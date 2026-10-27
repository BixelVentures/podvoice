import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
import {LiveMediaView} from '../../podvoice/gatekeeper/static/podview/live-media-view.js';
import {LiveMusicSelectionView} from '../../podvoice/gatekeeper/static/podview/live-music-selection-view.js';
import {LiveMusicCatalogueView} from '../../podvoice/gatekeeper/static/podview/live-music-view.js';

// Inert native DOM/HTTP ports only. All four production lifecycle owners and the
// actual playback/control parsers run unchanged; no effect reaches a provider.
class Node extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.className='';this.classList={add:c=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),c])].join(' ');},remove:c=>{this.className=this.className.split(' ').filter(v=>v!==c).join(' ');},contains:c=>this.className.split(' ').includes(c)};this.isConnected=true;this.open=false;this.textContent='';this.value='';this.style={getPropertyValue:k=>this.style[k]||'',setProperty:(k,v)=>this.style[k]=v};}
 append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}prepend(...nodes){for(const n of nodes.reverse()){n.remove();n.parentNode=this;this.children.unshift(n);}}after(){}replaceChildren(...nodes){for(const n of [...this.children])n.remove();this.append(...nodes);}remove(){if(this.parentNode){const rows=this.parentNode.children;rows.splice(rows.indexOf(this),1);this.parentNode=null;}}insertBefore(n,before){n.remove();n.parentNode=this;const i=this.children.indexOf(before);if(i<0)this.children.push(n);else this.children.splice(i,0,n);}
 setAttribute(k,v){this.attributes.set(k,String(v));if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}getAttribute(k){return this.attributes.get(k)??null;}
 removeAttribute(k){this.attributes.delete(k);}querySelector(tag){return this.children.find(n=>n.tagName===tag.toUpperCase())||null;}querySelectorAll(){return [];}showModal(){this.open=true;}close(){this.open=false;}focus(){}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(done=>setImmediate(done));};
function fixture(){
 const priorDocument=globalThis.document,priorNow=Date.now;let clock=priorNow(),poll=1,state='playing',setupCalls=0,setupPort=null,actionPort=null;
 Date.now=()=>clock;const nodes=new Map(),groups=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 const doc={createElement:tag=>new Node(tag),getElementById:node,body:new Node(),querySelector:selector=>groups.get(selector)};globalThis.document=doc;
 const host=new Node('host');Object.assign(host,{ownerDocument:doc,live:true,state:{focus:'music',connected:true,devices:[]},liveStatus:'connected',liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{musicRead:['playback','top','targets'],controlSetup:['music'],musicSelection:true},mediaRoomBindings:[{roomId:'room',accountId:'account',targetId:'configured',nativeRoomId:'configured-room',nativeHomepodId:'1',bindingId:'b'.repeat(64)}]},musicResults:{render:vm=>host.catalogueModel=vm},playerView:{renderPlayer:vm=>host.playerModel=vm,renderQueue(){},renderControls(){}},querySelector:selector=>{if(!groups.has(selector))groups.set(selector,new Node());return groups.get(selector);}});
 node('detail-output').append(new Node('span'));node('player-empty').append(new Node('h2'),new Node('p'));host.playerView=new PlayerView(host);
 const playback=()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'room',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'room',accountId:'account',targetId:'actual',nativeRoomId:'actual-room',nativeHomepodId:'2',bindingId:'a'.repeat(64),validUntil:clock/1000+15},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:'epoch',poll_sequence:poll,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date(clock).toISOString(),age_ms:0,max_age_ms:15000},playback:{state,target:{kind:'spotify_device',target_id:'actual',name:'Actual output'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Observed song',artists:['Observed artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
 const offer=(volume=35)=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'music',taskId:'control-'+setupCalls,revision:1,expiresAt:clock/1000+3,expectedBindingId:'a'.repeat(64),setup:{volume},options:['pause','resume','volume'].map(action=>({id:`opaque-${setupCalls}-${action}`,action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:35}:{kind:'none'}}))});
 const writes=[],reads=[],catalogueReads=[];
 host.liveTransport={connected:true,music:async kind=>{assert.equal(kind,'playback');reads.push({poll,state});return playback();},controlSetup:async(domain,target)=>{assert.equal(domain,'music');assert.deepEqual(target,{accountId:'account',kind:'spotify_device',targetId:'actual',expectedBindingId:'a'.repeat(64)});setupCalls++;return setupPort?setupPort():offer();},controlAction:async(task,id,args)=>{writes.push({task,id,args});return actionPort?actionPort():{outcome:'accepted'};}};
 const media=host.liveMedia=new LiveMediaView(host),selection=host.liveSelection=new LiveMusicSelectionView(host),controls=host.liveControls=new LiveControlView(host),catalogue=host.liveCatalogue=new LiveMusicCatalogueView(host,kind=>catalogueReads.push(kind));
 media.account=selection.account='account';catalogue.updateCapabilities(true,host.liveSnapshot.capabilities.musicRead);catalogue.resetAccount('account');
 const collection={ok:true,data:{config_entry_id:'account',tracks:[{uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Observed song',artist:'Observed artist'}]}};
 catalogue.select('top');catalogue.tracks('top',collection,'account');
 return {host,media,selection,controls,catalogue,nodes,reads,writes,catalogueReads,offer,playback,setupCalls:()=>setupCalls,holdSetup:port=>setupPort=port,holdAction:port=>actionPort=port,advance:ms=>clock+=ms,newPoll:nextState=>{poll++;if(nextState)state=nextState;},refreshCatalogue(){catalogue.refresh();catalogue.tracks('top',collection,'account');},async ready(){await media.refresh({immediate:true});await settle();assert.equal(node('play-pause').disabled,false);assert.equal(node('volume').disabled,false);},restore(){host.isConnected=false;host.playerView.cleanup();media.acceptedRefresh?.stop?.('cancelled');controls.cleanup();selection.cleanup();clearTimeout(catalogue.expiryTimer);media.queueControls.invalidate(true);globalThis.document=priorDocument;Date.now=priorNow;}};
}
const usable=f=>{assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);};
const disabled=f=>{assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);};

test('catalogue refresh alone cannot renew an expired offer; a new playback poll and released setup do',async()=>{
 const f=fixture();try{
  await f.ready();const firstTask=f.controls.musicOffer.task.taskId,reads=f.setupCalls(),item=f.media.playback.item.uri;
  f.advance(3001);f.media.render();usable(f);assert.equal(f.nodes.get('volume').value,'35');
  f.refreshCatalogue();await settle();usable(f);assert.equal(f.setupCalls(),reads);assert.equal(f.media.playback.item.uri,item);assert.equal(f.controls.musicOffer.task.taskId,firstTask);
  await f.media.refresh({immediate:true});await settle();usable(f);assert.equal(f.setupCalls(),reads,'same PC poll does not admit another setup');
  const hold=deferred();f.holdSetup(()=>hold.promise);f.newPoll();await f.media.refresh({immediate:true});usable(f);assert.equal(f.setupCalls(),reads+1);assert.equal(f.controls.musicReadPending,true);
  f.refreshCatalogue();await settle();usable(f);assert.equal(f.setupCalls(),reads+1,'catalogue neither duplicates nor cancels held setup');
  hold.resolve(f.offer());await settle();assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.notEqual(f.controls.musicOffer.task.taskId,firstTask);assert.deepEqual(f.writes,[]);
 }finally{f.restore();}
});

for(const outcome of ['accepted','unknown'])test(`catalogue refresh cannot release a held control or its ${outcome} fence`,async()=>{
 const f=fixture();const setup=deferred(),action=deferred();let intent;try{
  await f.ready();const before=f.setupCalls();f.holdSetup(()=>setup.promise);f.holdAction(()=>action.promise);
  intent=f.controls.musicIntent('pause');assert.equal(f.controls.musicIntentPending,true);usable(f);assert.equal(f.host.querySelector('.player .transport').getAttribute('aria-busy'),'true');
  f.refreshCatalogue();await settle();usable(f);assert.equal(f.controls.musicIntentPending,true);assert.equal(f.setupCalls(),before+1);assert.deepEqual(f.writes,[]);
  setup.resolve(f.offer());await settle();assert.equal(f.controls.pending,true);assert.equal(f.writes.length,1);usable(f);
  f.refreshCatalogue();await settle();usable(f);assert.equal(f.controls.pending,true);assert.equal(f.writes.length,1);
  // Observation is a separate source event. The receipt never manufactures it.
  f.holdSetup(null);action.resolve({outcome});await intent;await settle();
  if(outcome==='accepted'){
   usable(f);assert.equal(f.controls.musicFence.outcome,'accepted');const calls=f.setupCalls();f.refreshCatalogue();await settle();usable(f);assert.equal(f.setupCalls(),calls);assert.equal(f.media.playback.state,'playing');
   f.newPoll('paused');await f.media.refresh({immediate:true});await settle();
   assert.equal(f.media.playback.state,'paused');assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.writes.length,1);
  }else{
   disabled(f);assert.equal(f.controls.musicFence.outcome,'unknown');f.refreshCatalogue();f.newPoll();await f.media.refresh({immediate:true});await settle();disabled(f);assert.equal(f.controls.musicFence.outcome,'unknown');assert.equal(f.writes.length,1);assert.equal(await f.controls.musicIntent('pause'),false);
  }
 }finally{setup.resolve(f.offer());action.resolve({outcome:'unknown'});await intent;f.restore();}
});


test('actual100 above policy35 permits lowering; unknown is distinct and catalogue cannot invent a measurement',async()=>{
 const f=fixture();try{
  f.holdSetup(()=>f.offer(100));await f.media.refresh({immediate:true});await settle();
  const input=f.nodes.get('volume'),output=f.nodes.get('volume-value');
  assert.equal(input.max,'100');assert.equal(input.dataset.actionMax,'35');assert.equal(input.value,'100');assert.equal(output.textContent,'100 %');assert.equal(input.disabled,false);assert.equal(f.nodes.get('play-pause').disabled,false);
  f.advance(3001);f.holdSetup(()=>f.offer(null));f.newPoll();await f.media.refresh({immediate:true});await settle();
  assert.equal(input.value,'100');assert.equal(input.dataset.kitValueKnown,'false');assert.equal(output.textContent,'—');assert.equal(input.getAttribute('aria-valuetext'),'Ukendt lydstyrke');assert.equal(input.disabled,true);
  f.refreshCatalogue();await settle();assert.equal(input.value,'100');assert.equal(input.dataset.kitValueKnown,'false');assert.equal(output.textContent,'—');assert.equal(f.nodes.get('play-pause').disabled,false);assert.deepEqual(f.writes,[]);
 }finally{f.restore();}
});


for(const failure of ['rejected','invalid'])test(`actual player keeps passive ${failure} setup failure visible through Ro/overview without selection overlay, then clears on valid setup`,async()=>{
 const f=fixture(),held=deferred();try{
  f.holdSetup(()=>held.promise.then(()=>{if(failure==='rejected')throw Error('inert503');return {...f.offer(),expectedBindingId:'d'.repeat(64)};}));await f.media.refresh({immediate:true});await settle();
  assert.equal(f.controls.musicReadPending,true);assert.equal(f.nodes.get('player-state').textContent,'Spiller på');held.resolve();await settle();assert.equal(f.nodes.get('player-state').textContent,'Kan ikke styre højttaleren lige nu. Prøv igen om lidt.','settled async setup must update the visible owner before any navigation or rerender');
  for(const focus of ['music','photo','now']){f.host.state.focus=focus;f.media.render();assert.equal(f.nodes.get('player-state').textContent,'Kan ikke styre højttaleren lige nu. Prøv igen om lidt.');assert.equal(f.nodes.get('detail-status').textContent,'Kan ikke styre højttaleren lige nu. Prøv igen om lidt.');assert.equal(f.host.dataset.selectionFeedback,'false');assert.equal(f.host.querySelector('.player').getAttribute('aria-busy'),'false');disabled(f);assert.equal(f.nodes.get('track-name').textContent,'Observed song');}
  assert.equal(f.setupCalls(),1);assert.deepEqual(f.writes,[]);
  f.holdSetup(null);f.newPoll();await f.media.refresh({immediate:true});await settle();assert.equal(f.nodes.get('player-state').textContent,'Spiller på');assert.equal(f.nodes.get('detail-status').textContent,'');assert.equal(f.host.dataset.selectionFeedback,'false');assert.equal(f.nodes.get('play-pause').disabled,false);assert.deepEqual(f.writes,[]);
 }finally{held.resolve();f.restore();}
});
test('persistent control read failure yields to real selection feedback and never replaces account-only route status',async()=>{
 const f=fixture();try{
  f.holdSetup(()=>{throw Error('inert503');});await f.media.refresh({immediate:true});await settle();
  f.selection.feedback={message:'Afventer det eksplicitte musikvalg.',pending:true};f.media.render();assert.equal(f.nodes.get('player-state').textContent,'Afventer det eksplicitte musikvalg.');assert.equal(f.host.dataset.selectionFeedback,'true');
  f.selection.feedback=null;f.media.render();assert.equal(f.nodes.get('player-state').textContent,'Kan ikke styre højttaleren lige nu. Prøv igen om lidt.');assert.equal(f.host.dataset.selectionFeedback,'false');
  f.host.liveTransport.music=async()=>({...f.playback(),status:'account_observed',reason:'route_unavailable',binding:null});await f.media.refresh({immediate:true});await settle();
  assert.equal(f.nodes.get('player-state').textContent,'Afspiller · højttaler ikke bekræftet');assert.equal(f.nodes.get('detail-status').textContent,'Kontostatus · afspiller · højttaler ikke bekræftet');assert.equal(f.host.dataset.selectionFeedback,'false');disabled(f);assert.deepEqual(f.writes,[]);
 }finally{f.restore();}
});
