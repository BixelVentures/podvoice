// Inert loopback-only enrollment protocol fixture. Never packaged in dist.
// Approval below is authored fixture state, not Home Assistant authentication.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../podvoice/gatekeeper/static/podview/',import.meta.url)));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
export const enrollmentRoom='enrollment',enrollmentBoot='fixture-enrollment-boot';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function createEnrollmentFixture({now=Date.now}={}){
 const requests=new Map(),profiles=new Set(),streams=new Set(),journal=[];let revision=1;
 const projection=()=>({schema:'podview.snapshot.v1',bootId:enrollmentBoot,roomId:enrollmentRoom,revision,observedAt:now()/1000,voice:{phase:'IDLE',sessionId:null,active:false},timers:{status:'observed',epoch:'fixture-empty-timers',items:[]},capabilities:{timerActions:[],musicRead:[],musicActions:[],homeRead:[],controlSetup:[],musicSelection:false,queueSelection:false,answerRead:false,visualEnrichment:false},controllerContinuity:{enabled:true,available:true},admission:{kind:'ha_ingress',authenticated:true}});
 const publish=()=>{for(const res of streams)res.write(`event: snapshot\ndata: ${JSON.stringify(projection())}\n\n`);};
 const handler=async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
  const json=(status,value,cookies)=>{res.writeHead(status,{'Content-Type':'application/json',...(cookies?{'Set-Cookie':cookies}:{})});res.end(JSON.stringify(value));};
  const deny=(status=403,error='fixture_effect_denied')=>json(status,{ok:false,error});
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')).filter(v=>v.length===2));
  const cookie=(name,value,age)=>`${name}=${value}; HttpOnly; SameSite=Strict; Path=/view/; Max-Age=${age}`;
  const read=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048)throw Error('body_limit');}return JSON.parse(raw);};
  const scope=(body,keys)=>exact(body,keys)&&body.bootId===enrollmentBoot&&body.roomId===enrollmentRoom;
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return deny();
  // QA-only native viewport: the child loads canonical product assets unchanged.
  if(url.pathname==='/fixture-frame'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><html lang="da"><meta charset="utf-8"><title>PodView · lokal 1280×800 QA-ramme</title><style>html,body{margin:0;padding:0}iframe{display:block;border:0;width:1280px;height:800px}</style><iframe title="PodView · 1280×800 lokal fixture" src="/view/?room=enrollment" width="1280" height="800"></iframe></html>');
  }
  if(url.pathname==='/fixture/journal'&&req.method==='GET')return json(200,{fixture:true,events:journal});
  if(['/config/integrations/integration/podvoice','/fixture/admin'].includes(url.pathname)&&req.method==='GET'){
   const rows=[...requests].filter(([,r])=>r.expiresAt>now()&&!r.claimed).map(([id,r])=>`<li><strong>${escape(r.name)}</strong> · ${r.signal} · ${r.approved?'Godkendt i fixture':'Afventer lokal fixturegodkendelse'}<form method="post" action="/fixture/approve"><input type="hidden" name="bootId" value="${enrollmentBoot}"><input type="hidden" name="roomId" value="${enrollmentRoom}"><input type="hidden" name="requestId" value="${id}"><input type="hidden" name="matchSignal" value="${r.signal}"><button ${r.approved?'disabled':''}>Godkend lokalt eksempel</button></form></li>`).join('');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(`<!doctype html><html lang="da"><meta charset="utf-8"><title>Lokal fixturegodkendelse</title><h1>Lokal fixture · ingen Home Assistant</h1><p>Dette er forfattet testtilstand. Ingen rigtig skærm tilknyttes, og ingen enheder kan betjenes.</p><ul>${rows||'<li>Ingen afventende fixtureanmodning. Indsend først skærmnavnet i PodView.</li>'}</ul><a href="/fixture/admin">Opdater fixtureliste</a></html>`);
  }
  if(url.pathname==='/fixture/approve'&&req.method==='POST'){
   if(req.headers['content-type']!=='application/x-www-form-urlencoded')return deny();
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048)return deny();}const params=new URLSearchParams(raw),body=Object.fromEntries(params),r=requests.get(body.requestId);
   if(params.size!==4||!scope(body,['bootId','roomId','requestId','matchSignal'])||!r||r.claimed||r.expiresAt<=now()||r.signal!==body.matchSignal)return deny();
   r.approved=true;journal.push({event:'authored_admin_approval',requestId:body.requestId});res.writeHead(303,{Location:'/fixture/admin'});return res.end();
  }
  if(url.pathname.startsWith('/view/api/')){
   if(url.searchParams.size!==1||url.searchParams.get('room')!==enrollmentRoom)return deny(409,'stale_fixture_scope');
   if(req.method==='GET'&&url.pathname==='/view/api/snapshot'){journal.push({event:'snapshot',revision});return json(200,projection());}
   if(req.method==='GET'&&url.pathname==='/view/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream'});streams.add(res);publish();const heartbeat=setInterval(publish,2000);req.on('close',()=>{clearInterval(heartbeat);streams.delete(res);});return;
   }
   if(req.method!=='POST'||!['/view/api/controller/request','/view/api/controller/claim','/view/api/controller/renew'].includes(url.pathname))return deny();
   if(req.headers['content-type']!=='application/json'||req.headers['x-podview-request']!=='1')return deny(400,'invalid_fixture_request');
   let body;try{body=await read();}catch{return deny(400,'invalid_fixture_request');}
   if(url.pathname==='/view/api/controller/request'){
    if(!scope(body,['bootId','roomId','name'])||typeof body.name!=='string'||body.name!==body.name.trim()||!body.name||body.name.length>48||/[\u0000-\u001f\u007f]/u.test(body.name))return deny(409,'stale_fixture_scope');
    for(const [id,r]of requests)if(r.expiresAt<=now())requests.delete(id);if(requests.size>=8)return deny(409,'controller_limit');
    const id=randomBytes(16).toString('hex'),proof=randomBytes(32).toString('base64url'),signal=randomBytes(3).toString('hex').toUpperCase();requests.set(id,{name:body.name,proof,signal,expiresAt:now()+300000,approved:false,claimed:false});journal.push({event:'request',requestId:id,name:body.name,matchSignal:signal});
    return json(200,{ok:true,requestId:id,matchSignal:signal,expiresIn:300},[cookie('podview_controller_request',proof,300)]);
   }
   if(url.pathname==='/view/api/controller/claim'){
    if(!scope(body,['bootId','roomId','requestId'])||typeof body.requestId!=='string'||!/^[a-f0-9]{32}$/.test(body.requestId))return deny(409,'stale_fixture_scope');const r=requests.get(body.requestId);
    if(!r||r.claimed||r.expiresAt<=now()||cookies.podview_controller_request!==r.proof)return deny(403,'request_denied');
    if(!r.approved){journal.push({event:'claim_pending',requestId:body.requestId});return json(200,{ok:true,status:'pending',expiresIn:Math.max(0,Math.floor((r.expiresAt-now())/1000))});}
    r.claimed=true;const profile=randomBytes(16).toString('hex')+'.'+randomBytes(32).toString('base64url');profiles.add(profile);revision++;journal.push({event:'claim_connected',requestId:body.requestId});publish();return json(200,{ok:true,status:'connected'},[cookie('podview_controller',profile,86400),cookie('podview_control','fixture-action-cookie-no-authority',300)]);
   }
   if(!exact(body,['roomId'])||body.roomId!==enrollmentRoom||!profiles.has(cookies.podview_controller)){journal.push({event:'renew_denied'});return deny(403,'controller_not_paired');}
   revision++;journal.push({event:'renew_validated',revision});publish();return json(200,{ok:true,expiresIn:300,controllerExpiresAt:null},[cookie('podview_control','fixture-renewed-cookie-no-authority',300)]);
  }
  if(req.method!=='GET')return deny();
  if(!url.pathname.startsWith('/view/'))return deny(404,'fixture_not_found');
  let relative;try{relative=decodeURIComponent(url.pathname.slice(6));}catch{return deny(404,'fixture_not_found');}
  const file=path.resolve(root,relative||'index.html');if(!file.startsWith(root+path.sep)&&file!==root)return deny(404,'fixture_not_found');
  try{const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);}catch{deny(404,'fixture_not_found');}
 };
 const server=http.createServer((req,res)=>handler(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();}));
 return {server,handler,journal,close:()=>{for(const stream of streams)stream.end();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const fixture=createEnrollmentFixture(),port=Number(process.env.PORT||4186);fixture.server.listen(port,'127.0.0.1',()=>console.log(`INERT enrollment fixture http://127.0.0.1:${port}/view/setup.html?room=${enrollmentRoom} · admin /fixture/admin · journal /fixture/journal · no HA/provider/effects`));
}
