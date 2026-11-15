'use strict';
// iPad Overblik (issue 389, lærred v190 »Main«): fixed 4×3 widget slots beside the player,
// shared small-widget anatomy, white entry widgets in the bottom row, and Skærm og enhed.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_OVERBLIK_TEST_PORT||18988),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-ipad-overblik-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);
 await sleep(500);
 const slots={weather:'#home-weather',robot:'#now-view>.resource-card[data-kind=vacuum]',
  light:'#now-view>.resource-card[data-kind=light],#now-view>.resource-preview[data-kind=light]',
  tesla:'#home-vehicle',music:'#home-music',radio:'#home-radio',recipes:'#home-recipes',timer:'#timer-card'};
 const read=()=>page.evaluate(slots=>Object.fromEntries(Object.entries(slots).map(([key,sel])=>{
  const node=[...document.querySelectorAll(sel)].find(n=>n.getBoundingClientRect().width>0);
  if(!node)return [key,null];const b=node.getBoundingClientRect(),card=node.matches('#timer-card,.resource-card')?
   node.querySelector(':scope>:not([hidden])'):node,style=getComputedStyle(card);
  const before=getComputedStyle(card,'::before'),after=getComputedStyle(card,'::after');
  return [key,{box:[b.x,b.y,b.width,b.height].map(Math.round),bg:style.backgroundColor,
   chevron:before.content!=='none'&&before.width==='20px'&&(before.maskImage||before.webkitMaskImage)!=='none',
   tile:after.content==='none'?null:[after.right,after.top,after.width,after.height].join(' ')}];})),slots);
 const overview=await read();
 console.log('ipad overblik',JSON.stringify(overview));
 // Main board: 4 columns of 174 and 3 rows of 221 with 16 between, from x 24 / y 88.
 const expected={weather:[24,88,364,458],robot:[404,88,364,221],light:[404,325,174,221],tesla:[594,325,174,221],
  music:[24,562,174,221],radio:[214,562,174,221],recipes:[404,562,174,221],timer:[594,562,174,221]};
 for(const [key,box] of Object.entries(expected))assert.deepEqual(overview[key]?.box,box,`${key} slot`);
 // Bottom row: music, radio and recipes are white entry widgets with one 64-px icon surface at right 20, top 66.
 for(const key of ['music','radio','recipes']){
  assert.equal(overview[key].bg,'rgb(255, 255, 255)',`${key} is a white entry widget`);
  assert.equal(overview[key].tile,'20px 66px 64px 64px',`${key} has the shared 64-px icon surface`);
 }
 assert.equal(overview.timer.bg,'rgb(23, 23, 26)','timer stays dark');
 for(const key of Object.keys(expected))assert(overview[key].chevron,`${key} head shows the chevron`);
 assert.deepEqual(await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.scrollHeight]),
  [1180,820],'the page never scrolls');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-overblik-1180x820.png')});

 // A-Skaerm: the clock opens Skærm og enhed as a centred 560-wide sheet over the dimmed overview.
 await page.locator('#header-ro').tap();
 const sheet=page.locator('#quick-sheet');await sheet.waitFor({state:'visible'});await sleep(400);
 const dialog=await sheet.evaluate(n=>{const b=n.getBoundingClientRect();
  return {box:[b.x,b.y,b.width,b.height].map(Math.round),radius:getComputedStyle(n).borderTopLeftRadius,
   title:n.querySelector('#quick-title').textContent};});
 console.log('ipad skaerm',JSON.stringify(dialog));
 assert.equal(dialog.title,'Skærm og enhed');
 assert.equal(dialog.box[2],560,'sheet is 560 wide');
 assert.equal(dialog.box[0],310,'sheet is centred horizontally');
 assert(Math.abs(dialog.box[1]+dialog.box[3]/2-410)<=1,'sheet is centred vertically');
 assert.equal(dialog.radius,'28px');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-skaerm-1180x820.png')});
 assert.deepEqual(errors,[]);
 console.log('ipad overblik: fixed slots, entry widgets and Skærm og enhed ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
