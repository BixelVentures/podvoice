import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicResults,sourceMusicCards} from '../../podvoice/gatekeeper/static/podview/music-results.js';

// Native DOM port: the actual shared renderer owns these retained nodes, states,
// source requests and handlers. Layout acceptance remains a browser check.
function surface(){
 const writes=[],probes=[],animations=[];
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs=new Map();this.events=new Map();this.textContent='';this.disabled=false;this.hidden=false;this.style={};this.dataset=new Proxy({},{set:(o,k,v)=>{writes.push(['data',this,k,v]);o[k]=v;return true;},deleteProperty:(o,k)=>{delete o[k];return true;}});const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)};}
  append(...nodes){for(const n of nodes)this.insertBefore(n,null);}insertBefore(n,before){writes.push(['insert',this,n]);n.remove();n.parentNode=this;const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,n);}remove(){if(this.parentNode){writes.push(['remove',this]);this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(k,v){writes.push(['attribute',this,k,v]);this.attrs.set(k,String(v));}getAttribute(k){return k==='src'?this.src??null:this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}addEventListener(k,fn){this.events.set(k,fn);}querySelector(selector){return selector==='[data-refresh-label]'?this.label:null;}querySelectorAll(){return this.children;}getClientRects(){return [{}];}closest(selector){for(let n=this;n;n=n.parentNode)if(selector==='pv-widget-host'&&n.tagName==='PV-WIDGET-HOST')return n;return null;}
 }
 class Probe{constructor(){probes.push(this);}decode(){return Promise.resolve();}removeAttribute(){}}
 const doc={defaultView:{Image:Probe},createElement:tag=>{const n=new Node(tag);n.ownerDocument=doc;return n;}},nodes=new Map();
 for(const id of ['result-list','empty','result-count','response-title','music-refinements','music-refresh','music-response'])nodes.set(id,doc.createElement(id==='music-refresh'?'button':'div'));
 const refresh=nodes.get('music-refresh');refresh.label=doc.createElement('span');refresh.append(doc.createElement('img'),refresh.label);
 const host=doc.createElement('pv-widget-host');Object.assign(host,{live:true,state:{focus:'music'},liveTransport:{},liveSnapshot:{bootId:'boot',roomId:'room'},liveCatalogue:{account:'account'},querySelector:s=>nodes.get(s.slice(1)),motion:{reduced:false,animate:(node,keyframes,duration)=>{const animation={node,keyframes,duration,finished:new Promise(()=>{}),cancel(){this.cancelled=true;}};animations.push(animation);return animation;}}});
 host.append(nodes.get('music-response'));nodes.get('music-response').append(nodes.get('result-list'));const chosen=[],view=new MusicResults(host,{choose:card=>chosen.push(card)});
 return {host,view,nodes,refresh,writes,probes,animations,chosen};
}
const source=()=>sourceMusicCards([{uri:'spotify:playlist:0123456789ABCDEFGHIJKL',name:'Actual list',themeTitle:'Rolig morgen',themeId:'morning_acoustic',themeArt:'theme-art/morning_acoustic/'+'a'.repeat(64)+'.webp'}],'mood');

test('first actual read reserves the same Card artwork, title, body and action roles before any source response',()=>{
 const f=surface();f.view.render({cards:[],collection:'mood',busy:true});const rows=[...f.nodes.get('result-list').children];assert.equal(rows.length,3);assert.equal(f.probes.length,0,'no image is invented before source admission');
 for(const row of rows){assert.equal(row.dataset.artworkRole,'editorial');assert.equal(row.dataset.contentState,'pending');assert.equal(row.getAttribute('aria-hidden'),'true');assert.equal(row.disabled,true);assert.equal(row.dataset.optionId,undefined);const [art,copy,,action]=row.children;assert.equal(art.dataset.kitSlot,'artwork');assert.equal(copy.children[0].dataset.kitSlot,'title');assert.equal(copy.children[1].dataset.kitSlot,'body');assert.equal(action.dataset.kitSlot,'actions');assert.equal(copy.style.visibility,undefined,'blank content slots remain paintable');assert.equal(art.style.visibility,undefined,'the reserved art frame remains paintable');assert.deepEqual(copy.children.map(n=>n.textContent),['','','']);row.events.get('click')();}
 assert.equal(f.chosen.length,0);f.writes.length=0;f.view.render({cards:[],collection:'mood',busy:true});assert.deepEqual(f.writes,[],'same pending render neither restarts nor replaces loading slots');assert.deepEqual(f.nodes.get('result-list').children,rows);f.view.cleanup();
});

test('admitted source replaces blank content while artwork decode retains the identical reserved roles',async()=>{
 const f=surface();f.view.render({cards:[],busy:true});f.view.render({cards:source(),collection:'mood'});const row=[...f.view.rows.values()][0],image=row.children[0];assert.equal(row.dataset.contentState,'ready');assert.equal(row.dataset.artworkRole,'editorial');assert.equal(image.dataset.kitSlot,'artwork');assert.equal(image.dataset.artworkPending,'true');assert.equal(row.children[1].children[0].textContent,'Rolig morgen');assert.equal(row.children[1].children[1].textContent,'Actual list');assert.equal(f.probes.length,1);f.probes[0].onload();for(let i=0;i<6;i++)await Promise.resolve();assert.equal(f.view.rows.get(row.musicCard.id),row);assert.equal(image.dataset.artworkPending,undefined);assert.equal(image.src,source()[0].themeArt);assert.equal(row.dataset.contentState,'ready');f.view.cleanup();
});

test('real refresh keeps retained cover and text still while the Button indicates pending',()=>{
 const f=surface(),cards=source();f.view.render({cards});const row=[...f.view.rows.values()][0],children=[...row.children];f.view.render({cards,busy:true});assert.equal(f.refresh.dataset.refreshState,'pending');assert.equal(f.refresh.getAttribute('aria-busy'),'true');assert.equal(f.refresh.getAttribute('aria-disabled'),'true');assert.equal(f.refresh.label.textContent,'Henter forslag');assert.deepEqual(row.children,children);assert.equal(row.dataset.contentState,'ready','actual source content stays readable during refresh');assert.equal(f.animations.length,0,'unchanged retained content must not flicker');f.view.render({cards,busy:true});assert.equal(f.animations.length,0,'unchanged busy never starts motion');f.view.render({cards,status:'Forslag kunne ikke hentes'});assert.equal(f.refresh.getAttribute('aria-busy'),'false');assert.equal(f.refresh.dataset.refreshState,'idle');assert.equal(f.refresh.label.textContent,'Prøv igen');assert.equal(f.refresh.disabled,false);assert.deepEqual(row.children,children);f.view.cleanup();assert.ok(f.animations.every(a=>a.cancelled));
});

test('failed or cancelled first read clears gradient ownership without fabricated text, art or active choices',()=>{
 for(const end of ['error','cleanup']){const f=surface();f.view.render({cards:[],busy:true});const rows=[...f.nodes.get('result-list').children];if(end==='error')f.view.render({cards:[],status:'Forslag kunne ikke hentes'});else f.view.cleanup();assert.equal(f.nodes.get('result-list').getAttribute('aria-busy'),'false');assert.equal(f.refresh.getAttribute('aria-busy'),'false');assert.equal(f.probes.length,0);assert.equal(f.chosen.length,0);assert.ok(rows.every(row=>row.dataset.contentState!=='pending'||row.parentNode===null),'cancelled visible slots stop pending treatment');}
});

test('reduced motion refresh preserves content and busy state without content animations',()=>{
 const f=surface();f.host.motion.reduced=true;const cards=source();f.view.render({cards});f.view.render({cards,busy:true});assert.equal(f.refresh.getAttribute('aria-busy'),'true');assert.equal(f.animations.length,0);assert.equal([...f.view.rows.values()][0].children[1].children[0].textContent,'Rolig morgen');f.view.cleanup();assert.equal(f.refresh.getAttribute('aria-busy'),'false');
});
