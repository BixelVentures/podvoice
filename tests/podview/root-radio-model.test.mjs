import test from 'node:test';
import assert from 'node:assert/strict';
import {stations,radioStation,localRadioPlayerModel,localRadioTransition,localRadioControlModel} from '../../podvoice/gatekeeper/static/podview/radio-model.js';

test('five named channels have stable, unique identifiers and no invented stream or artwork',()=>{
 assert.deepEqual(stations.map(({id,label})=>[id,label]),[
  ['p3','P3'],['p1','P1'],['p4-ostjylland','P4 Østjylland'],['p6-beat','P6 Beat'],['p8-jazz','P8 Jazz'],
 ]);
 assert.ok(stations.every(station=>Object.isFrozen(station)));
 assert.ok(Object.isFrozen(stations));
 assert.ok(stations.every(station=>Object.keys(station).sort().join(',')==='id,label'));
 assert.equal(radioStation('p4-ostjylland'),stations[2]);
 assert.equal(radioStation('P3'),null);
 assert.equal(radioStation('__proto__'),null);
});

test('local selection changes only source content of the shared player model',()=>{
 const base={active:true,playing:true,fresh:true,title:'Old track',artist:'Old artist',target:'Stuen',fixtureArt:'assets/old.png',canOutput:true,canDiscover:true,volume:35};
 const first=localRadioPlayerModel('p3',base),second=localRadioPlayerModel('p8-jazz',base);
 assert.equal(first.title,'P3');
 assert.equal(second.title,'P8 Jazz');
 assert.equal(first.active,true);
 assert.equal(first.playing,false);
 assert.equal(first.fresh,false);
 assert.equal(first.artist,'Direkte radio');
 assert.equal(first.fixtureArt,'assets/radio-p3.svg');
 assert.equal(first.artwork,null);
 assert.equal(first.canOutput,false);
 assert.equal(first.canDiscover,false);
 assert.equal(first.volume,35);
 assert.equal(first.target,'Stuen');
 assert.equal(first.exampleOnly,true);
 assert.equal(first.sourceKind,'radio');
 assert.equal(first.previewLabel,'Radio på pause · ingen lyd');
 assert.equal(base.title,'Old track');
 assert.equal(localRadioPlayerModel('unknown',base),null);
 assert.equal('uri' in first,false);
 assert.equal('stream' in first,false);
 assert.equal('receipt' in first,false);
 assert.equal(localRadioPlayerModel('p1',{}).target,'');
 assert.equal(localRadioPlayerModel('p1',{}).volume,null);
});


test('local radio selection, pause, volume and output share one retained source without music playback side effects',async()=>{
 const {initialScene}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');let state=initialScene();
 state=localRadioTransition(state,{type:'radio-select',stationId:'p3'});assert.equal(state.radioPlaying,true);assert.equal(state.music.playback.active,false);
 state=localRadioTransition(state,{type:'volume',value:42});state=localRadioTransition(state,{type:'target',accountId:'household',kind:'configured_alias',targetId:'kitchen',revision:state.music.revision});
 assert.equal(state.music.playback.volume,42);assert.equal(state.music.playback.room,'Køkkenet');assert.equal(state.music.pending,null);
 state=localRadioTransition(state,{type:'toggle'});assert.equal(state.radioPlaying,false);const controls=localRadioControlModel(state);assert.equal(controls.toggle,true);assert.equal(controls.canVolume,true);assert.equal(controls.previous,false);assert.equal(controls.next,false);
 const moved={...state,focus:'photo'},vm=localRadioPlayerModel(moved.radioStationId,{target:moved.music.playback.room,volume:42},{playing:moved.radioPlaying,connected:moved.connected});assert.equal(vm.target,'Køkkenet');assert.equal(vm.canOutput,true);assert.equal(vm.playing,false);assert.equal(vm.exampleOnly,true);assert.equal(vm.fresh,false);
 for(const event of [{type:'skip',delta:1},{type:'volume',value:101},{type:'target',accountId:'household',kind:'spotify_device',targetId:'office',revision:state.music.revision},{type:'radio-select',stationId:'invented'}])assert.equal(localRadioTransition(state,event),state);
 const offline={...state,connected:false};assert.equal(localRadioTransition(offline,{type:'toggle'}),offline);assert.equal(localRadioControlModel(offline).blocked,true);
});

test('actual host routes local radio controls and valid music selection returns to music without affecting live',async()=>{
 const {readFileSync}=await import('node:fs');const {initialScene,sceneTransition}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),code=source.slice(source.indexOf(' music(event){'),source.indexOf('\n build(){')).trim();
 const music=new Function('localRadioTransition',`return ({${code}}).music;`)(localRadioTransition);
 const host={live:false,state:localRadioTransition(initialScene(),{type:'radio-select',stationId:'p3'}),render(){},dispatch(event){this.state=sceneTransition(this.state,event);}};
 music.call(host,{type:'toggle'});assert.equal(host.state.radioPlaying,false);music.call(host,{type:'volume',value:38});assert.equal(host.state.music.playback.volume,38);
 music.call(host,{type:'select',id:'smooth-jazz',revision:0});assert.equal(host.state.radioStationId,'p3');music.call(host,{type:'select',id:'smooth-jazz',revision:host.state.music.revision});assert.equal(host.state.radioStationId,null);assert.ok(host.state.music.pending);
 const live={live:true,state:host.state,liveMedia:{playback:{state:'playing'}},liveControls:{musicIntent(action){this.action=action;}}};music.call(live,{type:'toggle'});assert.equal(live.liveControls.action,'pause');assert.equal(live.state,host.state);
});

test('retained Radio transport focus callback cannot navigate or dispatch playback',async()=>{
 const {readFileSync}=await import('node:fs');const {initialScene}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),code=source.split('onOpenPlayer:()=>{')[1].split('},onSelect:')[0];
 for(const connected of [true,false]){
  const timer={id:'timer-kept',remaining:41},answers=[{id:'answer-kept',status:'ready'}],state={...localRadioTransition(initialScene(),{type:'radio-select',stationId:'p3'}),focus:'radio',connected,timer,answers},calls=[];
  const run=new Function('$',`return function(){${code}}`)(id=>{assert.equal(id,'play-pause');return {focus:options=>calls.push(options)};});
  const host={state,dispatch(){assert.fail('Radio focus callback must not navigate');},music(){assert.fail('Radio focus callback must not issue playback');}};
  run.call(host);assert.equal(host.state,state);assert.equal(host.state.timer,timer);assert.equal(host.state.answers,answers);assert.equal(host.state.radioStationId,'p3');assert.deepEqual(calls,[{preventScroll:true}]);
 }
});
