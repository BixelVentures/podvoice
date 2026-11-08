'use strict';
// Packaged UI → real Python selection/queue brokers → stateful inert native service.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const holdPlayback=process.env.MUSIC_HOLD_PLAYBACK==='1';
const loseSelectionReceipt = process.env.MUSIC_UNKNOWN_AFTER_COMMIT === '1';
const queueColdTail = process.env.MUSIC_QUEUE_INTENTS === 'cold-tail';
const queueIntentDuringRefresh = process.env.MUSIC_QUEUE_INTENTS === 'refresh' || queueColdTail;
const queueUnknownUnchanged = process.env.MUSIC_QUEUE_INTENTS === 'unknown-unchanged';
const queueUnknown = process.env.MUSIC_QUEUE_INTENTS === 'unknown' || queueUnknownUnchanged;
const queueIntents = process.env.MUSIC_QUEUE_INTENTS === '1' || queueIntentDuringRefresh || queueUnknown;
const queueIdentity=process.env.MUSIC_QUEUE_IDENTITY_TEST==='1';
const accountRollover=process.env.MUSIC_ACCOUNT_ROLLOVER_TEST==='1';
const queueJourney = queueIdentity || process.env.MUSIC_QUEUE_JOURNEY === '1' || queueIntents;
const defaultSpeakerProof=process.env.MUSIC_DEFAULT_SPEAKER_PROOF==='1';
const discoveryLoading=process.env.MUSIC_DISCOVERY_LOADING_TEST==='1';
const discoveryRevisit=process.env.MUSIC_DISCOVERY_LOADING_TEST==='revisit';
const discoveryCover=process.env.MUSIC_DISCOVERY_LOADING_TEST==='cover';
const recentSession=process.env.MUSIC_RECENT_SESSION_TEST==='1';
const documentScope=process.env.MUSIC_DOCUMENT_SCOPE_TEST==='1';
const voiceJourney=process.env.MUSIC_VOICE_JOURNEY_TEST==='1';
const voiceLongSession=voiceJourney&&process.env.MUSIC_LONG_SESSION==='1';
const cold=defaultSpeakerProof||process.env.MUSIC_COLD_CONTEXT==='1',rejectSetup=process.env.MUSIC_COLD_REJECT==='1',repeatMood=process.env.MUSIC_REPEAT_MOOD==='1',previewRenew=process.env.MUSIC_PREVIEW_RENEW==='1',holdMood=process.env.MUSIC_HOLD_MOOD==='1';
const port=Number(process.env.MUSIC_TEST_PORT||18979),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,page,serverLog='';const errors=[],actions=[],responses=[],moodRenewals=[];let bundleSHA,cssSHA;
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
async function defaultSpeakerJourney(){
 const viewport={width:1194,height:834},controls=[];
 const record=surface=>surface.on('request',request=>{
  if(request.method()==='POST'&&/\/(control|music)\/.*actions$/.test(new URL(request.url()).pathname)){
   controls.push(request.postDataJSON()?.action);
  }
 });
 const modal=surface=>surface.locator('#rooms');
 const row=(surface,name)=>modal(surface).locator('#room-options button').filter({hasText:name});
 const open=async surface=>{
  await surface.locator('#output').tap();
  await modal(surface).waitFor({state:'visible'});
  await row(surface,'Køkkenalrum HomePod').waitFor({state:'visible'});
 };
 await page.setViewportSize(viewport);
 record(page);
 await env.openOverview(page);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.readState==='idle',
  undefined,{timeout:15000});
 await open(page);
 const kitchen=row(page,'Køkkenalrum HomePod'),bedroom=row(page,'Soveværelse');
 assert.equal(await kitchen.getAttribute('aria-pressed'),'true');
 assert.equal(await kitchen.locator('.target-status').innerText(),'Valgt');
 assert.equal(await bedroom.getAttribute('aria-pressed'),'false');
 assert.equal(await modal(page).locator('#room-options button[aria-pressed="true"]').count(),1);
 assert.equal((await state()).state,'no_active_playback');
 assert.deepEqual((await state()).writes,[]);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-speaker-default-idle.png')});

 await page.close();
 assert.equal((await (await fetch(base+'/lab/state',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({externalOutput:'bedroom',externalPlaybackState:'playing'}),
 })).json()).room,'bedroom');
 page=await browser.newPage({hasTouch:true,viewport});
 record(page);
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.waitForFunction(()=>{
  const h=document.querySelector('pv-widget-host'),p=h?.liveMedia?.playback;
  return p?.state==='playing'&&p.roomBinding?.nativeRoomId==='bedroom'
   &&document.querySelector('#output')?.textContent.includes('Soveværelse');
 },undefined,{timeout:15000});
 await open(page);
 const active=row(page,'Soveværelse'),standard=row(page,'Køkkenalrum HomePod');
 assert.equal(await active.getAttribute('aria-pressed'),'true');
 assert.equal(await active.locator('.target-status').innerText(),'Aktuelt output');
 assert.equal(await standard.getAttribute('aria-pressed'),'false');
 assert.equal(await standard.locator('.target-status').innerText(),'Standardrum');
 assert.equal(await modal(page).locator('#room-options button[aria-pressed="true"]').count(),1);
 const after=await state();
 assert.equal(after.room,'bedroom');
 assert.equal(after.state,'playing');
 assert.deepEqual(after.writes,[]);
 assert.deepEqual(controls,[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'H4',bundleSHA,viewport,touch:true,
  idleDefault:'Køkkenalrum HomePod',alreadyPlayingOutput:'Soveværelse',
  controlPosts:controls.length,inertOwnerWrites:after.writes.length,inertNativeService:true,pageErrors:errors};
 await fs.writeFile(path.join(env.artifactDir(),'podview-speaker-default-proof.json'),JSON.stringify(proof,null,2));
 await page.screenshot({path:path.join(env.artifactDir(),'podview-speaker-existing-output.png')});
 console.log(JSON.stringify(proof));
}
async function documentScopeJourney(){
 const peer=await page.context().newPage();
 const localOnly=surface=>surface.route('**/*',route=>
  new URL(route.request().url()).origin===base?route.continue():route.abort());
 const discovery=async(surface,kind)=>{
  const reply=surface.waitForResponse(response=>{
   const url=new URL(response.url());
   return url.pathname==='/view/api/music'&&url.searchParams.get('kind')===kind&&response.ok();
  });
  await surface.locator('[data-collection="'+kind+'"]').tap();
  const response=await reply, body=await response.json();
  assert.equal(body.candidateSet.sourceKind,kind);
  return {source:body.candidateSet,document:response.request().headers()['x-podview-music-document']};
 };
 await localOnly(peer);
 peer.on('pageerror',error=>errors.push(error.message));
 try{
  await peer.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
  await env.openOverview(peer);
  const snapshots=await Promise.all([page,peer].map(async surface=>
   (await surface.request.get(base+'/view/api/snapshot?room=kitchen')).json()));
  assert.deepEqual(snapshots.map(s=>[s.bootId,s.roomId,s.admission.kind]),[
   [snapshots[0].bootId,'kitchen','ha_ingress'],[snapshots[0].bootId,'kitchen','ha_ingress'],
  ]);
  await page.locator('#home-music').tap();
  const first=await discovery(page,'recent');
  const row=page.locator('#result-list button.result').filter({hasText:'Katalogsang 11'});
  await row.waitFor({state:'visible'});
  await peer.locator('#home-music').tap();
  const other=await discovery(peer,'recent');
  assert.notEqual(first.source.candidateSetId,other.source.candidateSetId);
  assert.deepEqual((await state()).writes,[],'both reads leave the inert owner untouched');

  const setupReply=page.waitForResponse(r=>new URL(r.url()).pathname==='/view/api/music/selection/setup');
  const actionReply=page.waitForResponse(r=>
   new URL(r.url()).pathname==='/view/api/music/selection/actions').catch(error=>error);
  await page.bringToFront();
  await row.tap();
  const setup=await setupReply;
  assert.equal(setup.request().postDataJSON().candidateSetId,first.source.candidateSetId,
   'A uses its original candidate after B reads');
  assert.equal(setup.request().headers()['x-podview-music-document'],first.document);
  assert.equal(setup.status(),200,await setup.text());
  assert.match(first.document,/^[a-f0-9]{32}$/);
  assert.match(other.document,/^[a-f0-9]{32}$/);
  assert.notEqual(first.document,other.document);
  const action=await actionReply;
  if(action instanceof Error)throw action;
  assert.equal(action.request().headers()['x-podview-music-document'],first.document);
  assert.equal((await action.json()).outcome,'accepted');
  await page.locator('#track-name').filter({hasText:'Katalogsang 11'}).waitFor({state:'visible'});
  assert.deepEqual((await state()).writes.map(row=>row.action),['play_track']);

  const replacement=await discovery(page,'top');
  assert.equal(replacement.document,first.document);
  assert.notEqual(replacement.source.candidateSetId,first.source.candidateSetId);
  const stale=await page.request.post(setup.url(),{
   headers:{'X-PodView-Request':'1','X-PodView-Music-Document':first.document},
   data:setup.request().postDataJSON(),
  });
  assert.equal(stale.status(),409);
  assert.equal((await stale.json()).error,'stale_music_selection');
  assert.equal(actions.filter(action=>action.url.endsWith('/music/selection/actions')).length,1);
  assert.deepEqual((await state()).writes.map(row=>row.action),['play_track']);
  assert.deepEqual(errors,[]);
  if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
  assert.match(cssSHA,/^[a-f0-9]{64}$/);
  const proof={outcome:'PASS',bundleSHA,cssSHA,sharedHAIngress:true,documents:2,
   firstCandidateSurvivesSecondRead:true,sameDocumentReplacementRejectsOldSetup:true,
   inertPlaybackEffects:1,inertNativeService:true,pageErrors:errors};
  await fs.writeFile(path.join(env.artifactDir(),'podview-music-document-scope.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
 }finally{await peer.close();}
}
async function recentSessionJourney(){
 const title='Coming Home',coverUrl='https://i.scdn.co/image/InertComingHome';
 const uri='spotify:track:'+String(11).padStart(22,'0');
 const coverRoutes=surface=>surface.route('https://**/*',route=>{
  if(route.request().url()!==coverUrl)return route.abort();
  return route.fulfill({contentType:'image/svg+xml',
   body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>'});
 });
 await coverRoutes(page);
 let recentReads=0;
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.pathname==='/view/api/music'&&url.searchParams.get('kind')==='recent')recentReads++;
 });
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="recent"]').tap();
 const row=page.locator('#result-list button.result').filter({hasText:title});
 const rowArt=row.locator('img.result-art[src="'+coverUrl+'"]:not([data-content-transition])');
 await rowArt.waitFor({state:'visible',timeout:15000});
 await rowArt.evaluate(image=>image.decode());
 const list=page.locator('#result-list'),feed=page.locator('#music-response');
 const visibleRows=()=>list.locator('button[data-content-state=ready] h2').allTextContents();
 const scrollTop=()=>feed.evaluate(node=>node.scrollTop);
 const initialRows=await visibleRows();
 assert.equal(initialRows.length,5);
 const priorButtons=list.locator('button[data-content-state=ready]');
 assert.ok(await priorButtons.evaluateAll(buttons=>buttons.every(button=>!button.disabled)));
 await list.evaluate(node=>{
  const prior=new Set(node.querySelectorAll('button[data-content-state=ready]'));
  node.expansionDisabledWrites=0;
  new MutationObserver(changes=>{
   node.expansionDisabledWrites+=changes.filter(change=>prior.has(change.target)).length;
  }).observe(node,{subtree:true,attributes:true,attributeFilter:['disabled']});
 });
 let releasePlayback,markPlaybackHeld;
 const playbackGate=new Promise(resolve=>{releasePlayback=resolve;});
 const playbackHeld=new Promise(resolve=>{markPlaybackHeld=resolve;});
 const playbackRoute=async route=>{
  if(new URL(route.request().url()).searchParams.get('kind')!=='playback')return route.fallback();
  markPlaybackHeld();await playbackGate;await route.continue();
 };
 await page.route('**/view/api/music?**',playbackRoute);
 try{
  await page.locator('pv-widget-host').evaluate(host=>{void host.liveMedia.refresh({immediate:true});});
  await Promise.race([playbackHeld,sleep(10000).then(()=>{throw Error('background playback read was not held');})]);
  await page.getByRole('button',{name:'Se tidligere',exact:true}).tap();
  await list.getByText('Katalogsang 20',{exact:true}).waitFor();
  assert.equal(recentReads,1,'expansion reuses the admitted source');
  assert.equal(await list.evaluate(node=>node.expansionDisabledWrites),0,'the existing five rows stay enabled throughout expansion');
  assert.ok(await priorButtons.evaluateAll(buttons=>buttons.every(button=>!button.disabled)));
 }finally{releasePlayback();await page.unroute('**/view/api/music?**',playbackRoute);}
 const expandedRows=await visibleRows();
 assert.equal(expandedRows.length,10);
 assert.deepEqual(expandedRows.slice(0,5),initialRows);
 await env.touchScroll(page,feed,{dy:320});
 const retainedScroll=await scrollTop();
 assert.ok(retainedScroll>30,`touch scroll must move the expanded list (${retainedScroll})`);
 await page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/view/api/music'&&url.searchParams.get('kind')==='playback'&&response.ok();
 },{timeout:10000});
 await page.waitForFunction(()=>!document.querySelector('pv-widget-host')?.liveMedia?.pending);
 assert.equal(await scrollTop(),retainedScroll,'passive playback read preserves the expanded scroll position');
 assert.deepEqual(await visibleRows(),expandedRows);
 for(const [tab,title] of [['top','Coming Home'],['recent','Katalogsang 20']]){
  await page.locator('[data-collection='+tab+']').evaluate(button=>button.focus({preventScroll:true}));
  await page.keyboard.press('Enter');
  await list.getByText(title,{exact:true}).waitFor();
 }
 await page.waitForFunction(()=>!document.querySelector('pv-widget-host')?.liveCatalogue?.pendingRead);
 assert.deepEqual(await visibleRows(),expandedRows,'returning to Hør igen retains the expanded list');
 assert.equal(await scrollTop(),retainedScroll,'returning to Hør igen restores its scroll position');
 await row.scrollIntoViewIfNeeded();
 let release,markHeld;
 const gate=new Promise(resolve=>{release=resolve;});
 const held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music/selection/actions',async route=>{
  markHeld();
  await gate;
  await route.continue();
 },{times:1});
 await row.evaluate((node,{title,coverUrl})=>{
  node.addEventListener('click',event=>{
   if(!event.isTrusted)return;
   const start=performance.now(),probe=window.recentPaint={titleMs:null,coverMs:null};
   const measure=()=>{
    const now=performance.now()-start,cover=document.querySelector('#cover');
    if(probe.titleMs===null&&document.querySelector('#track-name')?.textContent===title)probe.titleMs=now;
    if(probe.coverMs===null&&cover?.getAttribute('src')===coverUrl&&cover.naturalWidth>0)probe.coverMs=now;
    if(now<3000&&(probe.titleMs===null||probe.coverMs===null))requestAnimationFrame(measure);
   };
   requestAnimationFrame(measure);
  },{once:true});
 },{title,coverUrl});
 let firstPaint;
 try{
  await row.tap();
  await Promise.race([held,sleep(8000).then(()=>{throw Error('selection action was not held');})]);
  await page.waitForFunction(()=>Number.isFinite(window.recentPaint?.titleMs)
   &&Number.isFinite(window.recentPaint?.coverMs),undefined,{timeout:5000});
  firstPaint=await page.evaluate(()=>window.recentPaint);
  assert(firstPaint.titleMs<300&&firstPaint.coverMs<300,JSON.stringify(firstPaint));
  const oldRead=await page.waitForResponse(response=>{
   const url=new URL(response.url());
   return url.pathname==='/view/api/music'&&url.searchParams.get('kind')==='playback'&&response.ok();
  },{timeout:10000});
  assert.notEqual((await oldRead.json()).data.playback.item.uri,uri);
  assert.deepEqual((await state()).writes,[]);
  assert.equal(await page.locator('#track-name').textContent(),title);
  assert.equal(await page.locator('#cover').getAttribute('src'),coverUrl);
  assert.equal(await page.locator('#player-room').textContent(),'Køkkenalrum HomePod');
  assert.match(await page.locator('#player-state').textContent(),/Starter afspilning/);
  assert.equal(await row.getAttribute('aria-busy'),'true');
  assert.equal(await list.locator('button[aria-busy="true"]').count(),1,'only the selected row shows pending');
  assert.equal(await list.getAttribute('aria-busy'),'false','selection does not make the catalogue busy');
  assert.deepEqual(await list.locator('button .result-play').evaluateAll(plays=>plays.flatMap(play=>
   getComputedStyle(play,'::before').content==='none'?[]:[play.closest('button').querySelector('h2').textContent])),[title]);
  assert.deepEqual(await visibleRows(),expandedRows,'held selection preserves every displayed row');
  await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-pending-player.png')});
 }finally{release();}
 const observed=(surface,phase,after=0)=>surface.waitForFunction(({uri,title,phase,after})=>{
  const host=document.querySelector('pv-widget-host'),playback=host?.liveMedia?.playback;
  const b=document.querySelector('#play-pause');
  return Date.now()>=after&&playback?.roomBinding?.validUntil*1000>Date.now()
   &&playback.roomBinding.nativeRoomId==='native-room'&&playback.roomBinding.nativeHomepodId==='42'
   &&playback.item?.uri===uri&&playback.state===phase&&b&&!b.disabled&&!host.liveControls.musicIntentPending
   &&!host.liveSelection.pending&&document.querySelector('#track-name')?.textContent===title;
 },{uri,title,phase,after},{timeout:15000});
 await observed(page,'playing');
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')
  ?.liveSelection?.feedback?.settlementStatus==='confirmed');
 const initialDeadline=await page.locator('pv-widget-host').evaluate(host=>
  host.liveMedia.playback.roomBinding.validUntil*1000);
 const baseline=await state();
 assert.deepEqual(baseline.writes.map(row=>row.action),['play_track']);
 assert.equal(baseline.selections[0].uri,uri);
 await observed(page,'playing',initialDeadline);
 assert.deepEqual((await state()).writes,baseline.writes,'passive renewal does not replay the selection');
 await page.request.post(base+'/lab/state',{data:{delayMs:600}});
 const toggle=page.locator('#play-pause'),labels=[];
 for(let index=0;index<3;index++){
  await toggle.tap();
  labels.push(await toggle.getAttribute('aria-label'));
  assert.equal(await toggle.isEnabled(),true);
 }
 assert.deepEqual(labels,['Fortsæt musikken','Sæt musik på pause','Fortsæt musikken']);
 await observed(page,'paused');
 const afterBurst=await state();
 assert.deepEqual(afterBurst.writes.map(row=>row.action),['play_track','pause','resume','pause']);
 await page.request.post(base+'/lab/state',{data:{delayMs:0}});
 const storageState=await page.context().storageState();
 await page.close();
 page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800},storageState});
 page.on('pageerror',error=>errors.push(error.message));
 await coverRoutes(page);
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await observed(page,'paused');
 const reopenedCover=page.locator('#cover[src="'+coverUrl+'"]');
 await reopenedCover.waitFor({state:'visible'});
 await reopenedCover.evaluate(image=>image.decode());
 assert.deepEqual((await state()).writes,afterBurst.writes,'reopening does not replay the selection or controls');
 await page.locator('#play-pause').tap();
 await observed(page,'playing');
 const volume=page.locator('#volume');
 await env.touchRange(page,volume,55);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.controls
  ?.volume?.base_percent===55);
 const final=await state();
 assert.equal(final.selections.length,1);
 assert.deepEqual(final.writes.map(row=>row.action),['play_track','pause','resume','pause','resume','volume']);
 assert.equal(final.volume,55);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-reopened-controls.png')});
 const expandedReadAges=[];
 let expandedRecentReads=0,explicitTargetReads=0,expandedChoicePressed=false;
 await page.route('**/view/api/music?**',async route=>{
  const url=new URL(route.request().url());
  if(!expandedChoicePressed||url.searchParams.get('kind')!=='targets'||!url.searchParams.has('account'))return route.fallback();
  if(++explicitTargetReads!==1)return route.continue();
  const response=await route.fetch(),body=await response.json();
  assert.ok(response.ok()&&body.ok&&body.roomBinding);
  // Only this fixture response crosses the boundary in transit.
  const observedAtMs=Date.now()-9950;
  body.observedAt=observedAtMs/1000;
  await sleep(100);
  assert.ok(Date.now()-observedAtMs>=10000);
  await route.fulfill({response,json:body});
 });
 page.on('response',async response=>{
  const url=new URL(response.url()),kind=url.searchParams.get('kind');
  if(url.pathname!=='/view/api/music'||!['targets','recent'].includes(kind)||!response.ok())return;
  const body=await response.json();
  if(kind==='targets'&&body.coverage==='account_targets'&&Number.isFinite(body.observedAt)){
   expandedReadAges.push(Date.now()-body.observedAt*1000);
  }
  if(kind==='recent'&&body.candidateSet)expandedRecentReads++;
 });
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="recent"]').tap();
 await page.getByRole('button',{name:'Se tidligere',exact:true}).tap();
 expandedChoicePressed=true;
 await page.locator('#result-list button.result').filter({hasText:'Katalogsang 20'}).tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSelection?.feedback?.settlementStatus==='confirmed');
 const expandedChoice=await state();
 assert.deepEqual(expandedChoice.writes.slice(final.writes.length).map(row=>row.action),['play_track']);
 assert.equal(expandedChoice.selections.at(-1).uri,'spotify:track:'+String(20).padStart(22,'0'));
 assert.equal(expandedRecentReads,2,'initial sample and one exact choice renewal');
 assert.equal(explicitTargetReads,2,'exactly one read-only refresh after the expired response');
 assert.equal(expandedReadAges.filter(age=>age>=10000).length,1);
 assert.ok(expandedReadAges.at(-1)>=0&&expandedReadAges.at(-1)<10000,
  `last target read must carry a usable original observation: ${expandedReadAges}`);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',stories:['F10','F11','A9','A10-renewal-reopen'],bundleSHA,firstPaint,
  expandedRecentRows:expandedRows.length,retainedScroll,singlePendingRow:true,rowsEnabledDuringExpansion:true,expandedChoiceEffects:1,expandedRecentReads,expandedReadAges,explicitTargetReads,
  previousItemReadWithSelectedTitleAndCover:true,selectionEffects:1,realLeaseRenewal:true,rapidLabels:labels,
  touchEffectsAfterReopen:['resume','volume'],inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-recent-session-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function voiceQueueJourney(){
 const step=async step=>{
  const response=await page.request.post(base+'/lab/voice-journey',{data:{step}});
  assert.equal(response.status(),200,await response.text());
  return response.json();
 };
 const observe=async(song,phase)=>(await page.waitForFunction(({song,phase})=>{
  const host=document.querySelector('pv-widget-host'),value=host.liveMedia?.playback;
  return value?.state===phase&&document.querySelector('#track-name')?.textContent===`Isoleret sang ${song}`
   &&value.config_entry_id==='account'&&value.roomBinding?.nativeRoomId==='native-room'
   &&value.roomBinding?.nativeHomepodId==='42'&&value.target?.id==='device'&&value.roomBinding.bindingId;
 },{song,phase},{timeout:12000})).jsonValue();
 await observe(1,'paused');
 assert.equal((await step('wake')).active,true);
 const source=await (await page.request.get(base+'/view/api/music?room=kitchen&kind=recent&account=account')).json();
 assert.equal(source.ok,true,JSON.stringify(source));
 const candidate=source.candidateSet;
 assert(candidate);
 const offer=await (await page.request.post(base+'/view/api/music/selection/setup',{
  headers:{'X-PodView-Request':'1'},data:{bootId:candidate.bootId,roomId:'kitchen',candidateSetId:candidate.candidateSetId,
   candidateIds:candidate.items.map(row=>row.id),
   target:{accountId:'account',kind:'spotify_device',targetId:'device'}},
 })).json();
 assert.equal(offer.ok,true,JSON.stringify(offer));
 assert.equal((await step('choose')).accepted,true);
 assert.equal(await page.locator('#track-name').textContent(),'Isoleret sang 1','accepted voice start cannot publish playback by itself');
 const {session}=await step('observe');
 const startedBinding=await observe(11,'playing');
 await page.locator('#player-detail').tap();
 const repeated=page.locator('#queue button.queue-track[data-current="false"]').filter({hasText:'Køsang 22'});
 await repeated.nth(1).waitFor();
 assert.equal(await repeated.count(),2);
 await repeated.nth(1).tap();
 const queuedBinding=await observe(22,'playing');
 assert.notEqual(queuedBinding,startedBinding,'queue advances the observed route within the native session');
 await page.locator('#play-pause').tap();
 assert.equal(await observe(22,'paused'),queuedBinding);
 await page.locator('#play-pause').tap();
 assert.equal(await observe(22,'playing'),queuedBinding);
 let renewal;
 if(voiceLongSession){
  const baseline=await state(),documentStartedAt=await page.evaluate(()=>performance.timeOrigin);
  const startedAt=performance.now(),samples=[];
  const readCount=value=>value.serviceReads.filter(row=>row.path.endsWith('/get_playback_snapshot')).length;
  const initialReads=readCount(baseline);
  console.log('A12→A10: waiting 600 s with the same voice-started session');
  for(let minute=1;minute<=10;minute++){
   const target=minute*60000;
   while(performance.now()-startedAt<target)await sleep(Math.ceil(target-(performance.now()-startedAt)));
   const value=await state(),reads=readCount(value);
   assert(reads>(samples.at(-1)?.reads??initialReads),`minute ${minute}: ordinary playback reads continue`);
   assert.deepEqual(value.writes,baseline.writes,'background reads never send an effect');
   assert.equal(value.observedNativeSession,session);
   assert.equal(value.state,'playing');assert.equal(value.song,22);
   samples.push({minute,elapsedMs:Math.floor(performance.now()-startedAt),reads});
   console.log('voiceQueueRenewalMinute',JSON.stringify(samples.at(-1)));
  }
  const realElapsedMs=Math.floor(performance.now()-startedAt);
  if(await page.locator('#photo-view').isVisible())await env.openOverview(page);
  assert.equal(await page.evaluate(()=>performance.timeOrigin),documentStartedAt);
  assert.equal(await observe(22,'playing'),queuedBinding);
  await page.locator('#play-pause').tap();
  assert.equal(await observe(22,'paused'),queuedBinding);
  await page.locator('#next').tap();
  await observe(23,'paused');
  const volume=page.locator('#volume');
  await env.touchRange(page,volume,55);
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.controls
   ?.volume?.base_percent===55);
  await page.locator('#play-pause').tap();
  await observe(23,'playing');
  assert.equal(await page.evaluate(()=>performance.timeOrigin),documentStartedAt);
  renewal={realElapsedMs,initialReads,samples,sameDocument:true,touchAfterDwell:['pause','next','volume','resume']};
 }
 const final=await state();
 assert.equal(final.observedNativeSession,session);
 assert.equal(final.queueSelections.length,1);
 assert.equal(final.queueSelections[0].index,1);
 const expectedActions=['play_track','play_queue_occurrence','pause','resume',...(renewal?.touchAfterDwell??[])];
 assert.deepEqual(final.writes.map(row=>row.action),expectedActions);
 const effects=final.nativeCalls.filter(row=>['start_room_selected_content','control_room_queue','control_room_playback','control_room_volume'].includes(row.service));
 assert.deepEqual(effects.map(row=>row.args.command_sequence),expectedActions.map((_,index)=>index+3));
 assert.ok(effects.every(({args})=>args.config_entry_id==='account'&&args.target_id==='device'
  &&args.room_id==='native-room'&&args.homepod_id==='42'&&args.owner_epoch===effects[0].args.owner_epoch));
 assert.ok(effects.slice(1).every(({args})=>args.native.session_id===session
  &&args.route.session_epoch===effects[1].args.route.session_epoch));
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:renewal?'A12→A10':'A12',bundleSHA,session,actualThinAndToolRouter:true,
  independentVoiceObservation:true,selectedSecondRepeatedOccurrence:true,freshBindingAfterQueue:true,
  touchPauseResume:true,inertNativeService:true,...(renewal?{renewal,cssSHA,effects:effects.map(({service,args})=>({service,
   action:args.action,sequence:args.command_sequence,account:args.config_entry_id,room:args.room_id,homepod:args.homepod_id,
   ownerEpoch:args.owner_epoch,nativeSession:args.native?.session_id,sessionEpoch:args.route?.session_epoch}))}:{})};
 const name=renewal?'podview-voice-queue-long-session-proof':'podview-voice-queue-proof';
 await fs.writeFile(path.join(env.artifactDir(),name+'.json'),JSON.stringify(proof,null,2));
 await page.screenshot({path:path.join(env.artifactDir(),name+'.png')});
 console.log(JSON.stringify(proof));
}
async function discoveryLoadingJourney(){
 const endpoint='**/view/api/music?**';
 const tabs=[
  {kind:'mood',entry:'#home-music',kits:['hero','listrow','listrow']},
  {kind:'feeling',kits:['card','card','card']},
  {kind:'top',kits:['listrow','listrow','listrow'],title:'Katalogsang 11'},
  {kind:'recent',kits:Array(5).fill('listrow'),title:'Katalogsang 15'}
 ];
 const results=[];
 for(const {kind,entry,kits,title} of tabs){
  const button=page.locator(entry||`[data-collection=${kind}]`);
  let release,markHeld;
  const gate=new Promise(resolve=>{release=resolve;}),held=new Promise(resolve=>{markHeld=resolve;});
  let reads=0;
  const hold=async route=>{
   const url=new URL(route.request().url());
   if(url.searchParams.get('kind')!==kind||++reads!==1)return route.continue();
   try{
    const response=await route.fetch();
    markHeld({status:response.status(),body:await response.json()});
    await gate;
    await route.fulfill({response});
   }catch(error){markHeld({error});throw error;}
  };
  await page.route(endpoint,hold);
  try{
   await button.evaluate((target,kind)=>{
    target.addEventListener('click',event=>{
     if(!event.isTrusted)return;
     const started=performance.now(),frames=[];
     window.f5Frames=frames;
     const visible=node=>node?.checkVisibility({visibilityProperty:true,opacityProperty:true})===true;
     const geometry=(node,origin)=>{
      const {x,y,width,height}=node.getBoundingClientRect(),parent=origin.getBoundingClientRect();
      return [x-parent.x,y-parent.y,width,height].map(Math.round);
     };
     let readyFrames=0;
     function sample(){
      const scene=document.getElementById('music-response'),list=document.getElementById('result-list');
      if(visible(scene)&&document.querySelector('#music-refinements [aria-pressed=true]')?.dataset.collection===kind){
       const rows=[...list.querySelectorAll(':scope > button.result')].filter(visible).map(row=>({
        state:row.dataset.contentState,kit:row.dataset.kit,rect:geometry(row,list),
        cover:geometry(row.querySelector('.result-art'),row),title:row.querySelector('h2').textContent,
        hidden:row.getAttribute('aria-hidden')==='true',disabled:row.disabled,
        fallback:row.querySelector('.result-art').classList.contains('live-art-fallback'),
        titleLines:Math.round(row.querySelector('h2').getBoundingClientRect().height
         /parseFloat(getComputedStyle(row.querySelector('h2')).lineHeight))
       }));
       const busy=list.getAttribute('aria-busy')==='true';
       frames.push({ms:performance.now()-started,busy,empty:visible(document.getElementById('empty')),
        list:geometry(list,scene),rows});
       if(!busy&&rows.length&&rows.every(row=>row.state==='ready'))readyFrames++;
      }
      if(readyFrames<4&&performance.now()-started<10000)requestAnimationFrame(sample);
     }
     requestAnimationFrame(sample);
    },{capture:true,once:true});
   },kind);
   await button.tap();
   const source=await Promise.race([held,sleep(10000).then(()=>{throw Error(`${kind} read not held`);})]);
   if(source.error)throw source.error;
   assert.equal(source.status,200,kind);
   assert.equal(source.body.ok,true,kind);
   assert.ok(source.body.data.tracks.length>=kits.length,kind);
   if(kind==='recent')assert.equal(source.body.data.tracks.length,7);
   await page.waitForFunction(()=>window.f5Frames?.length>=3,undefined,{timeout:3500});
   const before=await page.evaluate(()=>window.f5Frames.length);
   release();
   await page.waitForFunction(()=>window.f5Frames?.filter(frame=>!frame.busy&&frame.rows.length
    &&frame.rows.every(row=>row.state==='ready')).length>=4,undefined,{timeout:5000});
   const frames=await page.evaluate(()=>window.f5Frames);
   const loading=frames[0],ready=frames.find(frame=>!frame.busy);
   assert(loading.busy,`${kind}: first visible frame is the cold loading layout`);
   assert(ready,`${kind}: never rendered the actual response`);
   const shape=frame=>({list:frame.list,rows:frame.rows.map(({kit,rect,cover})=>({kit,rect,cover}))});
   assert.deepEqual(loading.rows.map(row=>row.kit),kits,kind);
   assert(ready.rows.every(row=>row.title.trim()),`${kind}: ready rows show actual titles`);
   if(title)assert(ready.rows.some(row=>row.title===title),kind);
   const titles=ready.rows.map(row=>row.title);
   assert.deepEqual(titles,source.body.data.tracks.slice(0,kits.length)
    .map(track=>track.themeTitle||track.name),kind);
   if(kind==='mood'){
    assert.equal(ready.rows[0].titleLines,2,'exercise the approved two-line Hero title');
    assert(ready.rows.slice(1).some(row=>row.fallback),'exercise a real alternative without a decoded cover');
   }
   let completed=false;
   for(const [index,frame] of frames.entries()){
    assert(!frame.empty,`${kind}: empty state flashed in frame ${index}`);
    assert.deepEqual(shape(frame),shape(ready),`${kind}: geometry changed in frame ${index}`);
    if(frame.busy){
     assert(!completed,`${kind}: loading returned after ready`);
     assert(frame.rows.every(row=>row.state==='pending'&&row.hidden&&row.disabled&&!row.title),
      `${kind}: loading rows must be neutral, inaccessible and inert`);
    }else{
     assert(index>=before,`${kind}: ready before source release`);
     completed=true;
     assert(frame.rows.every(row=>row.state==='ready'&&!row.hidden),`${kind}: loading row survived ready`);
     assert.deepEqual(frame.rows.map(row=>row.title),titles,kind);
    }
   }
   assert.equal(reads,1,`${kind}: exactly one cold catalogue read`);
   results.push({kind,reads,frameCount:frames.length,heldFrames:before,loading,ready});
  }finally{
   release();
   await page.unroute(endpoint,hold);
  }
 }
 assert.deepEqual((await state()).writes,[]);
 assert.deepEqual(actions.filter(action=>!action.url.endsWith('/queue/offer')),[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 assert(cssSHA,'hash the stylesheet actually served during the cold journey');
 if(process.env.MUSIC_EXPECTED_CSS)assert.equal(cssSHA,process.env.MUSIC_EXPECTED_CSS);
 const proof={outcome:'PASS',story:'F5',bundleSHA,cssSHA,results,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-loading-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function discoveryRevisitJourney(){
 const recent=page.locator('[data-collection=recent]'),top=page.locator('[data-collection=top]');
 const ready=page.locator('#result-list > button.result[data-option-id]');
 const entry=page.locator('#home-music');
 const cardIdentity=nodes=>nodes.map(row=>({id:row.dataset.optionId,title:row.querySelector('h2').textContent}));
 let warmHomeEntry;
 let reads=0,releaseFirst,markHeld;
 const gate=new Promise(resolve=>{releaseFirst=resolve;}),held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music?**',async route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.get('kind')!=='recent'||++reads!==1)return route.continue();
  const response=await route.fetch();
  assert.equal((await response.json()).ok,true);
  markHeld();
  await gate;
  await route.fulfill({response}).catch(()=>{}); // An abandoned browser fetch may already be cancelled.
 });
 await entry.tap();
 await recent.tap();
 try{
  await Promise.race([held,sleep(10000).then(()=>{throw Error('first recent read not held');})]);
  await top.tap();
  await ready.filter({hasText:'Katalogsang 11'}).waitFor({timeout:10000});
  assert.equal(await ready.count(),3,'the other tab completed while the first read was held');
  await recent.tap();
  await page.waitForFunction(()=>document.querySelector('#result-list')?.getAttribute('aria-busy')==='true'
   ||document.querySelectorAll('#result-list > button[data-option-id]').length===5,undefined,{timeout:3000});
  await ready.filter({hasText:'Katalogsang 15'}).waitFor({timeout:10000});
  assert.equal(reads,2,'returning to an interrupted initial tab starts exactly one new read');
  assert.equal(await ready.count(),5);
  await top.tap();
  assert.equal(await ready.count(),3,'returning to a populated tab retains its rows');
  assert.equal(await page.locator('#result-list [data-empty=true]').count(),0);

  const known=await ready.evaluateAll(cardIdentity);
  await page.locator('#header-title-action').tap();
  await entry.waitFor({state:'visible'});
  await entry.evaluate(button=>button.addEventListener('click',event=>{
   if(!event.isTrusted)return;
   const started=performance.now();
   const visible=node=>node?.checkVisibility({visibilityProperty:true,opacityProperty:true})===true;
   const sample=()=>{
    const scene=document.getElementById('music-response');
    const elapsedMs=performance.now()-started;
    if(visible(scene)){
     const list=document.getElementById('result-list');
     const rows=[...list.querySelectorAll('button.result[data-option-id]')].filter(visible)
      .map(row=>({id:row.dataset.optionId,title:row.querySelector('h2').textContent}));
     window.f1HomeEntry={elapsedMs,rows,
      tab:document.querySelector('#music-refinements [aria-pressed=true]')?.dataset.collection,
      loading:list.getAttribute('aria-busy')==='true'
       ||[...list.querySelectorAll('[data-empty=true],[data-content-state=pending]')].some(visible),
      spinner:visible(document.querySelector('#music-refresh[data-refresh-state=pending]'))
       ||[...list.querySelectorAll('button[aria-busy=true]')].some(visible),
      empty:visible(document.getElementById('empty'))};
    }else if(elapsedMs<2000)requestAnimationFrame(sample);
   };
   requestAnimationFrame(sample);
  },{capture:true,once:true}));
  await entry.tap();
  await page.waitForFunction(()=>window.f1HomeEntry,undefined,{timeout:2500});
  warmHomeEntry=await page.evaluate(()=>window.f1HomeEntry);
  assert(warmHomeEntry.elapsedMs<300,`known Find musik entry took ${warmHomeEntry.elapsedMs} ms`);
  assert.deepEqual(warmHomeEntry.rows,known,'first visible frame must contain the same known suggestions');
  assert.equal(warmHomeEntry.tab,'top');
  assert.equal(warmHomeEntry.loading||warmHomeEntry.spinner||warmHomeEntry.empty,false);
  assert.equal(reads,2,'reopening the known tab does not restart the abandoned recent read');
 }finally{releaseFirst();}
 assert.deepEqual((await state()).writes,[]);
 assert.deepEqual(actions.filter(action=>!action.url.endsWith('/queue/offer')),[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'F5',bundleSHA,revisitedAbandonedFirstRead:true,reads,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-revisit-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
 const entryProof={outcome:'PASS',story:'F1',bundleSHA,warmHomeEntry,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-home-entry-proof.json'),
  JSON.stringify(entryProof,null,2));
 console.log(JSON.stringify(entryProof));
}
async function discoveryCardHeight(){
 const sizes=[{width:1270,height:1060},{width:1280,height:800}];
 const layout=()=>page.locator('#result-list').evaluate(list=>{
  const group=list.getBoundingClientRect();
  const cards=[...list.querySelectorAll('button[data-content-state=ready]')].map(card=>{
   const {left,top,right,bottom,height}=card.getBoundingClientRect();
   return {left,top,right,bottom,height};
  });
  return {height:group.height,bottom:group.bottom,cards};
 });
 await page.emulateMedia({reducedMotion:'reduce'});
 const mood=[];
 for(const size of sizes){await page.setViewportSize(size);mood.push(await layout());}
 await page.locator('[data-collection=feeling]').tap();
 await page.locator('#result-list button[data-kit=card][data-content-state=ready]').first().waitFor();
 for(const [index,size] of sizes.entries()){
  await page.setViewportSize(size);
  const {cards:[hero,first,second],bottom}=mood[index],vibe=await layout();
  const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1,`${size.width}×${size.height}: ${label} (${a} vs ${b})`);
  near(hero.height,vibe.cards[0].height,'the day Hero and Vibe card have the same visible height');
  near(hero.bottom,bottom,'the Hero fits the day result area');
  near(first.height,second.height,'the two alternatives have equal height');
  near(second.bottom,hero.bottom,'the two columns end together');
  near(first.top,hero.top,'the two columns start together');
  assert.ok(hero.right<first.left,'the Hero is left of the alternatives');
 }
}
async function discoveryVibeJourney(){
 const expected=[['Jazz & lounge','Hiphop & R&B','Pop & dance'],['Afslappet pop','Deep house','Jazzklassikere'],['Lounge','90’er-techno','Festmusik']];
 const rows=page.locator('#result-list button[data-kit=card][data-content-state=ready]');
 const refresh=page.getByRole('button',{name:'Flere vibes',exact:true});
 const track=await page.locator('#track-name').textContent();
 const snapshot=()=>rows.evaluateAll(cards=>cards.map(card=>({
  direction:card.querySelector('h2').textContent,playlist:card.querySelector('p').textContent,
  uri:card.musicCard.uri,height:card.getBoundingClientRect().height,
 })));
 const seen=new Set();
 for(const [index,directions] of expected.entries()){
  await rows.locator('h2').filter({hasText:directions[0]}).waitFor();
  const current=await snapshot();
  assert.deepEqual(current.map(card=>card.direction),directions);
  for(const card of current){
   assert.match(card.playlist,/^Kold jazz [a-f0-9]{4}$/,'card names the actual inert source playlist');
   assert.match(card.uri,/^spotify:playlist:[a-f0-9]{22}$/);
   assert.ok(!seen.has(card.uri),'an earlier Vibe page cannot repeat a playlist');
   seen.add(card.uri);
  }
  if(index===expected.length-1)break;
  let markHeld,releaseRead;
  const held=new Promise(resolve=>{markHeld=resolve;}),gate=new Promise(resolve=>{releaseRead=resolve;});
  const isRefresh=url=>url.pathname==='/view/api/music'&&url.searchParams.get('kind')==='feeling'&&url.searchParams.get('refresh')==='1';
  await page.route(isRefresh,async route=>{
   const response=await route.fetch();
   markHeld();
   await gate;
   await route.fulfill({response}).catch(error=>{if(index!==1)throw error;});
  },{times:1});
  try{
   await refresh.tap();
   await Promise.race([held,sleep(10000).then(()=>{throw Error('Vibe refresh not held');})]);
   assert.deepEqual(await snapshot(),current,'current Vibe cards and height survive a held refresh');
   assert.equal(await page.locator('#result-list [data-content-transition]').count(),0,'reduced motion has no content overlay');
   if(index===1)await page.locator('[data-collection=top]').tap();
  }finally{releaseRead();}
  if(index===1){
   await page.locator('#result-list button[data-content-state=ready]').filter({hasText:'Katalogsang 11'}).waitFor();
   await page.locator('[data-collection=feeling]').tap();
  }
 }
 assert.equal(seen.size,9);
 assert.equal(await refresh.isDisabled(),true,'three pages exhaust the existing refresh control');
 assert.equal(await page.locator('#track-name').textContent(),track,'the player is retained while browsing Vibe');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-vibe-third-set.png')});
 console.log('PASS Vibe: three ordered sets, nine unique playlists, stable pending cards, interrupted final page recovery and exhausted refresh');
}
async function discoveryCoverJourney(){
 const coverUrl='https://i.scdn.co/image/InertRecentCover';
 const failedCoverUrl='https://i.scdn.co/image/InertFailedMoodCover';
 const externalRequests=[],themeArtRequests=[],themeArtResponses=[];
 await page.route('https://**/*',route=>{
  const url=route.request().url();
  externalRequests.push(url);
  if(url===failedCoverUrl)return route.fulfill({status:503});
  if(url!==coverUrl)return route.abort();
  return route.fulfill({contentType:'image/svg+xml',
   body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>'});
 });
 await page.route('**/view/theme-art/**',route=>{
  themeArtRequests.push(new URL(route.request().url()).pathname);
  return route.fulfill({status:503});
 });
 page.on('response',response=>{
  const {pathname}=new URL(response.url());
  if(pathname.startsWith('/view/theme-art/'))themeArtResponses.push({pathname,status:response.status()});
 });
 const moodResponse=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/view/api/music'&&url.searchParams.get('kind')==='mood';
 });
 let reads=0,releaseRefresh,markHeld;
 const gate=new Promise(resolve=>{releaseRefresh=resolve;}),held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('kind')!=='recent'||++reads!==2)return route.continue();
  const response=await route.fetch(),body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.data.tracks[0].artwork,undefined,'the actual refresh returns no cover for the same item');
  markHeld();
  await gate;
  await route.fulfill({response});
 });
 await page.locator('#home-music').tap();
 const mood=await (await moodResponse).json();
 assert.equal(mood.ok,true);
 const themes=Object.fromEntries(mood.data.tracks.map(track=>[track.themeId,track]));
 assert.equal(themes.cooking.artwork?.url,failedCoverUrl);
 assert.match(themes.cooking.themeArt,/^theme-art\/cooking\/[a-f0-9]{64}\.webp$/);
 assert.equal(themes.italian.themeArt,'assets/italian.png','legacy-policy art is excluded');
 assert.equal(themes.calm.themeArt,'assets/lake.png','exhausted budget leaves the canonical local asset');
 const localIllustrations={
  'Musik til madlavningen':'assets/kitchen.webp',
  'En italiensk aften':'assets/italian.webp',
  'En rolig stund':'assets/lake.webp',
 };
 for(const [title,src] of Object.entries(localIllustrations)){
  const art=page.locator('#result-list button.result').filter({hasText:title})
   .locator(`img.result-art[src="${src}"]:not([data-content-transition])`);
  await art.waitFor({state:'visible',timeout:15000});
  await art.evaluate(img=>img.decode());
  assert.ok(await art.evaluate(img=>img.naturalWidth>0));
 }
 await page.screenshot({path:path.join(env.artifactDir(),'podview-discovery-local-illustrations.png')});
 await discoveryCardHeight();
 await discoveryVibeJourney();
 await page.locator('[data-collection=recent]').tap();
 const list=page.locator('#result-list'),row=list.locator('button.result').filter({hasText:'Katalogsang 11'});
 const image=row.locator('img.result-art:not([data-content-transition])');
 await page.waitForFunction(url=>[...document.querySelectorAll('#result-list img.result-art')]
  .some(image=>image.getAttribute('src')===url&&image.naturalWidth>0),coverUrl,{timeout:15000});
 const initial=await row.elementHandle();
 await row.evaluate(element=>{
  element.coverTransitions=0;
  new MutationObserver(records=>{
   for(const record of records)for(const node of record.addedNodes){
    if(node.nodeType===Node.ELEMENT_NODE&&node.matches('img[data-content-transition]'))element.coverTransitions++;
   }
  }).observe(element,{childList:true});
 });
 assert.equal(await image.getAttribute('src'),coverUrl);
 await page.getByRole('button',{name:'Se tidligere',exact:true}).tap();
 await list.locator('button.result').filter({hasText:'Katalogsang 17'}).waitFor({timeout:15000});
 assert.equal(reads,1,'expanded cards already belong to the admitted sample');
 // Exercise the existing explicit source read separately from local expansion.
 await page.locator('pv-widget-host').evaluate(host=>host.liveCatalogue.beginRead('recent','refresh'));
 try{
  await Promise.race([held,sleep(10000).then(()=>{throw Error('cover refresh not held');})]);
  assert.equal(await image.getAttribute('src'),coverUrl);
 }finally{releaseRefresh();}
 await page.waitForFunction(()=>document.querySelector('#result-list')?.getAttribute('aria-busy')==='false');
 assert.equal(await row.evaluate((current,original)=>current===original,initial),true);
 assert.equal(await image.getAttribute('src'),coverUrl,'missing metadata never resets the accepted cover');
 assert.equal(await image.evaluate(img=>img.naturalWidth),64);
 assert.equal(await row.evaluate(element=>element.coverTransitions),0,'unchanged visible cover never crossfades to itself');
 assert.equal(reads,2);
 assert.deepEqual((await state()).writes,[]);
 assert.deepEqual(actions.filter(action=>!action.url.endsWith('/queue/offer')),[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'F9',bundleSHA,retainedCover:true,retainedWithoutCrossfade:true,recentExpanded:7,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-cover-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
 const service=await state();
 assert.deepEqual(externalRequests,[failedCoverUrl,coverUrl]);
 assert.deepEqual(themeArtRequests,['/view/'+themes.cooking.themeArt]);
 assert.deepEqual(themeArtResponses,[{pathname:'/view/'+themes.cooking.themeArt,status:503}]);
 assert.ok(service.retiredThemeArt);
 assert(!themeArtRequests.includes('/view/'+service.retiredThemeArt));
 assert.deepEqual(service.imageProviderCalls,[]);
 const fallbackProof={outcome:'PASS',story:'F12',bundleSHA,localIllustrations,
  spotifyFailureRequests:1,cachedGraphicRetrievalFailures:themeArtRequests.length,
  retiredPolicyRequests:0,imageProviderDispatches:service.imageProviderCalls.length,
  retainedCover:proof.retainedCover,inertCatalogue:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-cover-fallback-proof.json'),
  JSON.stringify(fallbackProof,null,2));
 console.log(JSON.stringify(fallbackProof));
 await discoveryGeneratedCover(failedCoverUrl,themes.cooking.themeArt);
}
async function discoveryGeneratedCover(failedCoverUrl,asset){
 const surface=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 const assetUrl=new URL('/view/'+asset,base).href;
 const requests=[],receipts=[],actionPosts=[],pageErrors=[];
 let releaseSpotify;
 const spotifyGate=new Promise(resolve=>{releaseSpotify=resolve;});
 try{
  await surface.route('**/*',async route=>{
   const url=route.request().url();
   if(url===failedCoverUrl){
    await spotifyGate;
    return route.fulfill({status:503});
   }
   return new URL(url).origin===base?route.continue():route.abort();
  });
  surface.on('pageerror',error=>pageErrors.push(error.message));
  surface.on('request',request=>{
   const url=request.url(),pathname=new URL(url).pathname;
   if(new URL(url).origin!==base||pathname.startsWith('/view/theme-art/'))requests.push(url);
   if(request.method()==='POST'&&pathname.startsWith('/view/api/')
    &&pathname!=='/view/api/music/queue/offer')actionPosts.push(pathname);
  });
  surface.on('response',response=>{
   if(response.url()===failedCoverUrl||response.url()===assetUrl){
    receipts.push({url:response.url(),status:response.status()});
   }
  });
  await surface.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
  const snapshot=await (await surface.request.get(base+'/view/api/snapshot')).json();
  assert.equal(snapshot.admission.kind,'ha_ingress');
  await env.openOverview(surface);
  const spotifyRequest=surface.waitForRequest(request=>request.url()===failedCoverUrl);
  const graphicResponse=surface.waitForResponse(response=>response.url()===assetUrl);
  await surface.locator('#home-music').tap();
  await spotifyRequest;
  const row=surface.locator('#result-list button.result').filter({hasText:'Musik til madlavningen'});
  const image=row.locator('img.result-art:not([data-content-transition])');
  await image.waitFor();
  const originalRow=await row.elementHandle(),originalImage=await image.elementHandle();
  assert.deepEqual(requests,[failedCoverUrl],'generated art must wait for Spotify failure');
  releaseSpotify();
  const response=await graphicResponse;
  assert.equal(response.status(),200);
  assert.equal(response.headers()['content-type'],'image/webp');
  assert.equal(response.headers()['x-podview-art-provenance'],'generated-theme-illustration');
  const digest=createHash('sha256').update(await response.body()).digest('hex');
  assert.equal(path.basename(asset,'.webp'),digest);
  assert.equal(response.headers().etag,`"${digest}"`);
  await surface.waitForFunction(url=>[...document.querySelectorAll('#result-list img.result-art')]
    .some(image=>image.currentSrc===url&&image.naturalWidth>0
    &&getComputedStyle(image).opacity==='1'
    &&image.checkVisibility({opacityProperty:true,visibilityProperty:true})),assetUrl);
  const decoded=await image.evaluate(async image=>{
   await image.decode();
   return {src:image.currentSrc,width:image.naturalWidth,height:image.naturalHeight,
    visible:image.checkVisibility({opacityProperty:true,visibilityProperty:true})};
  });
  assert.deepEqual(decoded,{src:assetUrl,width:1024,height:1024,visible:true});
  assert(await row.evaluate((current,previous)=>current===previous,originalRow));
  assert(await image.evaluate((current,previous)=>current===previous,originalImage));
  assert.deepEqual(requests,[failedCoverUrl,assetUrl]);
  assert.deepEqual(receipts,[{url:failedCoverUrl,status:503},{url:assetUrl,status:200}]);
  assert.deepEqual(actionPosts,[]);
  assert.deepEqual(pageErrors,[]);
  const service=await state();
  assert.deepEqual(service.writes,[]);
  assert.deepEqual(service.imageProviderCalls,[]);
  const proof={outcome:'PASS',story:'F9',bundleSHA,artworkSHA:digest,
   spotifyStatus:503,generatedAssetStatus:200,decoded:{width:decoded.width,height:decoded.height},
   sameRowAndImage:true,imageProviderDispatches:0,actionPosts:0,inertCatalogue:true};
  await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-generated-cover-proof.json'),
   JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
 }finally{
  releaseSpotify();
  await surface.close();
 }
}
async function accountRolloverJourney(){
 const host=page.locator('pv-widget-host');
 const accounts=page.locator('pv-choice-list[aria-label="Musikkonto"]');
 const queue=page.locator('#queue');
 const rows=queue.locator('button.queue-track[data-current="false"]');
 const names=()=>rows.locator('.queue-copy strong').allTextContents();
 const playback=()=>host.evaluate(h=>{
  const {account,playback:p}=h.liveMedia;
  return {account,observedAccount:p?.config_entry_id,owner:p?.owner_epoch,title:p?.item?.name,
   room:p?.roomBinding?.nativeRoomId,homepod:p?.roomBinding?.nativeHomepodId,
   binding:p?.roomBinding?.bindingId};
 });
 const endpoint='**/view/api/music/queue/offer';
 let release,markHeld;
 const gate=new Promise(resolve=>{release=resolve;});
 const held=new Promise(resolve=>{markHeld=resolve;});
 const capture=async route=>{
  if(route.request().postDataJSON()?.accountId!=='account')return route.continue();
  const requestedAt=Date.now();
  const response=await route.fetch();
  markHeld({body:await response.json(),requestedAt});
  await gate;
  await route.fulfill({response});
 };
 await page.route(endpoint,capture);
 let timeout,lateAgeMs,lateTTL;
 try{
  await page.locator('#home-music').tap();
  await accounts.getByRole('button',{name:'Testkonto A',exact:true}).tap();
  const {body:late,requestedAt}=await Promise.race([held,new Promise((_,reject)=>{
   timeout=setTimeout(()=>reject(Error('Account A queue was never held')),10000);
  })]);
  const a=await playback();
  assert.equal(a.account,'account');
  assert.equal(a.observedAccount,'account');
  assert.equal(a.title,'Isoleret sang 10');
  assert.equal(late.ok,true);
  assert.equal(late.accountId,'account');
  assert.equal(late.expectedBindingId,a.binding);
  assert.deepEqual(late.items.map(item=>item.title),['Køsang 11','Køsang 12']);

  await accounts.getByRole('button',{name:'Testkonto B',exact:true}).tap();
  await page.waitForFunction(()=>document.getElementById('track-name')?.textContent==='Isoleret sang 30');
  await page.locator('#track').tap();
  await rows.filter({hasText:'Køsang 31'}).waitFor({state:'visible'});
  const b=await playback();
  assert.equal(b.account,'account-b');
  assert.equal(b.observedAccount,'account-b');
  assert.notEqual(b.owner,a.owner);
  assert.deepEqual([a.room,a.homepod,b.room,b.homepod],['native-room','42','native-room','42']);
  assert.deepEqual(await names(),['Køsang 31','Køsang 32']);
  const current=await host.evaluate(h=>{
   window.g5CurrentOffer=h.liveMedia.queueControls.offer;
   return {account:window.g5CurrentOffer.accountId,
    seq:h.liveTransport.diagnostics().records.at(-1)?.seq??0};
  });
  assert.equal(current.account,'account-b');
  lateTTL=late.expiresInMs;
  release();
  await page.waitForFunction(seq=>document.querySelector('pv-widget-host')?.liveTransport
   .diagnostics().records.some(row=>row.seq>seq&&row.stage==='queue_read'
    &&row.code==='superseded'&&row.current===false),
  current.seq,{timeout:5000});
  lateAgeMs=Date.now()-requestedAt;
  assert(lateAgeMs<lateTTL,'Browser must discard A before the original offer expires');
  assert.deepEqual(await playback(),b);
  assert(await host.evaluate(h=>h.liveMedia.queueControls.offer===window.g5CurrentOffer));
  assert.deepEqual(await names(),['Køsang 31','Køsang 32']);
  assert.equal(await rows.and(queue.locator('button:enabled')).count(),2);
  assert.deepEqual((await state()).writes,[]);
  assert.deepEqual(actions.filter(row=>!row.url.endsWith('/queue/offer')),[]);
 }finally{clearTimeout(timeout);release();await page.unroute(endpoint,capture);}

 await rows.filter({hasText:'Køsang 31'}).tap();
 await page.waitForFunction(()=>document.getElementById('track-name')?.textContent==='Isoleret sang 31');
 const owner=await state();
 const attempts=owner.nativeCalls.filter(row=>['prepare_room_queue','control_room_queue'].includes(row.service));
 assert.deepEqual(attempts.map(({service,args})=>[service,args.config_entry_id,args.room_id,args.homepod_id]),[
  ['prepare_room_queue','account-b','native-room','42'],
  ['control_room_queue','account-b','native-room','42'],
 ]);
 assert.deepEqual(owner.writes.map(row=>row.song),[31]);
 assert.equal(actions.filter(row=>row.url.endsWith('/queue/actions')).length,1);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'G5',bundleSHA,lateAgeMs,lateTTL,oldQueueDiscarded:true,
  fixedOutput:['native-room','42'],oldAccountEffects:0,newAccountEffects:1,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-account-rollover-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function queueIdentityJourney(){
 const queue=page.locator('#queue'),rows=queue.locator('button.queue-track[data-current="false"]');
 const track=page.locator('#track'),host=page.locator('pv-widget-host');
 const endpoint='**/view/api/music/queue/offer';
 const mutate=async condition=>assert((await page.request.post(base+'/lab/queue',{data:{condition}})).ok());
 const status=expected=>page.waitForFunction(expected=>
  document.querySelector('#queue').dataset.status===expected,expected,{timeout:12000});
 const names=()=>rows.locator('.queue-copy strong').allTextContents();
 const observed=(song,room,homepod)=>page.waitForFunction(({song,room,homepod})=>{
  const playback=document.querySelector('pv-widget-host')?.liveMedia?.playback;
  return playback?.roomBinding?.nativeRoomId===room&&playback.roomBinding.nativeHomepodId===homepod
   &&playback.state==='playing'&&playback.item?.name===`Isoleret sang ${song}`
   &&document.getElementById('track-name').textContent===playback.item.name;
 },{song,room,homepod},{timeout:12000});

 await track.tap();
 await status('ready');
 assert.deepEqual(await names(),['Køsang 22','Køsang 22','Køsang 23','Køsang 24']);
 const oldBinding=await host.evaluate(h=>h.liveMedia.playback.roomBinding.bindingId);
 const first=await host.evaluate(h=>h.liveMedia.queueControls.offer.items.slice(0,2));
 assert.equal(first[0].uri,first[1].uri);
 assert.notEqual(first[0].id,first[1].id);
 const chosen=rows.nth(1);
 await chosen.evaluate(row=>row.addEventListener('click',event=>{
  if(!event.isTrusted)return;
  const start=performance.now();
  const clickAtMs=performance.timeOrigin+start;
  const sample=()=>{
   const playback=document.querySelector('pv-widget-host')?.liveMedia?.playback;
   const title=document.getElementById('track-name');
   const elapsed=performance.now()-start;
   if(playback?.state==='playing'&&playback.item?.name==='Isoleret sang 22'
    &&playback.roomBinding?.nativeHomepodId==='42'
    &&title?.checkVisibility({visibilityProperty:true,opacityProperty:true})
    &&title.textContent==='Isoleret sang 22'){
    window.queueSelectionTiming={clickAtMs,observedTitleMs:elapsed};
   }else if(elapsed<2000)requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
 },{capture:true,once:true}));
 await chosen.tap();
 await observed(22,'native-room','42');
 await page.waitForFunction(()=>window.queueSelectionTiming,undefined,{timeout:3000});
 await status('ready');
 assert.deepEqual(await names(),['Køsang 23','Køsang 24']);
 const afterChoice=await state();
 const selectionTiming=await page.evaluate(()=>window.queueSelectionTiming);
 const ownerEffectMs=afterChoice.queueEffectAtMs-selectionTiming.clickAtMs;
 assert(ownerEffectMs>=0&&ownerEffectMs<=selectionTiming.observedTitleMs,JSON.stringify({
  ownerEffectMs,observedTitleMs:selectionTiming.observedTitleMs,
 }));
 assert(selectionTiming.observedTitleMs<1500,'K3 inert owner observation exceeded 1.5 s');
 assert.deepEqual(afterChoice.queueSelections.map(({index,song})=>({index,song})),[{index:1,song:22}]);
 const commits=afterChoice.nativeCalls.filter(row=>row.service==='control_room_queue');
 assert.deepEqual(commits.map(({args})=>[args.args.occurrence_id,args.room_id,args.homepod_id]),
  [[first[1].id,'native-room','42']]);

 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 let markHeld;
 const held=new Promise(resolve=>{markHeld=resolve;});
 const capture=async route=>{
  const response=await route.fetch();
  markHeld({body:await response.json(),receivedAt:Date.now()});
  await gate;
  await route.fulfill({response});
 };
 await page.route(endpoint,capture,{times:1});
 let timeout,knownQueueTiming;
 try{
  await page.locator('#header-title-action').tap();
  await track.evaluate(button=>button.addEventListener('click',event=>{
   if(!event.isTrusted)return;
   const start=performance.now();
   let frames=0;
   const visibility={visibilityProperty:true,opacityProperty:true};
   const sample=()=>{
    frames++;
    const queue=document.getElementById('queue');
    const elapsed=performance.now()-start;
    if(queue?.checkVisibility(visibility)){
     const rows=[...queue.querySelectorAll('button.queue-track[data-current="false"]')]
      .filter(row=>row.checkVisibility(visibility)).map(row=>row.querySelector('.queue-copy strong').textContent);
     const placeholder=!!queue.querySelector('.queue-empty')?.checkVisibility(visibility);
     window.knownQueueTiming={firstVisibleFrameMs:elapsed,frames,rows,placeholder};
    }else if(elapsed<1500)requestAnimationFrame(sample);
   };
   requestAnimationFrame(sample);
  },{capture:true,once:true}));
  await track.tap();
  const {body:late,receivedAt}=await Promise.race([held,new Promise((_,reject)=>{
   timeout=setTimeout(()=>reject(Error('old queue response not held')),10000);
  })]);
  assert.equal(late.ok,true);
  assert.equal(late.expectedBindingId,oldBinding);
  assert.deepEqual(late.items.map(item=>item.name??item.title),['Køsang 23','Køsang 24']);
  await page.waitForFunction(()=>window.knownQueueTiming,undefined,{timeout:3000});
  knownQueueTiming=await page.evaluate(()=>window.knownQueueTiming);
  assert.deepEqual(knownQueueTiming.rows,['Køsang 23','Køsang 24'],'K1 first visible frame uses retained rows');
  assert.equal(knownQueueTiming.placeholder,false);
  assert(knownQueueTiming.firstVisibleFrameMs<300,'K1 known queue did not appear within 300 ms');
  await mutate('replace-session');
  await observed(30,'bedroom','43');
  await status('ready');
  assert.deepEqual(await names(),['Køsang 31','Køsang 32']);
  const current=await host.evaluate(h=>{
   const media=h.liveMedia;
   window.replacementQueue=media.queueControls.offer;
   return {bindingId:media.playback.roomBinding.bindingId,
    diagnosticSequence:h.liveTransport.diagnostics().records.at(-1)?.seq??0};
  });
  assert.notEqual(current.bindingId,oldBinding);
  assert(Date.now()-receivedAt<late.expiresInMs,'old offer is delivered before its original lease expires');
  release();
  await page.waitForFunction(sequence=>document.querySelector('pv-widget-host')?.liveTransport
   .diagnostics().records.some(row=>row.seq>sequence&&row.stage==='queue_read'&&row.code==='superseded'),
   current.diagnosticSequence,{timeout:5000});
  assert(await host.evaluate(h=>h.liveMedia.queueControls.offer===window.replacementQueue));
  assert.deepEqual(await names(),['Køsang 31','Køsang 32']);
  assert.deepEqual((await state()).writes,afterChoice.writes,'late old response cannot send a command');
 }finally{clearTimeout(timeout);release();}

 const queueUnavailable=page.waitForResponse(response=>
  new URL(response.url()).pathname==='/view/api/music/queue/offer',{timeout:12000});
 await mutate('autoplay-no-queue');
 await observed(32,'bedroom','43');
 assert.equal((await (await queueUnavailable).json()).error,'queue_offer_unavailable');
 await status('stale');
 assert.equal(await page.locator('#queue-title').innerText(),'Sidst kendte kø');
 assert.deepEqual(await names(),['Køsang 31','Køsang 32'],'only previously known rows are retained');
 assert.equal(await rows.and(queue.locator('button:enabled')).count(),0,'last-known rows grant no actions');
 assert.equal(await queue.locator('button[data-current="true"] strong').innerText(),'Isoleret sang 32');
 assert.match(await page.locator('#detail-toggle').getAttribute('aria-label'),/pause/i);
 await mutate('autoplay-with-queue');
 await observed(33,'bedroom','43');
 await status('ready');
 assert.deepEqual(await names(),['Køsang 34','Køsang 35']);
 const final=await state();
 assert.deepEqual(final.writes,afterChoice.writes,'owner autoplay and both queue reads send no new action');
 assert.equal(actions.filter(row=>row.url.endsWith('/actions')).length,1);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',stories:['K1','K3','K6','K4'],bundleSHA,
  knownQueue:{...knownQueueTiming,responseHeld:true},
  queueSelection:{ownerEffectMs,observedTitleMs:selectionTiming.observedTitleMs,occurrenceIndex:1},
  sameTrackOccurrence:first[1].id,lateOldQueueDiscarded:true,noWrongTargetCommand:true,
  ownerPlaybackContinuesWithoutQueue:true,ownerUpcomingRowsRestored:true,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-queue-identity-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function queuePersistenceJourney(){
 const queue=page.locator('#queue');
 const rows=queue.locator('button.queue-track[data-current="false"]');
 const title=page.locator('#queue-title');
 const open=async()=>page.locator('#track').tap();
 const close=async()=>page.locator('#header-title-action').tap();
 const itemNames=()=>rows.locator('.queue-copy strong').allTextContents();
 const status=async expected=>page.waitForFunction(value=>document.querySelector('#queue').dataset.status===value,
  expected,{timeout:10000});
 const assertNames=async numbers=>assert.deepEqual(await itemNames(),numbers.map(number=>`Køsang ${number}`));
 const assertNoEmpty=async()=>assert.equal(await queue.locator('.queue-empty').count(),0);
 const tapPaints=[];
 async function assertTapPaint(song){
  const title=`Køsang ${song}`;
  await page.waitForFunction(title=>window.queueTapPaints.some(row=>row.title===title),title,{timeout:2000});
  const paint=await page.evaluate(title=>window.queueTapPaints.find(row=>row.title===title),title);
  assert.deepEqual(paint.spinners,[title],'new trusted touch moves the single existing spinner');
  assert(paint.elapsedMs<100,`new selection paint took ${paint.elapsedMs} ms`);
  tapPaints.push(paint);
 }
 const condition=async condition=>{
  assert.equal((await page.request.post(base+'/lab/queue',{data:{condition}})).ok(),true);
 };
 async function holdNext(endpoint,{loseReply=false}={}){
  let markEntered,release;
  const entered=new Promise(resolve=>{markEntered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const handler=async route=>{
   markEntered();
   await gate;
   if(!loseReply)return route.continue();
   if(!queueUnknownUnchanged){
    const response=await route.fetch();
    assert.equal((await response.json()).outcome,'accepted','owner applied the first choice before reply loss');
   }
   await route.fulfill({status:502,json:{error:'inert_queue_receipt_lost'}});
  };
  await page.route(`**/view/api/music/queue/${endpoint}`,handler,{times:1});
  return {wait:async()=>{
   let timer;
   try{
    await Promise.race([entered,new Promise((_,reject)=>{
     timer=setTimeout(()=>reject(Error(`queue ${endpoint} was not requested`)),10000);
    })]);
   }finally{clearTimeout(timer);}
  },release};
 }

 await open();
 await status('ready');
 await assertNames([21,22,23,24]);
 if(queueIntents)await queue.evaluate(node=>{
  window.queueTapPaints=[];
  document.addEventListener('click',event=>{
   const row=event.target.closest?.('button.queue-track[data-current="false"]');
   if(!event.isTrusted||!node.contains(row))return;
   const label=item=>item.querySelector('.queue-copy strong').textContent;
   const title=label(row),started=performance.now();
   requestAnimationFrame(()=>{
    const spinners=[...node.querySelectorAll('button.queue-track')]
     .filter(item=>getComputedStyle(item,'::after').animationName==='pv-music-play-pending')
     .map(label);
    window.queueTapPaints.push({title,elapsedMs:performance.now()-started,spinners});
   });
  },true);
 });
 const stableRow=await rows.filter({hasText:'Køsang 23'}).elementHandle();
 const sourceBefore=await state();
 const command=await holdNext('actions',{loseReply:queueUnknown});
 const postAcceptRead=queueIntentDuringRefresh?await holdNext('offer'):null;
 await queue.evaluate(node=>{
  const list={minimum:Infinity,frames:0,stopped:false};
  window.queueFrameProbe=list;
  const watch=()=>{
   if(list.stopped)return;
   const visible=[...node.querySelectorAll('button.queue-track[data-current="false"]')]
    .filter(row=>row.getClientRects().length>0).length;
   list.minimum=Math.min(list.minimum,visible);
   list.frames++;
   requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
 });
 try{
  await rows.filter({hasText:'Køsang 22'}).tap();
  await command.wait();
  await status('pending');
  await assertNames([21,22,23,24]);
  const pendingRows=rows.and(queue.locator('[aria-busy="true"]'));
  assert.deepEqual(await pendingRows.locator('.queue-copy strong').allTextContents(),['Køsang 22']);
  const spinners=await rows.evaluateAll(items=>items
   .filter(row=>getComputedStyle(row,'::after').animationName==='pv-music-play-pending')
   .map(row=>row.querySelector('.queue-copy strong').textContent));
  assert.deepEqual(spinners,['Køsang 22'],'only the tapped occurrence renders a spinner');
  await assertNoEmpty();
  assert.equal((await state()).writes.length,sourceBefore.writes.length);
  await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-selected-only.png')});
  if(queueIntents&&!queueIntentDuringRefresh){
   const second=rows.filter({hasText:'Køsang 23'});
   assert.equal(await second.isEnabled(),true,'pending queue command must not disable another row');
   await second.tap();
   await assertTapPaint(23);
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);
   assert.equal((await state()).writes.length,sourceBefore.writes.length,'second touch waits behind first');
  }
 }finally{command.release();}
 if(queueUnknown){
  await status('unknown');
  assert.equal(await queue.locator('button[aria-busy="true"]').count(),0,'UNKNOWN clears visible selection');
  assert.equal(await rows.evaluateAll(items=>items.some(
   row=>getComputedStyle(row,'::after').animationName==='pv-music-play-pending',
  )),false);
  assert.match(await page.locator('#playback-status').innerText(),/dit næste valg blev ikke sendt/);
  const unknown=await state(),priorEffects=queueUnknownUnchanged?[]:[22];
  assert.equal(unknown.writes.length,sourceBefore.writes.length+priorEffects.length);
  const initialOffers=actions.filter(row=>row.url.endsWith('/music/queue/offer')).length;
  if(queueUnknownUnchanged){
   assert.equal(unknown.sequence,sourceBefore.sequence,'the existing same-track source is current');
  }else{
   const pushed=await page.request.post(base+'/lab/state',{data:{externalPlaybackState:'playing'}});
   const {sequence}=await pushed.json();
   await page.waitForFunction(sequence=>{
    const h=document.querySelector('pv-widget-host');
    return h?.liveMedia?.playback?.poll_sequence>=sequence;
   },sequence,{timeout:10000});
   await status('ready');
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/offer')).length,initialOffers+1);
  }
  assert.equal(await queue.locator('button[aria-busy="true"]').count(),0);
  assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);
  assert.deepEqual((await state()).queueSelections.map(row=>row.song),priorEffects);
  const deliberate=rows.filter({hasText:'Køsang 24'});
  assert.equal(await deliberate.isEnabled(),true,'a new deliberate choice is possible without reload');
  await deliberate.tap();
  await page.locator('#track-name').filter({hasText:'Isoleret sang 24'}).waitFor({state:'visible',timeout:15000});
  await status('ready');
  const final=await state(),posts=actions.filter(row=>row.url.endsWith('/music/queue/actions'));
  const effectSongs=[...priorEffects,24];
  assert.deepEqual(final.queueSelections.map(row=>row.song),effectSongs);
  assert.equal(posts.length,2);
  assert.notEqual(posts[0].body.taskId,posts[1].body.taskId);
  assert.notEqual(posts[0].body.requestId,posts[1].body.requestId);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{window.queueFrameProbe.stopped=true;});
  const proof={outcome:'PASS',bundleSHA,unknownQueueReply:true,visibleSpinnerCleared:true,tapPaints,
   effectSongs,recoveryWithoutReload:true,explicitReadBeforeNewPoll:queueUnknownUnchanged,
   inertNativeService:true,pageErrors:errors};
  if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
  await fs.writeFile(path.join(env.artifactDir(),'podview-queue-unknown-proof.json'),JSON.stringify(proof,null,2));
  await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-unknown.png')});
  console.log(JSON.stringify(proof));
  return;
 }
 let secondCommand;
 if(postAcceptRead){
  try{
   await postAcceptRead.wait();
   await status('loading');
   await page.locator('#track-name').filter({hasText:'Isoleret sang 22'}).waitFor({state:'visible'});
   const second=rows.filter({hasText:'Køsang 23'});
   assert.equal(await second.isEnabled(),true,'an accepted command does not lock another row during refresh');
   if(queueColdTail)secondCommand=await holdNext('actions');
   await second.tap();
   await assertTapPaint(23);
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);
   assert.equal((await state()).writes.length,sourceBefore.writes.length+1,'second touch needs the new offer');
  }finally{postAcceptRead.release();}
 }
 if(secondCommand){
  try{
   await secondCommand.wait();
   await status('pending');
   await assertNames([21,22,23,24]);
   const third=rows.filter({hasText:'Køsang 24'});
   assert.equal(await third.isEnabled(),true,'fresh exact surviving row stays tappable with a cold tail');
   for(const removed of [21,22])assert.equal(await rows.filter({hasText:`Køsang ${removed}`}).isEnabled(),false);
   assert.equal(await rows.filter({hasText:'Køsang 23'}).getAttribute('aria-busy'),'true');
   assert.equal(await queue.getByText('Nummer i køen').count(),0,'unknown tail cannot invent a visible row');
   await third.tap();
   await assertTapPaint(24);
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,2);
   assert.equal((await state()).writes.length,sourceBefore.writes.length+1,'new touch waits behind row 23');
   await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-intents-cold-tail.png')});
  }finally{secondCommand.release();}
 }
 if(queueIntents){
  const expectedOrder=queueColdTail?[22,23,24]:[22,23];
  await page.locator('#track-name').filter({hasText:`Isoleret sang ${expectedOrder.at(-1)}`})
   .waitFor({state:'visible',timeout:15000});
  await status('ready');
  await assertNames(queueColdTail?[25]:[24]);
  const value=await state();
  const posts=actions.filter(row=>row.url.endsWith('/music/queue/actions'));
  const seenTasks=posts.map(row=>row.body.taskId),seenRequests=posts.map(row=>row.body.requestId);
  assert.equal(posts.length,expectedOrder.length);
  assert.equal(new Set(seenTasks).size,expectedOrder.length,'each later touch uses a fresh broker task');
  assert.equal(new Set(seenRequests).size,expectedOrder.length,'one identity per explicit choice');
  assert.deepEqual(value.queueSelections.map(({song,index})=>[song,index]),
   expectedOrder.map((song,index)=>[song,index===0?1:0]));
  assert.equal(value.writes.length,sourceBefore.writes.length+expectedOrder.length);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{window.queueFrameProbe.stopped=true;});
  const proof={outcome:'PASS',bundleSHA,queueIntentOrder:expectedOrder,freshTasks:seenTasks.length,queueIntentDuringRefresh,queueColdTail,
   tapPaints,fixturePreservedOpaqueOccurrenceIds:true,inertNativeService:true,pageErrors:errors};
  if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
  await fs.writeFile(path.join(env.artifactDir(),'podview-queue-intents-proof.json'),JSON.stringify(proof,null,2));
  await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-intents.png')});
  console.log(JSON.stringify(proof));
  return;
 }
 await page.locator('#track-name').filter({hasText:'Isoleret sang 22'}).waitFor({state:'visible',timeout:15000});
 await status('ready');
 await assertNames([23,24]);
 const frameProbe=await page.evaluate(()=>{
  const probe=window.queueFrameProbe;
  probe.stopped=true;
  return {minimum:probe.minimum,frames:probe.frames};
 });
 assert(frameProbe.frames>0&&frameProbe.minimum>=2,'queue never paints an empty frame while advancing');
 // This inert fixture keeps opaque IDs stable across advancement; the native owner must
 // independently prove continuity before the same node can be expected on the live route.
 assert.equal(await stableRow.evaluate(row=>row.isConnected&&row.querySelector('.queue-order').textContent==='1'),
  true,'fixture-preserved occurrence moves to the first position on the same DOM row');
 await assertNoEmpty();
 assert.equal(await queue.locator('button[aria-busy="true"]').count(),0);
 const afterChoice=await state();
 assert.deepEqual(afterChoice.queueSelections.map(({song,index})=>[song,index]),[[22,1]]);
 assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);

 // A new real queue offer fails on the service side while reopening same-session display custody.
 await condition('failed');
 const failedRead=await holdNext('offer');
 try{
  await close();
  await open();
  await failedRead.wait();
  await status('loading');
  await assertNames([23,24]);
  await assertNoEmpty();
  assert.equal(await stableRow.evaluate(row=>row.isConnected&&row.getClientRects().length>0),true);
 }finally{failedRead.release();}
 await status('error');
 await assertNames([23,24]);
 await assertNoEmpty();
 assert.equal(await title.innerText(),'Køen kunne ikke hentes');
 assert.equal(await stableRow.evaluate(row=>row.isConnected),true);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-refresh-failed.png')});

 // A separate actual owner observation with zero upcoming rows is authoritative empty.
 await condition('empty');
 const emptyRead=await holdNext('offer');
 try{
  await close();
  await open();
  await emptyRead.wait();
  await status('loading');
  await assertNames([23,24]);
  await assertNoEmpty();
 }finally{emptyRead.release();}
 await status('ready');
 await assertNames([]);
 assert.equal(await queue.locator('.queue-empty').innerText(),'Ingen sange i køen.');
 assert.equal(await queue.locator('button[data-current="true"] strong').innerText(),'Isoleret sang 22');
 assert.equal((await state()).writes.length,sourceBefore.writes.length+1);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',stories:['K2','K5','K7'],bundleSHA,frameProbe,
  selectedOccurrence:22,retainedAfterFailure:[23,24],authoritativeEmpty:true,
  sameSessionReopen:true,fixturePreservedOpaqueOccurrenceIds:true,inertNativeService:true,pageErrors:errors};
 await fs.writeFile(path.join(env.artifactDir(),'podview-queue-persistence-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
(async()=>{try{
 const nonce=require('node:crypto').randomUUID();
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-selection-'));
 const fixtureEnv=env.pythonEnv({
  MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:'1',
  MUSIC_COLD_CONTEXT:cold?'1':'0',MUSIC_COLD_REJECT:rejectSetup?'1':'0',
  MUSIC_REPEAT_MOOD:repeatMood?'1':'0',MUSIC_QUEUE_JOURNEY:queueJourney?'1':'0',
  MUSIC_QUEUE_COLD_TAIL:queueColdTail?'1':'0',PODVIEW_TEST_NONCE:nonce,
  ...(queueIdentity?{MUSIC_OUTPUT_TRANSFER_TEST:'1'}:{}),
  // Reuse the existing isolated catalogue search and cover fixtures for all four reads.
  ...(discoveryLoading?{MUSIC_DISCOVERY_LOADING_TEST:'cover'}:{})
 });
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],
  {cwd:env.runtimeRoot,env:fixtureEnv,stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('startup');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,nonce,'own inert runtime');
 const options=env.browserOptions();
 if(queueIdentity||accountRollover||discoveryLoading||discoveryRevisit
  ||discoveryCover||voiceLongSession||documentScope){
  options.args=['--mute-audio'];
 }
 browser=await chromium.launch(options);
 const surfaceOptions={hasTouch:true,viewport:{width:1280,height:800}};
 page=documentScope?await (await browser.newContext(surfaceOptions)).newPage():await browser.newPage(surfaceOptions);
 if(queueIdentity||accountRollover||discoveryLoading||discoveryRevisit||voiceLongSession||documentScope){
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  page.on('request',request=>{
   if(request.method()==='POST'&&new URL(request.url()).pathname==='/view/api/control/actions'){
    actions.push({url:request.url(),body:request.postDataJSON()});
   }
  });
 }
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async r=>{
  const url=r.url();
  if(url.endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');
  if((discoveryLoading||voiceLongSession||documentScope)&&new URL(url).pathname.endsWith('/podview.css')){
   cssSHA=createHash('sha256').update(await r.body()).digest('hex');
  }
  if(!accountRollover&&(url.includes('/music/selection/')||url.includes('/music/queue/')
    ||cold&&url.includes('/music?')&&new URL(url).searchParams.get('kind')==='mood')){
   responses.push({url,status:r.status(),body:await r.text()});
  }
 });
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/music/'))actions.push({url:r.url(),body:r.postDataJSON(),traceHeader:r.headers()['x-podview-trace']});if(previewRenew&&r.method()==='GET'&&r.url().includes('/music?')){const url=new URL(r.url());if(url.searchParams.get('kind')==='mood'&&url.searchParams.get('renew')==='1')moodRenewals.push(r.headers()['x-podview-trace']);}});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 if(defaultSpeakerProof){await defaultSpeakerJourney();return;}
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
 if(voiceJourney){await voiceQueueJourney();return;}
 if(accountRollover){await accountRolloverJourney();return;}
 if(queueIdentity){await queueIdentityJourney();return;}
 if(queueJourney){await queuePersistenceJourney();return;}
 if(discoveryLoading){await discoveryLoadingJourney();return;}
 if(discoveryRevisit){await discoveryRevisitJourney();return;}
 if(discoveryCover){await discoveryCoverJourney();return;}
 if(recentSession){await recentSessionJourney();return;}
 if(documentScope){await documentScopeJourney();return;}
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="top"]').tap();
 const rows=page.locator('#result-list button.result');
 await rows.filter({hasText:'Katalogsang 11'}).waitFor({state:'visible',timeout:15000});
 if (loseSelectionReceipt) {
  const endpoint = '**/view/api/music/selection/actions';
  await page.route(endpoint, async route => {
   const committed = await route.fetch();
   assert.equal((await committed.json()).outcome, 'accepted');
   assert.equal((await state()).song, 11, 'the inert owner acted before the receipt was lost');
   await route.fulfill({status: 502, json: {error: 'fixture_receipt_lost'}});
  }, {times: 1});

  await rows.filter({hasText: 'Katalogsang 11'}).tap();
  await page.waitForFunction(() => {
   const selection = document.querySelector('pv-widget-host')?.liveSelection;
   return selection?.feedback?.outcome === 'unknown' && !selection.pending && !selection.pendingPlayer();
  }, undefined, {timeout: 12000});
  await page.locator('#track-name').filter({hasText: 'Isoleret sang 11'}).waitFor({state: 'visible', timeout: 15000});
  assert.equal((await state()).selections.length, 1, 'passive observation does not repeat the unknown command');
  assert.equal(actions.filter(action => action.url.endsWith('/selection/actions')).length, 1);

  await rows.filter({hasText: 'Katalogsang 12'}).tap();
  await page.locator('#track-name').filter({hasText: 'Isoleret sang 12'}).waitFor({state: 'visible', timeout: 15000});
  const observed = await state();
  assert.deepEqual(observed.selections.map(row => Number(row.uri.split(':').pop())), [11, 12]);
  const setups = actions.filter(action => action.url.endsWith('/selection/setup'));
  const sent = actions.filter(action => action.url.endsWith('/selection/actions'));
  assert.equal(setups.length, 2);
  assert.equal(sent.length, 2);
  assert.notEqual(setups[0].body.candidateSetId, setups[1].body.candidateSetId);
  assert.notEqual(sent[0].body.taskId, sent[1].body.taskId);
  assert.notEqual(sent[0].body.requestId, sent[1].body.requestId);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({outcome: 'PASS', bundleSHA, unknownAfterCommit: true, explicitChoiceEffects: [11, 12]}));
  return;
 }
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
