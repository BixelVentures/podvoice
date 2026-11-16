// One chosen song's life, from the tap to the room playing it (same style as music-flow.js).
// Only a request still on its way (requesting, accepted) holds the player's buttons; a confirmed
// settlement, a rejection, an unknown outcome or an expired wait gives them back at once.
export const MUSIC_SESSION_PHASES=Object.freeze(['idle','requesting','accepted','confirmed','playing','rejected',
 'unknown','expired']);
export const newMusicSession=()=>({phase:'idle',run:0});
const OPEN=new Set(['requesting','accepted']);
export function musicSession(s,e){
 if(e.type==='request')return {...newMusicSession(),phase:'requesting',run:s.run+1};
 if(e.type==='reset')return {...newMusicSession(),run:s.run+1};
 if(e.run!==s.run)return s;
 if(e.type==='accepted'&&s.phase==='requesting')return {...s,phase:'accepted'};
 if((e.type==='rejected'||e.type==='unknown'||e.type==='expired')&&OPEN.has(s.phase))return {...s,phase:e.type};
 if(e.type==='confirmed'&&s.phase==='accepted')return {...s,phase:'confirmed'};
 if(e.type==='observed'&&(s.phase==='accepted'||s.phase==='confirmed'))return {...s,phase:'playing'};
 return s;
}
export const controlsBlocked=s=>OPEN.has(s?.phase);

// The selection view's feedback, replayed as events through the reducer (one source of truth).
export function musicSessionFromFeedback(feedback,{observed=false}={}){
 let s=newMusicSession();
 if(!feedback)return s;
 const step=type=>{s=musicSession(s,{type,run:s.run});};
 s=musicSession(s,{type:'request'});
 if(feedback.pending)return s;
 const status=feedback.settlementStatus;
 if(feedback.outcome==='rejected'||status==='rejected'||status==='superseded'){step('rejected');return s;}
 if(feedback.outcome!=='accepted'){step('unknown');return s;}
 step('accepted');
 if(status==='unknown'){step('unknown');return s;}
 if(status==='confirmed')step('confirmed');
 if(feedback.displayObserved||observed)step('observed');
 else if(feedback.displayExpired)step('expired');
 return s;
}

// A room read is fresh, a short read failure (transient) or a known-old observation (stale).
export function playbackFreshness(playback){
 const stale=playback?.stale;
 if(stale==='transient')return 'transient';
 return stale===undefined||stale===null||stale===false?'fresh':'stale';
}
