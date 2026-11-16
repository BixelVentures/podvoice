'use strict';
// P5 value change (docs/MOTION.md §3.6), sampled every frame in a real browser on the running-timer page.
// - Clock minute change: only the changed digits roll (the new figure from 30% below, the old one away as ::before)
//   on the quick spring and land within ~450 ms; unchanged figures never move. Reduced: a fade, no movement.
// - Countdown: seconds change without motion.
// - Timer ring: a tick runs linear over the second, so the ring moves in nearly every frame instead of jumping
//   once a second; a user change (+1 min) travels on the smooth spring without overshoot. Reduced keeps the ring
//   continuous.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.VALUE_TEST_PORT||19011),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser;

// Every frame for `frames` frames: the header clock's slots (glyph translateY in px and opacity, ::before opacity),
// the countdown's glyph transforms and the detail ring's dash length.
const sample=(page,frames)=>page.evaluate(frames=>new Promise(resolve=>{
 const host=document.querySelector('pv-widget-host'),clock=host.querySelector('#header-clock');
 const panel=host.querySelector('#timers-view .timer-panel'),ring=panel.querySelector('.timer-progress');
 const count=panel.querySelector('.timer-count'),t0=performance.now(),out=[];
 const ty=node=>{const m=getComputedStyle(node).transform;return m==='none'?0:new DOMMatrix(m).m42;};
 const loop=()=>{
  out.push({t:performance.now()-t0,dash:Number.parseFloat(getComputedStyle(ring).strokeDasharray),
   clock:[...clock.children].map(slot=>({y:ty(slot.firstChild),o:Number(getComputedStyle(slot.firstChild).opacity),
    was:Number(getComputedStyle(slot,'::before').opacity)})),
   count:[...count.children].map(slot=>ty(slot.firstChild||slot))});
  if(out.length<frames)requestAnimationFrame(loop);else resolve(out);};
 requestAnimationFrame(loop);
}),frames);
const minuteLater=page=>page.evaluate(()=>{const host=document.querySelector('pv-widget-host');
 host.renderTopbarClock(new Date(Date.now()+60000));return host.querySelector('#header-clock').textContent;});

function checkClock(samples,{reduced}){
 const slots=samples[0].clock.length,moving=new Set();
 for(const s of samples)s.clock.forEach((slot,index)=>{if(Math.abs(slot.y)>.01||slot.o<.999)moving.add(index);});
 assert(moving.size>=1&&moving.size<=4,`some, not all, figures change (${[...moving]})`);
 assert(moving.size<slots,'unchanged figures stand still');
 const index=Math.max(...moving),track=samples.map(s=>s.clock[index]);
 if(reduced){
  assert(track.every(x=>Math.abs(x.y)<.01),'reduced: no movement');
  assert(track.every(x=>x.was<.01),'reduced: the old figure does not roll away');
  const shown=samples.find(s=>s.clock[index].o>.99&&s.t>0);
  assert(shown&&shown.t<=150,`reduced: the figure has faded in within --pv-dur-tap (${shown?.t})`);
  return;
 }
 const first=track.find(x=>Math.abs(x.y)>.01);
 assert(first&&first.y>0,`the new figure comes from below (${first?.y})`);
 const ys=track.map(x=>x.y).filter(y=>y>.01);
 for(let i=1;i<ys.length;i++)assert(ys[i]<=ys[i-1]+.01,`it rolls straight in: ${ys.map(y=>y.toFixed(2)).join(' ')}`);
 assert(ys.length>=5,`it rolls over several frames (${ys.length})`);
 assert(track.some(x=>x.was>.3),'the old figure is visible as it leaves');
 const landed=samples.find((s,i)=>i>0&&Math.abs(s.clock[index].y)<.05&&s.clock[index].o>.99);
 assert(landed&&landed.t<=460,`landed within ~450 ms (${landed?.t})`);
}
function checkRing(samples,label){
 const dashes=samples.map(s=>s.dash),changes=dashes.slice(1).filter((d,i)=>Math.abs(d-dashes[i])>1e-4).length;
 assert(changes>=dashes.length*.6,`${label}: the ring moves in most frames (${changes}/${dashes.length - 1})`);
 const steps=dashes.slice(1).map((d,i)=>Math.abs(d-dashes[i]));
 assert(Math.max(...steps)<.2,`${label}: no jump between frames (${Math.max(...steps).toFixed(3)})`);
}

(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},
   reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/index.html?stage=timer-detail-running`,{waitUntil:'domcontentloaded'});
  await page.locator('#timers-view .timer-panel .timer-count').waitFor({state:'visible'});await sleep(1500);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.pvMotion),reduced?'reduced':'full');

  // A tick: about 1.5 s of frames while the timer counts down.
  const ticking=await sample(page,90);
  checkRing(ticking,'tick');
  assert(ticking.every(s=>s.count.slice(-2).every(y=>Math.abs(y)<.01)),'seconds change without motion');
  assert.equal(await page.evaluate(()=>document.querySelector('#timers-view .timer-panel').dataset.pvProgress),'tick');

  // The clock's next minute.
  const before=await page.evaluate(()=>document.querySelector('#header-clock').textContent);
  const running=sample(page,40);await sleep(20);const after=await minuteLater(page);
  assert.notEqual(after,before);checkClock(await running,{reduced});

  // A user change: one more minute on the same timer travels on the spring (reduced: short and linear).
  const user=sample(page,50);await sleep(20);
  await page.evaluate(()=>{const host=document.querySelector('pv-widget-host'),t=host.state.timer;
   host.state={...host.state,timer:{...t,remaining:t.remaining+60,duration:t.duration+60,deadline:t.deadline+60000}};
   host.render();});
  const travel=await user,dashes=travel.map(s=>s.dash);
  assert.equal(await page.evaluate(()=>document.querySelector('#timers-view .timer-panel').dataset.pvProgress),'user');
  // From the first growing frame to the top; ticks after that count down again.
  const start=dashes.findIndex((d,i)=>i>0&&d-dashes[i-1]>1e-3),top=dashes.indexOf(Math.max(...dashes));
  const moved=dashes.slice(start-1,top+1);
  assert(start>0,'the ring grows after +1 min');
  for(let i=1;i<moved.length;i++)assert(moved[i]>=moved[i-1]-1e-3,`${reduced?'reduced':'spring'}: grows straight up`);
  const span=moved.at(-1)-moved[0],steps=moved.filter((d,i)=>i>0&&d-moved[i-1]>1e-3).length;
  assert(span>.5,`it grows by the added minute (${span.toFixed(2)})`);
  if(reduced)assert(steps<=14,`reduced: short (${steps} frames)`);
  else assert(steps>=12,`spring: travels over several frames (${steps})`);
  console.log('value',JSON.stringify({reduced,clock:after,growFrames:steps,growBy:Number(span.toFixed(2))}));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('value: digits roll with direction, seconds still, ring linear per tick and spring on +1 min ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');}})();
