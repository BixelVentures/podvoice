// Closed provider artwork projection. Never accepts model images or playback actions.
const IMAGE_PATH=/^\/image\/[A-Za-z0-9_-]{1,128}$/;
export function spotifyArtwork(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='kind,provider,url'||value.kind!=='album_cover'||value.provider!=='spotify'||typeof value.url!=='string'||value.url.length>512)return null;
 try{const url=new URL(value.url);if(url.protocol!=='https:'||url.hostname!=='i.scdn.co'||url.port||url.username||url.password||url.search||url.hash||!IMAGE_PATH.test(url.pathname)||value.url!==`https://i.scdn.co${url.pathname}`)return null;return {kind:'album_cover',provider:'spotify',url:value.url};}catch{return null;}
}
export function spotifyItemUrl(uri){const match=/^spotify:(track|episode):([A-Za-z0-9]{22})$/.exec(typeof uri==='string'?uri:'');return match?`https://open.spotify.com/${match[1]}/${match[2]}`:null;}
export function spotifyTrackUrl(uri){return typeof uri==='string'&&uri.startsWith('spotify:track:')?spotifyItemUrl(uri):null;}
const FALLBACK='assets/icons/music-note-beamed.svg';
function fallback(image){if(image.getAttribute('src')!==FALLBACK)image.src=FALLBACK;image.alt='Omslag ikke tilgængeligt';image.classList.remove('spotify-artwork');image.classList.add('live-art-fallback');}
export function renderSpotifyArtwork(image,item){
 const art=spotifyItemUrl(item?.uri)?spotifyArtwork(item?.artwork):null;
 const identity=art?`${item.uri}|${art.url}`:'';
 image.referrerPolicy='no-referrer';image.decoding='async';image.dataset.artworkIdentity=identity;
 if(!image.spotifyErrorHandler){image.spotifyErrorHandler=()=>{if(image.classList.contains('spotify-artwork')&&image.dataset.artworkIdentity){image.dataset.failedArtwork=image.dataset.artworkIdentity;fallback(image);}};image.addEventListener('error',image.spotifyErrorHandler);}
 if(!art||image.dataset.failedArtwork===identity){fallback(image);return false;}
 if(image.getAttribute('src')!==art.url)image.src=art.url;
 image.alt=`Albumomslag til ${item.name||item.title||'sangen'}`;
 image.classList.remove('live-art-fallback');image.classList.add('spotify-artwork');return true;
}
