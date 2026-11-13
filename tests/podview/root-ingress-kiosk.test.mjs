import test from 'node:test';
import assert from 'node:assert/strict';
import {beginIngressKiosk,beginIngressRoot} from '../../podvoice/gatekeeper/static/podview/ingress-kiosk.js';

const origin='https://ha.example',panel='/23375871_podvoice';
function frame(pathname=panel, ingressPage='') {
 const sent=[],listeners=new Map(),replacements=[],clicks=new Map();
 const parent={location:{origin,pathname},postMessage(message,targetOrigin){sent.push({message,targetOrigin});}};
 const link={addEventListener(type,fn){clicks.set(type,fn);},removeEventListener(type,fn){if(clicks.get(type)===fn)clicks.delete(type);}};
 const win={parent,location:{origin,href:`${origin}/api/hassio_ingress/opaque-session/${ingressPage}`,replace(url){replacements.push(url);}},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
 return {win,parent,sent,replacements,link,listeners,emit(type,event){listeners.get(type)?.(event);},click(extra={}){let prevented=false;clicks.get('click')?.({button:0,preventDefault(){prevented=true;},...extra});return prevented;}};
}
// Official frontend20260729.7 computeRouteTail, pinned by Core2026.8.2.
// Dedicated app panels already have /view in route.path; this strips it again.
function haProperties(f,input,{source=f.parent,eventOrigin=origin}={}) {
 const divider=input.path.indexOf('/',1);
 const route=divider===-1?{prefix:input.prefix+input.path,path:''}:{prefix:input.prefix+input.path.slice(0,divider),path:input.path.slice(divider)};
 f.emit('message',{source,origin:eventOrigin,data:{type:'home-assistant/properties',narrow:false,route,safeAreaInsets:{top:'0px',right:'0px',bottom:'0px',left:'0px'}}});
 return route;
}
function dedicated(f,path='',options){return haProperties(f,{prefix:panel,path},options);}

test('Core2026.8.2 dedicated panel click changes the durable HA route then opens its authenticated iframe',()=>{
 const f=frame();beginIngressRoot(f.win,f.link);
 assert.deepEqual(dedicated(f),{prefix:panel,path:''});
 assert.equal(f.click(),true);
 assert.deepEqual(f.sent.at(-1),{message:{type:'home-assistant/navigate',path:panel+'/view'},targetOrigin:origin});
 f.parent.location.pathname=panel+'/view';
 assert.deepEqual(dedicated(f,'/view'),{prefix:panel+'/view',path:''});
 assert.deepEqual(f.replacements,[origin+'/api/hassio_ingress/opaque-session/view/']);
 assert.ok(f.sent.every(x=>x.targetOrigin===origin));
});

test('reload resolves the dedicated /view and /view/ outer routes even though HA sends an empty path',()=>{
 for(const tail of ['/view','/view/']){
  const f=frame(panel+tail);beginIngressRoot(f.win,f.link);dedicated(f,tail);
  assert.deepEqual(f.replacements,[origin+'/api/hassio_ingress/opaque-session/view/']);
 }
});

test('generic /app/slug contract and newer dedicated-route contract resolve the same owned view',()=>{
 const f=frame('/app/23375871_podvoice/view');beginIngressRoot(f.win,f.link);
 const route=haProperties(f,{prefix:'/app',path:'/23375871_podvoice/view'});
 assert.deepEqual(route,{prefix:'/app/23375871_podvoice',path:'/view'});
 assert.equal(f.replacements.length,1);
 const newer=frame(panel+'/view');beginIngressRoot(newer.win,newer.link);
 newer.emit('message',{source:newer.parent,origin,data:{type:'home-assistant/properties',route:{prefix:panel,path:'/view'}}});
 assert.equal(newer.replacements.length,1);
});

test('PodView requests kiosk and returns to the same ingress root only when its exact outer route is left',()=>{
 const f=frame(panel+'/view','view/');const stop=beginIngressKiosk(f.win);
 assert.deepEqual(f.sent,[{message:{type:'home-assistant/subscribe-properties',kioskMode:true},targetOrigin:origin}]);
 dedicated(f,'/view');
 f.parent.location.pathname=panel;dedicated(f);
 assert.deepEqual(f.sent.at(-1),{message:{type:'home-assistant/unsubscribe-properties'},targetOrigin:origin});
 assert.deepEqual(f.replacements,[origin+'/api/hassio_ingress/opaque-session/']);
 f.emit('pagehide',{});assert.equal(f.sent.length,2);stop();
});

test('foreign sources/origins, stale queued routes and malformed path-only fixtures cannot redirect the iframe',()=>{
 const f=frame(panel+'/view');beginIngressRoot(f.win,f.link);
 dedicated(f,'/view',{source:{}});dedicated(f,'/view',{eventOrigin:'https://other.example'});
 dedicated(f,'');
 f.emit('message',{source:f.parent,origin,data:{type:'home-assistant/properties',route:{path:'/view'}}});
 assert.equal(f.replacements.length,0);
 dedicated(f,'/view');assert.equal(f.replacements.length,1);
 const kiosk=frame(panel+'/view','view/');beginIngressKiosk(kiosk.win);dedicated(kiosk,'/view');
 dedicated(kiosk,'');assert.equal(kiosk.replacements.length,0,'queued home properties do not match current outer pathname');
 kiosk.parent.location.pathname='/other_panel';haProperties(kiosk,{prefix:'/other_panel',path:''});
 assert.equal(kiosk.sent.at(-1).message.type,'home-assistant/unsubscribe-properties');
 assert.equal(kiosk.replacements.length,0,'leaving for another panel must not navigate its retained frame');
});

test('hidden root documents cannot navigate a different same-origin panel and modified clicks retain anchor behavior',()=>{
 const f=frame();beginIngressRoot(f.win,f.link);
 assert.equal(f.click({metaKey:true}),false);assert.equal(f.click({button:1}),false);
 f.parent.location.pathname='/another_panel';assert.equal(f.click(),false);
 f.parent.location.pathname=panel;f.emit('pagehide',{});assert.equal(f.click(),false);
});

test('BFCache restores root/view subscriptions once and ignores properties while hidden',()=>{
 const f=frame(panel+'/view');const stop=beginIngressRoot(f.win,f.link);
 assert.equal(beginIngressRoot(f.win,f.link),stop);assert.equal(f.sent.length,2);
 dedicated(f,'/view');f.emit('pagehide',{});dedicated(f,'/view');assert.equal(f.replacements.length,1);
 f.emit('pageshow',{persisted:false});assert.equal(f.sent.length,3);
 f.emit('pageshow',{persisted:true});dedicated(f,'/view');dedicated(f,'/view');assert.equal(f.replacements.length,2);
 stop();assert.equal(f.listeners.size,0);
 const k=frame(panel+'/view','view/');const end=beginIngressKiosk(k.win);
 dedicated(k,'/view');k.emit('pagehide',{});k.parent.location.pathname=panel;dedicated(k);assert.equal(k.replacements.length,0);
 k.parent.location.pathname=panel+'/view';k.emit('pageshow',{persisted:true});dedicated(k,'/view');
 assert.equal(k.sent.at(-1).message.kioskMode,true);end();assert.equal(k.listeners.size,0);
});

test('standalone and cross-origin pages keep ordinary link behavior and direct legacy iframe links do not force a return',()=>{
 for(const setup of [f=>{f.win.parent=f.win;},f=>{f.parent.location.origin='https://other.example';},f=>{f.parent.location.pathname='/api/hassio_ingress/not-a-public-app-route/';}]){
  const f=frame();setup(f);beginIngressRoot(f.win,f.link);beginIngressKiosk(f.win);assert.equal(f.sent.length,0);assert.equal(f.click(),false);
 }
 const hidden=frame(panel+'/view','view/');beginIngressKiosk(hidden.win);hidden.emit('pagehide',{});hidden.parent.location.pathname='/another_panel';const sent=hidden.sent.length;hidden.emit('pageshow',{persisted:true});assert.equal(hidden.sent.length,sent,'restoration cannot request kiosk for another panel');
 const legacy=frame(panel,'view/');beginIngressKiosk(legacy.win);dedicated(legacy);assert.equal(legacy.replacements.length,0);
});

// Re-asking never unsubscribes first: the gap made HA flash its toolbar on every tap (focus).
test('iPad wake: kiosk full screen is requested again when PodView becomes visible, focused or online',()=>{
 const f=frame(panel+'/view'),docListeners=new Map();
 f.win.document={visibilityState:'visible',addEventListener(type,fn){docListeners.set(type,fn);},removeEventListener(type,fn){if(docListeners.get(type)===fn)docListeners.delete(type);}};
 const end=beginIngressKiosk(f.win);
 const kiosk={message:{type:'home-assistant/subscribe-properties',kioskMode:true},targetOrigin:origin};
 const reset={message:{type:'home-assistant/unsubscribe-properties'},targetOrigin:origin};
 assert.deepEqual(f.sent,[kiosk]);
 // Screen locked: hidden documents do not talk to HA.
 f.win.document.visibilityState='hidden';docListeners.get('visibilitychange')();
 assert.deepEqual(f.sent,[kiosk]);
 // Unlocked: HA's rebuilt panel gets the kiosk request again.
 f.win.document.visibilityState='visible';docListeners.get('visibilitychange')();
 assert.deepEqual(f.sent.slice(1),[kiosk]);
 f.emit('focus');f.emit('online');
 assert.deepEqual(f.sent.slice(2),[kiosk,kiosk]);
 assert.equal(f.sent.some(sent=>sent.message.type===reset.message.type),false,'no kiosk gap');
 end();
 assert.equal(docListeners.size,0);assert.equal(f.listeners.size,0);
 f.sent.length=0;f.emit('focus');assert.deepEqual(f.sent,[]);
});

// Fejl 14 (13 Nov): the iPad wall screen showed PodView inside HA with toolbar and sidebar after a
// Core restart and a locked screen. HA's app panel (frontend ha-panel-app.ts) only enables kiosk
// on subscribe-properties when HA is not already in kiosk, and only an unsubscribe from the panel
// that enabled it turns it off.
function haPanel(f){
 const ha={hassKiosk:false,enabledByPanel:false,rebuilt(){this.enabledByPanel=false;rect.top=56;}};
 const rect={top:0,left:0};
 f.win.frameElement={getBoundingClientRect:()=>({...rect})};
 const timers=[];f.win.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length;};f.win.clearInterval=id=>{timers[id-1]=null;};
 const post=f.parent.postMessage;
 f.parent.postMessage=(message,target)=>{post(message,target);
  if(message.type==='home-assistant/subscribe-properties'&&message.kioskMode&&!ha.hassKiosk){ha.hassKiosk=true;ha.enabledByPanel=true;rect.top=0;}
  if(message.type==='home-assistant/unsubscribe-properties'&&ha.enabledByPanel){ha.hassKiosk=false;ha.enabledByPanel=false;rect.top=56;}};
 return {ha,rect,tick(){for(const t of timers)t?.fn();}};
}
test('a rebuilt HA panel without kiosk gets full screen back by itself; taps in full screen send nothing',()=>{
 const f=frame(panel+'/view','view/');f.win.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const h=haPanel(f);
 const end=beginIngressKiosk(f.win);
 assert.equal(h.rect.top,0,'first load is full screen');
 // A tap into PodView (focus) while full screen: no message at all, so no toolbar flash.
 const before=f.sent.length;f.emit('focus');f.emit('online');f.emit('resize');h.tick();
 assert.equal(f.sent.length,before,'nothing is sent while full screen');
 // Core restart or locked screen: the old panel's teardown turned HA's kiosk off and the
 // rebuilt panel shows its toolbar. No tap follows on a wall screen; the watch restores it.
 h.ha.rebuilt();h.ha.hassKiosk=false;
 h.tick();
 assert.equal(h.rect.top,0,'full screen again without any tap');
 assert.deepEqual(f.sent.slice(before).map(x=>x.message.type),
  ['home-assistant/unsubscribe-properties','home-assistant/subscribe-properties']);
 // Within 10 s a still-missing kiosk is not hammered.
 h.rect.top=56;const sent=f.sent.length;h.tick();assert.equal(f.sent.length,sent);
 end();
});
