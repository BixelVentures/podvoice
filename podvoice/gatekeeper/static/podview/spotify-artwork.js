// Provider covers stay source-bound; thematic alternatives have closed owner paths.
// Neither kind grants playback actions.
const PLAYLIST_URI=/^spotify:playlist:[A-Za-z0-9]{22}$/;
const IMAGE_PATH=/^\/image\/[A-Za-z0-9_-]{1,128}$/;
export function spotifyArtwork(value,uri){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='kind,provider,url'||(value.kind!=='album_cover'&&!(value.kind==='playlist_cover'&&PLAYLIST_URI.test(uri)))||value.kind==='album_cover'&&PLAYLIST_URI.test(uri)||value.provider!=='spotify'||typeof value.url!=='string'||value.url.length>512)return null;
 try{const url=new URL(value.url);if(url.protocol!=='https:'||url.hostname!=='i.scdn.co'||url.port||url.username||url.password||url.search||url.hash||!IMAGE_PATH.test(url.pathname)||value.url!==`https://i.scdn.co${url.pathname}`)return null;return {kind:value.kind,provider:'spotify',url:value.url};}catch{return null;}
}
// Immutable, owner-published thematic files; never an arbitrary image URL.
export function generatedMoodArtwork(value,themeId){
 if(typeof value!=='string'||!['morning_acoustic','evening_jazz','cooking','italian','indie','calm'].includes(themeId))return null;
 const prefix=`theme-art/${themeId}/`;return value.startsWith(prefix)&&/^[a-f0-9]{64}\.webp$/.test(value.slice(prefix.length))?value:null;
}
export function spotifyItemUrl(uri){const match=/^spotify:(track|episode):([A-Za-z0-9]{22})$/.exec(typeof uri==='string'?uri:'');return match?`https://open.spotify.com/${match[1]}/${match[2]}`:null;}
export function spotifyTrackUrl(uri){return typeof uri==='string'&&uri.startsWith('spotify:track:')?spotifyItemUrl(uri):null;}
const decodedArtwork=new WeakMap();
function decodedFor(image){const doc=image.ownerDocument?.defaultView||image.ownerDocument;if(!doc)return null;let cache=decodedArtwork.get(doc);if(!cache){cache=new Map();decodedArtwork.set(doc,cache);}return cache;}
const decodedKey=(image,url)=>JSON.stringify([image.dataset.artworkContent||'',url]);
function rememberDecoded(image,url,probe){const cache=decodedFor(image);if(!cache)return;const key=decodedKey(image,url);cache.delete(key);cache.set(key,probe);if(cache.size>64)cache.delete(cache.keys().next().value);}
const FALLBACK='assets/icons/music-note-beamed.svg';
function recordArtworkDiagnostic(image,code,owner){
 try{const transport=image.closest?.('pv-widget-host')?.liveTransport;if(owner!==undefined&&owner!==transport)return;transport?.recordDiagnostic?.('artwork',{code});}catch{/* Diagnostics cannot replace or interrupt the image fallback. */}
}
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
 const animation=image.animate([{opacity:0},{opacity:1}],{duration:120,easing:'cubic-bezier(.2,0,0,1)',iterations:1});image.artworkAnimation=animation;
 Promise.resolve(animation.finished).catch(()=>{}).finally(()=>{if(image.artworkAnimation===animation)image.artworkAnimation=null;});
}
export function renderRetainedArtwork(image,{url,identity,contentIdentity=identity,label,provider=false,backup=null,quiet=false,diagnosticOwner,retryKey}={}){
 const capturedOwner=diagnosticOwner===undefined?(image.closest?.('pv-widget-host')?.liveTransport??null):diagnosticOwner;
 if(quiet&&image.dataset.artworkQuiet!=='true')image.dataset.artworkQuiet='true';
 if(image.referrerPolicy!=='no-referrer')image.referrerPolicy='no-referrer';if(image.decoding!=='async')image.decoding='async';
 if(image.dataset.artworkContent!==contentIdentity){cancelArtwork(image);image.dataset.artworkContent=contentIdentity||'';delete image.dataset.failedArtwork;image.artworkFailures=new Set();image.artworkPrimaryFailure=null;image.artworkRetryKey=retryKey;if(image.getAttribute('src')&&image.getAttribute('src')!==FALLBACK)fallback(image);}
 // A fresh explicit source read may retry failures without discarding accepted art.
 if(retryKey!==undefined&&image.artworkRetryKey!==retryKey){image.artworkRetryKey=retryKey;if(image.artworkFailures?.size||image.dataset.failedArtwork||image.artworkPrimaryFailure){cancelArtwork(image);delete image.dataset.failedArtwork;image.artworkFailures=new Set();image.artworkPrimaryFailure=null;}}
 if(!image.spotifyErrorHandler){image.spotifyErrorHandler=()=>{if(image.dataset.displayedArtwork&&image.getAttribute('src')!==FALLBACK){recordArtworkDiagnostic(image,'resource_error',image.artworkDiagnosticOwner??null);const failed=image.dataset.displayedArtwork,owner=image.artworkDiagnosticOwner??null,next=!image.artworkRequest&&image.artworkBackup;image.dataset.failedArtwork=failed;(image.artworkFailures??=new Set()).add(failed);if(quiet)decodedFor(image)?.delete(decodedKey(image,image.getAttribute('src')));if(image.artworkRequest?.identity===failed)cancelArtwork(image);fallback(image);if(next){image.artworkPrimaryFailure=failed;renderRetainedArtwork(image,{...next,quiet,diagnosticOwner:owner});}}};image.addEventListener('error',image.spotifyErrorHandler);}
 // Every admitted failed stage remains failed for this content identity.
 // A quiet retained image stays accepted; otherwise follow its admitted chain.
 if(identity&&image.artworkFailures?.has(identity)&&quiet&&image.dataset.displayedArtwork&&image.getAttribute('src')!==FALLBACK)return false;
 if(identity&&(image.artworkPrimaryFailure===identity||image.artworkFailures?.has(identity))&&backup)return renderRetainedArtwork(image,{...backup,contentIdentity,quiet,diagnosticOwner:capturedOwner,retryKey});
 if(image.dataset.artworkIdentity!==identity){cancelArtwork(image);image.dataset.artworkIdentity=identity||'';}
 if(!url||!identity||(image.dataset.failedArtwork===identity||image.artworkFailures?.has(identity))){cancelArtwork(image);if(!(quiet&&image.dataset.displayedArtwork&&image.getAttribute('src')!==FALLBACK))fallback(image);return false;}
 if(image.getAttribute('src')===url){image.artworkBackup=backup?{...backup,contentIdentity,retryKey}:null;if(image.alt!==label)image.alt=label;if(image.dataset.displayedArtwork!==identity)image.dataset.displayedArtwork=identity;image.artworkDiagnosticOwner=capturedOwner;if(image.classList.contains('live-art-fallback'))image.classList.remove('live-art-fallback');if(image.classList.contains('spotify-artwork')!==provider)image.classList[provider?'add':'remove']('spotify-artwork');return true;}
 if(image.artworkRequest?.identity===identity){image.artworkRequest.label=label;image.artworkRequest.backup=backup;image.artworkRequest.retryKey=retryKey;return true;}
 cancelArtwork(image);image.artworkBackup=backup?{...backup,contentIdentity,retryKey}:null;
 const ImageClass=image.ownerDocument?.defaultView?.Image;
 if(quiet&&decodedFor(image)?.has(decodedKey(image,url))){image.src=url;image.alt=label;image.dataset.displayedArtwork=identity;image.artworkDiagnosticOwner=capturedOwner;image.classList.remove('live-art-fallback');image.classList[provider?'add':'remove']('spotify-artwork');return true;}
 // Non-browser renderers do not own image decoding; native browsers always do.
 if(!ImageClass){image.src=url;image.alt=label;image.dataset.displayedArtwork=identity;image.artworkDiagnosticOwner=capturedOwner;image.classList.remove('live-art-fallback');image.classList[provider?'add':'remove']('spotify-artwork');return true;}
 if(!image.getAttribute('src'))fallback(image);
 const probe=new ImageClass(),request={identity,contentIdentity,label,backup,probe,cancelled:false,diagnosticOwner:capturedOwner,retryKey};image.artworkRequest=request;image.dataset.artworkPending='true';probe.referrerPolicy='no-referrer';probe.decoding='async';
 probe.onerror=code=>{if(image.artworkRequest!==request||request.cancelled)return;recordArtworkDiagnostic(image,code==='decode_error'?'decode_error':'resource_error',request.diagnosticOwner);image.dataset.failedArtwork=identity;(image.artworkFailures??=new Set()).add(identity);const next=request.backup,retained=quiet&&image.dataset.displayedArtwork&&image.getAttribute('src')!==FALLBACK;if(next&&!retained)image.artworkPrimaryFailure=identity;cancelArtwork(image);if(!retained){fallback(image);if(next)renderRetainedArtwork(image,{...next,contentIdentity,quiet,diagnosticOwner:request.diagnosticOwner,retryKey:request.retryKey});}};
 probe.onload=()=>{Promise.resolve().then(()=>probe.decode?.()).then(()=>{
  if(image.artworkRequest!==request||request.cancelled||image.dataset.artworkIdentity!==identity||image.dataset.artworkContent!==contentIdentity)return;
  image.artworkRequest=null;image.artworkBackup=request.backup?{...request.backup,contentIdentity,retryKey:request.retryKey}:null;delete image.dataset.artworkPending;probe.onload=null;probe.onerror=null;image.src=url;image.alt=request.label;image.dataset.displayedArtwork=identity;image.artworkDiagnosticOwner=request.diagnosticOwner;image.classList.remove('live-art-fallback');image.classList[provider?'add':'remove']('spotify-artwork');if(quiet)rememberDecoded(image,url,probe);revealArtwork(image);
 }).catch(()=>probe.onerror?.('decode_error'));};
 probe.src=url;return true;
}
export function renderSpotifyArtwork(image,item,contentIdentity=item?.uri,quiet=false,diagnosticOwner,retryKey){
 const playlist=PLAYLIST_URI.test(item?.uri),art=spotifyItemUrl(item?.uri)||playlist?spotifyArtwork(item?.artwork,item?.uri):null,owned=playlist?(generatedMoodArtwork(item?.fallbackArt,item?.themeId)||(/^assets\/(?:(morning-acoustic|kitchen|italian|lake)\.(?:png|webp)|editorial-(forest|vinyl|ocean)\.(?:jpg|webp))$/.test(item?.fallbackArt||'')?item.fallbackArt.replace(/\.png$/,'.webp'):null)):null;
 return renderRetainedArtwork(image,{url:art?.url,identity:art?`${item.uri}|${art.url}`:'',contentIdentity,quiet,diagnosticOwner,retryKey,label:playlist?`Playlisteomslag til ${item?.name||item?.title||'afspilningslisten'}`:`Albumomslag til ${item?.name||item?.title||'sangen'}`,provider:true,backup:art&&owned?{url:owned,identity:`fixture|${owned}`,label:typeof item.fallbackLabel==='string'?item.fallbackLabel:'Illustration til afspilningslisten'}:null});
}
