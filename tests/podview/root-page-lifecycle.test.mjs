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
 const calls=[],target=new EventTarget(),host={isConnected:true,motion:{cancel(){calls.push('motion');}},scrollEdges:{detach(){calls.push('detach');},attach(){calls.push('attach');}},playerView:{resume(){calls.push('resume');}},cleanup(){calls.push('cleanup');},render(){calls.push('render');},schedule(){calls.push('schedule');}};
 const life=new PageLifecycle(host,target);life.attach();target.dispatchEvent(new Event('pagehide'));target.dispatchEvent(new Event('pageshow'));
 assert.deepEqual(calls,['motion','detach','cleanup','attach','resume','render','schedule']);life.detach();
});

function modalFixture(){
 const document=new EventTarget(),target=new EventTarget(),resources={music:{playing:true},timer:{id:'timer-1',remaining:40}},host={isConnected:true,ownerDocument:document,state:resources},life=new PageLifecycle(host,target);life.attach();
 // Dialogs are created after lifecycle attachment, like local/live robot controls.
 const dialog=()=>({tagName:'DIALOG',open:true,isConnected:true,modal:true,closes:0,restored:0,matches(selector){return selector===':modal'&&this.modal;},getBoundingClientRect(){return {left:100,right:500,top:100,bottom:400};},close(){this.open=false;this.closes++;this.restored++;}});
 const fire=(type,node,patch={})=>{const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries({target:node,pointerId:1,isPrimary:true,button:0,clientX:50,clientY:50,...patch}))Object.defineProperty(event,key,{value});document.dispatchEvent(event);return event;};
 const click=(node,patch={})=>{fire('pointerdown',node,patch);fire('pointerup',node,patch);return fire('click',node,patch);};return {host,resources,life,document,target,dialog,fire,click};
}
test('all late-created native modal dialogs close after a backdrop click and preserve resource state',()=>{
 const f=modalFixture();for(const name of ['rooms','music-detail','quick-sheet','customize-sheet','conflict','local-robot','live-robot']){const dialog=f.dialog();dialog.id=name;const event=f.click(dialog);assert.equal(dialog.closes,1,name);assert.equal(dialog.restored,1);assert.equal(event.defaultPrevented,true);assert.equal(f.host.state,f.resources);assert.equal(f.resources.music.playing,true);assert.equal(f.resources.timer.remaining,40);}f.life.detach();
});
test('modal padding, content, inside-to-outside drag, outside-to-inside and long backdrop drag never dismiss',()=>{
 const f=modalFixture();for(const scenario of ['padding','content','inside-out','outside-in','drag-return','drag-up','missing-up','secondary','right-button','nonmodal']){const dialog=f.dialog();if(scenario==='padding')f.click(dialog,{clientX:120,clientY:120});
 else if(scenario==='content')f.click({tagName:'BUTTON',parentNode:dialog});
 else if(scenario==='inside-out'){f.fire('pointerdown',dialog,{clientX:120,clientY:120});f.fire('pointerup',dialog);f.fire('click',dialog);}
 else if(scenario==='outside-in'){f.fire('pointerdown',dialog);f.fire('pointerup',dialog,{clientX:120,clientY:120});f.fire('click',dialog);}
 else if(scenario==='drag-return'){f.fire('pointerdown',dialog);f.fire('pointermove',dialog,{clientX:80});f.fire('pointerup',dialog);f.fire('click',dialog);}
 else if(scenario==='drag-up'){f.fire('pointerdown',dialog);f.fire('pointerup',dialog,{clientX:80});f.fire('click',dialog);}
 else if(scenario==='missing-up'){f.fire('pointerdown',dialog);f.fire('click',dialog);}
 else if(scenario==='secondary')f.click(dialog,{isPrimary:false});
 else if(scenario==='right-button')f.click(dialog,{button:2});
 else {dialog.modal=false;f.click(dialog);}assert.equal(dialog.closes,0,scenario);}f.life.detach();
});
test('cancel, scroll, blur, removed dialog and lifecycle detach fence unfinished backdrop gestures',()=>{
 const f=modalFixture();for(const kind of ['pointercancel','scroll','blur','removed','detached','second-pointer']){const dialog=f.dialog();f.fire('pointerdown',dialog);if(kind==='blur')f.target.dispatchEvent(new Event('blur'));else if(kind==='removed')dialog.isConnected=false;else if(kind==='detached')f.life.detach();else if(kind==='second-pointer')f.fire('pointerdown',dialog,{isPrimary:false,pointerId:2});else f.fire(kind,dialog);f.fire('pointerup',dialog);f.fire('click',dialog);assert.equal(dialog.closes,0,kind);f.life.attach();}
 const dialog=f.dialog();f.life.attach();f.life.attach();f.click(dialog,{clientX:53});assert.equal(dialog.closes,1);f.life.detach();
});
