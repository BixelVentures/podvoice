import {orderHomeDevices} from './home-model.js';
import {readTimers} from './src/lib/api/schemas.ts';
import {liveTimerHistory,liveTimers} from './src/screens/timer/live-timers.ts';
// PodVoice owns resources and authorizes controls. Unconfigured lights remain a visible placeholder.
export const unconfiguredLight=()=>({id:"podvoice-light-unconfigured",kind:"light",name:"Lys",scope:"home",revision:1,status:"unavailable",pending:null,hidden:false,timeline:[]});
export function liveScene(base, snapshot) {
 // The native timers are projected by the timer screen's model (src/screens/timer/live-timers.ts); the scene adds
 // what only it keeps: a dismissed alarm stays dismissed for the same owner.
 const observed=snapshot.timers.status==='observed',timerHistory=liveTimerHistory(snapshot.timerHistory);
 const previousTimer=t=>{const previous=base.timer?.id===t.id?base.timer:base.extraTimers.find(x=>x.id===t.id);return previous?.ownerBootId===snapshot.bootId?previous:null;};
 const timers=liveTimers({bootId:snapshot.bootId,timers:readTimers(snapshot.timers),timerHistory:snapshot.timerHistory})
  .map(t=>({...t,noticeDismissed:previousTimer(t)?.noticeDismissed}));
 const homeAllowed=snapshot.capabilities?.homeRead||[],observedDevices=base.devices.filter(d=>d.source==='home_assistant_state'&&homeAllowed.includes(d.kind==='light'?'light':'vacuum')),devices=orderHomeDevices([...(observedDevices.some(d=>d.kind==='light')?[]:[unconfiguredLight()]),...observedDevices]);
 const revokedWeather=base.focus==='weather'&&!snapshot.capabilities?.homeRead?.includes('weather');
 const revokedAnswer=base.answers.some(a=>a.live&&!a.historical&&a.id===base.focus)&&(snapshot.capabilities?.answerRead!==true||!base.answers.some(a=>a.id===base.focus&&a.sessionId===snapshot.answers?.sessionId&&a.turnId===snapshot.answers?.turnId&&a.taskId===snapshot.answers?.taskId&&a.inputRevision===snapshot.answers?.inputRevision&&a.revision===snapshot.answers?.revision));
 const revokedFocus=revokedWeather||revokedAnswer||base.devices.some(d=>d.id===base.focus&&(d.source==='home_assistant_state'||d.presentationOnly===true))&&!devices.some(d=>d.id===base.focus);
 return {...base,live:true,vehicle:snapshot.capabilities?.homeRead?.includes('vehicle')?base.vehicle:null,liveWeather:snapshot.capabilities?.homeRead?.includes('weather')?base.liveWeather:null,focus:revokedFocus?'now':base.focus,sessionId:snapshot.voice.sessionId||'podvoice-idle',connected:false,timerHistory,timer:observed?timers[0]||null:base.timer?{...base.timer,stale:true}:null,extraTimers:observed?timers.slice(1):base.extraTimers.map(t=>({...t,stale:true})),answers:base.answers.filter(a=>a.historical||snapshot.capabilities?.answerRead===true&&a.live&&a.sessionId===snapshot.answers?.sessionId&&a.turnId===snapshot.answers?.turnId&&a.taskId===snapshot.answers?.taskId&&a.inputRevision===snapshot.answers?.inputRevision&&a.revision===snapshot.answers?.revision),devices,pendingAnswer:null,notice:'',music:{...base.music,pending:null,message:'',playback:{...base.music.playback,active:false,playing:false}}};
}
export function liveLocalEvent(event, scene, snapshot, recoveryBlocked) {
 if (event.type !== 'show') return ['back', 'device-back', 'timer-notice-dismiss', 'hide'].includes(event.type);
 const {id} = event;
 if (id === 'weather') {
  if (recoveryBlocked || !snapshot?.capabilities?.homeRead?.includes('weather')) return false;
  const readStatus = scene?.homeReadStatus;
  const scope = JSON.stringify([snapshot.bootId, snapshot.roomId]);
  return !(readStatus?.scope === scope && readStatus.weather === 'denied');
 }
 return Boolean(['photo', 'now', 'timers', 'music', 'player', 'radio', 'recipes', 'vehicle',
  'podvoice-light-unconfigured', 'podview-light-empty', 'podview-vacuum-empty'].includes(id)
  || scene?.devices.some(device => device.id === id)
  || scene?.answers.some(answer => answer.id === id && !answer.hidden));
}
export const voiceStatus=phase=>({LISTENING:'Lytter…',THINKING:'Tænker…',RESPONDING:'Svarer…',SPEAKING:'Svarer…',AI_SPEAKING:'Svarer…',LOUNGE_WINDOW:'Spørg videre',CLOSING:'Afslutter…',IDLE:'Ingen aktiv samtale'}[phase]||'Forbundet');
// The request a timer tap makes on the observed timers (typed: src/lib/api/timer-actions.ts).
export {timerRequest as liveTimerRequest} from './src/lib/api/timer-actions.ts';

export {liveTimerHistory};

// Connection copy describes only admitted screen capabilities, never whether
// the household owns devices. Retry below rereads the existing HA session.
// Only explicit setup or a known connection failure chooses recovery copy.
// An empty successful read does not imply missing permissions or configuration.
export {homeConnectionPresentation} from './src/lib/api/connection.ts';
export function connectionPresentation({status,snapshot,blocked=false,sessionExpired=false,browserOffline=false}={}){
 // The grace period (reconnecting) keeps the last snapshot on screen exactly as it was.
 if(status==='reconnecting'&&!blocked)status='connected';
 if(browserOffline)return {state:'offline',headerLabel:'Ingen netværksforbindelse',text:snapshot?'Ingen netværksforbindelse · viser det seneste.':'Ingen netværksforbindelse. Kontrollér skærmens forbindelse.',retry:false};
 if(status==='connecting')return {state:'connecting',headerLabel:snapshot?'Genopretter forbindelse…':'Forbinder…',text:snapshot?'Genopretter forbindelsen til hjemmet…':'Forbinder til Home Assistant…',retry:false};
 // HA's ingress session stayed invalid after one quiet renewal: a connection problem, never a raw 401.
 if(status!=='connected'&&blocked&&sessionExpired){
  return {state:'offline',headerLabel:'Forbindelsen mangler',text:'Forbindelsen mangler · Prøv igen.',retry:true};
 }
 if(status!=='connected')return blocked?{state:'denied',headerLabel:'Adgang mangler',text:'Home Assistant kræver login eller adgang. Log ind i Home Assistant, og prøv igen.',retry:true}:{state:'offline',headerLabel:snapshot?'Forbindelsen er afbrudt':'Ingen forbindelse',text:snapshot?'Forbindelsen til hjemmet er afbrudt · viser det seneste.':'Ingen forbindelse til Home Assistant endnu. Kontrollér forbindelsen, og prøv igen.',retry:true};
 const capabilities=snapshot?.capabilities;
 const empty=capabilities&&Array.isArray(capabilities.homeRead)&&Array.isArray(capabilities.musicRead)&&Array.isArray(capabilities.timerActions)&&!capabilities.homeRead.length&&!capabilities.musicRead.length&&!capabilities.timerActions.length&&capabilities.answerRead!==true;
 return empty?{state:'empty',headerLabel:'',text:'Intet indhold er tilgængeligt for skærmen endnu. Kontrollér PodVoice i Home Assistant.',retry:false}:{state:'ready',headerLabel:'',text:'',retry:false};
}
