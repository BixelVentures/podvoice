// Ported from tests/podview/root-radio-connection-feedback.test.mjs (node:test + fake DOM) to Vitest with a real
// DOM, when the radio screen moved to React. tests/podview/radio117-radio-connection-feedback.test.mjs was a
// byte-identical copy; both are replaced by this file. Same assertions. Adaptations: the fake document became the
// real one and `root.emit(...)` a bubbling pv-action event (radio-fixture.js). The host's connection notice is
// still widget-view.js; its methods are read from that source as before.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'vitest';
import {connectionPresentation} from '../../../podvoice-view.js';
import {NotificationQueue} from '../../../ui/notification-queue.js';
import {emit, fixture} from './radio-fixture.js';

const podview=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=name=>readFileSync(resolve(podview,name),'utf8');

test('host connection notice and real queue notify once while Radio keeps offline explanation across reopen',()=>{
 const source=read('widget-view.js'),start=source.indexOf(' renderConnectionNotice('),end=source.indexOf('\n renderLive(){',start);
 const {root,view,calls}=fixture(),rendered=[],timers=new Map();let serial=0;
 const queue=new NotificationQueue(item=>rendered.push(item),{setTimer:callback=>{const id=++serial;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
 const render=new Function('$','document','applyKitComponent',`return function ${source.slice(start,end).trim()}`)(()=>null,document,()=>{});
 const host={state:{},showFeedback:(message,pending,options)=>queue.update(options.source,message,{pending,...options})};
 const update=connected=>{render.call(host,connectionPresentation({status:connected?'connected':'disconnected',snapshot:{}}));view.render({live:false,connected,stationId:'p3'});};
 update(true);const list=view.list,hero=view.hero;update(false);
 assert.equal(queue.current,null);assert.equal(host.connectionNotice.headerLabel,'Forbindelsen er afbrudt');assert.match(view.stationStatus.textContent,/Ikke forbundet/);assert.equal(view.list.data.connected,false);
 const count=rendered.length;
 // Navigation retains the same canonical Radio renderer and rerenders the host.
 root.hidden=true;update(false);root.hidden=false;update(false);
 assert.equal(rendered.length,count);assert.equal(queue.current,null);assert.equal(view.list,list);assert.equal(view.hero,hero);assert.match(view.stationStatus.textContent,/Kontrollér forbindelsen/);
 emit(root,{action_id:'choose',option_id:'p1'},list);assert.deepEqual(calls,[]);
 update(true);update(false);assert.equal(queue.current,null);assert.equal(host.connectionNotice.headerLabel,'Forbindelsen er afbrudt');assert.equal(rendered.length,count,'persistent status does not create a duplicate toast');
 queue.cleanup();view.destroy();assert.equal(timers.size,0);
});

test('actual local host branch preserves connection identity when navigation clears transient notice',()=>{
 const source=read('widget-view.js');
 const start=source.indexOf('const connection=connectionPresentation({...s.connectionPreview'),end=source.indexOf('if($(\'home-music\').disabled)',start);
 assert.ok(start>0&&end>start);
 const render=new Function('s','connectionPresentation',source.slice(start,end));
 const seen=[],queue=new NotificationQueue(item=>seen.push(item),{setTimer:()=>1,clearTimer:()=>{}});
 const host={renderConnectionNotice:connection=>queue.update('connection',connection.text,{retry:connection.retry})};
 render.call(host,{connected:false,notice:'Offline · viser seneste indhold'},connectionPresentation);
 assert.match(queue.current.message,/afbrudt/);queue.dismiss();const count=seen.length;
 render.call(host,{connected:false,notice:null},connectionPresentation);
 assert.equal(queue.current,null);assert.equal(seen.length,count,'navigation must not reopen the dismissed loss under a different message');
 render.call(host,{connected:true},connectionPresentation);render.call(host,{connected:false},connectionPresentation);
 assert.ok(queue.current);queue.cleanup();
});
