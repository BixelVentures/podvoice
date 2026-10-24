// Authored loopback QA: observations and deferred setup only; every action denied.
import http from 'node:http';
import {fixtureRequest} from './live-fixture.mjs';
import {mediaV2Snapshot,mediaV2Playback,mediaV2Speakers,mediaV2Account,mediaV2Boot,mediaV2Room} from './media-v2-fixture.mjs';
let mode='playing',epoch=Date.now(),hold=false,sequence=1;const pending=new Set(),streams=new Set();
const stats={setups:0,actionsDenied:0,effectDispatches:0};
const snapshot=()=>{const s=mediaV2Snapshot();s.capabilities.controlSetup=['music'];return s;};
const playback=()=>{const p=mediaV2Playback();if(mode==='stale')return {...p,status:'unavailable',binding:null,data:null,reason:'account_unavailable'};p.data.poll_sequence=++sequence;p.data.playback.state=mode==='paused'?'paused':'playing';p.data.playback.progress_ms=Math.min(199000,84000+(mode==='paused'?0:Date.now()-epoch));return p;};
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const offer=res=>json(res,200,{ok:true,schema:'podview.control.v1',roomId:mediaV2Room,bootId:mediaV2Boot,domain:'music',taskId:'control:'+(sequence++).toString(16).padStart(32,'0'),revision:1,expiresAt:Date.now()/1000+30,expectedBindingId:'2'.repeat(64),options:[{id:'a'.repeat(24),action:'pause',label:'Pause',argsSchema:{kind:'none'}},{id:'b'.repeat(24),action:'resume',label:'Fortsæt',argsSchema:{kind:'none'}},{id:'c'.repeat(24),action:'volume',label:'Lydstyrke',argsSchema:{kind:'percent',min:0,max:35}}],setup:{volume:mode==='unknown-volume'?null:35}});
const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname==='/incident'){
 const width=u.searchParams.get('width')==='980'?980:1280;res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<!doctype html><body style="margin:0"><p>Lokal playerfixture · ingen lyd eller enhedshandlinger.</p><form action="/incident/change" method="post" target="receipt">${['playing','paused','stale','unknown-volume','hold-setup','release-setup'].map(v=>`<button name="mode" value="${v}">${v}</button>`).join('')}</form><iframe name="receipt" title="Kvittering" style="display:block;border:0;width:${width}px;height:40px"></iframe><iframe title="Player ${width}" src="/view/?room=${mediaV2Room}" width="${width}" height="800" style="display:block;border:0"></iframe>`);
 }
 if(u.pathname==='/incident/change'&&req.method==='POST'){let b='';for await(const c of req)b+=c;const next=new URLSearchParams(b).get('mode');if(next==='hold-setup')hold=true;else if(next==='release-setup'){hold=false;for(const r of pending)offer(r);pending.clear();}else if(['playing','paused','stale','unknown-volume'].includes(next)){mode=next;epoch=Date.now();}res.end('Local fixture: '+mode+'; deferred setup '+hold);return;}
 if(u.pathname==='/incident/journal')return json(res,200,{mode,hold,pending:pending.size,...stats});
 if(u.pathname.startsWith('/view/api/')){
  if(req.method!=='GET'){
   if(u.pathname==='/view/api/control/setup'){stats.setups++;if(hold){pending.add(res);res.on('close',()=>pending.delete(res));return;}return offer(res);}
   stats.actionsDenied++;return json(res,403,{ok:false,error:'inert_fixture_no_effects'});
  }
  if(u.pathname==='/view/api/snapshot')return json(res,200,snapshot());
  if(u.pathname==='/view/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});streams.add(res);const push=()=>res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);push();const timer=setInterval(push,1000);req.on('close',()=>{clearInterval(timer);streams.delete(res);});return;}
  if(u.pathname==='/view/api/music'){const kind=u.searchParams.get('kind');if(kind==='targets')return json(res,200,{ok:true,data:{accounts:[{config_entry_id:mediaV2Account,title:'Lokal testkonto'}]}});if(kind==='playback')return json(res,200,playback());if(kind==='speakers')return json(res,200,mediaV2Speakers());return json(res,403,{ok:false,error:'inert_fixture_read_not_offered'});}
 }
 return fixtureRequest(req,res);
});server.listen(4189,'127.0.0.1',()=>console.log('Inert player incident fixture4189'));
