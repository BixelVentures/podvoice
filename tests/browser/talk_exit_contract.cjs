// Actual whole shipped HTML, inert I/O/native generated silent tracks; no microphone or provider proof.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function runTalkExitContracts(browser,{source,sourceSha,status,settings,bounded,FIXTURE_WAIT_MS,proof}) {
const results=[],cleanupFindings=[];
function installInertIO() {
  const f=window.__tabMedia={sockets:[],peers:[],streams:[],contexts:[],sent:[],permissionCalls:0,
    audios:[],pcmContexts:[],pcmStarts:[],holdPermission:false,holdOffer:false,permissionRelease:null,offerRelease:null,permissionPromise:null,offerPromise:null};
  // Observe native WebAudio objects/start calls, without replacing its processing algorithm.
  const NativeAudioContext=window.AudioContext;
  window.AudioContext=class extends NativeAudioContext {
    constructor(...args){
      super(...args);f.pcmContexts.push(this);
      const create=this.createBufferSource.bind(this);
      this.createBufferSource=()=>{const node=create(),start=node.start.bind(node);
        node.start=(...values)=>{f.pcmStarts.push({context:f.pcmContexts.indexOf(this)});return start(...values);};return node;};
    }
  };
  function silentStream() {
    const context=new AudioContext();f.contexts.push(context);
    const stream=context.createMediaStreamDestination().stream;f.streams.push(stream);return stream;
  }
  // Native generated tracks, no hardware, permission request, capture recording or audible source.
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async function(){
    f.permissionCalls++;const stream=silentStream();
    if(f.holdPermission){f.permissionPromise=new Promise(resolve=>f.permissionRelease=()=>resolve(stream));return f.permissionPromise;}
    return stream;
  }});
  window.EventSource=class {constructor(){queueMicrotask(()=>this.onopen?.());}close(){}};
  window.WebSocket=class {
    static OPEN=1;
    constructor(url){this.url=String(url);this.socketId=f.sockets.length;this.readyState=3;f.sockets.push(this);}
    send(data){if(typeof data==='string'){try{f.sent.push({...JSON.parse(data),socket_id:this.socketId});}catch(_){f.sent.push({type:'opaque'});}}}
    close(){this.readyState=3;}
  };
  window.RTCPeerConnection=class {
    constructor(){this.iceGatheringState='complete';this.connectionState='new';f.peers.push(this);}
    addTrack(track){this.sender={track,replaceTrack:async next=>{this.sender.track=next;},getStats:async()=>new Map()};return this.sender;}
    createDataChannel(){return this.channel={};}
    async createOffer(){if(f.holdOffer){f.offerPromise=new Promise(resolve=>f.offerRelease=()=>resolve({type:'offer',sdp:'v=0\r\ninert'}));return f.offerPromise;}return {type:'offer',sdp:'v=0\r\ninert'};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){this.remoteDescription=value;}
    close(){this.connectionState='closed';if(this.onconnectionstatechange)this.onconnectionstatechange();}
  };
  // Inert output owner; this facet does not exercise autoplay or speaker audio.
  window.Audio=class {constructor(){this.attrs={};this.paused=true;f.audios.push(this);}set src(v){this.attrs.src=v;}get src(){return this.attrs.src||'';}play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}removeAttribute(k){delete this.attrs[k];}hasAttribute(k){return Object.hasOwn(this.attrs,k);}load(){}};
}
function snapshot() {
  const f=window.__tabMedia;
  return {activeTab:document.querySelector('.tabbtn[aria-selected=true]')?.id,
    micPressed:document.querySelector('#cmic').getAttribute('aria-pressed'),
    micDisabled:document.querySelector('#cmic').disabled,
    tracks:f.streams.flatMap(stream=>stream.getTracks().map(t=>({state:t.readyState,enabled:t.enabled}))),
    peers:f.peers.map(p=>({state:p.connectionState,sender:p.sender?.track?.readyState})),
    sent:f.sent.map(v=>({type:v.type,attempt_id:v.attempt_id,socket_id:v.socket_id})),permissionCalls:f.permissionCalls,audioCount:f.audios.length,
    pcmContextCount:f.pcmContexts.length,pcmStartCount:f.pcmStarts.length,
    permissionHeld:!!f.permissionRelease,offerHeld:!!f.offerRelease};
}
function deliver(event) {
  const sock=window.__tabMedia.sockets.find(s=>new URL(s.url).pathname==='/api/talk');
  if(!sock || typeof sock.onmessage!=='function')throw new Error('actual Talk socket handler absent');
  sock.onmessage({data:JSON.stringify(event)});
}
async function read(page){return bounded(page.evaluate(snapshot),'actual owner snapshot');}
async function edge(page,boundary) {
  if(boundary==='home')await page.locator('#tab-home').click({timeout:FIXTURE_WAIT_MS});
  else if(boundary.startsWith('key-'))await page.locator('#tab-talk').press({'key-home':'Home','key-arrow':'ArrowRight','key-end':'End'}[boundary],{timeout:FIXTURE_WAIT_MS});
  else await bounded(page.evaluate(()=>window.dispatchEvent(new Event('pagehide'))),'actual shipped pagehide listener');
}
async function release(page) {
  // Join fixture promises admitted by actual production code; pageclose also cancels page-owned continuations.
  await bounded(page.evaluate(async()=>{
    const f=window.__tabMedia;f.holdPermission=false;f.holdOffer=false;
    const promises=[f.permissionPromise,f.offerPromise].filter(Boolean);
    f.permissionRelease?.();f.permissionRelease=null;f.offerRelease?.();f.offerRelease=null;
    await Promise.allSettled(promises);
  }),'release owned permission/offer gates');
}
async function one(browser,mode,boundary) {
  let page,context,primary=null;const errors=[],cleanupErrors=[],trace=[];
  const name=mode+'-'+boundary;
  try {
    page=await bounded(browser.newPage({viewport:{width:390,height:664}}),'new isolated page');context=page.context();
    page.on('pageerror',e=>errors.push(e.message));
    await bounded(page.addInitScript(installInertIO),'inert I/O admission');
    await bounded(page.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.origin!=='https://panel.test')return route.abort('blockedbyclient');
      if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:source});
      assert.equal(route.request().method(),'GET','no settings/household action permitted');
      let json={ok:true,status:'idle'};
      if(u.pathname==='/api/status')json=status();
      if(u.pathname==='/api/settings')json=settings;
      if(u.pathname==='/api/models')json={models:[],voices:[],default:null};
      return route.fulfill({json});
    }),'private inert routes');
    await bounded(page.goto('https://panel.test/'),'actual205 HTML navigation');
    await page.waitForFunction(()=>document.getElementById('s_save')?.disabled===false,null,{timeout:FIXTURE_WAIT_MS});
    await page.waitForFunction(()=>window.__tabMedia.sockets.some(s=>new URL(s.url).pathname==='/api/talk' && s.onmessage),null,{timeout:FIXTURE_WAIT_MS});
    await bounded(page.evaluate(()=>{const s=window.__tabMedia.sockets.find(s=>new URL(s.url).pathname==='/api/talk');s.readyState=WebSocket.OPEN;s.onopen?.({type:'open'});s.onmessage({data:JSON.stringify({type:'hello',protocol:2,rate:24000})});}),'actual protocol2 hello');
    assert.equal(await page.locator('#cmic').isEnabled(),true,'secure inert capture admitted by actual hello');
    const initial=await read(page);assert.equal(initial.activeTab,'tab-home');
    await bounded(page.evaluate(deliver,{type:'live_offer_request',attempt_id:'initial-hidden',connection_id:'fixture-connection'}),'initial hidden offer while not halted');
    await bounded(page.evaluate(deliver,{type:'play',url:'api/reply/inert',playback_id:'initial-hidden-reply'}),'initial hidden playback while not halted');
    await bounded(page.evaluate(()=>window.__tabMedia.sockets[0].onmessage({data:new ArrayBuffer(4)})),'initial hidden zero PCM');
    const initialHidden=await read(page);trace.push({edge:'initial-hidden-hello',state:initialHidden});
    assert.equal(initialHidden.peers.length,0,'initial hidden pane independently vetoes peer');
    assert.equal(initialHidden.audioCount,0,'initial hidden pane independently vetoes playback');
    assert.equal(initialHidden.permissionCalls,0,'initial hidden pane opens no microphone');
    assert.equal(initialHidden.pcmContextCount,initial.pcmContextCount,'initial hidden bytes create no PCM context');
    assert.equal(initialHidden.pcmStartCount,initial.pcmStartCount,'initial hidden bytes schedule no PCM source');
    await page.locator('#tab-talk').click({timeout:FIXTURE_WAIT_MS});
    await bounded(page.evaluate(()=>window.__tabMedia.sockets[0].onmessage({data:new ArrayBuffer(4)})),'explicit visible zero PCM control');
    const visiblePcm=await read(page);trace.push({edge:'visible-pcm-observer-positive',state:visiblePcm});
    assert.equal(visiblePcm.pcmContextCount,initialHidden.pcmContextCount+1,'instrumented actual PCM context positive control');
    assert.equal(visiblePcm.pcmStartCount,initialHidden.pcmStartCount+1,'instrumented actual source.start positive control');
    if(mode==='admitted' && boundary==='home') {
      // Exact finite-output stop runs through the shipped handler; source is inert.
      await bounded(page.evaluate(deliver,{type:'play',url:'api/reply/inert',playback_id:'owned',playback_connection:'finite-peer',playback_generation:1}),'owned finite output');
      await bounded(page.evaluate(deliver,{type:'stop_playback',playback_id:'owned',playback_connection:'other-peer',playback_generation:1,stop_id:'wrong'}),'stale finite stop');
      let output=await bounded(page.evaluate(()=>({audio:window.__tabMedia.audios.at(-1).paused,ack:window.__tabMedia.sent.filter(v=>v.type==='playback_stopped').at(-1)})),'stale stop observation');
      assert.equal(output.audio,false,'stale stop cannot silence current source');
      assert.equal(output.ack.stopped,false,'stale stop never claims source detached');
      await bounded(page.evaluate(deliver,{type:'stop_playback',playback_id:'owned',playback_connection:'finite-peer',playback_generation:1,stop_id:'exact'}),'exact finite stop');
      output=await bounded(page.evaluate(()=>({paused:window.__tabMedia.audios.at(-1).paused,attached:window.__tabMedia.audios.at(-1).hasAttribute('src'),ack:window.__tabMedia.sent.filter(v=>v.type==='playback_stopped').at(-1),permissions:window.__tabMedia.permissionCalls})),'exact source stop observation');
      assert.equal(output.paused,true);assert.equal(output.attached,false);
      assert.equal(output.ack.stop_id,'exact');assert.equal(output.ack.playback_connection,'finite-peer');
      assert.equal(output.ack.playback_generation,1);assert.equal(output.ack.playback_id,'owned');
      assert.equal(output.ack.stopped,true);assert.equal(output.ack.source_detached,true);
      assert.equal(output.permissions,0,'output Stop does not acquire the microphone');
      await bounded(page.evaluate(deliver,{type:'play',url:'api/reply/inert',playback_id:'held-source',playback_connection:'finite-peer',playback_generation:2}),'old source before failed cleanup');
      await bounded(page.evaluate(()=>{const a=window.__tabMedia.audios.at(-1);a.pause=function(){throw new Error('inert pause failed');};}),'inject source cleanup failure');
      const count=await bounded(page.evaluate(()=>window.__tabMedia.audios.length),'finite source count before rejected replacement');
      await bounded(page.evaluate(deliver,{type:'play',url:'api/reply/inert',playback_id:'rejected-new',playback_connection:'finite-peer',playback_generation:3}),'replacement must await old source cleanup');
      const rejected=await bounded(page.evaluate(()=>({count:window.__tabMedia.audios.length,paused:window.__tabMedia.audios.at(-1).paused,attached:window.__tabMedia.audios.at(-1).hasAttribute('src'),fault:window.__tabMedia.sent.filter(v=>v.type==='media'&&v.state==='fault').at(-1),drains:window.__tabMedia.sent.filter(v=>v.type==='media'&&v.announcing===false)})),'retained source and rejected output fault');
      assert.equal(rejected.count,count,'failed cleanup creates no replacement Audio');
      assert.equal(rejected.paused,false);assert.equal(rejected.attached,true,'old source remains owned');
      assert.equal(rejected.fault.playback_id,'rejected-new','Thin receives a fault for B');
      assert.equal(rejected.drains.some(v=>v.playback_id==='held-source'),false,'failed source stop never reports A drained');
      await bounded(page.evaluate(()=>{window.__tabMedia.audios.at(-1).pause=function(){this.paused=true;};}),'release inert source failure');
      await bounded(page.evaluate(deliver,{type:'stop_playback',playback_id:'held-source',playback_connection:'finite-peer',playback_generation:2,stop_id:'held-cleanup'}),'retained A exact cleanup');
      assert.equal(await bounded(page.evaluate(()=>window.__tabMedia.sent.filter(v=>v.type==='playback_stopped').at(-1).stopped),'old owner cleanup proof'),true);
    }
    if(mode==='late-permission') {
      await bounded(page.evaluate(()=>window.__tabMedia.holdPermission=true),'hold permission');
      await page.locator('#cmic').click({timeout:FIXTURE_WAIT_MS});
      await page.waitForFunction(()=>window.__tabMedia.permissionRelease!==null,null,{timeout:FIXTURE_WAIT_MS});
    } else {
      if(mode==='late-peer')await bounded(page.evaluate(()=>window.__tabMedia.holdOffer=true),'hold offer');
      await bounded(page.evaluate(deliver,{type:'live_offer_request',attempt_id:name,connection_id:'fixture-connection'}),'actual offer request');
      if(mode==='late-peer')await page.waitForFunction(()=>window.__tabMedia.offerRelease!==null,null,{timeout:FIXTURE_WAIT_MS});
      else {
        await page.waitForFunction(n=>window.__tabMedia.sent.some(v=>v.type==='live_offer' && v.attempt_id===n),name,{timeout:FIXTURE_WAIT_MS});
        await bounded(page.evaluate(deliver,{type:'live_answer',attempt_id:name,connection_id:'fixture-connection',provider_session_id:'fixture-provider',generation:1,sdp:'v=0\r\ninert'}),'actual answer');
        await bounded(page.evaluate(deliver,{type:'live_ready',attempt_id:name,connection_id:'fixture-connection',provider_session_id:'fixture-provider',generation:1}),'actual ready');
        await page.locator('#cmic').click({timeout:FIXTURE_WAIT_MS});
        await page.waitForFunction(()=>document.getElementById('cmic').getAttribute('aria-pressed')==='true',null,{timeout:FIXTURE_WAIT_MS});
      }
    }
    const before=await read(page);trace.push({edge:'before',state:before});
    assert.ok(mode==='late-peer'?before.peers.some(p=>p.state!=='closed'):before.tracks.some(t=>t.state==='live'),'actual live resources established');
    await edge(page,boundary);trace.push({edge:boundary,state:await read(page)});
    const exiting=boundary!=='pagehide';
    const stopped=await read(page);
    if(boundary.startsWith('key-'))assert.equal(stopped.activeTab,
      {'key-home':'tab-home','key-arrow':'tab-history','key-end':'tab-settings'}[boundary],
      'keyboard exits follow the daily-use primary tabs');
    assert.equal(stopped.sent.filter(v=>v.type==='stop').length,exiting?1:0,'exactly one same-socket Stop per Tal exit');
    if(exiting) {
      assert.equal(stopped.sent.find(v=>v.type==='stop').socket_id,0,'Stop stays on actual Talk socket');
      await page.locator('#tab-home').click({timeout:FIXTURE_WAIT_MS});
      await page.locator('#tab-home').click({timeout:FIXTURE_WAIT_MS});
      assert.equal((await read(page)).sent.filter(v=>v.type==='stop').length,1,'duplicate Home and other-to-other are inert');
      await page.locator('#tab-talk').click({timeout:FIXTURE_WAIT_MS});
      const returned=await read(page);
      assert.equal(returned.peers.length,stopped.peers.length,'return does not admit peer');
      assert.equal(returned.permissionCalls,stopped.permissionCalls,'return does not request capture');
      assert.equal(returned.sent.filter(v=>v.type==='wake'||v.type==='text').length,stopped.sent.filter(v=>v.type==='wake'||v.type==='text').length,'return sends no action');
      trace.push({edge:'return-without-action-before-late-release',state:returned});
    }
    if(mode!=='admitted')await release(page);
    const after=await read(page);trace.push({edge:'after-owned-release',state:after});
    if(boundary!=='pagehide')assert.equal(after.activeTab,'tab-talk','actual explicit return changed pane without starting media');
    assert.ok(after.tracks.every(t=>t.state==='ended'),name+' input tracks released');
    assert.ok(after.peers.every(p=>p.state==='closed'),name+' peer released');
    assert.ok(after.peers.every(p=>p.sender==='ended'),name+' admitted peer input tracks released');
    assert.equal(after.micPressed,'false',name+' microphone owner retired');
    if(mode==='late-peer')assert.equal(after.sent.filter(v=>v.type==='live_offer' && v.attempt_id===name).length,0,name+' late offer cannot cross boundary');
    if(exiting) {
      const quiet=await read(page);
      await bounded(page.evaluate(({name})=>{
        const f=window.__tabMedia,s=f.sockets[0],p=f.peers[0];
        s.onmessage({data:JSON.stringify({type:'play',url:'api/reply/inert',playback_id:'late-old-reply'})});
        s.onmessage({data:new ArrayBuffer(4)});
        for(const attempt of [name,'late-return-new'])s.onmessage({data:JSON.stringify({type:'live_offer_request',attempt_id:attempt,connection_id:'fixture-connection'})});
        s.onmessage({data:JSON.stringify({type:'live_answer',attempt_id:name,connection_id:'fixture-connection',provider_session_id:'fixture-provider',generation:1,sdp:'v=0\r\ninert'})});
        s.onmessage({data:JSON.stringify({type:'live_ready',attempt_id:name,connection_id:'fixture-connection',provider_session_id:'fixture-provider',generation:1})});
        if(p){p.ontrack?.({track:p.sender.track,streams:[]});p.channel?.onmessage?.({data:JSON.stringify({type:'error'})});p.onconnectionstatechange?.();}
      },{name}),'late messages after return without user action');
      const late=await read(page);trace.push({edge:'late-after-return',state:late});
      assert.equal(late.peers.length,quiet.peers.length,'late peer must not reopen');
      assert.equal(late.audioCount,quiet.audioCount,'late playback must not reopen');
      assert.equal(late.pcmContextCount,quiet.pcmContextCount,'late bytes create no PCM owner after return');
      assert.equal(late.pcmStartCount,quiet.pcmStartCount,'late bytes schedule no PCM after return');
      assert.equal(late.permissionCalls,quiet.permissionCalls,'late events never request capture');
      assert.equal(late.micPressed,'false');
      assert.equal(late.sent.filter(v=>v.type==='stop').length,1,'late events never duplicate Stop');
      assert.equal(late.sent.filter(v=>v.type==='wake').length,quiet.sent.filter(v=>v.type==='wake').length,'late permission never wakes');
      assert.equal(late.sent.filter(v=>v.type==='live_offer').length,quiet.sent.filter(v=>v.type==='live_offer').length,'late offer never crosses retired owner');
      await page.locator('#tab-home').click({timeout:FIXTURE_WAIT_MS});
      const hidden=await read(page);
      await bounded(page.evaluate(deliver,{type:'live_offer_request',attempt_id:'hidden-new',connection_id:'fixture-connection'}),'hidden fresh offer');
      await bounded(page.evaluate(deliver,{type:'play',url:'api/reply/inert',playback_id:'hidden-reply'}),'hidden legacy play');
      assert.equal((await read(page)).peers.length,hidden.peers.length,'hidden pane admits no peer');
      assert.equal((await read(page)).audioCount,hidden.audioCount,'hidden pane admits no reply');
      await bounded(page.evaluate(()=>window.__tabMedia.sockets[0].onmessage({data:new ArrayBuffer(4)})),'hidden late zero PCM');
      assert.equal((await read(page)).pcmContextCount,hidden.pcmContextCount,'hidden bytes create no PCM context');
      assert.equal((await read(page)).pcmStartCount,hidden.pcmStartCount,'hidden bytes schedule no PCM');
      await page.locator('#tab-talk').click({timeout:FIXTURE_WAIT_MS});
      await page.locator('#ctext').fill('isoleret testinput',{timeout:FIXTURE_WAIT_MS});
      if(mode==='admitted' && boundary==='home') {
        await bounded(page.locator('#ctext').evaluate(element=>element.dispatchEvent(
          new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))),
          'actual composing Enter keydown');
        assert.equal((await read(page)).sent.filter(v=>v.type==='text').length,0,'composition confirmation cannot submit text');
        assert.equal(await page.locator('#ctext').inputValue(),'isoleret testinput','composition confirmation retains draft');
        assert.equal(await page.locator('#csend').isEnabled(),true,'composition confirmation leaves Send available');
        await page.locator('#ctext').press('Enter',{timeout:FIXTURE_WAIT_MS});
      } else await page.locator('#csend').click({timeout:FIXTURE_WAIT_MS});
      const typed=await read(page);
      assert.equal(typed.sent.filter(v=>v.type==='text').length,1,'explicit visible text uses existing sender');
      await bounded(page.evaluate(()=>{const f=window.__tabMedia,e=f.sent.find(v=>v.type==='text');f.sockets[0].onmessage({data:JSON.stringify({type:'command_result',command_id:e.command_id,status:'accepted'})});}),'inert accepted text receipt');
      const fresh=name+'-fresh';
      await bounded(page.evaluate(deliver,{type:'live_offer_request',attempt_id:fresh,connection_id:'fixture-connection'}),'fresh peer after explicit text');
      await page.waitForFunction(n=>window.__tabMedia.sent.some(v=>v.type==='live_offer'&&v.attempt_id===n),fresh,{timeout:FIXTURE_WAIT_MS});
      const freshOwner=await read(page);
      await bounded(page.evaluate(deliver,{type:'live_offer_request',attempt_id:name,connection_id:'fixture-connection'}),'retired offer after explicit fresh text');
      assert.equal((await read(page)).peers.length,freshOwner.peers.length,'retired attempt cannot replace fresh owner');
      await bounded(page.evaluate(deliver,{type:'live_answer',attempt_id:fresh,connection_id:'fixture-connection',provider_session_id:'fresh-provider',generation:2,sdp:'v=0\r\ninert'}),'fresh answer');
      await bounded(page.evaluate(deliver,{type:'live_ready',attempt_id:fresh,connection_id:'fixture-connection',provider_session_id:'fresh-provider',generation:2}),'fresh ready');
      await page.locator('#cmic').click({timeout:FIXTURE_WAIT_MS});
      await page.waitForFunction(()=>document.getElementById('cmic').getAttribute('aria-pressed')==='true',null,{timeout:FIXTURE_WAIT_MS});
      const resumed=await read(page);trace.push({edge:'explicit-visible-text-and-mic',state:resumed});
      assert.equal(resumed.permissionCalls,late.permissionCalls+1,'only explicit mic requests new fixture stream');
      assert.equal(resumed.sent.filter(v=>v.type==='wake').length,late.sent.filter(v=>v.type==='wake').length+1,'explicit mic uses existing wake');
      await page.locator('#tab-home').click({timeout:FIXTURE_WAIT_MS});
      const final=await read(page);trace.push({edge:'fresh-exit',state:final});
      assert.equal(final.sent.filter(v=>v.type==='stop').length,3,'each of three distinct exit transitions sends exactly one Stop');
      assert.ok(final.tracks.every(t=>t.state==='ended'));assert.ok(final.peers.every(p=>p.state==='closed'&&p.sender==='ended'));
    }
    if(mode==='admitted' && boundary==='home') {
      await page.locator('#tab-talk').click({timeout:FIXTURE_WAIT_MS});
      await page.locator('#ctext').fill('reconnect fixture',{timeout:FIXTURE_WAIT_MS});
      await page.locator('#csend').click({timeout:FIXTURE_WAIT_MS});
      const peer=await bounded(page.evaluate(()=>window.__tabMedia.sent.find(v=>v.type==='browser_hello').peer_id),'page peer identity');
      await bounded(page.evaluate(deliver,{type:'play',url:'api/reply/inert',playback_id:'pv-timer-reconnect',playback_connection:'old-socket',playback_generation:2,peer_id:peer}),'finite timer before disconnect');
      await bounded(page.evaluate(()=>{const s=window.__tabMedia.sockets[0];s.readyState=3;s.onclose();document.getElementById('cmodel').dispatchEvent(new Event('change'));const n=window.__tabMedia.sockets.at(-1);n.readyState=WebSocket.OPEN;n.onopen?.();n.onmessage({data:JSON.stringify({type:'hello',protocol:2,rate:24000})});}),'actual socket reconnect and hello');
      const same=await bounded(page.evaluate(()=>window.__tabMedia.sent.filter(v=>v.type==='browser_hello').map(v=>v.peer_id)),'same-page peer across reconnect');
      assert.equal(same.length,2);assert.equal(same[1],peer,'same page keeps peer in memory');
      function newest(event){window.__tabMedia.sockets.at(-1).onmessage({data:JSON.stringify(event)});}
      const recovery={type:'stop_playback',playback_id:'pv-timer-reconnect',playback_connection:'new-socket',playback_generation:0,peer_id:peer,stop_id:'recover',recover_retired:true};
      await bounded(page.evaluate(newest,{...recovery,peer_id:'another-tab'}),'different-peer recovery rejected');
      assert.equal(await bounded(page.evaluate(()=>window.__tabMedia.sent.filter(v=>v.type==='playback_stopped').at(-1).stopped),'different-peer proof'),false);
      await bounded(page.evaluate(newest,recovery),'same-page exact retired timer stop');
      const ack=await bounded(page.evaluate(()=>window.__tabMedia.sent.filter(v=>v.type==='playback_stopped').at(-1)),'reconnected source acknowledgement');
      assert.equal(ack.stopped,true);assert.equal(ack.source_detached,true);assert.equal(ack.socket_id,1);
      assert.equal(ack.playback_id,'pv-timer-reconnect');assert.equal(ack.peer_id,peer);assert.equal(ack.playback_connection,'new-socket');
      await bounded(page.evaluate(newest,{type:'play',url:'api/reply/inert',playback_id:'newer',playback_connection:'new-socket',playback_generation:1,peer_id:peer}),'newer current-socket finite output');
      await bounded(page.evaluate(newest,recovery),'retired recovery cannot stop newer source');
      const protectedSource=await bounded(page.evaluate(()=>({paused:window.__tabMedia.audios.at(-1).paused,ack:window.__tabMedia.sent.filter(v=>v.type==='playback_stopped').at(-1)})),'newer source remains owned');
      assert.equal(protectedSource.paused,false);assert.equal(protectedSource.ack.stopped,false);
      await bounded(page.evaluate(newest,{type:'stop_playback',playback_id:'newer',playback_connection:'new-socket',playback_generation:1,peer_id:peer,stop_id:'final'}),'exact current source cleanup');
      trace.push({edge:'finite-same-page-reconnect',peer_stable:true,old_target:'pv-timer-reconnect',newer_protected:true});
    }
    assert.deepEqual(errors,[],name+' actual HTML script errors');
  }catch(error){primary=error;}
  finally {
    if(page) {
      try{await release(page);}catch(error){cleanupErrors.push({owner:'fixture-gate release',error:String(error)});}
      try{await bounded(page.evaluate(async()=>{
        // Explicit fixture rescue, only after assertions. This never substitutes for product cleanup.
        const f=window.__tabMedia;f.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));
        const contexts=[...new Set([...f.contexts,...f.pcmContexts])].filter(c=>c.state!=='closed');
        const joins=await Promise.allSettled(contexts.map(c=>c.close()));
        if(joins.some(r=>r.status==='rejected') || contexts.some(c=>c.state!=='closed'))throw new Error('native fixture context did not close');
      }),'native generated fixture media rescue');}catch(error){cleanupErrors.push({owner:'fixture-native rescue',error:String(error)});}
    }
    for(const [owner,label] of [[page,'page'],[context,'context']])if(owner) {
      try{await bounded(owner.close(),name+' '+label+' close');}catch(error){cleanupErrors.push({owner:label,error:String(error)});}
    }
  }
  const result={name,mode,boundary,pass:!primary && !cleanupErrors.length,error:primary?String(primary):null,cleanup_errors:cleanupErrors,trace};
  results.push(result);cleanupFindings.push(...cleanupErrors);
  if(proof)try{fs.writeFileSync(path.join(proof,'talk-exit-report.json'),JSON.stringify({issue:115,html_sha256:sourceSha,status:'INCOMPLETE',results},null,2)+'\n');}catch(error){throw primary || error;}
}

  for(const mode of ['admitted','late-permission','late-peer'])for(const boundary of ['pagehide','home'])await one(browser,mode,boundary);
  for(const boundary of ['key-home','key-arrow','key-end'])await one(browser,'admitted',boundary);
  const pass=!cleanupFindings.length && results.length===9 && results.every(r=>r.pass);
  const report={issue:115,html_sha256:sourceSha,status:pass?'PASS':'FAIL',run_complete:results.length===9,cleanup_errors:cleanupFindings,results,
    evidence:'Actual complete HTML/controllers; native generated silent tracks with inert peer/socket. No microphone permission, provider, audible Talk, HA-app/Safari or Voice PE proof.'};
  if(proof)fs.writeFileSync(path.join(proof,'talk-exit-report.json'),JSON.stringify(report,null,2)+'\n');
  assert.equal(pass,true,'all mandatory Tal exit/media ownership regressions');
  return report;
};
