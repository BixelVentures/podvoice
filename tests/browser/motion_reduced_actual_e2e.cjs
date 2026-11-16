'use strict';
// One reduced-motion source (docs/MOTION.md §3.0 rule 6, PR 4): :root[data-pv-motion] follows the system setting
// and the host's data-motion while the screen is idle, and under reduced motion no loop keeps running.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.MOTION_REDUCED_TEST_PORT||18991),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;

const root=page=>page.evaluate(()=>document.documentElement.dataset.pvMotion);
// Running CSS animations that loop forever, by animation name and target.
const loops=page=>page.evaluate(()=>document.getAnimations()
 .filter(a=>a.effect?.getTiming().iterations===Infinity&&a.playState==='running')
 .map(a=>`${a.animationName||a.id} on ${a.effect.target?.id||a.effect.target?.className||a.effect.target?.tagName}`));

(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-motion-reduced-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},reducedMotion:'no-preference'});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);await sleep(400);
 assert.equal(await root(page),'full');

 // The system setting changes while nothing animates: the root follows at once, without a render or a reload.
 await page.emulateMedia({reducedMotion:'reduce'});await sleep(50);
 assert.equal(await root(page),'reduced','root follows the system setting');
 await sleep(400);
 assert.deepEqual(await loops(page),[],'no endless loop runs under reduced motion');
 await page.emulateMedia({reducedMotion:'no-preference'});await sleep(50);
 assert.equal(await root(page),'full');

 // The design library marks the host data-motion=reduced in its preview frame; CSS follows the same root.
 await page.evaluate(()=>{document.querySelector('pv-widget-host').dataset.motion='reduced';});await sleep(50);
 assert.equal(await root(page),'reduced','root follows the host data-motion');
 const transition=await page.evaluate(()=>getComputedStyle(document.querySelector('.resource-preview,#home-radio'))
  .transitionDuration);
 assert.match(transition,/^0s(, 0s)*$/,`reduced overview cards do not transition (${transition})`);
 await page.evaluate(()=>{document.querySelector('pv-widget-host').dataset.motion='normal';});await sleep(50);
 assert.equal(await root(page),'full');
 assert.deepEqual(errors,[]);await context.close();
 console.log('motion reduced: one root source follows system and host; no loops under reduced ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
