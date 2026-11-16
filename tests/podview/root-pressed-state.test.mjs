import test from 'node:test';import assert from 'node:assert/strict';import {attachPressedState} from '../../podvoice/gatekeeper/static/podview/ui/pressed-state.js';
function fixture({documentRoot=false,raf=false}={}){
 const events=()=>({handlers:new Map(),addEventListener(n,f){this.handlers.set(n,f);},removeEventListener(n){this.handlers.delete(n);}}),win=events(),frames=[];if(raf)win.requestAnimationFrame=callback=>frames.push(callback);const frame=()=>{for(const callback of frames.splice(0))callback();};const doc=Object.assign(events(),{defaultView:win,nodeType:documentRoot?9:undefined}),surface=Object.assign(events(),{ownerDocument:doc});
 const node=(kind='button')=>{const classes=new Set(),attributes=new Map(),animations=[];return {kind,classes,attributes,animations,disabled:false,isConnected:true,matches:selector=>selector.startsWith('button,')?['button','summary','a','rolebutton'].includes(kind):['input','select','textarea','slider','editable'].includes(kind),getAttribute:n=>attributes.get(n)??null,setAttribute:(n,v)=>attributes.set(n,String(v)),removeAttribute:n=>attributes.delete(n),closest:()=>null,classList:{add:n=>classes.add(n),remove:n=>classes.delete(n)},animate(frames,options){let finish;const animation={frames,options,cancelled:0,finished:new Promise(done=>finish=done),cancel(){this.cancelled++;},finish(){finish();}};animations.push(animation);return animation;}};};
 const button=node(),cleanup=attachPressedState(surface),event=(patch={})=>({type:'pointerdown',pointerId:1,clientX:0,clientY:0,button:0,isPrimary:true,composedPath:()=>[{},button,surface],...patch}),root=documentRoot?doc:surface;return {win,doc,surface,root,button,classes:button.classes,cleanup,event,node,frame};
}
// P3 (docs/MOTION.md §3.4): CSS owns press motion. JS sets .is-pressed and never animates box-shadow or opacity.
test('press is immediate and pointerup clears it without any JS animation',()=>{
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());assert(f.classes.has('is-pressed'));assert.equal(f.button.getAttribute('data-pv-pointer-focus'),'true');f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));assert.equal(f.classes.size,0);assert.equal(f.button.animations.length,0);f.cleanup();
});
test('a tap released before its press was painted stays pressed for one painted frame, then springs back',()=>{
 const f=fixture({raf:true});f.root.handlers.get('pointerdown')(f.event());f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 assert(f.classes.has('is-pressed'),'held until painted');f.frame();assert(f.classes.has('is-pressed'));f.frame();assert.equal(f.classes.size,0);
 f.root.handlers.get('pointerdown')(f.event());f.frame();f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));assert.equal(f.classes.size,0,'a painted press releases at once');
 assert.equal(f.button.animations.length,0);f.cleanup();
});
test('a new press during the held frame keeps its own pressed state; cancel ends a press at once',()=>{
 const f=fixture({raf:true});f.root.handlers.get('pointerdown')(f.event());f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 f.root.handlers.get('pointerdown')(f.event());f.frame();f.frame();assert(f.classes.has('is-pressed'),'stale release cannot clear the new press');
 f.win.handlers.get('pointercancel')(f.event({type:'pointercancel'}));assert.equal(f.classes.size,0);f.cleanup();
});
test('scroll drag, pointer cancellation, lost capture, blur and cleanup cannot leave held or release feedback',()=>{
 for(const reason of ['move','pointercancel','lostpointercapture','blur','cleanup']){const f=fixture();f.root.handlers.get('pointerdown')(f.event());if(reason==='move')f.root.handlers.get('pointermove')(f.event({type:'pointermove',clientY:30}));else if(reason==='cleanup')f.cleanup();else f.win.handlers.get(reason)(f.event({type:reason}));assert.equal(f.classes.size,0,reason);assert.equal(f.button.animations.length,0,reason);f.cleanup();}
});
test('disabled, aria-disabled and inert controls never acknowledge, including a control disabled during its press',()=>{
 for(const denied of ['disabled','aria','inert']){const f=fixture();if(denied==='disabled')f.button.disabled=true;if(denied==='aria')f.button.setAttribute('aria-disabled','true');if(denied==='inert')f.button.closest=()=>({inert:true});f.root.handlers.get('pointerdown')(f.event());assert.equal(f.classes.size,0);f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));assert.equal(f.button.animations.length,0);f.cleanup();}
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());f.button.disabled=true;f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));assert.equal(f.classes.size,0);assert.equal(f.button.animations.length,0);f.cleanup();
});
test('secondary pointers cannot replace or cancel the primary press',()=>{
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());f.root.handlers.get('pointerdown')(f.event({pointerId:2,isPrimary:false}));f.win.handlers.get('pointercancel')(f.event({type:'pointercancel',pointerId:2}));assert(f.classes.has('is-pressed'));f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));assert.equal(f.classes.size,0);assert.equal(f.button.animations.length,0);f.cleanup();
});
test('keyboard press preserves native activation and restores visible focus after pointer input',()=>{
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));f.root.handlers.get('keydown')(f.event({type:'keydown',key:'Tab'}));assert.equal(f.button.getAttribute('data-pv-pointer-focus'),null);f.root.handlers.get('keydown')(f.event({type:'keydown',key:' ',repeat:false}));assert(f.classes.has('is-pressed'));f.win.handlers.get('keyup')(f.event({type:'keyup',key:' '}));assert.equal(f.classes.size,0);assert.equal(f.button.animations.length,0);f.root.handlers.get('keydown')(f.event({type:'keydown',key:'Enter',repeat:true}));assert.equal(f.classes.size,0);f.cleanup();assert.equal(f.root.handlers.size,0);assert.equal(f.win.handlers.size,0);
});
test('native fields and sliders inside an interactive card retain their gesture and text-selection ownership',()=>{
 for(const kind of ['input','select','textarea','slider','editable']){const f=fixture(),field=f.node(kind);f.root.handlers.get('pointerdown')(f.event({composedPath:()=>[field,f.button,f.surface]}));assert.equal(f.classes.size,0,kind);f.root.handlers.get('keydown')(f.event({key:' ',composedPath:()=>[field,f.button,f.surface]}));assert.equal(f.classes.size,0,kind);assert.equal(f.button.animations.length,0,kind);f.cleanup();}
});
test('native disclosure summaries and delegated body-sibling controls share the same press owner',()=>{
 const f=fixture({documentRoot:true}),summary=f.node('summary');assert.equal(f.surface.handlers.size,0);f.doc.handlers.get('pointerdown')(f.event({composedPath:()=>[summary,f.doc]}));assert(summary.classes.has('is-pressed'));f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));assert.equal(summary.classes.size,0);f.cleanup();assert.equal(f.doc.handlers.size,0);
});
test('pointer modality follows programmatic destination focus; keyboard navigation removes the pointer-only marker',()=>{
 const f=fixture(),photo=f.node();f.root.handlers.get('pointerdown')(f.event());f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));f.root.handlers.get('focusin')(f.event({type:'focusin',composedPath:()=>[photo,f.surface]}));assert.equal(f.button.getAttribute('data-pv-pointer-focus'),null);assert.equal(photo.getAttribute('data-pv-pointer-focus'),'true');f.root.handlers.get('keydown')(f.event({type:'keydown',key:'Tab',composedPath:()=>[photo,f.surface]}));assert.equal(photo.getAttribute('data-pv-pointer-focus'),null);f.cleanup();
});
test('background and disconnect cleanup end a held fast tap instead of leaving a pressed control',()=>{
 for(const stop of ['background','cleanup']){const f=fixture({raf:true});f.root.handlers.get('pointerdown')(f.event());f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));assert(f.classes.has('is-pressed'));if(stop==='background'){f.doc.hidden=true;f.doc.handlers.get('visibilitychange')();}else f.cleanup();assert.equal(f.classes.size,0);f.frame();f.frame();assert.equal(f.classes.size,0);f.cleanup();}
});
