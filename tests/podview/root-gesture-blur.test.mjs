import test from 'node:test';
import assert from 'node:assert/strict';
import {attachGestures} from '../../podvoice/gatekeeper/static/podview/ui/gestures.js';
class Events {
 constructor(){this.listeners=new Map();}
 addEventListener(type,fn){this.listeners.set(type,fn);}
 removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}
 fire(type,event={}){this.listeners.get(type)?.(event);}
}
function fixture(options={}){
 const window=new Events(),surface=new Events(),moves=[],previews=[];
 surface.ownerDocument={defaultView:window};surface.clientWidth=1024;
 surface.getBoundingClientRect=()=>({left:0,bottom:600});
 const detach=attachGestures(surface,{navigate:i=>moves.push(i),preview:p=>previews.push(p),...options});
 const target={closest:()=>null};
 const point=x=>({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:200,target});
 return {window,surface,moves,previews,detach,point};
}
test('losing window focus cancels edge feedback and prevents delayed pointerup navigation',()=>{
 const f=fixture();f.surface.fire('pointerdown',f.point(4));f.surface.fire('pointermove',f.point(160));
 assert.ok(f.previews.at(-1)>0,'precondition: edge feedback was active');
 f.window.fire('blur');
 const previewAfterBlur=f.previews.at(-1);
 f.surface.fire('pointerup',f.point(180));assert.deepEqual(f.moves,[],'old gesture must not navigate after focus loss');assert.equal(previewAfterBlur,0,'blur must release the active edge preview');f.detach();
});
test('uninterrupted edge gesture still navigates once and disconnect removes blur listener',()=>{
 const f=fixture();f.surface.fire('pointerdown',f.point(4));f.surface.fire('pointermove',f.point(160));f.surface.fire('pointerup',f.point(180));
 assert.deepEqual(f.moves,['back']);f.detach();assert.equal(f.window.listeners.size,0);assert.equal(f.surface.listeners.size,0);
});
test('wheel momentum cannot join across focus loss within the burst window',()=>{
 const f=fixture(),target={closest:()=>null};
 const wheel=dx=>({target,deltaX:dx,deltaY:0,deltaMode:0,ctrlKey:false,preventDefault(){}});
 f.surface.fire('wheel',wheel(-70));assert.deepEqual(f.moves,[],'pre-blur burst must be below threshold');
 f.window.fire('blur');f.surface.fire('wheel',wheel(-50));
 assert.deepEqual(f.moves,[],'post-blur wheel must begin a new burst');
 f.surface.fire('wheel',wheel(-70));assert.deepEqual(f.moves,['back'],'new uninterrupted burst remains functional');
 f.surface.fire('wheel',wheel(-150));assert.deepEqual(f.moves,['back'],'remaining momentum cannot repeat navigation');f.detach();
});

test('inactive surface ignores touch and becoming inactive cancels an in-flight swipe',()=>{
 let active=false;const f=fixture({active:()=>active});
 f.surface.fire('pointerdown',f.point(4));f.surface.fire('pointermove',f.point(160));f.surface.fire('pointerup',f.point(180));
 assert.deepEqual(f.moves,[]);
 active=true;f.surface.fire('pointerdown',f.point(4));f.surface.fire('pointermove',f.point(160));
 active=false;f.surface.fire('pointerup',f.point(180));assert.deepEqual(f.moves,[]);assert.equal(f.previews.at(-1),0);
 active=true;f.surface.fire('pointerdown',f.point(4));active=false;f.surface.fire('pointermove',f.point(160));active=true;f.surface.fire('pointerup',f.point(180));assert.deepEqual(f.moves,[]);f.detach();
});
test('bottom-edge vertical intent survives axis lock but ordinary vertical scrolling stays inert',()=>{
 const f=fixture(),point=(y)=>({...f.point(300),clientY:y});
 f.surface.fire('pointerdown',point(590));f.surface.fire('pointermove',point(540));f.surface.fire('pointerup',point(430));
 assert.deepEqual(f.moves,['controls']);
 f.surface.fire('pointerdown',point(400));f.surface.fire('pointermove',point(340));f.surface.fire('pointerup',point(250));
 assert.deepEqual(f.moves,['controls']);f.detach();
});
test('a voice-driven view change cancels a touch stroke from the previous view',()=>{
 let context='now';const f=fixture({context:()=>context});
 f.surface.fire('pointerdown',f.point(4));f.surface.fire('pointermove',f.point(160));
 context='weather';f.surface.fire('pointerup',f.point(180));
 assert.deepEqual(f.moves,[],'release must not navigate the newly opened view');assert.equal(f.previews.at(-1),0);
 f.surface.fire('pointerdown',f.point(4));f.surface.fire('pointermove',f.point(160));f.surface.fire('pointerup',f.point(180));
 assert.deepEqual(f.moves,['back'],'a new deliberate stroke uses the new view');f.detach();
});
test('detail downward touch at top survives native pointer cancellation without stealing scroll or sliders',()=>{
 const f=fixture({detail:()=>true}),parent={scrollTop:0,parentElement:f.surface},target={closest:()=>null,parentElement:parent};
 const touch=(x,y)=>({identifier:7,clientX:x,clientY:y});
 const begin=()=>f.surface.fire('touchstart',{target,touches:[touch(200,100)]});
 const end=(x=205,y=220)=>f.surface.fire('touchend',{changedTouches:[touch(x,y)]});
 begin();f.surface.fire('pointercancel');end();assert.deepEqual(f.moves,['back']);
 parent.scrollTop=30;begin();parent.scrollTop=0;end();assert.equal(f.moves.length,1,'cannot start from a scrolled detail');
 begin();parent.scrollTop=10;f.surface.fire('touchmove',{touches:[touch(200,160)]});parent.scrollTop=0;end();assert.equal(f.moves.length,1,'cannot scroll and then convert into back');
 begin();end(330,120);assert.equal(f.moves.length,1,'horizontal swipe belongs to child');
 target.closest=()=>({});begin();end();assert.equal(f.moves.length,1,'range and controls retain touch');f.detach();
});
