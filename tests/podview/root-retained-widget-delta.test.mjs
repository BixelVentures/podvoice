import test from 'node:test';
import assert from 'node:assert/strict';
import {updateResourceTile} from '../../podvoice/gatekeeper/static/podview/ui/resource-tile.js';

// Deliberately counts even a redundant property/attribute write. This is a
// deterministic DOM adapter test, not a browser MutationObserver or device QA.
let mutations=[];
const record=(node,key,value)=>mutations.push({node,key,value});
class RetainedNode extends EventTarget {
 constructor(tag='div'){
  super();this.tagName=tag.toUpperCase();this.localName=tag;this.children=[];this.attrs=new Map();this.values={textContent:'',className:'',hidden:false,inert:false,disabled:false,value:'',nodeValue:'',src:''};this.isConnected=true;
  this.dataset=new Proxy({}, {set:(target,key,value)=>{record(this,`data-${key}`,value);target[key]=String(value);return true;},deleteProperty:(target,key)=>{record(this,`delete-data-${key}`,undefined);delete target[key];return true;}});
  const styles={};this.style={getPropertyValue:key=>styles[key]||'',setProperty:(key,value)=>{record(this,`style:${key}`,value);styles[key]=String(value);}};
  Object.defineProperty(this.style,'display',{get:()=>styles.display||'',set:value=>{record(this,'style:display',value);styles.display=value;}});
  for(const key of Object.keys(this.values))Object.defineProperty(this,key,{get:()=>this.values[key],set:value=>{record(this,key,value);this.values[key]=value;if(key==='src')this.attrs.set('src',String(value));if(key==='textContent'){for(const n of this.children)n.parentNode=null;this.children=[];}}});
  this.classList={contains:name=>this.className.split(' ').includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},toggle:(name,on)=>{const names=this.className.split(' ').filter(Boolean);this.className=(on?[...new Set([...names,name])]:names.filter(x=>x!==name)).join(' ');}};
 }
 get childNodes(){return this.children;}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);record(this,'append',node);}}
 prepend(node){this.insertBefore(node,this.children[0]||null);}
 remove(){if(this.parentNode){const p=this.parentNode;p.children.splice(p.children.indexOf(this),1);this.parentNode=null;record(p,'remove',this);}}
 insertBefore(node,before){node.remove();node.parentNode=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);record(this,'insert',node);}
 replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];record(this,'replaceChildren',nodes);this.append(...nodes);}
 replaceWith(node){const parent=this.parentNode,index=parent.children.indexOf(this);this.remove();node.parentNode=parent;parent.children.splice(index,0,node);record(parent,'replaceWith',node);}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 setAttribute(key,value){record(this,`attr:${key}`,value);this.attrs.set(key,String(value));}
 getAttribute(key){return this.attrs.get(key)??null;}
 removeAttribute(key){record(this,`remove:${key}`,null);this.attrs.delete(key);}
 matches(selector){return selector==='[hidden]'?this.hidden:selector.startsWith('.')?this.classList.contains(selector.slice(1)):selector==='button:not(:disabled):not([hidden])'?this.tagName==='BUTTON'&&!this.disabled&&!this.hidden:this.tagName===selector.toUpperCase();}
 closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
 querySelectorAll(selector){if(selector.includes(' ')){const [head,...tail]=selector.split(' ');return this.querySelectorAll(head).flatMap(node=>node.querySelectorAll(tail.join(' ')));}return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 focus(){document.activeElement=this;}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
const documentFixture={baseURI:'https://podview.test/view/',activeElement:null,createElement:tag=>new RetainedNode(tag),createTextNode:value=>{const node=new RetainedNode('#text');node.nodeValue=value;return node;}};
const clean=()=>{mutations=[];};
const clone=value=>JSON.parse(JSON.stringify(value));

test('resource tile repeats write nothing; one changed detail touches only its text and accessible label',()=>{
 const tile=new RetainedNode('button'),visual=new RetainedNode('span'),icon=new RetainedNode('img'),value=new RetainedNode('span'),dial=new RetainedNode('svg'),title=new RetainedNode('strong'),detail=new RetainedNode('small');visual.className='resource-visual';value.className='resource-value';visual.append(dial,icon,value);tile.append(visual,title,detail);
 const input={target:'vacuum.qrevo',kind:'vacuum',status:'docked',title:'Robotstøvsuger',detail:'Ved basen',value:''};updateResourceTile(tile,input);clean();for(let i=0;i<20;i++)updateResourceTile(tile,{...input,observedAt:i});assert.equal(mutations.length,0);assert.strictEqual(tile.querySelector('strong'),title);
 updateResourceTile(tile,{...input,detail:'Rengør køkkenet'});assert.deepEqual(mutations.map(x=>x.key),['textContent','attr:aria-label']);assert.strictEqual(mutations[0].node,detail);assert.strictEqual(tile.querySelector('.resource-visual img'),icon);
 clean();updateResourceTile(tile,{...input,target:'vacuum.new',status:'paused'});assert.ok(mutations.some(x=>x.key==='data-target'&&x.value==='vacuum.new'));assert.equal(tile.dataset.status,'paused');
 clean();updateResourceTile(tile,{target:'timer.native',kind:'timer',status:'running',title:'Timer',detail:'Tæller ned',value:'0:59',duration:60,remaining:59});assert.equal(tile.style.getPropertyValue('--remaining'),String(59/60*100));clean();updateResourceTile(tile,{target:'timer.native',kind:'timer',status:'running',title:'Timer',detail:'Tæller ned',value:'0:59',duration:60,remaining:59});assert.equal(mutations.length,0);
 const inactive={target:undefined,kind:'vacuum',status:'unknown',title:'Robotstøvsuger',detail:'',hidden:true,disabled:true,ariaLabel:'Robotstøvsuger'};updateResourceTile(tile,inactive);assert.equal(tile.dataset.target,undefined);assert.equal(tile.hidden,true);assert.equal(tile.disabled,true);assert.equal(tile.getAttribute('aria-label'),'Robotstøvsuger');clean();for(let i=0;i<20;i++)updateResourceTile(tile,{...inactive});assert.equal(mutations.length,0);
});

test('canonical library keeps nodes/focus/disclosure on identical observations and updates authority without DOM churn',async()=>{
 const previous={HTMLElement:globalThis.HTMLElement,document:globalThis.document,customElements:globalThis.customElements,CustomEvent:globalThis.CustomEvent};const registry=new Map();globalThis.HTMLElement=RetainedNode;globalThis.document=documentFixture;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};globalThis.CustomEvent=class extends Event{constructor(type,options){super(type,options);this.detail=options.detail;}};
 try{
  await import('../../podvoice/gatekeeper/static/podview/ui/library/components.js');
  const create=tag=>{const C=registry.get(tag),node=new C();node.localName=tag;return node;};
  const robot=create('pv-vacuum-widget');const first={connected:true,state:'ready',title:'Roborock',detail:'Ved basen',text:'72 %',context:{sessionId:'s1',taskId:'t1',revision:1,resourceId:'vacuum.qrevo'},actions:[{id:'resume',optionId:'option-old',label:'Fortsæt'}]};robot.data=clone(first);const action=robot.actions.children[0],icon=robot.visual.children[0];action.focus();robot.scrollTop=37;clean();
  for(let i=0;i<20;i++)robot.data={...clone(first),observedAt:i,context:{...first.context,revision:10+i}};
  assert.equal(mutations.length,0);assert.strictEqual(robot.actions.children[0],action);assert.strictEqual(robot.visual.children[0],icon);assert.strictEqual(document.activeElement,action);assert.equal(robot.scrollTop,37);
  let dispatched;robot.addEventListener('pv-action',event=>dispatched=event.detail);action.click();assert.equal(dispatched.revision,29);assert.equal(dispatched.option_id,'option-old');
  clean();robot.data={...clone(first),detail:'Rengør køkkenet'};assert.equal(mutations.length,1);assert.strictEqual(mutations[0].node,robot.meta);assert.equal(mutations[0].key,'textContent');assert.strictEqual(document.activeElement,action);
  clean();robot.data={...clone(first),actions:[{id:'pause',optionId:'option-current',label:'Pause'}],context:{...first.context,revision:30}};assert.strictEqual(robot.actions.children[0],action);action.click();assert.equal(dispatched.action_id,'pause');assert.equal(dispatched.option_id,'option-current');assert.equal(dispatched.revision,30);
  robot.data={...robot.data,connected:false,context:{...first.context,revision:31}};assert.equal(action.disabled,true);assert.equal(action.getAttribute('aria-disabled'),'true');dispatched=null;action.click();assert.equal(dispatched,null);
  const button=create('pv-action-button');button.data={connected:true,label:'Fortsæt',action:'old-action',optionId:'old-option',context:{revision:1}};clean();button.data={connected:true,label:'Fortsæt',action:'current-action',optionId:'current-option',context:{revision:2}};assert.equal(mutations.length,0);let nextAction;button.addEventListener('pv-action',event=>nextAction=event.detail);button.action.click();assert.equal(nextAction.action_id,'current-action');assert.equal(nextAction.option_id,'current-option');assert.equal(nextAction.revision,2);
  const frame=create('pv-widget-frame');frame.data={text:'Forklaring',context:{revision:1}};frame.setOpen(false);frame.toggle.focus();clean();frame.data={text:'Forklaring',context:{revision:2},retrievedAt:99};assert.equal(mutations.length,0);assert.equal(frame.open,false);assert.equal(frame.content.inert,true);assert.strictEqual(document.activeElement,frame.toggle);
  const volume=create('pv-volume-control');volume.data={connected:true,value:35};volume.range.focus();volume.range.value='40';volume.data={connected:true,value:30};assert.equal(volume.range.value,'40');document.activeElement=null;volume.data={connected:true,value:30};assert.equal(volume.range.value,'30');clean();volume.data={connected:true,value:30,observedAt:99};assert.equal(mutations.length,0);
  const sources=create('pv-source-list');sources.data={connected:true,items:[{id:'source',kind:'owner_receipt',receiptId:'old-receipt',label:'Grundlag',scope:'tool_result'}]};const source=sources.items.children[0].children[0];sources.data={...sources.data,items:[{...sources.data.items[0],receiptId:'new-receipt'}]};let receipt;source.addEventListener('owner-source',event=>receipt=event.detail.receiptId);source.click();assert.equal(receipt,'new-receipt');sources.data={...sources.data,items:[]};assert.equal(sources.items.children[0].hidden,true);assert.equal(sources.items.children[0].inert,true);
 }finally{Object.assign(globalThis,previous);}
});

test('all four visual families preserve unchanged DOM and disclosure while source admission stays current',async()=>{
 const previous={HTMLElement:globalThis.HTMLElement,document:globalThis.document,customElements:globalThis.customElements,CustomEvent:globalThis.CustomEvent};const registry=new Map();globalThis.HTMLElement=RetainedNode;globalThis.document=documentFixture;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};globalThis.CustomEvent=class extends Event{constructor(type,options){super(type,options);this.detail=options.detail;}};
 try{
  await import('../../podvoice/gatekeeper/static/podview/ui/library/visual-components.js?retained-delta');const {visualExamples}=await import('../../podvoice/gatekeeper/static/podview/visual-examples.js');
  for(const family of ['fact-card','sourced-image','answer-timeline','simple-diagram']){
   const C=registry.get(`pv-${family}`),view=new C();view.localName=`pv-${family}`;const input={state:'ready',content:clone(visualExamples[family].content)};view.data=input;const row=view.list?.children[0],image=view.image;view.sources.open=true;view.sources.children[0].focus();const focus=document.activeElement;clean();
   for(let i=0;i<20;i++)view.data={...clone(input),observedAt:i,context:{revision:i}};
   assert.equal(mutations.length,0,`${family}: unchanged observations do not write`);assert.strictEqual(view.list?.children[0],row);assert.strictEqual(view.image,image);assert.equal(view.sources.open,true);assert.strictEqual(document.activeElement,focus);
   if(family==='fact-card'){const changed=clone(input);changed.content.facts[0].value='99';clean();view.data=changed;assert.equal(mutations.length,1);assert.strictEqual(mutations[0].node,row.children[1]);assert.equal(mutations[0].key,'textContent');}
  }
  const C=registry.get('pv-fact-card'),view=new C();view.localName='pv-fact-card';const owner='a'.repeat(32),replacement='b'.repeat(32),content=clone(visualExamples['fact-card'].content);content.sources=[{id:'source',kind:'owner_receipt',receiptId:owner,label:'Grundlag',scope:'tool_result'}];for(const fact of content.facts)fact.sourceId='source';view.data={state:'ready',content,ownerReceiptIds:[owner]};const source=view.sourceList.children[0].children[0];let requested;source.addEventListener('owner-source',event=>requested=event.detail.receiptId);const next=clone(content);next.sources[0].receiptId=replacement;view.data={state:'ready',content:next,ownerReceiptIds:[replacement]};source.click();assert.equal(requested,replacement);
  view.data={state:'ready',content:next,ownerReceiptIds:[]};assert.equal(source.disabled,true);requested=null;source.click();assert.equal(requested,null);view.data={state:'ready',content:next,ownerReceiptIds:[replacement],historical:true};assert.equal(source.disabled,true);assert.equal(view.sources.hidden,true);
  const pending=new C();pending.localName='pv-fact-card';pending.data={state:'loading'};const placeholders=[...pending.list.children];clean();pending.data={state:'pending'};assert.deepEqual(pending.list.children,placeholders);assert.equal(mutations.filter(x=>['append','remove','insert','replaceChildren'].includes(x.key)).length,0);clean();pending.data={state:'pending',observedAt:5};assert.equal(mutations.length,0);
 }finally{Object.assign(globalThis,previous);}
});
