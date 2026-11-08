'use strict';
// Serial execution keeps each isolated fixture on its own loopback port.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {artifactDir}=require('./podview_actual_env.cjs');
const journeys=['robot_ux_actual_e2e.cjs','music_push_actual_e2e.cjs','music_actual_e2e.cjs','music_selection_actual_e2e.cjs','radio_actual_e2e.cjs','robot_actual_e2e.cjs','light_actual_e2e.cjs','vehicle_actual_e2e.cjs','timer_actual_e2e.cjs','home_events_actual_e2e.cjs','answers_actual_e2e.cjs','recipe_actual_e2e.cjs'];
const env={...process.env,MUSIC_EXTENDED:'1',PODVIEW_TEST_ARTIFACT_DIR:artifactDir()};
function runJourney(journey,extraEnv={}){
 console.log(`Running actual PodView journey: ${journey}${extraEnv.MUSIC_COLD_REJECT==='1'?' (cold music context: setup rejected)':extraEnv.MUSIC_COLD_CONTEXT==='1'?' (cold music context: observed)':extraEnv.ROBOT_DRAFT_TEST==='1'?' (server task expiry and mode drafts)':extraEnv.ROBOT_SLOW_START_TEST==='1'?' (admitted Start across source expiry)':extraEnv.WEATHER_RETENTION_TEST==='1'?' (weather failure, reload, recovery and offline expiry)':extraEnv.TIMER_ADJUST_TEST==='1'?' (native v2 timer adjustment and exact Cancel)':''}`);
 const result=spawnSync(process.execPath,[path.join(__dirname,journey)],{env:{...env,...extraEnv},stdio:'inherit',timeout:240000});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`${journey} failed: ${result.signal||result.status}`);
}
// Optional names (e.g. `robot music`) run only those journeys, so CI can run them in parallel.
const only=process.argv.slice(2).map(name=>name.endsWith('_actual_e2e.cjs')?name:`${name}_actual_e2e.cjs`);
for(const name of only)if(!journeys.includes(name))throw new Error(`Unknown journey: ${name}`);
for(const journey of only.length?only:journeys){
 runJourney(journey);
 if(journey==='music_selection_actual_e2e.cjs'){
  runJourney(journey,{MUSIC_COLD_CONTEXT:'1',MUSIC_COLD_REJECT:'0'});
  runJourney(journey,{MUSIC_COLD_CONTEXT:'1',MUSIC_COLD_REJECT:'1'});
  runJourney(journey,{MUSIC_DEFAULT_SPEAKER_PROOF:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'default-speaker')});
  for(const scenario of ['1','revisit','cover']){
   runJourney(journey,{MUSIC_DISCOVERY_LOADING_TEST:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`discovery-${scenario}`)});
  }
  for(const scenario of ['cold-tail','unknown','unknown-unchanged']){
   console.log(`Queue recovery scenario: ${scenario}`);
   runJourney(journey,{MUSIC_QUEUE_INTENTS:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`queue-${scenario}`)});
  }
 }
 if(journey==='radio_actual_e2e.cjs'){
  for(const scenario of ['1','rejected','unknown']){
   runJourney(journey,{RADIO_STATION_ORDER_TEST:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`radio-${scenario}`)});
  }
 }
 if(journey==='robot_actual_e2e.cjs'){
  runJourney(journey,{ROBOT_DRAFT_TEST:'1'});
  runJourney(journey,{ROBOT_SLOW_START_TEST:'1'});
 }
 if(journey==='home_events_actual_e2e.cjs'){
  runJourney(journey,{WEATHER_RETENTION_TEST:'1'});
  runJourney(journey,{WEATHER_RETENTION_TEST:'1',WEATHER_COLD_OPEN_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'weather-cold-open')});
  runJourney(journey,{OFFLINE_FEEDBACK_TEST:'1',PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'offline-feedback')});
  runJourney(journey,{OFFLINE_FEEDBACK_TEST:'1',RO_LAYOUT_TEST:'1',PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'ro-layout')});
 }
 if(journey==='timer_actual_e2e.cjs'){
  runJourney(journey,{TIMER_ADJUST_TEST:'1'});
  runJourney(journey,{TIMER_RELOAD_TEST:'1'});
 }
}
console.log(`Actual PodView journey artifacts: ${env.PODVIEW_TEST_ARTIFACT_DIR}`);
