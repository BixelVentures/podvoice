import test from 'node:test';import assert from 'node:assert/strict';import * as kit from '../../podvoice/gatekeeper/static/podview/ui/kit.js';
class Element extends EventTarget{
 constructor(tag,doc){super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.className='';this.attributes=new Map();this.dataset={};this.children=[];this._text='';this.disabled=false;}
 set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text;}
 setAttribute(k,v){this.attributes.set(k,String(v));if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}
 getAttribute(k){return this.attributes.get(k)??null;}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
 contains(node){return this.children.includes(node)||this.children.some(child=>child.contains(node));}
 focus(){this.ownerDocument.activeElement=this;}
}
const doc=()=>{const d={activeElement:null};d.createElement=tag=>new Element(tag,d);return d;};
test('observed power retains icon,label,track and thumb without effects or optimistic pending',()=>{
 assert.equal(typeof kit.syncKitPowerToggle,'function');const d=doc(),node=d.createElement('button');let effects=0;node.addEventListener('click',()=>effects++);
 kit.syncKitPowerToggle(node,{checked:false,label:'Klima'});const [icon,label,track]=node.children,thumb=track.children[0];assert.equal(node.dataset.kit,'toggle');assert.equal(node.dataset.kitVariant,'power');assert.equal(node.getAttribute('role'),'switch');assert.equal(node.getAttribute('aria-label'),'Klima');assert.equal(node.getAttribute('aria-checked'),'false');assert.equal(label.textContent,'Slukket');assert.equal(node.dataset.feedback,'progress');assert.equal(track.getAttribute('aria-hidden'),'true');
 kit.applyKitComponent(node,'toggle',{loading:true,disabled:true});for(let i=0;i<3;i++)kit.syncKitPowerToggle(node,{checked:false,label:'Klima'});assert.equal(node.getAttribute('aria-checked'),'false');assert.equal(node.getAttribute('aria-busy'),'true');assert.equal(node.disabled,true);assert.deepEqual(node.children,[icon,label,track]);assert.equal(track.children[0],thumb);
 kit.applyKitComponent(node,'toggle',{loading:false,disabled:false});kit.syncKitPowerToggle(node,{checked:true,label:'Klima'});assert.equal(node.getAttribute('aria-checked'),'true');assert.equal(label.textContent,'Tændt');assert.deepEqual(node.children,[icon,label,track]);assert.equal(track.children[0],thumb);assert.equal(effects,0);
});
test('Button helper preserves owner listeners and permits canonical icons only',()=>{
 assert.equal(typeof kit.syncKitButtonContent,'function');const d=doc(),node=d.createElement('button');let clicks=0;node.addEventListener('click',()=>clicks++);kit.syncKitButtonContent(node,{label:'Lås bilen',icon:'assets/icons/lock.svg'});const children=[...node.children];kit.syncKitButtonContent(node,{label:'Låser…'});assert.deepEqual(node.children,children);assert.equal(children[1].textContent,'Låser…');assert.match(children[0].getAttribute('style'),/lock\.svg/);assert.throws(()=>kit.syncKitButtonContent(node,{label:'No',icon:'https://foreign/lock.svg'}),/canonical local asset/);node.dispatchEvent(new Event('click'));assert.equal(clicks,1);
});
test('Disclosure preserves owner panel while disabled closes and restores focus',()=>{
 const d=doc(),events=[],row=kit.createKitDisclosure({document:d,id:'seat-options',title:'Sædevarme',description:'Klima slukket',leadingIcon:'assets/icons/seat.svg',iconSrc:'assets/icons/chevron-down.svg',onToggle:value=>events.push(value)});assert.equal(typeof row.setDisabled,'function');assert.equal(row.trigger.getAttribute('aria-label'),null);assert.deepEqual(row.trigger.children.map(x=>x.dataset.kitSlot),['leading-icon','copy','trailing-icon']);const copy=row.trigger.children[1],child=d.createElement('button');row.panel.append(child);assert.equal(row.panel.getAttribute('role'),'region');row.setExpanded(true);d.activeElement=child;row.setDisabled(true);assert.equal(d.activeElement,row.trigger);assert.equal(row.panel.hidden,true);assert.equal(row.trigger.getAttribute('aria-disabled'),'true');row.trigger.dispatchEvent(new Event('click'));row.setExpanded(true);assert.equal(row.panel.hidden,true);assert.deepEqual(events,[]);row.setDescription('');assert.equal(copy.children[1].hidden,true);assert.equal(row.trigger.dataset.hasSummary,'false');row.setDisabled(false);row.trigger.dispatchEvent(new Event('click'));assert.equal(row.panel.hidden,false);assert.deepEqual(events,[true]);assert.equal(row.panel.children[0],child);
});
