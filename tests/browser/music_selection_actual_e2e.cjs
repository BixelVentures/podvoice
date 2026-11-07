'use strict';
// Packaged UI → real Python selection/queue brokers → stateful inert native service.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const holdPlayback=process.env.MUSIC_HOLD_PLAYBACK==='1';
const cold=process.env.MUSIC_COLD_CONTEXT==='1',rejectSetup=process.env.MUSIC_COLD_REJECT==='1',repeatMood=process.env.MUSIC_REPEAT_MOOD==='1',previewRenew=process.env.MUSIC_PREVIEW_RENEW==='1',holdMood=process.env.MUSIC_HOLD_MOOD==='1';
const port=Number(process.env.MUSIC_TEST_PORT||18979),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,page,serverLog='';const errors=[],actions=[],responses=[],moodRenewals=[];let bundleSHA;
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
(async()=>{try{
 const nonce=require('node:crypto').randomUUID();
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-selection-'));
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:"1",MUSIC_COLD_CONTEXT:cold?"1":"0",MUSIC_COLD_REJECT:rejectSetup?"1":"0",MUSIC_REPEAT_MOOD:repeatMood?"1":"0",PODVIEW_TEST_NONCE:nonce}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('startup');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,nonce,'own inert runtime');
 browser=await chromium.launch(env.browserOptions());
 page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');if(r.url().includes('/music/selection/')||r.url().includes('/music/queue/')||cold&&r.url().includes('/music?')&&new URL(r.url()).searchParams.get('kind')==='mood')responses.push({url:r.url(),status:r.status(),body:await r.text()})});
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/music/'))actions.push({url:r.url(),body:r.postDataJSON(),traceHeader:r.headers()['x-podview-trace']});if(previewRenew&&r.method()==='GET'&&r.url().includes('/music?')){const url=new URL(r.url());if(url.searchParams.get('kind')==='mood'&&url.searchParams.get('renew')==='1')moodRenewals.push(r.headers()['x-podview-trace']);}});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 if(cold){
  const initial=await (await page.request.get(base+'/view/api/music?kind=playback&account=account&include_controls=1')).json();
  assert.equal(initial.ok,true);assert.equal(initial.status,'idle');
  assert.equal(initial.data.playback.state,'no_active_playback');assert.equal(initial.data.playback.target,null);assert.equal(initial.data.playback.item,null);
  const snapshot=await (await page.request.get(base+'/view/api/snapshot')).json();assert.equal(snapshot.voice.active,false);assert.equal(snapshot.voice.phase,'IDLE');assert.equal(snapshot.voice.sessionId,null);assert.equal(snapshot.admission.kind,'ha_ingress');assert.equal(snapshot.voice.turnId,null);for(const key of ['taskId','inputRevision','providerGeneration'])assert.equal(Object.hasOwn(snapshot.voice,key),false);for(const key of ['sessionId','turnId','taskId','inputRevision'])assert.equal(snapshot.answers[key],null);assert.deepEqual(snapshot.capabilities.musicActions,[]);assert.equal(snapshot.mediaRoomBindings.length,1);
  const targets=await (await page.request.get(base+'/view/api/music?kind=targets&account=account')).json();assert.deepEqual(targets.data.targets,[]);
  let previewArmed=false,initialMood=true,holdArmed=false,releaseMood,markHeld;const heldMood=new Promise(resolve=>{markHeld=resolve;}),moodGate=new Promise(resolve=>{releaseMood=resolve;});
  if(holdMood)await page.route('**/view/api/music?**',async route=>{const url=new URL(route.request().url());if(!holdArmed||url.searchParams.get('kind')!=='mood'||url.searchParams.get('renew')!=='1')return route.continue();holdArmed=false;const response=await route.fetch();markHeld();await moodGate;await route.fulfill({response});});
  if(previewRenew)await page.route('**/view/api/music?**',async route=>{const url=new URL(route.request().url());if(url.searchParams.get('kind')!=='mood'||!initialMood&&!previewArmed)return route.continue();const response=await route.fetch(),body=await response.json();assert.equal(body.ok,true);assert.ok(body.candidateSet,'actual owner supplied playlist source');const tracks=body.data.tracks.map(({uri,name,artist,themeId,themeTitle,themeArt,artwork})=>({uri,name,artist,themeId,themeTitle,themeArt,...(artwork?{artwork}:{})}));const preview={ok:true,schema:'podview.mood-preview.v1',preview:{readOnly:true,bootId:snapshot.bootId,roomId:snapshot.roomId,configEntryId:'account',ownerEpoch:body.data.owner_epoch,source:'spotify_web_api',expiresIn:60,voiceSessionId:snapshot.voice.sessionId,voiceTurnId:snapshot.voice.turnId},data:{config_entry_id:'account',owner_epoch:body.data.owner_epoch,source:'spotify_web_api',tracks}};initialMood=false;previewArmed=false;await route.fulfill({response,json:preview});});
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
  if((repeatMood||previewRenew)&&!rejectSetup){
   await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveSelection?.feedback?.settlementStatus==='confirmed'&&h.liveMedia?.playback?.state==='playing'&&!h.liveControls?.musicIntentPending&&!h.liveSelection.pending;},undefined,{timeout:15000});
   await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-before-pause.png')});
   await page.locator('#play-pause').tap();
   await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveMedia?.playback?.state==='paused'&&!h.liveControls?.musicIntentPending&&document.querySelector('#play-pause')?.getAttribute('aria-label')==='Fortsæt musikken';},undefined,{timeout:15000});
   assert.equal((await state()).state,'paused');await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-after-pause.png')});const firstUri=value.selections[0].uri,second=mood.data.tracks.find(track=>track.uri!==firstUri);assert(second?.themeTitle,'a genuinely different displayed mood playlist exists');
   const holdOldItem=async expected=>{
    let staleShown,release;
    const stale=new Promise(resolve=>{staleShown=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const old=(await (await page.request.get(base+'/view/api/music?kind=playback&account=account&include_controls=1')).json()).data.playback;
    let usedOld=false;
    const handler=async route=>{
     const url=new URL(route.request().url());
     if(url.searchParams.get('kind')!=='playback')return route.continue();
     const response=await route.fetch(),body=await response.json();
     if(body.data?.playback?.item?.name!==expected)return route.fulfill({response,json:body});
     if(!usedOld){usedOld=true;body.data.playback=old;await route.fulfill({response,json:body});staleShown();return;}
     await gate;return route.fulfill({response,json:body});
    };
    await page.route('**/view/api/music?**',handler);
    return {stale,release,remove:()=>page.unroute('**/view/api/music?**',handler)};
   };
   const playlistHold=holdPlayback?await holdOldItem('Isoleret sang 12'):null;
   const secondRow=page.locator('#result-list button.result').filter({hasText:second.themeTitle});await secondRow.waitFor({state:'visible',timeout:15000});if(previewRenew)previewArmed=true;if(holdMood)holdArmed=true;await secondRow.tap();
   if(holdMood){await Promise.race([heldMood,sleep(10000).then(()=>{throw Error('actual second mood response not held');})]);const before=await page.locator('pv-widget-host').evaluate(h=>({readAt:h.liveTransport.acceptedReadAt,boot:h.liveSnapshot.bootId,room:h.liveSnapshot.roomId,voice:JSON.stringify(h.liveSnapshot.voice),binding:JSON.stringify(h.liveSnapshot.mediaRoomBindings),focus:h.state.focus}));await page.waitForFunction(readAt=>document.querySelector('pv-widget-host')?.liveTransport?.acceptedReadAt>readAt,before.readAt,{timeout:5000});const after=await page.locator('pv-widget-host').evaluate(h=>({readAt:h.liveTransport.acceptedReadAt,boot:h.liveSnapshot.bootId,room:h.liveSnapshot.roomId,voice:JSON.stringify(h.liveSnapshot.voice),binding:JSON.stringify(h.liveSnapshot.mediaRoomBindings),focus:h.state.focus}));assert.deepEqual({...after,readAt:0},{...before,readAt:0},'same-owner natural SSE arrived while actual renewal response held');const held=await page.locator('pv-widget-host').evaluate(h=>({pending:!!h.liveSelection.recovery,metadata:h.liveSelection.pendingPlayer()?.title??null}));assert.equal(held.pending,true,'explicit choice remains pending after normal SSE');assert(held.metadata,'selected metadata remains visible during renewal');assert.deepEqual((await state()).writes.map(row=>row.action),['play_context','pause'],'no second effect before renewal response');assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/setup')).length,1,'no second setup before renewal response');console.log('HELD_MOOD_SNAPSHOT',JSON.stringify({received:true,sameOwner:true,focus:after.focus,pending:true,metadataRetained:true,noSecondEffect:true}));releaseMood();}
   if(previewRenew){const feedback=page.locator('#player-state');await feedback.waitFor({state:'visible',timeout:15000});await page.waitForFunction(()=>document.querySelector('#player-state')?.textContent==='Musikvalget fejlede · prøv igen.',undefined,{timeout:15000});const readAt=await page.locator('pv-widget-host').evaluate(h=>h.liveTransport.acceptedReadAt);await page.waitForFunction(at=>document.querySelector('pv-widget-host')?.liveTransport?.acceptedReadAt>at,readAt,{timeout:5000});assert.equal(await feedback.textContent(),'Musikvalget fejlede · prøv igen.','preview feedback survives normal SSE');const denied=await state();assert.equal(denied.state,'paused');assert.equal(denied.selections.length,1);assert.deepEqual(denied.writes.map(row=>row.action),['play_context','pause']);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,1);const terminal=await page.locator('pv-widget-host').evaluate(h=>h.liveTransport.diagnostics().records.filter(row=>row.stage==='control_intent'&&row.code==='renewal_readonly').at(-1));assert(terminal?.requestId,'explicit readonly branch emits its actual intent reason');assert.equal(moodRenewals.at(-1),terminal.requestId,'same touch UUID correlates the explicit renewal read');const renewalRef=createHash('sha256').update(terminal.requestId).digest('hex').slice(0,16);await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-preview-feedback.png')});const feedbackGeometry=[];const feedbackState=async stage=>console.log('FEEDBACK_STATE',stage,JSON.stringify(await page.locator('pv-widget-host').evaluate(h=>{const v=h.liveSelection,t=v?.resultTicket,d=document;return {message:v?.feedback?.message??null,scopeCurrent:v?.resultCurrent?.(t)??null,ticket:!!t,scopeEqual:t?.scope===v?.feedbackScope?.(),focusTicket:d.activeElement===t?.focus,focusBody:d.activeElement===d.body,activeTag:d.activeElement?.tagName,visible:d.visibilityState,view:h.state?.focus,playerText:d.querySelector('#player-state')?.textContent,sourcePresent:!!v?.source,connected:h.liveTransport?.connected};})));for(const [width,height]of [[980,800],[768,1024]]){await feedbackState('before-'+width);await page.setViewportSize({width,height});await feedbackState('after-resize-'+width);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));});await feedbackState('after-animation-'+width);const geometry=await feedback.evaluate(node=>{const r=document.createRange();r.selectNodeContents(node);const text=r.getBoundingClientRect(),box=node.getBoundingClientRect(),player=node.closest('.player').getBoundingClientRect(),style=getComputedStyle(node);return {text:{left:text.left,right:text.right,top:text.top,bottom:text.bottom},box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},player:{left:player.left,right:player.right,top:player.top,bottom:player.bottom},scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,whiteSpace:style.whiteSpace};});feedbackGeometry.push({width,height,...geometry});console.log('FEEDBACK_GEOMETRY',JSON.stringify({width,height,...geometry}));await page.screenshot({path:path.join(env.artifactDir(),`podview-mood-preview-feedback-${width}.png`)});assert(geometry.text.left>=geometry.player.left-1&&geometry.text.right<=geometry.player.right+1&&geometry.text.top>=geometry.player.top-1&&geometry.text.bottom<=geometry.player.bottom+1,`feedback text stays in player at ${width}`);assert(geometry.scrollWidth<=geometry.clientWidth+1,`feedback is not horizontally clipped at ${width}`);}let persisted=null,mirrored=false,moodLogged=false;for(let attempt=0;attempt<21;attempt++){let after=0;for(let pageIndex=0;pageIndex<8;pageIndex++){const response=await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after);if(response.status()===429)break;assert.equal(response.status(),200);const body=await response.json();persisted=body.records.find(item=>item.row.stage==='control_intent'&&item.row.code==='renewal_readonly'&&item.row.requestRef===renewalRef)||persisted;if(!body.hasMore)break;after=body.nextAfter;}const lines=serverLog.split('\n');moodLogged=lines.some(line=>line.includes('mood_result ')&&line.includes('response=full')&&line.includes('trace_ref='+renewalRef));mirrored=!!persisted&&lines.some(line=>line.includes('client_diagnostics source=client ')&&line.includes('seq='+persisted.row.seq+' ')&&line.includes('requestRef='+renewalRef+' ')&&line.includes('code=renewal_readonly'));if(persisted&&moodLogged&&mirrored)break;if(attempt<20)await sleep(3000);}assert(persisted,'readonly terminal durably stored');assert(moodLogged,'original owner full response correlated before local preview fixture');assert(mirrored,'stored terminal mirrored once to owner log');const previewProof={outcome:'PASS',bundleSHA,explicitPreviewFeedback:true,visible:true,noNewAction:true,paused:true,readTraceRef:renewalRef,ownerResponse:'full',fixtureResponse:'preview',durableTerminal:true,serverMirror:true,feedbackGeometry,pageErrors:errors};await fs.writeFile(path.join(env.artifactDir(),'podview-mood-preview-feedback.json'),JSON.stringify(previewProof,null,2));console.log(JSON.stringify(previewProof));return;}
   if(holdPlayback){
    try{
     await Promise.race([playlistHold.stale,sleep(10000).then(()=>{throw Error('No held playback transition');})]);
     await page.waitForFunction(title=>document.querySelector('#track-name')?.textContent===title,second.name,{timeout:8000});
     await page.waitForFunction(()=>document.querySelector('#cover')?.getAttribute('src')?.includes('kitchen'),undefined,{timeout:4000});
     await page.screenshot({path:path.join(env.artifactDir(),'podview-playlist-during-old-read.png')});
    }finally{playlistHold.release();}
   }
   for(let n=0;(await state()).selections.length<2;n++){if(n>150)throw Error('second explicit mood selection has no native effect');await sleep(100);}
   await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveSelection?.feedback?.settlementStatus==='confirmed'&&h.liveMedia?.playback?.state==='playing'&&h.liveMedia.playback.item?.name==='Isoleret sang 12'&&!h.liveControls?.musicIntentPending&&!h.liveSelection.pending;},undefined,{timeout:15000});
   const repeated=await state();if(holdPlayback)await page.locator('#track-name').filter({hasText:'Isoleret sang 12'}).waitFor({state:'visible',timeout:15000});assert.equal(repeated.selections.length,2);assert.equal(repeated.selections[1].uri,second.uri);assert.notEqual(repeated.selections[1].requestId,repeated.selections[0].requestId);assert.deepEqual(repeated.writes.map(row=>row.action),['play_context','pause','play_context']);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,2);assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-after-second-selection.png')});const repeatProof={outcome:'PASS',bundleSHA,repeatMood:true,firstObserved:true,pauseObserved:true,secondDistinctPlaylistObserved:true,effects:repeated.writes.map(row=>row.action),oneEffectPerInput:true,pageErrors:errors};await fs.writeFile(path.join(env.artifactDir(),'podview-mood-repeat.json'),JSON.stringify(repeatProof,null,2));console.log(JSON.stringify(repeatProof));
   if(holdPlayback){
    await playlistHold.remove();
    await page.locator('[data-collection="recent"]').tap();
    const recent=page.locator('#result-list button.result').filter({hasText:'Katalogsang 13'});
    await recent.waitFor({state:'visible',timeout:15000});
    const recentHold=await holdOldItem('Isoleret sang 13');
    try{
     await recent.tap();
     await Promise.race([recentHold.stale,sleep(10000).then(()=>{throw Error('No held Hør igen playback transition');})]);
     await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent==='Katalogsang 13',undefined,{timeout:8000});
     await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-during-old-read.png')});
    }finally{recentHold.release();}
    await page.locator('#track-name').filter({hasText:'Isoleret sang 13'}).waitFor({state:'visible',timeout:15000});
    assert.deepEqual((await state()).writes.map(row=>row.action),['play_context','pause','play_context','play_track']);
    await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-after-switch.png')});
   }
  }
  console.log(JSON.stringify({outcome:'PASS',coldContext:true,rejectSetup,prepares:prepares.length,commits:commits.length,pageErrors:errors}));return;
 }
 await env.openOverview(page);
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="top"]').tap();
 const rows=page.locator('#result-list button.result');
 await rows.filter({hasText:'Katalogsang 11'}).waitFor({state:'visible',timeout:15000});
 // Passive bounded CI evidence only: no method wrapping, synthetic events or upload.
 await page.evaluate(()=>{const ids=new WeakMap(),scopes=new Map(),events=[],mutations=[];let serial=0;const id=node=>{if(!node)return null;if(!ids.has(node))ids.set(node,++serial);return ids.get(node);},scope=h=>{const s=h?.liveSnapshot,key=JSON.stringify([s?.bootId,s?.roomId,s?.capabilities?.musicRead,s?.capabilities?.musicSelection,s?.mediaRoomBindings]);if(!scopes.has(key))scopes.set(key,scopes.size+1);return scopes.get(key);},save=(list,row)=>{list.push(row);if(list.length>100)list.shift();};for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click'])document.addEventListener(type,event=>{const h=document.querySelector('pv-widget-host'),v=h?.liveSelection,c=h?.liveCatalogue,e=c?.entries?.get(c.key()),point=event.changedTouches?.[0]||event,b=event.target.closest?.('#result-list button.result');save(events,{type,at:performance.now(),target:id(event.target),button:id(b),x:point.clientX??null,y:point.clientY??null,disabled:b?.disabled??null,connected:b?.isConnected??null,scope:scope(h),focus:h?.state?.focus,pending:v?.pending,used:v?.used,musicPending:!!h?.liveControls?.musicIntentPending,settlement:v?.feedback?.settlementStatus,selectionSpent:e?.selectionSpent,selectionConfirmed:e?.selectionConfirmed});},true);new MutationObserver(records=>{for(const record of records)if(record.type==='childList')save(mutations,{at:performance.now(),parent:id(record.target),added:[...record.addedNodes].map(id),removed:[...record.removedNodes].map(id)});else if(record.type==='attributes')save(mutations,{at:performance.now(),target:id(record.target),attribute:record.attributeName,oldValue:record.oldValue,value:record.target.getAttribute(record.attributeName)});}).observe(document.querySelector('#result-list'),{childList:true,subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['disabled','hidden','inert','aria-disabled']});window.selectionCiEvidence={events,mutations};});
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
 // A voice answer must not revoke an unchanged music queue (A12/K7).
 const queueBeforeVoice=await page.locator('#queue').innerText();
 await page.request.post(base+'/lab/state',{data:{unrelatedVoiceTurn:'s1:unrelated-answer'}});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.turnId==='s1:unrelated-answer',undefined,{timeout:10000});
 assert.equal(await page.locator('#queue').innerText(),queueBeforeVoice,'unrelated voice keeps queue content');
 assert.equal(await queueRow.isEnabled(),true,'unrelated voice keeps queue selectable');
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
 }catch(error){if(page){try{const evidence=await page.locator('pv-widget-host').evaluate(async h=>{const t=h.liveTransport,records=[];for(const row of t?.diagnostics?.().records||[]){let requestRef;if(row.requestId){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.requestId));requestRef=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16);}records.push({seq:row.seq,atMs:row.atMs,generation:row.generation,stage:row.stage,code:row.code,domain:row.domain,endpoint:row.endpoint,current:row.current,...(requestRef?{requestRef}:{})});}const v=h.liveSelection,c=h.liveCatalogue,e=c?.entries?.get(c.key());return {events:window.selectionCiEvidence?.events||[],mutations:window.selectionCiEvidence?.mutations||[],records,dropped:t?.diagnosticDropped,scope:{focus:h.state?.focus,connected:t?.connected,generation:t?.generation,feedback:v?.feedback?.settlementStatus,pending:v?.pending,used:v?.used,musicPending:!!h.liveControls?.musicIntentPending,entry:e?{selectionSpent:e.selectionSpent,selectionExpired:e.selectionExpired,selectionUnavailable:e.selectionUnavailable,actionDispatched:e.actionDispatched,selectionConfirmed:e.selectionConfirmed,selectionSettlementStatus:e.selectionSettlementStatus}:null}};});await fs.writeFile(path.join(env.artifactDir(),'podview-music-selection-failure-evidence.json'),JSON.stringify(evidence,null,2));}catch(evidenceError){console.error('selection evidence unavailable',evidenceError.message);}console.log('failureState',JSON.stringify({service:await state(),responses,actions,ui:await page.locator('body').innerText(),selection:await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,account:h.liveMedia?.account,capabilities:h.liveSnapshot?.capabilities,feedback:h.liveSelection?.feedback&&{message:h.liveSelection.feedback.message,outcome:h.liveSelection.feedback.outcome},queueStatus:h.liveMedia?.queueControls?.status,note:h.liveSelection?.note?.textContent,offer:h.liveSelection?.offer}))}));await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection-failure.png')})}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
