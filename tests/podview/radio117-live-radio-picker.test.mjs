import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeakerOutputView} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
import {LiveRadioView} from '../../podvoice/gatekeeper/static/podview/live-radio-view.js';
class Node{
 constructor(doc){this.ownerDocument=doc;this.children=[];this.dataset={};this.attrs=new Map();this.listeners=new Map();this.classList={add(){}};this.textContent='';this.open=false;}
 append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 insertBefore(node,next){node.remove();const i=next?this.children.indexOf(next):this.children.length;this.children.splice(i<0?this.children.length:i,0,node);node.parentNode=this;}
 remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
 setAttribute(k,v){this.attrs.set(k,String(v));}
 getAttribute(k){return this.attrs.get(k)??null;}
 querySelector(){return this.note;}
 addEventListener(k,fn){const list=this.listeners.get(k)||[];list.push(fn);this.listeners.set(k,list);}
 emit(k){for(const fn of this.listeners.get(k)||[])fn();}
 focus(){this.ownerDocument.activeElement=this;}
 close(){this.open=false;this.emit('close');}
 showModal(){this.open=true;}
}
function fixture(){const doc={createElement:()=>new Node(doc),activeElement:null};const nodes=Object.fromEntries(['rooms','room-options','room-title'].map(id=>[id,new Node(doc)]));nodes.rooms.note=new Node(doc);doc.getElementById=id=>nodes[id];const host={ownerDocument:doc,isConnected:true,liveSnapshot:{bootId:'b',roomId:'r'},liveTransport:{connected:true},playerView:{}};host.liveOutputs=new SpeakerOutputView(host);const radio=host.liveRadio=new LiveRadioView(host);radio.render=()=>{};return {host,radio,view:host.liveOutputs,nodes,doc};}
const targets=[{id:'a',name:'Stuen',availability:'available',selectable:true,default:true},{id:'b',name:'Køkken',availability:'available',selectable:true,default:false}];
test('canonical radio picker retains exact keyed rows and focused control through passive updates',()=>{const {view,nodes,doc}=fixture(),model={targets,selectable:()=>true};view.renderRadioOutputs(model);const first=nodes['room-options'].children[0],second=nodes['room-options'].children[1];second.focus();view.renderRadioOutputs({...model,targets:targets.map(t=>({...t})),actualTargetId:'a'});assert.equal(nodes['room-options'].children[0],first);assert.equal(nodes['room-options'].children[1],second);assert.equal(doc.activeElement,second);assert.equal(first.children[2].textContent,'Aktuelt output');view.renderRadioOutputs({...model,targets:[targets[0]]});assert.equal(doc.activeElement,view.refresh);});
test('actual native cancel/close clears pending station before later radio output selection',()=>{const {radio,view,nodes}=fixture();view.bindRadioClose();for(const event of ['cancel','close']){radio.waitingStation='p3';radio.outputOpen=true;nodes.rooms.emit(event);assert.equal(radio.waitingStation,null);assert.equal(radio.outputOpen,false);}let effects=0;radio.act=()=>effects++;radio.value={enabled:true,bootId:'b',roomId:'r',validUntil:Date.now()/1000+30,actions:['start'],targets,state:{status:'idle',sourceKind:'none',stationId:null,targetId:null}};radio.outputOpen=true;nodes.rooms.open=true;radio.syncOutputs();nodes['room-options'].children[1].emit('click');assert.equal(effects,0);assert.equal(radio.nextTarget,'b');});
test('late refresh after picker cancel cannot reclaim canonical sheet custody',async()=>{const {radio,nodes}=fixture();let resolve;radio.refresh=()=>new Promise(r=>resolve=r);radio.openOutputs();nodes.rooms.close();nodes['room-options'].replaceChildren();resolve();await Promise.resolve();assert.equal(radio.outputOpen,false);assert.equal(nodes['room-options'].children.length,0);});

test('move closes canonical picker and binds readonly progress to exact chosen target while retaining observed destination',()=>{const {radio,view,nodes}=fixture();view.bindRadioClose();radio.value={enabled:true,bootId:'b',roomId:'r',validUntil:Date.now()/1000+30,actions:['start','move'],targets,state:{status:'playing',sourceKind:'radio',stationId:'p3',targetId:'a',ownerGeneration:1}};radio.outputOpen=true;nodes.rooms.open=true;const calls=[];radio.act=(...args)=>calls.push(args);radio.syncOutputs();nodes['room-options'].children[1].emit('click');assert.equal(nodes.rooms.open,false);assert.equal(radio.outputOpen,false);assert.deepEqual(calls,[['move',{targetId:'b'},{kind:'output',id:'b'}]]);assert.equal(radio.value.state.targetId,'a');assert.equal(radio.nextTarget,'b');});
