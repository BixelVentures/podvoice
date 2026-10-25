import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
const source=readFileSync(process.env.MUSIC_QUERY_OWNER_SOURCE||new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const start=source.indexOf(' async loadLiveMusic(kind){')+' async loadLiveMusic(kind){'.length,end=source.indexOf('\n connectGestures(){',start);
assert.ok(start>0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,load=new AsyncFunction('kind',source.slice(start,end).replace(/\n \}\s*$/,''));
for(const kind of ['mood','feeling','recent','account_playlists'])test(`explicit different-card choice obtains fresh authority through the existing ${kind} read contract`,async()=>{
 const urls=[],adopted=[],transport=new PodVoiceTransport({url:'https://fixture.invalid/view/',room:'room',fetch:async(url,options)=>{
  urls.push(new URL(url));assert.equal(options.method??'GET','GET');
  const actual=urls.at(-1),fresh=!['mood','feeling'].includes(kind)||actual.searchParams.get('renew')==='1';
  return {ok:true,status:200,json:async()=>({ok:true,candidateSetId:(fresh?'b':'a').repeat(64)})};
 }});transport.connected=true;transport.closed=false;transport.controller=new AbortController();transport.snapshot={capabilities:{musicRead:[kind]}};
 const request={kind:kind==='account_playlists'?'top':kind,sourceKind:kind,reason:'choice'},host={isConnected:true,liveTransport:transport,liveMedia:{account:'account'},liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{musicRead:[kind]}},liveCatalogue:{pendingRead:request,loading(){},slow(){},tracks(_kind,body){adopted.push(body);},failure(){assert.fail('read contract must succeed');},setBusy(){}}};
 try{await load.call(host,request.kind);assert.equal(urls.length,1);assert.equal(urls[0].pathname,'/view/api/music');assert.equal(urls[0].searchParams.get('kind'),kind);assert.equal(urls[0].searchParams.get('account'),'account');assert.equal(urls[0].searchParams.has('choice'),false);assert.equal(urls[0].searchParams.get('renew'),['mood','feeling'].includes(kind)?'1':null);assert.equal(adopted.length,1);assert.equal(adopted[0].candidateSetId,'b'.repeat(64),'a consumed cached candidate cannot be reused');}
 finally{clearTimeout(host.musicSlowTimer);transport.controller.abort();}
});
