import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {buildStyles} from './build-assets.mjs';
import {scriptBundles} from './build-scripts.mjs';
const args=process.argv.slice(2);
const port=Number(args[args.indexOf('--port')+1])||4173;
const host=args.includes('--host')?args[args.indexOf('--host')+1]:'0.0.0.0';
const root=path.resolve('dist');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const conversationStages={overview:'Overblik',listening:'Lytter',working:'Arbejder',speaking:'Kun mundtligt svar',visual:'Visuelt svar',late:'Afventer næste svar',complete:'Tale afsluttet',interrupted:'Du afbryder',followup:'Opfølgende spørgsmål'};
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local'),qa=url.searchParams.get('qa');
 if(['/', '/index.html'].includes(url.pathname)&&['1024x600','1280x800','390x844'].includes(qa)){
  const [w,h]=qa.split('x'),review=url.searchParams.get('review')==='conversation';
  const requested=url.searchParams.get('stage')||'',stage=/^[a-z-]+$/.test(requested)?requested:review?'conversation-overview':'';
  const view=url.searchParams.get('view')==='library'?'/library.html':'/'+(stage?'?stage='+stage:'');
  const controls=review?`<header><strong>PodView · samtaleforløb</strong><label>Tilstand <select id="stage">${Object.entries(conversationStages).map(([key,label])=>`<option value="conversation-${key}"${stage===`conversation-${key}`?' selected':''}>${label}</option>`).join('')}</select></label><span>Lokale eksempeldata · ingen tale eller enhedsbetjening</span></header>`:'';
  res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
  res.end(`<!doctype html><html lang="da"><head><meta charset="utf-8"><title>PodView · lokal vurdering</title><style>body{margin:0;background:#ddd;font:15px Arial,sans-serif;color:#222}header{display:flex;align-items:center;gap:24px;padding:14px 24px;flex-wrap:wrap;background:#fff}header span{color:#555;font-size:13px}select{min-height:44px;margin-left:8px;padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:#fff;font:inherit}iframe{width:${w}px;height:${h}px;border:0;display:block}</style></head><body>${controls}<iframe title="PodView ${w} × ${h}" src="${view}"></iframe>${review?`<script>document.getElementById('stage').addEventListener('change',event=>{const stage=event.target.value;document.querySelector('iframe').src='/?stage='+encodeURIComponent(stage);const url=new URL(location.href);url.searchParams.set('stage',stage);history.replaceState(null,'',url);});</script>`:''}</body></html>`);return;
 }
 if(url.pathname==='/podview.css')await buildStyles();
 const pathname=decodeURIComponent(url.pathname),target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!target.startsWith(root+path.sep))throw Error();
 res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');let content=await readFile(target);const bundle=scriptBundles.find(item=>path.resolve(item.html)===target);if(bundle&&!args.includes('--delivery')){const link=path.basename(bundle.file),tag=`<script type="module" src="${link}"></script>`;content=content.toString().replace(tag,bundle.sources.map(source=>`<script type="module" src="${source}"></script>`).join(''));}res.end(content);
}catch{res.writeHead(404);res.end('Not found');}}).listen(port,host,()=>console.log(`PodView preview listening on ${port}`));
