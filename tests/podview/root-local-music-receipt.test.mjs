import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const method=source.slice(source.indexOf(' scheduleReceipt('),source.indexOf('\n scheduleAnswer(')).trim();
function fixture(){
 const timers=[],cancelled=[],events=[],receipts=[];
 const schedule=new Function('setTimeout','clearTimeout',`return ({${method}
}).scheduleReceipt;`)((fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer;},timer=>cancelled.push(timer));
 const host={live:false,frozenPreview:true,isConnected:true,state:{generation:1,music:{pending:{operation:7}}},music:event=>events.push(event),journey:{receipt:operation=>receipts.push(operation)}};
 return {schedule,host,timers,cancelled,events,receipts};
}
test('seeded frozen music stays frozen but explicit local action receives its correlated receipt',()=>{
 const f=fixture();f.schedule.call(f.host);assert.equal(f.timers.length,0);
 f.schedule.call(f.host,true);assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,650);assert.equal(f.events.length,0);
 f.timers[0].fn();assert.deepEqual(f.events,[{type:'receipt',operation:7}]);assert.deepEqual(f.receipts,[7]);
});
test('live runtime never schedules simulated receipts; detached or replaced generation cannot settle local playback',()=>{
 const live=fixture();live.host.live=true;live.schedule.call(live.host,true);assert.equal(live.timers.length,0);
 for(const change of [host=>{host.isConnected=false;},host=>{host.state.generation++;}]){const f=fixture();f.schedule.call(f.host,true);change(f.host);f.timers[0].fn();assert.deepEqual(f.events,[]);assert.deepEqual(f.receipts,[]);}
 const empty=fixture();empty.host.state.music.pending=null;empty.schedule.call(empty.host,true);assert.equal(empty.timers.length,0);
});
