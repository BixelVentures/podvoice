import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const path=new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url);
const source=readFileSync(path,'utf8');
const method=source.slice(source.indexOf(' showFeedback(message,pending,options={})'),source.indexOf('\n open(id,opener)',source.indexOf(' showFeedback(message,pending,options={})'))).trim();
assert.ok(method.startsWith('showFeedback('));
function fixture() {
  const node={dataset:{},children:[],replaceChildren(...children){this.children=children;for(const c of children)c.parent=this;},contains(){return false}};
  const doc={createTextNode(value){return {nodeValue:value}},addEventListener(){},removeEventListener(){}};
  class Queue {constructor(callback){this.callback=callback;} update(source,message,options){this.current=message?{source,message,...options}:null;this.callback(this.current);} dismiss() {}}
  const fn=new Function('$','NotificationQueue','applyKitComponent','document',`return function ${method}`)(()=>node,Queue,()=>{},doc);
  const host={isConnected:true,ownerDocument:doc,motion:{feedback(){}},scheduleFeedbackGeometry(){},connectionRetry:{id:'retry'}};
  const local=(item,retry=false)=>({__pvItem:item,removed:false,remove(){this.removed=true},contains(child){return retry&&child===host.connectionRetry}});
  return {host,node,local,show:(message,pending=false,opts={})=>fn.call(host,message,pending,opts)};
}
test('a new noncolliding notice removes an earlier unrelated local row',()=>{
 const f=fixture(),a={source:'action',message:'A'},row=f.local(a);f.host.feedbackLocal=row;
 f.show('B',false,{source:'action'});
 assert.equal(row.removed,true);assert.equal(f.host.feedbackLocal,null);assert.equal(f.node.children[0].nodeValue,'B');
});
test('an unrelated notice retains the only local connection retry',()=>{
 const f=fixture(),row=f.local({source:'connection',message:'Offline'},true);f.host.feedbackLocal=f.host.connectionRetryLocal=row;
 f.show('B',false,{source:'action'});
 assert.equal(row.removed,false);assert.equal(f.host.connectionRetryLocal,row);assert.equal(f.node.children[0].nodeValue,'B');
});
test('a new connection retry removes its old row and moves the same retry button to the current notice',()=>{
 const f=fixture(),row=f.local({source:'connection',message:'Offline'},true);f.host.feedbackLocal=f.host.connectionRetryLocal=row;
 f.show('Forbindelsen er afbrudt',false,{source:'connection',retry:true});
 assert.equal(row.removed,true);assert.equal(f.host.connectionRetryLocal,null);assert.equal(f.host.feedbackLocal,null);assert.equal(f.node.children[1],f.host.connectionRetry);
});
