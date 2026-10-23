import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKitComponent,applyKitComponent} from '../../podvoice/gatekeeper/static/podview/ui/kit.js';
import {productLibrary,libraryCategories,libraryStateCount} from '../../podvoice/gatekeeper/static/podview/library-catalog.js';
import {previewStates,previewScene,answerPreviewStatuses} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {FORMATS} from '../../podvoice/gatekeeper/static/podview/scene-model.js';

test('product library links only actual local product preview stages with unique identities',()=>{
 const families=new Set(),states=new Set();
 for(const family of productLibrary){
  assert(!families.has(family.id),`duplicate family ${family.id}`);families.add(family.id);
  assert(family.name&&family.description&&family.usage&&family.interaction);
  assert(Array.isArray(family.limitations));assert(family.states.length>0);
  for(const state of family.states){
   assert(!states.has(state.id),`duplicate state ${state.id}`);states.add(state.id);
   assert(previewStates.includes(state.stage),`unknown stage ${state.stage}`);
   assert(state.label&&state.description);
   if(state.open==='#answer-host details:not([hidden]) > summary'){assert.ok(family.id.startsWith('answer-'));assert.equal(state.stage,`${family.id}-ready`);assert.equal(state.key,'sources');assert.equal(state.selector,'#answer-host');}
   else if(state.open)assert(['#player-detail','#output','#open-history','#home-radio','[data-robot-control]'].includes(state.open),`unexpected automatic action ${state.open}`);
  }
 }
 assert.equal(libraryStateCount,states.size);
 assert.deepEqual(libraryCategories,[...new Set(productLibrary.map(item=>item.category))]);
});

test('every product widget and all ten answer formats are findable in the same catalogue',()=>{
 for(const id of ['composition','conversation','music','player','weather','timer','robot','lights','radio','vehicle','history','overlays'])assert(productLibrary.some(item=>item.id===id),`missing ${id}`);
 for(const format of FORMATS){
  const family=productLibrary.find(item=>item.id===`answer-${format}`);assert(family,format);
  for(const status of answerPreviewStatuses)assert(family.states.some(state=>state.stage===`answer-${format}-${status}`),`${format} lacks ${status}`);
 }
});

test('missing source integrations remain explicit and never get fabricated ready states',()=>{
 const vehicle=productLibrary.find(item=>item.id==='vehicle');
 assert(vehicle.limitations.some(text=>text.includes('Ingen Tesla-integration')));
 assert(vehicle.states.every(state=>['conversation-overview','vehicle-unconnected','vehicle-charging','vehicle-charging-overview','vehicle-unknown','vehicle-stale'].includes(state.stage)));
 for(const state of vehicle.states.filter(row=>row.stage.startsWith('vehicle-charging')))assert.match(JSON.stringify(state),/lokalt|eksempel/i);
 const voice=productLibrary.find(item=>item.id==='conversation');
 assert(voice.limitations.some(text=>text.includes('oprindelige spørgsmål')));
 assert(voice.limitations.some(text=>text.includes('Fuld duplex')));
});

test('Radio denial and unavailable specimens open the existing detail without inventing authority',()=>{
 const radio=productLibrary.find(item=>item.id==='radio');
 for(const stage of ['first-denied','first-unavailable']){
  const sample=radio.states.find(item=>item.stage===stage);assert(sample,stage);
  assert.equal(sample.open,'#home-radio');assert.equal(sample.selector,'#radio-view');
  const scene=previewScene(sample.stage,1_000);
  assert.equal(scene.connected,false);assert.equal(scene.connectionPreview.status,'disconnected');
  assert.equal(Boolean(scene.connectionPreview.blocked),stage==='first-denied');
  assert.equal(scene.music.playback.active,false);assert.equal(scene.music.playback.playing,false);
  assert.deepEqual(scene.devices,[]);
 }
 const combined=productLibrary.find(item=>item.id==='composition').states.find(item=>item.stage==='activities-combined');
 assert.match(combined.description,/faste timerbar/);assert.match(combined.description,/egne widgets/);
 assert.doesNotMatch(combined.description,/tre aktiviteter i samme hero/);
});

test('component isolation targets the displayed anatomy and respects intentional absence',()=>{
 const sample=(family,stage)=>productLibrary.find(item=>item.id===family).states.find(item=>item.stage===stage);
 assert.equal(sample('weather','conversation-overview').selector,'#home-weather');
 assert.equal(sample('weather','weather-ready').selector,'#weather-view');
 assert.equal(sample('weather','conversation-visual').selector,'#answer-host');
 assert.equal(sample('robot','robot-overview-docked').selector,'#now-view > [data-kind="vacuum"]');
 assert.equal(sample('lights','light-rest-on').selector,'#resource-rail [data-kind="light"]');
 assert.equal(sample('history','conversation-complete').selector,'#answer-host');
 assert.equal(sample('overlays','timer-detail-running').selector,'#timers-view');
 const noTimer=sample('timer','timer-rest-empty');assert.equal(noTimer.selector,null);assert(noTimer.isolationNote);
 const noConversation=sample('conversation','conversation-overview');assert.equal(noConversation.selector,null);assert(noConversation.isolationNote);
 const dialogs=productLibrary.flatMap(family=>family.states).filter(item=>item.open&&item.open!=='#answer-host details:not([hidden]) > summary');
 assert(dialogs.every(item=>['#music-detail','#rooms','#history','#radio-view','dialog[aria-labelledby="local-robot-title"][open]'].includes(item.selector)));
});

test('published component library omits surveys while the original decisions remain archived',async()=>{
 const {readFile}=await import('node:fs/promises');
 const html=await readFile(new URL('../../podvoice/gatekeeper/static/podview/library.html',import.meta.url),'utf8');
 const source=await readFile(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8');
 for(const id of ['design-comparison','review-panel','design-questions','question-list','export-reviews'])assert(!html.includes(`id="${id}"`),id);
 assert.doesNotMatch(source,/localStorage|recordedReviews|applyVariant|data-vote/);
 const supplied=JSON.parse(await readFile(new URL('../../docs/USER-DESIGN-ANSWERS-2026-10-20.json',import.meta.url),'utf8'));
 assert.equal(supplied['question-1'].vote,'yes');assert.equal(supplied['question-6'].vote,'no');
 for(const id of ['component-menu','state','conversation-flow','product-preview'])assert(html.includes(`id="${id}"`),id);
});

test('stale survey URLs preserve canonical component navigation and drop question and variant',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const readHash='),source.indexOf('function frameSetup'));
 const family=productLibrary.find(item=>item.id==='weather'),sample=family.states.find(item=>item.stage==='weather-ready');
 const location={hash:`#component=weather&state=${encodeURIComponent(sample.id)}&part=1&question=question-2&variant=alternative`};
 let canonical='';const history={replaceState:(_state,_title,url)=>{canonical=url;}};
 const run=new Function('productLibrary','location','history',`let selected=productLibrary[0],state=selected.states[0],compare=false,isolated=false;${body};readHash();writeHash();return {selected,state,isolated,compare};`);
 const result=run(productLibrary,location,history);
 assert.equal(result.selected,family);assert.equal(result.state,sample);assert.equal(result.isolated,true);assert.equal(result.compare,false);
 const values=new URLSearchParams(canonical.slice(1));assert.equal(values.get('component'),'weather');assert.equal(values.get('state'),sample.id);assert.equal(values.get('part'),'1');
 assert.equal(values.has('question'),false);assert.equal(values.has('variant'),false);assert.doesNotMatch(source,/dataset\.reviewVariant/);
});


test('library Touchområder paints only opted-in documents and repeated application is quiet',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8'),start=source.indexOf('function applyTouchInspection('),end=source.indexOf('function renderTouchInspection(',start);
 const apply=new Function(`return (${source.slice(start,end).trim()});`)(),writes=[],dataset=new Proxy({}, {set(target,key,value){writes.push([key,value]);target[key]=value;return true;},deleteProperty(target,key){writes.push(['delete',key]);delete target[key];return true;}}),doc={documentElement:{dataset}};
 apply(doc,false);assert.deepEqual(writes,[]);apply(doc,true);assert.equal(dataset.libraryTouchAreas,'true');writes.length=0;apply(doc,true);assert.deepEqual(writes,[]);apply(doc,false);assert.equal(dataset.libraryTouchAreas,undefined);assert.deepEqual(writes,[['delete','libraryTouchAreas']]);apply(null,true);
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.html',import.meta.url),'utf8'),css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui/library/library.css',import.meta.url),'utf8');assert.match(html,/id="touch-areas"[^>]*aria-pressed="false"/);assert.match(html,/id="touch-area-legend"[^>]*hidden/);assert.match(html,/href="ui\/library\/library.css"/);assert.match(source,/applyTouchInspection\(doc\)/);assert.match(source,/applyTouchInspection\(frame.contentDocument\)/);assert.match(css,/html\[data-library-touch-areas=true\].*\[role=slider\]/);assert.match(css,/:focus-visible/);assert.match(css,/\.is-pressed/);
});


test('Button specimens use actual retained selected, owned pending and explicit error attributes without a command timer',()=>{
 class NativeButton extends EventTarget{constructor(tag){super();this.tagName=tag.toUpperCase();this.className='';this.attributes=new Map();this.dataset={};this.children=[];this.disabled=false;}setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}append(...nodes){this.children.push(...nodes);}}
 const doc={createElement:tag=>new NativeButton(tag)},source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8'),start=source.indexOf('function specimenNode('),end=source.indexOf('function renderSpecimens(',start),make=new Function('createKitComponent','applyKitComponent','document','entry',`return (${source.slice(start,end).trim()});`)((type,options)=>createKitComponent(type,{...options,document:doc}),applyKitComponent,doc,{name:'Button'});
 const selected=make('button','selected','tesla');assert.equal(selected.getAttribute('data-kit'),'button');assert.equal(selected.getAttribute('data-kit-identity'),'tesla');assert.equal(selected.getAttribute('aria-pressed'),'true');selected.dispatchEvent(new Event('click'));assert.equal(selected.getAttribute('aria-pressed'),'false');assert.equal(selected.textContent,'Valg fra');selected.dispatchEvent(new Event('click'));assert.equal(selected.getAttribute('aria-pressed'),'true');
 const pending=make('button','loading');assert.equal(pending.getAttribute('aria-busy'),'true');assert.equal(pending.disabled,true);assert.equal(pending.textContent,'Afventer');assert.equal(pending.dataset.state,undefined);
 const error=make('button','error');assert.equal(error.dataset.state,'error');assert.equal(error.getAttribute('aria-busy'),'false');assert.equal(error.textContent,'Prøv igen');assert.equal(make('button').dataset.state,undefined);
});


test('seven widget size boards load actual product frames at S/M/L footprints and retain the wide active-timer exception',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8'),configStart=source.indexOf('const widgetSizeTargets='),configEnd=source.indexOf('let level=',configStart),config=new Function(`${source.slice(configStart,configEnd)};return {widgetSizeTargets,widgetSizes};`)();
 assert.deepEqual(Object.keys(config.widgetSizeTargets),['weather','music','robot','lights','vehicle','radio','timer']);assert.deepEqual(config.widgetSizes.map(({id,width,height})=>({id,width,height})),[{id:'s',width:199,height:177},{id:'m',width:414,height:177},{id:'l',width:414,height:370}]);
 const start=source.indexOf('function renderWidgetSizePreviews('),end=source.indexOf('function navigation(',start),renderSource=source.slice(start,end).trim();
 const node=tag=>({tagName:tag.toUpperCase(),children:[],dataset:{},append(...children){this.children.push(...children);}}),doc={createElement:node};
 for(const id of Object.keys(config.widgetSizeTargets)){
  const target=node('section'),observed=[],render=new Function('document','selected','state','$','widgetSizes','resize','urlFor',`return (${renderSource});`)(doc,{id,name:id},{stage:id+'-current',label:'Aktuel tilstand'},()=>target,config.widgetSizes,{observe:viewport=>observed.push(viewport)},sample=>'/?stage='+sample.stage);
  render();const grid=target.children[2];assert.equal(grid.children.length,3);assert.equal(observed.length,3);assert.deepEqual(grid.children.map(item=>item.dataset.widgetSize),['s','m','l']);
  for(const item of grid.children){const frame=item.children[1].children[0];assert.equal(frame.tagName,'IFRAME');assert.equal(frame.loading,'lazy');assert.equal(frame.src,id==='timer'?'/?stage=timer-overview-empty':'/?stage='+id+'-current');assert.equal(typeof frame.onload,'function');}
  if(id==='timer')assert.match(target.children[1].textContent,/aktiv timer bruger.*brede? flade/);
 }
});

test('widget frame crop keeps the actual rectangle and a proportional scale instead of resizing its renderer',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8'),start=source.indexOf('function fit('),end=source.indexOf('const resize=',start),framing=new WeakMap(),fit=new Function('framing',`return (${source.slice(start,end).trim()});`)(framing),frame={style:{}},viewport={clientWidth:207,style:{},querySelector:()=>frame};
 framing.set(frame,{x:24,y:108,width:414,height:370});fit(viewport);assert.equal(frame.style.transform,'scale(0.5) translate(-24px,-108px)');assert.equal(viewport.style.aspectRatio,'414/370');assert.equal(frame.style.width,undefined);
 framing.delete(frame);fit(viewport);assert.equal(viewport.style.aspectRatio,'1280/800');
});

test('initial widget staging records settled geometry and restores real navigation motion; Back waits for its actual owner',async()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8'),start=source.indexOf('function renderWidgetSizePreviews('),end=source.indexOf('function navigation(',start),renderSource=source.slice(start,end).trim(),raf=new Map(),observers=[],events=[],framing=new WeakMap(),cleanup=new WeakMap();let serial=0,transform=64,boxReads=0;
 const node=tag=>({tagName:tag.toUpperCase(),children:[],dataset:{},style:{},isConnected:true,append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}});
 const widget=node('button');widget.getBoundingClientRect=()=>{boxReads++;events.push('measure:'+transform);return {x:24+transform,y:108,width:414,height:177};};
 const host={dataset:{motion:'system'},state:{focus:'robot-detail'},motion:{animations:new Map(),cancel(){events.push('cancel');transform=0;this.animations.clear();},releaseGeometry(animate){assert.equal(animate,false);events.push('release');}},dispatch(event){events.push('dispatch:'+this.dataset.motion);if(this.dataset.motion!=='reduced')transform=16;this.state.focus=event.id;},render(){events.push('render:'+this.dataset.motion);if(this.dataset.motion!=='reduced')transform=16;}};
 const childDoc={querySelector:selector=>selector==='pv-widget-host'?host:selector==='.responses'?{scrollTop:0}:widget},win={customElements:{whenDefined:()=>({then:callback=>callback()})},requestAnimationFrame:callback=>{raf.set(++serial,callback);return serial;},cancelAnimationFrame:id=>raf.delete(id),MutationObserver:class{constructor(callback){observers.push(callback);}observe(){}disconnect(){}}},doc={createElement:tag=>{const item=node(tag);if(tag==='iframe'){item.contentDocument=childDoc;item.contentWindow=win;}return item;}},target=node('section');
 const render=new Function('document','selected','state','$','widgetSizes','resize','urlFor','widgetSizeTargets','applyTouchInspection','applyMotion','framing','fit','sizePreviewCleanup',`return (${renderSource});`)(doc,{id:'robot',name:'Robot'},{stage:'robot-detail-docked',label:'Ved basen'},()=>target,[{id:'m',label:'Medium',width:414,height:177}],{observe(){}},sample=>'/?stage='+sample.stage,{robot:'[data-kind=vacuum]'},()=>{},()=>{events.push('restore');host.dataset.motion='system';},framing,viewport=>events.push(framing.has(viewport.children[0])?'crop':'full'),cleanup);
 render();const example=target.children[2].children[0],frame=example.children[1].children[0];frame.onload();assert.equal(host.dataset.motion,'reduced');assert.ok(events.includes('dispatch:reduced'));assert.ok(events.includes('render:reduced'));const flush=()=>{const [id,callback]=raf.entries().next().value;raf.delete(id);callback();};flush();assert.equal(framing.get(frame).x,24);assert.equal(host.dataset.motion,'system');assert.ok(events.indexOf('measure:0')<events.indexOf('restore'));
 host.state.focus='robot-detail';observers[0]();flush();assert.equal(example.dataset.expanded,'true');assert.equal(host.dataset.motion,'system');const before=boxReads,cancelCount=events.filter(event=>event==='cancel').length;let finish;const finished=new Promise(resolve=>finish=resolve);host.motion.animations.set(widget,{finished});transform=16;host.state.focus='now';observers[0]();assert.equal(raf.size,0);assert.equal(boxReads,before);transform=0;host.motion.animations.clear();finish();await finished;await Promise.resolve();await Promise.resolve();assert.equal(raf.size,1);flush();assert.equal(framing.get(frame).x,24);assert.equal(events.filter(event=>event==='cancel').length,cancelCount);assert.equal(example.dataset.expanded,'false');assert.equal(host.dataset.motion,'system');cleanup.get(frame)();assert.doesNotMatch(renderSource,/setTimeout|setInterval/);
});


test('conversation navigation exposes ten actual answer owners and preserves their existing IDs',()=>{
 const conversation=productLibrary.find(item=>item.id==='conversation');
 for(const format of FORMATS){
  const sample=conversation.states.find(item=>item.answerFormat===format);
  assert.equal(sample.stage,`answer-${format}-ready`);assert.equal(sample.selector,'#answer-host');
  assert(productLibrary.find(item=>item.id===`answer-${format}`).states.some(item=>item.stage===sample.stage));
 }
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8');
 assert.match(source,/families:item.id==='conversation'\?\[item.id,\.\.\.productLibrary.filter/);
});

test('additional domain coverage is reachable without fabricating unsupported owner states',()=>{
 const byId=id=>productLibrary.find(item=>item.id===id);
 for(const [id,stage]of [['robot','robot-detail-empty'],['robot','robot-detail-stale'],['robot','robot-detail-long'],['robot','robot-detail-care'],['lights','light-detail-empty'],['lights','light-detail-stale'],['lights','light-detail-long'],['lights','light-detail-room-living'],['lights','light-detail-room-kitchen'],['lights','light-detail-lamp'],['music','music-offline'],['music','music-unknown'],['player','player-queue-empty'],['player','player-queue-error'],['player','player-long-output'],['weather','weather-unconnected'],['weather','weather-offline'],['vehicle','vehicle-unknown'],['vehicle','vehicle-stale'],['timer','timer-detail-paused']])assert(byId(id).states.some(sample=>sample.stage===stage),stage);
 assert(byId('vehicle').limitations.some(text=>text.includes('ingen kommando-pending')));
 assert(byId('weather').limitations.some(text=>text.includes('ingen selvstændig')));
 assert(byId('radio').limitations.some(text=>text.includes('ingen særskilt radiofejl')));
 for(const id of ['vehicle','radio','weather'])assert(!byId(id).states.some(sample=>/^(vehicle|radio|weather)-(fault|pending)$/.test(sample.stage)));
});


test('music initial-empty and metadata fixtures are reachable through canonical product families',()=>{
 for(const [family,stage]of [['music','music-initial-empty'],['music','music-long-metadata'],['player','player-long-metadata']])assert(productLibrary.find(item=>item.id===family).states.some(item=>item.stage===stage));
});
