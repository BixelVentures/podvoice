import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialScene,sceneTransition as step,binding,deviceActions,deviceLabel,devicePresentation,lightSelection,lightChoices} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {unconfiguredLight,liveLocalEvent} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
const start=()=>step(initialScene(),{type:'device-demo',kind:'light',time:'12:00'});
const light=s=>s.devices.find(row=>row.kind==='light');
const select=(s,optionId)=>step(s,{type:'light-select',...binding(s,light(s)),optionId});
const apply=s=>{const d=light(s),pending=step(s,{type:'device-action',...binding(s,d),action:deviceActions(d)[0].id});return step(pending,{type:'device-result',id:d.id,...light(pending).pending,time:'12:01'});};
test('whole-house choices expose every lamp with room context and retain room filtering',()=>{let s=start(),d=light(s);assert.equal(d.exampleOnly,true);assert.equal(lightSelection(d).label,'Hele hjemmet');assert.equal(lightSelection(d).onCount,2);assert.equal(lightChoices(d).rooms.items.length,3);assert.deepEqual(lightChoices(d).lamps.items.map(row=>row.id),d.lights.map(row=>`light:${row.id}`));assert.deepEqual(lightChoices(d).lamps.items.map(row=>row.label),d.lights.map(row=>`${row.roomName} · ${row.name}`));assert.equal(lightChoices(d).lamps.selected,null);assert.deepEqual(lightChoices(d).lamps.items.map(row=>row.status),['on','on','off','off']);s=select(s,'room:living');d=light(s);assert.equal(lightChoices(d).rooms.selected,'room:living');assert.deepEqual(lightChoices(d).lamps.items.map(row=>row.id),['light:living-ceiling','light:living-floor']);assert.equal(select(s,'light:kitchen-ceiling'),s);s=select(s,'light:living-floor');assert.equal(lightSelection(light(s)).label,'Stuen · Gulvlampe');assert.equal(lightChoices(light(s)).rooms.selected,'room:living');assert.equal(lightChoices(light(s)).lamps.selected,'light:living-floor');});
test('a lamp chosen directly from whole home opens its room and controls only that lamp',()=>{let s=select(start(),'light:kitchen-counter');assert.equal(lightSelection(light(s)).label,'Køkkenet · Bordlys');assert.equal(lightChoices(light(s)).rooms.selected,'room:kitchen');assert.deepEqual(lightChoices(light(s)).lamps.items.map(row=>row.label),['Loftlys','Bordlys']);s=apply(s);assert.deepEqual(light(s).lights.filter(row=>row.on).map(row=>row.id),['living-ceiling','living-floor','kitchen-counter']);s=select(s,'home');assert.equal(lightChoices(light(s)).lamps.items.length,4);});
test('room and individual commands affect only their captured local target IDs',()=>{let s=select(start(),'room:kitchen');assert.equal(deviceActions(light(s))[0].id,'turn_on');s=apply(s);assert.equal(light(s).lights.every(row=>row.on),true);s=select(s,'room:living');s=select(s,'light:living-floor');s=apply(s);assert.deepEqual(light(s).lights.filter(row=>!row.on).map(row=>row.id),['living-floor']);assert.equal(light(s).status,'mixed');assert.equal(light(s).timeline.at(-1).label,'Stuen · Gulvlampe · Slukket');});
test('aggregate action applies to every light only when whole home is selected',()=>{let s=start();assert.equal(deviceActions(light(s))[0].label,'Sluk alt lys');s=apply(s);assert.equal(light(s).lights.every(row=>!row.on),true);assert.equal(deviceActions(light(s))[0].label,'Tænd alt lys');s=apply(s);assert.equal(light(s).lights.every(row=>row.on),true);});
test('selected room and lamp persist through overview Ro detail and fixture reopening',()=>{let s=select(start(),'room:kitchen');s=select(s,'light:kitchen-counter');const selected=light(s);for(const id of ['now','photo','demo-light'])s=step(s,{type:'show',id});assert.equal(light(s),selected);assert.equal(lightSelection(light(s)).id,'light:kitchen-counter');s=step(s,{type:'device-demo',kind:'light'});assert.deepEqual(light(s),selected);assert.equal(light(s).lights,selected.lights);assert.equal(lightSelection(light(s)).roomId,'kitchen');});
test('pending and stale context changes cannot retarget an action or accept an old result',()=>{let s=select(start(),'room:living');const d=light(s),oldBinding=binding(s,d);s=select(s,'light:living-ceiling');assert.equal(step(s,{type:'device-action',...oldBinding,action:'turn_off'}),s);s=step(s,{type:'device-action',...binding(s,light(s)),action:'turn_off'});const pending=light(s).pending;assert.deepEqual(pending.targetIds,['living-ceiling']);assert.equal(select(s,'room:kitchen'),s);assert.equal(step(s,{type:'device-result',id:d.id,...pending,operation:999}),s);s=step(s,{type:'device-result',id:d.id,...pending,targetIds:['kitchen-counter'],time:'12:01'});assert.deepEqual(light(s).lights.filter(row=>!row.on).map(row=>row.id),['living-ceiling','kitchen-ceiling','kitchen-counter']);});
test('offline unknown result does not replay or expose another command after reconnection',()=>{let s=start();s=step(s,{type:'device-action',...binding(s,light(s)),action:'turn_off'});const d=light(s),pending=d.pending;s=step(s,{type:'offline'});assert.equal(lightSelection(light(s)).status,'unknown');assert.deepEqual(deviceActions(light(s)),[]);assert.equal(step(s,{type:'device-result',id:d.id,...pending}),s);s=step(s,{type:'snapshot',generation:s.generation});assert.deepEqual(deviceActions(light(s)),[]);});
test('local example context never creates live choices or live control authority',()=>{const d=unconfiguredLight();assert.equal(lightSelection(d),null);assert.equal(lightChoices(d),null);assert.deepEqual(deviceActions(d),[]);assert.equal(liveLocalEvent({type:'light-select',optionId:'home'}),false);const local=light(start());assert.equal(lightSelection({...local,live:true}),null);assert.deepEqual(deviceActions({...local,live:true}),[]);assert.equal(lightSelection({...local,lights:[null]}),null);assert.equal(lightSelection({...local,lightSelectionId:32}),null);});
const hostSource=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
test('frozen review completes only explicitly requested local example lights, never live or robot effects',()=>{const jobs=[],events=[],method=hostSource.slice(hostSource.indexOf(' scheduleDevices(){'),hostSource.indexOf('\n music(event)')).trim(),schedule=new Function('setTimeout','clearTimeout',`return ({${method}}).scheduleDevices;`)((callback,delay)=>{jobs.push({callback,delay});return jobs.length;},()=>{}),host={frozenPreview:true,live:false,state:{devices:[{id:'local',kind:'light',exampleOnly:true,pending:{operation:1,action:'turn_off'}},{id:'robot',kind:'vacuum',exampleOnly:true,pending:{operation:2}},{id:'unadmitted',kind:'light',pending:{operation:3}},{id:'real',kind:'light',live:true,exampleOnly:true,pending:{operation:4}}]},dispatch:event=>events.push(event)};schedule.call(host);assert.equal(jobs.length,1);assert.equal(jobs[0].delay,650);jobs[0].callback();assert.equal(events[0].id,'local');assert.equal(events[0].type,'device-result');host.live=true;schedule.call(host);assert.equal(jobs.length,1);});
test('actual Ro projection retains mixed home and an explicitly selected off lamp',()=>{const method=hostSource.slice(hostSource.indexOf(' renderResourceRail(){')+' renderResourceRail(){'.length,hostSource.indexOf("  if($('resource-rail').hidden")),project=new Function('timerPresentation','timersFor','timerStateLabel','timerTime','lightSelection','deviceLabel','devicePresentation',`return function(){${method}return resources;};`)(()=>({visible:[]}),()=>[],()=>'',()=>'',lightSelection,deviceLabel,devicePresentation);const home=start(),selected=select(select(home,'room:kitchen'),'light:kitchen-counter');for(const s of [home,selected]){const rows=project.call({state:{...s,focus:'photo'}});assert.equal(rows.length,1);assert.equal(rows[0].id,'demo-light');assert.equal(rows[0].title,lightSelection(light(s)).title);assert.equal(rows[0].status,lightSelection(light(s)).status);}assert.equal(project.call({state:{...selected,focus:'photo'}})[0].status,'off');});
test('unconfirmed light states keep distinct explanations and never show retained counts as current',()=>{
 const original=light(start());
 for(const [status,detail] of Object.entries({unknown:'Lysstatus ukendt',fault:'Lysstatus kunne ikke hentes',unavailable:'Ikke forbundet'})){
  for(const lightSelectionId of ['home','room:living','light:living-floor']){
   const d={...original,status,lightSelectionId};assert.equal(lightSelection(d).detail,detail);assert.equal(deviceLabel(d),detail);assert.deepEqual(deviceActions(d),[]);
   const choices=lightChoices(d);assert.deepEqual(choices.rooms.items,[],'one unavailable explanation replaces repeated room statuses');assert.deepEqual(choices.lamps.items,[],'unconfirmed lamps are retained in state, not repeated as empty rows');
   assert.equal(d.lights,original.lights,'retain the last observed records without presenting them as current');
  }
 }
});

test('unconnected light shares concise overview status and one honest Home Assistant next step',()=>{const d=unconfiguredLight(),view=devicePresentation(d);assert.equal(view.detail,'Ikke forbundet');assert.match(view.scope,/Home Assistant/);assert.equal(view.power,false);assert.deepEqual(deviceActions(d),[]);assert.equal(lightChoices(d),null);const connected=light(start()),known=devicePresentation(connected);assert.equal(known.detail,'2 af 4 tændt');assert.equal(known.scope,'Hele hjemmet');assert.equal(deviceActions(connected)[0].id,'turn_off');});

test('whole lamp row toggles only its stable local target and rejects stale revisions',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),body=source.match(/ toggleLightOption\(\{sessionId,taskId,revision,optionId\}\)\{([\s\S]*?)\n \}(?=\n)/)[1],toggle=new Function('lightChoices','lightSelection','deviceActions',`return function({sessionId,taskId,revision,optionId}){${body}}`)(lightChoices,lightSelection,deviceActions);
 const host={state:start(),live:false,dispatch(event){this.state=step(this.state,event);}},before=light(host.state),event={...binding(host.state,before),optionId:'light:kitchen-counter'};
 toggle.call(host,event);const pending=light(host.state);assert.equal(pending.pending.action,'turn_on');assert.deepEqual(pending.pending.targetIds,['kitchen-counter']);
 host.state=step(host.state,{type:'device-result',id:pending.id,...pending.pending,time:'12:01'});assert.equal(light(host.state).lights.find(row=>row.id==='kitchen-counter').on,true);
 const current=host.state;toggle.call(host,event);assert.equal(host.state,current,'stale revision cannot toggle again');
 toggle.call(host,{...binding(host.state,light(host.state)),optionId:'light:missing'});assert.equal(host.state,current);
 host.live=true;toggle.call(host,{...binding(host.state,light(host.state)),optionId:'light:kitchen-counter'});assert.equal(host.state,current,'local shortcut never grants live authority');
});


test('room scenes affect exactly the selected room; per-lamp scenes preserve neighbours and reject hidden controls',()=>{
 let s=select(start(),'room:living');const kitchen=light(s).lights.filter(row=>row.roomId==='kitchen'),music=s.music;
 s=step(s,{type:'light-scene',...binding(s,light(s)),optionId:'hygge'});
 assert.deepEqual(light(s).lights.filter(row=>row.roomId==='living').map(row=>row.brightness),[30,30]);
 assert.deepEqual(light(s).lights.filter(row=>row.roomId==='kitchen'),kitchen);assert.equal(s.music,music);assert.equal(light(s).lightSelectionId,'room:living');
 for(const e of [{type:'light-toggle'},{type:'light-brightness',value:90}])assert.equal(step(s,{...e,...binding(s,light(s)),optionId:'kitchen-ceiling'}),s);
 const unchanged=s;s=step(s,{type:'light-scene',...binding(s,light(s)),optionId:'hygge'});assert.equal(s,unchanged,'identical scene does not create a new revision or restart motion');
 s=select(s,'light:living-floor');s=step(s,{type:'light-scene',...binding(s,light(s)),optionId:'all-off'});
 assert.equal(light(s).lights.find(row=>row.id==='living-ceiling').on,true);assert.equal(light(s).lights.find(row=>row.id==='living-floor').on,false);assert.deepEqual(light(s).lights.filter(row=>row.roomId==='kitchen'),kitchen);
});

test('offline area browsing preserves honest last-known data while every command remains blocked',()=>{
 let s=step(start(),{type:'offline'});const records=light(s).lights;
 s=select(s,'room:kitchen');assert.equal(light(s).lightSelectionId,'room:kitchen');assert.equal(light(s).lights,records);
 for(const e of [{type:'light-scene',optionId:'hygge'},{type:'light-toggle',optionId:'kitchen-counter'},{type:'device-action',action:'turn_on'}])assert.equal(step(s,{...e,...binding(s,light(s))}),s);
 const stale={...light(s),stale:true};assert.deepEqual(deviceActions(stale),[]);
});


test('selected lamp Hero uses its room as context without repeating the lamp title',()=>{
 const s=select(start(),'light:living-floor'),d=light(s),shown=devicePresentation(d);
 assert.equal(shown.title,'Gulvlampe');assert.equal(shown.scope,'Stuen');assert.doesNotMatch(shown.scope,/Gulvlampe/);assert.equal(shown.power,true);
});
