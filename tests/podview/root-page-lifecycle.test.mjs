import test from 'node:test';import assert from 'node:assert/strict';import {PageLifecycle} from '../../podvoice/gatekeeper/static/podview/ui/page-lifecycle.js';
import {initialScene,sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {LocalMusicRefresh} from '../../podvoice/gatekeeper/static/podview/flow-controller.js';
test('removed host cannot reconnect or schedule on pageshow, reattachment registers once',()=>{const target=new EventTarget();let requests=0,schedules=0,cleanups=0;const host={isConnected:true,live:true,liveTransport:{closed:true},connectPodVoice(){requests++;},schedule(){schedules++;},cleanup(){cleanups++;}};const life=new PageLifecycle(host,target);life.attach();target.dispatchEvent(new Event('pagehide'));assert.equal(cleanups,1);host.isConnected=false;life.detach();target.dispatchEvent(new Event('pageshow'));assert.equal(requests,0);assert.equal(schedules,0);host.isConnected=true;life.attach();life.attach();target.dispatchEvent(new Event('pageshow'));assert.equal(requests,1);assert.equal(schedules,1);life.detach();});
test('page restore renders the cancelled refresh before restarting work and ignores its late completion',()=>{
 const target=new EventTarget(),timers=new Map();let late;
 const host={isConnected:true,state:initialScene(),busy:false,scheduledBusy:null,
  dispatch(event){this.state=sceneTransition(this.state,event);this.refresh.sync();this.render();},
  render(){this.busy=!!this.state.music.refreshPending;},
  schedule(){this.scheduledBusy=this.busy;},cleanup(){this.refresh.dispose();}};
 host.refresh=new LocalMusicRefresh(host,{after(fn){late=fn;timers.set(1,fn);return 1;},cancel(id){timers.delete(id);}});
 const life=new PageLifecycle(host,target);life.attach();host.refresh.start();assert.equal(host.busy,true);
 target.dispatchEvent(new Event('pagehide'));assert.equal(timers.size,0);assert.equal(host.state.music.refreshPending,null);
 target.dispatchEvent(new Event('pageshow'));assert.equal(host.busy,false);assert.equal(host.scheduledBusy,false);
 const restored=host.state;late();assert.equal(host.state,restored);assert.equal(host.busy,false);assert.equal(host.state.music.suggestionPage,0);life.detach();
});

test('pagehide releases motion and edge observers before cleanup, restore attaches before rendering',()=>{
 const calls=[],target=new EventTarget(),host={isConnected:true,motion:{cancel(){calls.push('motion');}},scrollEdges:{detach(){calls.push('detach');},attach(){calls.push('attach');}},cleanup(){calls.push('cleanup');},render(){calls.push('render');},schedule(){calls.push('schedule');}};
 const life=new PageLifecycle(host,target);life.attach();target.dispatchEvent(new Event('pagehide'));target.dispatchEvent(new Event('pageshow'));
 assert.deepEqual(calls,['motion','detach','cleanup','attach','render','schedule']);life.detach();
});
