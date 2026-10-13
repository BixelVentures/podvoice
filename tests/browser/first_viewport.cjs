// #114 own AC2 only: first viewport of shipped UI; no HA/provider/device proof.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {chromium, devices} = require('playwright');
const root = process.env.PODVOICE_UI_ROOT || path.resolve(__dirname, '../..');
const proof = process.env.PODVOICE_UI_PROOF_DIR;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const htmlPath = path.join(root, 'podvoice/gatekeeper/static/index.html');
const dailyPath = path.join(root, 'tests/browser/daily_ui.cjs');
const source = fs.readFileSync(htmlPath, 'utf8');
const daily = fs.readFileSync(dailyPath, 'utf8');
const sourceSha = digest(source), dailySha = digest(daily);
assert.equal(sourceSha, 'ab7f58280ba9f6a50894b9a375afd4f42333dbe73a579b1900f40354c0bb3bf5', 'test must exercise the frozen UI v7 HTML');
assert.equal(dailySha, '51708533d3334c55cf8d767e5bd98c47717edb8f77b26cda498abdbf6e18bdc1', 'daily fixture owner must match v7');
assert.ok(proof && process.env.PODVOICE_BROWSER_NONCE && process.env.PODVOICE_BROWSER_REGISTRY_FD && process.env.PODVOICE_TEST_CHROMIUM, 'use the existing bounded registry worker; screenshots are required proof');
assert.ok(fs.statSync(proof).isDirectory(), 'proof directory is supplied by the existing owner');
const marker = '(async()=>{';
assert.equal(daily.split(marker).length, 2, 'only the daily fixture setup prefix is reusable');
// Reuse actual sample/status/settings definitions; never copy a UI controller.
// The pinned prefix has no browser launch: its first IIFE owns that later work.
const fixtures = new Function('require', '__dirname', daily.slice(0, daily.indexOf(marker)) + '\nreturn {sample,status,settings};')(
  createRequire(dailyPath), path.dirname(dailyPath));
const versionMatch = fs.readFileSync(path.join(root, 'podvoice/config.yaml'), 'utf8').match(/^version:\s*["']?([^"'\n]+)["']?$/m);
assert.ok(versionMatch, 'actual candidate version required');
const surfaces = [
  {name:'mobile', context:{...devices['iPhone 13'], colorScheme:'light'}},
  {name:'desktop', context:{viewport:{width:1440,height:900}, deviceScaleFactor:1, colorScheme:'light'}}
];
assert.equal(surfaces[0].context.viewport.width, 390);
assert.equal(surfaces[0].context.viewport.height, 664);
assert.deepEqual(surfaces[0].context.screen, {width:390,height:844});
const states = [
  {name:'ready', phase:'IDLE', wake:'proven', connected:true, service:'up', title:'Klar', action:'start'},
  {name:'busy', phase:'THINKING', wake:'proven', connected:true, service:'up', title:'Arbejder', action:'stop'},
  {name:'closing', phase:'CLOSING', wake:'proven', connected:true, service:'up', title:'Afslutter', detail:'Afventer afslutning.', action:'stop'},
  {name:'degraded', phase:'IDLE', wake:'fault', connected:true, service:'degraded', title:'Kræver opmærksomhed', detail:'Tjek forbindelsen under Diagnose.', action:'diagnose'},
  {name:'offline', phase:'IDLE', wake:'unknown', connected:false, service:'down', title:'Offline', detail:'Tjek forbindelsen under Diagnose.', action:'diagnose'}
];
const WAIT_MS = 15000;
function bounded(work, label) {
  let timer;
  return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),WAIT_MS);})])
    .finally(()=>clearTimeout(timer));
}
const results=[], fatalErrors=[], cleanupErrors=[];
let cleanupComplete=false, runComplete=false;
function report() {
  fs.writeFileSync(path.join(proof,'first-viewport-report.json'), JSON.stringify({
    issue:114, acceptance:'AC2 first viewport; synthetic API fixtures',
    html_sha256:sourceSha, daily_fixture_sha256:dailySha, test_sha256:digest(fs.readFileSync(__filename)),
    candidate_version:versionMatch[1].trim(), viewport_only:true, fullPage:false,
    surfaces:surfaces.map(surface=>({name:surface.name,configured_viewport:surface.context.viewport,configured_screen:surface.context.screen||null})),
    evidence_limit:'Chromium UI geometry only; no physical Voice PE, Safari, HA app or lifecycle claim',
    status:runComplete && cleanupComplete && !fatalErrors.length && !cleanupErrors.length && results.length===10 && results.every(result=>result.pass)?'PASS':'FAIL',
    cleanup_complete:cleanupComplete, fatal_errors:fatalErrors, cleanup_errors:cleanupErrors, results
  },null,2)+'\n');
}
async function firstViewport(page, locator, label, issues) {
  const count=await locator.count();
  if(count!==1){issues.push(label+': expected one rendered target, got '+count);return {label,count};}
  const observation=await locator.evaluate(element=>{
    const r=element.getBoundingClientRect(), css=getComputedStyle(element);
    const center=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
      viewport:{width:innerWidth,height:innerHeight}, scroll:{x:scrollX,y:scrollY},
      visible:css.display!=='none'&&css.visibility==='visible'&&Number(css.opacity)>0&&r.width>0&&r.height>0,
      covered:!center || !(element===center || element.contains(center)),
      disabled:element.matches('button')&&element.disabled,
      text:element.textContent.trim()};
  });
  const r=observation.rect, v=observation.viewport;
  if(!observation.visible || observation.covered || r.x<0 || r.y<0 || r.right>v.width || r.bottom>v.height)
    issues.push(label+': not fully visible in the first viewport');
  if(observation.disabled)issues.push(label+': required action disabled');
  if(observation.scroll.x!==0 || observation.scroll.y!==0)issues.push(label+': page was scrolled before proof');
  return {label,...observation};
}
(async()=>{
  const browser=await bounded(chromium.launch({headless:true,executablePath:process.env.PODVOICE_TEST_CHROMIUM}),'browser launch');
  let primaryFailure=null;
  try {
    for(const surface of surfaces)for(const state of states){
      const context=await bounded(browser.newContext(surface.context),'context creation');
      let page, contextFailure=null;
      try {
        page=await bounded(context.newPage(),'page creation');
        const errors=[], writes=[], issues=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.addInitScript(()=>{
          // Same inert socket contract as daily_ui: actual HTML/controllers run.
          window.EventSource=class {constructor(){setTimeout(()=>this.onopen?.(),0);}close(){}};
          window.WebSocket=class {static OPEN=1;constructor(){this.readyState=3;}send(){}close(){}};
        });
        await page.route('http://panel.test/**',async route=>{
          const request=route.request(), url=new URL(request.url());
          if(request.method()!=='GET')writes.push({path:url.pathname,method:request.method()});
          if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:source});
          let json={ok:true,status:'idle'};
          if(url.pathname==='/api/status'){
            json=fixtures.status();json.version=versionMatch[1].trim();json.services.voicepe=state.service;
            const room=json.rooms[0];room.connected=state.connected;room.state=state.phase;
            room.live_status=fixtures.sample(state.phase,{wake_readiness:state.wake,
              blocker:state.phase==='THINKING'?'pending_response':'inactive',
              timer_kind:state.phase==='CLOSING'?'deadline':'quiet_coverage',
              countdown_running:state.phase==='CLOSING',remaining_s:state.phase==='CLOSING'?0:null});
          }
          if(url.pathname==='/api/settings')json=fixtures.settings;
          if(url.pathname==='/api/models')json={models:[],voices:[],default:null};
          return route.fulfill({json});
        });
        await bounded(page.goto('http://panel.test/',{timeout:WAIT_MS}),'first viewport navigation');
        // Wait only for actual rendering, never for the expected readiness label.
        // A wrong status is evidence to record, not a reason to lose its screenshot.
        await page.waitForFunction(()=>document.querySelector('#rooms .rname')?.textContent==='Køkken' &&
          document.querySelector('#pane-home .live-status')?.textContent.trim(),null,{timeout:WAIT_MS});
        const targets=[];
        targets.push(await firstViewport(page,page.locator('#pane-home .live-title'),'status',issues));
        if(state.detail){
          const detail=page.locator('#pane-home .live-detail');
          const guidance=await firstViewport(page,detail,'next-action guidance',issues);
          if(guidance.text!==state.detail)issues.push('unexpected next-action guidance');
          targets.push(guidance);
        }
        const action=state.action==='diagnose'?page.locator('#tab-test'):
          page.getByRole('button',{name:state.action==='start'?'Start samtale i Køkken':'Stop i Køkken',exact:true});
        targets.push(await firstViewport(page,action,'required next action',issues));
        if(targets[0].text!==state.title)issues.push('unexpected status label: '+String(targets[0].text));
        if(errors.length)issues.push('page errors: '+errors.join('; '));
        if(writes.length)issues.push('unexpected API write');
        const filename=`first-viewport-${surface.name}-${state.name}.png`;
        await bounded(page.screenshot({path:path.join(proof,filename),fullPage:false}),'viewport screenshot');
        const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollX,scrollY,
          screen:{width:window.screen.width,height:window.screen.height}}));
        assert.deepEqual({width:viewport.width,height:viewport.height,scrollX:viewport.scrollX,scrollY:viewport.scrollY},
          {width:surface.context.viewport.width,height:surface.context.viewport.height,scrollX:0,scrollY:0},'normal viewport without scroll/zoom override');
        if(surface.context.screen)assert.deepEqual(viewport.screen,surface.context.screen,'actual pinned device screen');
        const result={surface:surface.name,state:state.name,fixture:state,viewport,targets,
          screenshot:filename,screenshot_sha256:digest(fs.readFileSync(path.join(proof,filename))),pass:issues.length===0,issues};
        results.push(result);report();
        // Collect all ten states, including truthful screenshots on geometry failure.
      } catch(error){contextFailure=error;throw error;}
      finally {
        try {await bounded(context.close(),'context cleanup');}
        catch(error){
          cleanupErrors.push({owner:'context',surface:surface.name,state:state.name,message:error.message});
          if(!contextFailure)throw error;
        }
      }
    }
    report();
    assert.equal(results.length,10,'all five states on both surfaces');
    assert.ok(results.every(result=>result.pass),JSON.stringify(results.filter(result=>!result.pass)));
    assert.equal(digest(fs.readFileSync(htmlPath)),sourceSha,'HTML unchanged during proof');
    assert.equal(digest(fs.readFileSync(dailyPath)),dailySha,'fixture owner unchanged during proof');
    runComplete=true;
  } catch(error){primaryFailure=error;throw error;}
  finally {
    try {await bounded(browser.close(),'browser cleanup');}
    catch(error){
      cleanupErrors.push({owner:'browser',message:error.message});
      if(!primaryFailure)throw error;
    }
    cleanupComplete=cleanupErrors.length===0;
    report();
  }
  console.log(JSON.stringify({pass:true,issue:114,states:10,evidence:'first viewport only',html_sha256:sourceSha}));
})().catch(error=>{fatalErrors.push({message:error.message});report();console.error(error);process.exitCode=1;});
