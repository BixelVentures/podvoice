// Closed provider artwork projection. Never accepts model images or playback actions.
const PLAYLIST_URI=/^spotify:playlist:[A-Za-z0-9]{22}$/;
const IMAGE_PATH=/^\/image\/[A-Za-z0-9_-]{1,128}$/;
export function spotifyArtwork(value,uri){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='kind,provider,url'||(value.kind!=='album_cover'&&!(value.kind==='playlist_cover'&&PLAYLIST_URI.test(uri)))||value.kind==='album_cover'&&PLAYLIST_URI.test(uri)||value.provider!=='spotify'||typeof value.url!=='string'||value.url.length>512)return null;
 try{const url=new URL(value.url);if(url.protocol!=='https:'||url.hostname!=='i.scdn.co'||url.port||url.username||url.password||url.search||url.hash||!IMAGE_PATH.test(url.pathname)||value.url!==`https://i.scdn.co${url.pathname}`)return null;return {kind:value.kind,provider:'spotify',url:value.url};}catch{return null;}
}
export function spotifyItemUrl(uri){const match=/^spotify:(track|episode):([A-Za-z0-9]{22})$/.exec(typeof uri==='string'?uri:'');return match?`https://open.spotify.com/${match[1]}/${match[2]}`:null;}
export function spotifyTrackUrl(uri){return typeof uri==='string'&&uri.startsWith('spotify:track:')?spotifyItemUrl(uri):null;}
const FALLBACK='assets/icons/music-note-beamed.svg';
function fallback(image){image.artworkAnimation?.cancel();image.artworkAnimation=null;if(image.getAttribute('src')!==FALLBACK)image.src=FALLBACK;if(image.alt!=='Omslag ikke tilgængeligt')image.alt='Omslag ikke tilgængeligt';if(image.classList.contains('spotify-artwork'))image.classList.remove('spotify-artwork');if(!image.classList.contains('live-art-fallback'))image.classList.add('live-art-fallback');if(image.dataset.displayedArtwork!==undefined)delete image.dataset.displayedArtwork;}
// The visible image stays in place while its admitted replacement is fetched and
// decoded. A superseded load can never overwrite a later source or a fallback.
export function cancelArtwork(image){
 image.artworkAnimation?.cancel();image.artworkAnimation=null;image.artworkBackup=null;
 const request=image.artworkRequest;if(!request)return;image.artworkRequest=null;request.cancelled=true;request.probe.onload=null;request.probe.onerror=null;request.probe.removeAttribute?.('src');delete image.dataset.artworkPending;
}
function revealArtwork(image){
 const view=image.ownerDocument?.defaultView,reduced=image.closest?.('[data-motion="reduced"]')||image.getRootNode?.()?.host?.dataset?.motion==='reduced'||view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 if(reduced||image.isConnected===false||typeof image.animate!=='function')return;
 const animation=image.animate([{opacity:0},{opacity:1}],{duration:180,easing:'cubic-bezier(.16,1,.3,1)',iterations:1});image.artworkAnimation=animation;
 Promise.resolve(animation.finished).catch(()=>{}).finally(()=>{if(image.artworkAnimation===animation)image.artworkAnimation=null;});
}
export function renderRetainedArtwork(image,{url,identity,contentIdentity=identity,label,provider=false,backup=null}={}){
 if(image.referrerPolicy!=='no-referrer')image.referrerPolicy='no-referrer';if(image.decoding!=='async')image.decoding='async';
 if(image.dataset.artworkContent!==contentIdentity){cancelArtwork(image);image.dataset.artworkContent=contentIdentity||'';delete image.dataset.failedArtwork;image.artworkPrimaryFailure=null;if(image.getAttribute('src')&&image.getAttribute('src')!==FALLBACK)fallback(image);}
 if(!image.spotifyErrorHandler){image.spotifyErrorHandler=()=>{if(image.dataset.displayedArtwork&&image.getAttribute('src')!==FALLBACK){const failed=image.dataset.displayedArtwork,next=!image.artworkRequest&&image.artworkBackup;image.dataset.failedArtwork=failed;if(image.artworkRequest?.identity===failed)cancelArtwork(image);fallback(image);if(next){image.artworkPrimaryFailure=failed;renderRetainedArtwork(image,next);}}};image.addEventListener('error',image.spotifyErrorHandler);}
 // A failed primary remains failed while its one admitted owned alternative loads.
 // Repeated snapshots must neither retry the provider nor restart the alternative.
 if(identity&&image.artworkPrimaryFailure===identity&&backup)return renderRetainedArtwork(image,{...backup,contentIdentity});
 if(image.dataset.artworkIdentity!==identity){cancelArtwork(image);image.dataset.artworkIdentity=identity||'';}
 if(!url||!identity||image.dataset.failedArtwork===identity){cancelArtwork(image);fallback(image);return false;}
 if(image.getAttribute('src')===url){image.artworkBackup=backup?{...backup,contentIdentity}:null;if(image.alt!==label)image.alt=label;if(image.dataset.displayedArtwork!==identity)image.dataset.displayedArtwork=identity;if(image.classList.contains('live-art-fallback'))image.classList.remove('live-art-fallback');if(image.classList.contains('spotify-artwork')!==provider)image.classList[provider?'add':'remove']('spotify-artwork');return true;}
 if(image.artworkRequest?.identity===identity){image.artworkRequest.label=label;image.artworkRequest.backup=backup;return true;}
 cancelArtwork(image);image.artworkBackup=backup?{...backup,contentIdentity}:null;
 const ImageClass=image.ownerDocument?.defaultView?.Image;
 // Non-browser renderers do not own image decoding; native browsers always do.
 if(!ImageClass){image.src=url;image.alt=label;image.dataset.displayedArtwork=identity;image.classList.remove('live-art-fallback');image.classList[provider?'add':'remove']('spotify-artwork');return true;}
 if(!image.getAttribute('src'))fallback(image);
 const probe=new ImageClass(),request={identity,contentIdentity,label,backup,probe,cancelled:false};image.artworkRequest=request;image.dataset.artworkPending='true';probe.referrerPolicy='no-referrer';probe.decoding='async';
 probe.onerror=()=>{if(image.artworkRequest!==request||request.cancelled)return;image.dataset.failedArtwork=identity;const next=request.backup;if(next)image.artworkPrimaryFailure=identity;cancelArtwork(image);fallback(image);if(next)renderRetainedArtwork(image,{...next,contentIdentity});};
 probe.onload=()=>{Promise.resolve().then(()=>probe.decode?.()).then(()=>{
  if(image.artworkRequest!==request||request.cancelled||image.dataset.artworkIdentity!==identity||image.dataset.artworkContent!==contentIdentity)return;
  image.artworkRequest=null;image.artworkBackup=request.backup?{...request.backup,contentIdentity}:null;delete image.dataset.artworkPending;probe.onload=null;probe.onerror=null;image.src=url;image.alt=request.label;image.dataset.displayedArtwork=identity;image.classList.remove('live-art-fallback');image.classList[provider?'add':'remove']('spotify-artwork');revealArtwork(image);
 }).catch(()=>probe.onerror?.());};
 probe.src=url;return true;
}
export function renderSpotifyArtwork(image,item,contentIdentity=item?.uri){
 const playlist=PLAYLIST_URI.test(item?.uri),art=spotifyItemUrl(item?.uri)||playlist?spotifyArtwork(item?.artwork,item?.uri):null,owned=playlist&&/^assets\/(?:(morning-acoustic|kitchen|italian|lake)\.(?:png|webp)|editorial-(forest|vinyl|ocean)\.(?:jpg|webp))$/.test(item?.fallbackArt||'')?item.fallbackArt.replace(/\.png$/,'.webp'):null;
 return renderRetainedArtwork(image,{url:art?.url,identity:art?`${item.uri}|${art.url}`:'',contentIdentity,label:playlist?`Playlisteomslag til ${item?.name||item?.title||'afspilningslisten'}`:`Albumomslag til ${item?.name||item?.title||'sangen'}`,provider:true,backup:art&&owned?{url:owned,identity:`fixture|${owned}`,label:typeof item.fallbackLabel==='string'?item.fallbackLabel:'Illustration til afspilningslisten'}:null});
}
