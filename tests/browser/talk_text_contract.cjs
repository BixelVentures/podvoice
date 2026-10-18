// Whole shipped HTML and actual Talk handlers; inert socket/clock, no provider or microphone.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function runTalkTextContracts(browser,{source,sourceSha,status,settings,bounded,FIXTURE_WAIT_MS,proof}) {
  const results=[];
  const unknown='Beskedens status er ukendt. Den bliver ikke sendt igen automatisk.';
  function installInertTextIO() {
    const f=window.__textIO={sockets:[],sent:[],intervals:new Map(),reconnects:[],now:Date.now(),throwNext:false,throwClose:false};
    const nativeTimeout=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window);
    let intervalId=0;
    Date.now=()=>f.now;
    // Exercise the existing timer callbacks deterministically; no product deadline is invented.
    window.setInterval=(callback,delay)=>{const id=++intervalId;f.intervals.set(id,{callback,delay});return id;};
    window.clearInterval=id=>f.intervals.delete(id);
    window.setTimeout=(callback,delay,...args)=>{
      const id=nativeTimeout(callback,delay,...args);
      if(delay===2500)f.reconnects.push({id,callback});return id;
    };
    f.reconnect=()=>{const timer=f.reconnects.shift();if(!timer)throw new Error('missing actual reconnect timer');nativeClear(timer.id);timer.callback();};
    f.tickLease=seconds=>{f.now+=seconds*1000;for(const timer of [...f.intervals.values()])if(timer.delay===5000)timer.callback();};
    window.EventSource=class {constructor(){queueMicrotask(()=>this.onopen?.());}close(){}};
    window.WebSocket=class {
      static OPEN=1;
      constructor(url){this.url=String(url);this.id=f.sockets.length;this.readyState=0;f.sockets.push(this);}
      send(data){if(f.throwNext){f.throwNext=false;throw new Error('inert send failure');}f.sent.push({...JSON.parse(data),socket_id:this.id});}
      close(){if(f.throwClose)throw new Error('inert close failure');if(this.readyState===3)return;this.readyState=3;queueMicrotask(()=>this.onclose?.({type:'close'}));}
    };
    // Text creates no audible source; prevent opening native audio devices in this owner test.
    window.AudioContext=class {constructor(){this.state='running';this.currentTime=0;}close(){this.state='closed';return Promise.resolve();}};
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>{throw new Error('text test must not open microphone');}});
  }
  function deliver({event,index}) {const sock=index===undefined?window.__textIO.sockets.at(-1):window.__textIO.sockets[index];sock.onmessage({data:JSON.stringify(event)});}
  function hello() {const s=window.__textIO.sockets.at(-1);s.readyState=WebSocket.OPEN;s.onopen?.({});s.onmessage({data:JSON.stringify({type:'hello',protocol:2,rate:24000})});}
  function observation() {
    const f=window.__textIO;
    return {draft:document.querySelector('#ctext').value,disabled:document.querySelector('#csend').disabled,
      lines:[...document.querySelectorAll('#clog .line')].map(e=>({who:e.querySelector('.who')?.textContent,text:e.textContent.replace(e.querySelector('.who')?.textContent||'','')})),
      frames:f.sent.filter(e=>e.type==='text'),stops:f.sent.filter(e=>e.type==='stop'),
      leases:[...f.intervals.values()].filter(t=>t.delay===5000).length,sockets:f.sockets.length,allFrames:f.sent.length,
      micDisabled:document.querySelector('#cmic').disabled,state:document.querySelector('#cstate').textContent};
  }
  async function one(name,run) {
    let page,context,primary=null;const pageErrors=[],cleanupErrors=[];
    try {
      page=await bounded(browser.newPage(),'text '+name+' page');context=page.context();
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.addInitScript(installInertTextIO);
      await page.route('**/*',route=>{
        const u=new URL(route.request().url());
        if(u.origin!=='https://panel.test')return route.abort('blockedbyclient');
        if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:source});
        assert.equal(route.request().method(),'GET','no external/settings/household mutation');
        const json=u.pathname==='/api/status'?status():u.pathname==='/api/settings'?settings:u.pathname==='/api/models'?{models:[],voices:[],default:null}:{ok:true,status:'idle'};
        return route.fulfill({json});
      });
      await bounded(page.goto('https://panel.test/'),'actual shipped text HTML');
      await page.waitForFunction(()=>window.__textIO.sockets.some(s=>s.onmessage),null,{timeout:FIXTURE_WAIT_MS});
      await page.evaluate(hello);await page.locator('#tab-talk').click({timeout:FIXTURE_WAIT_MS});
      const read=()=>page.evaluate(observation);
      const receive=event=>page.evaluate(deliver,{event});
      const send=async draft=>{
        await page.locator('#ctext').fill(draft);await page.locator('#csend').click({timeout:FIXTURE_WAIT_MS});
        return (await read()).frames.at(-1)?.command_id;
      };
      const reconnect=async()=>{await page.evaluate(()=>window.__textIO.reconnect());await page.evaluate(hello);};
      const close=()=>page.evaluate(()=>window.__textIO.sockets.at(-1).close());
      await run({page,read,receive,send,reconnect,close});
      assert.deepEqual(pageErrors,[],name+' no unhandled page error');
    }catch(error){primary=String(error);}
    finally {
      for(const [owner,label] of [[page,'page'],[context,'context']])if(owner)try{await bounded(owner.close(),name+' '+label+' cleanup');}catch(error){cleanupErrors.push(String(error));}
    }
    results.push({name,pass:!primary&&!cleanupErrors.length,error:primary,page_errors:pageErrors,cleanup_errors:cleanupErrors});
  }
  const countUnknown=o=>o.lines.filter(l=>l.text===unknown).length;
  const users=o=>o.lines.filter(l=>l.who==='you');
  await one('disconnect-reconnect-retired-receipts',async({page,read,send,close,reconnect,receive})=>{
    const old=await send('first');await page.locator('#ctext').fill('newer draft');await close();
    let o=await read();assert.equal(countUnknown(o),1);assert.equal(o.draft,'newer draft');assert.equal(users(o).length,0);assert.equal(o.disabled,true);assert.equal(o.leases,0);
    await reconnect();o=await read();assert.equal(o.frames.length,1,'no automatic replay');assert.equal(o.disabled,false);
    await page.evaluate(deliver,{index:0,event:{type:'command_result',command_id:old,status:'submitted'}});
    await receive({type:'command_result',command_id:old,status:'accepted'});
    o=await read();assert.equal(users(o).length,0);assert.equal(o.draft,'newer draft');
    const fresh=await send('second');assert.notEqual(fresh,old);
    await receive({type:'command_result',command_id:old,status:'accepted'});assert.equal((await read()).disabled,true);
    await receive({type:'command_result',command_id:fresh,status:'submitted'});o=await read();assert.equal(users(o).length,1);assert.equal(o.draft,'');assert.equal(o.frames.length,2);
  });
  await one('error-close-terminalizes-once',async({page,send,read})=>{
    await send('unconfirmed');await page.locator('#ctext').fill('');
    await page.evaluate(()=>{const s=window.__textIO.sockets.at(-1);s.onerror?.({});s.onclose?.({});s.onclose?.({});});
    const o=await read();assert.equal(countUnknown(o),1);assert.equal(o.draft,'');assert.equal(users(o).length,0);assert.equal(o.disabled,true);assert.equal(o.leases,0);
  });
  await one('synchronous-send-failure',async({page,send,read,reconnect})=>{
    await page.evaluate(()=>window.__textIO.throwNext=true);await send('kept');
    let o=await read();assert.equal(countUnknown(o),1);assert.equal(o.draft,'kept');assert.equal(o.frames.length,0);assert.equal(o.disabled,true);
    await reconnect();assert.equal((await read()).disabled,false);await send('explicit new request');o=await read();assert.equal(o.frames.length,1);assert.equal(countUnknown(o),1);
  });
  await one('submitted-one-user-bubble-no-technical-copy',async({send,receive,read})=>{
    const id=await send('sent');await receive({type:'command_result',command_id:id,status:'submitted'});
    await receive({type:'command_result',command_id:id,status:'submitted'});
    const o=await read();assert.equal(users(o).length,1);assert.equal(o.draft,'');assert.equal(o.disabled,false);assert.equal(o.lines.some(l=>l.text.includes('ingen separat modtagelseskvittering')),false);assert.equal(countUnknown(o),0);
  });
  await one('accepted-preserves-exact-newer-draft',async({page,send,receive,read})=>{
    const id=await send('  draft  ');assert.equal((await read()).frames.at(-1).text,'draft');
    await page.locator('#ctext').fill('draft ');
    await receive({type:'command_result',command_id:id,status:'accepted'});
    const o=await read();assert.equal(o.draft,'draft ');assert.equal(users(o).length,1);assert.equal(o.disabled,false);
  });
  await one('rejection-preserves-newer-and-cleared-drafts',async({page,send,receive,read})=>{
    for(const draft of ['newer','']){
      const id=await send('original');await page.locator('#ctext').fill(draft);
      await receive({type:'command_result',command_id:id,status:'rejected',message:'Meaningful rejection'});
      const o=await read();assert.equal(o.draft,draft);assert.equal(users(o).length,0);assert.equal(o.lines.at(-1).text,'Meaningful rejection');assert.equal(o.disabled,false);
    }
  });
  await one('unknown-receipt-is-not-false-not-sent',async({send,receive,read})=>{
    const id=await send('unknown');await receive({type:'command_result',command_id:id,status:'unknown'});
    await receive({type:'command_result',command_id:id,status:'submitted'});
    const o=await read();assert.equal(countUnknown(o),1);assert.equal(o.draft,'unknown');assert.equal(users(o).length,0);assert.equal(o.disabled,false);
  });
  await one('end-alone-keeps-legitimate-submitted',async({page,send,receive,read})=>{
    const id=await send('before End');await page.locator('#cstop').click({timeout:FIXTURE_WAIT_MS});
    let o=await read();assert.equal(o.stops.length,1);assert.equal(o.disabled,true);assert.equal(countUnknown(o),0);
    await receive({type:'command_result',command_id:id,status:'submitted'});
    await receive({type:'command_result',command_id:id,status:'rejected',code:'stopped'});
    o=await read();assert.equal(users(o).length,1);assert.equal(o.draft,'');assert.equal(countUnknown(o),0);
    await page.locator('#cstop').click({timeout:FIXTURE_WAIT_MS});assert.equal(countUnknown(await read()),0);
  });
  await one('stopped-receipt-settles-once',async({page,send,receive,read,close})=>{
    const id=await send('pending End');await page.locator('#cstop').click({timeout:FIXTURE_WAIT_MS});
    await receive({type:'command_result',command_id:id,status:'rejected',code:'stopped'});
    await receive({type:'command_result',command_id:id,status:'submitted'});
    let o=await read();assert.equal(users(o).length,0);assert.equal(o.draft,'pending End');assert.equal(o.lines.length,1);
    const another=await send('End then disconnect');await page.locator('#cstop').click({timeout:FIXTURE_WAIT_MS});await close();o=await read();assert.equal(countUnknown(o),1);assert.equal(o.draft,'End then disconnect');assert.notEqual(another,id);
  });
  await one('pending-lock-hello-diagnostics-one-heartbeat',async({page,send,read,receive})=>{
    const id=await send('pending');await page.evaluate(hello);await page.evaluate(hello);
    await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('podvoice-diagnostic',{detail:{active:true}}));window.dispatchEvent(new CustomEvent('podvoice-diagnostic',{detail:{active:false}}));});
    let o=await read();assert.equal(o.disabled,true);assert.equal(o.leases,1);
    await page.locator('#ctext').press('Enter');assert.equal((await read()).frames.length,1);
    await receive({type:'command_result',command_id:id,status:'submitted'});assert.equal((await read()).disabled,false);
  });
  await one('healthy-pongs-no-command-deadline-stale-heartbeat-unknown',async({page,send,read,receive,reconnect})=>{
    for(let cycle=0;cycle<4;cycle++){
      const id=await send('cycle '+cycle);
      for(let step=0;step<20;step++){await receive({type:'pong'});await page.evaluate(()=>window.__textIO.tickLease(5));}
      let o=await read();assert.equal(o.disabled,true);assert.equal(countUnknown(o),cycle);assert.equal(o.frames.length,cycle+1);
      await page.evaluate(()=>window.__textIO.tickLease(16));o=await read();assert.equal(countUnknown(o),cycle+1);assert.equal(o.leases,0);
      await reconnect();await receive({type:'command_result',command_id:id,status:'submitted'});o=await read();assert.equal(users(o).length,0);assert.equal(o.disabled,false);
    }
  });
  await one('retired-socket-cannot-revive-before-reconnect',async({page,send,read,reconnect})=>{
    for(const fault of ['error','close','send-throw-close-throw']){
      if(fault==='send-throw-close-throw')await page.evaluate(()=>{window.__textIO.throwNext=true;window.__textIO.throwClose=true;});
      await send('retired '+fault);
      if(fault==='error')await page.evaluate(()=>window.__textIO.sockets.at(-1).onerror?.({}));
      if(fault==='close')await page.evaluate(()=>window.__textIO.sockets.at(-1).close());
      const before=await read();
      await page.evaluate(()=>{
        const s=window.__textIO.sockets.at(-1);s.onopen?.({});
        for(const event of [{type:'hello',protocol:2,rate:24000},
          {type:'transcript_fragment',dir:'out',segment_id:'retired',text:'retired transcript'},
          {type:'live_offer_request',attempt_id:'retired',connection_id:'retired'},
          {type:'mic',on:true}])s.onmessage({data:JSON.stringify(event)});
      });
      const after=await read();assert.equal(after.disabled,true,fault+' Send remains disabled');
      assert.equal(after.micDisabled,true,fault+' microphone remains disabled');assert.equal(after.state,'offline',fault+' remains offline');
      assert.deepEqual(after.lines,before.lines,fault+' retired transcript ignored');assert.equal(after.allFrames,before.allFrames,fault+' no new hello/peer frames');
      assert.equal(after.leases,0,fault+' heartbeat cleaned before reconnect');
      await page.evaluate(()=>window.__textIO.throwClose=false);await reconnect();assert.equal((await read()).disabled,false,fault+' existing reconnect recovers');
    }
  });
  const report={issue:[95,115],html_sha256:sourceSha,status:results.every(r=>r.pass)?'PASS':'FAIL',run_complete:results.length===12,results,
    evidence:'Actual complete shipped HTML; inert socket and controlled existing timer callbacks; no microphone, provider, household, audible or physical acceptance.'};
  if(proof)fs.writeFileSync(path.join(proof,'talk-text-report.json'),JSON.stringify(report,null,2)+'\n');
  assert.equal(report.run_complete&&report.status==='PASS',true,JSON.stringify(results.filter(r=>!r.pass)));
  return report;
};
