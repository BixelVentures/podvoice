'use strict';
// A render with nothing new changes nothing (AGENTS.md »Ingen blink«; docs/MOTION.md §0): on Hjem, on a detail page
// (Radio) and in Ro, a second render() right after the first produces zero MutationObserver records anywhere in the
// document. Every write that would restyle (same-value hidden, text, data-* or attribute writes) shows up here.
// PODVIEW_TEST_ENGINE=webkit runs the same check in WebKit.
const playwright=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const engine=process.env.PODVIEW_TEST_ENGINE||'chromium',chromium=engine==='chromium';
const port=Number(process.env.RENDER_IDEMPOTENT_TEST_PORT||18997),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Renders once to settle, then renders again under a MutationObserver; returns what the second render changed.
const noopRender=page=>page.evaluate(()=>{
 const host=document.querySelector('pv-widget-host');host.render();
 const observer=new MutationObserver(()=>{});
 observer.observe(document.documentElement,{attributes:true,childList:true,characterData:true,subtree:true,
  attributeOldValue:true});
 host.render();const records=observer.takeRecords();observer.disconnect();
 return records.map(record=>{const node=record.target.nodeType===3?record.target.parentElement:record.target;
  const name=node?.id?`#${node.id}`:`${node?.nodeName}.${String(node?.className||'').slice(0,40)}`;
  return record.type==='attributes'?`${name}[${record.attributeName}]`:`${name} ${record.type}`;});
});
// A settled screen: no page or Ro motion and no pending render.
const settle=async page=>{for(let n=0;n<60;n++){
 if(await page.evaluate(()=>{const host=document.querySelector('pv-widget-host');
  return !host.motion?.moving&&!host.renderFrame;}))return;await sleep(50);}};

let server,browser,data;
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-render-idempotent-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','ignore','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await playwright[engine].launch(chromium?env.browserOptions():{headless:true});
 const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820}});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);await sleep(800);
 const report={};
 await settle(page);report.hjem=await noopRender(page);
 await page.locator('#home-radio').click();await sleep(900);await settle(page);
 report.radio=await noopRender(page);
 await page.locator('.topbar-title-action').click();await sleep(900);
 await page.locator('#show-photo').click();await sleep(1200);await settle(page);
 report.ro=await noopRender(page);
 for(const [screen,records]of Object.entries(report))
  assert.deepEqual(records,[],`${screen}: a render with nothing new mutates nothing (${records})`);
 assert.deepEqual(errors,[]);
 console.log(`render idempotent (${engine}): Hjem, Radio and Ro re-render with 0 mutations ok`);
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
