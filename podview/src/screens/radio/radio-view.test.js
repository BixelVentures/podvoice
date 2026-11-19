// Ported from tests/podview/root-radio-view.test.mjs (node:test + fake DOM) to Vitest with a real DOM, when the
// radio screen moved to React. tests/podview/canonical-next-radio-view.test.mjs was a byte-identical copy; both
// are replaced by this file. Same assertions. Adaptations: the fake DOM's child arrays became [...children];
// `root.emit(name, detail, target)` became a bubbling pv-action event dispatched on the target (emit() returns
// whether the radio view stopped it, as the fake's did); the fake click listener became button.click(); the
// fake `img.src` property became getAttribute('src') (a real src is an absolute URL); the NativeNode adapter
// (a hand-made DOM for the real choice-list renderer) became the real DOM with the real components.js.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'vitest';
import '../../../ui/library/components.js';
import {LiveRadioView} from '../../../live-radio-view.js';
import {previewScene} from '../../../preview-scenes.js';
import {stations,ownerStationIds,radioStation} from '../../../radio-model.js';
import {RadioView} from './RadioView';
import {emit, fixture, shell} from './radio-fixture.js';

const podview=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const repo=resolve(podview,'..');
const read=name=>readFileSync(resolve(podview,name),'utf8');

test('five actual radio choices occupy complete two plus three rows without a filler action',()=>{
 const css=read('ui-kit.css'),selector='pv-widget-host #radio-view .radio-station-tiles .pv-list:has(>button:nth-child(5):last-child)';
 assert.ok(css.includes(selector+'{grid-template-columns:repeat(6,minmax(0,1fr))}'));
 assert.ok(css.includes(selector+'>button{grid-column:span 2}'));
 assert.ok(css.includes(selector+'>button:nth-child(-n+2){grid-column:span 3}'));
 const {view}=fixture();view.render({live:false,connected:true});assert.equal(view.list.data.items.length,5);assert.deepEqual(view.list.data.items.map(item=>item.id),stations.map(item=>item.id));assert.ok(view.list.data.items.every(item=>!/[Ff]lere stationer/.test(item.label)));
 assert.equal(3+3,6);assert.equal(2+2+2,6);
});

test('radio detail reuses response heading and existing choice-list with authored station marks, without an extra player',()=>{
 const {root,view}=fixture();view.render({live:false,connected:true,stationId:'p3'});
 assert.deepEqual([...root.children].map(node=>node.tagName),['HEADER','SECTION','DIV','PV-CHOICE-LIST','BUTTON']);assert.equal(view.hero.dataset.kit,'hero');assert.equal(view.stationTitle.textContent,'P3');assert.equal(view.stationStatusLine.textContent,'Valgt');
 assert.equal(root.children[0].children[0].children[0].textContent,'Radio');
 const list=view.list;assert.equal(list.data.connected,true);
 assert.equal(list.data.selected,'p3');
 assert.deepEqual(list.data.items.slice(0,5).map(({id,label})=>({id,label})),stations.map(({id,label})=>({id,label})));assert.match(list.data.items[1].detail,/^Valgt/);assert.equal(list.data.items[4].detail,'Jazz');
 const heading=view.header;view.render({live:false,connected:true,stationId:'p8-jazz'});
 assert.equal(root.children[0],heading);assert.equal(view.list,list);
 assert.equal(list.data.selected,'p8-jazz');
});

test('local explicit selection delegates one stable station ID and rejects invalid or repeated choice',()=>{
 const {root,view,calls}=fixture();view.render({live:false,connected:true,stationId:'p3'});const list=view.list;
 assert.equal(emit(root,{action_id:'choose',option_id:'p8-jazz'},list),true);
 assert.deepEqual(calls,[["p8-jazz",stations[4]]]);
 assert.equal(list.data.selected,'p8-jazz');
 emit(root,{action_id:'choose',option_id:'p8-jazz'},list);
 emit(root,{action_id:'choose',option_id:'unknown'},list);
 emit(root,{action_id:'play',option_id:'p1'},list);
 emit(root,{action_id:'choose',option_id:'p1'},root.children[0]);
 assert.equal(calls.length,1);
 view.destroy();emit(root,{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,1);
});

test('live and disconnected render remain visibly present but cannot select a station',()=>{
 const {root,view,calls}=fixture();view.render({live:true,connected:true,stationId:'p3'});const list=view.list;
 assert.equal(list.data.connected,false);assert.equal(list.data.state,'unsupported');
 assert.match(view.subtitle.textContent,/ikke klar på højttalerne/i);assert.equal(list.data.stateText,'');
 emit(root,{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:false,stationId:'p3'});
 assert.equal(list.data.connected,false);emit(root,{action_id:'choose',option_id:'p1'},list);assert.equal(calls.length,0);
 view.render({live:false,connected:true,stationId:'p3'});emit(root,{action_id:'choose',option_id:'p1'},list);
 assert.deepEqual(calls,[["p1",stations[0]]]);
});

test('unchanged radio snapshots retain the exact list projection and disconnected state keeps selected context',()=>{
 const {view}=fixture();view.render({live:false,connected:true,stationId:'p8-jazz'});const projection=view.list.data;view.render({live:false,connected:true,stationId:'p8-jazz'});assert.equal(view.list.data,projection);
 view.render({live:false,connected:false,stationId:'p8-jazz'});assert.equal(view.list.data.selected,'p8-jazz');assert.equal(view.list.data.state,'offline');assert.equal(view.list.data.quietStatus,true);assert.match(view.subtitle.textContent,/Ikke forbundet/);assert.equal(view.list.data.items[4].detail,'Valgt · Jazz');
});

test('station identities reuse sourced DR marks and playback indication follows only the local owner model',()=>{
 const {view}=fixture();view.render({live:false,connected:true,stationId:'p3',playing:true});
 assert.deepEqual(view.list.data.items.slice(0,5).map(item=>item.icon),stations.map(station=>`radio-${station.id}`));
 assert.equal(view.list.data.items[1].current,false);assert.match(view.list.data.items[1].detail,/^Valgt/);assert.equal(view.list.data.items.filter(item=>item.current).length,0);
 const list=view.list,projection=list.data;view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(list.data,projection);
 view.render({live:false,connected:true,stationId:'p3',playing:false});assert.equal(view.list,list);assert.equal(list.data.items[1].current,false);assert.match(list.data.items[1].detail,/^Stoppet/);
 view.render({live:true,connected:true,stationId:'p3',playing:true});assert.equal(list.data.selected,null);assert.ok(list.data.items.every(item=>item.current===false));assert.ok(list.data.items.every(item=>!/^Spiller|^Valgt|^Stoppet/.test(item.detail)));
});

// Lærred v190 »A-Radio« (issue 393): the hero shows the station shown, its description and whether it plays or stopped.
test('radio hero shows the chosen station while selected tiles distinguish playing-model selection and stop',()=>{const {view}=fixture();for(const playing of [true,false]){view.render({live:false,connected:true,stationId:'p3',playing});assert.equal(view.subtitle.textContent,'Vælg eller skift station nedenfor.');assert.equal(view.stationTitle.textContent,'P3');assert.equal(view.stationStatus.textContent,'Musik og underholdning');assert.equal(view.stationStatusLine.textContent,playing?'Spiller':'Stoppet');assert.match(view.list.data.items[1].detail,playing?/^Valgt/:/^Stoppet/);}view.render({live:true,connected:true,stationId:'p3',playing:true});assert.match(view.stationStatus.textContent,/ikke klar på højttalerne/);assert.doesNotMatch(view.subtitle.textContent,/P3|Stoppet|Valgt i afspilleren/);});

test('station assets retain verified DR Design source bytes instead of recreated lettering',async()=>{
 const sources=JSON.parse(await readFile(resolve(repo,'docs/RADIO-LOGO-SOURCES.json'),'utf8'));
 for(const station of stations){const record=sources.assets[station.id],svg=await readFile(resolve(podview,'public/'+record.localAsset.replace(/^dist\//,'')),'utf8'),encoded=svg.match(/href="data:(image\/(?:png|webp));base64,([^"]+)"/);assert.ok(encoded,station.id);assert.equal(encoded[1],record.sourceContentType);const bytes=Buffer.from(encoded[2],'base64');if(encoded[1]==='image/webp'){assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');}else assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.match(record.page,/^https:\/\/www\.drdesign\.org\//);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sourceSha256);assert.doesNotMatch(svg,/<text|font-family/);}
});


test('only real stations occupy tiles; redundant player row stays hidden without selecting or pretending audio',()=>{const {root,view,calls}=fixture();let opened=0;view.onOpenPlayer=()=>opened++;view.render({live:false,connected:true,stationId:'p3',playing:true});assert.equal(view.list.data.items.length,5);assert.equal(view.playerButton.textContent,'Se afspiller');assert.equal(view.playerButton.hidden,true);view.playerButton.click();assert.equal(opened,0);assert.deepEqual(calls,[]);assert.equal(view.subtitle.textContent,'Vælg eller skift station nedenfor.');assert.doesNotMatch(view.subtitle.textContent,/Spiller/);assert.ok(view.list.data.items.every(row=>!row.current));});

test('radio Hero follows the selection and displays the actual unavailable cause while tiles retain known identity',()=>{
 const {view}=fixture();view.render({live:false,connected:true});const hero=view.hero,art=view.stationArt;
 assert.equal(view.stationTitle.textContent,'Vælg station');assert.equal(view.stationStatusLine.textContent,'Ingen station valgt');assert.equal(view.playerButton.hidden,true);assert.equal(view.list.data.items.length,stations.length);
 view.render({live:false,connected:true,stationId:'p6-beat',playing:true});assert.equal(view.hero,hero);assert.equal(view.stationArt,art);assert.equal(art.getAttribute('src'),'assets/radio-p6-beat.svg');assert.equal(view.stationTitle.textContent,'P6 Beat');assert.equal(view.playerButton.hidden,true);
 view.render({live:false,connected:false,stationId:'p6-beat',playing:false});assert.equal(view.stationTitle.textContent,'Radio');assert.match(view.stationStatus.textContent,/Ikke forbundet/);assert.equal(view.list.data.selected,'p6-beat');assert.match(view.list.data.items[3].detail,/^Stoppet/);assert.equal(view.list.data.connected,false);assert.ok(view.list.data.items.every(row=>row.id!=='open-player'));
});

test('selection updates the selected tile and the hero before owner callback while retaining Hero nodes and artwork',()=>{
 const {root,view}=fixture();view.render({live:false,connected:true});const hero=view.hero,art=view.stationArt,title=view.stationTitle,status=view.stationStatus,players=view.playerButton,children=[...hero.children],calls=[];
 view.onSelect=id=>{calls.push(id);assert.equal(title.textContent,'P4 Østjylland');assert.equal(status.textContent,'Musik og regionalt indhold');assert.equal(art.getAttribute('src'),'assets/radio-p4-ostjylland.svg');assert.equal(view.list.data.selected,id);assert.equal(hero.dataset.kitState,'ready');};
 emit(root,{action_id:'choose',option_id:'p4-ostjylland'},view.list);assert.deepEqual(calls,['p4-ostjylland']);assert.equal(art.width,144);assert.equal(art.height,144);assert.deepEqual([...hero.children],children);
 view.render({live:false,connected:true,stationId:'p4-ostjylland',playing:true});view.render({live:false,connected:true,stationId:'p4-ostjylland',playing:false});view.render({live:false,connected:false,stationId:'p4-ostjylland',playing:false});assert.strictEqual(view.hero,hero);assert.strictEqual(view.stationArt,art);assert.strictEqual(view.stationTitle,title);assert.strictEqual(view.stationStatus,status);assert.strictEqual(view.playerButton,players);assert.equal(art.width,144);assert.equal(art.height,144);assert.match(status.textContent,/Ikke forbundet/);
});
test('the redundant player row stays hidden and cannot navigate in empty, selected, offline or live Radio',()=>{
 const {view}=fixture();let opened=0;view.onOpenPlayer=()=>opened++;view.render({live:false,connected:true});view.playerButton.click();assert.equal(opened,0);for(const state of [{live:false,connected:true,stationId:'p1'},{live:false,connected:false,stationId:'p1'},{live:true,connected:false}]){view.render(state);assert.equal(view.playerButton.hidden,true);view.playerButton.click();assert.equal(opened,0);}
});

test('connected denial retains known station context, blocks forged selection, and only explicit recovery reopens local choice',()=>{
 const {root,view,calls}=fixture();view.render({live:false,connected:true,stationId:'p6-beat',playing:false});const list=view.list,hero=view.hero,art=view.stationArt;
 view.render({live:false,connected:true,blocked:true,stationId:'p6-beat',playing:false});assert.equal(list.data.connected,false);assert.equal(list.data.state,'unsupported');assert.equal(list.data.selected,'p6-beat');assert.equal(view.stationTitle.textContent,'Radio');assert.match(view.stationStatus.textContent,/Adgang afvist/);assert.match(list.data.items[3].detail,/^Stoppet/);assert.match(view.subtitle.textContent,/Adgang afvist/);assert.doesNotMatch(view.subtitle.textContent,/Ikke forbundet/);emit(root,{action_id:'choose',option_id:'p1'},list);assert.deepEqual(calls,[]);
 const denied=list.data;view.render({live:false,connected:true,blocked:true,stationId:'p6-beat',playing:false});assert.equal(list.data,denied);assert.equal(view.hero,hero);assert.equal(view.stationArt,art);
 view.render({live:false,connected:true,blocked:false,stationId:'p6-beat',playing:false});assert.equal(list.data.connected,true);emit(root,{action_id:'choose',option_id:'p1'},list);assert.deepEqual(calls,[[stations[0].id,stations[0]]]);assert.equal(list.data.selected,'p1');
});

test('first-denied, connected denial and live-unsupported Radio all disable actual canonical station Buttons before a click',async()=>{
 {
  const scene=previewScene('first-denied'),root=shell(),calls=[],view=new RadioView(root,{onSelect:id=>calls.push(id)});
  const cases=[{live:false,connected:scene.connected},{live:false,connected:true,blocked:true},{live:true,connected:true},{live:true,connected:true,enabled:true,canStart:false,status:'unknown'}];let retained;
  for(const input of cases){view.render(input);const buttons=[...view.list.querySelectorAll('button')];assert.equal(buttons.length,stations.length);assert.ok(buttons.every(button=>button.disabled===true));if(retained)assert.deepEqual(buttons,retained);retained=buttons;for(const button of buttons)button.click();emit(root,{action_id:'choose',option_id:'p3'},view.list);assert.deepEqual(calls,[]);assert.equal(view.list.data.selected,null);}
  view.render({live:false,connected:true});const buttons=[...view.list.querySelectorAll('button')];assert.deepEqual(buttons,retained);assert.ok(buttons.every(button=>button.disabled===false));buttons[1].click();buttons[1].click();assert.deepEqual(calls,['p3']);assert.equal(view.list.data.selected,'p3');view.destroy();
 }
});

test('Radio intro uses the same retained Hero message roles across selection and denied recovery without extra authority',()=>{
 const {view,calls}=fixture();view.render({live:false,connected:true});const hero=view.hero,copy=hero.children[0].children[1],list=view.list,payload=list.data;
 assert.equal(hero.dataset.kitVariant,'message');assert.equal(view.stationArt.dataset.kitSlot,'icon');assert.equal(copy.dataset.kitSlot,'copy');assert.equal(view.stationTitle.dataset.kitSlot,'title');assert.equal(view.stationStatus.dataset.kitSlot,'body');view.render({live:false,connected:true});assert.equal(list.data,payload);
 view.render({live:false,connected:false,blocked:true});assert.equal(view.hero,hero);assert.equal(view.hero.dataset.kitVariant,'message');assert.match(view.stationStatus.textContent,/Adgang afvist/);assert.equal(view.list.data.connected,false);assert.deepEqual(calls,[]);
 view.render({live:false,connected:true,stationId:'p3'});assert.equal(view.hero,hero);assert.equal(hero.children[0].children[1],copy);assert.equal(view.stationTitle.textContent,'P3');assert.equal(view.list.data.selected,'p3');assert.deepEqual(calls,[]);
});

test('pending station uses canonical item loading without changing selection and feedback naturally hides',()=>{const {view}=fixture();view.render({live:true,connected:true,enabled:true,canStart:false,pending:true,stationId:'p3',playing:true,pendingStationId:'p1'});assert.equal(view.list.data.selected,'p3');assert.deepEqual(view.list.data.items.filter(x=>x.loading).map(x=>x.id),['p1']);assert.equal(view.feedback.hidden,true);const list=view.list;view.render({live:true,connected:true,enabled:true,stationId:null,feedback:{state:'unknown',message:'Udfald ukendt'}});assert.equal(view.list,list);assert.equal(view.feedback.hidden,false);assert.equal(view.feedback.dataset.state,'unknown');assert.equal(view.feedback.textContent,'Udfald ukendt');assert.ok(view.list.data.items.every(x=>!x.loading));view.render({live:true,connected:true,enabled:true});assert.equal(view.feedback.hidden,true);assert.equal(view.feedback.textContent,'');});

test('radio outcome feedback occupies the shared Hero copy feedback slot after body, never the icon grid column',()=>{const {view}=fixture();view.render({live:true,connected:true,enabled:true,feedback:{state:'unknown',message:'Radiohandlingen har ukendt udfald. Handlingen gentages ikke.'}});const copy=view.hero.children[0].children[1];assert.equal(copy.dataset.kitSlot,'copy');assert.equal(view.feedback.parentNode,copy);assert.deepEqual([...copy.children].map(node=>node.dataset.kitSlot),[undefined,'title','body','feedback']);assert.equal(view.feedback.dataset.kitVariant,'feedback');assert.equal(view.feedback.hidden,false);const css=read('ui-kit.css');assert.ok(css.includes('.pv-kit-hero[data-kit-variant=message]:not([hidden]) [data-kit-slot=feedback]{grid-column:2;grid-row:3;'));view.render({live:true,connected:true,enabled:true,pending:true,pendingStationId:'p1'});assert.equal(view.feedback.hidden,true);assert.equal(view.feedback.textContent,'');assert.equal(view.feedback.parentNode,copy);});

test('held live start retains exact logos, labels only requested card Starter and previews requested player without changing selected observation',async()=>{
 let radio;
 try{
  const root=shell(),view=new RadioView(root),frames=[],snapshot={bootId:'b',roomId:'r'},now=Date.now()/1000;
  const dto=(stationId='p3',generation=1)=>({ok:true,schema:'podview.radio.v1',...snapshot,enabled:true,revision:generation,stations:ownerStationIds.map(id=>({id,name:radioStation(id).label})),targets:[{id:'a',name:'Stuen',selectable:true,availability:'available',default:true}],actions:['start','stop','move','volume'],state:{status:'playing',stationId,targetId:'a',generation,sourceKind:'radio',ownerGeneration:generation,volumePercent:37,observedAt:now},retrievedAt:now,validUntil:now+30,physicalResultVerified:false});
  let offerResolve,actionResolve,posts=0;const host={isConnected:true,liveSnapshot:snapshot,liveTransport:{connected:true,radioOffer:()=>new Promise(r=>offerResolve=r),radioAction:()=>{posts++;return new Promise(r=>actionResolve=r);},radio:async()=>dto('p1',2)},playerView:{renderPlayer:vm=>frames.push(vm),renderControls(){},renderQueue(){}},render(){view.render({live:true,connected:true,enabled:radio.current(),canStart:radio.can('start'),pending:radio.pending,stationId:radio.value.state.stationId,playing:radio.value.state.status==='playing',pendingStationId:radio.pendingStart()?.stationId,feedback:radio.feedback()});}};
  radio=new LiveRadioView(host);radio.value=dto();radio.lastConfirmed={...radio.value.state};radio.render();const buttons=[...view.list.querySelectorAll('button')],logos=buttons.map(button=>button.querySelector('img')),sources=logos.map(img=>img.getAttribute('src')),operation=radio.choose('p1');
  assert.equal(view.list.data.selected,'p3');assert.equal(frames.at(-1).title,'P1');assert.equal(frames.at(-1).playing,false);assert.equal(frames.at(-1).fresh,false);assert.equal(frames.at(-1).loading,true);assert.equal(frames.at(-1).volume,37);assert.deepEqual(buttons.filter(button=>button.getAttribute('aria-busy')==='true'),[buttons[0]]);assert.ok(buttons.every(button=>button.dataset.feedback==='label'));assert.equal(buttons[0].querySelector('span').textContent,'Starter…');assert.equal(buttons[1].getAttribute('aria-pressed'),'true');assert.deepEqual(buttons.map(button=>button.querySelector('img')),logos);assert.equal(buttons[0].querySelector('strong').textContent,'P1');assert.equal(view.feedback.hidden,true);
  radio.render();assert.deepEqual([...view.list.querySelectorAll('button')],buttons);assert.equal(buttons[0].getAttribute('aria-busy'),'true');assert.equal(posts,0);offerResolve({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});await Promise.resolve();await Promise.resolve();assert.equal(posts,1);assert.equal(frames.at(-1).title,'P1');assert.equal(radio.value.state.stationId,'p3');assert.equal(buttons[0].getAttribute('aria-busy'),'true');actionResolve({status:'accepted'});await operation;
  assert.equal(view.list.data.selected,'p1');assert.equal(frames.at(-1).title,'P1');assert.ok(buttons.every(button=>button.getAttribute('aria-busy')==='false'));assert.deepEqual(buttons.map(button=>button.querySelector('img')),logos);assert.deepEqual(logos.map(img=>img.getAttribute('src')),sources);
  view.destroy();
 }finally{clearTimeout(radio?.expiry);}
});

test('station surfaces retain normal shadow and exactly one native2px selected frame with no artwork spinner variant',()=>{const css=read('ui-kit.css');assert.ok(!css.includes('.pv-kit:is(.pv-kit-card,.pv-kit-hero,.pv-kit-tile),pv-widget-host #radio-view'));assert.ok(css.includes('pv-widget-host #radio-view .radio-station-tiles .pv-list>.pv-kit-button[aria-pressed=true]{background:var(--pv-surface)!important;border-color:var(--pv-ink)!important;box-shadow:none}'));assert.ok(!css.includes('data-progress-slot'));assert.ok(css.includes('.pv-kit.pv-kit-button[data-feedback=label][aria-busy=true]::after{content:none!important;animation:none!important}'));});

// Added with the move to React: the old fake DOM could only show that an unchanged input kept the same list
// projection; with a real DOM, an unchanged input must write nothing at all and a station change must not
// rebuild the screen (no blink).
function recordMutations(){
 const observer=new MutationObserver(()=>{});
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
 return ()=>observer.takeRecords();
}
test('an unchanged radio input writes nothing to the DOM and a station change rebuilds nothing',()=>{
 const {root,view}=fixture(),state={live:false,connected:true,stationId:'p3',playing:true,speaker:'Stuen'};
 view.render(state);const records=recordMutations(),children=[...root.querySelectorAll('*')];
 view.render({...state});view.render(state);assert.deepEqual(records(),[]);
 view.render({...state,stationId:'p1'});
 const removed=records().filter(record=>record.type==='childList'&&[...record.removedNodes].some(node=>node.nodeType===1));
 assert.deepEqual(removed,[],'no element is removed');
 for(const node of children)assert.ok(node.isConnected,'every element is kept');
 assert.equal(view.stationTitle.textContent,'P1');assert.equal(view.needle.style.left,'10%');
});
