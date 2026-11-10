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
 if(journey==='music_push_actual_e2e.cjs')runJourney(journey,{MUSIC_PUSH_OVERLAP_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'push-overlap')});
 if(journey==='music_actual_e2e.cjs')runJourney(journey,{MUSIC_VOLUME_DRAG_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'volume-drag')});
 if(journey==='music_actual_e2e.cjs')runJourney(journey,{MUSIC_RENEWED_CONTROLS_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'renewed-controls')});
 if(journey==='music_actual_e2e.cjs')runJourney(journey,{MUSIC_EXTERNAL_OUTPUT_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'external-output')});
 if(journey==='music_actual_e2e.cjs')runJourney(journey,{MUSIC_SPEAKER_REFRESH_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'speaker-refresh')});
 if(journey==='music_actual_e2e.cjs')runJourney(journey,{MUSIC_OUTPUT_TRANSFER_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'output-transfer')});
 if(journey==='music_actual_e2e.cjs')runJourney(journey,{MUSIC_MULTI_SCREEN_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'multi-screen')});
 if(journey==='music_actual_e2e.cjs')runJourney(journey,{MUSIC_MANUAL_RETRY_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'manual-retry')});
 if(journey==='music_selection_actual_e2e.cjs'){
  runJourney(journey,{MUSIC_ACCOUNT_ROLLOVER_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'account-rollover')});
  runJourney(journey,{MUSIC_DOCUMENT_SCOPE_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'document-scope')});
  runJourney(journey,{MUSIC_VOICE_JOURNEY_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'voice-queue')});
  runJourney(journey,{MUSIC_QUEUE_IDENTITY_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'queue-identity')});
  runJourney(journey,{MUSIC_RECENT_SESSION_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'recent-session')});
  runJourney(journey,{MUSIC_COLD_CONTEXT:'1',MUSIC_COLD_REJECT:'0'});
  runJourney(journey,{MUSIC_COLD_CONTEXT:'1',MUSIC_COLD_REJECT:'1'});
  runJourney(journey,{MUSIC_DEFAULT_SPEAKER_PROOF:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'default-speaker')});
  for(const scenario of ['1','revisit','cover','personal-cover']){
   runJourney(journey,{MUSIC_DISCOVERY_LOADING_TEST:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`discovery-${scenario}`)});
  }
  for(const scenario of ['same-owner','owner-change']){
   runJourney(journey,{MUSIC_LIBRARY_BUSY_TEST:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`library-busy-${scenario}`)});
  }
  for(const scenario of ['cold-tail','unknown','unknown-unchanged']){
   console.log(`Queue recovery scenario: ${scenario}`);
   runJourney(journey,{MUSIC_QUEUE_INTENTS:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`queue-${scenario}`)});
  }
 }
 if(journey==='vehicle_actual_e2e.cjs')runJourney(journey,{VEHICLE_RECOVERY_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'vehicle-recovery')});
 if(journey==='vehicle_actual_e2e.cjs')runJourney(journey,{VEHICLE_LIFECYCLE_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'vehicle-lifecycle')});
 if(journey==='radio_actual_e2e.cjs'){
  runJourney(journey,{RADIO_TIMING_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'radio-timing')});
  for(const scenario of ['missing','mismatch','rotate']){
   runJourney(journey,{RADIO_CONFIG_TEST:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`radio-config-${scenario}`)});
  }
  for(const scenario of ['1','rejected','unknown']){
   runJourney(journey,{RADIO_STATION_ORDER_TEST:scenario,
    PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,`radio-${scenario}`)});
  }
 }
 if(journey==='robot_actual_e2e.cjs'){
  runJourney(journey,{ROBOT_OBSERVATION_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'robot-observation')});
  runJourney(journey,{ROBOT_DOCK_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'robot-dock')});
  runJourney(journey,{ROBOT_DOCK_TEST:'1',ROBOT_HISTORY_DOCK_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'robot-history-dock')});
  runJourney(journey,{ROBOT_DOCK_TEST:'1',ROBOT_ACTIVE_BASE_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'robot-active-base')});
  runJourney(journey,{ROBOT_DRAFT_TEST:'1'});
  runJourney(journey,{ROBOT_DRAFT_TEST:'1',ROBOT_WATER_RECOVERY_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'robot-water-recovery')});
  runJourney(journey,{ROBOT_SLOW_START_TEST:'1'});
 }
 if(journey==='home_events_actual_e2e.cjs'){
  runJourney(journey,{WEATHER_RETENTION_TEST:'1'});
  runJourney(journey,{WEATHER_RETENTION_TEST:'1',WEATHER_COLD_OPEN_TEST:'1',
   PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'weather-cold-open')});
  runJourney(journey,{OFFLINE_FEEDBACK_TEST:'1',PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'offline-feedback')});
  runJourney(journey,{OFFLINE_FEEDBACK_TEST:'1',RO_LAYOUT_TEST:'1',PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'ro-layout')});
 }
 if(journey==='answers_actual_e2e.cjs')runJourney(journey,{ANSWERS_LIVE_TEST:'1',
  PODVIEW_TEST_ARTIFACT_DIR:path.join(env.PODVIEW_TEST_ARTIFACT_DIR,'answers-live')});
 if(journey==='timer_actual_e2e.cjs'){
  runJourney(journey,{TIMER_ADJUST_TEST:'1'});
  runJourney(journey,{TIMER_RELOAD_TEST:'1'});
 }
}
console.log(`Actual PodView journey artifacts: ${env.PODVIEW_TEST_ARTIFACT_DIR}`);
