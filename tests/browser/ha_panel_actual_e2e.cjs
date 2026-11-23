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
// 9. Frames: every screen transition (push and back) is sampled with requestAnimationFrame from the release;
//    a frame interval over 25 ms (1.5 vsyncs at 60 Hz) is a dropped frame. All numbers are printed (also > 17.5 and
//    > 20 ms, as the on-device meter counts them); PANEL_MAX_DROPPED (default 0) bounds the dropped frames.
// Run `npm run build` first (the journey uses the committed build output).
const playwright=require('playwright');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
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
 browser=await playwright.webkit.launch({headless:true});
 const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
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
 const transition=async(name,locator,back=true)=>{
  await sleep(300);await startSampling(frame);await locator.tap();
  results[`${name} push`]=await collect(frame);
  if(!back)return;
  await sleep(300);await startSampling(frame);await panel.getByRole('button',{name:'Tilbage'}).tap();
  results[`${name} back`]=await collect(frame);
  await panel.getByRole('heading',{level:1,name:'Køkkenalrum'}).waitFor();
 };
 const mounted=()=>frame.evaluate(()=>[...document.querySelectorAll('.pv-panel-screen')].map(node=>node.dataset.screen));

 // 2. Lys: the wish within 100 ms of the tap, HA's state confirms it. The first visit builds Lys (cold mount).
 assert.deepEqual(await mounted(),['home'],'only Hjem is mounted at start');
 await transition('Lys (cold)',panel.getByRole('button',{name:/^Lys/}),false);
 const lamp=panel.getByRole('switch',{name:/Køkkenø/});
 assert.equal(await lamp.getAttribute('aria-checked'),'false');
 const wishLatency=await (async()=>{
  const pending=frame.evaluate(()=>new Promise(resolve=>{
   const node=[...document.querySelectorAll('[role=switch]')].find(el=>el.getAttribute('aria-label').startsWith('Køkkenø'));
   let up=null;addEventListener('pointerup',()=>{up=performance.now();},{capture:true,once:true});
   new MutationObserver((_,observer)=>{if(node.getAttribute('aria-checked')==='true'){observer.disconnect();
    resolve(performance.now()-(up??performance.now()));}}).observe(node,{attributes:true});}));
  await lamp.tap();return pending;})();
 assert(wishLatency<100,`lamp wish shown ${wishLatency} ms after the release`);
 await page.waitForFunction(()=>window.fakeHass.hass.states['light.kokken_o'].state==='on');
 await panel.getByRole('switch',{name:/Køkkenø: Tændt/}).waitFor();
 assert.equal(await frame.evaluate(()=>document.querySelectorAll('[inert],dialog[open]').length),0);
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
  await transition(`${name} (cold)`,panel.getByRole('button',{name:tile}));
  await transition(`${name} (warm)`,panel.getByRole('button',{name:tile}));
 }
 // 5. Bounded: Hjem and the previous screen (Timer) only.
 assert.deepEqual(await mounted(),['home','timers']);

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
 await panel.getByRole('heading',{level:1,name:'Lys'}).waitFor();
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
 await cold.getByRole('switch',{name:/Stuelampe/}).tap();
 await cold.getByText('Ikke sendt – ingen forbindelse').waitFor({timeout:300});
 assert.equal(await cold.getByText(/Udfald ukendt/).count(),0);
 assert.equal(await page.evaluate(()=>window.fakeHass.calls.length),0,'nothing was sent without a link');
 await page.evaluate(()=>{window.fakeHass.setConnected(true);});
 await cold.getByText('Sidst kendt · ingen forbindelse til Home Assistant').first().waitFor({state:'detached'});
 await cold.getByText(/PodVoice 0\.1\.\d+ · build \d+\.\d+\.\d+ · 0123456789ab/).waitFor();

 assert.deepEqual(errors,[]);
 console.log('Frames (WebKit, 1180×820, touch):');
 for(const [name,r] of Object.entries(results))
  console.log(`  ${name.padEnd(16)} frames ${String(r.frames).padStart(3)}  >17.5ms ${r.over17}  >20ms ${r.over20}`+
   `  dropped(>25ms) ${r.dropped}  >34ms ${r.over34}  max ${r.maxFrameMs} ms`);
 const dropped=Object.values(results).reduce((sum,r)=>sum+r.dropped,0);
 assert(dropped<=maxDropped,`${dropped} dropped frames (> 25 ms) over all transitions`);
 console.log('ha_panel_actual_e2e: ok');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.close();}})();
