import test from 'node:test';import assert from 'node:assert/strict';import {gestureIntent as intent} from '../../podvoice/gatekeeper/static/podview/ui/gestures.js';
test('vertical scrolling and small accidental drags never switch scenes',()=>{assert.equal(intent({dx:30,dy:100}),null);assert.equal(intent({dx:25,dy:2}),null);assert.equal(intent({dx:80,dy:70}),null);});
test('sliders and other interactive areas cannot invoke parent gestures',()=>{assert.equal(intent({dx:200,dy:0,interactive:true}),null);assert.equal(intent({dx:0,dy:-150,bottom:true,interactive:true}),null);});
test('edge back and bottom controls take priority over ordinary navigation',()=>{assert.equal(intent({dx:160,dy:5,edge:true}),'back');assert.equal(intent({dx:0,dy:-130,bottom:true}),'controls');assert.equal(intent({dx:-130,dy:5,contentSwipe:true}),'next-view');assert.equal(intent({dx:130,dy:5,contentSwipe:true}),'previous-view');});
test('cancelled, slow and malformed strokes have no semantic effect',()=>{assert.equal(intent({dx:150,dy:0,duration:1800}),null);assert.equal(intent({dx:NaN,dy:0}),null);});

test('ordinary activity content never becomes a horizontal scene carousel',()=>{assert.equal(intent({dx:250,dy:0}),null);assert.equal(intent({dx:-250,dy:0}),null);assert.equal(intent({dx:-250,dy:0,edge:true}),null);});
import {wheelGesture} from '../../podvoice/gatekeeper/static/podview/ui/gestures.js';
test('a deliberate trackpad swipe returns once while inertial events cannot repeat',()=>{let s={};let fires=0;for(const [at,dx] of [[0,-30],[20,-40],[40,-50],[60,-100],[80,-100]]){const r=wheelGesture(s,{dx,dy:0,at});s=r.state;if(r.intent)fires++;assert.equal(r.capture,true);}assert.equal(fires,1);});
test('vertical scroll, pinch and horizontal controls cannot become trackpad navigation',()=>{let r=wheelGesture({}, {dx:-5,dy:60,at:0});assert.equal(r.capture,false);r=wheelGesture(r.state,{dx:-150,dy:0,at:20});assert.equal(r.intent,null);assert.equal(wheelGesture({}, {dx:-200,dy:0,at:0,blocked:true}).intent,null);assert.equal(wheelGesture({}, {dx:-200,dy:0,at:0,mode:1}).intent,null);});

test('content transition cancels prior owner and reduces to a bounded opacity fade',async()=>{
 const {transitionContent}=await import('../../podvoice/gatekeeper/static/podview/ui/gestures.js');const priorMatch=globalThis.matchMedia,priorStyle=globalThis.getComputedStyle;let cancelled=0,result;
 globalThis.matchMedia=()=>({matches:true});globalThis.getComputedStyle=()=>({opacity:'.8',transform:'none'});
 const element={isConnected:true,closest:()=>null,getAnimations:()=>[{id:'pv-content-transition',cancel(){cancelled++;}}],animate(frames,options){result={frames,options};return result;}};
 try{transitionContent(element);assert.equal(cancelled,1);assert.equal(result.options.duration,120);assert.equal(result.options.easing,'cubic-bezier(.2,0,0,1)');for(const frame of result.frames)assert.deepEqual(Object.keys(frame),['opacity']);element.isConnected=false;result=null;transitionContent(element);assert.equal(result,null);}finally{globalThis.matchMedia=priorMatch;globalThis.getComputedStyle=priorStyle;}
});
