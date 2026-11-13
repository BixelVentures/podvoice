import {applyKitTextRole,applyKitComponent,applyKitTemplate} from './ui/kit.js';
import {discoveryPeriod,resultsFor} from './widget-model.js';
import {MUSIC_THEMES,MUSIC_FEELINGS,playlistArtIndex} from './music-selection-model.js';
import {MUSIC_DISCOVERY_LIST_STEP} from './music-recommendation-model.js';
import {spotifyArtwork,generatedMoodArtwork,spotifyItemUrl,renderSpotifyArtwork,renderRetainedArtwork,cancelArtwork} from './spotify-artwork.js';

export const MUSIC_TABS=[['mood','Stemning'],['feeling','Humør'],['top','For dig'],['recent','Senest']];
export {discoveryPeriod};
const PROTOTYPE_TABS={mood:'Tid på dagen',feeling:'Vibe',top:'Din musik',recent:'Hør igen'};
const DISCOVERY_ACTION={mood:'Andre forslag',feeling:'Flere vibes',top:'Flere playlister',recent:'Se tidligere'};
const DISCOVERY_PERIOD={morning:'Godmorgen',afternoon:'Til eftermiddagen',evening:'Til aftenen'};
// The same period heading the music page uses, for the resting music card's context line.
export const discoveryPeriodLabel=now=>DISCOVERY_PERIOD[discoveryPeriod(now)]||'';
const text=(value,max=1024)=>typeof value==='string'?value.slice(0,max):'';
const make=(doc,tag,cls)=>{const node=doc.createElement(tag);if(cls)node.className=cls;return node;};
// The fixture adapter admits only bundled images or its explicitly verified artwork hosts.
export function fixtureArtwork(value){
 if(typeof value!=='string')return null;
 if(/^assets\/[A-Za-z0-9_/-]+\.(png|webp|jpg|jpeg|svg)$/.test(value))return value.replace(/^assets\/(morning-acoustic|kitchen|italian|lake|indie)\.png$/, 'assets/$1.webp');
 try{const u=new URL(value);return u.protocol==='https:'&&['image-cdn-fa.spotifycdn.com','image-cdn-ak.spotifycdn.com'].includes(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/image\/[A-Za-z0-9]+$/.test(u.pathname)?u.href:null;}catch{return null;}
}
// Owned natural illustrations are distinct pinned files, never invented source covers.
const THEME_FALLBACKS=['assets/editorial-forest.webp','assets/editorial-vinyl.webp','assets/editorial-ocean.webp'];
const EDITORIAL_PHOTOS={'assets/morning-acoustic.webp':THEME_FALLBACKS[0],'assets/kitchen.webp':THEME_FALLBACKS[1],'assets/italian.webp':THEME_FALLBACKS[1],'assets/lake.webp':THEME_FALLBACKS[2]};
function naturalThemeArtwork(paths){
 paths=paths.map(path=>EDITORIAL_PHOTOS[path]||path);
 const reserved=new Set(paths.filter(path=>THEME_FALLBACKS.includes(path))),used=new Set();
 return paths.map(path=>{const generated=generatedMoodArtwork(path,path?.split('/')[1]),identity=generated?generated.slice(generated.lastIndexOf('/')+1):path,chosen=(THEME_FALLBACKS.includes(path)||generated)&&!used.has(identity)?path:THEME_FALLBACKS.find(value=>!used.has(value)&&!reserved.has(value))||null;reserved.delete(path);if(chosen)used.add(chosen.startsWith('theme-art/')?chosen.slice(chosen.lastIndexOf('/')+1):chosen);return chosen;});
}
export function localMusicCards(options,revision){
 const themed=options.filter(option=>!['top','recent'].includes(option.collection)),images=naturalThemeArtwork(themed.map(option=>typeof option.art==='string'?fixtureArtwork(option.art.startsWith('https:')?option.art:`assets/${option.art}`):null));let index=0;
 return options.map(option=>{const cover=['top','recent'].includes(option.collection);return {id:option.id,name:option.name,description:option.description,detail:option.detail||(option.collection==='top'?'Dine topsange':''),artworkRole:cover?'cover':'editorial',fixtureArt:cover?typeof option.art==='string'?fixtureArtwork(option.art.startsWith('https:')?option.art:`assets/${option.art}`):null:images[index++],artLabel:`${cover?'Albumomslag':'Illustration'} til ${option.name}`,revision};});
}
// Discovery presents only the selected tab. Playback belongs to the retained player.
export function localDiscoveryCards(state){
 const music=state.music;
 const initiallyEmpty=music.previewEmptyCollection===music.collection&&music.previewEmptyPage===(music.suggestionPage||0);
 const options=initiallyEmpty?[]:resultsFor(music).map(option=>{
  const track=(option.collection==='recent'||option.collection==='top'&&!music.discoveryPrototype)?music.previewTracks?.[option.track]:null;
  return track?{...option,name:track.title,description:track.artist,art:track.art,detail:track.detail||'Forfattet lang albumtitel · En lang aften med musik og fortællinger fra hele den nordiske kyst'}:option;
 });
 const cards=localMusicCards(options,music.revision).map(card=>({...card,collection:music.collection}));
 if(!music.discoveryPrototype)return cards;
 return cards.map((card,index)=>{
  const option=options[index];
  if(music.collection==='recent')return {...card,detail:''};
  if(music.collection==='top')return {...card,description:'',detail:'',fixtureArt:`assets/${option.art}`,artLabel:'Redaktionel illustration'};
  const heading=music.collection==='mood'?DISCOVERY_PERIOD[music.discoveryPeriod]:null;
  const vibe=music.collection==='feeling';
  return {...card,name:vibe?option.description:card.name,description:vibe?card.name:heading&&index===0?({morning:'Rolig start på dagen',afternoon:'Pop til eftermiddagen',evening:'Jazz til aftenen'}[music.discoveryPeriod]):'',detail:'',fixtureArt:`assets/${vibe?'music-editorial-'+(index+1)+'.svg':option.art}`,artLabel:'Redaktionel illustration'};
 });
}
const LOCAL_PLAYLIST_ART = [
 'assets/music-editorial-1.svg', 'assets/music-editorial-2.svg', 'assets/music-editorial-3.svg',
];

function renderLibraryArtwork(image, card, contentIdentity, cover, diagnosticOwner) {
 const label = `Illustration til ${text(card.name,256)}`;
 const local = LOCAL_PLAYLIST_ART[playlistArtIndex(card.uri) % LOCAL_PLAYLIST_ART.length];
 const localBackup = {url:local,identity:`playlist-local|${local}`,label};
 const cache = typeof card.cachedPlaylistArt === 'string'
  ? generatedMoodArtwork(card.cachedPlaylistArt, card.cachedPlaylistArt.split('/')[1])
  : null;
 const backup = cache ? {url:cache,identity:`playlist-cache|${cache}`,label,backup:localBackup} : localBackup;
 // Keep accepted Spotify art for the exact row when its refresh has no replacement.
 if (!cover && image.dataset.artworkContent === contentIdentity && image.dataset.displayedArtwork
  && image.classList.contains('spotify-artwork')) {
  cover = spotifyArtwork({kind:'playlist_cover',provider:'spotify',url:image.getAttribute('src')},card.uri);
 }
 const artwork = cover ? {
  url:cover.url,identity:`${card.uri}|${cover.url}`,provider:true,backup,
  label:`Playlisteomslag til ${text(card.sourceName || card.name,256)}`,
 } : backup;
 renderRetainedArtwork(image, {
  ...artwork,contentIdentity,quiet:true,diagnosticOwner,retryKey:card.artworkRetryGeneration,
 });
}

export function sourceMusicCards(tracks,kind){
 const rows=['account_playlists','recent'].includes(kind)?tracks:tracks.slice(0,3),occurrences=new Map();
 return rows.map(track=>{
  const themed=!!track.themeTitle,artwork=spotifyArtwork(track.artwork,track.uri),staticArt=(kind==='feeling'?MUSIC_FEELINGS:MUSIC_THEMES)[track.themeId]?.[1],themeArt=['mood','feeling'].includes(kind)&&themed&&/^spotify:playlist:[A-Za-z0-9]{22}$/.test(track.uri)?(kind==='mood'&&generatedMoodArtwork(track.themeArt,track.themeId))||(staticArt&&[staticArt,staticArt.replace(/\.webp$/,'.png')].includes(track.themeArt)?staticArt:null):null;
  // A valid playlist cover is never replaced merely because another row shares it.
  const identity=JSON.stringify([track.uri,track.themeId||track.themeTitle||'']),occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
  const cachedPlaylistArt = kind === 'account_playlists' ? track.cachedPlaylistArt : null;
  return {id:`source:${identity}:${occurrence}`,...(cachedPlaylistArt ? {cachedPlaylistArt} : {}),name:track.themeTitle||track.name||track.title,description:track.themeTitle?(track.name||track.title):track.artist,detail:track.themeTitle?'':kind==='top'?'Dine topsange':'',uri:track.uri,sourceName:track.name||track.title,sourceArtist:track.artist,artwork,...(themed?{themeId:track.themeId,sourceArtwork:artwork}:{}),...(themeArt?{themeArt,artworkRole:generatedMoodArtwork(themeArt,track.themeId)||!artwork?'editorial':'cover'}:{})};
 });
}

// One retained card anatomy and the existing four tabs, shared by every adapter.
// It renders text nodes only. Selection authority stays in the supplying adapter.
export class MusicResults{
 constructor(host,{choose=()=>{}}={}){this.host=host;this.choose=choose;this.doc=host.ownerDocument;this.list=host.querySelector('#result-list');this.empty=host.querySelector('#empty');this.count=host.querySelector('#result-count');this.title=host.querySelector('#response-title');this.tabs=host.querySelector('#music-refinements');this.refresh=host.querySelector('#music-refresh');this.count.classList.add('music-result-summary');this.refresh.classList.add('music-refresh-footer');this.empty.classList.add('music-refresh-message');this.empty.setAttribute('role','status');this.empty.setAttribute('aria-live','polite');host.querySelector('#music-response')?.append(this.empty,this.refresh);this.refresh.addEventListener('click',event=>{if(this.refresh.disabled||this.refresh.getAttribute('aria-disabled')==='true'){event.preventDefault();event.stopImmediatePropagation();}},true);this.rows=new Map();this.contentTransitions=new Map();this.groupHeadings=new Map();this.cleanup=()=>{for(const cancel of this.contentTransitions.values())cancel();this.contentTransitions.clear();this.refreshCollection=null;for(const row of [...this.rows.values(),...(this.placeholders||[])]){cancelArtwork(row.children[0]);if(row.dataset.contentState==='pending')row.dataset.contentState='idle';if(row.dataset.pending!=='false')row.dataset.pending='false';if(row.getAttribute('aria-busy')!=='false')row.setAttribute('aria-busy','false');if(row.children[2].textContent)row.children[2].textContent='';}for(const node of [this.list,this.refresh])if(node.getAttribute('aria-busy')!=='false')node.setAttribute('aria-busy','false');if(this.refresh.dataset.refreshState!=='idle')this.refresh.dataset.refreshState='idle';const label=this.refresh.querySelector('[data-refresh-label]');if(label&&label.textContent!=='Andre forslag')label.textContent='Andre forslag';};}
 // A real refresh gets one finite content cue; content stays fully visible afterwards.
 fadeLoadingContent(row){
  this.contentTransitions.get(row)?.();const motion=this.host.motion;
  if(!motion||motion.reduced||!row.getClientRects?.().length)return;
  const animations=[row.children[0],row.children[1]].map(node=>motion.animate(node,[{opacity:.65},{opacity:1}],200));let stopped=false;
  const finish=()=>{if(stopped)return;stopped=true;for(const animation of animations)animation?.cancel();if(this.contentTransitions.get(row)===finish)this.contentTransitions.delete(row);};
  this.contentTransitions.set(row,finish);Promise.all(animations.map(animation=>animation?.finished)).catch(()=>{}).finally(finish);
 }
 // Artwork crossfades; one readable copy remains, and the retained action never moves.
 captureContent(row){
  this.contentTransitions.get(row)?.();
  const motion=this.host.motion;if(!motion||motion.reduced||!row.cloneNode||!row.getClientRects().length)return ()=>{};
  const bounds=row.getBoundingClientRect(),layers=[],animations=[];let stopped=false,timer;
  const finish=()=>{if(stopped)return;stopped=true;clearTimeout(timer);for(const animation of animations)animation?.cancel();for(const {node,clone,ready}of layers){node.removeEventListener('load',ready);node.removeEventListener('error',ready);clone.remove();}if(this.contentTransitions.get(row)===finish)this.contentTransitions.delete(row);};
  for(const node of [row.children[0]]){const rect=node.getBoundingClientRect(),clone=node.cloneNode(true);clone.setAttribute('aria-hidden','true');clone.dataset.contentTransition='true';clone.style.cssText=`position:absolute;grid-area:auto!important;justify-self:start!important;align-self:start!important;left:${rect.left-bounds.left}px;top:${rect.top-bounds.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;pointer-events:none;z-index:2;`;row.append(clone);layers.push({node,clone});}
  this.contentTransitions.set(row,finish);
  return ()=>{if(stopped)return;let remaining=layers.length+1;const duration=Number.parseFloat(this.doc.defaultView?.getComputedStyle(this.host).getPropertyValue('--pv-d-fast'))||200;
   const copy=motion.animate(row.children[1],[{opacity:.85},{opacity:1}],duration);animations.push(copy);Promise.resolve(copy?.finished).catch(finish).finally(()=>{if(--remaining===0)finish();});
   for(const layer of layers){let started=false;const ready=()=>{if(stopped||started)return;if(layer.node===row.children[0]&&layer.node.dataset.artworkPending==='true')return;started=true;const outgoing=motion.animate(layer.clone,[{opacity:1},{opacity:0}],duration),incoming=motion.animate(layer.node,[{opacity:0},{opacity:1}],duration);animations.push(outgoing,incoming);Promise.resolve(outgoing?.finished).catch(finish).finally(()=>{if(--remaining===0)finish();});};layer.ready=ready;if(layer.node===row.children[0]){layer.node.addEventListener('load',ready);layer.node.addEventListener('error',ready);}ready();}
   timer=setTimeout(finish,4000);
  };
 }
 create(id){const d=this.doc,row=make(d,'button','result pv-card pv-btn');applyKitComponent(row,'card');row.type='button';row.dataset.optionId=id;row.dataset.artworkRole='editorial';const art=make(d,'img','result-art');art.loading='lazy';art.decoding='async';art.dataset.kitSlot='artwork';const copy=make(d,'div','result-copy'),title=make(d,'h2'),description=make(d,'p'),detail=make(d,'small'),feedback=make(d,'span','result-feedback'),play=make(d,'span','round result-play'),icon=make(d,'img');title.dataset.kitSlot='title';description.dataset.kitSlot='body';play.dataset.kitSlot='actions';feedback.setAttribute('aria-live','polite');play.setAttribute('aria-hidden','true');icon.src='assets/icons/play-fill.svg';icon.alt='';play.append(icon);copy.append(title,description,detail);row.append(art,copy,feedback,play);row.addEventListener('click',()=>{if(row.disabled||row.getAttribute('aria-disabled')==='true')return;const card=row.musicCard;if(!this.host.live&&card.action==='continue'){if(this.host.state.music.playback.playing){this.host.dispatch({type:'show',id:'player'});this.host.focusHeading?.();}else this.doc.getElementById('play-pause')?.click();return;}if(!this.host.live&&this.host.state.music?.refreshPending){if(!this.host.musicRefresh?.cancelForSelection(card.id))return;row.dataset.revision=String(this.host.state.music.revision);}if(!this.host.live&&card.collection&&card.collection!==this.host.state.music.collection){this.host.music({type:'collection',value:card.collection});row.dataset.revision=String(this.host.state.music.revision);}this.choose(card,row);});return row;}
 layoutRow(row,collection,index,enabled){
  if(!enabled)return;
  const kind=collection==='mood'&&index===0?'hero':collection==='feeling'?'card':'listrow';
  if((row.dataset.kit||row.getAttribute('data-kit'))===kind)return;
  row.classList.remove('pv-card','pv-hero','pv-row','pv-kit-card','pv-kit-hero','pv-kit-listrow');applyKitComponent(row,kind);
 }
 render({cards=[],collection='mood',heading,status,sourceSummary='',empty='Ingen forslag matcher. Prøv en anden retning.',connected=true,busy=false,canRefresh=true,canChoose=true,canRenew=false,pendingId=null,revision,collapsed=false,accountLibrary=false,discovery=false}={}){
  const prototype=!this.host.live&&this.host.state.music?.discoveryPrototype;
  const discoveryLayout=prototype||discovery;
  // Catalogue reads can omit cover metadata without replacing the item.
  const preserveSourceCover=this.host.live&&discovery;
  const response=this.list.closest?.('#music-response');
  if(response){response.toggleAttribute('data-discovery-preview',!!discoveryLayout);if(discoveryLayout||accountLibrary)response.dataset.discoveryCollection=collection;else delete response.dataset.discoveryCollection;}
  if(discoveryLayout&&response){
   if(!this.discoveryHeader){
    this.discoveryHeader=make(this.doc,'header');
    applyKitComponent(this.discoveryHeader,'sectionheader');
    this.discoveryHeader.dataset.discoveryHeader='';
    this.discoveryTitle=make(this.doc,'h2');
    this.discoveryHeader.append(this.discoveryTitle);
    response.insertBefore(this.discoveryHeader,this.list.closest('#results'));
   }
   const day=collection==='mood';
   const suggestions=day||collection==='feeling';
   this.discoveryHeader.hidden=!suggestions;
   this.discoveryTitle.textContent=day?(DISCOVERY_PERIOD[this.host.state.music?.discoveryPeriod||discoveryPeriod(Date.now())]||'Tid på dagen'):'Vælg en stemning';
   const actionParent=suggestions?this.discoveryHeader:response;
   if(this.refresh.parentNode!==actionParent)actionParent.append(this.refresh);
  }
  if(!discoveryLayout&&this.discoveryHeader){this.discoveryHeader.hidden=true;if(this.refresh.parentNode===this.discoveryHeader)response.append(this.refresh);}
  const diagnosticOwner=this.host.liveTransport;
  const refreshScope=JSON.stringify([collection,this.host.liveCatalogue?.account??null,this.host.liveSnapshot?.bootId??null,this.host.liveSnapshot?.roomId??null]),refreshCompleted=!busy&&this.refreshCollection===refreshScope;
  if(busy&&canRefresh&&cards.length&&!pendingId){if(this.refreshCollection!==refreshScope)for(const cancel of this.contentTransitions.values())cancel();this.refreshCollection=refreshScope;}else if(!busy||this.refreshCollection!==refreshScope)this.refreshCollection=null;
  if(refreshCompleted&&cards.length===this.rows.size&&!cards.some(card=>card.group)){const slots=[...this.rows.values()];this.rows.clear();cards.forEach((card,index)=>{const row=slots[index];if(row.dataset.optionId!==card.id)row.dataset.optionId=card.id;this.rows.set(card.id,row);});}
  const grouped=cards.some(card=>card.group);if(this.list.dataset.grouped!==String(grouped))this.list.dataset.grouped=String(grouped);const groups=new Set(cards.map(card=>card.group).filter(Boolean));for(const [group,node]of this.groupHeadings)if(!groups.has(group)){node.remove();this.groupHeadings.delete(group);}let position=0;
  const showPlaceholders=busy&&!cards.length;
  if(!showPlaceholders)for(const row of this.placeholders||[])if(row.parentNode===this.list)row.remove();
  const wanted=new Set(cards.map(card=>card.id));for(const[id,row]of this.rows)if(!wanted.has(id)){this.contentTransitions.get(row)?.();cancelArtwork(row.children[0]);row.remove();this.rows.delete(id);}
  cards.forEach((card,index)=>{let row=this.rows.get(card.id);if(!row){row=this.create(card.id);this.rows.set(card.id,row);}const contentKey=JSON.stringify([card.name,card.description,card.detail,card.fixtureArt,card.artwork,card.uri,card.themeArt,card.cachedPlaylistArt]);const changed=row.contentKey!==undefined&&row.contentKey!==contentKey;if(changed&&!refreshCompleted)this.contentTransitions.get(row)?.();const retainedCover=preserveSourceCover&&card.uri&&row.musicCard?.uri===card.uri
    &&!card.artwork&&!card.themeArt&&!card.fixtureArt&&row.children[0].dataset.displayedArtwork;
   const reveal=refreshCompleted&&changed&&!retainedCover?this.captureContent(row):null;row.contentKey=contentKey;row.musicCard=card;if(row.dataset.contentState!=='ready')row.dataset.contentState='ready';if(card.action==='continue')applyKitComponent(row,'hero');
   if(row.dataset.musicGroup!==(card.group||''))row.dataset.musicGroup=card.group||'';
   const nextRevision=String(card.revision??revision??'');if(row.dataset.revision!==nextRevision)row.dataset.revision=nextRevision;if(row.classList.contains('recommended')!==(index===0))row.classList.toggle('recommended',index===0);
   this.layoutRow(row,collection,index,discoveryLayout||accountLibrary);
   const themeArt=collection==='mood'&&card.artworkRole==='editorial'&&/^spotify:playlist:[A-Za-z0-9]{22}$/.test(card.uri)?generatedMoodArtwork(card.themeArt,card.themeId):null,staticDefault=(collection==='feeling'?MUSIC_FEELINGS:MUSIC_THEMES)[card.themeId]?.[1],staticArt=['mood','feeling'].includes(collection)&&/^spotify:playlist:[A-Za-z0-9]{22}$/.test(card.uri)&&staticDefault&&(themeArt||[staticDefault,staticDefault.replace(/\.webp$/,'.png')].includes(card.themeArt))?staticDefault:null,sourceCover=!!spotifyItemUrl(card.uri)||/^spotify:playlist:[A-Za-z0-9]{22}$/.test(card.uri),artworkRole=(themeArt||staticArt)&&!spotifyArtwork(card.artwork,card.uri)?'editorial':sourceCover||card.artworkRole==='cover'&&fixtureArtwork(card.fixtureArt)?'cover':'editorial';if(row.dataset.artworkRole!==artworkRole)row.dataset.artworkRole=artworkRole;
   const allowed=connected&&(canChoose||canRenew)&&card.selectable!==false;if(row.disabled!==!allowed)row.disabled=!allowed;
   if(row.getAttribute('aria-disabled')!==String(!allowed||!!pendingId))row.setAttribute('aria-disabled',String(!allowed||!!pendingId));
   const pending=card.id===pendingId;
   if(row.getAttribute('aria-label')!==null)row.removeAttribute('aria-label');
   const actionDescription=pending?'Starter afspilning':allowed?card.action==='continue'?(this.host.state.music.playback.playing?'Åbn afspilleren':'Fortsæt'):'Afspil':'Afspilning ikke tilgængelig';if(row.getAttribute('aria-description')!==actionDescription)row.setAttribute('aria-description',actionDescription);
   if(row.dataset.pending!==String(pending))row.dataset.pending=String(pending);if(row.getAttribute('aria-busy')!==String(pending))row.setAttribute('aria-busy',String(pending));
   const actionIcon=row.children[3].children[0],actionSource=card.action==='continue'&&this.host.state.music.playback.playing?'assets/icons/chevron-right.svg':'assets/icons/play-fill.svg';if(actionIcon.getAttribute('src')!==actionSource)actionIcon.src=actionSource;
   const[art,copy,feedback]=row.children;for(const [node,value]of [[copy.children[0],text(card.name,256)],[copy.children[1],text(card.description,512)],[copy.children[2],text(card.detail,256)],[feedback,pending?'Starter afspilning':'']])if(node.textContent!==value)node.textContent=value;
   const contentIdentity=JSON.stringify([this.host.liveCatalogue?.account??null,this.host.liveSnapshot?.bootId??null,this.host.liveSnapshot?.roomId??null,card.uri||card.id,card.artworkGeneration??null]);const illustrationLabel=`Illustration til ${text(card.name,256)}`,staticBackup=staticArt?{url:staticArt,identity:`theme-static|${staticArt}`,label:illustrationLabel}:null,actualCover=spotifyArtwork(card.artwork,card.uri),generated=themeArt?{url:themeArt,identity:`theme|${themeArt}`,label:illustrationLabel,backup:staticBackup}:staticBackup,cover=actualCover?{url:actualCover.url,identity:`${card.uri}|${actualCover.url}`,label:`Playlisteomslag til ${text(card.sourceName||card.name,256)}`,provider:true,backup:generated}:generated;
   if (accountLibrary && /^spotify:playlist:[A-Za-z0-9]{22}$/.test(card.uri)) {
    renderLibraryArtwork(art, card, contentIdentity, actualCover, diagnosticOwner);
   } else if(themeArt||staticArt){renderRetainedArtwork(art,{...cover,contentIdentity,quiet:true,diagnosticOwner,retryKey:card.artworkRetryGeneration});}else if(sourceCover){renderSpotifyArtwork(art,{uri:card.uri,name:card.sourceName||card.name,artwork:card.artwork},contentIdentity,!!actualCover||preserveSourceCover,diagnosticOwner,card.artworkRetryGeneration);}else if(card.fixtureArt&&fixtureArtwork(card.fixtureArt)){renderRetainedArtwork(art,{url:card.fixtureArt,identity:`fixture|${card.fixtureArt}`,contentIdentity,quiet:true,diagnosticOwner,retryKey:card.artworkRetryGeneration,label:text(card.artLabel,512)});}else renderSpotifyArtwork(art,{uri:card.uri,name:card.sourceName||card.name,artwork:card.artwork},contentIdentity,true,diagnosticOwner,card.artworkRetryGeneration);
   reveal?.();
   if(card.group&&(index===0||cards[index-1].group!==card.group)){let heading=this.groupHeadings.get(card.group);if(!heading){heading=make(this.doc,'h2','music-group-heading');heading.textContent=card.group;this.groupHeadings.set(card.group,heading);}if(this.list.children[position]!==heading)this.list.insertBefore(heading,this.list.children[position]||null);position++;}if(this.list.children[position]!==row)this.list.insertBefore(row,this.list.children[position]||null);position++;
  });
  if(showPlaceholders){
   const count=this.host.live&&(collection==='recent'||accountLibrary)?MUSIC_DISCOVERY_LIST_STEP:3;
   this.placeholders??=Array.from({length:MUSIC_DISCOVERY_LIST_STEP},()=>{
    const row=this.create('');delete row.dataset.optionId;row.disabled=true;row.dataset.empty='true';
    row.setAttribute('aria-hidden','true');row.children[0].alt='';
    for(const child of [row.children[2],row.children[3]])child.style.visibility='hidden';
    return row;
   });
   for(const [index,row] of this.placeholders.entries()){
    if(index>=count){if(row.parentNode===this.list)row.remove();continue;}
    this.layoutRow(row,collection,index,discoveryLayout||accountLibrary);
    if(row.dataset.contentState!=='pending')row.dataset.contentState='pending';
    if(this.list.children[index]!==row)this.list.insertBefore(row,this.list.children[index]||null);
   }
  }
  if(this.title.textContent!=='Find musik')this.title.textContent='Find musik';if(!busy){const collectionLabel={mood:'Stemning',feeling:'Humør',top:'For dig',recent:'Senest'}[collection]||'',context=collectionLabel,count=[context,status===undefined?`${cards.length} forslag`:text(status)].filter(Boolean).join(' · ');if(this.count.textContent!==count)this.count.textContent=count;}else if(!cards.length&&this.count.textContent)this.count.textContent='';
  const localOutcome=this.host.live?null:this.host.state.music?.refreshStatus,refreshOutcome=localOutcome==='error'||localOutcome==='empty'?localOutcome:/kunne ikke (?:opdatere|opdateres|hentes|hente)/i.test(status||'')?'error':/ingen nye forslag/i.test(status||'')?'empty':null,refreshMessage=refreshOutcome==='error'?(cards.length?'Kunne ikke hente nye forslag. De viste forslag er bevaret.':'Kunne ikke hente forslag. Prøv igen.'):refreshOutcome==='empty'?'Ingen nye forslag i denne opdatering.':'';if(this.empty.dataset.refreshOutcome!==(refreshOutcome||''))this.empty.dataset.refreshOutcome=refreshOutcome||'';const sourceMessage=text(sourceSummary,512),emptyMessage=refreshMessage||sourceMessage||text(empty);if(this.empty.textContent!==emptyMessage)this.empty.textContent=emptyMessage;const emptyHidden=busy||!refreshMessage&&!sourceMessage&&(cards.length>0||(!!text(status)&&text(status)===this.empty.textContent));if(this.empty.hidden!==emptyHidden)this.empty.hidden=emptyHidden;
  const refreshBusy=busy&&connected&&canRefresh&&!pendingId&&!this.host.liveSelection?.pending;if(this.refresh.dataset.refreshState!==(refreshBusy?'pending':'idle'))this.refresh.dataset.refreshState=refreshBusy?'pending':'idle';for(const [node,value]of [[this.list,busy],[this.refresh,refreshBusy]])if(node.getAttribute('aria-busy')!==String(value))node.setAttribute('aria-busy',String(value));const refreshDisabled=!connected||!canRefresh||!!pendingId;if(this.refresh.disabled!==refreshDisabled)this.refresh.disabled=refreshDisabled;const refreshUnavailable=String(refreshDisabled||refreshBusy);if(this.refresh.getAttribute('aria-disabled')!==refreshUnavailable)this.refresh.setAttribute('aria-disabled',refreshUnavailable);
  const label=this.refresh.querySelector('[data-refresh-label]'),refreshLabel=discoveryLayout?(refreshBusy?(collection==='recent'?'Henter historik':'Henter forslag'):refreshOutcome==='error'?'Prøv igen':DISCOVERY_ACTION[collection]):refreshBusy?'Henter forslag':refreshOutcome?'Prøv igen':!cards.length&&/kunne ikke hentes/.test(status||'')?'Prøv igen':accountLibrary?'Flere playlister':'Andre forslag';if(label&&label.textContent!==refreshLabel)label.textContent=refreshLabel;
  for(const tab of this.tabs.querySelectorAll('[data-collection]')){const label=(discoveryLayout?PROTOTYPE_TABS:Object.fromEntries(MUSIC_TABS))[tab.dataset.collection];if(label&&tab.textContent!==label)tab.textContent=label;if(tab.hidden)tab.hidden=false;if(tab.disabled)tab.disabled=false;if(tab.getAttribute('aria-pressed')!==String(tab.dataset.collection===collection))tab.setAttribute('aria-pressed',String(tab.dataset.collection===collection));}
  const tabsHidden=this.host.state.focus!=='music'||collapsed;if(this.tabs.hidden!==tabsHidden)this.tabs.hidden=tabsHidden;
 }
}

// The overview uses the same admitted player model as the right-hand player.
// No fixture title is promoted into a live or unavailable account.
export function renderOverviewMediaValues(host){
 const focused=host.playerView?.progressVM||{},doc=host.ownerDocument,vm=host.live?host.playerView?.sourceModel?.('music')||focused:focused,radioVM=host.live?host.playerView?.sourceModel?.('radio')??focused:focused;
 const known=vm.active===true&&typeof vm.title==='string'&&vm.title.trim();
 const radio=vm.sourceKind==='radio';
 const artist=known&&!radio&&typeof vm.artist==='string'?vm.artist.trim().replace(/\s+/g,' '):'';
 const emptyMusic={offline:'Ikke forbundet',error:'Kan ikke hentes','account-selection':'Vælg musikkonto',loading:'Afventer data'}[vm.emptyState]||(host.live&&host.liveTransport?.connected===false?'Ikke forbundet':'Vælg musik');
 const radioKnown=radioVM.active===true&&radioVM.sourceKind==='radio'&&typeof radioVM.title==='string'&&!!radioVM.title.trim()&&(!host.live||((host.liveRadio?.hasSource?.()??host.liveRadio?.ownsPlayer?.())===true||host.liveRadio?.knownStopped?.()===true)||radioVM.loading===true&&!!host.liveRadio?.pendingStart?.());
 const radioAvailable=!host.live||host.liveRadio?.current()===true;
 const radioExample=radioVM.exampleOnly===true||typeof radioVM.previewLabel==='string'&&/ingen lyd/i.test(radioVM.previewLabel);
 const values={
  'home-music':{title:known&&!radio?`${vm.fresh===false&&!vm.readOnly?'Ikke opdateret · ':''}${vm.title}`:emptyMusic,secondary:known&&!radio?artist:'',status:known&&!radio?(vm.readOnly?`${vm.playing?'Afspiller':'På pause'} · højttaler ikke bekræftet`:vm.fresh===false?'Afspilningen er ikke opdateret':vm.playing?'Afspiller':'På pause'):''},
  'home-radio':{title:radioKnown?`${radioVM.fresh===false&&!radioExample&&radioVM.loading!==true?'Ikke opdateret · ':''}${radioVM.title}`:radioAvailable?'Vælg station':'Ikke tilgængelig',secondary:radioKnown?(radioVM.loading===true?'Starter…':radioExample?'Ingen lyd':radioVM.playing?'Afspiller':'Stoppet'):'',status:''},
 };
 for(const [id,value]of Object.entries(values)){
  const card=doc.getElementById(id);if(card?.dataset.mediaLayout==='media'){if(card.getAttribute('aria-description')!==null)card.removeAttribute('aria-description');continue;}const node=card?.querySelector('small');if(!node)continue;
  let title=node.querySelector('.overview-media-title'),secondary=node.querySelector('.overview-media-artist');
  if(!title||!secondary){title=make(doc,'span','overview-media-title');secondary=make(doc,'span','overview-media-artist');node.replaceChildren(title,secondary);}
  if(title.textContent!==value.title)title.textContent=value.title;if(secondary.textContent!==value.secondary)secondary.textContent=value.secondary;
  if(secondary.hidden!==!value.secondary)secondary.hidden=!value.secondary;
  if(card.getAttribute('aria-description')!==(value.status||null)){if(value.status)card.setAttribute('aria-description',value.status);else card.removeAttribute('aria-description');}
  const metadata=String(!!value.secondary);if(node.dataset.mediaMetadata!==metadata)node.dataset.mediaMetadata=metadata;
 }
}
