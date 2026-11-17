'use strict';
// Lærredsmatch (Green 15 Nov): the 1180×820 iPad design is the only layout. Any HA frame
// (sidebar, header, safe areas, portrait) shows the same stage scaled uniformly and centred.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_STAGE_TEST_PORT||18991),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const frames=[[1180,820],[1180,800],[1180,764],[924,764],[1124,764],[820,1180],[1366,1024]];
let server,browser,data;
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-ipad-stage-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const [width,height] of frames){
  const page=await browser.newPage({hasTouch:true,viewport:{width,height}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);
  await sleep(400);
  const s=Math.min(width/1180,height/820),ox=0,oy=0,W=Math.round(width/s),H=Math.round(height/s);
  // Stage coordinates: the stage keeps the canvas scale and stretches to fill the frame (never letterboxed).
  const box=sel=>page.evaluate(sel=>{const node=[...document.querySelectorAll(sel)]
   .find(n=>n.getBoundingClientRect().width>0);if(!node)return null;const b=node.getBoundingClientRect();
   return [b.x,b.y,b.width,b.height];},sel);
  const stage=b=>b&&[(b[0]-ox)/s,(b[1]-oy)/s,b[2]/s,b[3]/s].map(v=>Math.round(v)+0);
  const layout={page:await page.evaluate(()=>[document.documentElement.scrollWidth,
   document.documentElement.scrollHeight]),topbar:stage(await box('.view-nav')),
   left:stage(await box('.responses')),player:stage(await box('.player,#player-empty'))};
  console.log('ipad stage',width,height,JSON.stringify(layout));
  assert(layout.page[0]<=width&&layout.page[1]<=height,`${width}×${height}: the page never scrolls`);
  assert.deepEqual(layout.topbar,[0,16,W,72],`${width}×${height}: topbar spans the full frame`);
  assert.deepEqual([layout.left[0],layout.left[2]],[24,W-24-24-24-372],`${width}×${height}: left column fills to 24 before the player`);
  assert.deepEqual(layout.player,[W-24-372,104,372,H-24-104],`${width}×${height}: player 372×692, 24 from the right and bottom edges`);
  // Touch lands on the scaled control the user sees.
  const hit=await page.evaluate(()=>{const b=document.querySelector('#show-photo').getBoundingClientRect();
   const at=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!at?.closest('#show-photo');});
  assert(hit,`${width}×${height}: tapping Ro hits Ro`);
  // Kit-Topbar: the overview's left key is the Ro shortcut, a 56-px pill with moon + »Ro«.
  const ro=await page.evaluate(()=>{const b=document.querySelector('#show-photo');
   return {label:b.getAttribute('aria-label'),text:b.textContent.trim(),
    icon:b.querySelector('img').getAttribute('src'),height:b.offsetHeight};});
  assert.deepEqual(ro,{label:'Gå til Ro',text:'Ro',icon:'assets/icons/moon.svg',height:56},
   `${width}×${height}: the topbar's left key reads as Ro`);
  // Kit-Topbar right zone in stage px: clock and date right-aligned to x 1152, weather 28 px before them,
  // the date in the body face (only the clock is mono).
  const right=await page.evaluate(()=>{const stage=document.querySelector('.view-nav').getBoundingClientRect();
   const k=Math.min(innerWidth/1180,innerHeight/820),W=Math.round(stage.width/k),x=s=>document.querySelector(s).getBoundingClientRect();
   const edge=s=>Math.round((x(s).right-stage.x)/k),start=s=>Math.round((x(s).x-stage.x)/k);
   return {clock:edge('#header-clock'),date:edge('#header-date'),gap:start('#header-ro')-edge('#header-weather'),
    mono:/mono/i.test(getComputedStyle(document.querySelector('#header-date')).fontFamily)};});
  assert.deepEqual(right,{clock:W-24,date:W-24,gap:28,mono:false},`${width}×${height}: right zone matches Kit-Topbar`);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(env.artifactDir(),`ipad-stage-${width}x${height}.png`)});
  await page.close();
 }
 console.log('ipad stage: one canvas layout filling every frame ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
