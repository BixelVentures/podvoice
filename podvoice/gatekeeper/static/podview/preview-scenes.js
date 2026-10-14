import {visualFamilies} from './visual-content.js';
import {initialScene,sceneTransition as step} from './scene-model.js';
// Deterministic, explicitly documented prototype states; no integrations or requests.
export const previewStates=[...visualFamilies,'timers','quiet','weather','top','stack','music-stack','rest','music','waiting','partial','ready','empty','error','pending','offline','unknown','complete','vacuum','light','listening','connecting','ended','nothing','paused'];
export function previewScene(name){
 let s=initialScene();if(['rest','nothing','quiet'].includes(name)){for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'Eksempel'});}
 if(!previewStates.includes(name))return s;
 if(visualFamilies.includes(name)){s=step(s,{type:'request',kind:name});return step(s,{type:'answer-result',...s.pendingAnswer,status:'ready'});}
 if(['stack','music-stack'].includes(name)){s=step(s,{type:'timer-start',now:Date.now()});for(const kind of ['vacuum','light'])s=step(s,{type:'device-demo',kind,time:'14:50'});return step(s,{type:'show',id:name==='stack'?'now':'music'});}
 if(name==='timers')return step(s,{type:'show',id:'timers'});
 if(name==='quiet')return step(step(s,{type:'music',event:{type:'clear-playback'}}),{type:'show',id:'photo'});
 if(name==='weather')return step(s,{type:'show',id:'weather'});
 if(name==='top')return step(s,{type:'music',event:{type:'collection',value:'top'}});
 if(name==='listening')return {...step(s,{type:'show',id:'photo'}),notice:'Lytter…'};
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
