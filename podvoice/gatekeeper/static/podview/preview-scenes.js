import {visualHistoryExamples} from './visual-examples.js';
import {validateVisualContent} from './visual-content.js';
import {visualFamilies} from './visual-content.js';
import {FORMATS,initialScene,sceneTransition as step} from './scene-model.js';
// Deterministic, explicitly documented prototype states; no integrations or requests.
export const playerPreviewStates=['empty','loading','missing-art','offline','error'].flatMap(state=>['rest','active'].map(mode=>`player-${mode}-${state}`));
export const headerPreviewPhases={listening:'LISTENING',thinking:'THINKING',speaking:'AI_SPEAKING',ready:'LOUNGE_WINDOW',waiting:'UNKNOWN'};
export const previewStates=[...Object.keys(headerPreviewPhases).map(phase=>`header-${phase}`),...playerPreviewStates,'visual-history','now',...visualFamilies,'timers','quiet','weather','top','stack','music-stack','rest','music','waiting','partial','ready','empty','error','pending','offline','unknown','complete','vacuum','light','listening','connecting','ended','nothing','paused'];
export function previewScene(name){
 let s=initialScene();if(name?.startsWith('header-')&&Object.hasOwn(headerPreviewPhases,name.slice(7)))return {...s,focus:'now',navStack:[],voicePreviewPhase:headerPreviewPhases[name.slice(7)]};if(name==='visual-history'){for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});return localAnswerHistory({...s,focus:'now'});}if(playerPreviewStates.includes(name)){const rest=name.startsWith('player-rest-'),status=name.replace(/^player-(rest|active)-/,'');return {...s,focus:rest?'photo':'music',navStack:[],playerPreview:status,connected:status!=='offline'};}if(['rest','nothing','now','quiet','music','top','weather','timers','paused'].includes(name)){for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});s={...s,focus:'music',navStack:[],detailOrigin:undefined};}
 if(!previewStates.includes(name))return s;
 if(visualFamilies.includes(name)){s=step(s,{type:'request',kind:name});return step(s,{type:'answer-result',...s.pendingAnswer,status:'ready'});}
 if(['stack','music-stack'].includes(name)){s=step(s,{type:'timer-start',now:Date.now()});for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'14:50'});return step(s,{type:'show',id:name==='stack'?'now':'music'});}
 if(name==='timers')return step(s,{type:'show',id:'timers'});
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
  s=step(s,{type:'device-demo',kind:name==='light'?'light':'vacuum',time:'13:40'});
  if(name==='unknown')s=step(s,{type:'device-observation',id:'demo-vacuum',status:'unknown',time:'13:41'});
  return s;
 }
 if(name==='pending')return step(s,{type:'music',event:{type:'select',id:'smooth-jazz',revision:s.music.revision}});
 s=step(s,{type:'timer-start',now:Date.now()});
 if(name==='complete'){s=step(s,{type:'tick',now:s.timer.deadline});return step(s,{type:'show',id:'now'});}
 s=step(s,{type:'request',kind:'concise'});
 if(name!=='waiting')s=step(s,{type:'answer-result',...s.pendingAnswer,status:['partial','empty','error'].includes(name)?name:'ready'});
 if(['offline','connecting'].includes(name))s=step(s,{type:'offline'});
 if(name==='connecting')s={...s,notice:'Genopretter forbindelsen…'};
 if(name==='ended')s=step(s,{type:'session-ended'});
 return s;
}

// Only explicit QA stages call this. Existing pv-answer owns every renderer/action.
export function localAnswerHistory(scene){
 const focus=scene.focus;let s=scene;const titles={comparison:'Tre aktiviteter sammenlignet',concise:'Skal jeg tage en jakke med?',choices:'Hvad kan vi lave ved bordet?',chart:'Hvor meget skal vi finde frem?',steps:'Fold et papirfly',checklist:'Klar til at lave et kort?'};
 for(const kind of FORMATS){s=step(s,{type:'request',kind,resolved:true});const example=visualHistoryExamples[kind];s={...s,answers:s.answers.map(answer=>answer.id===s.pendingAnswer.id?{...answer,exampleOnly:true,title:example?.title||titles[kind],...(example?{meta:example.meta,content:validateVisualContent(kind,example.content)}:{})}:answer)};s=step(s,{type:'answer-result',...s.pendingAnswer,status:'ready'});}
 return {...s,focus,navStack:[],pendingAnswer:null};
}
