import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveAnswerView,answerReadContext } from '../../podvoice/gatekeeper/static/podview/live-answer-view.js';
import { liveScene } from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';

class Node extends EventTarget {
  constructor(tag) {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.attributes = new Map(); this.isConnected = true; this.open = false; this.hidden = false;
    this.textContent = ''; this.className = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  contains(node) { return node != null && (this === node || this.children.some(child => child === node || child?.contains?.(node) === true)); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name)??null; }
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
  host.state = { focus, connected:false,answers: [] };
  host.lastInteractionAt = 0;
  host.contains = node => node === active;
  host.focusHeading = () => { host.headingFocused = true; };
  host.dispatch = event => {
    host.events.push(event);
    if (event.type === 'show') host.state = { ...host.state, focus: event.id };
  };
  host.events = [];
  const answerContainer=new Node('section');answerContainer.hidden=true;host.querySelector=selector=>selector==='#answer-host'?answerContainer:null;
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
    host, view, request, answer, active, answerContainer,
    restore() { view.invalidate(); globalThis.document = priorDocument; },
    async read(result = answer()) { const pending = view.refresh(); request.resolve(result); await pending; },
  };
}

test('received answer remains historical after source expiry, without source authority',async()=>{const f=fixture();const now=Date.now;try{await f.read();const first=structuredClone(f.host.state.answers[0]);Date.now=()=>now()+121000;f.view.pruneExpired();assert.equal(f.host.state.answers.length,1);assert.equal(f.host.state.answers[0].historical,true);assert.equal(f.host.state.answers[0].content.summary,first.content.summary);assert.equal(f.host.state.answers[0].observedAt,first.observedAt);assert.equal(f.view.currentAnswer(receiptId),undefined);}finally{Date.now=now;f.restore();}});
test('ordinary new session and empty owner retains history but room replacement clears',async()=>{const f=fixture();try{await f.read();const before=f.host.liveSnapshot,next={...before,voice:{sessionId:'next',active:true},answers:{revision:0},capabilities:{answerRead:false}};f.view.onSnapshot(before,next);f.host.liveSnapshot=next;assert.equal(f.host.state.answers.length,1);assert.equal(f.host.state.answers[0].historical,true);f.view.onSnapshot(next,{...next,roomId:'other'});assert.equal(f.host.state.answers.length,0);}finally{f.restore();}});

test('latest20 received records survive omission and deduplicate; explicit read denial clears and late read cannot restore',async()=>{const f=fixture();try{await f.read();for(let i=1;i<=21;i++){const value=f.answer(),id=i.toString(16).padStart(32,'0');value.items[0].receiptId=id;value.items[0].content.sources[0].receiptId=id;f.host.liveTransport.answers=async()=>value;f.view.lastRead=0;await f.view.refresh();}assert.equal(f.host.state.answers.length,20);assert.equal(f.view.history.size,20);f.view.lastRead=0;await f.view.refresh();assert.equal(f.host.state.answers.length,20);const held=deferred();f.host.liveTransport.answers=()=>held.promise;f.view.lastRead=0;const pending=f.view.refresh();f.view.invalidate(true,true);held.resolve(f.answer());await pending;assert.equal(f.host.state.answers.length,0);assert.equal(f.view.history.size,0);}finally{f.restore();}});
test('read denial clears while a transient read error preserves admitted display',async()=>{for(const denied of [false,true]){const f=fixture();try{await f.read();f.host.liveTransport.answers=async()=>{throw Object.assign(Error('read'),denied?{code:'read_access_denied'}:{});};f.view.lastRead=0;await f.view.refresh();assert.equal(f.host.state.answers.length,denied?0:1);assert.equal(f.view.history.size,denied?0:1);}finally{f.restore();}}});
test('historical source and retry cannot issue reads after expiry',async()=>{const f=fixture(),now=Date.now;try{await f.read();Date.now=()=>now()+121000;f.view.pruneExpired();let reads=0;f.host.liveTransport.source=async()=>{reads++;};await f.view.showSource(receiptId,f.active);assert.equal(reads,0);assert.equal(f.view.dialog.open,false);}finally{Date.now=now;f.restore();}});

test('liveScene keeps admitted historical focus across ordinary empty session snapshots',async()=>{const f=fixture();try{await f.read();const old=f.host.liveSnapshot,next={...old,voice:{active:false,sessionId:'next'},answers:{revision:0},capabilities:{answerRead:false},timers:{status:'observed',items:[]}};f.view.onSnapshot(old,next);const state=liveScene({...f.host.state,devices:[],extraTimers:[],music:{playback:{}},timerHistory:[]},next);assert.equal(state.answers.length,1);assert.equal(state.answers[0].historical,true);assert.equal(state.focus,f.host.state.focus);}finally{f.restore();}});
test('history starts empty on new page instance and does not silently persist',async()=>{const f=fixture();try{await f.read();const other=fixture();try{assert.equal(other.host.state.answers.length,0);assert.equal(other.view.history.size,0);}finally{other.restore();}}finally{f.restore();}});
test('answer/source HTTP read denial has a distinct code, not transient or not-found errors',async()=>{const {PodVoiceTransport}=await import('../../podvoice/gatekeeper/static/podview/podvoice-transport.js');for(const kind of ['answers','source'])for(const status of [401,403,404,500]){const t=Object.create(PodVoiceTransport.prototype);Object.assign(t,{connected:true,snapshot:{capabilities:{answerRead:true}},base:'http://localhost/view/api/',room:'room',endpoint:()=>new URL('answers','http://localhost/view/api/'),request:async()=>({ok:false,status})});await assert.rejects(()=>t[kind](receiptId),error=>status===401||status===403?error.code==='read_access_denied':error.code===undefined);}});

test('same-room authenticated source denial clears archive after user closes pending dialog',async()=>{const f=fixture();try{await f.read();let reject;f.host.liveTransport.source=()=>new Promise((_,fail)=>{reject=fail;});const pending=f.view.showSource(receiptId,f.active);assert.equal(f.view.dialog.open,true);f.view.dialog.close();reject(Object.assign(Error('denied'),{code:'read_access_denied'}));await pending;assert.equal(f.view.history.size,0);assert.equal(f.host.state.answers.length,0);}finally{f.restore();}});
test('old source denial cannot clear a replacement room archive',async()=>{const f=fixture();try{await f.read();let reject;f.host.liveTransport.source=()=>new Promise((_,fail)=>{reject=fail;});const pending=f.view.showSource(receiptId,f.active);const old=f.host.liveSnapshot,next={...old,roomId:'other'};f.view.onSnapshot(old,next);f.host.liveSnapshot=next;f.view.history.set('new-room',{id:'new-room'});reject(Object.assign(Error('denied'),{code:'read_access_denied'}));await pending;assert.equal(f.view.history.has('new-room'),true);}finally{f.restore();}});
test('same-room answer read denial after ordinary owner change clears admitted archive',async()=>{const f=fixture();try{await f.read();let reject;f.host.liveTransport.answers=()=>new Promise((_,fail)=>{reject=fail;});f.view.lastRead=0;const pending=f.view.refresh();const old=f.host.liveSnapshot,next={...old,voice:{active:false,sessionId:null},answers:{revision:3}};f.view.onSnapshot(old,next);f.host.liveSnapshot=next;assert.equal(f.view.history.size,1);reject(Object.assign(Error('denied'),{code:'read_access_denied'}));await pending;assert.equal(f.view.history.size,0);}finally{f.restore();}});
test('old source denial cannot clear history after transport reauthentication generation',async()=>{const f=fixture();try{await f.read();f.host.liveTransport.generation=1;let reject;f.host.liveTransport.source=()=>new Promise((_,fail)=>{reject=fail;});const pending=f.view.showSource(receiptId,f.active);f.host.liveTransport.generation=2;reject(Object.assign(Error('denied'),{code:'read_access_denied'}));await pending;assert.equal(f.view.history.size,1);}finally{f.restore();}});
