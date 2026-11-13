import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {fixtureRequest} from '../../scripts/live-fixture.mjs';
import {mediaV2Room as room,mediaV2Boot as bootId,mediaV2Account as account,mediaV2Phases,mediaV2Fixture} from '../../scripts/media-v2-fixture.mjs';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {roomObservationCurrent,playbackBinding,playbackObservationCurrent,roomPlayerObservation} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
import {roomPlayerWire} from '../../scripts/room-player-wire.mjs';
// Authored scenes in the room player's wire shape (podview.room-player.v1).
const roomPlaybackObservation=(body,account,snapshot)=>roomPlayerObservation(roomPlayerWire(body),account,snapshot);
import {livePlayerModel} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {speakerCatalogue} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
const request=(endpoint,body,{method=body?'POST':'GET',headers={'content-type':'application/x-www-form-urlencoded'}}={})=>new Promise((resolve,reject)=>{
 const req=Readable.from(body?[body]:[]);Object.assign(req,{url:endpoint,method,headers});let status=200,raw='';fixtureRequest(req,{setHeader(){},writeHead(value){status=value;},end(value=''){raw+=value;resolve({status,body:raw.startsWith('{')?JSON.parse(raw):raw});}}).catch(reject);
});
const advance=(step,change={})=>request('/fixture-media-v2/step',new URLSearchParams({bootId,roomId:room,step:String(step),...change}).toString());
const read=kind=>request('/view/api/'+kind+'?room='+room);
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

test('library root preview and view ingress serve identical canonical product modules through the safe static fixture owner',async()=>{
 for(const file of ['index.html','library.html','podvoice-transport.js','ui/components.css']){
  const root=await request(file==='index.html'?'/?stage=music-paused':'/'+file),ingress=await request('/view/'+(file==='index.html'?'?stage=music-paused':file));assert.equal(root.status,200,file);assert.equal(ingress.status,200,file);assert.equal(root.body,ingress.body,file+' must use identical canonical bytes');
 }
 assert.equal((await request('/../package.json')).status,404);assert.equal((await request('/view/%2e%2e/package.json')).status,404);
});
