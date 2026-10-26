import {visualHistoryExamples} from './visual-examples.js';
import {validateVisualContent} from './visual-content.js';
import {visualFamilies} from './visual-content.js';
import {FORMATS,initialScene,sceneTransition as step} from './scene-model.js';
import {vehicleFixture} from './vehicle-model.js';
import {vehicleObservation} from './ha-home-observation.js';
import {scopedLightDevice} from './home-model.js';
import {WEATHER_CHANGE_EXAMPLE} from './weather-view.js';
import {TRACKS} from './widget-model.js';
import {localRadioTransition} from './radio-model.js';
// Deterministic, explicitly documented prototype states; no integrations or requests.
export const playerPreviewStates=['empty','loading','missing-art','offline','error'].flatMap(state=>['rest','active'].map(mode=>`player-${mode}-${state}`));
export const headerPreviewPhases={listening:'LISTENING',thinking:'THINKING',speaking:'AI_SPEAKING',ready:'LOUNGE_WINDOW',closing:'CLOSING',waiting:'UNKNOWN'};
export const devicePreviewStatuses={light:['off','on','mixed','pending','unknown','fault','unavailable'],robot:['docked','cleaning','paused','docking','stopped','pending','unknown','fault']};
export const devicePreviewStates=Object.entries(devicePreviewStatuses).flatMap(([kind,statuses])=>statuses.flatMap(status=>['detail','overview','rest'].map(layer=>`${kind}-${layer}-${status}`)));
export const deviceOfflinePreviewStates=['robot','light'].flatMap(kind=>['detail','overview','rest'].map(layer=>`${kind}-${layer}-offline`));
export const timerPreviewStates=['detail','overview','rest'].flatMap(layer=>['empty','running','finished','multiple','stale'].map(state=>`timer-${layer}-${state}`)).concat(['timer-overview-dismissed']);
export const musicPreviewStates=['mood','feeling','top','recent','paused','refreshing','refresh-error','refresh-empty'].map(state=>`music-${state}`);
export const radioPreviewStates=['ready','selected','paused','offline'].map(state=>`radio-${state}`);
export const weatherPreviewStates=[...['ready','empty','stale'].map(state=>`weather-${state}`),'weather-wind-known',...['idle','pending','ready','error'].map(state=>`weather-advice-${state}`)];
export const answerPreviewStatuses=['ready','waiting','partial','empty','error','offline','interrupted'];
export const answerPreviewStates=FORMATS.flatMap(format=>answerPreviewStatuses.map(state=>`answer-${format}-${state}`)).concat([...visualFamilies.map(format=>`answer-${format}-long`),'answer-sourced-image-image-failure','answer-simple-diagram-image-failure','answer-steps-complete','answer-checklist-complete']);
export const conversationPreviewStates=['overview','listening','working','speaking','visual','late','complete','interrupted','followup','long','resume','timer-finished','offline','reconnecting','reconnected','visual-error'].map(state=>`conversation-${state}`);
export const coexistencePreviewStates=['conversation-visual-timer-finished','conversation-long-timer-finished'];
export const firstRunPreviewStates=['first-connecting','first-unavailable','first-denied','first-empty'];
// Additional authored snapshots exercise only fields accepted by existing owners.
export const libraryDomainPreviewStates=['robot-detail-many-rooms','robot-detail-empty','robot-detail-stale','robot-detail-long','robot-detail-care','light-detail-empty','light-detail-stale','light-detail-long','light-detail-room-living','light-detail-room-kitchen','light-detail-lamp','weather-unconnected','weather-offline','weather-long','weather-connection-error','music-offline','music-unknown','music-long-output','music-initial-empty','music-long-metadata','music-cover-states','player-long-metadata','player-queue-empty','player-queue-error','player-long-output','vehicle-unknown','vehicle-stale',...['detail','overview','rest'].map(layer=>`timer-${layer}-paused`)];
export const huePreviewStates=['hue-kitchen','hue-living','hue-offline','hue-long','hue-mixed','hue-unknown','hue-stale','hue-live-shaped'];
export const previewStates=[...huePreviewStates,...libraryDomainPreviewStates,...firstRunPreviewStates,...conversationPreviewStates,...coexistencePreviewStates,...devicePreviewStates,...deviceOfflinePreviewStates,...timerPreviewStates,...musicPreviewStates,...radioPreviewStates,...weatherPreviewStates,...answerPreviewStates,'vehicle-unconnected','vehicle-charging','vehicle-charging-overview','activities-combined',...Object.keys(headerPreviewPhases).map(phase=>`header-${phase}`),...playerPreviewStates,'screen-device-ready','visual-history','now',...visualFamilies,'timers','quiet','night','weather','top','stack','music-stack','rest','music','waiting','partial','ready','empty','error','pending','offline','unknown','complete','vacuum','light','listening','connecting','ended','nothing','paused'];
export function previewScene(name,now=Date.now()){
 if(huePreviewStates.includes(name)){
  const lights=[...Array.from({length:2},(_,i)=>({id:`hue-kitchen-${i+1}`,roomId:'kitchen',roomName:'Køkken',name:['Pendler','Bordlys','Loft ved vask','Loft ved ovn','Væglys','Reol'][i],on:i<2,dimmable:true,brightness:i<2?60:0})),...Array.from({length:6},(_,i)=>({id:`hue-living-${i+1}`,roomId:'living',roomName:'Stue · 1. sal',floorName:'1. sal',name:['Gulvlampe','Sofa','Loftlys','Reol','Vindue','Væglys'][i],on:true,dimmable:true,brightness:50}))];
  let s=step(initialScene(),{type:'device-demo',kind:'light',time:'Eksempel'}),d=s.devices[0];const scenes=['kitchen','living'].flatMap(roomId=>[0,1,2].map(i=>({id:`example-${roomId}-${i+1}`,roomId,name:name==='hue-long'?(i===0?'Aftenlys ved spisebord og køkkenø':i===1?'Hele rummet til madlavning og fælles aftensmad':'Roligt lys til en sen aften'):({kitchen:['Morgen','Madlavning','Aften'],living:['Læsning','Aften','Hygge']})[roomId][i],entityIds:lights.filter(row=>row.roomId===roomId).map(row=>row.id),levels:Object.fromEntries(lights.filter(row=>row.roomId===roomId).map(row=>[row.id,[60,100,30][i]]))})));
  s={...s,devices:[{...d,lights,lightScenes:scenes,lightSelectionId:name==='hue-living'?'room:living':'room:kitchen',lightSceneSelections:{kitchen:{id:'example-kitchen-1',adjusted:false}},ownRoomId:'kitchen'}]};
  if(name==='hue-mixed'){s.devices[0].lights[1]={...s.devices[0].lights[1],brightness:30};s.devices[0].lightSceneSelections.kitchen.adjusted=true;}
  if(name==='hue-unknown')s.devices[0]={...s.devices[0],status:'unknown'};
  if(name==='hue-stale')s.devices[0]={...s.devices[0],stale:true};
  if(name==='hue-live-shaped'){
   // Source-shaped authored fixture, never an actual HA read or command grant.
   const observedAt=now/1000,sourceEpoch='a'.repeat(64),bindingId='b'.repeat(64),items=lights.filter(row=>row.roomId==='kitchen').map((row,i)=>({entityId:`light.example_kitchen_${i+1}`,areaId:'example_kitchen',name:row.name,state:row.on?'on':'off',brightness:Math.round(row.brightness/100*255),supportsBrightness:true})),wire={status:'observed',source:'home_assistant_state',sourceEpoch,observedAt,validUntil:observedAt+15,scope:{kind:'ha_area',areaId:'example_kitchen',areaName:'Køkken',bindingId,placementRevision:1,isOwnArea:true},complete:true,countUnit:'light_entities',items,scenes:[0,1,2].map(i=>({id:['c','d','e'][i].repeat(64),name:['Morgen','Madlavning','Aften'][i],entityIds:items.map(row=>row.entityId)}))},model=scopedLightDevice(wire,1,now);
   s={...s,focus:model.id,devices:[{...model,exampleOnly:true}],lightAreas:{status:'observed',source:'home_assistant_area_registry',sourceEpoch,observedAt,validUntil:observedAt+15,bindingId,placementRevision:1,ownAreaId:'example_kitchen',selectedAreaId:'example_kitchen',items:[{areaId:'example_kitchen',areaName:'Køkken'},{areaId:'example_living',areaName:'Stue · 1. sal'}]},lightPlacement:{status:'bound',areaId:'example_kitchen',areaName:'Køkken',bindingId,placementRevision:1}};
  }
  return name==='hue-offline'?step(s,{type:'offline'}):s;
 }
 if(name==='screen-device-ready')return step(initialScene(),{type:'show',id:'now'});
 if(libraryDomainPreviewStates.includes(name))return libraryDomainPreviewScene(name,now);
 if(firstRunPreviewStates.includes(name)){const connectionPreview=name==='first-empty'?{status:'connected',reason:'setup',snapshot:{capabilities:{homeRead:[],musicRead:[],timerActions:[],answerRead:false}}}:{status:name==='first-connecting'?'connecting':'disconnected',blocked:name==='first-denied'};const scene=initialScene();return {...scene,music:{...scene.music,playback:{...scene.music.playback,active:false,playing:false}},focus:'now',connected:false,weatherPreview:'empty',connectionPreview,devices:[],timer:null,extraTimers:[],answers:[]};}
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
  if(['conversation-offline','conversation-reconnecting'].includes(name))s={...s,connectionPreview:{status:name==='conversation-reconnecting'?'connecting':'disconnected',snapshot:{}},notice:name==='conversation-reconnecting'?'Genopretter forbindelsen…':'Forbindelsen er afbrudt · viser det seneste.'};
  if(name==='conversation-visual-error')s={...s,notice:'Det nye visuelle svar kunne ikke vises. Det tidligere svar bliver stående.'};
  return s;
 }
 if(timerPreviewStates.includes(name))return timerPreviewScene(name,now);
 if(musicPreviewStates.includes(name))return musicPreviewScene(name);
 if(radioPreviewStates.includes(name))return radioPreviewScene(name);
 if(name==='weather-wind-known')return {...step(initialScene(),{type:'show',id:'weather'}),weatherPreview:'ready',weatherFixture:{...WEATHER_CHANGE_EXAMPLE,hours:WEATHER_CHANGE_EXAMPLE.hours.map((hour,index)=>({...hour,wind_bearing:[0,45,90,135,180,225,270,315,360,null,null,null][index]}))}};
 if(name.startsWith('weather-advice-')&&weatherPreviewStates.includes(name))return {...step(initialScene(),{type:'show',id:'weather'}),weatherPreview:'ready',weatherFixture:{...WEATHER_CHANGE_EXAMPLE,advicePreview:name.slice('weather-advice-'.length)}};
 if(weatherPreviewStates.includes(name))return {...step(initialScene(),{type:'show',id:'weather'}),weatherPreview:name.slice('weather-'.length)};
 if(answerPreviewStates.includes(name))return answerPreviewScene(name);
 if(name==='activities-combined')return {...devicePreviewScene(timerPreviewScene('timer-overview-running',now),'robot-overview-cleaning'),vehicle:vehicleFixture({charging:true,now,controls:true})};
 if(['vehicle-charging','vehicle-charging-overview'].includes(name))return {...initialScene(),focus:name==='vehicle-charging'?'vehicle':'now',vehicle:vehicleFixture({charging:true,now,controls:true})};
 if(name==='vehicle-unconnected')return step(initialScene(),{type:'show',id:'vehicle'});
 if(deviceOfflinePreviewStates.includes(name)){const [kind,layer]=name.split('-');return step(devicePreviewScene(initialScene(),`${kind}-${layer}-${kind==='robot'?'cleaning':'on'}`),{type:'offline'});}
 let s=initialScene();if(devicePreviewStates.includes(name))return devicePreviewScene(s,name,now);if(name?.startsWith('header-')&&Object.hasOwn(headerPreviewPhases,name.slice(7)))return {...s,focus:'now',navStack:[],voicePreviewPhase:headerPreviewPhases[name.slice(7)]};if(name==='visual-history'){for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});return localAnswerHistory({...s,focus:'now'},true);}if(playerPreviewStates.includes(name)){const rest=name.startsWith('player-rest-'),status=name.replace(/^player-(rest|active)-/,'');return {...s,focus:rest?'photo':'music',navStack:[],playerPreview:status,...(status==='empty'?{music:{...s.music,playback:{...s.music.playback,active:false,playing:false}}}:{}),connected:status!=='offline'};}if(['rest','nothing','now','quiet','music','top','weather','timers','paused'].includes(name)){for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});s={...s,focus:'music',navStack:[],detailOrigin:undefined};}
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
   {id:'window',label:'Bedste tidspunkt',value:'Gå nu',detail:'Den næste time er tør i dette vejrforløb.',sourceId:'example'},
   {id:'temperature',label:'Temperatur nu',value:'15°',detail:'Let skyet. Tag en let jakke med.',sourceId:'example'},
   {id:'rain',label:'Senere på turen',value:'Regn om tre timer',detail:'Vælg en kort tur, hvis I vil være hjemme inden regnen.',sourceId:'example'}
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
 const answer=s.answers.find(item=>item.id===s.focus),completed=['complete','long','resume'].includes(stage);
 return {...s,voicePreviewPhase:completed?'IDLE':phases[stage],
  ...(completed?{localAnswerCompletion:{answerId:answer.id,revision:answer.revision,voice:'completed',visual:'completed'}}:{}),
  ...(['visual','followup'].includes(stage)?{localVoiceCompletion:{answerId:answer.id,revision:answer.revision,phase:'AI_SPEAKING',durationMs:4000}}:{})};
}

// Catalog inputs only. They enter the same scene and resource renderers as the
// product and never acquire native IDs, owner receipts or transport authority.
function timerPreviewScene(name,now){
 const [,layer,status]=name.split('-');
 let s=step(initialScene(),{type:'show',id:layer==='detail'?'timers':layer==='rest'?'photo':'now'});
 if(status==='empty')return s;
 s=step(s,{type:'timer-start',name:'',seconds:600,now:now-78000});
 s=step(s,{type:'tick',now});
 if(['finished','dismissed'].includes(status))s=step(s,{type:'tick',now:s.timer.deadline});
 if(status==='dismissed')s=step(s,{type:'timer-notice-dismiss',id:s.timer.id});
 if(status==='stale')s={...step(s,{type:'offline'}),timer:{...s.timer,stale:true,deadline:null}};
 // Keep the legacy stage URL, but obey the product's single-timer contract.
 if(status==='multiple')s={...s,timerHistory:[{seconds:180},{seconds:300},{seconds:600}]};
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
 if(status==='long'&&format==='fact-card')s={...s,answers:s.answers.map(answer=>({...answer,title:'En rolig tur med tid til pauser',content:validateVisualContent('fact-card',{
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
 if(status==='long'&&format!=='fact-card')s={...s,answers:s.answers.map(answer=>{const content=structuredClone(answer.content);content.summary+=' Tag dig tid til at læse forklaringen og se de enkelte dele i sammenhæng. Du kan åbne grundlaget nedenunder og vende tilbage til svaret uden at miste resten af indholdet.';for(const row of content.events||content.nodes||[])row.detail+=' Læs denne del før næste trin. Forklaringen er ikke en observation fra hjemmet.';if(content.image)content.image.caption+=' Se spejlingen i vandet og de rolige farver langs bjergene. Illustrationen giver plads til at studere motivet; den dokumenterer ikke en virkelig tur eller et bestemt sted.';return {...answer,exampleOnly:true,content:validateVisualContent(format,content)};})};
 if(status==='image-failure')s={...s,answers:s.answers.map(answer=>{const content=structuredClone(answer.content);const image=content.image||content.illustration;image.url='assets/qa-deliberately-missing-answer-image.webp';return {...answer,exampleOnly:true,content:validateVisualContent(format,content)};})};
 if(['ready','long','complete','image-failure'].includes(status)){const answer=s.answers[0];s={...s,voicePreviewPhase:'IDLE',localAnswerCompletion:{answerId:answer.id,revision:answer.revision,voice:'completed',visual:'completed'}};}
 return s;
}

// Only explicit QA stages call this. Existing pv-answer owns every renderer/action.
export function localAnswerHistory(scene,includeTranscript=false){
 const focus=scene.focus;let s=scene;const titles={comparison:'Tre aktiviteter sammenlignet',concise:'Skal jeg tage en jakke med?',choices:'Hvad kan vi lave ved bordet?',chart:'Hvor meget skal vi finde frem?',steps:'Fold et papirfly',checklist:'Klar til at lave et kort?'};
 for(const kind of FORMATS){s=step(s,{type:'request',kind,resolved:true});const example=visualHistoryExamples[kind];s={...s,answers:s.answers.map(answer=>answer.id===s.pendingAnswer.id?{...answer,exampleOnly:true,title:example?.title||titles[kind],...(example?{meta:example.meta,content:validateVisualContent(kind,example.content)}:{})}:answer)};s=step(s,{type:'answer-result',...s.pendingAnswer,status:'ready'});}
 if(includeTranscript){
  const text='Vi kan begynde med at finde papir, farver og en saks frem. Læg det hele midt på bordet, så alle kan nå. Et foldet kort er en enkel start: vælg en farve til forsiden, og tegn noget, som modtageren holder af. Der behøver ikke være en bestemt anledning.\n\nNår forsiden er klar, kan I skrive en kort hilsen indeni. Hvis det er svært at finde ordene, kan hver person nævne en lille ting, de glæder sig til at lave sammen med modtageren. Lad gerne nogen tegne i stedet for at skrive.\n\nGem de små papirrester til at lave mønstre eller et bogmærke. Når I er færdige, lægger I saksen væk og samler farverne. Det vigtigste er at have tid ved bordet sammen; kortet behøver ikke være perfekt. Vi kan også vælge en anden aktivitet, hvis I hellere vil bevæge jer lidt.';
  const segment={segmentId:'e'.repeat(32),sessionId:'authored-library-conversation',generation:1,ts:1792490400,endTs:1792490460,text,fragmentCount:3};
  s={...s,answers:[...s.answers,{id:'transcript:'+segment.segmentId,kind:'concise',title:'Samtaleudskrift',exampleOnly:true,historical:true,transcriptSegment:segment,status:'ready',observedAt:segment.ts,content:{summary:text},allowedActions:[],readConnected:false}]};
 }
 return {...s,focus,navStack:[],pendingAnswer:null};
}

// Explicit QA-only model input. All layers continue through the normal renderers.
function devicePreviewScene(s,name,now=Date.now()){
 const [domain,layer,status]=name.split('-'),kind=domain==='robot'?'vacuum':'light',id=`demo-${kind}`;
 const observedAt=Math.floor(now/1000),telemetry=status=>{const rows=[['cleaning_area',12.5,'m²'],['cleaning_time',600,'s'],['cleaning_mode','vac_and_mop',null],['selected_map','Stueetagen',null],['last_clean_end',observedAt-86400,null],['last_clean_start',observedAt-87000,null]];if(['cleaning','paused','pending'].includes(status))rows.unshift(['current_room','Køkkenet',null],['clean_percent',38,'%']);return {status:'observed',source:'local_preview',exampleOnly:true,items:rows.map(([key,value,unit])=>({key,value,unit,updatedAt:observedAt,retrievedAt:observedAt,stale:false}))};};
 for(const resource of ['vacuum','light'])s=step(s,{type:'device-demo',kind:resource,time:'12.00'});
 s={...s,devices:s.devices.map(d=>{
  if(d.id!==id)return d;
  const observed=status==='pending'?(kind==='light'?'on':'cleaning'):status;
  return {...d,exampleOnly:true,status:observed,...(kind==='vacuum'&&['cleaning','paused'].includes(observed)?{localJob:{id:`authored-${id}-job`,deviceId:id,kind:'fixture_room_clean',repeat:2,active:true,exampleOnly:true}}:{}),...(kind==='light'?{lights:d.lights.map((lamp,index)=>{const on=observed==='mixed'?index%2===0:observed==='on';return {...lamp,on,...(lamp.dimmable&&on?{brightness:lamp.brightness>0?lamp.brightness:60}:{})};})}:{battery:76,...(!['unknown','fault','unavailable'].includes(status)?{telemetry:telemetry(status)}:{})}),pending:status==='pending'?{operation:1,action:kind==='light'?'turn_off':'pause',generation:s.generation,...(kind==='light'?{targetIds:d.lights.map(lamp=>lamp.id),scopeLabel:'Hele hjemmet'}:{})}:null,timeline:[{id:'preview-observed',label:kind==='light'?'Lysstatus':'Robotstatus',time:'12.00'}]};
 }),deviceOperation:status==='pending'?1:s.deviceOperation,navStack:[],detailOrigin:undefined};
 s=step(s,{type:'show',id:'now'});
 return layer==='overview'?s:step(s,{type:'show',id:layer==='rest'?'photo':id});
}


// Catalog snapshots have no transport, credentials or new effect authority.
// Missing owner states (e.g. Tesla command pending) are deliberately not staged.
function libraryDomainPreviewScene(name,now){
 if(name==='robot-detail-many-rooms'){
  // Authored library inputs, not discovered household capabilities. Each explicit
  // local map/mode choice replaces the entire offered task, like the live owner.
  const s=devicePreviewScene(initialScene(),'robot-detail-docked',now),opaque=n=>n.toString(16).padStart(24,'0'),maps=[{id:opaque(100),label:'Stueplan',names:['Stue','Køkken','Spisestue','Entré','Kontor','Bryggers','Gang','Gæsteværelse','Toilet']},{id:opaque(200),label:'1. sal',names:['Soveværelse','Børneværelse','Repos','Badeværelse']}],modes=[{id:opaque(301),label:'Støvsugning',key:'vacuum'},{id:opaque(302),label:'Gulvvask',key:'mop'},{id:opaque(303),label:'Støvsugning og gulvvask',key:'both'}],offers={};
  const choice=(id,label,choices)=>({id:opaque(id),label,action:'set_option',argsSchema:{kind:'choice',choices}});
  for(const [index,map]of maps.entries())for(const mode of modes){const key=`${index}-${mode.key}`,areas=map.names.map((label,n)=>({id:opaque(1000+index*100+n),label}));offers[key]={mapName:map.label,options:[{id:'a'.repeat(24),action:'start',label:'Start rengøring',argsSchema:{kind:'cleaning',areas,repeat:{min:1,max:3}}},choice(401,'Kort',maps.map(({id,label})=>({id,label}))),choice(402,'Rengøringstype',modes.map(({id,label})=>({id,label}))),...(mode.key!=='mop'?[choice(403,'Sugestyrke',[{id:opaque(501),label:'Stille'},{id:opaque(502),label:'Balanceret'},{id:opaque(503),label:'Maksimal'}])]:[]),...(mode.key!=='vacuum'?[choice(404,'Vandmængde',[{id:opaque(601),label:'Lav'},{id:opaque(602),label:'Mellem'},{id:opaque(603),label:'Høj'}]),choice(405,'Moppetilstand',[{id:opaque(701),label:'Standard'},{id:opaque(702),label:'Grundig'}])]:[])],replacements:Object.fromEntries([...maps.map((row,n)=>[row.id,`${n}-${mode.key}`]),...modes.map(row=>[row.id,`${index}-${row.key}`])])};}
  return {...s,robotControlFixture:{exampleOnly:true,initialKey:'0-both',offers},devices:s.devices.map(d=>d.kind!=='vacuum'?d:{...d,exampleOnly:true,telemetry:undefined})};
 }
 if(['robot-detail-empty','light-detail-empty'].includes(name))return step(previewScene('first-empty',now),{type:'show',id:name.startsWith('robot')?'podview-vacuum-empty':'podview-light-empty'});
 if(name.startsWith('robot-detail-')){
  const s=devicePreviewScene(initialScene(),'robot-detail-cleaning',now),status=name.slice('robot-detail-'.length),at=now/1000;
  return {...s,devices:s.devices.map(d=>d.kind!=='vacuum'?d:{...d,...(status==='stale'?{stale:true}:{}),telemetry:{...d.telemetry,items:[...d.telemetry.items.map(row=>status==='long'&&['current_room','selected_map'].includes(row.key)?{...row,value:row.key==='current_room'?'Den store sammenhængende stue og spisestue ved terrassen og køkkenet':'Stueetagen med køkken, spisestue, arbejdsområde og den lange fordelingsgang'}:row),...(status==='care'?[['main_brush_time_left',72000,'s'],['filter_time_left',18000,'s'],['dirty_box_full',true,null],['dock_error','water_tank_not_installed',null]].map(([key,value,unit])=>({key,value,unit,updatedAt:at,retrievedAt:at,stale:false})):[])]}})};
 }
 if(name.startsWith('light-detail-')){
  const s=devicePreviewScene(initialScene(),'light-detail-on',now),variant=name.slice('light-detail-'.length),selection=({'room-living':'room:living','room-kitchen':'room:kitchen',lamp:'light:living-ceiling',long:'light:living-ceiling'})[variant]||'home';
  return {...s,devices:s.devices.map(d=>d.kind!=='light'?d:{...d,stale:variant==='stale',lightSelectionId:selection,lights:d.lights.map(lamp=>variant==='long'&&lamp.id==='living-ceiling'?{...lamp,name:'Pendlen over det lange spisebord ved vinduerne mod haven',roomName:'Stue og spisestue i den åbne køkkenalrumsløsning'}:lamp)})};
 }
 if(name==='weather-long')return {...step(initialScene(),{type:'show',id:'weather'}),weatherFixture:{...WEATHER_CHANGE_EXAMPLE,place:'Mårslet og det lange grønne område langs den sydlige del af Aarhus',condition:'Delvist skyet med længere solrige perioder mellem de spredte skyer'}};
 if(name==='weather-connection-error')return {...previewScene('weather-empty',now),connectionPreview:{status:'disconnected',reason:'unavailable'},connected:false};
 if(name.startsWith('weather-'))return {...previewScene(name==='weather-unconnected'?'first-empty':'weather-stale',now),focus:'weather',connected:false,weatherPreview:name==='weather-unconnected'?'empty':'stale'};
 if(name.startsWith('timer-')){const s=timerPreviewScene(name.replace(/paused$/,'running'),now);return step(s,{type:'timer',id:s.timer.id,action:'pause',now});}
 if(name.startsWith('vehicle-')){
  const known=name==='vehicle-stale',data=known?{batteryPercent:72,rangeKm:312,locked:true,charging:{status:'charging',powerKw:11,endsAt:now/1000+2700},climate:{status:'off',temperatureC:19}}:{};
  const admitted=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:now/1000,entityIds:['sensor.podview_preview_car'],data});
  return {...initialScene(),focus:'vehicle',vehicle:{...admitted,exampleOnly:true,context:'Lokalt eksempel · passiv bilstatus',source:'Lokalt eksempel',stale:known}};
 }
 let s=initialScene();
 if(name==='music-unknown')s=step(s,{type:'music',event:{type:'select',id:'smooth-jazz',revision:s.music.revision}});
 if(['music-offline','music-unknown'].includes(name))return step(s,{type:'offline'});
 if(name==='music-initial-empty')return {...s,music:{...s.music,previewEmptyCollection:s.music.collection,previewEmptyPage:s.music.suggestionPage||0,playback:{...s.music.playback,active:false,playing:false}}};
 if(name==='music-cover-states'){
  // Authored local image-state test, retaining the existing real track identities.
  // No playlist-cover mapping, provider failure claim or live source is invented.
  const previewTracks=TRACKS.map((track,index)=>({...track,art:index===1?null:index===2?'qa-unavailable-cover.svg':track.art,detail:index===1?'Lokalt billedtest · omslag mangler':index===2?'Lokalt billedtest · fil kan ikke indlæses':'Lokalt billedtest · kendt Spotify-omslag'}));
  return {...s,focus:'music',music:{...s.music,collection:'top',previewTracks}};
 }
 if(['music-long-metadata','player-long-metadata'].includes(name)){
  // Authored stress labels retain the fixture IDs, ordering and allowed artwork.
  // They are typography examples, not factual Spotify metadata or new grants.
  const previewTracks=TRACKS.map((track,index)=>({...track,title:`En lang sangtitel med plads til både hovedtitel, undertitel og en akustisk koncertversion · ${index+1}`,artist:'Det store orkester fra den åbne stue sammen med gæstemusikerne fra København'}));
  return {...s,focus:name.startsWith('player')?'player':'music',music:{...s.music,collection:'top',previewTracks}};
 }
 if(['player-queue-empty','player-queue-error'].includes(name))return {...s,focus:'player',queuePreview:name.endsWith('error')?'error':'empty'};
 // A long configured destination is real input to the existing local player,
 // media Card metadata and output label. Track/album identity stays unchanged.
 return {...s,focus:name.startsWith('player')?'player':'music',music:{...s.music,playback:{...s.music.playback,room:'Køkken og spisestue med højttalerne ved det lange spisebord'}}};
}
