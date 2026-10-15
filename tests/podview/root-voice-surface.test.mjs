import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSurface, voicePresentation } from '../../podvoice/gatekeeper/static/podview/voice-surface.js';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function withBrowser(run, { reduced = false } = {}) {
  const previous = {
    document: globalThis.document,
    matchMedia: globalThis.matchMedia,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const timers = new Map();
  let nextTimer = 1;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  const env = {
    timers,
    fire(id) { const timer = timers.get(id); if (timer) { timers.delete(id); timer.callback(); } },
    latestTimer() { return [...timers.entries()].at(-1); },
  };
  try { return run(env); }
  finally {
    globalThis.document = previous.document;
    globalThis.matchMedia = previous.matchMedia;
    globalThis.setTimeout = previous.setTimeout;
    globalThis.clearTimeout = previous.clearTimeout;
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.inert = false;
    this.textContent = '';
    this.animations = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  querySelector(selector) {
    if (selector === '.voice-copy') return this.children.find(child => child.className === 'voice-copy') ?? null;
    return null;
  }
  animate(frames, options) {
    let resolve;
    const animation = {
      frames, options, cancelled: 0,
      finished: new Promise(done => { resolve = done; }),
      cancel() { this.cancelled++; },
      finish() { resolve(); },
    };
    this.animations.push(animation);
    return animation;
  }
}

function fixture() {
  const host = new FakeElement('div');
  host.dataset.motion = 'system';
  host.isConnected = true;
  return { host, surface: new VoiceSurface(host) };
}

const view = (sessionId, turnId, phase = 'thinking') => voicePresentation({
  active: true, sessionId, turnId, phase: phase.toUpperCase() === phase ? phase : ({
    listening: 'LISTENING', thinking: 'THINKING', responding: 'AI_SPEAKING', ready: 'LOUNGE_WINDOW',
  })[phase],
});

test('same session, turn, and phase ticks do not restart the acknowledgement or wait timer', () => withBrowser(({ timers }) => {
  const { surface } = fixture();
  const first = view('s1', 't1', 'thinking');
  surface.update(first);
  const animationCount = surface.node.animations.length + surface.mark.animations.length;
  const timer = surface.slowTimer;
  surface.update({ ...first, label: 'Updated copy' });
  assert.equal(surface.node.animations.length + surface.mark.animations.length, animationCount);
  assert.equal(surface.slowTimer, timer);
  assert.equal(timers.size, 1);
}));

test('thinking wait copy is fenced by the current session, turn, and phase', () => withBrowser(({ fire, latestTimer }) => {
  const { surface } = fixture();
  surface.update(view('s1', 't1', 'thinking'));
  const oldCallback = latestTimer()[1].callback;
  surface.update(view('s1', 't2', 'thinking'));
  oldCallback(); // A callback already queued before clearTimeout must still be harmless.
  assert.equal(surface.detail.textContent, 'Et øjeblik');
  const currentTimer = latestTimer()[0];
  fire(currentTimer);
  assert.equal(surface.detail.textContent, 'Det tager lidt længere tid');
  surface.update(view('s2', 't3', 'thinking'));
  assert.equal(surface.detail.textContent, 'Et øjeblik');
}));

test('a close that is still animating cannot hide a newly reopened conversation', async () => withBrowser(async () => {
  const { surface } = fixture();
  surface.update(view('s1', 't1', 'listening'));
  surface.update(null);
  const exiting = surface.animation;
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.node.inert, true);
  surface.update(view('s2', 't1', 'responding'));
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.node.inert, false);
  exiting.finish();
  await flush();
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.label.textContent, 'Svarer…');
}));

test('cleanup cancels timers and every active animation and hides the detached surface', () => withBrowser(({ timers }) => {
  const { surface } = fixture();
  surface.update(view('s1', 't1', 'thinking'));
  const animations = [surface.animation, surface.copyAnimation, surface.markAnimation].filter(Boolean);
  assert.ok(timers.size > 0);
  surface.cleanup();
  assert.equal(timers.size, 0);
  assert.ok(animations.every(animation => animation.cancelled > 0));
  assert.equal(surface.node.hidden, true);
  assert.equal(surface.node.inert, true);
  assert.equal(surface.value, null);
}));

test('reduced motion keeps state feedback without starting Web Animations', () => withBrowser(() => {
  const { surface } = fixture();
  surface.host.dataset.motion = 'reduced';
  surface.update(view('s1', 't1', 'listening'));
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.node.dataset.phase, 'listening');
  assert.equal(surface.label.textContent, 'Lytter…');
  assert.equal(surface.node.animations.length, 0);
  assert.equal(surface.mark.animations.length, 0);
}));

test('inactive and disconnected voice has no presentation; unknown phase is a neutral waiting state', () => {
  assert.equal(voicePresentation({ active: true, phase: 'NOT_A_PHASE' }), null);
  assert.equal(voicePresentation({ active: false, phase: 'THINKING' }), null);
  assert.equal(voicePresentation({ active: true, phase: 'THINKING' }, false), null);
  assert.equal(voicePresentation({ active: true, phase: 'THINKING' }).phase, 'thinking');
  assert.equal(voicePresentation({ active: true, phase: 'UNKNOWN' }).phase, 'waiting');
});

test('presentation keys change across boot sessions, turns, and phases', () => {
  const one = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-1', phase: 'THINKING' });
  const same = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-1', phase: 'THINKING' });
  const nextTurn = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-2', phase: 'THINKING' });
  const nextBoot = voicePresentation({ active: true, sessionId: 'boot-b', turnId: 'turn-1', phase: 'THINKING' });
  const nextPhase = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-1', phase: 'AI_SPEAKING' });
  assert.equal(one.key, same.key);
  assert.notEqual(one.key, nextTurn.key);
  assert.notEqual(one.key, nextBoot.key);
  assert.notEqual(one.key, nextPhase.key);
});

test('a live reduced-motion preference change cancels an in-flight exit and cleanup detaches the listener',()=>withBrowser(()=>{
 const media=new EventTarget();media.matches=false;globalThis.matchMedia=()=>media;
 const {surface}=fixture();surface.update(view('s1','t1','thinking'));surface.update(null);const exiting=surface.animation;
 media.matches=true;media.dispatchEvent(new Event('change'));
 assert.ok(exiting.cancelled>0);assert.equal(surface.node.hidden,true);assert.equal(surface.animation,null);
 surface.cleanup();surface.node.hidden=false;media.dispatchEvent(new Event('change'));assert.equal(surface.node.hidden,false);
}));

test('a detached host cannot reopen or schedule a new voice surface',()=>withBrowser(({timers})=>{
 const {surface,host}=fixture();host.isConnected=false;surface.update(view('s1','t1','thinking'));
 assert.equal(surface.node.hidden,true);assert.equal(surface.node.inert,true);assert.equal(timers.size,0);
}));
