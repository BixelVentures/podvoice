import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveMediaView} from '../../podvoice/gatekeeper/static/podview/live-media-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function rig(){
 const previous=globalThis.document,node=()=>({hidden:false,setAttribute(){},addEventListener(){},prepend(){},replaceChildren(){}});globalThis.document={createElement:node,getElementById:node};
 let serial=0,binding='a'.repeat(64);const reads=[];
 const host={isConnected:true,state:{focus:'player'},liveSnapshot:{bootId:'boot',roomId:'display',capabilities:{musicRead:['playback','queue'],queueSelection:true},mediaRoomBindings:[]},liveTransport:{connected:true},playerView:{renderPlayer(){},renderControls(){},renderQueue(){}},liveSelection:{pendingPlayer:()=>null}};
 const wire=()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'display',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'display',accountId:'account',targetId:'actual',nativeRoomId:'actual-room',nativeHomepodId:'2',bindingId:binding,validUntil:Date.now()/1000+10},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:'epoch',poll_sequence:2,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:{state:'playing',target:{kind:'spotify_device',target_id:'actual',name:'Bridge'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
 host.liveTransport.music=async()=>wire();host.liveTransport.queueOffer=async(account,target,expected)=>{reads.push({account,target,expected});return {ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'display',accountId:account,targetId:target,expectedBindingId:expected,taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:2,truncated:false,items:[]};};
 const media=new LiveMediaView(host);host.liveMedia=media;media.account='account';
 return {host,media,reads,wire,replaceBinding:()=>binding='b'.repeat(64),async refresh(){await media.refresh({immediate:true});await tick();},close(){media.queueControls.invalidate(true);globalThis.document=previous;}};
}
test('already open player reads queue once when fresh actual playback arrives, and once for replacement binding',async()=>{const f=rig();try{await f.media.loadQueue();assert.equal(f.reads.length,0);await f.refresh();assert.equal(f.reads.length,1);assert.equal(f.media.queueControls.status,'ready');await f.refresh();assert.equal(f.reads.length,1);f.replaceBinding();await f.refresh();assert.equal(f.reads.length,2);assert.equal(f.reads[1].expected,'b'.repeat(64));}finally{f.close();}});
test('explicit player opening already read the queue: unchanged playback does not read again',async()=>{const f=rig();try{f.host.state.focus='now';await f.refresh();assert.equal(f.reads.length,0);f.host.state.focus='player';await f.media.loadQueue();await f.refresh();assert.equal(f.reads.length,1);}finally{f.close();}});
for(const state of ['outside','disconnected','selection-pending','selection-unknown','queue-pending','queue-unknown','wrong-owner','stale'])test(`automatic queue read stays closed for ${state}`,async()=>{const f=rig();try{
 f.host.state.focus='now';await f.refresh();f.host.state.focus='player';
 if(state==='outside')f.host.state.focus='music';
 if(state==='disconnected')f.host.liveTransport.connected=false;
 if(state==='selection-pending')f.host.liveSelection.feedback={pending:true};
 if(state==='selection-unknown')f.host.liveSelection.feedback={outcome:'unknown'};
 if(state==='queue-pending')f.media.queueControls.pending=true;
 if(state==='queue-unknown'){f.media.queueControls.status='unknown';f.media.queueControls.consumed=true;}
 if(state==='wrong-owner')f.host.liveSnapshot.bootId='replacement';
 if(state==='stale')f.media.playback.stale=true;
 await f.media.loadQueue({automatic:true});await tick();assert.equal(f.reads.length,0);
 }finally{f.close();}});
test('pending selection settling permits one read on the next actual observation, not every poll',async()=>{const f=rig();try{f.host.liveSelection.feedback={pending:true};await f.refresh();assert.equal(f.reads.length,0);f.host.liveSelection.feedback=null;await f.refresh();await f.refresh();assert.equal(f.reads.length,1);}finally{f.close();}});
test('failed automatic queue read does not retry on unchanged polls',async()=>{const f=rig();try{let reads=0;f.host.liveTransport.queueOffer=async()=>{reads++;throw Error('unavailable');};await f.refresh();await f.refresh();assert.equal(reads,1);assert.equal(f.media.queueControls.status,'error');}finally{f.close();}});
test('late queue for replaced actual binding cannot overwrite the new queue',async()=>{const f=rig();let release;try{const source=f.host.liveTransport.queueOffer;let first=true;f.host.liveTransport.queueOffer=async(...args)=>{const reply=await source(...args);if(first){first=false;return new Promise(resolve=>release=()=>resolve(reply));}return reply;};await f.refresh();assert.equal(f.media.queueControls.pending,true);f.replaceBinding();await f.refresh();assert.equal(f.reads.length,2);const accepted=f.media.queueControls.offer;assert.equal(accepted.expectedBindingId,'b'.repeat(64));release();await tick();assert.equal(f.media.queueControls.offer,accepted);}finally{release?.();f.close();}});
for(const terminal of [false,true])test(`same binding readmission after observed unbound state ${terminal?'preserves UNKNOWN command fence':'reads queue once again'}`,async()=>{const f=rig();try{
 await f.refresh();assert.equal(f.reads.length,1);
 if(terminal){f.media.queueControls.consumed=true;f.media.queueControls.status='unknown';}
 f.host.liveTransport.music=async()=>({...f.wire(),status:'account_observed',reason:'route_unavailable',binding:null});
 await f.refresh();assert.equal(f.media.playback.accountObserved,true);assert.equal(f.reads.length,1);
 f.host.liveTransport.music=async()=>f.wire();await f.refresh();await f.refresh();
 assert.equal(f.reads.length,terminal?1:2);
 if(!terminal)assert.equal(f.media.queueControls.status,'ready');
 }finally{f.close();}});

for(const explicit of [false,true])test(`held control intent does not latch an unstarted ${explicit?'explicit':'automatic'} queue read`,async()=>{const f=rig();try{
 let effects=0;f.host.liveTransport.queueAction=async()=>{effects++;throw Error('unexpected effect');};
 f.host.liveControls={musicIntentPending:true,render(){},invalidateMusic(){}};
 await f.refresh();if(explicit)await f.media.loadQueue();
 assert.equal(f.reads.length,0);assert.ok(f.media.queueReadKey==null,'unstarted read has no attempted key');
 const context=JSON.stringify(f.host.liveSnapshot);f.host.liveControls.musicIntentPending=false;
 await f.refresh();assert.equal(JSON.stringify(f.host.liveSnapshot),context);assert.equal(f.reads.length,1);assert.equal(f.media.queueControls.status,'ready');
 await f.refresh();assert.equal(f.reads.length,1);assert.equal(effects,0);
 }finally{f.close();}});
