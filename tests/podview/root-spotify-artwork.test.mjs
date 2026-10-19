import test from 'node:test';
import assert from 'node:assert/strict';
import {spotifyArtwork,spotifyItemUrl,spotifyTrackUrl,renderSpotifyArtwork,renderRetainedArtwork,cancelArtwork} from '../../podvoice/gatekeeper/static/podview/spotify-artwork.js';
const art={kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/ab67616d0000b273abc'};
const uri='spotify:track:0123456789ABCDEFGHIJKL';
test('closed artwork allowlist rejects noncanonical ports, credentials, paths and executable extensions',()=>{
 assert.deepEqual(spotifyArtwork(art),art);
 for(const url of ['http://i.scdn.co/image/abc','https://i.scdn.co:443/image/abc','https://user@i.scdn.co/image/abc','https://i.scdn.co/image/abc?x=1','https://i.scdn.co/image/abc#x','https://other.example/image/abc','https://i.scdn.co/image/%61bc','https://i.scdn.co/image/../abc','https://i.scdn.co/image/abc.svg','data:image/png;base64,xxx'])assert.equal(spotifyArtwork({...art,url}),null,url);
 assert.equal(spotifyArtwork({...art,html:'<script>'}),null);assert.equal(spotifyArtwork({...art,provider:'model'}),null);
});
test('provider links require canonical source IDs and grant no playback authority',()=>{
 assert.equal(spotifyTrackUrl(uri),'https://open.spotify.com/track/0123456789ABCDEFGHIJKL');
 assert.equal(spotifyItemUrl(uri.replace('track','episode')),'https://open.spotify.com/episode/0123456789ABCDEFGHIJKL');
 for(const value of ['spotify:track:abc','spotify:track:0123456789ABCDEFGHIJKL?play=1','https://spotify.com/fake',null])assert.equal(spotifyItemUrl(value),null);
 assert.equal(spotifyTrackUrl(uri.replace('track','episode')),null);
});
function image(){const attrs=new Map(),classes=new Set(),events=new Map();return {dataset:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},getAttribute:k=>attrs.get(k),set src(v){attrs.set('src',v);},get src(){return attrs.get('src');},addEventListener:(type,fn)=>events.set(type,fn),error:()=>events.get('error')()};}
test('current identity uses actual art; failed image keeps source identity and does not retry forever',()=>{
 const node=image(),track={uri,name:'Source song',artwork:art};assert.equal(renderSpotifyArtwork(node,track),true);assert.equal(node.src,art.url);assert.match(node.alt,/Source song/);
 node.error();assert.equal(node.src,'assets/icons/music-note-beamed.svg');assert.equal(renderSpotifyArtwork(node,track),false);assert.equal(node.src,'assets/icons/music-note-beamed.svg');
 assert.equal(renderSpotifyArtwork(node,{...track,uri:uri.replace(/L$/,'M')}),true);assert.equal(node.src,art.url);
 assert.equal(renderSpotifyArtwork(node,{...track,artwork:undefined}),false);assert.equal(node.src,'assets/icons/music-note-beamed.svg');
 assert.equal(renderSpotifyArtwork(node,{...track,uri:'spotify:track:abc'}),false);
});

function decodingImage(){
 const probes=[],node=image();let writes=0;const descriptor=Object.getOwnPropertyDescriptor(node,'src');Object.defineProperty(node,'src',{get:descriptor.get,set(value){writes++;descriptor.set(value);}});
 class Probe{constructor(){probes.push(this);this.done=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}decode(){return this.done;}removeAttribute(name){if(name==='src')this.src=null;}}
 node.ownerDocument={defaultView:{Image:Probe}};return {node,probes,writes:()=>writes};
}
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test('first artwork keeps the existing fallback geometry until decoding completes; repeated snapshots do not restart it',async()=>{
 const {node,probes,writes}=decodingImage(),track={uri,name:'Actual source',artwork:art};
 assert.equal(renderSpotifyArtwork(node,track),true);assert.equal(node.src,'assets/icons/music-note-beamed.svg');assert.equal(node.dataset.artworkPending,'true');
 renderSpotifyArtwork(node,track);assert.equal(probes.length,1);assert.equal(writes(),1);
 probes[0].onload();await flush();assert.equal(node.src,'assets/icons/music-note-beamed.svg');probes[0].resolve();await flush();
 assert.equal(node.src,art.url);assert.equal(node.dataset.artworkPending,undefined);assert.equal(node.artworkRequest,null);assert.equal(node.classList.contains('spotify-artwork'),true);
 const before=writes();renderSpotifyArtwork(node,track);renderSpotifyArtwork(node,{...track,name:'Updated title'});assert.equal(writes(),before);assert.equal(probes.length,1);assert.equal(node.alt,'Albumomslag til Updated title');
});
test('replacement is decoded in the background and a late older load cannot replace the newest artwork',async()=>{
 const {node,probes}=decodingImage();node.src='assets/kitchen.png';node.dataset.artworkContent='same-playlist';
 renderRetainedArtwork(node,{url:'assets/lake.png',identity:'lake',contentIdentity:'same-playlist',label:'Lake'});const oldLoad=probes[0].onload;
 renderRetainedArtwork(node,{url:'assets/indie.png',identity:'indie',contentIdentity:'same-playlist',label:'Indie'});assert.equal(node.src,'assets/kitchen.png');assert.equal(probes[0].src,null);assert.equal(probes[0].onerror,null);
 oldLoad();probes[0].resolve();await flush();assert.equal(node.src,'assets/kitchen.png');
 probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,'assets/indie.png');assert.equal(node.alt,'Indie');assert.equal(node.classList.contains('spotify-artwork'),false);
});
test('decode failure becomes one honest missing cover and never retries the failed identity on snapshot refresh',async()=>{
 const {node,probes}=decodingImage(),track={uri,name:'Actual',artwork:art};renderSpotifyArtwork(node,track);
 probes[0].onload();probes[0].reject(new Error('undecodable'));await flush();assert.equal(node.src,'assets/icons/music-note-beamed.svg');assert.equal(node.dataset.artworkPending,undefined);
 assert.equal(renderSpotifyArtwork(node,track),false);assert.equal(probes.length,1);
 assert.equal(renderSpotifyArtwork(node,{...track,uri:uri.replace(/L$/,'M')}),true);assert.equal(probes.length,2);
});
test('disconnect cancellation and missing source invalidate delayed decodes without mutating the retained image',async()=>{
 for(const invalidate of [cancelArtwork,node=>renderSpotifyArtwork(node,null)]){
  const {node,probes}=decodingImage();renderSpotifyArtwork(node,{uri,name:'Actual',artwork:art});probes[0].onload();await flush();invalidate(node);const before=node.src;
  probes[0].resolve();await flush();assert.equal(node.src,before);assert.equal(node.dataset.artworkPending,undefined);assert.equal(node.artworkRequest,null);assert.equal(probes[0].onload,null);assert.equal(probes[0].onerror,null);
 }
});
test('a failed old visible image does not cancel a newer decode already in progress',async()=>{
 const {node,probes}=decodingImage();renderRetainedArtwork(node,{url:'assets/kitchen.png',identity:'kitchen',contentIdentity:'same-playlist',label:'Kitchen'});probes[0].onload();probes[0].resolve();await flush();
 renderRetainedArtwork(node,{url:'assets/lake.png',identity:'lake',contentIdentity:'same-playlist',label:'Lake'});node.error();assert.equal(node.dataset.failedArtwork,'kitchen');assert.equal(node.dataset.artworkPending,'true');
 probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,'assets/lake.png');assert.equal(node.alt,'Lake');
});

test('new playlist identity clears old artwork immediately even when image URL is unchanged',async()=>{
 const {node,probes}=decodingImage(),url='assets/kitchen.png';renderRetainedArtwork(node,{url,identity:'art-one',contentIdentity:'playlist-one',label:'One'});probes[0].onload();probes[0].resolve();await flush();assert.equal(node.src,url);
 renderRetainedArtwork(node,{url,identity:'art-two',contentIdentity:'playlist-two',label:'Two'});assert.equal(node.src,'assets/icons/music-note-beamed.svg');assert.equal(node.dataset.artworkPending,'true');assert.equal(node.dataset.displayedArtwork,undefined);assert.equal(probes.length,2);
 probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,url);assert.equal(node.alt,'Two');
});
test('same playlist changed image retains its own cover until decode while changed account clears it',async()=>{
 const {node,probes}=decodingImage();renderRetainedArtwork(node,{url:'assets/kitchen.png',identity:'one',contentIdentity:'account-one|playlist',label:'One'});probes[0].onload();probes[0].resolve();await flush();
 renderRetainedArtwork(node,{url:'assets/lake.png',identity:'two',contentIdentity:'account-one|playlist',label:'Two'});assert.equal(node.src,'assets/kitchen.png');const late=probes[1].onload;
 renderRetainedArtwork(node,{url:'assets/indie.png',identity:'three',contentIdentity:'account-two|playlist',label:'Three'});assert.equal(node.src,'assets/icons/music-note-beamed.svg');late();probes[1].resolve();await flush();assert.equal(node.src,'assets/icons/music-note-beamed.svg');probes[2].onload();probes[2].resolve();await flush();assert.equal(node.src,'assets/indie.png');
});

test('unchanged successful artwork performs no source, attribute, class or dataset DOM writes',async()=>{
 const {node,probes,writes}=decodingImage(),track={uri,name:'Actual source',artwork:art};renderSpotifyArtwork(node,track);probes[0].onload();probes[0].resolve();await flush();let mutations=0;
 node.dataset=new Proxy(node.dataset,{set(target,key,value){mutations++;target[key]=value;return true;},deleteProperty(target,key){mutations++;delete target[key];return true;}});
 for(const key of ['alt','referrerPolicy','decoding']){let value=node[key];Object.defineProperty(node,key,{get:()=>value,set(next){mutations++;value=next;}});}
 for(const key of ['add','remove']){const original=node.classList[key];node.classList[key]=(...names)=>{mutations++;return original(...names);};}
 const before=writes();renderSpotifyArtwork(node,track);renderSpotifyArtwork(node,track);assert.equal(writes(),before);assert.equal(mutations,0);assert.equal(probes.length,1);
});

function motionImage({systemReduced=false,kitReduced=false,shadowReduced=false}={}){
 const f=decodingImage(),animations=[];f.node.ownerDocument.defaultView.matchMedia=query=>({matches:systemReduced&&query==='(prefers-reduced-motion: reduce)'});f.node.closest=selector=>kitReduced&&selector==='[data-motion="reduced"]'?{}:null;f.node.getRootNode=()=>({host:{dataset:{motion:shadowReduced?'reduced':'normal'}}});
 f.node.animate=(frames,options)=>{let resolve,reject;const animation={frames,options,cancelled:false,finished:new Promise((done,fail)=>{resolve=done;reject=fail;}),cancel(){this.cancelled=true;reject(new Error('cancelled'));},finish(){resolve();}};animations.push(animation);return animation;};return {...f,animations};
}
test('only a newly decoded image receives one bounded ready fade; identical snapshots do not restart it',async()=>{
 const {node,probes,animations}=motionImage(),track={uri,name:'Actual',artwork:art};renderSpotifyArtwork(node,track);assert.equal(animations.length,0);probes[0].onload();await flush();assert.equal(animations.length,0);probes[0].resolve();await flush();
 assert.equal(animations.length,1);assert.deepEqual(animations[0].frames,[{opacity:0},{opacity:1}]);assert.equal(animations[0].options.duration,180);assert.equal(animations[0].options.iterations,1);assert.equal(animations[0].options.fill,undefined);assert.equal(node.src,art.url);
 renderSpotifyArtwork(node,track);renderSpotifyArtwork(node,track);assert.equal(animations.length,1);assert.equal(animations[0].cancelled,false);animations[0].finish();await flush();assert.equal(node.artworkAnimation,null);assert.equal(node.src,art.url);
});
test('superseding image content and disconnect cancel any running ready fade without affecting newer ownership',async()=>{
 const {node,probes,animations}=motionImage(),first={uri,name:'First',artwork:art};renderSpotifyArtwork(node,first);probes[0].onload();probes[0].resolve();await flush();
 renderSpotifyArtwork(node,{...first,uri:uri.replace(/L$/,'M')});assert.equal(animations[0].cancelled,true);assert.equal(node.src,'assets/icons/music-note-beamed.svg');probes[1].onload();probes[1].resolve();await flush();assert.equal(animations.length,2);assert.equal(node.artworkAnimation,animations[1]);
 await flush();assert.equal(node.artworkAnimation,animations[1]);cancelArtwork(node);assert.equal(animations[1].cancelled,true);assert.equal(node.artworkAnimation,null);await flush();assert.equal(node.src,art.url);
});
test('system, kit and shadow-host reduced motion keep the decoded image immediately visible without optional fade',async()=>{
 for(const preferences of [{systemReduced:true},{kitReduced:true},{shadowReduced:true}]){
  const {node,probes,animations}=motionImage(preferences);renderSpotifyArtwork(node,{uri,name:'Actual',artwork:art});probes[0].onload();probes[0].resolve();await flush();assert.equal(node.src,art.url);assert.equal(animations.length,0);assert.equal(node.dataset.artworkPending,undefined);
 }
});

test('a displayed image failure cancels its ready fade before showing the honest missing cover',async()=>{
 const {node,probes,animations}=motionImage();renderSpotifyArtwork(node,{uri,name:'Actual',artwork:art});probes[0].onload();probes[0].resolve();await flush();node.error();assert.equal(animations[0].cancelled,true);assert.equal(node.artworkAnimation,null);assert.equal(node.src,'assets/icons/music-note-beamed.svg');await flush();assert.equal(node.src,'assets/icons/music-note-beamed.svg');
});
