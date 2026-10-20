import {visualHistoryExamples} from './visual-examples.js';
import {validateVisualContent} from './visual-content.js';
import {visualFamilies} from './visual-content.js';
import {FORMATS,initialScene,sceneTransition as step} from './scene-model.js';
import {vehicleFixture} from './vehicle-model.js';
import {localRadioTransition} from './radio-model.js';
// Deterministic, explicitly documented prototype states; no integrations or requests.
export const playerPreviewStates=['empty','loading','missing-art','offline','error'].flatMap(state=>['rest','active'].map(mode=>`player-${mode}-${state}`));
export const headerPreviewPhases={listening:'LISTENING',thinking:'THINKING',speaking:'AI_SPEAKING',ready:'LOUNGE_WINDOW',closing:'CLOSING',waiting:'UNKNOWN'};
export const devicePreviewStatuses={light:['off','on','mixed','pending','unknown','fault','unavailable'],robot:['docked','cleaning','paused','docking','stopped','pending','unknown','fault']};
export const devicePreviewStates=Object.entries(devicePreviewStatuses).flatMap(([kind,statuses])=>statuses.flatMap(status=>['detail','overview','rest'].map(layer=>`${kind}-${layer}-${status}`)));
export const deviceOfflinePreviewStates=['robot','light'].flatMap(kind=>['detail','overview','rest'].map(layer=>`${kind}-${layer}-offline`));
export const timerPreviewStates=['detail','overview','rest'].flatMap(layer=>['empty','running','finished','multiple','stale'].map(state=>`timer-${layer}-${state}`));
export const musicPreviewStates=['mood','feeling','top','recent','paused','refreshing','refresh-error','refresh-empty'].map(state=>`music-${state}`);
export const radioPreviewStates=['ready','selected','paused','offline'].map(state=>`radio-${state}`);
export const weatherPreviewStates=['ready','empty','stale'].map(state=>`weather-${state}`);
export const answerPreviewStatuses=['ready','waiting','partial','empty','error','offline','interrupted'];
export const answerPreviewStates=FORMATS.flatMap(format=>answerPreviewStatuses.map(state=>`answer-${format}-${state}`)).concat(['answer-fact-card-long','answer-steps-complete','answer-checklist-complete']);
export const conversationPreviewStates=['overview','listening','working','speaking','visual','late','complete','interrupted','followup','long','resume','timer-finished','offline','reconnecting','reconnected','visual-error'].map(state=>`conversation-${state}`);
export const coexistencePreviewStates=['conversation-visual-timer-finished','conversation-long-timer-finished'];
export const firstRunPreviewStates=['first-connecting','first-unavailable','first-denied','first-empty'];
export const previewStates=[...firstRunPreviewStates,...conversationPreviewStates,...coexistencePreviewStates,...devicePreviewStates,...deviceOfflinePreviewStates,...timerPreviewStates,...musicPreviewStates,...radioPreviewStates,...weatherPreviewStates,...answerPreviewStates,'vehicle-unconnected','vehicle-charging','vehicle-charging-overview','activities-combined',...Object.keys(headerPreviewPhases).map(phase=>`header-${phase}`),...playerPreviewStates,'visual-history','now',...visualFamilies,'timers','quiet','night','weather','top','stack','music-stack','rest','music','waiting','partial','ready','empty','error','pending','offline','unknown','complete','vacuum','light','listening','connecting','ended','nothing','paused'];
export function previewScene(name,now=Date.now()){
 if(firstRunPreviewStates.includes(name)){const connectionPreview=name==='first-empty'?{status:'connected',snapshot:{capabilities:{homeRead:[],musicRead:[],timerActions:[],answerRead:false}}}:{status:name==='first-connecting'?'connecting':'disconnected',blocked:name==='first-denied'};const scene=initialScene();return {...scene,music:{...scene.music,playback:{...scene.music.playback,active:false,playing:false}},focus:'now',connected:false,weatherPreview:'empty',connectionPreview,devices:[],timer:null,extraTimers:[],answers:[]};}
 if(coexistencePreviewStates.includes(name)){
  let s=conversationPreviewScene('conversation-visual',now);
  if(name==='conversation-long-timer-finished'){
   const long=answerPreviewScene('answer-fact-card-long').answers[0];
   s={...s,answers:s.answers.map(answer=>({...answer,title:long.title,weatherPresentation:undefined,content:long.content}))};
  }
  return step(s,{type:'tick',now:s.timer.deadline});
 }
 if(conversationPreviewStates.includes(name)){
  let s=conversationPreviewScene(name,now);
  if(['conversation-long','conversation-resume'].includes(name)){const long=answerPreviewScene('answer-fact-card-long').answers[0];s={...s,answers:s.answers.map(answer=>({...answer,title:long.title,weatherPresentation:undefined,content:long.content}))};}
  if(name==='conversation-timer-finished')s=step(s,{type:'tick',now:s.timer.deadline});
  if(['conversation-offline','conversation-reconnecting'].includes(name))s=step(s,{type:'offline'});
  if(name==='conversation-reconnecting')s={...s,notice:'Genopretter forbindelsen…'};
  if(name==='conversation-visual-error')s={...s,notice:'Det nye visuelle svar kunne ikke vises. Det tidligere svar bliver stående.'};
  return s;
 }
 if(timerPreviewStates.includes(name))return timerPreviewScene(name,now);
 if(musicPreviewStates.includes(name))return musicPreviewScene(name);
 if(radioPreviewStates.includes(name))return radioPreviewScene(name);
 if(weatherPreviewStates.includes(name))return {...step(initialScene(),{type:'show',id:'weather'}),weatherPreview:name.slice('weather-'.length)};
 if(answerPreviewStates.includes(name))return answerPreviewScene(name);
 if(name==='activities-combined')return {...devicePreviewScene(timerPreviewScene('timer-overview-running',now),'robot-overview-cleaning'),vehicle:vehicleFixture({charging:true,now})};
 if(['vehicle-charging','vehicle-charging-overview'].includes(name))return {...initialScene(),focus:name==='vehicle-charging'?'vehicle':'now',vehicle:vehicleFixture({charging:true,now})};
 if(name==='vehicle-unconnected')return step(initialScene(),{type:'show',id:'vehicle'});
 if(deviceOfflinePreviewStates.includes(name)){const [kind,layer]=name.split('-');return step(devicePreviewScene(initialScene(),`${kind}-${layer}-${kind==='robot'?'cleaning':'on'}`),{type:'offline'});}
 let s=initialScene();if(devicePreviewStates.includes(name))return devicePreviewScene(s,name);if(name?.startsWith('header-')&&Object.hasOwn(headerPreviewPhases,name.slice(7)))return {...s,focus:'now',navStack:[],voicePreviewPhase:headerPreviewPhases[name.slice(7)]};if(name==='visual-history'){for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});return localAnswerHistory({...s,focus:'now'});}if(playerPreviewStates.includes(name)){const rest=name.startsWith('player-rest-'),status=name.replace(/^player-(rest|active)-/,'');return {...s,focus:rest?'photo':'music',navStack:[],playerPreview:status,...(status==='empty'?{music:{...s.music,playback:{...s.music.playback,active:false,playing:false}}}:{}),connected:status!=='offline'};}if(['rest','nothing','now','quiet','music','top','weather','timers','paused'].includes(name)){for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});s={...s,focus:'music',navStack:[],detailOrigin:undefined};}
 if(!previewStates.includes(name))return s;
 if(visualFamilies.includes(name)){s=step(s,{type:'request',kind:name});return step(s,{type:'answer-result',...s.pendingAnswer,status:'ready'});}
 if(['stack','music-stack'].includes(name)){s=step(s,{type:'timer-start',now});for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'14.50'});return step(s,{type:'show',id:name==='stack'?'now':'music'});}
 if(name==='timers')return step(s,{type:'show',id:'timers'});
 if(name==='night')return previewScene('rest',now);
 if(name==='quiet')return step(step(s,{type:'music',event:{type:'clear-playback'}}),{type:'show',id:'photo'});
 if(name==='weather')return step(s,{type:'show',id:'weather'});
 if(name==='top')return localAnswerHistory(step(s,{type:'music',event:{type:'collection',value:'top'}}));
 if(name==='listening')return {...step(s,{type:'show',id:'photo'}),notice:'Lytter…'};
 if(name==='now')return localAnswerHistory(step(s,{type:'show',id:'now'}));
 if(name==='nothing')return step(s,{type:'show',id:'now'});
 if(name==='paused')return step(s,{type:'music',event:{type:'toggle'}});
 if(name==='rest')return step(s,{type:'show',id:'photo'});
 if(name==='music')return s;
 if(['unknown','vacuum','light'].includes(name)){
  s=step(s,{type:'device-demo',kind:name==='light'?'light':'vacuum',time:'13.40'});
  if(name==='unknown')s=step(s,{type:'device-observation',id:'demo-vacuum',status:'unknown',time:'13.41'});
  return s;
 }
 if(name==='pending')return step(s,{type:'music',event:{type:'select',id:'smooth-jazz',revision:s.music.revision}});
 s=step(s,{type:'timer-start',now});
 if(name==='complete'){s=step(s,{type:'tick',now:s.timer.deadline});return step(s,{type:'show',id:'now'});}
 s=step(s,{type:'request',kind:'concise'});
 if(name!=='waiting')s=step(s,{type:'answer-result',...s.pendingAnswer,status:['partial','empty','error'].includes(name)?name:'ready'});
 if(['offline','connecting'].includes(name))s=step(s,{type:'offline'});
 if(name==='connecting')s={...s,notice:'Genopretter forbindelsen…'};
 if(name==='ended')s=step(s,{type:'session-ended'});
 return s;
}

// Explicit QA snapshots, not a speech engine or a live question contract.
// A title may quote the authored fixture question here; live titles are never
// inferred transcripts. All snapshots retain the same local resource identities.
function conversationPreviewScene(name,now){
 const stage=name.slice('conversation-'.length);
 let s=step(initialScene(),{type:'show',id:'now'});
 s=step(s,{type:'timer-start',name:'',seconds:600,now:now-78000});
 s=step(s,{type:'tick',now});
 for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});
 s=step(s,{type:'device-observation',id:'demo-vacuum',status:'docked',time:'Eksempel'});
 s=step(s,{type:'show',id:'now'});
 s={...s,conversationPreviewAt:now,navStack:[],devices:s.devices.map(d=>d.kind==='light'?{...d,status:'unavailable'}:d)};
 const phases={complete:'IDLE',listening:'LISTENING',working:'THINKING',speaking:'AI_SPEAKING',visual:'AI_SPEAKING',late:'THINKING',interrupted:'LISTENING',followup:'AI_SPEAKING'};
 if(['overview','listening','working','speaking'].includes(stage))return {...s,voicePreviewPhase:phases[stage]};
 s=step(s,{type:'request',kind:'fact-card'});
 const content=validateVisualContent('fact-card',{
  summary:'Ja, den næste time ser bedst ud.',
  facts:[
   {id:'temperature',label:'Nu',value:'15°',detail:'Let skyet',sourceId:'example'},
   {id:'hour-plus-1',label:new Intl.DateTimeFormat('da-DK',{timeZone:'Europe/Copenhagen',hour:'2-digit',hourCycle:'h23'}).format(new Date(now+1*3600000)),value:'15°',detail:'Let skyet',sourceId:'example'},
   {id:'hour-plus-2',label:new Intl.DateTimeFormat('da-DK',{timeZone:'Europe/Copenhagen',hour:'2-digit',hourCycle:'h23'}).format(new Date(now+2*3600000)),value:'16°',detail:'Skyet',sourceId:'example'},
   {id:'hour-plus-3',label:new Intl.DateTimeFormat('da-DK',{timeZone:'Europe/Copenhagen',hour:'2-digit',hourCycle:'h23'}).format(new Date(now+3*3600000)),value:'15°',detail:'Regn',sourceId:'example'}
  ],
  sources:[{id:'example',label:'Forhåndsvisning',url:'example-sources.html',scope:'Opdigtet vejrforløb til UI-vurdering. Ikke en aktuel vejrudsigt, et live spørgsmål eller en PodVoice-kvittering.'}]
 });
 s={...s,answers:s.answers.map(a=>a.id===s.pendingAnswer.id?{...a,title:'Skal vi gå en tur?',meta:'Forhåndsvisning',exampleOnly:true,weatherPresentation:{kind:'local-weather',subtitle:'Tørt nu. Risiko for regn senere.'},content}:a)};
 s=step(s,{type:'answer-result',...s.pendingAnswer,status:'ready',at:0});
 if(stage==='complete')s={...step(s,{type:'session-ended'}),notice:''};
 if(stage==='followup')s={...s,answers:s.answers.map(a=>({...a,revision:a.revision+1,title:'Og hvis vi venter et par timer?',weatherPresentation:undefined,content:validateVisualContent('fact-card',{
  ...content,summary:'Tag en regnjakke med, og vælg en kortere tur.',facts:[
   {id:'temperature',label:'Temperatur',value:'14°',detail:'Lidt køligere senere.',sourceId:'example'},
   {id:'window',label:'Om et par timer',value:'Regn',detail:'Regnjakke er en god idé.',sourceId:'example'},
   {id:'later',label:'Turen',value:'Kortere',detail:'Vælg en rute tæt på hjemmet.',sourceId:'example'}
  ]
 })}))};
 // Late/interrupted snapshots intentionally keep useful content and no fake
 // pending receipt. The phase alone does not promise a future visual answer.
 return {...s,voicePreviewPhase:phases[stage]};
}

// Catalog inputs only. They enter the same scene and resource renderers as the
// product and never acquire native IDs, owner receipts or transport authority.
function timerPreviewScene(name,now){
 const [,layer,status]=name.split('-');
 let s=step(initialScene(),{type:'show',id:layer==='detail'?'timers':layer==='rest'?'photo':'now'});
 if(status==='empty')return s;
 s=step(s,{type:'timer-start',name:'',seconds:600,now:now-78000});
 s=step(s,{type:'tick',now});
 if(status==='finished')s=step(s,{type:'tick',now:s.timer.deadline});
 if(status==='stale')s={...step(s,{type:'offline'}),timer:{...s.timer,stale:true,deadline:null}};
 if(status==='multiple')s={...s,extraTimers:[{...s.timer,id:'local-timer-2',name:'Te',duration:180,remaining:120,deadline:now+120000}],timerSerial:2};
 return s;
}

function musicPreviewScene(name){
 const variant=name.slice('music-'.length);let s=initialScene();
 if(['mood','feeling','top','recent'].includes(variant))return step(s,{type:'music',event:{type:'collection',value:variant}});
 if(variant==='paused')return step(s,{type:'music',event:{type:'toggle'}});
 s=step(s,{type:'music',event:{type:'refresh',revision:s.music.revision}});
 if(variant!=='refreshing')s=step(s,{type:'music',event:{type:'refresh-result',...s.music.refreshPending,status:variant==='refresh-error'?'error':'empty'}});
 return s;
}

function radioPreviewScene(name){
 let s=step(initialScene(),{type:'show',id:'radio'});
 if(['radio-selected','radio-paused','radio-offline'].includes(name))s=localRadioTransition(s,{type:'radio-select',stationId:'p3'});
 if(name==='radio-paused')s=localRadioTransition(s,{type:'toggle'});
 return name==='radio-offline'?step(s,{type:'offline'}):s;
}

function answerPreviewScene(name){
 const format=FORMATS.find(format=>name.startsWith(`answer-${format}-`)),status=name.slice(`answer-${format}-`.length);
 let s=step(initialScene(),{type:'request',kind:format});
 if(status==='waiting')return s;
 s=step(s,{type:'answer-result',...s.pendingAnswer,status:['partial','empty','error'].includes(status)?status:'ready'});
 if(status==='interrupted')s={...s,pendingAnswer:null,answers:s.answers.map(answer=>({...answer,status:'interrupted'}))};
 if(status==='offline')s=step(s,{type:'offline'});
 if(status==='complete'){
  const answer=s.answers[0];
  const actions=format==='checklist'?['paper','colors','glue']:['next','next','next','finish'];
  for(const optionId of actions){const current=s.answers[0];s=step(s,{type:'answer-action',sessionId:s.sessionId,taskId:answer.id,revision:current.revision,action:format==='checklist'?'check':optionId==='finish'?'finish':'step',optionId});}
 }
 if(status==='long')s={...s,answers:s.answers.map(answer=>({...answer,title:'En rolig tur med tid til pauser',content:validateVisualContent('fact-card',{
  summary:'Planlæg en kort rundtur med plads til pauser. Lad børnene vælge noget at kigge efter, og aftal en nem vej hjem, hvis nogen bliver trætte.',
  facts:[
   ['route','Rute','En kort sløjfe','Vælg en tur, der ender samme sted som den begynder. Det gør det nemt at forkorte turen, hvis I får lyst til at vende hjem.'],
   ['pace','Tempo','God tid','Sæt tid af til at kigge på ting undervejs. Lad den langsomste sætte tempoet, og stop, når der er noget spændende at undersøge.'],
   ['pause','Pause','Et roligt sted','Find et sted, hvor I kan sidde et øjeblik. En kort pause gør det lettere at fortsætte sammen i samme tempo.'],
   ['clothes','Påklædning','Efter vejret','Se vejrudsigten før afgang, og tag et ekstra lag med. Pak en lille taske med vand og det, I får brug for på pausen.'],
   ['return','Hjemtur','En nem genvej','Hav en kort vej hjem i tankerne. I behøver ikke gennemføre hele den planlagte tur for at få en god oplevelse.'],
   ['next','Bagefter','Vælg sammen','Spørg, hvad der var sjovest på turen. Brug svaret til at vælge noget, I har lyst til at opleve næste gang.']
  ].map(([id,label,value,detail])=>({id,label,value,detail,sourceId:'example'})),
  sources:[{id:'example',label:'PodView · forhåndsvisning',url:'example-sources.html',scope:'Illustrativt indhold til prøve af langt svar og scroll. Ingen aktuel rute, vejrudsigt eller personlig anbefaling.'}]
 })}))};
 return s;
}

// Only explicit QA stages call this. Existing pv-answer owns every renderer/action.
export function localAnswerHistory(scene){
 const focus=scene.focus;let s=scene;const titles={comparison:'Tre aktiviteter sammenlignet',concise:'Skal jeg tage en jakke med?',choices:'Hvad kan vi lave ved bordet?',chart:'Hvor meget skal vi finde frem?',steps:'Fold et papirfly',checklist:'Klar til at lave et kort?'};
 for(const kind of FORMATS){s=step(s,{type:'request',kind,resolved:true});const example=visualHistoryExamples[kind];s={...s,answers:s.answers.map(answer=>answer.id===s.pendingAnswer.id?{...answer,exampleOnly:true,title:example?.title||titles[kind],...(example?{meta:example.meta,content:validateVisualContent(kind,example.content)}:{})}:answer)};s=step(s,{type:'answer-result',...s.pendingAnswer,status:'ready'});}
 return {...s,focus,navStack:[],pendingAnswer:null};
}

// Explicit QA-only model input. All layers continue through the normal renderers.
function devicePreviewScene(s,name){
 const [domain,layer,status]=name.split('-'),kind=domain==='robot'?'vacuum':'light',id=`demo-${kind}`;
 for(const resource of ['vacuum','light'])s=step(s,{type:'device-demo',kind:resource,time:'12.00'});
 s={...s,devices:s.devices.map(d=>{
  if(d.id!==id)return d;
  const observed=status==='pending'?(kind==='light'?'on':'cleaning'):status;
  return {...d,exampleOnly:true,status:observed,...(kind==='light'?{lights:d.lights.map((lamp,index)=>({...lamp,on:observed==='mixed'?index%2===0:observed==='on'}))}:{battery:76}),pending:status==='pending'?{operation:1,action:kind==='light'?'turn_off':'pause',generation:s.generation,...(kind==='light'?{targetIds:d.lights.map(lamp=>lamp.id),scopeLabel:'Hele hjemmet'}:{})}:null,timeline:[{id:'preview-observed',label:kind==='light'?'Lysstatus':'Robotstatus',time:'12.00'}]};
 }),deviceOperation:status==='pending'?1:s.deviceOperation,navStack:[],detailOrigin:undefined};
 s=step(s,{type:'show',id:'now'});
 return layer==='overview'?s:step(s,{type:'show',id:layer==='rest'?'photo':id});
}
