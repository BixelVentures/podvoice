import test from 'node:test';
import assert from 'node:assert/strict';
import {voicePresentation} from '../../podvoice/gatekeeper/static/podview/voice-surface.js';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {PodVoiceTransport as OldTransport} from './fixtures/podvoice31/podvoice-transport.js';
const pending={roomId:'kitchen',sessionId:'session',turnId:'turn',taskId:'task',inputRevision:2,revision:7};
const voice={active:true,phase:'AI_SPEAKING',sessionId:'session',turnId:'voice-turn'};
const snapshot=()=>({schema:'podview.snapshot.v1',bootId:'boot',roomId:'kitchen',revision:7,voice:{...voice},answers:{revision:7,sessionId:null,turnId:null,taskId:null,inputRevision:null},timers:{status:'unavailable',items:[]},capabilities:{musicRead:[],timerActions:[],answerRead:true},visualPending:{...pending}});
function accept(Class,value){const transport=new Class({url:'https://example.test/view/'});transport.closed=false;try{return transport.accept(value);}finally{clearTimeout(transport.freshnessTimer);}}
test('pending uses only vacant status detail and keeps actual speaking/listening labels',()=>{
 const value=voicePresentation(voice,true,pending);assert.equal(value.label,'Svarer…');assert.equal(value.detail,'Forbereder visning…');assert.equal(value.phase,'responding');
 const listening=voicePresentation({...voice,phase:'LISTENING'},true,pending);assert.equal(listening.label,'Lytter…');assert.equal(listening.detail,'Tal bare');
 assert.equal(voicePresentation(voice,false,pending),null);assert.equal(voicePresentation({...voice,active:false},true,pending),null);
 assert.equal(voicePresentation(voice,true,{...pending,sessionId:'other'}).detail,'');
 assert.equal(voicePresentation(voice,true).detail,'');
 assert.equal(value.key,voicePresentation(voice,true,{...pending}).key);assert.notEqual(value.key,voicePresentation(voice,true).key);
});
test('new optional pending scope is closed and old31 client safely ignores it',()=>{
 assert.equal(accept(PodVoiceTransport,snapshot()),true);assert.equal(accept(OldTransport,snapshot()),true);
 for(const mutate of [s=>s.visualPending.roomId='other',s=>s.visualPending.sessionId='other',s=>s.visualPending.revision=6,s=>s.visualPending.inputRevision=-1,s=>s.visualPending.extra=true,s=>s.voice.active=false,s=>s.voice.phase='CLOSING',s=>s.capabilities.answerRead=false]){const s=snapshot();mutate(s);assert.equal(accept(PodVoiceTransport,s),false);}
 const legacy=snapshot();delete legacy.visualPending;assert.equal(accept(PodVoiceTransport,legacy),true);
});
