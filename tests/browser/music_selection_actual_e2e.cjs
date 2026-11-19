'use strict';
// Packaged UI → real Python shelves/selection/queue brokers → stateful inert native service. No audio, no Spotify:
// cover requests are answered by an inert image and every other outside request is refused.
// Find musik (concept B): quick picks and cover shelves read from GET music/shelves (tests/music_shelves_fixture.py);
// a tile tap starts that tile's context (play_context) on the player's speaker through setup → offer → one action.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const loseSelectionReceipt = process.env.MUSIC_UNKNOWN_AFTER_COMMIT === '1';
const queueColdTail = process.env.MUSIC_QUEUE_INTENTS === 'cold-tail';
const queueIntentDuringRefresh = process.env.MUSIC_QUEUE_INTENTS === 'refresh' || queueColdTail;
const queueUnknownUnchanged = process.env.MUSIC_QUEUE_INTENTS === 'unknown-unchanged';
const queueUnknown = process.env.MUSIC_QUEUE_INTENTS === 'unknown' || queueUnknownUnchanged;
const queueIntents = process.env.MUSIC_QUEUE_INTENTS === '1' || queueIntentDuringRefresh || queueUnknown;
const queueGeneration=process.env.MUSIC_QUEUE_IDENTITY_TEST==='generation';
const queueIdentity=queueGeneration||process.env.MUSIC_QUEUE_IDENTITY_TEST==='1';
const accountRollover=process.env.MUSIC_ACCOUNT_ROLLOVER_TEST==='1';
const queueJourney = queueIdentity || process.env.MUSIC_QUEUE_JOURNEY === '1' || queueIntents
 || process.env.MUSIC_QUEUE_SKIP_TEST === '1';
const defaultSpeakerProof=process.env.MUSIC_DEFAULT_SPEAKER_PROOF==='1';
const recentSession=process.env.MUSIC_RECENT_SESSION_TEST==='1';
const startLatency=process.env.MUSIC_START_LATENCY_TEST==='1';
const queueSkip=process.env.MUSIC_QUEUE_SKIP_TEST==='1';
const coldPlayer=process.env.MUSIC_COLD_PLAYER_TEST==='1';
const documentScope=process.env.MUSIC_DOCUMENT_SCOPE_TEST==='1';
const voiceJourney=process.env.MUSIC_VOICE_JOURNEY_TEST==='1';
const voiceLongSession=voiceJourney&&process.env.MUSIC_LONG_SESSION==='1';
const cold=defaultSpeakerProof||process.env.MUSIC_COLD_CONTEXT==='1',rejectSetup=process.env.MUSIC_COLD_REJECT==='1';
const port=Number(process.env.MUSIC_TEST_PORT||18979),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,page,serverLog='';const errors=[],actions=[],responses=[];let bundleSHA,cssSHA;
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const findLab=body=>fetch(base+'/lab/find-musik',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify(body)}).then(r=>r.json());
const starts=value=>value.nativeCalls.filter(row=>row.service==='start_room_selected_content');
const SPEAKER_REFUSED='Højttaleren i rummet kan ikke bruges lige nu.';
// Spotify's cover hosts get an inert image (a colour per URL); nothing else outside PodVoice is reached.
async function inertCovers(surface){
 await surface.route(/^https:\/\//,route=>{
  const url=new URL(route.request().url());
  if(!/^(i\.scdn\.co|image-cdn-(fa|ak)\.spotifycdn\.com)$/.test(url.hostname))return route.abort();
  const hue=parseInt(createHash('sha256').update(url.href).digest('hex').slice(0,4),16)%360;
  return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" '
   +`height="64"><rect width="64" height="64" fill="hsl(${hue} 45% 45%)"/></svg>`});
 });
}
// PodView reads Find musik in the background as soon as it connects; wait for that page (with its AI shelves).
async function shelvesRead(surface){
 await surface.waitForFunction(()=>{const page=document.querySelector('pv-widget-host')?.liveCatalogue?.page;
  return !!page&&!page.refreshing&&page.shelves.some(shelf=>shelf.ai);},undefined,{timeout:30000});
}
const tile=(surface,shelf,name)=>surface.locator(`section.find-shelf[data-shelf="${shelf}"] button.find-tile`)
 .filter({has:surface.locator('strong',{hasText:new RegExp(`^${name}$`)})});
// Find musik opened from the overview, measured in its first visible frame (docs/MOTION.md §3.2: the scene renders
// inside the page transition's update, so the reading is taken the moment it is shown).
async function openFindMusik(surface){
 await surface.evaluate(()=>window.addEventListener('click',event=>{if(!event.target.closest?.('#home-music'))return;
  const view=document.getElementById('music-response');
  const measure=()=>{const buttons=[...view.querySelectorAll('button')];
   window.firstMusicFrame={quick:view.querySelectorAll('.find-quick-tile').length,
    tiles:view.querySelectorAll('.find-tile').length,shelves:view.querySelectorAll('.find-shelf').length,
    empty:!!view.querySelector('.find-empty'),locked:buttons.filter(b=>b.disabled||b.ariaDisabled==='true').length,
    loading:/Henter|Indlæser/.test(view.innerText||'')};};
  if(!view.hidden){measure();return;}
  const watch=new MutationObserver(()=>{if(view.hidden)return;watch.disconnect();measure();});
  watch.observe(view,{attributes:true,attributeFilter:['hidden']});},{once:true}));
 await surface.locator('#home-music').tap();
 await surface.waitForFunction(()=>window.firstMusicFrame!==undefined,null,{timeout:2000});
 return surface.evaluate(()=>window.firstMusicFrame);
}
// Every disabled/aria-disabled write on Find musik's buttons (a start never locks a tile).
async function watchLocks(surface){
 await surface.locator('#find-musik').evaluate(node=>{window.findLocks=[];new MutationObserver(records=>{
  for(const record of records)if(record.target.closest?.('button')&&(record.target.disabled
   ||record.target.getAttribute('aria-disabled')==='true'))window.findLocks.push(record.target.textContent.trim());
 }).observe(node,{subtree:true,attributes:true,attributeFilter:['disabled','aria-disabled']});});
}
const observedSong=(surface,song,phase='playing')=>surface.waitForFunction(({song,phase})=>{
 const h=document.querySelector('pv-widget-host'),p=h?.liveMedia?.playback;
 return p?.state===phase&&p.item?.uri===`spotify:track:${String(song).padStart(22,'0')}`
  &&document.querySelector('#track-name')?.textContent?.trim()===`Isoleret sang ${song}`
  &&!(h.liveControls?.musicIntentPending||h.liveControls?.player?.busy())&&!h.liveSelection?.pending;
},{song,phase},{timeout:20000});
// Find musik on the packaged page: content in its first frame, one vertical page with sideways shelves, a tile tap
// starts that tile's context on the player's room and the player shows it, taps never lock (the last one wins), a
// refused start is a short toast that clears itself, then the queue still works.
async function findMusikJourney(){
 await shelvesRead(page);
 const first=await openFindMusik(page);
 assert.equal(first.quick,6,'six quick picks in the first frame: '+JSON.stringify(first));
 assert(first.shelves>=6&&first.tiles>=20,'the shelves are drawn in the first frame: '+JSON.stringify(first));
 assert.deepEqual([first.empty,first.locked,first.loading],[false,0,false],'no empty, locked or loading frame');
 assert.equal(await page.locator('#header-title').innerText(),'Find musik');
 const ai=page.locator('section.find-shelf[data-shelf=ai_moment]');
 assert.equal(await ai.locator('.find-ai-badge').innerText(),'AI-valgt');
 assert.match(await ai.locator('.find-why').innerText(),/^Fordi /,'an AI shelf says why');
 // One page scrolls vertically; the player stays where it is.
 const feed=page.locator('#music-response'),player=page.locator('.player');
 const playerBox=await player.boundingBox();
 await env.touchScroll(page,feed,{dy:360});
 const scrolled=await feed.evaluate(node=>node.scrollTop);
 assert(scrolled>40,`a vertical swipe scrolls Find musik (${scrolled})`);
 assert.deepEqual(await player.boundingBox(),playerBox,'the player stays while the page scrolls');
 // A shelf wider than the column scrolls sideways under the finger; nothing navigates.
 const row=page.locator('section.find-shelf[data-shelf=recent] .find-shelf-row');
 await row.evaluate(node=>node.scrollIntoView({block:'center'}));await sleep(300);
 const wide=await row.evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth,left:node.scrollLeft}));
 assert(wide.scroll>wide.client+100,'the recent shelf is wider than the column: '+JSON.stringify(wide));
 const before={url:page.url(),history:await page.evaluate(()=>history.length),top:await feed.evaluate(n=>n.scrollTop),
  focus:await page.locator('pv-widget-host').evaluate(h=>h.state.focus)};
 const rowBox=await row.boundingBox(),y=rowBox.y+rowBox.height/3;
 await env.touchDrag(page,{x:rowBox.x+rowBox.width-60,y},{x:rowBox.x+120,y});
 await page.waitForFunction(()=>document.querySelector('[data-shelf=recent] .find-shelf-row').scrollLeft>100,
  undefined,{timeout:3000});
 await sleep(500);
 const after={url:page.url(),history:await page.evaluate(()=>history.length),top:await feed.evaluate(n=>n.scrollTop),
  focus:await page.locator('pv-widget-host').evaluate(h=>h.state.focus)};
 assert.deepEqual(after,before,'a sideways swipe moves the shelf, not the page');
 const swiped=await row.evaluate(node=>node.scrollLeft);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-find-musik-swiped.png')});

 // A tile tap starts that tile's context on the player's room; the player shows the wish at once.
 await watchLocks(page);
 const blue=tile(page,'albums','Blue'),blueUri=await blue.getAttribute('data-uri');
 assert.match(blueUri,/^spotify:album:/);
 await blue.scrollIntoViewIfNeeded();
 await blue.evaluate(node=>node.addEventListener('click',event=>{if(!event.isTrusted)return;
  const start=performance.now(),probe=window.wishShown={ms:null};
  const sample=()=>{
   if(document.querySelector('#track-name')?.textContent?.trim()==='Blue')probe.ms=performance.now()-start;
   else if(performance.now()-start<3000)requestAnimationFrame(sample);};
  requestAnimationFrame(sample);},{once:true}));
 await blue.tap();
 await page.waitForFunction(()=>Number.isFinite(window.wishShown?.ms),undefined,{timeout:4000});
 const wishMs=Math.round(await page.evaluate(()=>window.wishShown.ms));
 assert(wishMs<300,`the tapped tile shows in the player within 300 ms (${wishMs})`);
 await observedSong(page,11);
 let value=await state();
 const [blueStart]=starts(value);
 assert.equal(blueStart.args.action,'play_context');
 assert.equal(blueStart.args.args.context_uri,blueUri,'the tapped tile\'s context starts');
 assert.deepEqual([blueStart.args.room_id,blueStart.args.homepod_id,blueStart.args.target_id],
  ['native-room','42','device'],'on the player\'s room');
 assert.equal(await page.locator('#player-room').innerText(),'Køkkenalrum HomePod');
 assert.equal(await row.evaluate(node=>node.scrollLeft),swiped,'a start keeps the shelf where it was');

 // Taps during a start wait and the newest one follows (last wins); nothing is ever disabled.
 const held=page.waitForRequest(r=>new URL(r.url()).pathname==='/view/api/music/selection/actions');
 let release;const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/view/api/music/selection/actions',async route=>{await gate;await route.continue();},{times:1});
 const kind=tile(page,'albums','Kind of Blue'),phil=tile(page,'albums','Philharmonics');
 const show=tile(page,'podcasts','Det Røde Rum');
 await kind.tap();
 await held;
 await phil.tap();
 await show.scrollIntoViewIfNeeded();
 await show.tap();
 assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#find-musik button')]
  .filter(b=>b.disabled||b.ariaDisabled==='true').length),0,'no tile is disabled during a start');
 release();
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent?.trim()==='Det Røde Rum'
  ||/Isoleret sang 13/.test(document.querySelector('#track-name')?.textContent||''),undefined,{timeout:20000});
 await observedSong(page,13);
 value=await state();
 const showUri=await show.getAttribute('data-uri'),kindUri=await kind.getAttribute('data-uri');
 assert.deepEqual(starts(value).map(row=>row.args.args.context_uri),[blueUri,kindUri,showUri],
  'the first and the newest waiting tap are sent; the tap in between is replaced');
 assert.deepEqual(await page.evaluate(()=>window.findLocks),[],'no tile was ever locked');

 // A refused start is a short toast that clears itself; the player keeps what plays and the next tap starts.
 await findLab({failNextSetups:1});
 const toast=page.locator('#find-musik .find-toast');
 const nina=tile(page,'artists','Nina Simone');
 await nina.scrollIntoViewIfNeeded();
 const refusedAt=Date.now();
 await nina.tap();
 await toast.filter({hasText:SPEAKER_REFUSED}).waitFor({state:'visible',timeout:10000});
 await page.screenshot({path:path.join(env.artifactDir(),'podview-find-musik-toast.png')});
 await toast.waitFor({state:'hidden',timeout:6000});
 const toastMs=Date.now()-refusedAt;
 assert(toastMs<6000,`the toast clears itself (${toastMs} ms)`);
 assert.doesNotMatch(await page.locator('.player').innerText(),/kan ikke bruges|fejlede|afvist/,
  'no error text stays on the player');
 assert.equal(starts(await state()).length,3,'a refused setup starts nothing');
 await nina.tap();
 await observedSong(page,14);
 value=await state();
 assert.equal(starts(value).at(-1).args.args.context_uri,await nina.getAttribute('data-uri'));
 assert.deepEqual(await page.evaluate(()=>window.findLocks),[],'no tile was ever locked');

 // The queue still works after Find musik starts (A12/K7: an unrelated voice answer keeps it).
 await page.locator('#track').tap();
 const queueRow=page.locator('#queue button.queue-track:not([data-pv-leave])').filter({hasText:'Køsang 22'});
 await queueRow.waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll('#queue button.queue-track:not([data-pv-leave])')]
  .some(b=>b.textContent.includes('Køsang 22')&&!b.disabled),undefined,{timeout:15000});
 const queueBeforeVoice=await page.locator('#queue').innerText();
 await page.request.post(base+'/lab/state',{data:{unrelatedVoiceTurn:'s1:unrelated-answer'}});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.turnId
  ==='s1:unrelated-answer',undefined,{timeout:10000});
 assert.equal(await page.locator('#queue').innerText(),queueBeforeVoice,'unrelated voice keeps queue content');
 assert.equal(await queueRow.isEnabled(),true,'unrelated voice keeps queue selectable');
 await queueRow.tap();
 for(let n=0;(await state()).song!==22;n++){if(n>100)throw Error('queue occurrence effect missing');await sleep(100);}
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent?.trim()==='Isoleret sang 22',
  undefined,{timeout:15000});
 const queued=await state();
 assert.equal(queued.queueSelections.length,1);
 assert.deepEqual(queued.writes.map(r=>r.action),['play_context','play_context','play_context','play_context',
  'play_queue_occurrence']);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='prepare_room_selected_content').length,4);
 assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/setup')).length,5,'every tap was sent');
 assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,4);
 for(const r of actions.filter(r=>r.url.endsWith('/actions'))){assert(!Object.hasOwn(r.body,'uri'));
  assert(!Object.hasOwn(r.body,'index'));}
 assert.match(bundleSHA,/^[a-f0-9]{64}$/);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(env.artifactDir(),'podview-music-selection-trace.json'),
  JSON.stringify({bundleSHA,service:queued,actions,responses},null,2));
 await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection.png')});
 console.log(JSON.stringify({outcome:'PASS',packagedUI:true,bundleSHA,inertNativeService:true,firstFrame:first,
  verticalScroll:scrolled,shelfSwipe:swiped,wishMs,contexts:starts(queued).map(row=>row.args.args.context_uri),
  lastTapWins:true,locks:0,toastMs,queueProof:'Køsang 22 → play_queue_occurrence',pageErrors:errors}));
}
// An unknown outcome after the owner acted stays honest on the player and is never resent; the next tap starts.
async function unknownAfterCommitJourney(){
 await shelvesRead(page);
 await openFindMusik(page);
 await page.route('**/view/api/music/selection/actions',async route=>{
  const committed=await route.fetch();
  assert.equal((await committed.json()).outcome,'accepted');
  assert.equal(starts(await state()).length,1,'the inert owner acted before the receipt was lost');
  await route.fulfill({status:502,json:{error:'fixture_receipt_lost'}});
 },{times:1});
 const blue=tile(page,'albums','Blue');
 await blue.scrollIntoViewIfNeeded();
 await blue.tap();
 await page.waitForFunction(()=>{const s=document.querySelector('pv-widget-host')?.liveSelection;
  return s?.feedback?.outcome==='unknown'&&!s.pending;},undefined,{timeout:12000});
 await observedSong(page,11);
 assert.equal(await page.locator('#find-musik .find-toast').isVisible(),false,'an unknown outcome is not a toast');
 await sleep(3000);
 assert.equal(starts(await state()).length,1,'passive observation does not repeat the unknown command');
 assert.equal(actions.filter(action=>action.url.endsWith('/selection/actions')).length,1);
 const kind=tile(page,'albums','Kind of Blue');
 await kind.tap();
 await observedSong(page,12);
 const sent=actions.filter(action=>action.url.endsWith('/selection/actions'));
 assert.equal(sent.length,2);
 assert.notEqual(sent[0].body.requestId,sent[1].body.requestId);
 assert.deepEqual(starts(await state()).map(row=>row.args.args.context_uri),
  [await blue.getAttribute('data-uri'),await kind.getAttribute('data-uri')]);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',bundleSHA,unknownAfterCommit:true,explicitChoiceEffects:2}));
}
// Green timing: the speaker confirms at 2.7 s, Spotify's observation and HA event follow at 4.5 s.
// The tapped tile shows at once, and the player turns to playing at the first confirmation.
async function startLatencyJourney(){
 await shelvesRead(page);
 await openFindMusik(page);
 const row=tile(page,'albums','Blue');
 await row.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{
  const button=document.querySelector('#play-pause');
  return button&&!button.disabled&&button.getAttribute('aria-label')==='Fortsæt musikken';
 },undefined,{timeout:15000});
 await row.evaluate(node=>{
  node.addEventListener('click',event=>{
   if(!event.isTrusted)return;
   const start=performance.now();
   const probe=window.startLatency={clickAt:Date.now(),pendingMs:null,playingMs:null,playingTitle:null};
   const sample=()=>{
    const now=performance.now()-start,title=document.querySelector('#track-name')?.textContent;
    const label=document.querySelector('#play-pause')?.getAttribute('aria-label');
    if(probe.pendingMs===null&&title==='Blue')probe.pendingMs=now;
    if(probe.playingMs===null&&label==='Sæt musik på pause'&&['Blue','Isoleret sang 11'].includes(title)){
     probe.playingMs=now;probe.playingTitle=title;
    }
    if(now<12000&&probe.playingMs===null)requestAnimationFrame(sample);
   };
   requestAnimationFrame(sample);
  },{once:true});
 });
 await row.tap();
 await page.waitForFunction(()=>Number.isFinite(window.startLatency?.playingMs),undefined,{timeout:15000});
 await page.screenshot({path:path.join(env.artifactDir(),'podview-start-latency-playing.png')});
 const probe=await page.evaluate(()=>window.startLatency),fixture=await state();
 const speakerMs=Math.round(fixture.speakerConfirmedAtMs-probe.clickAt);
 const result={pendingMs:Math.round(probe.pendingMs),speakerMs,playingMs:Math.round(probe.playingMs),
  playingTitle:probe.playingTitle,bundleSHA};
 console.log('startLatency',JSON.stringify(result));
 assert(probe.pendingMs<300,`chosen tile visible within 300 ms: ${JSON.stringify(result)}`);
 assert(probe.playingMs>=speakerMs,`never playing before the speaker confirms: ${JSON.stringify(result)}`);
 assert(probe.playingMs<speakerMs+500,`playing within 500 ms of the speaker confirmation: ${JSON.stringify(result)}`);
 assert.equal(fixture.writes.filter(row=>row.action==='play_context').length,1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',mode:'start-latency',...result}));
}
// Two documents share one HA ingress session: each page keeps its own Find musik choice set, a tap uses its own,
// and a newer read in the same document replaces the earlier set.
async function documentScopeJourney(){
 const peer=await page.context().newPage();
 const localOnly=surface=>surface.route('**/*',route=>
  new URL(route.request().url()).origin===base?route.continue():route.abort());
 const shelfReads=surface=>{const reads=[];surface.on('response',response=>{
  if(new URL(response.url()).pathname==='/view/api/music/shelves'&&response.ok())reads.push(response);});return reads;};
 const latest=async reads=>{for(let n=0;n<100&&!reads.length;n++)await sleep(50);
  const response=reads.at(-1),body=await response.json();
  return {set:body.candidateSet?.candidateSetId,document:response.request().headers()['x-podview-music-document']};};
 const pageReads=page.shelfReads,peerReads=shelfReads(peer);
 await localOnly(peer);await inertCovers(peer);
 peer.on('pageerror',error=>errors.push(error.message));
 try{
  await peer.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
  await env.openOverview(peer);
  const snapshots=await Promise.all([page,peer].map(async surface=>
   (await surface.request.get(base+'/view/api/snapshot?room=kitchen')).json()));
  assert.deepEqual(snapshots.map(s=>[s.bootId,s.roomId,s.admission.kind]),[
   [snapshots[0].bootId,'kitchen','ha_ingress'],[snapshots[0].bootId,'kitchen','ha_ingress'],
  ]);
  await shelvesRead(page);
  await openFindMusik(page);
  const first=await latest(pageReads);
  await shelvesRead(peer);
  await openFindMusik(peer);
  const other=await latest(peerReads);
  assert.match(first.set,/^[a-f0-9]{64}$/);assert.match(other.set,/^[a-f0-9]{64}$/);
  assert.notEqual(first.set,other.set);
  assert.match(first.document,/^[a-f0-9]{32}$/);assert.match(other.document,/^[a-f0-9]{32}$/);
  assert.notEqual(first.document,other.document);
  assert.deepEqual((await state()).writes,[],'both reads leave the inert owner untouched');

  const setupReply=page.waitForResponse(r=>new URL(r.url()).pathname==='/view/api/music/selection/setup');
  const actionReply=page.waitForResponse(r=>
   new URL(r.url()).pathname==='/view/api/music/selection/actions').catch(error=>error);
  await page.bringToFront();
  const blue=tile(page,'albums','Blue');
  await blue.scrollIntoViewIfNeeded();
  await blue.tap();
  const setup=await setupReply,own=await latest(pageReads);
  assert.equal(setup.request().postDataJSON().candidateSetId,own.set,'A uses its own choice set after B reads');
  assert.notEqual(setup.request().postDataJSON().candidateSetId,other.set);
  assert.equal(setup.request().headers()['x-podview-music-document'],first.document);
  assert.equal(setup.status(),200,await setup.text());
  const action=await actionReply;
  if(action instanceof Error)throw action;
  assert.equal(action.request().headers()['x-podview-music-document'],first.document);
  assert.equal((await action.json()).outcome,'accepted');
  await observedSong(page,11);
  assert.deepEqual((await state()).writes.map(({action,uri})=>[action,uri]),[
   ['play_context',await blue.getAttribute('data-uri')],
  ]);

  // A newer read in the same document replaces the earlier choice set: the old setup is refused.
  const count=pageReads.length;
  await page.locator('pv-widget-host').evaluate(h=>h.liveCatalogue.refresh());
  for(let n=0;n<100&&pageReads.length===count;n++)await sleep(50);
  const replacement=await latest(pageReads);
  assert.equal(replacement.document,first.document);
  assert.notEqual(replacement.set,own.set);
  const stale=await page.request.post(setup.url(),{
   headers:{'X-PodView-Request':'1','X-PodView-Music-Document':first.document},
   data:setup.request().postDataJSON(),
  });
  assert.equal(stale.status(),409);
  assert.equal((await stale.json()).error,'stale_music_selection');
  assert.equal(actions.filter(action=>action.url.endsWith('/music/selection/actions')).length,1);
  assert.deepEqual((await state()).writes.map(row=>row.action),['play_context']);
  assert.deepEqual(errors,[]);
  if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
  assert.match(cssSHA,/^[a-f0-9]{64}$/);
  const proof={outcome:'PASS',bundleSHA,cssSHA,sharedHAIngress:true,documents:2,
   ownChoiceSetSurvivesSecondRead:true,sameDocumentReplacementRejectsOldSetup:true,
   inertPlaybackEffects:1,inertNativeService:true,pageErrors:errors};
  await fs.writeFile(path.join(env.artifactDir(),'podview-music-document-scope.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
 }finally{await peer.close();}
}
// F10/F11/A9/A10: a tile's title and cover show in the player at once while the start is under way, the page
// stays usable, a lease renewal or a reopen never replays the start, player taps keep working, and a later tile
// choice after an expired target read refreshes that read once.
async function recentSessionJourney(){
 const uri='spotify:track:'+String(11).padStart(22,'0'),title='Isoleret sang 11';
 await shelvesRead(page);
 await openFindMusik(page);
 const chosen=tile(page,'albums','Kind of Blue');
 await chosen.scrollIntoViewIfNeeded();
 const art=chosen.locator('.find-art img');
 await page.waitForFunction(node=>node.hasAttribute('data-ready'),await art.elementHandle(),{timeout:10000});
 const coverUrl=await art.getAttribute('src'),name='Kind of Blue';
 await watchLocks(page);
 const tilesBefore=await page.locator('#find-musik button').count();
 let release,markHeld;
 const gate=new Promise(resolve=>{release=resolve;});
 const held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music/selection/actions',async route=>{
  markHeld();
  await gate;
  await route.continue();
 },{times:1});
 await chosen.evaluate((node,{name,coverUrl})=>{
  node.addEventListener('click',event=>{
   if(!event.isTrusted)return;
   const start=performance.now(),probe=window.recentPaint={titleMs:null,coverMs:null};
   const measure=()=>{
    const now=performance.now()-start,cover=document.querySelector('#cover');
    if(probe.titleMs===null&&document.querySelector('#track-name')?.textContent===name)probe.titleMs=now;
    if(probe.coverMs===null&&cover?.getAttribute('src')===coverUrl&&cover.naturalWidth>0)probe.coverMs=now;
    if(now<3000&&(probe.titleMs===null||probe.coverMs===null))requestAnimationFrame(measure);
   };
   requestAnimationFrame(measure);
  },{once:true});
 },{name,coverUrl});
 let firstPaint;
 try{
  await chosen.tap();
  await Promise.race([held,sleep(8000).then(()=>{throw Error('selection action was not held');})]);
  await page.waitForFunction(()=>Number.isFinite(window.recentPaint?.titleMs)
   &&Number.isFinite(window.recentPaint?.coverMs),undefined,{timeout:5000}).catch(async error=>{
   throw Error(error.message+' '+JSON.stringify(await page.evaluate(()=>({probe:window.recentPaint,
    title:document.querySelector('#track-name')?.textContent,
    cover:document.querySelector('#cover')?.getAttribute('src'),
    width:document.querySelector('#cover')?.naturalWidth}))));
  });
  firstPaint=await page.evaluate(()=>window.recentPaint);
  assert(firstPaint.titleMs<300&&firstPaint.coverMs<300,JSON.stringify(firstPaint));
  const oldRead=await page.waitForResponse(response=>{
   const url=new URL(response.url());
   return url.pathname==='/view/api/music'&&url.searchParams.get('kind')==='playback'&&response.ok();
  },{timeout:10000});
  assert.notEqual((await oldRead.json()).uri,uri);
  assert.deepEqual((await state()).writes,[]);
  assert.equal(await page.locator('#track-name').textContent(),name,'an older playback read keeps the wish');
  assert.equal(await page.locator('#cover').getAttribute('src'),coverUrl);
  assert.equal(await page.locator('#player-room').textContent(),'Køkkenalrum HomePod');
  // A start is calm (13/11): the chosen item shows at once, no text over the speaker picker.
  assert.equal(await page.locator('#player-state').textContent(),'');
  assert.equal(await page.locator('#find-musik button').count(),tilesBefore,'the page keeps every tile');
  assert.deepEqual(await page.evaluate(()=>window.findLocks),[],'no tile is locked during the start');
  await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-pending-player.png')});
 }finally{release();}
 const observed=(surface,phase,after=0)=>surface.waitForFunction(({uri,title,phase,after})=>{
  const host=document.querySelector('pv-widget-host'),playback=host?.liveMedia?.playback;
  const b=document.querySelector('#play-pause');
  return Date.now()>=after&&playback?.roomBinding?.validUntil*1000>Date.now()
   &&playback.roomBinding.nativeRoomId==='native-room'&&playback.roomBinding.nativeHomepodId==='42'
   &&playback.item?.uri===uri&&playback.state===phase&&b&&!b.disabled
   &&!(host.liveControls.musicIntentPending||host.liveControls?.player?.busy())
   &&!host.liveSelection.pending&&document.querySelector('#track-name')?.textContent===title;
 },{uri,title,phase,after},{timeout:15000});
 await observed(page,'playing');
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')
  ?.liveSelection?.feedback?.settlementStatus==='confirmed');
 const initialDeadline=await page.locator('pv-widget-host').evaluate(host=>
  host.liveMedia.playback.roomBinding.validUntil*1000);
 const baseline=await state();
 assert.deepEqual(baseline.writes.map(row=>row.action),['play_context']);
 assert.equal(baseline.selections[0].uri,await chosen.getAttribute('data-uri'));
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
 assert.deepEqual(afterBurst.writes.map(row=>row.action),['play_context','pause','resume','pause']);
 await page.request.post(base+'/lab/state',{data:{delayMs:0}});
 const storageState=await page.context().storageState();
 await page.close();
 page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820},storageState});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await inertCovers(page);
 // The reopened page shows the last-known Find musik in its first frame, before its own read answers.
 let releaseShelves;const shelvesGate=new Promise(resolve=>{releaseShelves=resolve;});
 await page.route('**/view/api/music/shelves?**',async route=>{await shelvesGate;await route.continue();});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await observed(page,'paused');
 // After the start, the room player's own cover (HA's proxy image through PodVoice) is shown.
 const reopenedCover=page.locator('#cover[src*="/view/api/music/player/artwork"]');
 await reopenedCover.waitFor({state:'visible'});
 await reopenedCover.evaluate(image=>image.decode());
 assert.deepEqual((await state()).writes,afterBurst.writes,'reopening does not replay the selection or controls');
 const reopenedFrame=await openFindMusik(page);
 assert(reopenedFrame.quick===6&&reopenedFrame.tiles>=20&&!reopenedFrame.empty&&!reopenedFrame.loading,
  'the last-known Find musik is shown at once after a reload: '+JSON.stringify(reopenedFrame));
 releaseShelves();
 await page.unroute('**/view/api/music/shelves?**');
 await page.locator('#play-pause').tap();
 await observed(page,'playing');
 const volume=page.locator('#volume');
 await env.touchRange(page,volume,55);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.volume===55);
 const final=await state();
 assert.equal(final.selections.length,1);
 assert.deepEqual(final.writes.map(row=>row.action),['play_context','pause','resume','pause','resume','volume']);
 assert.equal(final.volume,55);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-reopened-controls.png')});
 // A later tile choice after the reopen: one effect, at most one choice-set renewal read (served from cache).
 let choicePressed=false,choiceShelfReads=0;
 page.on('response',response=>{
  if(new URL(response.url()).pathname==='/view/api/music/shelves'&&choicePressed)choiceShelfReads++;
 });
 const later=tile(page,'albums','Blue');
 await later.scrollIntoViewIfNeeded();
 choicePressed=true;
 await later.tap();
 await observedSong(page,12);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSelection?.feedback?.settlementStatus
  ==='confirmed');
 const laterChoice=await state();
 assert.deepEqual(laterChoice.writes.slice(final.writes.length).map(row=>row.action),['play_context']);
 assert.equal(laterChoice.selections.at(-1).uri,await later.getAttribute('data-uri'));
 assert(choiceShelfReads<=1,'at most one choice-set renewal read');
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',stories:['F10','F11','A9','A10-renewal-reopen'],bundleSHA,firstPaint,reopenedFrame,
  tilesEnabledDuringStart:true,laterChoiceEffects:1,choiceShelfReads,
  previousItemReadWithSelectedTitleAndCover:true,selectionEffects:1,realLeaseRenewal:true,rapidLabels:labels,
  touchEffectsAfterReopen:['resume','volume'],inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-recent-session-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
// Test 13/11 12:05: a start from an empty player is calm. Every frame of the player is recorded:
// no text over the speaker picker, the title changes once to the chosen song, no layout jump.
async function recordPlayer(){
 await page.evaluate(()=>{
  const read=()=>{const q=id=>document.getElementById(id),box=document.querySelector('.player')?.getBoundingClientRect();
   return {state:q('player-state')?.textContent||'',track:q('track-name')?.textContent||'',
    toggle:[q('play-pause')?.getAttribute('aria-label'),q('play-pause')?.disabled,q('play-pause')?.getAttribute('aria-busy')].join('|'),
    output:q('output')?.disabled+'|'+(q('output')?.getBoundingClientRect().top|0),height:box?box.height|0:0};};
  const probe=window.playerFrames={frames:[]};
  const sample=()=>{probe.frames.push(read());if(!probe.stop)requestAnimationFrame(sample);};
  requestAnimationFrame(sample);
 });
}
const playerChanges=async()=>page.evaluate(()=>{const p=window.playerFrames;p.stop=true;const out={};
 for(const key of Object.keys(p.frames[0]||{})){const seq=[];for(const f of p.frames)if(seq.at(-1)!==f[key])seq.push(f[key]);out[key]=seq;}
 return out;});
async function coldPlayerJourney(){
 assert((await page.request.post(base+'/lab/state',{data:{externalPlaybackState:'idle'}})).ok());
 await page.waitForFunction(()=>!['playing','paused'].includes(document.querySelector('pv-widget-host')?.liveMedia?.playback?.state),
  undefined,{timeout:15000});
 await shelvesRead(page);
 await openFindMusik(page);
 const row=tile(page,'albums','Blue');
 await row.scrollIntoViewIfNeeded();
 await sleep(500);
 await recordPlayer();
 await row.tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');
  return h?.liveSelection?.feedback?.displayObserved===true&&h.liveMedia?.playback?.state==='playing';},undefined,{timeout:20000});
 await sleep(800);
 const changes=await playerChanges();
 console.log('coldPlayer',JSON.stringify(changes));
 assert.deepEqual(changes.state.filter(text=>text&&!['Spiller på'].includes(text)),[],'no text over the speaker picker');
 // The tile's name shows at once, then only the room's own title (the context's first song);
 // never back to empty or between.
 assert.deepEqual(changes.track,['','Blue','Isoleret sang 11'],'one calm title change');
 assert.deepEqual(changes.output.length,1,'the speaker picker never flips');
 assert(changes.toggle.length<=2,'play/pause changes once: '+JSON.stringify(changes.toggle));
 assert(changes.height.length<=2,'no layout jumps: '+JSON.stringify(changes.height));
 return changes;
}
// K2/K4: three fast Next taps and one autoplay context switch. The queue list is never empty,
// never shows error text, keeps each row's DOM node while it stays listed and never reorders rows.
async function queueSkipJourney(){
 await page.locator('#track').tap();
 const upcoming=()=>page.evaluate(()=>[...document.querySelectorAll('#queue button.queue-track:not([data-pv-leave])[data-current="false"]')]
  .filter(row=>row.dataset.placeholder!=='true').map(row=>row.querySelector('.queue-copy strong').textContent));
 const firstUpcoming=title=>page.waitForFunction(title=>{
  const row=[...document.querySelectorAll('#queue button.queue-track:not([data-pv-leave])[data-current="false"]')]
   .find(node=>node.dataset.placeholder!=='true');
  return row?.querySelector('.queue-copy strong')?.textContent===title;
 },title,{timeout:15000});
 await firstUpcoming('Køsang 21');
 await page.evaluate(()=>{
  const queue=document.getElementById('queue'),probe=window.queueSkipProbe={frames:[],identity:[],order:[],texts:new Set()};
  let previous=new Map();
  const sample=()=>{
   const rows=[...queue.querySelectorAll('button.queue-track:not([data-pv-leave])')],real=rows.filter(row=>row.dataset.placeholder!=='true');
   const upcoming=real.filter(row=>row.dataset.current==='false');
   const placeholders=rows.length-real.length,ids=real.map(row=>row.dataset.trackId),now=new Map(real.map(row=>[row.dataset.trackId,row]));
   for(const [id,node] of now)if(previous.has(id)&&previous.get(id)!==node)probe.identity.push(id);
   const kept=[...previous.keys()].filter(id=>now.has(id));
   if(kept.join()!==ids.filter(id=>previous.has(id)).join())probe.order.push({before:[...previous.keys()],after:ids});
   const titles=upcoming.map(row=>row.querySelector('.queue-copy strong').textContent);
   probe.frames.push({at:performance.now(),upcoming:titles.length,placeholders,
    ascending:titles.every((title,index)=>index===0||Number(title.split(' ')[1])>Number(titles[index-1].split(' ')[1]))});
   probe.texts.add(document.getElementById('queue-title')?.textContent||'');
   probe.texts.add(queue.querySelector('.queue-empty')?.textContent||'');
   previous=now;
   if(!window.stopQueueSkip)requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
 });
 const before=await state(),next=page.locator('#next');
 for(let tap=0;tap<3;tap++)await next.tap();
 await firstUpcoming('Køsang 24');
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.item?.name==='Isoleret sang 23'
  &&document.getElementById('queue').dataset.status==='ready',undefined,{timeout:15000});
 assert.deepEqual((await upcoming()),['Køsang 24','Køsang 25','Køsang 26','Køsang 27','Køsang 28']);
 assert.deepEqual((await state()).writes.slice(before.writes.length).map(row=>row.action),['next','next','next']);
 assert.equal((await page.request.post(base+'/lab/queue',{data:{condition:'autoplay'}})).ok(),true);
 await firstUpcoming('Køsang 41');
 assert.deepEqual(await upcoming(),['Køsang 41','Køsang 42','Køsang 43']);
 // Testnoter 13/11 fejl 4: PodConnect's snapshot is stale for a while (the room plays on).
 // The known queue stays as it is: never empty, no row redrawn.
 await page.request.post(base+'/lab/state',{data:{snapshotStale:true}});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.owner_epoch===null,
  undefined,{timeout:15000});
 await sleep(1500);
 assert.deepEqual(await upcoming(),['Køsang 41','Køsang 42','Køsang 43'],'a stale read keeps the known queue');
 await page.request.post(base+'/lab/state',{data:{snapshotStale:false}});
 await page.waitForFunction(()=>typeof document.querySelector('pv-widget-host')?.liveMedia?.playback?.owner_epoch==='string',
  undefined,{timeout:15000});
 await sleep(1000);
 assert.deepEqual(await upcoming(),['Køsang 41','Køsang 42','Køsang 43']);
 const probe=await page.evaluate(()=>{window.stopQueueSkip=true;const p=window.queueSkipProbe;return {...p,texts:[...p.texts]};});
 const emptyFrames=probe.frames.filter(frame=>frame.upcoming+frame.placeholders===0);
 assert.deepEqual(emptyFrames,[],'the queue list is never empty');
 assert.deepEqual(probe.texts.filter(text=>/kunne ikke|ikke tilgængelig|afvist|fejl/i.test(text)),[],'no error text');
 assert.deepEqual(probe.identity,[],'a listed row keeps its DOM node');
 assert.deepEqual(probe.order,[],'rows never reorder');
 assert.ok(probe.frames.every(frame=>frame.ascending),'upcoming rows keep queue order');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',mode:'queue-skip-autoplay',frames:probe.frames.length,
  placeholderFrames:probe.frames.filter(frame=>frame.placeholders>0).length,texts:probe.texts.filter(Boolean),bundleSHA}));
}
async function defaultSpeakerJourney(){
 const viewport={width:1180,height:820},controls=[];
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
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await inertCovers(page);
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
 const repeated=page.locator('#queue button.queue-track:not([data-pv-leave])[data-current="false"]').filter({hasText:'Køsang 22'});
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
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.volume===55);
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
 // Start and queue choice use PodConnect's session commands; player taps are direct room
 // media_player calls (recorded in writes above), not session commands.
 const effects=final.nativeCalls.filter(row=>['start_room_selected_content','control_room_queue'].includes(row.service));
 assert.deepEqual(effects.map(row=>row.args.command_sequence),[3,4]);
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
async function accountRolloverJourney(){
 const host=page.locator('pv-widget-host');
 const accounts=page.locator('pv-choice-list[aria-label="Musikkonto"]');
 const queue=page.locator('#queue');
 const rows=queue.locator('button.queue-track:not([data-pv-leave])[data-current="false"]');
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
 const queue=page.locator('#queue'),rows=queue.locator('button.queue-track:not([data-pv-leave])[data-current="false"]');
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
 if(queueGeneration){
  let markHeld,release,timeout;
  const held=new Promise(resolve=>{markHeld=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const shownTask=await host.evaluate(h=>h.liveMedia.queueControls.offer.taskId);
  await page.route(endpoint,async route=>{
   const response=await route.fetch();
   markHeld(await response.json());
   await gate;
   await route.fulfill({response});
  },{times:1});
  try{
   await page.locator('#header-title-action').tap();
   await track.tap();
   const replacement=await Promise.race([held,new Promise((_,reject)=>{
    timeout=setTimeout(()=>reject(Error('queue renewal not held')),10000);
   })]);
   assert.equal(replacement.ok,true);
   assert.notEqual(replacement.taskId,shownTask);
   await chosen.waitFor({state:'visible'});
   assert.equal(await chosen.isEnabled(),true,'the displayed occurrence remains selectable during renewal');
   const result=page.waitForResponse(response=>response.url().endsWith('/music/queue/actions'));
   await chosen.tap();
   const response=await result, receipt=await response.json();
   const sent=response.request().postDataJSON();
   const owner=(await state()).nativeCalls.filter(row=>row.service==='control_room_queue');
   console.log(JSON.stringify({story:'queue-renew-generation',bundleSHA,shownTaskUsed:sent.taskId===shownTask,
    sameOccurrence:sent.optionId===first[1].id,outcome:receipt.outcome,ownerCalls:owner.length}));
   assert.equal(sent.taskId,shownTask);
   assert.equal(sent.optionId,first[1].id);
   assert.equal(receipt.outcome,'accepted');
   assert.equal(owner.length,1);
   assert.equal(owner[0].args.args.occurrence_id,first[1].id);
  }finally{clearTimeout(timeout);release();}
  return;
 }
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
     const rows=[...queue.querySelectorAll('button.queue-track:not([data-pv-leave])[data-current="false"]')]
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
 // The known rows have all played and the new source has not delivered: calm placeholders.
 await status('loading');
 assert.doesNotMatch(await page.locator('#queue-title').innerText(),/kunne ikke|ikke tilgængelig/);
 // K2: song 32 now plays, so the last-known rows 31 and 32 have played and are not upcoming.
 assert.deepEqual(await names(),[],'played rows of the last-known queue are not listed as upcoming');
 assert.equal(await rows.and(queue.locator('button:enabled')).count(),0,'last-known rows grant no actions');
 assert.equal(await queue.locator('button:not([data-pv-leave])[data-current="true"] strong').innerText(),'Isoleret sang 32');
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
 const rows=queue.locator('button.queue-track:not([data-pv-leave])[data-current="false"]');
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
   const row=event.target.closest?.('button.queue-track:not([data-pv-leave])[data-current="false"]');
   if(!event.isTrusted||!node.contains(row))return;
   const label=item=>item.querySelector('.queue-copy strong').textContent;
   const title=label(row),started=performance.now();
   requestAnimationFrame(()=>{
    const spinners=[...node.querySelectorAll('button.queue-track:not([data-pv-leave])')]
     .filter(item=>getComputedStyle(item,'::after').animationName.split(', ').includes('pv-spin'))
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
   const visible=[...node.querySelectorAll('button.queue-track:not([data-pv-leave])[data-current="false"]')]
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
   .filter(row=>getComputedStyle(row,'::after').animationName.split(', ').includes('pv-spin'))
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
   row=>getComputedStyle(row,'::after').animationName.split(', ').includes('pv-spin'),
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
   // Known rows stay as the ready queue while it is read again (owner 17/11: no reload flash).
   await status('ready');
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
   // K2: song 22 plays, so the played rows 21 and 22 are no longer listed as upcoming.
   await assertNames([23,24]);
   const third=rows.filter({hasText:'Køsang 24'});
   assert.equal(await third.isEnabled(),true,'fresh exact surviving row stays tappable with a cold tail');
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
  // Known rows stay as the ready queue while it is read again (owner 17/11: no reload flash).
  await page.waitForFunction(()=>document.querySelector('pv-widget-host').liveMedia?.queueControls?.pending===true
   &&document.querySelector('#queue').getClientRects().length>0);
  await status('ready');
  await assertNames([23,24]);
  await assertNoEmpty();
  assert.equal(await stableRow.evaluate(row=>row.isConnected&&row.getClientRects().length>0),true);
 }finally{failedRead.release();}
 // A read failure keeps the known rows as the last known queue, without error text.
 await status('stale');
 await assertNames([23,24]);
 await assertNoEmpty();
 // Musik-Koe: the title stays »Kø«; the line beside it says the queue is not updated.
 assert.equal(await page.locator('#queue-meta').innerText(),'Køen er ikke opdateret');
 assert.equal(await stableRow.evaluate(row=>row.isConnected),true);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-refresh-failed.png')});

 // A separate actual owner observation with zero upcoming rows is authoritative empty.
 await condition('empty');
 const emptyRead=await holdNext('offer');
 try{
  await close();
  await open();
  await emptyRead.wait();
  // Known rows stay as the ready queue while it is read again (owner 17/11: no reload flash).
  await page.waitForFunction(()=>document.querySelector('pv-widget-host').liveMedia?.queueControls?.pending===true
   &&document.querySelector('#queue').getClientRects().length>0);
  await status('ready');
  await assertNames([23,24]);
  await assertNoEmpty();
 }finally{emptyRead.release();}
 await page.waitForFunction(()=>document.querySelector('pv-widget-host').liveMedia?.queueControls?.pending===false);
 await status('ready');
 await assertNames([]);
 assert.equal(await queue.locator('.queue-empty').innerText(),'Ingen sange i køen.');
 assert.equal(await queue.locator('button:not([data-pv-leave])[data-current="true"] strong').innerText(),'Isoleret sang 22');
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
  MUSIC_COLD_CONTEXT:cold?'1':'0',MUSIC_COLD_REJECT:rejectSetup?'1':'0',MUSIC_QUEUE_JOURNEY:queueJourney?'1':'0',
  MUSIC_QUEUE_COLD_TAIL:queueColdTail?'1':'0',PODVIEW_TEST_NONCE:nonce,
  ...(queueIdentity?{MUSIC_OUTPUT_TRANSFER_TEST:'1',MUSIC_QUEUE_IDENTITY_TEST:'1'}:{}),
 });
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],
  {cwd:env.runtimeRoot,env:fixtureEnv,stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');
  try{if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('startup');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,nonce,'own inert runtime');
 const options=env.browserOptions();
 options.args=['--mute-audio'];
 browser=await chromium.launch(options);
 const surfaceOptions={hasTouch:true,viewport:{width:1180,height:820}};
 page=documentScope?await (await browser.newContext(surfaceOptions)).newPage():await browser.newPage(surfaceOptions);
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await inertCovers(page);
 page.on('request',request=>{
  if(request.method()==='POST'&&new URL(request.url()).pathname==='/view/api/control/actions'){
   actions.push({url:request.url(),body:request.postDataJSON()});
  }
 });
 page.on('pageerror',e=>errors.push(e.message));
 // Every Find musik read this page makes (its background prefetch included).
 page.shelfReads=[];
 page.on('response',response=>{if(new URL(response.url()).pathname==='/view/api/music/shelves'&&response.ok())
  page.shelfReads.push(response);});
 page.on('response',async r=>{
  const url=r.url();
  if(url.endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');
  if((voiceLongSession||documentScope)&&new URL(url).pathname.endsWith('/podview.css')){
   cssSHA=createHash('sha256').update(await r.body()).digest('hex');
  }
  if(!accountRollover&&(url.includes('/music/selection/')||url.includes('/music/queue/'))){
   responses.push({url,status:r.status(),body:await r.text()});
  }
 });
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/music/'))actions.push({url:r.url(),
  body:r.postDataJSON(),traceHeader:r.headers()['x-podview-trace']});});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 if(defaultSpeakerProof){await defaultSpeakerJourney();return;}
 if(cold){
  // The room's own player: nothing plays in the room yet.
  const initial=await (await page.request.get(base+'/view/api/music?kind=playback&account=account')).json();
  assert.equal(initial.ok,true);assert.equal(initial.state,'idle');
  assert.equal(initial.title,null);assert.equal(initial.uri,null);assert.equal(initial.session,null);
  const snapshot=await (await page.request.get(base+'/view/api/snapshot')).json();assert.equal(snapshot.voice.active,false);assert.equal(snapshot.voice.phase,'IDLE');assert.equal(snapshot.voice.sessionId,null);assert.equal(snapshot.admission.kind,'ha_ingress');assert.equal(snapshot.voice.turnId,null);for(const key of ['taskId','inputRevision','providerGeneration'])assert.equal(Object.hasOwn(snapshot.voice,key),false);for(const key of ['sessionId','turnId','taskId','inputRevision'])assert.equal(snapshot.answers[key],null);assert.deepEqual(snapshot.capabilities.musicActions,[]);assert.equal(snapshot.mediaRoomBindings.length,1);
  const targets=await (await page.request.get(base+'/view/api/music?kind=targets&account=account')).json();assert.deepEqual(targets.data.targets,[]);
  await env.openOverview(page);
  // CI 13/11: a background playback read greyed the speaker button for a frame, so the tap that
  // landed then was lost and the picker never opened. Once usable, it stays usable in the empty room.
  await page.locator('#output').evaluate(button=>{window.outputGreyed=[];window.homeFlash=[];new MutationObserver(()=>{
   if(button.disabled&&document.querySelector('pv-widget-host')?.liveTransport?.connected)window.outputGreyed.push(button.getAttribute('aria-label'));
  }).observe(button,{attributes:true,attributeFilter:['disabled']});
   // Green 13/11: the empty room's next read never shows "Afventer data" or a busy player.
   for(const id of ['home-music','player-empty'])new MutationObserver(()=>{const node=document.getElementById(id);
    if(/Afventer data|Henter/.test(node.textContent)||node.getAttribute('aria-busy')==='true')window.homeFlash.push(id+': '+node.textContent.trim().slice(0,60));
   }).observe(document.getElementById(id),{subtree:true,childList:true,characterData:true,attributes:true});});
  // Rest on the overview past the next background playback read (8 s) while suggestions load behind it.
  await sleep(9000);assert.deepEqual(await page.evaluate(()=>window.homeFlash),[],'the overview stays calm across background reads');
  // Green 13/11: Find musik opens with its shelves ready and usable in the first frame (read in the background).
  await shelvesRead(page);
  const firstFrame=await openFindMusik(page);
  assert(firstFrame.quick===6&&firstFrame.tiles>=20&&!firstFrame.empty&&!firstFrame.loading&&firstFrame.locked===0,
   'Find musik is ready when it opens: '+JSON.stringify(firstFrame));
  await page.locator('#output').tap();
  await page.locator('#room-options button').filter({hasText:'Køkkenalrum HomePod'}).tap();
  await page.waitForFunction(()=>!document.getElementById('rooms').open,undefined,{timeout:5000});await sleep(600);
  assert.deepEqual(await page.evaluate(()=>window.outputGreyed),[],'the speaker button never greys during background reads');
  const chosen=tile(page,'albums','Blue'),chosenUri=await chosen.getAttribute('data-uri');
  await chosen.scrollIntoViewIfNeeded();await chosen.tap();
  if(rejectSetup){
   // The refusal belongs to the tap: a toast that clears itself; nothing stays on the empty player.
   const toast=page.locator('#find-musik .find-toast');
   await toast.filter({hasText:SPEAKER_REFUSED}).waitFor({state:'visible',timeout:15000});
   await page.screenshot({path:path.join(env.artifactDir(),'podview-cold-context-rejected-toast.png')});
   await toast.waitFor({state:'hidden',timeout:6000});
   await sleep(1700);
   assert.doesNotMatch(await page.locator('#player-empty').innerText(),/kan ikke bruges/,
    'no refusal text stays on the player');
   assert.equal(await chosen.isEnabled(),true,'the tile stays usable after a refusal');
  }else{
   await page.locator('#track-name').filter({hasText:'Isoleret sang 11'}).waitFor({state:'visible',timeout:15000});
   await page.waitForFunction(()=>document.querySelector('#play-pause')?.disabled===false,undefined,{timeout:15000});
  }

  const value=await state(),commits=value.nativeCalls.filter(r=>r.service==='start_room_selected_content'),prepares=value.nativeCalls.filter(r=>r.service==='prepare_room_selected_content');
  assert.equal(commits.length,rejectSetup?0:1);assert.equal(prepares.length,rejectSetup?0:1);assert.equal(value.selections.length,rejectSetup?0:1);
  if(!rejectSetup){const args=commits[0].args;assert.equal(args.args.context_uri,chosenUri);
   assert.equal(args.action,'play_context');
   assert(actions.find(r=>r.url.endsWith('/music/selection/setup'))?.body.target.speakerId,
    'actual selected alias forwarded to owner');
   assert.equal(args.room_id,'native-room');assert.equal(args.homepod_id,'42');assert.equal(args.target_id,'device');
   assert.deepEqual(args.args,{context_uri:chosenUri,max_volume:100});assert.equal(value.state,'playing');
   assert.equal(value.volume,35);
   assert.equal(args.start_offer.start_volume_percent,35);assert.equal(value.writes.length,1);}
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
  console.log(JSON.stringify({outcome:'PASS',coldContext:true,rejectSetup,prepares:prepares.length,
   commits:commits.length,pageErrors:errors}));return;
 }
 await env.openOverview(page);
 if(voiceJourney){await voiceQueueJourney();return;}
 if(accountRollover){await accountRolloverJourney();return;}
 if(queueIdentity){await queueIdentityJourney();return;}
 if(queueSkip){await queueSkipJourney();return;}
 if(coldPlayer){await coldPlayerJourney();console.log(JSON.stringify({outcome:'PASS',mode:'cold-player'}));return;}
 if(queueJourney){await queuePersistenceJourney();return;}
 if(recentSession){await recentSessionJourney();return;}
 if(startLatency){await startLatencyJourney();return;}
 if(documentScope){await documentScopeJourney();return;}
 if(loseSelectionReceipt){await unknownAfterCommitJourney();return;}
 await findMusikJourney();
 }catch(error){if(page){try{const evidence=await page.locator('pv-widget-host').evaluate(async h=>{const t=h.liveTransport,records=[];for(const row of t?.diagnostics?.().records||[]){let requestRef;if(row.requestId){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.requestId));requestRef=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16);}records.push({seq:row.seq,atMs:row.atMs,generation:row.generation,stage:row.stage,code:row.code,domain:row.domain,endpoint:row.endpoint,current:row.current,...(requestRef?{requestRef}:{})});}const v=h.liveSelection,c=h.liveCatalogue,e=c?.entries?.get(c.key());return {events:window.selectionCiEvidence?.events||[],mutations:window.selectionCiEvidence?.mutations||[],records,dropped:t?.diagnosticDropped,scope:{focus:h.state?.focus,connected:t?.connected,generation:t?.generation,feedback:v?.feedback?.settlementStatus,pending:v?.pending,used:v?.used,musicPending:!!(h.liveControls?.musicIntentPending||h.liveControls?.player?.busy()),entry:e?{selectionSpent:e.selectionSpent,selectionExpired:e.selectionExpired,selectionUnavailable:e.selectionUnavailable,actionDispatched:e.actionDispatched,selectionConfirmed:e.selectionConfirmed,selectionSettlementStatus:e.selectionSettlementStatus}:null}};});await fs.writeFile(path.join(env.artifactDir(),'podview-music-selection-failure-evidence.json'),JSON.stringify(evidence,null,2));}catch(evidenceError){console.error('selection evidence unavailable',evidenceError.message);}console.log('failureState',JSON.stringify({service:await state(),responses,actions,ui:await page.locator('body').innerText(),selection:await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,account:h.liveMedia?.account,capabilities:h.liveSnapshot?.capabilities,feedback:h.liveSelection?.feedback&&{message:h.liveSelection.feedback.message,outcome:h.liveSelection.feedback.outcome},queueStatus:h.liveMedia?.queueControls?.status,note:h.liveSelection?.note?.textContent,offer:h.liveSelection?.offer}))}));await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection-failure.png')})}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
