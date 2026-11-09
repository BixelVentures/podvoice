import test from 'node:test';
import assert from 'node:assert/strict';
import {installNavigationScroll} from './navigation-scroll.js';
function fixture(design='candidate',live=false){
 const document={documentElement:{dataset:{design}},scrollingElement:{scrollTop:0}};
 const window={innerWidth:390};let cleaned=0;
 const original=function(event){assert.equal(this,host);if(event.focus)this.state={focus:event.focus};return event.result;};
 const cleanup=function(){assert.equal(this,host);cleaned++;return 'clean';};
 const host={live,state:{focus:'now'},dispatch:original,cleanup};const options={document,window};installNavigationScroll(host,options);
 return {host,document,window,original,cleanup,options,cleaned:()=>cleaned};
}
test('mobile detail starts at top and back restores actual overview scroll',()=>{
 const f=fixture(),s=f.document.scrollingElement;s.scrollTop=520;
 assert.equal(f.host.dispatch({focus:'robot',result:42}),42);assert.equal(s.scrollTop,0);
 s.scrollTop=180;f.host.dispatch({focus:'now'});assert.equal(s.scrollTop,520);
 f.host.dispatch({focus:'robot'});assert.equal(s.scrollTop,180);f.host.cleanup();
});
test('same-focus commands and desktop navigation leave document scroll unchanged',()=>{
 const f=fixture(),s=f.document.scrollingElement;s.scrollTop=350;
 f.host.dispatch({focus:'now'});assert.equal(s.scrollTop,350);
 f.host.dispatch({result:'dialog'});assert.equal(s.scrollTop,350);
 f.window.innerWidth=980;f.host.dispatch({focus:'robot'});assert.equal(s.scrollTop,350);
 // Returning to a different narrow layout cannot restore old-width positions.
 f.window.innerWidth=430;f.host.dispatch({focus:'now'});assert.equal(s.scrollTop,0);f.host.cleanup();
});
test('candidate/local guards, idempotence and cleanup preserve owners',()=>{
 for(const [design,live] of [['current',false],['candidate',true]]){const f=fixture(design,live);assert.equal(f.host.dispatch,f.original);}
 const f=fixture(),wrapped=f.host.dispatch;installNavigationScroll(f.host,f.options);assert.equal(f.host.dispatch,wrapped);
 assert.equal(f.host.cleanup(),'clean');assert.equal(f.cleaned(),1);assert.equal(f.host.dispatch,f.original);assert.equal(f.host.cleanup,f.cleanup);
 f.document.scrollingElement.scrollTop=90;wrapped.call(f.host,{focus:'robot'});assert.equal(f.document.scrollingElement.scrollTop,90);
});
