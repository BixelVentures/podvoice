import test from 'node:test';import assert from 'node:assert/strict';import {SceneMotion} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
const box={x:20,y:80,width:300,height:500};
function fixture(){let cancelled=0;const calls=[];const content={hidden:false,id:'now-view',getClientRects:()=>[box],animate:(frames)=>{calls.push(frames);return {cancel(){cancelled++;},finished:new Promise(()=>{})};}};const player={...content,getBoundingClientRect:()=>box};const feed={scrollTop:80,children:[content]};const host={dataset:{motion:'system'},querySelector:s=>s==='.responses'?feed:player};return {motion:new SceneMotion(host),feed,player,content,calls,get cancelled(){return cancelled;}};}
test('rapid navigation cancels previous motion and stable player never moves',()=>{const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});try{const f=fixture();const first=f.motion.capture('now');f.motion.enter('now','music',first);assert.equal(f.calls.length,1);const second=f.motion.capture('music');assert.equal(f.cancelled,1);f.motion.enter('music','now',second,true);assert.equal(f.feed.scrollTop,80);f.motion.cancel();assert.equal(f.cancelled,2);assert.equal(f.motion.animations.size,0);}finally{globalThis.matchMedia=previous;}});
test('reduced motion retains navigation and scroll without optional animations',()=>{const f=fixture();f.motion.host.dataset.motion='reduced';f.motion.capture('now');f.motion.enter('now','music',box);assert.equal(f.feed.scrollTop,0);f.motion.enter('music','now',box,true);assert.equal(f.feed.scrollTop,80);assert.equal(f.calls.length,0);});

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
