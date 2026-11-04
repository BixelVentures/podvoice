import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../dist/widget-view.js',import.meta.url),'utf8');
function fixture(handled=true){
 const calls=[],nodes=new Map(),doc={defaultView:{navigator:{onLine:true},location:{origin:'https://ha.example'}}};
 class Node extends EventTarget{constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs=new Map();this.style={getPropertyValue:()=>'',setProperty(){}};this.value='';this.textContent='';this.className='';}append(...items){this.children.push(...items);}getAttribute(k){return this.attrs.get(k)??null;}setAttribute(k,v){this.attrs.set(k,String(v));}removeAttribute(k){this.attrs.delete(k);}}
 doc.createElement=tag=>new Node(tag);const $=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};
 const code=source.slice(source.indexOf(' renderScreenSettings(){'),source.indexOf(' scheduleClock(){'));
 const Settings=new Function('$','connectionPresentation','document','applyKitComponent','requestIngressAdmin',`return class {${code}}`)($,()=>({headerLabel:'Forbundet'}),doc,()=>{},win=>{calls.push(win);return handled;});
 const host=new Settings();Object.assign(host,{ownerDocument:doc,live:true,state:{},liveStatus:'connected'});return {host,$,calls};
}
test('administration navigation requires current validated same-origin HA ingress',()=>{
 const f=fixture(),snapshot={bootId:'b',roomId:'r',admission:{kind:'ha_ingress',authenticated:true}},transport={connected:true,snapshot,base:new URL('https://ha.example/api/hassio_ingress/abc/view/api/')};
 f.host.liveSnapshot=snapshot;f.host.liveTransport=transport;f.host.renderScreenSettings();const link=f.host.screenAdminLink;
 assert.equal(link.hidden,false);assert.equal(link.getAttribute('href'),'https://ha.example/api/hassio_ingress/abc/');assert.equal(f.host.screenEnrollmentLink.hidden,false);
 for(const mutate of [()=>transport.connected=false,()=>transport.snapshot={...snapshot},()=>{snapshot.admission={kind:'ha_ingress',authenticated:false}},()=>{snapshot.admission={kind:'ha_ingress',authenticated:true,extra:true}},()=>{transport.base=new URL('https://evil.example/view/api/')}]){
  transport.connected=true;transport.snapshot=snapshot;transport.base=new URL('https://ha.example/api/hassio_ingress/abc/view/api/');snapshot.admission={kind:'ha_ingress',authenticated:true};mutate();f.host.renderScreenSettings();assert.equal(link.hidden,true);assert.equal(link.getAttribute('href'),null);
 }
 transport.base=new URL('https://ha.example/api/hassio_ingress/abc/view/api/');snapshot.admission={kind:'ha_ingress',authenticated:true};f.host.renderScreenSettings();const plain=new Event('click',{cancelable:true});assert.equal(link.dispatchEvent(plain),false);assert.equal(f.calls.length,1);for(const key of ['metaKey','ctrlKey','shiftKey','altKey']){const modified=new Event('click',{cancelable:true});Object.defineProperty(modified,key,{value:true});assert.equal(link.dispatchEvent(modified),true);}assert.equal(f.calls.length,1);transport.connected=false;const click=new Event('click',{cancelable:true});assert.equal(link.dispatchEvent(click),false);assert.equal(link.hidden,true);
});

test('standalone admin anchor keeps its native navigation when no HA parent handles the request',()=>{
 const f=fixture(false),snapshot={bootId:'b',roomId:'r',admission:{kind:'ha_ingress',authenticated:true}};f.host.liveSnapshot=snapshot;f.host.liveTransport={connected:true,snapshot,base:new URL('https://ha.example/api/hassio_ingress/abc/view/api/')};f.host.renderScreenSettings();const click=new Event('click',{cancelable:true});assert.equal(f.host.screenAdminLink.dispatchEvent(click),true);assert.equal(click.defaultPrevented,false);assert.equal(f.calls.length,1);assert.equal(f.host.screenAdminLink.getAttribute('href'),'https://ha.example/api/hassio_ingress/abc/');
});
