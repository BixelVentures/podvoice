// Find musik's shared music helpers: fixture artwork admission, the period label for the empty player,
// the start flow's source cards (the player's wish while a start is under way) and the overview card values.
// The Find musik page itself is drawn by src/screens/music (FindMusik.tsx).
import {discoveryPeriod} from './widget-model.js';
import {MUSIC_THEMES,MUSIC_FEELINGS} from './music-selection-model.js';
import {spotifyArtwork,generatedMoodArtwork} from './spotify-artwork.js';

export {discoveryPeriod};
const DISCOVERY_PERIOD={morning:'Godmorgen',afternoon:'Til eftermiddagen',evening:'Til aftenen'};
// The same period heading the music page uses, for the resting music card's context line.
export const discoveryPeriodLabel=now=>DISCOVERY_PERIOD[discoveryPeriod(now)]||'';
const make=(doc,tag,cls)=>{const node=doc.createElement(tag);if(cls)node.className=cls;return node;};
// The fixture adapter admits only bundled images or its explicitly verified artwork hosts.
export function fixtureArtwork(value){
 if(typeof value!=='string')return null;
 if(/^assets\/[A-Za-z0-9_/-]+\.(png|webp|jpg|jpeg|svg)$/.test(value))return value.replace(/^assets\/(morning-acoustic|kitchen|italian|lake|indie)\.png$/, 'assets/$1.webp');
 try{const u=new URL(value);return u.protocol==='https:'&&['image-cdn-fa.spotifycdn.com','image-cdn-ak.spotifycdn.com'].includes(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/image\/[A-Za-z0-9]+$/.test(u.pathname)?u.href:null;}catch{return null;}
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


// The overview uses the same admitted player model as the right-hand player.
// No fixture title is promoted into a live or unavailable account.
export function renderOverviewMediaValues(host){
 const focused=host.playerView?.progressVM||{},doc=host.ownerDocument,vm=host.live?host.playerView?.sourceModel?.('music')||focused:focused,radioVM=host.live?host.playerView?.sourceModel?.('radio')??focused:focused;
 const known=vm.active===true&&typeof vm.title==='string'&&vm.title.trim();
 const radio=vm.sourceKind==='radio';
 const artist=known&&!radio&&typeof vm.artist==='string'?vm.artist.trim().replace(/\s+/g,' '):'';
 const emptyMusic={offline:'Ikke forbundet',error:'Kan ikke hentes','account-selection':'Vælg musikkonto',loading:'Afventer data'}[vm.emptyState]||(host.live&&host.liveTransport?.connected===false?'Ikke forbundet':'Vælg musik');
 const radioKnown=radioVM.active===true&&radioVM.sourceKind==='radio'&&typeof radioVM.title==='string'&&!!radioVM.title.trim()&&(!host.live||((host.liveRadio?.hasSource?.()??host.liveRadio?.ownsPlayer?.())===true||host.liveRadio?.knownStopped?.()===true)||radioVM.loading===true&&!!host.liveRadio?.pendingStart?.());
 const radioAvailable=host.live?host.liveRadio?.current()===true:host.state?.connected!==false;
 const radioExample=radioVM.exampleOnly===true||typeof radioVM.previewLabel==='string'&&/ingen lyd/i.test(radioVM.previewLabel);
 const values={
  'home-music':{title:known&&!radio?`${vm.fresh===false&&!vm.readOnly?'Ikke opdateret · ':''}${vm.title}`:emptyMusic,secondary:known&&!radio?artist:'',status:known&&!radio?(vm.placement==='other-account'?'En anden Spotify-konto spiller her':vm.readOnly?`${vm.playing?'Afspiller':'På pause'} · højttaler ikke bekræftet`:vm.fresh===false?'Afspilningen er ikke opdateret':vm.playing?'Afspiller':'På pause'):''},
  'home-radio':{title:!radioAvailable?'Ikke tilgængelig':radioKnown?`${radioVM.fresh===false&&radioVM.playing&&!radioExample&&radioVM.loading!==true?'Ikke opdateret · ':''}${radioVM.title}`:radioAvailable?'Vælg station':'Ikke tilgængelig',secondary:radioAvailable&&radioKnown?(radioVM.loading===true?'Starter…':radioExample?'Ingen lyd':radioVM.playing?'Afspiller':'Stoppet'):'',status:''},
 };
 // W-radio »ikketilg«: the Radio widget is dimmed while radio cannot be chosen.
 const radioCard=doc.getElementById('home-radio'),radioState=radioAvailable?'ready':'unavailable';
 if(radioCard&&radioCard.dataset.kitState!==radioState)radioCard.dataset.kitState=radioState;
 // W-radio »spiller«/»starter«: the station logo fills the widget's 64-px surface.
 const radioArt=radioAvailable&&radioKnown&&/^assets\/radio-[a-z0-9-]+\.svg$/.test(radioVM.fixtureArt||'');
 const radioLogo=radioArt?`url(${radioVM.fixtureArt})`:'';
 if(radioCard?.style&&radioCard.style.getPropertyValue('--pv-radio-logo')!==radioLogo){
  if(radioLogo)radioCard.style.setProperty('--pv-radio-logo',radioLogo);
  else radioCard.style.removeProperty('--pv-radio-logo');
  radioCard.toggleAttribute('data-radio-logo',!!radioLogo);
 }
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
