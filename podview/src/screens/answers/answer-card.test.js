// Ported from tests/podview/root-history-renderer.test.mjs (node:test + fake DOM) to Vitest with a real DOM when the
// answer card (<pv-answer>) moved to React: the tests that drive the card. Its tests of the shared visual kit
// components stay there (plain JS). Same assertions. Adaptations: widget() is a real <pv-answer> placed in the
// document inside a [data-motion=reduced] wrapper (the fake was always connected and its querySelector made a loose
// fake node per selector; the reduced wrapper keeps happy-dom's cancelled step-guide title animation from surfacing as
// an unhandled AbortError); the fake's `children` arrays are real HTMLCollections, given the array methods the
// assertions use (this file only); the fake details/summary of one test are real ones; a summary a test clicks does
// not toggle natively (see quiet()); kit elements read without a card are placed in the document; properties the fake
// let a test overwrite (offsetHeight, style) are defined with
// Object.defineProperty; cards are removed after each test.
import assert from 'node:assert/strict';
import {afterEach, test} from 'vitest';
import {previewScene} from '../../../preview-scenes.js';
import {visualExamples} from '../../../visual-examples.js';
import {initialScene,sceneTransition} from '../../../scene-model.js';
import '../../../ui/library/visual-components.js';
import './AnswerWidget';
const ARRAY_METHODS=['find','filter','map','some','every','includes','indexOf','slice','at'];
for(const type of [NodeList,HTMLCollection])for(const method of ARRAY_METHODS)if(!(method in type.prototype))
 Object.defineProperty(type.prototype,method,
  {configurable:true,value(...args){return Array.prototype[method].apply([...this],args);}});
afterEach(()=>{document.body.replaceChildren();});
const receiptId='a'.repeat(32);
// The fake <summary> had no native activation: these tests drive open and toggle themselves, so a summary's native
// toggle (synchronous in happy-dom) is prevented where a test clicks it.
const quiet=summary=>{summary.addEventListener('click',event=>event.preventDefault());return summary;};
function widget(){const wrapper=document.createElement('div');wrapper.dataset.motion='reduced';document.body.append(wrapper);
 const view=document.createElement('pv-answer');wrapper.append(view);return view;}
test('historical answer metadata uses original date and AI provenance; action/retry dispatch and duplicate return are blocked',()=>{
 const view=widget(),answer={id:'receipt:'+receiptId,receiptId,kind:'concise',title:'Original',status:'ready',readStatus:'offline',readConnected:false,live:true,presentation:true,historical:true,observedAt:1700000000,provenance:{kind:'ai_explanation'},ownerReceiptIds:[receiptId],content:{summary:'Bevaret svar',sources:[{id:'source',kind:'owner_receipt',receiptId,label:'AI-forklaring',scope:'conversation_answer'}]}};
 const events=[];view.addEventListener('widget-action',e=>events.push(e.detail));view.addEventListener('owner-answer-retry',e=>events.push(e.detail));view.update({connected:false},answer);
 assert.match(view.querySelector('.answer-meta').textContent,/Tidligere svar.*2023.*AI-forklaring/);assert.equal(view.querySelector('.answer-status').hidden,true);assert.equal(view.querySelector('.sources').hidden,true);assert.equal(view.querySelector('.retry-answer').hidden,true);assert.equal(view.querySelector('.intro').data.text,'Bevaret svar');
 for(const action of ['choose','check','filter','guide','back'])view.act(action,'id');view.querySelector('.retry-answer').dispatchEvent(new Event('click'));view.emit({type:'answer-action'});assert.equal(events.length,0);view.querySelector('.dismiss').dispatchEvent(new Event('click'));assert.deepEqual(events,[]);assert.equal(view.querySelector('.dismiss').hidden,true);
});
test('all ten historical formats retain existing content anatomy and ready state',()=>{
 const shapes={concise:{},choices:{items:[{id:'one',label:'Et valg',detail:'Detalje',sourceId:'source'}]},comparison:{columns:[{id:'time',label:'Tid'}],items:[{id:'one',label:'Et valg',values:['5 min.'],sourceId:'source'}]},chart:{unit:'minutter',unitSingular:'minut',items:[{id:'one',label:'Pause',value:5,sourceId:'source'}]},steps:{steps:[{id:'one',text:'Første trin',sourceId:'source'}]},checklist:{items:[{id:'one',label:'Papir',checked:false,sourceId:'source'}]}};
 for(const kind of [...Object.keys(shapes),'fact-card','sourced-image','answer-timeline','simple-diagram']){const view=widget();let content=shapes[kind]?{summary:'Originalt indhold',...shapes[kind],sources:[{id:'source',kind:'owner_receipt',receiptId,label:'Grundlag',scope:'tool_result'}]}:structuredClone(visualExamples[kind].content);const answer={id:'receipt:'+receiptId,receiptId,kind,title:'Original '+kind,status:'ready',live:true,presentation:true,historical:true,observedAt:1700000000,provenance:{kind:'owner_sources'},ownerReceiptIds:[receiptId],content};view.update({connected:false},answer);assert.equal(view.querySelector('h1').textContent,answer.title);assert.equal(view.querySelector('.retry-answer').hidden,true);if(view.visualNode){assert.equal(view.visualNode.data.historical,true);assert.equal(view.visualNode.dataset.state,'ready');assert.equal(view.visualNode.summary.textContent,content.summary);}else{assert.equal(view.querySelector('.intro').data.text,content.summary);assert.equal(view.querySelector('.answer-status').hidden,true);} }
});

test('format switches clear stale weather actions and busy state without closing unchanged source disclosure',()=>{
 const view=widget(),scene={connected:true,sessionId:'local'};
 const weather={id:'weather-answer',kind:'concise',title:'Vejret',status:'ready'};
 view.update(scene,weather);view.querySelector('.open-weather-answer').hidden=false;
 const answer={id:'activities',kind:'comparison',title:'Aktiviteter',status:'ready',filter:'all',selected:'missing',revision:1};
 assert.doesNotThrow(()=>view.update(scene,answer));
 assert.equal(view.querySelector('.open-weather-answer').hidden,true);
 assert.equal(view.querySelector('.comparison').hidden,false);
 assert.deepEqual(view.querySelector('.guide').data.steps,[]);
 view.querySelector('.sources').open=true;view.update(scene,{...answer});
 assert.equal(view.querySelector('.sources').open,true);
 view.update(scene,{...answer,status:'waiting'});assert.equal(view.getAttribute('aria-busy'),'true');
 view.update(scene,weather);assert.equal(view.getAttribute('aria-busy'),'false');
 assert.equal(view.querySelector('.sources').open,false);
 assert.equal(view.querySelector('.answer-heading-target').dataset.customize,undefined);
});
test('review alternatives are explicit local presentation and clear when leaving review',()=>{
 const view=widget(),scene={connected:true,voicePreviewPhase:'LISTENING'},base={id:'example',kind:'fact-card',title:'Et svar',status:'ready',exampleOnly:true,content:structuredClone(visualExamples['fact-card'].content)};
 view.update(scene,{...base,reviewPresentation:{returnLabel:'Til overblik',previousAnswer:true}});
 assert.equal(view.querySelector('.dismiss').getAttribute('aria-label'),'Til overblik');
 assert.equal(view.querySelector('.answer-meta').textContent,'Forrige svar');assert.equal(view.querySelector('.answer-meta').hidden,false);
 view.update(scene,base);assert.equal(view.querySelector('.dismiss').getAttribute('aria-label'),'Til overblik');assert.equal(view.querySelector('.answer-meta').hidden,true);
 view.update(scene,{...base,live:true,readConnected:true,reviewPresentation:{returnLabel:'Til overblik',previousAnswer:true}});
 assert.equal(view.querySelector('.dismiss').getAttribute('aria-label'),'Til overblik');assert.equal(view.querySelector('.answer-meta').hidden,true);
});

test('answer navigation belongs only to global Back; hidden legacy controls cannot hide the answer',()=>{
 const view=widget(),answer={id:'answer-1',kind:'concise',title:'Vejret',status:'ready',exampleOnly:true};
 let scene={...initialScene(),focus:answer.id,answers:[answer],timer:{id:'timer-1',status:'running'}};
 const music=scene.music,timer=scene.timer;view.addEventListener('widget-action',event=>{scene=sceneTransition(scene,event.detail);});view.update(scene,answer);
 assert.equal(view.querySelector('.dismiss').hidden,true);view.querySelector('.dismiss').dispatchEvent(new Event('click'));assert.equal(scene.focus,answer.id);
 scene=sceneTransition(scene,{type:'back'});assert.equal(scene.focus,'now');assert.equal(scene.answers[0],answer);assert.equal(scene.answers[0].hidden,undefined);assert.equal(scene.music,music);assert.equal(scene.timer,timer);
 view.update(scene,{...answer,reviewPresentation:{returnLabel:'hide'}});assert.equal(view.querySelector('.dismiss').hidden,true);view.querySelector('.dismiss').dispatchEvent(new Event('click'));assert.equal(scene.answers[0].hidden,undefined);
});

test('a newly identified visual answer never borrows previous answer content while waiting',()=>{
 const view=widget(),scene={connected:true},ready={id:'first',kind:'fact-card',title:'Første svar',status:'ready',content:structuredClone(visualExamples['fact-card'].content)};
 view.update(scene,ready);const first=view.visualNode;assert.ok(first.lastContent);
 // The host assigns current authority before requesting render; rendered identity must be independent.
 const waiting={...ready,id:'second',title:'Nyt svar',status:'waiting',content:undefined};view.answer=waiting;view.update(scene,waiting);
 assert.notEqual(view.visualNode,first);assert.equal(view.visualNode.lastContent,undefined);assert.equal(view.visualNode.summary.hidden,true);assert.equal(view.visualNode.getAttribute('aria-busy'),'true');
 view.update(scene,{...waiting,status:'ready',content:ready.content});const retained=view.visualNode;
 view.update(scene,{...waiting,status:'waiting'});assert.equal(view.visualNode,retained);assert.equal(view.visualNode.summary.hidden,false);assert.equal(view.visualNode.summary.textContent,ready.content.summary);
});

test('all ten local answer states distinguish interruption, empty result and a retryable error',()=>{
 for(const kind of ['concise','choices','comparison','chart','steps','checklist','fact-card','sourced-image','answer-timeline','simple-diagram']){
  const view=widget(),scene={connected:true,sessionId:'local'},base={id:'states-'+kind,kind,title:'Et svar',status:'ready',selected:'paper-fold',filter:'all',checked:[],content:visualExamples[kind]?.content};
  const events=[];view.addEventListener('widget-action',event=>events.push(event.detail));view.update(scene,base);
  view.update(scene,{...base,status:'interrupted'});assert.equal(view.querySelector('.retry-answer').hidden,true,kind);view.querySelector('.retry-answer').dispatchEvent(new Event('click'));assert.equal(events.length,0,kind);
  if(view.visualNode){assert.equal(view.visualNode.dataset.state,'interrupted');assert.equal(view.visualNode.note.textContent,'Svaret blev afbrudt.');assert.equal(view.visualNode.body.hidden,false);}else assert.equal(view.querySelector('.answer-status').data.state,'interrupted');
  view.update(scene,{...base,status:'empty'});assert.equal(view.querySelector('.retry-answer').hidden,true,kind);
  view.update(scene,{...base,status:'error'});assert.equal(view.querySelector('.retry-answer').hidden,false,kind);view.querySelector('.retry-answer').dispatchEvent(new Event('click'));assert.deepEqual(events,[{type:'request',kind}]);
  view.update({connected:false},{...base,status:'error'});view.querySelector('.retry-answer').dispatchEvent(new Event('click'));assert.equal(events.length,1,kind);
 }
});
test('live error retry is a source reread and interrupted live answers remain content without retry',()=>{
 const view=widget(),scene={connected:true},answer={id:'receipt:'+receiptId,receiptId,kind:'concise',title:'Et svar',status:'ready',readStatus:'error',readConnected:true,live:true,presentation:true,ownerReceiptIds:[receiptId],content:{summary:'Bevaret forklaring',sources:[{id:'source',kind:'owner_receipt',receiptId,label:'Grundlag',scope:'tool_result'}]}};
 const reads=[],actions=[];view.addEventListener('owner-answer-retry',event=>reads.push(event.detail));view.addEventListener('widget-action',event=>actions.push(event.detail));
 view.update(scene,answer);assert.equal(view.querySelector('.retry-answer').textContent,'Hent igen');view.querySelector('.retry-answer').dispatchEvent(new Event('click'));assert.deepEqual(reads,[{receiptId}]);assert.deepEqual(actions,[]);
 view.update(scene,{...answer,readStatus:'interrupted'});assert.equal(view.querySelector('.intro').hidden,false);assert.equal(view.querySelector('.intro').data.text,'Bevaret forklaring');assert.equal(view.querySelector('.answer-status').data.state,'interrupted');assert.equal(view.querySelector('.retry-answer').hidden,true);view.querySelector('.retry-answer').dispatchEvent(new Event('click'));assert.equal(reads.length,1);
});

test('global offline notice suppresses duplicate answer copy while standalone previews retain their status',()=>{
 for(const kind of ['concise','choices','comparison','chart','steps','checklist','fact-card','sourced-image','answer-timeline','simple-diagram']){
  const view=widget(),base={id:'offline-'+kind,kind,title:'Seneste svar',status:'ready',selected:'paper-fold',filter:'all',checked:[],content:visualExamples[kind]?.content};
  view.update({connected:false},base);const note=view.visualNode?.note||view.querySelector('.answer-status');assert.equal(note.hidden,false,kind);
  view.update({connected:false,connectionNoticeVisible:true},base);assert.equal(note.hidden,true,kind);if(view.visualNode)assert.equal(view.visualNode.dataset.state,'offline');else assert.equal(note.data.state,'offline');
  view.update({connected:false,connectionNoticeVisible:false},base);assert.equal(note.hidden,false,kind);
 }
});
test('archived local error answers never present a retry action in any family',()=>{for(const kind of ['concise','choices','comparison','chart','steps','checklist','fact-card','sourced-image','answer-timeline','simple-diagram']){const view=widget(),answer={id:'archived-'+kind,kind,title:'Tidligere svar',status:'error',historical:true,revision:1,...(visualExamples[kind]?{content:structuredClone(visualExamples[kind].content)}:{})};view.update({connected:true},answer);assert.equal(view.querySelector('.retry-answer').hidden,true,kind);}});

test('response canvas error dock exposes the actual retry without reviving actions from a different answer',()=>{
 const view=widget(),scene={connected:true,sessionId:'local'};
 view.update(scene,{id:'choices',kind:'choices',title:'Valg',status:'ready',filter:'all',revision:1});
 assert.equal(view.querySelector('.followups').hidden,false);
 view.update(scene,{id:'weather',kind:'concise',title:'Vejret',status:'error',revision:1});
 assert.equal(view.querySelector('.retry-answer').hidden,false);assert.equal(view.querySelector('.answer-actions').hidden,false);assert.equal(view.querySelector('.followups').hidden,true);assert.equal(view.querySelector('.start-guide').hidden,true);
});

test('visual sources follow the answer as a named disclosure, never a leading ellipsis row',()=>{
 const view=document.body.appendChild(document.createElement('pv-fact-card'));view.data={state:'ready',content:visualExamples['fact-card'].content};
 assert.equal(view.sources.children[0].textContent,'Kilder');assert.equal(view.sources.children[0].querySelector('img'),null);assert.equal(view.sources.parentNode,view);assert.ok(view.children.indexOf(view.sources)>view.children.indexOf(view.body));assert.equal(view.lead.querySelector('details'),null);
 const widgetView=widget(),answer={id:'fact',kind:'fact-card',title:'Fakta',status:'ready',content:visualExamples['fact-card'].content};widgetView.update({connected:true},answer);
 assert.equal(widgetView.visualNode.sources.parentNode,widgetView.querySelector('.answer-content'));assert.equal(widgetView.querySelector('.response-heading').children.includes(widgetView.visualNode.sources),false);
});

test('comparison content remains hidden and inert through successive step updates',()=>{
 const view=widget(),scene={connected:true,sessionId:'local'},answer={id:'same-task',kind:'comparison',title:'En pause',status:'ready',filter:'all',selected:'paper-fold',revision:1};
 view.update(scene,answer);assert.equal(view.querySelector('.comparison').hidden,false);assert.equal(view.querySelector('.comparison').inert,false);
 for(const step of [0,1,2]){view.update(scene,{...answer,kind:'steps',step,revision:step+2});assert.equal(view.querySelector('.comparison').hidden,true);assert.equal(view.querySelector('.comparison').inert,true);assert.equal(view.querySelector('.answer-choices').hidden,true);assert.equal(view.querySelector('.answer-choices').inert,true);assert.equal(view.querySelector('.guide').hidden,false);assert.equal(view.querySelector('.guide').inert,false);assert.equal(view.querySelector('.guide').data.index,step);}
});

test('the actual conversation-long lead uses prose density while a short numeric fact conclusion stays brief',()=>{
 const long=previewScene('conversation-long').answers[0];assert.ok(long.content.summary.startsWith('Planlæg en kort rundtur'));assert.ok(long.content.summary.length>100&&long.content.summary.length<160);
 const view=document.body.appendChild(document.createElement('pv-fact-card'));view.data={state:'ready',contextTitle:long.title,content:long.content};assert.equal(view.dataset.conclusionDensity,'prose');
 const answer=widget();answer.update({connected:true},long);assert.equal(answer.dataset.conclusionDensity,'prose');
 view.data={state:'ready',content:visualExamples['fact-card'].content};assert.equal(view.dataset.conclusionDensity,'brief');
});

test('shared viewport density follows visible content rather than example IDs or source payload size',()=>{
 for(const stage of ['conversation-complete','answer-fact-card-ready','answer-steps-ready']){const scene=previewScene(stage),answer=scene.answers[0],view=widget();view.update(scene,answer);assert.equal(view.dataset.answerExtent,'short',stage);if(stage==='conversation-complete'){assert.equal(view.querySelector('.open-weather-answer').hidden,false);assert.equal(view.querySelector('.answer-actions').hidden,false);}}
 const scene=previewScene('conversation-long'),answer=scene.answers[0],view=widget();view.update(scene,answer);assert.equal(view.dataset.answerExtent,'long');const content=structuredClone(visualExamples['fact-card'].content);content.sources[0].scope='A'.repeat(240);view.update({connected:true},{...answer,id:'different-id',title:'Kort faktasvar',content});assert.equal(view.dataset.answerExtent,'short');
});

test('weather example disclosure lives in Kilder while current facts and the primary action remain visible',()=>{
 const scene=previewScene('conversation-complete'),answer=scene.answers[0],view=widget();view.update(scene,answer);const visual=view.visualNode;
 assert.equal(visual.weatherCaption,undefined);assert.equal(visual.sources.children[0].textContent,'Kilder');assert.equal(visual.sourceList.children[0].children[0].textContent,'Forhåndsvisning');assert.match(visual.sourceList.children[0].children[1].textContent,/Opdigtet vejrforløb.*Ikke en aktuel vejrudsigt/);assert.deepEqual(answer.content.facts.map(fact=>fact.id),['window','temperature','rain']);assert.equal(visual.body.hidden,false);assert.equal(view.querySelector('.open-weather-answer').hidden,false);assert.equal(view.querySelector('.open-weather-answer').inert,false);assert.ok(visual.list.children.every(row=>row.hidden!==true));
});


test('opening retained visual sources measures the body before native expansion and keeps current content',()=>{
 const view=widget(),scene=previewScene('conversation-complete'),answer=scene.answers[0];view.update(scene,answer);
 const visual=view.visualNode,sources=visual.sources,summary=quiet(sources.children[0]),body=view.querySelector('.answer-scroll'),values=new Map(),row=visual.list.children[0],button=view.querySelector('.open-weather-answer');
 view.style.setProperty=(key,value)=>values.set(key,value);view.style.removeProperty=key=>values.delete(key);
 body.getBoundingClientRect=()=>({height:410});
 let scrolls=0;view.scrollIntoView=body.scrollIntoView=summary.scrollIntoView=()=>scrolls++;
 summary.click();assert.equal(values.get('--pv-answer-retained-body-height'),'410px');
 sources.open=true;sources.dispatchEvent(new Event('toggle'));view.update(scene,{...answer});
 assert.equal(view.visualNode,visual);assert.equal(visual.list.children[0],row);assert.equal(view.querySelector('.open-weather-answer'),button);assert.equal(sources.open,true);assert.equal(values.get('--pv-answer-retained-body-height'),'410px');assert.equal(scrolls,0);
 // A click on the already-open disclosure must not capture its expanded height.
 body.getBoundingClientRect=()=>({height:999});summary.click();assert.equal(values.get('--pv-answer-retained-body-height'),'410px');
 sources.open=false;sources.dispatchEvent(new Event('toggle'));assert.equal(values.has('--pv-answer-retained-body-height'),false);
 body.getBoundingClientRect=()=>({height:415});summary.click();assert.equal(values.get('--pv-answer-retained-body-height'),'415px');
 view.update(scene,{...answer,id:'a-new-answer'});assert.equal(values.has('--pv-answer-retained-body-height'),false);
});

test('typed and visual source disclosures share flow capture and a detached old toggle cannot clear the current footprint',()=>{
 const view=widget(),values=new Map();view.style.setProperty=(key,value)=>values.set(key,value);view.style.removeProperty=key=>values.delete(key);view.querySelector('.answer-scroll').getBoundingClientRect=()=>({height:380});
 const typed=document.createElement('details'),typedSummary=quiet(document.createElement('summary'));typed.append(typedSummary);view.bindSourceDisclosure(typed);typedSummary.click();typed.open=true;typed.dispatchEvent(new Event('toggle'));assert.equal(values.get('--pv-answer-retained-body-height'),'380px');
 const scene=previewScene('conversation-complete');view.update(scene,scene.answers[0]);const visual=view.visualNode.sources;view.querySelector('.answer-scroll').getBoundingClientRect=()=>({height:410});quiet(visual.children[0]).click();visual.open=true;typed.open=false;typed.dispatchEvent(new Event('toggle'));
 assert.equal(values.get('--pv-answer-retained-body-height'),'410px');visual.open=false;visual.dispatchEvent(new Event('toggle'));assert.equal(values.size,0);
});


test('explicit source disclosure releases a real pointer geometry hold before native open and close',async()=>{
 const {SceneMotion}=await import('../../../ui/motion.js');
 const view=widget(),scene=previewScene('conversation-complete');view.update(scene,scene.answers[0]);const sources=view.visualNode.sources,summary=quiet(sources.children[0]),properties=new Map();
 Object.defineProperty(view,'offsetHeight',{configurable:true,value:656});view.getClientRects=()=>[{}];view.getBoundingClientRect=()=>({height:656,x:0,y:0});
 Object.defineProperty(view,'style',{configurable:true,value:{getPropertyValue:key=>properties.get(key)?.value||'',getPropertyPriority:key=>properties.get(key)?.priority||'',setProperty:(key,value,priority='')=>properties.set(key,{value,priority}),removeProperty:key=>properties.delete(key)}});
 view.querySelector('.answer-scroll').getBoundingClientRect=()=>({height:410});
 const host={dataset:{},isConnected:true,querySelectorAll:()=>[view]};host.motion=new SceneMotion(host);view.closest=selector=>selector==='pv-widget-host'?host:null;
 for(const open of [false,true]){sources.open=open;host.motion.holdGeometry();assert.equal(properties.get('max-height').value,'656px');assert.equal(properties.get('max-height').priority,'important');assert.equal(host.motion.geometry.size,1);
  summary.click();assert.equal(sources.open,open,'native details remains the activation owner');assert.equal(host.motion.geometry.size,0);for(const key of ['height','min-height','max-height'])assert.equal(properties.has(key),false,key);
 }
 assert.equal(properties.get('--pv-answer-retained-body-height').value,'410px');
});

test('every catalogue answer specimen renders through its retained canonical family',async()=>{
 const {productLibrary}=await import('../../../library-catalog.js');let count=0;
 for(const family of productLibrary.filter(item=>item.id.startsWith('answer-'))){
  for(const sample of family.states){
   const scene=previewScene(sample.stage),answer=scene.answers.find(item=>item.id===scene.focus),view=widget();
   assert.ok(answer,sample.id);view.update(scene,answer);count++;
   assert.equal(view.dataset.answerFamily,answer.kind,sample.id);
   assert.equal(view.querySelector('.answer-scroll').dataset.responseZone,'body');
   assert.equal(view.querySelector('.answer-actions').dataset.responseZone,'actions');
   assert.equal(view.querySelector('.sources').dataset.responseZone,'metadata');
   assert.equal(view.querySelector('.retry-answer').hidden,answer.status!=='error',sample.id);
   const visual=view.visualNode;view.update(scene,answer);assert.equal(view.visualNode,visual,sample.id);
   assert.equal(view.querySelector('.dismiss').hidden,true,sample.id);
  }
 }
 assert.equal(count,88);
});


// New with the React card: an identical answer changes nothing on the page, whichever branch draws it.
test('an identical render writes nothing to the DOM: card, Svar column and source dialog',async()=>{
 const records=[],observer=new MutationObserver(list=>records.push(...list));
 const settle=()=>{records.push(...observer.takeRecords());return records.length;};
 const scenes=[['conversation-complete'],['answer-choices-ready'],['answer-steps-ready'],['conversation-long']];
 for(const [stage] of scenes){
  const scene=previewScene(stage),answer=scene.answers.find(item=>item.id===scene.focus)||scene.answers[0],view=widget();
  view.update(scene,answer);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  for(let i=0;i<3;i++)view.update(structuredClone(scene),structuredClone(answer));
  assert.equal(settle(),0,stage);observer.disconnect();records.length=0;
 }
 const {SvarTodayView}=await import('./SvarToday');
 const root=document.body.appendChild(document.createElement('aside'));const column=new SvarTodayView(root,()=>{});
 const row=(id,current=false)=>({id,title:id,kind:'fact-card',kindLabel:'Fakta',time:'11.32',today:true,current,
  domain:'answer',icon:'chat-circle',observedAt:1});
 column.render([row('b'),row('a',true)],true);column.render([row('c'),row('b'),row('a',true)],true);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
 for(let i=0;i<3;i++)column.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(settle(),0,'Svar column');observer.disconnect();records.length=0;
 const {LiveAnswerView}=await import('./LiveAnswerView');
 const host=Object.assign(document.body.appendChild(document.createElement('div')),{state:{answers:[]},render(){}});
 const live=new LiveAnswerView(host);live.invalidate(false);live.invalidate(true,true);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
 for(let i=0;i<3;i++){live.invalidate(false);live.invalidate(true,true);}
 assert.equal(settle(),0,'source dialog');observer.disconnect();
});
