// K2: after skips, the queue never lists already-played tracks as upcoming.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveQueueView} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
import {LiveMediaView} from '../../podvoice/gatekeeper/static/podview/live-media-view.js';
import {boundPlayback} from './room-fixture.mjs';

const uri=song=>'spotify:track:'+String(song).padStart(22,'0');
const item=(song,name=`Sang ${song}`)=>({type:'track',uri:uri(song),name,artists:['Kunstner']});
const row=(song,order,title=`Sang ${song}`)=>({id:String(song).padStart(24,'0'),title,artist:'Kunstner',
 uri:uri(song),artwork:null,order});

function fixture(queue){
 const host={isConnected:true,liveSnapshot:{bootId:'boot',roomId:'kitchen',
  capabilities:{queueSelection:true,musicRead:['queue']}},liveTransport:{connected:true},
 liveMedia:{account:'account',renderQueue(){},refresh:async()=>{}}};
 const playback=song=>boundPlayback(host.liveSnapshot,{owner_epoch:'epoch',poll_sequence:4+song,target:{id:'device'},
  expiresAt:Date.now()+15000,item:item(song)});
 host.liveMedia.playback=playback(20);
 let serial=0;
 host.liveTransport.queueOffer=async()=>({ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'kitchen',
  accountId:'account',targetId:'device',expectedBindingId:'a'.repeat(64),
  taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',
  pollSequence:host.liveMedia.playback.poll_sequence,truncated:false,items:queue()});
 const view=new LiveQueueView(host);
 return {host,view,playback,titles:()=>view.model('account',host.liveMedia.playback).items.map(r=>r.title),
  close(){view.invalidate(true);}};
}

test('K2: the known queue drops played rows as soon as the song changes, before a new read',async()=>{
 const f=fixture(()=>[row(21,1),row(22,2),row(23,3),row(24,4),row(25,5)]);
 try{
  assert.equal(await f.view.load('account',f.host.liveMedia.playback),true);
  assert.deepEqual(f.titles(),['Sang 21','Sang 22','Sang 23','Sang 24','Sang 25']);
  // Three Next taps: song 23 now plays; no queue read has answered yet.
  f.host.liveMedia.playback=f.playback(23);
  assert.deepEqual(f.titles(),['Sang 24','Sang 25']);
 }finally{f.close();}
});

test('K2: a fresh queue answer that still lists played tracks is re-anchored on the current song',async()=>{
 const f=fixture(()=>[row(21,1),row(22,2),row(23,3),row(24,4)]);
 try{
  f.host.liveMedia.playback=f.playback(23);
  assert.equal(await f.view.load('account',f.host.liveMedia.playback),true);
  const model=f.view.model('account',f.host.liveMedia.playback);
  assert.deepEqual(model.items.map(r=>r.title),['Sang 24']);
  assert.equal(model.items[0].selectable,true,'the remaining upcoming row keeps its own occurrence authority');
 }finally{f.close();}
});

test('K2: a relinked current track is matched by title and artist; an unknown song keeps the list',async()=>{
 const f=fixture(()=>[row(21,1),row(22,2,'Relinket'),row(23,3)]);
 try{
  assert.equal(await f.view.load('account',f.host.liveMedia.playback),true);
  f.host.liveMedia.playback={...f.playback(22),item:{...item(99),name:'Relinket',artists:['Kunstner']}};
  assert.deepEqual(f.titles(),['Sang 23']);
  f.host.liveMedia.playback={...f.playback(22),item:item(98,'Helt anden sang')};
  assert.deepEqual(f.titles(),['Sang 21','Relinket','Sang 23']);
 }finally{f.close();}
});

test('K2: a song observed while Next was pending gets its queue read when the intent ends',async()=>{
 const previous=globalThis.document;
 const node=()=>({hidden:false,setAttribute(){},addEventListener(){},prepend(){},replaceChildren(){}});
 globalThis.document={createElement:node,getElementById:node};
 const reads=[];
 const host={isConnected:true,state:{focus:'player'},liveSnapshot:{bootId:'boot',roomId:'display',
  capabilities:{musicRead:['playback','queue'],queueSelection:true},mediaRoomBindings:[]},liveTransport:{connected:true},
 playerView:{renderPlayer(){},renderControls(){},renderQueue(){}},liveSelection:{pendingPlayer:()=>null},
 liveControls:{musicIntentPending:true,render(){},invalidateMusic(){}}};
 const binding={roomId:'display',accountId:'account',targetId:'actual',nativeRoomId:'actual-room',nativeHomepodId:'2',
  bindingId:'a'.repeat(64),validUntil:Date.now()/1000+10};
 host.liveTransport.music=async()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'display',
  configEntryId:'account',status:'observed',reason:null,binding,data:{ok:true,schema:'podconnect.playback.v1',
   config_entry_id:'account',owner_epoch:'epoch',poll_sequence:7,physical_result_verified:false,
   observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},
   playback:{state:'playing',target:{kind:'spotify_device',target_id:'actual',name:'Stue'},
    item:{type:'track',uri:uri(23),name:'Sang 23',artists:['Kunstner'],duration_ms:1000},progress_ms:0,
    provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
 host.liveTransport.queueOffer=async(account,target,expected)=>{reads.push(target);return {ok:true,
  schema:'podview.queue-offer.v1',bootId:'boot',roomId:'display',accountId:account,targetId:target,
  expectedBindingId:expected,taskId:'queue:'+'1'.padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',
  pollSequence:7,truncated:false,items:[row(24,1)]};};
 const media=new LiveMediaView(host);host.liveMedia=media;media.account='account';
 try{
  await media.refresh({immediate:true});
  assert.equal(media.playback.item.uri,uri(23));
  assert.equal(reads.length,0,'no queue read while Next is pending');
  // The control view ends the intent; the queue follows the song without another playback poll.
  host.liveControls.musicIntentPending=false;
  const {LiveControlView}=await import('../../podvoice/gatekeeper/static/podview/live-control-view.js');
  const control=Object.create(LiveControlView.prototype);
  Object.assign(control,{host,musicIntentOwner:'token',musicIntentPending:true,musicQueued:null,musicDeferred:null,
   renderMusicControls(){}});
  control.endMusicIntent('token','accepted',uri(20));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads.length,1,'intent end reads the deferred queue once');
 }finally{media.queueControls.invalidate(true);globalThis.document=previous;}
});

// K4 (Green 12 Nov): autoplay continued after "Hør igen"; the source's autoplay queue was still
// unresolved at the song change, and the queue stayed empty for the rest of the song.
test('K4: an unresolved autoplay queue is read again on newer observations until its songs arrive',async()=>{
 const previous=globalThis.document;
 const node=()=>({hidden:false,setAttribute(){},addEventListener(){},prepend(){},replaceChildren(){}});
 globalThis.document={createElement:node,getElementById:node};
 const rendered=[];let poll=10,reads=0;
 const host={isConnected:true,state:{focus:'player'},liveSnapshot:{bootId:'boot',roomId:'display',
  capabilities:{musicRead:['playback','queue'],queueSelection:true},mediaRoomBindings:[]},liveTransport:{connected:true},
 playerView:{renderPlayer(){},renderControls(){},renderQueue:(items,options)=>rendered.push({items,options})},
 liveSelection:{pendingPlayer:()=>null}};
 const binding={roomId:'display',accountId:'account',targetId:'actual',nativeRoomId:'actual-room',nativeHomepodId:'2',
  bindingId:'a'.repeat(64),validUntil:Date.now()/1000+10};
 host.liveTransport.music=async()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'display',
  configEntryId:'account',status:'observed',reason:null,binding,data:{ok:true,schema:'podconnect.playback.v1',
   config_entry_id:'account',owner_epoch:'epoch',poll_sequence:poll,physical_result_verified:false,
   observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},
   playback:{state:'playing',target:{kind:'spotify_device',target_id:'actual',name:'Stue'},
    item:{type:'track',uri:uri(31),name:'One More Night',artists:['Kunstner'],duration_ms:1000},progress_ms:0,
    provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
 host.liveTransport.queueOffer=async(account,target,expected)=>{
  if(++reads<3)throw Object.assign(Error('pending'),{code:'queue_preview_pending'});
  return {ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'display',accountId:account,targetId:target,
   expectedBindingId:expected,taskId:'queue:'+'2'.padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',
   pollSequence:poll,truncated:false,items:[row(32,1,'So Caught Up'),row(33,2,'Colors')]};
 };
 const media=new LiveMediaView(host);host.liveMedia=media;media.account='account';
 const refresh=async()=>{await media.refresh({immediate:true});await new Promise(resolve=>setImmediate(resolve));};
 try{
  await refresh();
  assert.equal(reads,1);
  assert.deepEqual(rendered.at(-1).items,[]);
  assert.equal(rendered.at(-1).options.status,'loading','unresolved autoplay is pending, not an empty queue');
  await refresh();poll++;await refresh();
  assert.equal(reads,3,'each newer source observation reads the unresolved queue again');
  assert.deepEqual(rendered.at(-1).items.map(r=>r.title),['So Caught Up','Colors']);
  await refresh();await refresh();
  assert.equal(reads,3,'a resolved queue is not polled');
 }finally{media.queueControls.invalidate(true);globalThis.document=previous;}
});
