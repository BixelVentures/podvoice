import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveQueueView} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
import {boundPlayback} from './room-fixture.mjs';

function fixture(){
 let serial=0,clock=0;const timers=new Map(),renders=[],actions=[],reads=[];
 const notifications=new NotificationQueue(item=>renders.push(item),{setTimer(callback){const id=++clock;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
 const host={isConnected:true,liveSnapshot:{bootId:'boot',roomId:'kitchen',voice:{sessionId:'session'},capabilities:{queueSelection:true,musicRead:['queue']}},liveTransport:{connected:true},liveMedia:{account:'account',renderQueue(){},refresh:async()=>{}},showFeedback(message,pending,options){notifications.update(options.source,message,{pending});}};
 host.liveMedia.playback=boundPlayback(host.liveSnapshot,{owner_epoch:'epoch',poll_sequence:4,target:{id:'device'},expiresAt:Date.now()+15000});
 host.liveTransport.queueOffer=async()=>{const offer={ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'kitchen',accountId:'account',targetId:'device',taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:4,truncated:false,items:[{id:serial.toString(16).padStart(24,'0'),title:'Known queued song',artist:'Artist',uri:'spotify:track:'+'0'.repeat(22),artwork:null,order:1}]};reads.push(offer);return offer;};
 host.liveTransport.queueAction=async(offer,id)=>{actions.push({taskId:offer.taskId,id});return {outcome:'unknown'};};
 const view=new LiveQueueView(host);return {host,view,notifications,renders,actions,reads,close(){view.invalidate(true);notifications.cleanup();}};
}

for(const outcome of ['unknown','rejected','thrown'])test(`a fresh server-issued queue choice can show the same ${outcome} failure after the prior toast is dismissed`,async()=>{
 const f=fixture();try{
  const action=f.host.liveTransport.queueAction;f.host.liveTransport.queueAction=async(...args)=>{await action(...args);if(outcome==='thrown')throw Error('network');return {outcome};};
  await f.view.load('account',f.host.liveMedia.playback);const first=f.view.offer;await f.view.choose(first.items[0]);const message=f.notifications.current.message;assert.match(message,outcome==='rejected'?/afvist/:/ikke bekræftes/);assert.equal(f.actions.length,1);f.notifications.dismiss();assert.equal(f.notifications.current,null);
  const quiet=f.renders.length;f.view.redraw();f.view.model('account',f.host.liveMedia.playback);await f.view.choose(first.items[0]);assert.equal(f.renders.length,quiet);assert.equal(f.actions.length,1,'dismissal never unconsumes the previous task');
  await f.view.load('account',f.host.liveMedia.playback);const second=f.view.offer;assert.notEqual(second.taskId,first.taskId);assert.notEqual(second.items[0].id,first.items[0].id);await f.view.choose(second.items[0]);assert.equal(f.actions.length,2);assert.equal(f.notifications.current?.message,message,'new explicit owner operation must produce its own truthful outcome');assert.equal(f.renders.filter(item=>item?.message===message).length,2);await f.view.choose(second.items[0]);assert.equal(f.actions.length,2,'the second offer is still consumed exactly once');
 }finally{f.close();}
});

test('only a fresh explicit notified queue read rearms its own failure, not passive reads or unrelated notices',async()=>{
 const f=fixture();try{
  let reads=0;f.host.liveTransport.queueOffer=async()=>{reads++;throw Error('network');};
  await f.view.load('account',f.host.liveMedia.playback,{notify:true});const message=f.notifications.current.message;f.notifications.dismiss();const quiet=f.renders.length;await f.view.load('account',f.host.liveMedia.playback);f.view.redraw();assert.equal(f.renders.length,quiet);assert.equal(f.notifications.current,null);
  f.notifications.update('connection','Offline',{priority:true});await f.view.load('account',f.host.liveMedia.playback,{notify:true});assert.equal(reads,3);assert.equal(f.notifications.current.source,'connection');assert.equal(f.notifications.pending.length,1);f.notifications.dismiss();assert.equal(f.notifications.current?.message,message);assert.equal(f.renders.filter(item=>item?.message===message).length,2);
  const visible=f.notifications.current;f.host.liveSnapshot.capabilities.queueSelection=false;await f.view.load('account',f.host.liveMedia.playback,{notify:true});assert.equal(f.notifications.current,visible,'an unoffered read cannot clear the actual queue notice');assert.equal(reads,3);
 }finally{f.close();}
});
