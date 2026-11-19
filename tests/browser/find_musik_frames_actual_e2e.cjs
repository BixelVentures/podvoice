'use strict';
// Green-tjek F5 (2.1.17, 17 Nov) reported cards and headings hidden for a frame on a Find musik heading tap.
// Cause: the check tapped during the page's opening transition, when hit-testing misses the heading, and its
// driver then scrolled the page. A finger tap (here: at the heading, once it takes touches) never hides a shown
// card or heading, also while a slow catalogue read runs.
// Packaged UI → real Python catalogue broker → inert native service. No audio.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const assert=require('node:assert/strict');
const port=Number(process.env.MUSIK_TAB_TEST_PORT||18998),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser;
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-musik-tabs-'));
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:'1',
   MUSIC_DISCOVERY_LOADING_TEST:'cover',PODVIEW_TEST_NONCE:require('node:crypto').randomUUID()}),
  stdio:['ignore','ignore','pipe']});
 let log='';server.stderr.on('data',chunk=>{log+=chunk;});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited '+log.slice(-2000));
  try{if((await fetch(base+'/view/')).ok)break;}catch{}if(n>150)throw Error('startup');await sleep(100);}
 browser=await chromium.launch({...env.browserOptions(),args:['--mute-audio']});
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Green's catalogue reads take seconds; a read in flight must not empty what is shown.
 const delay=Number(process.env.MUSIK_READ_DELAY_MS||900);
 await page.route('**/view/api/music?**',async route=>{await sleep(delay);await route.continue();});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.locator('#home-music').tap();
 await page.locator('[data-collection]').first().waitFor({state:'visible',timeout:5000});
 const tabs=await page.locator('[data-collection]').evaluateAll(nodes=>
  [...new Set(nodes.map(n=>n.dataset.collection))]);
 const blinks=[];
 for(const kind of [...tabs,...tabs]){
  // The user scrolls a heading below the fold into view before tapping it; that scroll is not part of the switch.
  await page.locator(`#music-refinements>[data-collection="${kind}"]`).evaluate(n=>{const b=n.getBoundingClientRect();
   if(b.top<88||b.bottom>780)n.scrollIntoView({block:'center'});});
  await sleep(300);
  await page.evaluate(()=>{
   // The green-check's own visibility rule (scripts/green-check.mjs).
   const shown=n=>{if(!n.isConnected||n.closest('[hidden],[inert]'))return false;const b=n.getBoundingClientRect();
    if(!b.width||!b.height||b.bottom<0||b.top>innerHeight||b.right<0||b.left>innerWidth)return false;
    const s=getComputedStyle(n);return s.visibility!=='hidden'&&s.display!=='none';};
   const label=n=>n.dataset.collection?`heading ${n.dataset.collection}`
    :`${n.id||n.className} «${n.textContent.trim().slice(0,30)}»`;
   const seen=new Map();
   window.__frames={seen,label};
   const sample=()=>{for(const n of document.querySelectorAll('button,[role=button]')){
     const s=shown(n)?'shown':'hidden';
     const states=seen.get(n);if(!states){if(s==='shown')seen.set(n,[s]);}else if(states.at(-1)!==s)states.push(s);}
    window.__frames.raf=requestAnimationFrame(sample);};
   sample();
  });
  // A finger tap at the heading (no scroll-into-view by the test driver), once the heading takes touches.
  const heading=page.locator(`#music-refinements>[data-collection="${kind}"]`);
  await page.waitForFunction(kind=>{const n=document.querySelector(`#music-refinements>[data-collection="${kind}"]`);
   const b=n?.getBoundingClientRect();return !!b&&b.height>0&&document.elementFromPoint(b.x+20,b.y+b.height/2)?.closest(
    `[data-collection="${kind}"]`)===n;},kind,{timeout:15000});
  const at=await heading.boundingBox();await page.touchscreen.tap(at.x+20,at.y+at.height/2);
  await sleep(1500);
  blinks.push(...(await page.evaluate(()=>{cancelAnimationFrame(window.__frames.raf);
   return [...window.__frames.seen].filter(([,s])=>s.length>2)
    .map(([n,s])=>`${window.__frames.label(n)}: ${s.join(' → ')}`);})).map(b=>`${kind}: ${b}`));
 }
 assert.deepEqual(blinks,[],'no shown card or heading is hidden and shown again on a heading tap');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',switches:tabs.length*2}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server?.kill();}})();
