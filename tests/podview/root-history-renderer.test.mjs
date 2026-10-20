import test from 'node:test';
import assert from 'node:assert/strict';
import {visualExamples} from '../../podvoice/gatekeeper/static/podview/visual-examples.js';
import {initialScene,sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.localName=tag;this.children=[];this.dataset={};this.style={};this.attrs=new Map();this.hidden=false;this.disabled=false;this.textContent='';this.className='';this.isConnected=true;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(n=>n!==name).join(' ');},contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>on?this.classList.add(name):this.classList.remove(name)};}
 append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
 insertBefore(n,before){n.remove();n.parentNode=this;const i=this.children.indexOf(before);if(i<0)this.children.push(n);else this.children.splice(i,0,n);}
 remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
 replaceWith(n){const p=this.parentNode,i=p.children.indexOf(this);this.remove();n.parentNode=p;p.children.splice(i,0,n);}
 removeAttribute(k){this.attrs.delete(k);if(k==='src')this._src=undefined;}
 set src(value){this.srcWrites??=[];this.srcWrites.push(value);this._src=value;}get src(){return this._src;}
 prepend(n){this.insertBefore(n,this.children[0]||null);n.connectedCallback?.();}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return k==='src'?this.src:this.attrs.get(k)??null;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){const matches=n=>selector.startsWith('#')?n.id===selector.slice(1):selector.startsWith('.')?n.classList.contains(selector.slice(1)):selector.startsWith('[')?selector==='[data-collection]'?'collection' in n.dataset:selector==='[data-refresh-label]'?'refreshLabel' in n.dataset:false:n.tagName===selector.toUpperCase();return this.children.flatMap(n=>[...(matches(n)?[n]:[]),...n.querySelectorAll(selector)]);}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
const registry=new Map();globalThis.HTMLElement=Node;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};globalThis.document={createElement(tag){const el=new(registry.get(tag)||Node)(tag);el.localName=tag;el.tagName=tag.toUpperCase();return el;}};globalThis.CustomEvent=class extends Event{constructor(type,options){super(type,options);this.detail=options.detail;}};
await import('../../podvoice/gatekeeper/static/podview/answer-widget.js');
await import('../../podvoice/gatekeeper/static/podview/ui/library/visual-components.js');
const receiptId='a'.repeat(32);
function imageContent(){const content=structuredClone(visualExamples['sourced-image'].content);content.image.url='https://images.unsplash.com/photo-123';return content;}
test('historical first preview and expanded renderer never assign remote src, preserve caption, ignore late load',()=>{
 for(const preview of [true,false]){const view=document.createElement('pv-sourced-image'),content=imageContent();view.data={historical:true,hideSummary:preview,state:'offline',content};assert.deepEqual(view.image.srcWrites||[],[]);assert.equal(view.image.hidden,true);assert.equal(view.imageError.hidden,false);assert.equal(view.captionText.textContent,content.image.caption);assert.equal(view.sources.hidden,true);assert.equal(view.dataset.state,'ready');view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,true);}
});
test('live image still loads; conversion to history removes its URL without reassigning it',()=>{const view=document.createElement('pv-sourced-image'),content=imageContent();view.data={content,state:'ready'};assert.deepEqual(view.image.srcWrites,[content.image.url]);view.data={content,historical:true};assert.equal(view.image.getAttribute('src'),undefined);assert.deepEqual(view.image.srcWrites,[content.image.url]);assert.equal(view.imageError.hidden,false);});
test('historical bundled illustration remains admitted and source dispatch is inert',()=>{const view=document.createElement('pv-simple-diagram'),content=structuredClone(visualExamples['simple-diagram'].content);content.sources=[{id:'source',kind:'owner_receipt',receiptId,label:'AI-forklaring',scope:'conversation_answer'}];for(const row of content.nodes)row.sourceId='source';content.illustration.sourceId='source';view.data={content,historical:true,ownerReceiptIds:[receiptId],allowConversation:true};assert.equal(view.image.src,'assets/bicycle-drivetrain-illustration.webp');const source=view.sourceList.children[0].children[0];let events=0;source.addEventListener('owner-source',()=>events++);source.dispatchEvent(new Event('click'));assert.equal(events,0);assert.equal(source.disabled,true);assert.equal(view.sources.hidden,true);});
function widget(){const view=document.createElement('pv-answer'),nodes=new Map();view.querySelector=selector=>{if(!nodes.has(selector)){const n=new Node();n.querySelector=()=>new Node();nodes.set(selector,n);}return nodes.get(selector);};view.connectedCallback();return view;}
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
test('historical remote image is described as deliberately retained text, not a network failure',()=>{
 const view=document.createElement('pv-sourced-image'),content=imageContent();
 view.data={historical:true,content};assert.match(view.imageError.textContent,/hentes ikke igen i historikken/);
 view.data={historical:false,content};view.image.dispatchEvent(new Event('error'));
 assert.match(view.imageError.textContent,/kunne ikke indlæses/);
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
test('diagram empty state and invalid first read keep their explanation outside hidden content',()=>{
 const view=document.createElement('pv-simple-diagram'),content=structuredClone(visualExamples['simple-diagram'].content);
 view.data={state:'ready',content};assert.equal(view.note.parentNode,view.caption);
 view.data={state:'empty'};assert.equal(view.body.hidden,true);assert.equal(view.note.hidden,false);assert.equal(view.note.parentNode,view);
 const invalid=document.createElement('pv-fact-card');invalid.data={state:'ready',content:{}};assert.equal(invalid.dataset.state,'error');assert.equal(invalid.body.hidden,true);assert.equal(invalid.note.hidden,false);assert.match(invalid.note.textContent,/kunne ikke læses/);
});
