import test from 'node:test';
import assert from 'node:assert/strict';
import {RadioView} from '../../podvoice/gatekeeper/static/podview/radio-view.js';
import {stations} from '../../podvoice/gatekeeper/static/podview/radio-model.js';

class Node {
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.localName=tag;this.children=[];this.parentNode=null;this.className='';this.dataset={};this.attributes=new Map();this._text='';this.data=null;}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 set textContent(value){this.children=[];this._text=String(value);}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 addEventListener(name,handler){this.listeners??=new Map();this.listeners.set(name,handler);}
 removeEventListener(name,handler){if(this.listeners?.get(name)===handler)this.listeners.delete(name);}
 emit(name,detail,target){let stopped=false;this.listeners.get(name)?.({detail,target,stopPropagation(){stopped=true;}});return stopped;}
}
function fixture(){const doc={createElement:tag=>new Node(doc,tag)},root=doc.createElement('section'),calls=[];const view=new RadioView(root,{onSelect:(id,station)=>calls.push([id,station])});return {root,view,calls};}

test('radio detail reuses response heading and existing choice-list with authored station marks, without an extra player',()=>{
 const {root,view}=fixture();view.render({live:false,connected:true,stationId:'p3'});
 assert.deepEqual(root.children.map(node=>[node.tagName,node.className]),[['HEADER','response-heading'],['PV-CHOICE-LIST','']]);
 assert.equal(root.children[0].children[0].children[0].textContent,'Radio');
 const list=root.children[1];assert.equal(list.data.connected,true);
 assert.equal(list.data.selected,'p3');
 assert.deepEqual(list.data.items.map(({id,label})=>({id,label})),stations.map(({id,label})=>({id,label})));assert.match(list.data.items[0].detail,/^Valgt/);assert.equal(list.data.items[4].detail,'Jazz');
 const heading=root.children[0];view.render({live:false,connected:true,stationId:'p8-jazz'});
 assert.equal(root.children[0],heading);assert.equal(root.children[1],list);
 assert.equal(list.data.selected,'p8-jazz');
});

test('local explicit selection delegates one stable station ID and rejects invalid or repeated choice',()=>{
 const {root,view,calls}=fixture();view.render({live:false,connected:true,stationId:'p3'});const list=root.children[1];
 assert.equal(root.emit('pv-action',{action_id:'choose',option_id:'p8-jazz'},list),true);
 assert.deepEqual(calls,[["p8-jazz",stations[4]]]);
 assert.equal(list.data.selected,'p8-jazz');
 root.emit('pv-action',{action_id:'choose',option_id:'p8-jazz'},list);
 root.emit('pv-action',{action_id:'choose',option_id:'unknown'},list);
 root.emit('pv-action',{action_id:'play',option_id:'p1'},list);
 root.emit('pv-action',{action_id:'choose',option_id:'p1'},root.children[0]);
 assert.equal(calls.length,1);
 view.destroy();root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,1);
});

test('live and disconnected render remain visibly present but cannot select a station',()=>{
 const {root,view,calls}=fixture();view.render({live:true,connected:true,stationId:'p3'});const list=root.children[1];
 assert.equal(list.data.connected,false);assert.equal(list.data.state,'unsupported');
 assert.match(view.subtitle.textContent,/ikke tilsluttet/i);assert.equal(list.data.stateText,'');
 root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:false,stationId:'p3'});
 assert.equal(list.data.connected,false);root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:true,stationId:'p3'});root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);
 assert.deepEqual(calls,[["p1",stations[1]]]);
});

test('unchanged radio snapshots retain the exact list projection and disconnected state keeps selected context',()=>{
 const {view}=fixture();view.render({live:false,connected:true,stationId:'p8-jazz'});const projection=view.list.data;view.render({live:false,connected:true,stationId:'p8-jazz'});assert.equal(view.list.data,projection);
 view.render({live:false,connected:false,stationId:'p8-jazz'});assert.equal(view.list.data.selected,'p8-jazz');assert.equal(view.list.data.state,'offline');assert.equal(view.list.data.quietStatus,true);assert.match(view.subtitle.textContent,/Forbindelsen mangler/);assert.equal(view.list.data.items[4].detail,'Valgt · Jazz');
});

test('station identities reuse sourced DR marks and playback indication follows only the local owner model',()=>{
 const {view}=fixture();view.render({live:false,connected:true,stationId:'p3',playing:true});
 assert.deepEqual(view.list.data.items.map(item=>item.icon),stations.map(station=>`radio-${station.id}`));
 assert.equal(view.list.data.items[0].current,true);assert.match(view.list.data.items[0].detail,/^Spiller/);assert.equal(view.list.data.items.filter(item=>item.current).length,1);
 const list=view.list,projection=list.data;view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(list.data,projection);
 view.render({live:false,connected:true,stationId:'p3',playing:false});assert.equal(view.list,list);assert.equal(list.data.items[0].current,false);assert.match(list.data.items[0].detail,/^På pause/);
 view.render({live:true,connected:true,stationId:'p3',playing:true});assert.equal(list.data.selected,null);assert.ok(list.data.items.every(item=>item.current===false));assert.ok(list.data.items.every(item=>!/^Spiller|^Valgt|^På pause/.test(item.detail)));
});

test('radio heading retains the selected station and distinguishes paused state from selection',()=>{const {view}=fixture();view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(view.subtitle.textContent,'P3 · Spiller');view.render({live:false,connected:true,stationId:'p3',playing:false});assert.equal(view.subtitle.textContent,'P3 · På pause');view.render({live:true,connected:true,stationId:'p3',playing:true});assert.doesNotMatch(view.subtitle.textContent,/P3|På pause|Valgt i afspilleren/);});

test('station assets retain verified DR Design source bytes instead of recreated lettering',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),sources=JSON.parse(await readFile(new URL('./fixtures/radio-logo-sources.json',import.meta.url),'utf8'));
 for(const station of stations){const record=sources.assets[station.id],svg=await readFile(new URL('../../podvoice/gatekeeper/static/podview/'+record.localAsset.replace(/^dist\//,''),import.meta.url),'utf8'),encoded=svg.match(/href="data:image\/png;base64,([^"]+)"/);assert.ok(encoded,station.id);assert.match(record.page,/^https:\/\/www\.drdesign\.org\//);assert.equal(createHash('sha256').update(Buffer.from(encoded[1],'base64')).digest('hex'),record.sourceSha256);assert.doesNotMatch(svg,/<text|font-family/);}
});
