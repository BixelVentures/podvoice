import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AnswerAutoReturn,autoReturnCandidate} from '../../podvoice/gatekeeper/static/podview/ui/answer-auto-return.js';
import {ScreenLifecycle} from '../../podvoice/gatekeeper/static/podview/ui/screen-lifecycle.js';
import {previewScene,conversationPreviewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
function setup(stage='conversation-complete'){
 let now=0,serial=0;const timers=new Map(),listeners=new Map();
 const doc={visibilityState:'visible',blocked:false,querySelector(){return this.blocked?{}:null;},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
 const host={live:false,isConnected:true,state:previewScene(stage,100000),previewStage:stage,ownerDocument:doc,dispatch(event){this.state=sceneTransition(this.state,event);}};
 const clock={setTimeout(fn,delay){timers.set(++serial,{fn,at:now+delay});return serial;},clearTimeout(id){timers.delete(id);}};
 const controller=new AnswerAutoReturn(host,clock);
 const advance=ms=>{now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}};
 return {host,doc,controller,timers,listeners,advance,clock};
}
test('returns to overview only after 30 seconds and unchanged renders never extend deadline or discard resources',()=>{
 const {host,controller,advance}=setup(),before=host.state;controller.sync();advance(15000);controller.sync();advance(14999);assert.equal(host.state.focus,before.focus);advance(1);assert.equal(host.state.focus,'now');
 for(const key of ['answers','music','timer','extraTimers'])assert.equal(host.state[key],before[key]);
});
test('speech and visual completion must both be explicit; a ready card alone never starts the clock',()=>{
 const {host,controller,timers,advance}=setup();host.previewStage='conversation-visual';host.state.voicePreviewPhase='AI_SPEAKING';controller.sync();assert.equal(timers.size,0);
 host.previewStage='conversation-complete';host.state.voicePreviewPhase='IDLE';host.state.answers[0].status='partial';controller.sync();assert.equal(timers.size,0);
 host.state.answers[0].status='ready';controller.sync();assert.equal(timers.size,1);advance(30000);assert.equal(host.state.focus,'now');
});
test('each input restarts the 30-second quiet period without changing task state',()=>{
 for(const event of ['pointerdown','click','touchstart','wheel','keydown','scroll']){
  const {host,controller,listeners,advance,timers}=setup(),focus=host.state.focus;controller.sync();advance(5000);listeners.get(event)();host.state.answers[0].revision++;host.state.localAnswerCompletion.revision++;controller.sync();advance(29999);assert.equal(host.state.focus,focus,event);assert.equal(timers.size,1);advance(1);assert.equal(host.state.focus,'now');
 }
});
test('new speech cancels the old answer countdown; its later completion does not restart',()=>{
 const {host,controller,advance,timers}=setup(),focus=host.state.focus;controller.sync();advance(5000);host.state.voicePreviewPhase='LISTENING';controller.sync();host.state.voicePreviewPhase='IDLE';controller.sync();advance(60000);assert.equal(host.state.focus,focus);assert.equal(timers.size,0);
});
test('steps, checklists, history, inline detail and open dialogs/details are excluded',()=>{
 for(const kind of ['steps','checklist']){const {host,controller,timers}=setup();host.state.answers[0].kind=kind;controller.sync();assert.equal(timers.size,0);}
 for(const patch of ['history','detail','dialog']){const {host,doc,controller,timers}=setup();if(patch==='history')host.historyBrowse={};if(patch==='detail')host.state.focus='weather';if(patch==='dialog')doc.blocked=true;controller.sync();assert.equal(timers.size,0);}
});
test('hidden page and teardown cancel without surprise when shown or reattached',()=>{
 const {host,doc,controller,listeners,advance,timers}=setup(),focus=host.state.focus;controller.sync();doc.visibilityState='hidden';listeners.get('visibilitychange')();doc.visibilityState='visible';controller.sync();advance(30000);assert.equal(host.state.focus,focus);controller.cleanup();assert.equal(timers.size,0);assert.equal(listeners.size,0);controller.sync();assert.equal(timers.size,0);
});
test('expiry rechecks open dialog and connection even without a render',()=>{
 for(const block of ['dialog','offline','detached']){const {host,doc,controller,advance}=setup(),focus=host.state.focus;controller.sync();if(block==='dialog')doc.blocked=true;if(block==='offline')host.state.connected=false;if(block==='detached')host.isConnected=false;advance(30000);assert.equal(host.state.focus,focus);}
});
test('live requires matching completed owner receipt, never an idle/ready phase inference',()=>{
 const {host}=setup(),a=host.state.answers[0];Object.assign(a,{live:true,exampleOnly:false,readConnected:true,sessionId:'s',turnId:'t',taskId:'task',inputRevision:1,revision:2});host.live=true;host.liveStatus='connected';host.liveTransport={connected:true};host.liveSnapshot={bootId:'b',capabilities:{answerRead:true},voice:{active:false,sessionId:null,phase:'IDLE'},answers:{sessionId:'s',turnId:'t',taskId:'task',inputRevision:1,revision:2}};
 assert.equal(autoReturnCandidate(host).eligible,false);host.liveSnapshot.answers.readOnlyCompleted=true;assert.equal(autoReturnCandidate(host).eligible,true);host.liveSnapshot.answers.turnId='other';assert.equal(autoReturnCandidate(host).eligible,false);host.liveSnapshot.answers.turnId='t';host.liveSnapshot.visualPending={};assert.equal(autoReturnCandidate(host).eligible,false);
});
test('finished alarm, held touch and focused input prevent conversation return',()=>{
 const x=setup();assert.equal(autoReturnCandidate(x.host).eligible,true);x.host.state.timer={status:'done'};assert.equal(autoReturnCandidate(x.host).eligible,false);x.host.state.timer=null;x.host.screenLifecycle={pointers:new Set([1])};assert.equal(autoReturnCandidate(x.host).eligible,false);x.host.screenLifecycle.pointers.clear();x.doc.activeElement={matches:()=>true};assert.equal(autoReturnCandidate(x.host).eligible,false);x.doc.activeElement=null;assert.equal(autoReturnCandidate(x.host).eligible,true);
});

test('completed answer returns to overview after 30s, then the existing idle owner waits a fresh 3 minutes before Ro',()=>{
 let now=400000,serial=0;const timers=new Map(),clock={now:()=>now,setTimeout(fn,delay){timers.set(++serial,{fn,at:now+delay});return serial;},clearTimeout:id=>timers.delete(id)},advance=ms=>{const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
 const doc={visibilityState:'visible',activeElement:null,querySelector:()=>null,addEventListener(){},removeEventListener(){}},host={live:false,isConnected:true,state:previewScene('conversation-complete',100000),previewStage:'conversation-complete',ownerDocument:doc,dataset:{},style:{setProperty(){}},lastInteractionAt:0};host.state.voicePreviewPhase='IDLE';const before=host.state;
 const lifecycle=host.screenLifecycle=new ScreenLifecycle(host,{navigator:{},removeEventListener(){}},clock);lifecycle.attached=true;const controller=new AnswerAutoReturn(host,clock);host.dispatch=event=>{host.state=sceneTransition(host.state,event);lifecycle.syncIdle();controller.sync();};
 // Simulate an old overview's idle deadline retained before this answer arrived.
 lifecycle.idleAt=now-300000;controller.sync();advance(29999);assert.equal(host.state.focus,before.focus);advance(1);assert.equal(host.state.focus,'now');assert.equal(lifecycle.idleAt,now,'arrival starts overview idle fresh');assert.equal(host.lastInteractionAt,0,'automatic navigation is not fabricated touch input');
 advance(179999);assert.equal(host.state.focus,'now');advance(1);assert.equal(host.state.focus,'photo');for(const key of ['answers','music','timer','extraTimers'])assert.equal(host.state[key],before[key]);assert.equal(timers.size,0);controller.cleanup();lifecycle.cleanup();
});

test('completed typed fixtures use a bound owner completion; stage names and ready status alone cannot grant it',()=>{
 for(const kind of ['concise','comparison','choices','chart','fact-card','sourced-image','answer-timeline','simple-diagram']){const f=setup(`answer-${kind}-ready`),before=f.host.state;assert.equal(autoReturnCandidate(f.host).eligible,true,kind);f.controller.sync();f.advance(29999);assert.equal(f.host.state.focus,before.focus);f.advance(1);assert.equal(f.host.state.focus,'now');assert.strictEqual(f.host.state.answers,before.answers);}
 for(const stage of ['answer-concise-waiting','answer-concise-partial','answer-concise-error','answer-concise-empty','answer-concise-offline','answer-concise-interrupted','answer-steps-ready','answer-checklist-ready','conversation-visual','conversation-followup'])assert.equal(autoReturnCandidate(setup(stage).host)?.eligible||false,false,stage);
 const f=setup('answer-concise-ready'),completion=f.host.state.localAnswerCompletion;for(const bad of [null,{...completion,answerId:'other'},{...completion,revision:completion.revision+1},{...completion,voice:'speaking'},{...completion,visual:'partial'}]){f.host.state.localAnswerCompletion=bad;f.host.previewStage='conversation-complete';assert.equal(autoReturnCandidate(f.host).eligible,false);}
});
const widgetSource=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),applySource=widgetSource.slice(widgetSource.indexOf(' applyConversationPreview('),widgetSource.indexOf('\n disconnectedCallback(')).trim(),scheduleSource=widgetSource.slice(widgetSource.indexOf(' scheduleAnswer(){'),widgetSource.indexOf('\n scheduleTick(){')).trim();
function finiteVoiceFlow(){const f=setup('conversation-visual'),{host,controller,clock}=f;host.frozenPreview=true;host.render=()=>controller.sync();host.scheduleTick=()=>{};host.scheduleAnswer=new Function('setTimeout','clearTimeout',`return function ${scheduleSource}`)(clock.setTimeout,clock.clearTimeout);host.applyConversationPreview=new Function('previewScene','conversationPreviewStates','sceneTransition',`return function ${applySource}`)(previewScene,conversationPreviewStates,sceneTransition);return f;}
test('authored speaking phase finishes through the existing answer flow, then starts the full 30s quiet period',()=>{
 const {host,controller,timers,advance}=finiteVoiceFlow(),before=host.state;controller.sync();assert.equal(timers.size,0);host.scheduleAnswer();advance(3999);assert.equal(host.state.voicePreviewPhase,'AI_SPEAKING');assert.equal(host.state.localAnswerCompletion,undefined);advance(1);assert.equal(host.state.voicePreviewPhase,'IDLE');assert.deepEqual(host.state.localAnswerCompletion,{answerId:before.focus,revision:before.answers[0].revision,voice:'completed',visual:'completed'});advance(29999);assert.equal(host.state.focus,before.focus);advance(1);assert.equal(host.state.focus,'now');for(const key of ['answers','music','timer','extraTimers'])assert.strictEqual(host.state[key],before[key]);controller.cleanup();
});
test('manual interruption and newer answer identity invalidate late authored voice completion',()=>{
 for(const change of ['interruption','newer']){const {host,advance}=finiteVoiceFlow();host.scheduleAnswer();if(change==='interruption')host.applyConversationPreview('conversation-interrupted');else host.state={...host.state,localVoiceCompletion:{...host.state.localVoiceCompletion,answerId:'newer'}};advance(4000);assert.notEqual(host.state.voicePreviewPhase,'IDLE',change);assert.equal(host.state.localAnswerCompletion,change==='interruption'?null:undefined);}
});
