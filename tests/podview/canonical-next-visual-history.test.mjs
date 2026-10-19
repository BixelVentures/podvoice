import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewScene,previewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {visualFamilies,validateVisualContent} from '../../podvoice/gatekeeper/static/podview/visual-content.js';
import {FORMATS,sceneTransition,focusedAnswer,initialScene} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {ownedAnswers} from '../../podvoice/gatekeeper/static/podview/owner-answers.js';

test('explicit QA history has one coherent saved household example for each canonical visual family',()=>{
 const state=previewScene('visual-history');assert(previewStates.includes('visual-history'));assert.equal(state.pendingAnswer,null);assert.equal(state.focus,'now');assert.deepEqual(state.answers.map(a=>a.kind),FORMATS);assert.equal(new Set(state.answers.map(a=>a.id)).size,10);
 for(const answer of state.answers){assert.equal(answer.exampleOnly,true);assert.equal(answer.status,'ready');assert.equal(answer.live,undefined);assert.equal(answer.receiptId,undefined);assert.equal(answer.ownerReceiptIds,undefined);if(visualFamilies.includes(answer.kind)){assert.equal(validateVisualContent(answer.kind,answer.content).summary,answer.content.summary);assert(answer.content.sources.every(s=>s.url==='example-sources.html'||answer.kind==='simple-diagram'&&s.url==='https://www.rei.com/learn/expert-advice/bike-gears-and-shifting.html'));}}
});
test('each existing history choice routes to same retained canonical answer without creating or requesting data',()=>{
 const state=previewScene('visual-history');for(const saved of state.answers){const next=sceneTransition(state,{type:'show',id:saved.id});assert.equal(focusedAnswer(next).id,saved.id);assert.equal(focusedAnswer(next).kind,saved.kind);assert.deepEqual(focusedAnswer(next).content,saved.content);assert.equal(next.answers.length,10);assert.equal(next.pendingAnswer,null);}
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
test('header reuses one history dialog/control and reserves far-right clock after weather',()=>{
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8'),nav=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));assert.equal((html.match(/id="history"/g)||[]).length,1);assert.equal((nav.match(/id="open-history"/g)||[]).length,1);assert(nav.indexOf('header-activity')<nav.indexOf('header-context'));assert(nav.indexOf('header-context')<nav.indexOf('open-history'));assert(nav.indexOf('open-history')<nav.indexOf('header-weather'));assert(nav.indexOf('header-weather')<nav.indexOf('header-clock'));assert(!nav.includes('disabled'));
});
test('header phase previews are explicit local stages, never normal scene activity',()=>{for(const [stage,phase] of Object.entries({listening:'LISTENING',thinking:'THINKING',speaking:'AI_SPEAKING',ready:'LOUNGE_WINDOW',waiting:'UNKNOWN'})){const state=previewScene(`header-${stage}`);assert.equal(state.voicePreviewPhase,phase);assert.equal(state.pendingAnswer,null);assert.equal(state.answers.length,0);}assert.equal(previewScene('quiet').voicePreviewPhase,undefined);assert.equal(initialScene().voicePreviewPhase,undefined);});

test('explicit top and now QA entries expose ten examples without changing their intended focus',()=>{for(const [stage,focus]of [['top','music'],['now','now']]){const state=previewScene(stage);assert.equal(state.focus,focus);assert.equal(state.answers.length,10);assert.equal(state.pendingAnswer,null);assert(state.answers.every(answer=>answer.exampleOnly&&!answer.live));}});

test('history gallery reuses canonical inert previews and one same-ID open control without row example prefixes',()=>{const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');assert(source.includes("const retained=document.createElement('article')"));assert(source.includes("viewport.inert=true"));assert(source.includes("viewport.setAttribute('aria-hidden','true')"));assert(source.includes("const preview=document.createElement('pv-answer')"));assert(!source.includes("preview.update({...s,connected:false},a)"),"Inert previews must preserve actual connectivity rather than inventing offline state");assert(source.includes("preview.inert=true"));assert(source.includes("this.dispatch({type:'show',id:a.id})"));assert(source.includes("const formatText=(answerCatalog[a.kind]"));assert(!source.includes("b.textContent=(a.exampleOnly?'Eksempel"));});
test('history gallery layout is scoped, two-column at device width and scrolls inside existing dialog',()=>{const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/frame-layout.css',import.meta.url),'utf8');assert(css.includes('#history #retained{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'));assert(css.includes('max-height:calc(100dvh - 32px)'));assert(css.includes('#history .history-preview'));assert(css.includes('pointer-events:none'));assert(css.includes('#history .history-open:focus-visible'));});

// Run the actual host projection with a mutation-counting DOM: source-only rendering
// tests do not claim browser layout, but catch rebuilding on irrelevant snapshots.
class HistoryNode extends EventTarget {
 constructor(tag='div'){super();this.tag=tag;this.children=[];this.attrs=new Map();this.writes=0;this.values={hidden:false,inert:false,textContent:''};this.updates=0;}
 get hidden(){return this.values.hidden;}set hidden(v){this.writes++;this.values.hidden=v;}
 get inert(){return this.values.inert;}set inert(v){this.writes++;this.values.inert=v;}
 get textContent(){return this.values.textContent;}set textContent(v){this.writes++;this.values.textContent=v;}
 append(...nodes){this.writes++;for(const n of nodes){n.parentElement=this;this.children.push(n);}}
 setAttribute(k,v){this.writes++;this.attrs.set(k,v);}getAttribute(k){return this.attrs.get(k)??null;}
 querySelector(selector){for(const n of this.children){if(n.tag===selector||selector==='.'+n.className)return n;const child=n.querySelector(selector);if(child)return child;}return null;}
 update(scene,answer){this.updates++;this.scene=scene;this.answer=answer;}
 getClientRects(){return [{}];}
}
const hostSource=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const projectHistory=new Function('s','$','document','answerCatalog',hostSource.slice(hostSource.indexOf(' for(const a of s.answers){'),hostSource.indexOf('\n const retainedRoot=')));
const openHistory=new Function('$','document',`return function ${hostSource.slice(hostSource.indexOf('open(id,opener){'),hostSource.indexOf('\n scheduleClock(){'))}`);
const historyCloseSource=hostSource.slice(hostSource.indexOf("$(id).addEventListener('close',()=>{")+"$(id).addEventListener('close',()=>{".length,hostSource.indexOf('});}',hostSource.indexOf("$(id).addEventListener('close',()=>{")));
const closeHistory=new Function('id','$',historyCloseSource);

test('unrelated snapshots preserve answer, preview, labels and attributes; authority changes still render immediately',()=>{
 const nodes=new Map([['answer-host',new HistoryNode()],['retained',new HistoryNode()]]),doc={createElement:tag=>new HistoryNode(tag)},get=id=>nodes.get(id),host={answerNodes:new Map(),retainedNodes:new Map(),live:true,liveTransport:{connected:true}};
 const answer={id:'stable-answer',kind:'concise',title:'Et svar',revision:1,status:'ready',content:{summary:'Bevar dette'}};let state={sessionId:'one',connected:true,answers:[answer],focus:'now'};
 const catalog={concise:'Kort svar'};projectHistory.call(host,state,get,doc,catalog);
 const widget=host.answerNodes.get(answer.id),retained=host.retainedNodes.get(answer.id),preview=retained.querySelector('pv-answer'),open=retained.querySelector('.history-open'),label=open.querySelector('strong');
 const watched=[widget,retained,preview,open,...open.children],before=watched.map(n=>n.writes);
 state={...state,timer:{remaining:11},answers:[{...structuredClone(answer),observedAt:123}]};projectHistory.call(host,state,get,doc,catalog);
 assert.equal(widget.updates,1);assert.equal(preview.updates,1);assert.deepEqual(watched.map(n=>n.writes),before);assert.equal(open.querySelector('strong'),label);assert.equal(widget.scene.timer,state.timer);assert.equal(widget.answer,state.answers[0]);
 host.liveTransport.connected=false;projectHistory.call(host,state,get,doc,catalog);assert.equal(widget.updates,2);assert.equal(widget.scene.connected,false);
 state={...state,sessionId:'two'};projectHistory.call(host,state,get,doc,catalog);assert.equal(widget.updates,3);assert.equal(preview.scene.sessionId,'two');
 state={...state,answers:[{...answer,historical:true,readStatus:'expired',revision:2}]};projectHistory.call(host,state,get,doc,catalog);assert.equal(widget.updates,4);assert.equal(preview.answer.historical,true);assert.equal(preview.inert,true);assert.equal(open.querySelector('strong'),label);
 state={...state,focus:answer.id};projectHistory.call(host,state,get,doc,catalog);assert.equal(widget.updates,4);assert.equal(widget.hidden,false);assert.equal(widget.inert,false);
});

test('history opens nonmodally, retains the current scene, leaves player operable, and restores prior scroll/inert/focus',()=>{
 const history=new HistoryNode('dialog'),responses=new HistoryNode(),under=new HistoryNode(),alreadyInert=new HistoryNode(),player=new HistoryNode(),trigger=new HistoryNode('button');alreadyInert.inert=true;responses.append(under,alreadyInert,history);responses.scrollTop=137;let focused=0;trigger.focus=()=>focused++;
 history.show=()=>{history.open=true;};history.showModal=()=>{throw Error('History must not make the player inert');};const nodes=new Map([['history',history],['open-history',trigger]]),get=id=>nodes.get(id),host={openers:new Map(),state:{focus:'music'},live:true};
 openHistory(get,{}).call(host,'history',trigger);assert.equal(history.open,true);assert.equal(host.state.focus,'music');assert.equal(under.inert,true);assert.equal(player.inert,false);assert.equal(responses.scrollTop,0);assert.equal(trigger.getAttribute('aria-expanded'),'true');
 openHistory(get,{}).call(host,'history',trigger);assert.equal(host.historyScrollTop,137);history.open=false;closeHistory.call(host,'history',get);assert.equal(responses.scrollTop,137);assert.equal(under.inert,false);assert.equal(alreadyInert.inert,true);assert.equal(focused,1);assert.equal(trigger.getAttribute('aria-expanded'),'false');
});

test('history markup uses the response pane and explains how real answers become available',()=>{
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8'),history=html.indexOf('<dialog id="history"');assert(history>html.indexOf('class="responses"'));assert(history<html.indexOf('</pv-widget-host>'));assert.match(html.slice(history,history+150),/aria-modal="false"/);assert(hostSource.includes('Når PodVoice viser et visuelt svar, kan du finde det her igen.'));assert(!hostSource.includes(":'Ingen gemte'"));assert(hostSource.includes('this.musicResults?.cleanup?.()'));
});

class HostLeaf extends HistoryNode {
 constructor(tag='div',all=[]){super(tag);all.push(this);this.all=all;this.selectors=new Map();this.dataset=new Proxy({},{set:(o,k,v)=>{this.writes++;o[k]=String(v);return true;},deleteProperty:(o,k)=>{this.writes++;delete o[k];return true;}});this.tokens=new Set();this.classList={contains:k=>this.tokens.has(k),toggle:(k,on)=>{this.writes++;on?this.tokens.add(k):this.tokens.delete(k);},remove:k=>{this.writes++;this.tokens.delete(k);}};}
 get disabled(){return this.values.disabled??false;}set disabled(v){this.writes++;this.values.disabled=!!v;}
 get hidden(){return !!this.values.hidden;}set hidden(v){this.writes++;this.values.hidden=!!v;}
 get inert(){return !!this.values.inert;}set inert(v){this.writes++;this.values.inert=!!v;}
 querySelector(selector){if(!this.selectors.has(selector))this.selectors.set(selector,new HostLeaf(selector,this.all));return this.selectors.get(selector);}
 insertBefore(node,before){this.writes++;const old=this.children.indexOf(node);if(old>=0)this.children.splice(old,1);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}
}

test('whole live host key regions emit zero DOM writes on an unchanged observation and preserve current timer authority',()=>{
 const all=[],nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new HostLeaf(id,all));return nodes.get(id);},doc={getElementById:get,querySelectorAll:()=>[],createElement:tag=>new HostLeaf(tag,all)},calls={timer:0,access:0,notice:0,radio:0,vehicle:0};
 const env={$:get,document:doc,resultsFor:()=>[],TRACKS:new Proxy({},{get:()=>({title:'Musik'})}),focusedAnswer:()=>null,timersFor:s=>s.timer?[s.timer]:[],timerPresentation:timers=>({current:timers[0]||null,visible:timers,all:timers}),timerStateLabel:t=>t.status,timerTime:n=>String(n),unconnectedVehicleModel:()=>({connected:false}),vehicleFixture:()=>({connected:true}),renderLiveWeather:()=>{},renderRobotHistory:()=>{},deviceLabel:()=>'',deviceActions:()=>[],answerCatalog:{}};
 const host=new HostLeaf('host',all);Object.assign(host,{live:true,liveStatus:'connected',state:{...previewScene('quiet'),devices:[],focus:'now'},answerNodes:new Map(),retainedNodes:new Map(),resourceButtons:new Map(),deviceNodes:new Map(),deviceRows:new Map(),liveSnapshot:{capabilities:{musicRead:[],homeRead:[],timerActions:['timer.start','timer.cancel']},timers:{status:'observed'}},radioView:{render(){calls.radio++;}},vehicleView:{render(){calls.vehicle++;}},timerView:{render(){calls.timer++;},renderAccess(){calls.access++;},renderNotice(){calls.notice++;}},renderVoice(){},alignOverview(){},liveCatalogue:{updateCapabilities(){},open(){},render(){}},liveSelection:{setAccount(){},onSnapshot(){}}});
 for(const [method,next] of [['renderLive','suspendLiveTimer'],['renderResourceRail','render'],['render',null]]){const start=hostSource.indexOf(' '+method+'(){'),end=next?hostSource.indexOf('\n '+next+'(',start):hostSource.lastIndexOf('\n}\ncustomElements.define');const code=hostSource.slice(start,end).trim();host[method]=new Function('env',`with(env){return ({${code}}).${method};}`)(env);}
 for(const focus of ['now','music','weather','photo']){host.state={...host.state,focus};host.render();const before=all.map(n=>n.writes),counts={...calls},identities=[...nodes.values()];host.state={...host.state};host.render();assert.deepEqual(all.map(n=>n.writes),before,focus+' keeps every host leaf unchanged');assert.deepEqual([...nodes.values()],identities);assert.deepEqual(calls,counts);}
 // A changed snapshot can revoke timer control without any layout change.
 host.liveSnapshot={...host.liveSnapshot,capabilities:{...host.liveSnapshot.capabilities,timerActions:[]}};const count=calls.access;host.render();assert.equal(calls.access,count+1);
 host.state={...host.state,timer:{id:'t',status:'running',name:'Pasta',duration:60,remaining:30,deadline:120001,revision:1}};env.createResourceTile=()=>new HostLeaf('resource',all);env.updateResourceTile=()=>{};host.render();const timerCalls=calls.timer,timerWrites=all.map(n=>n.writes);host.state={...host.state,timer:{...host.state.timer,deadline:120002,observedAt:123,revision:2}};host.render();assert.equal(calls.timer,timerCalls,'unseen owner/deadline precision changes do not repaint timer');assert.deepEqual(all.map(n=>n.writes),timerWrites,'metadata-only timer refresh leaves host DOM untouched');assert.equal(host.timerView.currentTimer.revision,2,'latest timer authority remains current');host.state={...host.state,timer:{...host.state.timer,status:'done',remaining:0}};host.render();assert.equal(calls.timer,timerCalls+1,'completion is projected immediately');
});
