// The one connection model for the live screen, as a pure reducer (same style as music-flow.js).
//
// link phases (what the transport knows):
//  closed          no transport running
//  connecting      first read, or a reconnect that outlived its grace period
//  connected       a fresh snapshot is accepted; actions are allowed
//  reconnecting    grace period: the connection dropped or restarts, the last snapshot stays on screen
//  offline         the transport lost its stream and recovers with backoff
//  blocked         PodVoice answered 403; terminal until an explicit start(), survives restart()
//  session-expired HA's ingress session answered 401 after one quiet renewal; recovery continues
//
// The browser's own network flag is part of the same state: while it is offline the phase is
// offline (a 403 still shows as blocked), whatever the link says.
export const connectionPhases=['closed','connecting','connected','reconnecting','offline','blocked','session-expired'];
export const newConnection=(browserOffline=false)=>({link:'closed',browserOffline:browserOffline===true});

export function connectionStep(s,e){
 switch(e.type){
  // Explicit start: the only event that lifts a 403 block.
  case 'start':return {...s,link:'connecting'};
  // Every (re)read. A 403 survives restart(); a held snapshot gets the grace period.
  case 'connecting':
   if(s.link==='blocked')return s;
   return {...s,link:['connected','reconnecting'].includes(s.link)?'reconnecting':'connecting'};
  case 'connected':return s.link==='blocked'?s:{...s,link:'connected'};
  case 'grace-expired':return s.link==='reconnecting'?{...s,link:'connecting'}:s;
  case 'lost':return ['blocked','session-expired','closed'].includes(s.link)?s:{...s,link:'offline'};
  case 'denied':return {...s,link:'blocked'};
  case 'expired':return s.link==='blocked'?s:{...s,link:'session-expired'};
  case 'unblock':return s.link==='blocked'?{...s,link:'connecting'}:s;
  case 'unexpire':return s.link==='session-expired'?{...s,link:'connecting'}:s;
  case 'browser':return s.browserOffline===(e.offline===true)?s:{...s,browserOffline:e.offline===true};
  case 'close':return {...s,link:'closed'};
  default:return s;
 }
}

export function connectionPhase(s){
 if(!s)return 'closed';
 if(s.browserOffline&&!['blocked','closed'].includes(s.link))return 'offline';
 return s.link;
}

// The strings the screen has always used: connected, connecting, reconnecting, disconnected.
export function liveStatusOf(s){
 const phase=connectionPhase(s);
 return ['connected','connecting','reconnecting'].includes(phase)?phase:'disconnected';
}

export const canAct=s=>connectionPhase(s)==='connected';
export const connectionBlocked=s=>s?.link==='blocked';
export const connectionSessionExpired=s=>s?.link==='session-expired';
