import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const code=text.slice(text.indexOf(' feedbackGeometry(){'),text.indexOf('\n scheduleFeedbackGeometry()',text.indexOf(' feedbackGeometry(){'))).trim();
function fixture(source='connection'){
 const toast={hidden:false,contains:()=>false,getBoundingClientRect:()=>({left:0,right:200,top:100,bottom:160})};
 const grid={id:'now-view',calls:[],insertBefore(node,anchor){node.parentNode=this;this.calls.push([node,anchor])}};
 const card={parentElement:grid,parentNode:grid,tagName:'DIV',closest:selector=>selector==='.resource-card'?card:null,calls:[],insertBefore(node,anchor){node.parentNode=this;this.calls.push([node,anchor])}};
 const control={parentElement:card,parentNode:card,tagName:'BUTTON',getAttribute:()=>null,closest:selector=>selector==='.resource-card'?card:selector==='.responses'?true:null,getBoundingClientRect:()=>({left:0,right:200,top:110,bottom:150,width:200,height:40})};
 const retry={name:'Prøv igen'};
 const doc={querySelectorAll:()=>[control],createElement:()=>({children:[],setAttribute(){},append(child){this.children.push(child)}}),defaultView:{innerWidth:1024,innerHeight:600,getComputedStyle:()=>({visibility:'visible',display:'block'})}};
 const item={source,retry:source==='connection',message:'Forbindelsen er afbrudt.'};const host={ownerDocument:doc,notifications:{current:item},connectionRetry:retry};
 const run=new Function('$','applyKitComponent','document',`return function ${code}`)(()=>toast,()=>{},doc);
 run.call(host);return {toast,grid,card,control,host,retry};
}
test('connection feedback occupies overview grid row and retains actual retry',()=>{const x=fixture();assert.equal(x.toast.hidden,true);assert.equal(x.grid.calls.length,1);assert.equal(x.grid.calls[0][1],x.card);assert.equal(x.host.feedbackLocal.children[0],x.retry);assert.equal(x.host.connectionRetryLocal,x.host.feedbackLocal);assert.equal(x.card.calls.length,0)});
test('ordinary action feedback stays associated with the affected control',()=>{const x=fixture('action');assert.equal(x.grid.calls.length,0);assert.equal(x.card.calls.length,1);assert.equal(x.card.calls[0][1],x.control);assert.equal(x.host.feedbackLocal.children.length,0)});
