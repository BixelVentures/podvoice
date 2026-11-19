import {groupAnswerHistory,answerThread} from '../../podview/owner-answers.js';
import {applyKitComponent,applyKitDialog,applyKitTextRole,createKitSliderField,createKitDisclosure} from '../../podview/ui/kit.js';
import {LightRoomView} from '../../podview/src/screens/light/LightRoomView.tsx';
import {renderOverviewMediaValues,fixtureArtwork} from '../../podview/music-results.js';
import {updateResourceFacts} from '../../podview/ui/resource-tile.js';
import {spotifyArtwork,spotifyItemUrl,renderRetainedArtwork,cancelArtwork} from '../../podview/spotify-artwork.js';
import {radioStation} from '../../podview/radio-model.js';
import {vehicleModel as projectVehicle,vehicleChargeUpdate,vehicleRailPresentation,vehicleOverviewFacts} from '../../podview/vehicle-model.js';
import {VehicleView} from '../../podview/src/screens/vehicle/VehicleView.tsx';
import test from 'node:test';
import {connectionPresentation,homeConnectionPresentation} from '../../podview/podvoice-view.js';
import {weatherHeaderVisible} from '../../podview/weather-view.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewScene,previewStates} from '../../podview/preview-scenes.js';
import {visualFamilies,validateVisualContent} from '../../podview/visual-content.js';
import {FORMATS,sceneTransition,focusedAnswer,initialScene,lightSelection,lightChoices,devicePresentation,robotRecentCompletion} from '../../podview/scene-model.js';
import {ownedAnswers} from '../../podview/owner-answers.js';

test('explicit QA history has one coherent saved household example for each canonical visual family',()=>{
 const state=previewScene('visual-history');assert(previewStates.includes('visual-history'));assert.equal(state.pendingAnswer,null);assert.equal(state.focus,'now');assert.deepEqual(state.answers.slice(0,10).map(a=>a.kind),FORMATS);assert.equal(new Set(state.answers.map(a=>a.id)).size,11);
 for(const answer of state.answers){assert.equal(answer.exampleOnly,true);assert.equal(answer.status,'ready');assert.equal(answer.live,undefined);assert.equal(answer.receiptId,undefined);assert.equal(answer.ownerReceiptIds,undefined);if(visualFamilies.includes(answer.kind)){assert.equal(validateVisualContent(answer.kind,answer.content).summary,answer.content.summary);assert(answer.content.sources.every(s=>s.url==='example-sources.html'||answer.kind==='simple-diagram'&&s.url==='https://www.rei.com/learn/expert-advice/bike-gears-and-shifting.html'));}}
});
test('each existing history choice routes to same retained canonical answer without creating or requesting data',()=>{
 const state=previewScene('visual-history');for(const saved of state.answers){const next=sceneTransition(state,{type:'show',id:saved.id});assert.equal(focusedAnswer(next).id,saved.id);assert.equal(focusedAnswer(next).kind,saved.kind);assert.deepEqual(focusedAnswer(next).content,saved.content);assert.equal(next.answers.length,11);assert.equal(next.pendingAnswer,null);}
});
test('normal and live-start quiet scenes remain unpopulated; local examples cannot pass owner receipt admission',()=>{
 assert.equal(initialScene().answers.length,0);assert.equal(previewScene('quiet').answers.length,0);assert.equal(previewScene('nothing').answers.length,0);const state=previewScene('visual-history');assert.throws(()=>ownedAnswers({schema:'podview.answers.v1',roomId:'r0',revision:1,items:state.answers},{roomId:'r0',answers:{revision:1,sessionId:'s'},voice:{sessionId:'s'}}));
});
test('an ordinary local answer remains an explicit example through completion and history',()=>{
 let state=sceneTransition(initialScene(),{type:'request',kind:'comparison'});
 const pending=focusedAnswer(state);assert.equal(pending.exampleOnly,true);assert.equal(pending.live,undefined);
 state=sceneTransition(state,{type:'answer-result',id:pending.id,generation:state.generation,status:'ready'});
 state=sceneTransition(state,{type:'show',id:'now'});
 assert.equal(state.answers[0].exampleOnly,true);assert.equal(state.answers[0].status,'ready');assert.equal(state.answers[0].live,undefined);
});
test('header phase previews are explicit local stages, never normal scene activity',()=>{for(const [stage,phase] of Object.entries({listening:'LISTENING',thinking:'THINKING',speaking:'AI_SPEAKING',ready:'LOUNGE_WINDOW',waiting:'UNKNOWN'})){const state=previewScene(`header-${stage}`);assert.equal(state.voicePreviewPhase,phase);assert.equal(state.pendingAnswer,null);assert.equal(state.answers.length,0);}assert.equal(previewScene('quiet').voicePreviewPhase,undefined);assert.equal(initialScene().voicePreviewPhase,undefined);});

test('explicit top and now QA entries expose ten examples without changing their intended focus',()=>{for(const [stage,focus]of [['top','music'],['now','now']]){const state=previewScene(stage);assert.equal(state.focus,focus);assert.equal(state.answers.length,10);assert.equal(state.pendingAnswer,null);assert(state.answers.every(answer=>answer.exampleOnly&&!answer.live));}});

test('history retains the existing bounded dialog and keyboard focus treatment',()=>{const css=readFileSync(new URL('../../podview/frame-layout.css',import.meta.url),'utf8');assert(css.includes('max-height:calc(100dvh - 32px)'));assert(css.includes('#history .history-open:focus-visible'));});

// Run the actual host projection with a mutation-counting DOM: source-only rendering
// tests do not claim browser layout, but catch rebuilding on irrelevant snapshots.
class HistoryNode extends EventTarget {
 constructor(tag='div'){super();this.tag=tag;this.children=[];this.attrs=new Map();this.writes=0;this.values={hidden:false,inert:false,textContent:''};this.updates=0;}
 get hidden(){return this.values.hidden;}set hidden(v){this.writes++;this.values.hidden=v;}
 get inert(){return this.values.inert;}set inert(v){this.writes++;this.values.inert=v;}
 get textContent(){return this.values.textContent;}set textContent(v){this.writes++;this.values.textContent=v;}
 append(...nodes){this.writes++;for(const n of nodes){n.parentElement=this;this.children.push(n);}}
 setAttribute(k,v){this.writes++;this.attrs.set(k,v);}getAttribute(k){return this.attrs.get(k)??null;}
 querySelector(selector){for(const n of this.children){if(n.tag===selector||selector.startsWith('.')&&String(n.className||'').split(' ').includes(selector.slice(1)))return n;const child=n.querySelector(selector);if(child)return child;}return null;}
 update(scene,answer){this.updates++;this.scene=scene;this.answer=answer;}
 getClientRects(){return [{}];}
}
const hostSource=readFileSync(new URL('../../podview/widget-view.js',import.meta.url),'utf8');
const projectHistoryRaw=new Function('s','$','document','answerCatalog','applyKitComponent','groupAnswerHistory','answerThread',hostSource.slice(hostSource.indexOf(' const historyRows=new Map();'),hostSource.indexOf('\n const ordered=groupAnswerHistory('))+'\nreturn historyRows;');const projectHistory=function(...args){return projectHistoryRaw.call(this,...args,applyKitComponent,groupAnswerHistory,answerThread);};
const openHistory=new Function('$','document',`return function ${hostSource.slice(hostSource.indexOf('open(id,opener){'),hostSource.indexOf('\n renderScreenSettings(){'))}`);
// The history dialog's close (the shell's onClose calls the host's dialogClosed) and a history row's tap.
const historyCloseSource=hostSource.slice(hostSource.indexOf(' dialogClosed(id){')+' dialogClosed(id){'.length,hostSource.lastIndexOf('}',hostSource.indexOf('\n togglePin(){')));
const openHistoryAnswer=new Function('$',`return function ${hostSource.slice(hostSource.indexOf('openHistoryAnswer(id){'),hostSource.indexOf('\n closeDialog(id){'))}`)(id=>globalThis.__historyGet(id));
const closeHistory=new Function('id','$',historyCloseSource);

test('history opens nonmodally, retains the current scene, leaves player operable, and restores prior scroll/inert/focus',()=>{
 const history=new HistoryNode('dialog'),responses=new HistoryNode(),under=new HistoryNode(),alreadyInert=new HistoryNode(),player=new HistoryNode(),trigger=new HistoryNode('button');alreadyInert.inert=true;responses.append(under,alreadyInert,history);responses.scrollTop=137;let focused=0;trigger.focus=()=>focused++;
 history.show=()=>{history.open=true;};history.showModal=()=>{throw Error('History must not make the player inert');};const nodes=new Map([['history',history],['open-history',trigger]]),get=id=>nodes.get(id),host={openers:new Map(),state:{focus:'music'},live:true,dispatch(event){assert.deepEqual(event,{type:'show',id:'now'});this.state.focus=event.id;},focusHeading(){focused++;}};
 openHistory(get,{}).call(host,'history',trigger);assert.equal(history.open,true);assert.equal(host.state.focus,'music');assert.equal(under.inert,true);assert.equal(player.inert,false);assert.equal(responses.scrollTop,0);assert.equal(trigger.getAttribute('aria-expanded'),'true');
 openHistory(get,{}).call(host,'history',trigger);assert.equal(host.historyScrollTop,137);history.open=false;closeHistory.call(host,'history',get);assert.equal(responses.scrollTop,137);assert.equal(under.inert,false);assert.equal(alreadyInert.inert,true);assert.equal(focused,1);assert.equal(trigger.getAttribute('aria-expanded'),'false');
});


class HostLeaf extends HistoryNode {
 constructor(tag='div',all=[]){super(tag);all.push(this);this.all=all;this.selectors=new Map();this.dataset=new Proxy({},{set:(o,k,v)=>{this.writes++;o[k]=String(v);return true;},deleteProperty:(o,k)=>{this.writes++;delete o[k];return true;}});this.tokens=new Set();this.classList={contains:k=>this.tokens.has(k),add:(...keys)=>{for(const k of keys)if(!this.tokens.has(k)){this.writes++;this.tokens.add(k);}},toggle:(k,on)=>{this.writes++;on?this.tokens.add(k):this.tokens.delete(k);},remove:k=>{this.writes++;this.tokens.delete(k);}};}
 get disabled(){return this.values.disabled??false;}set disabled(v){this.writes++;this.values.disabled=!!v;}
 get hidden(){return !!this.values.hidden;}set hidden(v){this.writes++;this.values.hidden=!!v;}
 get inert(){return !!this.values.inert;}set inert(v){this.writes++;this.values.inert=!!v;}
 get src(){return this.getAttribute('src')??'';}set src(v){this.setAttribute('src',String(v));}
 get alt(){return this.getAttribute('alt')??'';}set alt(v){this.setAttribute('alt',String(v));}
 querySelector(selector){if(!this.selectors.has(selector)){const node=new HostLeaf(selector,this.all);node.ownerDocument=this.ownerDocument;this.selectors.set(selector,node);}return this.selectors.get(selector);}
 insertBefore(node,before){this.writes++;const old=this.children.indexOf(node);if(old>=0)this.children.splice(old,1);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}
 after(node){if(!this.parentElement)return;const index=this.parentElement.children.indexOf(this);node.parentElement=this.parentElement;this.parentElement.children.splice(index+1,0,node);this.parentElement.writes++;}
}

test('whole live host key regions emit zero DOM writes on an unchanged observation and preserve current timer authority',()=>{
 const all=[],nodes=new Map(),create=tag=>Object.assign(new HostLeaf(tag,all),{ownerDocument:doc}),get=id=>{if(!nodes.has(id))nodes.set(id,create(id));return nodes.get(id);},doc={getElementById:get,querySelectorAll:()=>[],createElement:create},calls={timer:0,access:0,notice:0,radio:0,vehicle:0,recipe:0};
 const env={RecipeView:class {constructor(root,back,onCookingChange,{background}){calls.recipe++;this.root=root;this.background=background;this.pendingSession=null;}},groupAnswerHistory,answerThread,devicePresentation,LightRoomView,applyKitTextRole,createKitSliderField,createKitDisclosure,robotRecentCompletion,vehicleRailPresentation,vehicleOverviewFacts,createResourceTile:()=>create('resource'),updateResourceTile:()=>{},updateResourceFacts,spotifyArtwork,spotifyItemUrl,renderRetainedArtwork,cancelArtwork,radioStation,fixtureArtwork,$:get,document:doc,projectVehicle,vehicleChargeUpdate,renderOverviewMediaValues,connectionPresentation,homeConnectionPresentation,weatherHeaderVisible,lightSelection,lightChoices,resultsFor:()=>[],TRACKS:new Proxy({},{get:()=>({title:'Musik'})}),focusedAnswer:()=>null,timersFor:s=>s.timer?[s.timer]:[],timerPresentation:timers=>({current:timers[0]||null,visible:timers,all:timers}),timerStateLabel:t=>t.status,timerTime:n=>String(n),unconnectedVehicleModel:()=>({connected:false}),vehicleFixture:()=>({connected:true}),renderLiveWeather:()=>{},renderRobotHistory:()=>{},deviceLabel:()=>'',deviceActions:()=>[],answerCatalog:{}};
 const host=new HostLeaf('host',all);Object.assign(host,{ownerDocument:doc,live:true,liveStatus:'connected',state:{...previewScene('quiet'),devices:[],focus:'now'},answerNodes:new Map(),shell:{set(){},view:{history:{empty:{}},retry:{}}},resourceButtons:new Map(),deviceNodes:new Map(),deviceRows:new Map(),lightRooms:new HostLeaf('pv-choice-list',all),lightLamps:new HostLeaf('pv-choice-list',all),lightSceneStatus:new HostLeaf('p',all),liveSnapshot:{capabilities:{musicRead:[],homeRead:[],timerActions:['timer.start','timer.cancel']},timers:{status:'observed'}},radioView:{render(){calls.radio++;}},vehicleView:{feedbackScopeFor:VehicleView.prototype.feedbackScopeFor,render(){calls.vehicle++;}},timerView:{renderOverviewActivities(){},render(){calls.timer++;},renderAccess(){calls.access++;},renderNotice(){calls.notice++;}},renderOverviewAction(){},renderVoice(){},renderTopbar(){},renderConnectionNotice(){},alignOverview(){},liveCatalogue:{updateCapabilities(){},open(){},render(){}},liveSelection:{setAccount(){},onSnapshot(){}}});
 // History fixture has no Hue status DOM; the Hue renderer has separate coverage.
 host.renderLightStatus=()=>{};
 // Mount leaves before the no-op render audit; execute the real light lifecycle and control renderer below.
 host.lightControlButton=create('button');host.lightRefreshButton=create('button');
 const controlStart=hostSource.indexOf(' renderLiveLightControl('),controlEnd=hostSource.indexOf('\n actCurrentLight(',controlStart);host.renderLiveLightControl=new Function('env',`with(env){return ({${hostSource.slice(controlStart,controlEnd)}}).renderLiveLightControl;}`)(env);
 const scenesStart=hostSource.indexOf(' renderLightScenes('),scenesEnd=hostSource.indexOf('\n renderLightAdjustments(',scenesStart);assert.ok(scenesStart>=0&&scenesEnd>scenesStart);host.renderLightScenes=new Function('env',`with(env){return ({${hostSource.slice(scenesStart,scenesEnd)}}).renderLightScenes;}`)(env);
 const lightStart=hostSource.indexOf(' renderLightAdjustments(light){'),lightEnd=hostSource.indexOf('\n toggleLightOption(',lightStart);assert.ok(lightStart>=0&&lightEnd>lightStart);const lightMethods=new Function('env','applyKitComponent','applyKitDialog',`with(env){return (class{${hostSource.slice(lightStart,lightEnd)}}).prototype;}`)(env,applyKitComponent,applyKitDialog);for(const method of ['renderLightAdjustments','openLightDetail','renderLightDetail','closeLightDetail'])host[method]=lightMethods[method];
 for(const [method,next]of [['lightAreaContext','currentLightDevice'],['currentLightDevice','syncLightArea'],['syncLightArea','readLightArea'],['renderOverviewMediaCards','renderOverviewFacts'],['renderOverviewFacts','renderResourceRail']]){const start=hostSource.indexOf(' '+method+'('),end=hostSource.indexOf('\n '+(next==='readLightArea'?'async ':'')+next+'(',start);assert.ok(start>=0&&end>start);host[method]=new Function('env',`with(env){return ({${hostSource.slice(start,end)}}).${method};}`)(env);}
 for(const [method,next] of [['renderLive','suspendLiveTimer'],['renderResourceRail','render'],['render',null]]){const start=hostSource.indexOf(' '+method+'(){'),end=next?hostSource.indexOf('\n '+next+'(',start):hostSource.lastIndexOf('\n}\ncustomElements.define');const code=hostSource.slice(start,end).trim();host[method]=new Function('env',`with(env){return ({${code}}).${method};}`)(env);}
 for(const focus of ['now','music','weather','photo']){host.state={...host.state,focus};host.render();const before=all.map(n=>n.writes),counts={...calls},identities=[...nodes.values()];host.state={...host.state};host.render();assert.deepEqual(all.map(n=>n.writes),before,focus+' keeps every host leaf unchanged');assert.deepEqual([...nodes.values()],identities);assert.deepEqual(calls,counts);}
 assert.equal(calls.recipe,1,'one background recipe owner survives repeated host renders');
 assert.equal(host.recipeView.root,get('recipe-view'));assert.equal(host.recipeView.background,true);
 // A changed snapshot can revoke timer control without any layout change.
 host.liveSnapshot={...host.liveSnapshot,capabilities:{...host.liveSnapshot.capabilities,timerActions:[]}};const count=calls.access;host.render();assert.equal(calls.access,count+1);
 host.state={...host.state,timer:{id:'t',status:'running',name:'Pasta',duration:60,remaining:30,deadline:120001,revision:1}};env.createResourceTile=()=>new HostLeaf('resource',all);env.updateResourceTile=()=>{};host.render();const timerCalls=calls.timer,timerWrites=all.map(n=>n.writes);host.state={...host.state,timer:{...host.state.timer,deadline:120002,observedAt:123,revision:2}};host.render();assert.equal(calls.timer,timerCalls,'unseen owner/deadline precision changes do not repaint timer');assert.deepEqual(all.map(n=>n.writes),timerWrites,'metadata-only timer refresh leaves host DOM untouched');assert.equal(host.timerView.currentTimer.revision,2,'latest timer authority remains current');host.state={...host.state,timer:{...host.state.timer,status:'done',remaining:0}};host.render();assert.equal(calls.timer,timerCalls+1,'completion is projected immediately');
});

const dispatchHistory=new Function('sceneTransition','focusedAnswer','$',`return function ${hostSource.slice(hostSource.indexOf('dispatch(event){'),hostSource.indexOf('\n schedule(){'))}`)(sceneTransition,focusedAnswer,id=>globalThis.__historyGet(id));
const focusHistoryHeading=new Function('$','focusedAnswer',`return function ${hostSource.slice(hostSource.indexOf('focusHeading(){'),hostSource.indexOf('\n alignOverview(){'))}`)(id=>globalThis.__historyGet(id),focusedAnswer);
function historyBrowseSurface(){
 const nodes=new Map(),doc={activeElement:null,createElement:tag=>new HistoryNode(tag)},get=id=>{if(!nodes.has(id)){const n=new HistoryNode(id);n.focus=()=>{doc.activeElement=n;};nodes.set(id,n);}return nodes.get(id);};
 const responses=new HistoryNode('responses'),history=get('history');responses.append(get('underlying'),history);responses.scrollTop=91;get('retained').scrollTop=187;
 history.show=()=>{history.open=true;doc.activeElement=get('history-close');};
 const host={live:false,isConnected:true,state:{...previewScene('top'),navStack:[],devices:[]},liveSnapshot:{bootId:'boot',roomId:'room'},answerNodes:new Map(),openers:new Map(),render(){projectHistory.call(this,this.state,get,doc,answerCatalog);},scheduleReceipt(){},scheduleAnswer(){},scheduleDevices(){},scheduleTick(){}};
 const answerCatalog={concise:'Kort svar'};
 host.dispatch=dispatchHistory;host.focusHeading=focusHistoryHeading;host.open=openHistory(get,doc);history.close=()=>{history.open=false;closeHistory.call(host,'history',get);};
 const previous=globalThis.__historyGet;globalThis.__historyGet=get;host.render();
 host.openHistoryAnswer=openHistoryAnswer;
 return {host,get,doc,history,responses,restore(){if(previous===undefined)delete globalThis.__historyGet;else globalThis.__historyGet=previous;}};
}

test('history answer Back returns to overview without reopening history or replacing retained resources',()=>{
 const f=historyBrowseSurface();try{const {host,get,history,doc}=f,answer=host.state.answers.find(a=>a.kind==='concise'),original=answer,originalMusic=host.state.music;
 host.open('history',get('open-history'));get('retained').scrollTop=187;host.openHistoryAnswer(answer.id);assert.equal(host.state.focus,answer.id);assert.equal(history.open,false);
 host.dispatch({type:'back'});host.focusHeading();assert.equal(history.open,false);assert.equal(host.state.focus,'now');assert.equal(get('retained').scrollTop,187);assert.equal(host.state.answers.find(a=>a.id===answer.id),original);assert.equal(host.state.music,originalMusic);
 assert.equal(host.historyBrowse,null);host.dispatch({type:'back'});assert.equal(host.state.focus,'photo');assert.equal(host.state.music,originalMusic);
 }finally{f.restore();}
});
test('nested answer Back preserves its guide and original identity while returning to overview',()=>{
 const f=historyBrowseSurface();try{const {host,get,history}=f,answer=host.state.answers.find(a=>a.kind==='comparison');host.open('history',get('open-history'));host.openHistoryAnswer(answer.id);
 host.dispatch({type:'answer-action',sessionId:host.state.sessionId,taskId:answer.id,revision:answer.revision,action:'guide',optionId:'paper-fold'});const guide=focusedAnswer(host.state);assert.equal(guide.originKind,'comparison');host.dispatch({type:'back'});assert.equal(history.open,false);assert.equal(host.state.focus,'now');assert.equal(host.historyBrowse,null);assert.equal(host.state.answers.find(a=>a.id===answer.id),guide);host.dispatch({type:'show',id:answer.id});assert.equal(focusedAnswer(host.state),guide);
 }finally{f.restore();}
});
for(const invalid of ['boot','room','removed','hidden','navigation','disconnected'])test('invalidated history browse cannot reopen or steal focus: '+invalid,()=>{
 const f=historyBrowseSurface();try{const {host,get,history,doc}=f,answer=host.state.answers.find(a=>a.kind==='concise');host.open('history',get('open-history'));host.openHistoryAnswer(answer.id);
 if(invalid==='boot')host.liveSnapshot.bootId='other';if(invalid==='room')host.liveSnapshot.roomId='other';if(invalid==='removed')host.state={...host.state,answers:host.state.answers.filter(a=>a.id!==answer.id)};if(invalid==='hidden')host.state={...host.state,answers:host.state.answers.map(a=>a.id===answer.id?{...a,hidden:true}:a)};if(invalid==='navigation')host.dispatch({type:'show',id:'now'});if(invalid==='disconnected')host.isConnected=false;
 const elsewhere={id:'elsewhere'};doc.activeElement=elsewhere;host.dispatch({type:'back'});assert.equal(history.open,false);assert.equal(doc.activeElement,elsewhere);assert.equal(host.historyBrowse,null);
 }finally{f.restore();}
});
test('opening the same underlying answer from history returns to overview without replacing its identity',()=>{
 const f=historyBrowseSurface();try{const {host,get,history}=f,answer=host.state.answers.find(a=>a.kind==='concise');host.dispatch({type:'show',id:answer.id});const stack=host.state.navStack;host.open('history',get('open-history'));host.openHistoryAnswer(answer.id);host.dispatch({type:'back'});assert.equal(history.open,false);assert.equal(host.state.focus,'now');assert.equal(host.state.answers.find(a=>a.id===answer.id),answer);assert.equal(host.historyBrowse,null);host.dispatch({type:'back'});assert.equal(host.state.focus,'photo');
 }finally{f.restore();}
});
