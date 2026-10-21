import {installDOMAttributes} from './helpers/dom-attributes.mjs';
import {bindRoom,targetEnvelope} from './canonical-room-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSample,directTargets,selectionRequestTargets,selectionOffer,selectionCurrent} from '../../podvoice/gatekeeper/static/podview/music-selection-model.js';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {LiveMusicSelectionView} from '../../podvoice/gatekeeper/static/podview/live-music-selection-view.js';

const track={name:'Faktisk sang',artist:'Faktisk kunstner',uri:'spotify:track:0123456789ABCDEFGHIJKL'};
const snapshot=()=>({schema:'podview.snapshot.v1',bootId:'boot',roomId:'kitchen',revision:2,voice:{sessionId:null},answers:{},timers:{status:'observed',items:[]},capabilities:{musicRead:['search','targets'],musicSelection:true,timerActions:[]}});
const context=()=>({schema:'podview.music-search-context.v1',bootId:'boot',roomId:'kitchen',configEntryId:'account',source:'spotify_web_api',query:'sang',candidateSetId:'a'.repeat(64),revisionScope:'music_selection',sessionId:'touch:one',turnId:'touch:two',taskId:'music:three',inputRevision:1,revision:1});
const result=()=>({ok:true,data:{ok:true,schema:'podconnect.search_tracks.v1',config_entry_id:'account',source:'spotify_web_api',coverage:'spotify_search_sample',query:'sang',limit:3,source_sample_count:1,returned_count:1,tracks:[track]},candidateSet:context()});
const target={accountId:'account',kind:'spotify_device',targetId:'direct-one',name:'Køkkenalrum HomePod'};
const offer=()=>({ok:true,schema:'podview.music-selection.v1',candidateSetId:'a'.repeat(64),accountId:'account',target:{kind:'spotify_device',targetId:'direct-one'},taskId:'music-selection:'+'b'.repeat(32),revision:1,startVolumePercent:35,expiresIn:50,options:[{id:'c'.repeat(24),label:track.name,artist:track.artist}]});

test('search and target projection require exact account, source and current room context',()=>{
 const s=snapshot(),body=result();assert.equal(searchSample(body,'account','sang',s).tracks[0].name,track.name);
 assert.equal(searchSample(body,'other','sang',s),null);
 assert.equal(searchSample(body,'account','sang',{...s,bootId:'new'}).context,null);
 assert.equal(searchSample({...body,data:{...body.data,source:'invented'}},'account','sang',s),null);
 const targets={ok:true,coverage:'account_targets',data:{targets:[{...target,readOnly:false,restricted:false},{...target,kind:'configured_alias',targetId:'alias',readOnly:false,restricted:false},{...target,kind:'observed_output',targetId:'observed',readOnly:true,restricted:false}]}};
 assert.deepEqual(directTargets(targetEnvelope(s,targets,'account','direct-one'),'account',s),[target]);
 assert.equal(directTargets(targets,'other',s),null);
});

test('offer accepts only opaque server options and expires against boot, account and capability',()=>{
 const source=searchSample(result(),'account','sang',snapshot()),value=selectionOffer(offer(),source,target);
 assert.equal(value.options[0].id,'c'.repeat(24));assert.equal('uri' in value.options[0],false);
 assert.equal(selectionCurrent(value,snapshot(),'account',source),true);
 assert.equal(selectionCurrent(value,{...snapshot(),bootId:'new'},'account',source),false);
 assert.equal(selectionCurrent(value,snapshot(),'other',source),false);
 assert.equal(selectionCurrent(value,{...snapshot(),capabilities:{musicSelection:false}},'account',source),false);
 assert.equal(selectionCurrent({...value,expiresAt:Date.now()-1},snapshot(),'account',source),false);
 assert.equal(selectionOffer({...offer(),options:[{id:'c'.repeat(24),label:'Another song',artist:track.artist}]},source,target),null);
});

test('transport sends exact query, opaque setup and one action without a browser track URI',async()=>{
 const calls=[],t=new PodVoiceTransport({url:'https://home.example/view/',fetch:async(url,init={})=>{calls.push({url:String(url),init});if(String(url).includes('/actions')){const sent=JSON.parse(init.body);return {ok:true,json:async()=>({ok:true,outcome:'accepted',requestId:sent.requestId,retryAllowed:false,physicalResultVerified:false})};}if(String(url).includes('/setup'))return {ok:true,json:async()=>offer()};return {ok:true,json:async()=>result()};}});
 t.connected=true;t.closed=false;t.snapshot=snapshot();t.controller=new AbortController();const sample=await t.music('search','account','sang');assert.equal(sample.ok,true);assert.match(calls[0].url,/kind=search/);assert.match(calls[0].url,/query=sang/);
 await t.musicSelectionSetup('a'.repeat(64),target);const setup=JSON.parse(calls[1].init.body);assert.equal(setup.candidateSetId,'a'.repeat(64));assert.deepEqual(setup.target,{accountId:'account',kind:'spotify_device',targetId:'direct-one'});
 const parsed=selectionOffer(offer(),searchSample(result(),'account','sang',snapshot()),target),action=await t.musicSelectionAction(parsed,'c'.repeat(24));assert.equal(action.outcome,'accepted');assert.equal(calls.length,3);const sent=JSON.parse(calls[2].init.body);assert.equal(sent.optionId,'c'.repeat(24));assert.equal(sent.confirmedVolumePercent,35);assert.equal('uri' in sent,false);t.close();
});

test('malformed action reply is unknown and capability loss prevents a send',async()=>{
 let calls=0;const t=new PodVoiceTransport({url:'https://home.example/view/',fetch:async()=>{calls++;return {ok:true,json:async()=>({ok:true,outcome:'accepted',requestId:'wrong',retryAllowed:false,physicalResultVerified:false})};}});t.connected=true;t.snapshot=snapshot();const parsed=selectionOffer(offer(),searchSample(result(),'account','sang',snapshot()),target);const first=await t.musicSelectionAction(parsed,'c'.repeat(24));assert.equal(first.outcome,'unknown');assert.equal(first.retryAllowed,false);assert.equal(calls,1);t.snapshot.capabilities.musicSelection=false;assert.equal((await t.musicSelectionAction(parsed,'c'.repeat(24))).outcome,'rejected');assert.equal(calls,1);t.close();
});

test('read-only search survives a same-room snapshot and clears on boot replacement',()=>{
 const view=Object.create(LiveMusicSelectionView.prototype),s=snapshot();let cleared=0;
 Object.assign(view,{account:'account',host:{isConnected:true,liveTransport:{connected:true},liveSnapshot:s,liveMedia:{account:'account'}},source:{tracks:[track],context:null},searchScope:{bootId:'boot',roomId:'kitchen',accountId:'account'},offer:null,render(){},invalidate(){cleared++;}});
 view.onSnapshot();assert.equal(cleared,0);view.host.liveSnapshot={...s,bootId:'new'};view.onSnapshot();assert.equal(cleared,1);
});

test('confirmation consumes the offered task before awaiting a single send',async()=>{
 const source=searchSample(result(),'account','sang',snapshot()),task=selectionOffer(offer(),source,target);let calls=0,release;
 const held=new Promise(resolve=>release=resolve),view=Object.create(LiveMusicSelectionView.prototype);
 Object.assign(view,{account:'account',host:{isConnected:true,liveSnapshot:snapshot(),liveMedia:{account:'account'},liveTransport:{connected:true,async musicSelectionAction(){calls++;await held;return {outcome:'unknown'};}}},source,offer:task,chosen:task.options[0],generation:0,pending:false,used:false,dialog:{close(){}},note:{textContent:''},render(){}});
 const first=view.send(),second=view.send();assert.equal(calls,1);release();await Promise.all([first,second]);assert.equal(view.used,true);assert.equal(view.offer,null);assert.match(view.note.textContent,/gentages ikke/);
});

function heldView(transport){
 const view=Object.create(LiveMusicSelectionView.prototype),s=snapshot();
 Object.assign(view,{host:{isConnected:true,liveSnapshot:s,liveMedia:{account:'account'},liveTransport:{connected:true,...transport}},account:'account',generation:0,active:false,source:null,offer:null,targets:[],used:false,pending:false,input:{value:'sang'},dialog:{open:false,close(){}},targetSelect:{value:'direct-one',replaceChildren(){}},results:{replaceChildren(){}},targetLabel:{hidden:true},note:{textContent:''},render(){},showTracks(){},showTargets(){}});
 return view;
}

test('same-account owner replacement fences a held search result',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),view=heldView({music:async()=>held});
 const pending=view.search();view.ownerChanged('account');release(result());await pending;
 assert.equal(view.source,null);assert.equal(view.offer,null);assert.equal(view.active,false);
});

test('same-account owner replacement fences a held setup and closes its choice',async()=>{
 let release,closed=0;const held=new Promise(resolve=>release=resolve),view=heldView({musicSelectionSetup:async()=>held});
 view.source=searchSample(result(),'account','sang',snapshot());view.targets=[target];view.dialog={open:true,close(){closed++;this.open=false;}};
 const pending=view.setup();view.ownerChanged('account');release(offer());await pending;
 assert.equal(view.offer,null);assert.equal(view.source,null);assert.ok(closed>=1);
});

test('delayed setup response cannot extend the server offer deadline',()=>{
 const source=searchSample(result(),'account','sang',snapshot()),start=Date.now();
 const admitted=selectionOffer(offer(),source,target,start-1000);
 assert.ok(admitted);assert.ok(admitted.expiresAt<=start+49000);
 assert.equal(selectionOffer(offer(),source,target,start-51000),null);
});

test('revoke then restore cannot revive a held setup',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),view=heldView({musicSelectionSetup:async()=>held});
 view.source=searchSample(result(),'account','sang',snapshot());view.searchScope={bootId:'boot',roomId:'kitchen',accountId:'account'};view.targets=[target];view.onSnapshot();
 const pending=view.setup();view.host.liveSnapshot={...snapshot(),capabilities:{...snapshot().capabilities,musicSelection:false}};view.onSnapshot();view.host.liveSnapshot=snapshot();view.onSnapshot();release(offer());await pending;
 assert.equal(view.source,null);assert.equal(view.offer,null);
});

test('search-capability revoke then restore cannot revive a held search',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),view=heldView({music:async()=>held});view.onSnapshot();
 const pending=view.search();view.host.liveSnapshot={...snapshot(),capabilities:{...snapshot().capabilities,musicRead:['targets']}};view.onSnapshot();view.host.liveSnapshot=snapshot();view.onSnapshot();release(result());await pending;
 assert.equal(view.source,null);assert.equal(view.offer,null);
});

test('new start policy stays separate from manual observed volume and does not require a name in the closed offer target',()=>{
 const source=searchSample(result(),'account','sang',snapshot());
 const body={...offer(),observedVolumePercent:27};
 const parsed=selectionOffer(body,source,target);
 assert.equal(parsed.startVolumePercent,35);assert.equal('observedVolumePercent' in parsed,false);
 assert.equal(parsed.target.name,'Køkkenalrum HomePod');
 const legacy={...offer(),observedVolumePercent:35};delete legacy.startVolumePercent;
 assert.equal(selectionOffer(legacy,source,target),null);
 for(const bad of [-1,101,35.5,'35',null])assert.equal(selectionOffer({...offer(),startVolumePercent:bad},source,target),null);
 const view=heldView({});view.source=source;view.offer=parsed;view.openConfirm(0);assert.equal(view.dialog.open,false);assert.match(view.feedback.message,/ikke længere/);
});

test('manual 27 percent never replaces explicit 35 percent start confirmation on the wire',async()=>{
 let sent;const t=new PodVoiceTransport({url:'https://home.example/view/',fetch:async(_url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({ok:true,outcome:'accepted',requestId:sent.requestId,retryAllowed:false,physicalResultVerified:false})};}});
 t.connected=true;t.snapshot=snapshot();
 const parsed=selectionOffer({...offer(),observedVolumePercent:27},searchSample(result(),'account','sang',snapshot()),target);
 await t.musicSelectionAction(parsed,'c'.repeat(24));
 assert.equal(sent.confirmedVolumePercent,35);assert.equal('observedVolumePercent' in sent,false);assert.equal('startVolumePercent' in sent,false);
 assert.equal('target' in sent,false);assert.equal('uri' in sent,false);t.close();
});

test('search form remains available but result action never opens a target or confirmation dialog',async()=>{
 const previous=globalThis.document;
 class Element extends EventTarget{constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};}append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes[k]=v;}showModal(){this.open=true;}close(){this.open=false;}replaceChildren(){this.children=[];}}
installDOMAttributes(Element);
 globalThis.document={createElement:tag=>new Element(tag)};
 let view;
 try{const calls=[],s=snapshot();bindRoom(s,'account','direct-one');const host={isConnected:true,liveSnapshot:s,liveMedia:{account:'account'},querySelector:()=>new Element('div'),append(){},musicResults:{render(){}},liveTransport:{connected:true,musicSelectionSetup:async()=>offer(),musicSelectionAction:async(task,id)=>{calls.push(id);return {outcome:'accepted'};}}};view=new LiveMusicSelectionView(host);view.account='account';view.active=true;view.source=searchSample(result(),'account','sang',s);view.searchScope=view.context();view.targets=[target];view.showTargets();assert.equal(view.targetLabel.hidden,true);await view.chooseCard({optionIndex:0});assert.deepEqual(calls,['c'.repeat(24)]);assert.notEqual(view.dialog.open,true);assert.notEqual(view.searchDialog.open,true);assert.equal(view.targetLabel.hidden,true);await view.chooseCard({optionIndex:0});assert.equal(calls.length,1);view.openSearch();assert.equal(view.searchDialog.open,true);assert.equal(view.input.type,'search');
 }finally{clearTimeout(view?.expiryTimer);globalThis.document=previous;}
});

test('search result Play uses room binding without a confirmation and shows its receipt only through player feedback',async()=>{const sent=[],view=heldView({musicSelectionSetup:async()=>offer(),musicSelectionAction:async(_task,id)=>{sent.push(id);return {outcome:'accepted'};}});try{bindRoom(view.host.liveSnapshot,'account','direct-one');view.active=true;view.source=searchSample(result(),'account','sang',view.host.liveSnapshot);view.searchScope=view.context();view.targets=[target];view.searchDialog={open:false};await view.chooseCard({optionIndex:0});assert.deepEqual(sent,['c'.repeat(24)]);assert.equal(view.dialog.open,false);assert.equal(view.searchDialog.open,false);assert.equal(view.note.textContent,'');assert.match(view.feedback.message,/modtaget/);await view.chooseCard({optionIndex:0});assert.equal(sent.length,1);}finally{clearTimeout(view.expiryTimer);}});

test('search direct intent is cancelled by navigation while setup is held even if focus stays put',async()=>{let release,sent=0;const view=heldView({musicSelectionSetup:()=>new Promise(resolve=>release=resolve),musicSelectionAction:async()=>{sent++;return {outcome:'accepted'};}});try{bindRoom(view.host.liveSnapshot,'account','direct-one');view.host.state={focus:'music'};view.active=true;view.source=searchSample(result(),'account','sang',view.host.liveSnapshot);view.searchScope=view.context();view.targets=[target];const pending=view.chooseCard({optionIndex:0});view.host.state.focus='home';release(offer());await pending;assert.equal(sent,0);assert.equal(view.dialog.open,false);assert.equal(view.feedback,null);}finally{clearTimeout(view.expiryTimer);}});

const emptySearchTargets=view=>({ok:true,coverage:'account_targets',bootId:view.host.liveSnapshot.bootId,roomId:view.host.liveSnapshot.roomId,roomBinding:{...view.host.liveSnapshot.mediaRoomBindings[0]},data:{targets:[]}});
function searchDiscoveryView(){const setupCalls=[],sent=[],models=[],view=heldView({});Object.assign(view,{form:{},panel:{setAttribute(){}},submit:{},back:{},render(){LiveMusicSelectionView.prototype.render.call(this);}});view.host.musicResults={render:model=>models.push(model)};bindRoom(view.host.liveSnapshot,'account','direct-one');view.host.state={focus:'music'};view.searchDialog={open:false,close(){this.open=false;}};view.host.liveTransport.music=async kind=>kind==='search'?result():emptySearchTargets(view);view.host.liveTransport.musicSelectionSetup=async(...args)=>{setupCalls.push(args);return offer();};view.host.liveTransport.musicSelectionAction=async(_task,id)=>{sent.push(id);return {outcome:'unknown'};};return {view,setupCalls,sent,models,cleanup(){clearTimeout(view.expiryTimer);}};}
test('song search empty exact discovery remains inert until explicit Play requests native setup then sends once',async()=>{const f=searchDiscoveryView();try{await f.view.search();assert.equal(f.view.source.tracks[0].uri,track.uri);assert.equal(f.models.at(-1).canChoose,true);assert.equal(f.setupCalls.length,0);assert.equal(f.sent.length,0);await f.view.chooseCard({optionIndex:0});assert.equal(f.setupCalls.length,1);assert.deepEqual(f.setupCalls[0][1],{accountId:'account',kind:'spotify_device',targetId:'direct-one',name:'Rummets højttaler'});assert.deepEqual(f.sent,['c'.repeat(24)]);assert.match(f.view.feedback.message,/gentages ikke/);await f.view.chooseCard({optionIndex:0});assert.equal(f.sent.length,1);assert.notEqual(f.view.dialog.open,true);assert.notEqual(f.view.searchDialog.open,true);}finally{f.cleanup();}});
test('song search empty exact discovery can request setup but unavailable native owner never grants an action',async()=>{const f=searchDiscoveryView();try{f.view.host.liveTransport.musicSelectionSetup=async(...args)=>{f.setupCalls.push(args);throw Error('native unavailable');};await f.view.search();await f.view.chooseCard({optionIndex:0});assert.equal(f.setupCalls.length,1);assert.equal(f.sent.length,0);assert.equal(f.view.offer,null);assert.match(f.view.feedback.message,/rummet/);}finally{f.cleanup();}});
test('song search retains exact empty-discovery denial boundaries without substitute targets or effects',async()=>{for(const cause of ['no-echo','foreign-binding','room','boot','foreign-row','restricted','readOnly','alias','observed-output','ok-false','data-error','envelope-error','unavailable','bad-stamp','failed-read']){const f=searchDiscoveryView();try{const response=emptySearchTargets(f.view),row={...target,restricted:false,readOnly:false};if(cause==='no-echo')delete response.roomBinding;if(cause==='foreign-binding')response.roomBinding.bindingId='b'.repeat(64);if(cause==='room')response.roomId='foreign';if(cause==='boot')response.bootId='foreign';if(cause==='foreign-row')response.data.targets=[{...row,targetId:'foreign'}];if(cause==='restricted')response.data.targets=[{...row,restricted:true}];if(cause==='readOnly')response.data.targets=[{...row,readOnly:true}];if(cause==='alias')response.data.targets=[{...row,kind:'configured_alias'}];if(cause==='observed-output')response.data.targets=[{...row,kind:'observed_output'}];if(cause==='ok-false')response.ok=false;if(cause==='data-error')response.data.error='unavailable';if(cause==='envelope-error')response.errors=['unavailable'];if(cause==='unavailable')response.status='unavailable';if(cause==='bad-stamp')response.observedAt='invalid';f.view.host.liveTransport.music=async kind=>{if(kind==='search')return result();if(cause==='failed-read')throw Error('read_access_denied');return response;};await f.view.search();await f.view.chooseCard({optionIndex:0});assert.equal(f.setupCalls.length,0,cause);assert.equal(f.sent.length,0,cause);assert.notEqual(f.view.dialog.open,true,cause);}finally{f.cleanup();}}});

test('shared setup-request resolver preserves empty discovery truth and creates no action authority',()=>{const f=searchDiscoveryView();try{const body=emptySearchTargets(f.view);assert.deepEqual(directTargets(body,'account',f.view.host.liveSnapshot),[]);const request=selectionRequestTargets(body,'account',f.view.host.liveSnapshot);assert.deepEqual(request,[{accountId:'account',kind:'spotify_device',targetId:'direct-one',name:'Rummets højttaler'}]);assert.equal('options' in request[0],false);assert.equal('taskId' in request[0],false);assert.equal(f.setupCalls.length,0);assert.equal(f.sent.length,0);assert.equal(selectionRequestTargets(body,'foreign',f.view.host.liveSnapshot),null);}finally{f.cleanup();}});
test('held empty song-search discovery cannot survive room, boot, account, permission, binding or navigation replacement',async()=>{for(const boundary of ['room','boot','account','permission','binding','leave']){const f=searchDiscoveryView();try{f.view.onSnapshot();const body=emptySearchTargets(f.view);let release,entered;const ready=new Promise(resolve=>entered=resolve);f.view.host.liveTransport.music=async kind=>{if(kind==='search')return result();entered();return new Promise(resolve=>release=()=>resolve(body));};const pending=f.view.search();await ready;if(boundary==='room')f.view.host.liveSnapshot.roomId='foreign';if(boundary==='boot')f.view.host.liveSnapshot.bootId='foreign';if(boundary==='account')f.view.ownerChanged('foreign');if(boundary==='permission')f.view.host.liveSnapshot.capabilities.musicSelection=false;if(boundary==='binding')f.view.host.liveSnapshot.mediaRoomBindings[0].bindingId='b'.repeat(64);if(boundary==='leave')f.view.leave();f.view.onSnapshot();release();await pending;await f.view.chooseCard({optionIndex:0});assert.equal(f.setupCalls.length,0,boundary);assert.equal(f.sent.length,0,boundary);assert.equal(f.view.offer,null,boundary);}finally{f.cleanup();}}});
test('held native setup from empty song-search discovery retains intent and authority fences',async()=>{for(const boundary of ['room','boot','account','provider','permission','binding','source','focus','leave']){const f=searchDiscoveryView(),previous=globalThis.document,focus={};globalThis.document={activeElement:focus,body:{}};try{f.view.onSnapshot();await f.view.search();let release,entered;const ready=new Promise(resolve=>entered=resolve),original=f.view.host.liveTransport.musicSelectionSetup;f.view.host.liveTransport.musicSelectionSetup=async(...args)=>{const response=await original(...args);entered();return new Promise(resolve=>release=()=>resolve(response));};const pending=f.view.chooseCard({optionIndex:0});await ready;if(boundary==='room')f.view.host.liveSnapshot.roomId='foreign';if(boundary==='boot')f.view.host.liveSnapshot.bootId='foreign';if(boundary==='account')f.view.ownerChanged('foreign');if(boundary==='provider')f.view.host.liveSnapshot.providerGeneration=8;if(boundary==='permission')f.view.host.liveSnapshot.capabilities.musicSelection=false;if(boundary==='binding')f.view.host.liveSnapshot.mediaRoomBindings[0].bindingId='b'.repeat(64);if(boundary==='source')f.view.source.context.candidateSetId='d'.repeat(64);if(boundary==='focus')globalThis.document.activeElement={};if(boundary==='leave')f.view.leave();f.view.onSnapshot();release();await pending;assert.equal(f.sent.length,0,boundary);assert.equal(f.view.offer,null,boundary);assert.equal(f.setupCalls.length,1,boundary);}finally{globalThis.document=previous;f.cleanup();}}});
