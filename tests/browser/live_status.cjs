// Exercise the shipped read-only projection without HA/provider access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('podvoice/gatekeeper/static/index.html', 'utf8');
const code = source.slice(source.indexOf('var liveStatusWatermarks ='), source.indexOf('function renderLiveStatus'));
const ctx = vm.createContext({}); vm.runInContext(code, ctx);
const sample = {session_id:'a',generation:2,observed_at:100,phase:'LISTENING',authority:'Live',blocker:'quiet_window_incomplete',input_state:'quiet',output_state:'queued',quiet_s:2,idle_timeout_s:4,remaining_s:2,countdown_running:true,timer_kind:'quiet_coverage',transcript:'<img src=x>',transcript_at:98};
assert.ok(ctx.acceptLiveStatus('r0',sample));
assert.equal(ctx.acceptLiveStatus('r0',{...sample,observed_at:99}),null);
assert.equal(ctx.acceptLiveStatus('r0',{...sample,generation:1,observed_at:101}),null);
assert.ok(ctx.acceptLiveStatus('r0',{...sample,session_id:'b',generation:0,observed_at:102}));
assert.equal(ctx.acceptLiveStatus('r0',{...sample,observed_at:101}),null);
assert.equal(ctx.liveStatusView({connected:false,live_status:{...sample,phase:'IDLE',wake_readiness:'proven'}},100000).title,'Offline');
let expired = ctx.liveStatusView({live_status:{...sample,freshness_s:0.75,input_age_s:0.2}},101000);
assert.ok(expired.details.some(x=>x.includes('forældet')));
assert.ok(!expired.lines.some(x=>x.startsWith('Ro:')));
const semantic = ctx.liveStatusView({live_status:{...sample,semantic_end:true,freshness_s:0.75,input_age_s:10,observation_age_s:0.1,output_age_s:1}},100000);
assert.ok(semantic.lines.some(x=>x.startsWith('Ro:')),'semantic end coverage follows output not raw VAD');
assert.ok(semantic.details.some(x=>x.includes('Højttaler: forældet')));
assert.ok(!ctx.liveStatusView({live_status:{...sample,semantic_end:true,freshness_s:0.75,observation_age_s:1}},100000).lines.some(x=>x.startsWith('Ro:')));
let view = ctx.liveStatusView({live_status:sample},101000);
assert.equal(view.title,'Lytter'); assert.ok(view.lines.some(x=>x.includes('Ro: 2,0 s af 4,0 s')));
assert.ok(!view.lines.some(x=>x.includes('tilbage')));
assert.ok(view.details.some(x=>x.includes('transskription')));
assert.equal(ctx.liveStatusView({live_status:sample},104000).title,'Status forældet');
assert.equal(ctx.liveStatusView({},100000).title,'Status ukendt');
for (const [wake_readiness,title] of Object.entries({proven:'Klar',recovered:'Vækning ikke bekræftet',fault:'Kræver opmærksomhed',unknown:'Samtale lukket'})) assert.equal(ctx.liveStatusView({live_status:{...sample,phase:'IDLE',wake_readiness}},100000).title,title);
for (const [output_state,label] of Object.entries({active:'Svarlyd registreret',pending:'lyd i kø'})) assert.ok(ctx.liveStatusView({live_status:{...sample,output_state}},100000).details.some(x=>x.includes(label)));
assert.ok(ctx.liveStatusView({live_status:{...sample,phase:'IDLE'}},100000).lines.every(x=>!x.includes('transskription')));
view=ctx.liveStatusView({live_status:{...sample,timer_kind:'deadline',remaining_s:0}},100000);
assert.ok(view.lines.some(x=>x.includes('0,0 s tilbage ved seneste måling')));
assert.ok(source.includes('ev.type === "live_status"'));
assert.ok(source.includes('acceptLiveStatus(r.room, r.live_status)'));
const noop=()=>{};
Object.assign(ctx,{rooms:{},lastStatus:null,lastObservedMs:0,Date,window:{dispatchEvent:noop},CustomEvent:function(){},renderSub:noop,renderServices:noop,renderCapabilities:noop,renderRooms:noop,renderMetrics:noop,renderActivity:noop,renderLifecycle:noop});
vm.runInContext(source.slice(source.indexOf('function applyStatus(data)'),source.indexOf('function fmtClock')),ctx);
vm.runInContext(source.slice(source.indexOf('function applyEvent(ev)'),source.indexOf('async function control')),ctx);
ctx.applyStatus({rooms:[{room:'fixture',live_status:sample}]});
assert.equal(ctx.rooms.fixture.live_status.session_id,'a');
ctx.applyEvent({type:'live_status',room:'fixture',live_status:{...sample,session_id:'b',generation:0,observed_at:105,phase:'THINKING'}});
assert.equal(ctx.rooms.fixture.live_status.session_id,'b');
ctx.applyStatus({rooms:[{room:'fixture',live_status:{...sample,observed_at:104}}]});
assert.equal(ctx.rooms.fixture.live_status.session_id,'b','late poll cannot overwrite SSE');
ctx.applyEvent({type:'live_status',room:'fixture',live_status:{...sample,session_id:'b',generation:0,observed_at:106,phase:'IDLE',transcript:null}});
assert.equal(ctx.rooms.fixture.live_status.transcript,null);
assert.equal(ctx.liveStatusView({live_status:{...sample,phase:'CLOSING',timer_kind:'deadline',remaining_s:0}},100000).title,'Afslutter');
assert.ok(ctx.liveStatusView({live_status:{...sample,phase:'CLOSING',timer_kind:'deadline',remaining_s:0}},100000).lines.some(x=>x.includes('afventer afslutning')));
console.log('PASS: shipped projection identity, stale/unknown, measured coverage, zero deadline, idle transcript cleanup, snapshot/SSE hooks');
if (process.env.PODVOICE_BROWSER_PROOF === '1') {
  const {chromium} = require('playwright');
  (async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.PODVOICE_TEST_CHROMIUM});
    try {
      const css=source.match(/<style>([\s\S]*?)<\/style>/)[1];
      const functions=source.slice(source.indexOf('var liveStatusWatermarks ='),source.indexOf('var savedWakeWord ='));
      const render=source.slice(source.indexOf('function renderRooms()'),source.indexOf('function renderMetrics'));
      const status=source.slice(source.indexOf('function applyStatus(data)'),source.indexOf('function fmtClock'));
      const events=source.slice(source.indexOf('function applyEvent(ev)'),source.indexOf('async function control'));
      for (const width of [320,390,430,768,1440]) {
        const page=await browser.newPage({viewport:{width,height:900}});
        await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div id="rooms"></div><div id="room-tests"></div><script>function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}function safe(o,k,d){return o&&o[k]!=null?o[k]:d;}var STATE_PILL={},STATE_LABEL={};function control(){};var rooms={},lastStatus=null,lastObservedMs=0;function noop(){};var renderWakeWordStatus=noop,renderSub=noop,renderServices=noop,renderCapabilities=noop,renderMetrics=noop,renderActivity=noop,renderLifecycle=noop;${functions}${render}${status}${events}</script>`);
        await page.evaluate(v=>{applyStatus({rooms:[{room:'Køkken',state:'LISTENING',connected:true,live_status:{...v,observed_at:Date.now()/1000,transcript_at:Date.now()/1000-2}}]});},sample);
        assert.ok((await page.locator('.room').innerText()).includes('Lytter'));
        assert.equal(await page.locator('.room img').count(),0);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow '+width);
        await page.locator('.room button').first().focus();
        assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Start samtale');
        await page.evaluate(()=>{document.querySelector('details.room-diagnostics').open=true;document.querySelector('details.live-explanation').open=true; var v=rooms['Køkken'].live_status;applyEvent({type:'live_status',room:'Køkken',live_status:{...v,observed_at:v.observed_at+0.1,blocker:'Et værktøj arbejder'}});});
        assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Start samtale','SSE preserves button focus');
        assert.equal(await page.locator('details.live-explanation').evaluate(e=>e.open),true);
        await page.evaluate(()=>{var v=rooms['Køkken'].live_status;applyStatus({rooms:[{...rooms['Køkken'],live_status:{...v,observed_at:v.observed_at+0.1,blocker:'Afventer svar'}}]});});
        assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Start samtale','poll preserves button focus');
        assert.equal(await page.locator('details.live-explanation').evaluate(e=>e.open),true);
        await page.locator('details.live-explanation summary').focus();
        await page.evaluate(()=>{var v=rooms['Køkken'].live_status;applyEvent({type:'live_status',room:'Køkken',live_status:{...v,observed_at:v.observed_at+0.1,blocker:'Næste måling'}});});
        assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
        await page.close();
      }
      console.log('PASS: real Chromium room card at 320/390/430/768/1440, escaped transcript, keyboard focus, no horizontal overflow');
    } finally {await browser.close();}
  })().catch(e=>{console.error(e);process.exitCode=1;});
}
