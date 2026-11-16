// Lærred »PodView Retninger«: »SvarK-Historik« (↑ 1 nyt svar) and »Lys-Ukendt« (Status ukendt + compact info line).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

class El{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentNode=null;this.attrs={};this.dataset={};
  this.hidden=false;this.disabled=false;this._text='';this.listeners={};this.className='';this.scrollTop=0;this.style={setProperty(){}};
  this.classList={add:(...c)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...c])].join(' ');},contains:c=>this.className.split(' ').includes(c)};}
 get textContent(){return this._text||this.children.map(c=>c.textContent).join('');}
 set textContent(v){this._text=String(v);this.children=[];}
 get isConnected(){return true;}
 setAttribute(n,v){this.attrs[n]=String(v);} getAttribute(n){return n in this.attrs?this.attrs[n]:null;} removeAttribute(n){delete this.attrs[n];}
 addEventListener(t,f){(this.listeners[t]||=[]).push(f);} click(){for(const f of this.listeners.click||[])f({});}
 dispatch(t){for(const f of this.listeners[t]||[])f({});}
 append(...n){for(const c of n){c.remove();c.parentNode=this;this.children.push(c);}} prepend(...n){for(const c of n.reverse()){c.remove();c.parentNode=this;this.children.unshift(c);}}
 remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}}
 before(n){const p=this.parentNode;n.remove();n.parentNode=p;p.children.splice(p.children.indexOf(this),0,n);}
 after(n){const p=this.parentNode;n.remove();n.parentNode=p;p.children.splice(p.children.indexOf(this)+1,0,n);}
 insertBefore(n,ref){n.remove();n.parentNode=this;const i=ref?this.children.indexOf(ref):-1;if(i<0)this.children.push(n);else this.children.splice(i,0,n);}
 replaceChildren(...n){for(const c of this.children)c.parentNode=null;this.children=[];this.append(...n);}
 querySelector(sel){const match=c=>sel.startsWith('.')?c.className.split(' ').includes(sel.slice(1)):c.tagName===sel.toUpperCase();
  for(const c of this.children){if(match(c))return c;const f=c.querySelector(sel);if(f)return f;}return null;}
 closest(){return null;} getClientRects(){return [];} getBoundingClientRect(){return {left:0,right:0,width:0};}
}
const doc={createElement:t=>new El(t,doc)};
globalThis.document=doc;
globalThis.HTMLElement??=class {};
globalThis.customElements??={define(){},get(){}};

const {SvarTodayView,svarUnseenCount,svarNewLabel}=await import('../../podvoice/gatekeeper/static/podview/svar-today-view.js');
const {LightRoomView}=await import('../../podvoice/gatekeeper/static/podview/light-room-view.js');
const {lightSelection}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');

function svar(){const root=doc.createElement('aside'),header=doc.createElement('header'),h=doc.createElement('h2'),list=doc.createElement('div');
 list.className='svar-today-rows';header.append(h);root.append(header,list);const opened=[];const view=new SvarTodayView(root,id=>opened.push(id));return {root,list,view,opened};}
const row=(id,current=false)=>({id,title:id,kindLabel:'Fakta',time:'11.32',today:true,current});

test('»↑ 1 nyt svar« counts only answers that arrived while an older answer is read',()=>{
 const {view,opened}=svar();
 view.render([row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,true,'reading an older answer that was already listed is not news');
 view.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,false);assert.equal(view.newer.textContent,'↑ 1 nyt svar');
 view.render([row('d'),row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.textContent,'↑ 2 nye svar');
 view.newer.click();
 assert.deepEqual(opened,['d'],'tapping opens the newest answer');assert.equal(view.newer.hidden,true);
});

test('a new answer while the list is scrolled away shows the pill; at the top on the newest it does not',()=>{
 const {view,list,opened}=svar();
 view.render([row('a',true)],true);
 view.render([row('b',true),row('a')],true);
 assert.equal(view.newer.hidden,true,'the new answer is the one on screen and the list is at the top');
 list.scrollTop=200;list.dispatch('scroll');
 view.render([row('c'),row('b',true),row('a')],true);
 assert.equal(view.newer.textContent,'↑ 1 nyt svar');
 view.newer.click();assert.equal(list.scrollTop,0);assert.deepEqual(opened,['c']);
});

test('the count starts over when the Svar page is left',()=>{
 const {view}=svar();
 view.render([row('b'),row('a',true)],true);view.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,false);
 view.render([],false);view.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,true);
 assert.equal(svarUnseenCount([row('x')],null),0);assert.equal(svarNewLabel(1),'↑ 1 nyt svar');assert.equal(svarNewLabel(3),'↑ 3 nye svar');
});

test('the pill is styled as the canvas: 44 px dark pill in the »I dag« column',()=>{
 const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');
 assert.match(css,/#svar-today>\.svar-today-new\{[^}]*height:44px;[^}]*border-radius:999px;[^}]*background:#17171A;color:#F7F6F3;font:600 15px/);
});

function lightHost(connected){
 const lights=[{id:'k1',name:'Pendler',roomId:'kok',roomName:'Køkkenalrum',on:true,state:'on'},{id:'s1',name:'Gulvlampe',roomId:'stue',roomName:'Stue',on:false,state:'off'}];
 const light={id:'lys',kind:'light',status:'mixed',stale:!connected,lights,ownRoomId:'kok',scope:'room',exampleOnly:true,lightSelectionId:'room:kok'};
 const host={state:{connected:true,focus:'lys',devices:[light]},lightRooms:doc.createElement('div'),dispatch(){}};
 doc.createElement('section').append(host.lightRooms);return {host,light};
}
test('Lys-Ukendt says »Status ukendt« and shows the compact info line, never »Ikke opdateret«',()=>{
 const {host,light}=lightHost(false);
 assert.ok(lightSelection(light),'fixture must be a valid light selection');
 const view=new LightRoomView(host);view.render(light);
 assert.deepEqual([...view.rows.values()].map(e=>e.status.textContent),['Status ukendt','Status ukendt']);
 assert.equal(view.panelStatus.textContent,'Status ukendt');
 assert.equal(view.notice.hidden,false);assert.equal(view.notice.getAttribute('role'),'status');
 assert.equal(view.notice.textContent,'iLysoplysninger kunne ikke hentes. Prøv igen.');
 for(const e of view.rows.values())assert.equal(e.power.disabled,true);
 const fresh=lightHost(true);const freshView=new LightRoomView(fresh.host);freshView.render(fresh.light);
 assert.equal(freshView.notice.hidden,true);
 assert.doesNotMatch(readFileSync(new URL('../../podvoice/gatekeeper/static/podview/light-room-view.js',import.meta.url),'utf8'),/Ikke opdateret/);
});
