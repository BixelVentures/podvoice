// PodVoice owns resources and authorizes controls. Unconfigured lights remain a visible placeholder.
export const unconfiguredLight=()=>({id:"podvoice-light-unconfigured",kind:"light",revision:1,status:"unavailable",pending:null,hidden:false,timeline:[]});
export function liveScene(base, snapshot) {
 const items=snapshot.timers.status==='observed'?snapshot.timers.items:[];
 const timers=items.filter(t=>t&&typeof t.id==='string'&&typeof t.name==='string'&&Number.isFinite(t.secondsLeft)&&['running','paused','finished'].includes(t.status)).slice(0,32).map(t=>({id:t.id,name:t.name.slice(0,120),remaining:Math.max(0,t.secondsLeft),duration:null,status:t.status==='finished'?'done':t.status,deadline:null,hidden:false,noticeDismissed:base.timer?.id===t.id?base.timer.noticeDismissed:base.extraTimers.find(x=>x.id===t.id)?.noticeDismissed}));
 return {...base,sessionId:snapshot.voice.sessionId||'podvoice-idle',connected:false,timer:timers[0]||null,extraTimers:timers.slice(1),answers:[],devices:[unconfiguredLight()],pendingAnswer:null,notice:'',music:{...base.music,pending:null,message:'',playback:{...base.music.playback,active:false,playing:false}}};
}
export const liveLocalEvent=e=>['show','back','device-back','timer-notice-dismiss','hide'].includes(e.type)&&!(e.type==='show'&&!['photo','now','timers','music','podvoice-light-unconfigured'].includes(e.id));
export const voiceStatus=phase=>({LISTENING:'Lytter…',THINKING:'Tænker…',RESPONDING:'Svarer…',SPEAKING:'Svarer…',AI_SPEAKING:'Svarer…',LOUNGE_WINDOW:'Lytter…',CLOSING:'Afslutter…',IDLE:'Ingen aktiv samtale'}[phase]||'Forbundet');
export function liveTimerRequest(snapshot,connected,event){
 if(!connected||!snapshot||!Array.isArray(snapshot.capabilities?.timerActions))return null;
 if(event.type==='timer-start'&&snapshot.capabilities.timerActions.includes('timer.start')&&Number.isInteger(event.seconds)&&event.seconds>=1&&event.seconds<=86400&&typeof event.name==='string'&&event.name.length<=120)return {action:'timer.start',args:{seconds:event.seconds,name:event.name}};
 if(event.type==='timer'&&event.action==='cancel'&&snapshot.capabilities.timerActions.includes('timer.cancel')&&snapshot.timers.items.some(t=>t.id===event.id))return {action:'timer.cancel',args:{timer_id:event.id}};
 return null;
}
