import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceMusicCards,localMusicCards,fixtureArtwork,MUSIC_TABS,MusicResults} from '../../podvoice/gatekeeper/static/podview/music-results.js';
import {LiveMusicCatalogueView} from '../../podvoice/gatekeeper/static/podview/live-music-view.js';
import {LiveMusicSelectionView} from '../../podvoice/gatekeeper/static/podview/live-music-selection-view.js';
import {initialWidgetState,resultsFor} from '../../podvoice/gatekeeper/static/podview/widget-model.js';
const track={title:'Source title <img onerror=bad()>',artist:'Actual artist',uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/abc'}};
function catalogue(){const renders=[],reads=[],host={state:{focus:'music'},musicResults:{render:vm=>renders.push(vm)}};const view=new LiveMusicCatalogueView(host,kind=>reads.push(kind));host.liveCatalogue=view;view.updateCapabilities(true,['recent','top','recent']);view.resetAccount('account');return {view,host,renders,reads};}
test('typed fixture and real source adapters share card fields without personal claims or action authority',()=>{const local=localMusicCards(resultsFor(initialWidgetState()),1),source=sourceMusicCards([track]);assert.equal(local.length,3);assert.equal(source[0].name,track.title);assert.equal(source[0].description,track.artist);assert.equal(source[0].detail,'');assert.equal('action' in source[0],false);assert.equal('fixtureArt' in source[0],false);assert.deepEqual(MUSIC_TABS.map(x=>x[0]),['mood','feeling','top','recent']);assert.equal(fixtureArtwork('https://evil.example/image/x'),null);assert.equal(fixtureArtwork('assets/../secret.svg'),null);assert.equal(fixtureArtwork('assets/kitchen.png'),'assets/kitchen.png');});
test('mood remains an honest unavailable shared state and never requests an invented provider query',()=>{const f=catalogue();f.view.select('mood');assert.equal(f.reads.length,0);assert.deepEqual(f.renders.at(-1).cards,[]);assert.match(f.renders.at(-1).empty,/ikke tilgængelige/);assert.equal(f.renders.at(-1).canRefresh,false);});
test('refresh fetches current collection and retains exact source cards through pending and failure',()=>{const f=catalogue();f.view.select('top');f.view.tracks('top',{ok:true,data:{config_entry_id:'account',tracks:[track]}},'account');const before=f.view.cards;f.view.refresh();assert.deepEqual(f.reads,['top','top']);f.view.loading('top');assert.equal(f.renders.at(-1).cards,before);assert.equal(f.renders.at(-1).busy,true);f.view.failure('top');assert.equal(f.renders.at(-1).cards,before);assert.match(f.renders.at(-1).status,/seneste/);assert.equal(f.renders.at(-1).canChoose,false);});
test('late account/collection samples cannot replace shared rows and reset clears old account data',()=>{const f=catalogue();f.view.select('top');f.view.tracks('top',{ok:true,data:{config_entry_id:'wrong',tracks:[track]}},'account');assert.equal(f.view.cards.length,0);f.view.select('recent');f.view.tracks('top',{ok:true,data:{config_entry_id:'account',tracks:[track]}},'account');assert.equal(f.view.cards.length,0);f.view.tracks('recent',{ok:true,data:{config_entry_id:'account',tracks:[track]}},'account');assert.equal(f.view.cards.length,1);f.view.resetAccount('other');assert.equal(f.view.cards.length,0);});
test('valid empty search never falls back to catalogue fixtures or old source cards',()=>{let vm;const view=Object.create(LiveMusicSelectionView.prototype);Object.assign(view,{host:{musicResults:{render:next=>vm=next},liveSnapshot:{capabilities:{musicRead:['search']}},liveCatalogue:{cards:[track],selected:'top'}},context:()=>({}),panel:{},submit:{},input:{},back:{},targetLabel:{},targetSelect:{},active:true,source:{tracks:[],context:null},targets:[],note:{textContent:'Ingen sange fundet.'}});view.render();assert.deepEqual(vm.cards,[]);assert.equal(vm.canChoose,false);});
test('read capability revocation and restoration advance generation so a held sample cannot revive',()=>{const f=catalogue();const before=f.host.liveMusicGeneration||0;f.view.updateCapabilities(true,['recent']);f.view.updateCapabilities(true,['recent','top','recent']);assert.ok(f.host.liveMusicGeneration>=before+2);});
const sampleBody=count=>({ok:true,data:{config_entry_id:'account',tracks:Array.from({length:count},(_,index)=>({name:`Actual source ${index}`,artist:'Actual artist',uri:`spotify:track:${String(index).padStart(22,'0')}`}))}});
test('stable full provider sample advances three actual source items only after a successful reread',()=>{const f=catalogue(),body=sampleBody(7);f.view.select('top');f.view.tracks('top',body,'account');assert.equal(f.view.sample.length,7);assert.deepEqual(f.view.cards.map(card=>card.name),['Actual source 0','Actual source 1','Actual source 2']);const first=f.view.cards;f.view.refresh();assert.equal(f.view.cards,first);assert.equal(f.view.busy,true);f.view.tracks('top',body,'account');assert.deepEqual(f.view.cards.map(card=>card.name),['Actual source 3','Actual source 4','Actual source 5']);assert.equal(f.view.offset,3);const second=f.view.cards,sample=f.view.sample;f.view.refresh();f.view.failure('top');assert.equal(f.view.cards,second);assert.equal(f.view.sample,sample);assert.equal(f.view.offset,3);f.view.refresh();f.view.tracks('top',body,'account');assert.deepEqual(f.view.cards.map(card=>card.name),['Actual source 6']);f.view.refresh();f.view.tracks('top',body,'account');assert.deepEqual(f.view.cards.map(card=>card.name),['Actual source 0','Actual source 1','Actual source 2']);assert.deepEqual(f.reads,['top','top','top','top','top']);assert.equal(f.renders.at(-1).canChoose,false);});
test('unchanged three-song source admits no fake extra suggestions and account reset clears sample page',()=>{const f=catalogue(),body=sampleBody(3);f.view.select('recent');f.view.tracks('recent',body,'account');const names=f.view.cards.map(card=>card.name);f.view.refresh();f.view.tracks('recent',body,'account');assert.deepEqual(f.view.cards.map(card=>card.name),names);assert.match(f.view.status,/Ingen andre sange/);f.view.resetAccount('other');assert.deepEqual(f.view.sample,[]);assert.equal(f.view.offset,0);});
test('switching collection clears previous membership during loading and failure while same-collection refresh retains it',()=>{const f=catalogue(),body=sampleBody(7);f.view.select('top');f.view.tracks('top',body,'account');f.view.refresh();f.view.tracks('top',body,'account');assert.equal(f.view.offset,3);assert.equal(f.view.cards.length,3);f.view.select('recent');assert.equal(f.view.busy,true);assert.deepEqual(f.view.cards,[]);assert.deepEqual(f.view.sample,[]);assert.equal(f.view.offset,0);assert.equal(f.view.renderedKind,null);assert.equal(f.renders.at(-1).collection,'recent');assert.deepEqual(f.renders.at(-1).cards,[]);f.view.failure('recent');assert.equal(f.view.busy,false);assert.deepEqual(f.renders.at(-1).cards,[]);assert.match(f.renders.at(-1).status,/kunne ikke hentes/);f.view.tracks('top',body,'account');assert.deepEqual(f.view.cards,[]);f.view.select('recent');f.view.tracks('recent',body,'account');const likedCards=f.view.cards;f.view.refresh();assert.equal(f.view.cards,likedCards);f.view.failure('recent');assert.equal(f.view.cards,likedCards);});


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
 const nodes=new Map(['result-list','empty','result-count','response-title','music-refinements','music-refresh'].map(id=>[id,doc.createElement('div')]));nodes.get('music-refresh').label=doc.createElement('span');for(const [id]of MUSIC_TABS){const tab=doc.createElement('button');tab.dataset.collection=id;nodes.get('music-refinements').append(tab);}
 const host={ownerDocument:doc,state:{focus:'music'},querySelector:selector=>nodes.get(selector.slice(1))};const chosen=[],view=new MusicResults(host,{choose:card=>chosen.push(card)});
 return {host,view,nodes,writes,chosen,clear:()=>{writes.length=0;}};
}
const resultCards=()=>[{id:'first',name:'Musik til morgen',description:'Faktisk liste',detail:'Fra Spotify',fixtureArt:'assets/kitchen.png',artLabel:'Morgen',revision:1},{id:'second',name:'En rolig stund',description:'En anden liste',detail:'Fra Spotify',fixtureArt:'assets/lake.png',artLabel:'Ro',revision:1}];
test('identical shared music render writes no DOM leaves or artwork and preserves keyed rows',()=>{
 const f=retainedResultSurface(),vm={cards:resultCards(),heading:'Musik',revision:1};f.view.render(vm);const rows=[...f.nodes.get('result-list').children];f.clear();f.view.render({...vm,cards:resultCards()});f.view.render({...vm,cards:resultCards()});assert.deepEqual(f.writes,[]);assert.deepEqual(f.nodes.get('result-list').children,rows);f.view.cleanup();
});
test('one changed music title updates only that title and accessible label while authority revocation is immediate',()=>{
 const f=retainedResultSurface(),cards=resultCards();f.view.render({cards});const row=f.nodes.get('result-list').children[0];f.clear();const changed=cards.map(card=>({...card}));changed[0].name='Ny titel';f.view.render({cards:changed});assert.deepEqual(f.writes.map(([,key])=>key),['aria-label','textContent']);assert.equal(row.children[1].children[0].textContent,'Ny titel');f.clear();f.view.render({cards:changed,canChoose:false});assert.equal(row.disabled,true);row.listeners.get('click')();assert.equal(f.chosen.length,0);assert.equal(f.writes.some(([,key])=>key==='src'),false);f.view.cleanup();
});
test('unchanged empty-busy music retains the same three placeholders without detach or reappend',()=>{
 const f=retainedResultSurface();f.view.render({busy:true,cards:[]});const rows=[...f.nodes.get('result-list').children];f.clear();f.view.render({busy:true,cards:[]});assert.deepEqual(f.writes,[]);assert.deepEqual(f.nodes.get('result-list').children,rows);f.view.render({cards:resultCards()});assert.equal(f.nodes.get('result-list').children.some(row=>rows.includes(row)),false);f.view.cleanup();
});
test('shared music removal and cleanup cancel owned probes without changing retained cards',()=>{
 const f=retainedResultSurface(),cards=resultCards();f.view.render({cards});const rows=[...f.nodes.get('result-list').children],removed=[],requests=rows.map(row=>{const request={cancelled:false,probe:{onload:()=>{},onerror:()=>{},removeAttribute:name=>removed.push(name)}};row.children[0].artworkRequest=request;row.children[0].dataset.artworkPending='true';return request;});
 f.view.render({cards:[cards[1]]});assert.equal(requests[0].cancelled,true);assert.equal(requests[0].probe.onload,null);assert.equal(requests[1].cancelled,false);assert.equal(f.nodes.get('result-list').children[0],rows[1]);f.view.cleanup();assert.equal(requests[1].cancelled,true);assert.equal(requests[1].probe.onerror,null);assert.deepEqual(removed,['src','src']);
});

test('canonical result nodes prefer actual source playlist art over illustration and retain identical source cover without DOM writes',()=>{const f=retainedResultSurface(),uri='spotify:playlist:0123456789ABCDEFGHIJKL',artwork={kind:'playlist_cover',provider:'spotify',url:'https://i.scdn.co/image/sourceplaylist'},card={id:'source:0:'+uri,uri,name:'En rolig stund',sourceName:'Actual playlist name',description:'Actual playlist name',fixtureArt:'assets/lake.png',artwork};f.view.render({cards:[card]});const row=f.nodes.get('result-list').children[0];assert.equal(row.children[0].src,artwork.url);assert.equal(row.children[0].alt,'Playlisteomslag til Actual playlist name');assert.equal(row.children[0].classList.contains('spotify-artwork'),true);f.clear();f.view.render({cards:[{...card,artwork:{...artwork}}]});assert.deepEqual(f.writes,[]);assert.equal(f.nodes.get('result-list').children[0],row);f.view.cleanup();});

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
test('refresh keeps its focused button and actual cards while busy, rejects duplicate activation and remains focused after success',()=>{
 const f=refreshFocusSurface(),cards=resultCards();f.view.render({cards});f.refresh.focus();const calls=f.focusCalls,rows=[...f.nodes.get('result-list').children];
 assert.equal(f.activate().blocked,false);assert.equal(f.activations,1);
 f.view.render({cards,busy:true});assert.equal(f.refresh.disabled,false,'busy must not natively blur the focused refresh');assert.equal(f.refresh.getAttribute('aria-disabled'),'true');assert.equal(f.refresh.getAttribute('aria-busy'),'true');assert.equal(f.doc.activeElement,f.refresh);assert.deepEqual(f.nodes.get('result-list').children,rows);
 assert.equal(f.activate().blocked,true);assert.equal(f.activations,1,'capture guard stops another host activation');
 f.view.render({cards:resultCards().map(card=>({...card,id:card.id+'-new'}))});assert.equal(f.doc.activeElement,f.refresh);assert.equal(f.focusCalls,calls,'no restoration call or focus theft');assert.equal(f.refresh.getAttribute('aria-disabled'),'false');assert.equal(f.refresh.getAttribute('aria-busy'),'false');assert.equal(f.activate().blocked,false);assert.equal(f.activations,2);f.view.cleanup();
});
test('refresh failure retains cards and focus and allows one explicit retry',()=>{
 const f=refreshFocusSurface(),cards=resultCards();f.view.render({cards});f.refresh.focus();f.view.render({cards,busy:true});const rows=[...f.nodes.get('result-list').children];
 f.view.render({cards,status:'Kunne ikke opdatere · viser seneste udvalg.'});assert.equal(f.doc.activeElement,f.refresh);assert.deepEqual(f.nodes.get('result-list').children,rows);assert.equal(f.activate().blocked,false);assert.equal(f.activations,1);f.view.cleanup();
});
test('disconnect or capability loss natively disables refresh without restoring focus on recovery',()=>{
 for(const revoked of [{connected:false},{canRefresh:false},{pendingId:'selection'}]){
  const f=refreshFocusSurface(),cards=resultCards();f.view.render({cards});f.refresh.focus();f.view.render({cards,busy:true});const calls=f.focusCalls;
  f.view.render({cards,...revoked});assert.equal(f.refresh.disabled,true);assert.equal(f.refresh.getAttribute('aria-disabled'),'true');assert.equal(f.doc.activeElement,f.doc.body);assert.equal(f.activate().blocked,true);assert.equal(f.activations,0);
  const elsewhere={tag:'other-control'};f.doc.activeElement=elsewhere;f.view.render({cards});assert.equal(f.doc.activeElement,elsewhere);assert.equal(f.focusCalls,calls);f.view.cleanup();
 }
});
test('refresh completion, failure and cleanup never steal focus after the user moves or navigates away',()=>{
 for(const completion of [{},{status:'Kunne ikke opdatere · viser seneste udvalg.'}]){
  const f=refreshFocusSurface(),cards=resultCards();f.view.render({cards});f.refresh.focus();f.view.render({cards,busy:true});const calls=f.focusCalls,elsewhere={tag:'different-control'};
  f.doc.activeElement=elsewhere;f.view.render({cards,...completion});assert.equal(f.doc.activeElement,elsewhere);f.host.state.focus='now';f.doc.activeElement=f.doc.body;f.view.render({cards,...completion});assert.equal(f.doc.activeElement,f.doc.body);f.view.cleanup();assert.equal(f.doc.activeElement,f.doc.body);assert.equal(f.focusCalls,calls);
 }
});
