import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicResults,sourceMusicCards} from '../../podvoice/gatekeeper/static/podview/music-results.js';
import {LiveMusicCatalogueView} from '../../podvoice/gatekeeper/static/podview/live-music-view.js';
import {MUSIC_THEMES,moodPreview} from '../../podvoice/gatekeeper/static/podview/music-selection-model.js';

const ai='theme-art/cooking/'+'a'.repeat(64)+'.webp';
const cover={kind:'playlist_cover',provider:'spotify',url:'https://i.scdn.co/image/actual'};
const source=extra=>({uri:'spotify:playlist:0123456789ABCDEFGHIJKL',name:'Actual playlist',artist:'Musik til madlavningen',themeTitle:'Musik til madlavningen',themeId:'cooking',...extra});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function surface(){
 const probes=[],records=[];
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.style={};this.textContent='';this.events=new Map();const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)};}
  append(...nodes){for(const n of nodes)this.insertBefore(n,null);}insertBefore(n,before){n.remove();n.parentNode=this;const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,n);}remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return k==='src'?this.src??null:this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}addEventListener(k,fn){this.events.set(k,fn);}querySelector(){return null;}querySelectorAll(){return this.children;}closest(selector){for(let n=this;n;n=n.parentNode)if(selector==='pv-widget-host'&&n.tagName==='PV-WIDGET-HOST')return n;return null;}
 }
 class Probe{constructor(){probes.push(this);this.decoded=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}decode(){return this.decoded;}removeAttribute(){this.cancelled=true;}}
 const doc={defaultView:{Image:Probe},createElement:tag=>{const n=new Node(tag);n.ownerDocument=doc;return n;}},nodes=new Map();for(const id of ['result-list','empty','result-count','response-title','music-refinements','music-refresh','music-response'])nodes.set(id,doc.createElement('div'));
 const host=doc.createElement('pv-widget-host');Object.assign(host,{live:true,state:{focus:'music'},liveTransport:{recordDiagnostic:(stage,fields)=>records.push({stage,...fields})},liveSnapshot:{bootId:'boot',roomId:'room'},liveCatalogue:{account:'one'},querySelector:s=>nodes.get(s.slice(1))});host.append(nodes.get('music-response'));nodes.get('music-response').append(nodes.get('result-list'));const view=new MusicResults(host);
 return {host,view,probes,records,render(row){const cards=sourceMusicCards([row],'mood');view.render({cards,collection:'mood'});return [...view.rows.values()][0].children[0];},async succeed(probe){probe.onload();await flush();probe.resolve();await flush();}};
}

test('cold backend static illustration is preserved and loaded without invented AI artwork',async()=>{
 const f=surface(),row=source({themeArt:'assets/kitchen.png'}),card=sourceMusicCards([row],'mood')[0];assert.equal(card.themeArt,MUSIC_THEMES.cooking[1]);const image=f.render(row);assert.deepEqual(f.probes.map(p=>p.src),['assets/kitchen.webp']);await f.succeed(f.probes[0]);assert.equal(image.src,'assets/kitchen.webp');assert.match(image.alt,/^Illustration til /);assert.doesNotMatch(image.alt,/AI|genereret/i);assert.equal(image.classList.contains('spotify-artwork'),false);f.view.cleanup();
});

test('cold source prefers the real Spotify cover and falls through only to its canonical supplied illustration',async()=>{
 const f=surface(),image=f.render(source({themeArt:'assets/kitchen.webp',artwork:cover}));assert.deepEqual(f.probes.map(p=>p.src),[cover.url]);f.probes[0].onerror(new Event('error'));assert.deepEqual(f.probes.map(p=>p.src),[cover.url,MUSIC_THEMES.cooking[1]]);await f.succeed(f.probes[1]);assert.equal(image.src,MUSIC_THEMES.cooking[1]);f.view.cleanup();
});

test('warm AI error follows actual cover then canonical static fallback, and unchanged renders never retry failed stages',async()=>{
 const f=surface(),row=source({themeArt:ai,artwork:cover}),image=f.render(row);assert.deepEqual(f.probes.map(p=>p.src),[ai]);f.probes[0].onerror(new Event('error'));assert.deepEqual(f.probes.map(p=>p.src),[ai,cover.url]);f.probes[1].onerror(new Event('error'));assert.deepEqual(f.probes.map(p=>p.src),[ai,cover.url,MUSIC_THEMES.cooking[1]]);f.render(row);assert.equal(f.probes.length,3,'same pending fallback cannot restart failed primary');await f.succeed(f.probes[2]);assert.equal(image.src,MUSIC_THEMES.cooking[1]);f.render(row);assert.equal(f.probes.length,3);assert.equal(image.src,MUSIC_THEMES.cooking[1]);assert.deepEqual(f.records,[{stage:'artwork',code:'resource_error'},{stage:'artwork',code:'resource_error'}]);f.view.cleanup();
});

test('every failed admitted stage ends as the honest note without paid generation or repeat image requests',()=>{
 const f=surface(),row=source({themeArt:ai,artwork:cover}),image=f.render(row);for(let i=0;i<3;i++)f.probes[i].onerror(new Event('error'));assert.equal(image.src,'assets/icons/music-note-beamed.svg');for(let i=0;i<3;i++)f.render(row);assert.equal(f.probes.length,3);assert.equal(f.records.length,3);assert.equal(image.dataset.artworkPending,undefined);f.view.cleanup();
});

test('static paths are admitted only for their exact canonical theme and collection',()=>{
 const f=surface();for(const themeArt of ['assets/lake.webp','assets/../kitchen.webp','https://foreign.invalid/kitchen.webp','assets/kitchen.webp?x=1']){const row=source({themeArt});assert.equal(sourceMusicCards([row],'mood')[0].themeArt,undefined);f.render(row);}assert.equal(f.probes.length,0);const feeling=sourceMusicCards([source({themeArt:'assets/kitchen.webp'})],'feeling');assert.equal(feeling[0].themeArt,undefined);f.view.render({cards:feeling,collection:'feeling'});assert.equal(f.probes.length,0);f.view.cleanup();
});

test('account replacement, row removal and cleanup cancel late AI failures before any fallback or diagnostic',async()=>{
 for(const boundary of ['account','remove','cleanup']){const f=surface(),row=source({themeArt:ai,artwork:cover}),image=f.render(row),old=f.probes[0],error=old.onerror;old.onload();await flush();if(boundary==='account'){f.host.liveCatalogue.account='two';f.render(row);}else if(boundary==='remove')f.view.render({cards:[]});else f.view.cleanup();const count=f.probes.length;error(new Event('error'));old.reject(Error('obsolete decode'));await flush();assert.equal(f.probes.length,count,boundary);assert.deepEqual(f.records,[],boundary);assert.equal(image.src,'assets/icons/music-note-beamed.svg');assert.equal(old.cancelled,true);f.view.cleanup();}
});


test('actual catalogue retries a failed same-hash image chain only after a new explicit source read, never render or renewal',()=>{
 const f=surface(),reads=[];f.host.liveSnapshot.capabilities={musicRead:['mood','targets'],musicSelection:true};f.host.liveSnapshot.voice={};f.host.liveTransport.connected=true;f.host.musicResults=f.view;
 const catalogue=new LiveMusicCatalogueView(f.host,kind=>{f.host.liveMusicGeneration=(f.host.liveMusicGeneration||0)+1;reads.push([kind,catalogue.pendingRead.reason]);});f.host.liveCatalogue=catalogue;catalogue.account='one';catalogue.updateCapabilities(true,f.host.liveSnapshot.capabilities.musicRead);
 const body=()=>({ok:true,schema:'podview.mood-preview.v1',preview:{bootId:'boot',roomId:'room',configEntryId:'one',ownerEpoch:'epoch',source:'spotify_web_api',voiceSessionId:null,voiceTurnId:null,readOnly:true,expiresIn:60},data:{config_entry_id:'one',owner_epoch:'epoch',source:'spotify_web_api',tracks:['cooking','italian','calm'].map((themeId,index)=>({uri:'spotify:playlist:'+String(index).padStart(22,'0'),name:'Actual playlist '+index,artist:MUSIC_THEMES[themeId][0],themeTitle:MUSIC_THEMES[themeId][0],themeId,themeArt:'theme-art/'+themeId+'/'+'a'.repeat(64)+'.webp'}))}});
 try{catalogue.select('mood');catalogue.tracks('mood',body(),'one');const cards=catalogue.cards,first=[...f.view.rows.values()][0],before=f.probes.length;assert.equal(cards[0].artworkRetryGeneration,1);f.probes[0].onerror(new Event('error'));f.probes[before].onerror(new Event('error'));const failed=f.probes.length;catalogue.render();catalogue.render();assert.equal(f.probes.length,failed);
  catalogue.refresh();assert.deepEqual(reads,[['mood','initial'],['mood','refresh']]);assert.equal(f.probes.length,failed,'held read does not retry an image');catalogue.tracks('mood',body(),'one');assert.equal(catalogue.cards[0].artworkRetryGeneration,2);assert.equal(catalogue.cards[0].uri,cards[0].uri);assert.equal(catalogue.cards[0].themeArt,cards[0].themeArt);assert.equal(f.probes.length,failed+1,'one retry for the failed row, without changing its URL');assert.equal([...f.view.rows.values()][0],first);catalogue.render();assert.equal(f.probes.length,failed+1);const retained=catalogue.cards;catalogue.beginRead('mood','renew');catalogue.tracks('mood',body(),'one');assert.equal(catalogue.cards,retained);assert.equal(catalogue.cards[0].artworkRetryGeneration,2);assert.equal(f.probes.length,failed+1,'authority renewal does not reset artwork failures');f.probes[failed].onerror(new Event('error'));assert.equal(f.probes.length,failed+2,'retried AI follows static backup once with the same retry key');f.probes[failed+1].onerror(new Event('error'));catalogue.render();assert.equal(f.probes.length,failed+2,'fallback recursion never resets the retry key or failures');
 }finally{clearTimeout(catalogue.expiryTimer);f.view.cleanup();}
});


test('successful same-URI same-URL explicit catalogue refresh retains decoded art and never paints a note or starts another decode',async()=>{
 const f=surface();f.host.liveSnapshot.capabilities={musicRead:['mood','targets'],musicSelection:true};f.host.liveSnapshot.voice={};f.host.liveTransport.connected=true;f.host.musicResults=f.view;const catalogue=new LiveMusicCatalogueView(f.host,()=>{f.host.liveMusicGeneration=(f.host.liveMusicGeneration||0)+1;});f.host.liveCatalogue=catalogue;catalogue.account='one';catalogue.updateCapabilities(true,f.host.liveSnapshot.capabilities.musicRead);
 const body=()=>({ok:true,schema:'podview.mood-preview.v1',preview:{bootId:'boot',roomId:'room',configEntryId:'one',ownerEpoch:'epoch',source:'spotify_web_api',voiceSessionId:null,voiceTurnId:null,readOnly:true,expiresIn:60},data:{config_entry_id:'one',owner_epoch:'epoch',source:'spotify_web_api',tracks:['cooking','italian','calm'].map((themeId,index)=>({uri:'spotify:playlist:'+String(index).padStart(22,'0'),name:'Actual playlist '+index,artist:MUSIC_THEMES[themeId][0],themeTitle:MUSIC_THEMES[themeId][0],themeId,themeArt:'theme-art/'+themeId+'/'+'a'.repeat(64)+'.webp'}))}});
 try{catalogue.select('mood');catalogue.tracks('mood',body(),'one');for(const probe of [...f.probes])await f.succeed(probe);const images=[...f.view.rows.values()].map(row=>row.children[0]),accepted=images.map(image=>image.src),writes=[];images.forEach(image=>{let value=image.src;Object.defineProperty(image,'src',{get:()=>value,set:next=>{writes.push(next);value=next;}});});catalogue.refresh();assert.deepEqual(images.map(image=>image.src),accepted);catalogue.tracks('mood',body(),'one');assert.deepEqual(images.map(image=>image.src),accepted);assert.deepEqual(writes,[],'no fallback, image assignment or visual reset');assert.equal(f.probes.length,3,'accepted images never decode again');assert.ok(images.every(image=>image.dataset.artworkPending===undefined));assert.deepEqual(f.records,[]);
 }finally{clearTimeout(catalogue.expiryTimer);f.view.cleanup();}
});


test('explicit retry of failed AI retains the already accepted static illustration until a real replacement decodes',async()=>{
 const f=surface(),cold=source({themeArt:MUSIC_THEMES.cooking[1]}),image=f.render(cold);await f.succeed(f.probes[0]);const accepted=image.src;let cards=sourceMusicCards([source({themeArt:ai})],'mood').map(card=>({...card,artworkRetryGeneration:1}));f.view.render({cards});assert.equal(image.src,accepted);f.probes[1].onerror(new Event('error'));assert.equal(image.src,accepted);f.view.render({cards});assert.equal(f.probes.length,2);cards=cards.map(card=>({...card,artworkRetryGeneration:2}));f.view.render({cards});assert.equal(f.probes.length,3);assert.equal(f.probes[2].src,ai);assert.equal(image.src,accepted,'an explicit retry never replaces the accepted picture with a note');await f.succeed(f.probes[2]);assert.equal(image.src,ai);f.view.cleanup();
});


const feelingThemes=[['energy','Mere energi','assets/indie.webp'],['calm','Helt ned i tempo','assets/lake.webp'],['familiar','Noget velkendt','assets/italian.webp'],['sing','Syng med','assets/indie.webp'],['soft','Bløde toner','assets/lake.webp'],['bright','Et lyst øjeblik','assets/kitchen.webp']];
const feelingSnapshot={bootId:'boot',roomId:'room',voice:{},capabilities:{musicRead:['feeling']}};
function feelingBody(themes=feelingThemes.slice(0,3),suffix='webp'){return {ok:true,schema:'podview.feeling-preview.v1',preview:{bootId:'boot',roomId:'room',configEntryId:'one',ownerEpoch:'epoch',source:'spotify_web_api',voiceSessionId:null,voiceTurnId:null,readOnly:true,expiresIn:60},data:{config_entry_id:'one',owner_epoch:'epoch',source:'spotify_web_api',tracks:themes.map(([themeId,themeTitle,themeArt],index)=>({uri:'spotify:playlist:'+String(index).padStart(22,'0'),name:'Actual playlist '+index,artist:themeTitle,themeId,themeTitle,themeArt:themeArt.replace(/\.webp$/,'.'+suffix)}))}};}
function feelingCards(body){const admitted=moodPreview(body,'one',feelingSnapshot,Date.now(),'feeling');assert.ok(admitted,'closed source validator admits canonical feeling metadata');return sourceMusicCards(admitted.tracks,'feeling');}

test('all six backend feeling static illustrations survive validation, source projection and actual shared rendering',async()=>{
 for(const suffix of ['png','webp'])for(const offset of [0,3]){const f=surface(),themes=feelingThemes.slice(offset,offset+3),cards=feelingCards(feelingBody(themes,suffix));assert.deepEqual(cards.map(card=>card.themeArt),themes.map(theme=>theme[2]));f.view.render({cards,collection:'feeling'});assert.deepEqual(f.probes.map(probe=>probe.src),themes.map(theme=>theme[2]));for(const probe of [...f.probes])await f.succeed(probe);const images=[...f.view.rows.values()].map(row=>row.children[0]);assert.deepEqual(images.map(image=>image.src),themes.map(theme=>theme[2]));assert.ok(images.every(image=>image.alt.startsWith('Illustration til ')&&!/AI|genereret/i.test(image.alt)));f.view.render({cards,collection:'feeling'});assert.equal(f.probes.length,3);f.view.cleanup();}
});

test('feeling keeps actual Spotify cover first and uses its exact supplied static illustration only after resource failure',async()=>{
 const f=surface(),body=feelingBody();body.data.tracks[0].artwork=cover;const cards=feelingCards(body);assert.deepEqual(cards[0].sourceArtwork,cover);assert.equal(cards[0].themeArt,'assets/indie.webp');f.view.render({cards:cards.slice(0,1),collection:'feeling'});assert.deepEqual(f.probes.map(probe=>probe.src),[cover.url]);f.probes[0].onerror(new Event('error'));assert.deepEqual(f.probes.map(probe=>probe.src),[cover.url,'assets/indie.webp']);await f.succeed(f.probes[1]);const image=[...f.view.rows.values()][0].children[0];assert.equal(image.src,'assets/indie.webp');assert.equal(image.classList.contains('spotify-artwork'),false);f.view.render({cards:cards.slice(0,1),collection:'feeling'});assert.equal(f.probes.length,2);assert.equal(cards[0].uri,body.data.tracks[0].uri);assert.equal(cards[0].sourceArtist,body.data.tracks[0].artist);f.view.cleanup();
});

test('feeling rejects mismatched static assets for every ID and never accepts generated mood paths or mood-only IDs',()=>{
 for(const [themeId,themeTitle,themeArt]of feelingThemes){for(const wrong of [themeArt==='assets/indie.webp'?'assets/lake.webp':'assets/indie.webp','theme-art/'+themeId+'/'+'a'.repeat(64)+'.webp',themeArt+'?v=1','https://foreign.invalid/'+themeArt]){const body=feelingBody(),row=body.data.tracks[0];Object.assign(row,{themeId,themeTitle,artist:themeTitle,themeArt:wrong});assert.equal(moodPreview(body,'one',feelingSnapshot,Date.now(),'feeling'),null);const card=sourceMusicCards([row],'feeling')[0];assert.equal(card.themeArt,undefined);const f=surface();f.view.render({cards:[{...card,themeArt:wrong,artworkRole:'editorial'}],collection:'feeling'});assert.equal(f.probes.length,0,'renderer independently rejects injected cross-kind or foreign art');f.view.cleanup();}}
 const row=source({themeArt:'assets/kitchen.webp'});assert.equal(sourceMusicCards([row],'feeling')[0].themeArt,undefined);const body=feelingBody();body.data.tracks[0]=row;assert.equal(moodPreview(body,'one',feelingSnapshot,Date.now(),'feeling'),null);
});

test('feeling artwork preserves accepted decode cache and cancels late fallback after account replacement',async()=>{
 const f=surface(),cards=feelingCards(feelingBody()).slice(0,1);f.view.render({cards,collection:'feeling'});await f.succeed(f.probes[0]);const image=[...f.view.rows.values()][0].children[0],accepted=image.src;f.view.render({cards:cards.map(card=>({...card,artworkRetryGeneration:2})),collection:'feeling'});assert.equal(image.src,accepted);assert.equal(f.probes.length,1);const replacement=cards.map(card=>({...card,artwork:cover}));f.view.render({cards:replacement,collection:'feeling'});const late=f.probes[1].onerror;f.host.liveCatalogue.account='two';f.view.render({cards:replacement,collection:'feeling'});const count=f.probes.length;late(new Event('error'));assert.equal(f.probes.length,count);assert.deepEqual(f.records,[]);f.view.cleanup();
});


// Retain the incumbent root mood-only rejection case alongside canonical collection coverage.
test('static paths are admitted only for their exact canonical theme and only in mood results',()=>{
 const f=surface();for(const themeArt of ['assets/lake.webp','assets/../kitchen.webp','https://foreign.invalid/kitchen.webp','assets/kitchen.webp?x=1']){const row=source({themeArt});assert.equal(sourceMusicCards([row],'mood')[0].themeArt,undefined);f.render(row);}assert.equal(f.probes.length,0);const feeling=sourceMusicCards([source({themeArt:'assets/kitchen.webp'})],'feeling');assert.equal(feeling[0].themeArt,undefined);f.view.render({cards:feeling,collection:'feeling'});assert.equal(f.probes.length,0);f.view.cleanup();
});
