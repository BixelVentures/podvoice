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
 assert.deepEqual(root.children.map(node=>node.tagName),['HEADER','SECTION','PV-CHOICE-LIST','BUTTON']);assert.equal(view.hero.dataset.kit,'hero');assert.equal(view.stationTitle.textContent,'Vælg radiostation');
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
 assert.match(view.subtitle.textContent,/ikke tilgængelig/i);assert.equal(list.data.stateText,'');
 root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:false,stationId:'p3'});
 assert.equal(list.data.connected,false);root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:true,stationId:'p3'});root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);
 assert.deepEqual(calls,[["p1",stations[1]]]);
});

test('unchanged radio snapshots retain the exact list projection and disconnected state keeps selected context',()=>{
 const {view}=fixture();view.render({live:false,connected:true,stationId:'p8-jazz'});const projection=view.list.data;view.render({live:false,connected:true,stationId:'p8-jazz'});assert.equal(view.list.data,projection);
 view.render({live:false,connected:false,stationId:'p8-jazz'});assert.equal(view.list.data.selected,'p8-jazz');assert.equal(view.list.data.state,'offline');assert.equal(view.list.data.quietStatus,true);assert.match(view.subtitle.textContent,/Ikke forbundet/);assert.equal(view.list.data.items[4].detail,'Valgt · Jazz');
});

test('station identities reuse sourced DR marks and playback indication follows only the local owner model',()=>{
 const {view}=fixture();view.render({live:false,connected:true,stationId:'p3',playing:true});
 assert.deepEqual(view.list.data.items.slice(0,5).map(item=>item.icon),stations.map(station=>`radio-${station.id}`));
 assert.equal(view.list.data.items[0].current,false);assert.match(view.list.data.items[0].detail,/^Valgt/);assert.equal(view.list.data.items.filter(item=>item.current).length,0);
 const list=view.list,projection=list.data;view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(list.data,projection);
 view.render({live:false,connected:true,stationId:'p3',playing:false});assert.equal(view.list,list);assert.equal(list.data.items[0].current,false);assert.match(list.data.items[0].detail,/^Stoppet/);
 view.render({live:true,connected:true,stationId:'p3',playing:true});assert.equal(list.data.selected,null);assert.ok(list.data.items.every(item=>item.current===false));assert.ok(list.data.items.every(item=>!/^Spiller|^Valgt|^Stoppet/.test(item.detail)));
});

test('radio introduction stays static while selected tiles distinguish playing-model selection and stop',()=>{const {view}=fixture();for(const playing of [true,false]){view.render({live:false,connected:true,stationId:'p3',playing});assert.equal(view.subtitle.textContent,'Vælg eller skift station nedenfor.');assert.equal(view.stationTitle.textContent,'Vælg radiostation');assert.equal(view.stationStatus.textContent,'Vælg eller skift station nedenfor.');assert.match(view.list.data.items[0].detail,playing?/^Valgt/:/^Stoppet/);}view.render({live:true,connected:true,stationId:'p3',playing:true});assert.match(view.stationStatus.textContent,/ikke tilgængelig/);assert.doesNotMatch(view.subtitle.textContent,/P3|Stoppet|Valgt i afspilleren/);});

test('station assets retain verified DR Design source bytes instead of recreated lettering',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),sources=JSON.parse(await readFile(new URL('../../docs/RADIO-LOGO-SOURCES.json',import.meta.url),'utf8'));
 for(const station of stations){const record=sources.assets[station.id],svg=await readFile(new URL('../../podvoice/gatekeeper/static/podview/'+record.localAsset.replace(/^dist\//,''),import.meta.url),'utf8'),encoded=svg.match(/href="data:(image\/(?:png|webp));base64,([^"]+)"/);assert.ok(encoded,station.id);assert.equal(encoded[1],record.sourceContentType);const bytes=Buffer.from(encoded[2],'base64');if(encoded[1]==='image/webp'){assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');}else assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.match(record.page,/^https:\/\/www\.drdesign\.org\//);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sourceSha256);assert.doesNotMatch(svg,/<text|font-family/);}
});


test('only real stations occupy tiles; redundant player row stays hidden without selecting or pretending audio',()=>{const {root,view,calls}=fixture();let opened=0;view.onOpenPlayer=()=>opened++;view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(view.list.data.items.length,5);assert.equal(view.playerButton.textContent,'Se afspiller');assert.equal(view.playerButton.hidden,true);view.playerButton.listeners.get('click')();assert.equal(opened,0);assert.deepEqual(calls,[]);assert.equal(view.subtitle.textContent,'Vælg eller skift station nedenfor.');assert.doesNotMatch(view.subtitle.textContent,/Spiller/);assert.ok(view.list.data.items.every(row=>!row.current));});

test('radio Hero keeps its introduction through selection and displays the actual unavailable cause while tiles retain known identity',()=>{
 const {view}=fixture();view.render({live:false,connected:true});const hero=view.hero,art=view.stationArt;
 assert.equal(view.stationTitle.textContent,'Vælg radiostation');assert.equal(view.playerButton.hidden,true);assert.equal(view.list.data.items.length,stations.length);
 view.render({live:false,connected:true,stationId:'p6-beat',playing:true});assert.equal(view.hero,hero);assert.equal(view.stationArt,art);assert.equal(art.src,'assets/icons/boombox.svg');assert.equal(view.stationTitle.textContent,'Vælg radiostation');assert.equal(view.playerButton.hidden,true);
 view.render({live:false,connected:false,stationId:'p6-beat',playing:false});assert.equal(view.stationTitle.textContent,'Radio');assert.match(view.stationStatus.textContent,/Ikke forbundet/);assert.equal(view.list.data.selected,'p6-beat');assert.match(view.list.data.items[3].detail,/^Stoppet/);assert.equal(view.list.data.connected,false);assert.ok(view.list.data.items.every(row=>row.id!=='open-player'));
});

test('selection updates the selected tile before owner callback while retaining static Hero nodes and artwork',()=>{
 const {root,view}=fixture();view.render({live:false,connected:true});const hero=view.hero,art=view.stationArt,title=view.stationTitle,status=view.stationStatus,players=view.playerButton,children=[...hero.children],calls=[];
 view.onSelect=id=>{calls.push(id);assert.equal(title.textContent,'Vælg radiostation');assert.equal(status.textContent,'Vælg eller skift station nedenfor.');assert.equal(art.src,'assets/icons/boombox.svg');assert.equal(view.list.data.selected,id);assert.equal(hero.dataset.kitState,'ready');};
 root.emit('pv-action',{action_id:'choose',option_id:'p4-ostjylland'},view.list);assert.deepEqual(calls,['p4-ostjylland']);assert.equal(art.width,96);assert.equal(art.height,96);assert.deepEqual(hero.children,children);
 view.render({live:false,connected:true,stationId:'p4-ostjylland',playing:true});view.render({live:false,connected:true,stationId:'p4-ostjylland',playing:false});view.render({live:false,connected:false,stationId:'p4-ostjylland',playing:false});assert.strictEqual(view.hero,hero);assert.strictEqual(view.stationArt,art);assert.strictEqual(view.stationTitle,title);assert.strictEqual(view.stationStatus,status);assert.strictEqual(view.playerButton,players);assert.equal(art.width,96);assert.equal(art.height,96);assert.match(status.textContent,/Ikke forbundet/);
});
test('the redundant player row stays hidden and cannot navigate in empty, selected, offline or live Radio',()=>{
 const {view}=fixture();let opened=0;view.onOpenPlayer=()=>opened++;view.render({live:false,connected:true});view.playerButton.listeners.get('click')();assert.equal(opened,0);for(const state of [{live:false,connected:true,stationId:'p1'},{live:false,connected:false,stationId:'p1'},{live:true,connected:false}]){view.render(state);assert.equal(view.playerButton.hidden,true);view.playerButton.listeners.get('click')();assert.equal(opened,0);}
});

test('connected denial retains known station context, blocks forged selection, and only explicit recovery reopens local choice',()=>{
 const {root,view,calls}=fixture();view.render({live:false,connected:true,stationId:'p6-beat',playing:false});const list=view.list,hero=view.hero,art=view.stationArt;
 view.render({live:false,connected:true,blocked:true,stationId:'p6-beat',playing:false});assert.equal(list.data.connected,false);assert.equal(list.data.state,'unsupported');assert.equal(list.data.selected,'p6-beat');assert.equal(view.stationTitle.textContent,'Radio');assert.match(view.stationStatus.textContent,/Adgang afvist/);assert.match(list.data.items[3].detail,/^Stoppet/);assert.match(view.subtitle.textContent,/Adgang afvist/);assert.doesNotMatch(view.subtitle.textContent,/Ikke forbundet/);root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.deepEqual(calls,[]);
 const denied=list.data;view.render({live:false,connected:true,blocked:true,stationId:'p6-beat',playing:false});assert.equal(list.data,denied);assert.equal(view.hero,hero);assert.equal(view.stationArt,art);
 view.render({live:false,connected:true,blocked:false,stationId:'p6-beat',playing:false});assert.equal(list.data.connected,true);root.emit('pv-action',{action_id:'choose',option_id:'p1'},list);assert.deepEqual(calls,[[stations[1].id,stations[1]]]);assert.equal(list.data.selected,'p1');
});

// This adapter executes the real choice-list renderer and native disabled
// properties. Projection-only test doubles cannot establish disabled buttons.
class NativeNode extends Node{
 constructor(tag='div'){super(globalThis.document,tag);this.isConnected=true;this.hidden=false;this.disabled=false;this.classList.toggle=(name,on)=>{const names=this.className.split(' ').filter(Boolean);this.className=(on?[...new Set([...names,name])]:names.filter(value=>value!==name)).join(' ');};}
 get childNodes(){return this.children;}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 prepend(node){this.insertBefore(node,this.children[0]);}
 remove(){if(this.parentNode){const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
 insertBefore(node,before){node.remove();node.parentNode=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}
 removeAttribute(name){this.attributes.delete(name);}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 matches(selector){return selector==='[hidden]'?this.hidden:selector.startsWith('.')?this.classList.contains(selector.slice(1)):selector==='button:not(:disabled):not([hidden])'?this.tagName==='BUTTON'&&!this.disabled&&!this.hidden:this.tagName===selector.toUpperCase();}
 closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
 querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 dispatchEvent(event){if(!event.target)Object.defineProperty(event,'target',{value:this});this.listeners?.get(event.type)?.(event);if(event.bubbles&&!event.cancelBubble)this.parentNode?.dispatchEvent(event);return !event.defaultPrevented;}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click',{bubbles:true}));}
}

test('first-denied, connected denial and live-unsupported Radio all disable actual canonical station Buttons before a click',async()=>{
 const previous={HTMLElement:globalThis.HTMLElement,document:globalThis.document,customElements:globalThis.customElements,CustomEvent:globalThis.CustomEvent},registry=new Map();
 globalThis.HTMLElement=NativeNode;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};globalThis.CustomEvent=class extends Event{constructor(type,options){super(type,options);this.detail=options.detail;}};
 globalThis.document={activeElement:null,createElement(tag){const Constructor=registry.get(tag),node=Constructor?new Constructor():new NativeNode(tag);node.localName=tag;node.tagName=tag.toUpperCase();return node;}};
 try{
  await import('../../podvoice/gatekeeper/static/podview/ui/library/components.js?radio-native-disabled');const {previewScene}=await import('../../podvoice/gatekeeper/static/podview/preview-scenes.js'),scene=previewScene('first-denied'),root=document.createElement('section'),calls=[],view=new RadioView(root,{onSelect:id=>calls.push(id)});
  const cases=[{live:false,connected:scene.connected},{live:false,connected:true,blocked:true},{live:true,connected:true},{live:true,connected:true,enabled:true,canStart:false,status:'unknown'}];let retained;
  for(const input of cases){view.render(input);const buttons=view.list.querySelectorAll('button');assert.equal(buttons.length,stations.length);assert.ok(buttons.every(button=>button.disabled===true));if(retained)assert.deepEqual(buttons,retained);retained=buttons;for(const button of buttons)button.click();root.emit('pv-action',{action_id:'choose',option_id:'p3'},view.list);assert.deepEqual(calls,[]);assert.equal(view.list.data.selected,null);}
  view.render({live:false,connected:true});const buttons=view.list.querySelectorAll('button');assert.deepEqual(buttons,retained);assert.ok(buttons.every(button=>button.disabled===false));buttons[0].click();buttons[0].click();assert.deepEqual(calls,['p3']);assert.equal(view.list.data.selected,'p3');view.destroy();
 }finally{Object.assign(globalThis,previous);}
});

test('Radio intro uses the same retained Hero message roles across selection and denied recovery without extra authority',()=>{
 const {view,calls}=fixture();view.render({live:false,connected:true});const hero=view.hero,copy=hero.children[1],list=view.list,payload=list.data;
 assert.equal(hero.dataset.kitVariant,'message');assert.equal(view.stationArt.dataset.kitSlot,'icon');assert.equal(copy.dataset.kitSlot,'copy');assert.equal(view.stationTitle.dataset.kitSlot,'title');assert.equal(view.stationStatus.dataset.kitSlot,'body');view.render({live:false,connected:true});assert.equal(list.data,payload);
 view.render({live:false,connected:false,blocked:true});assert.equal(view.hero,hero);assert.equal(view.hero.dataset.kitVariant,'message');assert.match(view.stationStatus.textContent,/Adgang afvist/);assert.equal(view.list.data.connected,false);assert.deepEqual(calls,[]);
 view.render({live:false,connected:true,stationId:'p3'});assert.equal(view.hero,hero);assert.equal(hero.children[1],copy);assert.equal(view.stationTitle.textContent,'Vælg radiostation');assert.equal(view.list.data.selected,'p3');assert.deepEqual(calls,[]);
});

test('pending station uses canonical item loading without changing selection and feedback naturally hides',()=>{const {view}=fixture();view.render({live:true,connected:true,enabled:true,canStart:false,pending:true,stationId:'p3',playing:true,pendingStationId:'p1'});assert.equal(view.list.data.selected,'p3');assert.deepEqual(view.list.data.items.filter(x=>x.loading).map(x=>x.id),['p1']);assert.equal(view.feedback.hidden,true);const list=view.list;view.render({live:true,connected:true,enabled:true,stationId:null,feedback:{state:'unknown',message:'Udfald ukendt'}});assert.equal(view.list,list);assert.equal(view.feedback.hidden,false);assert.equal(view.feedback.dataset.state,'unknown');assert.equal(view.feedback.textContent,'Udfald ukendt');assert.ok(view.list.data.items.every(x=>!x.loading));view.render({live:true,connected:true,enabled:true});assert.equal(view.feedback.hidden,true);assert.equal(view.feedback.textContent,'');});

test('radio outcome feedback occupies the shared Hero copy feedback slot after body, never the icon grid column',()=>{const {view}=fixture();view.render({live:true,connected:true,enabled:true,feedback:{state:'unknown',message:'Radiohandlingen har ukendt udfald. Handlingen gentages ikke.'}});const copy=view.hero.children[1];assert.equal(copy.dataset.kitSlot,'copy');assert.equal(view.feedback.parentNode,copy);assert.deepEqual(copy.children.map(node=>node.dataset.kitSlot),['title','body','feedback']);assert.equal(view.feedback.dataset.kitVariant,'feedback');assert.equal(view.feedback.hidden,false);const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');assert.ok(css.includes('.pv-kit-hero[data-kit-variant=message]:not([hidden]) [data-kit-slot=feedback]{grid-column:2;grid-row:3;'));view.render({live:true,connected:true,enabled:true,pending:true,pendingStationId:'p1'});assert.equal(view.feedback.hidden,true);assert.equal(view.feedback.textContent,'');assert.equal(view.feedback.parentNode,copy);});

test('held live start retains exact logos, labels only requested card Starter and previews requested player without changing selected observation',async()=>{
 const previous={HTMLElement:globalThis.HTMLElement,document:globalThis.document,customElements:globalThis.customElements,CustomEvent:globalThis.CustomEvent},registry=new Map();globalThis.HTMLElement=NativeNode;globalThis.customElements={define:(name,ctor)=>registry.set(name,ctor)};globalThis.CustomEvent=class extends Event{constructor(type,options){super(type,options);this.detail=options.detail;}};globalThis.document={activeElement:null,createElement(tag){const Constructor=registry.get(tag),node=Constructor?new Constructor():new NativeNode(tag);node.localName=tag;node.tagName=tag.toUpperCase();return node;}};
 let radio;
 try{
  await import('../../podvoice/gatekeeper/static/podview/ui/library/components.js?radio-artwork-progress');const {LiveRadioView}=await import('../../podvoice/gatekeeper/static/podview/live-radio-view.js'),root=document.createElement('section'),view=new RadioView(root),frames=[],snapshot={bootId:'b',roomId:'r'},now=Date.now()/1000;
  const dto=(stationId='p3',generation=1)=>({ok:true,schema:'podview.radio.v1',...snapshot,enabled:true,revision:generation,stations:stations.map(s=>({id:s.id,name:s.label})),targets:[{id:'a',name:'Stuen',selectable:true,availability:'available',default:true}],actions:['start','stop','move','volume'],state:{status:'playing',stationId,targetId:'a',generation,sourceKind:'radio',ownerGeneration:generation,volumePercent:37,observedAt:now},retrievedAt:now,validUntil:now+30,physicalResultVerified:false});
  let offerResolve,actionResolve,posts=0;const host={isConnected:true,liveSnapshot:snapshot,liveTransport:{connected:true,radioOffer:()=>new Promise(r=>offerResolve=r),radioAction:()=>{posts++;return new Promise(r=>actionResolve=r);},radio:async()=>dto('p1',2)},playerView:{renderPlayer:vm=>frames.push(vm),renderControls(){},renderQueue(){}},render(){view.render({live:true,connected:true,enabled:radio.current(),canStart:radio.can('start'),pending:radio.pending,stationId:radio.value.state.stationId,playing:radio.value.state.status==='playing',pendingStationId:radio.pendingStart()?.stationId,feedback:radio.feedback()});}};
  radio=new LiveRadioView(host);radio.value=dto();radio.lastConfirmed={...radio.value.state};radio.render();const buttons=view.list.querySelectorAll('button'),logos=buttons.map(button=>button.querySelector('img')),sources=logos.map(img=>img.getAttribute('src')),operation=radio.choose('p1');
  assert.equal(view.list.data.selected,'p3');assert.equal(frames.at(-1).title,'P1');assert.equal(frames.at(-1).playing,false);assert.equal(frames.at(-1).fresh,false);assert.equal(frames.at(-1).loading,true);assert.equal(frames.at(-1).volume,37);assert.deepEqual(buttons.filter(button=>button.getAttribute('aria-busy')==='true'),[buttons[1]]);assert.ok(buttons.every(button=>button.dataset.feedback==='label'));assert.equal(buttons[1].querySelector('span').textContent,'Starter…');assert.equal(buttons[0].getAttribute('aria-pressed'),'true');assert.deepEqual(buttons.map(button=>button.querySelector('img')),logos);assert.equal(buttons[1].querySelector('strong').textContent,'P1');assert.equal(view.feedback.hidden,true);
  radio.render();assert.deepEqual(view.list.querySelectorAll('button'),buttons);assert.equal(buttons[1].getAttribute('aria-busy'),'true');assert.equal(posts,0);offerResolve({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});await Promise.resolve();await Promise.resolve();assert.equal(posts,1);assert.equal(frames.at(-1).title,'P1');assert.equal(radio.value.state.stationId,'p3');assert.equal(buttons[1].getAttribute('aria-busy'),'true');actionResolve({status:'accepted'});await operation;
  assert.equal(view.list.data.selected,'p1');assert.equal(frames.at(-1).title,'P1');assert.ok(buttons.every(button=>button.getAttribute('aria-busy')==='false'));assert.deepEqual(buttons.map(button=>button.querySelector('img')),logos);assert.deepEqual(logos.map(img=>img.getAttribute('src')),sources);
  view.destroy();
 }finally{clearTimeout(radio?.expiry);Object.assign(globalThis,previous);}
});

test('station surfaces retain normal shadow and exactly one native2px selected frame with no artwork spinner variant',()=>{const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');assert.ok(!css.includes('.pv-kit:is(.pv-kit-card,.pv-kit-hero,.pv-kit-tile),pv-widget-host #radio-view'));assert.ok(css.includes('pv-widget-host #radio-view .radio-station-tiles .pv-list>.pv-kit-button[aria-pressed=true]{background:var(--pv-surface)!important;border-color:var(--pv-ink)!important;box-shadow:none}'));assert.ok(!css.includes('data-progress-slot'));assert.ok(css.includes('.pv-kit.pv-kit-button[data-feedback=label][aria-busy=true]::after{content:none!important;animation:none!important}'));});
