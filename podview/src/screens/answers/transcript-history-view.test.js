// Ported from tests/podview/answer-history-integration-transcript-history-view.test.mjs and its near-duplicate
// canonical-next-transcript-history-view.test.mjs (node:test, a view made with Object.create plus fake dialog/body) to
// Vitest (happy-dom) when live-answer-view.js moved to LiveAnswerView.tsx. Superset: the answer-history-integration
// copy has all 11 of canonical-next's tests (identical) plus 'identityless complete rows never inherit hidden state or
// focus after a new read prepends another row', so this is that copy (12 tests). The LiveAnswerView tests were first
// run against the old live-answer-view.js. Adaptations: the view is built with `new LiveAnswerView(host)` (the fake
// host gains no-op append and addEventListener and a dataset; the fake dialog and body are not assigned). Source files
// are read by path (happy-dom's URL is not accepted by readFileSync). 'existing concise renderer displays whole
// transcript…' no longer extracts and evals renderTranscript from answer-widget.js: it drives the real card (pv-answer
// from ./AnswerWidget, in the document) with update({connected:true}, transcript answer) for live false and true, after
// presetting its data-answer-domain/data-kit-identity as the old test preset the fake widget's dataset, and makes the
// same assertions on the card's dataset and its .intro (data.text, hidden), .sources/.answer-actions/.retry-answer/
// .comparison (hidden) and .answer-meta (text). 'only explicit history opening…' keeps the widget-view.js checks; the
// transcript-before-typed check now reads model.ts (paintAnswer: `if (answer.transcriptSegment) paintTranscript(`
// before `else if (answer.live) paintTyped(`) instead of answer-widget.js, and also asserts the first one is present.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import './AnswerWidget';
import {LiveAnswerView} from './LiveAnswerView';
const podview=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=name=>readFileSync(resolve(podview,name),'utf8');
const row=(id='a',text='Hele den registrerede tale')=>({segmentId:id.repeat(32),sessionId:'session',generation:1,ts:1700000000,endTs:1700000001,text,fragmentCount:2});
function rig(){const requests=[],host={isConnected:true,state:{answers:[],focus:'now'},liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{answerRead:true}},liveTransport:{connected:true,generation:1,answers(mode){return new Promise((resolve,reject)=>requests.push({mode,resolve,reject}));}},render(){},focusHeading(){},append(){},addEventListener(){},dataset:{}};const view=new LiveAnswerView(host);Object.assign(view,{host,history:new Map(),presented:new Set(),generation:0});const envelope=items=>({schema:'podview.transcript-history.v1',roomId:'room',bootId:'boot',items});return {host,view,requests,envelope};}
test('explicit transcript read singleflights, preserves server order/full text and stays separate from rich receipts',async()=>{const f=rig(),rich={id:'receipt:a',live:true,historical:true,status:'ready',title:'Visuelt svar'};f.view.history.set(rich.id,rich);const long='  '+('Registreret tekst. '.repeat(200))+'  ',read=f.view.refreshTranscripts();void f.view.refreshTranscripts();assert.equal(f.requests.length,1);assert.equal(f.requests[0].mode,'segments');assert.equal(f.view.transcriptPending,true);f.requests[0].resolve(f.envelope([row('b',long),row('a')]));await read;assert.deepEqual(f.host.state.answers.map(a=>a.id),['receipt:a','transcript:'+'b'.repeat(32),'transcript:'+'a'.repeat(32)]);const segment=f.host.state.answers[1];assert.equal(segment.content.summary,long);assert.equal(segment.transcriptSegment.text,long);assert.equal(segment.title,'Samtaleudskrift');assert.equal(segment.receiptId,undefined);assert.equal(segment.provenance,undefined);assert.equal(segment.presentation,undefined);assert.equal(segment.taskId,undefined);assert.deepEqual(segment.allowedActions,[]);assert.equal(f.view.currentAnswer(segment.id),null);});
test('transient failure preserves text; successful replacement removes absent segments and safely exits removed focus',async()=>{const f=rig();let read=f.view.refreshTranscripts();f.requests.at(-1).resolve(f.envelope([row()]));await read;const original=f.host.state.answers[0];f.host.state.focus=original.id;read=f.view.refreshTranscripts();f.requests.at(-1).reject(Error('offline'));await read;assert.deepEqual(f.host.state.answers,[original]);assert.equal(f.view.transcriptStatus,'error');assert.equal(f.view.historyPresentation().data.state,'empty');read=f.view.refreshTranscripts();f.requests.at(-1).resolve(f.envelope([]));await read;assert.deepEqual(f.host.state.answers,[]);assert.equal(f.host.state.focus,'now');assert.equal(f.view.transcriptStatus,'ready');assert.equal(f.view.historyPresentation().data.state,'empty');assert.equal(f.view.historyPresentation().hidden,false);});
test('late responses cannot cross room, boot, transport generation or transport object',async()=>{for(const change of [f=>f.host.liveSnapshot.roomId='other',f=>f.host.liveSnapshot.bootId='other',f=>f.host.liveTransport.generation++,f=>f.host.liveTransport={...f.host.liveTransport}]){const f=rig(),read=f.view.refreshTranscripts();change(f);f.requests[0].resolve(f.envelope([row()]));await read;assert.equal(f.host.state.answers.length,0);}});
test('ownership replacement and authoritative denial clear transcripts while transient disconnect retains known text',async()=>{for(const kind of ['room','transport','auth','denial','offline']){const f=rig();let read=f.view.refreshTranscripts();f.requests[0].resolve(f.envelope([row()]));await read;if(kind==='denial'){read=f.view.refreshTranscripts();f.requests.at(-1).reject(Object.assign(Error('denied'),{code:'read_access_denied'}));await read;}else{if(kind==='room')f.host.liveSnapshot.roomId='other';if(kind==='transport')f.host.liveTransport={...f.host.liveTransport};if(kind==='auth')f.host.liveSnapshot.capabilities.answerRead=false;if(kind==='offline')f.host.liveTransport.connected=false;f.host.state.answers=f.view.retained(f.host.state.answers);}assert.equal(f.host.state.answers.length,kind==='offline'?1:0);}});
test('malformed response is read failure, not empty success or promoted answer',async()=>{const f=rig(),read=f.view.refreshTranscripts();f.requests[0].resolve(f.envelope([{...row(),receiptId:'forged'}]));await read;assert.equal(f.view.transcriptStatus,'error');assert.equal(f.host.state.answers.length,0);});
test('existing concise renderer displays whole transcript and removes sources/actions without claiming completion',()=>{
 const widget=document.createElement('pv-answer');document.body.append(widget);const q=selector=>widget.querySelector(selector);
 const text='Long tale '.repeat(400);
 try{
  for(const live of [false,true]){
   widget.dataset.answerDomain=live?'answer':'weather';widget.dataset.kitIdentity=live?'neutral':'weather';
   widget.update({connected:true},{id:'transcript:x',kind:'concise',title:'Du',live,historical:true,status:'ready',
    observedAt:1700000000,transcriptSegment:row('a',text),content:{summary:text}});
   assert.equal(widget.dataset.answerDomain,'answer');assert.equal(widget.dataset.kitIdentity,'neutral');
  }
  assert.equal(q('.intro').data.text,text);assert.equal(q('.intro').hidden,false);
  for(const selector of ['.sources','.answer-actions','.retry-answer','.comparison'])assert.equal(q(selector).hidden,true);
  assert.match(q('.answer-meta').textContent,/Registreret tale.*Kan være ufuldstændig/);
  assert.doesNotMatch(q('.answer-meta').textContent,/afsluttet|færdig/i);
 }finally{widget.remove();}
});
test('snapshot polling and current receipt-owner changes do not reread or erase admitted transcripts',async()=>{const f=rig();const read=f.view.refreshTranscripts();f.requests[0].resolve(f.envelope([row()]));await read;const original=f.host.state.answers[0];f.view.onSnapshot(f.host.liveSnapshot,f.host.liveSnapshot);f.view.invalidate(true,false);assert.deepEqual(f.host.state.answers,[original]);assert.equal(f.requests.length,1);});
test('visual receipt removal leaves independently admitted transcript text intact',async()=>{const f=rig();const read=f.view.refreshTranscripts();f.requests[0].resolve(f.envelope([row()]));await read;const before={...f.host.liveSnapshot,answerHistoryRemovalRevision:0},next={...f.host.liveSnapshot,answerHistoryRemovalRevision:1,answerHistoryReceiptIds:[]};f.host.liveSnapshot=next;f.view.onSnapshot(before,next);assert.equal(f.host.state.answers[0].transcriptSegment.text,row().text);assert.equal(f.requests.length,1);});
test('only explicit history opening invokes segment read; the canonical transcript branch precedes typed receipt admission',()=>{const host=read('widget-view.js'),answer=read('src/screens/answers/model.ts');assert.equal(host.split('refreshTranscripts()').length-1,1);const open=host.slice(host.indexOf(' open(id,opener)'),host.indexOf('\n ',host.indexOf(' open(id,opener)')+1));assert.match(open,/if\(id==='history'\).*if\(this.live\)void this.liveAnswers\?\.refreshTranscripts\(\)/);assert.notEqual(answer.indexOf('if (answer.transcriptSegment) paintTranscript('),-1);
 assert(answer.indexOf('if (answer.transcriptSegment) paintTranscript(')<answer.indexOf('else if (answer.live) paintTyped('));});

test('old-generation denied read cannot clear newly admitted history, focus or status after reconnect',async()=>{const f=rig(),read=f.view.refreshTranscripts();f.host.liveTransport.generation=2;const rich={id:'new-rich',live:true,historical:true,title:'Ny historik'},segment={id:'transcript:'+row().segmentId,live:true,historical:true,transcriptSegment:row(),content:{summary:row().text}};f.view.history.set(rich.id,rich);f.view.transcripts=new Map([[segment.id,segment]]);f.view.transcriptStatus='ready';f.host.state={answers:[rich,segment],focus:segment.id};let renders=0;f.host.render=()=>renders++;const previous=f.host.state;f.requests[0].reject(Object.assign(Error('late denied'),{code:'read_access_denied'}));await read;assert.equal(f.host.state,previous);assert.equal(f.view.history.get(rich.id),rich);assert.equal(f.view.transcripts.get(segment.id),segment);assert.equal(f.view.transcriptStatus,'ready');assert.equal(renders,0);assert.equal(f.view.transcriptPending,false);});
test('current-generation denied transcript read still revokes retained history and focus',async()=>{const f=rig();let read=f.view.refreshTranscripts();f.requests[0].resolve(f.envelope([row()]));await read;f.host.state.focus=f.host.state.answers[0].id;f.view.history.set('rich',{id:'rich',live:true,historical:true});read=f.view.refreshTranscripts();f.requests.at(-1).reject(Object.assign(Error('denied'),{code:'read_access_denied'}));await read;assert.equal(f.host.state.answers.length,0);assert.equal(f.host.state.focus,'now');assert.equal(f.view.history.size,0);assert.equal(f.view.transcripts.size,0);assert.equal(f.view.transcriptStatus,'error');});
test('identityless complete rows never inherit hidden state or focus after a new read prepends another row',async()=>{
 const f=rig(),complete=text=>({sessionId:'session',role:'user',finality:'complete',ts:1,endTs:1,text});
 let read=f.view.refreshTranscripts();f.requests.at(-1).resolve(f.envelope([complete('First')]));await read;
 const first=f.host.state.answers[0];first.hidden=true;f.host.state.focus=first.id;
 read=f.view.refreshTranscripts();f.requests.at(-1).resolve(f.envelope([complete('New'),complete('First')]));await read;
 assert.notEqual(f.host.state.answers[0].id,first.id);assert.equal(f.host.state.answers[0].hidden,false);
 assert.equal(f.host.state.answers[1].hidden,false);assert.equal(f.host.state.focus,'now');
});
