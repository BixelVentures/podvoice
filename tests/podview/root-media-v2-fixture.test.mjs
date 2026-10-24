import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {fixtureRequest} from '../../scripts/live-fixture.mjs';
import {mediaV2Room as room,mediaV2Boot as bootId,mediaV2Account as account,mediaV2Phases,mediaV2Fixture} from '../../scripts/media-v2-fixture.mjs';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {roomPlaybackObservation,roomObservationCurrent,playbackBinding,playbackObservationCurrent} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
import {livePlayerModel} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {speakerCatalogue} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
const request=(endpoint,body,{method=body?'POST':'GET',headers={'content-type':'application/x-www-form-urlencoded'}}={})=>new Promise((resolve,reject)=>{
 const req=Readable.from(body?[body]:[]);Object.assign(req,{url:endpoint,method,headers});let status=200,raw='';fixtureRequest(req,{setHeader(){},writeHead(value){status=value;},end(value=''){raw+=value;resolve({status,body:raw.startsWith('{')?JSON.parse(raw):raw});}}).catch(reject);
});
const advance=(step,change={})=>request('/fixture-media-v2/step',new URLSearchParams({bootId,roomId:room,step:String(step),...change}).toString());
const read=kind=>request('/view/api/'+kind+'?room='+room);
test('actual v2 fixture reads traverse the native transport and distinguish external output, pause, route loss, idle, unavailable and restoration',async()=>{
 await advance(0);const snap=(await read('snapshot')).body,sent=[],transport=new PodVoiceTransport({room,url:'http://loopback.invalid/view/?room='+room,fetch:async(url,init={})=>{sent.push(String(url));const u=new URL(url),reply=await request(u.pathname+u.search,init.body,{method:init.method||'GET',headers:init.headers||{}});return {ok:reply.status===200,status:reply.status,json:async()=>reply.body};}});transport.snapshot=snap;transport.closed=false;transport.connected=true;transport.controller=new AbortController();
 let previous=null;try{
  assert.deepEqual(snap.capabilities.controlSetup,[]);assert.equal(snap.capabilities.queueSelection,false);assert.equal(snap.mediaRoomBindings[0].targetId,'fixture-default');assert.equal((await transport.music('targets')).data.accounts[0].config_entry_id,account);
  const context={bootId,roomId:room,accountId:account},title='Forfattet ekstern afspilning';
  for(let step=0;step<mediaV2Phases.length;step++){
   assert.equal((await advance(step)).status,200);transport.snapshot=(await read('snapshot')).body;const body=await transport.music('playback',account),p=roomPlaybackObservation(body,account,transport.snapshot,previous),catalogue=await transport.music('speakers',account),rows=speakerCatalogue(catalogue,context);assert.ok(rows);assert.equal(body.schema,'podview.room-playback.v2');assert.equal(Object.keys(body).length,9);
   if([0,1,2,6].includes(step)){
    const binding=playbackBinding(p,transport.snapshot);assert.ok(binding);assert.notEqual(binding.bindingId,snap.mediaRoomBindings[0].bindingId);assert.equal(binding.targetId,step===2?'fixture-external-frida':'fixture-external-svend');assert.equal(Object.keys(binding).length,7);assert.equal(Object.keys(body.data).length,8);assert.equal(Object.hasOwn(body.data,'room_proof_valid_until'),false);assert.equal(roomObservationCurrent(p,transport.snapshot),true);
    const matched=rows.find(row=>row.nativeRoomId===binding.nativeRoomId&&row.homepodId===binding.nativeHomepodId),vm=livePlayerModel(p,true,'ready',transport.snapshot,'Køkken · standard',matched.name);assert.equal(vm.target,step===2?'Frida · fixture':'Svend · fixture');assert.equal(vm.title,title);assert.equal(p.state,[1,6].includes(step)?'paused':'playing');assert.equal(p.progressMs,84000);assert.equal(vm.canSeek,false);assert.equal(rows.find(r=>r.default).outputSelected,false);
   }else if(step===3){assert.equal(p.observationStatus,'account_observed');assert.equal(p.item.name,title);assert.equal(playbackBinding(p,transport.snapshot),null);assert.equal(roomObservationCurrent(p,transport.snapshot),false);assert.equal(playbackObservationCurrent(p,transport.snapshot),true);assert.equal(livePlayerModel(p,true,'ready',transport.snapshot).readOnly,true);}
   else if(step===4){assert.equal(p.observationStatus,'idle');assert.equal(p.state,'no_active_playback');assert.equal(p.item,null);assert.equal(p.target,null);assert.equal(playbackObservationCurrent(p,transport.snapshot),true);}
   else{assert.equal(p.observationStatus,'unavailable');assert.equal(p.reason,'account_unavailable');assert.equal(p.item,null);assert.equal(p.target,null);assert.equal(body.data,null);assert.equal(playbackObservationCurrent(p,transport.snapshot),false);}
   previous=p;
  }
  const count=sent.length;await assert.rejects(transport.queueOffer(account,'fixture-external-svend','2'.repeat(64)));await assert.rejects(transport.controlSetup('music',{accountId:account,kind:'spotify_device',targetId:'fixture-external-svend',expectedBindingId:'2'.repeat(64)}));assert.equal(sent.length,count,'read-only fixture capabilities do not dispatch native effects');
 }finally{transport.close();}
});
test('QA scenario changes only bounded server fixture observations; browser remains the canonical 1280×800 product with no state injection',async()=>{
 const page=await request('/fixture-media-v2');assert.equal(page.status,200);assert.match(page.body,/src="\/view\/\?room=media-v2"/);assert.match(page.body,/width="1280" height="800"/);assert.match(page.body,/target="fixture-receipt"/);assert.equal(/<script|eval\(|postMessage/.test(page.body),false);assert.equal((await request('/fixture-frame?room='+room+'&size=1280x800')).status,200);
 for(const change of [{bootId:'foreign'},{roomId:'foreign'},{step:'7'},{step:'-1'},{extra:'no'}])assert.equal((await advance(0,change)).status,403);
 for(const route of ['actions','pair','control/setup','control/actions','music/queue/offer','music/queue/actions','music/selection/setup','music/selection/actions'])assert.equal((await request('/view/api/'+route+'?room='+room,'{}',{headers:{'content-type':'application/json'}})).status,403,route);
 assert.equal((await request('/view/api/actions','{}',{headers:{'content-type':'application/json',referer:'http://local/view/?room='+room}})).status,403,'query-free native actions are denied for this room too');
 assert.equal((await request('/view/api/music?room='+room+'&kind=playback&account=foreign')).status,409);
 const journal=(await request('/fixture-media-v2/journal')).body;assert.equal(journal.fixture,true);assert.ok(journal.events.length<=128);assert.ok(journal.events.every(row=>['authored_observation_change','playback_read','effect_denied','authored_network_change','passive_503'].includes(row.event)));
});

test('fixed980 viewport uses the same retained productiframe and native network controls, without arbitrary width or client injection',async()=>{
 const page=(await request('/fixture-media-v2?width=980')).body;assert.match(page,/width="980" height="800"/);assert.match(page,/width:980px;height:800px/);assert.match(page,/src="\/view\/\?room=media-v2"/);assert.match(page,/action="\/fixture-media-v2\/network" target="fixture-receipt"/);assert.match(page,/<button name="network" value="off">/);assert.match(page,/<button name="network" value="on">/);assert.equal(/<script|eval\(|postMessage/.test(page),false);
 for(const width of ['100','99999','980px','980%3Bcolor%3Ared'])assert.match((await request('/fixture-media-v2?width='+width)).body,/width="1280" height="800"/);
});
test('networkoff genuinely closes an existing SSE stream and503s passive reads; networkon preserves phase and restores normal protocol reads without effects',async()=>{
 const network=(value,change={})=>request('/fixture-media-v2/network',new URLSearchParams({bootId,roomId:room,network:value,...change}).toString());
 await network('on');await advance(1);const before=(await request('/fixture-media-v2/journal')).body,source=(await request('/view/api/music?room='+room+'&kind=playback&account='+account)).body;
 const req=new EventEmitter();Object.assign(req,{method:'GET',headers:{}});let frames=[],closed=false,status;
 const res={writeHead:value=>{status=value;},write:value=>frames.push(value),end:()=>{closed=true;}};
 try{
  assert.equal(await mediaV2Fixture(req,res,new URL('http://local/view/api/events?room='+room)),true);assert.equal(status,200);assert.equal(frames.length,1);assert.match(frames[0],/event: snapshot/);
  for(const change of [{bootId:'foreign'},{roomId:'foreign'},{network:'false'},{extra:'denied'}])assert.equal((await network('off',change)).status,403);assert.equal(closed,false);
  assert.equal((await network('off')).status,200);assert.equal(closed,true);
  for(const route of ['snapshot','events','music?kind=playback&account='+account]){const url='/view/api/'+route+(route.includes('?')?'&':'?')+'room='+room,response=await request(url);assert.equal(response.status,503,route);assert.deepEqual(response.body,{ok:false,error:'authored_network_unavailable'});}
  const offline=(await request('/fixture-media-v2/journal')).body;assert.equal(offline.networkOnline,false);assert.equal(offline.step,1);assert.equal(offline.counts.passiveFailures-before.counts.passiveFailures,3);assert.equal(offline.counts.effectRequests,before.counts.effectRequests);assert.equal(offline.counts.effectDispatches,0);
  assert.equal((await network('on')).status,200);const restored=(await read('snapshot')).body,wire=(await request('/view/api/music?room='+room+'&kind=playback&account='+account)).body,p=roomPlaybackObservation(wire,account,restored);assert.equal(p.state,'paused');assert.equal(p.item.uri,source.data.playback.item.uri);assert.equal(p.progressMs,source.data.playback.progress_ms);assert.equal(wire.binding.bindingId,source.binding.bindingId);assert.equal(restored.revision,source.data.poll_sequence);
  const after=(await request('/fixture-media-v2/journal')).body;assert.equal(after.networkOnline,true);assert.equal(after.step,1);assert.equal(after.counts.effectRequests,before.counts.effectRequests);assert.equal(after.counts.effectDispatches,0);assert.ok(after.events.some(row=>row.event==='authored_network_change'&&row.networkOnline===false));
 }finally{req.emit('close');await network('on');}
});

test('library root preview and view ingress serve identical canonical product modules through the safe static fixture owner',async()=>{
 for(const file of ['index.html','library.html','podvoice-transport.js','ui/components.css']){
  const root=await request(file==='index.html'?'/?stage=music-paused':'/'+file),ingress=await request('/view/'+(file==='index.html'?'?stage=music-paused':file));assert.equal(root.status,200,file);assert.equal(ingress.status,200,file);assert.equal(root.body,ingress.body,file+' must use identical canonical bytes');
 }
 assert.equal((await request('/../package.json')).status,404);assert.equal((await request('/view/%2e%2e/package.json')).status,404);
});
