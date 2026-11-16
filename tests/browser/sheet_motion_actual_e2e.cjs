'use strict';
// P2 sheet (docs/MOTION.md §3.3) with a real touch: »Skærm og enhed« rises 24px on the smooth spring while it fades
// in over --pv-dur-base, and leaves faster (16px, --pv-dur-quick) than it came. A close during the opening turns
// around from where the sheet is. Reduced motion only fades. Every frame is sampled.
// P6 busy (§3.7): a kit button that turns busy shows no spinner for 400 ms, then fades it in and spins it.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.SHEET_TEST_PORT||18993),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;

// Starts sampling the sheet's translate, opacity and display every frame; returns the samples later.
const startSampling=page=>page.evaluate(()=>{
 const sheet=document.getElementById('quick-sheet'),run={};window.sheetRun=run;window.sheetSamples=[];
 const t0=performance.now();
 const loop=()=>{if(window.sheetRun!==run)return;const style=getComputedStyle(sheet);
  const y=style.translate==='none'?0:Number.parseFloat(style.translate.split(' ')[1]||'0');
  window.sheetSamples.push({t:performance.now()-t0,y,opacity:Number(style.opacity),display:style.display,
   open:sheet.open});
  if(window.sheetSamples.length<90)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
});
const samples=async page=>{await sleep(1600);return page.evaluate(()=>window.sheetSamples);};
async function tap(page,selector){
 const box=await page.locator(selector).boundingBox();assert(box,`${selector} is visible`);
 await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
}
const near=(a,b,eps,label)=>assert(Math.abs(a-b)<=eps,`${label}: ${a} vs ${b}`);

function checkOpen(s,{reduced}){
 const shown=s.filter(x=>x.open);assert(shown.length>30,'sampled the opening');
 const first=shown[0],settled=shown.filter(x=>x.t>first.t+700);
 if(reduced){for(const x of shown)assert.equal(x.y,0,'reduced: nothing moves');}
 else{
  assert(first.y>12,`opening starts low (${first.y}px of 24)`);
  for(let i=1;i<shown.length;i++)assert(shown[i].y<=shown[i-1].y+.01,'rises monotonically');
  assert(shown.every(x=>x.y>=-.01),'smooth spring: no overshoot');
  const half=shown.find(x=>x.y<12);assert(half&&half.t-first.t<260,`half way within ~250 ms (${half?.t-first.t})`);
 }
 const opaque=shown.find(x=>x.opacity>.99);
 assert(opaque&&opaque.t-first.t<=(reduced?220:300),`opacity reaches 1 in time (${opaque?.t-first.t} ms)`);
 for(const x of settled){near(x.y,0,.5,'settled');assert.equal(x.opacity,1);}
}
function checkClose(s,{reduced,from=0}){
 // The closing is everything after the last open frame (the interrupt run also samples the opening).
 const closing=s.slice(s.findLastIndex(x=>x.open)+1);assert(closing.length>10,'sampled the closing');
 const first=closing[0];
 near(first.y,from,reduced?0:3,'the close starts from where the sheet is');
 const visible=closing.filter(x=>x.display!=='none');
 assert(visible.length>=3,'the sheet stays displayed while it leaves');
 const gone=closing.find(x=>x.display==='none'||x.opacity<.01);
 assert(gone&&gone.t-first.t<=(reduced?220:240),`out within quick (${gone?.t-first.t} ms)`);
 if(!reduced){
  // Toward the 16px exit offset from wherever the sheet was, without reversing on the way.
  const sign=Math.sign(16-first.y)||1;
  for(let i=1;i<visible.length;i++)assert(sign*(visible[i].y-visible[i-1].y)>=-.01,
   `moves straight to the exit: ${visible.map(x=>x.y.toFixed(2)).join(' ')}`);
  assert(Math.abs(visible.at(-1).y-16)<=Math.abs(first.y-16)+.01,'ends at the 16px exit offset');
 }else for(const x of visible)assert.equal(x.y,0);
 return gone.t-first.t;
}

// Marks the first visible kit button busy (as runKitButtonAction does) and samples its spinner every frame.
async function busySpinner(page){
 return page.evaluate(()=>new Promise(resolve=>{
  const button=[...document.querySelectorAll('button.pv-kit.pv-kit-button')].find(node=>node.getClientRects().length&&
   getComputedStyle(node).visibility==='visible');
  button.dataset.feedback='progress';const t0=performance.now();button.setAttribute('aria-busy','true');
  const out=[];const loop=()=>{const after=getComputedStyle(button,'::after');
   out.push({t:performance.now()-t0,opacity:Number(after.opacity),rotate:after.rotate,content:after.content});
   if(performance.now()-t0<800)requestAnimationFrame(loop);
   else{button.setAttribute('aria-busy','false');resolve({id:button.id||button.className,out});}};
  requestAnimationFrame(loop);
 }));
}
function checkBusy({id,out},{reduced}){
 assert(out.every(x=>x.content!=='none'),`${id}: busy draws the spinner pseudo`);
 const early=out.filter(x=>x.t<380),late=out.filter(x=>x.t>600);
 assert(early.length>10&&early.every(x=>x.opacity<.01),`${id}: no spinner during the first 400 ms`);
 assert(late.length&&late.every(x=>x.opacity>.99),`${id}: spinner shown after 400 ms + quick fade`);
 const spins=new Set(late.map(x=>x.rotate)).size>1;
 assert.equal(spins,!reduced,`${id}: ${reduced?'static ring under reduced':'spinner rotates'}`);
}

(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-sheet-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},
   reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
  await env.openOverview(page);await sleep(500);

  // Open with a tap on the topbar key, then close with the sheet's own close button.
  await startSampling(page);await tap(page,'#header-ro');
  const opening=await samples(page);checkOpen(opening,{reduced});
  await startSampling(page);await tap(page,'#quick-sheet .dialog-close');
  const out=checkClose(await samples(page),{reduced});
  const inMs=opening.filter(x=>x.open).find(x=>x.opacity>.99).t-opening.find(x=>x.open).t;
  if(!reduced)assert(out<inMs+80,`the exit (${out} ms) is not slower than the entry fade (${inMs} ms)`);

  // Interrupt: close 90 ms into the opening; the close begins where the sheet is, without a jump.
  if(!reduced){
   await startSampling(page);await tap(page,'#header-ro');await sleep(90);
   const at=await page.evaluate(()=>{const style=getComputedStyle(document.getElementById('quick-sheet'));
    return Number.parseFloat(style.translate.split(' ')[1]||'0');});
   await page.evaluate(()=>document.querySelector('#quick-sheet .dialog-close').click());
   const turned=await samples(page);
   checkClose(turned,{reduced,from:at});
   console.log('sheet interrupt',JSON.stringify({at:Math.round(at*10)/10}));
  }
  console.log('sheet',JSON.stringify({reduced,inMs:Math.round(inMs),outMs:Math.round(out)}));
  await sleep(300);const busy=await busySpinner(page);checkBusy(busy,{reduced});
  console.log('busy',JSON.stringify({reduced,button:busy.id,shownAt:Math.round(busy.out.find(x=>x.opacity>0)?.t)}));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('sheet motion: smooth rise, quicker exit, interruptible, reduced fade only; busy waits 400 ms ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
