import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixtureRequest} from '../../scripts/live-fixture.mjs';
const request=(endpoint,body)=>new Promise((resolve,reject)=>{
 const req=Readable.from(body?[JSON.stringify(body)]:[]);req.url='/view/api/'+endpoint;
 let text='',status=200;const res={setHeader(){},writeHead(value){status=value;},end(value=''){text+=value;resolve({status,body:text?JSON.parse(text):null});}};
 fixtureRequest(req,res).catch(reject);
});
const action=room=>({bootId:'test-only',roomId:room,taskId:'timers:fixture-timer-epoch',revision:1,requestId:crypto.randomUUID(),action:'timer.start',args:{seconds:300,name:''}});
test('inert actual fixture handler retains pair gate, UNKNOWN and authoritative scope changes',async()=>{
 const denied=await request('actions?room=timer-unknown',action('timer-unknown'));assert.equal(denied.status,409);
 await request('pair');
 const unknown=action('timer-unknown'),reply=await request('actions?room=timer-unknown',unknown);
 assert.deepEqual(reply.body,{ok:false,requestId:unknown.requestId,outcome:'unknown',retryAllowed:false});
 assert.deepEqual((await request('snapshot?room=timer-unknown')).body.timers.items,[]);
 const waiting=await request('actions?room=timer-no-observation',action('timer-no-observation'));
 assert.equal(waiting.body.outcome,'accepted');assert.ok(waiting.body.timerId);assert.deepEqual((await request('snapshot?room=timer-no-observation')).body.timers.items,[]);
 await Promise.all(['timer-boot-change','timer-room-change','timer-epoch-change'].map(async room=>{
  const receipt=(await request('actions?room='+room,action(room))).body;
  await new Promise(resolve=>setTimeout(resolve,1550));const observed=(await request('snapshot?room='+room)).body;
  assert.equal(observed.timers.items[0].id,receipt.timerId,'same ID alone cannot establish old operation scope');
  assert.equal(observed.bootId,room==='timer-boot-change'?'fixture-next-boot':'test-only');
  assert.equal(observed.roomId,room==='timer-room-change'?'fixture-other-room':room);
  assert.equal(observed.timers.epoch,room==='timer-epoch-change'?'fixture-next-epoch':'fixture-timer-epoch');
  assert.equal((await request('actions?room='+room,{...action(room),action:'timer.cancel',args:{timer_id:receipt.timerId}})).status,409,'old owner request remains fenced');
 }));
});

test('transport-timeout handler commits no timer and leaves response open until client abort',async()=>{
 await request('pair');const req=Readable.from([JSON.stringify(action('timer-transport-timeout'))]);req.url='/view/api/actions?room=timer-transport-timeout';
 let ended=false;const res={setHeader(){},on(){},end(){ended=true;},writeHead(){}};
 await fixtureRequest(req,res);assert.equal(ended,false,'actual handler sends no receipt or response body');
 assert.deepEqual((await request('snapshot?room=timer-transport-timeout')).body.timers.items,[],'no optimistic timer is committed');
});
