import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureServer} from '../../scripts/live-fixture.mjs';

test('loopback timer fixture preserves admission and proves both exact-ID arrival orders',async()=>{
 await new Promise(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${fixtureServer.address().port}/view/api/`;
 const controllers=[];
 try{
  const request=(room,body)=>fetch(base+'actions?room='+room,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const body=(room,revision=1)=>({bootId:'test-only',roomId:room,taskId:'timers:fixture-timer-epoch',revision,requestId:crypto.randomUUID(),action:'timer.start',args:{seconds:180,name:''}});
  assert.equal((await request('timer-receipt-first',body('timer-receipt-first'))).status,409,'new cases retain existing pair gate');
  assert.equal((await fetch(base+'pair',{method:'POST'})).status,200);
  for(const room of ['timer-receipt-first','timer-snapshot-first']){
   const abort=new AbortController();controllers.push(abort);
   const events=await fetch(base+'events?room='+room,{signal:abort.signal}),reader=events.body.getReader();
   let buffer='',seenResolve;const seen=new Promise(resolve=>seenResolve=resolve),order=[];
   const pump=(async()=>{try{while(true){const {value,done}=await reader.read();if(done)return;buffer+=new TextDecoder().decode(value);let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=JSON.parse(frame.match(/data: (.*)/)[1]);if(data.timers.items.length){order.push('snapshot');seenResolve(data);return;}}}}catch(error){if(!abort.signal.aborted)throw error;}})();
   const receipt=await request(room,body(room)).then(response=>response.json()).then(value=>{order.push('receipt');return value;});
   const observed=await seen;
   assert.deepEqual(order,room==='timer-receipt-first'?['receipt','snapshot']:['snapshot','receipt']);
   assert.equal(receipt.retryAllowed,false);assert.equal(receipt.outcome,'accepted');
   assert.equal(observed.timers.items[0].id,receipt.timerId,'receipt ID is exactly the observed native ID');
   const stale=body(room,1);stale.action='timer.cancel';stale.args={timer_id:receipt.timerId};assert.equal((await request(room,stale)).status,409,'stale revision cannot cancel');
   const cancel={...stale,revision:observed.revision,requestId:crypto.randomUUID()};assert.equal((await request(room,cancel)).status,200);
   const cleaned=await fetch(base+'snapshot?room='+room).then(response=>response.json());assert.deepEqual(cleaned.timers.items,[],'exact timer removed without waiting for expiry');
   abort.abort();await pump;
  }
 }finally{controllers.forEach(controller=>controller.abort());fixtureServer.closeAllConnections();await new Promise(resolve=>fixtureServer.close(resolve));}
});
