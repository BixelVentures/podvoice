import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWidgetState,widgetTransition as step,resultsFor,TRACKS} from '../../podvoice/gatekeeper/static/podview/widget-model.js';
test('a choice changes playback only after its correlated simulated receipt',()=>{const s=initialWidgetState();const pending=step(s,{type:'select',id:'italian-favorites',revision:1});assert.deepEqual(pending.playback,s.playback);const done=step(pending,{type:'receipt',operation:pending.operation});assert.equal(done.playback.room,'Stuen');assert.equal(done.playback.track,8);assert.equal(done.pending,null);});
test('old receipt cannot overrule a newer room choice',()=>{let s=step(initialWidgetState(),{type:'select',id:'smooth-jazz',revision:1});const old=s.operation;s=step(s,{type:'target',accountId:'household',kind:'configured_alias',targetId:'kitchen',revision:s.revision});assert.equal(step(s,{type:'receipt',operation:old}),s);s=step(s,{type:'receipt',operation:s.operation});assert.equal(s.playback.room,'Køkkenet');});
test('pause supersedes pending playback and its late receipt',()=>{let s=step(initialWidgetState(),{type:'select',id:'smooth-jazz',revision:1});const old=s.operation;s=step(s,{type:'toggle'});assert.equal(s.playback.playing,false);assert.equal(step(s,{type:'receipt',operation:old}),s);});
test('legacy hidden filters cannot silently replace the frozen displayed choices',()=>{const start=initialWidgetState(),s=step(start,{type:'filter',value:'jazz'});assert.equal(s,start);assert.deepEqual(resultsFor(s),resultsFor(start));});
test('collapsing a response never stops or loses playback',()=>{const s=initialWidgetState();const collapsed=step(s,{type:'collapse'});assert.deepEqual(collapsed.playback,s.playback);assert.equal(collapsed.collapsed,true);assert.equal(step(collapsed,{type:'collapse'}).collapsed,false);});
test('pause and room transfer preserve track artwork without a duplicate pause notice',()=>{let s=step(initialWidgetState(),{type:'select',id:'smooth-jazz',revision:1});s=step(s,{type:'receipt',operation:s.operation});assert.equal(s.playback.art,TRACKS[7].art);s=step(s,{type:'toggle'});assert.equal(s.message,'');const paused=s.playback;s=step(s,{type:'target',accountId:'household',kind:'configured_alias',targetId:'living-room',revision:s.revision});s=step(s,{type:'receipt',operation:s.operation});assert.equal(s.playback.track,paused.track);assert.equal(s.playback.art,paused.art);assert.equal(s.playback.playing,false);});
test('queue selection shares playback and supersedes pending transfers',()=>{let s=step(initialWidgetState(),{type:'target',accountId:'household',kind:'configured_alias',targetId:'kitchen',revision:1});const operation=s.operation;assert.equal(step(s,{type:'queue-select',id:'cruel-summer',revision:0}),s);s=step(s,{type:'queue-select',id:'cruel-summer',revision:s.revision});assert.equal(s.playback.track,2);assert.equal(s.playback.art,TRACKS[2].art);assert.equal(s.playback.room,'Stuen');assert.equal(s.playback.playing,true);assert.equal(step(s,{type:'receipt',operation}),s);});

test('Connect rejects stale, unavailable, name-only and cross-account targets',()=>{const s=initialWidgetState(),valid={type:'target',accountId:'household',kind:'configured_alias',targetId:'kitchen',revision:1};for(const bad of [{revision:0},{accountId:'another-account'},{targetId:'Køkkenet'},{kind:'observed_output'},{kind:'spotify_device',targetId:'office'}])assert.equal(step(s,{...valid,...bad}),s);const pending=step(s,valid);assert.deepEqual(pending.playback,s.playback);const observed=step(pending,{type:'receipt',operation:pending.operation});assert.equal(observed.playback.targetId,'kitchen');assert.equal(observed.playback.track,s.playback.track);});
test('collection changes preserve playing music and invalidate old touch choices',()=>{const start=initialWidgetState(),s=step(start,{type:'collection',value:'top'});assert.deepEqual(s.playback,start.playback);assert.equal(resultsFor(s).length,3);assert.equal(step(s,{type:'select',id:'smooth-jazz',revision:1}),s);const p=step(s,{type:'select',id:resultsFor(s)[1].id,revision:s.revision});assert.equal(p.pending.track,1);});
test('empty player cannot resume phantom music but a real choice can start it',()=>{let s=step(initialWidgetState(),{type:'clear-playback'});assert.equal(s.playback.active,false);assert.equal(step(s,{type:'toggle'}),s);assert.equal(step(s,{type:'skip',delta:1}),s);s=step(s,{type:'select',id:'smooth-jazz',revision:s.revision});s=step(s,{type:'receipt',operation:s.operation});assert.equal(s.playback.active,true);assert.equal(s.playback.playing,true);});

test('local collections show distinct source-backed tracks and selecting a card starts that exact track',()=>{
 const start=initialWidgetState(),sets=[];
 for(const collection of ['top','recent']){
  const s=step(start,{type:'collection',value:collection}),options=resultsFor(s);
  sets.push(options.map(option=>option.id.split(':')[1]).join(','));
  for(const option of options){
   const pending=step(s,{type:'select',id:option.id,revision:s.revision});
   assert.deepEqual(pending.playback,s.playback);
   const done=step(pending,{type:'receipt',operation:pending.operation});
   assert.equal(TRACKS[done.playback.track].title,option.name);
   assert.match(TRACKS[done.playback.track].uri,/^spotify:track:[A-Za-z0-9]{22}$/);
   assert.equal(done.playback.playing,true);
  }
 }
 assert.equal(new Set(sets).size,2);
});

test('other suggestions keep playback and invalidate previous card bindings without changing the queue source',()=>{
 for(const collection of ['mood','feeling','top','recent']){
  const s=step(initialWidgetState(),{type:'collection',value:collection});
  const before=resultsFor(s),loading=step(s,{type:'refresh',revision:s.revision}),next=step(loading,{type:'refresh-result',...loading.refreshPending,status:'ready'});
  assert.deepEqual(resultsFor(loading),before);
  assert.equal(next.playback,s.playback);
  assert.notDeepEqual(resultsFor(next).map(x=>x.id),before.map(x=>x.id));
  assert.equal(resultsFor(next).length,3);
  assert.equal(step(next,{type:'select',id:before[0].id,revision:s.revision}),next);
  const pending=step(next,{type:'select',id:resultsFor(next)[0].id,revision:next.revision});
  assert.equal(step(pending,{type:'refresh'}),pending);
 }
});

test('mock start volume comes from its simulated owner receipt, while browsing and pause retain manual volume',()=>{
 let s=step(initialWidgetState(),{type:'volume',value:64});
 s=step(s,{type:'refresh',revision:s.revision});assert.equal(s.playback.volume,64);
 s=step(s,{type:'refresh-result',...s.refreshPending,status:'ready'});
 s=step(s,{type:'toggle'});assert.equal(s.playback.volume,64);
 const pending=step(s,{type:'select',id:resultsFor(s)[0].id,revision:s.revision});
 assert.equal(pending.playback.volume,64);
 const done=step(pending,{type:'receipt',operation:pending.operation});
 assert.equal(done.playback.volume,35);
});
