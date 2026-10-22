import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
import {SceneMotion} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
test('one feedback notice expires after six seconds including pending; unchanged rendering never restarts it',()=>{
 const method=source.split('\n').find(line=>line.startsWith(' showFeedback(')).trim(),node={dataset:{},hidden:true,getClientRects(){return this.hidden?[]:[{}];},replaceChildren(copy){this.textContent=copy.nodeValue;}},timers=[],cleared=[];
 const show=new Function('$','NotificationQueue','applyKitComponent','document','setTimeout','clearTimeout',`return function ${method}`)(()=>node, class extends NotificationQueue {constructor(render){super(render,{setTimer:(callback,delay)=>{timers.push({callback,delay});return timers.length;},clearTimer:id=>cleared.push(id)});}},()=>{}, {createTextNode:()=>({nodeValue:''})},(callback,delay)=>{timers.push({callback,delay});return timers.length;},id=>cleared.push(id)),host={dataset:{},isConnected:true};
 // The actual motion owner controls visibility. Without WAAPI it uses its
 // immediate fallback, keeping this test focused on the six-second queue clock.
 host.motion=new SceneMotion(host);
 show.call(host,'Modtaget',false);assert.equal(timers[0].delay,6000);assert.equal(node.hidden,false);show.call(host,'Modtaget',false);assert.equal(timers.length,1);timers[0].callback();assert.equal(node.hidden,true);show.call(host,'Modtaget',false);assert.equal(node.hidden,true);assert.equal(timers.length,1);
 show.call(host,'Afventer',true);assert.equal(timers.at(-1).delay,6000);assert.equal(node.hidden,false);timers.at(-1).callback();assert.equal(node.hidden,true);show.call(host,'Afventer',false);assert.equal(node.hidden,false);assert.equal(timers.length,3);show.call(host,'',false);assert.equal(node.hidden,true);assert.equal(cleared.at(-1),3);
});

function pointerFeedback({animated=false}={}){
 const timers=new Map(),listeners=new Map(),registrations=[],retry={clicks:0,click(){this.clicks++;}},node={dataset:{},hidden:true,children:[],getClientRects(){return this.hidden?[]:[{}];},replaceChildren(...children){this.children=children;},contains(target){return this.children.includes(target);}},doc={createTextNode:()=>({nodeValue:''}),addEventListener(type,callback,options){listeners.set(type,callback);registrations.push({type,callback,options});},removeEventListener(type,callback,capture){assert.equal(capture,true);if(listeners.get(type)===callback)listeners.delete(type);}};
 const animations=[];if(animated)node.animate=(frames,options)=>{let finish,reject;const animation={frames,options,finished:new Promise((yes,no)=>{finish=yes;reject=no;}),cancel(){reject(new Error('cancel'));},finish(){finish();}};animations.push(animation);return animation;};
 let serial=0;const showCode=source.split('\n').find(line=>line.startsWith(' showFeedback(')).trim(),show=new Function('$','NotificationQueue','applyKitComponent','document',`return function ${showCode}`)(id=>id==='playback-status'?node:undefined,class extends NotificationQueue{constructor(render){super(render,{setTimer(callback,delay){const id=++serial;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id)});}},()=>{},doc),host={dataset:{},isConnected:true,ownerDocument:doc,connectionRetry:retry,closeLightDetail(){},suspendLiveTimer(){}};host.motion=new SceneMotion(host);
 const cleanupCode=source.split('\n').find(line=>line.startsWith(' cleanup(')).trim(),cleanup=new Function('$','cleanupWeather','clearTimeout','clearInterval',`return function ${cleanupCode}`)(()=>undefined,()=>{},()=>{},()=>{});
 return {host,node,retry,timers,listeners,registrations,animations,show:(...args)=>show.call(host,...args),cleanup:()=>cleanup.call(host)};
}

test('outside pointer dismisses through the queue without taking the underlying click or retry button',()=>{
 const f=pointerFeedback();f.show('Ikke forbundet',false,{source:'connection',retry:true});f.show('Handling modtaget',false,{source:'action'});assert.equal(f.registrations.length,1);assert.deepEqual(f.registrations[0].options,{capture:true,passive:true});let prevented=0,stopped=0,clicks=0;const underneath={click(){clicks++;}},pointer=target=>({target,composedPath:()=>target===f.retry?[target,f.node]:[target],preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 f.listeners.get('pointerdown')(pointer(f.retry));f.retry.click();assert.equal(f.retry.clicks,1);assert.equal(f.host.notifications.current.source,'connection');
 f.listeners.get('pointerdown')(pointer(underneath));underneath.click();assert.equal(clicks,1);assert.equal(prevented,0);assert.equal(stopped,0);assert.equal(f.host.notifications.current.source,'action');assert.equal(f.timers.size,1);f.show('Ikke forbundet',false,{source:'connection',retry:true});assert.equal(f.host.notifications.current.source,'action');f.listeners.get('pointerdown')(pointer(underneath));assert.equal(f.node.hidden,true);assert.equal(f.timers.size,0);f.cleanup();
});

test('notification lifecycle removes its document listener and clock, then reconnects once',()=>{
 const f=pointerFeedback();f.show('Modtaget',false);const firstListener=f.listeners.get('pointerdown'),oldClock=[...f.timers.values()][0].callback;assert.equal(f.timers.size,1);f.cleanup();assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.host.detachNotificationPointer,null);oldClock();assert.equal(f.node.hidden,true);f.host.isConnected=false;f.show('Sent svar',false);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.host.isConnected=true;f.show('Modtaget',false);f.show('Modtaget',false);assert.equal(f.listeners.size,1);assert.equal(f.registrations.length,2);assert.notStrictEqual(f.listeners.get('pointerdown'),firstListener);assert.equal(f.timers.size,1);f.cleanup();assert.equal(f.listeners.size,0);
});

test('outside dismissal finishes hiding when the underlying navigation cancels its exit animation',async()=>{
 const f=pointerFeedback({animated:true});f.show('Ikke forbundet',false,{source:'connection'});const target={};f.listeners.get('pointerdown')({target,composedPath:()=>[target]});assert.equal(f.host.notifications.current,null);assert.equal(f.node.hidden,false,'content is retained during its normal exit');assert.equal(f.animations.at(-1).options.duration,120);f.host.motion.cancel();await Promise.resolve();assert.equal(f.node.hidden,true,'cancelled exit must finish the dismissed state');assert.equal(f.timers.size,0);f.show('Ikke forbundet',false,{source:'connection'});assert.equal(f.host.notifications.current,null);assert.equal(f.node.hidden,true,'unchanged connection observation cannot replay the dismissed toast');f.cleanup();
});

test('a cancelled old toast exit cannot hide a replacement notification',async()=>{
 const f=pointerFeedback({animated:true});f.show('Første',false);f.host.notifications.dismiss();const exit=f.animations.at(-1);f.show('Ny besked',false);assert.notStrictEqual(f.animations.at(-1),exit);await Promise.resolve();assert.equal(f.node.hidden,false);assert.equal(f.host.notifications.current.message,'Ny besked');f.cleanup();await Promise.resolve();
});
