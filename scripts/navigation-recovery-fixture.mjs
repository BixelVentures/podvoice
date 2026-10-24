// Local-only failure controls. No upstream requests or device effects.
import http from 'node:http';
import {createEnrollmentFixture} from './enrollment-fixture.mjs';
const base=createEnrollmentFixture(),streams=new Set();let online=true;
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/fixture/network'){
  if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;online=new URLSearchParams(body).get('state')==='online';if(!online)for(const stream of streams)stream.end();res.writeHead(303,{Location:'/fixture/network'});res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<h1>Local network fixture: ${online?'online':'offline'}</h1><form method="post"><button name="state" value="offline">Disconnect local fixture</button><button name="state" value="online">Restore local fixture</button></form>`);return;
 }
 if(url.pathname==='/nav-frame'){
  const width=url.searchParams.get('width')==='980'?980:1280;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<style>html,body{margin:0}iframe{display:block;border:0;width:${width}px;height:800px}</style><iframe title="Local ${width} navigation" src="/view/?room=enrollment" width="${width}" height="800"></iframe>`);return;
 }
 if(url.pathname.startsWith('/view/api/')&&!online){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"ok":false,"error":"authored_outage"}');return;}
 if(url.pathname==='/view/api/events'){streams.add(res);res.on('close',()=>streams.delete(res));}
 await base.handler(req,res);
}).listen(4187,'127.0.0.1',()=>console.log('Local navigation fixture4187; /nav-frame?width=980 or1280; /fixture/network'));
