'use strict';
// iPad Foto-Ro and nat-skærm (issue 390, lærred v192 »A-FotoRo«, v190 »FotoRo-Aktiv« and »Foto-Nat«):
// full-bleed photo with clock, date and weather; activity cards always left, music always right;
// a 52-px control only on music and radio; tap anywhere draws a circle at the finger and opens the overview;
// 21–7 a black night screen with a dimmed clock, weather and only a running timer.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_FOTORO_TEST_PORT||18987),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Europe/Copenhagen is UTC+1 in November.
const DAY=new Date('2026-11-09T13:30:00Z'),NIGHT=new Date('2026-11-09T22:14:00Z'),
 EVENING=new Date('2026-11-09T20:30:00Z');
let server,browser;
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height].map(Math.round);
 });
async function open(stage,time,{rest=true}={}){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.clock.setFixedTime(time);
 await page.goto(`${base}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
 if(rest)await page.locator('#photo-view').waitFor({state:'visible'});await sleep(700);return page;
}
const card=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {box:[b.x,b.y,b.width,b.height].map(Math.round),radius:s.borderTopLeftRadius,text:n.innerText.replace(/\s+/g,
  ' ').trim()};});
(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());

 // FotoRo-Aktiv: a running timer left, music right with its own pause control.
 let page=await open('timer-rest-running',DAY);
 const host=page.locator('pv-widget-host');
 assert.equal(await host.getAttribute('data-night'),'false','14.30 is day');
 assert.deepEqual(await box(page.locator('#photo-view')),[0,0,1180,820],'the photo fills the whole screen');
 const clock=await page.locator('#photo-clock').evaluate(n=>{const s=getComputedStyle(n),b=n.getBoundingClientRect();
  return {size:s.fontSize,weight:s.fontWeight,x:Math.round(b.x),text:n.textContent};});
 assert.equal(clock.text,'14.30');assert.equal(clock.size,'168px');assert.equal(clock.weight,'600');
 assert(Math.abs(clock.x-48)<=8,`clock starts at 48 (${clock.x})`);
 assert.equal(await page.locator('#photo-date').evaluate(n=>getComputedStyle(n).fontSize),'26px');
 const weather=await page.locator('#photo-weather').evaluate(n=>{const b=n.getBoundingClientRect(),
  t=n.querySelector('strong');
  return {right:Math.round(b.right),temp:getComputedStyle(t).fontSize,
   icon:getComputedStyle(n.querySelector('img')).display};});
 assert.equal(weather.right,1132,'weather ends 48 from the right edge');assert.equal(weather.temp,'44px');
 assert.equal(weather.icon,'none','the canvas weather has no icon');
 const hint=page.locator('.photo-caption');assert(await hint.isVisible(),'the hint is visible');
 assert.equal((await hint.innerText()).trim(),'Tryk for at åbne hjemmet');
 const timer=page.locator('#resource-rail>.resource-preview[data-kind=timer]');
 const left=await card(timer);console.log('fotoro timer',JSON.stringify(left));
 assert.deepEqual(left.box,[40,700,340,80],'activity card bottom-left 340×80');assert.equal(left.radius,'24px');
 assert.match(left.text,/^\d+:\d\d Timer\s*\S/,'timer shows remaining time, then Timer and its state');
 const chip=await timer.locator('.resource-visual').evaluate(n=>{const s=getComputedStyle(n),
  b=n.getBoundingClientRect();
  return [Math.round(b.width),Math.round(b.height),s.borderTopLeftRadius,s.backgroundColor];});
 assert.deepEqual(chip,[48,48,'14px','rgb(23, 23, 26)'],'timer chip is the dark 48-px surface');
 assert(await timer.locator('.resource-chevron').isVisible(),'timer keeps the chevron');
 const player=page.locator('aside.player');
 const right=await card(player);console.log('fotoro music',JSON.stringify(right));
 assert.deepEqual(right.box,[800,700,340,80],'music card bottom-right 340×80');assert.equal(right.radius,'24px');
 const control=await page.locator('#play-pause').evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
  return {size:[Math.round(b.width),Math.round(b.height)],radius:s.borderTopLeftRadius,bg:s.backgroundColor,
   label:n.getAttribute('aria-label')};});
 assert.deepEqual(control.size,[52,52]);assert.equal(control.radius,'50%');assert.equal(control.bg,'rgb(23, 23, 26)');
 assert.equal(control.label,'Sæt musik på pause','music control pauses');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-fotoro-aktiv-1180x820.png')});
 // Tap anywhere: a circle at the finger, then the overview.
 await page.evaluate(()=>{const photo=document.getElementById('photo-view');window.circleAt=null;
  new MutationObserver(()=>{if(photo.dataset.pvCircle==='down')
   window.circleAt??=[photo.style.getPropertyValue('--pv-press-x'),
   photo.style.getPropertyValue('--pv-press-y')];}).observe(photo,{attributes:true});});
 await page.touchscreen.tap(600,420);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host').dataset.view==='active');
 assert.deepEqual(await page.evaluate(()=>window.circleAt),['600px','420px'],'the circle starts at the finger');
 assert.deepEqual(page.errors,[]);await page.close();

 // Radio direkte: stop control.
 page=await open('radio-selected',DAY,{rest:false});
 // The radio preview opens on the radio page; go home the way the screen lifecycle does.
 await page.evaluate(()=>document.querySelector('pv-widget-host').dispatch({type:'show',id:'photo'}));
  await page.locator('#photo-view').waitFor({state:'visible'});
 await sleep(400);
 if(await page.locator('aside.player').isVisible()){
  const radio=await page.locator('#play-pause').evaluate(n=>[n.getAttribute('aria-label'),
   Math.round(n.getBoundingClientRect().width)]);
  console.log('fotoro radio',JSON.stringify(radio));assert.equal(radio[1],52);
  assert.match(radio[0],/^(Stop radio|Start radio ved livepunkt)$/,'radio control stops or plays');
  await page.screenshot({path:path.join(env.artifactDir(),'ipad-fotoro-radio-1180x820.png')});
 }
 await page.close();

 // A-FotoRo, nothing playing: Vælg musik with the period, chevron and no control.
 page=await open('quiet',DAY);
 const empty=await card(page.locator('#player-empty'));console.log('fotoro empty',JSON.stringify(empty));
 assert.deepEqual(empty.box,[800,700,340,80]);assert.equal(empty.text,'Vælg musik Til eftermiddagen');
 assert.equal(await page.locator('#resource-rail').isVisible(),false,'no activity card without activities');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-fotoro-1180x820.png')});await page.close();

 // Foto-Nat 21–7: black, no photo, dimmed clock and weather in the middle, only a running timer as a pill.
 for(const [time,label] of [[EVENING,'21.30'],[NIGHT,'23.14']]){
  page=await open('timer-rest-running',time);
  assert.equal(await page.locator('pv-widget-host').getAttribute('data-night'),'true',`${label} is night`);
  const night=await page.evaluate(()=>{const $=id=>document.getElementById(id),
   c=$('photo-clock').getBoundingClientRect(),
   w=$('photo-weather').getBoundingClientRect(),img=getComputedStyle(document.querySelector('#photo-view>img'));
   return {bg:getComputedStyle($('photo-view')).backgroundColor,img:img.display,
    clock:getComputedStyle($('photo-clock')).color,
    size:getComputedStyle($('photo-clock')).fontSize,center:Math.round(c.x+c.width/2),top:Math.round(c.y),
    weather:[Math.round(w.x+w.width/2),getComputedStyle($('photo-weather')).visibility,
     $('photo-weather').innerText.replace(/\s+/g,' ')],
    date:getComputedStyle($('photo-date')).display,
     player:getComputedStyle(document.querySelector('aside.player')).visibility};});
  console.log('fotoro night',label,JSON.stringify(night));
  assert.equal(night.bg,'rgb(0, 0, 0)');assert.equal(night.img,'none','no photo at night');
  assert.equal(night.clock,'rgb(107, 58, 44)');assert.equal(night.size,'168px');
  assert(Math.abs(night.center-590)<=8,'clock is centred (drift and optical offset aside)');
   assert(Math.abs(night.top-310)<=4,'clock top 310');
  assert(Math.abs(night.weather[0]-590)<=2,'weather is centred under the clock');
   assert.equal(night.weather[1],'visible');
  assert.match(night.weather[2],/°\s*\S/,'night weather shows temperature and condition');
   assert.equal(night.date,'none');assert.equal(night.player,'hidden');
  const pill=await card(page.locator('#resource-rail>.resource-preview[data-kind=timer]'));
   console.log('fotoro pill',JSON.stringify(pill));
  const pillNode=page.locator('#resource-rail>.resource-preview[data-kind=timer]');
  const order=await pillNode.evaluate(n=>[...n.querySelectorAll(
   '.resource-label>strong,.resource-label>.resource-value')].filter(e=>e.getBoundingClientRect().width>0)
   .sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x).map(e=>e.innerText.trim()).join(' '));
  assert.match(order,/^Timer \d+:\d\d$/,'the pill reads Timer, then the remaining time');assert.equal(pill.box[3],44);
   assert.equal(pill.box[1]+44,764,'pill 56 from the bottom');
  assert(Math.abs(pill.box[0]+pill.box[2]/2-590)<=1,'pill is centred');
  if(label==='23.14')await page.screenshot({path:path.join(env.artifactDir(),'ipad-foto-nat-1180x820.png')});
  // One tap wakes Foto-Ro (the day view) without opening the overview.
  await page.touchscreen.tap(600,420);
  await page.waitForFunction(()=>document.querySelector('pv-widget-host').dataset.night==='false');
  assert.equal(await page.locator('pv-widget-host').getAttribute('data-view'),'rest','night tap wakes Foto-Ro');
  assert.deepEqual(page.errors,[]);await page.close();
 }
 console.log('ipad fotoro: day, active, empty and night ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');}})();
