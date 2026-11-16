'use strict';
// P9 track A (docs/MOTION.md §3.10.2) in a real browser with a real touch, sampled every frame. A music shelf is
// scrolled by the engine's own scroll (no JS); where scroll-driven animations exist, a card shrinks toward .94 as
// it is cut by the shelf's edge and is exactly full size while inside, following the scroll in every frame. Reduced:
// every card stays full size while the shelf still scrolls.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.SCROLL_TEST_PORT||19019),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser;

// The first shelf that overflows: every frame its scroll and each card's scale and box against the shelf.
const startSampling=page=>page.evaluate(()=>{
 const shelf=[...document.querySelectorAll('#music-response .music-shelf')].find(s=>s.scrollWidth>s.clientWidth+40);
 shelf.dataset.scrollProbe='';const out=[];window.scrollSamples=out;
 const loop=()=>{const frame=shelf.getBoundingClientRect();
  out.push({scroll:shelf.scrollLeft,cards:[...shelf.children].map(card=>{
   const m=new DOMMatrix(getComputedStyle(card).transform==='none'?undefined:getComputedStyle(card).transform);
   const left=card.offsetLeft-shelf.scrollLeft,width=card.offsetWidth;
   return {scale:m.a,inside:left>=-.5&&left+width<=frame.width+.5};})});
  if(out.length<80)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
 const box=shelf.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};
});

(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},
   reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/index.html?stage=music-prototype-afternoon`,{waitUntil:'domcontentloaded'});
  await page.locator('#music-response .music-shelf').first().waitFor({state:'visible'});await sleep(1200);
  const shelf=await startSampling(page),y=shelf.y+shelf.height/2;
  // A real horizontal touch drag on the shelf: the engine scrolls it (native scroll, no JS of ours).
  const session=await page.context().newCDPSession(page);
  const point=x=>[{x,y,id:1,radiusX:6,radiusY:6,force:1}];
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(shelf.x+600)});
  for(let x=shelf.x+590;x>=shelf.x+200;x-=15){
   await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point(x)});await sleep(16);}
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
  await sleep(900);
  const samples=await page.evaluate(()=>window.scrollSamples);
  const scrolls=samples.map(s=>s.scroll);
  assert(Math.max(...scrolls)-scrolls[0]>100,
   `the shelf scrolls under the finger (${scrolls[0]} → ${Math.max(...scrolls)})`);
  for(const s of samples)for(const card of s.cards){
   assert(card.scale>=.94-1e-3&&card.scale<=1+1e-3,`a card stays between .94 and 1 (${card.scale})`);
   if(card.inside)assert(Math.abs(card.scale-1)<1e-3,'a card inside the shelf is full size');
   if(reduced)assert(Math.abs(card.scale-1)<1e-3,'reduced: no scale');
  }
  const cut=samples.flatMap(s=>s.cards.filter(card=>!card.inside).map(card=>card.scale));
  if(!reduced){
   assert(cut.some(scale=>scale<.99),'a card cut by the edge is smaller');
   // It follows the scroll: the first cut card's scale changes in the frames where the shelf moved.
   const moved=samples.filter((s,i)=>i>0&&Math.abs(s.scroll-samples[i-1].scroll)>1).length;
   assert(moved>=5,`the scroll moved over several frames (${moved})`);
  }
  console.log('scroll',JSON.stringify({reduced,scrolled:Math.round(Math.max(...scrolls)-scrolls[0]),
   smallest:Number(Math.min(...cut,1).toFixed(3))}));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('scroll: native shelf scroll, cards shrink at the edge only, reduced full size ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');}})();
