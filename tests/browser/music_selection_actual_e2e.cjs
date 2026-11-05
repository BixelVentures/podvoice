'use strict';
// Packaged UI → real Python selection/queue brokers → stateful inert native service.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const cold=process.env.MUSIC_COLD_CONTEXT==='1',rejectSetup=process.env.MUSIC_COLD_REJECT==='1';
const port=Number(process.env.MUSIC_TEST_PORT||18979),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,page,serverLog='';const errors=[],actions=[],responses=[];let bundleSHA;
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
(async()=>{try{
 const nonce=require('node:crypto').randomUUID();
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-selection-'));
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:"1",MUSIC_COLD_CONTEXT:cold?"1":"0",MUSIC_COLD_REJECT:rejectSetup?"1":"0",PODVIEW_TEST_NONCE:nonce}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('startup');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,nonce,'own inert runtime');
 browser=await chromium.launch(env.browserOptions());
 page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');if(r.url().includes('/music/selection/')||r.url().includes('/music/queue/')||cold&&r.url().includes('/music?')&&new URL(r.url()).searchParams.get('kind')==='mood')responses.push({url:r.url(),status:r.status(),body:await r.text()})});
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/music/'))actions.push({url:r.url(),body:r.postDataJSON(),traceHeader:r.headers()['x-podview-trace']})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 if(cold){
  const initial=await (await page.request.get(base+'/view/api/music?kind=playback&account=account&include_controls=1')).json();
  assert.equal(initial.ok,true);assert.equal(initial.status,'idle');
  assert.equal(initial.data.playback.state,'no_active_playback');assert.equal(initial.data.playback.target,null);assert.equal(initial.data.playback.item,null);
  const snapshot=await (await page.request.get(base+'/view/api/snapshot')).json();assert.equal(snapshot.voice.active,false);assert.equal(snapshot.voice.phase,'IDLE');assert.equal(snapshot.voice.sessionId,null);assert.equal(snapshot.admission.kind,'ha_ingress');assert.equal(snapshot.voice.turnId,null);for(const key of ['taskId','inputRevision','providerGeneration'])assert.equal(Object.hasOwn(snapshot.voice,key),false);for(const key of ['sessionId','turnId','taskId','inputRevision'])assert.equal(snapshot.answers[key],null);assert.deepEqual(snapshot.capabilities.musicActions,[]);assert.equal(snapshot.mediaRoomBindings.length,1);
  const targets=await (await page.request.get(base+'/view/api/music?kind=targets&account=account')).json();assert.deepEqual(targets.data.targets,[]);
  await env.openOverview(page);await page.locator('#home-music').tap();
  await page.locator('#output').tap();await page.locator('#room-options button').filter({hasText:'Køkkenalrum HomePod'}).tap();
  const row=page.locator('#result-list button.result').filter({hasText:'Kold jazz'}).first();await row.waitFor({state:'visible',timeout:20000});await row.tap();
  if(rejectSetup){
   await page.locator('#player-empty').getByText('Højttaleren i rummet kan ikke bruges lige nu.',{exact:true}).waitFor({state:'visible',timeout:15000});
   await sleep(1700);assert(await page.locator('#player-empty').getByText('Højttaleren i rummet kan ikke bruges lige nu.',{exact:true}).isVisible(),'setup failure survives normal snapshot');
  }else{
   await page.locator('#track-name').filter({hasText:'Isoleret sang 11'}).waitFor({state:'visible',timeout:15000});
   await page.waitForFunction(()=>document.querySelector('#play-pause')?.disabled===false,undefined,{timeout:15000});
  }
  const value=await state(),commits=value.nativeCalls.filter(r=>r.service==='start_room_selected_content'),prepares=value.nativeCalls.filter(r=>r.service==='prepare_room_selected_content');
  assert.equal(commits.length,rejectSetup?0:1);assert.equal(prepares.length,rejectSetup?0:1);assert.equal(value.selections.length,rejectSetup?0:1);
  const mood=responses.map(r=>{try{return JSON.parse(r.body)}catch{return null}}).find(r=>r?.candidateSet?.sourceKind==='mood');assert(mood,'real Python mood source');
  if(!rejectSetup){const args=commits[0].args;assert.equal(args.args.context_uri,mood.data.tracks[0].uri);assert.equal(args.action,'play_context');assert(actions.find(r=>r.url.endsWith('/music/selection/setup'))?.body.target.speakerId,'actual selected alias forwarded to owner');assert.match(args.args.context_uri,/^spotify:playlist:[a-z0-9]{22}$/);assert.equal(args.room_id,'native-room');assert.equal(args.homepod_id,'42');assert.equal(args.target_id,'device');assert.deepEqual(args.args,{context_uri:args.args.context_uri,max_volume:100});assert.equal(value.state,'playing');assert.equal(value.volume,35);assert.equal(args.start_offer.start_volume_percent,35);assert.equal(value.writes.length,1);}
  if(rejectSetup){assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/setup')).length,1);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,0);assert.equal(value.writes.length,0);}
  // Read existing diagnostics only; never inject product state or force upload.
  const setupRequests=actions.filter(r=>r.url.endsWith('/music/selection/setup'));
  const actionRequests=actions.filter(r=>r.url.endsWith('/music/selection/actions'));
  assert.equal(setupRequests.length,1);const traceId=setupRequests[0].traceHeader;
  assert.match(traceId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(Object.hasOwn(setupRequests[0].body,'requestId'),false,'setup body stays closed; trace is optional metadata');
  const traceRef=createHash('sha256').update(traceId).digest('hex').slice(0,16);
  if(!rejectSetup){assert.equal(actionRequests.length,1);assert.equal(actionRequests[0].traceHeader,traceId);assert.equal(actionRequests[0].body.requestId,traceId);}
  const local=await page.locator('pv-widget-host').evaluate(h=>h.liveTransport.diagnostics());
  const intent=local.records.filter(r=>r.stage==='control_intent'&&r.code==='start'&&r.domain==='music');
  assert.equal(intent.length,1);assert.equal(intent[0].requestId,traceId,'one UUID minted at actual card tap');
  const localSetup=local.records.find(r=>r.stage==='request'&&r.endpoint==='music/selection/setup'&&r.code==='start'&&r.requestId===traceId);
  assert(localSetup&&intent[0].seq<localSetup.seq,'intent is recorded before setup starts');
  const parseServer=()=>serverLog.split('\n').flatMap(line=>{
   const match=line.match(/\b(selected_trace|selected_start_prepare|selected_start_commit|selected_start_receipt)\s/);if(!match)return [];
   const fields={marker:match[1]};for(const [,key,value]of line.matchAll(/\b(trace_ref|request_ref|stage|outcome|state|error_class|error_kind|accepted|native_identity_match|possible_send|prepared|poll_floor|elapsed_ms)=([A-Za-z0-9_.:-]+)/g))fields[key]=value;
   return fields.trace_ref===traceRef?[fields]:[];
  });
  const serverTrace=parseServer(),setupTrace=serverTrace.filter(r=>r.marker==='selected_trace'&&r.stage==='setup');
  assert.equal(setupTrace.length,1);assert.equal(setupTrace[0].outcome,rejectSetup?'native_unavailable':'accepted');
  if(rejectSetup){assert.equal(serverTrace.filter(r=>r.marker.startsWith('selected_start_')||r.stage==='action').length,0);}
  else{
   for(const marker of ['selected_start_prepare','selected_start_commit','selected_start_receipt'])assert.equal(serverTrace.filter(r=>r.marker===marker).length,1);
   assert(serverTrace.some(r=>r.marker==='selected_trace'&&r.stage==='selection'&&r.outcome==='send_started'));
   assert(serverTrace.some(r=>r.marker==='selected_trace'&&r.stage==='action'&&r.outcome==='accepted'));
   const nativeRefs=serverTrace.filter(r=>r.marker.startsWith('selected_start_')).map(r=>r.request_ref);assert.equal(new Set(nativeRefs).size,1);assert.match(nativeRefs[0],/^[a-f0-9]{16}$/);
  }
  assert(!serverLog.includes(traceId),'server logger never prints browser UUID');
  const expected=[['control_intent','start'],['control_intent',rejectSetup?'rejected':'accepted'],['request',rejectSetup?'http_error':'ok','music/selection/setup'],...(!rejectSetup?[['request','ok','music/selection/actions'],['control_action','accepted']]:[])];
  let journalRows=[];
  for(let attempt=0;attempt<21;attempt++){
   let after=0;const rows=[];for(let pageIndex=0;pageIndex<8;pageIndex++){
    const response=await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after);if(response.status()===429)break;assert.equal(response.status(),200);
    const body=await response.json();rows.push(...body.records);if(!body.hasMore)break;after=body.nextAfter;
   }
   journalRows=rows.filter(r=>r.row.requestRef===traceRef);
   if(expected.every(([stage,code,endpoint])=>journalRows.some(r=>r.row.stage===stage&&r.row.code===code&&(!endpoint||r.row.endpoint===endpoint))))break;
   if(attempt<20)await sleep(3000);
  }
  for(const [stage,code,endpoint]of expected)assert(journalRows.some(r=>r.row.stage===stage&&r.row.code===code&&(!endpoint||r.row.endpoint===endpoint)),`persisted same trace_ref ${stage}/${code}/${endpoint||''}`);
  const traceWitness={bundleSHA,traceRef,intentBeforeSetup:true,oneUuidAcrossSetupAndAction:!rejectSetup,setupBodyUnchanged:true,serverTrace,journal:journalRows.map(({serverSeq,row})=>({serverSeq,...row})),effectCount:value.writes.length};
  // Only closed, hashed trace facts enter this receipt; headers/UUIDs stay in memory.
  await fs.writeFile(path.join(env.artifactDir(),'cold-trace-'+(rejectSetup?'rejected':'observed')+'.json'),JSON.stringify(traceWitness,null,2));
  const terminalSnapshot=await (await page.request.get(base+'/view/api/snapshot')).json();assert.deepEqual(terminalSnapshot.voice,snapshot.voice);assert.deepEqual(terminalSnapshot.mediaRoomBindings,snapshot.mediaRoomBindings);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(env.artifactDir(),'podview-cold-context-'+(rejectSetup?'rejected':'observed')+'.png')});
  await fs.writeFile(path.join(env.artifactDir(),'cold-context-'+(rejectSetup?'rejected':'observed')+'.json'),JSON.stringify({runtimeNonceVerified:true,bundleSHA,initialStatus:initial.status,voice:snapshot.voice,terminalVoice:terminalSnapshot.voice,trace:traceWitness,service:{state:value.state,prepareCount:prepares.length,commitCount:commits.length,effectCount:value.writes.length},visible:await page.locator('body').innerText()},null,2));
  console.log(JSON.stringify({outcome:'PASS',coldContext:true,rejectSetup,prepares:prepares.length,commits:commits.length,pageErrors:errors}));return;
 }
 await env.openOverview(page);
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="top"]').tap();
 const rows=page.locator('#result-list button.result');
 await rows.filter({hasText:'Katalogsang 11'}).waitFor({state:'visible',timeout:15000});
 for(const song of [11,12,11]){
  const row=rows.filter({hasText:`Katalogsang ${song}`});
  await row.tap();
  for(let n=0;(await state()).song!==song;n++){if(n>100)throw Error('selection effect missing '+song);await sleep(100)}
  await page.waitForFunction(s=>document.querySelector('#track-name')?.textContent?.trim()===`Isoleret sang ${s}`,song,{timeout:15000});
  await page.waitForFunction(s=>{const h=document.querySelector('pv-widget-host');return !h?.liveControls?.musicIntentPending&&!h?.liveSelection?.pending&&h?.liveSelection?.feedback?.settlementStatus==='confirmed'&&h.liveMedia?.playback?.item?.uri===`spotify:track:${String(s).padStart(22,'0')}`},song,{timeout:15000});
 }
 const result=await state();
 assert.deepEqual(result.selections.map(r=>Number(r.uri.split(':').pop())),[11,12,11]);
 assert.equal(new Set(result.selections.map(r=>r.requestId)).size,3);
 assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,3);
 await page.locator('#track').tap();
 const queueRow=page.locator('#queue button.queue-track').filter({hasText:'Køsang 22'});
 await queueRow.waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll('#queue button.queue-track')].some(b=>b.textContent.includes('Køsang 22')&&!b.disabled),undefined,{timeout:15000});
 await queueRow.tap();
 for(let n=0;(await state()).song!==22;n++){if(n>100)throw Error('queue occurrence effect missing');await sleep(100)}
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent?.trim()==='Isoleret sang 22',undefined,{timeout:15000});
 const queued=await state();assert.equal(queued.queueSelections.length,1);assert.equal(queued.queueSelections[0].index,1);
 assert.equal(actions.filter(r=>r.url.endsWith('/music/queue/actions')).length,1);
 assert.deepEqual(queued.writes.map(r=>r.action),['play_track','play_track','play_track','play_queue_occurrence']);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='prepare_room_selected_content').length,3);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='start_room_selected_content').length,3);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='prepare_room_queue').length,1);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='control_room_queue').length,1);
 for(const r of actions.filter(r=>r.url.endsWith('/actions'))){assert(!Object.hasOwn(r.body,'uri'));assert(!Object.hasOwn(r.body,'index'));}
 assert.match(bundleSHA,/^[a-f0-9]{64}$/);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(env.artifactDir(),'podview-music-selection-trace.json'),JSON.stringify({bundleSHA,service:queued,actions,responses},null,2));
 await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection.png')});
 console.log(JSON.stringify({outcome:'PASS',packagedUI:true,bundleSHA,inertNativeService:true,catalogueSelections:[11,12,11],oneEffectPerExplicitChoice:true,queueProof:'opaque second occurrence → existing prepare/commit → observed song22',pageErrors:errors}));
 }catch(error){if(page){console.log('failureState',JSON.stringify({service:await state(),responses,actions,ui:await page.locator('body').innerText(),selection:await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,account:h.liveMedia?.account,capabilities:h.liveSnapshot?.capabilities,feedback:h.liveSelection?.feedback&&{message:h.liveSelection.feedback.message,outcome:h.liveSelection.feedback.outcome},queueStatus:h.liveMedia?.queueControls?.status,note:h.liveSelection?.note?.textContent,offer:h.liveSelection?.offer}))}));await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection-failure.png')})}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
