import test from 'node:test';
import assert from 'node:assert/strict';
import {RobotMotion,robotIsCleaning} from '../../podvoice/gatekeeper/static/podview/ui/robot-motion.js';
const observed=(state='cleaning')=>({id:'vacuum.real',live:true,source:'home_assistant_state',status:state,observedAt:Date.now()/1000});
function fixture(){
 const doc=new EventTarget();doc.hidden=false;doc.documentElement={dataset:{}};const media=new EventTarget();media.matches=false;
 let observer;class Observer{constructor(callback){this.callback=callback;observer=this;}observe(){this.active=true;}disconnect(){this.active=false;}}
 const icon=()=>({isConnected:true,visible:true,calls:[],getClientRects(){return this.visible?[{}]:[];},animate(frames,options){const animation={frames,options,cancelled:false,cancel(){this.cancelled=true;}};this.calls.push(animation);return animation;}});
 const photo=icon(),detail=icon(),panel=icon(),device=observed();
 const host={isConnected:true,live:true,dataset:{},state:{connected:true,devices:[device]},liveTransport:{connected:true},querySelectorAll(selector){return selector.startsWith('.resource-preview')?[{dataset:{target:device.id},querySelector:()=>photo}]:selector==='pv-vacuum-widget'?[{data:{context:{resourceId:device.id}},querySelector:()=>detail}]:[{observation:{icon:panel},value:{device}}];}};
 const motion=new RobotMotion(host,{document:doc,media,Observer});return {host,doc,media,device,photo,detail,panel,motion,observer:()=>observer};
}
test('only fresh exact-source observed cleaning is eligible; unknown, paused, stale and offline are static',()=>{
 const now=Date.now(),device={...observed(),observedAt:now/1000};assert.equal(robotIsCleaning(device,{live:true,now}),true);
 for(const status of ['paused','docked','docking','unknown','unavailable','fault','stopped','complete'])assert.equal(robotIsCleaning({...device,status},{live:true,now}),false);
 for(const patch of [{stale:true},{hidden:true},{source:'service_ack'},{observedAt:(now-90001)/1000},{observedAt:(now+6000)/1000},{observedAt:undefined},{live:false}])assert.equal(robotIsCleaning({...device,...patch},{live:true,now}),false);
 assert.equal(robotIsCleaning(device,{live:true,connected:false,now}),false);assert.equal(robotIsCleaning({status:'cleaning'},{live:false,now}),true);
});
test('Ro, overview/detail and panel share retained cleaning motion; repeated polls never restart it',()=>{
 const f=fixture();try{f.motion.sync();for(const icon of [f.photo,f.detail,f.panel]){assert.equal(icon.calls.length,1);assert.equal(icon.calls[0].options.iterations,Infinity);assert.equal(icon.calls[0].options.duration,4200);}
 f.motion.sync();f.device.observedAt=Date.now()/1000;f.motion.sync();assert.ok([f.photo,f.detail,f.panel].every(icon=>icon.calls.length===1));
 f.detail.visible=false;f.motion.sync();assert.equal(f.detail.calls[0].cancelled,true);assert.equal(f.photo.calls[0].cancelled,false);
 f.device.status='paused';f.motion.sync();assert.equal(f.motion.animations.size,0);assert.ok([f.photo,f.detail,f.panel].every(icon=>icon.calls[0].cancelled));
 }finally{f.motion.cleanup();}
});
test('reduced motion and background/removal cancel every glyph immediately; reconnect attaches clean owners',()=>{
 const f=fixture();f.motion.sync();const first=f.photo.calls[0];f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(first.cancelled,true);assert.equal(f.motion.animations.size,0);
 f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.equal(f.photo.calls.length,2);f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.motion.animations.size,0);
 f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));f.host.liveTransport.connected=false;f.motion.sync();assert.equal(f.motion.animations.size,0);
 f.host.liveTransport.connected=true;f.motion.sync();const active=f.photo.calls.at(-1);f.host.isConnected=false;f.observer().callback();assert.equal(active.cancelled,true);assert.equal(f.observer().active,false);assert.equal(f.motion.attached,false);
 f.host.isConnected=true;f.motion.sync();assert.equal(f.motion.attached,true);f.motion.cleanup();assert.equal(f.motion.animations.size,0);const count=f.photo.calls.length;f.media.dispatchEvent(new Event('change'));assert.equal(f.photo.calls.length,count);
});

test('cleaning glyph expires without another snapshot and cancelled queued expiry cannot revive it',()=>{
 const f=fixture(),jobs=new Map();let now=100000,serial=0;f.device.observedAt=now/1000;
 const motion=new RobotMotion(f.host,{document:f.doc,media:f.media,Observer:null,now:()=>now,setTimer:(fn,ms)=>{const id=++serial;jobs.set(id,{fn,ms});return id;},clearTimer:id=>jobs.delete(id)});
 try{motion.sync();assert.equal(jobs.size,1);const first=[...jobs.values()][0];assert.equal(first.ms,90001);motion.sync();assert.equal(jobs.size,1);
  now+=90001;first.fn();assert.equal(motion.animations.size,0);assert.equal(motion.expiryTimer,null);
  f.device.observedAt=now/1000;motion.sync();const queued=[...jobs.values()].at(-1).fn;const count=f.photo.calls.length;
  motion.cleanup();queued();assert.equal(motion.animations.size,0);assert.equal(f.photo.calls.length,count);assert.equal(motion.attached,false);
 }finally{motion.cleanup();f.motion.cleanup();}
});

test('default freshness timers preserve the browser receiver for schedule and cleanup',()=>{
 const previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout,jobs=new Map();let serial=0;
 globalThis.setTimeout=function(fn,ms){assert.equal(this,globalThis);const id=++serial;jobs.set(id,{fn,ms});return id;};
 globalThis.clearTimeout=function(id){assert.equal(this,globalThis);jobs.delete(id);};
 const f=fixture();try{f.motion.sync();assert.equal(jobs.size,1);assert.ok([...jobs.values()][0].ms>0);f.motion.cleanup();assert.equal(jobs.size,0);}
 finally{f.motion.cleanup();globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;}
});
