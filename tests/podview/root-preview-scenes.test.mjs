import test from 'node:test';
import assert from 'node:assert/strict';
import {previewScene as createPreviewScene,previewStates,timerPreviewStates,musicPreviewStates,radioPreviewStates,weatherPreviewStates,answerPreviewStates,deviceOfflinePreviewStates,coexistencePreviewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition,deviceActions} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
const previewNow=Date.parse('2026-10-20T09:10:00Z');
const previewScene=name=>createPreviewScene(name,previewNow);
test('authored cover-state stage retains actual track choices while clearly labeling known, missing and failed local images',async()=>{
 const {localDiscoveryCards}=await import('../../podvoice/gatekeeper/static/podview/music-results.js'),{resultsFor,TRACKS}=await import('../../podvoice/gatekeeper/static/podview/widget-model.js');const state=previewScene('music-cover-states'),cards=localDiscoveryCards(state);
 assert.ok(previewStates.includes('music-cover-states'));assert.deepEqual(state,previewScene('music-cover-states'));assert.equal(state.music.collection,'top');assert.equal(state.focus,'music');assert.deepEqual(cards.map(card=>card.id),resultsFor(state.music).map(option=>option.id));assert.deepEqual(cards.map(card=>card.name),TRACKS.slice(0,3).map(track=>track.title));assert.equal(cards[0].fixtureArt,TRACKS[0].art);assert.equal(cards[1].fixtureArt,null);assert.equal(cards[2].fixtureArt,'assets/qa-unavailable-cover.svg');assert.ok(cards.every(card=>card.artworkRole==='cover'&&card.detail.startsWith('Lokalt billedtest · ')));assert.equal(state.music.pending,null);
 for(const card of cards){const selected=sceneTransition(state,{type:'music',event:{type:'select',id:card.id,revision:state.music.revision}});assert.equal(selected.music.pending.id,card.id);assert.equal(selected.music.playback,state.music.playback,'image fixture never starts playback');}
 const away=sceneTransition(sceneTransition(state,{type:'show',id:'now'}),{type:'show',id:'music'});assert.deepEqual(localDiscoveryCards(away),cards);assert.equal(away.music.playback,state.music.playback);assert.equal(previewScene('music-top').music.previewTracks,undefined,'image failure is not seeded into ordinary fixtures');
});
test('state previews retain resources independently of answer and connection status',()=>{
 for(const name of ['waiting','partial','ready','empty','error','offline','connecting','ended']){
  const s=previewScene(name);assert.equal(s.timer.status,'running',name);assert.equal(s.timer.remaining,60,name);assert.equal(s.music.playback.track,0,name);
 }
 const offline=previewScene('offline');assert.equal(offline.connected,false);assert.equal(offline.music.pending,null);
 assert.equal(previewScene('ended').pendingAnswer,null);
});
test('preview states distinguish unknown device result, completed timer and no activities',()=>{
 assert.equal(new Set(previewStates).size,previewStates.length);
 const unknown=previewScene('unknown');assert.equal(unknown.devices[0].status,'unknown');assert.deepEqual(deviceActions(unknown.devices[0]),[]);
 assert.equal(previewScene('complete').timer.status,'done');assert.equal(previewScene('nothing').timer,null);
 const rest=previewScene('rest');assert.equal(rest.focus,'photo');const active=sceneTransition(rest,{type:'show',id:'music'});assert.equal(active.music,rest.music);
});

test('stacked scenes preserve timer and devices when opening a detail',()=>{
 for(const name of ['stack','music-stack']){const s=previewScene(name);assert.equal(s.devices.length,2);assert.equal(s.timer.status,'running');const detail=sceneTransition(s,{type:'show',id:'demo-light'});assert.equal(detail.music,s.music);assert.equal(detail.timer,s.timer);assert.equal(detail.devices,s.devices);}
});
test('device detail returns to overview then Ro without stopping resources',()=>{
 const s=previewScene('music-stack');const detail=sceneTransition(s,{type:'show',id:'demo-vacuum'});assert.equal(detail.detailOrigin,'music');const next=sceneTransition(detail,{type:'show',id:'demo-light'});assert.equal(next.detailOrigin,'music');const back=sceneTransition(next,{type:'device-back'});assert.equal(back.focus,'now');assert.equal(sceneTransition(back,{type:'back'}).focus,'photo');assert.equal(back.music,s.music);assert.equal(back.timer,s.timer);assert.equal(back.devices,s.devices);
});

test('weather detail returns to overview and keeps its resources',()=>{let s=previewScene('music-stack');const music=s.music,timer=s.timer;s=sceneTransition(s,{type:'show',id:'weather'});assert.equal(s.focus,'weather');s=sceneTransition(s,{type:'device-back'});assert.equal(s.focus,'now');assert.deepEqual(s.music,music);assert.deepEqual(s.timer,timer);});

test('the music entry keeps household fixtures when navigating to overview and rest',()=>{
 const s=previewScene('top');assert.deepEqual(s.devices.map(d=>d.kind),['vacuum','light']);
 const now=sceneTransition(s,{type:'show',id:'now'}),rest=sceneTransition(now,{type:'show',id:'photo'});
 assert.equal(now.devices,s.devices);assert.equal(rest.devices,s.devices);assert.equal(rest.music,s.music);
});

import {devicePreviewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {lightSelection} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {conversationPreviewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {validateVisualContent} from '../../podvoice/gatekeeper/static/podview/visual-content.js';
test('explicit device audit stages use canonical IDs across detail, overview and Ro',()=>{
 for(const name of devicePreviewStates){
  const [domain,layer,status]=name.split('-'),kind=domain==='robot'?'vacuum':'light',id=`demo-${kind}`,s=previewScene(name),device=s.devices.find(d=>d.id===id);
  assert.ok(previewStates.includes(name));assert.equal(device.exampleOnly,true);
  assert.equal(s.focus,layer==='detail'?id:layer==='overview'?'now':'photo',name);
  assert.equal(!!device.pending,status==='pending',name);
  assert.equal(device.status,status==='pending'?(kind==='light'?'on':'cleaning'):status,name);
  if(kind==='light')assert.equal(lightSelection(device).status,device.status,name);
  const detail=sceneTransition(s,{type:'show',id});assert.equal(detail.music,s.music);assert.equal(detail.devices,s.devices);
 }
});

test('conversation previews keep listening and voice-only replies on the useful overview',()=>{
 const overview=previewScene('conversation-overview');
 for(const stage of ['listening','working','speaking']){
  const scene=previewScene(`conversation-${stage}`);
  assert.equal(scene.focus,'now');
  assert.deepEqual(scene.answers,[]);
  assert.equal(scene.pendingAnswer,null,'a voice phase must not invent a visual request');
  assert.deepEqual(scene.music,overview.music);
  assert.deepEqual(scene.timer,overview.timer);
  assert.deepEqual(scene.devices,overview.devices);
 }
 assert.equal(previewScene('conversation-speaking').voicePreviewPhase,'AI_SPEAKING');
 assert.equal(overview.timer.remaining,522);
});

test('late and interrupted conversation previews retain the same useful answer and resources',()=>{
 const visible=previewScene('conversation-visual');
 for(const stage of ['late','interrupted']){
  const scene=previewScene(`conversation-${stage}`);
  assert.equal(scene.focus,visible.focus);
  assert.deepEqual(scene.answers,visible.answers);
  assert.deepEqual(scene.music,visible.music);
  assert.deepEqual(scene.timer,visible.timer);
  assert.equal(scene.pendingAnswer,null);
  const lateReceipt=sceneTransition(scene,{type:'answer-result',id:'old-answer',generation:scene.generation,status:'ready'});
  assert.equal(lateReceipt,scene,'a late result without a matching pending task cannot replace focus');
 }
 assert.equal(previewScene('conversation-late').voicePreviewPhase,'THINKING');
 assert.equal(previewScene('conversation-interrupted').voicePreviewPhase,'LISTENING');
});

test('speech completion and a follow-up do not discard the visual answer or running resources',()=>{
 const visible=previewScene('conversation-visual'),complete=previewScene('conversation-complete'),followup=previewScene('conversation-followup');
 assert.equal(complete.voicePreviewPhase,'IDLE');
 assert.equal(complete.focus,visible.focus);
 assert.equal(complete.answers[0].status,'ready');
 assert.deepEqual(complete.answers[0].content,visible.answers[0].content);
 assert.equal(followup.answers[0].id,visible.answers[0].id);
 assert.equal(followup.answers[0].revision,visible.answers[0].revision+1);
 assert.notEqual(followup.answers[0].title,visible.answers[0].title);
 for(const scene of [complete,followup]){
  assert.deepEqual(scene.music,visible.music);
  assert.deepEqual(scene.timer,visible.timer);
  assert.equal(scene.pendingAnswer,null);
 }
});

test('conversation fixtures are deterministic and carry no live answer or source authority',()=>{
 for(const name of conversationPreviewStates){
  assert.ok(previewStates.includes(name));
  const scene=previewScene(name);
  assert.deepEqual(previewScene(name),scene);
  for(const answer of scene.answers){
   assert.equal(answer.exampleOnly,true);
   assert.equal(answer.live,undefined);
   assert.equal(answer.receiptId,undefined);
   assert.equal(answer.provenance,undefined);
   assert.deepEqual(validateVisualContent(answer.kind,answer.content),answer.content);
   assert.match(answer.content.sources[0].label,/forhåndsvisning/i);
   assert.equal(answer.content.sources[0].url,'example-sources.html');
  }
 }
});

test('conversation countdown is anchored to preview creation instead of the Unix epoch',()=>{
 const scene=createPreviewScene('conversation-overview',previewNow);
 assert.equal(scene.timer.deadline,previewNow+522000);
 const next=sceneTransition(scene,{type:'tick',now:previewNow+1000});
 assert.equal(next.timer.status,'running');assert.equal(next.timer.remaining,521);
});

test('finished timer coexists with short and scroll-length visual answers without changing resource identities',()=>{
 const active=previewScene('conversation-visual');
 for(const name of coexistencePreviewStates){
  const scene=previewScene(name),answer=scene.answers[0];
  assert.ok(previewStates.includes(name));assert.equal(scene.focus,active.focus);
  assert.equal(answer.id,active.answers[0].id);assert.equal(answer.status,'ready');
  assert.equal(answer.exampleOnly,true);assert.equal(answer.live,undefined);
  assert.equal(scene.timer.id,active.timer.id);assert.equal(scene.timer.status,'done');assert.equal(scene.timer.remaining,0);
  assert.deepEqual(scene.music,active.music);assert.deepEqual(scene.devices,active.devices);
  assert.equal(scene.voicePreviewPhase,'AI_SPEAKING');
  assert.deepEqual(validateVisualContent(answer.kind,answer.content),answer.content);
 }
 assert.equal(previewScene('conversation-visual-timer-finished').answers[0].content.facts.length,3);
 assert.equal(previewScene('conversation-long-timer-finished').answers[0].content.facts.length,6);
});

test('timer catalog renders real empty, running, completed and retained states across all layers',()=>{
 for(const name of timerPreviewStates){
  const [,layer,status]=name.split('-'),scene=previewScene(name);
  assert.equal(scene.focus,layer==='detail'?'timers':layer==='rest'?'photo':'now');
  assert.equal(scene.timer===null,status==='empty');
  if(status==='running'){assert.equal(scene.timer.remaining,522);assert.equal(scene.timer.deadline,previewNow+522000);}
  if(status==='finished'){assert.equal(scene.timer.remaining,0);assert.equal(scene.timer.status,'done');}
  if(status==='multiple'){assert.equal(scene.extraTimers?.length||0,0);assert.equal(scene.timer.status,'running');assert.deepEqual(scene.timerHistory.map(item=>item.seconds),[180,300,600]);}
  if(status==='stale'){assert.equal(scene.connected,false);assert.equal(scene.timer.stale,true);assert.equal(sceneTransition(scene,{type:'tick',now:previewNow+600000}).timer.remaining,522);}
  assert.equal(scene.timer?.ownerBootId,undefined,'local fixture cannot claim native ownership');
 }
});

test('music catalog keeps existing choices through refresh failures and covers all four collections',()=>{
 for(const collection of ['mood','feeling','top','recent'])assert.equal(previewScene(`music-${collection}`).music.collection,collection);
 assert.equal(previewScene('music-paused').music.playback.playing,false);
 assert.ok(previewScene('music-refreshing').music.refreshPending);
 for(const status of ['error','empty']){const scene=previewScene(`music-refresh-${status}`);assert.equal(scene.music.refreshStatus,status);assert.equal(scene.music.suggestionPage,0);assert.equal(scene.music.refreshPending,null);}
 for(const name of musicPreviewStates)assert.equal(previewScene(name).focus,'music');
});

test('radio and vehicle catalog states stay local and never invent connected vehicle data',()=>{
 for(const name of radioPreviewStates)assert.equal(previewScene(name).focus,'radio');
 assert.equal(previewScene('radio-selected').radioStationId,'p3');
 assert.equal(previewScene('radio-selected').music.playback.active,false);
 assert.equal(previewScene('radio-paused').radioPlaying,false);
 assert.equal(previewScene('radio-offline').connected,false);
 const vehicle=previewScene('vehicle-unconnected');assert.equal(vehicle.focus,'vehicle');assert.equal(vehicle.vehicle,undefined);
 for(const name of weatherPreviewStates){const scene=previewScene(name);assert.equal(scene.focus,'weather');assert.equal(scene.weatherPreview,name.startsWith('weather-advice-')||name==='weather-wind-known'?'ready':name.slice(8));assert.equal(scene.liveWeather,undefined);if(name.startsWith('weather-advice-'))assert.equal(scene.weatherFixture.advicePreview,name.slice('weather-advice-'.length));}
 assert.deepEqual(previewScene('weather-wind-known').weatherFixture.hours.map(hour=>hour.wind_bearing),[0,45,90,135,180,225,270,315,360,null,null,null]);
});

test('device offline previews retain observed state while blocking model actions',()=>{
 for(const name of deviceOfflinePreviewStates){
  const scene=previewScene(name),kind=name.startsWith('robot')?'vacuum':'light',device=scene.devices.find(d=>d.kind===kind);
  assert.equal(scene.connected,false);assert.equal(device.status,kind==='vacuum'?'cleaning':'on');
  const action=deviceActions(device)[0];assert.ok(action);
  assert.equal(sceneTransition(scene,{type:'device-action',sessionId:scene.sessionId,taskId:device.id,revision:device.revision,action:action.id}),scene);
 }
});

test('all ten answer families expose canonical lifecycle examples without live authority',()=>{
 for(const name of answerPreviewStates){
  const scene=previewScene(name),answer=scene.answers[0];assert.ok(answer,name);assert.equal(scene.focus,answer.id);
  assert.equal(answer.exampleOnly,true);assert.equal(answer.live,undefined);assert.equal(answer.receiptId,undefined);
  if(name.endsWith('-offline')){assert.equal(scene.connected,false);assert.equal(answer.status,'ready');}
  if(name.endsWith('-waiting'))assert.ok(scene.pendingAnswer);
  if(name.endsWith('-complete'))assert.equal(answer.status,'done');
 }
 const long=previewScene('answer-fact-card-long').answers[0];assert.equal(long.content.facts.length,6);assert.deepEqual(validateVisualContent(long.kind,long.content),long.content);
});


test('local weather decision uses relative periods across afternoon and midnight',()=>{
 for(const [time] of [
  ['2026-10-20T11:37:00Z',['14','15','16']],
  ['2026-10-20T21:37:00Z',['00','01','02']],
  ['2026-12-20T12:37:00Z',['14','15','16']]
 ]){
  const answer=createPreviewScene('conversation-visual',Date.parse(time)).answers[0];
  assert.equal(answer.content.facts[2].value,'Regn om tre timer');
  assert.equal(answer.content.facts[0].value,'Gå nu');
  assert.equal(answer.content.summary,'Ja, den næste time ser bedst ud.');
  assert.equal(answer.exampleOnly,true);assert.match(answer.content.sources[0].scope,/Opdigtet vejrforløb/);
  assert.deepEqual(createPreviewScene('conversation-followup',Date.parse(time)).answers[0].title,'Og hvis vi venter et par timer?');
 }
});

test('on and mixed light fixtures restore a nonzero preview dimmer level for every lit dimmable lamp',()=>{for(const name of ['light-detail-on','light-detail-mixed']){const s=previewScene(name),light=s.devices.find(d=>d.kind==='light');assert.ok(light.lights.filter(l=>l.on&&l.dimmable).every(l=>l.brightness>0));assert.equal(light.lights.find(l=>l.id==='kitchen-counter').dimmable,false);}});

test('many-room robot stage authors only public task offers and closed map/mode replacements',async()=>{
 const {controlTask}=await import('../../podvoice/gatekeeper/static/podview/control-model.js'),scene=previewScene('robot-detail-many-rooms'),fixture=scene.robotControlFixture,robot=scene.devices.find(d=>d.kind==='vacuum');assert.equal(scene.focus,robot.id);assert.equal(robot.status,'docked');assert.equal(robot.exampleOnly,true);assert.equal(robot.live,undefined);assert.equal(fixture.exampleOnly,true);assert.equal(Object.keys(fixture.offers).length,6);assert.equal(fixture.offers[fixture.initialKey].mapName,'Stueplan');assert.equal(fixture.offers[fixture.initialKey].options[0].argsSchema.areas.length,9);
 for(const offer of Object.values(fixture.offers)){const task=controlTask({ok:true,schema:'podview.control.v1',domain:'vacuum',bootId:'preview',roomId:'preview',taskId:'preview-task',revision:1,expiresAt:Date.now()/1000+60,setup:{mapName:offer.mapName},options:offer.options},{bootId:'preview',roomId:'preview'},'vacuum');assert.equal(task.options.length,offer.options.length);assert.equal(task.mapName,offer.mapName);const choices=offer.options.flatMap(option=>option.argsSchema.choices||[]);for(const [choiceId,next]of Object.entries(offer.replacements)){assert(choices.some(choice=>choice.id===choiceId));assert(fixture.offers[next]);}}
 const ground=fixture.offers['0-both'].options[0].argsSchema.areas,upstairs=fixture.offers['1-both'].options[0].argsSchema.areas;assert.equal(upstairs.length,4);assert(!upstairs.some(area=>ground.some(prior=>prior.id===area.id)));assert.equal(fixture.offers['0-vacuum'].options.some(option=>option.label==='Vandmængde'),false);assert.equal(fixture.offers['0-mop'].options.some(option=>option.label==='Sugestyrke'),false);assert.equal(previewScene('robot-detail-docked').robotControlFixture,undefined);
});


test('new library domain snapshots carry genuine owner input and no live action rights',async()=>{
 const {libraryDomainPreviewStates}=await import('../../podvoice/gatekeeper/static/podview/preview-scenes.js');
 const {vehicleModel}=await import('../../podvoice/gatekeeper/static/podview/vehicle-model.js');
 const {deviceOverviewFacts,lightSelection}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');
 for(const stage of libraryDomainPreviewStates){assert(previewStates.includes(stage));const scene=previewScene(stage);assert.deepEqual(scene,previewScene(stage),stage);assert.equal(scene.sessionId,'demo-session-1');}
 for(const kind of ['robot','light']){
  const empty=previewScene(`${kind}-detail-empty`);assert.equal(empty.connected,false);assert.equal(empty.devices.length,1);assert.equal(empty.devices[0].presentationOnly,true);assert.equal(empty.devices[0].status,'unavailable');assert.deepEqual(deviceActions(empty.devices[0]),[]);
  const stale=previewScene(`${kind}-detail-stale`).devices.find(d=>d.kind===(kind==='robot'?'vacuum':'light'));assert.equal(stale.stale,true);
 }
 const longRobot=previewScene('robot-detail-long').devices.find(d=>d.kind==='vacuum');assert(deviceOverviewFacts(longRobot,previewNow/1000).facts.some(row=>row.id==='room'&&row.value.length>60));
 const care=previewScene('robot-detail-care').devices.find(d=>d.kind==='vacuum');assert(care.telemetry.items.some(row=>row.key==='filter_time_left'));assert(care.telemetry.items.some(row=>row.key==='dock_error'));
 const longLight=previewScene('light-detail-long').devices.find(d=>d.kind==='light');assert(lightSelection(longLight).title.length>45);assert.equal(lightSelection(longLight).targetIds.length,1);
 assert.equal(lightSelection(previewScene('light-detail-room-living').devices.find(d=>d.kind==='light')).roomId,'living');assert.equal(lightSelection(previewScene('light-detail-room-kitchen').devices.find(d=>d.kind==='light')).roomId,'kitchen');
 for(const layer of ['detail','overview','rest'])assert.equal(previewScene(`timer-${layer}-paused`).timer.status,'paused');
 assert.equal(previewScene('music-offline').connected,false);const unknown=previewScene('music-unknown');assert.equal(unknown.music.pending,null);assert.match(unknown.music.message,/Udfald ukendt/);
 for(const variant of ['unknown','stale']){const model=vehicleModel(previewScene(`vehicle-${variant}`).vehicle);assert.equal(model.exampleOnly,true);assert.deepEqual(model.actions,[]);assert.match(model.context,/Lokalt eksempel/);assert.equal(model.modelName,undefined);if(variant==='unknown'){assert.equal(model.batteryPercent,null);assert.equal(model.status,'Status ukendt');}else{assert.equal(model.batteryPercent,72);assert.match(model.status,/Sidst kendt/);}}
 const emptyQueue=previewScene('player-queue-empty');assert.equal(emptyQueue.focus,'player');assert.equal(emptyQueue.music.playback.active,true);assert.equal(emptyQueue.queuePreview,'empty');assert.equal(previewScene('player-queue-error').queuePreview,'error');
 for(const stage of ['player-long-output','music-long-output'])assert(previewScene(stage).music.playback.room.length>45);
 assert.equal(previewScene('weather-unconnected').weatherPreview,'empty');assert.equal(previewScene('weather-offline').weatherPreview,'stale');
});


test('music specimens supply actual long renderer inputs and a distinct initial empty result',async()=>{
 const {localPlayerModel,localQueueModel}=await import('../../podvoice/gatekeeper/static/podview/player-view.js');
 const {localDiscoveryCards}=await import('../../podvoice/gatekeeper/static/podview/music-results.js');
 const {TRACKS}=await import('../../podvoice/gatekeeper/static/podview/widget-model.js');
 const empty=previewScene('music-initial-empty');assert.deepEqual(localDiscoveryCards(empty),[]);assert.equal(empty.music.playback.active,false);assert.equal(empty.music.refreshStatus,'');
 const refresh=previewScene('music-refresh-empty');assert.equal(localDiscoveryCards(refresh).length,3);assert.equal(refresh.music.playback.active,true);assert.equal(refresh.music.refreshStatus,'empty');
 for(const stage of ['music-long-metadata','player-long-metadata']){
  const state=previewScene(stage),vm=localPlayerModel(state),queue=localQueueModel(state),cards=localDiscoveryCards(state);
  assert(vm.title.length>80);assert(vm.artist.length>70);assert.equal(cards[0].name,vm.title);assert.equal(queue[0].title,vm.title);assert.equal(cards[0].description,vm.artist);assert.deepEqual(queue.map(item=>item.id),TRACKS.map(item=>item.id));
  const navigated=sceneTransition(sceneTransition(state,{type:'show',id:'now'}),{type:'show',id:'player'});assert.equal(localPlayerModel(navigated).title,vm.title);assert.deepEqual(localQueueModel(navigated).map(item=>item.id),queue.map(item=>item.id));
  const selected=sceneTransition(state,{type:'music',event:{type:'queue-select',id:queue[1].id,revision:state.music.revision}});assert.equal(localPlayerModel(selected).title,queue[1].title);assert.equal(localQueueModel(selected)[0].id,queue[1].id);
  const offline=sceneTransition(state,{type:'offline'});assert.equal(localPlayerModel(offline).canOutput,false);assert.equal(localQueueModel(offline).every(item=>!item.selectable),true);
 }
 for(const stage of ['player-queue-empty','player-queue-error']){const state=previewScene(stage),vm=localPlayerModel(state);assert.equal(vm.active,true);assert.equal(vm.title,TRACKS[0].title);assert.equal(vm.playing,true);assert.deepEqual(localQueueModel(state),[]);}
});


test('weather stress and connection failure use supported passive owner inputs',async()=>{
 const {localWeatherModel,liveWeatherModel,WEATHER_CHANGE_EXAMPLE}=await import('../../podvoice/gatekeeper/static/podview/weather-view.js');
 const {homeConnectionPresentation}=await import('../../podvoice/gatekeeper/static/podview/podvoice-view.js');
 const long=previewScene('weather-long'),model=localWeatherModel(long.weatherFixture);assert(model.title.length>60);assert(model.current.condition.length>60);assert.equal(model.source,'Eksempeldata');assert.deepEqual(long.weatherFixture.hours,WEATHER_CHANGE_EXAMPLE.hours);assert.deepEqual(long.weatherFixture.days,WEATHER_CHANGE_EXAMPLE.days);
 const failure=previewScene('weather-connection-error');assert.equal(failure.weatherPreview,'empty');const empty=liveWeatherModel(null,{reason:homeConnectionPresentation(failure.connectionPreview).reason});assert.equal(empty.current,null);assert.deepEqual(empty.hours,[]);assert.match(empty.emptyDetail,/svarer ikke/);assert.equal(empty.connectionReason,'unavailable');
});


test('metadata fixtures follow reducer-admitted Senest and refreshed options rather than stale top IDs',async()=>{
 const {localDiscoveryCards}=await import('../../podvoice/gatekeeper/static/podview/music-results.js');
 const {resultsFor}=await import('../../podvoice/gatekeeper/static/podview/widget-model.js');
 let state=sceneTransition(previewScene('music-long-metadata'),{type:'music',event:{type:'collection',value:'recent'}});
 const verifySelectable=scene=>{const cards=localDiscoveryCards(scene);assert.deepEqual(cards.map(card=>card.id),resultsFor(scene.music).map(option=>option.id));for(const card of cards){assert(card.id.startsWith('recent:'));assert(card.name.length>80);const selected=sceneTransition(scene,{type:'music',event:{type:'select',id:card.id,revision:scene.music.revision}});assert.equal(selected.music.pending?.id,card.id);}};
 verifySelectable(state);state=sceneTransition(state,{type:'music',event:{type:'refresh',revision:state.music.revision}});state=sceneTransition(state,{type:'music',event:{type:'refresh-result',...state.music.refreshPending,status:'ready'}});assert.equal(state.music.suggestionPage,1);verifySelectable(state);
 let empty=previewScene('music-initial-empty');assert.deepEqual(localDiscoveryCards(empty),[]);empty=sceneTransition(empty,{type:'music',event:{type:'refresh',revision:empty.music.revision}});assert.deepEqual(localDiscoveryCards(empty),[]);empty=sceneTransition(empty,{type:'music',event:{type:'refresh-result',...empty.music.refreshPending,status:'empty'}});assert.deepEqual(localDiscoveryCards(empty),[]);
 let recovered=previewScene('music-initial-empty');recovered=sceneTransition(recovered,{type:'music',event:{type:'refresh',revision:recovered.music.revision}});recovered=sceneTransition(recovered,{type:'music',event:{type:'refresh-result',...recovered.music.refreshPending,status:'ready'}});assert.equal(localDiscoveryCards(recovered).length,3);assert.equal(recovered.music.playback.active,false);
});

test('visual answer long and failed-image specimens remain validated local content',()=>{
 for(const format of ['fact-card','sourced-image','answer-timeline','simple-diagram']){
  const stage=`answer-${format}-long`,scene=previewScene(stage),answer=scene.answers[0];
  assert.ok(answerPreviewStates.includes(stage));assert.equal(answer.live,undefined);
  assert.deepEqual(validateVisualContent(format,answer.content),answer.content);
  assert.ok(answer.content.summary.length>100);
 }
 for(const format of ['sourced-image','simple-diagram']){
  const answer=previewScene(`answer-${format}-image-failure`).answers[0],content=answer.content;
  assert.equal(answer.exampleOnly,true);assert.equal(answer.status,'ready');
  assert.equal((content.image||content.illustration).url,'assets/qa-deliberately-missing-answer-image.webp');
  assert.ok((content.image||content.illustration).caption);assert.ok(content.sources.length);
  assert.deepEqual(validateVisualContent(format,content),content);
 }
});

test('answer back and history selection retain all ten answer identities without replaying actions',()=>{
 for(const format of ['concise','choices','comparison','chart','steps','checklist','fact-card','sourced-image','answer-timeline','simple-diagram']){
  let scene=previewScene(`answer-${format}-ready`);
  if(format==='checklist'||format==='steps'){
   const answer=scene.answers[0];scene=sceneTransition(scene,{type:'answer-action',sessionId:scene.sessionId,taskId:answer.id,revision:answer.revision,action:format==='checklist'?'check':'step',optionId:format==='checklist'?'paper':'next'});
  }
  const retained=scene.answers,music=scene.music,timer=scene.timer,answer=retained[0];
  scene=sceneTransition(scene,{type:'back'});assert.equal(scene.focus,'now');assert.equal(scene.answers,retained);
  // History selection uses the existing show event and the retained stable ID.
  scene=sceneTransition(scene,{type:'show',id:answer.id});
  assert.equal(scene.focus,answer.id);assert.equal(scene.answers,retained);assert.equal(scene.answers[0],answer);
  assert.equal(scene.music,music);assert.equal(scene.timer,timer);assert.equal(scene.pendingAnswer,null);
 }
});

test('walking answer gives distinct decision facts without claiming live weather',()=>{
 const answer=previewScene('conversation-visual').answers[0];
 assert.equal(answer.title,'Skal vi gå en tur?');assert.equal(answer.exampleOnly,true);assert.equal(answer.live,undefined);
 assert.equal(answer.content.facts.length,3);
 assert.deepEqual(answer.content.facts.map(fact=>fact.id),['window','temperature','rain']);
 assert.equal(answer.content.facts.filter(fact=>/°/.test(fact.value)).length,1);
 assert.equal(answer.content.facts[0].value,'Gå nu');assert.equal(answer.content.facts[2].value,'Regn om tre timer');
 assert.match(answer.content.sources[0].scope,/Ikke en aktuel vejrudsigt/);
 assert.deepEqual(validateVisualContent('fact-card',answer.content),answer.content);
});

test('silent dismissed timer is an actual completed timer and dismissal event before first render',async()=>{
 const scene=previewScene('timer-overview-dismissed'),finished=previewScene('timer-overview-finished');assert(previewStates.includes('timer-overview-dismissed'));assert.equal(scene.focus,'now');assert.equal(scene.timer.status,'done');assert.equal(scene.timer.remaining,0);assert.equal(scene.timer.noticeDismissed,true);assert.equal(scene.timer.id,finished.timer.id);assert.equal(scene.timer.ownerBootId,undefined);const {TimerNotice}=await import('../../podvoice/gatekeeper/static/podview/timer-notice.js');let hidden=false;TimerNotice.prototype.render.call({disposed:false,hide(){hidden=true;},startAudio(){assert.fail('dismissed fixture must not start audio');}},scene.timer,'now',false);assert.equal(hidden,true);assert.deepEqual(scene.music,finished.music);const cleared=sceneTransition(scene,{type:'timer',id:scene.timer.id,action:'cancel'});assert.equal(cleared.timer.status,'cancelled');assert.equal(scene.timer.status,'done');
 const screen=previewScene('screen-device-ready');assert(previewStates.includes('screen-device-ready'));assert.equal(screen.focus,'now');assert.equal(screen.timer,null);assert.equal(screen.music.playback.active,true);assert.equal(screen.connectionPreview,undefined);assert.equal(screen.screenDevice,undefined,'the actual screen owner authors its explicitly local example; no native capability is injected');
});

test('Tesla admitted library example offers only inert local actions',()=>{
 const scene=previewScene('vehicle-admitted-example',1000000);
 assert.equal(scene.vehicle.exampleOnly,true);
 assert.equal(scene.focus,'vehicle');
 assert.ok(scene.vehiclePreviewActions.includes('unlock'));
 assert.ok(scene.vehiclePreviewActions.includes('rearTrunkToggle'));
 assert.equal(scene.vehicle.modelName,'Model Y');
 assert.equal(scene.vehicle.batteryPercent,72);
 assert.equal(scene.vehicle.rangeKm,312);
 assert.equal(scene.vehicle.access.rearTrunk,'closed');
 assert.deepEqual(scene.vehicle.actions,[]);
});
