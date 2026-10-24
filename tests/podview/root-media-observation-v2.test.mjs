import test from 'node:test';
import assert from 'node:assert/strict';
import {roomPlaybackObservation,roomObservationCurrent,roomObservationDisplay,playbackBinding,playbackObservationCurrent} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
import {livePlayerModel,PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';
const snapshot={bootId:'boot',roomId:'display',capabilities:{musicRead:['playback']},mediaRoomBindings:[{roomId:'display',accountId:'account',targetId:'default',nativeRoomId:'default',nativeHomepodId:'1',bindingId:'b'.repeat(64)}]};
const wire=()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'display',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'display',accountId:'account',targetId:'external',nativeRoomId:'actual-room',nativeHomepodId:'2',bindingId:'a'.repeat(64),validUntil:Date.now()/1000+10},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:'epoch',poll_sequence:2,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:{state:'playing',target:{kind:'spotify_device',target_id:'external',name:'Spotify bridge'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
const parse=w=>roomPlaybackObservation(w,'account',snapshot);
test('v2 external actual output bypasses configured NEXT/default but never derives native label from Spotify target',()=>{
 const p=parse(wire());assert.equal(playbackBinding(p,snapshot).nativeHomepodId,'2');assert.equal(roomObservationCurrent(p,snapshot),true);assert.equal(playbackObservationCurrent(p,snapshot),true);
 const vm=livePlayerModel(p,true,'ready',snapshot,'Default','Actual speaker');assert.equal(vm.target,'Actual speaker');assert.equal(vm.title,'Song');assert.equal(vm.canSeek,false);assert.equal(livePlayerModel(p,true,'ready',snapshot,'Default').target,'Højttaler');
 const host={live:true,liveSnapshot:snapshot,liveMedia:{playback:p}},key=PlayerView.prototype.volumeBinding.call({host});host.liveSnapshot={...snapshot,mediaRoomBindings:[]};assert.equal(PlayerView.prototype.volumeBinding.call({host}),key);host.liveMedia.playback={...p,roomBinding:{...p.roomBinding,bindingId:'c'.repeat(64)}};assert.notEqual(PlayerView.prototype.volumeBinding.call({host}),key);
});
test('v2 metadata-only observation is fresh with no native or command binding and retains only explicit same-scope display',()=>{
 const w=wire();w.status='account_observed';w.reason='route_unavailable';w.binding=null;const p=parse(w);assert.equal(roomObservationCurrent(p,snapshot),false);assert.equal(playbackBinding(p,snapshot),null);assert.equal(playbackObservationCurrent(p,snapshot),true);assert.equal(livePlayerModel(p,true,'ready',snapshot).readOnly,true);assert.equal(livePlayerModel(p,true,'ready',snapshot).fresh,true);
 for(const status of ['observed','account_observed']){const source=status==='observed'?parse(wire()):p,old={...source,expiresAt:Date.now()-1};assert.equal(roomObservationDisplay(old,snapshot),false);assert.equal(roomObservationDisplay({...old,displayRetained:true},snapshot),true);assert.equal(roomObservationDisplay({...old,displayRetained:true},{...snapshot,bootId:'new'}),false);assert.equal(playbackObservationCurrent({...old,displayRetained:true},snapshot),false);}
});
test('v2 fresh idle and unavailable are distinct structured results with no phantom prior playback',()=>{
 const w=wire();w.status='idle';w.binding=null;w.data.playback={state:'no_active_playback',item:null,target:null};const idle=parse(w);assert.equal(idle.observationStatus,'idle');assert.equal(playbackObservationCurrent(idle,snapshot),true);assert.equal(roomObservationDisplay(idle,snapshot),false);
 w.status='unavailable';w.reason='owner_changed';w.data=null;const unavailable=parse(w);assert.equal(unavailable.reason,'owner_changed');assert.equal(unavailable.item,null);assert.equal(unavailable.target,null);assert.equal(playbackObservationCurrent(unavailable,snapshot),false);assert.equal(roomObservationDisplay({...unavailable,displayRetained:true},snapshot),false);
});
test('v2 rejects malformed schema/status/TTL/binding without legacy fallback and accepts new owner sequence',()=>{
 const mutations=[w=>w.extra=true,w=>w.data.room_proof_valid_until=Date.now()/1000+10,w=>w.binding.validUntil=Date.now()/1000-1,w=>w.binding.validUntil=NaN,w=>w.binding.targetId='wrong',w=>w.binding.accountId='wrong',w=>w.binding.roomId='wrong',w=>w.reason='route_unavailable',w=>w.data.playback.progress_ms=-1,w=>w.status='idle',w=>w.status='unavailable',w=>{w.status='account_observed';w.reason='route_unavailable';},w=>w.data.observation.observed_at=new Date(Date.now()-20000).toISOString()];
 for(const mutate of mutations){const w=wire();mutate(w);assert.throws(()=>parse(w));}
 const previous=parse(wire()),w=wire();w.data.poll_sequence=1;assert.throws(()=>roomPlaybackObservation(w,'account',snapshot,previous));w.data.owner_epoch='new';assert.equal(roomPlaybackObservation(w,'account',snapshot,previous).owner_epoch,'new');
 const p=parse(wire()),expiredNative={...p,roomBinding:{...p.roomBinding,validUntil:Date.now()/1000-1}};assert.equal(playbackBinding(expiredNative,snapshot),null);assert.equal(roomObservationCurrent(expiredNative,snapshot),false);assert.equal(playbackObservationCurrent(expiredNative,snapshot),true);assert.equal(livePlayerModel(expiredNative,true,'ready',snapshot).readOnly,true);
});

test('canonical nullable item and target preserve source facts without inventing native binding',()=>{
 for(const state of ['playing','paused'])for(const nulls of ['item','target','both']){
  const w=wire();w.status='account_observed';w.reason='route_unavailable';w.binding=null;w.data.playback.state=state;if(nulls!=='target')w.data.playback.item=null;if(nulls!=='item')w.data.playback.target=null;
  const p=parse(w);assert.equal(p.item,w.data.playback.item===null?null:p.item);assert.equal(p.target,w.data.playback.target===null?null:p.target);assert.equal(playbackObservationCurrent(p,snapshot),true);assert.equal(playbackBinding(p,snapshot),null);
 }
 const w=wire();w.data.playback.item=null;const p=parse(w);assert.equal(p.item,null);assert.equal(roomObservationCurrent(p,snapshot),true);w.data.playback.target=null;assert.throws(()=>parse(w),'positive binding cannot exist without actual target identity');
});

test('legacy account-observed freshness is metadata-only and retained expiry never becomes current',()=>{
 const w=wire(),binding=snapshot.mediaRoomBindings[0];w.schema='podview.room-playback.v1';delete w.reason;w.status='account_observed';w.binding=binding;w.data.playback.target.target_id=binding.targetId;
 const p=parse(w);assert.equal(playbackObservationCurrent(p,snapshot),true);assert.equal(roomObservationCurrent(p,snapshot),false);assert.equal(livePlayerModel(p,true,'ready',snapshot).fresh,true);
 for(const old of [{...p,stale:true,displayRetained:true},{...p,expiresAt:Date.now()-1,displayRetained:true}]){assert.equal(playbackObservationCurrent(old,snapshot),false);assert.equal(livePlayerModel(old,true,'ready',snapshot).fresh,false);}
});
