'use strict';
// Inert HA ingress/session, real packaged UI, real HA proxy/add-on route, public source and isolated disk.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'), port=18972, base=`http://127.0.0.1:${port}`;
const python='/Users/madsbachandersen/Documents/PodVoice/.venv/bin/python';
const envBase={...process.env,PYTHONPATH:`/private/tmp/pv118-py312all:${root}/podvoice:${root}/tests`,RECIPE_TEST_PORT:String(port)};
const width=Number(process.env.RECIPE_VIEW_WIDTH || 1280),height=Number(process.env.RECIPE_VIEW_HEIGHT || 800);
const shot=`${width}x${height}`;
const source='https://www.arla.dk/opskrifter/nem-chokoladekage-i-bradepande/';
let dir,server,browser;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
 server=spawn(python,[path.join(__dirname,'recipe_e2e_server.py')],{cwd:root,env:{...envBase,RECIPE_TEST_CATALOG:path.join(dir,'catalog.json')},stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',data=>process.stderr.write(data));
 for(let n=0;n<100;n++){if(server.exitCode!==null)throw Error('server exited '+server.exitCode);try{if((await fetch(base+'/view/')).ok)return}catch{} await sleep(100)}throw Error('server not ready');
}
async function stop(){if(!server||server.exitCode!==null)return;const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;server=null}
async function openCatalog(page){
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});
 await page.locator('#photo-view').waitFor({state:'visible',timeout:15000});
 await page.locator('#photo-view').click();
 await page.locator('#home-recipes').waitFor({state:'visible'});
 await page.waitForTimeout(700);
 await page.locator('#home-recipes').click();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor({state:'visible'});
 await page.locator('#recipe-view [data-recipe]').first().waitFor({state:'visible'});
}
(async()=>{try{
 dir=await mkdtemp(path.join(os.tmpdir(),'podview-recipe-browser-'));await start();
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
 let page=await browser.newPage({viewport:{width,height}}); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await openCatalog(page);
 const entries=page.locator('#recipe-view [data-recipe-layout=catalog] > div').first();
 const all=page.locator('#recipe-view input[type=radio][value=""]');await all.check();await all.focus();
 await entries.evaluate(e=>{e.scrollTop=80});const before=await entries.evaluate(e=>({scroll:e.scrollTop,maximum:e.scrollHeight-e.clientHeight}));
 assert(before.maximum>0,'test viewport must provide real scroll');
 const saved=await page.evaluate(async ({base,source})=>{const r=await fetch(base+'/api/podvoice/recipe-submissions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+'x'.repeat(32)},body:JSON.stringify({url:source})});return {status:r.status,body:await r.json()}},{base,source});
 assert.equal(saved.status,200);assert.equal(saved.body.status,'saved');assert.match(saved.body.message,/^Gemt: /);
 await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').waitFor({state:'attached',timeout:16000});
 assert.equal(await page.locator('#recipe-view input[type=radio]:checked').inputValue(),'');
 assert.deepEqual(await page.evaluate(()=>({name:document.activeElement.name,value:document.activeElement.value})),{name:'recipe-category',value:''});
 const after=await entries.evaluate(e=>e.scrollTop);assert.equal(after,before.scroll,'catalog scroll preserved');
 await page.screenshot({path:`/private/tmp/podview-recipe-${shot}-catalog.png`});
 await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').scrollIntoViewIfNeeded();
 await page.screenshot({path:`/private/tmp/podview-recipe-${shot}-saved.png`});
 await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').click();
 await page.getByRole('heading',{name:'Nem chokoladekage i bradepande'}).waitFor();
 await page.screenshot({path:`/private/tmp/podview-recipe-${shot}-detail.png`});
 const duplicate=await page.evaluate(async ({base,source})=>{const r=await fetch(base+'/api/podvoice/recipe-submissions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+'x'.repeat(32)},body:JSON.stringify({url:source+'?utm_source=test'})});return r.json()},{base,source});
 assert.equal(duplicate.id,saved.body.id);assert.equal(duplicate.status,'saved');
 await page.close(); await stop(); await start();
 page=await browser.newPage({viewport:{width,height}}); page.on('pageerror',e=>errors.push(e.message));
 await openCatalog(page);
 assert.equal(await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').count(),1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',receipt:saved.body.message,autoVisibleWithoutNavigation:true,category:'Alle',focusAndScrollPreserved:true,scroll:before.scroll,duplicate:'same receipt',serverRestart:'catalog retained',pageErrors:errors,viewport:shot,screenshot:`/private/tmp/podview-recipe-${shot}-saved.png`,testStore:dir}));
 }finally{if(browser)await browser.close();await stop();if(dir)await rm(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
