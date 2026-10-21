import test from 'node:test';import assert from 'node:assert/strict';import {playbackObservation,queueObservation} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
const item={type:'track',uri:'spotify:track:abc',name:'Song',artists:['Artist'],duration_ms:1000};
const playback=()=>({ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:'owner',poll_sequence:3,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',age_ms:100,max_age_ms:15000,observed_at:new Date().toISOString()},playback:{state:'playing',target:{kind:'spotify_device',target_id:'device',name:'Kitchen'},item}});
test('only current account provider observations can establish playback',()=>{const v=playback(),p=playbackObservation(v,'account');assert.equal(p.item.name,'Song');assert.throws(()=>playbackObservation(v,'another'));assert.throws(()=>playbackObservation({...v,poll_sequence:2},'account',p));assert.throws(()=>playbackObservation({...v,physical_result_verified:true},'account'));assert.throws(()=>playbackObservation({...v,observation:{...v.observation,age_ms:16000}},'account'));assert.equal(playbackObservation({...v,owner_epoch:'new',poll_sequence:1},'account',p).poll_sequence,1);});
test('explicit empty playback never retains a phantom target or item',()=>{const v=playback();assert.throws(()=>playbackObservation({...v,playback:{...v.playback,state:'no_active_playback'}},'account'));const p=playbackObservation({...v,playback:{state:'no_active_playback',target:null,item:null}},'account');assert.equal(p.item,null);});
test('queue preserves duplicate URI occurrences and rejects duplicate snapshot IDs',()=>{const v={ok:true,schema:'podconnect.queue.v1',config_entry_id:'account',owner_epoch:'owner',snapshot_id:'owner:q:1',scope:'account',relation_to_playback:'not_atomic',observed_at:new Date().toISOString(),returned_count:2,items:[{...item,option_id:'owner:q:1:0'},{...item,option_id:'owner:q:1:1'}]};const q=queueObservation(v,'account');assert.equal(q.items.length,2);assert.notEqual(q.items[0].id,q.items[1].id);assert.throws(()=>queueObservation({...v,items:[v.items[0],v.items[0]]},'account'));assert.throws(()=>queueObservation({...v,scope:'room'},'account'));});

test('unnamed provider speakers retain playback and malformed timestamps fail closed',()=>{const v=playback();v.playback.target.name=null;assert.equal(playbackObservation(v,'account').target.name,null);v.observation.observed_at='not-a-date';assert.throws(()=>playbackObservation(v,'account'));});

test('response delay cannot renew provider observation freshness',()=>{const v=playback();v.observation.observed_at=new Date(Date.now()-20000).toISOString();v.observation.age_ms=100;assert.throws(()=>playbackObservation(v,'account'),/expired/);v.observation.observed_at=new Date(Date.now()+6000).toISOString();assert.throws(()=>playbackObservation(v,'account'),/future/);});

test('current and duplicate queue occurrences preserve only actual closed Spotify artwork',()=>{
 const art={kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/ab67616d0000b273abc'},source={...item,uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:art,html:'<script>'};
 const v=playback();v.playback.item=source;const p=playbackObservation(v,'account');assert.deepEqual(p.item.artwork,art);assert.equal(p.item.spotifyUrl,'https://open.spotify.com/track/0123456789ABCDEFGHIJKL');assert.equal(p.item.html,undefined);
 const q=queueObservation({ok:true,schema:'podconnect.queue.v1',config_entry_id:'account',owner_epoch:'owner',snapshot_id:'owner:q:2',scope:'account',relation_to_playback:'not_atomic',observed_at:new Date().toISOString(),returned_count:2,items:[{...source,option_id:'owner:q:2:0'},{...source,option_id:'owner:q:2:1'}]},'account');
 assert.notEqual(q.items[0].id,q.items[1].id);assert.deepEqual(q.items.map(i=>i.artwork),[art,art]);
 v.playback.item.artwork={...art,url:'https://wrong.example/cover'};assert.equal(playbackObservation(v,'account').item.artwork,null);
});

test('source progress is admitted only as a nonnegative safe integer, never carried between item observations',()=>{
 for(const value of [0,500,1000]){const v=playback();v.playback.progress_ms=value;assert.equal(playbackObservation(v,'account').progressMs,value);}
 for(const value of [undefined,null,-1,NaN,Infinity,'500',1.5,Number.MAX_SAFE_INTEGER+1]){const v=playback();v.playback.progress_ms=value;assert.equal(playbackObservation(v,'account').progressMs,null);}
 const v=playback();v.playback.progress_ms=500;const old=playbackObservation(v,'account');const next=playback();next.playback.item={...item,uri:'spotify:track:new'};assert.equal(playbackObservation(next,'account',old).progressMs,null);
});
