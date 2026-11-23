import {act, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {RootBoundary, rootRetryDelay, ScreenBoundary} from './boundary';
import {frameSummary, installIdleHome} from './health';
import {attemptUrl, loadWithRetry, retryDelay} from './loader';
import {createWatchdog} from './watchdog';
import {createReporter} from './report';
import {createFakeHass} from '../lib/ha/ha-fixture';
import {createHaTransport} from '../lib/ha/transport';
import {createQueryClient} from '../lib/query/client';

let broken = true;
function Fragile({label}: {label: string}) {
  if (broken) throw new Error(`${label} broke`);
  return <p>{label} works</p>;
}

describe('error boundaries', () => {
  afterEach(() => {
    broken = true;
    vi.useRealTimers();
  });

  it('a screen that throws shows »Prøv igen«, reports, and a tap mounts it afresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reports: unknown[] = [];
    const user = userEvent.setup();
    render(
      <>
        <ScreenBoundary name="lights" onReport={report => reports.push(report)}>
          <Fragile label="Lys" />
        </ScreenBoundary>
        <p>Hjem stays</p>
      </>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Skærmen kunne ikke vises')).toBeTruthy();
    expect(screen.getByText('Hjem stays')).toBeTruthy();
    expect(reports).toEqual([expect.objectContaining({kind: 'boundary', message: 'Error: Lys broke'})]);
    broken = false;
    await user.click(screen.getByRole('button', {name: 'Prøv igen'}));
    expect(screen.getByText('Lys works')).toBeTruthy();
  });

  it('the root boundary remounts the shell by itself after a growing pause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
    const reports: unknown[] = [];
    render(
      <RootBoundary onReport={report => reports.push(report)}>
        <Fragile label="Shell" />
      </RootBoundary>,
    );
    expect(screen.getByText('PodView genstarter visningen …')).toBeTruthy();
    expect(reports).toHaveLength(1);
    broken = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(rootRetryDelay(1));
    });
    expect(screen.getByText('Shell works')).toBeTruthy();
    expect([1, 2, 3, 6, 9].map(rootRetryDelay)).toEqual([1000, 2000, 4000, 30_000, 30_000]);
  });

  it('a remount mounts the children afresh (their state is new)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    let fail = false;
    function Counter() {
      const [count, setCount] = useState(0);
      if (fail) throw new Error('boom');
      return <button type="button" onClick={() => { setCount(count + 1); }}>{`count ${String(count)}`}</button>;
    }
    const view = render(<RootBoundary delay={() => 10}><Counter /></RootBoundary>);
    await user.click(screen.getByRole('button', {name: 'count 0'}));
    expect(screen.getByRole('button', {name: 'count 1'})).toBeTruthy();
    fail = true;
    view.rerender(<RootBoundary delay={() => 10}><Counter /></RootBoundary>);
    fail = false;
    await user.click(screen.getByRole('button', {name: 'Prøv igen nu'}));
    expect(screen.getByRole('button', {name: 'count 0'})).toBeTruthy();
  });
});

describe('heartbeat watchdog', () => {
  function clock() {
    let now = 0;
    let visible = true;
    let tick: () => void = () => undefined;
    const stale = vi.fn();
    const dog = createWatchdog({
      onStale: stale,
      now: () => now,
      visible: () => visible,
      staleMs: 20_000,
      checkMs: 5000,
      setInterval: handler => {
        tick = handler;
        return 1;
      },
      clearInterval: () => undefined,
    });
    dog.start();
    const advance = (ms: number) => {
      for (let step = 0; step < ms; step += 5000) {
        now += 5000;
        tick();
      }
    };
    return {dog, stale, advance, setVisible: (value: boolean) => { visible = value; }, jump: (ms: number) => {
      now += ms;
      tick();
    }};
  }

  it('rebuilds when React stops committing while the page is visible', () => {
    const {dog, stale, advance} = clock();
    for (let i = 0; i < 10; i += 1) {
      advance(5000);
      dog.beat();
    }
    expect(stale).not.toHaveBeenCalled();
    advance(25_000);
    expect(stale).toHaveBeenCalledTimes(1);
    // Once per silence: the clock restarts after a rebuild.
    advance(10_000);
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it('never judges a hidden page or one the iPad suspended', () => {
    const {stale, advance, setVisible, jump} = clock();
    setVisible(false);
    advance(60_000);
    expect(stale).not.toHaveBeenCalled();
    setVisible(true);
    jump(10 * 60_000);
    expect(stale).not.toHaveBeenCalled();
    advance(15_000);
    expect(stale).not.toHaveBeenCalled();
  });
});

describe('loader', () => {
  it('retries a failed import with backoff and a fresh URL, until it loads', async () => {
    const urls: string[] = [];
    const waits: number[] = [];
    const bundle = new URL('https://ha.local/podvoice_static/frontend/0123456789ab/podview-panel.js');
    let failures = 3;
    await loadWithRetry(
      attempt => {
        urls.push(attemptUrl(bundle, attempt));
        return failures-- > 0 ? Promise.reject(new TypeError('Importing a module script failed.')) : Promise.resolve();
      },
      {wait: ms => { waits.push(ms); return Promise.resolve(); }},
    );
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(urls).toEqual([bundle.href, `${bundle.href}?retry=1`, `${bundle.href}?retry=2`, `${bundle.href}?retry=3`]);
    expect([7, 20].map(retryDelay)).toEqual([30_000, 30_000]);
  });

  it('a wake-up (network back, page shown) retries at once', async () => {
    vi.useFakeTimers();
    let resume: () => void = () => undefined;
    let attempts = 0;
    const done = loadWithRetry(() => (++attempts < 2 ? Promise.reject(new Error('busy')) : Promise.resolve()), {
      wake: next => { resume = next; return () => undefined; },
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);
    resume();
    await done;
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });
});

describe('reports to HA', () => {
  function setup() {
    const transport = createHaTransport(createQueryClient());
    const fake = createFakeHass({onChange: hass => { transport.setHass(hass); }});
    transport.setHass(fake.hass);
    let now = 0;
    const context = () => ({bundle: 'abc', room: 'kokken'});
    const reporter = createReporter({source: transport, now: () => now, context});
    return {fake, reporter, step: (ms: number) => { now += ms; }};
  }

  it('sends with context, once a minute per message, a few a minute in all', () => {
    const {fake, reporter, step} = setup();
    reporter.report({kind: 'error', message: 'TypeError: x'});
    reporter.report({kind: 'error', message: 'TypeError: x'});
    expect(fake.ws).toEqual([{type: 'podvoice/panel_report', kind: 'error', message: 'TypeError: x', bundle: 'abc',
      room: 'kokken'}]);
    for (let i = 0; i < 10; i += 1) reporter.report({kind: 'error', message: `e${String(i)}`});
    expect(fake.ws).toHaveLength(6);
    step(61_000);
    reporter.report({kind: 'error', message: 'TypeError: x'});
    expect(fake.ws).toHaveLength(7);
  });

  it('keeps what happened while HA was away and sends it when the link is back', () => {
    const {fake, reporter} = setup();
    fake.setConnected(false);
    reporter.report({kind: 'remount', message: 'React root rebuilt (watchdog)'});
    expect(fake.ws).toHaveLength(0);
    expect(reporter.pending()).toBe(1);
    fake.setConnected(true);
    reporter.flush();
    expect(fake.ws.map(message => message.kind)).toEqual(['remount']);
  });

  it('folds the frame meter sessions into one line', () => {
    expect(frameSummary([])).toBeNull();
    expect(frameSummary([{kind: 'push', frames: 40, over34: 1, maxFrameMs: 38.2, p95FrameMs: 17.1},
      {kind: 'tap', frames: 10, over34: 0, maxFrameMs: 16.9, p95FrameMs: 16.8}])).toBe(
      '2 touches (push,tap): 50 frames, 1 over 34 ms, worst 38.2 ms, worst p95 17.1 ms');
  });
});

describe('idle return to Hjem', () => {
  it('fires after the configured quiet time; a touch starts it again; 0 turns it off', () => {
    vi.useFakeTimers();
    const idle = vi.fn();
    const stop = installIdleHome({seconds: () => 120, onIdle: idle});
    vi.advanceTimersByTime(100_000);
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(100_000);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(idle).toHaveBeenCalledTimes(1);
    stop();
    const off = installIdleHome({seconds: () => 0, onIdle: idle});
    vi.advanceTimersByTime(10 * 60_000);
    expect(idle).toHaveBeenCalledTimes(1);
    off();
    vi.useRealTimers();
  });
});
