'use strict';
// Udforsk cover flow (docs/MOTION.md, Udforsk) with real touches, with and without reduced motion. The flow is a
// native scroll-snap scroller; each cover is drawn by its view timeline. p = scrollLeft / 430.
// - The finger scrolls the flow natively and the covers follow p: the nearest cover's box matches exploreFrame. No
//   JavaScript writes a cover's style while it moves (MutationObserver), and the title is invisible at a crossing.
// - A slow release snaps to the nearest cover; a fling travels on with the engine's momentum and snaps.
// - A tap on a neighbour scrolls to it; the arrow keys step; the 36px back-edge zone never scrolls the flow.
// - Reduced: the covers stand flat.
// - An engine that claims scroll timelines but does not run them gets the flat snap carousel (checked at rest).
// - WebKit (when installed: node node_modules/playwright/cli.js install webkit): wheel and keyboard scrolling snap
//   on covers, the timelines run (no flat fallback), and the frame times while the flow moves are reported.
const {chromium,webkit}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.EXPLORE_TEST_PORT||19015),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,dir;

const READ=()=>{
 const flow=document.querySelector('#recipe-view [data-recipe-layout=explore]');
 const covers=[...flow.querySelectorAll('[data-recipe-cover]')],centre=flow.getBoundingClientRect();
 const middle=centre.x+centre.width/2;
 const boxes=covers.map(cover=>{const r=cover.getBoundingClientRect();return {x:r.x+r.width/2-middle,w:r.width};});
 const info=document.querySelector('#recipe-view [data-recipe-layout=explore-info]');
 return {p:flow.scrollLeft/430,scrollLeft:flow.scrollLeft,boxes,text:Number(getComputedStyle(info).opacity),
  slide:parseFloat(getComputedStyle(info).translate)||0,
  turn:new DOMMatrix(getComputedStyle(covers[1]).transform).m13,
  hidden:covers.map(c=>getComputedStyle(c).visibility==='hidden'),count:covers.length,
  current:covers.findIndex(c=>c.getAttribute('aria-current')==='true'),
  title:document.querySelector('#recipe-view [data-recipe-explore-title]').textContent,
  position:document.querySelector('#recipe-view [data-recipe-explore-position]').textContent,
  writes:window.exploreWrites?.length??0,recipe:!!document.querySelector('#recipe-view [data-recipe-layout=intro]')};
};
const read=page=>page.evaluate(`(${READ})()`);
// Style or attribute writes on the covers or their slots while the flow moves (the title and dots may change).
const watch=page=>page.evaluate(()=>{const flow=document.querySelector('#recipe-view [data-recipe-layout=explore]');
 window.exploreWrites=[];window.exploreWatch?.disconnect();
 window.exploreWatch=new MutationObserver(records=>{for(const r of records)if(r.target!==flow)
  window.exploreWrites.push(`${r.target.dataset?.recipeCover??r.target.nodeName}[${r.attributeName}]`);});
 window.exploreWatch.observe(flow,{attributes:true,subtree:true,attributeFilter:['style','class']});});

async function touch(page){
 const session=await page.context().newCDPSession(page);
 const send=(type,x,y=420)=>session.send('Input.dispatchTouchEvent',{type,
  touchPoints:type==='touchEnd'?[]:[{x,y,id:1,radiusX:6,radiusY:6,force:1}]});
 return {send,close:()=>session.detach()};
}
async function settled(page){
 let last=null;
 for(let n=0;n<80;n++){const s=await read(page);
  if(last&&s.scrollLeft===last.scrollLeft&&s.scrollLeft%430===0&&s.current===Math.round(s.p))return s;
  last=s;await sleep(60);}
 throw Error(`the flow did not come to rest: ${JSON.stringify(last)}`);
}

async function open(browser,reduced,{stale=false}={}){
 const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},
  reducedMotion:reduced?'reduce':'no-preference'});
 await context.route(/^https?:\/\//,route=>{
  if(new URL(route.request().url()).origin===base)return route.continue();
  if(route.request().resourceType()!=='image')return route.abort();
  return route.fulfill({contentType:'image/svg+xml',body:
   '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="tan"/></svg>'});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});await env.openOverview(page);
 await page.locator('#home-recipes').tap();
 await page.locator('#recipe-view [data-recipe="Burgerboller"]').waitFor({state:'visible',timeout:20000});
 // A stale engine: the timelines exist but never move the covers.
 if(stale)await page.addStyleTag({content:'#recipe-view [data-recipe-cover]{animation:none!important}'});
 await page.locator('#recipe-view [data-recipe-view=explore]').tap();
 await page.locator('#recipe-view [data-recipe-layout=explore]').waitFor({state:'visible'});await sleep(900);
 return {context,page,errors};
}

async function run(reduced){
 const {context,page,errors}=await open(browser,reduced);
 assert.equal(await page.locator('[data-recipe-explore-flat]').count(),0,'running timelines keep the cover flow');
 const t=await touch(page);
 let s=await read(page);
 assert(s.count>=6,`enough recipes to fling (${s.count})`);assert.equal(s.p,0);assert.equal(s.current,0);
 assert.deepEqual(s.hidden.map((h,k)=>h===k>3.5),s.hidden.map(()=>true),'covers past 3.5 are hidden');
 // At rest the canvas: the chosen cover flat and centred, its neighbour 430 to the right and turned away.
 assert(Math.abs(s.boxes[0].x)<1&&Math.abs(s.boxes[0].w-720)<1,`chosen cover centred (${JSON.stringify(s.boxes[0])})`);
 if(reduced)assert(Math.abs(s.turn)<1e-6,'reduced: the covers stand flat');
 else assert(Math.abs(s.turn)>.5,`the neighbour turns away (${s.turn})`);

 // A slow drag past the half-way point: the covers follow the native scroll; no style is written per frame.
 await watch(page);
 await t.send('touchStart',800);
 let early;
 for(let x=780;x>=560;x-=20){await t.send('touchMove',x);await sleep(30);if(x===680)early=await read(page);}
 s=await read(page);
 assert(s.p>.4&&s.p<.7,`the finger scrolls the flow (${s.p.toFixed(3)})`);
 const near=s.boxes[1];
 assert(Math.abs(near.x-(1-s.p)*430)<40,`cover 1 follows p (${near.x.toFixed(1)} vs ${((1-s.p)*430).toFixed(1)})`);
 if(Math.abs(s.p-.5)<.08)assert(s.text<.25,`the title fades at the crossing (${s.text} at p ${s.p.toFixed(3)})`);
 // The text follows the finger: out the way the covers go, the next one in from the other side; reduced only fades.
 assert(early.p>.1&&early.p<.4,`early in the drag (${early.p})`);
 if(reduced)assert.equal(early.slide,0,'reduced: the text does not slide');
 else assert(early.slide<-1&&early.text<1,
  `the text slides out with the covers (${early.slide}, ${early.text} at ${early.p})`);
 assert.equal(s.writes,0,`no cover style is written while it moves (${s.writes})`);
 await sleep(250);await t.send('touchEnd');s=await settled(page);
 assert.equal(s.p,1,`a slow release past half-way snaps to the next cover (${s.p})`);
 assert.equal(s.text,1);assert(Math.abs(s.slide)<.5,`at rest the text stands still (${s.slide} at ${s.p})`);
 assert.equal(s.position,`2 af ${s.count}`);assert.equal(s.current,1);

 // A fling: the engine's momentum carries the flow on, and it snaps to a cover.
 await t.send('touchStart',900);for(let x=860;x>=500;x-=60){await t.send('touchMove',x);await sleep(8);}
 await t.send('touchEnd');s=await settled(page);
 assert(s.p>=2,`the fling travels on past the finger (${s.p})`);
 const writes=await page.evaluate(()=>window.exploreWrites.filter(w=>!/^(I|SPAN)\[/.test(w)));
 assert.deepEqual(writes,[],'only the title and dots change while the flow moves');

 // The 36px back-edge zone never scrolls the flow.
 const before=s.scrollLeft;
 await t.send('touchStart',20);for(let x=60;x<=300;x+=40){await t.send('touchMove',x);await sleep(16);}
 await t.send('touchEnd');await sleep(400);
 assert.equal((await read(page)).scrollLeft,before,'a swipe from the edge leaves the flow');

 // The arrow keys step one cover; a tap on a neighbour scrolls to it and opens nothing.
 await page.evaluate(()=>document.querySelector('#recipe-view [data-recipe-layout=explore]').focus());
 await page.keyboard.press('ArrowLeft');s=await settled(page);assert.equal(s.p,Math.round(before/430)-1,'arrow steps');
 // A real touch on the visible part of the right neighbour (a locator tap would scroll it into view first).
 const name=await page.locator('#recipe-view [data-recipe-cover]').nth(s.current+1).getAttribute('data-recipe-cover');
 await t.send('touchStart',1060,380);await sleep(60);await t.send('touchEnd');s=await settled(page);
 assert.equal(s.p,Math.round(before/430),'a tap on the neighbour scrolls to it');assert.equal(s.recipe,false);
 assert.equal(s.title,name);
 await t.close();
 assert.deepEqual(errors,[]);await context.close();
 console.log('explore',JSON.stringify({reduced,landed:s.p}));
}

// The timelines do not run: at rest the flow becomes the flat carousel (744px slots) and still snaps on covers.
async function stale(){
 const {context,page,errors}=await open(browser,false,{stale:true});
 const flow=page.locator('#recipe-view [data-recipe-layout=explore]');
 await page.waitForFunction(()=>document.querySelector('[data-recipe-layout=explore]').dataset.recipeExploreFlat==='');
 const slot=await page.locator('[data-recipe-explore-slot]').first().evaluate(n=>n.offsetWidth);
 assert.equal(slot,744,'the flat carousel has one cover per 744px');
 await flow.evaluate(n=>n.focus());await page.keyboard.press('ArrowRight');await sleep(900);
 const at=await flow.evaluate(n=>n.scrollLeft);
 assert.equal(at,744,'the flat carousel steps one cover');
 assert.match(await page.locator('[data-recipe-explore-position]').innerText(),/^2 af /);
 assert.deepEqual(errors,[]);await context.close();
 console.log('explore stale timelines: flat carousel ok');
}

// WebKit has no CDP touches; the trackpad wheel and the keys drive the same native snap scroller.
async function onWebKit(){
 let engine;
 try{engine=await webkit.launch({headless:true});}
 catch{console.log('explore webkit: not installed, skipped');return;}
 try{
  const {context,page,errors}=await open(engine,false);
  const flow=page.locator('#recipe-view [data-recipe-layout=explore]');
  await page.mouse.move(590,380);
  await page.evaluate(()=>{window.frames=[];let last=performance.now();window.recording=true;
   const loop=t=>{window.frames.push(t-last);last=t;if(window.recording)requestAnimationFrame(loop);};
   requestAnimationFrame(loop);});
  for(let n=0;n<10;n++){await page.mouse.wheel(60,0);await sleep(16);}
  await sleep(1200);
  let at=await flow.evaluate(n=>n.scrollLeft);
  assert(at>0&&at%430===0,`a wheel scroll snaps on a cover (${at})`);
  await flow.evaluate(n=>n.focus());await page.keyboard.press('ArrowRight');await sleep(1000);
  const next=await flow.evaluate(n=>n.scrollLeft);
  assert.equal(next,at+430,'the arrow steps one cover');
  const frames=await page.evaluate(()=>{window.recording=false;return window.frames.slice(1).sort((a,b)=>a-b);});
  assert.equal(await page.locator('[data-recipe-explore-flat]').count(),0,'WebKit runs the cover timelines');
  const s=await read(page);
  assert.equal(s.current,Math.round(s.p));assert(s.text>.99,`the text stands at rest (${s.text})`);
  const q=f=>frames[Math.min(frames.length-1,Math.floor(frames.length*f))].toFixed(1);
  console.log('explore webkit frames',JSON.stringify({frames:frames.length,median:q(.5),p95:q(.95),
   max:frames.at(-1).toFixed(1),over34:frames.filter(f=>f>34).length}));
  assert.deepEqual(errors,[]);await context.close();
 }finally{await engine.close();}
}

(async()=>{try{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'podview-explore-'));
 server=spawn(env.python,[path.join(__dirname,'recipe_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({RECIPE_TEST_PORT:String(port),RECIPE_TEST_CATALOG:path.join(dir,'catalog.json')}),stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>150)throw Error('fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true])await run(reduced);
 await stale();
 await onWebKit();
 console.log('explore: native scroll, compositor covers, snap, fling, edge, tap, reduced flat ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');if(dir)await fs.rm(dir,{recursive:true,force:true});}})();
