'use strict';
// iPad UI kit (issue 387): tokens, topbar, widget sizes, press feedback and horizontal fade in 1180×820.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.UI_KIT_TEST_PORT||18986),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;
// Press reaction measured inside the page: pointerdown → first frame where the press is painted.
const pressLatency=(page,selector,check)=>page.evaluate(({selector,check})=>new Promise(resolve=>{
 const node=document.querySelector(selector);
 node.addEventListener('pointerdown',()=>{const start=performance.now();
  const frame=()=>{const css=getComputedStyle(node);
   const done=check==='scale'?!['none','1'].includes(css.scale)&&css.filter.startsWith('brightness(')
    :node.dataset.pvCircle==='down'&&getComputedStyle(node,'::after').opacity==='1';
   if(done)resolve(performance.now()-start);else if(performance.now()-start>500)resolve(Infinity);
    else requestAnimationFrame(frame);};
  requestAnimationFrame(frame);},{once:true});
}),{selector,check});
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-ui-kit-'));
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

 const shot=(name,clip)=>page.screenshot({path:path.join(env.artifactDir(),`ui-kit-${name}.png`),clip});
 // One token set: canvas v2 colours, Schibsted + Plex Mono, three motion times.
 const tokens=await page.evaluate(async()=>{await document.fonts.ready;const css=getComputedStyle(document.documentElement);
  const v=name=>css.getPropertyValue(name).trim();
  await document.fonts.load('600 18px "Schibsted Grotesk Variable"');
   await document.fonts.load('500 20px "IBM Plex Mono"');
  return {bg:v('--pv-bg'),surface:v('--pv-surface'),ink:v('--pv-ink'),danger:v('--pv-danger'),press:v('--pv-d-press'),
   change:v('--pv-d-switch'),enter:v('--pv-d-in'),font:getComputedStyle(document.body).fontFamily,
   sans:document.fonts.check('600 18px "Schibsted Grotesk Variable"'),mono:document.fonts.check('500 20px "IBM Plex Mono"'),
   clock:getComputedStyle(document.querySelector('#header-clock')).fontFamily};});
 assert.deepEqual([tokens.bg,tokens.surface,tokens.ink,tokens.danger],['#E9E7E2','#F7F6F3','#17171A','#B0262A']);
 assert.deepEqual([tokens.press,tokens.change,tokens.enter],['120ms','240ms','400ms']);
 assert.match(tokens.font,/^"Schibsted Grotesk Variable", "Inter Variable"/);
 assert.equal(tokens.sans,true,'Schibsted Grotesk is served locally');
  assert.equal(tokens.mono,true,'IBM Plex Mono is served locally');
 assert.match(tokens.clock,/^"IBM Plex Mono"/);

 // Topbar: full 1180 width, 72 high, Svar centred with its speaker grille.
 const bar=await page.evaluate(()=>{const nav=document.querySelector('.view-nav').getBoundingClientRect();
  const svar=document.querySelector('#open-history'),box=svar.getBoundingClientRect();
  return {
   width:nav.width,height:nav.height,centre:box.left+box.width/2,middle:box.top+box.height/2-nav.top,svarHeight:box.height,dots:svar.querySelectorAll('.pv-svar-grille>i').length,
   label:svar.querySelector('strong').textContent};});
 assert.deepEqual([bar.width,bar.height,bar.svarHeight,bar.dots,bar.label],[1180,72,48,21,'Svar']);
 assert(Math.abs(bar.centre-590)<=1,`Svar is centred: ${bar.centre}`);
 assert(Math.abs(bar.middle-36)<=1,`Svar is vertically centred: ${bar.middle}`);

 await shot('topbar',{x:0,y:0,width:1180,height:72});
 // Svar press: shrink + darker within 100 ms of the finger landing.
 const svar=await page.locator('#open-history').boundingBox();
 const svarPress=pressLatency(page,'#open-history','scale');
 await page.mouse.move(svar.x+svar.width/2,svar.y+svar.height/2);await page.mouse.down();
 const svarMs=await svarPress;assert(svarMs<100,`Svar press visible in ${svarMs} ms`);await sleep(200);
 assert.deepEqual(await page.locator('#open-history').evaluate(n=>[getComputedStyle(n).scale,getComputedStyle(n).filter]),
  ['0.97','brightness(0.92)'],'held press settles at .97 and slightly darker');
 await shot('svar-pressed',{x:390,y:0,width:400,height:72});
 await page.mouse.move(5,400);await page.mouse.up();

 // Widget sizes and flat press: a circle at the finger.
 const sizes=await page.evaluate(()=>{const row=document.createElement('div');row.className='pv-hscroll';row.id='kit-row';
  row.style.width='600px';
  for(const size of ['s','m','l']){const w=document.createElement('button');w.className='pv-widget';w.dataset.size=size;
   w.id=`kit-${size}`;w.textContent=size;row.append(w);}
  document.querySelector('pv-widget-host').append(row);
  const css=getComputedStyle(row);
  return {
   sizes:['s','m','l'].map(size=>{const b=document.getElementById(`kit-${size}`).getBoundingClientRect();return [b.width,b.height];}),
   mask:css.maskImage||css.webkitMaskImage,snap:css.scrollSnapType,align:getComputedStyle(row.firstChild).scrollSnapAlign};
    });
 assert.deepEqual(sizes.sizes,[[174,221],[364,221],[364,458]]);
 assert.equal(sizes.mask,'linear-gradient(90deg, rgb(0, 0, 0) 78%, rgba(0, 0, 0, 0))');
 assert.equal(sizes.snap,'x mandatory');assert.equal(sizes.align,'start');
 await page.locator('#kit-m').scrollIntoViewIfNeeded();
 const rowBox=await page.locator('#kit-row').boundingBox();
 await shot('widgets-fade',{x:rowBox.x,y:rowBox.y,width:rowBox.width,height:rowBox.height});
 const widget=await page.locator('#kit-m').boundingBox();
 const flatPress=pressLatency(page,'#kit-m','circle');
 await page.mouse.move(widget.x+40,widget.y+60);await page.mouse.down();
 const flatMs=await flatPress;assert(flatMs<100,`widget press visible in ${flatMs} ms`);
 const circle=await page.evaluate(()=>{const w=document.querySelector('#kit-m'),after=getComputedStyle(w,'::after');
  return {
   left:after.left,top:after.top,radius:after.borderRadius,shrinks:!['none','1'].includes(getComputedStyle(w).scale)};
   });
 assert.deepEqual(circle,{left:'40px',top:'60px',radius:'50%',shrinks:false},'flat press is a circle at the finger');
 await shot('widget-pressed',{x:widget.x,y:widget.y,width:widget.width,height:widget.height});
 await page.mouse.up();await sleep(400);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#kit-m'),'::after').opacity),'0',
  'circle fades after release');

 await page.locator('#kit-row').evaluate(row=>{row.scrollLeft=row.scrollWidth;});await sleep(300);
 await shot('widgets-scrolled',{x:rowBox.x,y:rowBox.y,width:rowBox.width,height:rowBox.height});
 assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(env.artifactDir(),'ui-kit-1180x820.png')});
 console.log('ui kit: tokens, topbar, widget sizes, press <100 ms, horizontal fade ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
