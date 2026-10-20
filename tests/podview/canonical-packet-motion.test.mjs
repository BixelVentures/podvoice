import test from 'node:test';import assert from 'node:assert/strict';import {SceneMotion} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
const box={x:20,y:80,width:300,height:500};
function fixture(){let cancelled=0;const calls=[];const content={hidden:false,id:'now-view',getClientRects:()=>[box],animate:(frames)=>{calls.push(frames);return {cancel(){cancelled++;},finished:new Promise(()=>{})};}};const player={...content,getBoundingClientRect:()=>box};const feed={scrollTop:80,children:[content]};const host={dataset:{motion:'system'},querySelector:s=>s==='.responses'?feed:player};return {motion:new SceneMotion(host),feed,player,content,calls,get cancelled(){return cancelled;}};}
test('rapid navigation cancels previous motion and stable player never moves',()=>{const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});try{const f=fixture();const first=f.motion.capture('now');f.motion.enter('now','music',first);assert.equal(f.calls.length,1);const second=f.motion.capture('music');assert.equal(f.cancelled,1);f.motion.enter('music','now',second,true);assert.equal(f.feed.scrollTop,80);f.motion.cancel();assert.equal(f.cancelled,2);assert.equal(f.motion.animations.size,0);}finally{globalThis.matchMedia=previous;}});
test('reduced motion retains navigation and scroll with opacity-only crossfades',()=>{const f=fixture();f.motion.host.dataset.motion='reduced';f.motion.capture('now');f.motion.enter('now','music',box);assert.equal(f.feed.scrollTop,0);f.motion.enter('music','now',box,true);assert.equal(f.feed.scrollTop,80);assert.equal(f.calls.length,2);for(const frames of f.calls)for(const frame of frames)assert.deepEqual(Object.keys(frame),['opacity']);});

function resourceFixture(){
 const nodes=[];
 const host={dataset:{motion:'system'},querySelectorAll:()=>nodes};
 const motion=new SceneMotion(host);
 function tile(y,log=[]){
  const node={y,visualOffset:0,log,animations:[],offsetParent:null,get offsetLeft(){return 0;},get offsetTop(){return this.y;},offsetWidth:200,offsetHeight:80,getClientRects:()=>[{}],getBoundingClientRect(){this.log.push('read');return {x:0,y:this.y+this.visualOffset,width:200,height:80};},animate(frames,options){const animation={frames,options,cancelled:0,finished:new Promise(()=>{}),cancel(){this.cancelled++;node.visualOffset=0;node.log.push('cancel');}};this.animations.push(animation);return animation;}};
  nodes.push(node);return node;
 }
 return {host,motion,nodes,tile};
}
function withMotionPreference(run,{reduced=false}={}){const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:reduced});try{return run();}finally{globalThis.matchMedia=previous;}}

test('resource capture measures the visible box without cancelling its owned animation',()=>withMotionPreference(()=>{
 const f=resourceFixture(),log=[],tile=f.tile(180,log);
 f.motion.animate(tile,[{transform:'translateY(-20px)'},{transform:'none'}],240);
 log.length=0;tile.y=160;
 const before=f.motion.resources();
 assert.deepEqual(log,['read']);
 assert.equal(before.get(tile).y,160);
 assert.equal(f.motion.animations.has(tile),true);
}));

test('unchanged resource geometry neither cancels nor restarts an active animation',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180);
 f.motion.animate(tile,[{opacity:.5},{opacity:1}],160);
 const before=f.motion.resources();
 f.motion.settleResources(before);
 assert.equal(tile.animations[0].cancelled,0);
 assert.equal(tile.animations.length,1);
 assert.equal(f.motion.animations.size,1);
}));

test('adding a resource fades it in and FLIP-shifts an existing resource below it',()=>withMotionPreference(()=>{
 const f=resourceFixture(),existing=f.tile(220);
 const before=f.motion.resources();
 const added=f.tile(100);
 existing.y=300;
 f.motion.settleResources(before);
 assert.equal(existing.animations.length,1);
 assert.equal(existing.animations[0].options.duration,240);
 assert.deepEqual(existing.animations[0].frames,[{transform:'translate(0px,-80px)'},{transform:'none'}]);
 assert.equal(added.animations.length,1);
 assert.equal(added.animations[0].options.duration,160);
 assert.deepEqual(added.animations[0].frames,[{opacity:.45},{opacity:1}]);
}));

test('view changes and reduced motion suppress resource animations',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(200),before=f.motion.resources();tile.y=260;
 f.motion.settleResources(before,true);
 assert.equal(tile.animations.length,0);
 f.host.dataset.motion='reduced';
 const reducedBefore=f.motion.resources();tile.y=340;
 f.motion.settleResources(reducedBefore);
 assert.equal(tile.animations.length,0);
}));

test('motion cleanup cancels every owned resource animation',()=>withMotionPreference(()=>{
 const f=resourceFixture(),a=f.tile(100),b=f.tile(200);
 f.motion.animate(a,[{opacity:.5},{opacity:1}]);
 f.motion.animate(b,[{opacity:.5},{opacity:1}]);
 f.motion.cancel();
 assert.equal(a.animations[0].cancelled,1);
 assert.equal(b.animations[0].cancelled,1);
 assert.equal(f.motion.animations.size,0);
}));

test('a reduced-motion retarget drops the cancelled animation owner immediately',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(100);f.motion.animate(tile,[{opacity:0},{opacity:1}]);const animation=tile.animations[0];
 f.host.dataset.motion='reduced';f.motion.animate(tile,[{opacity:0},{opacity:1}]);
 assert.equal(animation.cancelled,1);assert.equal(f.motion.animations.size,0);assert.equal(tile.animations.length,1);
}));


test('normal animation progress during an unchanged render is not mistaken for a layout change',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180);f.motion.animate(tile,[{transform:'translateY(-20px)'},{transform:'none'}]);tile.visualOffset=-20;const before=f.motion.resources();tile.visualOffset=-15;f.motion.settleResources(before);assert.equal(tile.animations[0].cancelled,0);assert.equal(tile.animations.length,1);assert.equal(f.motion.animations.size,1);f.motion.cancel();
}));
test('a genuine layout retarget starts from the prior visible position with one animation owner',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180);f.motion.animate(tile,[{transform:'translateY(-20px)'},{transform:'none'}]);tile.visualOffset=-20;const before=f.motion.resources();tile.y=220;f.motion.settleResources(before);assert.equal(tile.animations[0].cancelled,1);assert.equal(tile.animations.length,2);assert.deepEqual(tile.animations[1].frames,[{transform:'translate(0px,-60px)'},{transform:'none'}]);assert.equal(f.motion.animations.get(tile),tile.animations[1]);f.motion.cancel();assert.equal(tile.animations[1].cancelled,1);
}));
test('switching reduced motion cancels an already active resource transition without a replacement',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180);f.motion.animate(tile,[{opacity:.5},{opacity:1}]);const before=f.motion.resources();f.host.dataset.motion='reduced';f.motion.settleResources(before);assert.equal(tile.animations[0].cancelled,1);assert.equal(tile.animations.length,1);assert.equal(f.motion.animations.size,0);
}));

test('an animation finishing between capture and settle does not create a replacement on unchanged layout',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180);f.motion.animate(tile,[{transform:'translateY(-20px)'},{transform:'none'}]);tile.visualOffset=-5;const before=f.motion.resources();f.motion.animations.delete(tile);tile.visualOffset=0;f.motion.settleResources(before);assert.equal(tile.animations.length,1);assert.equal(tile.animations[0].cancelled,0);assert.equal(f.motion.animations.size,0);
}));

function preferenceMotion(){
 const old=globalThis.matchMedia,media=new EventTarget(),listeners=new Set();media.matches=false;let attached=0,detached=0;
 const add=media.addEventListener.bind(media),remove=media.removeEventListener.bind(media);
 media.addEventListener=(type,fn)=>{if(type==='change'){attached++;listeners.add(fn);}add(type,fn);};media.removeEventListener=(type,fn)=>{if(type==='change'){detached++;listeners.delete(fn);}remove(type,fn);};
 globalThis.matchMedia=()=>media;
 const f=resourceFixture();return {...f,media,listeners,get attached(){return attached;},get detached(){return detached;},restore(){f.motion.cancel();globalThis.matchMedia=old;}};
}
test('OS reduce event immediately cancels all active scenes without another render or replay',()=>{
 const f=preferenceMotion();try{const a=f.tile(100),b=f.tile(200);f.motion.animate(a,[{opacity:0},{opacity:1}],380);f.motion.animate(b,[{opacity:0},{opacity:1}],320);assert.equal(f.attached,1);assert.equal(f.listeners.size,1);f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(f.motion.animations.size,0);assert.equal(a.animations[0].cancelled,1);assert.equal(b.animations[0].cancelled,1);assert.equal(f.listeners.size,0);assert.equal(f.detached,1);f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.equal(a.animations.length,1);assert.equal(b.animations.length,1);}finally{f.restore();}
});
test('existing pagehide or disconnect cancellation releases OS listener and later explicit motion reattaches once',()=>{
 const f=preferenceMotion();try{const a=f.tile(100);f.motion.animate(a,[{opacity:0},{opacity:1}]);f.motion.cancel();f.motion.cancel();assert.equal(f.listeners.size,0);assert.equal(f.detached,1);f.media.dispatchEvent(new Event('change'));assert.equal(a.animations.length,1);f.motion.animate(a,[{opacity:0},{opacity:1}]);const before=f.motion.resources();f.motion.settleResources(before);f.motion.settleResources(f.motion.resources());assert.equal(f.attached,2);assert.equal(f.listeners.size,1);assert.equal(a.animations.length,2);assert.equal(a.animations[1].cancelled,0);f.motion.cancel();assert.equal(f.detached,2);assert.equal(f.listeners.size,0);}finally{f.restore();}
});
test('last animation completion releases preference listener but superseded completion cannot release a current owner',async()=>{
 const f=preferenceMotion();try{const node=f.tile(100),finished=[];node.animate=(frames,options)=>{let resolve;const animation={frames,options,cancelled:0,cancel(){this.cancelled++;},finished:new Promise(done=>resolve=done)};finished.push(resolve);node.animations.push(animation);return animation;};f.motion.animate(node,[{opacity:0},{opacity:1}]);f.motion.animate(node,[{opacity:.5},{opacity:1}]);assert.equal(f.attached,1);finished[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.listeners.size,1);assert.equal(f.motion.animations.get(node),node.animations[1]);finished[1]();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.motion.animations.size,0);assert.equal(f.listeners.size,0);assert.equal(f.detached,1);}finally{f.restore();}
});
test('initial reduced preference does not attach a listener or replay motion until another explicit request',()=>{
 const f=preferenceMotion();try{const node=f.tile(100);f.media.matches=true;f.motion.animate(node,[{opacity:0},{opacity:1}]);assert.equal(node.animations.length,0);assert.equal(f.attached,0);f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.equal(node.animations.length,0);f.motion.animate(node,[{opacity:0},{opacity:1}]);assert.equal(node.animations.length,1);assert.equal(f.listeners.size,1);}finally{f.restore();}
});
test('Ro entry introduces the player while ordinary detail entry leaves it stable',()=>withMotionPreference(()=>{
 const f=fixture(),photo={...f.content},frame={...f.content};
 const query=f.motion.host.querySelector;f.motion.host.querySelector=selector=>selector==='#photo-view'?photo:selector==='.frame'?frame:query(selector);
 f.motion.enter('photo','now',box);
 assert.equal(f.motion.animations.has(f.content),true);assert.equal(f.motion.animations.has(f.player),true);assert.equal(f.motion.animations.has(frame),false);
 f.motion.cancel();f.motion.enter('now','photo',box);
 assert.equal(f.motion.animations.has(photo),true);assert.equal(f.motion.animations.has(f.player),false);assert.equal(f.motion.animations.has(frame),false);
 for(const frames of f.calls)for(const keyframe of frames){assert.equal(keyframe.filter,undefined);assert.doesNotMatch(keyframe.transform||'',/scale/);}
}));

function navigationFixture(){
 const node=(id,rect)=>({id,hidden:false,inert:false,dataset:{},style:{},children:[],animations:[],getAttribute:()=>null,removeAttribute(){this.style={};},setAttribute(){},getClientRects(){return this.hidden?[]:[rect];},getBoundingClientRect:()=>rect,querySelector(){return null;},animate(frames,options){let resolve;const animation={frames,options,cancelled:0,paused:0,played:0,cancel(){this.cancelled++;},pause(){this.paused++;},play(){this.played++;},finished:new Promise(done=>resolve=done),finish:()=>resolve()};this.animations.push(animation);return animation;}});
 const photo=node('photo-view',{x:0,y:0,width:1280,height:800}),overview=node('now-view',{x:28,y:80,width:824,height:650}),detail=node('weather-view',{x:28,y:80,width:824,height:650}),heading=node('heading',{x:28,y:80,width:824,height:70}),cards=Array.from({length:8},(_,i)=>node('card-'+i,{x:28+(i%2)*420,y:150+Math.floor(i/2)*180,width:400,height:176})),player=node('player',{x:876,y:112,width:376,height:650});
 detail.children=[heading,...cards.slice(6)];detail.querySelector=()=>heading;overview.hidden=true;detail.hidden=true;
 const feed={scrollTop:53,children:[photo,overview,detail]},host={isConnected:true,dataset:{motion:'system'},querySelector:s=>s==='.responses'?feed:s==='#photo-view'?photo:s==='#home-weather'?cards[0]:s.startsWith('.player')?player:null,querySelectorAll:s=>s.startsWith('#now-view')?cards:[]};
 return {motion:new SceneMotion(host),host,feed,photo,overview,detail,heading,cards,player};
}
test('Ro retains and fades its photo, staggers at most six cards and decodes player within a bounded wait',async()=>withMotionPreference(async()=>{
 const f=navigationFixture();let ready;const decoded=new Promise(done=>ready=done);f.player.querySelector=()=>({complete:true,naturalWidth:300,decode:()=>decoded});
 const before=f.motion.capture('photo','now');f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',before);
 assert.equal(f.photo.hidden,false);assert.equal(f.photo.inert,true);assert.equal(f.photo.animations[0].options.duration,200);
 assert.deepEqual(f.cards.map(c=>c.animations.length),[1,1,1,1,1,1,0,0]);
 f.cards.slice(0,6).forEach((card,i)=>{assert.equal(card.animations[0].options.delay,i*30);assert.equal(card.animations[0].options.duration,160);});
 const player=f.player.animations[0];assert.equal(player.paused,1);assert.equal(player.played,0);assert.equal(player.options.duration,240);assert.equal(player.frames[0].opacity,1);
 ready();await Promise.resolve();assert.equal(player.played,1);assert.equal(f.motion.waits.size,0);
 f.motion.cancel();assert.equal(f.photo.hidden,true);assert.equal(f.photo.inert,false);assert.equal(f.motion.exits.size,0);assert.equal(f.motion.animations.size,0);
}));
test('card to heading uses 280ms FLIP and return restores the exact overview scroll with 240ms FLIP',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.photo.hidden=true;f.overview.hidden=false;
 let before=f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',before);
 assert.equal(f.heading.animations[0].options.duration,280);assert.equal(f.heading.animations[0].options.easing,'cubic-bezier(.2,0,0,1)');assert.match(f.heading.animations[0].frames[0].transform,/scale\(/);
 assert.equal(f.overview.animations[0].options.duration,90);
 before=f.motion.capture('weather','now');f.detail.hidden=true;f.overview.hidden=false;f.motion.enter('weather','now',before,true);
 assert.equal(f.feed.scrollTop,53);assert.equal(f.cards[0].animations.at(-1).options.duration,240);assert.equal(f.player.animations.length,0);f.motion.cancel();assert.equal(f.detail.hidden,true);
}));
test('same-view requests keep scroll and do not animate, and older WebView without WAAPI still navigates',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.motion.enter('now','now',null);assert.equal(f.feed.scrollTop,53);assert.equal(f.motion.animations.size,0);
 f.photo.hidden=true;f.overview.hidden=false;f.overview.animate=undefined;f.motion.enter('weather','now',null,true);assert.equal(f.feed.scrollTop,0);assert.equal(f.motion.animations.size,0);
}));
test('cancelled cover decoding cannot replay a discarded navigation',async()=>withMotionPreference(async()=>{
 const f=navigationFixture();let ready;const decoded=new Promise(done=>ready=done);f.player.querySelector=()=>({complete:true,naturalWidth:300,decode:()=>decoded});
 const before=f.motion.capture('photo','now');f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',before);const animation=f.player.animations[0];f.motion.cancel();ready();await Promise.resolve();assert.equal(animation.played,0);assert.equal(animation.cancelled,1);assert.equal(f.motion.waits.size,0);
}));

test('timer72→112 FLIPs every retained overview sibling40px without animating layout properties',()=>withMotionPreference(()=>{
 const f=resourceFixture(),timer=f.tile(100),weather=f.tile(188),robot=f.tile(188),light=f.tile(380),vehicle=f.tile(380),music=f.tile(492),radio=f.tile(492);
 timer.id='timer-card';timer.offsetHeight=72;timer.getBoundingClientRect=function(){return {x:0,y:this.y+this.visualOffset,width:842,height:this.offsetHeight};};
 let selector;f.host.querySelectorAll=value=>{selector=value;return f.nodes;};
 const before=f.motion.resources();assert.match(selector,/#now-view>\[data-overview-rank\]/);
 timer.offsetHeight=112;for(const node of f.nodes.slice(1))node.y+=40;f.motion.settleResources(before);
 assert.equal(timer.animations[0].options.duration,240);assert.match(timer.animations[0].frames[0].transform,/scale\(1,0\.642857/);
 for(const node of [weather,robot,light,vehicle,music,radio]){assert.equal(node.animations[0].options.duration,240);assert.equal(node.animations[0].frames[0].transform,'translate(0px,-40px)');}
 for(const node of f.nodes)for(const frame of node.animations[0].frames)assert(Object.keys(frame).every(key=>['transform','transformOrigin','opacity'].includes(key)));
 const same=f.motion.resources();f.motion.settleResources(same);for(const node of f.nodes)assert.equal(node.animations.length,1,'unchanged ticks/finished state must not replay');
 // Reverse while the first transition is still running, with one owner each.
 const back=f.motion.resources();timer.offsetHeight=72;for(const node of f.nodes.slice(1))node.y-=40;f.motion.settleResources(back);
 for(const node of f.nodes){assert.equal(node.animations[0].cancelled,1);assert.equal(node.animations.length,2);assert.equal(f.motion.animations.get(node),node.animations[1]);}
 assert.equal(weather.animations[1].frames[0].transform,'translate(0px,40px)');
 f.host.dataset.motion='reduced';f.motion.settleResources(f.motion.resources());assert.equal(f.motion.animations.size,0);
}));
test('touch geometry hold retains measured height and releases with FLIP; alarm bypasses immediately',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180),values=new Map();let natural=72;tile.id='timer-card';tile.style={getPropertyValue:k=>values.get(k)?.[0]||'',getPropertyPriority:k=>values.get(k)?.[1]||'',setProperty:(k,v,p)=>values.set(k,[v,p]),removeProperty:k=>values.delete(k)};
 Object.defineProperty(tile,'offsetHeight',{get(){return Number.parseFloat(values.get('height')?.[0])||natural;}});tile.getBoundingClientRect=()=>({x:0,y:180,width:200,height:tile.offsetHeight});f.host.state={timer:null};
 f.motion.holdGeometry();natural=112;assert.equal(tile.offsetHeight,72);assert.equal(f.motion.geometry.size,1);f.motion.holdGeometry();assert.equal(tile.offsetHeight,72);f.motion.releaseGeometry();assert.equal(tile.offsetHeight,112);assert.equal(values.size,0);assert.equal(f.motion.geometry.size,0);assert.equal(tile.animations.length,1);assert.equal(tile.animations[0].options.duration,240);
 f.motion.holdGeometry();f.host.state.timer={status:'done'};f.motion.resources();assert.equal(f.motion.geometry.size,0);assert.equal(values.size,0);f.motion.cancel();
}));

test('all detail and return section animations finish inside their single navigation budget',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.photo.hidden=true;f.overview.hidden=false;
 const before=f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',before);
 for(const node of [f.heading,...f.cards])for(const a of node.animations)assert(a.options.duration+a.options.delay<=280);
 f.overview.children=[f.cards[0],...f.cards.slice(1,5)];const returning=f.motion.capture('weather','now');f.detail.hidden=true;f.overview.hidden=false;f.motion.enter('weather','now',returning,true);
 for(const node of f.cards.slice(0,5))for(const a of node.animations)assert(a.options.duration+a.options.delay<=240);
 f.motion.cancel();
}));
test('resource wrapper is the sole return FLIP owner and interrupt capture excludes outgoing overlay',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.photo.hidden=true;f.overview.hidden=false;const card=f.cards[0],shell=f.cards[1];card.overviewShell=shell;assert.equal(f.motion.card('weather'),shell);
 const before=f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',before);assert.equal(f.overview.hidden,false,'outgoing overlay retained only for fade');
 const interrupted=f.motion.capture('weather','now');assert.equal(interrupted.outgoing,f.detail,'capture current content, not the previous overlay');assert.equal(f.overview.hidden,true);f.motion.cancel();
}));

test('Ro decode wait plus player and bounded card stagger reserve rendering budget below360ms',()=>withMotionPreference(()=>{
 const savedSet=globalThis.setTimeout,savedClear=globalThis.clearTimeout,delays=[];globalThis.setTimeout=(fn,delay)=>{delays.push(delay);return 1;};globalThis.clearTimeout=()=>{};
 try{const f=navigationFixture();f.player.querySelector=()=>({complete:true,naturalWidth:300,decode:()=>new Promise(()=>{})});const before=f.motion.capture('photo','now');f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',before);assert.deepEqual(delays,[80]);assert.equal(f.player.animations[0].options.duration+delays[0],320);assert.equal(Math.max(...f.cards.flatMap(n=>n.animations.map(a=>a.options.duration+a.options.delay))),310);f.motion.cancel();assert.equal(f.motion.waits.size,0);}finally{globalThis.setTimeout=savedSet;globalThis.clearTimeout=savedClear;}
}));

test('navigation skips discarded resource-grid measurements; stable-view reconciliation remains active',()=>{
 let reads=0;const host={dataset:{},state:{focus:'weather'},lastRenderedFocus:'now',querySelectorAll(){reads++;return[];}};const motion=new SceneMotion(host);assert.equal(motion.resources().size,0);assert.equal(reads,0);host.lastRenderedFocus='weather';motion.resources();assert.equal(reads,1);motion.cancel();
});
