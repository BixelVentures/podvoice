'use strict';
// On-device frame meter (ui/frame-meter.js, docs/MOTION.md "Måling på iPad'en") in the packaged UI against the real
// Python bridge: opening Hjem from Ro and tapping the Radio card each leave one motion session; when the page is
// hidden the meter posts them to /view/api/frames, and the GET endpoint returns them with kind, views and frames.
// Runs in Chromium (real touch) and WebKit (mouse for the finger). PODVIEW_TEST_ENGINES=chromium limits the run.
const playwright=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const engines=(process.env.PODVIEW_TEST_ENGINES||'chromium,webkit').split(',');
const port=Number(process.env.FRAME_METER_TEST_PORT||(20000+Math.floor(Math.random()*20000)));
const base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;

async function tap(page,engine,selector){
 const box=await page.locator(selector).boundingBox();assert(box,`${selector} is visible`);
 const x=box.x+box.width/2,y=box.y+box.height/2;
 if(engine==='chromium'){
  const session=await page.context().newCDPSession(page),point=[{x,y,id:1,radiusX:6,radiusY:6,force:1}];
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point});await sleep(80);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
 }else{await page.mouse.move(x,y);await page.mouse.down();await sleep(80);await page.mouse.up();}
}

(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-frames-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 for(const engine of engines){
  browser=await playwright[engine].launch(engine==='chromium'?env.browserOptions():{headless:true});
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820}});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);
  await sleep(1600);
  const before=await page.locator('pv-widget-host').evaluate(host=>host.state.focus);
  assert.equal(before,'now');
  await tap(page,engine,'#home-radio');
  await page.waitForFunction(()=>document.querySelector('pv-widget-host').state.focus==='radio');
  await sleep(1800);
  // The meter flushes when the page is hidden (HA app to background, screen off); pagehide stands in for that.
  // A keepalive fetch is not always reported to Playwright, so the server's GET endpoint is the oracle.
  await page.evaluate(()=>dispatchEvent(new Event('pagehide')));
  const mine=row=>engine==='chromium'?/Chrome/.test(row.ua):!/Chrome/.test(row.ua);
  let read,ours=[];
  for(let n=0;n<50&&!ours.some(row=>row.kind==='push');n++){
   await sleep(100);read=await (await fetch(base+'/view/api/frames?room=kitchen')).json();
   ours=read.sessions.filter(mine);
  }
  const push=ours.find(row=>row.kind==='push'&&row.from==='now'&&row.to==='radio');
  assert(push,`a push session now -> radio: ${JSON.stringify(ours)}`);
  assert(push.frames>=10,`the push sampled frames (${push.frames})`);
  assert(push.maxFrameMs>0&&push.p95FrameMs>0&&push.animations>0,JSON.stringify(push));
  assert(push.startLatencyMs!==null&&push.startLatencyMs<200,`start latency ${push.startLatencyMs}`);
  assert(ours.some(row=>row.kind==='ro-close'&&row.from==='photo'&&row.to==='now'),
   `the Ro -> Hjem touch is a ro-close session: ${JSON.stringify(ours.map(r=>[r.kind,r.from,r.to]))}`);
  assert(read.aggregates.push.count>=1);
  console.log('frames',JSON.stringify({engine,push:{frames:push.frames,maxFrameMs:push.maxFrameMs,
   p95FrameMs:push.p95FrameMs,startLatencyMs:push.startLatencyMs,durationMs:push.durationMs},kinds:ours.map(r=>r.kind)}));
  assert.deepEqual(errors,[]);await browser.close();browser=null;
 }
 console.log(`frame meter (${engines.join(', ')}): touch sessions reach /view/api/frames with kind and frames`);
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
