import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const code=text.slice(text.indexOf(' feedbackGeometry(){'),text.indexOf('\n scheduleFeedbackGeometry()',text.indexOf(' feedbackGeometry(){'))).trim();
function fixture(navigation=false){
 const retry={name:'Prøv igen'},style={removeProperty(name){delete this[name];}},rect={left:0,right:200,top:100,bottom:160,width:200,height:60};
 const toast={hidden:false,children:[retry],style,contains:()=>false,getBoundingClientRect:()=>rect};
 const grid={calls:[],insertBefore(){this.calls.push('unexpected layout mutation');}},card={parentNode:grid};
 const control={parentNode:card,matches:()=>navigation,querySelectorAll:()=>[],getAttribute:()=>null,closest:()=>null,getBoundingClientRect:()=>({left:0,right:200,top:110,bottom:150,width:200,height:40})};
 const doc={querySelectorAll:()=>[control],defaultView:{innerHeight:600,getComputedStyle:()=>({visibility:'visible',display:'block'})}};
 const host={ownerDocument:doc,querySelector:()=>({getBoundingClientRect:()=>({top:0,bottom:600})}),notifications:{current:{source:'connection',retry:true,message:'Forbindelsen er afbrudt.'}},connectionRetry:retry};
 const run=new Function('$','document',`return function ${code}`)(()=>toast,doc);run.call(host);return {toast,grid,host,retry,control};
}
// The former tests required a feedback grid row. Actual touch proved that its
// synchronous removal on pointerdown moved the next navigation target by615px.
test('connection retry remains in its single overlay portal while collision offsets protect the real command hitbox',()=>{
 const x=fixture();assert.equal(x.toast.hidden,false);assert.equal(x.grid.calls.length,0);assert.equal(x.host.feedbackLocal,undefined);assert.equal(x.toast.children[0],x.retry);assert.equal(x.toast.style.bottom,'auto');assert(Number.parseFloat(x.toast.style.top)+60<=110-8);
});
test('empty navigation-card surface is not mistaken for a command obstacle or replaced by a layout row',()=>{
 const x=fixture(true);assert.equal(x.toast.hidden,false);assert.equal(x.grid.calls.length,0);assert.equal(x.toast.style.top,undefined);assert.equal(x.toast.children[0],x.retry);
});
