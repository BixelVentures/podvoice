'use strict';
// Status = speaker (owner 17/11 on the iPad, 2.1.17): radio played on Frida's speaker and was stopped; Frida stayed
// chosen in the player, yet a tap in Musik started on Køkkenalrum. The player's speaker is the start's destination:
// a speaker chosen for radio (playerView.chooseSpeaker, exactly what the radio sheet calls) makes the Find musik start
// carry that speaker, not the room's configured default. Then one tap in the speaker sheet moves the music.
// Packaged UI → real Python selection broker → inert native service. No audio.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const assert=require('node:assert/strict');
const port=Number(process.env.MUSIC_SPEAKER_TEST_PORT||18997),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser;
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-speaker-target-'));
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:'1',
   MUSIC_DISCOVERY_LOADING_TEST:'cover',MUSIC_START_ANY_SPEAKER:'1',
   PODVIEW_TEST_NONCE:require('node:crypto').randomUUID()}),
  stdio:['ignore','ignore','pipe']});
 let log='';server.stderr.on('data',chunk=>{log+=chunk;});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited '+log.slice(-2000));
  try{if((await fetch(base+'/view/')).ok)break;}catch{}if(n>150)throw Error('startup');await sleep(100);}
 browser=await chromium.launch({...env.browserOptions(),args:['--mute-audio']});
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[],setups=[],moves=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{
  if(request.method()!=='POST')return;const url=new URL(request.url()).pathname,body=request.postDataJSON?.();
  if(url.endsWith('/music/selection/setup'))setups.push(body);
  if(/\/control\/.*actions$|\/control\/intent$/.test(url)&&body?.action==='move_existing_session')moves.push(body);
 });
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="top"]').tap();
 const song=page.locator('#result-list button.result').filter({hasText:'Katalogsang 11'});
 await song.waitFor({state:'visible',timeout:15000});
 const catalogue=await page.evaluate(async()=>{const h=document.querySelector('pv-widget-host');
  return (await h.liveTransport.music('speakers',h.liveMedia.account)).speakers;});
 const kitchen=catalogue.find(row=>row.default),bedroom=catalogue.find(row=>!row.default&&row.startSelectable);
 assert(kitchen&&bedroom,'the fixture has the default room and another startable speaker');
 // Radio was played on the other speaker and stopped: the radio sheet chose it for the player.
 await page.evaluate(row=>document.querySelector('pv-widget-host').playerView.chooseSpeaker(
  {id:row.homepodId,name:row.name}),bedroom);
 // A tap in Musik starts on the player's speaker.
 await song.tap();
 for(let n=0;n<100&&!setups.length;n++)await sleep(100);
 assert.equal(setups.length,1,'one setup for one tap');
 assert.equal(setups[0].target.speakerId,bedroom.speakerId,'the start targets the player\'s speaker');
 assert.notEqual(setups[0].target.speakerId,kitchen.speakerId,'never the configured default room');
 // The inert native service cannot start in the other room; the refusal never locks the next choice.
 // Radio is then chosen on the default room's speaker: the next tap starts there and plays.
 await page.evaluate(row=>document.querySelector('pv-widget-host').playerView.chooseSpeaker(
  {id:row.homepodId,name:row.name}),kitchen);
 await page.waitForFunction(()=>!document.querySelector('pv-widget-host').liveSelection.pending,undefined,
  {timeout:5000});
 await song.tap();
 for(let n=0;n<100&&setups.length<2;n++)await sleep(100);
 assert.equal(setups.length,2,'the next tap is not held by the refused start');
 assert.equal(setups[1].target.speakerId,kitchen.speakerId,'last speaker choice wins');
 await page.waitForFunction(()=>document.querySelector('pv-widget-host').liveMedia?.playback?.state==='playing',
  undefined,{timeout:15000});
 // One tap in the speaker sheet moves the playing music (owner: it took two taps).
 await page.locator('#output').tap();
 const rooms=page.locator('#rooms');await rooms.waitFor({state:'visible'});
 const other=rooms.locator('#room-options button').filter({hasText:bedroom.name});
 await page.waitForFunction(name=>[...document.querySelectorAll('#room-options button')]
  .some(b=>b.textContent.includes(name)&&!b.disabled),bedroom.name,{timeout:10000});
 await other.tap();
 for(let n=0;n<50&&!moves.length;n++)await sleep(100);
 assert.equal(moves.length,1,'one tap moves the music');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',speaker:bedroom.name,setups:setups.length,moves:moves.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server?.kill();}})();
