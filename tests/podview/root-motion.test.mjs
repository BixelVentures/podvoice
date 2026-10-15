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
  const node={y,log,animations:[],getClientRects:()=>[{}],getBoundingClientRect(){this.log.push('read');return {x:0,y:this.y,width:200,height:80};},animate(frames,options){const animation={frames,options,cancelled:0,finished:new Promise(()=>{}),cancel(){this.cancelled++;node.log.push('cancel');}};this.animations.push(animation);return animation;}};
  nodes.push(node);return node;
 }
 return {host,motion,nodes,tile};
}
function withMotionPreference(run,{reduced=false}={}){const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:reduced});try{return run();}finally{globalThis.matchMedia=previous;}}

test('resource capture measures the visible box before cancelling its owned animation',()=>withMotionPreference(()=>{
 const f=resourceFixture(),log=[],tile=f.tile(180,log);
 f.motion.animate(tile,[{transform:'translateY(-20px)'},{transform:'none'}],240);
 log.length=0;tile.y=160;
 const before=f.motion.resources();
 assert.deepEqual(log,['read','cancel']);
 assert.equal(before.get(tile).y,160);
 assert.equal(f.motion.animations.has(tile),false);
}));

test('unchanged resource geometry does not restart a cancelled animation',()=>withMotionPreference(()=>{
 const f=resourceFixture(),tile=f.tile(180);
 f.motion.animate(tile,[{opacity:.5},{opacity:1}],160);
 const before=f.motion.resources();
 f.motion.settleResources(before);
 assert.equal(tile.animations[0].cancelled,1);
 assert.equal(tile.animations.length,1);
 assert.equal(f.motion.animations.size,0);
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
