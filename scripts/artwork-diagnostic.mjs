// Loopback diagnostic only. Uses canonical MusicResults and native Image/decode.
// Bundled editorial images are authored test inputs, never Spotify cover evidence.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const assets=new Map([
 ['/view/assets/diagnostic/shared-slow.webp',{file:'assets/editorial-vinyl.webp',delay:4000}],
 ['/view/assets/diagnostic/account-next.webp',{file:'assets/editorial-ocean.webp',delay:6000}],
]);
export const artworkDiagnosticAsset=pathname=>assets.get(pathname)||null;
export const artworkDiagnosticHTML=`<!doctype html><html lang="da"><head><meta charset="utf-8"><base href="/view/"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lokalt artwork-forløb · ingen Spotify eller lyd</title><link rel="stylesheet" href="podview.css"><style>body{height:auto;overflow:auto;padding:0}body>header,body>details{padding:16px}#artwork-diagnostic-host{display:block;width:min(1280px,100%);height:800px;min-height:800px}#artwork-diagnostic-host>.frame{height:100%;min-height:0}#artwork-diagnostic-host>.frame>.responses{height:100%;min-height:0}</style></head><body><header aria-label="Lokale testhandlinger"><strong>Forfattet billeddiagnostik · ingen Spotifydata eller lyd</strong><p>Serveren forsinker billedsvaret 4/6 sekunder. Browserens egen decode er uændret.</p><button id="start">Start forsinket billede</button><button id="repeat">Gentag uændret render</button><button id="switch">Skift forfattet konto</button><button id="identity">Samme billede, nye kilde-ID'er</button></header><pv-widget-host id="artwork-diagnostic-host" data-level="detail" data-view="active" data-focus="music"><main class="frame"><section class="responses" aria-label="Kanoniske musikkort"></section></main></pv-widget-host><details open><summary>DOM- og klikjournal</summary><pre id="journal" aria-live="polite"></pre></details><script type="module" src="/fixture-artwork-client.js"></script></body></html>`;
export const artworkDiagnosticClient=`import {MusicResults} from '/view/music-results.js';
const host=document.querySelector('pv-widget-host'),journal=document.querySelector('#journal'),started=performance.now();
const record=(event,extra={})=>{const rows=[...host.querySelectorAll('#result-list>.result')].map(row=>{const image=row.querySelector('img'),r=row.getBoundingClientRect();return {id:row.dataset.optionId,src:image.getAttribute('src'),pending:image.dataset.artworkPending==='true',displayed:image.dataset.displayedArtwork||null,content:image.dataset.artworkContent,rect:[r.x,r.y,r.width,r.height]};});journal.textContent+=JSON.stringify({ms:Math.round(performance.now()-started),event,...extra,rows})+'\\n';};
const markup=new DOMParser().parseFromString(await(await fetch('/view/')).text(),'text/html'),article=markup.querySelector('#music-response');article.hidden=false;host.querySelector('.responses').append(document.importNode(article,true));
Object.assign(host,{live:true,state:{focus:'music'},liveCatalogue:{account:'authored-account-a'},liveSnapshot:{bootId:'authored-diagnostic',roomId:'loopback-artwork'}});
const renderer=new MusicResults(host,{choose:card=>record('native-card-click',{cardId:card.id,account:host.liveCatalogue.account})});
let cards=[],generation=0;
const render=()=>{renderer.render({cards,collection:'top',status:'Forfattet billedforløb · ingen afspilning',canRefresh:false,canChoose:true});record('render');};
const inputs=(url,prefix)=>['A','B'].map((label,index)=>({id:prefix+':'+index,name:'Forfattet kilde '+label,description:'Delt forfattet illustration',detail:'Ingen Spotifydata eller lyd',fixtureArt:url,artworkRole:'cover',artLabel:'Forfattet illustration til kilde '+label}));
document.querySelector('#start').addEventListener('click',()=>{host.liveCatalogue.account='authored-account-a';cards=inputs('assets/diagnostic/shared-slow.webp','source:'+ ++generation);render();});
document.querySelector('#repeat').addEventListener('click',render);
document.querySelector('#switch').addEventListener('click',()=>{host.liveCatalogue.account='authored-account-b';cards=cards.map(card=>({...card,fixtureArt:'assets/diagnostic/account-next.webp'}));render();record('account-switched');});
document.querySelector('#identity').addEventListener('click',()=>{cards=inputs('assets/diagnostic/shared-slow.webp','new-source:'+ ++generation);render();record('new-source-ids');});
const observer=new MutationObserver(records=>{if(records.some(row=>row.target.matches?.('.result-art')))record('artwork-dom-change');});observer.observe(host,{subtree:true,attributes:true,attributeFilter:['src','data-artwork-pending','data-artwork-content','data-displayed-artwork']});
window.addEventListener('pagehide',()=>{observer.disconnect();renderer.cleanup();},{once:true});record('ready');`;
export async function artworkDiagnosticFixture(req,res,url){
 if(url.pathname==='/fixture-artwork'){res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');res.end(artworkDiagnosticHTML);return true;}
 if(url.pathname==='/fixture-artwork-client.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(artworkDiagnosticClient);return true;}
 const asset=artworkDiagnosticAsset(url.pathname);if(!asset)return false;
 if(req.method&&req.method!=='GET'){res.writeHead(405);res.end();return true;}
 res.setHeader('Content-Type','image/webp');res.setHeader('Cache-Control','no-store');
 const timer=setTimeout(async()=>{try{res.end(await readFile(path.resolve('podvoice/gatekeeper/static/podview',asset.file)));}catch{res.writeHead(404);res.end();}},asset.delay);
 res.once?.('close',()=>clearTimeout(timer));return true;
}
