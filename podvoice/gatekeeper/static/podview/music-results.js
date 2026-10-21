import {applyKitComponent,applyKitTemplate} from './ui/kit.js';
import {resultsFor} from './widget-model.js';
import {spotifyArtwork,generatedMoodArtwork,spotifyItemUrl,renderSpotifyArtwork,renderRetainedArtwork,cancelArtwork} from './spotify-artwork.js';

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
 return paths.map(path=>{const generated=generatedMoodArtwork(path,path?.split('/')[1]),identity=generated?generated.slice(generated.lastIndexOf('/')+1):path,chosen=(THEME_FALLBACKS.includes(path)||generated)&&!used.has(identity)?path:THEME_FALLBACKS.find(value=>!used.has(value)&&!reserved.has(value))||null;reserved.delete(path);if(chosen)used.add(chosen.startsWith('theme-art/')?chosen.slice(chosen.lastIndexOf('/')+1):chosen);return chosen;});
}
export function localMusicCards(options,revision){
 const themed=options.filter(option=>!['top','recent'].includes(option.collection)),images=naturalThemeArtwork(themed.map(option=>fixtureArtwork(option.art.startsWith('https:')?option.art:`assets/${option.art}`)));let index=0;
 return options.map(option=>{const cover=['top','recent'].includes(option.collection);return {id:option.id,name:option.name,description:option.description,detail:option.detail,artworkRole:cover?'cover':'editorial',fixtureArt:cover?fixtureArtwork(option.art.startsWith('https:')?option.art:`assets/${option.art}`):images[index++],artLabel:`${cover?'Albumomslag':'Illustration'} til ${option.name}`,revision};});
}
// Discovery presents only the selected tab. Playback belongs to the retained player.
export function localDiscoveryCards(state){
 const music=state.music;
 return localMusicCards(resultsFor(music),music.revision).map(card=>({...card,collection:music.collection}));
}
export function sourceMusicCards(tracks,kind){
 const rows=tracks.slice(0,3),images=naturalThemeArtwork(rows.filter(track=>track.themeTitle).map(track=>kind==='mood'&&generatedMoodArtwork(track.themeArt,track.themeId)||fixtureArtwork(track.themeArt))),used=new Set(),occurrences=new Map();let themedIndex=0;
 return rows.map((track,index)=>{
  const themed=!!track.themeTitle,sourceArtwork=spotifyArtwork(track.artwork,track.uri),imageKey=sourceArtwork&&`spotify|${sourceArtwork.url}`,artwork=sourceArtwork&&(!themed||!used.has(imageKey))?sourceArtwork:null,fallbackArt=themed?images[themedIndex++]:null;
  if(themed&&artwork)used.add(imageKey);
  const identity=JSON.stringify([track.uri,track.themeId||track.themeTitle||'']),occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
  return {id:`source:${identity}:${occurrence}`,name:track.themeTitle||track.name||track.title,description:track.themeTitle?(track.name||track.title):track.artist,detail:track.themeTitle?'Afspilningsliste fra Spotify':'',uri:track.uri,sourceName:track.name||track.title,sourceArtist:track.artist,artwork,...(themed?{themeId:track.themeId,sourceArtwork,...(fallbackArt?{fallbackArt,...(!artwork?{fixtureArt:fallbackArt}:{}),artLabel:`Illustration til ${track.themeTitle}`}:{})}:{})};
 });
}

// One retained card anatomy and the existing four tabs, shared by every adapter.
// It renders text nodes only. Selection authority stays in the supplying adapter.
export class MusicResults{
 constructor(host,{choose=()=>{}}={}){this.host=host;this.choose=choose;this.doc=host.ownerDocument;this.list=host.querySelector('#result-list');this.empty=host.querySelector('#empty');this.count=host.querySelector('#result-count');this.title=host.querySelector('#response-title');this.tabs=host.querySelector('#music-refinements');this.refresh=host.querySelector('#music-refresh');this.count.classList.add('music-result-summary');this.refresh.classList.add('music-refresh-footer');this.empty.classList.add('music-refresh-message');this.empty.setAttribute('role','status');this.empty.setAttribute('aria-live','polite');host.querySelector('#music-response')?.append(this.empty,this.refresh);this.refresh.addEventListener('click',event=>{if(this.refresh.disabled||this.refresh.getAttribute('aria-disabled')==='true'){event.preventDefault();event.stopImmediatePropagation();}},true);this.rows=new Map();this.groupHeadings=new Map();this.cleanup=()=>{for(const row of [...this.rows.values(),...(this.placeholders||[])]){cancelArtwork(row.children[0]);if(row.dataset.pending!=='false')row.dataset.pending='false';if(row.getAttribute('aria-busy')!=='false')row.setAttribute('aria-busy','false');if(row.children[2].textContent)row.children[2].textContent='';}for(const node of [this.list,this.refresh])if(node.getAttribute('aria-busy')!=='false')node.setAttribute('aria-busy','false');if(this.refresh.dataset.refreshState!=='idle')this.refresh.dataset.refreshState='idle';const label=this.refresh.querySelector('[data-refresh-label]');if(label&&label.textContent!=='Andre forslag')label.textContent='Andre forslag';};}
 create(id){const d=this.doc,row=make(d,'button','result pv-card pv-btn');applyKitComponent(row,'card');row.type='button';row.dataset.optionId=id;const art=make(d,'img','result-art'),copy=make(d,'div','result-copy'),title=make(d,'h2'),description=make(d,'p'),detail=make(d,'small'),feedback=make(d,'span','result-feedback'),play=make(d,'span','round result-play'),icon=make(d,'img');feedback.setAttribute('aria-live','polite');play.setAttribute('aria-hidden','true');icon.src='assets/icons/play-fill.svg';icon.alt='';play.append(icon);copy.append(title,description,detail);row.append(art,copy,feedback,play);row.addEventListener('click',()=>{if(row.disabled||row.getAttribute('aria-disabled')==='true')return;const card=row.musicCard;if(!this.host.live&&card.action==='continue'){if(this.host.state.music.playback.playing){this.host.dispatch({type:'show',id:'player'});this.host.focusHeading?.();}else this.doc.getElementById('play-pause')?.click();return;}if(!this.host.live&&this.host.state.music?.refreshPending){if(!this.host.musicRefresh?.cancelForSelection(card.id))return;row.dataset.revision=String(this.host.state.music.revision);}if(!this.host.live&&card.collection&&card.collection!==this.host.state.music.collection){this.host.music({type:'collection',value:card.collection});row.dataset.revision=String(this.host.state.music.revision);}this.choose(card,row);});return row;}
 render({cards=[],collection='mood',heading,status,empty='Ingen forslag matcher. Prøv en anden retning.',connected=true,busy=false,canRefresh=true,canChoose=true,canRenew=false,pendingId=null,revision,collapsed=false}={}){
  const grouped=cards.some(card=>card.group);if(this.list.dataset.grouped!==String(grouped))this.list.dataset.grouped=String(grouped);const groups=new Set(cards.map(card=>card.group).filter(Boolean));for(const [group,node]of this.groupHeadings)if(!groups.has(group)){node.remove();this.groupHeadings.delete(group);}let position=0;
  const showPlaceholders=busy&&!cards.length;
  if(!showPlaceholders)for(const row of this.placeholders||[])if(row.parentNode===this.list)row.remove();
  const wanted=new Set(cards.map(card=>card.id));for(const[id,row]of this.rows)if(!wanted.has(id)){cancelArtwork(row.children[0]);row.remove();this.rows.delete(id);}
  cards.forEach((card,index)=>{let row=this.rows.get(card.id);if(!row){row=this.create(card.id);this.rows.set(card.id,row);}row.musicCard=card;if(card.action==='continue')applyKitComponent(row,'hero');
   if(row.dataset.musicGroup!==(card.group||''))row.dataset.musicGroup=card.group||'';
   const nextRevision=String(card.revision??revision??'');if(row.dataset.revision!==nextRevision)row.dataset.revision=nextRevision;if(row.classList.contains('recommended')!==(index===0))row.classList.toggle('recommended',index===0);
   const artworkRole=spotifyArtwork(card.artwork,card.uri)||!card.fixtureArt&&spotifyItemUrl(card.uri)||card.artworkRole==='cover'&&fixtureArtwork(card.fixtureArt)?'cover':'editorial';if(row.dataset.artworkRole!==artworkRole)row.dataset.artworkRole=artworkRole;
   const allowed=connected&&(canChoose||canRenew)&&card.selectable!==false;if(row.disabled!==!allowed)row.disabled=!allowed;
   if(row.getAttribute('aria-disabled')!==String(!allowed||!!pendingId))row.setAttribute('aria-disabled',String(!allowed||!!pendingId));
   const pending=card.id===pendingId;
   if(row.getAttribute('aria-label')!==null)row.removeAttribute('aria-label');
   const actionDescription=pending?'Starter afspilning':allowed?card.action==='continue'?(this.host.state.music.playback.playing?'Åbn afspilleren':'Fortsæt'):'Afspil':'Afspilning ikke tilgængelig';if(row.getAttribute('aria-description')!==actionDescription)row.setAttribute('aria-description',actionDescription);
   if(row.dataset.pending!==String(pending))row.dataset.pending=String(pending);if(row.getAttribute('aria-busy')!==String(pending))row.setAttribute('aria-busy',String(pending));
   const actionIcon=row.children[3].children[0],actionSource=card.action==='continue'&&this.host.state.music.playback.playing?'assets/icons/chevron-right.svg':'assets/icons/play-fill.svg';if(actionIcon.getAttribute('src')!==actionSource)actionIcon.src=actionSource;
   const[art,copy,feedback]=row.children;for(const [node,value]of [[copy.children[0],text(card.name,256)],[copy.children[1],text(card.description,512)],[copy.children[2],text(card.detail,256)],[feedback,pending?'Starter afspilning':'']])if(node.textContent!==value)node.textContent=value;
   const contentIdentity=JSON.stringify([this.host.liveCatalogue?.account??null,this.host.liveSnapshot?.bootId??null,this.host.liveSnapshot?.roomId??null,card.uri||card.id,card.artworkGeneration??null]);if(spotifyArtwork(card.artwork,card.uri)){renderSpotifyArtwork(art,{uri:card.uri,name:card.sourceName||card.name,artwork:card.artwork,fallbackArt:card.fallbackArt,fallbackLabel:card.artLabel,themeId:card.themeId},contentIdentity,true);}else if(card.fixtureArt&&(fixtureArtwork(card.fixtureArt)||/^spotify:playlist:[A-Za-z0-9]{22}$/.test(card.uri)&&generatedMoodArtwork(card.fixtureArt,card.themeId))){renderRetainedArtwork(art,{url:card.fixtureArt,identity:`fixture|${card.fixtureArt}`,contentIdentity,quiet:true,label:text(card.artLabel,512)});}else renderSpotifyArtwork(art,{uri:card.uri,name:card.sourceName||card.name,artwork:card.artwork,fallbackArt:card.fallbackArt,fallbackLabel:card.artLabel,themeId:card.themeId},contentIdentity,true);
   if(card.group&&(index===0||cards[index-1].group!==card.group)){let heading=this.groupHeadings.get(card.group);if(!heading){heading=make(this.doc,'h2','music-group-heading');heading.textContent=card.group;this.groupHeadings.set(card.group,heading);}if(this.list.children[position]!==heading)this.list.insertBefore(heading,this.list.children[position]||null);position++;}if(this.list.children[position]!==row)this.list.insertBefore(row,this.list.children[position]||null);position++;
  });
  if(showPlaceholders){this.placeholders??=Array.from({length:3},()=>{const row=this.create('');delete row.dataset.optionId;row.disabled=true;row.dataset.empty='true';row.setAttribute('aria-hidden','true');for(const child of row.children)child.style.visibility='hidden';return row;});this.placeholders.forEach((row,index)=>{if(this.list.children[index]!==row)this.list.insertBefore(row,this.list.children[index]||null);});}
  if(this.title.textContent!=='Find musik')this.title.textContent='Find musik';if(!busy){const collectionLabel={mood:'Stemning',feeling:'Humør',top:'Topsange',recent:'Senest'}[collection]||'',context=collectionLabel,count=[context,status===undefined?`${cards.length} forslag`:text(status)].filter(Boolean).join(' · ');if(this.count.textContent!==count)this.count.textContent=count;}else if(!cards.length&&this.count.textContent)this.count.textContent='';
  const localOutcome=this.host.live?null:this.host.state.music?.refreshStatus,refreshOutcome=localOutcome==='error'||localOutcome==='empty'?localOutcome:/kunne ikke (?:opdatere|opdateres|hentes|hente)/i.test(status||'')?'error':/ingen nye forslag/i.test(status||'')?'empty':null,refreshMessage=refreshOutcome==='error'?(cards.length?'Kunne ikke hente nye forslag. De viste forslag er bevaret.':'Kunne ikke hente forslag. Prøv igen.'):refreshOutcome==='empty'?'Ingen nye forslag i denne opdatering.':'';if(this.empty.dataset.refreshOutcome!==(refreshOutcome||''))this.empty.dataset.refreshOutcome=refreshOutcome||'';const emptyMessage=refreshMessage||text(empty);if(this.empty.textContent!==emptyMessage)this.empty.textContent=emptyMessage;const emptyHidden=busy||!refreshMessage&&(cards.length>0||(!!text(status)&&text(status)===this.empty.textContent));if(this.empty.hidden!==emptyHidden)this.empty.hidden=emptyHidden;
  const refreshBusy=busy&&connected&&canRefresh&&!pendingId&&!this.host.liveSelection?.pending;if(this.refresh.dataset.refreshState!==(refreshBusy?'pending':'idle'))this.refresh.dataset.refreshState=refreshBusy?'pending':'idle';for(const [node,value]of [[this.list,busy],[this.refresh,refreshBusy]])if(node.getAttribute('aria-busy')!==String(value))node.setAttribute('aria-busy',String(value));const refreshDisabled=!connected||!canRefresh||!!pendingId;if(this.refresh.disabled!==refreshDisabled)this.refresh.disabled=refreshDisabled;const refreshUnavailable=String(refreshDisabled||refreshBusy);if(this.refresh.getAttribute('aria-disabled')!==refreshUnavailable)this.refresh.setAttribute('aria-disabled',refreshUnavailable);
  const label=this.refresh.querySelector('[data-refresh-label]'),refreshLabel=refreshBusy?'Henter forslag':refreshOutcome?'Prøv igen':!cards.length&&/kunne ikke hentes/.test(status||'')?'Prøv igen':'Andre forslag';if(label&&label.textContent!==refreshLabel)label.textContent=refreshLabel;
  for(const tab of this.tabs.querySelectorAll('[data-collection]')){if(tab.hidden)tab.hidden=false;if(tab.disabled)tab.disabled=false;if(tab.getAttribute('aria-pressed')!==String(tab.dataset.collection===collection))tab.setAttribute('aria-pressed',String(tab.dataset.collection===collection));}
  const tabsHidden=this.host.state.focus!=='music'||collapsed;if(this.tabs.hidden!==tabsHidden)this.tabs.hidden=tabsHidden;
 }
}

// The overview uses the same admitted player model as the right-hand player.
// No fixture title is promoted into a live or unavailable account.
export function renderOverviewMediaValues(host){
 const vm=host.playerView?.progressVM||{},doc=host.ownerDocument;
 const known=vm.active===true&&typeof vm.title==='string'&&vm.title.trim();
 const radio=vm.sourceKind==='radio';
 const artist=known&&!radio&&typeof vm.artist==='string'?vm.artist.trim().replace(/\s+/g,' '):'';
 const values={
  'home-music':known&&!radio?`${vm.fresh===false?'Sidst kendt':vm.playing?'Spiller':'Senest'}: ${vm.title}${artist?'\n'+artist:''}`:'Ingen seneste afspilning',
  'home-radio':known&&radio?`${vm.title} · ${vm.playing?'Valgt':'På pause'}`:host.live?'Ikke forbundet':'Ingen station valgt',
 };
 for(const [id,value]of Object.entries(values)){const card=doc.getElementById(id);if(card?.dataset.mediaLayout==='media')continue;const node=card?.querySelector('small');if(node&&node.textContent!==value)node.textContent=value;if(id==='home-music'&&node){const metadata=String(!!artist);if(node.dataset.mediaMetadata!==metadata)node.dataset.mediaMetadata=metadata;}}
}
