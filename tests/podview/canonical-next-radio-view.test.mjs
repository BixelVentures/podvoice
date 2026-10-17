import test from 'node:test';
import assert from 'node:assert/strict';
import {RadioView} from '../../podvoice/gatekeeper/static/podview/radio-view.js';
import {stations} from '../../podvoice/gatekeeper/static/podview/radio-model.js';

class Node {
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.localName=tag;this.children=[];this.parentNode=null;this.className='';this.dataset={};this.attributes=new Map();this._text='';this.data=null;}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 set textContent(value){this.children=[];this._text=String(value);}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 addEventListener(name,handler){this.listeners??=new Map();this.listeners.set(name,handler);}
 removeEventListener(name,handler){if(this.listeners?.get(name)===handler)this.listeners.delete(name);}
 emit(name,detail,target){let stopped=false;this.listeners.get(name)?.({detail,target,stopPropagation(){stopped=true;}});return stopped;}
}
function fixture(){const doc={createElement:tag=>new Node(doc,tag)},root=doc.createElement('section'),calls=[];const view=new RadioView(root,{onSelect:(id,station)=>calls.push([id,station])});return {root,view,calls};}

test('radio detail reuses response heading and existing choice-list without logos or extra player',()=>{
 const {root,view}=fixture();view.render({live:false,connected:true,stationId:'p3'});
 assert.deepEqual(root.children.map(node=>[node.tagName,node.className]),[['HEADER','response-heading'],['PV-CHOICE-LIST','']]);
 assert.equal(root.children[0].children[0].children[0].textContent,'Radio');
 const list=root.children[1];assert.equal(list.data.connected,true);
 assert.equal(list.data.selected,'p3');
 assert.deepEqual(list.data.items,stations.map(({id,label})=>({id,label})));
 const heading=root.children[0];view.render({live:false,connected:true,stationId:'p8-jazz'});
 assert.equal(root.children[0],heading);assert.equal(root.children[1],list);
 assert.equal(list.data.selected,'p8-jazz');
});

test('local explicit selection delegates one stable station ID and rejects invalid or repeated choice',()=>{
 const {root,view,calls}=fixture();view.render({live:false,connected:true,stationId:'p3'});const list=root.children[1];
 assert.equal(root.emit('pv-action',{action_id:'choose',option_id:'p8-jazz'},list),true);
 assert.deepEqual(calls,[["p8-jazz",stations[4]]]);
 assert.equal(list.data.selected,'p8-jazz');
 root.emit('pv-action',{action_id:'choose',option_id:'p8-jazz'},list);
 root.emit('pv-action',{action_id:'choose',option_id:'unknown'},list);
 root.emit('pv-action',{action_id:'play',option_id:'p1'},list);
 root.emit('pv-action',{action_id:'choose',option_id:'p1'},root.children[0]);
 assert.equal(calls.length,1);
 view.destroy();root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,1);
});

test('live and disconnected render remain visibly present but cannot select a station',()=>{
 const {root,view,calls}=fixture();view.render({live:true,connected:true,stationId:'p3'});const list=root.children[1];
 assert.equal(list.data.connected,false);assert.equal(list.data.state,'unsupported');
 assert.match(list.data.stateText,/ikke forbundet/i);
 root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:false,stationId:'p3'});
 assert.equal(list.data.connected,false);root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:true,stationId:'p3'});root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);
 assert.deepEqual(calls,[["p1",stations[1]]]);
});
