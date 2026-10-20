import {robotRoom} from './robot-observation.js';
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
 {id:'living-ceiling',roomId:'living',roomName:'Stuen',name:'Loftlys',on:true},
 {id:'living-floor',roomId:'living',roomName:'Stuen',name:'Gulvlampe',on:true},
 {id:'kitchen-ceiling',roomId:'kitchen',roomName:'Køkkenet',name:'Loftlys',on:false},
 {id:'kitchen-counter',roomId:'kitchen',roomName:'Køkkenet',name:'Bordlys',on:false},
];
export function initialScene(){return {sessionId:'demo-session-1',generation:1,connected:true,focus:'music',navStack:[],music:initialWidgetState(),answers:[],serial:0,pendingAnswer:null,conflict:null,timer:null,extraTimers:[],timerHistory:[],notice:'',devices:[],deviceOperation:0,timerSerial:0};}
export const binding=(s,a)=>({sessionId:s.sessionId,taskId:a.id,revision:a.revision});
const matches=(s,e,a)=>!!a&&e.sessionId===s.sessionId&&e.taskId===a.id&&e.revision===a.revision;
export const focusedAnswer=s=>s.answers.find(a=>a.id===s.focus);
function request(s,kind){const serial=s.serial+1;const id=`demo-answer-${serial}`;const answer={id,revision:1,kind,status:'waiting',selected:'paper-fold',filter:'all',step:0,checked:[],hidden:false,title:kind==='steps'?'Fold et papirfly':kind==='checklist'?'Klar til at lave et kort?':kind==='concise'?'Skal jeg tage en jakke med?':'En pause uden skærm',source:'Lokalt aktivitetseksempel',exampleOnly:true,freshness:'Eksempeldata · planlagte tider',updatedAt:null};if(visualExamples[kind])Object.assign(answer,{title:visualExamples[kind].title,meta:visualExamples[kind].meta,content:validateVisualContent(kind,visualExamples[kind].content)});return {...s,serial,focus:id,answers:[...s.answers.map(a=>['waiting','partial'].includes(a.status)?{...a,status:'interrupted'}:a),answer],pendingAnswer:{id,generation:s.generation},conflict:null,notice:''};}
function sceneBaseTransition(s,e){
 if(['timer-start','timer','tick','timer-notice-dismiss'].includes(e.type))return timerTransition(s,e);
 switch(e.type){
 case 'show': {if(e.id==='player'||e.id==='timers'||e.id==='weather'||e.id==='radio'||e.id==='vehicle'||e.id==='now'||e.id==='music'||e.id==='photo'||s.devices.some(d=>d.id===e.id)||s.answers.some(a=>a.id===e.id&&!a.hidden))return {...s,focus:e.id,detailOrigin:(e.id==='timers'||e.id==='weather'||s.devices.some(d=>d.id===e.id))&&e.id!==s.focus&&s.focus!=='timers'&&s.focus!=='weather'&&!s.devices.some(d=>d.id===s.focus)?s.focus:s.detailOrigin,notice:''};return s;}
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
 case 'music': {if(!s.connected)return s;const music=widgetTransition(s.music,e.event);return music===s.music?s:{...s,music};}
 case 'offline':return {...s,devices:s.devices.map(d=>({...d,pending:null,status:d.pending?'unknown':d.status,revision:d.revision+1})),connected:false,generation:s.generation+1,pendingAnswer:null,music:{...s.music,pending:null,operation:s.music.operation+1,message:s.music.pending?'Udfald ukendt · hent status igen':'Sidst kendte afspilning'},notice:'Offline · viser sidst kendte indhold'};
 // Demo reconnection rotates the session and atomically restores a local snapshot. No actions replay.
 case 'snapshot':if(e.generation!==s.generation||s.connected)return s;return {...s,connected:true,sessionId:`demo-session-${s.generation}`,answers:s.answers.map(a=>['waiting','partial'].includes(a.status)?{...a,status:'error',revision:a.revision+1}:a),notice:'Forbindelsen er tilbage'};
 case 'session-ended':return {...s,devices:s.devices.map(d=>({...d,pending:null,status:d.pending?'unknown':d.status,revision:d.revision+1})),sessionId:`ended-${s.generation+1}`,generation:s.generation+1,pendingAnswer:null,answers:s.answers.map(a=>({...a,status:['waiting','partial'].includes(a.status)?'error':a.status,revision:a.revision+1})),notice:'Musik og timer fortsætter.'};
 case 'hide-resource':return {...s,focus:s.focus===e.id?'now':s.focus,devices:s.devices.map(d=>d.id===e.id?{...d,hidden:true}:d)};
 case 'restore-resources':return {...s,devices:s.devices.map(d=>({...d,hidden:false}))};
 case 'device-demo':{if(!['vacuum','light'].includes(e.kind)||!s.connected)return s;const id=`demo-${e.kind}`;const existing=s.devices.find(d=>d.id===id);if(existing)return {...s,focus:id,devices:s.devices.map(d=>d.id===id?{...d,hidden:false}:d)};return {...s,focus:id,devices:[...s.devices,{id,kind:e.kind,...(e.kind==='light'?{name:'Lys',scope:'home',exampleOnly:true,lightSelectionId:'home',lights:lightExamples.map(row=>({...row}))}:{}),revision:1,status:e.kind==='vacuum'?'cleaning':'mixed',pending:null,hidden:false,timeline:[{id:'initial',label:e.kind==='vacuum'?'Rengøring startet':'Lys i hjemmet',time:e.time}]}]};}
 case 'light-select':{const d=s.devices.find(x=>x.id===e.taskId);if(!s.connected||s.focus!==d?.id||!matches(s,e,d)||d.pending||!lightSelection(d))return s;const choices=lightChoices(d),ids=[...choices.rooms.items,...choices.lamps.items].map(row=>row.id);if(!ids.includes(e.optionId)||e.optionId===d.lightSelectionId)return s;return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,lightSelectionId:e.optionId,revision:x.revision+1}:x)};}
 case 'device-action':{const d=s.devices.find(x=>x.id===e.taskId);if(!s.connected||!matches(s,e,d)||d.pending||!deviceActions(d).some(a=>a.id===e.action))return s;const deviceOperation=s.deviceOperation+1,selection=lightSelection(d);return {...s,deviceOperation,devices:s.devices.map(x=>x.id===d.id?{...x,pending:{operation:deviceOperation,action:e.action,generation:s.generation,...(selection?{targetIds:[...selection.targetIds],scopeLabel:selection.label}:{})}}:x)};}
 case 'device-result':{const d=s.devices.find(x=>x.id===e.id);if(!s.connected||!d?.pending||d.pending.operation!==e.operation||e.generation!==s.generation)return s;if(lightSelection(d)){const on=d.pending.action==='turn_on',lights=d.lights.map(row=>d.pending.targetIds.includes(row.id)?{...row,on}:row),status=lights.every(row=>row.on)?'on':lights.every(row=>!row.on)?'off':'mixed';return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,lights,status,pending:null,revision:x.revision+1,timeline:[...x.timeline,{id:`observed-${e.operation}`,label:`${d.pending.scopeLabel} · ${on?'Tændt':'Slukket'}`,time:e.time}]}:x)};}const status=({pause:'paused',resume:'cleaning',dock:'docking',stop:'stopped',turn_off:'off',turn_on:'on'})[d.pending.action];return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,status,pending:null,revision:x.revision+1,timeline:[...x.timeline,{id:`observed-${e.operation}`,label:deviceLabel({...x,status}),time:e.time}]}:x)};}
 case 'device-observation':{const d=s.devices.find(x=>x.id===e.id);if(!d||!['docked','complete','fault','unknown'].includes(e.status))return s;return {...s,devices:s.devices.map(x=>x.id===d.id?{...x,status:e.status,pending:null,revision:x.revision+1,timeline:[...x.timeline,{id:`observation-${x.revision}`,label:deviceLabel({...x,status:e.status}),time:e.time}]}:x)};}
 default:return s;
 }
}
const validFocus=(s,id)=>['photo','now','music','player','timers','radio','vehicle'].includes(id)||(id==='weather'&&(!s.live||!!s.liveWeather))||s.devices.some(d=>d.id===id&&!d.hidden)||s.answers.some(a=>a.id===id&&!a.hidden);
function navigationBack(s){
 const answer=focusedAnswer(s);if(answer?.originKind)return sceneBaseTransition(s,{type:'answer-action',...binding(s,answer),action:'back',optionId:'back'});
 const stack=[...(s.navStack||[])];let id;while(stack.length){const candidate=stack.pop();if(candidate!==s.focus&&validFocus(s,candidate)){id=candidate;break;}}
 id||=validFocus(s,s.detailOrigin)&&s.detailOrigin!==s.focus?s.detailOrigin:'now';
 return {...s,focus:id,navStack:stack,notice:''};
}
export function sceneTransition(s,e){
 if(['back','device-back'].includes(e.type))return navigationBack(s);
 const next=sceneBaseTransition(s,e);if(next===s||next.focus===s.focus)return next;
 const stack=e.type==='show'&&e.id==='photo'?[]:[...(s.navStack||[]),s.focus].slice(-32);
 return {...next,navStack:stack};
}
export const visibleActivities=a=>ACTIVITIES.filter(x=>a.filter==='all'||(a.filter==='quick'?x.minutes<=20:x.materials===1));

export const deviceLabel=d=>d.kind==='light'&&d.source==='home_assistant_state'&&d.displayState?(d.stale?'Sidst kendt: ':'')+d.displayState:lightSelection(d)?lightSelection(d).detail:d.kind==='light'?(d.stale?'Sidst kendt: ':'')+(({on:'Lys er tændt',off:'Lys er slukket',unavailable:'Ikke forbundet',unknown:'Lysstatus ukendt',fault:'Lysstatus ukendt'})[d.status]||'Lysstatus ukendt'):d.live?(d.stale?'Sidst kendt: ':'')+({cleaning:robotRoom(d)?`Rengør · ${robotRoom(d)}`:'Rengør',paused:'Rengøring på pause',docking:'På vej til basen',docked:'Ved basen',stopped:'Ingen aktiv rengøring',fault:'Robotten melder en fejl',unknown:'Status ukendt',unavailable:'Robotten er ikke tilgængelig'})[d.status]:({cleaning:'Rengør',paused:'Rengøring på pause',docking:'På vej til basen',docked:'Ved basen',complete:'Rengøring afsluttet',fault:'Børste blokeret · se enheden',unknown:'Udfald ukendt · hent status igen',stopped:'Rengøring stoppet',on:'Lyset er tændt',off:'Lyset er slukket'})[d.status]||'Status ukendt';
// One device presentation is shared by Ro, overview and detail; density belongs to the renderer.
export function devicePresentation(d){
 const selection=lightSelection(d),battery=d.kind==='vacuum'&&!d.presentationOnly&&Number.isFinite(d.battery)&&d.battery>=0&&d.battery<=100?`${d.battery} %`:'';
 return {id:d.id,kind:d.kind,target:d.presentationOnly?undefined:d.id,title:d.kind==='vacuum'?'Robotstøvsuger':selection?.title||d.name||'Lys',status:d.pending?'pending':selection?.status||d.status,resourceStatus:selection?.status||d.status,detail:deviceLabel(d),value:battery,scope:d.kind==='light'&&d.status==='unavailable'?'Forbind lys via Home Assistant for at se og styre dem her.':selection?.label||(d.kind==='light'?'Hele hjemmet':''),power:selection?.power??(d.status==='on'),disabled:d.presentationOnly===true};
}
export function deviceActions(d){if(d.live)return [];if(d.kind==='light'){const selection=lightSelection(d);if(selection){if(!['on','off','mixed'].includes(selection.status))return [];const off=selection.power;return [{id:off?'turn_off':'turn_on',label:selection.kind==='home'?(off?'Sluk alt lys':'Tænd alt lys'):selection.kind==='room'?`${off?'Sluk':'Tænd'} lys · ${selection.label}`:`${off?'Sluk':'Tænd'} ${selection.label}`}];}return ['on','off'].includes(d.status)?[{id:d.status==='on'?'turn_off':'turn_on',label:d.scope==='home'?(d.status==='on'?'Sluk alt lys':'Tænd alt lys'):(d.status==='on'?'Sluk lys':'Tænd lys')}]:[];}return ({cleaning:[{id:'pause',label:'Pause rengøring'},{id:'dock',label:'Til basen'},{id:'stop',label:'Stop rengøring'}],paused:[{id:'resume',label:'Fortsæt rengøring'},{id:'dock',label:'Til basen'}],docking:[{id:'stop',label:'Stop robot'}]})[d.status]||[];}


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
