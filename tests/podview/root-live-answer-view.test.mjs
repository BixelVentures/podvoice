import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveAnswerView } from '../../podvoice/gatekeeper/static/podview/live-answer-view.js';

class Node extends EventTarget {
  constructor(tag) {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.attributes = new Map(); this.isConnected = true; this.open = false; this.hidden = false;
    this.textContent = ''; this.className = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

const receiptId = 'a'.repeat(32);
function fixture({ focus = 'photo', modal = false } = {}) {
  const priorDocument = globalThis.document;
  const active = new Node('button');
  globalThis.document = {
    activeElement: active,
    createElement: tag => new Node(tag),
    querySelector: selector => selector === 'dialog[open]' && modal ? {} : null,
  };
  const host = new Node('host');
  host.dataset.edgeDrag = 'false';
  host.state = { focus, answers: [] };
  host.lastInteractionAt = 0;
  host.contains = node => node === active;
  host.focusHeading = () => { host.headingFocused = true; };
  host.dispatch = event => {
    host.events.push(event);
    if (event.type === 'show') host.state = { ...host.state, focus: event.id };
  };
  host.events = [];
  host.render = () => { host.renderCount = (host.renderCount || 0) + 1; };
  const snapshot = {
    bootId: 'boot-a', roomId: 'room',
    voice: { sessionId: 'session-a', active: false },
    capabilities: { answerRead: true },
    answers: { revision: 2, sessionId: 'session-a', turnId: 'turn-a', taskId: 'task-a', inputRevision: 1 },
  };
  host.liveSnapshot = snapshot;
  const request = deferred();
  host.liveTransport = { connected: true, answers: () => request.promise };
  const view = new LiveAnswerView(host);
  const answer = () => ({ schema: 'podview.answers.v1', roomId: 'room', revision: 2, items: [{
    receiptId, sessionId: 'session-a', turnId: 'turn-a', taskId: 'task-a', inputRevision: 1,
    observedAt: Date.now() / 1000, provenance: { kind: 'tool_result' }, family: 'fact-card',
    displaySuggested: true,
    content: {
      summary: 'Observeret svar',
      facts: [{ id: 'fact', label: 'Temperatur', value: '12 °C', detail: 'Aktuel måling', sourceId: 'source' }],
      sources: [{ id: 'source', kind: 'owner_receipt', receiptId, label: 'Værktøjsresultat', scope: 'tool_result' }],
    },
  }] });
  return {
    host, view, request, answer, active,
    restore() { view.invalidate(); globalThis.document = priorDocument; },
    async read(result = answer()) { const pending = view.refresh(); request.resolve(result); await pending; },
  };
}

test('completed exact-owner receipt opens from the photo even after voice becomes inactive', async () => {
  const f = fixture();
  try {
    await f.read();
    assert.equal(f.host.liveSnapshot.voice.active, false);
    assert.deepEqual(f.host.events, [{ type: 'show', id: `receipt:${receiptId}` }]);
    assert.equal(f.host.state.answers[0].receiptId, receiptId);
    assert.equal(f.view.presented.has(`receipt:${receiptId}`), true);
  } finally { f.restore(); }
});

test('recent touch or active edge gesture defers presentation until a later read', async () => {
  const f = fixture();
  try {
    f.host.lastInteractionAt = Date.now();
    await f.read();
    assert.equal(f.host.events.length, 0);
    assert.equal(f.host.state.answers.length, 1);

    f.host.lastInteractionAt = 0;
    f.host.dataset.edgeDrag = 'true';
    f.view.lastRead = Date.now() - 5000;
    const second = deferred(); f.host.liveTransport.answers = () => second.promise;
    const pending = f.view.refresh(); second.resolve(f.answer()); await pending;
    assert.equal(f.host.events.length, 0);

    f.host.dataset.edgeDrag = 'false';
    f.view.lastRead = Date.now() - 5000;
    const third = deferred(); f.host.liveTransport.answers = () => third.promise;
    const later = f.view.refresh(); third.resolve(f.answer()); await later;
    assert.equal(f.host.events.length, 1);
  } finally { f.restore(); }
});

test('a detail view and an open modal keep the completed answer from interrupting', async () => {
  for (const options of [{ focus: 'weather' }, { modal: true }]) {
    const f = fixture(options);
    try {
      await f.read();
      assert.equal(f.host.events.length, 0);
      assert.equal(f.host.state.answers.length, 1);
    } finally { f.restore(); }
  }
});

test('same-boot task replacement, boot change, and permission revoke fence pending results', async () => {
  const cases = [
    ['same-boot context change', f => { f.host.liveSnapshot.answers = { ...f.host.liveSnapshot.answers, turnId: 'turn-b', taskId: 'task-b' }; }],
    ['boot change', f => { f.host.liveSnapshot.bootId = 'boot-b'; }],
    ['permission revoke', f => { f.host.liveSnapshot.capabilities.answerRead = false; f.view.invalidate(true); }],
  ];
  for (const [label, change] of cases) {
    const f = fixture();
    try {
      const pending = f.view.refresh();
      change(f);
      f.request.resolve(f.answer());
      await pending;
      assert.equal(f.host.events.length, 0, label);
      assert.equal(f.host.state.answers.length, 0, label);
    } finally { f.restore(); }
  }
});

test('returning an already presented answer to now does not reopen it automatically', async () => {
  const f = fixture({ focus: 'now' });
  try {
    await f.read();
    assert.equal(f.host.events.length, 1);
    f.host.state = { ...f.host.state, focus: 'now' };
    f.view.lastRead = Date.now() - 5000;
    const next = deferred(); f.host.liveTransport.answers = () => next.promise;
    const pending = f.view.refresh(); next.resolve(f.answer()); await pending;
    assert.equal(f.host.events.length, 1);
    assert.equal(f.host.state.focus, 'now');
    assert.equal(f.host.state.answers.length, 1);
  } finally { f.restore(); }
});

test('focus moves to the answer heading only when the prior focused target becomes hidden', async () => {
  const f = fixture();
  try {
    f.active.hidden = true;
    await f.read();
    assert.equal(f.host.headingFocused, true);
  } finally { f.restore(); }
});
