'use strict';
// PodView as a Home Assistant panel, in WebKit (Safari's engine) at the wall iPad's 1180×820 with touch.
// The built panel (custom_components/podvoice/frontend) is loaded the way HA loads it: an iframe written with only a
// loader, registerIframe, the safe-area insets on the iframe's root, then `hass` on every change. `hass` is the fake
// in podview/src/lib/ha/ha-fixture.ts (bundled here with esbuild).
// 1. Hjem shows the HA area, its tiles and the room's PodConnect speaker; the safe-area inset reaches the stage.
// 2. Every tap answers at once: a lamp's switch and the speaker's play/pause show the wish within 100 ms, HA's state
//    confirms it; nothing is ever inert and no dialog is open.
// 3. A tap mid-transition wins (Lys, then Tilbage at once, ends on Hjem with only Hjem shown).
// 4. The page re-reads HA after sleep (visibilitychange/pageshow).
// 5. Bounded mounting: only Hjem, the current and the previous screen are mounted; a screen's first visit builds it
//    (a cold mount), the second finds it warm. Both transitions are measured.
// 6. A screen that throws while rendering shows »Prøv igen«; the rest keeps working, and the tap recovers it.
// 7. The loader: HA busy (the bundle answers 503 twice) delays the panel, it never fails it.
// 8. A reload while HA is disconnected: the cards are marked last known and a tap says »Ikke sendt«; the link
//    coming back clears it.
// 9. The parity screens: Musik's queue and »Afspil på«, Find musik B (AI-valgt, Stemning/Humør, search), Radio,
//    Robot (rooms, settings, recipes, journal), Bil (hero, history, wake warning, the integration's confirmation
//    step), Svar from the topbar with a live answer and »1 nyt svar«, Ro with its music button and the full-screen
//    timer alarm; each tap answers
//    and no dialog, inert or modal is left behind.
// 10. Frames: every screen transition (push and back) is sampled with requestAnimationFrame from the release;
//    a frame interval over 25 ms (1.5 vsyncs at 60 Hz) is a dropped frame. All numbers are printed (also > 17.5 and
//    > 20 ms, as the on-device meter counts them); PANEL_MAX_DROPPED (default 0) bounds the dropped frames.
// Run `npm run build` first (the journey uses the committed build output).
const playwright=require('playwright');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const {findMusicSteps}=require('./ha_panel/find-music-steps.cjs');
const {robotSteps,vehicleSteps}=require('./ha_panel/robot-vehicle-steps.cjs');
const root=path.resolve(__dirname,'../..');
const esbuild=require(path.join(root,'node_modules/esbuild'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const maxDropped=Number(process.env.PANEL_MAX_DROPPED??0);
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
 '.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.json':'application/json'};

async function serve(state){
 const fixture=esbuild.buildSync({entryPoints:[path.join(root,'podview/src/lib/ha/ha-fixture.ts')],bundle:true,
  format:'esm',write:false,target:'safari16'}).outputFiles[0].text;
 const server=http.createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost');let file=null;
  if(url.pathname==='/ha_panel/fixture.js'){response.writeHead(200,{'Content-Type':'text/javascript'});
   response.end(fixture);return;}
  // HA serves the bundle under a digest of all its files (panel.py): /podvoice_static/frontend/<digest>/...
  const versioned=/^\/podvoice_static\/frontend\/[0-9a-f]{12}\/(.+)$/.exec(url.pathname);
  if(versioned?.[1]==='podview-panel.js'&&state.failBundle>0){state.failBundle--;state.failed++;
   response.writeHead(503);response.end();return;}
  if(versioned)file=path.join(root,'custom_components/podvoice/frontend',versioned[1]);
  else if(url.pathname.startsWith('/ha_panel/'))file=path.join(__dirname,'ha_panel',url.pathname.slice(10));
  try{
   if(!file||!path.resolve(file).startsWith(root))throw Error('outside');
   const body=await fs.readFile(file);
   response.writeHead(200,{'Content-Type':TYPES[path.extname(file)]??'application/octet-stream'});response.end(body);
  }catch{response.writeHead(404);response.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return server;
}

// rAF deltas inside the panel's document from now until `ms` after the next pointerup.
const startSampling=frame=>frame.evaluate(()=>{
 const run={deltas:[],up:null,last:null,done:false};window.frameRun=run;
 addEventListener('pointerup',()=>{run.up=performance.now();},{capture:true,once:true});
 const tick=ts=>{if(run.done)return;if(run.up!==null&&run.last!==null&&ts>=run.up)run.deltas.push(ts-run.last);
  run.last=ts;if(run.up!==null&&ts-run.up>900){run.done=true;return;}requestAnimationFrame(tick);};
 requestAnimationFrame(tick);
});
const collect=async frame=>{await frame.waitForFunction(()=>window.frameRun.done,null,{timeout:5000});
 return frame.evaluate(()=>{const d=window.frameRun.deltas,sorted=[...d].sort((a,b)=>a-b);
  return {frames:d.length,over17:d.filter(x=>x>17.5).length,over20:d.filter(x=>x>20).length,
   dropped:d.filter(x=>x>25).length,
   over34:d.filter(x=>x>34).length,maxFrameMs:Math.round((sorted.at(-1)??0)*10)/10};});};

(async()=>{let server,browser;try{
 const state={failBundle:2,failed:0};
 server=await serve(state);const base=`http://127.0.0.1:${server.address().port}`;
 browser=await env.webkit();
 const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820}});
 // The fixture's Spotify covers (fixtures/music.ts, https as the panel requires) are answered here: the journey
 // never reaches the network.
 const PIXEL=Buffer.from('R0lGODlhAQABAAAAACw=','base64');
 await context.route('https://i.scdn.co/**',route=>route.fulfill({status:200,contentType:'image/gif',body:PIXEL}));
 // Opskrifter's photos are the recipe sources' own (cdn.sanity.io, the bloggers' sites): never the network either.
 await context.route(url=>url.protocol==='https:'&&url.hostname!=='i.scdn.co',route=>
  route.request().resourceType()==='image'?route.fulfill({status:200,contentType:'image/gif',body:PIXEL}):route.continue());
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
 await page.goto(base+'/ha_panel/host.html',{waitUntil:'load'});
 const frame=await (await page.waitForSelector('iframe')).contentFrame();
 const panel=page.frameLocator('iframe');
 // 7. The bundle failed twice (HA busy); the loader retried with backoff instead of giving up.
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor({timeout:15000});
 assert.equal(state.failed,2,'the bundle import failed twice before it loaded');
 errors.splice(0,errors.length,...errors.filter(text=>!/503|Failed to load resource|Importing a module|could not load/i.test(text)));
 await frame.waitForFunction(()=>document.fonts.status==='loaded');

 // 1. HA data and the safe area.
 await panel.getByRole('button',{name:/Musik.*Holocene · Bon Iver/}).waitFor();
 await panel.getByRole('article',{name:'Køkkenalrum: Spiller'}).waitFor();
 const safeTop=await frame.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--pv-safe-top-s'));
 assert.equal(parseFloat(safeTop),24,'HA\'s safe-area inset reaches the stage');
 const css=await frame.evaluate(()=>[...document.styleSheets].some(sheet=>sheet.href?.includes('/0123456789ab/podview-panel.css')));
 assert(css,'the stylesheet is linked with the module\'s version');

 const results={};
 // A finger rests ~100 ms on a control before it lifts; the panel builds a screen that is not mounted yet as the
 // finger lands (data-opens prewarm), so `hold` presses first and measures from the release, as the wall does.
 // Without `hold` the tap is instant (press and release together): the worst case for a cold mount. Results whose
 // name ends in »(instant)« are printed but not counted against PANEL_MAX_DROPPED.
 const transition=async(name,locator,back=true,{hold=false}={})=>{
  await sleep(300);
  if(hold){await locator.dispatchEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true});await sleep(100);}
  await startSampling(frame);await locator.tap();
  results[`${name} push`]=await collect(frame);
  if(!back)return;
  await sleep(300);await startSampling(frame);await panel.getByRole('button',{name:'Tilbage'}).tap();
  results[`${name} back`]=await collect(frame);
  await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 };
 const mounted=()=>frame.evaluate(()=>[...document.querySelectorAll('.pv-panel-screen')].map(node=>node.dataset.screen));

 // 2. Lys: the wish within 100 ms of the tap, HA's state confirms it. The first visit builds Lys (cold mount).
 assert.deepEqual(await mounted(),['home'],'only Hjem is mounted at start');
 await transition('Lys (cold)',panel.getByRole('button',{name:/^Lys/}),false,{hold:true});
 const lamp=panel.getByRole('switch',{name:/Køkkenø/});
 // A finger taps the lamp's row: the label around the switch's (visually hidden) checkbox.
 const row=control=>control.locator('xpath=ancestor::label[1]');
 assert.equal(await lamp.isChecked(),false);
 // The switch is a native checkbox (role=switch) in the row's label; the row shows the wish as data-selected.
 const wishLatency=await (async()=>{
  const pending=frame.evaluate(()=>new Promise(resolve=>{
   const input=[...document.querySelectorAll('[role=switch]')]
    .find(el=>el.getAttribute('aria-label').startsWith('Køkkenø'));
   const row=input.closest('label');
   let up=null;addEventListener('pointerup',()=>{up=performance.now();},{capture:true,once:true});
   new MutationObserver((_,observer)=>{if(input.checked&&row.hasAttribute('data-selected')){observer.disconnect();
    resolve(performance.now()-(up??performance.now()));}}).observe(row,{attributes:true});}));
  await row(lamp).tap();return pending;})();
 assert(wishLatency<100,`lamp wish shown ${wishLatency} ms after the release`);
 await page.waitForFunction(()=>window.fakeHass.hass.states['light.kokken_o'].state==='on');
 await panel.getByRole('switch',{name:/Køkkenø: Tændt/}).waitFor();
 // (The answer card's hidden parts inside <pv-answer> are inert by the wall page's design; they lock nothing.)
 assert.equal(await frame.evaluate(()=>[...document.querySelectorAll('[inert],dialog[open]')]
  .filter(node=>!node.closest('pv-answer')).length),0);
 await sleep(300);await startSampling(frame);await panel.getByRole('button',{name:'Tilbage'}).tap();
 results['Lys back']=await collect(frame);
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();

 // Musik: pause in the room's player, shown at once; the next tap is never blocked.
 const aside=panel.getByRole('complementary',{name:'Rummets musik'});
 await aside.getByRole('button',{name:'Pause'}).tap();
 await aside.getByRole('button',{name:'Afspil'}).waitFor({timeout:100});
 await aside.getByRole('button',{name:'Afspil'}).tap();
 await aside.getByRole('button',{name:'Pause'}).waitFor({timeout:100});
 await page.waitForFunction(()=>window.fakeHass.calls.filter(c=>c.domain==='media_player').length===2);

 // The other screens: the first visit is a cold mount, the next one finds the screen warm (the previous screen).
 for(const [name,tile] of [['Musik',/^Musik/],['Vejr',/Let skyet/],['Timer',/^Timer/]]){
  await transition(`${name} (cold)`,panel.getByRole('button',{name:tile}),true,{hold:true});
  await transition(`${name} (warm)`,panel.getByRole('button',{name:tile}));
 }
 // The worst case: Vejr let go (Lys is now previous) and opened by an instant tap, no prewarm.
 await transition('Lys (cold again)',panel.getByRole('button',{name:/^Lys/}),true,{hold:true});
 await transition('Vejr (instant)',panel.getByRole('button',{name:/Let skyet/}));
 // 5. Bounded: Hjem and the previous screen (Vejr) only.
 assert.deepEqual(await mounted(),['home','weather']);

 // 9. Parity screens.
 const noLock=async where=>assert.deepEqual(await frame.evaluate(()=>
  [...document.querySelectorAll('[inert],dialog[open]')].filter(node=>!node.closest('pv-answer'))
   .map(node=>`${node.tagName}#${node.id}.${node.className}`)),[],`nothing inert after ${where}`);
 // Musik: the queue plays a row once; »Afspil på« opens and closes on taps.
 await panel.getByRole('button',{name:/^Musik/}).first().tap();
 const music=panel.locator('#music-view');
 await music.getByRole('button',{name:/^Afspil 2 · /}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.filter(c=>c.service==='music_queue_play').length===1);
 await sleep(300);await startSampling(frame);
 await music.getByRole('button',{name:/^Afspil på|Køkkenalrum/}).first().tap();
 results['Afspil på open']=await collect(frame);
 await panel.getByRole('dialog',{name:'Afspil på'}).getByRole('button',{name:'Luk'}).tap();
 await noLock('Afspil på');
 await transition('Find musik (cold)',music.getByRole('button',{name:'Vælg musik'}),false,{hold:true});
 await panel.locator('#find-view').getByRole('button',{name:/^Afspil /}).first().waitFor();
 // Find musik B: »AI-valgt« with its reason, Stemning/Humør, search (tests/browser/ha_panel/find-music-steps.cjs).
 await findMusicSteps(page,{sleep,assert});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await transition('Radio (cold)',music.getByRole('button',{name:'Radio',exact:true}),false,{hold:true});
 await panel.locator('#radio-view').getByRole('button',{name:/^P3/}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='radio_command'&&c.data.action==='start'));
 await panel.locator('#radio-view').getByRole('button',{name:/^Stop/}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='radio_command'&&c.data.action==='stop'));
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Robot: a command from the integration's admitted actions, sent once (the robot is cleaning).
 await page.evaluate(()=>{window.fakeHass.patch('vacuum.qrevo','cleaning');});
 await transition('Robot (cold)',panel.locator('#home-robot'),false,{hold:true});
 const robotAction=panel.locator('#robot-view [data-action-id]').first();
 await robotAction.tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='robot_command'));
 await noLock('Robot');
 // Rooms, settings, recipes and the journal (tests/browser/ha_panel/robot-vehicle-steps.cjs).
 await robotSteps(page,{sleep,assert});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Opskrifter (O1, O4, O7): the catalogue is there in the first frame (read when the page started), a recipe opens,
 // starts, ticks its first step, shows »Fortsæt« over the catalogue and ends with »Afslut opskrift«.
 const recipeReads=()=>page.evaluate(()=>window.fakeHass.calls.filter(c=>c.service==='recipes_snapshot').length);
 const readsBefore=await recipeReads();
 assert.ok(readsBefore>=1,'the catalogue is read when the page starts');
 await transition('Opskrifter (cold)',panel.locator('#home-recipes'),false,{hold:true});
 const recipes=panel.locator('#recipes-view');
 assert.equal(await recipes.locator('.recipe-card').count(),8,'the catalogue in the first frame');
 await transition('Opskrift (cold)',recipes.getByRole('button',{name:/^Burgerboller/}),false,{hold:true});
 const recipe=panel.locator('#recipe-view');
 await recipe.getByRole('button',{name:'Start opskrift'}).tap();
 await recipe.getByText('Trin 1 af 5 · af Meyers').waitFor({timeout:300});
 await recipe.locator('.recipe-step-check').first().tap();
 await recipe.getByText('Trin 2 af 5 · af Meyers').waitFor({timeout:300});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await recipes.getByRole('button',{name:/^Fortsæt Burgerboller, Trin 2 af 5/}).tap();
 await recipe.getByRole('button',{name:'Afslut opskrift'}).tap();
 await recipe.getByRole('button',{name:'Start opskrift'}).waitFor({timeout:300});
 await noLock('Opskrifter');
 assert.equal(await recipeReads(),readsBefore,'opening Opskrifter reads nothing: the catalogue was read at start');
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Bil: a risky action asks for the integration's confirmation, then sends the token once.
 await transition('Bil (cold)',panel.locator('#home-vehicle'),false,{hold:true});
 await panel.locator('#vehicle-view').getByRole('button',{name:'Lås op'}).tap();
 const ask=panel.getByRole('alertdialog',{name:'Lås bilen op?'});
 await ask.waitFor();
 await ask.getByRole('button',{name:'Lås op'}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='vehicle_command'&&c.data.confirmation));
 await sleep(400);
 await noLock('Bil');
 // The old hero with the battery dots, »Seneste hændelser« and the wake warning before lock.
 await vehicleSteps(page,{sleep,assert});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Svar from the topbar.
 await transition('Svar (cold)',panel.getByRole('button',{name:'Se tidligere svar'}),true,{hold:true});
 await transition('Svar (warm)',panel.getByRole('button',{name:'Se tidligere svar'}));
 // Svar live: GPT-Live gives an answer while an older one is read: it is pushed (never polled), counted in
 // »↑ 1 nyt svar«, and the key jumps to it.
 await panel.getByRole('button',{name:'Se tidligere svar'}).tap();
 const svar=panel.locator('#answers-view');
 await svar.getByRole('button',{name:/En rolig morgen/}).tap();
 await page.evaluate(()=>{window.addonAnswers.live=true;window.fakeHass.pushAll('podvoice/answers_subscribe');});
 const newer=svar.getByRole('button',{name:'Vis nyeste svar · 1 nyt svar'});
 await newer.waitFor({timeout:300});
 // The key enters with the kit's spring (ui-kit.css pv-enter-up); a finger meets it once it stands.
 // It is the topmost element under its own centre (nothing covers it), and the finger lands there.
 await frame.waitForFunction(()=>{const key=document.querySelector('.svar-today-new');
  if(!key||key.getAnimations().length)return false;const r=key.getBoundingClientRect();
  return key.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
 await sleep(300);await startSampling(frame);await newer.tap();
 results['Svar nyt svar']=await collect(frame);
 await svar.locator('.svar-today-row[data-live=true][aria-current=true]').waitFor({timeout:300});
 await newer.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.fakeHass.calls.filter(c=>c.service==='answers_snapshot').length),0,
  'Svar is pushed, never read with a service call');
 assert.equal(await page.evaluate(()=>window.fakeHass.calls.filter(c=>c.service==='radio_state').length),0,
  'Radio is pushed, never polled');
 await noLock('Svar');
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Ro's music button: the room's track with play/pause (the wish at once, Ro stays); the card wakes to Musik.
 // (Radio's Stop above left the speaker idle; the room's speaker plays a track again.)
 await page.evaluate(()=>{window.fakeHass.patch('media_player.kokkenalrum','playing',
  {media_title:'Holocene',media_artist:'Bon Iver',podconnect_source:'spotify',supported_features:1|4|16|32|16384});});
 await panel.getByRole('button',{name:'Gå til Ro'}).tap();
 const restPlayer=panel.locator('.pv-rest-player');
 await restPlayer.waitFor();
 const restKey=restPlayer.getByRole('button',{name:/^(Pause|Afspil)$/});
 const restLabel=await restKey.getAttribute('aria-label');
 await restKey.tap();
 await restPlayer.getByRole('button',{name:restLabel==='Pause'?'Afspil':'Pause'}).waitFor({timeout:100});
 await frame.waitForSelector('#photo-view',{state:'visible'});
 // The finger rests on the card first (as `transition` holds): Musik is built as it lands.
 const restOpen=restPlayer.getByRole('button',{name:/^Åbn Musik/});
 await sleep(300);
 await restOpen.dispatchEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true});await sleep(100);
 await startSampling(frame);await restOpen.tap();
 results['Ro → Musik']=await collect(frame);
 await panel.locator('#music-view').waitFor();
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 await noLock('Ro musik');
 // Ro from the topbar, a tap wakes it to Hjem.
 await sleep(300);await startSampling(frame);await panel.getByRole('button',{name:'Gå til Ro'}).tap();
 results['Ro in']=await collect(frame);
 await frame.waitForSelector('#photo-view',{state:'visible'});
 await sleep(300);await startSampling(frame);await panel.locator('#photo-view').tap();
 results['Ro out']=await collect(frame);
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 await noLock('Ro');

 // 3. Last tap wins mid-transition.
 await panel.getByRole('button',{name:/^Lys/}).tap();
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 await sleep(700);
 // Exactly one screen is shown; the mounted others are invisible (never inert).
 assert.deepEqual(await frame.evaluate(()=>[...document.querySelectorAll('.pv-panel-screen')]
  .filter(node=>Number(getComputedStyle(node).opacity)>0.01).map(node=>node.dataset.screen)),['home']);
 assert.deepEqual(await frame.evaluate(()=>[...document.querySelectorAll('.pv-panel-screen')]
  .filter(node=>!node.hasAttribute('aria-hidden')).map(node=>node.dataset.screen)),['home']);

 // 4. Sleep and wake: HA's state changed while hidden; the page shows it after visibilitychange.
 await page.evaluate(()=>{window.fakeHass.patch('light.kokken_loft','off');});
 await frame.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await panel.getByRole('button',{name:/Lys.*1 af 2 tændt/}).waitFor();

 // 6. A render error in Lys (a light whose colour modes cannot be read) stays inside Lys.
 await panel.getByRole('button',{name:/^Lys/}).tap();
 await panel.getByRole('switch',{name:/Køkkenø/}).waitFor();
 await page.evaluate(()=>{const modes=['onoff'];modes.some=()=>{throw new Error('journey: unreadable colour modes');};
  window.fakeHass.patch('light.kokken_o',null,{supported_color_modes:modes});});
 await panel.getByText('Skærmen kunne ikke vises').waitFor();
 await panel.getByRole('complementary',{name:'Rummets musik'}).getByRole('button',{name:/Pause|Afspil/}).waitFor();
 await page.evaluate(()=>{window.fakeHass.patch('light.kokken_o',null,{supported_color_modes:['onoff']});});
 await panel.getByRole('button',{name:'Prøv igen'}).tap();
 await panel.getByRole('switch',{name:/Køkkenø/}).waitFor();
 assert(await page.evaluate(()=>window.fakeHass.ws.some(m=>m.type==='podvoice/panel_report'&&m.kind==='boundary')),
  'the render error reached HA\'s log');
 errors.splice(0,errors.length,...errors.filter(text=>!/journey: unreadable colour modes/.test(text)));
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();

 // 8. Reload while HA is disconnected (HA also tears a hidden panel down after 5 min: a cold start).
 state.failBundle=0;
 await page.goto(base+'/ha_panel/host.html?connected=0&area=stue',{waitUntil:'load'});
 const cold=page.frameLocator('iframe');
 await cold.getByRole('heading',{level:1,name:'Stue'}).waitFor();
 await cold.getByText('Sidst kendt · ingen forbindelse til Home Assistant').first().waitFor();
 await cold.getByRole('button',{name:/^Lys/}).tap();
 await row(cold.getByRole('switch',{name:/Stuelampe/})).tap();
 await cold.getByText('Ikke sendt – ingen forbindelse').waitFor({timeout:300});
 assert.equal(await cold.getByText(/Udfald ukendt/).count(),0);
 assert.equal(await page.evaluate(()=>window.fakeHass.calls.length),0,'nothing was sent without a link');
 await page.evaluate(()=>{window.fakeHass.setConnected(true);});
 await cold.getByText('Sidst kendt · ingen forbindelse til Home Assistant').first().waitFor({state:'detached'});
 await cold.getByText(/PodVoice 0\.1\.\d+ · build \d+\.\d+\.\d+ · 0123456789ab/).waitFor();

 assert.deepEqual(errors,[]);
 console.log('Frames (WebKit, 1180×820, touch):');
 for(const [name,r] of Object.entries(results))
  console.log(`  ${name.padEnd(22)} frames ${String(r.frames).padStart(3)}  >17.5ms ${r.over17}  >20ms ${r.over20}`+
   `  dropped(>25ms) ${r.dropped}  >34ms ${r.over34}  max ${r.maxFrameMs} ms`);
 const dropped=Object.entries(results).filter(([name])=>!name.includes('(instant)'))
  .reduce((sum,[,r])=>sum+r.dropped,0);
 assert(dropped<=maxDropped,`${dropped} dropped frames (> 25 ms) over all transitions`);
 console.log('ha_panel_actual_e2e: ok');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.close();}})();
