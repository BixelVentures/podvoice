'use strict';
// Find musik never blinks (AGENTS.md: no blink, no empty in-between states). Recorded every frame on the packaged
// page while covers arrive late, one cover fails and the shelves read is slow (Green's reads take seconds):
// - a cover is never visible before its pixels are decoded, and a late cover moves no tile;
// - a cover that fails stays the quiet tile background: no broken image, the title stays;
// - reopening Find musik draws nothing (an unchanged page is not redrawn, covers do not fade in again);
// - a finger tap on a shelf heading (Green-tjek F5) or a background refresh never hides a shown tile or heading.
// Packaged UI → real Python shelves broker → inert native service. No audio, no Spotify.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const assert=require('node:assert/strict');
const port=Number(process.env.FIND_MUSIK_FRAMES_TEST_PORT||18998),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Blue (Joni Mitchell, a saved album) has a cover that cannot be fetched.
const FAILED='https://i.scdn.co/image/album1';
let server,browser;
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-find-musik-frames-'));
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:'1',
   PODVIEW_TEST_NONCE:require('node:crypto').randomUUID()}),
  stdio:['ignore','ignore','pipe']});
 let log='';server.stderr.on('data',chunk=>{log+=chunk;});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited '+log.slice(-2000));
  try{if((await fetch(base+'/view/')).ok)break;}catch{}if(n>150)throw Error('startup');await sleep(100);}
 browser=await chromium.launch({...env.browserOptions(),args:['--mute-audio']});
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Covers arrive late (0.3-1.2 s, in no particular order); one fails; nothing else outside PodVoice is reached.
 let coverSeed=0;
 await page.route(/^https:\/\//,async route=>{
  const url=route.request().url();
  if(!/^https:\/\/(i\.scdn\.co|image-cdn-(fa|ak)\.spotifycdn\.com)\//.test(url))return route.abort();
  await sleep(300+(coverSeed++*137)%900);
  if(url===FAILED)return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:'image/svg+xml',
   body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">'
   +`<rect width="64" height="64" fill="hsl(${coverSeed*47%360} 45% 45%)"/></svg>`});
 });
 // Green's shelves reads take about a second; a read in flight never empties what is shown.
 const delay=Number(process.env.FIND_MUSIK_READ_DELAY_MS||900);
 await page.route('**/view/api/music/shelves?**',async route=>{await sleep(delay);await route.continue();});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.waitForFunction(()=>{const p=document.querySelector('pv-widget-host')?.liveCatalogue?.page;
  return !!p&&!p.refreshing&&p.shelves.some(shelf=>shelf.ai);},undefined,{timeout:30000});
 // Every frame: a cover shown before it is decoded, a tile that moves, a shown button that is hidden and back.
 await page.evaluate(()=>{
  const shown=n=>{if(!n.isConnected||n.closest('[hidden],[inert]'))return false;const b=n.getBoundingClientRect();
   if(!b.width||!b.height||b.bottom<0||b.top>innerHeight||b.right<0||b.left>innerWidth)return false;
   const s=getComputedStyle(n);return s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';};
  const label=n=>n.dataset.uri?`tile ${n.querySelector('strong')?.textContent}`
   :n.matches('h2')?`heading ${n.textContent}`
   :`${n.id||n.className} «${n.textContent.trim().slice(0,30)}»`;
  const probe=window.findFrames={popped:new Set(),moved:new Set(),seen:new Map(),label,frames:0};
  const place=new Map();
  const sample=()=>{
   const page=document.querySelector('#find-musik');
   if(page&&!document.getElementById('music-response').hidden){
    probe.frames++;
    for(const image of page.querySelectorAll('.find-art img')){
     if(Number(getComputedStyle(image).opacity)>0&&!(image.complete&&image.naturalWidth>0))
      probe.popped.add(image.getAttribute('src'));
    }
    const top=page.getBoundingClientRect();
    for(const tile of page.querySelectorAll('button[data-uri]')){
     const b=tile.getBoundingClientRect(),row=tile.closest('.find-shelf-row');
     const at=[b.x-top.x+(row?.scrollLeft||0),b.y-top.y,b.width,b.height].map(Math.round).join(',');
     if(place.has(tile)&&place.get(tile)!==at)probe.moved.add(label(tile)+` ${place.get(tile)} → ${at}`);
     place.set(tile,at);
    }
   }
   for(const n of document.querySelectorAll('#music-response :is(button,h2)')){
    const s=shown(n)?'shown':'hidden',states=probe.seen.get(n);
    if(!states){if(s==='shown')probe.seen.set(n,[s]);}else if(states.at(-1)!==s)states.push(s);
   }
   probe.raf=requestAnimationFrame(sample);
  };
  sample();
 });
 const blinks=async stage=>(await page.evaluate(()=>[...window.findFrames.seen].filter(([,s])=>s.length>2)
  .map(([n,s])=>`${window.findFrames.label(n)}: ${s.join(' → ')}`))).map(b=>`${stage}: ${b}`);
 const resetSeen=()=>page.evaluate(()=>window.findFrames.seen.clear());

 // 1) Open Find musik: the page is there at once; covers fade in only when decoded and move nothing.
 await page.locator('#home-music').tap();
 await page.locator('#find-musik .find-tile').first().waitFor({state:'visible',timeout:2000});
 const blue=page.locator('section.find-shelf[data-shelf=albums] button.find-tile').filter({hasText:'Blue'})
  .filter({hasNotText:'Kind of'});
 await blue.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const shown=[...document.querySelectorAll('#find-musik .find-art img')].filter(i=>{
  const b=i.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight&&b.left<innerWidth&&b.right>0;});
  return shown.length>6&&shown.every(i=>i.hasAttribute('data-ready')||i.getAttribute('src')
   ==='https://i.scdn.co/image/album1');},undefined,{timeout:15000});
 await sleep(400);
 const opened=await page.evaluate(()=>({popped:[...window.findFrames.popped],moved:[...window.findFrames.moved],
  frames:window.findFrames.frames}));
 assert.deepEqual(opened.popped,[],'no cover is visible before it is decoded');
 assert.deepEqual(opened.moved,[],'a late cover moves no tile');
 // 2) The failed cover is the tile's quiet background: no broken image, its title and subtitle stay.
 const failed=await blue.evaluate(tile=>{const art=tile.querySelector('.find-art'),image=art.querySelector('img');
  const a=art.getBoundingClientRect();return {ready:image?.hasAttribute('data-ready')??null,
   opacity:image?getComputedStyle(image).opacity:null,art:[Math.round(a.width),Math.round(a.height)],
   background:getComputedStyle(art).backgroundColor,title:tile.querySelector('strong').textContent,
   subtitle:tile.querySelector(':scope > span:not(.find-art)')?.textContent};});
 assert.deepEqual([failed.ready,failed.opacity,failed.art,failed.title],[false,'0',[136,136],'Blue'],
  'a failed cover stays hidden behind the tile background: '+JSON.stringify(failed));
 assert.notEqual(failed.background,'rgba(0, 0, 0, 0)','the tile keeps its cover-shaped background');
 assert.equal(failed.subtitle,'Joni Mitchell');
 assert.doesNotMatch(await page.locator('#music-response').innerText(),/fejl|kunne ikke|ikke tilgængelig/i,
  'a failed cover says nothing');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-find-musik-failed-cover.png')});
 const results=[...await blinks('open')];

 // 3) Back to the overview and into Find musik again: nothing is redrawn and no cover fades in again.
 await page.locator('#header-title-action').tap();
 await page.locator('#home-music').waitFor({state:'visible',timeout:5000});
 await sleep(800);
 await page.locator('#find-musik').evaluate(node=>{window.reopenWrites=[];new MutationObserver(records=>{
  for(const r of records){
   window.reopenWrites.push(r.type+':'+(r.attributeName||'')+':'+(r.target.className||r.target.nodeName));
  }
 }).observe(node,{subtree:true,childList:true,attributes:true,characterData:true});});
 const readyBefore=await page.locator('#find-musik img[data-ready]').count();
 await resetSeen();
 await page.locator('#home-music').tap();
 await page.locator('#find-musik .find-tile').first().waitFor({state:'visible',timeout:2000});
 await sleep(1500);
 assert.deepEqual(await page.evaluate(()=>window.reopenWrites),[],'reopening an unchanged page draws nothing');
 assert.equal(await page.locator('#find-musik img[data-ready]').count(),readyBefore,'no cover fades in again');

 // 4) A finger tap on each shelf heading (scrolled into view first, as a user would) hides nothing.
 const feed=page.locator('#music-response');
 const shelves=await page.locator('#find-musik section.find-shelf').evaluateAll(nodes=>nodes.map(n=>n.dataset.shelf));
 for(const shelf of shelves){
  const heading=page.locator(`section.find-shelf[data-shelf="${shelf}"] h2`);
  await heading.evaluate(n=>{const b=n.getBoundingClientRect();
   if(b.top<120||b.bottom>760)n.scrollIntoView({block:'center'});});
  await sleep(400);
  await resetSeen();
  const before=await feed.evaluate(n=>n.scrollTop);
  const at=await heading.boundingBox();
  await page.touchscreen.tap(at.x+20,at.y+at.height/2);
  await sleep(700);
  results.push(...await blinks(`heading ${shelf}`));
  assert.equal(await feed.evaluate(n=>n.scrollTop),before,`a tap on ${shelf}'s heading does not move the page`);
 }
 // 5) A background refresh (a slow read) replaces nothing that is shown and draws no empty state.
 await resetSeen();
 const tiles=await page.locator('#find-musik button[data-uri]').count();
 await page.locator('pv-widget-host').evaluate(h=>h.liveCatalogue.refresh());
 await sleep(delay+800);
 results.push(...await blinks('refresh'));
 assert.equal(await page.locator('#find-musik button[data-uri]').count(),tiles,'a refresh keeps every tile');
 assert.equal(await page.locator('#find-musik .find-empty').count(),0);
 const final=await page.evaluate(()=>{cancelAnimationFrame(window.findFrames.raf);
  return {popped:[...window.findFrames.popped],moved:[...window.findFrames.moved],frames:window.findFrames.frames};});
 assert.deepEqual(results,[],'no shown tile or heading is hidden and shown again');
 assert.deepEqual(final.popped,[],'no cover is visible before it is decoded');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',frames:final.frames,headings:shelves.length,failedCover:failed,
  reopenWrites:0,refreshKeptTiles:tiles}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server?.kill();}})();
