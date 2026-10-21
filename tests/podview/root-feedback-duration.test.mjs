import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
import {SceneMotion} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
test('one feedback notice expires after four seconds including pending; unchanged rendering never restarts it',()=>{
 const method=source.split('\n').find(line=>line.startsWith(' showFeedback(')).trim(),node={dataset:{},hidden:true,getClientRects(){return this.hidden?[]:[{}];},replaceChildren(copy){this.textContent=copy.nodeValue;}},timers=[],cleared=[];
 const show=new Function('$','NotificationQueue','applyKitComponent','document','setTimeout','clearTimeout',`return function ${method}`)(()=>node, class extends NotificationQueue {constructor(render){super(render,{setTimer:(callback,delay)=>{timers.push({callback,delay});return timers.length;},clearTimer:id=>cleared.push(id)});}},()=>{}, {createTextNode:()=>({nodeValue:''})},(callback,delay)=>{timers.push({callback,delay});return timers.length;},id=>cleared.push(id)),host={dataset:{},isConnected:true};
 // The actual motion owner controls visibility. Without WAAPI it uses its
 // immediate fallback, keeping this test focused on the four-second queue clock.
 host.motion=new SceneMotion(host);
 show.call(host,'Modtaget',false);assert.equal(timers[0].delay,4000);assert.equal(node.hidden,false);show.call(host,'Modtaget',false);assert.equal(timers.length,1);timers[0].callback();assert.equal(node.hidden,true);show.call(host,'Modtaget',false);assert.equal(node.hidden,true);assert.equal(timers.length,1);
 show.call(host,'Afventer',true);assert.equal(timers.at(-1).delay,4000);assert.equal(node.hidden,false);timers.at(-1).callback();assert.equal(node.hidden,true);show.call(host,'Afventer',false);assert.equal(node.hidden,false);assert.equal(timers.length,3);show.call(host,'',false);assert.equal(node.hidden,true);assert.equal(cleared.at(-1),3);
});
