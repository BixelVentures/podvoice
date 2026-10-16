import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWidgetState,widgetTransition as step,resultsFor,musicRefreshFeedback} from '../../podvoice/gatekeeper/static/podview/widget-model.js';
import {initialScene,sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {LocalMusicRefresh} from '../../podvoice/gatekeeper/static/podview/flow-controller.js';

test('refresh preserves cards and playback until a matching completion and admits one request',()=>{
 const initial=initialWidgetState(),loading=step(initial,{type:'refresh',revision:initial.revision});
 assert.equal(loading.playback,initial.playback);assert.deepEqual(resultsFor(loading),resultsFor(initial));
 assert.equal(musicRefreshFeedback(loading),'');
 assert.equal(step(loading,{type:'refresh',revision:loading.revision}),loading);
 assert.equal(step(loading,{type:'select',id:resultsFor(loading)[0].id,revision:loading.revision}),loading);
 for(const invalid of [{requestId:999},{revision:0}])assert.equal(step(loading,{type:'refresh-result',...loading.refreshPending,...invalid,status:'ready'}),loading);
 const ready=step(loading,{type:'refresh-result',...loading.refreshPending,status:'ready'});
 assert.notDeepEqual(resultsFor(ready),resultsFor(initial));assert.equal(ready.playback,initial.playback);
 assert.equal(musicRefreshFeedback(ready),'');assert.equal(ready.refreshPending,null);
});

test('failed and empty refresh retain usable source cards and support a fresh retry',()=>{
 for(const status of ['error','empty']){
  const initial=initialWidgetState(),loading=step(initial,{type:'refresh',revision:initial.revision});
  const done=step(loading,{type:'refresh-result',...loading.refreshPending,status});
  assert.deepEqual(resultsFor(done),resultsFor(initial));assert.equal(done.playback,initial.playback);
  assert.match(musicRefreshFeedback(done),status==='error'?/Kunne ikke opdatere/:/Ingen nye forslag/);
  const retry=step(done,{type:'refresh',revision:done.revision});assert.ok(retry.refreshPending.requestId>loading.refreshPending.requestId);
  assert.equal(step(retry,{type:'refresh-result',...loading.refreshPending,status:'ready'}),retry);
 }
});

function harness(options={}){
 const queued=new Map();let serial=0,callback;
 const host={isConnected:true,state:initialScene(),dispatch(event){this.state=sceneTransition(this.state,event);this.refresh.sync();}};
 host.refresh=new LocalMusicRefresh(host,{after(fn){callback=fn;queued.set(++serial,fn);return serial;},cancel(id){queued.delete(id);},...options});
 return {host,queued,late(){callback();},complete(){const fn=[...queued.values()][0];queued.clear();fn();}};
}

test('finite local adapter completes and playback controls remain independent',()=>{
 const {host,queued,complete}=harness();host.refresh.start();assert.equal(queued.size,1);
 host.refresh.start();assert.equal(queued.size,1);
 host.dispatch({type:'music',event:{type:'volume',value:64}});host.dispatch({type:'music',event:{type:'toggle'}});
 complete();assert.equal(host.state.music.refreshPending,null);assert.equal(host.state.music.suggestionPage,1);
 assert.equal(host.state.music.playback.volume,64);assert.equal(host.state.music.playback.playing,false);assert.equal(queued.size,0);
});

test('local adapter cancels on tab, navigation, offline, session end and removal and rejects late callbacks',()=>{
 for(const change of [
  h=>h.dispatch({type:'music',event:{type:'collection',value:'top'}}),
  h=>h.dispatch({type:'show',id:'photo'}),
  h=>h.dispatch({type:'offline'}),
  h=>h.dispatch({type:'session-ended'}),
  h=>{h.isConnected=false;h.refresh.dispose();},
 ]){
  const {host,queued,late}=harness();host.refresh.start();change(host);const before=host.state;
  assert.equal(queued.size,0);assert.equal(host.state.music.refreshPending,null);late();assert.equal(host.state,before);
 }
});

test('local adapter maps fixture reader failure to retry feedback without replacing cards',()=>{
 const {host,complete}=harness({outcome(){throw new Error('local fixture unavailable');}}),before=resultsFor(host.state.music);
 host.refresh.start();complete();assert.equal(host.state.music.refreshStatus,'error');assert.deepEqual(resultsFor(host.state.music),before);
});
