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

test('completed exact-owner receipt opens from the photo even after voice becomes inactive', async () => {
  const f = fixture();
  try {
    await f.read();
    assert.equal(f.host.liveSnapshot.voice.active, false);
    assert.deepEqual(f.host.events, [{ type: 'show', id: `receipt:${receiptId}` }]);
    assert.equal(f.host.state.answers[0].receiptId, receiptId);
    assert.equal(f.host.state.answers[0].readConnected,true);
    assert.equal(f.host.state.connected,false);
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

test('failed owner refresh keeps the factual answer and exposes a retryable read state', async () => {
  const f = fixture({focus:'now'});
  try {
    await f.read();
    const original = f.host.state.answers[0];
    f.view.lastRead = 0;
    let rejectRead;
    f.host.liveTransport.answers = () => new Promise((resolve,reject) => { rejectRead=reject; });
    const pending=f.view.refresh(true);
    assert.equal(f.host.state.answers[0].readStatus,'pending');
    assert.deepEqual(f.host.state.answers[0].content,original.content);
    rejectRead(new Error('unavailable'));
    await pending;
    assert.equal(f.host.state.answers[0].readStatus,'error');
    assert.deepEqual(f.host.state.answers[0].content,original.content);
    assert.equal(f.host.state.answers[0].receiptId,original.receiptId);
  } finally {f.restore();}
});

test('owner retry re-reads current receipts without issuing a local demo request', async () => {
  const f=fixture();
  try {
    await f.read();
    let reads=0;
    f.host.liveTransport.answers=async()=>{reads++;return f.answer();};
    const retry=id=>{const event=new Event('owner-answer-retry');event.detail={receiptId:id};f.host.dispatchEvent(event);};
    retry('b'.repeat(32));
    assert.equal(reads,0);
    retry(receiptId);
    await Promise.resolve();await Promise.resolve();
    assert.equal(reads,1);
    assert.equal(f.host.state.answers[0].readStatus,undefined);
    assert.ok(f.host.events.every(event=>event.type==='show'));
    f.host.liveTransport.connected=false;
    retry(receiptId);
    assert.equal(reads,1);
  } finally {f.restore();}
});

test('connection loss retains the answer with explicit offline freshness', async()=>{
  const f=fixture();
  try{await f.read();const content=f.host.state.answers[0].content;f.view.invalidate();assert.equal(f.host.state.answers[0].readStatus,'offline');assert.equal(f.host.state.answers[0].readConnected,false);assert.deepEqual(f.host.state.answers[0].content,content);}finally{f.restore();}
});

test('source-shaped initial loading, empty and failed reads preserve the locked overview',async()=>{
 for(const outcome of ['empty','error']){
  const f=fixture({focus:'now'});
  try{
   let rejectRead;const pendingResult=new Promise((resolve,reject)=>{rejectRead=reject;});
   if(outcome==='error')f.host.liveTransport.answers=()=>pendingResult;
   const originalChildren=[...f.host.children];
   const pending=f.view.refresh();
   assert.equal(f.answerContainer.hidden,true,'initial polling must not unhide an answer surface');
   assert.equal(f.answerContainer.children.length,0,'no generic answer panel is injected');
   assert.deepEqual(f.host.children,originalChildren);
   assert.equal(f.host.state.focus,'now');
   if(outcome==='error')rejectRead(new Error('unavailable'));else f.request.resolve({...f.answer(),items:[]});
   await pending;
   assert.equal(f.answerContainer.hidden,true);
   assert.equal(f.answerContainer.children.length,0);
   assert.equal(f.host.state.answers.length,0);
   assert.equal(f.host.state.focus,'now');
  }finally{f.restore();}
 }
});

test('unbound or replaced owner contexts cannot inject an answer or new overview surface',async()=>{
 for(const change of [f=>{f.host.liveSnapshot.answers={revision:0,sessionId:null,turnId:null,taskId:null,inputRevision:null};},f=>{f.host.liveSnapshot.roomId='other-room';},f=>{f.host.liveSnapshot.answers={...f.host.liveSnapshot.answers,taskId:'new-task'};}]){
  const f=fixture({focus:'now'});
  try{const pending=f.view.refresh();change(f);f.request.resolve(f.answer());await pending;assert.equal(f.host.state.answers.length,0);assert.equal(f.answerContainer.hidden,true);assert.equal(f.answerContainer.children.length,0);}finally{f.restore();}
 }
});

test('retained source and retry controls reject a receipt from a replaced task or room',async()=>{
 for(const change of [f=>{f.host.liveSnapshot.answers={...f.host.liveSnapshot.answers,taskId:'new-task'};},f=>{f.host.liveSnapshot.roomId='other-room';},f=>{f.host.liveSnapshot.bootId='new-boot';}]){
  const f=fixture();
  try{
   await f.read();let reads=0,sources=0;
   f.host.liveTransport.answers=async()=>{reads++;return f.answer();};
   f.host.liveTransport.source=async()=>{sources++;};
   change(f);
   const retry=new Event('owner-answer-retry');retry.detail={receiptId};f.host.dispatchEvent(retry);
   await f.view.showSource(receiptId,f.active);
   assert.equal(reads,0);assert.equal(sources,0);assert.equal(f.view.dialog.open,false);
  }finally{f.restore();}
 }
});

test('current owner source stays readable and a late foreign-context failure cannot change its status',async()=>{
 const f=fixture();
 try{
  await f.read();
  f.host.liveTransport.source=async()=>({schema:'podview.source.v1',kind:'owner_receipt',receiptId,externalSourcesProvided:false,toolName:'weather',summary:'Observeret svar',observedAt:Date.now()/1000,provenance:{kind:'tool_result'},facts:[{id:'fact',label:'Temperatur',value:'12 °C',detail:'Aktuel måling'}]});
  await f.view.showSource(receiptId,f.active);
  assert.equal(f.view.dialog.open,true);assert.equal(f.view.body.children[0].textContent,'Observeret svar');
  let rejectSource;f.host.liveTransport.source=()=>new Promise((resolve,reject)=>{rejectSource=reject;});
  const pending=f.view.showSource(receiptId,f.active);const loading=f.view.note.textContent;
  f.host.liveSnapshot.roomId='other-room';rejectSource(new Error('unavailable'));await pending;
  assert.equal(f.view.note.textContent,loading);
 }finally{f.restore();}
});

test('normal completed read survives actual inactive-session-null shape without reopening or granting ownership',async()=>{const f=fixture();try{await f.read();const key=answerReadContext(f.host.liveSnapshot);f.host.liveSnapshot={...f.host.liveSnapshot,voice:{active:false,sessionId:null},answers:{...f.host.liveSnapshot.answers,readOnlyCompleted:true}};assert.equal(answerReadContext(f.host.liveSnapshot),key);assert.equal(f.view.currentAnswer(receiptId).receiptId,receiptId);f.view.lastRead=0;f.host.liveTransport.answers=async()=>f.answer();await f.view.refresh();assert.equal(f.host.events.length,1);assert.equal(f.host.state.answers[0].readConnected,true);assert.equal(f.host.state.connected,false);delete f.host.liveSnapshot.answers.readOnlyCompleted;assert.ok(!f.view.currentAnswer(receiptId));}finally{f.restore();}});


function acceptSnapshot(f,next){
 const previous=f.host.liveSnapshot;
 if(typeof f.view.onSnapshot==='function')f.view.onSnapshot(previous,next);
 else if(JSON.stringify(previous.answers)!==JSON.stringify(next.answers))f.view.invalidate(true);
 f.host.liveSnapshot=next;
}
const nextRevision=f=>({...f.host.liveSnapshot,answers:{...f.host.liveSnapshot.answers,revision:3}});
const sourceResponse=()=>({schema:'podview.source.v1',kind:'owner_receipt',receiptId,externalSourcesProvided:false,toolName:'weather',summary:'Observeret svar',observedAt:Date.now()/1000,provenance:{kind:'tool_result'},facts:[{id:'fact',label:'Temperatur',value:'12 °C',detail:'Aktuel måling'}]});

test('same-task receipt revision retains focused identity and scroll while fencing old source until fresh read',async()=>{
 const f=fixture();
 try{
  await f.read();const original=f.host.state.answers[0];
  f.answerContainer.scrollTop=73;f.host.state={...f.host.state,focus:original.id};
  const pendingResult=deferred();f.host.liveTransport.answers=()=>pendingResult.promise;
  acceptSnapshot(f,nextRevision(f));
  assert.equal(f.host.state.focus,original.id);assert.equal(f.host.state.answers.length,1);
  assert.equal(f.answerContainer.scrollTop,73);assert.equal(f.view.currentAnswer(receiptId),undefined);
  const scene=liveScene({...f.host.state,devices:[],extraTimers:[],music:{playback:{}}},{...f.host.liveSnapshot,timers:{status:'unavailable',items:[]}});
  assert.equal(scene.focus,original.id);assert.equal(scene.answers.length,1);assert.equal(scene.answers[0].readStatus,'pending');
  assert.notEqual(scene.answers[0].readContext,answerReadContext(f.host.liveSnapshot));
  const read=f.view.refresh();const fresh=f.answer();fresh.revision=3;
  pendingResult.resolve(fresh);await read;
  assert.equal(f.host.state.focus,original.id);assert.equal(f.answerContainer.scrollTop,73);
  assert.ok(f.view.currentAnswer(receiptId));assert.equal(f.host.events.length,1);
  assert.equal(f.host.state.answers.length,1);
 }finally{f.restore();}
});

test('same-task source disclosure keeps shell but removes stale body and revalidates actual source',async()=>{
 const f=fixture();
 try{
  await f.read();f.host.liveTransport.source=async()=>sourceResponse();
  await f.view.showSource(receiptId,f.active);f.view.body.scrollTop=41;
  const sourceRead=deferred();f.host.liveTransport.source=()=>sourceRead.promise;
  const answersRead=deferred();f.host.liveTransport.answers=()=>answersRead.promise;
  acceptSnapshot(f,nextRevision(f));
  assert.equal(f.view.dialog.open,true);assert.equal(f.view.body.children.length,0);
  const fresh=f.answer();fresh.revision=3;const pending=f.view.refresh();answersRead.resolve(fresh);await pending;
  assert.equal(f.view.dialog.open,true);assert.equal(f.view.body.children.length,0);
  sourceRead.resolve(sourceResponse());await Promise.resolve();await Promise.resolve();
  assert.ok(f.view.body.children.length);assert.equal(f.view.body.scrollTop,41);
 }finally{f.restore();}
});

test('owner changes revoke live reads; only boot and room replacement clear history',async()=>{
 for(const mutate of [s=>({...s,bootId:'boot-b'}),s=>({...s,roomId:'room-b'}),s=>({...s,answers:{...s.answers,taskId:'task-b'}}),s=>({...s,answers:{...s.answers,inputRevision:2}}),s=>({...s,answers:{...s.answers,sessionEpoch:9}}),s=>({...s,answers:{...s.answers,providerGeneration:9}}),s=>({...s,capabilities:{answerRead:false}})]){
  const f=fixture();try{
   await f.read();f.host.liveTransport.source=async()=>sourceResponse();await f.view.showSource(receiptId,f.active);
   const before=f.host.liveSnapshot,next=mutate(before);acceptSnapshot(f,next);
   const reset=before.bootId!==next.bootId||before.roomId!==next.roomId;assert.equal(f.host.state.answers.length,reset?0:1);if(!reset)assert.equal(f.host.state.answers[0].historical,true);assert.equal(f.view.dialog.open,false);
   assert.ok(!f.view.currentAnswer(receiptId));
  }finally{f.restore();}
 }
});

test('authoritative empty response removes live authority and preserves historical display',async()=>{
 const f=fixture();try{
  await f.read();f.host.liveTransport.source=async()=>sourceResponse();await f.view.showSource(receiptId,f.active);
  acceptSnapshot(f,nextRevision(f));const fresh=f.answer();fresh.revision=3;fresh.items=[];
  f.host.liveTransport.answers=async()=>fresh;await f.view.refresh();
  assert.equal(f.host.state.answers.length,1);assert.equal(f.host.state.answers[0].historical,true);assert.equal(f.view.dialog.open,false);
 }finally{f.restore();}
});

test('expired receipt loses source access and becomes historical at original deadline',async()=>{
 const f=fixture();const previousNow=Date.now,previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout;
 try{
  let now=Date.now();Date.now=()=>now;let expiry;
  globalThis.setTimeout=callback=>{expiry=callback;return {unref(){}};};globalThis.clearTimeout=()=>{};
  await f.read();f.host.liveTransport.source=async()=>sourceResponse();await f.view.showSource(receiptId,f.active);
  assert.equal(typeof expiry,'function');now+=120001;assert.equal(f.view.currentAnswer(receiptId),undefined);expiry();
  assert.equal(f.host.state.answers.length,1);assert.equal(f.host.state.answers[0].historical,true);assert.equal(f.view.dialog.open,false);
 }finally{Date.now=previousNow;globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;f.restore();}
});

test('superseded same-task reads and source completions cannot republish after revoke',async()=>{
 const f=fixture();try{
  await f.read();const sourceRead=deferred();f.host.liveTransport.source=()=>sourceRead.promise;
  const pendingSource=f.view.showSource(receiptId,f.active);
  acceptSnapshot(f,nextRevision(f));const answersRead=deferred();f.host.liveTransport.answers=()=>answersRead.promise;
  const pending=f.view.refresh();f.view.invalidate(true,true);
  const fresh=f.answer();fresh.revision=3;answersRead.resolve(fresh);sourceRead.resolve(sourceResponse());
  await pending;await pendingSource;assert.equal(f.host.state.answers.length,0);
  assert.equal(f.view.dialog.open,false);assert.equal(f.view.body.children.length,0);
 }finally{f.restore();}
});
