'use strict';
// PodView as a Home Assistant panel, in WebKit (Safari's engine) at the wall iPad's 1180×820 with touch.
// The built panel (custom_components/podvoice/frontend) is loaded the way HA loads it: an iframe written with only a
// loader, registerIframe, the safe-area insets on the iframe's root, then `hass` on every change. `hass` is the fake
// in podview/src/lib/ha/ha-fixture.ts (bundled here with esbuild).
// 1. Hjem shows the HA area, its tiles and the room's PodConnect speaker; the safe-area inset reaches the stage.
// 2. Every tap answers at once: a lamp's switch and the speaker's play/pause show the wish within 100 ms, HA's state
//    confirms it; nothing is inert but the stack's hidden screens (G7 #19) and Ro waiting unseen, and no dialog is open.
// 3. A tap mid-transition wins (Lys, then Tilbage at once, ends on Hjem with only Hjem shown).
// 4. The page re-reads HA after sleep (visibilitychange/pageshow).
// 5. Bounded mounting: only Hjem, the current and the previous screen are mounted; a screen's first visit builds it
//    (a cold mount), the second finds it warm. Both transitions are measured.
// 6. A screen that throws while rendering shows »Prøv igen«; the rest keeps working, and the tap recovers it.
// 7. The loader: HA busy (the bundle answers 503 twice) delays the panel, it never fails it.
// 8. A reload while HA is disconnected: the cards are marked last known and a tap says »Ikke sendt«; the link
//    coming back clears it.
// 9. The parity screens: Musik's queue and »Afspil på« (also pulled down to close), Find musik B (AI-valgt, Stemning/Humør, search), Radio (P1 first, starter → needle, Stop in the player and on Ro),
//    Robot (rooms, settings, recipes, journal), Bil (hero, history, wake warning, the integration's confirmation
//    step), Svar from the topbar with a live answer and »1 nyt svar«, Ro with its music button and the full-screen
//    timer alarm; each tap answers
//    and no dialog, inert or modal is left behind.
// 10. Frames: every screen transition (push and back) is sampled with requestAnimationFrame from the release;
//    a frame interval over 25 ms (1.5 vsyncs at 60 Hz) is a dropped frame. All numbers are printed (also > 17.5 and
//    > 20 ms, as the on-device meter counts them); PANEL_MAX_DROPPED (default 0) bounds the dropped frames.
// 3b. No swipe back: a drag from the column's left edge stays on the screen; »Tilbage« goes back.
// 11. Reduced motion: a transition is a short cross-fade; nothing slides.
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
// PANEL_FRAMES_EACH=1 prints each transition as it is measured (a run that fails later still shows its frames).
const collect=async frame=>{await frame.waitForFunction(()=>window.frameRun.done,null,{timeout:5000});
 const r=await frame.evaluate(()=>{const d=window.frameRun.deltas,sorted=[...d].sort((a,b)=>a-b);
  return {frames:d.length,over17:d.filter(x=>x>17.5).length,over20:d.filter(x=>x>20).length,
   dropped:d.filter(x=>x>25).length,
   over34:d.filter(x=>x>34).length,maxFrameMs:Math.round((sorted.at(-1)??0)*10)/10,
   firstMs:Math.round((d[0]??0)*10)/10,
   firstMaxMs:Math.round(Math.max(0,...d.slice(0,4))*10)/10};});
 return r;};

(async()=>{let server,browser;try{
 const state={failBundle:2,failed:0};
 server=await serve(state);const base=`http://127.0.0.1:${server.address().port}`;
 browser=await env.webkit();
 const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820}});
 // The wall clock starts on a fixed afternoon and runs on from there: Ro has its day look (its music card is hidden
 // 21-07 Copenhagen) whenever the journey runs. Only Date moves: Playwright's context.clock would also take over
 // timers, requestAnimationFrame and performance, which the frame measurements and motion here must keep real.
 await context.addInitScript(start=>{
  const Real=Date,offset=start-Real.now();
  globalThis.Date=class extends Real{
   constructor(...args){if(args.length)super(...args);else super(Real.now()+offset);}
   static now(){return Real.now()+offset;}
  };
 },Date.parse('2026-11-19T16:24:00+01:00'));
 // The fixture's Spotify covers (fixtures/music.ts, https as the panel requires) are answered here: the journey
 // never reaches the network.
 const PIXEL=Buffer.from('R0lGODlhAQABAAAAACw=','base64');
 await context.route('https://i.scdn.co/**',route=>route.fulfill({status:200,contentType:'image/gif',body:PIXEL}));
 // Opskrifter's photos are the recipe sources' own (cdn.sanity.io, the bloggers' sites): never the network either.
 await context.route(url=>url.protocol==='https:'&&url.hostname!=='i.scdn.co',route=>
  route.request().resourceType()==='image'?route.fulfill({status:200,contentType:'image/gif',body:PIXEL}):route.continue());
 // Ro's shared album: the integration's authenticated view (/api/podvoice/photos/<id>?…&authSig=…) answers with the
 // cached photo; here the panel's own photo stands in for each.
 const PHOTO=await fs.readFile(path.join(root,'podview/public/ambient.webp'));
 const photoReads=[];
 await context.route(url=>url.pathname.startsWith('/api/podvoice/photos/'),route=>{
  photoReads.push(new URL(route.request().url()).pathname);
  return route.fulfill({status:200,contentType:'image/webp',body:PHOTO,
   headers:{'Cache-Control':'private, max-age=31536000, immutable',ETag:'"photo"'}});
 });
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
 await panel.getByRole('button',{name:/^Vis kø · Holocene af Bon Iver/}).waitFor();
 await panel.getByRole('button',{name:'Musik, Regnvejr og torsdag aften'}).waitFor();
 await panel.getByRole('article',{name:'Køkkenalrum: Spiller'}).waitFor();
 const safeTop=await frame.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--pv-safe-top'));
 assert.equal(parseFloat(safeTop),24,'HA\'s safe-area inset reaches the stage');
 // The stage fits the frame with its insets (24 top, 20 bottom): the 24 px margins absorb them, so the canvas stays
 // 1:1 with the topbar's keys 24 from the top and Hjem's three full rows (104–796) unclipped.
 const fit=await frame.evaluate(()=>{
  const grid=document.querySelector('#home-view > .grid');const ro=document.querySelector('nav[aria-label="Visning"] button');
  const cells=[...grid.children].map(cell=>cell.getBoundingClientRect());
  return {top:ro.getBoundingClientRect().top,gridTop:grid.getBoundingClientRect().top,
   bottom:Math.max(...cells.map(r=>r.bottom)),clipped:[...grid.children].filter(cell=>{const child=cell.firstElementChild;
    return child&&child.getBoundingClientRect().height>cell.getBoundingClientRect().height+0.5;}).length,
   rows:grid.getBoundingClientRect().height,height:window.innerHeight};
 });
 assert.deepEqual([Math.round(fit.top),Math.round(fit.gridTop),Math.round(fit.bottom),fit.clipped,Math.round(fit.rows)],
  [24,104,796,0,692],`the stage fits with the safe areas, Hjem unclipped: ${JSON.stringify(fit)}`);
 const css=await frame.evaluate(()=>[...document.styleSheets].some(sheet=>sheet.href?.includes('/0123456789ab/podview-panel.css')));
 assert(css,'the stylesheet is linked with the module\'s version');

 const results=new Proxy({},{set(all,name,r){all[name]=r;
  if(process.env.PANEL_FRAMES_EACH)console.log(`  frames ${String(name)} ${JSON.stringify(r)}`);return true;}});
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
 const mounted=()=>frame.evaluate(()=>[...document.querySelectorAll('[data-screen]')].map(node=>node.dataset.screen));

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
    .find(el=>el.getAttribute('aria-label')==='Tænd Køkkenø');
   const row=input.closest('label');
   let up=null;addEventListener('pointerup',()=>{up=performance.now();},{capture:true,once:true});
   new MutationObserver((_,observer)=>{if(input.checked&&row.hasAttribute('data-selected')){observer.disconnect();
    resolve(performance.now()-(up??performance.now()));}}).observe(row,{attributes:true});}));
  await row(lamp).tap();return pending;})();
 assert(wishLatency<100,`lamp wish shown ${wishLatency} ms after the release`);
 await page.waitForFunction(()=>window.fakeHass.hass.states['light.kokken_o'].state==='on');
 await panel.getByRole('switch',{name:'Sluk Køkkenø'}).waitFor();
 // L1: a tap on a room card chooses the room and never switches it; its switch powers the room's Hue group.
 const calls=()=>page.evaluate(()=>window.fakeHass.calls.filter(c=>['light','scene'].includes(c.domain))
  .map(c=>`${c.service} ${c.entityId}`));
 const before=(await calls()).length;
 await panel.locator('[data-room-id="stue"] button').first().tap();
 await panel.getByRole('region',{name:'Stue'}).waitFor();
 assert.equal((await calls()).length,before,'choosing a room switches nothing');
 await row(panel.getByRole('switch',{name:'Sluk alle lys i Stue'})).tap();
 await page.waitForFunction(()=>window.fakeHass.hass.states['light.stue_lampe'].state==='off');
 assert.deepEqual((await calls()).slice(before),['turn_off light.stue_stue'],'the room switch is its group');
 // A Hue scene: chosen at once, run once, and Hue's scene select confirms it.
 await panel.locator('[data-room-id="kokken"] button').first().tap();
 const scene=panel.getByRole('group',{name:'Scener i Køkkenalrum'}).getByRole('button',{name:/^Læs/});
 await scene.tap();
 assert.equal(await scene.getAttribute('aria-pressed'),'true');
 await page.waitForFunction(()=>window.fakeHass.hass.states['select.kokkenalrum_kokkenalrum_scene'].state==='Læs');
 assert.deepEqual((await calls()).slice(before+1),['turn_on scene.kokkenalrum_kokkenalrum_laes']);
 assert.equal(await frame.evaluate(()=>document.querySelectorAll('[inert]:not([data-screen]:not([data-place=center])):not([data-rest][data-place=waiting]),dialog[open]').length),0);
 await sleep(300);await startSampling(frame);await panel.getByRole('button',{name:'Tilbage'}).tap();
 results['Lys back']=await collect(frame);
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();

 // Musik: pause in the room's player, shown at once; the next tap is never blocked.
 const aside=panel.getByRole('complementary',{name:'Rummets musik'});
 // The wish is measured in the page, from the finger's release to the key's new name (state, not the test
 // runner's round trip to a remote browser).
 const keyLatency=async(from,to)=>{
  const pending=frame.evaluate(([from,to])=>new Promise(resolve=>{
   const aside=document.querySelector('aside[aria-label="Rummets musik"]');
   let up=null;addEventListener('pointerup',()=>{up=performance.now();},{capture:true,once:true});
   new MutationObserver((_,observer)=>{if(aside.querySelector(`button[aria-label="${to}"]`)){observer.disconnect();
    resolve(performance.now()-(up??performance.now()));}}).observe(aside,{subtree:true,attributes:true,childList:true});
  }),[from,to]);
  await aside.getByRole('button',{name:from}).tap();
  const ms=await pending;
  assert(ms<100,`${to} shown ${ms} ms after the release`);
 };
 await keyLatency('Pause','Afspil');
 await keyLatency('Afspil','Pause');
 await page.waitForFunction(()=>window.fakeHass.calls.filter(c=>c.domain==='media_player').length===2);

 // The other screens: the first visit is a cold mount, the next one finds the screen warm (the previous screen).
 for(const [name,tile] of [['Musik',/^Vis kø/],['Vejr',/Let skyet/],['Timer',/^Timer/]]){
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
  [...document.querySelectorAll('[inert]:not([data-screen]:not([data-place=center])):not([data-rest][data-place=waiting]),dialog[open]')]
   .map(node=>`${node.tagName}#${node.id}.${node.className}`)),[],`nothing inert after ${where}`);
 // Afspiller: the queue plays a row once; the room sheet (its »Afspil på«) opens from the player's room key and
 // closes on taps.
 await panel.getByRole('button',{name:/^Vis kø/}).first().tap();
 const music=panel.locator('#music-view');
 await music.getByRole('button',{name:/^Afspil 2 · /}).waitFor();await sleep(400);
 // G7 #4: frame by frame from the tap until the list settles: no row goes current → not current → current (row 1
 // keeps its mark until the speaker confirms), and no song is shown twice at once (the chosen row itself moves up).
 await frame.evaluate(()=>{window.queueTrace=[];const t0=performance.now();const tick=()=>{
  window.queueTrace.push([...document.querySelectorAll('#queue [data-current]')].map(row=>({
   title:row.querySelector('span.truncate')?.textContent??'',current:row.getAttribute('data-current')==='true',
   mark:row.getAttribute('data-mark'),seen:Number(getComputedStyle(row.parentElement).opacity)>0.05})));
  if(performance.now()-t0<2200)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 await music.getByRole('button',{name:/^Afspil 2 · /}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.filter(c=>c.service==='music_queue_play').length===1);
 await sleep(2400);
 {const trace=await frame.evaluate(()=>window.queueTrace);
  const row1=[];for(const rows of trace){const first=rows.find(row=>row.current&&row.seen);
   const key=first?`${first.title}|${first.mark}`:'none';if(row1.at(-1)!==key)row1.push(key);}
  assert.equal(row1.length,2,`row 1 changes once, from the old song to the chosen one: ${row1.join(' → ')}`);
  assert(row1.every(key=>/\|(playing|paused)$/.test(key)),`row 1 always has its mark: ${row1.join(' → ')}`);
  const twice=trace.flatMap((rows,index)=>{const seen=rows.filter(row=>row.seen).map(row=>row.title);
   return seen.filter((title,at)=>seen.indexOf(title)!==at).map(title=>`${index}:${title}`);});
  assert.deepEqual(twice,[],'no song is shown twice in any frame');}
 await sleep(300);await startSampling(frame);
 const roomKey=panel.getByRole('complementary',{name:'Rummets musik'}).getByRole('button',{name:/^Rum: /});
 await roomKey.tap();
 results['Afspil på open']=await collect(frame);
 await panel.getByRole('dialog',{name:'Vælg rum'}).getByRole('group',{name:'Højttalere'}).waitFor();
 await panel.getByRole('dialog',{name:'Vælg rum'}).getByRole('button',{name:'Luk'}).tap();
 await noLock('Afspil på');
 // Pull to close: a finger on the sheet's title drags it down; a short slow pull springs back, a long one closes it.
 const pull=async(distance,pause)=>{
  await roomKey.tap();
  const sheet=panel.getByRole('dialog',{name:'Vælg rum'});
  await sheet.waitFor();await sleep(600);
  const title=await sheet.getByRole('heading',{name:'Vælg rum'}).boundingBox();
  const x=title.x+title.width/2,y=title.y+title.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=8;i++){await page.mouse.move(x,y+distance*i/8);if(pause)await sleep(pause);}
  await page.mouse.up();return sheet;};
 const held=await pull(40,60);
 await sleep(700);
 assert(await held.isVisible(),'a short slow pull springs the sheet back');
 await held.getByRole('button',{name:'Luk'}).tap();
 await held.waitFor({state:'detached'});
 const thrown=await pull(260,0);
 await thrown.waitFor({state:'detached',timeout:2000});
 await noLock('Afspil på pulled');
 // The speaker key mutes (A-Player): the cross shows at once, the level goes to 0, a second tap brings it back.
 const aside2=panel.getByRole('complementary',{name:'Rummets musik'});
 await aside2.getByRole('button',{name:'Slå lyd fra'}).tap();
 await aside2.getByRole('button',{name:'Slå lyd til'}).waitFor({timeout:100});
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='volume_set'&&c.data.volume_level===0));
 await aside2.getByRole('button',{name:'Slå lyd til'}).tap();
 await aside2.getByRole('button',{name:'Slå lyd fra'}).waitFor({timeout:1000});
 // Find musik and Radio open from Hjem's tiles (Afspiller has no »Vælg musik« or »Radio« pills: Musik-Koe).
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 await transition('Find musik (cold)',panel.locator('#home-view').getByRole('button',{name:/^Musik, /}),false,
  {hold:true});
 await panel.locator('#find-view').getByRole('button',{name:/^Afspil /}).first().waitFor();
 // Find musik B: »AI-valgt« with its reason, Stemning/Humør, search (tests/browser/ha_panel/find-music-steps.cjs).
 await findMusicSteps(page,{sleep,assert});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await transition('Radio (cold)',panel.locator('#home-view').getByRole('button',{name:/^Radio, /}),false,{hold:true});
 // Radio (A-Radio): the stations read P1 first; a tile starts its station (»starter« at once, the needle on the
 // scale once the speaker plays it); Stop is the player's (the radio plays through it).
 const radioView=panel.locator('#radio-view');
 assert.deepEqual(await radioView.getByRole('group',{name:'Stationer'}).getByRole('button')
  .evaluateAll(tiles=>tiles.map(tile=>tile.getAttribute('data-station'))),
 ['p1','p3','p4-ostjylland','p6-beat','p8-jazz'],'the stations read P1 first (owner, 25 Nov)');
 // Every phase the hero passes through, from the tap on (the fake speaker confirms fast).
 await frame.evaluate(()=>{const hero=document.querySelector('#radio-view [data-radio-phase]');window.radioPhases=[];
  new MutationObserver(()=>window.radioPhases.push(hero.getAttribute('data-radio-phase')))
   .observe(hero,{attributes:true,attributeFilter:['data-radio-phase']});});
 await radioView.getByRole('button',{name:/^P3/}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='radio_command'&&c.data.action==='start'));
 await frame.waitForSelector('#radio-view [data-radio-phase=spiller] [data-needle]');
 assert.deepEqual((await frame.evaluate(()=>window.radioPhases)).slice(0,2),['starter','spiller'],
  'the hero shows »Starter P3…« before the speaker confirms');
 await aside.getByText('DIREKTE',{exact:false}).first().waitFor();
 await aside.getByRole('button',{name:'Stop'}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='radio_command'&&c.data.action==='stop'));
 await frame.waitForSelector('#radio-view [data-radio-phase=vaelg]');
 assert.equal(await frame.locator('#radio-view [data-needle]').count(),0,'no needle once the radio stops');
 // Ro's radio card: P1 plays; on Foto-Ro the music card has »Stop radio«, and Ro stays.
 await radioView.getByRole('button',{name:/^P1 /}).tap();
 await frame.waitForSelector('#radio-view [data-radio-phase=spiller]');
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Timer (A-Timer, Timer-Alarm): a preset fills the draft, »Start timer« starts it, the face counts down with
 // ±1 min; the bridge finishes it, the full-screen alarm covers the page with »+1 min«, which stops the alarm and
 // starts one minute (T1, T3). Every tap answers; nothing is left inert.
 const timerCalls=()=>page.evaluate(()=>window.fakeHass.calls.filter(c=>c.service==='timer_command_v2')
  .map(c=>c.data.action));
 await panel.locator('#home-timers').tap();
 const timersView=panel.locator('#timers-view');
 await timersView.getByRole('button',{name:'3 min'}).tap();
 assert.equal(await timersView.getByRole('status',{name:'Valgt tid'}).textContent(),'3:00');
 await timersView.getByRole('button',{name:'Start timer'}).tap();
 const face=timersView.getByRole('article',{name:/^Timer · /});
 await face.getByText(/^Færdig kl\. /).waitFor();
 await face.getByRole('button',{name:'1 minut mere'}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='timer_command_v2'&&c.data.action==='adjust'));
 await page.evaluate(()=>window.fakeHass.finishTimers());
 const alarm=panel.getByRole('alertdialog',{name:'Timeren er færdig'});
 await alarm.waitFor();
 assert.match(await alarm.locator('#timer-alert-kicker').textContent(),/^Timer · \d+ min · ringede \d\d\.\d\d$/);
 await alarm.getByRole('button',{name:'1 minut mere'}).tap();
 await alarm.waitFor({state:'detached',timeout:3000});
 assert.deepEqual((await timerCalls()).slice(-2),['acknowledge_finished','start']);
 await timersView.getByRole('article',{name:/^Timer · 1:00|^Timer · 0:5/}).waitFor();
 await timersView.getByRole('button',{name:'Annuller timer'}).tap();
 await timersView.getByRole('form',{name:'Ny timer'}).waitFor();
 await noLock('Timer');
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 await panel.getByRole('button',{name:'Radio, P1'}).waitFor();
 await panel.getByRole('button',{name:'Gå til Ro'}).tap();
 await panel.locator('[data-rest-player=radio]').getByRole('button',{name:'Stop radio'}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.filter(c=>c.service==='radio_command'&&c.data.action==='stop')
  .length===2);
 await frame.waitForSelector('#photo-view',{state:'visible'});
 await panel.locator('#photo-view').tap();
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
 assert.equal(await recipes.getByRole('list',{name:'Alle opskrifter'}).getByRole('button').count(),8,
  'the catalogue in the first frame');
 await transition('Opskrift (cold)',recipes.getByRole('button',{name:/^Burgerboller/}),false,{hold:true});
 const recipe=panel.locator('#recipe-view');
 await recipe.getByRole('button',{name:'Start opskrift'}).tap();
 await recipe.getByText('Trin 1 af 5 · af Meyers').waitFor({timeout:300});
 // A step is marked done by a tap on its circle (A-Opskrift).
 await recipe.getByRole('button',{name:'Markér trin 1 færdigt'}).tap();
 await recipe.getByText('Trin 2 af 5 · af Meyers').waitFor({timeout:300});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await recipes.getByRole('button',{name:/^Fortsæt Burgerboller, Trin 2 af 5/}).tap();
 // Every step done, »Afslut opskrift« ends it.
 for(const step of [2,3,4,5])await recipe.getByRole('button',{name:`Markér trin ${step} færdigt`}).tap();
 await recipe.getByRole('button',{name:'Afslut opskrift'}).tap();
 await recipe.getByRole('button',{name:'Start opskrift'}).waitFor({timeout:300});
 await noLock('Opskrifter');
 assert.equal(await recipeReads(),readsBefore,'opening Opskrifter reads nothing: the catalogue was read at start');
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Bil: a risky action asks for the integration's confirmation, then sends the token once.
 await transition('Bil (cold)',panel.locator('#home-vehicle'),false,{hold:true});
 // Adgang's Døre surface (K-ActionTile): status and action in one press; unlocking asks first.
 await panel.locator('#vehicle-view').getByRole('button',{name:/^Døre: Låst/}).tap();
 const ask=panel.getByRole('alertdialog',{name:'Lås bilen op?'});
 await ask.waitFor();
 await ask.getByRole('button',{name:'Lås op'}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.some(c=>c.service==='vehicle_command'&&c.data.confirmation));
 await sleep(400);
 await noLock('Bil');
 // The hero's dot car filled to the battery, »Seneste hændelser«, and lock sent at once (no confirmation).
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
 // The key enters with a spring (motion/react); a finger meets it once it stands.
 // It is the topmost element under its own centre (nothing covers it), and the finger lands there.
 await frame.waitForFunction(()=>{const key=document.querySelector('button[aria-label^="Vis nyeste svar"]');
  if(!key||key.getAnimations().length||getComputedStyle(key.parentElement).opacity!=='1')return false;
  const r=key.getBoundingClientRect();
  return key.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
 await sleep(300);await startSampling(frame);await newer.tap();
 results['Svar nyt svar']=await collect(frame);
 await svar.locator('button[data-live=true][aria-current=true]').waitFor({timeout:300});
 await newer.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.fakeHass.calls.filter(c=>c.service==='answers_snapshot').length),0,
  'Svar is pushed, never read with a service call');
 assert.equal(await page.evaluate(()=>window.fakeHass.calls.filter(c=>c.service==='radio_state').length),0,
  'Radio is pushed, never polled');
 await noLock('Svar');
 // The Svar key follows the add-on's voice phase (sensor.podvoice_voice_phase) within 100 ms of HA's state, while
 // the add-on builds the answer the card waits in its own places (»bygges«), and the answer fills them.
 for(const [value,state] of [['listening','lytter'],['thinking','taenker'],['answering','svarer'],['rest','hvile']]){
  const at=await page.evaluate(v=>{window.fakeHass.patch('sensor.podvoice_voice_phase',v,{rooms:{kokken:v}});
   return performance.now();},value);
  await panel.locator(`#open-history[data-svar-state=${state}]`).waitFor({timeout:300});
  const took=await page.evaluate(start=>performance.now()-start,at);
  assert.ok(took<300,`the Svar key shows ${value} at once (${took.toFixed(0)} ms)`);
 }
 await page.evaluate(()=>{window.addonAnswers.pending=true;window.fakeHass.pushAll('podvoice/answers_subscribe');});
 // Reading the newest (the live one, chosen above) keeps it: »bygges« shows only when nothing older is read.
 await svar.locator('[data-answer-card]').first().waitFor();
 await page.evaluate(()=>{window.addonAnswers.pending=false;window.fakeHass.pushAll('podvoice/answers_subscribe');});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // A new answer while away from Svar puts the red dot on the key; seeing its card takes it away. (The fixture's live
 // answer is given anew at each push.)
 await sleep(50);
 await page.evaluate(()=>{window.fakeHass.pushAll('podvoice/answers_subscribe');});
 await panel.locator('#open-history[data-svar-state=ulaest]').waitFor({timeout:1000});
 await panel.locator('#open-history').tap();
 await panel.locator('#open-history[data-svar-state=hvile]').waitFor({timeout:1000});
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 // Ro's music button: the room's track with play/pause (the wish at once, Ro stays); the card wakes to Musik.
 // (Radio's Stop above left the speaker idle; the room's speaker plays a track again.)
 await page.evaluate(()=>{window.fakeHass.patch('media_player.kokkenalrum','playing',
  {media_title:'Holocene',media_artist:'Bon Iver',podconnect_source:'spotify',supported_features:1|4|16|32|16384});});
 await panel.getByRole('button',{name:'Gå til Ro'}).tap();
 const restPlayer=panel.locator('[data-rest-player]');
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
 // The carousel is the shared album (podvoice.photos): the newest photo first, its image from the integration's
 // signed view (never an Apple URL), loaded, and the next photo already fetched.
 await frame.waitForFunction(()=>{const img=document.querySelector('[data-photo] img:not([aria-hidden])');
  return img&&img.complete&&img.naturalWidth>0;});
 const album=await frame.evaluate(()=>({shown:document.querySelector('[data-photo]').getAttribute('data-photo'),
  src:document.querySelector('[data-photo] img:not([aria-hidden])').getAttribute('src')}));
 assert.equal(album.shown,'A-4','Ro shows the newest photo of the album first');
 assert.match(album.src,/^\/api\/podvoice\/photos\/A-4\?.*authSig=/,'the photo comes from the signed view');
 assert(await page.evaluate(()=>window.fakeHass.calls.some(c=>c.service==='photos')),'Ro read the album as it opened');
 assert(photoReads.length>=2&&photoReads.some(read=>read!=='/api/podvoice/photos/A-4'),
  `the next photo is fetched ahead: ${JSON.stringify(photoReads)}`);
 await sleep(300);await startSampling(frame);await panel.locator('#photo-view').tap();
 results['Ro out']=await collect(frame);
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 await noLock('Ro');

 // 3. Last tap wins mid-transition.
 await panel.getByRole('button',{name:/^Lys/}).tap();
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 await sleep(700);
 // Exactly one screen is shown; the mounted others are invisible and inert (G7 #19), the shown one never is.
 assert.deepEqual(await frame.evaluate(()=>[...document.querySelectorAll('[data-screen]')]
  .filter(node=>Number(getComputedStyle(node).opacity)>0.01).map(node=>node.dataset.screen)),['home']);
 assert.deepEqual(await frame.evaluate(()=>[...document.querySelectorAll('[data-screen]')]
  .filter(node=>!node.hasAttribute('aria-hidden')).map(node=>node.dataset.screen)),['home']);
 assert.deepEqual(await frame.evaluate(()=>[...document.querySelectorAll('[data-screen]')]
  .filter(node=>!node.inert).map(node=>node.dataset.screen)),['home']);

 // 3b. No swipe back: a drag from the screen column's left edge leaves Lys where it is; »Tilbage« goes back.
 await panel.getByRole('button',{name:/^Lys/}).tap();
 await panel.getByRole('switch',{name:/Køkkenø/}).waitFor();
 await sleep(700);
 // The drags below start on Lys's scene tiles and lamp rows: a drag is never a press, so nothing is switched.
 const lightCalls=()=>page.evaluate(()=>window.fakeHass.calls
  .filter(c=>['light','scene'].includes(c.domain)).length);
 const pressesBefore=await lightCalls();
 const column=await panel.getByRole('region',{name:'Hjemmet'}).boundingBox();
 const centred=()=>frame.evaluate(()=>document.querySelector('[data-screen][data-place="center"]')?.dataset.screen);
 const shift=id=>frame.evaluate(id=>new DOMMatrixReadOnly(getComputedStyle(
  document.querySelector(`[data-screen="${id}"]`)).transform).m41,id);
 {const y=column.y+column.height/2;await page.mouse.move(column.x+8,y);await page.mouse.down();
  for(let i=1;i<=12;i++)await page.mouse.move(column.x+8+512*i/12,y);await page.mouse.up();}
 await sleep(700);
 assert.equal(await centred(),'lights','a drag from the left edge is no swipe back');
 assert.equal(await shift('lights'),0,'and Lys rests in place');
 await sleep(300);await startSampling(frame);
 await panel.getByRole('button',{name:'Tilbage'}).tap();
 results['Tilbage (Lys)']=await collect(frame);
 await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 assert.equal(await centred(),'home','Tilbage goes back to Hjem');
 await sleep(700);
 assert.equal(await shift('home'),0,'Hjem rests in place');

 assert.equal(await page.evaluate(()=>window.fakeHass.calls.filter(c=>['light','scene'].includes(c.domain)).length),
  pressesBefore,'no drag across Lys switched a lamp or ran a scene');
 // 4. Sleep and wake: HA's state changed while hidden; the page shows it after visibilitychange.
 await page.evaluate(()=>{window.fakeHass.patch('light.kokken_o','on');window.fakeHass.patch('light.kokken_loft','off');});
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
 // G7 #1: offline never adds a row; the topbar says it, and the grid keeps its place (the bottom row is whole).
 await cold.getByText('Forbinder til Home Assistant …').waitFor();
 assert.equal(await cold.getByText(/Sidst kendt/).count(),0,'never »Sidst kendt«');
 assert(await cold.locator('#home-timers').evaluate(node=>node.getBoundingClientRect().bottom
  <=node.closest('main').getBoundingClientRect().bottom),'the bottom row is not clipped offline');
 assert.equal(await cold.locator('[data-svar-state]').getAttribute('data-svar-state'),'offline',
  'the Svar key says Offline without the link (G7 #5)');
 await cold.getByRole('button',{name:/^Lys/}).tap();
 // Stue has three lamps (two of them unplugged): its fold starts closed.
 await cold.getByRole('button',{name:/^Lamper/}).tap();
 await row(cold.getByRole('switch',{name:/Stuelampe/})).tap();
 await cold.getByText('Ikke sendt – ingen forbindelse').waitFor({timeout:300});
 assert.equal(await cold.getByText(/Udfald ukendt/).count(),0);
 assert.equal(await page.evaluate(()=>window.fakeHass.calls.length),0,'nothing was sent without a link');
 await page.evaluate(()=>{window.fakeHass.setConnected(true);});
 await cold.getByText('Forbinder til Home Assistant …').waitFor({state:'detached'});
 // What the wall runs is readable in Skærm og enhed (the clock opens it).
 await cold.getByRole('button',{name:/Skærm og enhed$/}).tap();
 await cold.getByText(/PodVoice 0\.1\.\d+ · build \d+\.\d+\.\d+ · 0123456789ab/).waitFor();
 // Fotoalbum: the album's name and »N billeder · opdateret hh.mm«; »Hent nu« reads the album at once.
 const albumRow=cold.locator('[data-photo-album]');
 await albumRow.getByText('HA podview').waitFor();
 await albumRow.getByText(/^4 billeder · opdateret \d\d\.\d\d$/).waitFor();
 await albumRow.getByRole('button',{name:'Hent nu'}).tap();
 await page.waitForFunction(()=>window.fakeHass.calls.filter(c=>c.service==='photos_refresh').length===1);
 await albumRow.getByText(/^4 billeder · opdateret \d\d\.\d\d$/).waitFor();
 // Automatisk dæmpning dims the wall's screen from Home Assistant (the wall is in kiosk mode).
 await cold.getByText(/^Kl\. 21–7 dæmpes skærmen til 10 %/).waitFor();
 await page.keyboard.press('Escape');
 await cold.getByRole('dialog',{name:'Skærm og enhed'}).waitFor({state:'detached'});

 // 11. Reduced motion (the system setting, read when the page starts): a push is a short cross-fade, nothing slides.
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(base+'/ha_panel/host.html',{waitUntil:'load'});
 const calm=page.frameLocator('iframe');
 await calm.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 const still=await (await page.waitForSelector('iframe')).contentFrame();
 await sleep(500);
 await still.evaluate(()=>{const run={poses:[],up:null};window.reducedRun=run;
  addEventListener('pointerup',()=>{run.up=performance.now();},{capture:true,once:true});
  const pose=id=>{const node=document.querySelector(`[data-screen="${id}"]`);
   return node?[getComputedStyle(node).transform,Number(getComputedStyle(node).opacity)]:null;};
  const tick=ts=>{if(run.up!==null)run.poses.push({at:ts-run.up,home:pose('home'),lights:pose('lights')});
   if(run.up===null||ts-run.up<600)requestAnimationFrame(tick);else run.done=true;};requestAnimationFrame(tick);});
 await calm.getByRole('button',{name:/^Lys/}).tap();
 await still.waitForFunction(()=>window.reducedRun.done,null,{timeout:5000});
 const poses=await still.evaluate(()=>window.reducedRun.poses);
 assert(poses.every(({home,lights})=>[home,lights].every(pose=>!pose||pose[0]==='none')),'nothing slides');
 assert(poses.filter(({at})=>at>=250).every(({lights})=>lights?.[1]===1),'Lys is shown within 250 ms');
 assert(poses.filter(({at})=>at>=250).every(({home})=>home[1]<0.01),'Hjem is gone within 250 ms');

 assert.deepEqual(errors,[]);
 console.log('Frames (WebKit, 1180×820, touch):');
 for(const [name,r] of Object.entries(results))
  console.log(`  ${name.padEnd(22)} frames ${String(r.frames).padStart(3)}  >17.5ms ${r.over17}  >20ms ${r.over20}`+
   `  dropped(>25ms) ${r.dropped}  >34ms ${r.over34}  max ${r.maxFrameMs} ms  first4 max ${r.firstMaxMs} ms`);
 const dropped=Object.entries(results).filter(([name])=>!name.includes('(instant)'))
  .reduce((sum,[,r])=>sum+r.dropped,0);
 assert(dropped<=maxDropped,`${dropped} dropped frames (> 25 ms) over all transitions`);
 console.log('ha_panel_actual_e2e: ok');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.close();}})();
