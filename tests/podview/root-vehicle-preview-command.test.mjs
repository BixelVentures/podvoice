import test from 'node:test';
import assert from 'node:assert/strict';
import {VehiclePreviewCommand} from '../../podvoice/gatekeeper/static/podview/vehicle-preview-command.js';
import {vehicleFixture,vehiclePreviewAction} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';
function setup(options={}){
 let now=0,nextId=0;const timers=new Map(),events=[],progress=[];
 const host={live:false,state:{connected:true,focus:'vehicle',sessionId:'session-a',vehicle:vehicleFixture({controls:true}),music:{track:'keep'},timer:{id:'keep'}}};
 const clock={setTimer(fn,ms){const id=++nextId;timers.set(id,{at:now+ms,fn});return id;},clearTimer:id=>timers.delete(id)};
 const driver=new VehiclePreviewCommand(host,{...clock,...options});
 host.dispatch=event=>{events.push(event);const state=host.state;if(!state.connected||event.sessionId!==state.sessionId)return;const vehicle=vehiclePreviewAction(state.vehicle,event);if(vehicle!==state.vehicle)host.state={...state,vehicle};driver.sync();};
 const advance=ms=>{const end=now+ms;for(;;){const first=[...timers.entries()].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!first)break;timers.delete(first[0]);now=first[1].at;first[1].fn();}now=end;};
 const send=(event={action:'lock',value:false,confirmed:true},extra={})=>driver.send({revision:host.state.vehicle.revision,...event},{onProgress:update=>progress.push(update),...extra});
 return {host,driver,events,progress,timers,advance,send};
}

test('local preview retains state through 2–6 seconds and confirms only a verified reducer commit',async()=>{
 const f=setup(),initial=f.host.state,first=f.send();assert.deepEqual(f.progress,[{phase:'waking',localPreview:true}]);assert.equal(f.events.length,0);assert.equal(f.host.state,initial);
 f.advance(1999);assert.equal(f.progress.length,1);f.advance(1);assert.equal(f.progress[1].phase,'awaiting');f.advance(3999);assert.equal(f.host.state,initial);assert.equal(f.events.length,0);
 f.advance(1);assert.deepEqual(await first,{status:'confirmed',revision:2,localPreview:true});assert.equal(f.events.length,1);assert.equal(f.events[0].sessionId,'session-a');assert.equal(f.host.state.vehicle.locked,false);assert.equal(f.host.state.music,initial.music);assert.equal(f.host.state.timer,initial.timer);assert.equal(f.timers.size,0);
});

test('duplicate clicks cannot schedule a second command and the captured intent is immutable',async()=>{
 const f=setup(),event={action:'lock',value:false,confirmed:true,revision:1},first=f.driver.send(event);event.value=true;assert.deepEqual(await f.send(),{status:'failed',reason:'busy'});assert.equal(f.timers.size,2);f.advance(6000);assert.equal((await first).status,'confirmed');assert.equal(f.events.length,1);assert.equal(f.events[0].value,false);
});

test('session, revision, connection and vehicle replacement invalidate without adopting newer binding',async()=>{
 for(const change of [
  host=>{host.state={...host.state,sessionId:'session-b'};},
  host=>{host.state={...host.state,connected:false};},
  host=>{host.state={...host.state,vehicle:{...host.state.vehicle,revision:2}};},
  host=>{host.state={...host.state,vehicle:{...host.state.vehicle}};},
  host=>{host.live=true;}
 ]){const f=setup(),pending=f.send();change(f.host);f.driver.sync();assert.equal((await pending).status,'unknown');f.advance(20000);assert.equal(f.events.length,0);assert.equal(f.timers.size,0);}
 const f=setup(),pending=f.send();f.advance(2000);f.host.state={...f.host.state,connected:false};f.advance(4000);assert.equal((await pending).status,'unknown');assert.equal(f.events.length,0,'completion independently revalidates without relying on render sync');
});

test('abort/dispose cancel local timers; late callbacks never commit or affect a fresh generation',async()=>{
 const f=setup(),controller=new AbortController(),first=f.send(undefined,{signal:controller.signal}),late=[...f.timers.values()].map(timer=>timer.fn);controller.abort();assert.equal((await first).status,'unknown');assert.equal(f.timers.size,0);
 const second=f.send();for(const callback of late)callback();assert.equal(f.events.length,0);f.advance(6000);assert.equal((await second).status,'confirmed');assert.equal(f.events.length,1);
 const g=setup(),pending=g.send();g.driver.dispose();assert.equal((await pending).status,'unknown');g.advance(10000);assert.equal(g.events.length,0);assert.equal(g.timers.size,0);assert.equal((await g.send()).reason,'disposed');
});

test('failure and unknown never mutate state or auto-retry, and accepted dispatch without desired observation is unknown',async()=>{
 for(const outcome of ['failed','unknown']){const f=setup({outcome}),initial=f.host.state,pending=f.send();f.advance(6000);assert.equal((await pending).status,outcome);f.advance(60000);assert.equal(f.host.state,initial);assert.equal(f.events.length,0);assert.equal(f.timers.size,0);}
 const f=setup();f.host.dispatch=event=>f.events.push(event);const pending=f.send();f.advance(6000);assert.equal((await pending).status,'unknown');assert.equal(f.host.state.vehicle.locked,true);assert.equal(f.events.length,1);
 const g=setup();g.host.dispatch=()=>{g.host.state={...g.host.state,vehicle:{...g.host.state.vehicle,revision:2}};};const wrongState=g.send();g.advance(6000);assert.equal((await wrongState).status,'unknown','revision increment alone is not command confirmation');
});

test('live, passive, wrong revision and unconfirmed consequential intents cannot start timers',async()=>{
 for(const prepare of [host=>{host.live=true;},host=>{host.state.vehicle={...host.state.vehicle,mode:'observed'};},host=>{host.state.vehicle={...host.state.vehicle,controlsPreview:false};}]){const f=setup();prepare(f.host);assert.equal((await f.send()).status,'failed');assert.equal(f.timers.size,0);}
 for(const event of [{action:'lock',value:false},{action:'lock',value:'false',confirmed:true},{action:'lock',value:false,confirmed:true,revision:0},{action:'frunk',value:'open',confirmed:true},{action:'seat-heat',seat:'driver',value:2},{action:'climate-settings',temperatureC:21,seats:{driver:2,passenger:0}},{action:'climate-settings',temperatureC:21,seats:{driver:2,rear:0},confirmed:true}]){const f=setup();assert.equal((await f.send(event)).status,'failed');assert.equal(f.timers.size,0);assert.equal(f.events.length,0);}
});

test('batched climate settings copy desired seat identities before the delay and verify all fields',async()=>{
 const f=setup(),event={action:'climate-settings',temperatureC:23,seats:{driver:2,passenger:1},confirmed:true,revision:1};
 const pending=f.driver.send(event);event.seats.driver=0;event.temperatureC=17;f.advance(6000);assert.equal((await pending).status,'confirmed');assert.equal(f.events[0].temperatureC,23);assert.deepEqual(f.events[0].seats,{driver:2,passenger:1});
});


test('explicit climate intent is preserved and confirmed against the reducer',async()=>{
 const f=setup(),start=f.send({action:'climate',value:true,confirmed:true});f.advance(6000);assert.equal((await start).status,'confirmed');assert.equal(f.host.state.vehicle.climate.status,'heat');assert.equal(f.events[0].value,true);
 const stop=f.send({action:'climate',value:false,confirmed:true});f.advance(6000);assert.equal((await stop).status,'confirmed');assert.equal(f.host.state.vehicle.climate.status,'off');assert.equal(f.events[1].value,false);
 assert.equal((await f.send({action:'climate',value:'true',confirmed:true})).status,'failed');assert.equal(f.timers.size,0);
});


test('ten seconds without a result remains pending and never invents failure or changes car state',async()=>{
 const f=setup({totalMs:60000}),initial=f.host.state,pending=f.send();let settled=false;pending.then(()=>settled=true);f.advance(10000);await Promise.resolve();assert.equal(settled,false);assert.equal(f.driver.pending!==null,true);assert.equal(f.host.state,initial);assert.equal(f.events.length,0);assert.equal(f.progress.at(-1).phase,'awaiting');f.advance(50000);assert.equal((await pending).status,'confirmed');assert.equal(f.events.length,1);
});


test('an authorized command survives repeated view navigation and completes while hidden',async()=>{
 const f=setup(),initial=f.host.state,pending=f.send({action:'rear-trunk',value:'open',confirmed:true});
 for(const focus of ['now','vehicle','music','vehicle','now']){f.host.state={...f.host.state,focus};f.driver.sync();f.advance(300);assert.ok(f.driver.pending);}
 f.advance(4500);assert.equal((await pending).status,'confirmed');assert.equal(f.host.state.focus,'now');assert.equal(f.host.state.vehicle.access.rearTrunk,'open');assert.equal(f.events.length,1);assert.equal(f.host.state.music,initial.music);assert.equal(f.host.state.timer,initial.timer);assert.equal(f.timers.size,0);
 assert.equal((await f.send({action:'rear-trunk',value:'closed',confirmed:true})).reason,'not-available','hidden presentation cannot initiate another action');
});
