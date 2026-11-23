import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MUSIC_SESSION_PHASES,newMusicSession,musicSession,controlsBlocked,musicSessionFromFeedback,playbackFreshness,
} from '../../podview/music-session-model.js';
import {LiveMusicSelectionView} from '../../podview/live-music-selection-view.js';


// ---- A. music session reducer ----
const session=(...types)=>types.reduce((s,type)=>musicSession(s,{type,run:s.run}),
 musicSession(newMusicSession(),{type:'request'}));

test('music session: phases follow request, acceptance, confirmation and observation',()=>{
 assert.deepEqual(MUSIC_SESSION_PHASES,
  ['idle','requesting','accepted','confirmed','playing','rejected','unknown','expired']);
 assert.equal(newMusicSession().phase,'idle');
 assert.equal(session().phase,'requesting');
 assert.equal(session('accepted').phase,'accepted');
 assert.equal(session('accepted','confirmed').phase,'confirmed');
 assert.equal(session('accepted','confirmed','observed').phase,'playing');
 assert.equal(session('accepted','observed').phase,'playing');
 assert.equal(session('rejected').phase,'rejected');
 assert.equal(session('accepted','unknown').phase,'unknown');
 assert.equal(session('accepted','expired').phase,'expired');
});

test('music session: illegal and stale-run events return the same state',()=>{
 const requesting=session();
 for(const type of ['confirmed','observed','nonsense'])
  assert.equal(musicSession(requesting,{type,run:requesting.run}),requesting);
 const confirmed=session('accepted','confirmed');
 for(const type of ['accepted','expired','rejected','unknown'])
  assert.equal(musicSession(confirmed,{type,run:confirmed.run}),confirmed);
 const rejected=session('rejected');
 assert.equal(musicSession(rejected,{type:'accepted',run:rejected.run}),rejected);
 // A late answer from an earlier request cannot move the new one.
 const next=musicSession(requesting,{type:'request'});
 assert.equal(musicSession(next,{type:'accepted',run:requesting.run}),next);
 const reset=musicSession(next,{type:'reset'});
 assert.equal(reset.phase,'idle');assert.equal(musicSession(reset,{type:'accepted',run:next.run}),reset);
});

test('music session: only requesting and accepted block the controls',()=>{
 const blocked=Object.fromEntries(MUSIC_SESSION_PHASES.map(phase=>[phase,controlsBlocked({phase,run:1})]));
 assert.deepEqual(blocked,{idle:false,requesting:true,accepted:true,confirmed:false,playing:false,rejected:false,
  unknown:false,expired:false});
});

test('music session from feedback: a confirmed settlement unblocks even when the item cannot be proven',()=>{
 const base={outcome:'accepted',awaitingObservation:true,requestedAt:Date.now()};
 assert.equal(musicSessionFromFeedback(null).phase,'idle');
 assert.equal(musicSessionFromFeedback({pending:true}).phase,'requesting');
 assert.equal(musicSessionFromFeedback(base).phase,'accepted');
 // Destination not provable, target id changed, failed playlist progress or clock skew: no observation,
 // but the settlement is confirmed. Before the fix the buttons stayed locked for 30 s.
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'confirmed'}).phase,'confirmed');
 assert.equal(controlsBlocked(musicSessionFromFeedback({...base,settlementStatus:'confirmed'})),false);
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'confirmed',displayExpired:true}).phase,'confirmed');
 assert.equal(musicSessionFromFeedback({...base,displayObserved:true}).phase,'playing');
 assert.equal(musicSessionFromFeedback(base,{observed:true}).phase,'playing');
 assert.equal(musicSessionFromFeedback({...base,displayExpired:true}).phase,'expired');
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'rejected'}).phase,'rejected');
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'superseded'}).phase,'rejected');
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'unknown'}).phase,'unknown');
 assert.equal(musicSessionFromFeedback({outcome:'rejected'}).phase,'rejected');
 assert.equal(musicSessionFromFeedback({outcome:'unknown'}).phase,'unknown');
});

test('playback freshness normalises stale to fresh, transient or stale',()=>{
 assert.equal(playbackFreshness({}),'fresh');
 assert.equal(playbackFreshness({stale:false}),'fresh');
 assert.equal(playbackFreshness({stale:null}),'fresh');
 assert.equal(playbackFreshness({stale:'transient'}),'transient');
 assert.equal(playbackFreshness({stale:true}),'stale');
 assert.equal(playbackFreshness({stale:'other'}),'stale');
});

// The room player's commands (room-commands.ts) and the queue presentation (queue-presentation.ts) are tested with
// the room player in podview/src/screens/player/room-player.test.js.
test('regression: selection hold follows the session, not the 30 s display wait',()=>{
 const view=Object.create(LiveMusicSelectionView.prototype);
 let feedback={outcome:'accepted',awaitingObservation:true,requestedAt:Date.now()};
 view.host={liveMedia:{playback:null}};
 view.playerFeedback=()=>feedback;view.pendingPlayer=()=>({title:'Song'});view.selectionItemObserved=()=>false;
 assert.deepEqual(view.controlHold(),{blocked:true,playing:false,phase:'accepted'});
 feedback={...feedback,settlementStatus:'confirmed'};
 assert.deepEqual(view.controlHold(),{blocked:false,playing:true,phase:'confirmed'});
 view.pendingPlayer=()=>null;
 assert.equal(view.controlHold(),null);
});
