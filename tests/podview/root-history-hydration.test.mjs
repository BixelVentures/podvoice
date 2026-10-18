import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveAnswerView,answerReadContext } from '../../podvoice/gatekeeper/static/podview/live-answer-view.js';
import * as answerOwner from '../../podvoice/gatekeeper/static/podview/owner-answers.js';
const historicalAnswers=(...args)=>answerOwner.historicalAnswers(...args);
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {visualExamples} from '../../podvoice/gatekeeper/static/podview/visual-examples.js';

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

function archived(id=receiptId){return {receiptId:id,family:'fact-card',title:'Tidligere måling',observedAt:1700000000,provenance:{kind:'tool_result'},content:{summary:'Bevaret måling',facts:[{id:'fact',label:'Temperatur',value:'12 °C',detail:'Måling',sourceId:'source'}],sources:[{id:'source',kind:'owner_receipt',receiptId:id,label:'Værktøj',scope:'tool_result'}]}};}
function historyFixture({empty=true}={}){const f=fixture({focus:'now'});Object.assign(f.host.liveSnapshot,{answerHistoryRevision:1,answerHistoryRemovalRevision:0,answerHistoryReceiptIds:[receiptId]});if(empty){f.host.liveSnapshot.answers={revision:0,sessionId:null,turnId:null,taskId:null,inputRevision:null};f.host.liveSnapshot.voice={active:false,sessionId:null};}f.calls=[];f.responses=[];f.host.liveTransport.generation=1;f.host.liveTransport.answers=async history=>{f.calls.push(history===true?'history':'live');if(history){const response=f.responses.shift();if(response instanceof Error)throw response;return response;}return empty?{schema:'podview.answers.v1',roomId:f.host.liveSnapshot.roomId,revision:f.host.liveSnapshot.answers.revision,items:[]}:f.request.promise;};f.envelope=(items=[archived()])=>({schema:'podview.answer-history.v1',bootId:'boot-a',roomId:'room',revision:f.host.liveSnapshot.answerHistoryRevision,removalRevision:f.host.liveSnapshot.answerHistoryRemovalRevision,receiptIds:items.map(a=>a.receiptId),items});f.next=(revision,removal=0,ids=removal?[]:f.host.liveSnapshot.answerHistoryReceiptIds)=>{const previous=f.host.liveSnapshot,next={...previous,answerHistoryRevision:revision,answerHistoryRemovalRevision:removal,answerHistoryReceiptIds:ids};f.view.onSnapshot(previous,next);f.host.liveSnapshot=next;};return f;}

test('reload hydrates original expired content with empty current owner and no source authority',async()=>{const f=historyFixture();try{f.responses.push(f.envelope());await f.view.refresh();assert.deepEqual(f.calls,['history']);const a=f.host.state.answers[0];assert.equal(a.historical,true);assert.equal(a.observedAt,1700000000);assert.equal(a.content.summary,'Bevaret måling');assert.equal(a.readContext,null);assert.deepEqual(a.allowedActions,[]);assert.equal(f.view.currentAnswer(receiptId),null);await f.view.showSource(receiptId,{});assert.deepEqual(f.calls,['history']);await f.view.refresh();assert.equal(f.calls.length,1);}finally{f.restore();}});

test('history envelope rejects wrong scopes, revisions, unsupported provenance, content extras and source escape',()=>{const f=historyFixture();try{for(const mutate of [v=>v.bootId='other',v=>v.roomId='other',v=>v.revision=0,v=>v.removalRevision=2,v=>v.extra=true,v=>v.items.push(v.items[0]),v=>v.items[0].allowedActions=['play'],v=>v.items[0].observedAt=Date.now()/1000+6,v=>v.items[0].provenance.kind='verified',v=>v.items[0].provenance.receiptIds=[receiptId],v=>v.items[0].content.extra='html',v=>v.items[0].content.facts[0].extra='action',v=>v.items[0].content.sources[0].receiptId='b'.repeat(32)]){const v=f.envelope();mutate(v);assert.throws(()=>historicalAnswers(v,f.host.liveSnapshot));}const many=f.envelope(Array.from({length:21},(_,i)=>archived(i.toString(16).padStart(32,'0'))));assert.throws(()=>historicalAnswers(many,f.host.liveSnapshot));assert.throws(()=>historicalAnswers(f.envelope(),{...f.host.liveSnapshot,capabilities:{answerRead:false}}));}finally{f.restore();}});

test('admission-only revision retains existing content during held hydration; removal clears immediately and old response cannot resurrect',async()=>{const f=historyFixture();try{f.responses.push(f.envelope());await f.view.refresh();const previous=f.host.state.answers[0];f.next(2);const old=deferred(),oldBody=f.envelope([archived(),archived('b'.repeat(32))]);f.responses.push(old.promise);const pending=f.view.refresh();assert.equal(f.host.state.answers[0].content.summary,previous.content.summary);f.next(3,1);assert.equal(f.host.state.answers.length,0);f.responses.push(f.envelope([]));await f.view.refresh();old.resolve(oldBody);await pending;assert.equal(f.host.state.answers.length,0);assert.equal(f.view.history.size,0);}finally{f.restore();}});

test('held live response after history removal cannot re-add revoked record',async()=>{const f=historyFixture({empty:false});try{f.host.liveSnapshot.answerHistoryReceiptIds=[];f.responses.push(f.envelope([]));const pending=f.view.refresh();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.calls,['history','live']);f.next(2,1);f.request.resolve(f.answer());await pending;assert.equal(f.host.state.answers.length,0);assert.equal(f.view.history.size,0);}finally{f.restore();}});

test('authoritative history replaces local56 cache; valid later live record survives late history response',async()=>{const f=historyFixture({empty:false});try{f.view.history.set('receipt:'+receiptId,{id:'receipt:'+receiptId,live:true,historical:true});f.host.state.answers=[...f.view.history.values()];const held=deferred();f.responses.push(held.promise);f.host.liveSnapshot.answerHistoryReceiptIds=[];const history=f.view.refreshHistory();const later={id:'receipt:'+('b'.repeat(32)),receiptId:'b'.repeat(32),live:true,historical:false,status:'ready',observedAt:Date.now()/1000};f.host.state.answers.push(later);held.resolve(f.envelope([]));await history;assert.equal(f.view.history.size,0);assert.deepEqual(f.host.state.answers,[later]);f.view.remember([later]);assert.equal(f.view.history.size,0);}finally{f.restore();}});

test('transient history error retains display; actual403 clears; stale transport denial cannot clear replacement scope',async()=>{const f=historyFixture();try{f.responses.push(f.envelope());await f.view.refresh();f.next(2);f.responses.push(Error('offline'));await f.view.refresh();assert.equal(f.host.state.answers.length,1);const denied=Object.assign(Error('denied'),{code:'read_access_denied'});f.responses.push(denied);await f.view.refresh();assert.equal(f.host.state.answers.length,0);f.responses.push(f.envelope());await f.view.refresh();const held=deferred();f.next(3);f.responses.push(held.promise);const pending=f.view.refresh();f.host.liveTransport={...f.host.liveTransport,generation:2};held.resolve(Promise.reject(denied));await pending;assert.equal(f.host.state.answers.length,1);}finally{f.restore();}});

test('actual transport selects existing historical read route and keeps denial distinct',async()=>{const urls=[],t=new PodVoiceTransport({url:'https://example.test/view/',room:'room',fetch:async url=>{urls.push(new URL(url));return {ok:false,status:403,json:async()=>({})};}});t.connected=true;t.closed=false;t.snapshot={capabilities:{answerRead:true}};await assert.rejects(t.answers(true),e=>e.code==='read_access_denied');assert.equal(urls[0].searchParams.get('history'),'1');assert.equal(urls[0].searchParams.get('room'),'room');await assert.rejects(t.answers(),e=>e.code==='read_access_denied');assert.equal(urls[1].searchParams.has('history'),false);});

test('normal empty-owner snapshots do not starve a held independent history read',async()=>{const f=historyFixture();try{const held=deferred(),body=f.envelope();f.responses.push(held.promise);const pending=f.view.refresh();const old=f.host.liveSnapshot,next=structuredClone(old);f.view.onSnapshot(old,next);f.host.liveSnapshot=next;held.resolve(body);await pending;assert.equal(f.host.state.answers.length,1);assert.equal(f.host.state.answers[0].historical,true);}finally{f.restore();}});

test('all ten archived families admit original bounded content without live receipt context',()=>{const f=historyFixture();try{const shapes={concise:{},choices:{items:[{id:'one',label:'Valg',detail:'Detalje',sourceId:'source'}]},comparison:{columns:[{id:'time',label:'Tid'}],items:[{id:'one',label:'Valg',values:['5 min.'],sourceId:'source'}]},chart:{unit:'minutter',unitSingular:'minut',items:[{id:'one',label:'Pause',value:5,sourceId:'source'}]},steps:{steps:[{id:'one',text:'Første trin',sourceId:'source'}]},checklist:{items:[{id:'one',label:'Papir',checked:false,sourceId:'source'}]}};for(const kind of [...Object.keys(shapes),'fact-card','sourced-image','answer-timeline','simple-diagram']){const row=archived();row.family=kind;row.provenance={kind:'owner_sources'};row.content=shapes[kind]?{summary:'Afsluttet svar',...shapes[kind],sources:row.content.sources}:structuredClone(visualExamples[kind].content);const result=historicalAnswers(f.envelope([row]),f.host.liveSnapshot).items[0];assert.deepEqual(result.content,row.content);assert.equal(result.kind,kind);assert.equal(result.historical,true);assert.equal(result.observedAt,row.observedAt);assert.equal(result.sessionId,undefined);assert.equal(result.validUntil,undefined);}}finally{f.restore();}});

test('snapshot history counters are paired, bounded and cannot roll backwards within boot',()=>{const t=new PodVoiceTransport({url:'https://example.test/view/'});t.closed=false;const snapshot={schema:'podview.snapshot.v1',bootId:'boot',roomId:'room',revision:1,voice:{active:false,sessionId:null},timers:{status:'unavailable',items:[]},capabilities:{musicRead:[],timerActions:[],answerRead:true},answers:{revision:0,sessionId:null,turnId:null,taskId:null,inputRevision:null},answerHistoryRevision:2,answerHistoryRemovalRevision:1,answerHistoryReceiptIds:[receiptId]};try{for(const change of [s=>delete s.answerHistoryRemovalRevision,s=>s.answerHistoryRevision=-1,s=>s.answerHistoryRemovalRevision=3,s=>s.answerHistoryRemovalRevision=0.5]){const bad=structuredClone(snapshot);change(bad);assert.equal(t.accept(bad),false);}assert.equal(t.accept(snapshot),true);assert.equal(t.accept({...snapshot,revision:2,answerHistoryRevision:1}),false);assert.equal(t.accept({...snapshot,revision:2,answerHistoryRemovalRevision:0}),false);}finally{clearTimeout(t.freshnessTimer);}});

test('new client without history fields preserves legacy page retention and never requests history',async()=>{const f=fixture({focus:'now'});try{const calls=[],reply=f.answer();f.host.liveTransport.answers=async history=>{calls.push(history);return reply;};await f.view.refresh();assert.deepEqual(calls,[undefined]);assert.equal(f.view.history.size,1);}finally{f.restore();}});

test('same history revision in new room clears old scope and held old-room response is inert',async()=>{const f=historyFixture();try{f.responses.push(f.envelope());await f.view.refresh();f.next(2);const held=deferred(),oldBody=f.envelope();f.responses.push(held.promise);const pending=f.view.refresh();const before=f.host.liveSnapshot,next={...before,roomId:'new-room'};f.view.onSnapshot(before,next);f.host.liveSnapshot=next;assert.equal(f.host.state.answers.length,0);held.resolve(oldBody);await pending;assert.equal(f.host.state.answers.length,0);}finally{f.restore();}});

test('21st admission evicts only oldest ID while19 unaffected displays survive held hydration',async()=>{const f=historyFixture();try{const initial=Array.from({length:20},(_,i)=>archived(i.toString(16).padStart(32,'0')));f.host.liveSnapshot.answerHistoryReceiptIds=initial.map(a=>a.receiptId);f.responses.push(f.envelope(initial));await f.view.refresh();const surviving=f.host.state.answers.slice(0,19),newId='f'.repeat(32),nextIds=[newId,...initial.slice(0,19).map(a=>a.receiptId)];f.next(2,1,nextIds);assert.equal(f.host.state.answers.length,19);for(const a of surviving)assert.ok(f.host.state.answers.includes(a));const held=deferred();f.responses.push(held.promise);const pending=f.view.refresh();assert.equal(f.host.state.answers.length,19);held.resolve(f.envelope([archived(newId),...initial.slice(0,19)]));await pending;assert.equal(f.host.state.answers.length,20);assert.equal(f.host.state.answers.some(a=>a.receiptId===initial[19].receiptId),false);}finally{f.restore();}});

test('exact removal preserves unaffected live answer and prevents current read from readding absent receipt',async()=>{const f=historyFixture({empty:false});try{const second='b'.repeat(32);f.host.liveSnapshot.answerHistoryReceiptIds=[receiptId,second];f.responses.push(f.envelope([archived(),archived(second)]));const first=f.view.refresh();f.request.resolve(f.answer());await first;const live=f.host.state.answers.find(a=>a.receiptId===receiptId);assert.equal(live.historical,undefined);f.next(2,1,[receiptId]);assert.deepEqual(f.host.state.answers,[live]);f.next(3,2,[]);f.responses.push(f.envelope([]));await f.view.refresh();assert.equal(f.host.state.answers.length,0);}finally{f.restore();}});

test('history membership rejects mismatched envelope order and duplicate snapshot IDs',()=>{const f=historyFixture();try{const value=f.envelope();value.receiptIds=['b'.repeat(32)];assert.throws(()=>historicalAnswers(value,f.host.liveSnapshot));const extra=f.envelope();extra.receiptIds.push(receiptId);assert.throws(()=>historicalAnswers(extra,f.host.liveSnapshot));}finally{f.restore();}});

test('simultaneous exact removal and new owner resets live revision and source authority without deleting retained history',async()=>{const f=historyFixture({empty:false});try{f.responses.push(f.envelope());const first=f.view.refresh();f.request.resolve(f.answer());await first;assert.equal(f.view.revision,2);f.view.dialog.showModal();f.view.sourceId=receiptId;const prior=f.host.liveSnapshot,id='c'.repeat(32),next={...prior,answerHistoryRevision:3,answerHistoryRemovalRevision:1,answerHistoryReceiptIds:[id,receiptId],voice:{sessionId:'new-session',active:true},answers:{...prior.answers,sessionId:'new-session',turnId:'new-turn',taskId:'new-task',revision:1}};f.view.onSnapshot(prior,next);f.host.liveSnapshot=next;assert.equal(f.view.revision,0);assert.equal(f.view.dialog.open,false);assert.equal(f.host.state.answers.length,1);assert.equal(f.host.state.answers[0].historical,true);const live=f.answer();live.revision=1;Object.assign(live.items[0],{receiptId:id,sessionId:'new-session',turnId:'new-turn',taskId:'new-task'});live.items[0].content.sources[0].receiptId=id;f.host.liveTransport.answers=async history=>history?f.envelope([archived(id),archived()]):live;await f.view.refresh();assert.equal(f.view.revision,1);assert.equal(f.host.state.answers.find(a=>a.receiptId===id).historical,undefined);assert.equal(f.host.state.answers.find(a=>a.receiptId===receiptId).historical,true);}finally{f.restore();}});

test('same boot owner absence preserves archive and restored metadata replaces it authoritatively',async()=>{const f=historyFixture();try{f.responses.push(f.envelope());await f.view.refresh();const original=f.host.state.answers[0],before=f.host.liveSnapshot,missing={...before,capabilities:{answerRead:false}};delete missing.answerHistoryRevision;delete missing.answerHistoryRemovalRevision;delete missing.answerHistoryReceiptIds;f.view.onSnapshot(before,missing);f.host.liveSnapshot=missing;await f.view.refresh();assert.equal(f.host.state.answers.length,1);assert.equal(f.host.state.answers[0].observedAt,original.observedAt);assert.deepEqual(f.host.state.answers[0].content,original.content);assert.equal(f.view.history.size,1);assert.deepEqual(f.calls,['history']);const restored={...before,answerHistoryRevision:2,answerHistoryRemovalRevision:1,answerHistoryReceiptIds:[]};f.view.onSnapshot(missing,restored);f.host.liveSnapshot=restored;f.responses.push(f.envelope([]));await f.view.refresh();assert.equal(f.host.state.answers.length,0);assert.equal(f.view.history.size,0);f.view.pruneExpired();assert.equal(f.host.state.answers.length,0);}finally{f.restore();}});
