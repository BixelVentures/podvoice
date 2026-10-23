import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const start=code.indexOf(' async loadLiveMusic('),end=code.indexOf('\n connectGestures()',start);
const load=new Function(`return ({${code.slice(start,end)}}).loadLiveMusic`)();
function host(){
 const events=[],request={kind:'top',sourceKind:'account_playlists'};
 const h={isConnected:true,liveMedia:{account:'account'},liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{musicRead:['account_playlists']}},liveCatalogue:{pendingRead:request,loading:kind=>events.push(['loading',kind]),slow:()=>{},tracks:(...args)=>events.push(['tracks',...args]),failure:()=>events.push(['failure']),offline:()=>events.push(['offline']),setBusy:()=>{}},liveTransport:{connected:true,music:async(...args)=>{events.push(['read',...args]);return {ok:true,data:{playlists:[]}};}}};
 return {h,events};
}
test('For dig uses the explicitly admitted account playlist read while retaining its UI kind',async()=>{
 const {h,events}=host();await load.call(h,'top');assert.deepEqual(events.map(x=>x.slice(0,2)),[['loading','top'],['read','account_playlists'],['tracks','top']]);assert.equal(events[1][2],'account');assert.equal(events[1][3],undefined);
});
test('a superseded account-playlist request cannot paint a later tab or account',async()=>{
 for(const change of [h=>{h.liveCatalogue.pendingRead={kind:'top',sourceKind:'account_playlists'};},h=>{h.liveMedia.account='other';},h=>{h.liveSnapshot.capabilities.musicRead=[];},h=>{h.liveSnapshot.roomId='other';}]){
  const {h,events}=host();let complete;h.liveTransport.music=()=>new Promise(resolve=>{complete=resolve;});const pending=load.call(h,'top');change(h);complete({ok:true,data:{playlists:[]}});await pending;assert.equal(events.some(x=>x[0]==='tracks'),false);
 }
});
test('ordinary Top keeps its existing transport contract and cannot borrow an unoffered playlist source',async()=>{
 const {h,events}=host();h.liveCatalogue.pendingRead={kind:'top',sourceKind:'top'};h.liveSnapshot.capabilities.musicRead=['top'];await load.call(h,'top');assert.equal(events.find(x=>x[0]==='read')[1],'top');
 const blocked=host();blocked.h.liveSnapshot.capabilities.musicRead=['top'];await load.call(blocked.h,'top');assert.deepEqual(blocked.events,[['offline']]);
});
