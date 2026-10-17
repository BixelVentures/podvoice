import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVisualContent} from '../../podvoice/gatekeeper/static/podview/visual-content.js';
import {visualExamples} from '../../podvoice/gatekeeper/static/podview/visual-examples.js';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.localName=tag;this.children=[];this.dataset={};this.style={};this.attrs=new Map();this.hidden=false;this.disabled=false;this.textContent='';this.className='';this.isConnected=true;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(n=>n!==name).join(' ');},contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>on?this.classList.add(name):this.classList.remove(name)};}
 append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
 insertBefore(n,before){n.remove();n.parentNode=this;const i=this.children.indexOf(before);if(i<0)this.children.push(n);else this.children.splice(i,0,n);}
 remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
 replaceWith(n){const p=this.parentNode,i=p.children.indexOf(this);this.remove();n.parentNode=p;p.children.splice(i,0,n);}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return k==='src'?this.src:this.attrs.get(k)??null;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){const matches=n=>selector.startsWith('#')?n.id===selector.slice(1):selector.startsWith('.')?n.classList.contains(selector.slice(1)):selector.startsWith('[')?selector==='[data-collection]'?'collection' in n.dataset:selector==='[data-refresh-label]'?'refreshLabel' in n.dataset:false:n.tagName===selector.toUpperCase();return this.children.flatMap(n=>[...(matches(n)?[n]:[]),...n.querySelectorAll(selector)]);}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
const doc={createElement:tag=>new Node(tag)};

const illustration={url:'assets/bicycle-drivetrain-illustration.png',alt:'En illustreret kæde forbinder pedaler og baghjul.',caption:'AI-genereret principskitse, ikke en teknisk tegning.',credit:'PodView · AI-genereret illustration',kind:'illustration',sourceId:'bicycle-art'};
function diagram(){return {...structuredClone(visualExamples['simple-diagram'].content),illustration:{...illustration}};}
test('optional diagram illustration remains source-bound, closed and read-only',()=>{
 const raw=diagram();raw.illustration.html='<script>bad()</script>';raw.illustration.actions=['play'];raw.illustration.style='position:fixed';
 const result=validateVisualContent('simple-diagram',raw);assert.deepEqual(result.illustration,illustration);assert.equal(result.illustration.html,undefined);assert.equal(result.illustration.actions,undefined);assert.equal(result.illustration.style,undefined);
 for(const mutate of [x=>x.url='assets/../secret.png',x=>x.url='data:image/png;base64,aaa',x=>x.url='assets/art.svg',x=>x.sourceId='invented',x=>x.kind='photo',x=>x.alt='',x=>x.caption='x'.repeat(301),x=>x.credit='']){const bad=diagram();mutate(bad.illustration);assert.throws(()=>validateVisualContent('simple-diagram',bad));}
 const plain=structuredClone(visualExamples['simple-diagram'].content);delete plain.illustration;assert.equal(validateVisualContent('simple-diagram',plain).illustration,undefined);
});
test('actual illustrated renderer retains useful art and node identity through pending/error, removes art when next valid answer has none',async()=>{
 const previous={HTMLElement:globalThis.HTMLElement,document:globalThis.document,customElements:globalThis.customElements};const registry=new Map();globalThis.HTMLElement=Node;globalThis.document=doc;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};
 try{await import('../../podvoice/gatekeeper/static/podview/ui/library/visual-components.js');const view=new(registry.get('pv-simple-diagram'))();view.localName='pv-simple-diagram';view.data={state:'ready',content:diagram()};
 const first=view.list.children[0],image=view.image.src;assert.equal(view.figure.hidden,false);assert.equal(image,illustration.url);assert.equal(view.captionText.textContent,illustration.caption);assert.equal(view.credit.parentNode,view.caption);assert.equal(view.credit.textContent,'Illustration · '+illustration.credit);
 view.data={state:'pending'};assert.equal(view.list.children[0],first);assert.equal(view.image.src,image);assert.equal(view.figure.hidden,false);assert.equal(view.getAttribute('aria-busy'),'true');
 view.data={state:'error'};assert.equal(view.list.children[0],first);assert.equal(view.image.src,image);assert.equal(view.body.hidden,false);assert.match(view.note.textContent,/kunne ikke/);
 const plain=structuredClone(visualExamples['simple-diagram'].content);delete plain.illustration;view.data={state:'ready',content:plain};assert.equal(view.figure.hidden,true);assert.equal(view.dataset.illustrated,'false');assert.equal(view.list.children[0],first);assert.equal(view.note.hidden,true);
 const Image=registry.get('pv-sourced-image'),sourced=new Image();sourced.localName='pv-sourced-image';const picture=structuredClone(visualExamples['sourced-image'].content);sourced.data={state:'ready',content:picture};assert.equal(sourced.dataset.imageKind,'illustration');picture.image.kind='photo';sourced.data={state:'ready',content:picture};assert.equal(sourced.dataset.imageKind,'photo');
 }finally{Object.assign(globalThis,previous);}
});

test('actual timeline consolidates only uniformly planned metadata; mixed and forecast semantics remain explicit',async()=>{
 const previous={HTMLElement:globalThis.HTMLElement,document:globalThis.document,customElements:globalThis.customElements};const registry=new Map();globalThis.HTMLElement=Node;globalThis.document=doc;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};
 try{await import('../../podvoice/gatekeeper/static/podview/ui/library/visual-components.js?timeline-qa');const view=new(registry.get('pv-answer-timeline'))();view.localName='pv-answer-timeline';const content=structuredClone(visualExamples['answer-timeline'].content);view.data={state:'ready',content};assert.equal(view.timelineContext.textContent,'Planlagt forløb');assert.equal(view.timelineContext.hidden,false);assert.equal(view.list.children[0].children[0].textContent,'07.00');
 content.events[1].status='observed';view.data={state:'ready',content};assert.equal(view.timelineContext.hidden,true);assert.match(view.list.children[0].children[0].textContent,/Planlagt/);assert.match(view.list.children[1].children[0].textContent,/Registreret/);
 view.data={state:'ready',content,forecast:true};assert.equal(view.timelineContext.hidden,true);for(const row of view.list.children)assert.match(row.children[0].textContent,/Prognose/);
 }finally{Object.assign(globalThis,previous);}
});
test('actual native chart uses correct Danish singular in output and accessible measurement',async()=>{
 const previous={HTMLElement:globalThis.HTMLElement,document:globalThis.document,customElements:globalThis.customElements};const registry=new Map();class ComponentNode extends Node{get childNodes(){return this.children;}prepend(n){this.insertBefore(n,this.children[0]||null);}contains(n){return n===this||this.children.some(child=>child===n);}}globalThis.HTMLElement=ComponentNode;globalThis.document=doc;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};
 try{await import('../../podvoice/gatekeeper/static/podview/ui/library/components.js');const view=new(registry.get('pv-data-chart'))();view.localName='pv-data-chart';view.data={unit:'typer',unitSingular:'type',items:[{id:'one',label:'Fold papir',value:1},{id:'two',label:'Tegn sammen',value:2}]};assert.equal(view.items.children[0].children[2].textContent,'1 type');assert.equal(view.items.children[1].children[2].textContent,'2 typer');assert.equal(view.items.children[0].children[1].getAttribute('aria-label'),'Fold papir: 1 type');assert.equal(view.items.children[0].children[1].max,2);
 }finally{Object.assign(globalThis,previous);}
});
