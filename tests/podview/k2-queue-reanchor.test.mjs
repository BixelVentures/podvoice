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


// K4 (Green 12 Nov): autoplay continued after "Hør igen"; the source's autoplay queue was still
// unresolved at the song change, and the queue stayed empty for the rest of the song.
