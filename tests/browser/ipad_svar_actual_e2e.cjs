'use strict';
// iPad Svar (issue 399, lærred v190 »A-SvarKort«, »SvarK-*«, »Kit-SvarKnap«). While Voice PE works, the status sits in
// the Svar button itself (48 high, radius 24, five bars; »Lytter…« in #FBF3DE with a gold ring, »Svarer…« dark). An
// answer is one column-wide card in the answer tint (#E9E6F4, lærred v193) at y 104: the context line in 15/600,
// the answer in 44/800. A match result is a dark block with the score in 168 mono and the scorers from the answer under each team. A follow-up is the top
// section of the same card, above a line; the earlier answer stays below it in the same card.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_SVAR_TEST_PORT||19011),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// The iPad frame (ui-kit.css): edges 24, the content column 744 (--pv-column), 32, the player 356; y 104 to 796.
const EDGE=24,COLUMN=744,TOP=104,BOTTOM=796,PLAYER_W=356,PLAYER_X=1180-EDGE-PLAYER_W;
const CARD='rgb(233, 230, 244)',INK='rgb(23, 23, 26)',LISTEN='rgb(251, 243, 222)';
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),bottom:Math.round(b.bottom),
  radius:s.borderTopLeftRadius,bg:s.backgroundColor,size:s.fontSize,weight:s.fontWeight,family:s.fontFamily,
  color:s.color,shadow:s.boxShadow};});
let server,browser,data;
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-ipad-svar-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data,ANSWERS_LIVE_TEST:'1'}),
  stdio:['ignore','ignore','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){
  if(server.exitCode!==null)throw Error('answer fixture exited');
  try{if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>150)throw Error('answer fixture startup');await sleep(100);
 }
 browser=await chromium.launch(env.browserOptions());
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);

 // Kit-SvarKnap: the status is drawn as the Svar button, not as a separate wider pill.
 assert.equal((await fetch(base+'/lab/svar-sport',{method:'POST'})).status,200);
 const status=page.locator('pv-widget-host>.voice-surface');
 await page.waitForFunction(()=>{const n=document.querySelector('pv-widget-host>.voice-surface');
  return n&&!n.hidden&&n.dataset.phase;},null,{timeout:10000});
 const phase=await status.getAttribute('data-phase');
 const pill=await box(status);
 near(pill.h,48,'status height');assert.equal(pill.radius,'24px','status radius');near(pill.y,12,'status top');
 near(pill.x+pill.w/2,590,'status centred on the Svar button');
 assert(pill.w<224,`status hugs its text like the Svar button (${pill.w})`);
 const bars=status.locator('.voice-bars>i');
 assert.equal(await bars.count(),5,'five bars as on the Svar button');
 if(phase==='listening'){assert.equal(pill.bg,LISTEN,'Lytter… is #FBF3DE');
  assert.match(pill.shadow,/rgb\(216, 178, 90\)/,'Lytter… has the gold ring');}
 if(phase==='responding')assert.equal(pill.bg,INK,'Svarer… is dark');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-knap.png')});

 // A-SvarKort: one card for the answer.
 const host=page.locator('#answer-host');
 const sport=host.locator('pv-answer:visible',{has:page.locator('pv-sport-result')});
 await sport.locator('.pv-sport-result').getByText('3–1',{exact:true}).waitFor({state:'visible',timeout:10000});
 await sleep(400);
 const card=await box(host);
 assert.deepEqual([card.x,card.y,card.w],[EDGE,TOP,COLUMN],'answer card column-wide at 24/104');
 assert.equal(card.bg,CARD,'card in the answer tint #E9E6F4');assert.equal(card.radius,'24px','card radius 24');
 near(card.h,BOTTOM-TOP,'card reaches the bottom of the player column',4);
 const kind=await box(sport.locator('h1'));
 assert.equal(kind.size,'15px','context line 15');assert.equal(kind.weight,'600','context line 600');
 assert.equal(kind.x,EDGE+32+20+8,'card padding 32, then the 20 icon and 8 (SvarK-Spec v193)');
 const answer=await box(sport.locator('.pv-visual-summary'));
 assert.equal(answer.size,'44px','answer 44');assert.equal(answer.weight,'800','answer 800');
 assert.equal(await sport.locator('.pv-answer-domain-icon').isVisible(),false,'no chat icon in front of the answer');
 // SvarK-Sport: dark block, score in 168 mono, scorers from the answer under each team.
 const score=await box(sport.locator('.pv-sport-score'));
 assert.equal(score.bg,INK,'result block is dark');
 const result=await box(sport.locator('.pv-sport-result'));
 assert.equal(result.size,'168px','score 168');assert.match(result.family,/IBM Plex Mono/,'score in mono');
 const teams=await sport.locator('.pv-sport-team').evaluateAll(n=>n.map(x=>x.getBoundingClientRect().x+
  x.getBoundingClientRect().width/2));
 const scorers=sport.locator('.pv-visual-list .pv-visual-value');
 assert.deepEqual(await scorers.allTextContents(),["Lewandowski 12', 58'","Lukébakio 71'"]);
 const scorerX=await scorers.evaluateAll(n=>n.map(x=>x.getBoundingClientRect().x+x.getBoundingClientRect().width/2));
 near(scorerX[0],teams[0],'home scorers under the home team',3);near(scorerX[1],teams[1],
 'away scorers under the away team',3);
 const list=await box(sport.locator('.pv-visual-list'));
 assert.equal(list.bg,INK,'scorers sit inside the dark block');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-sport.png')});

 // SvarK-Opfoelg: the follow-up is the top section of the same card.
 assert.equal((await fetch(base+'/lab/svar-followup',{method:'POST'})).status,200);
 const current=host.locator('pv-answer[data-thread=current]:visible');
 await current.getByText('Assist: Pedri',{exact:true}).waitFor({state:'visible',timeout:10000});
 await sleep(500);
 const top=await box(current),below=await box(host.locator('pv-answer[data-thread=earlier]:visible'));
 assert(top.y<below.y,`follow-up above the earlier answer (${top.y} vs ${below.y})`);
 near(top.y,TOP,'follow-up starts the card');
 assert.equal(top.bg,'rgba(0, 0, 0, 0)','follow-up shares the card surface');
 assert.equal(below.bg,'rgba(0, 0, 0, 0)','earlier answer shares the card surface');
 const line=await current.evaluate(n=>{const s=getComputedStyle(n,'::after');return {h:s.height,bg:s.backgroundColor};
 });
 assert.deepEqual(line,{h:'1px',bg:'rgba(23, 23, 26, 0.12)'},'a line separates the follow-up from the answer');
 assert.equal((await box(sport.locator('.pv-visual-summary'))).size,'32px','earlier answer steps down to 32 (v193)');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-opfoelg.png')});
 // Svar page (A-SvarKort): Svar opens the newest answer as the card; »I dag« stands in the player column,
 // newest first, four equal rows filling the column (16 between, radius 20), the answer being read white with a
 // 3-px ink ring, time in mono.
 assert.equal((await fetch(base+'/lab/close-live-answer',{method:'POST'})).status,200);
 await page.reload({waitUntil:'domcontentloaded'});await env.openOverview(page);
 const today=page.locator('#svar-today');
 for(let n=0;!(await page.evaluate(()=>!!document.querySelector('pv-widget-host').svarTodayRows?.length));n++){
  if(n>100)throw Error('history rows not loaded');await sleep(100);}
 await page.locator('#open-history').tap();
 await today.waitFor({state:'visible',timeout:10000});await sleep(600);
 const column=await box(today);
 assert.deepEqual([column.x,column.y,column.w],[PLAYER_X,TOP,PLAYER_W],'I dag in the 356 player column at 800/104');
 assert.equal(await page.locator('aside.player').isVisible(),false,'the player gives the column to I dag');
 assert.equal((await today.locator('header>h2').innerText()).trim(),'I dag');
 assert.equal((await today.locator('header>span').innerText()).trim(),'Nyeste øverst');
 const heading=await box(today.locator('header>h2'));assert.equal(heading.size,'22px');assert.equal(heading.weight,'800');
 const cardBox=await box(host);assert.deepEqual([cardBox.x,cardBox.y,cardBox.w],[EDGE,TOP,COLUMN],'answer card beside it');
 assert(await host.locator('pv-answer:visible').count()>0,'the newest answer is shown as the card');
 const row=today.locator('.svar-today-row').first();
 const rowBox=await box(row);
 assert.equal(rowBox.h,(BOTTOM-TOP-32-16-3*16)/4,'four equal rows fill the column');assert.equal(rowBox.radius,'20px','row radius 20');
 near(rowBox.y,TOP+32+16,'first row under the 32-px header and 16 gap');
 assert.equal(await row.getAttribute('aria-current'),'true','the answer being read is marked');
 assert.equal(rowBox.bg,'rgb(255, 255, 255)');assert.match(rowBox.shadow,/rgb\(23, 23, 26\) 0px 0px 0px 3px inset/);
 const time=await box(row.locator('time'));assert.match(time.family,/IBM Plex Mono/);assert.equal(time.size,'15px');
 assert.match(await row.locator('time').innerText(),/^\d\d\.\d\d$/,'today shows the time');
 const title=await box(row.locator('strong'));assert.equal(title.size,'17px');assert.equal(title.weight,'700');
 // Kit-SvarKnap: at rest the Svar button stays the light key on its own page; only »Svarer…« is dark.
 const knap=await page.locator('#open-history').evaluate(n=>[getComputedStyle(n,'::before').backgroundColor,
  getComputedStyle(n).color]);
 assert.deepEqual(knap,['rgb(247, 246, 243)','rgb(23, 23, 26)'],'Svar button rests light on the Svar page');
 // Kit-Topbar: back is its own 44×44 key (radius 14, #F7F6F3) at the 24 edge, centred on the 56-px keys (24 from the
 // top), then the title 22/600 14 after it.
 const key=await box(page.locator('#header-title-action>.topbar-back-icon'));
 assert.deepEqual([key.x,key.y,key.w,key.h],[EDGE,24+(56-44)/2,44,44],'back key 44×44 at 24/30');
 assert.equal(key.radius,'14px');assert.equal(key.bg,'rgb(247, 246, 243)');
 const label=await box(page.locator('#header-title-action>.topbar-title-copy'));
 assert.equal(label.x,EDGE+44+14,'title 14 after the key');assert.equal(label.size,'22px');assert.equal(label.weight,'600');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-historik.png')});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',journey:'ipad-svar',statusPhase:phase,statusWidth:pill.w,card,
  followupOnTop:true}));
}catch(error){const page=browser?.contexts()[0]?.pages()[0];
 if(page)await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-failure.png')});throw error;
}finally{if(browser)await browser.close();
 if(server&&server.exitCode===null){const done=new Promise(resolve=>server.once('exit',resolve));
 server.kill('SIGTERM');await done;}
 if(data)await fs.rm(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
