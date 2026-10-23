import test from 'node:test';import assert from 'node:assert/strict';
import {weatherObservation} from '../../podvoice/gatekeeper/static/podview/weather-observation.js';import {liveWeatherModel} from '../../podvoice/gatekeeper/static/podview/weather-view.js';
const now=Date.now(),context={roomId:'kitchen',sessionId:'s1',turnId:'s1:1',taskId:'weather-task',inputRevision:1,providerGeneration:2};
const raw=()=>({source:'Met.no',location:'hjemmet',retrievedAt:new Date(now).toISOString(),observedAt:now/1000,units:{temperature:'°C',precipitation:'mm',windSpeed:'km/h'},current:{temperature:13.9,condition:'cloudy'},forecastType:'hourly',forecast:[{datetime:new Date(now+3600000).toISOString(),temperature:14.7,precipitation:0}],aiAdvice:{schema:'podview.weather-advice.v1',receiptId:'actual-presentation',weatherReceiptId:'actual-weather',...context,summary:'En jakke kan være rar i det kølige vejr.',summaryKind:'ai_advice',evidenceFactIds:['fact:0'],validUntil:now/1000+60,source:'Met.no',sourceRetrievedAt:new Date(now).toISOString()}});
test('typed actual receipt advice occupies existing slot only for same current owner',()=>{const source=raw(),w=weatherObservation(source),model=liveWeatherModel(w,{now,aiContext:context});assert.equal(model.summary,source.aiAdvice.summary);assert.equal(model.summaryLabel,'AI-råd baseret på vejrudsigten');assert.equal(model.adviceUntil,source.aiAdvice.validUntil*1000);assert.equal(model.hours[0].rain,'0 mm');assert.equal(model.current.temperature,'14°');assert.equal(w.current.temperature,13.9);assert.equal(source.current.temperature,13.9);});
test('new input, task, room, generation, offline and expiry remove AI prose without dropping facts',()=>{const w=weatherObservation(raw());for(const options of [{aiContext:null},{aiContext:{...context,inputRevision:2}},{aiContext:{...context,taskId:'new-task'}},{aiContext:{...context,roomId:'other'}},{aiContext:{...context,providerGeneration:3}},{aiContext:context,connected:false},{aiContext:context,now:now+60000}]){const m=liveWeatherModel(w,{now,...options});assert.equal(m.summary,'');assert.equal(m.current.temperature,'14°');}});
test('untyped model text, wrong source, extra fields and empty evidence never become AI advice',()=>{for(const change of [{schema:'arbitrary-text'},{source:'DMI'},{summaryKind:'rules'},{extra:'unexpected'},{evidenceFactIds:[]}]){const source=raw();Object.assign(source.aiAdvice,change);const w=weatherObservation(source);assert.equal(w.aiAdvice,null);assert.equal(liveWeatherModel(w,{now,aiContext:context}).summary,'');}});

import {weatherAdviceCapability,weatherPassiveAdvice} from '../../podvoice/gatekeeper/static/podview/weather-observation.js';
import {validateHome,applyHome} from '../../podvoice/gatekeeper/static/podview/home-model.js';
const scope={bootId:'boot',roomId:'kitchen'},weatherKey='a'.repeat(64);
const capability=(weather=raw())=>({schema:'podview.weather-advice-capability.v1',...scope,weatherKey,source:weather.source,sourceRetrievedAt:Date.parse(weather.retrievedAt)/1000,availability:'available',status:'idle',validUntil:now/1000+60});
const passive=(status='ready',weather=raw())=>({schema:'podview.passive-weather-advice.v1',...scope,weatherKey,requestId:'b'.repeat(32),source:weather.source,sourceRetrievedAt:Date.parse(weather.retrievedAt)/1000,validUntil:now/1000+60,status,summaryKind:'ai_advice',summary:status==='ready'?'Tag en jakke med – skyerne har allerede taget deres på.':null,evidenceFactIds:status==='ready'?['current:temperature']:[]});
test('passive weather receipt is independently source-bound, closed and never invents a voice owner',()=>{
 const source=raw();delete source.aiAdvice;source.passiveAdvice=passive();const weather=weatherObservation(source),cap=weatherAdviceCapability(capability(),weather,scope,now),model=liveWeatherModel(weather,{now,passiveContext:cap});
 assert.equal(model.summary,source.passiveAdvice.summary);assert.equal(model.summaryState,'ready');assert.equal(model.summaryLabel,'AI-råd baseret på vejrudsigten');assert.equal(model.current.temperature,'14°');assert.equal(model.hours[0].rain,'0 mm');assert.equal('sessionId' in weather.passiveAdvice,false);
 for(const change of [{roomId:'other'},{bootId:'new'},{weatherKey:'c'.repeat(64)},{source:'DMI'},{sourceRetrievedAt:new Date(now-1).toISOString()},{validUntil:now/1000},{validUntil:now/1000+901},{summary:'<invented>'},{summary:'a\nsecond line'},{evidenceFactIds:[]},{extra:true},{requestId:'fake'}])assert.equal(weatherPassiveAdvice({...source.passiveAdvice,...change},weather,now,cap),null,JSON.stringify(change));
 assert.equal(liveWeatherModel(weather,{now,connected:false,passiveContext:cap}).summary,'');assert.equal(liveWeatherModel(weather,{now,passiveContext:{...cap,weatherKey:'c'.repeat(64)}}).summary,'');
});
test('capability admits only current exact weather scope and unavailable can retain typed identity without granting generation',()=>{
 const weather=weatherObservation(raw()),cap=capability();assert.deepEqual(weatherAdviceCapability(cap,weather,scope,now),cap);
 for(const change of [{roomId:'other'},{bootId:'new'},{weatherKey:'invalid'},{source:'DMI'},{sourceRetrievedAt:cap.sourceRetrievedAt-1},{validUntil:now/1000},{availability:'yes'},{status:'invented'},{extra:1}])assert.equal(weatherAdviceCapability({...cap,...change},weather,scope,now),null,JSON.stringify(change));
 for(const fields of [{},{weatherKey:null,source:null,sourceRetrievedAt:null,validUntil:null}]){const unavailable={...cap,...fields,availability:'unavailable',status:'unavailable'};assert.deepEqual(weatherAdviceCapability(unavailable,weather,scope,now),unavailable);}
 assert.equal(weatherAdviceCapability(cap,{...weather,stale:true},scope,now),null);
});
test('actual pending occupies only summary role, voice advice retains priority, terminal error never claims generated prose',()=>{
 const source=raw(),weather=weatherObservation({...source,passiveAdvice:passive('pending')}),cap=capability(),pending=liveWeatherModel(weather,{now,passiveContext:cap,passiveStatus:'pending'});
 assert.equal(pending.summary,'');assert.equal(pending.summaryState,'pending');assert.equal(pending.hours.length,1);assert.equal(pending.current.temperature,'14°');
 assert.equal(liveWeatherModel(weather,{now,aiContext:context,passiveContext:cap,passiveStatus:'pending'}).summary,source.aiAdvice.summary);
 const timeout=liveWeatherModel(weather,{now,passiveContext:cap,passiveStatus:'unavailable'});assert.equal(timeout.summaryState,'unavailable');assert.equal(timeout.summary,'Vejrrådet er ikke tilgængeligt lige nu.');assert.notEqual(timeout.summaryLabel,'AI-råd baseret på vejrudsigten');
 for(const status of ['pending','error','unavailable'])assert.equal(weatherPassiveAdvice({...passive(status),summary:'Invented ready text'},weather,now,cap),null);
});
test('existing home validation and apply preserve admitted capability and drop it with withdrawn weather read',()=>{
 const body={schema:'podview.home.v1',...scope,revision:1,observedAt:now/1000,vacuum:{status:'unavailable',items:[]},weather:{status:'observed',data:{...raw(),passiveAdvice:passive()}},weatherAdvice:capability()};
 const home=validateHome(body,scope.roomId,scope.bootId),scene={devices:[],focus:'weather',homeScope:null};assert.equal(home.weatherAdvice.weatherKey,weatherKey);assert.equal(home.weather.passiveAdvice.summary,passive().summary);
 assert.equal(applyHome(scene,home,['weather']).weatherAdvice.weatherKey,weatherKey);assert.equal(applyHome(scene,home,[]).weatherAdvice,null);
});
test('admitted passive flow never falls back to source rules on idle, pending, unavailable or error',()=>{
 const source=raw(),row=source.forecast[0];row.temperature=12;source.forecast[0].datetime=new Date(now+600000).toISOString();source.advice={id:'advice:'+'d'.repeat(32),ruleVersion:'next-hour-clothing-v1',source:source.source,retrievedAt:source.retrievedAt,periodTime:row.datetime,evidence:[{field:'temperature',value:12,unit:'°C',normalizedValue:12,normalizedUnit:'°C'}],kind:'practical_guidance',scope:'next_hourly_period',summary:'En jakke kan være rar at have med.',children:'Tag en jakke med.',validUntil:now/1000+60};delete source.aiAdvice;const weather=weatherObservation(source);assert.ok(weather.advice);
 for(const status of ['idle','pending','unavailable','error']){const model=liveWeatherModel(weather,{now,passiveContext:capability(source),passiveStatus:status});assert.notEqual(model.summary,'Tag en jakke med.');assert.equal(model.summary,['unavailable','error'].includes(status)?'Vejrrådet er ikke tilgængeligt lige nu.':'');assert.ok(!model.summaryLabel.startsWith('Praktisk'));assert.equal(model.current.temperature,'14°');}
});

test('final passive wire uses numeric Unix times and home requires a retained task ID; only unadmitted POST can have null',()=>{
 const source=raw(),weather=weatherObservation(source),cap=capability(),ready=passive();assert.equal(typeof ready.sourceRetrievedAt,'number');assert.equal(typeof ready.validUntil,'number');assert.ok(weatherPassiveAdvice(ready,weather,now,cap));
 for(const change of [{sourceRetrievedAt:source.retrievedAt},{sourceRetrievedAt:String(ready.sourceRetrievedAt)},{validUntil:String(ready.validUntil)},{sourceRetrievedAt:ready.sourceRetrievedAt-1},{summary:'a'.repeat(121)}])assert.equal(weatherPassiveAdvice({...ready,...change},weather,now,cap),null,JSON.stringify(change));
 const noTask={...passive('unavailable'),requestId:null};assert.equal(weatherPassiveAdvice(noTask,weather,now,cap),null);assert.ok(weatherPassiveAdvice(noTask,weather,now,cap,{allowUnadmitted:true}));assert.equal(weatherObservation({...source,passiveAdvice:noTask}).passiveAdvice,null);
 for(const status of ['pending','ready','error'])assert.equal(weatherPassiveAdvice({...passive(status),requestId:null},weather,now,cap,{allowUnadmitted:true}),null);
 assert.equal(weatherPassiveAdvice(ready,{...weather,retrievedAt:'invalid'},now,cap),null);
 // The existing voice receipt remains the independent, unchanged string contract.
 assert.equal(typeof weather.aiAdvice.sourceRetrievedAt,'string');assert.equal(liveWeatherModel(weather,{now,aiContext:context}).summary,source.aiAdvice.summary);
});
