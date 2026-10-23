import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RadioView} from '../../podvoice/gatekeeper/static/podview/radio-view.js';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
import {connectionPresentation} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
class Node {
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.localName=tag;this.children=[];this.parentNode=null;this.className='';this.classList={contains:name=>this.className.split(' ').includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');}};this.dataset={};this.attributes=new Map();this._text='';this.data=null;}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 set textContent(value){this.children=[];this._text=String(value);}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
 getAttribute(name){if(name.startsWith('data-'))return this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]??null;return this.attributes.get(name)??null;}
 addEventListener(name,handler){this.listeners??=new Map();this.listeners.set(name,handler);}
 removeEventListener(name,handler){if(this.listeners?.get(name)===handler)this.listeners.delete(name);}
 emit(name,detail,target){let stopped=false;this.listeners.get(name)?.({detail,target,stopPropagation(){stopped=true;}});return stopped;}
}
function fixture(){const doc={createElement:tag=>new Node(doc,tag)},root=doc.createElement('section'),calls=[];const view=new RadioView(root,{onSelect:(id,station)=>calls.push([id,station])});return {root,view,calls};}


test('host connection notice and real queue notify once while Radio keeps offline explanation across reopen',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderConnectionNotice('),end=source.indexOf('\n renderLive(){',start);
 const {root,view,calls}=fixture(),rendered=[],timers=new Map();let serial=0;
 const queue=new NotificationQueue(item=>rendered.push(item),{setTimer:callback=>{const id=++serial;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
 const render=new Function('$','document','applyKitComponent',`return function ${source.slice(start,end).trim()}`)(()=>null,root.ownerDocument,()=>{});
 const host={state:{},showFeedback:(message,pending,options)=>queue.update(options.source,message,{pending,...options})};
 const update=connected=>{render.call(host,connectionPresentation({status:connected?'connected':'disconnected',snapshot:{}}));view.render({live:false,connected,stationId:'p3'});};
 update(true);const list=view.list,hero=view.hero;update(false);
 assert.equal(queue.current.source,'connection');assert.match(queue.current.message,/afbrudt/);assert.match(view.stationStatus.textContent,/Ikke forbundet/);assert.equal(view.list.data.connected,false);
 queue.dismiss();const count=rendered.length;
 // Navigation retains the same canonical Radio renderer and rerenders the host.
 root.hidden=true;update(false);root.hidden=false;update(false);
 assert.equal(rendered.length,count);assert.equal(queue.current,null);assert.equal(view.list,list);assert.equal(view.hero,hero);assert.match(view.stationStatus.textContent,/Kontrollér forbindelsen/);
 root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.deepEqual(calls,[]);
 update(true);update(false);assert.equal(queue.current.source,'connection');assert.equal(rendered.length,count+1,'a genuinely new loss may notify again');
 queue.cleanup();view.destroy();assert.equal(timers.size,0);
});

test('actual local host branch preserves connection identity when navigation clears transient notice',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
 const start=source.indexOf('const connection=connectionPresentation({...s.connectionPreview'),end=source.indexOf('if($(\'home-music\').disabled)',start);
 assert.ok(start>0&&end>start);
 const render=new Function('s','connectionPresentation',source.slice(start,end));
 const seen=[],queue=new NotificationQueue(item=>seen.push(item),{setTimer:()=>1,clearTimer:()=>{}});
 const host={renderConnectionNotice:connection=>queue.update('connection',connection.text,{retry:connection.retry})};
 render.call(host,{connected:false,notice:'Offline · viser sidst kendte indhold'},connectionPresentation);
 assert.match(queue.current.message,/afbrudt/);queue.dismiss();const count=seen.length;
 render.call(host,{connected:false,notice:null},connectionPresentation);
 assert.equal(queue.current,null);assert.equal(seen.length,count,'navigation must not reopen the dismissed loss under a different message');
 render.call(host,{connected:true},connectionPresentation);render.call(host,{connected:false},connectionPresentation);
 assert.ok(queue.current);queue.cleanup();
});
