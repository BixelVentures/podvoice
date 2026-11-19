// Ported from tests/podview/root-speaker-output-idle.test.mjs and root-configured-speaker-label.test.mjs (node:test +
// fake DOM) to Vitest with a real DOM (happy-dom), when the player and the speaker picker moved to React. Same
// assertions; each was first run against the pre-React player-view.js and speaker-output-view.js in the same real DOM.
// Adaptations: placeOutputHeader runs on a real PlayerView's outputPlacement (the fake slot was a hand-made view), so
// the fake parent's and copy's child lists are compared among the real card's and copy's children (placed()), with
// the output adjacent to the volume after it, and no duplicate #output; `attributes[key]` is getAttribute(key); the
// configured-label host is the real shell's (mountSpeakers), and its mock view (an output already in its copy) is a
// real PlayerView on that shell; configuredSpeakerLabel is the pure one in speaker-catalogue.js.
import {test} from 'vitest';
import {LiveMediaView} from '../../../live-media-view.js';
import {roomPlayerObservation} from '../../../media-observation.js';
import {livePlayerModel} from '../../../player-model.js';
import {configuredSpeakerLabel} from '../../../speaker-catalogue.js';
import {roomPlayerWire} from '../../../../scripts/room-player-wire.mjs';
import assert from './dom-assert.js';
import {mountPlayer, mountSpeakers} from './player-fixture.js';
import {PlayerView, placeOutputHeader} from './PlayerView';


// root-speaker-output-idle: the slot is a real PlayerView's outputPlacement (the output and the volume after it in
// the player card, the empty card's title and the copy holding it); the fake parent and copy held only those nodes.
function surface() {
  const {view, $} = mountPlayer();
  const {output, parent, next, emptyTitle, copy} = view.outputPlacement;
  output.listenerIdentity = {};
  return {view, output, parent, next, emptyTitle, copy, state: $('player-state'), room: $('player-room')};
}
// The fake parent's and copy's children, among the real ones (the card's other parts, the empty copy's text).
const placed = (s, node) => [...node.children].filter(child => [s.output, s.next, s.emptyTitle].includes(child));
const outputs = () => document.querySelectorAll('#output').length;

test('idle uses the same output node and neutral empty header, never fake playing metadata',()=>{const s=surface(),identity=s.output.listenerIdentity;placeOutputHeader(s.view,{active:false,canOutput:true});assert.equal(s.copy.children[0],s.output);assert.equal(s.output.listenerIdentity,identity);assert.equal(s.output.disabled,false);assert.equal(s.room.textContent,'Musik');assert.equal(s.state.textContent,'');assert.equal(s.output.getAttribute('aria-label'),'Musik · Se aktuelle højttalere');});
test('populated playback restores the same canonical output node',()=>{const s=surface();placeOutputHeader(s.view,{active:false,canOutput:true});placeOutputHeader(s.view,{active:true,canOutput:true});assert.deepEqual(placed(s,s.parent),[s.output,s.next]);assert.equal(s.output.nextElementSibling,s.next);assert.equal(s.copy.children[0],s.emptyTitle);});
for(const state of [{active:false,canOutput:false},{active:false,loading:false,canOutput:false},{active:false,loading:true,canOutput:false}])test(`empty room header survives disconnection and failure without granting control: ${JSON.stringify(state)}`,()=>{const s=surface(),identity=s.output.listenerIdentity;placeOutputHeader(s.view,{active:false,canOutput:true,configuredTarget:'Køkkenalrum HomePod'});placeOutputHeader(s.view,{...state,configuredTarget:'Køkkenalrum HomePod'});assert.deepEqual(placed(s,s.copy),[s.output]);assert.deepEqual(placed(s,s.parent),[s.next]);assert.equal(s.output.listenerIdentity,identity);assert.equal(s.output.disabled,true);assert.equal(s.room.textContent,'Køkkenalrum HomePod');assert.equal(s.state.textContent,'');assert.equal(s.output.getAttribute('aria-label'),'Konfigureret højttaler: Køkkenalrum HomePod');});
test('repeated idle renders never duplicate control or header',()=>{const s=surface();for(let i=0;i<3;i++)placeOutputHeader(s.view,{active:false,canOutput:true});assert.deepEqual(placed(s,s.copy),[s.output]);assert.equal(outputs(),1);placeOutputHeader(s.view,{active:true});placeOutputHeader(s.view,{active:false,canOutput:true});assert.deepEqual(placed(s,s.copy),[s.output]);assert.deepEqual(placed(s,s.parent),[s.next]);assert.equal(outputs(),1);});


test('idle output accessible name always includes its visible heading across configured and unavailable states',()=>{
 const s=surface();
 for(const value of [{canOutput:true},{canOutput:false},{canOutput:true,configuredTarget:'Køkkenalrum HomePod'},{canOutput:false,configuredTarget:'Stue'}]){
  placeOutputHeader(s.view,{active:false,...value});
  assert.ok(s.room.textContent);assert.ok(s.output.getAttribute('aria-label').includes(s.room.textContent));
  assert.equal(s.output.disabled,!value.canOutput);
 }
});

test('idle next destination replaces configured display with explicit nonplaying intent in the same retained header',()=>{
 const s=surface(),identity=s.output.listenerIdentity;placeOutputHeader(s.view,{active:false,canOutput:true,configuredTarget:'Køkkenalrum HomePod',nextDestinationLabel:'Svend’s HomePod'});assert.equal(s.room.textContent,'Svend’s HomePod');assert.equal(s.state.textContent,'');assert.equal(s.output.getAttribute('aria-label'),'Næste afspilning: Svend’s HomePod');assert.equal(s.output.listenerIdentity,identity);assert.equal(s.copy.children[0],s.output);assert.equal(s.output.disabled,false);
 placeOutputHeader(s.view,{active:false,canOutput:true,configuredTarget:'Køkkenalrum HomePod'});assert.equal(s.room.textContent,'Køkkenalrum HomePod');assert.equal(s.output.getAttribute('aria-label'),'Konfigureret højttaler: Køkkenalrum HomePod');
});

// CI 13/11 (music_selection cold journeys): every background playback read set loading and greyed the
// speaker button for a frame, so a tap that landed then was lost and the picker never opened.
test('a playback read in the empty room never greys the speaker button: the picker opens in every state',()=>{
 const s=surface();placeOutputHeader(s.view,{active:false,canOutput:true,configuredTarget:'Køkkenalrum HomePod'});
 for(const loading of [true,false,true]){
  placeOutputHeader(s.view,{active:false,loading,canOutput:true,configuredTarget:'Køkkenalrum HomePod'});
  assert.equal(s.output.disabled,false,`loading=${loading} keeps the picker usable`);
  assert.equal(s.output.getAttribute('aria-label'),'Konfigureret højttaler: Køkkenalrum HomePod');
 }
});

// root-configured-speaker-label.
// Authored scenes in the room player's wire shape (podview.room-player.v1).
const roomPlaybackObservation=(body,account,snapshot)=>roomPlayerObservation(roomPlayerWire(body),account,snapshot);
const binding={accountId:'a',bindingId:'b'.repeat(64),nativeHomepodId:'42',nativeRoomId:'kitchen',roomId:'room',targetId:'engine'};
const snapshot=()=>({bootId:'boot',roomId:'room',sessionId:'session',mediaRoomBindings:[{...binding}],capabilities:{musicRead:['targets','playback'],controlSetup:[]}});
const payload=()=>({ok:true,schema:'podview.speaker-catalogue.v1',bootId:'boot',roomId:'room',accountId:'a',status:'observed',catalogueId:'c'.repeat(64),retrievedAt:Date.now()/1000,source:'podconnect.get_targets',speakers:[{speakerId:'d'.repeat(64),accountId:'a',kind:'configured_alias',nativeRoomId:'kitchen',homepodId:'42',name:'Køkkenalrum',availability:'available',default:true,nativeSelected:false,outputSelected:false,selectable:false}],moveAvailable:false,physicalResultVerified:false});
// A SpeakerOutputView on the real shell; `nodes.get(id)` reads the document.
function setup() {
  const {host, view, $} = mountSpeakers({liveSnapshot: snapshot(), liveMedia: {account: 'a', render() {}},
    liveTransport: {connected: true, music: async () => payload()}});
  return {host, view, nodes: {get: $}};
}
test('configured destination survives empty playback without selected/output authority',async()=>{const {host,view,nodes}=setup();try{let calls=[];host.liveTransport.music=async(...args)=>{calls.push(args);return payload();};await view.refreshConfiguredLabel();assert.equal(view.configuredLabel(),'Køkkenalrum');assert.deepEqual(calls,[['speakers','a']]);const vm=livePlayerModel(null,true,'unavailable',host.liveSnapshot,view.configuredLabel());assert.equal(vm.active,false);assert.equal(vm.playing,false);assert.equal(vm.target,'');assert.equal(vm.volume,null);assert.equal(vm.configuredTarget,'Køkkenalrum');
 // The fake view (its output already in the empty copy) is a real PlayerView on the same shell.
 const player=new PlayerView(host,{}),output=nodes.get('output');placeOutputHeader(player,vm);
 assert.equal(nodes.get('player-room').textContent,'Køkkenalrum');assert.equal(nodes.get('player-state').textContent,'');assert.equal(output.getAttribute('aria-label'),'Konfigureret højttaler: Køkkenalrum');player.cleanup();}finally{view.cleanup();}});
for(const field of ['room','boot','account','homepod','alias','stale','future','duplicate'])test(`configured label rejects ${field}`,()=>{const value=payload(),snap=snapshot();if(field==='room')value.roomId='foreign';if(field==='boot')value.bootId='foreign';if(field==='account')value.accountId='foreign';if(field==='homepod')value.speakers[0].homepodId='43';if(field==='alias')value.speakers[0].nativeRoomId='other';if(field==='stale')value.retrievedAt-=31;if(field==='future')value.retrievedAt+=6;if(field==='duplicate')value.speakers.push({...value.speakers[0]});assert.equal(configuredSpeakerLabel(value,snap,'a'),'');});
for(const field of ['room','boot','account','generation','revoked','binding','disconnect','transport','cleanup'])test(`held label read cannot publish after ${field}`,async()=>{const {host,view}=setup();try{let resolve;host.liveTransport.music=()=>new Promise(r=>resolve=r);const pending=view.refreshConfiguredLabel();if(field==='room')host.liveSnapshot.roomId='other';if(field==='boot')host.liveSnapshot.bootId='other';if(field==='account')host.liveMedia.account='other';if(field==='generation')host.liveTransport.generation=(host.liveTransport.generation||0)+1;if(field==='revoked')host.liveSnapshot.capabilities.musicRead=[];if(field==='binding')host.liveSnapshot.mediaRoomBindings[0].bindingId='e'.repeat(64);if(field==='disconnect')host.liveTransport.connected=false;if(field==='transport')host.liveTransport={...host.liveTransport};if(field==='cleanup')view.cleanup();resolve(payload());await pending;assert.equal(view.configuredLabel(),'');}finally{view.cleanup();}});
test('clearRoom revokes media/control observation but retains independently current configured label',async()=>{const {host,view}=setup();try{await view.refreshConfiguredLabel();let revoked=0;host.liveControls={invalidateMusic(){revoked++;},musicContext(){return null;}};const media={host,generation:0,rows:new Map(),queueControls:{invalidate(){}},playback:{state:'playing'}};LiveMediaView.prototype.clearRoom.call(media);assert.equal(media.playback,null);assert.equal(revoked,1);assert.equal(view.configuredLabel(),'Køkkenalrum');host.liveSnapshot.mediaRoomBindings[0].bindingId='e'.repeat(64);view.sync();assert.equal(view.configuredLabel(),'');}finally{view.cleanup();}});
test('expiry retains validated configuration text while revoking fresh observed destination without an effect or automatic read',async()=>{const original=globalThis.setTimeout,originalNow=Date.now,callbacks=[];let now=originalNow();Date.now=()=>now;globalThis.setTimeout=fn=>{callbacks.push(fn);return 1;};const {host,view}=setup();try{let reads=0,renders=0;host.liveMedia.render=()=>renders++;host.liveTransport.music=async()=>{reads++;return payload();};await view.refreshConfiguredLabel();assert.equal(view.configuredLabel(),'Køkkenalrum');assert.equal(view.observedDestination('d'.repeat(64)),false);
 host.liveMedia.playback=roomPlaybackObservation({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'room',configEntryId:'a',status:'observed',reason:null,binding:{...binding,validUntil:now/1000+15},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'a',owner_epoch:'native-owner',poll_sequence:1,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date(now).toISOString(),age_ms:0,max_age_ms:15000},playback:{state:'playing',target:{kind:'spotify_device',target_id:'engine',name:'Native output'},item:{type:'track',uri:'spotify:track:'+'A'.repeat(22),name:'Actual track',artists:['Actual artist'],duration_ms:180000},progress_ms:1000,provider_changed_at_ms:now,shuffle:false,repeat:'off'},physical_result_verified:false}},'a',host.liveSnapshot);
 assert.equal(view.observedDestination('d'.repeat(64)),true);now+=15001;assert.equal(view.observedDestination('d'.repeat(64)),false);assert.notEqual(view.labelValue,null);assert.equal(view.configuredLabel(),'Køkkenalrum');now+=15000;callbacks.at(-1)();assert.equal(view.configuredLabel(),'Køkkenalrum');assert.equal(view.observedDestination('d'.repeat(64)),false);assert.equal(view.labelValue,null);assert.equal(view.selectionDestination(),null);assert.equal(reads,1);assert.equal(renders,2);}finally{view.cleanup();globalThis.setTimeout=original;Date.now=originalNow;}});

test('queued earlier expiry cannot erase newer catalogue label',async()=>{const originalTimer=globalThis.setTimeout,originalNow=Date.now,callbacks=[];let now=100000;Date.now=()=>now;globalThis.setTimeout=fn=>{callbacks.push(fn);return callbacks.length;};const {host,view}=setup();try{await view.refreshConfiguredLabel();const oldExpiry=callbacks[0];now+=30001;await view.refreshConfiguredLabel();assert.equal(view.configuredLabel(),'Køkkenalrum');oldExpiry();assert.equal(view.configuredLabel(),'Køkkenalrum');}finally{view.cleanup();globalThis.setTimeout=originalTimer;Date.now=originalNow;}});

test('held configured-label read survives an unrelated voice turn without any effect',async()=>{const {host,view}=setup();try{let resolve,reads=0;host.liveTransport.music=()=>{reads++;return new Promise(r=>resolve=r);};const pending=view.refreshConfiguredLabel();Object.assign(host.liveSnapshot,{sessionId:'another-voice-session',taskId:'another-answer',inputRevision:42,providerGeneration:7});resolve(payload());await pending;assert.equal(view.configuredLabel(),'Køkkenalrum');assert.equal(reads,1);}finally{view.cleanup();}});
