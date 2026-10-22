import {vehiclePreviewAction} from './vehicle-model.js';
import {robotRoom,robotValue} from './robot-observation.js';
import {visualExamples} from './visual-examples.js';
import {visualFamilies,validateVisualContent} from './visual-content.js';
import {timerTransition} from './timer-model.js';
import {initialWidgetState, widgetTransition} from './widget-model.js';

// Stable fixture IDs are shared by touch and visual actions. These are local examples.
export const ACTIVITIES = [
 {id:'paper-fold',icon:'paper-plane',title:'Fold papir',minutes:15,materials:1,description:'Et ark papir og plads ved bordet.',steps:['Find et ark papir, og læg det på bordet.','Fold arket på midten, og åbn det igen.','Fold de to øverste hjørner ind mod midten.','Fold siderne ind igen. Fold midten, og giv flyet vinger.']},
 {id:'draw-together',icon:'pencil',title:'Tegn sammen',minutes:20,materials:2,description:'Papir og farver. Skift til at tegne.',steps:['Find papir og farver.','Tegn en form, og giv papiret videre.','Byg videre på hinandens tegning.','Giv tegningen et navn sammen.']},
 {id:'make-card',icon:'card',title:'Lav et kort',minutes:30,materials:3,description:'Papir, farver og lim til et lille kort.',steps:['Find papir, farver og lim.','Fold papiret som et kort.','Tegn eller lim noget på forsiden.','Skriv en hilsen indeni.']},
];
export const FORMATS = ['comparison','concise','choices','chart','steps','checklist',...visualFamilies];
// Local examples only. These IDs are not HA entities, area IDs or device grants.
const lightExamples=[
 {id:'living-ceiling',roomId:'living',roomName:'Stuen',name:'Loftlys',on:true,dimmable:true,brightness:80},
 {id:'living-floor',roomId:'living',roomName:'Stuen',name:'Gulvlampe',on:true,dimmable:true,brightness:60},
 {id:'kitchen-ceiling',roomId:'kitchen',roomName:'Køkkenet',name:'Loftlys',on:false,dimmable:true,brightness:0},
 {id:'kitchen-counter',roomId:'kitchen',roomName:'Køkkenet',name:'Bordlys',on:false,dimmable:false},
];
export function initialScene(){return {sessionId:'demo-session-1',generation:1,connected:true,focus:'music',navStack:[],music:initialWidgetState(),answers:[],serial:0,pendingAnswer:null,conflict:null,timer:null,extraTimers:[],timerHistory:[],notice:'',devices:[],deviceOperation:0,timerSerial:0};}
export const binding=(s,a)=>({sessionId:s.sessionId,taskId:a.id,revision:a.revision});
const matches=(s,e,a)=>!!a&&e.sessionId===s.sessionId&&e.taskId===a.id&&e.revision===a.revision;
export const focusedAnswer=s=>s.answers.find(a=>a.id===s.focus);
function request(s,kind){const serial=s.serial+1;const id=`demo-answer-${serial}`;const answer={id,revision:1,kind,status:'waiting',selected:'paper-fold',filter:'all',step:0,checked:[],hidden:false,title:kind==='steps'?'Fold et papirfly':kind==='checklist'?'Klar til at lave et kort?':kind==='concise'?'Skal jeg tage en jakke med?':'En pause uden skærm',source:'Lokalt aktivitetseksempel',exampleOnly:true,freshness:'Eksempeldata · planlagte tider',updatedAt:null};if(visualExamples[kind])Object.assign(answer,{title:visualExamples[kind].title,meta:visualExamples[kind].meta,content:validateVisualContent(kind,visualExamples[kind].content)});return {...s,serial,focus:id,answers:[...s.answers.map(a=>['waiting','partial'].includes(a.status)?{...a,status:'interrupted'}:a),answer],pendingAnswer:{id,generation:s.generation},conflict:null,notice:''};}
function sceneBaseTransition(s,e){
 if(['timer-start','timer','tick','timer-notice-dismiss'].includes(e.type))return timerTransition(s,e);
 switch(e.type){
 case 'show': {if(['podview-light-empty','podview-vacuum-empty'].includes(e.id)&&!s.devices.some(d=>d.id===e.id)){const kind=e.id==='podview-light-empty'?'light':'vacuum';if(s.devices.some(d=>d.kind===kind))return s;return {...s,focus:e.id,detailOrigin:s.focus,notice:'',devices:[...s.devices,{id:e.id,kind,revision:1,status:'unavailable',live:true,presentationOnly:true,pending:null,hidden:false,timeline:[]}]};}if(e.id==='player'||e.id==='timers'||e.id==='weather'||e.id==='radio'||e.id==='vehicle'||e.id==='now'||e.id==='music'||e.id==='photo'||s.devices.some(d=>d.id===e.id)||s.answers.some(a=>a.id===e.id&&!a.hidden))return {...s,focus:e.id,detailOrigin:(e.id==='timers'||e.id==='weather'||s.devices.some(d=>d.id===e.id))&&e.id!==s.focus&&s.focus!=='timers'&&s.focus!=='weather'&&!s.devices.some(d=>d.id===s.focus)?s.focus:s.detailOrigin,notice:''};return s;}
 case 'device-back':return navigationBack(s);
 case 'request': {if(!s.connected||!FORMATS.includes(e.kind))return s;const a=focusedAnswer(s);if(a&&['steps','checklist'].includes(a.kind)&&a.status!=='done'&&!e.resolved)return {...s,conflict:{kind:e.kind}};return request(s,e.kind);}
 case 'conflict':if(!s.conflict)return s;return e.choice==='replace'?request(s,s.conflict.kind):{...s,conflict:null};
 case 'answer-result': {if(!s.pendingAnswer||e.id!==s.pendingAnswer.id||e.generation!==s.generation||!['partial','ready','error','empty'].includes(e.status))return s;return {...s,pendingAnswer:e.status==='partial'?s.pendingAnswer:null,answers:s.answers.map(a=>a.id===e.id?{...a,status:e.status,updatedAt:e.at??null}:a)};}
 case 'answer-action': {const a=s.answers.find(a=>a.id===e.taskId);if(!s.connected||!matches(s,e,a)||!['ready','done'].includes(a.status)||visualFamilies.includes(a.kind))return s;let patch;
 if(e.action==='filter'&&['all','quick','few'].includes(e.optionId)){const options=visibleActivities({...a,filter:e.optionId});patch={filter:e.optionId,selected:options.some(x=>x.id===a.selected)?a.selected:options[0]?.id||a.selected};}
 if(e.action==='choose'&&ACTIVITIES.some(x=>x.id===e.optionId)&&visibleActivities(a).some(x=>x.id===e.optionId))patch={selected:e.optionId};
 if(e.action==='guide'&&ACTIVITIES.some(x=>x.id===e.optionId))patch={originKind:a.kind,originTitle:a.title,selected:e.optionId,kind:'steps',title:ACTIVITIES.find(x=>x.id===e.optionId).title,step:0,status:'ready'};
 if(e.action==='back'&&a.originKind)patch={kind:a.originKind,title:a.originTitle,originKind:null};
 if(e.action==='step'&&['back','next'].includes(e.optionId)){const n=ACTIVITIES.find(x=>x.id===a.selected).steps.length;patch={step:Math.max(0,Math.min(n-1,a.step+(e.optionId==='next'?1:-1))),status:'ready'};}
 if(e.action==='finish'&&a.kind==='steps'&&a.step===ACTIVITIES.find(x=>x.id===a.selected).steps.length-1)patch={status:'done'};
 if(e.action==='check'&&['paper','colors','glue'].includes(e.optionId)&&a.kind==='checklist'){const checked=a.checked.includes(e.optionId)?a.checked.filter(x=>x!==e.optionId):[...a.checked,e.optionId];patch={checked,status:checked.length===3?'done':'ready'};}
 if(!patch)return s;return {...s,answers:s.answers.map(x=>x.id===a.id?{...x,...patch,revision:x.revision+1}:x)};}
 case 'hide':return {...s,focus:s.focus===e.id?'now':s.focus,answers:s.answers.map(a=>a.id===e.id?{...a,hidden:true}:a)};
 case 'music': {if(!s.connected&&!['collection','filter','collapse'].includes(e.event?.type))return s;const music=widgetTransition(s.music,e.event);return music===s.music?s:{...s,music};}
 case 'offline':return {...s,devices:s.devices.map(d=>({...d,pending:null,status:d.pending?'unknown':d.status,revision:d.revision+1})),connected:false,generation:s.generation+1,pendingAnswer:null,music:{...s.music,pending:null,operation:s.music.operation+1,message:s.music.pending?'Udfald ukendt · hent status igen':'Sidst kendte afspilning'},notice:'Offline · viser sidst kendte indhold'};
 // Demo reconnection rotates the session and atomically restores a local snapshot. No actions replay.
 case 'snapshot':if(e.generation!==s.generation||s.connected)return s;return {...s,connected:true,music:s.music.message==='Sidst kendte afspilning'?{...s.music,message:''}:s.music,sessionId:`demo-session-${s.generation}`,answers:s.answers.map(a=>['waiting','partial'].includes(a.status)?{...a,status:'error',revision:a.revision+1}:a),notice:'Forbindelsen er tilbage'};
 case 'session-ended':return {...s,devices:s.devices.map(d=>({...d,pending:null,status:d.pending?'unknown':d.status,revision:d.revision+1})),sessionId:`ended-${s.generation+1}`,generation:s.generation+1,pendingAnswer:null,answers:s.answers.map(a=>({...a,status:['waiting','partial'].includes(a.status)?'error':a.status,revision:a.revision+1})),notice:'Musik og timer fortsætter.'};
 case 'hide-resource':return {...s,focus:s.focus===e.id?'now':s.focus,devices:s.devices.map(d=>d.id===e.id?{...d,hidden:true}:d)};
 case 'restore-resources':return {...s,devices:s.devices.map(d=>({...d,hidden:false}))};
 case 'device-demo':{if(!['vacuum','light'].includes(e.kind)||!s.connected)return s;const id=`demo-${e.kind}`;const existing=s.devices.find(d=>d.id===id);if(existing)return {...s,focus:id,devices:s.devices.map(d=>d.id===id?{...d,hidden:false}:d)};return {...s,focus:id,devices:[...s.devices,{id,kind:e.kind,...(e.kind==='light'?{name:'Lys',scope:'home',exampleOnly:true,lightSelectionId:'home',lights:lightExamples.map(row=>({...row}))}:{}),revision:1,status:e.kind==='vacuum'?'cleaning':'mixed',pending:null,hidden:false,timeline:[{id:'initial',label:e.kind==='vacuum'?'Rengøring startet':'Lys i hjemmet',time:e.time}]}]};}
 case 'vehicle-control':{if(!s.connected||s.focus!=='vehicle'||e.sessionId!==s.sessionId)return s;const vehicle=vehiclePreviewAction(s.vehicle,e);return vehicle===s.vehicle?s:{...s,vehicle};}
 case 'light-toggle':case 'light-brightness':case 'light-scene':{const d=s.devices.find(x=>x.id===e.taskId);if(!s.connected||s.focus!==d?.id||!matches(s,e,d)||d.live||!d.exampleOnly||d.pending||d.stale||!['on','off','mixed'].includes(d.status)||!Array.isArray(d.lights))return s;
 const selection=lightSelection(d);if(!selection)return s;
 let lights;
 if(e.type==='light-toggle'){if(!selection.targetIds.includes(e.optionId))return s;lights=d.lights.map(row=>row.id===e.optionId?{...row,on:!row.on,...(row.dimmable&&!row.on?{brightness:row.brightness>0?row.brightness:60}:{})}:row);}
 else if(e.type==='light-brightness'){if(!Number.isInteger(e.value)||e.value<0||e.value>100||!selection.targetIds.includes(e.optionId)||!d.lights.some(row=>row.id===e.optionId&&row.dimmable===true))return s;lights=d.lights.map(row=>row.id===e.optionId?{...row,brightness:e.value,on:e.value>0}:row);}
 else {const level=({hygge:30,middag:80,'all-off':0})[e.optionId];if(level===undefined)return s;lights=d.lights.map(row=>selection.targetIds.includes(row.id)?{...row,on:level>0,...(row.dimmable?{brightness:level}:{})}:row);}
 if(lights.every((row,index)=>row.on===d.lights[index].on&&row.brightness===d.lights[index].brightness))return s;
 const status=lights.every(row=>row.on)?'on':lights.every(row=>!row.on)?'off':'mixed';return {...s,devices:s.devices.map(row=>row===d?{...d,lights,status,revision:d.revision+1}:row)};}
 case 'light-select':{const d=s.devices.find(x=>x.id===e.taskId);if(s.focus!==d?.id||!matches(s,e,d)||d.pending||!lightSelection(d))return s;const choices=lightChoices(d),ids=[...choices.rooms.items,...choices.lamps.items].map(row=>row.id);if(!ids.includes(e.optionId)||e.optionId===d.lightSelectionId)return s;return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,lightSelectionId:e.optionId,revision:x.revision+1}:x)};}
 case 'device-action':{const d=s.devices.find(x=>x.id===e.taskId);if(!s.connected||!matches(s,e,d)||d.pending||!deviceActions(d).some(a=>a.id===e.action))return s;const deviceOperation=s.deviceOperation+1,selection=lightSelection(d);return {...s,deviceOperation,devices:s.devices.map(x=>x.id===d.id?{...x,pending:{operation:deviceOperation,action:e.action,generation:s.generation,...(selection?{targetIds:[...selection.targetIds],scopeLabel:selection.label}:{})}}:x)};}
 case 'device-result':{const d=s.devices.find(x=>x.id===e.id);if(!s.connected||!d?.pending||d.pending.operation!==e.operation||e.generation!==s.generation)return s;if(lightSelection(d)){const on=d.pending.action==='turn_on',lights=d.lights.map(row=>d.pending.targetIds.includes(row.id)?{...row,on,...(row.dimmable&&on?{brightness:row.brightness>0?row.brightness:60}:{})}:row),status=lights.every(row=>row.on)?'on':lights.every(row=>!row.on)?'off':'mixed';return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,lights,status,pending:null,revision:x.revision+1,timeline:[...x.timeline,{id:`observed-${e.operation}`,label:`${d.pending.scopeLabel} · ${on?'Tændt':'Slukket'}`,time:e.time}]}:x)};}const status=({pause:'paused',resume:'cleaning',dock:'docking',stop:'stopped',turn_off:'off',turn_on:'on'})[d.pending.action];return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,status,pending:null,revision:x.revision+1,timeline:[...x.timeline,{id:`observed-${e.operation}`,label:deviceLabel({...x,status}),time:e.time}]}:x)};}
 case 'device-observation':{const d=s.devices.find(x=>x.id===e.id);if(!d||!['docked','complete','fault','unknown'].includes(e.status))return s;return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,status:e.status,pending:null,revision:x.revision+1,timeline:[...x.timeline,{id:`observation-${x.revision}`,label:deviceLabel({...x,status:e.status}),time:e.time}]}:x)};}
 default:return s;
 }
}
// Back follows the fixed household hierarchy, independent of entry origin.
// Retained tasks/resources are not rewritten when leaving their detail.
function navigationBack(s){
 if(s.focus==='photo'&&!(s.navStack?.length)&&!s.detailOrigin&&!s.notice)return s;
 return {...s,focus:s.focus==='now'||s.focus==='photo'?'photo':'now',navStack:[],detailOrigin:null,notice:''};
}
export function sceneTransition(s,e){
 if(['back','device-back'].includes(e.type))return navigationBack(s);
 const next=sceneBaseTransition(s,e);if(next===s||next.focus===s.focus)return next;
 const stack=e.type==='show'&&e.id==='photo'?[]:[...(s.navStack||[]),s.focus].slice(-32);
 return {...next,navStack:stack};
}
export const visibleActivities=a=>ACTIVITIES.filter(x=>a.filter==='all'||(a.filter==='quick'?x.minutes<=20:x.materials===1));

export const deviceLabel=d=>d.kind==='light'&&d.source==='home_assistant_state'&&d.displayState?(d.stale?'Sidst kendt: ':'')+d.displayState:lightSelection(d)?lightSelection(d).detail:d.kind==='light'?(d.stale?'Sidst kendt: ':'')+(({on:'Lys er tændt',off:'Lys er slukket',unavailable:'Ikke forbundet',unknown:'Lysstatus ukendt',fault:'Lysstatus ukendt'})[d.status]||'Lysstatus ukendt'):d.live?(d.stale?'Sidst kendt: ':'')+({cleaning:robotRoom(d)?`Rengør · ${robotRoom(d)}`:'Rengør',paused:'Rengøring på pause',docking:'På vej til basen',docked:'Ved basen',stopped:'Ingen aktiv rengøring',fault:'Robotten melder en fejl',unknown:'Status ukendt',unavailable:'Robotten er ikke tilgængelig'})[d.status]:({cleaning:'Rengør',paused:'Rengøring på pause',docking:'På vej til basen',docked:'Ved basen',complete:'Rengøring afsluttet',fault:'Børste blokeret · se enheden',unknown:'Udfald ukendt · hent status igen',stopped:'Rengøring stoppet',on:'Lyset er tændt',off:'Lyset er slukket'})[d.status]||'Status ukendt';
// Bounded read-only metadata for the existing sized Card/Tile anatomy. Missing
// telemetry is omitted; a status or accepted command never manufactures a fact.
export function deviceOverviewFacts(d,now=Date.now()/1000){
 const facts=[];let context='';if(!d||d.presentationOnly)return {facts,context};
 if(d.kind==='vacuum'){
  const active=['cleaning','paused'].includes(d.status),rows=d.telemetry?.status==='observed'&&Array.isArray(d.telemetry.items)?d.telemetry.items:[],byKey=new Map(rows.filter(row=>Number.isFinite(row.updatedAt)&&row.updatedAt<=now+1).map(row=>[row.key,row]));
  for(const [id,label]of [['current_room',active?'Rum':'Senest observeret rum'],['cleaning_area',active?'Rengjort areal':'Seneste areal'],['cleaning_time',active?'Forløbet':'Seneste varighed'],['clean_percent','Fremdrift'],['battery','Batteri'],['cleaning_mode','Tilstand'],['selected_map','Kort'],['last_clean_end','Senest afsluttet'],['last_clean_start','Senest startet']]){
   const row=byKey.get(id);if(!row||row.value===null||row.value===undefined||row.value==='')continue;const stale=d.stale===true||row.stale===true||now-row.updatedAt>300;
   if(['current_room','clean_percent'].includes(id)&&(!active||stale))continue;
   const timestamp=id==='last_clean_end'||id==='last_clean_start';if(timestamp&&(!Number.isFinite(row.value)||row.value<=0||row.value>now+1))continue;
   const value=timestamp?new Date(row.value*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):robotValue(row);
   facts.push({id:id==='current_room'?'room':id==='clean_percent'?'progress':id,label,value,stale});
  }
  if(!facts.some(fact=>fact.id==='battery')&&Number.isFinite(d.battery)&&d.battery>=0&&d.battery<=100)facts.splice(Math.min(3,facts.length),0,{id:'battery',label:'Batteri',value:`${d.battery.toLocaleString('da-DK')} %`,stale:d.stale===true});
  const end=byKey.get('last_clean_end');if(end&&Number.isFinite(end.value)&&end.value>0&&end.value<=now+1)context=[`Senest afsluttet ${new Date(end.value*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`,byKey.get('selected_map')?.value].filter(Boolean).join(' · ');
 }else if(d.kind==='light'){
  const selection=lightSelection(d),local=selection&&d.exampleOnly===true&&!d.live,rows=local?d.lights.filter(row=>selection.targetIds.includes(row.id)):d.source==='home_assistant_state'&&Array.isArray(d.observedLights)?d.observedLights:[],stale=d.stale===true||['unknown','fault','unavailable'].includes(d.status);
  if(!rows.length)return {facts,context};const known=rows.filter(row=>local||['on','off'].includes(row.state));
  if(known.length)facts.push({id:'on-count',label:known.length===rows.length?'Tændt':'Bekræftet tændt',value:`${known.filter(row=>local?row.on:row.state==='on').length} af ${rows.length}`,stale});
  if(local){const rooms=[...new Set(rows.map(row=>row.roomName))];facts.push({id:'rooms',label:rooms.length===1?'Rum':'Rum med lys',value:rooms.join(' · '),stale});}
  for(const row of known){const on=local?row.on:row.state==='on',brightness=row.brightness;if(!on||!Number.isFinite(brightness)||brightness<0||brightness>(local?100:255))continue;facts.push({id:`brightness:${row.id||row.entityId}`,label:local?`${row.roomName} · ${row.name}`:row.name,value:`${Math.round(local?brightness:brightness/255*100)} %`,stale});}
  context=selection?.kind==='light'?selection.label:'';
 }
 return {facts,context};
}
// One device presentation is shared by Ro, overview and detail; density belongs to the renderer.
// One factual metadata role for the Robot Hero in panel and detail.
export function robotDetailMetadata(device,now=Date.now()/1000){
 const facts=deviceOverviewFacts({...device,kind:'vacuum'},now).facts,format=row=>`${row.value}${row.stale?' · sidst kendt':''}`,battery=facts.find(row=>row.id==='battery'),measurements=['cleaning_area','cleaning_time'].map(id=>facts.find(row=>row.id===id)).filter(Boolean).map(format).join(' · '),active=['cleaning','paused'].includes(device?.status);
 return [battery?`Batteri ${format(battery)}`:'',measurements?`${active?'':'Senest: '}${measurements}`:''].filter(Boolean).join(' · ');
}
export function devicePresentation(d){
 const selection=lightSelection(d),battery=d.kind==='vacuum'&&!d.presentationOnly&&Number.isFinite(d.battery)&&d.battery>=0&&d.battery<=100?`${d.battery} %`:'';
 const clean=d.kind==='vacuum'&&!d.presentationOnly&&!d.stale&&d.status==='cleaning'&&d.telemetry?.status==='observed'&&Array.isArray(d.telemetry.items)?d.telemetry.items.find(row=>row.key==='clean_percent'):null,now=Date.now()/1000;
 const progress=clean&&clean.unit==='%'&&clean.stale===false&&Number.isFinite(clean.updatedAt)&&clean.updatedAt>=0&&clean.updatedAt<=now+1&&now-clean.updatedAt<=300&&Number.isFinite(clean.value)&&clean.value>=0&&clean.value<=100?clean.value:undefined;
 return {...deviceOverviewFacts(d),id:d.id,kind:d.kind,target:d.presentationOnly?undefined:d.id,title:d.kind==='vacuum'?'Robotstøvsuger':selection?.title||d.name||'Lys',status:d.pending?'pending':selection?.status||d.status,resourceStatus:selection?.status||d.status,detail:deviceLabel(d),value:battery,...(progress!==undefined?{progress}:{}),scope:d.kind==='light'&&d.status==='unavailable'?'Forbind lys i Home Assistant for at se og styre dem her.':(selection?.kind==='light'?d.lights.find(lamp=>selection.targetIds.includes(lamp.id))?.roomName:selection?.label)||(d.kind==='light'?'Hele hjemmet':''),power:selection?.power??(d.status==='on'),disabled:d.presentationOnly===true};
}
export function deviceActions(d){if(d.live)return [];if(d.kind==='light'){if(d.stale)return [];const selection=lightSelection(d);if(selection){if(!['on','off','mixed'].includes(selection.status))return [];const off=selection.power;return [{id:off?'turn_off':'turn_on',label:selection.kind==='home'?(off?'Sluk alt lys':'Tænd alt lys'):selection.kind==='room'?`${off?'Sluk':'Tænd'} lys · ${selection.label}`:`${off?'Sluk':'Tænd'} ${selection.label}`}];}return ['on','off'].includes(d.status)?[{id:d.status==='on'?'turn_off':'turn_on',label:d.scope==='home'?(d.status==='on'?'Sluk alt lys':'Tænd alt lys'):(d.status==='on'?'Sluk lys':'Tænd lys')}]:[];}return ({cleaning:[{id:'pause',label:'Pause rengøring'},{id:'dock',label:'Til basen'},{id:'stop',label:'Stop rengøring'}],paused:[{id:'resume',label:'Fortsæt rengøring'},{id:'dock',label:'Til basen'}],docking:[{id:'stop',label:'Stop robot'}]})[d.status]||[];}


const lightUnconfirmedDetail={unknown:'Lysstatus ukendt',fault:'Lysstatus kunne ikke hentes',unavailable:'Ikke forbundet'};
export function lightSelection(d){
 if(d?.kind!=='light'||d.live===true||d.exampleOnly!==true||!Array.isArray(d.lights)||d.lights.length<1||d.lights.length>16||d.lights.some(row=>!row||typeof row.id!=='string'||typeof row.roomId!=='string'||typeof row.roomName!=='string'||typeof row.name!=='string'||typeof row.on!=='boolean')||new Set(d.lights.map(row=>row.id)).size!==d.lights.length)return null;
 const id=d.lightSelectionId||'home';if(typeof id!=='string')return null;const lamp=id.startsWith('light:')?d.lights.find(row=>`light:${row.id}`===id):null,roomId=lamp?.roomId||(id.startsWith('room:')?id.slice(5):id==='home'?'home':null),lights=id==='home'?d.lights:lamp?[lamp]:d.lights.filter(row=>row.roomId===roomId);
 if(!lights.length||!roomId)return null;
 const kind=lamp?'light':id==='home'?'home':'room',roomName=lights[0].roomName,label=lamp?`${roomName} · ${lamp.name}`:kind==='home'?'Hele hjemmet':roomName,onCount=lights.filter(row=>row.on).length,total=lights.length,status=['unknown','fault','unavailable'].includes(d.status)?d.status:onCount===0?'off':onCount===total?'on':'mixed';
 return {id,kind,roomId,title:lamp?lamp.name:kind==='home'?'Lys':`Lys · ${roomName}`,label,detail:lightUnconfirmedDetail[status]|| (total===1?(onCount?'Tændt':'Slukket'):`${onCount} af ${total} tændt`),status,power:['on','mixed'].includes(status),onCount,total,targetIds:lights.map(row=>row.id),exampleOnly:true};
}
export function lightChoices(d){
 const selected=lightSelection(d);if(!selected)return null;const unconfirmed=lightUnconfirmedDetail[selected.status];if(unconfirmed)return {rooms:{selected:null,items:[]},lamps:{selected:null,items:[]}};
 const rooms=[{id:'home',label:'Hele hjemmet',detail:unconfirmed||`${d.lights.filter(row=>row.on).length} af ${d.lights.length} tændt`,icon:'lightbulb'}];
 for(const roomId of new Set(d.lights.map(row=>row.roomId))){const rows=d.lights.filter(row=>row.roomId===roomId);rooms.push({id:`room:${roomId}`,label:rows[0].roomName,detail:unconfirmed||`${rows.filter(row=>row.on).length} af ${rows.length} tændt`,icon:'lightbulb'});}
 return {rooms:{selected:selected.roomId==='home'?'home':`room:${selected.roomId}`,items:rooms},lamps:{selected:selected.kind==='light'?selected.id:null,items:d.lights.filter(row=>selected.roomId==='home'||row.roomId===selected.roomId).map(row=>({id:`light:${row.id}`,label:selected.roomId==='home'?`${row.roomName} · ${row.name}`:row.name,detail:unconfirmed||(row.on?'Tændt':'Slukket'),status:unconfirmed?selected.status:row.on?'on':'off',icon:'lightbulb'}))}};
}

// Rank only known overview destinations. The host snapshots this when entering
// overview, so incoming observations never move a card under an active finger.
export function overviewPriorities({timers=[],devices=[],mediaActive=false}={}){
 const activeTimer=timers.some(timer=>!timer.hidden&&['running','paused','done'].includes(timer.status));
 // Geometry follows stable function slots. State changes appearance only,
 // never order: timer, weather/robot, lights/vehicle, music/radio.
 const cards=[{id:'timer-card',priority:activeTimer?'active':'useful'},{id:'home-weather',priority:'useful'}];
 const deviceCards=devices.filter(device=>!device.hidden).map(device=>{
  const unavailable=device.presentationOnly===true||['unavailable','unknown'].includes(device.status),active=!!device.pending||(device.kind==='vacuum'&&['cleaning','paused','docking','fault'].includes(device.status));
  return {id:device.id,kind:device.kind,priority:active?'active':unavailable?'unavailable':'useful'};
 });
 cards.push(...deviceCards.filter(device=>device.kind==='vacuum'),...deviceCards.filter(device=>device.kind!=='vacuum'),{id:'home-vehicle',priority:'unavailable'},{id:'home-music',priority:mediaActive?'secondary':'useful'},{id:'home-radio',priority:'secondary'});
 return cards.map(({id,priority},index)=>({id,priority,rank:index+1}));
}
