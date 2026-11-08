import {weatherFactObservation,weatherAdviceCapability} from '../../podvoice/gatekeeper/static/podview/weather-observation.js';
import {liveWeatherModel} from '../../podvoice/gatekeeper/static/podview/weather-view.js';
import test from 'node:test';import assert from 'node:assert/strict';import {validateHome,applyHome} from '../../podvoice/gatekeeper/static/podview/home-model.js';
const home=()=>({schema:'podview.home.v1',roomId:'kitchen',revision:2,observedAt:1700000000,vacuum:{status:'observed',items:[{entityId:'vacuum.actual',name:'Robot',state:'cleaning',battery:65,observedAt:1700000000,source:'home_assistant_state',actions:['start'],settings:{invented:true}}]}});
test('passive robot reads retain exact entity and observed state but never admit commands',()=>{const h=validateHome(home(),'kitchen');assert.equal(h.vacuum.items[0].entityId,'vacuum.actual');assert.equal(h.vacuum.items[0].state,'cleaning');assert.equal(h.vacuum.items[0].actions,undefined);assert.equal(h.vacuum.items[0].settings,undefined);const s=applyHome({devices:[{kind:'light',status:'unavailable'}]},h);assert.equal(s.devices[0].status,'cleaning');assert.equal(s.devices[0].pending,null);});
test('wrong room, duplicate entity and unrecognized source cannot replace real resources',()=>{for(const mutate of [h=>h.roomId='elsewhere',h=>h.vacuum.items.push({...h.vacuum.items[0]}),h=>h.vacuum.items[0].source='model',h=>h.vacuum.items[0].state='done']){const h=home();mutate(h);assert.throws(()=>validateHome(h,'kitchen'));}});
test('unavailable robot reads preserve last values as stale without inventing completion',()=>{const old=applyHome({devices:[]},validateHome(home(),'kitchen'));const next=applyHome(old,{revision:3,vacuum:{status:'unavailable',items:[]}});assert.equal(next.devices[0].stale,true);assert.equal(next.devices[0].status,'cleaning');});

test('removed configured vacuum leaves detail instead of showing obsolete device controls',()=>{const base=applyHome({devices:[],focus:'now'},validateHome(home(),'kitchen'));base.focus='vacuum.actual';const next=applyHome(base,{revision:3,vacuum:{status:'observed',items:[]}});assert.deepEqual(next.devices,[]);assert.equal(next.focus,'now');});

test('approved family slots remain vacuum then light across source updates',()=>{const scene={devices:[{kind:'light',status:'unavailable'}]};const next=applyHome(scene,validateHome(home(),'kitchen'));assert.deepEqual(next.devices.map(row=>row.kind),['vacuum','light']);const stale=applyHome(next,{revision:2,vacuum:{status:'unavailable',items:[]}});assert.deepEqual(stale.devices.map(row=>row.kind),['vacuum','light']);});

test('same boot room and vacuum retain unavailable telemetry stale, while explicit empty and identity changes clear',()=>{const telemetry={status:'observed',items:[{key:'filter_time_left',value:40,unit:'h',stale:false}]},raw={bootId:'boot',roomId:'kitchen',revision:1,weather:null,vacuum:{status:'observed',items:[{entityId:'vacuum.actual',name:'Robot',source:'home_assistant_state',state:'docked',telemetry}]}},scene=applyHome({devices:[]},raw);for(const change of ['unavailable','empty','entity','boot','room']){const next=structuredClone(raw);next.vacuum.items[0].telemetryUnavailable=true;next.vacuum.items[0].telemetry=change==='empty'?{status:'observed',items:[]}:{status:'unavailable',items:[]};if(change==='entity')next.vacuum.items[0].entityId='vacuum.other';if(change==='boot')next.bootId='new';if(change==='room')next.roomId='other';const result=applyHome(scene,next);assert.equal(result.devices[0].telemetry.items.length,change==='unavailable'?1:0,change);if(change==='unavailable'){assert.equal(result.devices[0].telemetry.items[0].stale,true);assert.equal(telemetry.items[0].stale,false);}}});

test('partial hourly failure retains only fresh exact source owner within same home scope',()=>{const now=Date.now(),scope={entityId:'weather.actual',ownerEpoch:'a'.repeat(64)},hourly={source:'Met.no',location:'same',units:{temperature:'°C'},forecastType:'hourly',retrievedAt:new Date(now-1000).toISOString(),observationScope:scope,forecast:[{datetime:new Date(now+3600000).toISOString(),temperature:10}]},weather={...hourly,forecastType:'daily',hourly},home={bootId:'boot',roomId:'room',revision:1,weather,vacuum:{status:'observed',items:[]}},scene=applyHome({devices:[]},home);for(const change of ['unavailable','entity','epoch','boot','room','location','source','units','legacy','expired','empty']){const next=structuredClone(home);delete next.weather.hourly;next.weather.hourlyUnavailable=true;if(change==='entity')next.weather.observationScope.entityId='weather.other';if(change==='epoch')next.weather.observationScope.ownerEpoch='b'.repeat(64);if(change==='boot')next.bootId='other';if(change==='room')next.roomId='other';if(change==='location')next.weather.location='other';if(change==='source')next.weather.source='other';if(change==='units')next.weather.units.temperature='°F';if(change==='legacy')delete next.weather.observationScope;const prior=structuredClone(scene);if(change==='expired')prior.liveWeather.hourly.retrievedAt=new Date(now-900001).toISOString();if(change==='empty')next.weather.hourly={...hourly,forecast:[]};const result=applyHome(prior,next);if(change==='unavailable'){assert.equal(result.liveWeather.hourly.forecast.length,1);assert.equal(result.liveWeather.hourly.stale,true);assert.equal(result.liveWeather.hourly.retrievedAt,hourly.retrievedAt);}else if(change==='empty')assert.equal(result.liveWeather.hourly.forecast.length,0);else assert.equal(result.liveWeather.hourly,undefined,change);}});

test('home validator preserves actual boot and rejects a reply from a different request owner',()=>{const value={...home(),bootId:'boot'};assert.equal(validateHome(value,'kitchen','boot').bootId,'boot');assert.throws(()=>validateHome(value,'kitchen','new'),/home_boot_changed/);assert.throws(()=>validateHome({...value,bootId:{}},'kitchen'));});

test('present but invalid auxiliary is never revived as a transient missing response',()=>{const now=Date.now(),identity={entityId:'weather.actual',ownerEpoch:'a'.repeat(64)},hourly={source:'Met.no',location:'same',retrievedAt:new Date(now-1000).toISOString(),observedAt:now/1000,units:{temperature:'°C'},current:null,forecastType:'hourly',forecast:[{datetime:new Date(now+3600000).toISOString(),temperature:10}],observationScope:identity},data={...hourly,forecastType:'daily',hourly},wire={schema:'podview.home.v1',bootId:'boot',roomId:'room',revision:1,observedAt:now/1000,vacuum:{status:'observed',items:[]},weather:{status:'observed',data}},scene=applyHome({devices:[]},validateHome(wire,'room','boot'));for(const invalid of [null,{...hourly,observationScope:{...identity,entityId:'weather.other'}},{...hourly,forecast:[{datetime:'invalid'}]}]){const next=validateHome({...wire,weather:{status:'observed',data:{...data,hourly:invalid}}},'room','boot');assert.equal(next.weather.hourlyUnavailable,false);assert.equal(applyHome(scene,next).liveWeather.hourly,undefined);}const missing=structuredClone(data);delete missing.hourly;const next=applyHome(scene,validateHome({...wire,weather:{status:'observed',data:missing}},'room','boot'));assert.equal(next.liveWeather.hourly.stale,true);});

test('malformed observed telemetry does not masquerade as an unavailable category for retention',()=>{const now=Date.now()/1000,telemetry={schema:'podview.robot.v1',vacuumEntityId:'vacuum.actual',source:'home_assistant_roborock',status:'observed',items:[{key:'filter_time_left',entityId:'sensor.filter',value:40,unit:'h',updatedAt:now,retrievedAt:now,stale:false}]},wire={...home(),bootId:'boot'};wire.vacuum.items[0].telemetry=telemetry;const scene=applyHome({devices:[]},validateHome(wire,'kitchen','boot'));assert.equal(scene.devices[0].telemetry.items.length,1);for(const kind of ['unavailable','malformed','empty']){const next=structuredClone(wire);next.vacuum.items[0].telemetry=kind==='unavailable'?{status:'unavailable'}:kind==='empty'?{...telemetry,items:[]}:{...telemetry,vacuumEntityId:'vacuum.other'};const result=applyHome(scene,validateHome(next,'kitchen','boot'));assert.equal(result.devices[0].telemetry.items.length,kind==='unavailable'?1:0,kind);}});

test('robot history retains only explicit completed setup on accepted owner records',()=>{
 const h=home(),base={id:'a'.repeat(32),recordedAt:1700000000,outcome:'accepted_by_ha',physicalResultVerified:false,recipe:{areaIds:['area'],mapName:'Stueplan',repeat:2,completeSetup:true}};
 const read=row=>{h.vacuum.items[0].history={status:'observed',source:'device_control_start_journal',items:[row]};return validateHome(h,'kitchen').vacuum.items[0].history.items[0].recipe.completeSetup;};
 assert.equal(read(base),true);assert.equal(read({...base,recipe:{...base.recipe,completeSetup:false}}),false);assert.equal(read({...base,recipe:{...base.recipe,completeSetup:'true'}}),false);assert.equal(read({...base,outcome:'unknown'}),false);assert.equal(read({...base,recipe:{...base.recipe,completeSetup:undefined}}),false);
});

test('partial robot observations retain bound fields and never promote old samples',()=>{
 const now=Date.now()/1000,bindingId='a'.repeat(64),row=(key,value,at)=>({key,entityId:`sensor.${key}`,value,unit:'%',updatedAt:at,retrievedAt:at,stale:false}),telemetry=items=>({status:'observed',bindingId,items,currentActivity:{status:'unavailable'}}),home={bootId:'boot',roomId:'room',revision:1,vacuum:{status:'observed',items:[{entityId:'vacuum.actual',source:'home_assistant_state',state:'docked',telemetry:telemetry([row('battery',80,now-10),row('clean_percent',40,now-20)])}]}};
 const first=applyHome({devices:[]},home),next=structuredClone(home);next.vacuum.items[0].telemetry=telemetry([row('battery',90,now),row('clean_percent',10,now-30)]);const merged=applyHome(first,next).devices[0].telemetry;assert.equal(merged.items.find(x=>x.key==='battery').value,90);const retained=merged.items.find(x=>x.key==='clean_percent');assert.equal(retained.value,40);assert.equal(retained.updatedAt,now-20);assert.equal(retained.stale,true);
 for(const mutate of [x=>x.vacuum.items[0].telemetry.bindingId='b'.repeat(64),x=>x.bootId='other',x=>x.vacuum.items[0].entityId='vacuum.other']){const changed=structuredClone(next);changed.vacuum.items[0].telemetry.items=[];mutate(changed);assert.equal(applyHome(first,changed).devices[0].telemetry.items.length,0);}
});

const retainedFacts=(now=Date.now())=>({source:'Home Assistant',location:'Home',retrievedAt:new Date(now-1000).toISOString(),stateUpdatedAt:new Date(now-2000).toISOString(),observedAt:(now-1000)/1000,units:{temperature:'°C',precipitation:'mm',windSpeed:'m/s'},current:{temperature:10,condition:'fog'},forecastType:'daily',forecast:[{datetime:new Date(now+3600000).toISOString(),temperature:12,highTemperature:12,lowTemperature:8,condition:'cloudy'}],observationScope:{entityId:'weather.actual',ownerEpoch:'a'.repeat(64)}});
const retainedHome=weather=>({schema:'podview.home.v1',bootId:'boot',roomId:'room',revision:1,observedAt:Date.now()/1000,vacuum:{status:'observed',items:[]},weather});
test('fresh browser receives scoped last-known weather without renewing original source timestamps',()=>{
 const raw=retainedFacts(),until=(Date.parse(raw.stateUpdatedAt)+7200000)/1000;
 const fresh=validateHome(retainedHome({status:'observed',data:raw,lastKnown:null}),'room','boot');
 const recovered=validateHome(retainedHome({status:'unavailable',data:null,lastKnown:{data:raw,validUntil:until}}),'room','boot');
 const scene=applyHome({devices:[]},recovered,['weather']);
 assert.equal(scene.liveWeather.current.temperature,10);assert.equal(scene.liveWeather.stale,true);
 assert.equal(scene.liveWeather.retrievedAt,raw.retrievedAt);assert.equal(scene.liveWeather.stateUpdatedAt,raw.stateUpdatedAt);
 assert.equal(scene.liveWeather.displayUntil,until*1000);assert.equal(fresh.weather.displayUntil,until*1000);
 assert.equal(scene.liveWeather.aiAdvice,null);assert.equal(scene.liveWeather.passiveAdvice,null);assert.equal(scene.liveWeather.advice,null);
});
test('explicit absent or malformed history clears prior weather rather than taking legacy retention',()=>{
 const raw=retainedFacts(),prior=applyHome({devices:[]},validateHome(retainedHome({status:'observed',data:raw,lastKnown:null}),'room','boot'),['weather']);
 for(const lastKnown of [null,undefined,{data:raw,validUntil:Date.now()/1000+7201},{data:{...raw,observationScope:null},validUntil:Date.now()/1000+10}]){
  const next=validateHome(retainedHome({status:'unavailable',data:null,lastKnown}),'room','boot');assert.equal(next.weather,null);assert.equal(applyHome(prior,next,['weather']).liveWeather,null);
 }
 const invalid=validateHome(retainedHome({status:'observed',data:{...raw,observationScope:null},lastKnown:null}),'room','boot');assert.equal(invalid.weather,null);assert.equal(applyHome(prior,invalid,['weather']).liveWeather,null);
 assert.throws(()=>validateHome({...retainedHome({status:'unavailable',data:null,lastKnown:null}),bootId:'other'},'room','boot'));
});
test('forecast-only facts use their original retrieval limit while expired auxiliary hours cannot return',()=>{
 const now=Date.now(),raw=retainedFacts(now),hourly={...raw,current:null,forecastType:'hourly',retrievedAt:new Date(now-901000).toISOString()};delete hourly.stateUpdatedAt;
 const facts=weatherFactObservation({...raw,current:null,stateUpdatedAt:undefined,hourly},{now,stale:true});
 assert.equal(facts.current,null);assert.equal(facts.displayUntil,Date.parse(raw.retrievedAt)+7200000);assert.equal(facts.hourly,undefined);assert.equal(facts.hourlyUnavailable,false);assert.equal(facts.forecast.length,1);
 assert.equal(weatherFactObservation({...raw,stateUpdatedAt:new Date(now+1000).toISOString()},{now}),null);
 for(const invalid of [{...raw,observedAt:(Date.parse(raw.retrievedAt)-1)/1000},{...raw,observedAt:(now+1)/1000},{...raw,current:null,stateUpdatedAt:'invalid'},{...raw,current:null,stateUpdatedAt:new Date(now+1000).toISOString()}])assert.equal(weatherFactObservation(invalid,{now}),null);
});
test('fresh scoped weather expires offline via the existing model deadline, with no facts or advice at its boundary',()=>{
 const now=Date.now(),raw=retainedFacts(now);raw.stateUpdatedAt=new Date(now-7199000).toISOString();
 const facts=weatherFactObservation(raw,{now}),deadline=now+1000;
 assert.equal(facts.displayUntil,deadline);
 const before=liveWeatherModel(facts,{now:deadline-1,connected:false});assert.equal(before.current.temperature,'10°');assert.equal(before.sourceStale,true);assert.equal(before.refreshAt,deadline);assert.equal(before.metadata.find(row=>row.id==='weather-retrieved').label,'Hentet');
 const after=liveWeatherModel(facts,{now:deadline,connected:false});assert.equal(after.current,null);assert.deepEqual(after.days,[]);assert.deepEqual(after.hours,[]);assert.equal(after.summary,'');
});

test('passive advice closes at source freshness expiry while historical facts stay bounded',()=>{
 const now=Date.now(),raw=retainedFacts(now);
 raw.stateUpdatedAt=new Date(now-30*60*1000+1000).toISOString();
 const facts=weatherFactObservation(raw,{now}),scope={bootId:'boot',roomId:'room'};
 const cap={schema:'podview.weather-advice-capability.v1',...scope,weatherKey:'b'.repeat(64),source:raw.source,
  sourceRetrievedAt:Date.parse(raw.retrievedAt)/1000,availability:'available',status:'idle',validUntil:(now+60000)/1000};
 assert.ok(weatherAdviceCapability(cap,facts,scope,now+999));
 assert.equal(weatherAdviceCapability(cap,facts,scope,now+1000),null);
 assert.equal(liveWeatherModel(facts,{now:now+1000}).sourceStale,true);
 assert.equal(liveWeatherModel(facts,{now:now+1000}).current.temperature,'10°');
 const shortBound=weatherFactObservation(raw,{now,validUntil:(now+500)/1000});
 assert.ok(weatherAdviceCapability(cap,shortBound,scope,now+499));
 assert.equal(weatherAdviceCapability(cap,shortBound,scope,now+500),null);
});

test('explicit legacy current-only weather is bounded, never retained, and never inferred from absent scope',()=>{
 const now=Date.now(),raw=retainedFacts(now);delete raw.observationScope;const deadline=Date.parse(raw.stateUpdatedAt)+7200000;
 const direct=weatherFactObservation(raw,{now,allowCurrentOnly:true});assert.equal(direct.current.temperature,10);assert.equal(direct.displayUntil,deadline);assert.equal(direct.observationScope,undefined);assert.equal(weatherFactObservation(raw,{now:deadline,allowCurrentOnly:true}),null);assert.equal(weatherFactObservation(raw,{now}),null);assert.equal(weatherFactObservation(raw,{now,allowCurrentOnly:true,stale:true}),null);assert.equal(weatherFactObservation(raw,{now:deadline,allowCurrentOnly:true,stale:true,validUntil:deadline/1000+3600}),null);
 const unscopedHourly=weatherFactObservation({...raw,hourly:{...raw,forecastType:'hourly'}},{now,allowCurrentOnly:true});assert.equal(unscopedHourly.hourly,undefined);
 const good={status:'observed',data:raw,lastKnown:null,currentOnly:true},home=validateHome(retainedHome(good),'room','boot');assert.equal(home.weather.current.temperature,10);assert.equal(home.weather.displayUntil,deadline);const scene=applyHome({devices:[]},home,['weather']);const unavailable=validateHome(retainedHome({status:'unavailable',data:null,lastKnown:null}),'room','boot');assert.equal(applyHome(scene,unavailable,['weather']).liveWeather,null);
 const variants=[{...good,currentOnly:false},{status:'observed',data:raw,lastKnown:null},{status:'observed',data:raw,currentOnly:true},{...good,lastKnown:{data:raw,validUntil:deadline/1000}},{...good,data:{...raw,observationScope:null}},{...good,data:{...raw,observationScope:{entityId:'weather.actual'}}},{...good,data:{...raw,observationScope:{entityId:'weather.actual',ownerEpoch:'a'.repeat(64)}}},{...good,status:'unavailable',data:null,lastKnown:{data:{...raw,observationScope:{entityId:'weather.actual',ownerEpoch:'a'.repeat(64)}},validUntil:deadline/1000}},{...good,data:{...raw,forecast:null}}];
 for(const variant of variants){const value=validateHome(retainedHome(variant),'room','boot');assert.equal(value.weather,null,JSON.stringify(variant));assert.equal(applyHome(scene,value,['weather']).liveWeather,null,JSON.stringify(variant));}
});
