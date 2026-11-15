// Musik-Koe: music that plays on another device has no queue for this room. The queue settles at once on the
// empty state instead of showing loading rows for ten seconds first.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveMediaView} from '../../podvoice/gatekeeper/static/podview/live-media-view.js';

function fixture(playback){
 const shown=[];
 const view=Object.create(LiveMediaView.prototype);
 Object.assign(view,{account:'account',playback,queueTroubleSince:null,queueTroubleTimer:null,
  queueControls:{retained:null,offer:null,pending:false,invalidations:0,invalidate(){this.invalidations++;},
   model(){return null;},status:'stale'},
  host:{isConnected:true,liveSnapshot:{bootId:'boot',roomId:'kitchen',
   capabilities:{queueSelection:true,musicRead:['playback','queue']}},
   playerView:{renderQueue:(items,options)=>shown.push({items,options})}}});
 return {view,shown};
}

test('Musik-Koe: playback on another device resolves to the empty state at once, not loading rows',()=>{
 const {view,shown}=fixture({state:'playing',elsewhere:true,source:'spotify',
  item:{type:'track',uri:'spotify:track:'+'1'.repeat(22),name:'Heartless',artists:['Kanye West']}});
 try{
  view.renderQueue();
  const {items,options}=shown.at(-1);
  assert.deepEqual(items,[]);
  assert.notEqual(options.status,'loading','no skeleton for a queue that cannot come');
  assert.equal(options.placeholders,false);
  assert.equal(options.empty,'Køen kan ikke vises lige nu. Musikken spiller videre.');
  assert.equal(view.queueTroubleTimer,null,'nothing waits to resolve it later');
 }finally{clearTimeout(view.queueTroubleTimer);}
});
