// The timer surfaces (TimerScreen, HomeTimer, HeaderTimer) in a real DOM, mounted once as the shell mounts them and
// driven only through what the shell and the server write: the scene (publishTimerScene), the snapshot and the
// connection (query cache), the command store and the alarm's records. Ported from timer-view.test.js,
// timer-overview.test.js and the DOM tests of timer-access.test.js (TimerView): the user-visible assertions are
// kept; reads of TimerView internals (view.canStart, view.nodes, renderAccess calls) became the rendered controls.
import assert from 'node:assert/strict';
import {act} from 'react';
import type {Root} from 'react-dom/client';
import {afterEach, beforeEach, test, vi} from 'vitest';
import {connectApi, offlineApi} from '../../lib/api/client';
import type {PodVoiceApi} from '../../lib/api/client';
import {ingestConnection, ingestSnapshot} from '../../lib/query/live';
import type {Connection} from '../../lib/query/live';
import {connectShell} from '../../lib/store/shell';
import type {ShellEvent} from '../../lib/store/shell';
import {anchorFor} from './display';
import type {Timer} from './model';
import {timerPresentation} from './presentation';
import {publishTimerCompletions, publishTimerScene, resetTimerState, syncTimerDisplay, timerCommands} from './state';
import type {TimerScene} from './state';
import {mountTimer} from './TimerScreen';

const SHELL = `<nav class="view-nav"><span class="header-context"><span id="header-timer-slot"></span></span></nav>
<section id="timers-view"></section><div id="timer-card"><div class="timer-active-list"></div>
<button id="open-timers"></button></div>`;

let roots: Root[] = [];
let dispatched: ShellEvent[] = [];
let calls: unknown[] = [];

beforeEach(() => {
  resetTimerState();
  dispatched = [];
  calls = [];
  connectShell({dispatch: event => dispatched.push(event), focusHeading: () => undefined});
  document.body.innerHTML = SHELL;
});
afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots = [];
  vi.useRealTimers();
});

const $ = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw Error(`missing ${selector}`);
  return node;
};
const page = () => $('#timers-view');
const detail = () => page().querySelector<HTMLElement>('.timer-running .timer-panel');
const overview = () => document.querySelector<HTMLElement>('#timer-card .timer-panel');
const form = () => $('#timers-view form') as HTMLFormElement;
const start = () => $('#timers-view .timer-start') as HTMLButtonElement;
const note = () => $('#timers-live-note');
const button = (root: Element | null, selector: string) => {
  const found = root?.querySelector<HTMLButtonElement>(selector);
  if (!found) throw Error(`missing ${selector}`);
  return found;
};
const press = (node: HTMLElement) => {
  act(() => {
    node.click();
  });
};

function scene(change: Partial<TimerScene> = {}) {
  act(() => {
    publishTimerScene({live: false, focus: 'timers', connected: true, timers: [], timerHistory: [], sessionId: 's',
      generation: 1, ...change});
    syncTimerDisplay();
  });
}
function mount(change: Partial<TimerScene> = {}) {
  scene(change);
  act(() => {
    roots = mountTimer({page: page(), overview: $('#timer-card .timer-active-list'), header: $('#header-timer-slot')});
  });
}
const LIVE: Connection = {mode: 'live', status: 'connected', connected: true, blocked: false, sessionExpired: false,
  browserOffline: false, acceptedReadAt: Date.now()};
function live(items: Record<string, unknown>[], actions = ['timer.start', 'timer.cancel'], connection = LIVE) {
  act(() => {
    ingestConnection(connection);
    ingestSnapshot({schema: 'podview.snapshot.v1', bootId: 'native-boot', roomId: 'kitchen', revision: 1,
      timers: {status: 'observed', epoch: 'epoch', items}, capabilities: {timerActions: actions, homeRead: []}});
  });
}
function api(result: Record<string, unknown> = {ok: true, outcome: 'accepted'}): PodVoiceApi {
  const value: PodVoiceApi = {
    ...offlineApi,
    timerAction: request => {
      calls.push(request);
      return Promise.resolve({requestId: request.requestId, retryAllowed: false, ...result} as never);
    },
    weatherAdvice: () => Promise.reject(new Error('unused')),
  };
  connectApi(value);
  return value;
}
// Every DOM mutation from now on, as "<what>": an unchanged render must produce none.
function writes() {
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
  return () => observer.takeRecords().map(record => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    return `${target?.className ?? ''}:${record.type}:${record.attributeName ?? ''}`;
  });
}

const native: Timer = {id: 'native-timer', name: 'Pasta', status: 'running', remaining: 59, duration: 60,
  deadline: 190000, ownerBootId: 'native-boot'};
const local: Timer = {id: 'local', name: '', status: 'running', remaining: 59, duration: 60,
  deadline: Date.now() + 59000};
const nativeRow = {id: 'native-timer', name: 'Pasta', status: 'running', secondsLeft: 59, durationSeconds: 60,
  sourceRevision: '7'};

test('unchanged timer data performs zero DOM writes and a one-second tick only updates digits, ring and aria', () => {
  mount({timers: [local]});
  const card = detail(), home = overview();
  const finish = button(card, '.timer-finish');
  finish.focus();
  const recorded = writes();
  scene({timers: [{...local}]});
  assert.deepEqual(recorded(), []);
  scene({timers: [{...local, remaining: 58}]});
  const changed = recorded();
  assert.ok(changed.length > 0);
  for (const write of changed)
    assert.match(write, /^(|timer-count|timer-open[^:]*|timer-panel[^:]*|timer-copy|timer-state|header-timer):/, write);
  assert.equal(detail(), card, 'the same card');
  assert.equal(overview(), home);
  assert.equal(document.activeElement, finish, 'focus stays');
  assert.equal(button(card, '.timer-count').textContent, '0:58');
});

test('a live timer keeps its authority through a countdown and switches the same completion action at once', () => {
  live([nativeRow]);
  mount({live: true, timers: [native]});
  const card = detail(), finish = button(card, '.timer-finish');
  assert.equal(finish.disabled, false);
  const recorded = writes();
  live([{...nativeRow, secondsLeft: 58}]);
  scene({live: true, timers: [{...native, remaining: 58}]});
  assert.equal(recorded().some(write => write.endsWith(':disabled')), false, 'a tick never revokes controls');
  live([{...nativeRow, status: 'finished', secondsLeft: 0}]);
  scene({live: true, timers: [{...native, status: 'done', remaining: 0}]});
  assert.equal(detail(), card);
  assert.equal(button(card, '.timer-finish').textContent, 'Stop alarm');
  for (const [surface, isDetail] of [[detail(), true], [overview(), false]] as const) {
    assert.equal(button(surface, '.timer-count').textContent, isDetail ? '0:00' : 'Tiden er gået');
    const state = button(surface, '.timer-state');
    assert.equal(state.textContent, isDetail ? 'Alarmen ringer, til du stopper den.' : '');
    assert.equal(state.hidden, !isDetail);
    const label = button(surface, '.timer-open').getAttribute('aria-label') ?? '';
    assert.equal(label.split('Tiden er gået').length - 1, 1);
    if (!isDetail) {
      assert.doesNotMatch(label, /0:00/);
      assert.match(label, /Åbn timerdetaljer$/);
    }
  }
  api();
  press(button(card, '.timer-finish'));
  assert.deepEqual(calls.map(call => (call as {action: string}).action), ['timer.cancel']);
});

test('lost authority disables the same retained action; a drained alarm reads Færdig', () => {
  live([{...nativeRow, status: 'finished', secondsLeft: 0, physicalDrained: true}]);
  mount({live: true, timers: [{...native, status: 'done', remaining: 0, physicalDrained: true}]});
  const finish = button(detail(), '.timer-finish');
  assert.equal(finish.textContent, 'Færdig');
  assert.equal(finish.getAttribute('aria-label'), 'Færdig timer');
  live([{...nativeRow, status: 'finished', secondsLeft: 0, physicalDrained: true}], ['timer.start', 'timer.cancel'],
    {...LIVE, status: 'disconnected', connected: false});
  assert.equal(button(detail(), '.timer-finish'), finish);
  assert.equal(finish.disabled, true);
  press(finish);
  assert.deepEqual(calls, []);
});

test('an observation wait marks the retained card busy without replacing its countdown; it ends with the wait', () => {
  live([nativeRow]);
  mount({live: true, timers: [native]});
  const card = detail();
  act(() => {
    timerCommands.setState({pending: true});
  });
  assert.equal(card?.getAttribute('aria-busy'), 'true');
  assert.equal(button(card, '.timer-count').textContent, '0:59');
  assert.equal(button(card, '.timer-finish').disabled, true);
  const recorded = writes();
  act(() => {
    timerCommands.setState({pending: true});
  });
  assert.deepEqual(recorded(), [], 'an unchanged wait writes nothing');
  act(() => {
    timerCommands.setState({pending: false});
  });
  assert.equal(card.getAttribute('aria-busy'), 'false');
  assert.equal(button(card, '.timer-finish').disabled, false);
});

test('recent durations stay inspectable when an empty timer page loses its connection', () => {
  mount({connected: false, timerHistory: [{name: 'Pasta', seconds: 600}]});
  const recent = $('#timers-view .timer-recent');
  assert.equal(recent.hidden, false);
  assert.equal(start().disabled, true);
  assert.equal(button(recent, '[data-recent-seconds]').disabled, true);
  const recorded = writes();
  scene({connected: false, timerHistory: [{name: 'Pasta', seconds: 600}]});
  assert.deepEqual(recorded(), []);
});

// Lærred »A-Timer« »Tidligere timere«: newest first as »Seneste«, the rest »Tidligere«; a tap fills the draft only.
test('recent timer pills refill the draft by duration without starting a timer', () => {
  mount({timerHistory: [{name: 'Pasta', seconds: 600}, {name: 'Te', seconds: 180}, {name: 'Ovn', seconds: 600}]});
  const rows = [...document.querySelectorAll<HTMLButtonElement>('#timers-view [data-recent-seconds]')];
  assert.deepEqual(rows.map(row => [Number(row.dataset.recentSeconds), row.getAttribute('aria-label')]),
    [[600, '10:00, Seneste. Justér før start'], [180, '3:00, Tidligere. Justér før start']]);
  press(rows[1] as HTMLElement);
  assert.equal($('#timers-view .timer-selected output').textContent, '3:00');
  assert.deepEqual(dispatched, []);
  assert.equal(document.activeElement, start(), 'Start is focused to adjust before starting');
});

test('recent timers wait during an active timer and keep five unique durations', () => {
  const history = [600, 180, 600, 60, 300, 900, 1200].map(seconds => ({name: 'x', seconds}));
  mount({timers: [local], timerHistory: history});
  const rows = [...document.querySelectorAll<HTMLButtonElement>('#timers-view [data-recent-seconds]')];
  assert.deepEqual(rows.map(row => Number(row.dataset.recentSeconds)), [600, 180, 60, 300, 900]);
  assert.ok(rows.every(row => row.disabled));
});

test('detail actions dispatch only permitted local timer operations', () => {
  mount({timers: [local]});
  const card = detail();
  const visible = [...(card?.querySelectorAll<HTMLButtonElement>('[data-timer-action]') ?? [])].filter(b => !b.hidden);
  assert.equal(visible.length, 1);
  assert.equal(button(card, '.timer-actions').hidden, false);
  press(visible[0] as HTMLElement);
  assert.equal(dispatched[0]?.action, 'pause');
  assert.equal(dispatched[0].id, 'local');
  scene({timers: [{...local, status: 'paused'}]});
  const toggle = button(card, '[data-timer-action="toggle"]');
  assert.equal(toggle.textContent, 'Fortsæt');
  press(toggle);
  assert.equal(dispatched[1]?.action, 'resume');
  scene({connected: false, timers: [{...local, status: 'paused'}]});
  assert.ok([...(card?.querySelectorAll<HTMLButtonElement>('[data-timer-action]') ?? [])].every(b => b.disabled));
  press(toggle);
  assert.equal(dispatched.length, 2);
});

test('a native timer without adjust permission offers no local controls', () => {
  live([nativeRow]);
  mount({live: true, timers: [native]});
  assert.equal(button(detail(), '.timer-actions').hidden, true);
});

test('the Home bar keeps its card through ticks and has none after cancellation', () => {
  mount({focus: 'now', timers: [local]});
  const card = overview();
  assert.ok(card);
  scene({focus: 'now', timers: [{...local, remaining: 58}]});
  assert.equal(overview(), card);
  scene({focus: 'now', timers: []});
  assert.equal(overview(), null);
});

test('a completed timer names the alarm time from the bell record, with honest blocked-audio copy', () => {
  const at = new Date(2026, 9, 20, 18, 5).getTime();
  live([{...nativeRow, status: 'finished', secondsLeft: 0}]);
  mount({live: true, timers: [{...native, status: 'done', remaining: 0}]});
  act(() => {
    publishTimerCompletions(new Map([[native.id, {at, exhausted: true, played: true}]]));
  });
  const card = detail();
  assert.equal(button(card, '.timer-copy strong').textContent, 'Timeren ringede kl. 18.05');
  act(() => {
    publishTimerCompletions(new Map([[native.id, {at, exhausted: true, played: false}]]));
  });
  assert.equal(button(card, '.timer-copy strong').textContent, 'Timeren blev færdig kl. 18.05');
  assert.equal(detail(), card);
});

test('lærred »Timer-faerdig«: a ringing local timer says when it rang, that it rings, and offers Stop alarm', () => {
  const at = new Date(2026, 9, 20, 18, 5).getTime();
  const done = {...local, status: 'done', remaining: 0};
  mount({timers: [done]});
  act(() => {
    publishTimerCompletions(new Map([[local.id, {at, exhausted: false, played: true}]]));
  });
  const card = detail(), finish = button(card, '.timer-finish');
  assert.equal(button(card, '.timer-copy strong').textContent, 'Timeren ringede 18.05');
  assert.equal(button(card, '.timer-state').textContent, 'Alarmen ringer, til du stopper den.');
  assert.equal(finish.textContent, 'Stop alarm');
  assert.equal(finish.getAttribute('data-kit-variant'), 'alarm');
  assert.equal(finish.getAttribute('data-kit-size'), '56');
  // Without the bell's record the local timer is only finished: no ringing copy and no alarm key.
  act(() => {
    publishTimerCompletions(new Map());
  });
  assert.notEqual(button(card, '.timer-copy strong').textContent, 'Timeren ringede 18.05');
  assert.notEqual(finish.textContent, 'Stop alarm');
  assert.equal(finish.getAttribute('data-kit-variant'), 'secondary');
});

test('running and paused timers hide creation and prevent draft changes until they end', () => {
  mount({timers: [local]});
  for (const status of ['running', 'paused']) {
    scene({timers: [{...local, status}]});
    assert.equal(form().hidden, true);
    for (const preset of form().querySelectorAll<HTMLButtonElement>('[data-minutes]')) assert.equal(preset.disabled, true);
    assert.equal(start().disabled, true);
  }
  scene({timers: [{...local, status: 'cancelled'}]});
  assert.equal(form().hidden, false);
  assert.equal(start().disabled, false);
});

test('a stale running timer keeps its dial and says it is not updated', () => {
  mount({timers: [{...local, stale: true}]});
  const card = detail();
  assert.equal(card?.dataset.stale, 'true');
  assert.equal(button(card, '.timer-state').textContent, 'Ikke opdateret');
  assert.equal($('#timers-view .timer-running h2').textContent, 'Senest kendte timer');
});

test('the draft: presets and steps choose the time, Start dispatches it and returns to Home once it runs', () => {
  mount();
  press(button(form(), '[data-minutes="10"]'));
  assert.equal($('#timers-view .timer-selected output').textContent, '10:00');
  press(button(form(), '[data-adjust="60"]'));
  assert.equal($('#timers-view .timer-selected output').textContent, '11:00');
  connectShell({dispatch: event => {
    dispatched.push(event);
    if (event.type === 'timer-start') scene({timers: [{...local, remaining: 660, duration: 660}]});
  }});
  act(() => {
    form().requestSubmit();
  });
  assert.deepEqual(dispatched.map(event => event.type), ['timer-start', 'show']);
  assert.equal(dispatched[0]?.seconds, 660);
  assert.deepEqual(dispatched[1], {type: 'show', id: 'now'});
});

test('live Start returns to Home only when the exact new timer is observed fresh', async () => {
  live([]);
  api({ok: true, outcome: 'accepted', timerId: 'new'});
  mount({live: true});
  await act(async () => {
    form().requestSubmit();
    await Promise.resolve();
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(dispatched, [], `an accepted receipt is not yet the timer ${JSON.stringify(dispatched)}`);
  live([{id: 'new', name: '', status: 'running', secondsLeft: 300, durationSeconds: 300, sourceRevision: '1'}]);
  scene({live: true, timers: [{...native, id: 'new', remaining: 300, duration: 300}]});
  assert.deepEqual(dispatched, [], 'no navigation before the snapshot is reconciled');
  const {readSnapshot} = await import('../../lib/query/live');
  act(() => {
    timerCommands.reconcile(readSnapshot());
  });
  assert.deepEqual(dispatched, [{type: 'show', id: 'now'}]);
});

test('one feedback slot follows the visible timer surface: the draft, then the detail card', () => {
  live([], ['timer.start', 'timer.cancel']);
  mount({live: true});
  act(() => {
    timerCommands.setState({feedback: 'Udfald ukendt · handlingen gentages ikke', phase: 'unknown'});
  });
  assert.equal(note().closest('form'), form());
  assert.equal(note().textContent, 'Udfald ukendt · handlingen gentages ikke');
  assert.equal(note().hidden, false);
  live([nativeRow]);
  scene({live: true, timers: [native]});
  assert.equal(note().closest('.timer-panel'), detail());
  act(() => {
    timerCommands.setState({feedback: '', phase: null});
  });
  assert.equal(note().hidden, true);
});

test('an unavailable first-empty draft keeps its anatomy without granting Start and says why', () => {
  live([], [], {...LIVE, status: 'disconnected', connected: false});
  mount({live: true});
  assert.equal(form().hidden, false);
  assert.equal(start().disabled, true);
  assert.equal((form().elements[0] as HTMLButtonElement).disabled, true);
  assert.equal(note().hidden, false);
  assert.equal(note().textContent, 'Timerstyring er ikke tilgængelig lige nu.');
});

test('pending and unknown block Start and Cancel; recovery restores only the actual permissions', () => {
  live([], ['timer.start', 'timer.cancel']);
  mount({live: true});
  for (const blocked of [{pending: true}, {phase: 'unknown' as const, feedback: 'Udfald ukendt · handlingen gentages ikke'}]) {
    act(() => {
      timerCommands.setState(blocked);
    });
    assert.equal(form().hidden, false);
    assert.equal(start().disabled, true);
    act(() => {
      timerCommands.setState({pending: false, phase: null, feedback: ''});
    });
  }
  assert.equal(start().disabled, false);
  assert.equal(note().hidden, true);
});

test('aria-busy tells an active wait from an unknown outcome', () => {
  live([], ['timer.start', 'timer.cancel']);
  mount({live: true});
  const rows: [string, boolean, boolean, 'sending' | 'awaiting' | 'unknown' | null][] = [
    ['', true, true, 'sending'],
    ['Afventer opdateret timer', false, true, 'awaiting'],
    ['Udfald ukendt · handlingen gentages ikke', false, false, 'unknown'],
    ['', false, false, null],
  ];
  for (const [feedback, pending, busy, phase] of rows) {
    act(() => {
      timerCommands.setState({pending, feedback, phase});
    });
    assert.equal(form().getAttribute('aria-busy'), String(busy), feedback);
    assert.equal(note().getAttribute('aria-busy'), String(busy), feedback);
    assert.equal(start().disabled, phase !== null || pending);
    if (busy) assert.equal(note().textContent, '');
  }
});

test('a native +1 min sends the exact row once; a held adjustment keeps ±1 tappable and Cancel possible', async () => {
  live([{...nativeRow, secondsLeft: 120, durationSeconds: 300}], ['timer.start', 'timer.cancel', 'timer.adjust']);
  mount({live: true, timers: [{...native, remaining: 120, duration: 300, sourceRevision: '7'}]});
  const pending = new Promise<never>(() => undefined);
  connectApi({...offlineApi, timerAction: request => {
    calls.push(request);
    return pending;
  }, weatherAdvice: () => Promise.reject(new Error('unused'))});
  const card = detail();
  const plus = button(card, '[data-delta-seconds="60"]'), minus = button(card, '[data-delta-seconds="-60"]');
  assert.equal(plus.hidden, false);
  await act(async () => {
    plus.click();
    await Promise.resolve();
  });
  assert.deepEqual((calls[0] as {args: unknown}).args, {timer_id: 'native-timer', delta_seconds: 60, expected_revision: '7'});
  assert.equal(plus.getAttribute('aria-busy'), 'true', 'the chosen button spins');
  assert.equal(minus.disabled, false, 'the other stays tappable: taps queue');
  press(minus);
  assert.equal(calls.length, 1, 'a queued tap is not sent while the first is in flight');
  assert.equal(button(card, '.timer-finish').disabled, false, 'Cancel of the observed timer stays possible');
  assert.equal(detail(), card);
});

test('v1 metadata or a revoked adjust permission never shows ±1 min', () => {
  live([{...nativeRow, durationSeconds: undefined, sourceRevision: undefined}], ['timer.cancel', 'timer.adjust']);
  mount({live: true, timers: [{...native, sourceRevision: undefined}]});
  assert.equal(button(detail(), '[data-delta-seconds="60"]').hidden, true);
  live([nativeRow], ['timer.cancel']);
  scene({live: true, timers: [{...native, sourceRevision: '7'}]});
  assert.equal(button(detail(), '[data-delta-seconds="60"]').hidden, true);
});

test('the topbar chip shows a running timer on every page but Timer, and opens Timer', () => {
  mount({focus: 'now', timers: [local]});
  const chip = $('#header-timer') as HTMLButtonElement;
  assert.equal(chip.hidden, false);
  assert.equal(chip.getAttribute('aria-label'), 'Timer 0:59, Tæller ned');
  assert.equal(chip.querySelector('span')?.textContent, '0:59');
  press(chip);
  assert.deepEqual(dispatched[0], {type: 'show', id: 'timers'});
  scene({focus: 'timers', timers: [local]});
  assert.equal(chip.hidden, true);
  scene({focus: 'now', timers: [{...local, status: 'done', remaining: 0}]});
  assert.equal(chip.hidden, true);
});

// P5 (docs/MOTION.md §3.6): the ring names its last change: a countdown tick, else the user's change.
test('the ring marks a tick as a tick and +1 min as the user’s change', () => {
  mount({timers: [local]});
  const card = detail();
  scene({timers: [{...local, remaining: 58}]});
  assert.equal(card?.dataset.pvProgress, 'tick');
  scene({timers: [{...local, remaining: 118, duration: 120}]});
  assert.equal(card.dataset.pvProgress, 'user');
});

// The live countdown between two snapshots (display.ts): every second, never past zero, never a completion.
test('a native timer counts each second between observations and stands still on doubt', () => {
  const snapshot = {bootId: 'native-boot', roomId: 'kitchen', revision: 1, schema: 'podview.snapshot.v1' as const,
    capabilities: {timerActions: []}, timers: {status: 'observed' as const, epoch: 'e', items: [{...nativeRow}]}};
  const facts = {live: true, snapshot, fresh: true, accessConnected: true};
  let step = anchorFor(null, native, facts, 0);
  assert.equal(step.displayed, 59);
  step = anchorFor(step.anchor, native, facts, 1000);
  assert.equal(step.displayed, 58);
  step = anchorFor(step.anchor, {...native}, facts, 2500);
  assert.equal(step.displayed, 57, 'a duplicate source count keeps its anchor');
  const stale = anchorFor(step.anchor, native, {...facts, fresh: false}, 9000);
  assert.equal(stale.displayed, 57, 'an old read stands still');
  const end = anchorFor(null, {...native, remaining: 1}, {...facts, snapshot: {...snapshot, timers: {...snapshot.timers,
    items: [{...nativeRow, secondsLeft: 1}]}}}, 0);
  const zero = anchorFor(end.anchor, {...native, remaining: 1}, {...facts, snapshot: end.anchor ? {...snapshot, timers:
    {...snapshot.timers, items: [{...nativeRow, secondsLeft: 1}]}} : null}, 5000);
  assert.equal(zero.displayed, 0);
  assert.equal(timerPresentation([{...native, remaining: 0}]).current?.status, 'running', 'zero is not completion');
});

test('the presentation keeps one current timer: an unfinished alarm first, then the running timer ending first', () => {
  const timers: Timer[] = [
    {id: 'later', status: 'running', deadline: 9000, remaining: 9},
    {id: 'attention', status: 'done', noticeDismissed: false, deadline: null, remaining: 0},
    {id: 'sooner', status: 'running', deadline: 3000, remaining: 3},
  ];
  const view = timerPresentation(timers);
  assert.deepEqual(view.visible.map(timer => timer.id), ['attention']);
  assert.deepEqual(view.all.map(timer => timer.id), ['later', 'attention', 'sooner']);
  assert.equal(view.canStart, false);
  assert.equal(timerPresentation(timers.filter(t => t.id !== 'attention')).current?.id, 'sooner');
  const finished = timerPresentation([{id: 'f', status: 'done', noticeDismissed: true, remaining: 1, deadline: null},
    {id: 'n', status: 'running', remaining: 12, deadline: 12000}]);
  assert.equal(finished.current?.id, 'f');
  assert.equal(finished.current.remaining, 0);
  assert.equal(finished.all[0]?.remaining, 1);
  assert.equal(timerPresentation([]).canStart, true);
  assert.equal(timerPresentation([{id: 'c', status: 'cancelled', remaining: 0}]).canStart, true);
});
