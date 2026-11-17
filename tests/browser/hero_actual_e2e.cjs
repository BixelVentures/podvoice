'use strict';
// P7 hero (docs/MOTION.md §3.8) with real touches, sampled every frame, with and without reduced motion. In
// Opskrifter → Udforsk, a tap on the chosen cover flies the cover (720×460) into the recipe's photo on the smooth
// spring while the pages move as a push; Tilbage flies the photo back into the cover. One element carries the name
// at a time, so the transition never aborts. Reduced: no flight, the pages only fade.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.HERO_TEST_PORT||19017),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,dir;

const startSampling=page=>page.evaluate(()=>{
 const out=[];window.heroSamples=out;window.heroT0=null;
 addEventListener('touchend',()=>{window.heroT0=performance.now();},{capture:true,once:true});
 const loop=()=>{
  const group=getComputedStyle(document.documentElement,'::view-transition-group(pv-hero)');
  const flying=document.getAnimations().some(a=>a.effect?.pseudoElement?.includes('(pv-hero)'));
  const named=[...document.querySelectorAll('*')].filter(n=>n.style?.viewTransitionName==='pv-hero').length;
  out.push({t:performance.now(),flying,named,width:Number.parseFloat(group.width)||0,
   nav:document.documentElement.dataset.pvNav||null});
  if(out.length<75)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
});
const samples=async page=>{await sleep(1400);return page.evaluate(()=>window.heroSamples.map(s=>({...s,
 t:s.t-(window.heroT0??s.t)})));};
async function tap(page,locator){
 const box=await locator.boundingBox();assert(box,'visible');
 await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
}
const size=locator=>locator.evaluate(n=>Math.round(n.getBoundingClientRect().width));

function check(s,{from,to,reduced,label}){
 assert(s.every(x=>x.named<=1),`${label}: at most one element is named pv-hero`);
 const flight=s.filter(x=>x.flying);
 if(reduced){assert.equal(flight.length,0,`${label}: reduced has no flight`);
  assert(s.some(x=>x.nav),`${label}: the pages still transition`);return;}
 assert(flight.length>12,`${label}: the hero flies over several frames (${flight.length})`);
 assert(flight[0].t<120,`${label}: it starts within ~100 ms of the touch (${Math.round(flight[0].t)})`);
 assert(Math.abs(flight[0].width-from)<4,`${label}: it starts at the source size (${flight[0].width} vs ${from})`);
 const widths=flight.map(x=>x.width),sign=Math.sign(to-from);
 for(let i=1;i<widths.length;i++)assert(sign*(widths[i]-widths[i-1])>=-.5,`${label}: straight to the target`);
 assert(Math.abs(widths.at(-1)-to)<6,`${label}: it lands on the target size (${widths.at(-1)} vs ${to})`);
 assert(!s.at(-1).flying&&s.at(-1).named===0,`${label}: done, and the name is cleared`);
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
 page.on('console',message=>{
  if(message.type()==='error'&&/view.transition/i.test(message.text()))errors.push(message.text());});
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});await env.openOverview(page);
 await page.locator('#home-recipes').tap();
 await page.locator('#recipe-view [data-recipe="Burgerboller"]').waitFor({state:'visible',timeout:20000});
 await page.locator('#recipe-view [data-recipe-view=explore]').tap();
 const cover=page.locator('#recipe-view [data-recipe-cover][aria-current=true]');
 await cover.waitFor({state:'visible'});await sleep(900);
 const coverWidth=await size(cover),name=await cover.getAttribute('data-recipe-cover');

 await startSampling(page);await tap(page,cover);
 const opening=await samples(page);
 const photo=page.locator('#recipe-view [data-recipe-layout=intro] img').first();
 await photo.waitFor({state:'visible'});
 assert.equal(await page.locator('#recipe-view [data-recipe-layout=title]').innerText(),name,'the cover opens its recipe');
 const photoWidth=await size(photo);
 check(opening,{from:coverWidth,to:photoWidth,reduced,label:'open'});

 await startSampling(page);await tap(page,page.locator('#header-title-action'));
 const closing=await samples(page);
 await page.locator('#recipe-view [data-recipe-cover][aria-current=true]').waitFor({state:'visible'});
 check(closing,{from:photoWidth,to:coverWidth,reduced,label:'back'});
 console.log('hero',JSON.stringify({reduced,coverWidth,photoWidth,
  openFrames:opening.filter(x=>x.flying).length,backFrames:closing.filter(x=>x.flying).length}));
 assert.deepEqual(errors,[]);await context.close();
}

(async()=>{try{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'podview-hero-'));
 server=spawn(env.python,[path.join(__dirname,'recipe_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({RECIPE_TEST_PORT:String(port),RECIPE_TEST_CATALOG:path.join(dir,'catalog.json')}),stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>150)throw Error('fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true])await run(reduced);
 console.log('hero: Udforsk cover flies into the recipe photo and back, one name at a time, reduced fades ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');if(dir)await fs.rm(dir,{recursive:true,force:true});}})();
