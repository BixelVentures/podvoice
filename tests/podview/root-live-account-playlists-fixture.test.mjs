import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixtureRequest} from '../../scripts/live-fixture.mjs';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {roomPlaybackObservation,roomObservationCurrent} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
import {accountPlaylistsSample,collectionCurrent,collectionSelection,directTargets,selectionOffer,selectionCurrent} from '../../podvoice/gatekeeper/static/podview/music-selection-model.js';
import {LiveMusicCatalogueView} from '../../podvoice/gatekeeper/static/podview/live-music-view.js';
const request=(endpoint,body,{method=body?'POST':'GET',headers={'content-type':'application/json','x-podview-request':'1'}}={})=>new Promise((resolve,reject)=>{
 const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url:endpoint,method,headers});let text='',status=200;
 fixtureRequest(req,{setHeader(){},writeHead(value){status=value;},end(value=''){text+=value;resolve({status,body:text.startsWith('{')?JSON.parse(text):text});}}).catch(reject);
});
const setup=async room=>{
 const snap=(await request('/view/api/snapshot?room='+room)).body,sent=[],transport=new PodVoiceTransport({room,url:`http://loopback.invalid/view/?room=${room}`,fetch:async(url,init={})=>{const body=init.body&&JSON.parse(init.body);sent.push({url:String(url),body});const reply=await request(new URL(url).pathname+new URL(url).search,body);return {ok:reply.status===200,status:reply.status,json:async()=>reply.body};}});transport.closed=false;transport.connected=true;transport.snapshot=snap;transport.controller=new AbortController();
 const account=(await transport.music('targets')).data.accounts[0].config_entry_id,binding=snap.mediaRoomBindings[0],playback=roomPlaybackObservation(await transport.music('playback',account),account,snap);
 return {snap,transport,account,binding,playback,sent};
};
test('four isolated rooms expose the actual account source capability and native room-bound retained player',async()=>{
 for(const room of ['account-playlists','account-playlists-readonly','account-playlists-empty','account-playlists-fail']){
  const f=await setup(room);try{assert.deepEqual(f.snap.capabilities.musicRead,['targets','playback','account_playlists']);assert.equal(f.snap.capabilities.musicSelection,room!=='account-playlists-readonly');assert.equal(roomObservationCurrent(f.playback,f.snap),true);assert.equal(f.playback.item.name,'Bevaret fixturesang');assert.equal(f.playback.progressMs,84000);assert.deepEqual(f.snap.capabilities.musicActions,[]);assert.deepEqual(f.snap.capabilities.timerActions,[]);assert.equal(f.account,f.binding.accountId);assert.equal((await request('/view/?room='+room)).status,200);}finally{f.transport.close();}
 }
 const ordinary=(await request('/view/api/snapshot?room=media')).body;assert.equal(ordinary.capabilities.musicRead.includes('account_playlists'),false);
});
test('actual read, subset setup and one native action use closed DTOs and opaque IDs without provider/audio effects',async()=>{
 const f=await setup('account-playlists');try{
  const wire=await f.transport.music('account_playlists',f.account),source=accountPlaylistsSample(wire,f.account,f.snap);assert.ok(source);assert.equal(source.tracks.length,5);assert.equal(collectionCurrent(source,f.snap,f.account),true);assert.equal(source.tracks[0].uri,'spotify:playlist:'+'a'.repeat(22));assert.ok(source.tracks.every(row=>row.artist==='Playliste'&&row.artwork===null));
  const selected=collectionSelection(source,[3,1,4]),targets=directTargets(await f.transport.music('targets',f.account),f.account,f.snap);assert.equal(targets.length,1);
  const receipt=await f.transport.musicSelectionSetup(source.context.candidateSetId,targets[0],selected.candidateIds),offer=selectionOffer(receipt,selected,targets[0]);assert.ok(offer);assert.equal(selectionCurrent(offer,f.snap,f.account,selected),true);assert.deepEqual(offer.options.map(row=>row.label),[source.tracks[3].name,source.tracks[1].name,source.tracks[4].name]);
  const result=await f.transport.musicSelectionAction(offer,offer.options[0].id);assert.equal(result.outcome,'unknown');assert.equal(result.physicalResultVerified,false);assert.equal(result.retryAllowed,false);
  const setupCall=f.sent.find(row=>row.url.endsWith('/music/selection/setup'));assert.deepEqual(setupCall.body.candidateIds,selected.candidateIds);assert.equal('uri' in setupCall.body,false);
  const actionCall=f.sent.find(row=>row.url.endsWith('/music/selection/actions'));assert.deepEqual((await request('/view/api/music/selection/actions',actionCall.body)).body,result);assert.equal((await request('/view/api/music/selection/actions',{...actionCall.body,requestId:crypto.randomUUID()})).status,409);
  const after=roomPlaybackObservation(await f.transport.music('playback',f.account),f.account,f.snap);assert.equal(after.item.uri,f.playback.item.uri);assert.equal(after.state,f.playback.state);assert.equal(after.progressMs,f.playback.progressMs);
 }finally{f.transport.close();}
});
test('readonly and empty responses omit candidateSet rather than fabricating choices',async()=>{
 for(const room of ['account-playlists-readonly','account-playlists-empty']){const f=await setup(room);try{const wire=await f.transport.music('account_playlists',f.account),source=accountPlaylistsSample(wire,f.account,f.snap);assert.ok(source);assert.equal(Object.hasOwn(wire,'candidateSet'),false);assert.equal(source.context,null);assert.equal(collectionCurrent(source,f.snap,f.account),false);assert.equal(source.tracks.length,room.endsWith('empty')?0:5);if(room.endsWith('readonly'))await assert.rejects(f.transport.musicSelectionSetup('a'.repeat(64),{accountId:f.account,kind:'spotify_device',targetId:f.binding.targetId},['a'.repeat(24)]));}finally{f.transport.close();}}
});
test('read failure crosses the actual catalogue failure path and retains cards, order, sample and player',async()=>{
 const f=await setup('account-playlists-fail'),renders=[],host={liveSnapshot:f.snap,liveTransport:f.transport,liveStatus:'connected',state:{focus:'music'},musicResults:{render:value=>renders.push(value)}};
 const view=new LiveMusicCatalogueView(host,()=>{});try{
  view.resetAccount(f.account);view.updateCapabilities(true,f.snap.capabilities.musicRead);view.select('top');view.tracks('top',await f.transport.music('account_playlists',f.account),f.account);const cards=view.cards,sample=view.sample;assert.equal(cards.length,3);assert.equal(renders.at(-1).canChoose,true);
  view.refresh();await assert.rejects(f.transport.music('account_playlists',f.account),error=>error.code==='read_transient');view.failure('top');assert.equal(view.cards,cards);assert.equal(view.sample,sample);assert.match(view.status,/viser seneste udvalg/);assert.equal(renders.at(-1).canChoose,false);assert.equal(view.busy,false);
  const after=roomPlaybackObservation(await f.transport.music('playback',f.account),f.account,f.snap);assert.equal(after.item.uri,f.playback.item.uri);assert.equal(after.progressMs,84000);
 }finally{clearTimeout(view.expiryTimer);f.transport.close();}
});
test('fixture setup denies stale scope, raw URI/foreign occurrence, extra fields and absent native headers',async()=>{
 const f=await setup('account-playlists');try{const source=accountPlaylistsSample(await f.transport.music('account_playlists',f.account),f.account,f.snap),body={bootId:f.snap.bootId,roomId:f.snap.roomId,candidateSetId:source.context.candidateSetId,target:{accountId:f.account,kind:'spotify_device',targetId:f.binding.targetId},candidateIds:[source.items[0].id]};
  for(const change of [{bootId:'other'},{roomId:'account-playlists-readonly'},{candidateSetId:'a'.repeat(64)},{candidateIds:[source.tracks[0].uri]},{candidateIds:['a'.repeat(24)]},{candidateIds:[source.items[0].id,source.items[0].id]},{target:{...body.target,accountId:'other'}},{extra:true}])assert.equal((await request('/view/api/music/selection/setup',{...body,...change})).status,409,JSON.stringify(change));
  assert.equal((await request('/view/api/music/selection/setup',body,{headers:{'content-type':'application/json'}})).status,400);assert.equal((await request('/view/api/music/selection/setup',body)).status,200,'invalid attempts never consume valid source');
 }finally{f.transport.close();}
});
