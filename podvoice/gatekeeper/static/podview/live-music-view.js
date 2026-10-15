import {spotifyArtwork,spotifyTrackUrl,renderSpotifyArtwork} from './spotify-artwork.js';
const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const CATEGORIES=[['recent','Senest'],['top','Topsange'],['liked','Likede']];
const LABELS=Object.fromEntries(CATEGORIES);

export function projectMusicTracks(body,account){
 if(body?.ok!==true||!Array.isArray(body.data?.tracks)||account!==undefined&&(typeof account!=='string'||!account||body.data.config_entry_id!==account))return null;
 const artistOf=track=>typeof track?.artist==='string'?track.artist:Array.isArray(track?.artists)&&track.artists.every(artist=>typeof artist==='string')?track.artists.join(', '):null;
 return body.data.tracks.filter(track=>typeof track?.uri==='string'&&spotifyTrackUrl(track.uri)&&typeof (track.name||track.title)==='string'&&typeof artistOf(track)==='string').slice(0,3).map(track=>({uri:track.uri,title:track.name||track.title,artist:artistOf(track),artwork:spotifyArtwork(track.artwork),spotifyUrl:spotifyTrackUrl(track.uri)}));
}

// Passive catalogue surface. Rows are observations, never selectable actions.
export class LiveMusicCatalogueView{
 constructor(host,onSelect){this.host=host;this.onSelect=onSelect;this.rows=new Map();this.panel=document.createElement('section');this.panel.id='live-music';this.panel.className='live-music';this.panel.setAttribute('aria-label','Musik');this.controls=make('div','refinements');this.note=make('p','live-music-note','Vælg musik.');this.note.setAttribute('role','status');this.list=make('div','result-list live-music-list');this.account=null;this.panel.append(this.controls,this.note,this.list);for(const[kind,label]of CATEGORIES){const button=make('button',null,label);button.type='button';button.dataset.kind=kind;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>this.select(kind));this.controls.append(button);} $('music-response').append(this.panel);}
 select(kind){if(!CATEGORIES.some(([supported])=>supported===kind))return;const button=[...this.controls.children].find(b=>b.dataset.kind===kind);if(!button||button.hidden||button.disabled)return;this.selected=kind;this.loading(kind);this.onSelect(kind);}
 setPressed(){for(const button of this.controls.children)button.setAttribute('aria-pressed',String(button.dataset.kind===this.selected));}
 setBusy(value){this.panel.setAttribute('aria-busy',String(value));}
 updateCapabilities(connected,capabilities=[]){if(connected&&!this.account&&!this.renderedKind&&this.panel.getAttribute('aria-busy')!=='true')this.note.textContent='Vælg en konto.';for(const button of this.controls.children){const kind=button.dataset.kind;button.hidden=!capabilities.includes(kind);button.disabled=!connected||button.hidden;if(button.hidden&&this.selected===kind)this.selected=null;}}
 loading(kind){this.selected=kind;this.setPressed();this.note.textContent='Henter musik…';this.setBusy(true);}
 slow(kind){if(this.selected===kind)this.note.textContent='Det tager lidt længere tid…';}
 failure(kind){if(this.selected===kind)this.note.textContent=this.renderedKind?'Kunne ikke opdatere musikken.':'Musikken kunne ikke hentes.';this.setBusy(false);}
 offline(message='Forbindelsen mangler.'){this.note.textContent=this.renderedKind?'Viser seneste musik.':message;this.setBusy(false);}
 clearRows(){for(const row of this.rows.values())row.remove();this.rows.clear();this.list.replaceChildren();}
 resetAccount(account=null){this.account=account;this.renderedKind=null;this.selected=null;this.clearRows();this.setPressed();this.setBusy(false);this.note.textContent=account?'Vælg musik.':'Vælg en konto.';}
 tracks(kind,body,account){if(this.selected!==kind||account!==undefined&&account!==this.account)return;const valid=projectMusicTracks(body,account);if(valid===null){this.failure(kind);return;}this.clearRows();this.renderedKind=kind;if(!valid.length){this.note.textContent=body.data.tracks.length?'Sangene kunne ikke vises.':'Ingen sange i dette udvalg.';this.setBusy(false);return;}
  this.note.textContent=`${valid.length} ${valid.length===1?'sang':'sange'} · ${LABELS[kind]||'Musik'}`;for(const track of valid){const card=make('article','result live-music-result');const art=make('span','result-art live-track-art'),cover=make('img','live-track-cover');cover.loading='lazy';renderSpotifyArtwork(cover,{...track,name:track.title});art.append(cover);const text=make('div','result-copy'),title=make('h2',null,track.title),artist=make('p',null,track.artist);text.append(title,artist);const source=make('a','spotify-source-link','Spotify');source.href=track.spotifyUrl;source.target='_blank';source.rel='noopener noreferrer';source.referrerPolicy='no-referrer';source.setAttribute('aria-label',`Åbn ${track.title} hos Spotify`);card.append(art,text,source);this.rows.set(`${kind}:${this.rows.size}:${track.uri}`,card);this.list.append(card);}this.setBusy(false);
 }
}
