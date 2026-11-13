'use strict';
// iPad layout (issue 388, lærred v190): 1180×820 landscape, left column 744 + player 372, no page scroll.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_LAYOUT_TEST_PORT||18987),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-ipad-layout-'));
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

 // Kiosk page: fixed iPad viewport without zoom, nothing scrolls the page itself.
 const meta=await page.locator('meta[name=viewport]').getAttribute('content');
 assert.match(meta,/user-scalable=no/);assert.match(meta,/viewport-fit=cover/);
 const box=sel=>page.evaluate(sel=>{const node=[...document.querySelectorAll(sel)]
   .find(n=>n.getBoundingClientRect().width>0);
  if(!node)return null;const b=node.getBoundingClientRect();
  return [b.x,b.y,b.width,b.height].map(Math.round);},sel);
 const layout={page:await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.scrollHeight]),
  topbar:await box('.view-nav'),left:await box('.responses'),player:await box('.player,#player-empty')};
 console.log('ipad layout',JSON.stringify(layout));
 assert.deepEqual(layout.page,[1180,820],'the page itself never scrolls in 1180×820');
 assert.deepEqual(layout.topbar,[0,0,1180,72]);
 // Canvas: 24 margin, left column 744, 16 gap, player 372, 24 margin; content starts 16 under the topbar.
 assert.deepEqual([layout.left[0],layout.left[2]],[24,744],'left column is 744 wide at x 24');
 assert.deepEqual(layout.player,[784,88,372,695],'player is 372×695 at x 784, y 88');
 const widgets=await page.evaluate(()=>[...document.querySelectorAll('.responses button')]
  .map(n=>n.getBoundingClientRect()).filter(b=>b.width>0).map(b=>Math.round(b.right)));
 assert(widgets.length>0&&Math.max(...widgets)<=768,`widgets stay inside the left column: ${widgets}`);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-layout-1180x820.png')});
 console.log('ipad layout: 744 + 372 columns, no page scroll ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
