import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveWeatherAdvice} from '../../podvoice/gatekeeper/static/podview/live-home-view.js';
import {weatherObservation} from '../../podvoice/gatekeeper/static/podview/weather-observation.js';
import {liveWeatherModel} from '../../podvoice/gatekeeper/static/podview/weather-view.js';
const origin=Date.parse('2026-10-23T10:00:00Z'),scope={bootId:'boot',roomId:'room'};
function rig(){
 let time=origin,next=0,visible=true;const timers=new Map(),calls=[],deferred=[];
 const raw={source:'Met.no',location:'hjemmet',retrievedAt:new Date(origin).toISOString(),observedAt:origin/1000,units:{temperature:'°C',precipitation:'mm',windSpeed:'km/h'},current:{temperature:12,condition:'cloudy'},forecastType:'hourly',forecast:[{datetime:new Date(origin+3600000).toISOString(),temperature:13,precipitation:0}]};
 const cap={schema:'podview.weather-advice-capability.v1',...scope,weatherKey:'a'.repeat(64),source:raw.source,sourceRetrievedAt:origin/1000,availability:'available',status:'idle',validUntil:origin/1000+60};
 const host={live:true,isConnected:true,state:{focus:'now',liveWeather:weatherObservation(raw),weatherAdvice:cap,homeScope:JSON.stringify([scope.bootId,scope.roomId])},liveSnapshot:{...scope,capabilities:{homeRead:['weather']}},liveTransport:{connected:true,weatherAdvice:(binding,{signal})=>{calls.push({binding,signal});return new Promise((resolve,reject)=>deferred.push({resolve,reject}));}},render(){this.projection=owner.sync();},async loadLiveHome(){this.reads=(this.reads||0)+1;await this.onRead?.();}};
 const owner=new LiveWeatherAdvice(host,{now:()=>time,setTimer:(fn,delay)=>{timers.set(++next,{fn,at:time+delay});return next;},clearTimer:id=>timers.delete(id),visible:()=>visible});
 const dto=(status='pending',key=host.state.weatherAdvice.weatherKey)=>({schema:'podview.passive-weather-advice.v1',...scope,weatherKey:key,requestId:'b'.repeat(32),source:raw.source,sourceRetrievedAt:Date.parse(raw.retrievedAt)/1000,validUntil:origin/1000+60,status,summaryKind:'ai_advice',summary:status==='ready'?'Tag jakken med – skyerne bliver hængende.':null,evidenceFactIds:status==='ready'?['current:temperature']:[]});
 return {host,owner,calls,deferred,timers,dto,cap,raw,hide(){visible=false;},model(){const p=owner.sync();return liveWeatherModel(host.state.liveWeather,{now:time,passiveContext:p?.context,passiveAdvice:p?.advice,passiveStatus:p?.status});},async settle(){await Promise.resolve();await Promise.resolve();},async tick(ms=1000){time+=ms;for(const[id,timer]of [...timers])if(timer.at<=time){timers.delete(id);await timer.fn();}await Promise.resolve();}};
}
test('held POST shows the pending slot without polling; server admission alone starts completion reads',async()=>{
 const h=rig();assert.equal(h.owner.sync(),null);assert.equal(h.calls.length,0);h.host.state.focus='weather';assert.equal(h.owner.sync()?.status,'requesting');assert.equal(h.model().summaryState,'pending');assert.equal(h.model().summary,'');assert.equal(h.calls.length,1);for(let i=0;i<5;i++)h.owner.sync();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);await h.tick(2500);assert.equal(h.host.reads||0,0);assert.equal(h.timers.size,0);assert.equal(h.host.state.weatherAdvice.status,'idle');assert.equal(h.model().summaryState,'pending');
 h.deferred[0].resolve(h.dto());await h.settle();assert.equal(h.model().summaryState,'pending');assert.equal(h.model().summary,'');assert.equal(h.model().current.temperature,'12°');assert.equal(h.model().hours[0].rain,'0 mm');assert.equal(h.timers.size,1);
 h.host.onRead=()=>{h.host.state.weatherAdvice={...h.cap,status:'ready'};h.host.state.liveWeather={...h.host.state.liveWeather,passiveAdvice:h.dto('ready')};};
 await h.tick();assert.equal(h.host.reads,1);assert.equal(h.calls.length,1);assert.equal(h.model().summary,h.dto('ready').summary);assert.equal(h.model().summaryState,'ready');assert.equal(h.timers.size,0);h.owner.cleanup();
});
test('navigation aborts local work, ignores late result and never repeats paid POST on return or cleanup',async()=>{
 const h=rig();h.host.state.focus='weather';h.owner.sync();h.host.state.focus='now';h.owner.sync();assert.equal(h.calls[0].signal.aborted,true);h.deferred[0].resolve(h.dto('ready'));await h.settle();assert.equal(h.owner.sync(),null);assert.equal(h.host.projection,undefined);
 h.host.state.focus='weather';assert.equal(h.model().summaryState,'unavailable');assert.equal(h.calls.length,1);await h.tick();assert.equal(h.host.reads,1);h.owner.cleanup();h.owner.sync();assert.equal(h.calls.length,1);h.owner.cleanup();
});
test('same-key changed source, boot, room, access and visibility cannot publish a late receipt',async()=>{
 for(const change of [h=>h.host.state.liveWeather={...h.host.state.liveWeather,current:{temperature:30,condition:'sunny'}},h=>h.host.liveSnapshot={...h.host.liveSnapshot,bootId:'new'},h=>h.host.liveSnapshot={...h.host.liveSnapshot,roomId:'other'},h=>h.host.liveSnapshot.capabilities.homeRead=[],h=>h.host.liveTransport.connected=false,h=>h.hide(),h=>h.host.isConnected=false]){
  const h=rig();h.host.state.focus='weather';h.owner.sync();change(h);h.owner.sync();h.deferred[0].resolve(h.dto('ready'));await h.settle();assert.notEqual(h.model().summary,h.dto('ready').summary);assert.equal(h.calls.length,1);h.owner.cleanup();
 }
});
test('new admitted key can request once while wrong key or request identity never replaces its weather',async()=>{
 const h=rig();h.host.state.focus='weather';h.owner.sync();h.deferred[0].resolve(h.dto('ready','f'.repeat(64)));await h.settle();assert.equal(h.model().summaryState,'unavailable');assert.equal(h.model().current.temperature,'12°');h.owner.sync();assert.equal(h.calls.length,1);
 h.host.state.weatherAdvice={...h.cap,weatherKey:'c'.repeat(64)};h.owner.sync();assert.equal(h.calls.length,2);h.deferred[1].resolve(h.dto());await h.settle();h.host.state.liveWeather={...h.host.state.liveWeather,passiveAdvice:{...h.dto('ready'),requestId:'d'.repeat(32)}};assert.equal(h.model().summaryState,'unavailable');h.owner.cleanup();
});
test('read-only pending recovery is bounded and unavailable capability cannot generate or display old prose',async()=>{
 const h=rig();h.host.state.focus='weather';h.host.state.weatherAdvice={...h.cap,status:'pending'};assert.equal(h.model().summaryState,'pending');assert.equal(h.calls.length,0);for(let i=0;i<9;i++)await h.tick();assert.equal(h.host.reads,8);assert.equal(h.model().summaryState,'unavailable');assert.equal(h.timers.size,0);assert.equal(h.model().current.temperature,'12°');
 h.host.state.weatherAdvice={...h.cap,availability:'unavailable',status:'unavailable'};h.host.state.liveWeather={...h.host.state.liveWeather,passiveAdvice:h.dto('ready')};assert.equal(h.model().summaryState,'unavailable');assert.equal(h.model().summary,'Vejrrådet er ikke tilgængeligt lige nu.');assert.equal(h.calls.length,0);h.owner.cleanup();
});
test('POST failure remains honest and never retries; stale binding refreshes only home',async()=>{
 for(const code of [undefined,'stale_weather_binding','read_access_denied']){const h=rig();h.host.state.focus='weather';assert.equal(h.model().summaryState,'pending');assert.equal(h.timers.size,0);assert.equal(h.host.reads||0,0);h.deferred[0].reject(Object.assign(Error('unavailable'),{code}));await h.settle();assert.equal(h.model().summaryState,'unavailable');assert.equal(h.model().summary,'Vejrrådet er ikke tilgængeligt lige nu.');assert.equal(h.host.reads||0,['stale_weather_binding','read_access_denied'].includes(code)?1:0);h.owner.sync();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);h.owner.cleanup();}
});

test('default browser timers retain the native global receiver through requesting, pending read and cleanup',async()=>{
 const h=rig(),previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout,timers=new Map(),receivers=[];let next=0,owner;
 globalThis.setTimeout=function(callback,delay){assert.equal(this,globalThis,'native setTimeout requires its global receiver');receivers.push('set');timers.set(++next,{callback,delay});return next;};
 globalThis.clearTimeout=function(id){assert.equal(this,globalThis,'native clearTimeout requires its global receiver');receivers.push('clear');timers.delete(id);};
 try{
  owner=new LiveWeatherAdvice(h.host,{now:()=>origin,visible:()=>true});h.host.render=()=>owner.sync();h.host.state.focus='weather';assert.equal(owner.sync().status,'requesting');assert.equal(h.calls.length,1);assert.equal(timers.size,0);
  h.deferred[0].resolve(h.dto());await h.settle();assert.equal(owner.sync().status,'pending');assert.equal(timers.size,1);const [id,timer]=[...timers][0];assert.equal(timer.delay,1000);timers.delete(id);h.host.onRead=()=>{h.host.state.weatherAdvice={...h.cap,status:'ready'};h.host.state.liveWeather={...h.host.state.liveWeather,passiveAdvice:h.dto('ready')};};await timer.callback();assert.equal(h.host.reads,1);assert.equal(owner.sync().status,'ready');assert.equal(timers.size,0);assert.equal(h.calls.length,1);assert.ok(receivers.includes('set'));assert.ok(receivers.includes('clear'));owner.cleanup();assert.equal(timers.size,0);
 }finally{owner?.cleanup();globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;}
});

test('ready capability without a valid completion receipt stays honest and cannot leave a blank ready claim or replay generation',async()=>{
 for(const receipt of [null,{invalid:true}]){
  const h=rig();h.host.state.focus='weather';h.host.state.weatherAdvice={...h.cap,status:'ready'};h.host.state.liveWeather={...h.host.state.liveWeather,passiveAdvice:receipt};const model=h.model();assert.equal(model.summaryState,'unavailable');assert.equal(model.summary,'Vejrrådet er ikke tilgængeligt lige nu.');assert.equal(model.current.temperature,'12°');assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);h.owner.sync();assert.equal(h.calls.length,0);h.owner.cleanup();
 }
});
