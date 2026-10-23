import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewScene,conversationPreviewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const method=source.slice(source.indexOf(' applyConversationPreview('),source.indexOf('\n disconnectedCallback(')).trim();
const apply=new Function('previewScene','conversationPreviewStates','sceneTransition',`return ({${method}}).applyConversationPreview;`)(previewScene,conversationPreviewStates,sceneTransition);
function host(stage='conversation-overview'){
 const view={live:false,isConnected:true,state:previewScene(stage,1000000),previewStage:stage,renderCount:0,scheduled:[],querySelector(){return this.dialogOpen?{}:null;},render(){this.renderCount++;},scheduleAnswer(){this.scheduled.push('answer');},scheduleTick(){this.scheduled.push('tick');},applyConversationPreview:apply};
 view.ownerDocument={querySelector:()=>view.dialogOpen||view.siblingDialogOpen?{}:null};return view;
}
test('one conversation host keeps music, actual timer deadlines, devices and history across every manual phase',()=>{
 const view=host();view.state=sceneTransition(view.state,{type:'request',kind:'choices',resolved:true});view.state=sceneTransition(view.state,{type:'answer-result',...view.state.pendingAnswer,status:'ready'});view.state=sceneTransition(view.state,{type:'show',id:'now'});
 const {music,timer,extraTimers,timerHistory,devices}=view.state,history=view.state.answers[0];
 for(const stage of ['listening','working','speaking','visual','late','interrupted','followup','complete']){
  const before=view.state,oldAnswer=before.answers.find(answer=>answer.id===view.conversationPreviewAnswerId);
  assert.equal(view.applyConversationPreview(`conversation-${stage}`),true);
  for(const [key,value] of Object.entries({music,timer,extraTimers,timerHistory,devices}))assert.equal(view.state[key],value,key+' must retain its actual runtime object');
  assert.equal(view.state.timer.deadline,1522000);assert.equal(view.state.answers[0],history);assert.equal(view.frozenPreview,true);assert.equal(view.previewStage,`conversation-${stage}`);assert.equal(view.state.pendingAnswer,null);
  if(['listening','working','speaking','late','interrupted','complete'].includes(stage)){assert.equal(view.state.answers,before.answers);assert.equal(view.state.focus,before.focus);}
  if(stage==='visual'){assert.equal(view.state.answers.length,2);assert.notEqual(view.conversationPreviewAnswerId,history.id);assert.equal(view.state.focus,view.conversationPreviewAnswerId);}
  if(stage==='followup'){const answer=view.state.answers.at(-1);assert.equal(answer.id,oldAnswer.id);assert.equal(answer.revision,oldAnswer.revision+1);assert.equal(answer.title,'Og hvis vi venter et par timer?');}
 }
 assert.equal(view.state.voicePreviewPhase,'IDLE');assert.equal(view.renderCount,8);assert.equal(view.scheduled.length,16);
});
test('existing visual snapshot joins the continuous flow without duplicate answers or lost revision',()=>{
 const view=host('conversation-visual'),first=view.state.answers[0];assert.equal(view.applyConversationPreview('conversation-visual'),true);assert.equal(view.state.answers.length,1);assert.equal(view.state.answers[0].id,first.id);assert.equal(view.state.answers[0].revision,first.revision);
 assert.equal(view.applyConversationPreview('conversation-followup'),true);const revised=view.state.answers[0];assert.equal(revised.revision,first.revision+1);view.applyConversationPreview('conversation-followup');assert.equal(view.state.answers[0].revision,revised.revision);
 view.applyConversationPreview('conversation-overview');assert.equal(view.state.focus,'now');assert.equal(view.state.answers[0].id,first.id);
});

test('interactive reconnect projects the same connection phase as its authored scene and clears it after recovery',()=>{
 const view=host('conversation-visual'),music=view.state.music,answerId=view.state.answers[0].id;
 assert.equal(view.applyConversationPreview('conversation-offline'),true);assert.equal(view.state.connected,false);assert.equal(view.state.connectionPreview.status,'disconnected');
 assert.equal(view.applyConversationPreview('conversation-reconnecting'),true);assert.equal(view.state.connected,false);assert.equal(view.state.connectionPreview.status,'connecting');
 assert.equal(view.applyConversationPreview('conversation-reconnected'),true);assert.equal(view.state.connected,true);assert.equal(view.state.connectionPreview,null);
 assert.deepEqual(view.state.music.playback,music.playback);assert.ok(view.state.answers.some(answer=>answer.id===answerId));
});
test('manual conversation steps never steal an open detail dialog or operate on a live/detached host',()=>{
 for(const patch of [{live:true},{live:undefined},{isConnected:false},{dialogOpen:true}]){const view=Object.assign(host(),patch),state=view.state;assert.equal(view.applyConversationPreview('conversation-visual'),false);assert.equal(view.state,state);assert.equal(view.renderCount,0);assert.deepEqual(view.scheduled,[]);}
 const view=host(),state=view.state;for(const stage of ['visual','weather',null,'conversation-invented'])assert.equal(view.applyConversationPreview(stage),false);assert.equal(view.state,state);
});
test('voice-only steps keep the current detail focus and nav path until an explicit visual result',()=>{
 const view=host('conversation-visual');view.state=sceneTransition(view.state,{type:'show',id:'weather'});const before=view.state;for(const stage of ['listening','working','speaking','complete']){view.applyConversationPreview(`conversation-${stage}`);assert.equal(view.state.focus,'weather');assert.equal(view.state.navStack,before.navStack);assert.equal(view.state.detailOrigin,before.detailOrigin);}
});

test('conversation focus changes use the canonical motion capture before render and enter after it; unchanged focus retains scroll',()=>{
 const view=host(),calls=[],box={x:700,y:60,width:420,height:680};view.scrollTop=184;
 view.render=function(){calls.push(['render',this.state.focus]);};
 view.motion={capture(previous){calls.push(['capture',previous,view.state.focus,view.scrollTop]);return box;},enter(previous,next,oldPlayer,back){calls.push(['enter',previous,next,oldPlayer,back]);view.scrollTop=0;}};
 view.applyConversationPreview('conversation-visual');const answerId=view.state.focus;
 assert.deepEqual(calls,[['capture','now','now',184],['render',answerId],['enter','now',answerId,box,false]]);
 view.scrollTop=137;calls.length=0;
 for(const phase of ['listening','working','speaking','late','interrupted','followup','complete'])view.applyConversationPreview(`conversation-${phase}`);
 assert.equal(view.scrollTop,137);assert.equal(calls.length,7);assert(calls.every(call=>call[0]==='render'&&call[1]===answerId));
 calls.length=0;view.applyConversationPreview('conversation-overview');assert.deepEqual(calls,[['capture',answerId,answerId,137],['render','now'],['enter',answerId,'now',box,true]]);
});
test('a body-sibling native dialog blocks manual steps even when the host contains no open dialog',()=>{
 const view=host();view.siblingDialogOpen=true;assert.equal(view.querySelector('dialog[open]'),null);assert.ok(view.ownerDocument.querySelector('dialog[open]'));
 const state=view.state;view.motion={capture(){assert.fail('blocked step cannot capture or animate');},enter(){assert.fail('blocked step cannot enter');}};
 assert.equal(view.applyConversationPreview('conversation-visual'),false);assert.equal(view.state,state);assert.equal(view.renderCount,0);assert.deepEqual(view.scheduled,[]);assert.equal(view.conversationPreviewAnswerId,undefined);
 view.siblingDialogOpen=false;view.motion=undefined;assert.equal(view.applyConversationPreview('conversation-visual'),true);
});

test('long-answer progression finishes the existing timer without replacing music or moving focus',()=>{
 const view=host(),music=view.state.music,timer=view.state.timer;
 view.applyConversationPreview('conversation-visual');const id=view.state.focus;
 view.applyConversationPreview('conversation-long');const answer=view.state.answers[0];
 assert.equal(view.state.focus,id);assert.equal(view.state.timer,timer);assert.equal(view.state.music,music);
 assert.ok(answer.content.facts.length>4);
 view.applyConversationPreview('conversation-timer-finished');
 assert.equal(view.state.timer.id,timer.id);assert.equal(view.state.timer.deadline,timer.deadline);assert.equal(view.state.timer.status,'done');assert.equal(view.state.timer.remaining,0);
 assert.equal(view.state.focus,id);assert.equal(view.state.answers[0],answer);assert.equal(view.state.music,music);
 const done=view.state.timer;view.applyConversationPreview('conversation-timer-finished');assert.equal(view.state.timer,done);
});
test('visual failure and reconnect preserve useful answers, resource selections and never replay actions',()=>{
 const view=host();view.applyConversationPreview('conversation-visual');const answer=view.state.answers[0],timer=view.state.timer,playback=view.state.music.playback;
 view.applyConversationPreview('conversation-visual-error');assert.equal(view.state.answers[0],answer);assert.match(view.state.notice,/visuelle svar/);
 view.applyConversationPreview('conversation-offline');assert.equal(view.state.connected,false);const generation=view.state.generation;
 view.applyConversationPreview('conversation-offline');assert.equal(view.state.generation,generation);
 view.applyConversationPreview('conversation-reconnecting');assert.equal(view.state.connected,false);
 view.applyConversationPreview('conversation-reconnected');assert.equal(view.state.connected,true);assert.equal(view.state.music.pending,null);
 assert.equal(view.state.answers[0],answer);assert.equal(view.state.timer,timer);assert.equal(view.state.music.playback,playback);
});
test('an inline detail defers arriving answers until the user returns',()=>{
 const view=host();view.applyConversationPreview('conversation-visual');const answer=view.state.answers[0];
 view.state=sceneTransition(view.state,{type:'show',id:'weather'});const detail=view.state;
 assert.equal(view.applyConversationPreview('conversation-followup'),false);assert.equal(view.state,detail);
 view.state=sceneTransition(view.state,{type:'show',id:answer.id});
 assert.equal(view.applyConversationPreview('conversation-followup'),true);assert.equal(view.state.focus,answer.id);
});

test('long answer returns through overview with both reading positions and resources retained',()=>{
 const view=host(),positions=new Map();view.scrollTop=84;
 view.motion={capture(focus){positions.set(focus,view.scrollTop);},enter(previous,next,box,back){view.scrollTop=back?positions.get(next)||0:0;}};
 const music=view.state.music;
 view.applyConversationPreview('conversation-visual');view.applyConversationPreview('conversation-long');view.scrollTop=286;
 const answer=view.state.answers[0];view.applyConversationPreview('conversation-timer-finished');const timer=view.state.timer;
 assert.equal(view.scrollTop,286);
 view.applyConversationPreview('conversation-overview');assert.equal(view.scrollTop,84);
 view.applyConversationPreview('conversation-resume');assert.equal(view.scrollTop,286);assert.equal(view.state.focus,answer.id);
 assert.equal(view.state.answers[0],answer);assert.equal(view.state.timer,timer);assert.equal(view.state.music,music);
});
test('speaker picker defers followup without replacing the selected output or answer',()=>{
 const view=host();view.applyConversationPreview('conversation-visual');view.dialogOpen=true;
 const before=view.state,playback=before.music.playback;
 assert.equal(view.applyConversationPreview('conversation-followup'),false);assert.equal(view.state,before);
 view.dialogOpen=false;assert.equal(view.applyConversationPreview('conversation-followup'),true);
 assert.equal(view.state.music.playback,playback);assert.equal(view.state.answers[0].id,before.answers[0].id);
});
