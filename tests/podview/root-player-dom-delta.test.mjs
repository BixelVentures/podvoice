import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';

function fixture(){
 const writes=[],nodes=new Map(),groups=new Map();
 class Node extends EventTarget{
  constructor(name,tag='div'){super();this.name=name;this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.dataset=new Proxy({}, {set:(object,key,value)=>{writes.push(`${name}.data.${key}`);object[key]=value;return true;},deleteProperty:(object,key)=>{if(key in object)writes.push(`${name}.delete.${key}`);delete object[key];return true;}});const values={hidden:false,disabled:false,textContent:'',src:undefined,alt:'',value:'',min:'',max:'',referrerPolicy:'',decoding:'',className:''};for(const key of Object.keys(values))Object.defineProperty(this,key,{get:()=>values[key],set:value=>{writes.push(`${name}.${key}`);values[key]=value;}});const styles={visibility:'',getPropertyValue(key){return this[key]||'';},setProperty(key,value){this[key]=value;}};this.style=new Proxy(styles,{set:(object,key,value)=>{writes.push(`${name}.style.${key}`);object[key]=value;return true;}});const tokens=new Set();this.classList={contains:value=>tokens.has(value),add:(...values)=>{for(const value of values){writes.push(`${name}.class.add.${value}`);tokens.add(value);}},remove:(...values)=>{for(const value of values){writes.push(`${name}.class.remove.${value}`);tokens.delete(value);}}};}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  append(...children){writes.push(`${this.name}.append`);for(const child of children){child.remove();child.parentNode=this;this.children.push(child);}}
  insertBefore(child,next){writes.push(`${this.name}.insert`);child.remove();child.parentNode=this;const index=this.children.indexOf(next);this.children.splice(index<0?this.children.length:index,0,child);}
  remove(){if(this.parentNode){writes.push(`${this.name}.remove`);const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
  replaceWith(child){writes.push(`${this.name}.replaceWith`);const parent=this.parentNode,index=parent.children.indexOf(this);child.remove();parent.children.splice(index,1,child);child.parentNode=parent;this.parentNode=null;}
  replaceChildren(...children){writes.push(`${this.name}.replaceChildren`);for(const child of [...this.children])child.remove();this.append(...children);}
  querySelector(tag){return this.children.find(child=>child.tagName===tag.toUpperCase())||null;}
  setAttribute(key,value){writes.push(`${this.name}.attr.${key}`);this.attrs.set(key,String(value));}
  getAttribute(key){return key==='src'?(this.src??null):(this.attrs.get(key)??null);}
  removeAttribute(key){if(this.attrs.has(key)){writes.push(`${this.name}.removeAttribute.${key}`);this.attrs.delete(key);}}
  close(){writes.push(`${this.name}.close`);this.open=false;}
 }
 const doc={getElementById(id){if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},createElement:tag=>{const node=new Node(tag,tag);node.ownerDocument=doc;return node;}};
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
 const f=fixture();f.view.renderPlayer(active);f.view.renderControls(controls);f.writes.length=0;f.view.renderControls({...controls,volume:36});assert.deepEqual(f.writes.sort(),['volume.value','detail-volume.value','volume-value.textContent','detail-volume-value.textContent','volume.attr.aria-valuetext','detail-volume.attr.aria-valuetext','volume.style.--pv-slider-progress','detail-volume.style.--pv-slider-progress'].sort());
});

const queueItem={id:'real-occurrence:1',title:'Actual song',artist:'Actual artist',uri:active.uri,artwork:active.artwork,order:1,revision:1,selectable:true};
test('identical queue projections keep focus, scroll, row identity and every DOM leaf unchanged',t=>{
 const f=fixture();f.view.renderQueue([queueItem]);const queue=f.nodes.get('queue'),row=queue.children[0];f.host.ownerDocument.activeElement=row;queue.scrollTop=91;f.writes.length=0;
 f.view.renderQueue([{...queueItem,artwork:{...queueItem.artwork}}]);t.diagnostic(`identical queue writes: ${f.writes.length}`);assert.deepEqual(f.writes,[]);assert.equal(queue.children[0],row);assert.equal(f.host.ownerDocument.activeElement,row);assert.equal(queue.scrollTop,91);
});
test('queue title-only and immediate permission changes update only their actual leaves',()=>{
 const f=fixture(),selected=[];f.view.chooseQueue=item=>selected.push(item);f.view.renderQueue([queueItem]);const row=f.nodes.get('queue').children[0];f.writes.length=0;
 f.view.renderQueue([{...queueItem,title:'New actual title'}]);assert.deepEqual(f.writes.sort(),['button.attr.aria-label','strong.textContent','img.alt'].sort());assert.equal(row.children[2].children[0].textContent,'New actual title');
 f.writes.length=0;f.view.renderQueue([{...queueItem,title:'New actual title',selectable:false}]);assert.deepEqual(f.writes.sort(),['button.disabled','button.attr.aria-label'].sort());assert.equal(row.disabled,true);row.dispatchEvent(new Event('click'));assert.deepEqual(selected,[]);assert.equal(f.nodes.get('queue').children[0],row);
});
test('unchanged empty and first-read queue states retain existing nodes and do not remove and append placeholders',t=>{
 for(const status of ['ready','loading','stale','error','unknown']){const f=fixture();f.view.renderQueue([],{status});const queue=f.nodes.get('queue'),children=[...queue.children];queue.scrollTop=37;f.writes.length=0;f.view.renderQueue([],{status});t.diagnostic(`${status} queue writes: ${f.writes.length}`);assert.deepEqual(f.writes,[],status);assert.deepEqual(queue.children,children,status);assert.equal(queue.scrollTop,37,status);}
});

function decoding(f){const probes=[];class Probe{constructor(){probes.push(this);this.ready=new Promise(resolve=>this.resolve=resolve);}decode(){return this.ready;}removeAttribute(name){if(name==='src')this.src=null;}}f.host.ownerDocument.defaultView={Image:Probe};for(const id of ['cover','detail-cover'])f.host.ownerDocument.getElementById(id).ownerDocument=f.host.ownerDocument;return probes;}
const flushDecode=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('removing an existing queue occurrence cancels its exact image probe before any late decode can commit',async()=>{
 const f=fixture(),probes=decoding(f);f.view.renderQueue([queueItem]);const image=f.nodes.get('queue').children[0].children[1],probe=probes[0],late=probe.onload;late();await flushDecode();const src=image.src;f.view.renderQueue([]);assert.equal(probe.onload,null);assert.equal(probe.onerror,null);assert.equal(probe.src,null);assert.equal(image.artworkRequest,null);assert.equal(image.dataset.artworkPending,undefined);probe.resolve();late();await flushDecode();assert.equal(image.src,src);assert.equal(f.view.rows.size,0);
});
test('player owner cleanup cancels cover, detail and queue probes; late decode does not change retained nodes or sources',async()=>{
 const f=fixture(),probes=decoding(f);f.view.renderPlayer(active);f.view.renderQueue([queueItem]);assert.equal(probes.length,3);const images=[f.nodes.get('cover'),f.nodes.get('detail-cover'),f.nodes.get('queue').children[0].children[1]],late=probes.map(probe=>probe.onload);for(const callback of late)callback();await flushDecode();const sources=images.map(image=>image.src),row=f.nodes.get('queue').children[0];f.host.ownerDocument.activeElement=row;f.nodes.get('queue').scrollTop=79;f.view.cleanup();
 for(const probe of probes){assert.equal(probe.onload,null);assert.equal(probe.onerror,null);assert.equal(probe.src,null);probe.resolve();}for(const callback of late)callback();await flushDecode();assert.deepEqual(images.map(image=>image.src),sources);for(const image of images){assert.equal(image.artworkRequest,null);assert.equal(image.dataset.artworkPending,undefined);}assert.equal(f.nodes.get('queue').children[0],row);assert.equal(f.host.ownerDocument.activeElement,row);assert.equal(f.nodes.get('queue').scrollTop,79);f.writes.length=0;f.view.cleanup();assert.deepEqual(f.writes,[]);
});

test('unchanged source position writes nothing and a source advance changes only timeline leaves',()=>{
 const f=fixture(),vm={...active,progressMs:84000,durationMs:187000,positionFresh:true};f.view.renderPlayer(vm);f.writes.length=0;f.view.renderPlayer({...vm});assert.deepEqual(f.writes,[]);f.view.renderPlayer({...vm,progressMs:85000});assert.deepEqual(f.writes.sort(),['player-progress-meter.attr.value','player-progress-meter.attr.aria-label','player-elapsed.textContent','detail-progress-meter.attr.value','detail-progress-meter.attr.aria-label','detail-elapsed.textContent'].sort());
});


test('identical local seek position does not repaint fill or reset slider',()=>{
 const f=fixture(),vm={...active,examplePosition:true,trackId:'example',seekOperation:1,canSeek:true,progressMs:90000,durationMs:180000,positionFresh:true};f.view.renderPlayer(vm);assert.equal(f.view.seekControl.style.getPropertyValue('--seek-progress'),'50%');f.writes.length=0;f.view.renderPlayer({...vm});assert.deepEqual(f.writes,[]);
 f.view.renderPlayer({...vm,progressMs:180000});assert.equal(f.view.seekControl.style.getPropertyValue('--seek-progress'),'100%');assert.equal(f.writes.filter(write=>write==='input.style.--seek-progress').length,1);
});

test('paused player has no redundant visual caption and retains its position, resume control and spoken state',()=>{
 const f=fixture(),vm={...active,playing:false,progressMs:84000,durationMs:187000,positionFresh:true};f.view.renderPlayer(vm);f.view.renderControls({...controls,playing:false});
 assert.equal(f.nodes.get('player-state').textContent,'');assert.equal(f.nodes.get('detail-status').textContent,'');assert.equal(f.nodes.get('play-icon').src,'assets/icons/play-fill.svg');assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'),'Fortsæt musikken');assert.match(f.nodes.get('output').getAttribute('aria-label'),/På pause/);assert.equal(f.nodes.get('player-progress').hidden,false);assert.equal(f.nodes.get('player-elapsed').textContent,'1:24');assert.equal(f.nodes.get('player-duration').textContent,'3:07');assert.equal(f.nodes.get('player-progress-meter').getAttribute('value'),'84000');
 const position=f.nodes.get('player-progress-meter');f.writes.length=0;f.view.renderPlayer({...vm});f.view.renderControls({...controls,playing:false});assert.deepEqual(f.writes,[]);assert.equal(f.nodes.get('player-progress-meter'),position);
 f.view.renderPlayer({...vm,feedback:{message:'Afventer svar',pending:true}});assert.equal(f.nodes.get('player-state').textContent,'Afventer svar');assert.equal(f.nodes.get('detail-status').textContent,'Afventer svar');
 f.view.renderPlayer({...vm,fresh:false,feedback:{message:'Udfald ukendt',pending:false}});assert.equal(f.nodes.get('player-state').textContent,'Udfald ukendt');
});

test('paused radio keeps a truthful subtitle and accessible state without duplicate visual pause copy',async()=>{
 const {localRadioPlayerModel,localRadioControlModel}=await import('../../podvoice/gatekeeper/static/podview/radio-model.js');const {initialScene}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');const f=fixture(),scene={...initialScene(),radioStationId:'p3',radioPlaying:false},vm=localRadioPlayerModel('p3',active,{playing:false,connected:true});f.view.renderPlayer(vm);f.view.renderControls(localRadioControlModel(scene));
 assert.equal(f.nodes.get('track-name').textContent,'P3');assert.equal(f.nodes.get('track-artist').textContent,'Direkte radio · ingen lyd');assert.equal(f.nodes.get('player-state').textContent,'');assert.equal(f.nodes.get('detail-status').textContent,'');assert.equal(f.nodes.get('play-icon').src,'assets/icons/play-fill.svg');assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'),'Start radio');assert.match(f.nodes.get('output').getAttribute('aria-label'),/Radio på pause · ingen lyd/);assert.equal(f.nodes.get('previous').hidden,true);assert.equal(f.nodes.get('next').hidden,true);assert.equal(vm.exampleOnly,true);assert.equal(vm.fresh,false);assert.equal('stream' in vm,false);
 for(const feedback of [{message:'Afventer radio',pending:true},{message:'Radio kunne ikke startes',pending:false}]){f.view.renderPlayer({...vm,feedback});assert.equal(f.nodes.get('player-state').textContent,feedback.message);assert.equal(f.nodes.get('detail-status').textContent,feedback.message);}
 f.view.renderPlayer({...active,sourceKind:'radio',playing:false,fresh:false,artist:'Direkte radio'});assert.equal(f.nodes.get('player-state').textContent,'Sidst kendt');f.view.renderPlayer({...active,sourceKind:'radio',artist:''});assert.equal(f.nodes.get('track-artist').textContent,'Direkte radio');f.view.renderPlayer({...active,sourceKind:'radio',artist:'Faktisk kildebeskrivelse'});assert.equal(f.nodes.get('track-artist').textContent,'Faktisk kildebeskrivelse');
});

test('queue-only detail omits routine playback caption and retains long-title rows, actions and source errors',()=>{
 const f=fixture(),selected=[];f.view.chooseQueue=item=>selected.push(item);f.view.renderPlayer(active);assert.equal(f.nodes.get('detail-status').textContent,'');
 const long={...queueItem,title:'En meget lang faktisk titel '.repeat(12),artist:'Kildekunstner '.repeat(8),reorderable:true};f.view.renderQueue([long,{...queueItem,id:'other',order:2}]);const queue=f.nodes.get('queue'),first=queue.children[0],second=queue.children[1];assert.equal(first.children[2].children[0].textContent,long.title);assert.equal(first.children[2].children[1].textContent,long.artist);first.dispatchEvent(new Event('click'));assert.equal(selected[0].id,long.id);f.view.renderQueue([{...long},{...queueItem,id:'other',order:2}]);assert.equal(queue.children[0],first);assert.equal(queue.children[1],second);assert.equal(first.dataset.reorderable,undefined);assert.doesNotMatch(first.getAttribute('aria-label'),/Flyt|Alt/);
 f.view.renderPlayer({...active,feedback:{message:'Afspilning kunne ikke bekræftes',pending:false}});assert.equal(f.nodes.get('detail-status').textContent,'Afspilning kunne ikke bekræftes');
});
