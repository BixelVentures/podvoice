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
  const s=Math.min(width/1180,height/820),ox=(width-1180*s)/2,oy=(height-820*s)/2;
  // Stage coordinates: map the on-screen box back into the 1180×820 design.
  const box=sel=>page.evaluate(sel=>{const node=[...document.querySelectorAll(sel)]
   .find(n=>n.getBoundingClientRect().width>0);if(!node)return null;const b=node.getBoundingClientRect();
   return [b.x,b.y,b.width,b.height];},sel);
  const stage=b=>b&&[(b[0]-ox)/s,(b[1]-oy)/s,b[2]/s,b[3]/s].map(v=>Math.round(v)+0);
  const layout={page:await page.evaluate(()=>[document.documentElement.scrollWidth,
   document.documentElement.scrollHeight]),topbar:stage(await box('.view-nav')),
   left:stage(await box('.responses')),player:stage(await box('.player,#player-empty'))};
  console.log('ipad stage',width,height,JSON.stringify(layout));
  assert(layout.page[0]<=width&&layout.page[1]<=height,`${width}×${height}: the page never scrolls`);
  assert.deepEqual(layout.topbar,[0,0,1180,72],`${width}×${height}: topbar is the canvas topbar`);
  assert.deepEqual([layout.left[0],layout.left[2]],[24,744],`${width}×${height}: left column 744 at x 24`);
  assert.deepEqual(layout.player,[784,88,372,695],`${width}×${height}: player 372×695 at 784,88`);
  // Touch lands on the scaled control the user sees.
  const hit=await page.evaluate(()=>{const b=document.querySelector('#show-photo').getBoundingClientRect();
   const at=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!at?.closest('#show-photo');});
  assert(hit,`${width}×${height}: tapping Hjem hits Hjem`);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(env.artifactDir(),`ipad-stage-${width}x${height}.png`)});
  await page.close();
 }
 console.log('ipad stage: one scaled canvas layout in every frame ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
