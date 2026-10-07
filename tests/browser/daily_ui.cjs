// Real Chromium, shipped HTML, synthetic API fixtures; no HA/provider/device access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = process.env.PODVOICE_UI_ROOT || path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'podvoice/gatekeeper/static/index.html'), 'utf8');
const proof = process.env.PODVOICE_UI_PROOF_DIR;
if (proof) fs.mkdirSync(proof, {recursive:true});
const reports = [];
function sample(phase='LISTENING', extra={}) {
  return {session_id:'fixture-session',generation:3,observed_at:Date.now()/1000,
    phase,authority:'GPT-Live',blocker:'quiet_window_incomplete',input_state:'quiet',
    output_state:'quiet',quiet_s:1.2,idle_timeout_s:4,timer_kind:'quiet_coverage',
    transcript:'<img src=x onerror=alert(1)>',transcript_at:Date.now()/1000-1,...extra};
}
function status() {
  return {version:'2.0.1',services:{openai:'up',voicepe:'degraded',mcp:'up',podconnect:'up'},
    service_details:{openai:{reason:'aktiv Realtime-session',source:'fixture probe'},voicepe:{reason:'wake afprøves',source:'fixture firmware'}},
    rooms:[{room:'Køkken',state:'LISTENING',connected:true,level:100,last_latency_ms:230,
      wake_word_supported:true,wake_word_confirmed:'hey_chat_hey_jarvis',live_status:sample()}],
    metrics:{sessions:4},activity:[{room:'Køkken',ts:Date.now()/1000,text:'Samtale åbnet'}],
    timeline_activity:[],capabilities:{time:true,home:true,web_search:true,weather:true,music:true,timers:false,missing:['timers'],discovery:{api_id:'assist'}},
    capability_details:{time:{verified:true,reason:'fixture time',source:'fixture HA'},home:{verified:false,reason:'fixture home',source:'fixture discovery'}}};
}
const settings={engine:'thin',live_alpha:true,wake_word:'hey_chat_hey_jarvis',idle_timeout_s:4,duck_level:20,rooms:[]};
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PODVOICE_TEST_CHROMIUM});
  try {
    for (const width of [320,390,430,768,1440]) {
      for (const scheme of ['light','dark']) {
        const page=await browser.newPage({viewport:{width,height:1000},colorScheme:scheme});
        const errors=[], commands=[];
        let serverStatus=status(), injecting=false;
        const heldPolls=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{
          // Fixture I/O: real rendered app and controllers, no external sockets.
          window.EventSource=class { constructor(){setTimeout(()=>this.onopen?.(),0);} close(){} };
          window.WebSocket=class { static OPEN=1; constructor(){this.readyState=3;} send(){} close(){} };
        });
        await page.route('http://panel.test/**',async route=>{
          const url=new URL(route.request().url());
          if (url.pathname==='/') return route.fulfill({contentType:'text/html',body:source});
          let json={ok:true,status:'idle'};
          if (url.pathname==='/api/status') { if(injecting)await new Promise(resolve=>heldPolls.push(resolve)); json=JSON.parse(JSON.stringify(serverStatus)); json.rooms.forEach(r=>{if(r.live_status)r.live_status.observed_at=Date.now()/1000;}); }
          if (url.pathname==='/api/settings') json=settings;
          if (url.pathname==='/api/models') json={models:[],voices:[],default:null};
          if (url.pathname==='/api/control') commands.push(route.request().postDataJSON());
          return route.fulfill({json});
        });
        async function clickControl(name) {
          const ack=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/control');
          await page.getByRole('button',{name,exact:true}).click();
          assert.equal((await ack).status(),200,'fixture command acknowledged before payload observation');
        }
        await page.goto('http://panel.test/');
        // The HA host supplies the canvas behind a transparent ingress panel.
        await page.addStyleTag({content:`html {background:${scheme==='dark'?'#101923':'#ffffff'};}`});
        await page.waitForFunction(()=>document.querySelector('#pane-home .live-title')?.textContent==='Lytter');
        assert.equal(await page.locator('#room-tests img').count(),0,'untrusted transcript is text');
        assert.equal(await page.locator('#pane-home details').count(),0,'daily use has no tutorial/diagnostic disclosures');
        assert.doesNotMatch(await page.locator('#pane-home').innerText(),/Styring:|Ro:|Streamstart|Sådan|LED/);
        assert.equal(await page.locator('#wake-example').count(),0);
        assert.equal(await page.locator('#s_live_alpha').count(),1,'actual saved preference retained');
        assert.equal(await page.locator('.primary-controls button').count(),2);
        assert.equal(await page.locator('.room-diagnostics').evaluate(e=>e.open),false);
        assert.equal(await page.locator('#activity-section').evaluate(e=>e.open),false);
        assert.match(await page.locator('.room').innerText(),/Lytter/);
        assert.doesNotMatch(await page.locator('#svc').getAttribute('title')||'',/aktiv Realtime-session/);
        assert.ok(!await page.locator('#svc span').first().getAttribute('title').then(x=>x.includes('aktiv Realtime-session')));
        await clickControl('Start samtale i Køkken');
        await clickControl('Stop i Køkken');
        assert.deepEqual(commands,[{room:'Køkken',action:'listen'},{room:'Køkken',action:'stop'}]);
        assert.equal(await page.locator('#toast').innerText(),'Kommando modtaget');
        assert.match(await page.locator('#capabilities').textContent(),/Tid: verificeret/);
        assert.match(await page.locator('#capabilities').textContent(),/Hjem: fundet/);
        // Adversarial real-owner fixtures: pending names cannot classify a domain,
        // change input data or claim whole-home failure; details remain available.
        // Hold poll responses during this deliberate injected owner sequence;
        // release them with the final server state, avoiding unrelated fixture rollback.
        injecting=true;
        const pendingCaps={time:true,home:true,web_search:true,weather:true,music:true,timers:true,missing:[],
          discovery:{api_id:'assist',pending_tools:['HassBroadcast','HassCancelAllTimers'],role_conflicts:[]}};
        const pendingBefore=JSON.stringify(pendingCaps);
        await page.evaluate(c=>applyStatus({...lastStatus,capabilities:c,service_details:{...lastStatus.service_details,
          openai:{reason:'Realtime-session aktiv',source:'aktiv Realtime-session'}}}),pendingCaps);
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.evaluate(()=>JSON.stringify(lastStatus.capabilities)),pendingBefore,'projection does not mutate owner capabilities');
        assert.match(await page.locator('#cap_warning').innerText(),/Ekstra hjemmefunktioner afventer godkendelse/);
        assert.doesNotMatch(await page.locator('#pane-home').innerText(),/HassBroadcast|HassCancelAllTimers|Hjemmestyring er ikke tilgængelig/);
        assert.match(await page.locator('#capabilities').textContent(),/Hjem: fundet/);
        assert.match(await page.locator('#capabilities').textContent(),/Timere: fundet/);
        assert.doesNotMatch(await page.locator('#svc span').first().getAttribute('title'),/aktiv|Realtime-session/);
        assert.match(await page.locator('#svc span').first().getAttribute('title'),/seneste samtale/);
        await page.getByRole('button',{name:'Se Diagnose',exact:true}).focus();
        const warningChanges=await page.evaluate(()=>{
          const target=document.getElementById('cap_warning');let mutations=0;
          const watcher=new MutationObserver(x=>mutations+=x.length);watcher.observe(target,{childList:true});
          for(let i=0;i<5;i++)renderCapabilities(lastStatus.capabilities,lastStatus.capability_details);
          return Promise.resolve().then(()=>{watcher.disconnect();return mutations;});
        });
        assert.equal(warningChanges,0,'unchanged warning preserves keyboard target and avoids alert storm');
        assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Se Diagnose');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#tab-test').getAttribute('aria-selected'),'true');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'tab-test');
        assert.equal(await page.locator('#connection-details').evaluate(e=>e.open),true);
        assert.match(await page.locator('#capability-diagnostics').innerText(),/HassBroadcast, HassCancelAllTimers/);
        assert.match(await page.locator('#service-details').innerText(),/Realtime-session aktiv.*aktiv Realtime-session/);
        await page.locator('#tab-home').click();
        await page.evaluate(()=>applyStatus({...lastStatus,capabilities:{...lastStatus.capabilities,home:false,timers:false,
          missing:['home'],discovery:{role_conflicts:['home_control'],last_error:'fixture tool mismatch'}}}));
        assert.match(await page.locator('#cap_warning').innerText(),/Hjemmestyring, Timere er ikke tilgængelige/);
        assert.match(await page.locator('#cap_warning').innerText(),/blokeret af en konflikt/);
        assert.doesNotMatch(await page.locator('#cap_warning').innerText(),/home_control|fixture tool mismatch/);
        assert.match(await page.locator('#capability-diagnostics').textContent(),/home_control/);
        await page.evaluate(()=>{const c={...lastStatus.capabilities,home:true,missing:[],discovery:{}};delete c.timers;applyStatus({...lastStatus,capabilities:c});});
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#cap_warning').evaluate(e=>e.hidden),true,'absent timers are unknown, not unavailable');
        assert.match(await page.locator('#capabilities').textContent(),/Timere: ukendt/);
        assert.equal(await page.locator('#capabilities .pill').filter({hasText:'Timere: ukendt'}).getAttribute('class'),'pill pill-degraded');
        await page.evaluate(()=>applyStatus({...lastStatus,capabilities:{...lastStatus.capabilities,missing:['home'],discovery:{retry_state:'retrying',last_error:'fixture disconnect',next_retry_at:123}}}));
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.match(await page.locator('#cap_warning').innerText(),/Home Assistant forbinder igen/);
        assert.doesNotMatch(await page.locator('#cap_warning').innerText(),/fixture disconnect|Direkte dialog.*virker/);
        assert.match(await page.locator('#capability-diagnostics').textContent(),/fixture disconnect/);
        await page.evaluate(d=>applyStatus(d),status());
        serverStatus=await page.evaluate(()=>lastStatus);
        // Opaque IDs receive neutral device labels; the real command target stays exact.
        await page.evaluate(()=>{liveStatusWatermarks={};applyStatus({...lastStatus,rooms:[{...rooms['Køkken'],room:'R0',live_status:{...rooms['Køkken'].live_status,observed_at:Date.now()/1000,phase:'IDLE',wake_readiness:'recovered'}}]});});
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#rooms .rname').innerText(),'Voice PE');
        assert.equal(await page.locator('#pane-home .live-title').innerText(),'Vækkeord ikke bekræftet');
        assert.match(await page.locator('#rooms').innerText(),/Prøv dit vækkeord/);
        await clickControl('Start samtale i Voice PE');
        await clickControl('Stop i Voice PE');
        assert.deepEqual(commands.slice(2),[{room:'R0',action:'listen'},{room:'R0',action:'stop'}]);
        commands.length=2;
        await page.evaluate(()=>{const rm=rooms.R0;applyStatus({...lastStatus,rooms:[rm,{...rm,room:'r1'}]});});
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.deepEqual(await page.locator('#rooms .rname').allTextContents(),['Voice PE 1','Voice PE 2']);
        assert.deepEqual(await page.locator('#room-tests > details > summary').allTextContents(),['R0','r1']);
        await clickControl('Stop i Voice PE 2');
        assert.deepEqual(commands.pop(),{room:'r1',action:'stop'});
        await page.evaluate(()=>{const rm=rooms.R0;applyStatus({...lastStatus,rooms:[{...rm,connected:false,live_status:{...rm.live_status,observed_at:Date.now()/1000,wake_readiness:'proven'}}]});});
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#pane-home .live-title').innerText(),'Offline','disconnected cannot inherit proven readiness');
        await page.evaluate(()=>{const rm=rooms.R0;applyStatus({...lastStatus,rooms:[{...rm,connected:true,live_status:{...rm.live_status,observed_at:Date.now()/1000,wake_readiness:'fault'}}]});});
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#pane-home .live-title').innerText(),'Kræver opmærksomhed');
        await page.evaluate(()=>{const rm=rooms.R0;applyStatus({...lastStatus,rooms:[{...rm,live_status:{...rm.live_status,observed_at:Date.now()/1000,wake_readiness:'proven'}}]});});
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#pane-home .live-title').innerText(),'Klar');
        await page.evaluate(d=>{liveStatusWatermarks={};applyStatus(d);},status());
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#rooms .rname').innerText(),'Køkken','configured friendly name is preserved');
        injecting=false; heldPolls.splice(0).forEach(resolve=>resolve());

        await page.evaluate(()=>applyStatus({...lastStatus,diagnostic_active:true,services:{...lastStatus.services,openai:'degraded'}}));
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.match(await page.locator('#svc').innerText(),/midlertidigt låst/);
        assert.match(await page.locator('#svc span').first().getAttribute('title'),/Sikker systemtest/);
        await page.evaluate(()=>applyStatus({...lastStatus,diagnostic_active:false,services:{...lastStatus.services,openai:'up'}}));
        serverStatus=await page.evaluate(()=>lastStatus);
        await page.locator('#tab-test').click();
        assert.equal(await page.locator('#tab-test').innerText(),'Diagnose');
        await page.locator('.room-diagnostics > summary').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.room-diagnostics').evaluate(e=>e.open),true);
        await clickControl('Test højttaler i Køkken');
        assert.deepEqual(commands[2],{room:'Køkken',action:'test_speaker'});
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('.primary-controls button')).every(e=>!e.disabled));
        await page.locator('.room-diagnostics > summary').focus();
        await page.evaluate(v=>applyEvent({type:'live_status',room:'Køkken',live_status:v}),sample('LISTENING',{blocker:'fixture update'}));
        assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY','diagnostic focus retained');
        assert.equal(await page.locator('.room-diagnostics').evaluate(e=>e.open),true);
        await page.locator('#tab-home').click();
        await page.getByRole('button',{name:'Stop i Køkken',exact:true}).focus();
        await page.evaluate(v=>applyEvent({type:'live_status',room:'Køkken',live_status:v}),sample('CLOSING',{timer_kind:'deadline',remaining_s:0,countdown_running:true}));
        assert.equal(await page.locator('#pane-home .live-title').innerText(),'Afslutter');
        assert.match(await page.locator('#pane-home .live-status').innerText(),/Afventer afslutning\./);
        assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Stop i Køkken');
        assert.equal(await page.locator('.room-diagnostics').evaluate(e=>e.open),true,'SSE retains disclosure');
        await page.evaluate(()=>{const v=rooms.Køkken.live_status;applyStatus({...lastStatus,rooms:[{...rooms.Køkken,live_status:{...v,observed_at:v.observed_at-1,phase:'IDLE',wake_readiness:'proven'}}]});});
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#pane-home .live-title').innerText(),'Afslutter','late poll cannot claim ready');
        const overflows=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        assert.ok(overflows.scroll<=overflows.width,JSON.stringify({width,scheme,overflows}));
        const tooSmall=await page.evaluate(()=>Array.from(document.querySelectorAll('button,summary,input:not([type=checkbox]),select')).filter(e=>e.getClientRects().length && !e.disabled).map(e=>({text:e.textContent||e.id,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(e=>e.w<43.9||e.h<43.9));
        assert.deepEqual(tooSmall,[],`touch targets ${width}/${scheme}`);
        await page.locator('#tab-home').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#tab-talk').getAttribute('aria-selected'),'true');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'tab-talk');
        await page.keyboard.press('Home');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'tab-home');
        let changes=await page.evaluate(()=>{
          const target=document.getElementById('svc_announce');let mutations=0;
          const watcher=new MutationObserver(x=>mutations+=x.length);watcher.observe(target,{childList:true});
          for(let i=0;i<5;i++)renderServices(lastStatus.services,lastStatus.service_details,false);
          return Promise.resolve().then(()=>{watcher.disconnect();return mutations;});
        });
        assert.equal(changes,0,'unchanged service poll must not announce repeatedly');
        // Measure the rendered text against composed CSS backgrounds, including dark mode.
        const contrast=await page.evaluate(()=>{
          const rgba=s=>(s.match(/[\d.]+/g)||[]).map(Number);
          const blend=(fg,bg)=>{const a=fg[3]??1;return fg.slice(0,3).map((c,i)=>c*a+bg[i]*(1-a));};
          const luminance=c=>c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((x,c,i)=>x+c*[.2126,.7152,.0722][i],0);
          const results=[];
          for(const e of document.querySelectorAll('body *')){
            if(!e.getClientRects().length||e.closest('[disabled],.sr-only')||!Array.from(e.childNodes).some(n=>n.nodeType===3&&n.textContent.trim()))continue;
            const style=getComputedStyle(e); if(style.visibility==='hidden')continue;
            const chain=[];for(let p=e;p;p=p.parentElement)chain.unshift(p);
            let bg=[255,255,255];for(const p of chain)bg=blend(rgba(getComputedStyle(p).backgroundColor),bg);
            const fg=blend(rgba(style.color),bg), l1=luminance(fg),l2=luminance(bg),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
            const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&parseInt(style.fontWeight)>=700);
            results.push({text:e.textContent.trim().slice(0,65),ratio:+ratio.toFixed(2),required:large?3:4.5});
          }
          return {tested:results.length,minimum:Math.min(...results.map(x=>x.ratio)),failures:results.filter(x=>x.ratio+.01<x.required)};
        });
        assert.deepEqual(contrast.failures,[],`rendered text contrast ${width}/${scheme}: ${JSON.stringify(contrast.failures)}`);
        await page.locator('.room-diagnostics').evaluate(e=>e.open=false);
        if(proof)await page.screenshot({path:path.join(proof,`home-${width}-${scheme}.png`),fullPage:true});
        for (const pane of ['talk','test','history','settings']) {
          await page.locator('#tab-'+pane).click();
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${pane} overflow ${width}/${scheme}`);
          if(proof && [390,1440].includes(width)){ await page.waitForTimeout(220); await page.screenshot({path:path.join(proof,`${pane}-${width}-${scheme}.png`),fullPage:true}); }
        }
        // CSS zoom changes layout geometry (deviceScaleFactor alone would not).
        await page.locator('#tab-home').click();
        await page.evaluate(()=>document.body.style.zoom='2');
        const zoomOverflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,out:Array.from(document.querySelectorAll('body *')).filter(e=>e.getClientRects().length && e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right}))}));
        assert.ok(zoomOverflow.scroll<=zoomOverflow.width,`200% overflow ${width}/${scheme}: ${JSON.stringify(zoomOverflow)}`);
        if(proof)await page.screenshot({path:path.join(proof,`home-${width}-${scheme}-zoom200.png`),fullPage:true});
        assert.deepEqual(errors,[],`page errors ${width}/${scheme}`);
        reports.push({width,scheme,overflow:false,zoom200Overflow:false,focus:'preserved',commands:'unchanged',unchangedStatusAnnouncements:changes,contrast});
        await page.close();
      }
    }
    if(proof)fs.writeFileSync(path.join(proof,'browser-report.json'),JSON.stringify({evidence:'Chromium with synthetic API fixtures; no live HA, provider, VoiceOver or physical Voice PE',results:reports},null,2));
    console.log(JSON.stringify({pass:true,evidence:'Shipped HTML + Chromium + synthetic API fixtures',results:reports},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
