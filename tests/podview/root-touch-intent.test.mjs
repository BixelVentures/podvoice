import test from 'node:test';
import assert from 'node:assert/strict';
import {attachTouchIntent} from '../../podvoice/gatekeeper/static/podview/ui/touch-intent.js';

class Target {
 constructor(){this.listeners=new Map();}
 addEventListener(type,fn,capture){assert.equal(capture,true);this.listeners.set(type,fn);}
 removeEventListener(type,fn,capture){assert.equal(capture,true);if(this.listeners.get(type)===fn)this.listeners.delete(type);}
 fire(type,event={}){this.listeners.get(type)?.(event);}
}
function fixture(){
 const surface=new Target(),events=new Target(),document=new Target(),jobs=new Map();
 let serial=0,at=0,hit;
 events.setTimeout=fn=>{jobs.set(++serial,fn);return serial;};events.clearTimeout=id=>jobs.delete(id);
 surface.ownerDocument=document;document.defaultView=events;document.elementFromPoint=()=>hit;
 const button={isConnected:true,disabled:false,attrs:new Map(),matches:s=>s.includes('button'),closest:()=>null,contains:node=>node===button,getBoundingClientRect:()=>({left:10,right:110,top:10,bottom:70}),setAttribute:(k,v)=>button.attrs.set(k,v),removeAttribute:k=>button.attrs.delete(k)};
 const range={matches:()=>false};hit=button;
 const dispose=attachTouchIntent(surface,{now:()=>at});
 const pointer=(extra={})=>({isPrimary:true,pointerId:4,pointerType:'touch',button:0,clientX:40,clientY:35,target:button,composedPath:()=>[button,surface],...extra});
 const tapDown=extra=>surface.fire('pointerdown',pointer(extra));
 const tapUp=extra=>events.fire('pointerup',pointer(extra));
 const click=(extra={})=>{const e=pointer({detail:1,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});surface.fire('click',e);return e;};
 return {surface,events,document,button,range,jobs,dispose,pointer,tapDown,tapUp,click,setHit:target=>{hit=target;},advance:ms=>{at+=ms;}};
}

test('valid touch release keeps native click; there is no activation on pointerdown',()=>{
 const f=fixture();f.tapDown();assert.equal(f.jobs.size,0);f.tapUp();assert.equal(f.click().defaultPrevented,undefined);assert.equal(f.jobs.size,0);f.dispose();
});

test('leaving a control cancels activation and feedback even after returning inside',()=>{
 const f=fixture();f.tapDown();f.events.fire('pointermove',f.pointer({clientX:120}));assert.equal(f.button.attrs.get('data-touch-cancelled'),'true');
 f.events.fire('pointermove',f.pointer());f.tapUp();const click=f.click();assert.equal(click.defaultPrevented,true);assert.equal(click.stopped,true);assert.equal(f.button.attrs.size,0);f.dispose();
});

test('release outside without a preceding move is cancelled, including pen',()=>{
 const f=fixture();f.tapDown({pointerType:'pen'});f.tapUp({pointerType:'pen',clientX:120});assert.equal(f.click({pointerType:'pen'}).defaultPrevented,true);f.dispose();
});

test('pointer cancel, lost capture, ancestor scroll and window blur cancel only the active press',()=>{
 for(const reason of ['pointercancel','lostpointercapture','scroll','blur']){
  const f=fixture();f.tapDown();
  if(reason==='scroll')f.document.fire(reason,{target:{contains:node=>node===f.button}});
  else f.events.fire(reason,f.pointer());
  f.tapUp();assert.equal(f.click().defaultPrevented,true,reason);f.dispose();
 }
});

test('keyboard, accessibility, programmatic activation, mouse and next touch survive a cancelled touch',()=>{
 const f=fixture();f.tapDown();f.tapUp({clientX:120});
 assert.equal(f.click({detail:0,pointerType:''}).defaultPrevented,undefined);
 assert.equal(f.click({pointerType:'mouse'}).defaultPrevented,undefined);
 f.tapDown({pointerId:5});f.tapUp({pointerId:5});assert.equal(f.click({pointerId:5}).defaultPrevented,undefined);f.dispose();
});

test('range gestures are untouched and another pointer cannot cancel the wrong press',()=>{
 const f=fixture();f.tapDown({target:f.range,composedPath:()=>[f.range,f.surface]});f.tapUp({clientX:120});assert.equal(f.click({target:f.range}).defaultPrevented,undefined);
 f.tapDown();f.events.fire('pointercancel',f.pointer({pointerId:999}));f.tapUp();assert.equal(f.click().defaultPrevented,undefined);f.dispose();
});

test('shadow button is found through composed path and covered/hidden controls cannot activate',()=>{
 const f=fixture();const host={shadowRoot:{elementFromPoint:()=>f.button}};f.setHit(host);f.tapDown({target:host});f.tapUp();assert.equal(f.click({target:host}).defaultPrevented,undefined);
 f.tapDown();f.setHit({});f.tapUp();assert.equal(f.click().defaultPrevented,true);
 f.setHit(f.button);f.tapDown();f.button.closest=()=>({});f.tapUp();assert.equal(f.click().defaultPrevented,true);f.dispose();
});

test('legacy touch click is narrowly tied to cancelled control; stale correlation expires',()=>{
 const f=fixture();f.tapDown();f.tapUp({clientX:120});assert.equal(f.click({pointerType:'',pointerId:undefined}).defaultPrevented,true);
 f.tapDown();f.tapUp({clientX:120});f.advance(1001);assert.equal(f.click({pointerType:'',pointerId:undefined}).defaultPrevented,undefined);f.dispose();
});

test('cleanup removes listeners, owned timeout and cancellation feedback',()=>{
 const f=fixture();f.tapDown();f.events.fire('pointermove',f.pointer({clientX:120}));f.dispose();assert.equal(f.button.attrs.size,0);assert.equal(f.surface.listeners.size,0);assert.equal(f.events.listeners.size,0);assert.equal(f.document.listeners.size,0);assert.equal(f.jobs.size,0);
 const g=fixture();g.tapDown();g.tapUp();assert.equal(g.jobs.size,1);g.dispose();assert.equal(g.jobs.size,0);
});
