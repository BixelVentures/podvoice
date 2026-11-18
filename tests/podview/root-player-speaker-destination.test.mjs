import test from 'node:test';import assert from 'node:assert/strict';
import {SpeakerOutputView} from '../../podview/speaker-output-view.js';
// Status = speaker (owner 17/11, 2.1.17): radio on Frida's speaker, stopped; a start in Musik took Køkkenalrum.
// The player's speaker resolves into the music start's destination; the configured room is only the fallback.
const binding={accountId:'a',bindingId:'b'.repeat(64),nativeHomepodId:'42',nativeRoomId:'kitchen',roomId:'room',
 targetId:'engine'};
const row=(id,room,homepod,name,extra={})=>({speakerId:id.repeat(64),accountId:'a',kind:'configured_alias',
 nativeRoomId:room,homepodId:homepod,name,availability:'available',default:room==='kitchen',nativeSelected:false,
 outputSelected:false,selectable:true,startSelectable:true,startBlockedReason:null,moveBlockedReason:null,...extra});
const payload=(speakers)=>({ok:true,schema:'podview.speaker-catalogue.v1',bootId:'boot',roomId:'room',accountId:'a',
 status:'observed',catalogueId:'c'.repeat(64),retrievedAt:Date.now()/1000,source:'podconnect.get_targets',
 speakers,moveAvailable:true,physicalResultVerified:false});
const speakers=[row('d','kitchen','42','Køkkenalrum'),row('e','frida','44','Frida')];
class Node{constructor(){this.children=[];this.attributes={};this.dataset={};}append(...n){this.children.push(...n);}
 addEventListener(){}removeEventListener(){}replaceChildren(...x){this.children=x;}
 getAttribute(k){return this.attributes[k];}
 setAttribute(k,v){this.attributes[k]=v;}querySelector(){return new Node();}}
function setup(chosen){
 const nodes=new Map(),reads=[];
 const host={isConnected:true,ownerDocument:{createElement:()=>new Node(),getElementById:id=>{
   if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);}},
  liveSnapshot:{bootId:'boot',roomId:'room',mediaRoomBindings:[{...binding}],
   capabilities:{musicRead:['targets','playback'],controlSetup:[],musicSelection:true}},
  liveMedia:{account:'a',render(){}},
  liveTransport:{connected:true,generation:1,music:async(...args)=>{reads.push(args);return payload(speakers);}},
  playerView:{playerSpeaker:()=>chosen.value}};
 const view=new SpeakerOutputView(host);host.liveOutputs=view;return {view,reads,chosen};
}
test('a speaker chosen for radio is the destination of the next music start',async()=>{
 const {view,reads}=setup({value:{homepodId:'44',nativeRoomId:null,name:'Frida'}});
 try{
  assert.equal(view.selectionDestination(),null,'nothing chosen for music yet');
  assert.equal(view.playerDestinationMismatch(),true);
  await view.playerDestination();
  assert.deepEqual(view.selectionDestination(),{speakerId:'e'.repeat(64),name:'Frida'});
  assert.equal(view.playerDestinationMismatch(),false);
  assert.deepEqual(reads,[['speakers','a']],'one catalogue read');
 }finally{view.cleanup();}
});
test('last tap wins: a later radio choice replaces an older music choice',async()=>{
 const chosen={value:{homepodId:'42',nativeRoomId:'kitchen',name:'Køkkenalrum'}};
 const {view}=setup(chosen);
 try{
  await view.playerDestination();
  assert.equal(view.selectionDestination(),null,'the configured room needs no explicit destination');
  view.nextDestination=Object.freeze({speakerId:'d'.repeat(64),name:'Køkkenalrum',accountId:'a',nativeRoomId:'kitchen',
   nativeHomepodId:'42',key:view.context().key,transport:view.context().transport});
  chosen.value={homepodId:'44',nativeRoomId:null,name:'Frida'};
  assert.equal(view.playerDestinationMismatch(),true);
  await view.playerDestination();
  assert.equal(view.selectionDestination().name,'Frida');
 }finally{view.cleanup();}
});
test('a speaker that cannot start music leaves the destination unchanged',async()=>{
 const {view}=setup({value:{homepodId:'44',nativeRoomId:null,name:'Frida'}});
 speakers[1].startSelectable=false;
 try{await view.playerDestination();assert.equal(view.selectionDestination(),null);}
 finally{speakers[1].startSelectable=true;view.cleanup();}
});
test('no player speaker: nothing to resolve and no read',async()=>{
 const {view,reads}=setup({value:null});
 try{assert.equal(view.playerDestinationMismatch(),false);await view.playerDestination();assert.deepEqual(reads,[]);}
 finally{view.cleanup();}
});
// A speaker tapped while a start was on its way is one move, made once when the started music is observed.
test('a speaker tapped during a start moves the music once it plays, never twice',()=>{
 const {view}=setup({value:null}),calls=[];let playing=false;
 view.host.liveControls={musicContext:()=>playing?{key:'k'}:null,musicIntentPending:false,
  moveSpeaker:(row,current,choice)=>{calls.push([row.name,current(),choice.name]);return Promise.resolve(true);}};
 view.validUntil=Date.now()+30000;view.moveAvailable=true;
 try{
  view.queuedMove=Object.freeze({row:speakers[1],at:Date.now()});
  view.runQueuedMove();assert.deepEqual(calls,[],'nothing to move before the music is observed');
  playing=true;view.runQueuedMove();view.runQueuedMove();
  assert.deepEqual(calls,[['Frida',true,'Frida']],'one explicit tap is one move');
  view.queuedMove=Object.freeze({row:speakers[1],at:Date.now()-31000});view.runQueuedMove();
  assert.equal(calls.length,1,'an old tap is not replayed');
 }finally{view.cleanup();}
});
