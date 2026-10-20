import {spotifyArtwork,spotifyItemUrl,renderSpotifyArtwork,renderRetainedArtwork,cancelArtwork} from './spotify-artwork.js';

export const MUSIC_TABS=[['mood','Stemning'],['feeling','Humør'],['top','Topsange'],['recent','Senest']];
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
 return paths.map(path=>{const chosen=THEME_FALLBACKS.includes(path)&&!used.has(path)?path:THEME_FALLBACKS.find(value=>!used.has(value)&&!reserved.has(value))||null;reserved.delete(path);if(chosen)used.add(chosen);return chosen;});
}
export function localMusicCards(options,revision){
 const themed=options.filter(option=>!['top','recent'].includes(option.collection)),images=naturalThemeArtwork(themed.map(option=>fixtureArtwork(option.art.startsWith('https:')?option.art:`assets/${option.art}`)));let index=0;
 return options.map(option=>{const cover=['top','recent'].includes(option.collection);return {id:option.id,name:option.name,description:option.description,detail:option.detail,artworkRole:cover?'cover':'editorial',fixtureArt:cover?fixtureArtwork(option.art.startsWith('https:')?option.art:`assets/${option.art}`):images[index++],artLabel:`${cover?'Albumomslag':'Illustration'} til ${option.name}`,revision};});
}
export function sourceMusicCards(tracks){
 const rows=tracks.slice(0,3),images=naturalThemeArtwork(rows.filter(track=>track.themeTitle).map(track=>fixtureArtwork(track.themeArt))),used=new Set(),occurrences=new Map();let themedIndex=0;
 return rows.map((track,index)=>{
  const themed=!!track.themeTitle,sourceArtwork=spotifyArtwork(track.artwork,track.uri),imageKey=sourceArtwork&&`spotify|${sourceArtwork.url}`,artwork=sourceArtwork&&(!themed||!used.has(imageKey))?sourceArtwork:null,fallbackArt=themed?images[themedIndex++]:null;
  if(themed&&artwork)used.add(imageKey);
  const identity=JSON.stringify([track.uri,track.themeId||track.themeTitle||'']),occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
  return {id:`source:${identity}:${occurrence}`,name:track.themeTitle||track.name||track.title,description:track.themeTitle?(track.name||track.title):track.artist,detail:track.themeTitle?'Afspilningsliste fra Spotify':'',uri:track.uri,sourceName:track.name||track.title,sourceArtist:track.artist,artwork,...(themed?{sourceArtwork,...(fallbackArt?{fallbackArt,...(!artwork?{fixtureArt:fallbackArt}:{}),artLabel:`Illustration til ${track.themeTitle}`}:{})}:{})};
 });
}

// One retained card anatomy and the existing four tabs, shared by every adapter.
// It renders text nodes only. Selection authority stays in the supplying adapter.
export class MusicResults{
 constructor(host,{choose=()=>{}}={}){this.host=host;this.choose=choose;this.doc=host.ownerDocument;this.list=host.querySelector('#result-list');this.empty=host.querySelector('#empty');this.count=host.querySelector('#result-count');this.title=host.querySelector('#response-title');this.tabs=host.querySelector('#music-refinements');this.refresh=host.querySelector('#music-refresh');this.refresh.addEventListener('click',event=>{if(this.refresh.disabled||this.refresh.getAttribute('aria-disabled')==='true'){event.preventDefault();event.stopImmediatePropagation();}},true);this.rows=new Map();this.cleanup=()=>{for(const row of [...this.rows.values(),...(this.placeholders||[])])cancelArtwork(row.children[0]);};}
 create(id){const d=this.doc,row=make(d,'button','result');row.type='button';row.dataset.optionId=id;const art=make(d,'img','result-art'),copy=make(d,'div','result-copy'),title=make(d,'h2'),description=make(d,'p'),detail=make(d,'small'),feedback=make(d,'span','result-feedback'),play=make(d,'span','round result-play'),icon=make(d,'img');feedback.setAttribute('aria-live','polite');play.setAttribute('aria-hidden','true');icon.src='assets/icons/play-fill.svg';icon.alt='';play.append(icon);copy.append(title,description,detail);row.append(art,copy,feedback,play);row.addEventListener('click',()=>{if(!row.disabled&&row.getAttribute('aria-disabled')!=='true')this.choose(row.musicCard,row);});return row;}
 render({cards=[],collection='mood',heading,status,empty='Ingen forslag matcher. Prøv en anden retning.',connected=true,busy=false,canRefresh=true,canChoose=true,canRenew=false,pendingId=null,revision,collapsed=false}={}){
  const showPlaceholders=busy&&!cards.length;
  if(!showPlaceholders)for(const row of this.placeholders||[])if(row.parentNode===this.list)row.remove();
  const wanted=new Set(cards.map(card=>card.id));for(const[id,row]of this.rows)if(!wanted.has(id)){cancelArtwork(row.children[0]);row.remove();this.rows.delete(id);}
  cards.forEach((card,index)=>{let row=this.rows.get(card.id);if(!row){row=this.create(card.id);this.rows.set(card.id,row);}row.musicCard=card;
   const nextRevision=String(card.revision??revision??'');if(row.dataset.revision!==nextRevision)row.dataset.revision=nextRevision;if(row.classList.contains('recommended')!==(index===0))row.classList.toggle('recommended',index===0);
   const artworkRole=spotifyArtwork(card.artwork,card.uri)||!card.fixtureArt&&spotifyItemUrl(card.uri)||card.artworkRole==='cover'&&fixtureArtwork(card.fixtureArt)?'cover':'editorial';if(row.dataset.artworkRole!==artworkRole)row.dataset.artworkRole=artworkRole;
   const allowed=connected&&!busy&&(canChoose||canRenew)&&card.selectable!==false;if(row.disabled!==!allowed)row.disabled=!allowed;
   if(row.getAttribute('aria-disabled')!==String(!allowed||!!pendingId))row.setAttribute('aria-disabled',String(!allowed||!!pendingId));
   const pending=card.id===pendingId;
   const accessibleLabel=`${pending?'Afventer afspilning af':allowed?'Afspil':'Afspilning ikke tilgængelig for'} ${[text(card.name,256),text(card.description,512),text(card.detail,256),pending?'Afventer afspilning':''].filter(Boolean).join(' · ')}`;if(row.getAttribute('aria-label')!==accessibleLabel)row.setAttribute('aria-label',accessibleLabel);
   if(row.dataset.pending!==String(pending))row.dataset.pending=String(pending);if(row.getAttribute('aria-busy')!==String(pending))row.setAttribute('aria-busy',String(pending));
   const[art,copy,feedback]=row.children;for(const [node,value]of [[copy.children[0],text(card.name,256)],[copy.children[1],text(card.description,512)],[copy.children[2],text(card.detail,256)],[feedback,pending?'Afventer afspilning':'']])if(node.textContent!==value)node.textContent=value;
   const contentIdentity=JSON.stringify([this.host.liveCatalogue?.account??null,this.host.liveSnapshot?.bootId??null,this.host.liveSnapshot?.roomId??null,card.uri||card.id,card.artworkGeneration??null]);if(spotifyArtwork(card.artwork,card.uri)){renderSpotifyArtwork(art,{uri:card.uri,name:card.sourceName||card.name,artwork:card.artwork,fallbackArt:card.fallbackArt,fallbackLabel:card.artLabel},contentIdentity);}else if(card.fixtureArt&&fixtureArtwork(card.fixtureArt)){renderRetainedArtwork(art,{url:card.fixtureArt,identity:`fixture|${card.fixtureArt}`,contentIdentity,label:text(card.artLabel,512)});}else renderSpotifyArtwork(art,{uri:card.uri,name:card.sourceName||card.name,artwork:card.artwork,fallbackArt:card.fallbackArt,fallbackLabel:card.artLabel},contentIdentity);
   if(this.list.children[index]!==row)this.list.insertBefore(row,this.list.children[index]||null);
  });
  if(showPlaceholders){this.placeholders??=Array.from({length:3},()=>{const row=this.create('');delete row.dataset.optionId;row.disabled=true;row.dataset.empty='true';row.setAttribute('aria-hidden','true');for(const child of row.children)child.style.visibility='hidden';return row;});this.placeholders.forEach((row,index)=>{if(this.list.children[index]!==row)this.list.insertBefore(row,this.list.children[index]||null);});}
  if(this.title.textContent!=='Find musik')this.title.textContent='Find musik';if(!busy){const collectionLabel={mood:'Stemning',feeling:'Humør',top:'Topsange',recent:'Senest'}[collection]||'',context=heading&&heading!=='Find musik'?text(heading,256):collectionLabel,count=[context,status===undefined?`${cards.length} forslag`:text(status)].filter(Boolean).join(' · ');if(this.count.textContent!==count)this.count.textContent=count;}else if(!cards.length&&this.count.textContent)this.count.textContent='';if(this.empty.textContent!==text(empty))this.empty.textContent=text(empty);
  const emptyHidden=busy||cards.length>0||(!!text(status)&&text(status)===this.empty.textContent);if(this.empty.hidden!==emptyHidden)this.empty.hidden=emptyHidden;
  for(const node of [this.list,this.refresh])if(node.getAttribute('aria-busy')!==String(busy))node.setAttribute('aria-busy',String(busy));const refreshDisabled=!connected||!canRefresh||!!pendingId;if(this.refresh.disabled!==refreshDisabled)this.refresh.disabled=refreshDisabled;const refreshUnavailable=String(refreshDisabled||busy);if(this.refresh.getAttribute('aria-disabled')!==refreshUnavailable)this.refresh.setAttribute('aria-disabled',refreshUnavailable);
  const label=this.refresh.querySelector('[data-refresh-label]'),refreshLabel=!cards.length&&/kunne ikke hentes/.test(status||'')?'Prøv igen':'Andre forslag';if(label&&(!busy||!label.textContent)&&label.textContent!==refreshLabel)label.textContent=refreshLabel;
  for(const tab of this.tabs.querySelectorAll('[data-collection]')){if(tab.hidden)tab.hidden=false;if(tab.disabled!==!connected)tab.disabled=!connected;if(tab.getAttribute('aria-pressed')!==String(tab.dataset.collection===collection))tab.setAttribute('aria-pressed',String(tab.dataset.collection===collection));}
  const tabsHidden=this.host.state.focus!=='music'||collapsed;if(this.tabs.hidden!==tabsHidden)this.tabs.hidden=tabsHidden;
 }
}

// The overview uses the same admitted player model as the right-hand player.
// No fixture title is promoted into a live or unavailable account.
export function renderOverviewMediaValues(host){
 const vm=host.playerView?.progressVM||{},doc=host.ownerDocument;
 const known=vm.active===true&&typeof vm.title==='string'&&vm.title.trim();
 const radio=vm.sourceKind==='radio';
 const values={
  'home-music':known&&!radio?`${vm.fresh===false?'Sidst kendt':vm.playing?'Spiller':'Senest'}: ${vm.title}`:'Ingen seneste afspilning',
  'home-radio':known&&radio?`${vm.title} · ${vm.playing?'Valgt':'På pause'}`:host.live?'Ikke forbundet':'Ingen station valgt',
 };
 for(const [id,value]of Object.entries(values)){const node=doc.getElementById(id)?.querySelector('small');if(node&&node.textContent!==value)node.textContent=value;}
}
