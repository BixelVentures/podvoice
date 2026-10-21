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
 assert.equal(added.animations[0].options.duration,120);
 assert.deepEqual(added.animations[0].frames,[{opacity:.45},{opacity:1}]);
}));

test('an overview grid move has one outer owner, so nested previews retain the exact card displacement',()=>withMotionPreference(()=>{
 const f=resourceFixture(),card=f.tile(180),preview=f.tile(180),panel=f.tile(100),timer=f.tile(100);
 card.id='robot-card';timer.id='timer-card';card.contains=node=>node===preview;timer.contains=node=>node===panel;
 const before=f.motion.resources();assert.deepEqual([...before.keys()],[card,timer]);
 // The active timer adds one row: the robot and its preview both lay out120px lower.
 card.y+=120;preview.y+=120;timer.offsetHeight=112;panel.offsetHeight=112;
 f.motion.settleResources(before);
 assert.deepEqual(card.animations[0].frames,[{transform:'translate(0px,-120px)'},{transform:'none'}]);
 assert.equal(preview.animations.length,0,'the child inherits exactly one120px translation rather than240px');
 assert.equal(panel.animations.length,0,'the timer panel has no competing entrance beneath the timer owner');
 f.motion.settleResources(f.motion.resources());assert.equal(card.animations.length,1,'an unchanged tick cannot restart the grid move');f.motion.cancel();
}));

test('a resource hidden by a state change immediately loses its old transform owner',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180);let visible=true;tile.getClientRects=()=>visible?[{}]:[];
 f.motion.animate(tile,[{transform:'translateY(120px)'},{transform:'none'}]);const before=f.motion.resources();visible=false;f.motion.settleResources(before);
 assert.equal(tile.animations[0].cancelled,1);assert.equal(f.motion.animations.has(tile),false);visible=true;f.motion.settleResources(f.motion.resources());assert.equal(tile.animations.length,1);f.motion.cancel();
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
function navigationFixture(){
 const node=(id,rect)=>({id,hidden:false,inert:false,dataset:{},style:{},children:[],animations:[],getClientRects(){return this.hidden?[]:[rect];},getBoundingClientRect:()=>rect,querySelector(){return null;},animate(frames,options){let resolve;const animation={frames,options,cancelled:0,cancel(){this.cancelled++;},finished:new Promise(done=>resolve=done),finish:()=>resolve()};this.animations.push(animation);return animation;}});
 const photo=node('photo-view',{x:0,y:0,width:1280,height:800}),overview=node('now-view',{x:28,y:80,width:824,height:650}),detail=node('weather-view',{x:28,y:80,width:824,height:650}),heading=node('heading',{x:28,y:80,width:824,height:70}),cards=Array.from({length:8},(_,i)=>node('card-'+i,{x:28+(i%2)*420,y:150+Math.floor(i/2)*180,width:400,height:176})),player=node('player',{x:876,y:112,width:376,height:650});
 detail.children=[heading,...cards.slice(6)];detail.querySelector=()=>heading;overview.hidden=true;detail.hidden=true;
 const surfaces=[],document={createElement(){throw Error('navigation must not create a proxy or clone');}};
 const feed={scrollTop:53,children:[photo,overview,detail]},host={ownerDocument:document,append(){throw Error('navigation must not append an extra layer');},isConnected:true,dataset:{motion:'system'},querySelector:s=>s==='.responses'?feed:s==='#photo-view'?photo:s.startsWith('.player')?player:null,querySelectorAll:()=>cards};
 return {motion:new SceneMotion(host),host,feed,photo,overview,detail,heading,cards,player,surfaces};
}
test('the same player moves by its actual geometry both ways between Ro and active, never during detail navigation',()=>withMotionPreference(()=>{
 const f=navigationFixture();let y=300;f.player.getBoundingClientRect=()=>({x:876,y,width:376,height:650});
 const wake=f.motion.capture('photo','now');y=80;f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',wake);assert.equal(f.player.animations.length,1);assert.equal(f.player.animations[0].frames[0].transform,'translate(0px,220px)');assert.equal(f.player.animations[0].options.duration,200);assert.equal(f.motion.animations.size,2);f.motion.cancel();
 const old=f.motion.capture('now','photo');y=300;f.overview.hidden=true;f.photo.hidden=false;f.motion.enter('now','photo',old,true);assert.equal(f.player.animations.length,2);assert.equal(f.player.animations[1].frames[0].transform,'translate(0px,-220px)');assert.equal(f.player.animations[1].options.duration,200);assert(f.photo.animations[0].frames.every(frame=>Object.keys(frame).length===1));f.motion.cancel();
 f.photo.hidden=true;f.overview.hidden=false;const before=f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',before);assert.equal(f.player.animations.length,2);assert.equal(f.motion.animations.has(f.player),false);f.motion.cancel();
}));

test('Ro to overview gently fades one pane in place without child stagger or an artwork wait',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.player.querySelector=()=>{throw Error('navigation must not gate on cover decoding');};
 const before=f.motion.capture('photo','now');f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',before);
 assert.equal(f.motion.animations.size,1);assert.equal(f.overview.hidden,false);assert.equal(f.overview.animations.length,1);assert.equal(f.overview.animations[0].options.duration,200);assert.equal(f.overview.animations[0].options.delay,0);assert.deepEqual(f.overview.animations[0].frames,[{opacity:.65},{opacity:1}]);assert.equal(f.photo.hidden,true);assert.equal(f.photo.animations.length,0);assert(f.cards.every(card=>card.animations.length===0));assert.equal(f.player.animations.length,0);f.motion.cancel();
}));

test('opening and returning move only the actual incoming pane at normal scale and full opacity',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.photo.hidden=true;f.overview.hidden=false;
 const open=f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',open);
 assert.equal(f.motion.animations.size,1);assert.equal(f.heading.animations.length,0);assert.equal(f.overview.hidden,true);assert.equal(f.player.animations.length,0);
 const animation=f.detail.animations[0];assert.equal(animation.options.duration,200);assert.equal(animation.options.delay,0);assert.equal(animation.options.easing,'cubic-bezier(.2,0,0,1)');assert.deepEqual(animation.frames,[{opacity:1,transform:'translateX(16px)'},{opacity:1,transform:'none'}]);
 const back=f.motion.capture('weather','now');f.detail.hidden=true;f.overview.hidden=false;f.motion.enter('weather','now',back,true);
 assert.equal(f.feed.scrollTop,53);assert.equal(animation.cancelled,1);assert.equal(f.motion.animations.size,1);assert.deepEqual(f.overview.animations[0].frames,[{opacity:1,transform:'translateX(-16px)'},{opacity:1,transform:'none'}]);assert(f.cards.every(card=>card.animations.length===0));assert.equal(f.player.animations.length,0);f.motion.cancel();
}));

test('same-view requests keep scroll and do not animate, and older WebView without WAAPI still navigates',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.motion.enter('now','now',null);assert.equal(f.feed.scrollTop,53);assert.equal(f.motion.animations.size,0);
 f.photo.hidden=true;f.overview.hidden=false;f.overview.animate=undefined;for(const card of f.cards)card.animate=undefined;f.host.ownerDocument=undefined;f.motion.enter('weather','now',null,true);assert.equal(f.feed.scrollTop,0);assert.equal(f.motion.animations.size,0);
}));
test('reduced navigation uses120ms opacity only and keeps persistent playback untouched',()=>{
 const f=navigationFixture();f.host.dataset.motion='reduced';f.photo.hidden=true;f.overview.hidden=false;
 const old=f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',old);
 assert.equal(f.motion.animations.size,1);assert.equal(f.detail.animations[0].options.duration,120);assert.equal(f.detail.animations[0].options.delay,0);assert(f.detail.animations[0].frames.every(frame=>Object.keys(frame).length===1&&typeof frame.opacity==='number'));assert.equal(f.player.animations.length,0);f.motion.cancel();
});

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

test('all detail content arrives in the pane without independent child animations or geometry reads',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.photo.hidden=true;f.overview.hidden=false;
 for(const node of [f.heading,...f.cards,f.detail,f.overview,f.player])node.getBoundingClientRect=()=>{throw Error('ordinary navigation needs no FLIP measurement');};
 const old=f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',old);
 assert.equal(f.motion.animations.size,1);assert(f.detail.children.every(node=>node.animations.length===0));assert.equal(f.detail.animations[0].options.duration,200);f.motion.cancel();
}));

test('interruption cancels the previous pane without reviving outgoing content or adding layers',()=>withMotionPreference(()=>{
 const f=navigationFixture();f.photo.hidden=true;f.overview.hidden=false;f.motion.capture('now','weather');f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now','weather',null);const first=f.detail.animations[0];
 f.motion.capture('weather','now');assert.equal(first.cancelled,1);assert.equal(f.motion.animations.size,0);assert.equal(f.overview.hidden,true);f.detail.hidden=true;f.overview.hidden=false;f.motion.enter('weather','now',null,true);assert.equal(f.motion.animations.size,1);assert.equal(f.detail.hidden,true);f.motion.cancel();
}));

test('pane entry has no decode timer or delayed reveal work that can replay after cancellation',()=>withMotionPreference(()=>{
 const savedSet=globalThis.setTimeout,savedClear=globalThis.clearTimeout,delays=[];globalThis.setTimeout=(fn,delay)=>{delays.push(delay);return 1;};globalThis.clearTimeout=()=>{};
 try{const f=navigationFixture();f.player.querySelector=()=>{throw Error('no cover gate');};const before=f.motion.capture('photo','now');f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',before);assert.deepEqual(delays,[]);assert.equal(f.motion.animations.size,1);assert.equal(f.overview.animations.length,1);const animation=f.overview.animations[0];f.motion.cancel();assert.equal(animation.cancelled,1);assert.equal(f.motion.animations.size,0);}finally{globalThis.setTimeout=savedSet;globalThis.clearTimeout=savedClear;}
}));

test('navigation skips discarded resource-grid measurements; stable-view reconciliation remains active',()=>{
 let reads=0;const host={dataset:{},state:{focus:'weather'},lastRenderedFocus:'now',querySelectorAll(){reads++;return[];}};const motion=new SceneMotion(host);assert.equal(motion.resources().size,0);assert.equal(reads,0);host.lastRenderedFocus='weather';motion.resources();assert.equal(reads,1);motion.cancel();
});

test('overflowing overview wakes without spatial motion, a hint or child choreography',()=>withMotionPreference(()=>{
 const f=navigationFixture();Object.assign(f.feed,{clientHeight:650,scrollHeight:850});const before=f.motion.capture('photo','now');f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',before);
 assert.equal(f.motion.animations.size,1);assert.equal(f.overview.animations.length,1);assert(f.overview.animations[0].frames.every(frame=>Object.keys(frame).length===1));assert.equal(f.feed.scrollTop,0);assert(f.cards.every(card=>card.animations.length===0));f.motion.cancel();
}));

test('five pointer taps40ms apart cannot activate incoming content; keyboard and expiry remain available',()=>{
 const savedSet=globalThis.setTimeout,savedClear=globalThis.clearTimeout;let expire,delay,cleared=0;
 globalThis.setTimeout=(fn,ms)=>{expire=fn;delay=ms;return 1;};globalThis.clearTimeout=()=>cleared++;
 try{const f=navigationFixture(),listeners=new Map(),node={addEventListener(type,fn,capture){assert.equal(capture,true);listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
 f.motion.guardNavigation(node,280);assert.equal(delay,280);let blocked=0,stopped=0;
 for(let time=0;time<200;time+=40)listeners.get('click')({detail:1,preventDefault(){blocked++;},stopImmediatePropagation(){stopped++;}});
 listeners.get('click')({detail:0,preventDefault(){throw Error('keyboard blocked');}});assert.equal(blocked,5);assert.equal(stopped,5);listeners.get('pointerdown')({type:'pointerdown',detail:0,preventDefault(){blocked++;},stopImmediatePropagation(){stopped++;}});assert.equal(blocked,6);assert.equal(stopped,6);
 expire();assert.equal(listeners.size,0);assert.equal(f.motion.releaseNavigationGuard,null);
 f.motion.guardNavigation(node,120);assert.equal(delay,120);f.motion.cancel();assert.equal(listeners.size,0);assert.ok(cleared>=2);
 }finally{globalThis.setTimeout=savedSet;globalThis.clearTimeout=savedClear;}
});

test('Ro minute update retains digit nodes and animates only changed figures, with no identical-update restart',()=>{
 const f=fixture(),calls=[];f.motion.animate=(node,frames,duration,options)=>calls.push({node,frames,duration,options});const clock={ownerDocument:{createElement:()=>({textContent:''})},replaceChildren(...children){this.children=children;}};
 f.motion.updateClock(clock,'18.09');const digits=[...clock.children];assert.equal(calls.length,0);f.motion.updateClock(clock,'18.09');assert.equal(calls.length,0);f.motion.updateClock(clock,'18.10');assert.equal(calls.length,2);assert.equal(calls[0].node,digits[3]);assert.equal(calls[1].node,digits[4]);assert.deepEqual(clock.children,digits);assert.equal(clock.children.map(n=>n.textContent).join(''),'18.10');assert(calls.every(c=>c.options.fadeReduced&&c.frames.every(frame=>Object.keys(frame).length===1)));f.motion.updateClock(clock,'18.10');assert.equal(calls.length,2);
});
test('interrupted toast exit cannot hide a replacement message and reduced feedback uses120ms opacity',async()=>{
 const f=fixture();f.motion.host.dataset.motion='reduced';const animations=[],node={hidden:false,getClientRects:()=>[box],animate(frames,options){let resolve,reject;const a={frames,options,finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),cancel(){reject(new Error('cancel'));},finish(){resolve();}};animations.push(a);return a;}};
 f.motion.feedback(node,false);f.motion.feedback(node,true);animations[0].finish();await Promise.resolve();assert.equal(node.hidden,false);assert.equal(animations[1].options.duration,120);f.motion.feedback(node,false);animations.at(-1).finish();await Promise.resolve();assert.equal(node.hidden,true);f.motion.cancel();
});

test('geometry hold snapshots every height once before any layout write and restores originals',()=>{
 const order=[],nodes=[0,1,2].map(index=>{const values=new Map([['min-height','12px']]);return {getClientRects:()=>[{}],get offsetHeight(){order.push('read'+index);return 72+index;},style:{getPropertyValue:key=>values.get(key)||'',getPropertyPriority:()=>'',setProperty(key,value){order.push('write'+index);values.set(key,value);},removeProperty:key=>values.delete(key)},values};});
 const motion=new SceneMotion({dataset:{},querySelectorAll:()=>nodes});motion.holdGeometry();assert.deepEqual(order.slice(0,3),['read0','read1','read2']);assert.equal(order.filter(x=>x.startsWith('read')).length,3);assert.equal(order.slice(3).every(x=>x.startsWith('write')),true);motion.holdGeometry();assert.equal(order.length,12);
 nodes.forEach(node=>{node.getBoundingClientRect=()=>({});});motion.releaseGeometry(false);for(const node of nodes){assert.equal(node.values.get('min-height'),'12px');assert.equal(node.values.has('height'),false);}motion.cancel();
});

test('all widgets preserve outer and nested scroll through the same complete-pane forward and back interaction',()=>withMotionPreference(()=>{
 for(const focus of ['weather','music','timers','radio','vehicle','robot','light','player']){
  const f=navigationFixture(),nested={scrollTop:77,scrollLeft:19};f.feed.querySelectorAll=()=>[nested];f.photo.hidden=true;f.overview.hidden=false;
  const old=f.motion.capture('now',focus);f.overview.hidden=true;f.detail.hidden=false;f.motion.enter('now',focus,old);assert.equal(f.detail.animations.length,1,focus);assert.equal(f.detail.animations[0].frames[0].opacity,1,focus);
  nested.scrollTop=0;nested.scrollLeft=0;const back=f.motion.capture(focus,'now');f.detail.hidden=true;f.overview.hidden=false;f.motion.enter(focus,'now',back,true);
  assert.equal(f.feed.scrollTop,53,focus);assert.equal(nested.scrollTop,77,focus);assert.equal(nested.scrollLeft,19,focus);assert.equal(f.motion.animations.size,1,focus);assert.equal(f.overview.animations[0].frames[0].transform,'translateX(-16px)',focus);assert.equal(f.heading.animations.length,0,focus);assert.equal(f.player.animations.length,0,focus);assert(f.cards.every(card=>card.animations.length===0),focus);f.motion.cancel();
 }
}));

test('resource settling reads all changed boxes before the first animation writes',()=>withMotionPreference(()=>{
 const f=resourceFixture(),order=[],nodes=[f.tile(0),f.tile(80),f.tile(160)];const before=f.motion.resources();
 for(const node of nodes){node.y+=40;const visible=node.getClientRects;node.getClientRects=function(){order.push('visibility');return visible.call(this);};const read=node.getBoundingClientRect;node.getBoundingClientRect=function(){order.push('read');return read.call(this);};const animate=node.animate;node.animate=function(...args){order.push('animate');return animate.apply(this,args);};}
 f.motion.settleResources(before);assert.deepEqual(order,['visibility','visibility','visibility','read','read','read','animate','animate','animate']);f.motion.cancel();
}));

test('reduced Ro crossings preserve both routes with120ms pane fades and no player movement',()=>{
 const f=navigationFixture();f.host.dataset.motion='reduced';let y=300;f.player.getBoundingClientRect=()=>({x:876,y,width:376,height:650});
 const wake=f.motion.capture('photo','now');y=80;f.photo.hidden=true;f.overview.hidden=false;f.motion.enter('photo','now',wake);assert.equal(f.player.animations.length,0);assert.equal(f.overview.animations[0].options.duration,120);assert(f.overview.animations[0].frames.every(frame=>Object.keys(frame).length===1));
 const rest=f.motion.capture('now','photo');y=300;f.overview.hidden=true;f.photo.hidden=false;f.motion.enter('now','photo',rest,true);assert.equal(f.player.animations.length,0);assert.equal(f.photo.animations[0].options.duration,120);assert(f.photo.animations[0].frames.every(frame=>Object.keys(frame).length===1));f.motion.cancel();assert.equal(f.motion.animations.size,0);
});

test('one notification enters, changes once, ignores repeated copy and retains content until its exit finishes',async()=>{
 const f=fixture(),animations=[],node={dataset:{source:'connection'},textContent:'Forbinder',hidden:true,getClientRects(){return this.hidden?[]:[box];},animate(frames,options){let finish;const a={frames,options,cancelled:0,finished:new Promise(done=>finish=done),cancel(){this.cancelled++;},finish(){finish();}};animations.push(a);return a;}};
 f.motion.feedback(node,true);assert.equal(node.hidden,false);assert.equal(animations.length,1);assert.equal(animations[0].options.duration,160);f.motion.feedback(node,true);assert.equal(animations.length,1,'unchanged queue observation never restarts feedback');
 node.textContent='Offline';f.motion.feedback(node,true);assert.equal(animations.length,2);assert.equal(animations[0].cancelled,1);assert.equal(animations[1].options.duration,120);assert(animations[1].frames.every(frame=>Object.keys(frame).length===1),'notice replacement settles quietly without moving');
 f.motion.feedback(node,false);assert.equal(node.hidden,false);assert.equal(node.textContent,'Offline');const exit=animations.at(-1);f.motion.feedback(node,false);assert.equal(animations.at(-1),exit);exit.finish();await Promise.resolve();assert.equal(node.hidden,true);f.motion.cancel();
});
test('a detached notification owner hides immediately without an exit animation',()=>{
 const f=fixture();f.motion.host.isConnected=false;const node={hidden:false,textContent:'Offline',getClientRects:()=>[box],animate(){throw Error('detached owner must not animate');}};f.motion.feedback(node,false);assert.equal(node.hidden,true);
});

test('finite player FLIP releases only its own transient paint marker on finish and retains the same moving node',async()=>{
 const f=navigationFixture();let y=300;f.player.getBoundingClientRect=()=>({x:876,y,width:390,height:96});const before=f.motion.capture('now','photo');y=650;f.overview.hidden=true;f.photo.hidden=false;f.motion.enter('now','photo',before,true);
 assert.equal(f.player.dataset.scenePlayerMoving,'true');assert.equal(f.motion.playerPaint.size,1);assert.equal(f.player.animations.length,1);assert.equal(f.player.animations[0].frames[0].transform,'translate(0px,-350px)');assert.deepEqual(f.player.style,{});
 f.player.animations[0].finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.player.dataset.scenePlayerMoving,undefined);assert.equal(f.motion.playerPaint.size,0);assert.equal(f.motion.animations.has(f.photo),true,'player paint finishes independently of the entering photo');assert.deepEqual(f.player.style,{});f.motion.cancel();
});
test('cancel, rapid reverse and reduced navigation leave no stale player paint marker',async()=>{
 const f=navigationFixture();let y=300;f.player.getBoundingClientRect=()=>({x:876,y,width:390,height:96});const first=f.motion.capture('now','photo');y=650;f.motion.enter('now','photo',first,true);const outgoing=f.player.animations[0];assert.equal(f.player.dataset.scenePlayerMoving,'true');
 const reverse=f.motion.capture('photo','now');assert.equal(outgoing.cancelled,1);assert.equal(f.player.dataset.scenePlayerMoving,undefined);y=90;f.motion.enter('photo','now',reverse);assert.equal(f.player.dataset.scenePlayerMoving,'true');const current=f.player.animations[1];outgoing.finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.player.dataset.scenePlayerMoving,'true','superseded completion cannot release the current paint owner');assert.equal(f.motion.animations.get(f.player),current);
 f.motion.cancel();assert.equal(f.player.dataset.scenePlayerMoving,undefined);assert.equal(f.motion.playerPaint.size,0);assert.equal(current.cancelled,1);f.host.dataset.motion='reduced';f.motion.enter('now','photo',{x:800,y:90,width:390,height:96},true);assert.equal(f.player.dataset.scenePlayerMoving,undefined);assert.equal(f.player.animations.length,2);f.motion.cancel();
});
test('disconnected or WAAPI-unavailable player never retains transient paint state',()=>{
 for(const unavailable of ['disconnected','no-waapi']){const f=navigationFixture();if(unavailable==='disconnected')f.host.isConnected=false;else f.player.animate=undefined;f.motion.enter('now','photo',{x:300,y:400,width:390,height:96},true);assert.equal(f.player.dataset.scenePlayerMoving,undefined);assert.equal(f.motion.playerPaint.size,0);f.motion.cancel();}
});
