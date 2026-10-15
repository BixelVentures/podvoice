import {spotifyArtwork,renderSpotifyArtwork} from './spotify-artwork.js';

export const MUSIC_TABS=[['mood','Stemning'],['top','Topsange'],['recent','Senest'],['liked','Likede']];
const text=(value,max=1024)=>typeof value==='string'?value.slice(0,max):'';
const make=(doc,tag,cls)=>{const node=doc.createElement(tag);if(cls)node.className=cls;return node;};
// The fixture adapter admits only bundled images or its explicitly verified artwork hosts.
export function fixtureArtwork(value){
 if(typeof value!=='string')return null;
 if(/^assets\/[A-Za-z0-9_/-]+\.(png|jpg|jpeg|svg)$/.test(value))return value;
 try{const u=new URL(value);return u.protocol==='https:'&&['image-cdn-fa.spotifycdn.com','image-cdn-ak.spotifycdn.com'].includes(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/image\/[A-Za-z0-9]+$/.test(u.pathname)?u.href:null;}catch{return null;}
}
export function localMusicCards(options,revision){return options.map(option=>({id:option.id,name:option.name,description:option.description,detail:option.detail,fixtureArt:fixtureArtwork(option.art.startsWith('https:')?option.art:`assets/${option.art}`),artLabel:`${option.collection?'Albumomslag':'Illustration'} til ${option.name}`,revision}));}
export function sourceMusicCards(tracks){return tracks.slice(0,3).map((track,index)=>({id:`source:${index}:${track.uri}`,name:track.themeTitle||track.name||track.title,description:track.themeTitle?(track.name||track.title):track.artist,detail:track.themeTitle?'Afspilningsliste fra Spotify':'',uri:track.uri,sourceName:track.name||track.title,sourceArtist:track.artist,artwork:spotifyArtwork(track.artwork),...(track.themeTitle?{fixtureArt:fixtureArtwork(track.themeArt),artLabel:`Illustration til ${track.themeTitle}`}:{})}));}

// One retained card anatomy and the existing four tabs, shared by every adapter.
// It renders text nodes only. Selection authority stays in the supplying adapter.
export class MusicResults{
 constructor(host,{choose=()=>{}}={}){this.host=host;this.choose=choose;this.doc=host.ownerDocument;this.list=host.querySelector('#result-list');this.empty=host.querySelector('#empty');this.count=host.querySelector('#result-count');this.title=host.querySelector('#response-title');this.tabs=host.querySelector('#music-refinements');this.refresh=host.querySelector('#music-refresh');this.rows=new Map();}
 create(id){const d=this.doc,row=make(d,'button','result');row.type='button';row.dataset.optionId=id;const art=make(d,'img','result-art'),copy=make(d,'div','result-copy'),title=make(d,'h2'),description=make(d,'p'),detail=make(d,'small'),feedback=make(d,'span','result-feedback'),play=make(d,'span','round result-play'),icon=make(d,'img');feedback.setAttribute('aria-live','polite');play.setAttribute('aria-hidden','true');icon.src='assets/icons/play-fill.svg';icon.alt='';play.append(icon);copy.append(title,description,detail);row.append(art,copy,feedback,play);row.addEventListener('click',()=>{if(!row.disabled&&row.getAttribute('aria-disabled')!=='true')this.choose(row.musicCard,row);});return row;}
 render({cards=[],collection='mood',heading,status,empty='Ingen forslag matcher. Prøv en anden retning.',connected=true,busy=false,canRefresh=true,canChoose=true,pendingId=null,revision,collapsed=false}={}){
  const wanted=new Set(cards.map(card=>card.id));for(const[id,row]of this.rows)if(!wanted.has(id)){row.remove();this.rows.delete(id);}
  cards.forEach((card,index)=>{let row=this.rows.get(card.id);if(!row){row=this.create(card.id);this.rows.set(card.id,row);}row.musicCard=card;row.dataset.revision=String(card.revision??revision??'');row.classList.toggle('recommended',index===0);const allowed=connected&&!busy&&canChoose&&card.selectable!==false;row.disabled=!allowed;row.setAttribute('aria-disabled',String(!allowed||!!pendingId));row.setAttribute('aria-label',`${allowed?'Afspil':'Afspilning ikke tilgængelig for'} ${text(card.name,256)}`);const pending=card.id===pendingId;row.dataset.pending=String(pending);row.setAttribute('aria-busy',String(pending));const[art,copy,feedback]=row.children;copy.children[0].textContent=text(card.name,256);copy.children[1].textContent=text(card.description,512);copy.children[2].textContent=text(card.detail,256);feedback.textContent=pending?'Starter…':'';
   if(card.fixtureArt&&fixtureArtwork(card.fixtureArt)){art.classList.remove('spotify-artwork','live-art-fallback');art.src=card.fixtureArt;art.alt=text(card.artLabel,512);}else renderSpotifyArtwork(art,{uri:card.uri,name:card.name,artwork:card.artwork});
   if(this.list.children[index]!==row)this.list.insertBefore(row,this.list.children[index]||null);
  });
  if(heading!==undefined)this.title.textContent=text(heading,256);this.count.textContent=status===undefined?`${cards.length} forslag`:text(status);this.empty.textContent=text(empty);this.empty.hidden=cards.length>0;this.list.setAttribute('aria-busy',String(busy));this.refresh.disabled=!connected||busy||!canRefresh||!!pendingId;this.refresh.setAttribute('aria-busy',String(busy));const label=this.refresh.querySelector('[data-refresh-label]');if(label)label.textContent=busy?'Henter…':'Andre forslag';
  for(const tab of this.tabs.querySelectorAll('[data-collection]')){tab.hidden=false;tab.disabled=!connected;tab.setAttribute('aria-pressed',String(tab.dataset.collection===collection));}
  this.tabs.hidden=this.host.state.focus!=='music'||collapsed;
 }
}
