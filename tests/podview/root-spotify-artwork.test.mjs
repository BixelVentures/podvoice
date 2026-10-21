import test from 'node:test';
import assert from 'node:assert/strict';
import {generatedMoodArtwork,spotifyArtwork,spotifyItemUrl,spotifyTrackUrl,renderSpotifyArtwork,renderRetainedArtwork,cancelArtwork} from '../../podvoice/gatekeeper/static/podview/spotify-artwork.js';
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
 const {node,probes}=decodingImage();node.src='assets/kitchen.webp';node.dataset.artworkContent='same-playlist';
 renderRetainedArtwork(node,{url:'assets/lake.webp',identity:'lake',contentIdentity:'same-playlist',label:'Lake'});const oldLoad=probes[0].onload;
 renderRetainedArtwork(node,{url:'assets/indie.webp',identity:'indie',contentIdentity:'same-playlist',label:'Indie'});assert.equal(node.src,'assets/kitchen.webp');assert.equal(probes[0].src,null);assert.equal(probes[0].onerror,null);
 oldLoad();probes[0].resolve();await flush();assert.equal(node.src,'assets/kitchen.webp');
 probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,'assets/indie.webp');assert.equal(node.alt,'Indie');assert.equal(node.classList.contains('spotify-artwork'),false);
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
 const {node,probes}=decodingImage();renderRetainedArtwork(node,{url:'assets/kitchen.webp',identity:'kitchen',contentIdentity:'same-playlist',label:'Kitchen'});probes[0].onload();probes[0].resolve();await flush();
 renderRetainedArtwork(node,{url:'assets/lake.webp',identity:'lake',contentIdentity:'same-playlist',label:'Lake'});node.error();assert.equal(node.dataset.failedArtwork,'kitchen');assert.equal(node.dataset.artworkPending,'true');
 probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,'assets/lake.webp');assert.equal(node.alt,'Lake');
});

test('new playlist identity clears old artwork immediately even when image URL is unchanged',async()=>{
 const {node,probes}=decodingImage(),url='assets/kitchen.webp';renderRetainedArtwork(node,{url,identity:'art-one',contentIdentity:'playlist-one',label:'One'});probes[0].onload();probes[0].resolve();await flush();assert.equal(node.src,url);
 renderRetainedArtwork(node,{url,identity:'art-two',contentIdentity:'playlist-two',label:'Two'});assert.equal(node.src,'assets/icons/music-note-beamed.svg');assert.equal(node.dataset.artworkPending,'true');assert.equal(node.dataset.displayedArtwork,undefined);assert.equal(probes.length,2);
 probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,url);assert.equal(node.alt,'Two');
});
test('same playlist changed image retains its own cover until decode while changed account clears it',async()=>{
 const {node,probes}=decodingImage();renderRetainedArtwork(node,{url:'assets/kitchen.webp',identity:'one',contentIdentity:'account-one|playlist',label:'One'});probes[0].onload();probes[0].resolve();await flush();
 renderRetainedArtwork(node,{url:'assets/lake.webp',identity:'two',contentIdentity:'account-one|playlist',label:'Two'});assert.equal(node.src,'assets/kitchen.webp');const late=probes[1].onload;
 renderRetainedArtwork(node,{url:'assets/indie.webp',identity:'three',contentIdentity:'account-two|playlist',label:'Three'});assert.equal(node.src,'assets/icons/music-note-beamed.svg');late();probes[1].resolve();await flush();assert.equal(node.src,'assets/icons/music-note-beamed.svg');probes[2].onload();probes[2].resolve();await flush();assert.equal(node.src,'assets/indie.webp');
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
 assert.equal(animations.length,1);assert.deepEqual(animations[0].frames,[{opacity:0},{opacity:1}]);assert.equal(animations[0].options.duration,120);assert.equal(animations[0].options.iterations,1);assert.equal(animations[0].options.fill,undefined);assert.equal(node.src,art.url);
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

test('playlist cover is an optional closed source image bound only to an exact playlist URI; track and episode admission stays unchanged',()=>{const playlist=uri.replace('track','playlist'),cover={...art,kind:'playlist_cover'};assert.deepEqual(spotifyArtwork(cover,playlist),cover);for(const id of [undefined,uri,uri.replace('track','episode'),'spotify:playlist:short',playlist+'?play=1'])assert.equal(spotifyArtwork(cover,id),null);assert.equal(spotifyArtwork(art,playlist),null);assert.deepEqual(spotifyArtwork(art,uri),art);assert.deepEqual(spotifyArtwork(art,uri.replace('track','episode')),art);assert.equal(spotifyItemUrl(playlist),null);for(const change of [a=>a.provider='model',a=>a.html='<img>',a=>a.url='https://image-cdn-ak.spotifycdn.com/image/abc',a=>a.url+='?v=1',a=>a.url='http://i.scdn.co/image/abc']){const value={...cover};change(value);assert.equal(spotifyArtwork(value,playlist),null);}const node=image();assert.equal(renderSpotifyArtwork(node,{uri:playlist,name:'Actual playlist',artwork:cover}),true);assert.equal(node.src,cover.url);assert.equal(node.alt,'Playlisteomslag til Actual playlist');});

test('real playlist cover uses the same retained decode lifecycle, keeps unchanged identity and rejects late older playlist art',async()=>{const {node,probes,writes}=decodingImage(),playlist=uri.replace('track','playlist'),cover={...art,kind:'playlist_cover'};renderSpotifyArtwork(node,{uri:playlist,name:'Actual playlist',artwork:cover});assert.equal(probes.length,1);assert.equal(node.src,'assets/icons/music-note-beamed.svg');probes[0].onload();probes[0].resolve();await flush();assert.equal(node.src,cover.url);const before=writes();renderSpotifyArtwork(node,{uri:playlist,name:'Actual playlist',artwork:cover});assert.equal(writes(),before);assert.equal(probes.length,1);const second=playlist.replace(/L$/,'M'),third=playlist.replace(/L$/,'N');renderSpotifyArtwork(node,{uri:second,name:'Second',artwork:cover});assert.equal(node.src,'assets/icons/music-note-beamed.svg','new playlist never shows old playlist cover');const late=probes[1].onload;renderSpotifyArtwork(node,{uri:third,name:'Third',artwork:{...cover,url:'https://i.scdn.co/image/third'}});late();probes[1].resolve();await flush();assert.notEqual(node.src,cover.url);probes[2].onload();probes[2].resolve();await flush();assert.equal(node.src,'https://i.scdn.co/image/third');assert.equal(node.alt,'Playlisteomslag til Third');});

test('failed admitted playlist cover decodes one owned illustration without retrying the primary on refresh',async()=>{
 const {node,probes,writes,animations}=motionImage(),playlist={uri:'spotify:playlist:0123456789ABCDEFGHIJKL',name:'Actual list',artwork:{...art,kind:'playlist_cover'},fallbackArt:'assets/kitchen.webp',fallbackLabel:'Illustration til madlavning'};
 renderSpotifyArtwork(node,playlist);assert.equal(probes[0].src,art.url);probes[0].onerror();assert.equal(probes.length,2);assert.equal(probes[1].src,'assets/kitchen.webp');assert.equal(node.src,'assets/icons/music-note-beamed.svg');
 renderSpotifyArtwork(node,playlist);assert.equal(probes.length,2,'poll does not restart fallback or provider');probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,'assets/kitchen.webp');assert.equal(node.alt,'Illustration til madlavning');assert.equal(node.classList.contains('spotify-artwork'),false);assert.equal(animations.length,1);
 const before=writes();renderSpotifyArtwork(node,playlist);renderSpotifyArtwork(node,playlist);assert.equal(writes(),before);assert.equal(probes.length,2);assert.equal(animations.length,1);
});
test('provider decode and owned fallback failures are both latched without a retry loop',async()=>{
 const {node,probes}=decodingImage(),playlist={uri:'spotify:playlist:0123456789ABCDEFGHIJKL',artwork:{...art,kind:'playlist_cover'},fallbackArt:'assets/lake.webp'};
 renderSpotifyArtwork(node,playlist);probes[0].onload();probes[0].reject(Error('invalid cover'));await flush();assert.equal(probes.length,2);probes[1].onerror();for(let i=0;i<5;i++)renderSpotifyArtwork(node,playlist);assert.equal(probes.length,2);assert.equal(node.src,'assets/icons/music-note-beamed.svg');assert.equal(node.dataset.artworkPending,undefined);
});
test('visible source failure uses the current backup while cancelled or superseded loads cannot revive it',async()=>{
 for(const mode of ['visible','new-content','disconnect']){
  const {node,probes}=decodingImage(),playlist={uri:'spotify:playlist:0123456789ABCDEFGHIJKL',artwork:{...art,kind:'playlist_cover'},fallbackArt:'assets/kitchen.webp'};
  renderSpotifyArtwork(node,playlist);probes[0].onload();probes[0].resolve();await flush();node.error();assert.equal(probes.length,2);const late=probes[1].onload;
  if(mode==='new-content')renderSpotifyArtwork(node,{...playlist,uri:playlist.uri.replace(/L$/,'M'),fallbackArt:'assets/lake.webp'});
  if(mode==='disconnect')cancelArtwork(node);
  late();probes[1].resolve();await flush();assert.equal(node.src,mode==='visible'?'assets/kitchen.webp':'assets/icons/music-note-beamed.svg');
  if(mode==='new-content'){probes[2].onload();probes[2].resolve();await flush();assert.equal(node.src,art.url);}
 }
});
test('fallback admission cannot turn a track or invalid owned path into another image request',()=>{
 for(const fallbackArt of ['https://evil.example/image/abc','assets/indie.webp','assets/../kitchen.png','assets/not-owned.png']){
  const {node,probes}=decodingImage();renderSpotifyArtwork(node,{uri:'spotify:playlist:0123456789ABCDEFGHIJKL',artwork:{...art,kind:'playlist_cover'},fallbackArt});probes[0].onerror();assert.equal(probes.length,1);assert.equal(node.src,'assets/icons/music-note-beamed.svg');
 }
 const {node,probes}=decodingImage();renderSpotifyArtwork(node,{uri,artwork:art,fallbackArt:'assets/kitchen.webp'});probes[0].onerror();assert.equal(probes.length,1,'track covers do not become themed illustrations');
});


test('quiet same-option refresh retains its accepted image through replacement failure and missing art without retry loops',async()=>{
 const {node,probes}=decodingImage(),first={url:'assets/kitchen.webp',identity:'accepted',contentIdentity:'same-option',label:'Morgen',quiet:true};renderRetainedArtwork(node,first);probes[0].onload();probes[0].resolve();await flush();assert.equal(node.src,first.url);
 const next={...first,url:'assets/lake.webp',identity:'replacement',backup:{url:'assets/indie.webp',identity:'backup',label:'Alternativ'}};renderRetainedArtwork(node,next);assert.equal(node.src,first.url);assert.equal(node.dataset.artworkPending,'true');probes[1].onerror();assert.equal(node.src,first.url);assert.equal(node.dataset.artworkPending,undefined);for(let i=0;i<3;i++)renderRetainedArtwork(node,next);assert.equal(probes.length,2);assert.equal(node.src,first.url);renderRetainedArtwork(node,{...first,url:undefined,identity:''});assert.equal(node.src,first.url);assert.equal(node.classList.contains('live-art-fallback'),false);
});
test('quiet decoded exact URLs can be reused immediately while a different option never borrows unrequested artwork',async()=>{
 const {node,probes}=decodingImage(),first={url:'assets/kitchen.webp',identity:'first-art',contentIdentity:'first-option',label:'Første',quiet:true};renderRetainedArtwork(node,first);probes[0].onload();probes[0].resolve();await flush();const second=image();second.ownerDocument=node.ownerDocument;renderRetainedArtwork(second,{...first,identity:'second-art',contentIdentity:'first-option',label:'Andet'});assert.equal(second.src,first.url);assert.equal(second.alt,'Andet');assert.equal(Boolean(second.artworkRequest),false);assert.equal(second.dataset.artworkPending,undefined);assert.equal(probes.length,1);
 renderRetainedArtwork(second,{url:'assets/lake.webp',identity:'third-art',contentIdentity:'third-option',label:'Tredje',quiet:true});assert.equal(second.src,'assets/icons/music-note-beamed.svg');assert.equal(second.dataset.displayedArtwork,undefined);assert.equal(second.dataset.artworkQuiet,'true');assert.equal(probes.length,2);
});
test('quiet superseded decode cannot restore an earlier option and cleanup cancels the in-flight replacement',async()=>{
 const {node,probes}=decodingImage();renderRetainedArtwork(node,{url:'assets/kitchen.webp',identity:'one',contentIdentity:'one',label:'Et',quiet:true});const late=probes[0].onload;renderRetainedArtwork(node,{url:'assets/lake.webp',identity:'two',contentIdentity:'two',label:'To',quiet:true});late();probes[0].resolve();await flush();assert.equal(node.dataset.displayedArtwork,undefined);assert.equal(node.dataset.artworkContent,'two');cancelArtwork(node);probes[1].resolve();await flush();assert.equal(node.dataset.displayedArtwork,undefined);assert.equal(node.artworkRequest,null);assert.equal(node.dataset.artworkPending,undefined);
});
test('quiet artwork reveals immediately after decode with all motion disabled',async()=>{
 const {node,probes,animations}=motionImage({systemReduced:true});renderRetainedArtwork(node,{url:'assets/kitchen.webp',identity:'quiet',contentIdentity:'quiet-option',label:'Rolig',quiet:true});probes[0].onload();probes[0].resolve();await flush();assert.equal(node.src,'assets/kitchen.webp');assert.equal(animations.length,0);assert.equal(node.dataset.artworkPending,undefined);
});


test('generated mood art admits only an exact closed mood directory and lowercase immutable digest',()=>{
 const digest='a1'.repeat(32);
 for(const id of ['morning_acoustic','evening_jazz','cooking','italian','indie','calm'])assert.equal(generatedMoodArtwork(`theme-art/${id}/${digest}.webp`,id),`theme-art/${id}/${digest}.webp`);
 const valid=`theme-art/cooking/${digest}.webp`;
 for(const value of [undefined,null,'',`theme-art/unknown/${digest}.webp`,`theme-art/italian/${digest}.webp`,valid.toUpperCase(),valid+'?cache=1',valid+'#art',valid+'/',valid.replace('.webp','.png'),valid.replace(digest,'a'.repeat(63)),valid.replace(digest,'a'.repeat(65)),'/'+valid,'/view/'+valid,'https://example.test/view/'+valid,'//example.test/'+valid,'../'+valid,valid.replace('/cooking/','/cooking/../cooking/'),valid.replace('/cooking/','/cooking%2f/'),valid.replace('/cooking/','/cooking%2F/'),valid.replace('/cooking/','/cooking\\/'),valid.replace('/cooking/','/cooking//')])assert.equal(generatedMoodArtwork(value,'cooking'),null,String(value));
 assert.equal(generatedMoodArtwork(valid,'unknown'),null);assert.equal(generatedMoodArtwork(valid,'italian'),null);
});

test('generated thematic fallback follows an actual failed playlist cover, never replaces track album art',async()=>{
 const path='theme-art/cooking/'+'c'.repeat(64)+'.webp',playlist={uri:'spotify:playlist:0123456789ABCDEFGHIJKL',name:'Actual playlist',themeId:'cooking',artwork:{...art,kind:'playlist_cover'},fallbackArt:path,fallbackLabel:'Illustration til madlavning'};
 const {node,probes}=decodingImage();renderSpotifyArtwork(node,playlist,playlist.uri,true);assert.equal(probes[0].src,art.url);probes[0].onerror();assert.equal(probes[1].src,path);probes[1].onload();probes[1].resolve();await flush();assert.equal(node.src,path);assert.equal(node.alt,'Illustration til madlavning');assert.equal(node.classList.contains('spotify-artwork'),false);
 for(const item of [{...playlist,themeId:'italian'},{...playlist,uri,artwork:art}]){const f=decodingImage();renderSpotifyArtwork(f.node,item);f.probes[0].onerror();assert.equal(f.probes.length,1);assert.equal(f.node.src,'assets/icons/music-note-beamed.svg');}
});
