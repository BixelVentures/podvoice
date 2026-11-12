// Strip mode for weak wall screens (Frameo: RK3126, Android 6, WebView/Chrome 107). Scroll measured
// 14–24 fps with 1.5–2.2 s freezes; the main thread was busy with decorative work during scroll
// (scroll-edge fades re-measured on every scroll event, motion geometry holds, painted effects).
// Strip mode keeps every function and text, and removes that decoration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liteMode, LITE_KEY } from '../../podvoice/gatekeeper/static/podview/ui/lite.js';

const FRAMEO = 'Mozilla/5.0 (Linux; Android 6.0.1; Frame Build/MXC89K; wv) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/107.0.5304.36 Safari/537.36';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const storage = (value) => ({ getItem: (key) => (key === LITE_KEY ? value : null) });

test('a weak wall screen (Chrome before 111) gets strip mode automatically', () => {
  assert.equal(liteMode({ userAgent: FRAMEO, storage: storage(null) }), true);
});

test('Mac and iPad keep the full design', () => {
  assert.equal(liteMode({ userAgent: MAC_CHROME, storage: storage(null) }), false);
  assert.equal(liteMode({ userAgent: IPAD, storage: storage(null) }), false);
});

test('a per-screen setting forces strip mode on or off', () => {
  assert.equal(liteMode({ userAgent: IPAD, storage: storage('1') }), true);
  assert.equal(liteMode({ userAgent: FRAMEO, storage: storage('0') }), false);
  const blocked = { getItem() { throw new Error('storage blocked'); } };
  assert.equal(liteMode({ userAgent: FRAMEO, storage: blocked }), true, 'blocked storage falls back to auto');
});

test('strip mode removes painted effects and motion in the delivered stylesheet', async () => {
  const css = await readFile(new URL('../../podvoice/gatekeeper/static/podview/podview.css', import.meta.url), 'utf8');
  const rule = css.match(/html\[data-lite\] \*,[^{]*\{([^}]*)\}/);
  assert.ok(rule, 'strip rule present');
  for (const declaration of ['animation:none!important', 'transition:none!important', 'box-shadow:none!important',
    'backdrop-filter:none!important']) {
    assert.ok(rule[1].includes(declaration), declaration);
  }
});

test('strip mode does not start scroll-edge fades or motion bookkeeping', async () => {
  const source = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),
    'utf8');
  const guarded = /if\(!this\.lite\)\{this\.motion\?\?=new SceneMotion\(this\);this\.scrollEdges\?\?=new ScrollEdges/;
  assert.match(source, guarded);
});

test('strip mode makes every Web Animation finish at once and disables zoom', async () => {
  const { applyLiteMode } = await import('../../podvoice/gatekeeper/static/podview/ui/lite.js');
  const calls = [];
  class Element {}
  Element.prototype.animate = function (keyframes, timing) {
    calls.push(timing);
    return { finished: Promise.resolve() };
  };
  const attributes = new Map();
  let viewport = 'width=device-width';
  const doc = {
    documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
    querySelector: () => ({ setAttribute: (_, value) => { viewport = value; } }),
    defaultView: { Element },
  };
  applyLiteMode(doc);
  applyLiteMode(doc);
  const fade = { duration: 200, delay: 50, easing: 'ease-out', fill: 'both' };
  new Element().animate([{ opacity: 0 }, { opacity: 1 }], fade);
  new Element().animate([{ opacity: 0 }], 300);
  assert.equal(attributes.has('data-lite'), true);
  assert.match(viewport, /user-scalable=no/);
  assert.deepEqual(calls[0], { duration: 0, delay: 0, endDelay: 0, easing: 'ease-out', fill: 'both' });
  assert.deepEqual(calls[1], { duration: 0, delay: 0, endDelay: 0 });
});

test('a redraw waits while the finger is down or content scrolls, and runs right after', async () => {
  const source = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),
    'utf8');
  const body = source.match(/function deferForGesture\(host\)\{([\s\S]*?)\n\}/)[1];
  const timers = [];
  const host = {
    touching: false, lastScrollAt: 0, isConnected: true, renders: 0,
    render() { this.renders++; },
  };
  const deferFn = new Function('host', 'Date', 'setTimeout', 'clearTimeout', body);
  const defer = (clock, set, clear) => deferFn(host, clock, set, clear);
  const clock = { now: () => 10_000 };
  const run = () => defer(clock, (fn) => timers.push(fn), () => {});
  assert.equal(run(), false, 'idle: redraw now');
  host.touching = true;
  assert.equal(run(), true, 'finger down: redraw waits');
  host.touching = false;
  host.lastScrollAt = 9_950;
  assert.equal(run(), true, 'scrolled 50 ms ago: redraw waits');
  host.lastScrollAt = 0;
  timers.at(-1)();
  assert.equal(host.renders, 1, 'the waiting redraw runs once afterwards');
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

test('in strip mode the touched element shows pressed at once via its own inline style', async () => {
  const { attachPressedState } = await import('../../podvoice/gatekeeper/static/podview/ui/pressed-state.js');
  const handlers = new Map();
  let styleReads = 0;
  const target = {
    classes: new Set(), animations: 0, dataset: {}, disabled: false, isConnected: true, id: 'home-vehicle',
    inline: new Map(),
    style: {
      setProperty(name, value) { target.inline.set(name, value); },
      removeProperty(name) { target.inline.delete(name); },
    },
    classList: { add(name) { target.classes.add(name); }, remove(name) { target.classes.delete(name); } },
    matches: (selector) => selector.startsWith('button,'),
    getAttribute: () => null, setAttribute() {}, removeAttribute() {}, closest: () => null,
    animate() { target.animations++; return { cancel() {}, finished: Promise.resolve() }; },
  };
  const win = {
    addEventListener: (name, fn) => handlers.set(`win:${name}`, fn), removeEventListener() {},
    getComputedStyle: () => { styleReads++; return { boxShadow: 'none', color: 'rgb(0, 0, 0)' }; },
  };
  const doc = {
    defaultView: win, addEventListener() {}, removeEventListener() {},
    documentElement: { hasAttribute: (name) => name === 'data-lite' },
  };
  const surface = {
    ownerDocument: doc, addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener() {},
  };
  attachPressedState(surface);
  const event = (type, x = 0, y = 0) => ({ type, pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true,
    composedPath: () => [target, surface] });
  handlers.get('pointerdown')(event('pointerdown'));
  assert.equal(target.inline.get('transform'), 'scale(.97)', 'pressed on touch-down, before any click');
  assert.equal(target.classes.has('is-pressed'), false, 'no class: it restyled the whole page');
  handlers.get('win:pointerup')(event('pointerup'));
  assert.equal(target.inline.size, 0, 'released on lift');
  handlers.get('pointerdown')(event('pointerdown'));
  handlers.get('pointermove')(event('pointermove', 0, 30));
  assert.equal(target.inline.size, 0, 'dragging the finger away cancels the press');
  assert.deepEqual({ styleReads, animations: target.animations }, { styleReads: 0, animations: 0 });
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

test('edge-drag preview never writes the root in strip mode and only on change elsewhere', async () => {
  const source = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),
    'utf8');
  const preview = source.match(/preview:progress=>\{([\s\S]*?)\n  \}/)[1];
  assert.match(preview, /if\(this\.lite\)return;/);
  assert.match(preview, /if\(this\.dataset\.edgeDrag!==drag\)/);
  assert.match(preview, /getPropertyValue\?\.\('--edge-progress'\)!==value/);
});
