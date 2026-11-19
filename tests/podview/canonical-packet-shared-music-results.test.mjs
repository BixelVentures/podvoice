import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceMusicCards,fixtureArtwork} from '../../podview/music-results.js';
import {LiveMusicSelectionView} from '../../podview/live-music-selection-view.js';
import {initialWidgetState,resultsFor,widgetTransition} from '../../podview/widget-model.js';
const track={title:'Source title <img onerror=bad()>',artist:'Actual artist',uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/abc'}};
function catalogue(){const renders=[],reads=[],host={state:{focus:'music'},musicResults:{render:vm=>renders.push(vm)}};const view=new LiveMusicCatalogueView(host,kind=>reads.push(kind));host.liveCatalogue=view;view.updateCapabilities(true,['recent','top','recent']);view.resetAccount('account');return {view,host,renders,reads};}

test('valid empty search never falls back to catalogue fixtures or old source cards',()=>{let vm;const view=Object.create(LiveMusicSelectionView.prototype);Object.assign(view,{host:{musicResults:{render:next=>vm=next},liveSnapshot:{capabilities:{musicRead:['search']}},liveCatalogue:{cards:[track],selected:'top'}},context:()=>({}),panel:{},submit:{},input:{},back:{},targetLabel:{},targetSelect:{},active:true,source:{tracks:[],context:null},targets:[],note:{textContent:'Ingen sange fundet.'}});view.render();assert.deepEqual(vm.cards,[]);assert.equal(vm.canChoose,false);});

const sampleBody=count=>({ok:true,data:{config_entry_id:'account',tracks:Array.from({length:count},(_,index)=>({name:`Actual source ${index}`,artist:'Actual artist',uri:`spotify:track:${String(index).padStart(22,'0')}`}))}});

function retainedResultSurface(){
 const writes=[];
 class ResultNode{
  constructor(tag){this.tag=tag;this.children=[];this.parentNode=null;this.attrs=new Map();this.listeners=new Map();const values={textContent:'',disabled:false,hidden:false,src:'',alt:'',referrerPolicy:'',decoding:'',className:''};
   for(const key of Object.keys(values))Object.defineProperty(this,key,{get:()=>values[key],set:value=>{writes.push([this,key,value]);values[key]=value;if(key==='disabled'&&value&&this.ownerDocument?.activeElement===this)this.ownerDocument.activeElement=this.ownerDocument.body;}});
   this.dataset=new Proxy({},{set:(target,key,value)=>{writes.push([this,'data-'+key,value]);target[key]=value;return true;},deleteProperty:(target,key)=>{if(key in target)writes.push([this,'delete-data-'+key]);delete target[key];return true;}});
   this.style=new Proxy({},{set:(target,key,value)=>{writes.push([this,'style-'+key,value]);target[key]=value;return true;}});const classes=new Set();this.classList={contains:name=>classes.has(name),add:name=>{writes.push([this,'class-add',name]);classes.add(name);},remove:name=>{writes.push([this,'class-remove',name]);classes.delete(name);},toggle:(name,on)=>{writes.push([this,'class-toggle',name]);if(on)classes.add(name);else classes.delete(name);}};
  }
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){writes.push([this,'insert',node]);if(node.parentNode){const old=node.parentNode.children;old.splice(old.indexOf(node),1);}node.parentNode=this;const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);}
  remove(){if(this.parentNode){writes.push([this,'remove']);const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(name,value){writes.push([this,name,value]);this.attrs.set(name,String(value));}
  getAttribute(name){return name==='src'?this.src:this.attrs.get(name)??null;}
  addEventListener(name,handler){this.listeners.set(name,handler);}
  querySelector(selector){return selector==='[data-refresh-label]'?this.label:null;}
  querySelectorAll(){return this.children;}
 }
 const doc={createElement:tag=>{const node=new ResultNode(tag);node.ownerDocument=doc;return node;}};
 const nodes=new Map(['result-list','empty','result-count','response-title','music-refinements','music-refresh','music-response'].map(id=>[id,doc.createElement('div')]));nodes.get('music-refresh').label=doc.createElement('span');for(const [id]of MUSIC_TABS){const tab=doc.createElement('button');tab.dataset.collection=id;nodes.get('music-refinements').append(tab);}
 const host={ownerDocument:doc,state:{focus:'music'},querySelector:selector=>nodes.get(selector.slice(1))};const chosen=[],view=new MusicResults(host,{choose:card=>chosen.push(card)});
 return {host,view,nodes,writes,chosen,clear:()=>{writes.length=0;}};
}
const resultCards=()=>[{id:'first',name:'Musik til morgen',description:'Faktisk liste',detail:'Fra Spotify',fixtureArt:'assets/kitchen.webp',artLabel:'Morgen',revision:1},{id:'second',name:'En rolig stund',description:'En anden liste',detail:'Fra Spotify',fixtureArt:'assets/lake.webp',artLabel:'Ro',revision:1}];

test('actual track cards from the same album retain their genuine source covers rather than inventing unique playlist illustrations',()=>{const rows=[0,1,2].map(i=>({...track,uri:'spotify:track:'+String(i).padStart(22,'0')})),cards=sourceMusicCards(rows);assert.equal(cards.length,3);assert.equal(cards.every(card=>card.artwork.url===track.artwork.url&&!card.fixtureArt),true);assert.equal(cards.every(card=>!('sourceArtwork' in card)),true);});

// The fixture models native disable blur so the original busy-disable defect
// fails causally; it does not pretend to establish native browser acceptance.
function refreshFocusSurface(){
 const f=retainedResultSurface(),refresh=f.nodes.get('music-refresh'),doc=f.host.ownerDocument;
 doc.body={tag:'body'};doc.activeElement=doc.body;let activations=0,focusCalls=0;
 refresh.focus=()=>{focusCalls++;doc.activeElement=refresh;};
 const activate=()=>{const event={blocked:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.blocked=true;}};refresh.listeners.get('click')?.(event);if(!event.blocked&&!refresh.disabled)activations++;return event;};
 return {...f,refresh,doc,activate,get activations(){return activations;},get focusCalls(){return focusCalls;}};
}

