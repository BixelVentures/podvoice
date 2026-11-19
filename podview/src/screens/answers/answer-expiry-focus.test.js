// Ported from tests/podview/root-answer-expiry-focus.test.mjs and its identical copy answer-expiry-focus.test.mjs
// (node:test, fake document and a view made with Object.create plus a fake dialog/body) to Vitest with a real DOM
// (happy-dom) when live-answer-view.js moved to LiveAnswerView.tsx. Same 8 tests and assertions; first run against the
// old live-answer-view.js in the same DOM. Adaptations: the view is built with `new LiveAnswerView(host)` (the fake
// host gains append — into document.body —, addEventListener and dataset), so its dialog is the real <dialog>:
// sourceOpen opens it with showModal(), `close` is its real Close button (so dialog.contains(close) holds as the fake's
// did), and the fake dialog's close() hook that moved focus from Close back to the answer is a 'close' listener added
// by the fixture; `body` is the real document.body; the fake document's activeElement and querySelector (plus hidden
// and visibilityState) are writable own properties on the real document, `doc` is the document, and both are restored
// and the body emptied after each test (the old fixture never restored globalThis.document).
import {afterEach,test} from 'vitest';
import assert from 'node:assert/strict';
import {LiveAnswerView} from './LiveAnswerView';
// The tests' fake document becomes own properties on the real one (restored afterwards, nesting-safe).
function fakeDocument(values){
 const faked={hidden:false,visibilityState:'visible',...values},prior=new Map();
 for(const [name,value] of Object.entries(faked)){
  prior.set(name,Object.getOwnPropertyDescriptor(document,name));
  Object.defineProperty(document,name,{configurable:true,enumerable:true,writable:true,value});
 }
 return ()=>{for(const [name,descriptor] of prior){if(descriptor)Object.defineProperty(document,name,descriptor);
  else delete document[name];}};
}
let restoreDocument=()=>{};
afterEach(()=>{restoreDocument();restoreDocument=()=>{};document.body.replaceChildren();});
function fixture({focus='answer',sourceOpen=false,otherDialog=false,renderMoves=false}={}){
 const body=document.body,answer={isConnected:true},player={isConnected:true},other={isConnected:true},heading={isConnected:true};
 const doc=document;let recovered=0;const root={contains:node=>node===answer};
 const host={isConnected:true,answerNodes:new Map([['expired',root]]),state:{focus:'expired',answers:[{id:'expired',receiptId:'receipt',live:true,observedAt:Date.now()/1000-121}]},render(){answer.isConnected=false;if(doc.activeElement===answer)doc.activeElement=body;if(renderMoves)doc.activeElement=player;},focusHeading(){recovered++;doc.activeElement=heading;},
  append(node){document.body.append(node);},addEventListener(){},dataset:{}};
 const view=new LiveAnswerView(host),dialog=view.dialog,close=dialog.querySelector('.dialog-close');
 if(sourceOpen)dialog.showModal();
 dialog.addEventListener('close',()=>{if(doc.activeElement===close)doc.activeElement=answer;});
 restoreDocument=fakeDocument({activeElement:{answer,player,close,other}[focus],querySelector:()=>otherDialog?other:null});
 Object.assign(view,{sourceId:'receipt'});
 return {view,doc,answer,player,close,other,heading,recovered:()=>recovered};
}

test('expiry recovers heading when it removes the focused answer control',()=>{const f=fixture();f.view.pruneExpired();assert.equal(f.view.host.state.focus,'now');assert.equal(f.view.host.state.answers.length,0);assert.equal(f.recovered(),1);assert.equal(f.doc.activeElement,f.heading);});
test('expiry closing its own source dialog recovers after the source opener is removed',()=>{const f=fixture({focus:'close',sourceOpen:true});f.view.pruneExpired();assert.equal(f.view.dialog.open,false);assert.equal(f.recovered(),1);assert.equal(f.doc.activeElement,f.heading);});
for(const focus of ['player','other'])test('expiry does not steal surviving '+focus+' focus',()=>{const f=fixture({focus});const prior=f.doc.activeElement;f.view.pruneExpired();assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,prior);});
test('a surviving source Close keeps focus when another answer expires',()=>{const f=fixture({focus:'close',sourceOpen:true});f.view.host.state.answers.push({id:'surviving',receiptId:'receipt',live:false});f.view.pruneExpired();assert.equal(f.view.dialog.open,true);assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,f.close);});
test('an unrelated open dialog prevents focus recovery into the background',()=>{const f=fixture({otherDialog:true});f.view.pruneExpired();assert.equal(f.recovered(),0);});
test('a deliberate new focus target established during rendering is preserved',()=>{const f=fixture({renderMoves:true});f.view.pruneExpired();assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,f.player);});
test('disconnected host does not render or recover focus',()=>{const f=fixture();f.view.host.isConnected=false;f.view.pruneExpired();assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,f.answer);});
