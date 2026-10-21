import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveAnswerView} from '../../podvoice/gatekeeper/static/podview/live-answer-view.js';
function fixture({focus='answer',sourceOpen=false,otherDialog=false,renderMoves=false}={}){
 const body={isConnected:true},answer={isConnected:true},player={isConnected:true},close={isConnected:true},other={isConnected:true},heading={isConnected:true};
 const doc={body,activeElement:{answer,player,close,other}[focus],querySelector:()=>otherDialog?other:null};globalThis.document=doc;
 let recovered=0;const root={contains:node=>node===answer};
 const host={isConnected:true,answerNodes:new Map([['expired',root]]),state:{focus:'expired',answers:[{id:'expired',receiptId:'receipt',live:true,observedAt:Date.now()/1000-121}]},render(){answer.isConnected=false;if(doc.activeElement===answer)doc.activeElement=body;if(renderMoves)doc.activeElement=player;},focusHeading(){recovered++;doc.activeElement=heading;}};
 const dialog={open:sourceOpen,contains:node=>node===close,close(){this.open=false;if(doc.activeElement===close)doc.activeElement=answer;}};
 const view=Object.create(LiveAnswerView.prototype);Object.assign(view,{host,dialog,sourceId:'receipt',body:{replaceChildren(){}}});
 return {view,doc,answer,player,close,other,heading,recovered:()=>recovered};
}
test('expiry recovers heading when it removes the focused answer control',()=>{const f=fixture();f.view.pruneExpired();assert.equal(f.view.host.state.focus,'now');assert.equal(f.view.host.state.answers.length,0);assert.equal(f.recovered(),1);assert.equal(f.doc.activeElement,f.heading);});
test('expiry closing its own source dialog recovers after the source opener is removed',()=>{const f=fixture({focus:'close',sourceOpen:true});f.view.pruneExpired();assert.equal(f.view.dialog.open,false);assert.equal(f.recovered(),1);assert.equal(f.doc.activeElement,f.heading);});
for(const focus of ['player','other'])test('expiry does not steal surviving '+focus+' focus',()=>{const f=fixture({focus});const prior=f.doc.activeElement;f.view.pruneExpired();assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,prior);});
test('a surviving source Close keeps focus when another answer expires',()=>{const f=fixture({focus:'close',sourceOpen:true});f.view.host.state.answers.push({id:'surviving',receiptId:'receipt',live:false});f.view.pruneExpired();assert.equal(f.view.dialog.open,true);assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,f.close);});
test('an unrelated open dialog prevents focus recovery into the background',()=>{const f=fixture({otherDialog:true});f.view.pruneExpired();assert.equal(f.recovered(),0);});
test('a deliberate new focus target established during rendering is preserved',()=>{const f=fixture({renderMoves:true});f.view.pruneExpired();assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,f.player);});
test('disconnected host does not render or recover focus',()=>{const f=fixture();f.view.host.isConnected=false;f.view.pruneExpired();assert.equal(f.recovered(),0);assert.equal(f.doc.activeElement,f.answer);});
