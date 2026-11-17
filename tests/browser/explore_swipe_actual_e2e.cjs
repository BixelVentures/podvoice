'use strict';
// P9 Udforsk cover flow (docs/MOTION.md §3.10.3) with real touches, sampled every frame, with and without reduced
// motion. The fractional index p is read back from the covers' own transforms (x = d·430 inside one cover).
// - The finger scrubs 1:1 after the 10px slop; the title is invisible at the half-way crossing; will-change is on
//   only while the flow moves and covers past 3.5 are hidden, not transparent.
// - A slow release settles on the nearest cover. A fling travels on: v·0.499/430 covers ahead (±6 at most), with
//   no jump between frames. A touch on the moving flow catches it where it is and opens nothing.
// - Past the first cover the finger meets the rubber-band, and the release returns to it.
// - Reduced: the covers stand flat, the finger still tracks 1:1, and a fling moves at most one cover.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.EXPLORE_TEST_PORT||19015),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,dir;

// p from the covers: the visible cover nearest the centre has x = (k − p)·430 when |k − p| ≤ 1.
const READ=()=>{
 const flow=document.querySelector('#recipe-view [data-recipe-layout=explore]');
 const covers=[...flow.querySelectorAll('[data-recipe-cover]')];
 let best=null;
 covers.forEach((cover,k)=>{const style=getComputedStyle(cover);if(style.visibility==='hidden')return;
  const m=new DOMMatrix(style.transform),x=m.m41;if(!best||Math.abs(x)<Math.abs(best.x))best={k,x,m13:m.m13};});
 const info=document.querySelector('#recipe-view [data-recipe-layout=explore-info]');
 return {p:best.k-best.x/430,turn:best.m13,text:Number(getComputedStyle(info).opacity),
  moving:flow.dataset.pvMoving!==undefined,willChange:getComputedStyle(covers[0]).willChange,
  hidden:covers.map(c=>getComputedStyle(c).visibility==='hidden'),count:covers.length,
  recipe:!!document.querySelector('#recipe-view [data-recipe-layout=intro]')};
};
const read=page=>page.evaluate(`(${READ})()`);
const sampling=page=>page.evaluate(`(()=>{const out=[];window.exploreSamples=out;const t0=performance.now();
 const loop=()=>{out.push({t:performance.now()-t0,...(${READ})()});if(out.length<90)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);})()`);
const samples=async page=>{await sleep(1600);return page.evaluate(()=>window.exploreSamples);};

async function touch(page){
 const session=await page.context().newCDPSession(page);
 const send=(type,x,y=420)=>session.send('Input.dispatchTouchEvent',{type,
  touchPoints:type==='touchEnd'?[]:[{x,y,id:1,radiusX:6,radiusY:6,force:1}]});
 return {send,close:()=>session.detach()};
}
async function settled(page){
 for(let n=0;n<60;n++){const s=await read(page);if(!s.moving)return s;await sleep(50);}
 throw Error('the flow did not come to rest');
}

async function run(reduced){
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
 await page.getByRole('button',{name:'Udforsk',exact:true}).tap();
 await page.locator('#recipe-view [data-recipe-layout=explore]').waitFor({state:'visible'});await sleep(900);
 const t=await touch(page);
 let s=await read(page);
 assert(s.count>=6,`enough recipes to fling (${s.count})`);assert.equal(Math.round(s.p*1000)/1000,0);
 assert.equal(s.moving,false);assert.equal(s.willChange,'auto','no will-change at rest');
 assert.deepEqual(s.hidden.map((h,k)=>h===k>3.5),s.hidden.map(()=>true),'covers past 3.5 are hidden');
 if(reduced)assert(Math.abs(s.turn)<1e-6,'reduced: the covers stand flat');

 // 1:1 scrub: the lock happens at the first move past 10px (x 570); from there p follows the finger exactly.
 await t.send('touchStart',590);
 for(const x of [570,520,470,420,362]){await t.send('touchMove',x);await sleep(20);
  s=await read(page);const expected=(570-x)/430;
  assert(Math.abs(s.p-expected)<.003,`1:1 at x ${x}: p ${s.p.toFixed(4)} vs ${expected.toFixed(4)}`);}
 assert.equal(s.moving,true);assert.equal(s.willChange,'transform','will-change while moving');
 assert(s.text<.06,`the title is invisible at the crossing (${s.text})`);
 // A slow release: no velocity, so it settles on the nearest cover.
 await sleep(200);await t.send('touchEnd');s=await settled(page);
 assert.equal(Math.round(s.p*1000)/1000,0,`slow release returns to the nearest cover (${s.p})`);
 assert.equal(s.willChange,'auto');assert.equal(s.text,1);

 // A fling: about 2500 px/s to the left.
 await sampling(page);
 await t.send('touchStart',800);for(let x=780;x>=600;x-=20){await t.send('touchMove',x);await sleep(8);}
 await t.send('touchEnd');
 const fling=await samples(page),end=fling.at(-1).p;
 const steps=fling.slice(1).map((f,i)=>Math.abs(f.p-fling[i].p));
 assert(Math.max(...steps)<.5,`no jump between frames (${Math.max(...steps).toFixed(3)})`);
 assert(Math.abs(end-Math.round(end))<.002,'it lands on a cover');
 if(reduced)assert(Math.round(end)<=1,`reduced: at most one cover (${end})`);
 else assert(Math.round(end)>=2,`the fling travels on past the finger (${end})`);
 s=await settled(page);const landed=Math.round(s.p);

 // Catch in flight: a touch while it moves stops it where it is and opens nothing.
 if(!reduced){
  await t.send('touchStart',800);for(let x=780;x>=640;x-=20){await t.send('touchMove',x);await sleep(8);}
  await t.send('touchEnd');await sleep(90);
  const before=await read(page);assert(before.moving,'still flying');
  await t.send('touchStart',600);const caught=await read(page);await sleep(120);const held=await read(page);
  assert(Math.abs(held.p-caught.p)<.002,`caught where it was (${caught.p} → ${held.p})`);
  await t.send('touchEnd');s=await settled(page);
  assert.equal(s.recipe,false,'a catching touch is never a tap');
  assert(Math.abs(s.p-Math.round(caught.p))<.002,'it settles on the nearest cover');
 }

 // Rubber-band past the first cover: travel back to 0, then pull right 400px.
 await page.evaluate(()=>{document.querySelector('#recipe-view [data-recipe-layout=explore]').focus();});
 for(let n=0;n<landed+3;n++){await page.keyboard.press('ArrowLeft');await sleep(30);}
 s=await settled(page);assert.equal(Math.round(s.p*1000)/1000,0,'the arrow keys travel back');
 await t.send('touchStart',400);for(let x=420;x<=800;x+=20){await t.send('touchMove',x);await sleep(8);}
 s=await read(page);const free=-(800-420)/430;
 assert(s.p<-.05&&s.p>free+.1,`resistance past the first cover (${s.p.toFixed(3)} vs free ${free.toFixed(3)})`);
 await sleep(150);await t.send('touchEnd');s=await settled(page);
 assert.equal(Math.round(s.p*1000)/1000,0,'it returns to the first cover');
 await t.close();
 assert.deepEqual(errors,[]);await context.close();
 console.log('explore',JSON.stringify({reduced,flingLanded:landed}));
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
 console.log('explore: 1:1 scrub, projected fling, catch, rubber-band, reduced flat ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');if(dir)await fs.rm(dir,{recursive:true,force:true});}})();
