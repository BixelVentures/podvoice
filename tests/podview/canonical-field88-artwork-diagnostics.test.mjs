import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {MusicResults,sourceMusicCards} from '../../podvoice/gatekeeper/static/podview/music-results.js';
import {renderRetainedArtwork,cancelArtwork} from '../../podvoice/gatekeeper/static/podview/spotify-artwork.js';

const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 const records=[],probes=[],events=new Map(),attrs=new Map(),classes=new Set();
 const host={liveTransport:{recordDiagnostic:(stage,fields)=>records.push({stage,...fields})}};
 class Probe{
  constructor(){probes.push(this);this.decoded=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}
  decode(){return this.decoded;}removeAttribute(name){if(name==='src')this.src=null;}
 }
 const image={dataset:{},isConnected:true,ownerDocument:{defaultView:{Image:Probe}},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},getAttribute:k=>attrs.get(k),set src(v){attrs.set('src',v);},get src(){return attrs.get('src');},addEventListener:(event,handler)=>events.set(event,handler),closest:selector=>selector==='pv-widget-host'?host:null};
 const art={url:'theme-art/cooking/'+'a'.repeat(64)+'.webp',identity:'private-identity',contentIdentity:'private-account|private-content',label:'Private source title',quiet:true};
 return {image,host,records,probes,art,error:()=>events.get('error')(),render(value=art){return renderRetainedArtwork(image,value);}};
}

test('current probe resource failure records one closed event without source or owner content',()=>{
 const f=fixture();f.render();const error=f.probes[0].onerror;error(new Event('error'));
 assert.deepEqual(f.records,[{stage:'artwork',code:'resource_error'}]);assert.equal(f.image.src,'assets/icons/music-note-beamed.svg');assert.equal(f.image.dataset.artworkPending,undefined);
 error(new Event('error'));assert.equal(f.render(),false);assert.equal(f.probes.length,1);assert.equal(f.records.length,1);
 assert.doesNotMatch(JSON.stringify(f.records),/theme-art|private|title|uri|url|identity|account/i);
});

test('decode rejection is distinct from resource failure and unchanged failed content stays quiet',async()=>{
 const f=fixture();f.render();f.probes[0].onload();await flush();f.probes[0].reject(Error('private URL and decode prose'));await flush();
 assert.deepEqual(f.records,[{stage:'artwork',code:'decode_error'}]);assert.equal(f.image.src,'assets/icons/music-note-beamed.svg');assert.equal(f.render(),false);assert.equal(f.records.length,1);assert.equal(f.probes.length,1);
});

test('obsolete request errors and late decode failures cannot emit diagnostics for a replacement',async()=>{
 const f=fixture();f.render();const old=f.probes[0],oldError=old.onerror;old.onload();await flush();
 f.render({...f.art,url:f.art.url.replace('a'.repeat(64),'b'.repeat(64)),identity:'replacement'});oldError(new Event('error'));old.reject(Error('late decode'));await flush();assert.deepEqual(f.records,[]);
 f.probes[1].onerror(new Event('error'));assert.deepEqual(f.records,[{stage:'artwork',code:'resource_error'}]);
});

test('cancelled artwork and a changed canonical transport owner discard obsolete diagnostics',async()=>{
 for(const change of ['cancel','owner']){
  const f=fixture();f.render();const failed=f.probes[0].onerror,newRecords=[];
  if(change==='cancel')cancelArtwork(f.image);else f.host.liveTransport={recordDiagnostic:(stage,fields)=>newRecords.push({stage,...fields})};
  failed(new Event('error'));assert.deepEqual(f.records,[]);assert.deepEqual(newRecords,[]);
 }
});

test('visible image errors log only a currently displayed non-fallback image',async()=>{
 const f=fixture();f.render();f.probes[0].onload();f.probes[0].resolve();await flush();assert.equal(f.image.src,f.art.url);assert.deepEqual(f.records,[]);
 f.error();assert.deepEqual(f.records,[{stage:'artwork',code:'resource_error'}]);assert.equal(f.image.src,'assets/icons/music-note-beamed.svg');f.error();f.render();assert.equal(f.records.length,1);assert.equal(f.probes.length,1);
});

test('missing or throwing optional diagnostic sink cannot change existing image fallback behavior',()=>{
 for(const owner of [null,{liveTransport:{recordDiagnostic(){throw Error('inert sink failure');}}}]){
  const f=fixture();f.image.closest=()=>owner;f.render();assert.doesNotThrow(()=>f.probes[0].onerror(new Event('error')));assert.equal(f.image.src,'assets/icons/music-note-beamed.svg');assert.equal(f.render(),false);
 }
});

test('a displayed image from an old transport cannot attribute a late error to its replacement owner',async()=>{
 const f=fixture();f.render();f.probes[0].onload();f.probes[0].resolve();await flush();const replacement=[];f.host.liveTransport={recordDiagnostic:(stage,fields)=>replacement.push({stage,...fields})};f.error();assert.deepEqual(f.records,[]);assert.deepEqual(replacement,[]);assert.equal(f.image.src,'assets/icons/music-note-beamed.svg');
});

for(const failure of ['resource','decode'])test(`explicit artwork owner survives initial unattached image before ${failure} failure`,async()=>{
 const f=fixture();f.image.closest=()=>null;const options={...f.art,diagnosticOwner:f.host.liveTransport};f.render(options);f.image.closest=selector=>selector==='pv-widget-host'?f.host:null;
 if(failure==='resource')f.probes[0].onerror(new Event('error'));else{f.probes[0].onload();await flush();f.probes[0].reject(Error('private decode'));await flush();}
 assert.deepEqual(f.records,[{stage:'artwork',code:failure==='resource'?'resource_error':'decode_error'}]);
});

test('explicit unattached owner is never replaced by a different future transport or fallback owner',()=>{
 const f=fixture(),original=f.host.liveTransport,later=[];f.image.closest=()=>null;f.render({...f.art,diagnosticOwner:original,backup:{url:'assets/lake.webp',identity:'backup',label:'Private backup'}});f.image.closest=selector=>selector==='pv-widget-host'?f.host:null;f.host.liveTransport={recordDiagnostic:(stage,fields)=>later.push({stage,...fields})};f.probes[0].onerror(new Event('error'));assert.equal(f.probes.length,2);f.probes[1].onerror(new Event('error'));assert.deepEqual(f.records,[]);assert.deepEqual(later,[]);
});

test('fallback recursion retains the explicitly captured primary owner',()=>{
 const f=fixture(),owner=f.host.liveTransport;f.image.closest=()=>null;f.render({...f.art,diagnosticOwner:owner,backup:{url:'assets/lake.webp',identity:'backup',label:'Private backup'}});f.image.closest=selector=>selector==='pv-widget-host'?f.host:null;f.probes[0].onerror(new Event('error'));assert.equal(f.probes.length,2);f.probes[1].onerror(new Event('error'));assert.deepEqual(f.records,[{stage:'artwork',code:'resource_error'},{stage:'artwork',code:'resource_error'}]);
});


test('actual PlayerView artwork call supplies its host owner before the image is attached',()=>{
 const f=fixture();f.image.closest=()=>null;PlayerView.prototype.artwork.call({host:f.host},f.image,{uri:'spotify:track:0123456789ABCDEFGHIJKL',title:'Private title',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/private'}});f.image.closest=selector=>selector==='pv-widget-host'?f.host:null;f.probes[0].onerror(new Event('error'));assert.deepEqual(f.records,[{stage:'artwork',code:'resource_error'}]);
});

test('actual MusicResults starts generated artwork while detached and logs the same owner after row insertion',()=>{
 const f=fixture();
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.style={};this.textContent='';const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)};this.events=new Map();}
  append(...nodes){for(const n of nodes)this.insertBefore(n,null);}insertBefore(n,before){n.remove();n.parentNode=this;const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,n);}remove(){if(this.parentNode){const rows=this.parentNode.children;rows.splice(rows.indexOf(this),1);this.parentNode=null;}}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return k==='src'?this.src??null:this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}addEventListener(k,fn){this.events.set(k,fn);}querySelector(){return null;}querySelectorAll(){return this.children;}closest(selector){for(let n=this;n;n=n.parentNode)if(selector==='pv-widget-host'&&n.tagName==='PV-WIDGET-HOST')return n;return null;}
 }
 const doc={defaultView:f.image.ownerDocument.defaultView,createElement:tag=>{const n=new Node(tag);n.ownerDocument=doc;return n;}},nodes=new Map();for(const id of ['result-list','empty','result-count','response-title','music-refinements','music-refresh','music-response'])nodes.set(id,doc.createElement('div'));
 const host=doc.createElement('pv-widget-host');Object.assign(host,{state:{focus:'music'},live:true,liveTransport:f.host.liveTransport,querySelector:selector=>nodes.get(selector.slice(1))});host.append(nodes.get('music-response'));nodes.get('music-response').append(nodes.get('result-list'));const view=new MusicResults(host),cards=sourceMusicCards([{uri:'spotify:playlist:0123456789ABCDEFGHIJKL',name:'Private list',themeId:'cooking',themeTitle:'Cooking',themeArt:f.art.url}],'mood');
 view.render({cards,collection:'mood'});const image=[...view.rows.values()][0].children[0];assert.equal(image.closest('pv-widget-host'),host);assert.equal(f.probes.length,1);f.probes[0].onerror(new Event('error'));assert.deepEqual(f.records,[{stage:'artwork',code:'resource_error'}]);view.cleanup();
});
