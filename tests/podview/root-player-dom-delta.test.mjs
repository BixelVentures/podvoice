import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';

function fixture(){
 const writes=[],nodes=new Map(),groups=new Map();
 class Node extends EventTarget{
  constructor(name,tag='div'){super();this.name=name;this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.dataset=new Proxy({}, {set:(object,key,value)=>{writes.push(`${name}.data.${key}`);object[key]=value;return true;},deleteProperty:(object,key)=>{if(key in object)writes.push(`${name}.delete.${key}`);delete object[key];return true;}});const values={hidden:false,disabled:false,textContent:'',src:undefined,alt:'',value:'',min:'',max:'',referrerPolicy:'',decoding:''};for(const key of Object.keys(values))Object.defineProperty(this,key,{get:()=>values[key],set:value=>{writes.push(`${name}.${key}`);values[key]=value;}});const styles={visibility:''};this.style=new Proxy(styles,{set:(object,key,value)=>{writes.push(`${name}.style.${key}`);object[key]=value;return true;}});const tokens=new Set();this.classList={contains:value=>tokens.has(value),add:(...values)=>{for(const value of values){writes.push(`${name}.class.add.${value}`);tokens.add(value);}},remove:(...values)=>{for(const value of values){writes.push(`${name}.class.remove.${value}`);tokens.delete(value);}}};}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  append(...children){writes.push(`${this.name}.append`);for(const child of children){child.remove();child.parentNode=this;this.children.push(child);}}
  insertBefore(child,next){writes.push(`${this.name}.insert`);child.remove();child.parentNode=this;const index=this.children.indexOf(next);this.children.splice(index<0?this.children.length:index,0,child);}
  remove(){if(this.parentNode){writes.push(`${this.name}.remove`);const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
  replaceWith(child){writes.push(`${this.name}.replaceWith`);const parent=this.parentNode,index=parent.children.indexOf(this);child.remove();parent.children.splice(index,1,child);child.parentNode=parent;this.parentNode=null;}
  replaceChildren(...children){writes.push(`${this.name}.replaceChildren`);for(const child of [...this.children])child.remove();this.append(...children);}
  querySelector(tag){return this.children.find(child=>child.tagName===tag.toUpperCase())||null;}
  setAttribute(key,value){writes.push(`${this.name}.attr.${key}`);this.attrs.set(key,String(value));}
  getAttribute(key){return key==='src'?this.src:this.attrs.get(key);}
  close(){writes.push(`${this.name}.close`);this.open=false;}
 }
 const doc={getElementById(id){if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},createElement:tag=>new Node(tag,tag)};
 const host={ownerDocument:doc,state:{focus:'now'},dataset:new Proxy({}, {set:(object,key,value)=>{writes.push(`host.data.${key}`);object[key]=value;return true;}}),querySelector(selector){if(!groups.has(selector))groups.set(selector,new Node(selector));return groups.get(selector);}};
 doc.getElementById('player-empty').append(new Node('empty-title','h2'),new Node('empty-copy','p'));host.querySelector('.player').append(doc.getElementById('output'),doc.getElementById('track'));doc.getElementById('detail-output').append(new Node('detail-output-span','span'));
 const view=new PlayerView(host);return {writes,nodes,groups,host,view};
}
const active={active:true,fresh:true,playing:true,title:'Observed song',artist:'Observed artist',target:'Køkkenalrum HomePod',uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/abc'},canOutput:true,canDiscover:true};
const controls={playing:true,previous:true,next:true,toggle:true,blocked:false,volume:35,canVolume:true};

test('identical configured empty player and controls produce zero DOM writes without clearing and refilling its room',t=>{
 const f=fixture(),empty={active:false,configuredTarget:'Køkkenalrum HomePod',canOutput:true,canDiscover:true,emptyState:'unconfirmed',empty:'Vælg musik til rummet.'};f.view.renderPlayer(empty);const output=f.nodes.get('output');f.writes.length=0;f.view.renderPlayer({...empty});t.diagnostic(`unchanged empty writes: ${f.writes.length}`);assert.deepEqual(f.writes,[]);assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');assert.equal(f.nodes.get('output'),output);
});
test('identical populated player and controls do not write; title-only changes touch title leaves only',t=>{
 const f=fixture();f.view.renderPlayer(active);f.view.renderControls(controls);f.writes.length=0;f.view.renderPlayer({...active,artwork:{...active.artwork}});f.view.renderControls({...controls});t.diagnostic(`unchanged populated plus controls writes: ${f.writes.length}`);assert.deepEqual(f.writes,[]);
 f.view.renderPlayer({...active,title:'New title'});assert.deepEqual(f.writes.sort(),['cover.alt','detail-cover.alt','detail-track.textContent','track-name.textContent'].sort());assert.equal(f.nodes.get('cover').src,active.artwork.url);
});
test('changed permissions revoke retained controls immediately without resetting a volume gesture',()=>{
 const f=fixture();f.view.renderPlayer(active);f.view.renderControls(controls);const input=f.nodes.get('volume');input.value='42';f.writes.length=0;f.view.renderControls({...controls,blocked:true,gesture:input});for(const id of ['previous','next','play-pause','volume'])assert.equal(f.nodes.get(id).disabled,true);assert.equal(input.value,'42');assert.equal(f.writes.includes('volume.value'),false);assert.equal(f.nodes.get('cover').src,active.artwork.url);
});

test('repeated first-read and feedback states are no-ops and never clear the configured room',()=>{
 const f=fixture(),loading={active:false,loading:true,configuredTarget:'Køkkenalrum HomePod',canOutput:false,canDiscover:true};f.view.renderPlayer(loading);f.writes.length=0;f.view.renderPlayer({...loading});assert.deepEqual(f.writes,[]);const feedback={...loading,feedback:{pending:true,message:'Afventer afspilning i rummet.'}};f.view.renderPlayer(feedback);assert.equal(f.nodes.get('player-empty').querySelector('p').hidden,false);f.writes.length=0;f.view.renderPlayer({...feedback,feedback:{...feedback.feedback}});assert.deepEqual(f.writes,[]);assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');assert.equal(f.nodes.get('play-pause').disabled,true);
});
test('a volume-only update changes only actual slider/output leaves',()=>{
 const f=fixture();f.view.renderPlayer(active);f.view.renderControls(controls);f.writes.length=0;f.view.renderControls({...controls,volume:36});assert.deepEqual(f.writes.sort(),['volume.value','detail-volume.value','volume-value.textContent','detail-volume-value.textContent'].sort());
});
