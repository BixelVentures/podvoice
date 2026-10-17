import test from 'node:test';
import assert from 'node:assert/strict';
import {attachGestures} from '../../podvoice/gatekeeper/static/podview/ui/gestures.js';
class Events {
 constructor(){this.listeners=new Map();}
 addEventListener(type,fn){this.listeners.set(type,fn);}
 removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}
 fire(type,event={}){this.listeners.get(type)?.(event);}
}
function fixture(){
 const window=new Events(),surface=new Events(),moves=[],previews=[];
 surface.ownerDocument={defaultView:window};surface.clientWidth=1024;
 surface.getBoundingClientRect=()=>({left:0,bottom:600});
 const detach=attachGestures(surface,{navigate:i=>moves.push(i),preview:p=>previews.push(p)});
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
