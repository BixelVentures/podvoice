import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderRetainedArtwork,cancelArtwork,spotifyArtwork,spotifyItemUrl} from '../../podvoice/gatekeeper/static/podview/spotify-artwork.js';
import {fixtureArtwork,renderOverviewMediaValues} from '../../podvoice/gatekeeper/static/podview/music-results.js';
import {radioStation,localRadioPlayerModel} from '../../podvoice/gatekeeper/static/podview/radio-model.js';
import {localPlayerModel} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {initialScene} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {liveScene,liveLocalEvent,liveTimerRequest} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {vehicleFixture,vehicleModel} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderOverviewMediaCards('),end=source.indexOf('\n renderOverviewFacts(',start);
const method=source.slice(start,end).trim();
function fixture({live=false,vm=localPlayerModel(initialScene()),state=initialScene(),radioSize='m'}={}){
 const probes=[],writes=[];class Probe{constructor(){probes.push(this);}decode(){return Promise.resolve();}removeAttribute(){this.src=null;}}
 const doc={defaultView:{Image:Probe},createElement:()=>({textContent:'',hidden:false,className:''})};
 const cards=new Map();for(const id of ['home-music','home-radio','home-vehicle']){
  const attrs=new Map(),classes=new Set(),image={ownerDocument:doc,dataset:{},alt:'',classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)},getAttribute:k=>attrs.get(k)??null,set src(v){writes.push(v);attrs.set('src',v);},get src(){return attrs.get('src');},addEventListener(){}};
  image.src=`assets/icons/${id==='home-radio'?'boombox':id==='home-vehicle'?'car-front':'music-note-beamed'}.svg`;
  const heading={textContent:id==='home-music'?'Find musik':id==='home-radio'?'Radio':'Tesla'},small={textContent:'',hidden:false,dataset:{}},label={querySelector:()=>label.value||null,append:value=>label.value=value};
  const card={ownerDocument:doc,dataset:id==='home-radio'?{kitSize:radioSize}:{},image,heading,small,label,querySelector:selector=>selector===':scope>img:first-child'?image:selector==='strong'?heading:selector==='small'?small:selector===':scope>span'?label:null};cards.set(id,card);
 }
 const render=new Function('$','spotifyArtwork','spotifyItemUrl','renderRetainedArtwork','cancelArtwork','fixtureArtwork','radioStation','projectVehicle',`return function ${method}`)(id=>cards.get(id),spotifyArtwork,spotifyItemUrl,renderRetainedArtwork,cancelArtwork,fixtureArtwork,radioStation,vehicleModel);
 doc.getElementById=id=>cards.get(id);const host={live,state,liveTransport:live?{connected:state.connected}:undefined,ownerDocument:doc,playerView:{progressVM:vm}};return {cards,host,probes,writes,render:vehicle=>render.call(host,vehicle??vehicleFixture({charging:true}))};
}
const flush=async()=>{for(let i=0;i<7;i++)await Promise.resolve();};
test('M music retains source-owned cover/title/artist and decodes once across unchanged updates',async()=>{
 const f=fixture(),card=f.cards.get('home-music'),image=card.image;f.render();assert.equal(card.dataset.mediaLayout,'media');assert.equal(card.heading.textContent,f.host.playerView.progressVM.title);assert.equal(card.small.textContent,f.host.playerView.progressVM.artist);assert.equal(f.probes.length,1);assert.equal(image.src,'assets/icons/music-note-beamed.svg');
 f.probes[0].onload();await flush();assert.equal(image.src,fixtureArtwork(f.host.playerView.progressVM.fixtureArt));assert.match(image.alt,/Albumomslag/);const before=f.writes.length;f.render();f.render();assert.equal(f.probes.length,1);assert.equal(f.writes.length,before);assert.strictEqual(card.image,image);
});
test('M radio only uses its selected known station logo; empty and unmatched rows keep the station icon',async()=>{
 const state={...initialScene(),radioStationId:'p3'},vm=localRadioPlayerModel('p3',{}, {playing:true}),f=fixture({state,vm}),card=f.cards.get('home-radio');f.render();assert.equal(card.heading.textContent,'P3');assert.equal(card.small.textContent,'Direkte radio');assert.equal(f.probes[0].src,'assets/radio-p3.svg');f.probes[0].onload();await flush();assert.equal(card.image.src,'assets/radio-p3.svg');
 f.host.playerView.progressVM={...vm,title:'Unknown station',fixtureArt:'assets/radio-p1.svg'};f.render();assert.equal(card.image.src,'assets/icons/boombox.svg');assert.equal(f.probes.length,1);const before=f.writes.length;f.render();assert.equal(f.writes.length,before);
 f.host.playerView.progressVM={active:false};f.render();assert.equal(card.heading.textContent,'Radio');assert.equal(card.small.textContent,'Vælg station');assert.equal(card.image.dataset.displayedArtwork,undefined);
});
test('live artwork admission ignores local paths and arbitrary URLs, and clearing cancels a pending older decode',async()=>{
 const vm={active:true,title:'Observed song',artist:'Observed artist',uri:'spotify:track:0123456789ABCDEFGHIJKL',fixtureArt:'assets/kitchen.webp',artwork:{kind:'album_cover',provider:'spotify',url:'https://other.example/image/a'}},f=fixture({live:true,vm});f.render();assert.equal(f.probes.length,0);assert.equal(f.cards.get('home-music').image.src,'assets/icons/music-note-beamed.svg');
 f.host.playerView.progressVM={...vm,uri:'spotify:track:unbound',artwork:{...vm.artwork,url:'https://i.scdn.co/image/actual'}};f.render();assert.equal(f.probes.length,0,'valid CDN path never grants an invalid source identity');
 f.host.playerView.progressVM={...vm,artwork:{...vm.artwork,url:'https://i.scdn.co/image/actual'}};f.render();assert.equal(f.probes.length,1);const late=f.probes[0].onload;f.host.playerView.progressVM={active:false};f.render();assert.equal(f.probes[0].src,null);late();await flush();assert.equal(f.cards.get('home-music').image.src,'assets/icons/music-note-beamed.svg');assert.equal(f.cards.get('home-music').heading.textContent,'Find musik');
});
test('S Tesla promotes actual bounded battery while empty, invalid and M states keep their honest roles',()=>{
 const f=fixture(),card=f.cards.get('home-vehicle');f.render();const value=card.label.value;assert.equal(value.textContent,'72%');assert.equal(value.hidden,false);assert.equal(card.dataset.hasOverviewValue,'true');
 for(const batteryPercent of [null,NaN,-1,101,'72']){f.render({...vehicleFixture({charging:true}),batteryPercent});assert.equal(value.hidden,true);assert.equal(value.textContent,'');}
 f.render(vehicleModel(null));assert.equal(value.hidden,true);f.render({...vehicleFixture(),batteryPercent:0});assert.equal(value.textContent,'0%');assert.equal(value.hidden,false);card.dataset.kitSize='m';f.render();assert.equal(value.hidden,true);assert.strictEqual(card.label.value,value);
});

test('full media and compact projections have one copy writer across empty/known updates and M to S changes',()=>{
 for(const vm of [{active:false},{active:true,title:'Actual song',artist:'Actual artist',playing:true,fresh:true}]){
  const f=fixture({live:true,vm}),card=f.cards.get('home-music');let mutations=0,text=card.small.textContent;Object.defineProperty(card.small,'textContent',{get:()=>text,set:value=>{mutations++;text=value;}});
  const update=()=>{f.render();renderOverviewMediaValues(f.host);};update();const before=mutations;update();update();assert.equal(mutations,before,'M copy cannot alternate with compact metadata');assert.equal(text,vm.active?'Actual artist':'Vælg musik');
  card.dataset.kitSize='s';update();assert.equal(card.dataset.mediaLayout,'compact');assert.equal(text,vm.active?'Spiller: Actual song\nActual artist':'Ingen seneste afspilning');const compactBefore=mutations;update();assert.equal(mutations,compactBefore);
 }
});

 test('live empty music follows transport readiness, keeps navigation and never enables local command authority',()=>{
 const snapshot={voice:{},timers:{status:'observed',items:[]},capabilities:{}};
 const state=liveScene(initialScene(),snapshot),f=fixture({live:true,state,vm:{active:false}}),card=f.cards.get('home-music');
 assert.equal(state.connected,false,'live scene deliberately cannot authorize the local reducer');
 f.host.liveTransport={connected:true};f.render();
 assert.equal(card.heading.textContent,'Find musik');assert.equal(card.small.textContent,'Vælg musik');
 assert.equal(liveLocalEvent({type:'show',id:'music'},state),true);
 assert.equal(liveTimerRequest(snapshot,true,{type:'timer-start',seconds:60,name:'test'}),null,'a connected transport alone supplies no command capability');
 f.host.liveTransport.connected=false;f.render();assert.equal(card.small.textContent,'Ikke forbundet');
 assert.equal(liveLocalEvent({type:'show',id:'music'},state),true,'offline navigation remains available');
 f.host.liveTransport.connected=true;f.render();assert.equal(card.small.textContent,'Vælg musik');assert.equal(state.connected,false);
 f.host.playerView.progressVM={active:true,title:'Retained song',artist:'Retained artist',fresh:false};
 f.host.liveTransport.connected=false;f.render();assert.equal(card.heading.textContent,'Retained song');assert.equal(card.small.textContent,'Retained artist');
 assert.equal(f.probes.length,0,'no invented art or provider call');
 });
