// The <pv-answer> card tests moved to podview/src/screens/answers/answer-card.test.js (Vitest) when the card moved to
// React; the tests below exercise the shared visual kit components (podview/ui/library), which stay plain JS. The
// kit components (components.js) were loaded through answer-widget.js before; they are imported directly now.
import {previewScene} from '../../podview/preview-scenes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {visualExamples} from '../../podview/visual-examples.js';
import {initialScene,sceneTransition} from '../../podview/scene-model.js';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.localName=tag;this.children=[];this.dataset={};this.style={};this.attrs=new Map();this.hidden=false;this.disabled=false;this.textContent='';this.className='';this.isConnected=true;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(n=>n!==name).join(' ');},contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>on?this.classList.add(name):this.classList.remove(name)};}
 get childNodes(){return this.children;}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
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
await import('../../podview/ui/library/components.js');
await import('../../podview/ui/library/visual-components.js');
const receiptId='a'.repeat(32);
function imageContent(){const content=structuredClone(visualExamples['sourced-image'].content);content.image.url='https://images.unsplash.com/photo-123';return content;}
test('historical first preview and expanded renderer never assign remote src, preserve caption, ignore late load',()=>{
 for(const preview of [true,false]){const view=document.createElement('pv-sourced-image'),content=imageContent();view.data={historical:true,hideSummary:preview,state:'offline',content};assert.deepEqual(view.image.srcWrites||[],[]);assert.equal(view.image.hidden,true);assert.equal(view.imageError.hidden,false);assert.equal(view.captionText.textContent,content.image.caption);assert.equal(view.sources.hidden,true);assert.equal(view.dataset.state,'ready');view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,true);}
});
test('live image still loads; conversion to history removes its URL without reassigning it',()=>{const view=document.createElement('pv-sourced-image'),content=imageContent();view.data={content,state:'ready'};assert.deepEqual(view.image.srcWrites,[content.image.url]);view.data={content,historical:true};assert.equal(view.image.getAttribute('src'),undefined);assert.deepEqual(view.image.srcWrites,[content.image.url]);assert.equal(view.imageError.hidden,false);});
test('historical bundled illustration remains admitted and source dispatch is inert',()=>{const view=document.createElement('pv-simple-diagram'),content=structuredClone(visualExamples['simple-diagram'].content);content.sources=[{id:'source',kind:'owner_receipt',receiptId,label:'AI-forklaring',scope:'conversation_answer'}];for(const row of content.nodes)row.sourceId='source';content.illustration.sourceId='source';view.data={content,historical:true,ownerReceiptIds:[receiptId],allowConversation:true};assert.equal(view.image.src,'assets/bicycle-drivetrain-illustration.webp');const source=view.sourceList.children[0].children[0];let events=0;source.addEventListener('owner-source',()=>events++);source.dispatchEvent(new Event('click'));assert.equal(events,0);assert.equal(source.disabled,true);assert.equal(view.sources.hidden,true);});
test('historical remote image is described as deliberately retained text, not a network failure',()=>{
 const view=document.createElement('pv-sourced-image'),content=imageContent();
 view.data={historical:true,content};assert.match(view.imageError.textContent,/hentes ikke igen i historikken/);
 view.data={historical:false,content};view.image.dispatchEvent(new Event('error'));
 assert.match(view.imageError.textContent,/kunne ikke indlæses/);
});

test('diagram empty state and invalid first read keep their explanation outside hidden content',()=>{
 const view=document.createElement('pv-simple-diagram'),content=structuredClone(visualExamples['simple-diagram'].content);
 view.data={state:'ready',content};assert.equal(view.note.parentNode,view.caption);
 view.data={state:'empty'};assert.equal(view.body.hidden,true);assert.equal(view.note.hidden,false);assert.equal(view.note.parentNode,view);
 const invalid=document.createElement('pv-fact-card');invalid.data={state:'ready',content:{}};assert.equal(invalid.dataset.state,'error');assert.equal(invalid.body.hidden,true);assert.equal(invalid.note.hidden,false);assert.match(invalid.note.textContent,/kunne ikke læses/);
});

test('fact presentation keeps one primary role and adapts long numeric values without changing source facts or row identity',()=>{
 const view=document.createElement('pv-fact-card'),content=structuredClone(visualExamples['fact-card'].content);
 content.facts[0].value='15°';view.data={content,state:'ready'};const primary=view.list.children[0];
 assert.equal(primary.dataset.answerRole,'primary');assert.equal(primary.dataset.valueKind,'numeric');assert.equal(primary.dataset.valueDensity,'short');
 assert.ok(view.list.children.slice(1).every(row=>row.dataset.answerRole==='supporting'));assert.equal(primary.getAttribute('data-kit'),'listrow');
 const long='123456789012345678901234567890 kWh',changed=structuredClone(content);changed.facts[0].value=long;view.data={content:changed,state:'ready'};
 assert.equal(view.list.children[0],primary);assert.equal(primary.dataset.valueDensity,'long');assert.equal(primary.children[1].textContent,long);assert.equal(changed.facts[0].value,long);assert.equal(content.facts[0].value,'15°');
 view.data={state:'pending'};assert.equal(view.list.children[0],primary);assert.equal(primary.children[1].textContent,long);assert.equal(view.note.hidden,true);
 view.data={state:'interrupted'};assert.equal(view.body.hidden,false);assert.equal(view.list.children[0],primary);assert.equal(view.note.textContent,'Svaret blev afbrudt.');
});

test('step indicator and progress follow the actual current instruction and disappear for read-only source steps',()=>{
 const guide=document.createElement('pv-step-guide'),steps=['Find papir.','Fold papiret.'];
 guide.data={steps,index:0,connected:true,state:'ready'};
 assert.equal(guide.position.textContent,'01');assert.equal(guide.progress.value,1);assert.equal(guide.progress.max,2);assert.equal(guide.titleNode.textContent,steps[0]);
 const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});try{guide.data={steps,index:1,connected:true,state:'ready'};}finally{globalThis.matchMedia=previous;}
 assert.equal(guide.position.textContent,'02');assert.equal(guide.progress.value,2);assert.equal(guide.titleNode.textContent,steps[1]);assert.equal(guide.next.hidden,true);assert.equal(guide.finish.hidden,false);
 guide.data={readOnly:true,stepItems:[{id:'actual-step',text:'Anvisning fra kilden.'}],connected:false,state:'ready'};
 assert.equal(guide.position.hidden,true);assert.equal(guide.progress.hidden,true);assert.equal(guide.actions.hidden,true);assert.equal(guide.outline.children[0].textContent,'Anvisning fra kilden.');
});

test('long conclusions use prose density and duplicate title text is suppressed without mutating source content',()=>{
 const view=document.createElement('pv-fact-card'),content=structuredClone(visualExamples['fact-card'].content),summary='Et roligt forløb kan deles op i flere små bidder. '.repeat(5).trim();content.summary=summary;content.facts[0].value='En kort sløjfe';
 view.data={state:'ready',contextTitle:'Hvad kan vi gøre i eftermiddag?',content};
 assert.equal(view.dataset.conclusionDensity,'prose');assert.equal(view.summary.textContent,summary);assert.equal(view.summary.hidden,false);assert.equal(view.list.children[0].dataset.valueKind,'text');
 const row=view.list.children[0];view.data={state:'ready',contextTitle:summary,content};assert.equal(view.summary.hidden,true);assert.equal(view.list.children[0],row);assert.equal(content.summary,summary);assert.equal(content.facts[0].value,'En kort sløjfe');
 view.data={state:'interrupted'};assert.equal(view.summary.textContent,summary);assert.equal(view.list.children[0],row);assert.equal(view.note.textContent,'Svaret blev afbrudt.');
});


test('visual sources close with Escape without scrolling the retained answer to its trigger',()=>{
 const view=document.createElement('pv-fact-card');view.data={state:'ready',content:visualExamples['fact-card'].content};const sources=view.sources,summary=sources.children[0];
 let focusOptions;summary.focus=options=>focusOptions=options;sources.open=true;const escape=new Event('keydown');escape.key='Escape';sources.dispatchEvent(escape);
 assert.equal(sources.open,false);assert.deepEqual(focusOptions,{preventScroll:true});
});


test('late image events cannot replace pending content or resurrect a failed current image',()=>{
 const view=document.createElement('pv-sourced-image'),content=imageContent();view.data={state:'ready',content};
 view.image.complete=true;view.image.naturalWidth=600;view.image.dispatchEvent(new Event('load'));
 assert.equal(view.image.hidden,false);assert.equal(view.imageError.hidden,true);
 const next=structuredClone(content);next.image.url='assets/qa-deliberately-missing-answer-image.webp';
 view.image.complete=false;view.image.naturalWidth=0;view.data={state:'ready',content:next};
 const caption=view.captionText.textContent,sources=view.sourceList.children[0];
 view.image.dispatchEvent(new Event('error'));assert.equal(view.imageError.hidden,true);
 view.image.complete=true;view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,true);assert.equal(view.imageError.hidden,false);
 view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,true);assert.equal(view.imageError.hidden,false);
 assert.equal(view.captionText.textContent,caption);assert.equal(view.sourceList.children[0],sources);
 view.image.naturalWidth=600;view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,false);assert.equal(view.imageError.hidden,true);
 view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,false);assert.equal(view.imageError.hidden,true);
});

test('retained step navigation binds Next to the canonical primary Button and emits only current owner context',()=>{
 const guide=document.createElement('pv-step-guide'),steps=['Find papir.','Fold papiret.','Giv flyet vinger.'],events=[];guide.addEventListener('pv-action',event=>events.push(event.detail));guide.data={steps,index:0,connected:true,state:'ready',context:{sessionId:'session',taskId:'guide-task',revision:1}};const next=guide.next,back=guide.back,finish=guide.finish;assert.equal(next.getAttribute('data-kit'),'button');assert.equal(next.getAttribute('data-kit-variant'),'primary');assert.equal(next.textContent,'Næste trin');assert.equal(back.disabled,true);next.click();assert.deepEqual(events,[{type:'action.requested',session_id:'session',task_id:'guide-task',revision:1,resource_id:null,action_id:'step',option_id:'next',value:undefined}]);
 const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});try{guide.data={steps,index:1,connected:true,state:'ready',context:{sessionId:'session',taskId:'guide-task',revision:2}};assert.equal(guide.next,next);assert.equal(guide.back,back);assert.equal(guide.progress.value,2);assert.equal(guide.titleNode.textContent,steps[1]);assert.equal(next.getAttribute('data-kit-variant'),'primary');back.click();assert.equal(events.at(-1).revision,2);assert.equal(events.at(-1).option_id,'back');guide.data={steps,index:2,connected:true,state:'ready',context:{sessionId:'session',taskId:'guide-task',revision:3}};assert.equal(guide.next,next);assert.equal(next.hidden,true);assert.equal(guide.finish,finish);assert.equal(finish.hidden,false);finish.click();assert.equal(events.at(-1).action_id,'finish');assert.equal(events.at(-1).revision,3);guide.data={steps,index:1,connected:false,state:'ready',context:{sessionId:'session',taskId:'guide-task',revision:4}};const count=events.length;next.click();back.click();assert.equal(events.length,count);guide.data={readOnly:true,stepItems:[{id:'source-step',text:'Bevaret instruktion.'}],connected:false,state:'ready'};assert.equal(guide.actions.hidden,true);assert.equal(guide.outline.children[0].textContent,'Bevaret instruktion.');assert.equal(guide.next,next);}finally{globalThis.matchMedia=previous;}
});

test('completed guide visibly confirms finish, blocks repeated finish and restores retained navigation for readback',()=>{
 const guide=document.createElement('pv-step-guide'),steps=['Find papir.','Fold papiret.'],events=[];
 guide.addEventListener('pv-action',event=>events.push(event.detail));
 guide.data={steps,index:1,connected:true,state:'ready',context:{sessionId:'session',taskId:'finished-guide',revision:1}};
 const meta=guide.meta,finish=guide.finish,next=guide.next,back=guide.back,title=guide.titleNode;
 finish.click();assert.equal(events.length,1);assert.equal(events[0].action_id,'finish');
 guide.data={steps,index:1,connected:true,state:'complete',context:{sessionId:'session',taskId:'finished-guide',revision:2}};
 assert.equal(guide.meta,meta);assert.equal(meta.textContent,'Alle trin er gennemgået');assert.equal(guide.finish,finish);assert.equal(finish.textContent,'Afsluttet');assert.equal(finish.disabled,true);assert.equal(finish.hidden,false);assert.equal(guide.titleNode,title);assert.equal(title.textContent,steps[1]);assert.equal(guide.progress.value,2);
 finish.click();finish.dispatchEvent(new Event('click'));assert.equal(events.length,1);
 back.click();assert.equal(events.length,2);assert.equal(events.at(-1).option_id,'back');assert.equal(events.at(-1).revision,2);
 const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});try{
  guide.data={steps,index:0,connected:true,state:'ready',context:{sessionId:'session',taskId:'finished-guide',revision:3}};
  assert.equal(guide.meta,meta);assert.equal(meta.textContent,'Trin 1 af 2');assert.equal(guide.next,next);assert.equal(next.hidden,false);assert.equal(next.disabled,false);assert.equal(guide.finish,finish);assert.equal(finish.textContent,'Færdig');assert.equal(finish.hidden,true);assert.equal(guide.titleNode,title);assert.equal(title.textContent,steps[0]);next.click();assert.equal(events.at(-1).revision,3);
  guide.data={steps,index:1,connected:true,state:'ready',context:{sessionId:'session',taskId:'finished-guide',revision:4}};
  assert.equal(finish.hidden,false);assert.equal(finish.disabled,false);assert.equal(finish.textContent,'Færdig');
 }finally{globalThis.matchMedia=previous;}
});
