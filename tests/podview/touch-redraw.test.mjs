// Touch smoothness on iPad and Mac: data that is not caused by the touch (clock, outputs, the player
// refresh) waits until the finger lifts, and redraws write the root only on change, because each
// root write restyles the whole page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('a redraw waits while the finger is down and runs right after', async () => {
  const source = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),
    'utf8');
  const body = source.match(/function deferForGesture\(host,kind='render'\)\{([\s\S]*?)\n\}/)[1];
  const timers = [];
  const host = {
    touching: false, isConnected: true, renders: 0,
    render() { this.renders++; },
  };
  const deferFn = new Function('host', 'kind', 'Date', 'setTimeout', 'clearTimeout', body);
  const defer = (clock, set, clear, kind = 'render') => deferFn(host, kind, clock, set, clear);
  const clock = { now: () => 10_000 };
  const run = () => defer(clock, (fn) => timers.push(fn), () => {});
  assert.equal(run(), false, 'idle: redraw now');
  host.touching = true;
  assert.equal(run(), true, 'finger down: redraw waits');
  host.touching = false;
  timers.at(-1)();
  assert.equal(host.renders, 1, 'the waiting redraw runs once afterwards');
  host.lives = 0;host.renderLive = function () { this.lives++; };
  host.touching = true;
  assert.equal(defer(clock, (fn) => timers.push(fn), () => {}, 'renderLive'), true, 'live redraw waits too');
  timers.at(-1)();
  assert.deepEqual([host.renders, host.lives], [1, 1], 'a waiting live redraw stays a light live redraw');
  defer(clock, (fn) => timers.push(fn), () => {}, 'renderLive');
  defer(clock, (fn) => timers.push(fn), () => {}, 'render');
  defer(clock, (fn) => timers.push(fn), () => {}, 'renderLive');
  timers.at(-1)();
  assert.deepEqual([host.renders, host.lives], [2, 1], 'a waiting full redraw is never downgraded');
});

test('live data redraws wait for the finger; navigation redraws do not', async () => {
  const source = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),
    'utf8');
  assert.match(source, /renderLive\(\)\{if\(this\.touching&&deferForGesture\(this,'renderLive'\)\)return;/);
  assert.doesNotMatch(source, /render\(\)\{if\([^)]*deferForGesture\(this\)\)return;/);
});

test('cached date formatting gives the same text as toLocaleTimeString', async () => {
  const { formatDate } = await import('../../podvoice/gatekeeper/static/podview/ui/date-format.js');
  const at = new Date('2026-11-12T19:05:00Z');
  for (const options of [{ hour: '2-digit', minute: '2-digit' },
    { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' }]) {
    assert.equal(formatDate(at, options), at.toLocaleTimeString('da-DK', options));
  }
  const day = { weekday: 'short', day: 'numeric', month: 'short' };
  assert.equal(formatDate(at, day), at.toLocaleDateString('da-DK', day));
});

test('an unchanged screen sync writes nothing on the root (each root write restyles the whole page)', async () => {
  const { ScreenLifecycle } = await import('../../podvoice/gatekeeper/static/podview/ui/screen-lifecycle.js');
  const writes = [];
  const values = new Map();
  const dataset = new Proxy({}, {
    set(target, key, value) { writes.push(`data-${String(key)}`); target[key] = value; return true; },
  });
  const host = {
    dataset, state: { focus: 'now' }, isConnected: true, live: false,
    ownerDocument: { visibilityState: 'visible' },
    style: {
      getPropertyValue: (name) => values.get(name) || '',
      setProperty: (name, value) => { writes.push(name); values.set(name, value); },
    },
  };
  const lifecycle = Object.create(ScreenLifecycle.prototype);
  Object.assign(lifecycle, {
    host, attached: true, clock: { now: () => Date.UTC(2026, 10, 12, 12) }, nightWakeUntil: 0, step: 0, kiosk: false,
    syncDetail() {}, syncIdle() {}, syncWakeLock() {},
  });
  lifecycle.sync();
  assert.ok(writes.length > 0, 'first sync sets the root');
  writes.length = 0;
  lifecycle.sync();
  assert.deepEqual(writes, []);
});

test('edge-drag preview writes the root only on change', async () => {
  const source = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),
    'utf8');
  const preview = source.match(/preview:progress=>\{([\s\S]*?)\n  \}/)[1];
  assert.match(preview, /if\(this\.dataset\.edgeDrag!==drag\)/);
  assert.match(preview, /getPropertyValue\?\.\('--edge-progress'\)!==value/);
});

test('the player refresh waits while a finger is down and runs right after', async () => {
  const { LiveMediaView } = await import('../../podvoice/gatekeeper/static/podview/live-media-view.js');
  const source = LiveMediaView.prototype.render.toString();
  const waits = /if\(this\.host\.touching\)\{/;
  assert.match(source, waits);
  const view = Object.create(LiveMediaView.prototype);
  view.host = { touching: true };
  const realSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  try {
    view.render();
    assert.equal(timers.length, 1, 'redraw postponed, not run under the finger');
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});
