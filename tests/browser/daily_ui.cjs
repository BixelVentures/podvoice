// Real Chromium, shipped HTML, synthetic API fixtures; no HA/provider/device access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { chromium } = require('playwright');
const root = process.env.PODVOICE_UI_ROOT || path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'podvoice/gatekeeper/static/index.html'), 'utf8');
const sourceSha=crypto.createHash('sha256').update(source).digest('hex');
// Optional historical source is screenshot evidence only. Candidate regression
// below is mandatory regardless of evidence paths and never accepts old defects.
const baselinePath=process.env.PODVOICE_UI_BASELINE_HTML;
const baselineSource=baselinePath?fs.readFileSync(baselinePath,'utf8'):null;
const baselineSha=baselineSource?crypto.createHash('sha256').update(baselineSource).digest('hex'):null;
if(baselineSource)assert.equal(baselineSha,'ab7f58280ba9f6a50894b9a375afd4f42333dbe73a579b1900f40354c0bb3bf5','explicit published539 screenshot baseline');
const proof = process.env.PODVOICE_UI_PROOF_DIR;
if(baselineSource)assert.ok(proof,'explicit baseline screenshot request requires proof directory');
if (proof) fs.mkdirSync(proof, {recursive:true});
const reports = [];
// Test-only observation bound; production deadlines and state are untouched.
const FIXTURE_WAIT_MS=15000;
function bounded(work,label,ms=FIXTURE_WAIT_MS) {
  let timer;
  return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})])
    .finally(()=>clearTimeout(timer));
}

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
// Passive projection regression: input rows are fixtures, the renderer is shipped.
// Build nonfinite values inside the browser task; JSON cannot carry NaN/Infinity.
function measurementObservation(box, index) {
  function edge(event, at_ms, extra={}) {
    const row={room:'Køkken',session:'fixture-measurement',event,...extra};
    if(at_ms!==undefined)row.at_ms=at_ms;
    return row;
  }
  const cases=[
    {name:'finite-host-arrival',kind:'numeric',events:[edge('speech_stopped',0),edge('input_transcript',20),edge('response_audio_started',50),edge('playback_started',100)]},
    {name:'missing-turn-ends',kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',100)]},
    ...[null,'bad',false,'150'].map((value,i)=>({name:'invalid-edge-'+i,kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',100),edge('playback_started',value)]})),
    {name:'missing-numeric-edge',kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',100),edge('playback_started',undefined)]},
    {name:'invalid-start-null',kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',null),edge('playback_started',200)]},
    {name:'reverse-monotonic-order',kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',200),edge('playback_started',100)]},
    {name:'negative-monotonic-edge',kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',-100),edge('playback_started',200)]},
    {name:'nonfinite-NaN',kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',100),edge('playback_started',NaN)]},
    {name:'nonfinite-Infinity',kind:'unknown',prefix:'Tur:',events:[edge('speech_stopped',100),edge('playback_started',Infinity)]},
    {name:'typed-start-is-not-speech',kind:'typed',events:[edge('speech_stopped',100,{source:'text',accepted:true}),edge('response_audio_started',150)]},
    {name:'actual-recovery-edge',kind:'recovery',events:[edge('close_requested',100),edge('wake_rearm_recovered',200)]}
  ];
  const invalid=[['null',null],['bad-string','bad'],['boolean-false',false],['boolean-true',true],['numeric-string','150'],['negative',-100],['NaN',NaN],['Infinity',Infinity],['negative-Infinity',-Infinity],['missing',undefined]];
  for(const [name,first,last,prefix] of [
    ['wake','wake_received','provider_connected','Wake → provider klar:'],
    ['close','close_requested','wake_rearmed','Lukning → rearm-kvittering:']
  ]) {
    cases.push({name:name+'-finite-zero-start',kind:'pair',prefix,expected:'100 ms',events:[edge(first,0),edge(last,100)]});
    cases.push({name:name+'-zero-delta',kind:'pair',prefix,expected:'0 ms',events:[edge(first,0),edge(last,0)]});
    for(const [type,value] of invalid)for(const endpoint of ['first','last'])
      cases.push({name:name+'-'+endpoint+'-'+type,kind:'unknown',prefix,events:[edge(first,endpoint==='first'?value:100),edge(last,endpoint==='last'?value:200)]});
    cases.push({name:name+'-reverse',kind:'unknown',prefix,events:[edge(first,200),edge(last,100)]});
    cases.push({name:name+'-missing-pair',kind:'absent-pair',prefix,events:[edge(first,100)]});
  }
  for(const [type,value] of [['zero',0],['finite',100],...invalid]) {
    cases.push({name:'offset-'+type,kind:'offset',expected:type==='zero'?'+0 ms':type==='finite'?'+100 ms':'—',events:[edge('input_transcript',value)]});
    const extra=type==='missing'?{}:{duration_ms:value};
    cases.push({name:'duration-'+type,kind:'duration',expected:type==='zero'?'0 ms':type==='finite'?'100 ms':type==='missing'?null:'—',events:[edge('input_transcript',100,extra)]});
  }
  if(index===null)return cases.map(({name,kind})=>({name,kind}));
  const item=cases[index];
  // The marker distinguishes null/NaN/Infinity signatures without clock changes.
  item.events[0].fixture_renderer_case=item.name;
  renderLifecycle(item.events);
  return {name:item.name,kind:item.kind,prefix:item.prefix,expected:item.expected,
    signature:JSON.stringify(item.events),signatureMatches:box.dataset.signature===JSON.stringify(item.events),
    text:box.textContent,
    rows:Array.from(box.children).filter(row=>!row.querySelector('.who')).map(row=>row.textContent),
    eventRows:Array.from(box.children).filter(row=>row.querySelector('.who')).map(row=>({offset:row.querySelector('.who').textContent,label:row.lastChild.textContent}))};
}
function assertMeasurement(observed) {
  assert.equal(observed.signatureMatches,true,observed.name+' actual renderer signature');
  assert.doesNotMatch(observed.text,/NaN|Infinity|(?:^|\s)-\d+\s*ms/,observed.name+' invalid/negative measurement');
  assert.doesNotMatch(observed.text,/hørbart svar|meningsfuld.*lyd/i,observed.name+' host times are not audible proof');
  const summary=observed.rows.find(row=>observed.prefix && row.startsWith(observed.prefix));
  if(observed.kind==='unknown') {
    assert.ok(summary && /ukendt|—/.test(summary),observed.name+' unknown summary');
    assert.doesNotMatch(summary,/\d+\s*ms/,observed.name+' unusable pair cannot derive duration');
  }
  if(observed.kind==='numeric') {
    assert.ok(observed.rows.some(row=>row.includes('50 ms') && row.includes('100 ms')),'finite same-owner deltas retained');
    assert.ok(observed.text.includes('Serverens hændelsestider'),'known host-event label');
  }
  if(observed.kind==='typed') {
    assert.ok(observed.rows.some(row=>/tekstinput|skrevet|indtastet/i.test(row)),'written-input summary');
    assert.ok(!observed.text.includes('Du stoppede med at tale'),'written-input event label');
  }
  if(observed.kind==='recovery') {
    assert.match(observed.text,/genaktiver|genoprett|genopret|recovery|gendannet/i,'actual recovery label');
    assert.doesNotMatch(observed.text,/wake_rearm_recovered|Firmware har kvitteret genaktivering|fysisk vækning bekræftet|næste wake bevist/i,'recovery is not wake ACK/proof');
    assert.doesNotMatch(observed.text,/rearm-kvittering: 100 ms/,'recovery cannot invent ACK summary');
  }
  if(observed.kind==='pair')assert.equal(summary,observed.prefix+' '+observed.expected,observed.name);
  if(observed.kind==='absent-pair')assert.equal(summary,undefined,observed.name+' no forced missing-pair summary');
  if(observed.kind==='offset')assert.equal(observed.eventRows[0].offset,observed.expected,observed.name);
  if(observed.kind==='duration')assert.equal(observed.eventRows[0].label,'Transskription klar'+(observed.expected===null?'':' · '+observed.expected),observed.name);
}
async function observeMeasurement(page,index) {
  return bounded(page.locator('#lifecycle_timeline').evaluate(measurementObservation,index,{timeout:FIXTURE_WAIT_MS}),'atomic measurement observation');
}
async function captureMeasurement(page,indices,variant,width,sourceHash) {
  const screenshots=[];
  for(const index of indices) {
    const observed=await observeMeasurement(page,index);
    if(variant==='after')assertMeasurement(observed);
    const signature=()=>page.locator('#lifecycle_timeline').evaluate(box=>box.dataset.signature,undefined,{timeout:FIXTURE_WAIT_MS});
    assert.equal(await bounded(signature(),'measurement before screenshot'),observed.signature,'fixture still displayed before screenshot');
    const name=`measurement-${variant}-${width}-${observed.name}.png`;
    await bounded(page.screenshot({path:path.join(proof,name),fullPage:true}),'source-bound measurement screenshot');
    assert.equal(await bounded(signature(),'measurement after screenshot'),observed.signature,'fixture still displayed after screenshot');
    screenshots.push({path:name,width,variant,case:observed.name,html_sha256:sourceHash,observed,
      caption:'Actual full HTML; synthetic host-event rows injected atomically into shipped renderLifecycle. No physical latency or viewport acceptance.'});
  }
  return screenshots;
}
async function baselineMeasurementScreens(browser,width,indices) {
  let page,context,primary=null;const cleanupErrors=[],held=[],owned=[];let hold=false,onHeld=null;
  const own=work=>{owned.push(work);work.catch(()=>{});return work;};
  const errors=[],testRequests=[];let screenshots=[];
  try {
    page=await bounded(browser.newPage({viewport:{width,height:1000},colorScheme:'light'}),'baseline page');context=page.context();
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.EventSource=class {constructor(){setTimeout(()=>this.onopen?.(),0);}close(){}};
      window.WebSocket=class {static OPEN=1;constructor(){this.readyState=3;}send(){}close(){}};
    });
    await page.route('http://panel.test/**',async route=>{
      const url=new URL(route.request().url());
      if(/^\/api\/(?:eval(?:\/|$)|groundtest(?:\/|$)|stuetest(?:\/|$)|acceptance$)/.test(url.pathname))testRequests.push(url.pathname);
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:baselineSource});
      let json={ok:true,status:'idle'};
      if(url.pathname==='/api/status') {
        if(hold)await new Promise(resolve=>{held.push(resolve);if(onHeld){const notify=onHeld;onHeld=null;notify();}});
        json=status();
      }
      if(url.pathname==='/api/settings')json=settings;
      if(url.pathname==='/api/models')json={models:[],voices:[],default:null};
      return route.fulfill({json});
    });
    const initialized=own(page.waitForResponse(r=>new URL(r.url()).pathname==='/api/status',{timeout:FIXTURE_WAIT_MS}));
    await bounded(page.goto('http://panel.test/'),'actual baseline HTML');await bounded(initialized,'baseline status initializer');
    await page.waitForFunction(()=>document.getElementById('lifecycle_timeline')?.dataset.signature==='[]' && document.getElementById('s_save')?.disabled===false,null,{timeout:FIXTURE_WAIT_MS});
    await page.locator('#tab-test').click({timeout:FIXTURE_WAIT_MS});
    hold=true;const entered=new Promise(resolve=>onHeld=resolve);const poll=own(page.evaluate(()=>poll()));
    await bounded(entered,'baseline screenshot poll held');
    screenshots=await captureMeasurement(page,indices,'before',width,baselineSha);
    assert.deepEqual(errors,[],'baseline full-HTML script errors');assert.deepEqual(testRequests,[],'baseline has no hidden conversation tests');
    hold=false;held.splice(0).forEach(resolve=>resolve());await bounded(poll,'baseline held poll release');
  }catch(error){primary=error;}
  finally {
    hold=false;onHeld=null;held.splice(0).forEach(resolve=>resolve());
    // This extra page/context belongs to the same worker and existing browser.
    // Attempt both public owners and preserve the primary failure independently.
    for(const [owner,label] of [[page,'baseline page cleanup'],[context,'baseline context cleanup']]) {
      if(!owner)continue;
      try{await bounded(owner.close(),label);}catch(error){cleanupErrors.push({owner:label,error:String(error)});}
    }
    try{await bounded(Promise.allSettled(owned),'baseline owned-work join');}catch(error){cleanupErrors.push({owner:'baseline owned work',error:String(error)});}
  }
  const report={width,html_sha256:baselineSha,source_kind:'published539 full HTML',screenshots,cleanup_complete:!cleanupErrors.length,
    primary_error:primary?String(primary):null,cleanup_errors:cleanupErrors,evidence:'Synthetic rendered projection only; baseline defects are observations, not accepted behavior'};
  if(proof)fs.writeFileSync(path.join(proof,`measurement-before-${width}.json`),JSON.stringify(report,null,2)+'\n');
  if(primary)throw primary;assert.deepEqual(cleanupErrors,[],'baseline public-owner cleanup');return report;
}

// Actual origin/API controls admission; inert transport events never request capture.
async function talkCaptureGuard(page,secure) {
  const kind=secure?'https-native-api':'http-no-native-api';
  const report={issue:115,kind,html_sha256:sourceSha,phases:[],capture_requested:false,permissions_modified:false,
    evidence:'Actual full HTML and native secure context/API availability; inert hello/diagnostic edges only. No MediaStream/audio/HA-app/Safari proof.'};
  function record(phase,state) {
    report.phases.push({phase,...state});
    if(proof)fs.writeFileSync(path.join(proof,`talk-capture-${kind}.json`),JSON.stringify(report,null,2)+'\n');
  }
  function snapshot() {
    return {secure_context:window.isSecureContext,
      get_user_media:typeof navigator.mediaDevices?.getUserMedia==='function',
      mic_disabled:document.getElementById('cmic').disabled,
      mic_pressed:document.getElementById('cmic').getAttribute('aria-pressed'),
      hint:document.getElementById('cmichint').textContent,
      send_disabled:document.getElementById('csend').disabled,
      stage:document.getElementById('cstage_title').textContent};
  }
  // Snapshot is an observer only; no controller/capability logic is duplicated.
  const read=()=>bounded(page.evaluate(snapshot),'native capture admission snapshot');
  await page.locator('#tab-talk').click({timeout:FIXTURE_WAIT_MS});
  await page.waitForFunction(()=>window.__fixtureTalkSockets?.some(sock=>
    new URL(sock.url).pathname==='/api/talk' && typeof sock.onmessage==='function'),null,{timeout:FIXTURE_WAIT_MS});
  const before=await read();record('initial',before);
  assert.equal(before.secure_context,secure,'real standard origin matches fixture');
  assert.equal(before.get_user_media,secure,'real native capture API availability matches origin');
  assert.equal(before.mic_disabled,true,'initial transport has not admitted microphone');
  if(!secure)assert.match(before.hint,/HTTPS/,'initial concrete HTTPS action');
  await bounded(page.evaluate(()=>{
    const sock=window.__fixtureTalkSockets.find(sock=>new URL(sock.url).pathname==='/api/talk');
    sock.readyState=WebSocket.OPEN;if(sock.onopen)sock.onopen({type:'open'});
    sock.onmessage({data:JSON.stringify({type:'hello',protocol:2,rate:24000})});
  }),'actual shipped hello');
  const hello=await read();record('hello',hello);
  assert.equal(hello.send_disabled,false,'hello admits permitted text input');
  assert.equal(hello.stage,'Klar','actual hello handler ran');
  assert.equal(hello.secure_context,secure,'hello does not change origin security');
  assert.equal(hello.get_user_media,secure,'hello does not grant capture capability');
  assert.equal(hello.mic_disabled,!secure,'hello preserves native capture prerequisite');
  assert.equal(hello.mic_pressed,'false','hello did not request microphone capture');
  if(!secure)assert.match(hello.hint,/HTTPS/,'HTTPS action retained after hello');
  await bounded(page.evaluate(()=>applyStatus({...lastStatus,diagnostic_active:true})),'actual diagnostic active');
  const active=await read();record('diagnostic-active',active);
  assert.equal(active.mic_disabled,true,'diagnostic owner excludes capture');
  assert.equal(active.send_disabled,true,'diagnostic owner excludes text');
  assert.equal(active.stage,'Systemtest kører','actual diagnostic listener ran');
  await bounded(page.evaluate(()=>applyStatus({...lastStatus,diagnostic_active:false})),'actual diagnostic cleared');
  const cleared=await read();record('diagnostic-cleared',cleared);
  assert.equal(cleared.send_disabled,false,'diagnostic cleared restores permitted text');
  assert.equal(cleared.stage,'Klar','actual diagnostic cleared listener ran');
  assert.equal(cleared.secure_context,secure,'diagnostic clearance cannot change origin');
  assert.equal(cleared.get_user_media,secure,'diagnostic clearance cannot grant capture API');
  assert.equal(cleared.mic_disabled,!secure,'diagnostic cleared retains native capture prerequisite');
  assert.equal(cleared.mic_pressed,'false','no capture started during diagnosis');
  if(!secure)assert.match(cleared.hint,/HTTPS/,'HTTPS action retained after diagnostic clearance');
  report.pass=true;record('complete',{});return report;
}
async function secureTalkCaptureGuard(browser) {
  let page,context,primary=null,result=null;const cleanupErrors=[],held=[],owned=[];
  let hold=false,onHeld=null;const errors=[],testRequests=[];
  const own=work=>{owned.push(work);work.catch(()=>{});return work;};
  try {
    page=await bounded(browser.newPage({viewport:{width:390,height:1000},colorScheme:'light'}),'secure capture page');context=page.context();
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.EventSource=class {constructor(){setTimeout(()=>this.onopen?.(),0);}close(){}};
      window.__fixtureTalkSockets=[];
      window.WebSocket=class {static OPEN=1;constructor(url){this.readyState=3;this.url=String(url);window.__fixtureTalkSockets.push(this);}send(){}close(){}};
    });
    // Routing actual HTTPS HTML/API avoids external network. Browser security and
    // navigator.mediaDevices are untouched; no ignored certificate/security flags.
    await page.route('https://panel.test/**',async route=>{
      const url=new URL(route.request().url());
      if(/^\/api\/(?:eval(?:\/|$)|groundtest(?:\/|$)|stuetest(?:\/|$)|acceptance$)/.test(url.pathname))testRequests.push(url.pathname);
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:source});
      let json={ok:true,status:'idle'};
      if(url.pathname==='/api/status') {
        if(hold)await new Promise(resolve=>{held.push(resolve);if(onHeld){const notify=onHeld;onHeld=null;notify();}});
        json=status();
      }
      if(url.pathname==='/api/settings')json=settings;
      if(url.pathname==='/api/models')json={models:[],voices:[],default:null};
      return route.fulfill({json});
    });
    await bounded(page.goto('https://panel.test/'),'actual HTTPS HTML');
    await page.waitForFunction(()=>document.querySelector('#pane-home .live-title')?.textContent==='Lytter' &&
      document.getElementById('s_save')?.disabled===false,null,{timeout:FIXTURE_WAIT_MS});
    hold=true;const entered=new Promise(resolve=>onHeld=resolve);const poll=own(page.evaluate(()=>poll()));
    await bounded(entered,'HTTPS capture poll held');assert.ok(held.length>0,'actual HTTPS poll is held');
    result=await talkCaptureGuard(page,true);
    assert.deepEqual(errors,[],'HTTPS whole-HTML script errors');assert.deepEqual(testRequests,[],'HTTPS has no hidden conversation-test API');
    hold=false;held.splice(0).forEach(resolve=>resolve());await bounded(poll,'HTTPS held poll released');
  }catch(error){primary=error;}
  finally {
    hold=false;onHeld=null;held.splice(0).forEach(resolve=>resolve());
    for(const [owner,label] of [[page,'HTTPS page cleanup'],[context,'HTTPS context cleanup']]) {
      if(!owner)continue;
      try{await bounded(owner.close(),label);}catch(error){cleanupErrors.push({owner:label,error:String(error)});}
    }
    try{await bounded(Promise.allSettled(owned),'HTTPS owned-work join');}catch(error){cleanupErrors.push({owner:'HTTPS owned work',error:String(error)});}
  }
  const receipt={result,primary_error:primary?String(primary):null,cleanup_complete:!cleanupErrors.length,cleanup_errors:cleanupErrors};
  if(proof)fs.writeFileSync(path.join(proof,'talk-capture-https-owner.json'),JSON.stringify(receipt,null,2)+'\n');
  if(primary)throw primary;assert.deepEqual(cleanupErrors,[],'HTTPS public-owner cleanup');return receipt;
}

// Whole shipped settings form, actual native label activation and CSS geometry.
// API payloads are inert; this fixture never saves settings or opens Talk.
async function settingsTouchTargets(browser) {
  const results=[];
  const checkboxIds=['s_live_alpha','s_force_mini','s_extended_device_control','s_panel_lan_open'];
  for(const width of [320,360,390,430,768,1440])for(const scheme of ['light','dark']) {
    let page,context,primary,result;
    const cleanupErrors=[],errors=[],writes=[];
    try {
      page=await bounded(browser.newPage({viewport:{width,height:1000},colorScheme:scheme}),'settings touch page');
      context=page.context();
      page.on('pageerror',error=>errors.push(error.message));
      await bounded(page.addInitScript(()=>{
        window.EventSource=class {close(){}};
        window.WebSocket=class {static OPEN=1;constructor(){this.readyState=3;}close(){this.readyState=3;}send(){}};
      }),'settings touch inert transports');
      await bounded(page.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!=='https://panel.test')return route.abort('blockedbyclient');
        if(request.method()!=='GET') {
          writes.push({path:url.pathname,method:request.method()});
          return route.abort('blockedbyclient');
        }
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:source});
        let json={ok:true};
        if(url.pathname==='/api/status')json=status();
        if(url.pathname==='/api/settings')json=settings;
        if(url.pathname==='/api/models')json={models:[],voices:[],default:null};
        if(url.pathname==='/api/podconnect/rooms')json={rooms:[]};
        return route.fulfill({json});
      }),'settings touch isolated routes');
      await bounded(page.goto('https://panel.test/'),'settings touch full HTML');
      await page.locator('#tab-settings').click({timeout:FIXTURE_WAIT_MS});
      await page.waitForFunction(()=>document.querySelector('#s_save').disabled===false,null,{timeout:FIXTURE_WAIT_MS});
      await page.locator('#pane-settings details.adv > summary').first().click({timeout:FIXTURE_WAIT_MS});
      await page.locator('#pane-settings details.adv > summary').filter({hasText:'Sikkerhed'}).click({timeout:FIXTURE_WAIT_MS});
      await page.locator('#s_addroom').click({timeout:FIXTURE_WAIT_MS});
      assert.equal(await page.locator('#s_rooms .roomrow input').count(),2,'actual add-room uses text address and room fallback');
      const geometry=await bounded(page.evaluate(()=>{
        const selectors=['#pane-settings .setgrid label[for]','#s_rooms .roomrow input'];
        const targets=selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector)))
          .filter(element=>element.getClientRects().length);
        return targets.map(element=>{
          const rect=element.getBoundingClientRect();
          return {id:element.id||element.htmlFor||element.className,width:rect.width,height:rect.height,
            control:element instanceof HTMLLabelElement?element.control?.id:null};
        });
      }),'settings touch rendered geometry');
      assert.ok(geometry.length>checkboxIds.length+2,'actual visible form label inventory observed');
      assert.deepEqual(geometry.filter(target=>target.width<43.99||target.height<43.99),[],
        `settings targets below44px ${width}/${scheme}: ${JSON.stringify(geometry)}`);
      const labels=[];
      for(const id of checkboxIds) {
        const label=page.locator(`#pane-settings label[for="${id}"]`),input=page.locator('#'+id);
        assert.equal(await label.count(),1,id+' unique native label');
        assert.equal(await bounded(label.evaluate((element,id)=>element.control===document.getElementById(id),id),'settings touch label association'),true,id+' exact native control');
        await label.scrollIntoViewIfNeeded({timeout:FIXTURE_WAIT_MS});
        const box=await label.boundingBox();assert.ok(box && box.width>=43.99 && box.height>=43.99,id+' full label44px');
        const before=await input.isChecked();
        // The bottom interior tests the enlarged label area, not only its text.
        await label.click({position:{x:2,y:box.height-2},timeout:FIXTURE_WAIT_MS});
        assert.equal(await input.isChecked(),!before,id+' bottom-edge label activates native checkbox');
        await label.click({position:{x:2,y:box.height-2},timeout:FIXTURE_WAIT_MS});
        assert.equal(await input.isChecked(),before,id+' second explicit click restores fixture selection');
        labels.push({id,width:box.width,height:box.height,bottomEdgeToggle:true});
      }
      const overflow=await bounded(page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth})),'settings touch overflow');
      assert.ok(overflow.scroll<=overflow.width,JSON.stringify({width,scheme,overflow}));
      assert.deepEqual(writes,[],'geometry and native label activation never save/restart/control');
      assert.deepEqual(errors,[],'whole HTML settings scripts remain valid');
      if(proof)await bounded(page.screenshot({path:path.join(proof,`settings-targets-${width}-${scheme}.png`),fullPage:true}),'settings touch screenshot');
      result={width,scheme,html_sha256:sourceSha,geometry,labels,overflow:false,writes:0};
    } catch(error) {primary=error;}
    finally {
      if(page)try {await bounded(page.close(),'settings touch page cleanup');}catch(error){cleanupErrors.push(String(error));}
      if(context)try {await bounded(context.close(),'settings touch context cleanup');}catch(error){cleanupErrors.push(String(error));}
    }
    if(primary) {if(cleanupErrors.length)primary.message+='; cleanup: '+cleanupErrors.join('; ');throw primary;}
    assert.deepEqual(cleanupErrors,[],'settings touch owned page/context cleanup');
    results.push({...result,cleanup_complete:true});
  }
  return {issue:130,results,evidence:'Actual full HTML/CSS/native labels with inert APIs; not installed HA/Safari, saved preferences, provider or physical evidence.'};
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PODVOICE_TEST_CHROMIUM});
  try {
    for (const width of [320,390,430,768,1440]) {
      for (const scheme of ['light','dark']) {
        const page=await browser.newPage({viewport:{width,height:1000},colorScheme:scheme});
        const errors=[], commands=[], testRequests=[];
        let serverStatus=status(), injecting=false, onHeldPoll=null;
        const heldPolls=[],ownedWork=[];
        function own(work){ownedWork.push(work);work.catch(()=>{});return work;}
        try {
        page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{
          // Fixture I/O: real rendered app and controllers, no external sockets.
          window.EventSource=class { constructor(){setTimeout(()=>this.onopen?.(),0);} close(){} };
          window.__fixtureTalkSockets=[];
          window.WebSocket=class { static OPEN=1; constructor(url){this.readyState=3;this.url=String(url);window.__fixtureTalkSockets.push(this);} send(){} close(){} };
        });
        await page.route('http://panel.test/**',async route=>{
          const url=new URL(route.request().url());
          if (/^\/api\/(?:eval(?:\/|$)|groundtest(?:\/|$)|stuetest(?:\/|$)|acceptance$)/.test(url.pathname))
            testRequests.push({method:route.request().method(),path:url.pathname});
          if (url.pathname==='/') return route.fulfill({contentType:'text/html',body:source});
          let json={ok:true,status:'idle'};
          if (url.pathname==='/api/status') { if(injecting)await new Promise(resolve=>{
            heldPolls.push(resolve);
            if(onHeldPoll){const notify=onHeldPoll;onHeldPoll=null;notify();}
          }); json=JSON.parse(JSON.stringify(serverStatus)); json.rooms.forEach(r=>{if(r.live_status)r.live_status.observed_at=Date.now()/1000;}); }
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
        for(const id of ['eval_live','eval_audio_idle','eval_protocol_owner','eval_golden','eval_close',
          'eval_quiet_thanks','eval_device','eval_data','eval_replay','eval_numeric_ab','eval_numeric_preview',
          'eval_result','g_start','g_test','g_actions','g_final_actions','g_hint','a_start','a_refresh','stuetest_script','acceptance'])
          assert.equal(await page.locator('#'+id).count(),0,'conversation test UI removed: '+id);

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
        assert.equal(await page.locator('#pane-home .live-title').innerText(),'Vækning ikke bekræftet');
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
        for(const fixture of [
          {word:'hey_chat_hey_jarvis',wake:'recovered',service:'degraded',title:'Vækning ikke bekræftet',wordLabel:'Ordvalg bekræftet af enheden: Hey Chat + Hey Jarvis',reason:'Wake-motoren afprøves'},
          {word:null,wake:'proven',service:'up',title:'Klar',wordLabel:'Kan ikke bekræfte vækkeord',reason:'Wakeword blev fysisk registreret'},
          {word:'hey_chat_hey_jarvis',wake:'proven',service:'degraded',title:'Klar',wordLabel:'Ordvalg bekræftet af enheden: Hey Chat + Hey Jarvis',reason:'Firmwarekontrakten mangler: fixture-contract'}
        ]) {
          await page.evaluate(f=>{const rm=rooms.R0;applyStatus({...lastStatus,
            services:{...lastStatus.services,voicepe:f.service},
            service_details:{...lastStatus.service_details,voicepe:{reason:f.reason,source:'fixture owner'}},
            rooms:[{...rm,wake_word_confirmed:f.word,live_status:{...rm.live_status,observed_at:Date.now()/1000,wake_readiness:f.wake}}]});},fixture);
          serverStatus=await page.evaluate(()=>lastStatus);
          assert.equal(await page.locator('#pane-home .live-title').innerText(),fixture.title);
          assert.ok((await page.locator('#s_wake_word_status').textContent()).includes(fixture.wordLabel));
          const badge=page.locator('#svc span').filter({hasText:'Voice PE:'});
          assert.equal(await badge.innerText(),'Voice PE: '+(fixture.service==='up'?'wake-klar':'ikke verificeret'));
          assert.ok((await badge.getAttribute('title')).includes(fixture.reason),'original owner reason retained');
          assert.equal(await page.evaluate(()=>rooms.R0.wake_word_confirmed),fixture.word,'projection never changes device ACK');
          assert.equal(await page.evaluate(()=>rooms.R0.live_status.wake_readiness),fixture.wake,'projection never changes physical readiness');
        }
        await page.evaluate(d=>{liveStatusWatermarks={};applyStatus(d);},status());
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.equal(await page.locator('#rooms .rname').innerText(),'Køkken','configured friendly name is preserved');
        // A deliberate outstanding poll proves the fixture barrier, rather than
        // relying on whether the real three-second poll happened to fire.
        const deliberateHeld=new Promise(resolve=>onHeldPoll=resolve);
        const deliberatePoll=own(page.evaluate(()=>poll()));
        await bounded(deliberateHeld,'deliberate poll entered');
        assert.ok(heldPolls.length>0,'actual poll is held before diagnostic injection');
        await page.evaluate(()=>applyStatus({...lastStatus,diagnostic_active:true,services:{...lastStatus.services,openai:'degraded'}}));
        serverStatus=await page.evaluate(()=>lastStatus);
        assert.match(await page.locator('#svc').innerText(),/midlertidigt låst/);
        assert.match(await page.locator('#svc span').first().getAttribute('title'),/Sikker systemtest/);
        await page.evaluate(()=>applyStatus({...lastStatus,diagnostic_active:false,services:{...lastStatus.services,openai:'up'}}));
        serverStatus=await page.evaluate(()=>lastStatus);
        injecting=false; heldPolls.splice(0).forEach(resolve=>resolve());
        await bounded(deliberatePoll,'deliberate poll final-state delivery');
        assert.equal(await page.evaluate(()=>lastStatus.diagnostic_active),false,'held poll delivered the final owner state');
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
        assert.deepEqual(testRequests,[],`no hidden conversation-test fetches ${width}/${scheme}`);
        assert.deepEqual(errors,[],`page errors ${width}/${scheme}`);
        // Re-run the shipped initializers after real navigation, then observe
        // the next normal three-second status poll without advancing its clock.
        serverStatus=status();
        const reloadInitializers=['/api/status','/api/audio-trace','/api/settings'].map(endpoint=>
          own(page.waitForResponse(r=>new URL(r.url()).pathname===endpoint && r.request().method()==='GET')));
        await page.reload();
        await bounded(Promise.all(reloadInitializers),'full-HTML reload initializers');
        await page.waitForFunction(()=>document.querySelector('#pane-home .live-title')?.textContent==='Lytter' &&
          document.getElementById('s_save')?.disabled===false);
        const normalReloadPoll=own(page.waitForResponse(r=>new URL(r.url()).pathname==='/api/status'));
        await bounded(normalReloadPoll,'normal status poll after reload');
        assert.equal(await page.locator('#tab-home').getAttribute('aria-selected'),'true');
        assert.equal(await page.locator('#trace_arm').count(),1,'passive audio evidence initializer retained');
        assert.equal(await page.locator('#s_save').isEnabled(),true,'saved settings loaded after reload');
        assert.deepEqual(testRequests,[],`no resumed conversation-test fetches ${width}/${scheme}`);
        assert.deepEqual(errors,[],`page errors after reload ${width}/${scheme}`);
        let measurement=null;
        if(scheme==='light' && [390,1440].includes(width)) {
          // The same real poll owner stays blocked through observation/screenshots.
          // No sleeps, clock advance, renderer copy or new browser worker.
          injecting=true;const measurementHeld=new Promise(resolve=>onHeldPoll=resolve);
          const measurementPoll=own(page.evaluate(()=>poll()));
          await bounded(measurementHeld,'measurement poll entered');
          assert.ok(heldPolls.length>0,'actual status poll held for measurement evidence');
          await page.locator('#tab-test').click({timeout:FIXTURE_WAIT_MS});
          const inventory=await observeMeasurement(page,null);
          const results=[];
          const names=['finite-host-arrival','invalid-edge-0','typed-start-is-not-speech','actual-recovery-edge'];
          const indices=names.map(name=>{const index=inventory.findIndex(item=>item.name===name);assert.ok(index>=0,name);return index;});
          if(width===390) {
            assert.equal(inventory.length,86,'14 approved cases plus72 endpoint/offset/duration controls');
            for(let index=0;index<inventory.length;index++) {
              const observed=await observeMeasurement(page,index);assertMeasurement(observed);results.push(observed);
            }
          }
          const after=proof?await captureMeasurement(page,indices,'after',width,sourceSha):[];
          const before=baselineSource?await baselineMeasurementScreens(browser,width,indices):null;
          measurement={issue:100,acceptance:'AC4',mandatory_regression:width===390?'86 cases enforced':'already enforced at390/light',
            html_sha256:sourceSha,source_kind:'candidate full HTML',results,screenshots:after,baseline:before,
            ac5_before_after:before && after.length===4 && before.screenshots.length===4?'SOURCE_BOUND_RENDERED_EVIDENCE':'NOT_PROVEN',
            evidence:'Atomic synthetic rows after whole-HTML/API initialization; separate14-case API proof is retained. No HA/provider/physical/audio/first-viewport proof.'};
          if(proof)fs.writeFileSync(path.join(proof,`measurement-after-${width}.json`),JSON.stringify(measurement,null,2)+'\n');
          injecting=false;heldPolls.splice(0).forEach(resolve=>resolve());
          await bounded(measurementPoll,'measurement held poll release');
          assert.deepEqual(errors,[],`measurement script errors ${width}/${scheme}`);
          assert.deepEqual(testRequests,[],`measurement has no hidden conversation-test fetches ${width}/${scheme}`);
        }
        let captureGuard=null;
        if(width===390 && scheme==='light') {
          injecting=true;const captureHeld=new Promise(resolve=>onHeldPoll=resolve);
          const capturePoll=own(page.evaluate(()=>poll()));
          await bounded(captureHeld,'HTTP capture poll held');assert.ok(heldPolls.length>0,'actual HTTP poll is held');
          const insecure=await talkCaptureGuard(page,false);
          const secure=await secureTalkCaptureGuard(browser);
          captureGuard={insecure,secure};
          injecting=false;heldPolls.splice(0).forEach(resolve=>resolve());
          await bounded(capturePoll,'HTTP capture poll released');
          assert.deepEqual(errors,[], 'capture admission script errors');
          assert.deepEqual(testRequests,[], 'capture admission has no hidden conversation-test API');
        }
        reports.push({width,scheme,overflow:false,zoom200Overflow:false,focus:'preserved',commands:'unchanged',unchangedStatusAnnouncements:changes,contrast,measurement,captureGuard});
        } finally {
          injecting=false;onHeldPoll=null;
          heldPolls.splice(0).forEach(resolve=>resolve());
          // Closing the page cancels outstanding browser navigation/evaluation;
          // join their original promises before another fixture owner starts.
          try { await bounded(Promise.allSettled(ownedWork),'daily owned-work release join'); }
          finally {
            await bounded(page.close(),'daily page cleanup');
            await bounded(Promise.allSettled(ownedWork),'daily owned-work canceled join');
          }
        }
      }
    }
    const touchTargets=await settingsTouchTargets(browser);
    reports.push(touchTargets);
    const talkExit=await require("./talk_exit_contract.cjs")(browser,{source,sourceSha,status,settings,bounded,FIXTURE_WAIT_MS,proof});
    reports.push({issue:115,talkExit});
    const settingsRepair=await require("./settings_repair_contract.cjs")(browser,{source,sourceSha,status,settings,bounded,FIXTURE_WAIT_MS});
    reports.push({issue:113,settingsRepair});
    if(proof)fs.writeFileSync(path.join(proof,'browser-report.json'),JSON.stringify({evidence:'Chromium with synthetic API fixtures; no live HA, provider, VoiceOver or physical Voice PE',results:reports},null,2));
    console.log(JSON.stringify({pass:true,evidence:'Shipped HTML + Chromium + synthetic API fixtures',results:reports},null,2));
  } finally {await bounded(browser.close(),'daily browser cleanup');}
})().catch(e=>{console.error(e);process.exitCode=1;});
