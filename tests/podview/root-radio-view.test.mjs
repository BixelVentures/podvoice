import test from 'node:test';
import assert from 'node:assert/strict';
import {RadioView} from '../../podvoice/gatekeeper/static/podview/radio-view.js';
import {stations} from '../../podvoice/gatekeeper/static/podview/radio-model.js';
import {readFileSync} from 'node:fs';

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

test('five actual radio choices occupy complete two plus three rows without a filler action',()=>{
 const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8'),selector='pv-widget-host #radio-view .radio-station-tiles .pv-list:has(>button:nth-child(5):last-child)';
 assert.ok(css.includes(selector+'{grid-template-columns:repeat(6,minmax(0,1fr))}'));
 assert.ok(css.includes(selector+'>button{grid-column:span 2}'));
 assert.ok(css.includes(selector+'>button:nth-child(-n+2){grid-column:span 3}'));
 const {view}=fixture();view.render({live:false,connected:true});assert.equal(view.list.data.items.length,5);assert.deepEqual(view.list.data.items.map(item=>item.id),stations.map(item=>item.id));assert.ok(view.list.data.items.every(item=>!/[Ff]lere stationer/.test(item.label)));
 assert.equal(3+3,6);assert.equal(2+2+2,6);
});

test('radio detail reuses response heading and existing choice-list with authored station marks, without an extra player',()=>{
 const {root,view}=fixture();view.render({live:false,connected:true,stationId:'p3'});
 assert.deepEqual(root.children.map(node=>node.tagName),['HEADER','SECTION','PV-CHOICE-LIST','BUTTON']);assert.equal(view.hero.dataset.kit,'hero');assert.equal(view.stationTitle.textContent,'P3');
 assert.equal(root.children[0].children[0].children[0].textContent,'Radio');
 const list=view.list;assert.equal(list.data.connected,true);
 assert.equal(list.data.selected,'p3');
 assert.deepEqual(list.data.items.slice(0,5).map(({id,label})=>({id,label})),stations.map(({id,label})=>({id,label})));assert.match(list.data.items[0].detail,/^Valgt/);assert.equal(list.data.items[4].detail,'Jazz');
 const heading=view.header;view.render({live:false,connected:true,stationId:'p8-jazz'});
 assert.equal(root.children[0],heading);assert.equal(view.list,list);
 assert.equal(list.data.selected,'p8-jazz');
});

test('local explicit selection delegates one stable station ID and rejects invalid or repeated choice',()=>{
 const {root,view,calls}=fixture();view.render({live:false,connected:true,stationId:'p3'});const list=view.list;
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
 const {root,view,calls}=fixture();view.render({live:true,connected:true,stationId:'p3'});const list=view.list;
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
 assert.deepEqual(view.list.data.items.slice(0,5).map(item=>item.icon),stations.map(station=>`radio-${station.id}`));
 assert.equal(view.list.data.items[0].current,false);assert.match(view.list.data.items[0].detail,/^Valgt/);assert.equal(view.list.data.items.filter(item=>item.current).length,0);
 const list=view.list,projection=list.data;view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(list.data,projection);
 view.render({live:false,connected:true,stationId:'p3',playing:false});assert.equal(view.list,list);assert.equal(list.data.items[0].current,false);assert.match(list.data.items[0].detail,/^På pause/);
 view.render({live:true,connected:true,stationId:'p3',playing:true});assert.equal(list.data.selected,null);assert.ok(list.data.items.every(item=>item.current===false));assert.ok(list.data.items.every(item=>!/^Spiller|^Valgt|^På pause/.test(item.detail)));
});

test('radio heading retains the selected station and distinguishes paused state from selection',()=>{const {view}=fixture();view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(view.subtitle.textContent,'P3 · Valgt');view.render({live:false,connected:true,stationId:'p3',playing:false});assert.equal(view.subtitle.textContent,'P3 · På pause');view.render({live:true,connected:true,stationId:'p3',playing:true});assert.doesNotMatch(view.subtitle.textContent,/P3|På pause|Valgt i afspilleren/);});

test('station assets retain verified DR Design source bytes instead of recreated lettering',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),sources=JSON.parse(await readFile(new URL('../../docs/RADIO-LOGO-SOURCES.json',import.meta.url),'utf8'));
 for(const station of stations){const record=sources.assets[station.id],svg=await readFile(new URL('../../podvoice/gatekeeper/static/podview/'+record.localAsset.replace(/^dist\//,''),import.meta.url),'utf8'),encoded=svg.match(/href="data:image\/png;base64,([^"]+)"/);assert.ok(encoded,station.id);assert.match(record.page,/^https:\/\/www\.drdesign\.org\//);assert.equal(createHash('sha256').update(Buffer.from(encoded[1],'base64')).digest('hex'),record.sourceSha256);assert.doesNotMatch(svg,/<text|font-family/);}
});


test('only real stations occupy tiles; separate player row opens the retained player without selecting or pretending audio',()=>{const {root,view,calls}=fixture();let opened=0;view.onOpenPlayer=()=>opened++;view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(view.list.data.items.length,5);assert.equal(view.playerButton.textContent,'Se afspiller');view.playerButton.listeners.get('click')();assert.equal(opened,1);assert.deepEqual(calls,[]);assert.equal(view.subtitle.textContent,'P3 · Valgt');assert.doesNotMatch(view.subtitle.textContent,/Spiller/);assert.ok(view.list.data.items.every(row=>!row.current));});

test('radio hero retains the actual selected identity through pause and lost connection without inventing programme metadata',()=>{
 const {view}=fixture();view.render({live:false,connected:true});const hero=view.hero,art=view.stationArt;
 assert.equal(view.stationTitle.textContent,'Vælg en radiostation');assert.equal(view.playerButton.hidden,true);assert.equal(view.list.data.items.length,stations.length);
 view.render({live:false,connected:true,stationId:'p6-beat',playing:true});assert.equal(view.hero,hero);assert.equal(view.stationArt,art);assert.equal(art.src,'assets/radio-p6-beat.svg');assert.equal(view.stationTitle.textContent,'P6 Beat');assert.equal(view.playerButton.hidden,false);
 view.render({live:false,connected:false,stationId:'p6-beat',playing:false});assert.equal(view.stationTitle.textContent,'P6 Beat');assert.equal(view.stationStatus.textContent,'På pause');assert.equal(view.list.data.connected,false);assert.ok(view.list.data.items.every(row=>row.id!=='open-player'));
});

test('selection updates retained Hero before owner callback or image decode, without an animation deadline',()=>{
 const {root,view}=fixture();view.render({live:false,connected:true});const hero=view.hero,art=view.stationArt,title=view.stationTitle,status=view.stationStatus,players=view.playerButton,children=[...hero.children],calls=[];
 view.onSelect=id=>{calls.push(id);assert.equal(title.textContent,'P4 Østjylland');assert.equal(status.textContent,'Valgt');assert.equal(art.src,'assets/radio-p4-ostjylland.svg');assert.equal(view.list.data.selected,id);assert.equal(hero.dataset.kitState,'ready');};
 root.emit('pv-action',{action_id:'choose',option_id:'p4-ostjylland'},view.list);assert.deepEqual(calls,['p4-ostjylland']);assert.equal(art.width,96);assert.equal(art.height,96);assert.deepEqual(hero.children,children);
 view.render({live:false,connected:true,stationId:'p4-ostjylland',playing:true});view.render({live:false,connected:true,stationId:'p4-ostjylland',playing:false});view.render({live:false,connected:false,stationId:'p4-ostjylland',playing:false});assert.strictEqual(view.hero,hero);assert.strictEqual(view.stationArt,art);assert.strictEqual(view.stationTitle,title);assert.strictEqual(view.stationStatus,status);assert.strictEqual(view.playerButton,players);assert.equal(art.width,96);assert.equal(art.height,96);assert.equal(status.textContent,'På pause');
});
test('the reserved empty player row cannot navigate before a station is actually selected',()=>{
 const {view}=fixture();let opened=0;view.onOpenPlayer=()=>opened++;view.render({live:false,connected:true});view.playerButton.listeners.get('click')();assert.equal(opened,0);view.render({live:false,connected:true,stationId:'p1'});view.playerButton.listeners.get('click')();assert.equal(opened,1);view.render({live:true,connected:false});view.playerButton.listeners.get('click')();assert.equal(opened,1);
});
