import {SceneMotion} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ScreenLifecycle,screenClock,safeScreenReload} from '../../podvoice/gatekeeper/static/podview/ui/screen-lifecycle.js';
function setup(kiosk=false){
 let time=Date.parse('2026-10-20T12:00:00Z'),serial=0,reloads=0;const timers=new Map(),events=new Map(),style=new Map(),viewport={content:'width=device-width,initial-scale=1'},note={},storage=new Map();
 const doc={visibilityState:'visible',addEventListener(type,fn){events.set(type,fn);},removeEventListener(type){events.delete(type);},querySelector(selector){return selector.startsWith('meta')?viewport:null;},getElementById(){return note;}};
 const win={location:{search:kiosk?'?kiosk=1':'',reload(){reloads++;}},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},addEventListener(type,fn){events.set(type,fn);},removeEventListener(type){events.delete(type);},matchMedia(){return {matches:false,addEventListener(){},removeEventListener(){}};}};
 const host={showFeedback(message,pending,options){note.textContent=message;note.source=options.source;note.pending=pending;},isConnected:true,live:true,liveStatus:'connected',liveSnapshot:{voice:{active:false}},liveTransport:{connected:true,restart(){return Promise.resolve();}},state:{focus:'photo',answers:[],extraTimers:[],devices:[],music:{}},dataset:{},style:{setProperty:(key,value)=>style.set(key,value)},ownerDocument:doc,getClientRects:()=>[{}],querySelector:()=>({getClientRects:()=>[{}]}),dispatch(event){this.state.focus=event.id;}};
 const clock={now:()=>time,setTimeout(fn,delay){timers.set(++serial,{fn,at:time+delay});return serial;},clearTimeout(id){timers.delete(id);}};
 const lifecycle=new ScreenLifecycle(host,win,clock);return {host,doc,win,lifecycle,viewport,events,style,timers,note,reloads:()=>reloads,at(value){time=Date.parse(value);},advance(ms){time+=ms;for(const[id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}},tick(){time+=60000;for(const[id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}}};
}
test('night clock uses Copenhagen schedule and explicit night preview',()=>{
 assert.deepEqual(screenClock(new Date('2026-10-20T21:00:00Z')),{day:'2026-10-20',hour:23});const x=setup();x.lifecycle.attach();assert.equal(x.host.dataset.night,'false');x.at('2026-10-20T21:00:00Z');x.lifecycle.sync();assert.equal(x.host.dataset.night,'true');assert.equal(x.host.dataset.nightSource,'clock-schedule');x.at('2026-10-20T12:00:00Z');x.host.previewStage='night';x.lifecycle.sync();assert.equal(x.host.dataset.nightSource,'local-preview');
});
test('Ro drift stays bounded and changes once a minute; cleanup removes timer and restores viewport',()=>{
 const x=setup(true);x.lifecycle.attach();assert.match(x.viewport.content,/maximum-scale=1/);for(let i=0;i<12;i++){const before=[...x.style.values()];x.tick();assert.notDeepEqual([...x.style.values()],before);assert([...x.style.values()].every(value=>Math.abs(parseFloat(value))<=4));assert.equal(x.timers.size,1);}x.host.state.focus='now';x.lifecycle.sync();assert.equal(x.style.get('--drift-x'),'0px');x.lifecycle.cleanup();assert.equal(x.timers.size,0);assert.equal(x.viewport.content,'width=device-width,initial-scale=1');
});
test('ordinary browser retains zoom and never performs maintenance reload',()=>{
 const x=setup();x.at('2026-10-20T02:00:00Z');x.lifecycle.attach();assert.doesNotMatch(x.viewport.content,/maximum-scale/);x.events.get('error')();x.tick();assert.equal(x.reloads(),0);
});
test('04 maintenance defers active resources and useful history then reloads at most once',()=>{
 const x=setup(true);x.host.state.timer={status:'running'};x.at('2026-10-20T02:00:00Z');x.lifecycle.attach();assert.equal(x.reloads(),0);x.at('2026-10-20T04:00:00Z');x.host.state.timer=null;x.host.state.answers=[{historical:true}];x.lifecycle.sync();assert.equal(x.reloads(),0);x.host.state.answers=[];x.lifecycle.sync();assert.equal(x.reloads(),1);x.lifecycle.sync();assert.equal(x.reloads(),1);
});
test('error recovery never reloads an active conversation, local demo or playing screen',()=>{
 for(const state of ['voice','local','music','dialog']){const x=setup(true);if(state==='voice')x.host.liveSnapshot.voice.active=true;if(state==='local')x.host.live=false;if(state==='music')x.host.dataset.playback='active';if(state==='dialog')x.doc.querySelector=()=>({});x.lifecycle.attach();x.events.get('error')();x.tick();assert.equal(x.reloads(),0,state);assert.equal(safeScreenReload(x.host),false);}
});
test('wake refresh is read only, retains tasks and shows one existing note until fresh snapshot',async()=>{
 const x=setup();let args;x.host.state.focus='now';x.host.liveTransport.restart=(...value)=>{args=value;return Promise.resolve();};x.lifecycle.attach();x.doc.visibilityState='hidden';x.events.get('visibilitychange')();assert.equal(x.timers.size,0);x.doc.visibilityState='visible';x.events.get('visibilitychange')();await Promise.resolve();assert.deepEqual(args,[false,false,false]);assert.equal(x.host.state.focus,'photo');assert.equal(x.note.textContent,'Opdaterer…');x.host.liveSnapshot={voice:{active:false}};x.lifecycle.sync();assert.equal(x.lifecycle.wakeSnapshot,undefined);x.host.state.focus='demo-answer';x.host.state.answers=[{id:'demo-answer',kind:'steps'}];x.lifecycle.wake();assert.equal(x.host.state.focus,'demo-answer');
});
test('wake returns an ordinary retained answer to Ro without deleting it',()=>{
 const x=setup(),answer={id:'a',kind:'fact-card',status:'ready'};x.host.state.focus='a';x.host.state.answers=[answer];x.lifecycle.attach();x.lifecycle.wake();assert.equal(x.host.state.focus,'photo');assert.equal(x.host.state.answers[0],answer);
});
test('blocked reload-marker storage prevents an error reload loop',()=>{
 const x=setup(true);x.win.sessionStorage.setItem=()=>{throw Error('blocked');};x.lifecycle.attach();x.events.get('error')();x.tick();assert.equal(x.reloads(),0);x.events.get('error')();x.tick();assert.equal(x.reloads(),0);
});

test('pending owner task defers wake transport restart until task settles',async()=>{
 const x=setup();let calls=0;x.host.liveTransport.restart=()=>{calls++;return Promise.resolve();};x.host.state.pendingAnswer={id:'pending'};x.host.state.focus='answer';x.lifecycle.attach();x.lifecycle.wake();await Promise.resolve();assert.equal(calls,0);assert.equal(x.host.state.focus,'answer');x.host.state.pendingAnswer=null;x.lifecycle.sync();await Promise.resolve();assert.equal(calls,1);
});
test('repeated wake coalesces one restart and cleanup fences a queued read',async()=>{
 const x=setup();let calls=0;x.host.liveTransport.restart=()=>{calls++;return Promise.resolve();};x.lifecycle.attach();x.lifecycle.wake();x.lifecycle.wake();x.lifecycle.sync();await Promise.resolve();assert.equal(calls,1);
 const y=setup();y.host.liveTransport.restart=()=>{assert.fail('detached lifecycle must not start transport');};y.lifecycle.attach();y.lifecycle.wake();y.lifecycle.cleanup();await Promise.resolve();
});
test('maintenance catches a hidden screen crossing 04 and waits for recent interaction',()=>{
 const x=setup(true);x.at('2026-10-20T01:30:00Z');x.lifecycle.attach();x.doc.visibilityState='hidden';x.events.get('visibilitychange')();x.at('2026-10-20T03:00:00Z');x.doc.visibilityState='visible';x.host.lastInteractionAt=Date.parse('2026-10-20T03:00:00Z');x.lifecycle.wake();assert.equal(x.reloads(),0);x.tick();assert.equal(x.reloads(),0);x.tick();assert.equal(x.reloads(),1);
});
test('white-screen detection includes a missing frame and ignores transient hiding',()=>{
 const x=setup(true);x.lifecycle.attach();x.host.querySelector=()=>null;x.lifecycle.sync();assert.equal(x.reloads(),0);x.host.querySelector=()=>({getClientRects:()=>[{}]});x.tick();assert.equal(x.reloads(),0);x.host.querySelector=()=>null;x.lifecycle.sync();x.tick();assert.equal(x.reloads(),1);
});
test('legacy WebView media query listener is removed during cleanup',()=>{
 const x=setup();let attached=0,detached=0;x.win.matchMedia=()=>({addListener(){attached++;},removeListener(){detached++;}});x.lifecycle.attach();x.lifecycle.cleanup();assert.equal(attached,1);assert.equal(detached,1);
});
test('missing owner voice state never authorizes maintenance reload',()=>{
 const x=setup(true);x.host.liveSnapshot={};x.lifecycle.attach();x.events.get('error')();x.tick();assert.equal(x.reloads(),0);
});

test('wake never invalidates pending timer, playback, selection or queue owner operations',async()=>{
 for(const owner of ['timer','music','control','selection','queue']){
  const x=setup();let calls=0;x.host.liveTransport.restart=()=>{calls++;return Promise.resolve();};
  if(owner==='timer')x.host.liveActionPending=true;if(owner==='music')x.host.state.music.pending={};if(owner==='control')x.host.liveControls={musicIntentPending:true};if(owner==='selection')x.host.liveSelection={pending:true};if(owner==='queue')x.host.liveMedia={queueControls:{pending:true}};
  x.lifecycle.attach();x.lifecycle.wake();await Promise.resolve();assert.equal(calls,0,owner);
 }
});

test('offline pending state cannot deadlock read-only wake recovery or lose current task',async()=>{
 const x=setup();let args;x.host.liveStatus='disconnected';x.host.liveTransport.connected=false;x.host.liveControls={pending:true};x.host.state.focus='answer';x.host.state.pendingAnswer={id:'pending'};const state=x.host.state;x.host.liveTransport.restart=(...value)=>{args=value;return Promise.resolve();};x.lifecycle.attach();x.lifecycle.wake();await Promise.resolve();assert.deepEqual(args,[false,false,false]);assert.equal(x.host.state,state);assert.equal(x.host.state.focus,'answer');
});

test('wake status uses the shared queue and clears only its own source after a fresh snapshot',async()=>{
 const x=setup(),events=[];x.host.showFeedback=(message,pending,options)=>events.push({message,pending,...options});x.lifecycle.attach();x.lifecycle.wake();await Promise.resolve();assert.deepEqual(events.at(-1),{message:'Opdaterer…',pending:true,source:'wake'});x.host.liveSnapshot={voice:{active:false}};x.lifecycle.sync();assert.deepEqual(events.at(-1),{message:'',pending:false,source:'wake'});
});

test('detail idle returns one history step after60s and retains timer and playback',()=>{
 const x=setup(),timer={id:'t',status:'running'},music={track:'retained'};x.host.state={...x.host.state,focus:'weather',timer,music};const actions=[];x.host.dispatch=e=>{actions.push(e);x.host.state.focus='now';};x.lifecycle.attach();x.lifecycle.sync();x.tick();assert.deepEqual(actions,[{type:'back'}]);assert.equal(x.host.state.timer,timer);assert.equal(x.host.state.music,music);x.lifecycle.cleanup();
});
test('detail no-op render keeps deadline; input restarts and pending conversation blocks return',()=>{
 const x=setup();x.host.state.focus='player';x.lifecycle.attach();const first=x.lifecycle.detailTimer;x.lifecycle.sync();assert.equal(x.lifecycle.detailTimer,first);x.events.get('wheel')({type:'wheel'});assert.notEqual(x.lifecycle.detailTimer,first);x.host.state.pendingAnswer={id:'pending'};x.lifecycle.sync();assert.equal(x.lifecycle.detailTimer,null);x.host.state.pendingAnswer=null;x.lifecycle.sync();assert.notEqual(x.lifecycle.detailTimer,null);x.host.state.focus='answer';x.lifecycle.sync();assert.equal(x.lifecycle.detailTimer,null);x.lifecycle.cleanup();
});
test('held touch prevents detail timeout and geometry releases only after2s quiet or cleanup',()=>{
 const x=setup();let holds=0,releases=0;x.host.motion={holdGeometry(){holds++;},releaseGeometry(){releases++;}};x.host.state.focus='timers';x.lifecycle.attach();x.events.get('pointerdown')({type:'pointerdown',pointerId:1});assert.equal(x.lifecycle.detailTimer,null);x.tick();assert.equal(x.host.state.focus,'timers');assert.equal(holds,1);x.events.get('pointerup')({type:'pointerup',pointerId:1});const quiet=x.timers.get(x.lifecycle.quietTimer);assert.equal(quiet.at-x.lifecycle.clock.now(),2000);x.events.get('pointerdown')({type:'pointerdown',pointerId:2});assert.equal(x.lifecycle.quietTimer,null);assert.equal(releases,0);x.lifecycle.cleanup();assert.equal(releases,1);assert.equal(x.timers.size,0);
});
test('native pointercancel does not end a live finger contact; blur releases all geometry',()=>{
 const x=setup();let released=0;x.host.motion={holdGeometry(){},releaseGeometry(){released++;}};x.host.state.focus='weather';x.lifecycle.attach();for(const e of [{type:'pointerdown',pointerId:1},{type:'touchstart',touches:[{}]},{type:'pointercancel',pointerId:1}])x.events.get(e.type)(e);assert.equal(x.lifecycle.pointers.has('touch'),true);assert.equal(x.lifecycle.quietTimer,null);assert.equal(x.lifecycle.detailTimer,null);x.events.get('blur')();assert.equal(x.lifecycle.pointers.size,0);assert.equal(released,1);x.lifecycle.cleanup();
});
test('overall idle returns overview to Ro after180s; unchanged rendering never extends deadline',()=>{
 const x=setup();x.host.state.focus='now';x.lifecycle.attach();const timer=x.lifecycle.idleTimer;x.advance(60000);x.lifecycle.sync();assert.equal(x.lifecycle.idleTimer,timer);x.advance(119999);assert.equal(x.host.state.focus,'now');x.advance(1);assert.equal(x.host.state.focus,'photo');x.lifecycle.cleanup();
});
test('overall idle resets on interaction and blocks alarm, focused answer and editing',()=>{
 const x=setup();x.host.state.focus='now';x.lifecycle.attach();x.advance(170000);x.events.get('pointerdown')({type:'pointerdown',pointerId:1});x.events.get('pointerup')({type:'pointerup',pointerId:1});x.advance(10000);assert.equal(x.host.state.focus,'now');x.host.state.timer={status:'done'};x.lifecycle.sync();assert.equal(x.lifecycle.idleTimer,null);x.host.state.timer=null;x.host.state.focus='answer';x.host.state.answers=[{id:'answer'}];x.lifecycle.sync();assert.equal(x.lifecycle.idleTimer,null);x.host.state.focus='now';x.doc.activeElement={matches:()=>true};x.lifecycle.sync();assert.equal(x.lifecycle.idleTimer,null);x.lifecycle.cleanup();
});
test('night is22–06 Copenhagen and one tap wakes Ro30s without click-through',()=>{
 const x=setup();x.at('2026-10-20T20:00:00Z');x.lifecycle.attach();assert.equal(x.host.dataset.night,'true');let stopped=0;x.events.get('pointerdown')({type:'pointerdown',pointerId:1,preventDefault(){},stopImmediatePropagation(){stopped++;}});assert.equal(x.host.dataset.night,'false');assert.equal(x.host.state.focus,'photo');x.events.get('click')({preventDefault(){},stopImmediatePropagation(){stopped++;}});assert.equal(stopped,2);x.events.get('pointerup')({type:'pointerup',pointerId:1});x.advance(29999);assert.equal(x.host.dataset.night,'false');x.advance(1);assert.equal(x.host.dataset.night,'true');x.at('2026-10-21T04:00:00Z');x.lifecycle.sync();assert.equal(x.host.dataset.night,'false');x.lifecycle.cleanup();
});
test('online offline changes use existing host banner rendering without rewriting HA status',()=>{
 const x=setup();let renders=0;x.host.renderLive=()=>renders++;x.win.navigator={onLine:true};x.lifecycle.attach();x.win.navigator.onLine=false;x.events.get('offline')();assert.equal(x.host.browserOffline,true);assert.equal(x.host.liveStatus,'connected');x.win.navigator.onLine=true;x.events.get('online')();assert.equal(x.host.browserOffline,false);assert.equal(renders,2);x.lifecycle.cleanup();assert.equal(x.events.has('offline'),false);
});
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('wake lock visible live acquisition releases on hiding and reacquires on return',async()=>{
 const x=setup();let requests=0,releases=0;x.win.navigator={wakeLock:{request:async kind=>{assert.equal(kind,'screen');requests++;return{release:async()=>{releases++;},addEventListener(){}};}}};x.lifecycle.attach();await flush();assert.equal(requests,1);x.lifecycle.sync();await flush();assert.equal(requests,1);x.doc.visibilityState='hidden';x.events.get('visibilitychange')();await flush();assert.equal(releases,1);x.doc.visibilityState='visible';x.events.get('visibilitychange')();await flush();assert.equal(requests,2);x.lifecycle.cleanup();await flush();assert.equal(releases,2);
});
test('wake lock rejection is nonfatal and does not retry per render; stale acquisition releases',async()=>{
 const x=setup();let requests=0;x.win.navigator={wakeLock:{request:async()=>{requests++;throw Error('denied');}}};x.lifecycle.attach();await flush();x.lifecycle.sync();await flush();assert.equal(requests,1);x.lifecycle.cleanup();
 const y=setup();let resolve,releases=0;y.win.navigator={wakeLock:{request:()=>new Promise(r=>resolve=r)}};y.lifecycle.attach();await flush();y.lifecycle.cleanup();resolve({release:async()=>{releases++;}});await flush();assert.equal(releases,1);assert.equal(y.lifecycle.wakeLock,null);
});
test('local preview requires display interaction before requesting wake lock',async()=>{
 const x=setup();x.host.live=false;let requests=0;x.win.navigator={wakeLock:{request:async()=>{requests++;return{release:async()=>{},addEventListener(){}};}}};x.lifecycle.attach();await flush();assert.equal(requests,0);x.events.get('pointerdown')({type:'pointerdown',pointerId:1});await flush();assert.equal(requests,1);x.lifecycle.cleanup();
});


test('two-second quiet geometry release cannot bounce an unchanged idle timer after its entrance has finished',async()=>{
 const x=setup(),oldStyle=globalThis.getComputedStyle,heights=[177.4,177.4,177.4],nodes=[];x.host.state.focus='now';
 for(let i=0;i<3;i++){const values=new Map(),node={id:i===2?'timer-card':'resource-'+i,style:{getPropertyValue:k=>values.get(k)||'',getPropertyPriority:()=>'',setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)},getClientRects:()=>[{}],offsetParent:null,offsetLeft:0,offsetWidth:200,animations:[]};
  Object.defineProperty(node,'height',{get:()=>Number.parseFloat(values.get('height'))||heights[i]});Object.defineProperty(node,'offsetHeight',{get:()=>Math.round(node.height)});Object.defineProperty(node,'offsetTop',{get:()=>nodes.slice(0,i).reduce((sum,n)=>sum+n.height,0)});
  node.getBoundingClientRect=()=>({x:0,y:node.offsetTop,width:200,height:node.height});node.animate=(frames,options)=>{let finish;const animation={frames,options,finished:new Promise(resolve=>finish=resolve),cancel(){x.lifecycle.clock.clearTimeout(timer);}};const timer=x.lifecycle.clock.setTimeout(()=>finish(),options.duration);node.animations.push(animation);return animation;};nodes.push(node);
 }
 x.host.querySelectorAll=()=>nodes;x.host.motion=new SceneMotion(x.host);globalThis.getComputedStyle=node=>({height:node.height+'px'});
 try{
  const timer=nodes[2],initialTop=timer.getBoundingClientRect().y;x.host.motion.animate(timer,[{opacity:.45},{opacity:1}],120);x.lifecycle.attach();x.advance(120);for(let i=0;i<4;i++)await Promise.resolve();assert.equal(x.host.motion.animations.size,0);assert.equal(timer.animations.length,1);
  x.events.get('pointerdown')({type:'pointerdown',pointerId:7});assert.equal(nodes[0].style.getPropertyValue('height'),'177.4px');assert.equal(timer.getBoundingClientRect().y,initialTop,'holding geometry must not round prior rows');
  x.events.get('pointerup')({type:'pointerup',pointerId:7});x.advance(1999);assert.equal(timer.animations.length,1);x.advance(1);assert.equal(x.host.motion.geometry.size,0);assert.equal(timer.getBoundingClientRect().y,initialTop);assert.equal(timer.animations.length,1,'quiet release owns no new event or bounce');
  for(let seconds=0;seconds<8;seconds++){const before=x.host.motion.resources();x.advance(1000);x.host.motion.settleResources(before);assert.equal(timer.animations.length,1,'unchanged later renders retain the settled timer');}
  const before=x.host.motion.resources();heights[2]=112;x.host.motion.settleResources(before);assert.equal(timer.animations.length,2,'a real timer extent change retains its finite transition');assert.equal(timer.animations[1].options.duration,240);assert.match(timer.animations[1].frames[0].transform,/scale/);
 }finally{x.lifecycle.cleanup();x.host.motion.cancel();globalThis.getComputedStyle=oldStyle;}
});

test('return to a still-fresh connected snapshot preserves the warm view without restarting',async()=>{
 const x=setup();let restarts=0;const transport=x.host.liveTransport;transport.snapshot=x.host.liveSnapshot;transport.acceptedReadAt=Date.parse('2026-10-20T12:00:00Z');transport.restart=()=>{restarts++;return Promise.resolve();};
 const cached={title:'Retained music'};x.host.state.music=cached;x.lifecycle.attach();x.doc.visibilityState='hidden';x.events.get('visibilitychange')();x.advance(2000);x.doc.visibilityState='visible';x.events.get('visibilitychange')();await Promise.resolve();assert.equal(restarts,0);assert.equal(x.host.state.music,cached);assert.equal(transport.connected,true);assert.notEqual(x.note.textContent,'Opdaterer…');
 x.lifecycle.cleanup();
});

test('wake still obtains a fresh read for stale, disconnected or replaced snapshot owners',async()=>{
 for(const kind of ['expired','future','disconnected','blocked','closed','other-snapshot']){
  const x=setup();let restarts=0;const t=x.host.liveTransport;t.snapshot=x.host.liveSnapshot;t.acceptedReadAt=Date.parse('2026-10-20T12:00:00Z');t.restart=()=>{restarts++;return Promise.resolve();};
  if(kind==='expired')t.acceptedReadAt-=6000;if(kind==='future')t.acceptedReadAt++;if(kind==='disconnected')t.connected=false;if(kind==='blocked')t.recoveryBlocked=true;if(kind==='closed')t.closed=true;if(kind==='other-snapshot')t.snapshot={voice:{active:false}};
  x.lifecycle.attach();x.lifecycle.wake();await Promise.resolve();assert.equal(restarts,1,kind);x.lifecycle.cleanup();
 }
});
