'use strict';
// iPad Svar (issue 399, lærred v190 »A-SvarKort«, »SvarK-*«, »Kit-SvarKnap«). While Voice PE works, the status sits in
// the Svar button itself (48 high, radius 24, five bars; »Lytter…« in #FBF3DE with a gold ring, »Svarer…« dark).
// Every answer is its own card in --pv-surface (radius 24, padding 32) as tall as its content: a short sport result
// never stretches to the bottom of the column. The answers of one round (same voice session) stack as cards, newest
// on top, 16 apart. A match result is a dark block (radius 20, padding 32) with the score in 168 mono and the scorers
// under each team. Colour rule: neutral cards and rows; the kind shows only as the icon in its category chip; the
// selected row has the kit's selected fill. »Tidligere svar« rows are 64 high: chip · one-line title · time in mono.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_SVAR_TEST_PORT||19011),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const CARD='rgb(247, 246, 243)',INK='rgb(23, 23, 26)',LISTEN='rgb(251, 243, 222)';
const ANSWER='rgb(233, 230, 244)',LINE='rgb(220, 218, 212)';
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

 // A-SvarKort: one card for the answer, as tall as its content.
 const host=page.locator('#answer-host');
 const sport=host.locator('pv-answer:visible',{has:page.locator('pv-sport-result')});
 await sport.locator('.pv-sport-result').getByText('3–1',{exact:true}).waitFor({state:'visible',timeout:10000});
 await sleep(400);
 const column=await box(host),card=await box(sport);
 assert.deepEqual([column.x,column.y],[24,104],'cards start at 24/104');
 assert.deepEqual([card.x,card.y,card.w],[column.x,column.y,column.w],'the card spans the card column');
 assert.equal(card.bg,CARD,'card is the neutral surface');assert.equal(card.radius,'24px','card radius 24');
 const content=await sport.evaluate(n=>Math.max(...[...n.children].filter(c=>c.getClientRects().length)
  .map(c=>c.getBoundingClientRect().bottom)));
 near(card.bottom,Math.round(content)+32,'the card ends 32 under its content',3);
 assert(card.h<692,`a short answer does not stretch to the bottom of the column (${card.h})`);
 const chip=await box(sport.locator('.answer-canvas-icon'));
 assert.deepEqual([chip.w,chip.h,chip.radius,chip.bg],[32,32,'999px',ANSWER],'the kind sits in its category chip');
 const kind=await box(sport.locator('h1'));
 assert.equal(kind.size,'15px','context line 15');assert.equal(kind.weight,'600','context line 600');
 assert.equal(kind.x,card.x+32+32+8,'card padding 32, chip 32, 8 to the label');
 const answer=await box(sport.locator('.pv-visual-summary'));
 assert.equal(answer.size,'44px','answer 44');assert.equal(answer.weight,'800','answer 800');
 assert.equal(await sport.locator('.pv-answer-domain-icon').isVisible(),false,'no chat icon in front of the answer');
 // SvarK-Sport: dark block as tall as its content (radius 20, padding 32), score in 168 mono, scorers per team.
 const score=await box(sport.locator('.pv-sport-score'));
 assert.equal(score.bg,INK,'result block is dark');assert.equal(score.radius,'20px','result block radius 20');
 const list=await box(sport.locator('.pv-visual-list'));
 assert.equal(list.bg,INK,'scorers sit inside the dark block');
 assert.deepEqual(await sport.locator('.pv-sport-score').evaluate(n=>getComputedStyle(n).padding),'32px 32px 8px');
 assert.deepEqual(await sport.locator('.pv-visual-list').evaluate(n=>getComputedStyle(n).paddingBottom),'32px');
 const lastScorer=await sport.locator('.pv-visual-list .pv-visual-value').first().evaluate(n=>
  Math.round(n.getBoundingClientRect().bottom));
 near(list.bottom,lastScorer+32,'the dark block ends 32 under the scorers',2);
 const result=await box(sport.locator('.pv-sport-result'));
 assert.equal(result.size,'168px','score 168');assert.match(result.family,/IBM Plex Mono/,'score in mono');
 const teams=await sport.locator('.pv-sport-team').evaluateAll(n=>n.map(x=>x.getBoundingClientRect().x+
  x.getBoundingClientRect().width/2));
 const scorers=sport.locator('.pv-visual-list .pv-visual-value');
 assert.deepEqual(await scorers.allTextContents(),["Lewandowski 12', 58'","Lukébakio 71'"]);
 const scorerX=await scorers.evaluateAll(n=>n.map(x=>x.getBoundingClientRect().x+x.getBoundingClientRect().width/2));
 near(scorerX[0],teams[0],'home scorers under the home team',3);near(scorerX[1],teams[1],
 'away scorers under the away team',3);
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-sport.png')});

 // Several questions in one round: each answer is its own card, newest on top, 16 between.
 assert.equal((await fetch(base+'/lab/svar-followup',{method:'POST'})).status,200);
 const current=host.locator('pv-answer[data-thread=current]:visible');
 await current.getByText('Assist: Pedri',{exact:true}).waitFor({state:'visible',timeout:10000});
 await sleep(500);
 const top=await box(current),below=await box(host.locator('pv-answer[data-thread=earlier]:visible'));
 near(top.y,104,'the newest answer is the top card');
 assert.equal(below.y-top.bottom,16,'16 between the cards');
 for(const [label,item] of [['newest',top],['earlier',below]]){
  assert.equal(item.bg,CARD,`${label} answer is its own neutral card`);assert.equal(item.radius,'24px');}
 assert(top.h<400,`the short follow-up keeps its own height (${top.h})`);
 assert.equal((await box(sport.locator('.pv-visual-summary'))).size,'32px','earlier answer steps down to 32');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-opfoelg.png')});
 // Svar page (A-SvarKort): Svar opens the newest answer; »I dag« stands in the player column, one compact row per
 // answer, newest first: 64 high, radius 18, chip · title in one line · time in mono; the row being read is filled.
 assert.equal((await fetch(base+'/lab/close-live-answer',{method:'POST'})).status,200);
 await page.reload({waitUntil:'domcontentloaded'});await env.openOverview(page);
 const today=page.locator('#svar-today');
 for(let n=0;!(await page.evaluate(()=>!!document.querySelector('pv-widget-host').svarTodayRows?.length));n++){
  if(n>100)throw Error('history rows not loaded');await sleep(100);}
 await page.locator('#open-history').tap();
 await today.waitFor({state:'visible',timeout:10000});await sleep(600);
 const todayBox=await box(today);
 assert.deepEqual([todayBox.x,todayBox.y],[column.x+column.w+32,104],'I dag in the player column beside the cards');
 assert.equal(await page.locator('aside.player').isVisible(),false,'the player gives the column to I dag');
 assert.equal((await today.locator('header>h2').innerText()).trim(),'I dag');
 assert.equal((await today.locator('header>span').innerText()).trim(),'Nyeste øverst');
 const heading=await box(today.locator('header>h2'));assert.equal(heading.size,'22px');assert.equal(heading.weight,'800');
 assert.equal(await host.locator('pv-answer:visible').count(),2,'the newest round is shown as its cards');
 const rows=today.locator('.svar-today-row');
 assert.deepEqual(await rows.locator('.svar-today-title').allTextContents(),['Assist','FC Barcelona mod Sevilla'],
  'one row per answer, newest first');
 const row=rows.first(),rowBox=await box(row),other=await box(rows.nth(1));
 assert.equal(rowBox.h,64,'row 64 high');assert.equal(rowBox.radius,'18px','row radius 18');
 near(rowBox.y,104+32+16,'first row under the 32-px header and 16 gap');
 assert.equal(other.y-rowBox.bottom,8,'8 between rows');
 assert.equal(await row.getAttribute('aria-current'),'true','the answer being read is marked');
 assert.equal(rowBox.bg,LINE,'the selected row has the kit selected fill');assert.equal(rowBox.shadow,'none');
 assert.equal(other.bg,CARD,'other rows are the neutral surface');
 const rowChip=await box(row.locator('.svar-today-chip'));
 assert.deepEqual([rowChip.w,rowChip.h,rowChip.bg],[32,32,ANSWER],'the kind sits in its category chip');
 const time=await box(row.locator('time'));assert.match(time.family,/IBM Plex Mono/);assert.equal(time.size,'15px');
 assert.match(await row.locator('time').innerText(),/^\d\d\.\d\d$/,'today shows the time');
 near(time.x+time.w,rowBox.x+rowBox.w-16,'time at the right edge',1);
 const title=row.locator('strong');const titleBox=await box(title);
 assert.equal(titleBox.size,'17px');assert.equal(titleBox.weight,'700');
 assert.deepEqual(await title.evaluate(n=>[getComputedStyle(n).whiteSpace,getComputedStyle(n).textOverflow]),
  ['nowrap','ellipsis'],'the title is one line with an ellipsis');
 // Choosing the older answer shows its round; that answer is the full-size card, scrolled into view.
 await rows.nth(1).tap();
 await page.waitForFunction(()=>document.querySelector('#svar-today .svar-today-row:nth-child(2)')
  ?.getAttribute('aria-current')==='true',null,{timeout:5000});
 await sleep(500);
 assert.equal(await host.locator('pv-answer:visible').count(),2,'the chosen answer comes with its round');
 const chosen=host.locator('pv-answer[data-thread=current]:visible');
 await chosen.locator('.pv-sport-result').waitFor({state:'visible'});
 const chosenBox=await box(chosen),columnBox=await box(page.locator('.frame>.responses'));
 assert(chosenBox.y>=columnBox.y-1&&chosenBox.y<columnBox.bottom,'the chosen card is in view');
 assert.equal((await box(chosen.locator('.pv-visual-summary'))).size,'44px','the chosen answer is full size');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-valgt.png')});
 await rows.first().tap();
 await page.waitForFunction(()=>document.querySelector('#svar-today .svar-today-row:nth-child(1)')
  ?.getAttribute('aria-current')==='true',null,{timeout:5000});
 await sleep(400);
 // Kit-SvarKnap: at rest the Svar button stays the light key on its own page; only »Svarer…« is dark.
 const knap=await page.locator('#open-history').evaluate(n=>[getComputedStyle(n,'::before').backgroundColor,
  getComputedStyle(n).color]);
 assert.deepEqual(knap,['rgb(247, 246, 243)','rgb(23, 23, 26)'],'Svar button rests light on the Svar page');
 // Kit-Topbar: back is its own 44×44 key (radius 14, #F7F6F3) at the 24 edge, centred on the 56-px keys (24 from the
 // top), then the title 22/600 14 after it.
 const key=await box(page.locator('#header-title-action>.topbar-back-icon'));
 assert.deepEqual([key.x,key.y,key.w,key.h],[24,24+(56-44)/2,44,44],'back key 44×44 at 24/30');
 assert.equal(key.radius,'14px');assert.equal(key.bg,'rgb(247, 246, 243)');
 const label=await box(page.locator('#header-title-action>.topbar-title-copy'));
 assert.equal(label.x,24+44+14,'title 14 after the key');assert.equal(label.size,'22px');assert.equal(label.weight,'600');
 await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-historik.png')});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',journey:'ipad-svar',statusPhase:phase,statusWidth:pill.w,card,
  roundCards:2}));
}catch(error){const page=browser?.contexts()[0]?.pages()[0];
 if(page)await page.screenshot({path:path.join(env.artifactDir(),'ipad-svar-failure.png')});throw error;
}finally{if(browser)await browser.close();
 if(server&&server.exitCode===null){const done=new Promise(resolve=>server.once('exit',resolve));
 server.kill('SIGTERM');await done;}
 if(data)await fs.rm(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
