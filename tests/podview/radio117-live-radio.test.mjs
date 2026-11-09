import test from 'node:test';
import assert from 'node:assert/strict';
import {radioObservation,LiveRadioView} from '../../podvoice/gatekeeper/static/podview/live-radio-view.js';
import {stations} from '../../podvoice/gatekeeper/static/podview/radio-model.js';
const now=Date.now(),snapshot={bootId:'boot',roomId:'room'};
test('startup connection invalidation before first snapshot keeps host rendering without radio authority',()=>{
 const calls=[],host={isConnected:true,liveTransport:{connected:false},render:()=>calls.push('host'),liveMedia:{render:()=>calls.push('music')},showFeedback:message=>calls.push(['feedback',message])},radio=new LiveRadioView(host);
 assert.doesNotThrow(()=>radio.invalidate());
 assert.equal(radio.current(),false);assert.equal(radio.can('start'),false);assert.equal(radio.value,undefined);
 assert.deepEqual(calls,[['feedback',''],'host','music']);
 host.liveSnapshot=snapshot;assert.doesNotThrow(()=>radio.invalidate(true));assert.equal(radio.can('start'),false);
});
function value(overrides={}){return {ok:true,schema:'podview.radio.v1',...snapshot,revision:1,enabled:true,blockedReasons:[],stations:stations.map(s=>({id:s.id,name:s.label})),targets:[{id:'stuen',name:'Stuen',availability:'available',selectable:true,default:true}],actions:['start','stop','move'],state:{status:'playing',stationId:'p3',targetId:'stuen',generation:1,sourceKind:'radio',ownerGeneration:1,volumePercent:null,observedAt:now/1000},retrievedAt:now/1000,validUntil:now/1000+30,physicalResultVerified:false,...overrides};}
function fixture(v=value()){const calls=[],host={isConnected:true,liveSnapshot:snapshot,liveTransport:{connected:true},playerView:{renderPlayer:vm=>calls.push(['player',vm]),renderControls:vm=>calls.push(['controls',vm]),renderQueue:()=>{}}};const radio=new LiveRadioView(host);host.liveRadio=radio;radio.value=v;radio.render=()=>{};return {host,radio,calls};}
test('radio catalogue admits only scoped fresh native observations in canonical station order',()=>{assert.ok(radioObservation(value(),snapshot,null,now));for(const bad of [value({bootId:'other'}),value({validUntil:now/1000-1}),value({stations:[...value().stations].reverse()}),value({physicalResultVerified:true}),value({actions:['resume_spotify']}),value({state:{...value().state,sourceKind:undefined}})])assert.equal(radioObservation(bad,snapshot,null,now),null);});
test('radio rejects rollback of revision, session generation and native source owner generation',()=>{const previous=value();for(const next of [value({revision:0}),value({state:{...value().state,generation:0}}),value({state:{...value().state,ownerGeneration:0}})])assert.equal(radioObservation(next,snapshot,previous,now),null);});
test('native source claim owns shared player rather than last-arriving Spotify read',()=>{const {radio,calls}=fixture();assert.equal(radio.renderPlayer(),true);assert.equal(calls[0][1].sourceKind,'radio');assert.equal(calls[1][1].previous,undefined);radio.value=value({state:{...value().state,sourceKind:'spotify',ownerGeneration:2,status:'stopped'}});assert.equal(radio.renderPlayer(),false);});
test('stale radio retains display but revokes every control and target choice',()=>{const {radio,calls}=fixture(value({validUntil:0}));assert.equal(radio.renderPlayer(),true);assert.equal(calls[0][1].fresh,false);assert.equal(calls[1][1].blocked,true);assert.equal(radio.target(),null);});
test('target precedence is observed actual then explicit next then valid default',()=>{const {radio}=fixture();radio.value.targets.push({id:'kitchen',name:'Køkken',availability:'available',selectable:true,default:false});radio.nextTarget='kitchen';assert.equal(radio.target().id,'stuen');radio.value.state.targetId=null;assert.equal(radio.target().id,'kitchen');radio.nextTarget=null;assert.equal(radio.target().id,'stuen');radio.value.targets[0].availability='unavailable';assert.equal(radio.target(),null);});
test('same playing station does not submit an offer; stopped station explicitly starts live',async()=>{const {radio}=fixture(),actions=[];radio.act=(...args)=>actions.push(args);await radio.choose('p3');assert.equal(actions.length,0);radio.value.state.status='stopped';await radio.choose('p3');assert.deepEqual(actions,[['start',{stationId:'p3',targetId:'stuen'}]]);});
test('unsupported controls never route into Spotify and stop targets only radio session',()=>{const {radio}=fixture(),actions=[];radio.act=(...args)=>actions.push(args);radio.control({type:'skip',delta:1});radio.control({type:'toggle'});assert.deepEqual(actions,[['stop',{}, {kind:'transport',id:'play-pause'}]]);});
test('unknown action outcome fences commands without retries or optimistic playing',async()=>{const {radio,host}=fixture(value({state:{...value().state,status:'stopped'}}));let offers=0,actions=0;host.liveTransport.radioOffer=async()=>{offers++;return {ok:true,...snapshot,taskId:'opaque-task',optionId:'opaque-option',expiresAt:Date.now()/1000+10};};host.liveTransport.radioAction=async()=>{actions++;return {status:'unknown'};};await radio.choose('p3');assert.equal(radio.value.state.status,'stopped');assert.equal(radio.unknown,true);await radio.choose('p3');assert.equal(offers,1);assert.equal(actions,1);});
test('an offer resolved after owner scope changes is never sent',async()=>{const {radio,host}=fixture();let actions=0;host.liveTransport.radioOffer=async()=>{host.liveSnapshot={...snapshot,bootId:'new'};return {ok:true,...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+10};};host.liveTransport.radioAction=async()=>{actions++;};await radio.choose('p1');assert.equal(actions,0);});
test('radio without valid destination opens existing picker before any mutation',async()=>{const {radio}=fixture(value({targets:[],state:{...value().state,targetId:null}}));let opened=0,actions=0;radio.openOutputs=()=>opened++;radio.act=()=>actions++;await radio.choose('p1');assert.equal(opened,1);assert.equal(actions,0);assert.equal(radio.waitingStation,'p1');});
test('accepted receipt is settled only by newer native observation without optimistic playing',async()=>{const {radio,host}=fixture(value({state:{...value().state,status:'stopped'}}));let atReceipt;host.liveTransport.radioOffer=async()=>({ok:true,...snapshot,taskId:'task',optionId:'option',expiresAt:Date.now()/1000+5});host.liveTransport.radioAction=async()=>{atReceipt=radio.value.state.status;return {status:'accepted'};};host.liveTransport.radio=async()=>value({revision:2,state:{...value().state,generation:2,status:'playing'}});await radio.choose('p3');assert.equal(atReceipt,'stopped');assert.equal(radio.value.state.status,'playing');assert.equal(radio.pending,false);assert.equal(radio.unknown,false);clearTimeout(radio.expiry);});
test('new native observation recovers unknown display without reissuing action',async()=>{const {radio,host}=fixture();radio.unknown=true;radio.unknownGeneration=1;let reads=0;host.liveTransport.radio=async()=>{reads++;return value({revision:2,state:{...value().state,generation:2}});};await radio.refresh({immediate:true});assert.equal(reads,1);assert.equal(radio.unknown,false);clearTimeout(radio.expiry);});
test('connection invalidation cancels an in-flight source read and rejects its late response',async()=>{const {radio,host}=fixture();let resolve;host.liveTransport.radio=()=>new Promise(r=>resolve=r);const read=radio.refresh({immediate:true});radio.invalidate(true);resolve(value({revision:2}));await read;assert.equal(radio.value,null);assert.equal(radio.pending,false);});
test('active native radio requires measured observation, coherent source and bounded volume',()=>{for(const state of [{...value().state,observedAt:null},{...value().state,observedAt:now/1000-31},{...value().state,targetId:null},{...value().state,sourceKind:'spotify'},{...value().state,volumePercent:101},{...value().state,volumePercent:0.5}])assert.equal(radioObservation(value({state}),snapshot,null,now),null);});
test('radio mute restore is scoped to radio native ownership without Spotify login',async()=>{const {PlayerView}=await import('../../podvoice/gatekeeper/static/podview/player-view.js');const {host,radio}=fixture();host.live=true;host.liveMedia={account:null,playback:null};const binding=PlayerView.prototype.volumeBinding.call({host});assert.match(binding,/radio/);radio.value.state.ownerGeneration=2;assert.notEqual(PlayerView.prototype.volumeBinding.call({host}),binding);});
test('cancelling destination picker clears deferred station and releases radio sheet custody',async()=>{const {radio}=fixture(value({targets:[],state:{...value().state,targetId:null}}));radio.openOutputs=()=>{radio.outputOpen=true;};await radio.choose('p1');assert.equal(radio.waitingStation,'p1');radio.closeOutputs();assert.equal(radio.waitingStation,null);assert.equal(radio.outputOpen,false);let action=0;radio.act=()=>action++;radio.value=value();radio.openOutputs();assert.equal(radio.waitingStation,null);assert.equal(action,0);});
test('disconnect or revoked scope clears deferred station without effect',()=>{const {radio}=fixture();radio.waitingStation='p3';radio.outputOpen=true;let action=0;radio.act=()=>action++;radio.invalidate(true);assert.equal(radio.waitingStation,null);assert.equal(radio.outputOpen,false);assert.equal(action,0);});
test('disconnect revokes read authority even if transport reconnects before a new radio GET',()=>{const {radio,host}=fixture();assert.equal(radio.can('start'),true);host.liveTransport.connected=false;radio.invalidate();host.liveTransport.connected=true;assert.equal(radio.current(),false);assert.equal(radio.can('start'),false);assert.equal(radio.target(),null);});
test('disconnect after action submission preserves unknown fence for same native generation',async()=>{const {radio,host}=fixture(value({state:{...value().state,status:'stopped'}}));let resolve;host.liveTransport.radioOffer=async()=>({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});host.liveTransport.radioAction=()=>new Promise(r=>resolve=r);const action=radio.choose('p3');await Promise.resolve();assert.ok(radio.sentOperation);radio.invalidate();resolve({status:'accepted'});await action;assert.equal(radio.unknown,true);host.liveTransport.radio=async()=>value();await radio.refresh({immediate:true});assert.equal(radio.unknown,true);clearTimeout(radio.expiry);});
test('radio access denial revokes retained source and destination intent',async()=>{const {radio,host}=fixture();radio.nextTarget='stuen';radio.waitingStation='p1';host.liveTransport.radio=async()=>{throw Object.assign(Error('denied'),{code:'read_access_denied'});};await radio.refresh({immediate:true});assert.equal(radio.value,null);assert.equal(radio.nextTarget,null);assert.equal(radio.waitingStation,null);});
test('actual host radio projection admits live transport independently of deliberately-false local scene flag',async()=>{const {readFileSync}=await import('node:fs');const {initialScene}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');const {liveScene}=await import('../../podvoice/gatekeeper/static/podview/podvoice-view.js');const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),expression=source.match(/const radioModel=(\{live:this.live,[\s\S]*?\}),radioSignature=/)?.[1];assert.ok(expression);const s=liveScene(initialScene(),{...snapshot,timers:{status:'observed',items:[]},voice:{sessionId:null},capabilities:{musicRead:[],homeRead:[]}});assert.equal(s.connected,false);const {host,radio}=fixture();host.live=true;const project=new Function('s','homeConnection',`return (${expression});`);assert.equal(project.call(host,s,{reason:null}).connected,true);host.liveTransport.recoveryBlocked=true;assert.equal(project.call(host,s,{reason:'denied'}).connected,false);});
test('accepted action observed unknown recovers only from a newer definitive native revision without command replay',async()=>{const {radio,host}=fixture(value({state:{...value().state,status:'stopped'}}));let actions=0;host.liveTransport.radioOffer=async()=>({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});host.liveTransport.radioAction=async()=>{actions++;return {status:'accepted'};};host.liveTransport.radio=async()=>value({revision:2,state:{...value().state,status:'unknown',generation:2}});await radio.choose('p3');assert.equal(radio.unknown,true);assert.equal(radio.unknownGeneration,2);assert.equal(radio.unknownBoot,'boot');host.liveTransport.radio=async()=>value({revision:3,state:{...value().state,status:'playing',generation:2}});await radio.refresh({immediate:true});assert.equal(radio.unknown,false);assert.equal(actions,1);clearTimeout(radio.expiry);});
test('preparing, unknown and error retain last confirmed radio transport without fabricating a stop',()=>{const {radio,calls}=fixture();radio.lastConfirmed={...radio.value.state};for(const status of ['preparing','unknown','error']){radio.value=value({state:{...value().state,status,stationId:'p1'}});calls.length=0;radio.renderPlayer();assert.equal(calls[0][1].title,'P3');assert.equal(calls[0][1].playing,true);assert.equal(calls[0][1].fresh,false);assert.equal(calls[1][1].playing,true);}radio.value=value({state:{...value().state,status:'stopped'}});calls.length=0;radio.renderPlayer();assert.equal(calls[0][1].playing,false);});
test('host never projects preparing or unknown radio as observed stopped station',async()=>{const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),expression=source.match(/const radioModel=(\{live:this.live,[\s\S]*?\}),radioSignature=/)?.[1],project=new Function('s','homeConnection',`return (${expression});`),{host,radio}=fixture();host.live=true;for(const status of ['preparing','unknown','error']){radio.value.state.status=status;assert.equal(project.call(host,{connected:false},{reason:null}).playing,null);}radio.value.state.status='stopped';assert.equal(project.call(host,{connected:false},{reason:null}).playing,false);radio.value.state.status='playing';assert.equal(project.call(host,{connected:false},{reason:null}).playing,true);});
test('stopped radio target cannot override explicit next destination',()=>{const {radio}=fixture();radio.value.targets.push({id:'kitchen',name:'Køkken',availability:'available',selectable:true,default:false});radio.value.state.status='stopped';radio.nextTarget='kitchen';assert.equal(radio.target().id,'kitchen');});
test('actual host projection exposes separate native start permission for passive unknown with no action offers',async()=>{const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),expression=source.match(/const radioModel=(\{live:this.live,[\s\S]*?\}),radioSignature=/)?.[1],project=new Function('s','homeConnection',`return (${expression});`),{host,radio}=fixture();host.live=true;radio.value.state.status='unknown';radio.value.actions=[];const model=project.call(host,{connected:false},{reason:null});assert.equal(model.enabled,true);assert.equal(model.canStart,false);assert.equal(model.playing,null);});
test('fresh stopped radio remembers its valid destination below explicit next and requires a picker if that destination disappears',async()=>{const {radio}=fixture();radio.value.targets.push({id:'kitchen',name:'Køkken',availability:'available',selectable:true,default:false});radio.value.state={...radio.value.state,status:'stopped',targetId:'kitchen'};assert.equal(radio.nextTarget,undefined);assert.equal(radio.target().id,'kitchen');const actions=[];radio.act=(...args)=>actions.push(args);await radio.choose('p3');assert.deepEqual(actions,[['start',{stationId:'p3',targetId:'kitchen'}]]);radio.nextTarget='stuen';assert.equal(radio.target().id,'stuen');radio.nextTarget=null;radio.value.targets[1].availability='unavailable';assert.equal(radio.target(),null);radio.value.targets.splice(1,1);assert.equal(radio.target(),null);radio.value.targets[0].availability='unavailable';assert.equal(radio.target(),null);});

// Passive source transitions also need honest feedback without a local action.
test('passive preparation has no loading text panel and error uses canonical feedback',()=>{for(const status of ['preparing','error']){const {radio,calls}=fixture(value({state:{...value().state,status},actions:status==='preparing'?[]:['start']}));assert.equal(radio.renderPlayer(),true);assert.equal(calls[0][1].controlStatus,'');assert.equal(calls[0][1].feedback?.state,status==='error'?'error':undefined);assert.equal(calls[0][1].playing,false);}});
test('retained playing display and toggle dispatch the same Stop action after native error, while unknown remains disabled',()=>{const {radio,calls}=fixture();radio.lastConfirmed={...radio.value.state};const sent=[];radio.act=action=>sent.push(action);for(const status of ['error','unknown']){radio.value.state.status=status;radio.value.actions=['start','stop'];calls.length=0;radio.renderControls();assert.equal(calls[0][1].playing,true);assert.equal(calls[0][1].toggle,status==='error');if(calls[0][1].toggle)radio.control({type:'toggle'});}assert.deepEqual(sent,['stop']);});

function held(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('held station offer and writer show only exact readonly control; no observation or provider authority changes',async()=>{const {radio,host,calls}=fixture();const offer=held(),writer=held(),posts=[];host.liveTransport.radioOffer=body=>{posts.push(body);return offer.promise;};host.liveTransport.radioAction=body=>{posts.push(body);return writer.promise;};host.liveTransport.radio=async()=>value({revision:2,state:{...value().state,stationId:'p1',generation:2}});const operation=radio.choose('p1');assert.deepEqual(radio.progress(),{kind:'station',id:'p1'});assert.equal(Object.isFrozen(radio.progress()),true);assert.equal(radio.pendingPhase,'preparing');radio.renderControls();assert.equal(calls.filter(row=>row[0]==='controls').at(-1)?.[1]?.loadingControlId,'play-pause');assert.equal(radio.message,'');assert.equal(radio.value.state.stationId,'p3');assert.equal(radio.can('start'),false);await radio.choose('p1');assert.equal(posts.length,1);const marker=radio.progress();offer.resolve({...snapshot,taskId:'task',optionId:'opt',expiresAt:Date.now()/1000+5});await Promise.resolve();await Promise.resolve();assert.equal(radio.pendingPhase,'sending');assert.equal(radio.progress(),marker);assert.deepEqual(Object.keys(posts[0]).sort(),['action','bootId','revision','roomId','stationId','targetId','volumePercent']);assert.equal(posts[0].stationId,'p1');writer.resolve({status:'accepted'});await operation;assert.equal(radio.progress(),null);assert.equal(radio.pending,false);assert.equal(radio.value.state.stationId,'p1');assert.equal(radio.feedback(),null);clearTimeout(radio.expiry);});
test('first start while Spotify owns player shows requested display only and restores source on offer failure',async()=>{const {radio,host,calls}=fixture(value({state:{...value().state,sourceKind:'spotify',status:'idle',stationId:null,targetId:null}}));const offer=held();host.liveTransport.radioOffer=()=>offer.promise;const operation=radio.choose('p1');assert.deepEqual(radio.progress(),{kind:'station',id:'p1'});assert.equal(radio.renderPlayer(),true);assert.equal(radio.ownsPlayer(),false);assert.equal(calls[0][1].title,'P1');assert.equal(calls[0][1].playing,false);assert.equal(calls[0][1].loading,true);assert.equal(calls[0][1].canOutput,false);calls.length=0;offer.resolve({...snapshot,taskId:'task',optionId:'opt',expiresAt:0});await operation;assert.equal(radio.progress(),null);assert.equal(radio.feedback().state,'error');assert.equal(radio.renderPlayer(),false);assert.equal(calls.length,0);assert.equal(radio.value.state.sourceKind,'spotify');});
test('stale transport and disconnect remove progress without granting an action or replay',async()=>{for(const phase of ['stale','scope','disconnect']){const {radio,host}=fixture();const offer=held();let writes=0;host.liveTransport.radioOffer=()=>offer.promise;host.liveTransport.radioAction=async()=>{writes++;return {status:'accepted'};};const operation=radio.choose('p1');assert.ok(radio.progress());if(phase==='stale')radio.value.validUntil=0;else if(phase==='scope')host.liveSnapshot={...snapshot,sessionId:'other'};else {host.liveTransport.connected=false;radio.invalidate();}assert.equal(radio.progress(),null);if(phase==='stale')radio.invalidate();offer.resolve({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});await operation;assert.equal(writes,0);assert.equal(radio.pending,false);}});
test('unknown writer clears progress and retains no-repeat authority fence; volume keeps native measurement',async()=>{const {radio,host}=fixture(value({actions:['start','stop','move','volume'],state:{...value().state,volumePercent:37}}));const writer=held();host.liveTransport.radioOffer=async()=>({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});host.liveTransport.radioAction=()=>writer.promise;const operation=radio.act('volume',{volumePercent:60});assert.deepEqual(radio.progress(),{kind:'volume',id:'play-pause'});assert.equal(radio.value.state.volumePercent,37);await Promise.resolve();writer.resolve({status:'unknown'});await operation;assert.equal(radio.progress(),null);assert.equal(radio.feedback().state,'unknown');assert.equal(radio.can('volume'),false);assert.equal(radio.value.state.volumePercent,37);});

test('sending-phase render cannot submit a stale action after lifecycle invalidation',async()=>{const {radio,host}=fixture();let posts=0;host.liveTransport.radioOffer=async()=>({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});host.liveTransport.radioAction=async()=>{posts++;return {status:'accepted'};};let invalidated=false;radio.render=()=>{if(radio.pendingPhase==='sending'&&!invalidated){invalidated=true;radio.invalidate();}};await radio.choose('p1');assert.equal(posts,0);assert.equal(radio.progress(),null);assert.equal(radio.pending,false);});

test('all start origins retain exact scoped station and desired target, expire display immediately and never submit stale preview',async()=>{for(const origin of [null,{kind:'transport',id:'play-pause'},{kind:'output',id:'stuen'}]){const {radio,host,calls}=fixture(value({state:{...value().state,volumePercent:37}}));const offer=held();let writes=0;host.liveTransport.radioOffer=()=>offer.promise;host.liveTransport.radioAction=async()=>{writes++;return {status:'accepted'};};const operation=radio.act('start',{stationId:'p1',targetId:'stuen'},origin);assert.equal(radio.pendingStart().stationId,'p1');assert.equal(radio.pendingStart().targetId,'stuen');assert.equal(radio.pendingStart().targetName,'Stuen');assert.equal(Object.isFrozen(radio.pendingStart()),true);radio.renderPlayer();assert.equal(calls[0][1].title,'P1');assert.equal(calls[0][1].target,'Stuen');assert.equal(calls[0][1].volume,37);assert.equal(calls[1][1].pendingLabel,'Starter P1…');assert.equal(calls[1][1].blocked,false);assert.equal(radio.value.state.stationId,'p3');radio.value.validUntil=0;assert.equal(radio.pendingStart(),null);calls.length=0;radio.renderPlayer();assert.equal(calls[0][1].title,'P3');assert.equal(calls[0][1].loading,undefined);radio.invalidate();offer.resolve({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});await operation;assert.equal(writes,0);assert.equal(radio.pendingRequest,null);assert.equal(radio.pendingStart(),null);}});

test('requested start preview volume belongs only to fresh admitted native destination, never the prior player or another receiver',async()=>{const kitchen={id:'kitchen',name:'Køkken',availability:'available',selectable:true,default:false};for(const sample of [{label:'Spotify other receiver',sourceKind:'spotify',status:'idle',targetId:'kitchen',volumePercent:62,expected:null},{label:'stopped radio other receiver',sourceKind:'radio',status:'stopped',targetId:'kitchen',volumePercent:62,expected:null},{label:'same receiver station switch',sourceKind:'radio',status:'playing',targetId:'stuen',volumePercent:37,expected:37},{label:'same receiver native Spotify',sourceKind:'spotify',status:'idle',targetId:'stuen',volumePercent:37,expected:37},{label:'missing measurement',sourceKind:'radio',status:'stopped',targetId:'stuen',volumePercent:null,expected:null},{label:'unknown source',sourceKind:'unknown',status:'idle',targetId:'stuen',volumePercent:37,expected:null},{label:'missing destination',sourceKind:'spotify',status:'idle',targetId:null,volumePercent:37,expected:null},{label:'stale measurement',sourceKind:'spotify',status:'idle',targetId:'stuen',volumePercent:37,observedAt:Date.now()/1000-31,expected:null},{label:'missing observation',sourceKind:'spotify',status:'idle',targetId:'stuen',volumePercent:37,observedAt:null,expected:null}]){const {expected,label,...state}=sample,{radio,host,calls}=fixture(value({targets:[...value().targets,kitchen],state:{...value().state,...state}})),offer=held(),sent=[];host.playerView.volumeMuteVM={volume:89};host.liveTransport.radioOffer=body=>{sent.push(body);return offer.promise;};const operation=radio.act('start',{stationId:'p1',targetId:'stuen'});assert.equal(radio.pendingStart().volumePercent,expected,label);radio.renderPlayer();assert.equal(calls[0][1].volume,expected,label);assert.equal(calls[1][1].volume,expected,label);assert.equal(calls[1][1].canVolume,false,label);assert.equal(sent[0].volumePercent,null,'preview measurement never becomes native start-volume authority');assert.equal(radio.value.state.targetId,state.targetId);assert.equal(host.playerView.volumeMuteVM.volume,89);radio.invalidate();offer.resolve({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});await operation;assert.equal(radio.pendingStart(),null);}});

// A correlated explicit rejection is terminal; it is not a lost action receipt.
test('explicit rejected receipt restores existing source without unknown custody, replay or optimistic selection',async()=>{const {radio,host}=fixture();let offers=0,writes=0;host.liveTransport.radioOffer=async()=>{offers++;return {...snapshot,taskId:'rejected-task',optionId:'rejected-option',expiresAt:Date.now()/1000+5};};host.liveTransport.radioAction=async()=>{writes++;return {status:'rejected'};};await radio.choose('p1');assert.equal(offers,1);assert.equal(writes,1);assert.equal(radio.unknown,false);assert.equal(radio.pending,false);assert.equal(radio.pendingStart(),null);assert.equal(radio.value.state.stationId,'p3');assert.equal(radio.value.state.status,'playing');assert.equal(radio.feedback().state,'error');assert.equal(radio.can('start'),true);assert.equal(radio.message,'Radio kunne ikke startes. Prøv igen.');});

test('radio counter reset requires a different valid nonempty manager process identity; legacy same-owner rollback stays fenced',()=>{const previous=value({ownerProcessId:'manager-old',revision:90,state:{...value().state,generation:50,ownerGeneration:40}}),reset=value({ownerProcessId:'manager-new',revision:1});assert.ok(radioObservation(reset,snapshot,previous,now));for(const ownerProcessId of ['manager-old',null,undefined,'',129..toString().repeat(65)])assert.equal(radioObservation({...reset,ownerProcessId},snapshot,previous,now),null);assert.equal(radioObservation(reset,snapshot,{...previous,ownerProcessId:undefined},now),null);});
test('manager restart discards pending history picker and volume cache, fences old callbacks and retired owner replay without any effect',async()=>{const {host,radio}=fixture(value({ownerProcessId:'old',revision:90,state:{...value().state,generation:50,ownerGeneration:40}}));try{radio.ownerProcessId='old';radio.lastConfirmed={...radio.value.state};radio.stoppedHistory={old:true};radio.nextTarget='stuen';radio.outputOpen=true;host.playerView.volumeRestore=41;host.playerView.volumeMuteBinding='old';host.playerView.sourceFocus={kind:'radio'};let resolveOffer,sends=0;host.liveTransport.radioOffer=()=>new Promise(done=>resolveOffer=done);host.liveTransport.radioAction=async()=>{sends++;return {status:'accepted'};};const pending=radio.choose('p1');await Promise.resolve();assert.equal(radio.pending,true);radio.unknown=true;radio.unknownGeneration=50;radio.unknownRevision=90;host.liveTransport.radio=async()=>value({ownerProcessId:null,revision:91,state:{...value().state,status:'unknown',generation:51,ownerGeneration:40}});await radio.refresh({immediate:true});assert.equal(radio.ownerProcessId,'old','temporary null retains last actual process identity');assert.equal(radio.unknown,true);host.liveTransport.radio=async()=>value({ownerProcessId:'new',revision:1,state:{...value().state,status:'unknown',generation:1,ownerGeneration:1}});await radio.refresh({immediate:true});assert.equal(radio.value.ownerProcessId,'new');assert.equal(radio.value.state.generation,1);assert.equal(radio.pending,false);assert.equal(radio.lastConfirmed,null);assert.equal(radio.stoppedHistory,null);assert.equal(radio.nextTarget,null);assert.equal(radio.outputOpen,false);assert.equal(host.playerView.volumeRestore,null);assert.equal(host.playerView.sourceFocus,null);assert.equal(radio.can('start'),false);assert.equal(radio.unknown,true);resolveOffer({...snapshot,taskId:'old-task',optionId:'old-option',expiresAt:Date.now()/1000+5});await pending;assert.equal(sends,0);host.liveTransport.radio=async()=>value({ownerProcessId:'old',revision:99,state:{...value().state,generation:99,ownerGeneration:99}});await radio.refresh({immediate:true});assert.equal(radio.value.ownerProcessId,'new','retired manager cannot return by late poll');host.liveTransport.radio=async()=>value({ownerProcessId:'new',revision:2,state:{...value().state,status:'idle',sourceKind:'none',stationId:null,targetId:null,generation:1,ownerGeneration:1}});await radio.refresh({immediate:true});assert.equal(radio.unknown,false,'fresh definitive new owner may recover presentation');assert.equal(radio.read,null);assert.equal(sends,0);}finally{clearTimeout(radio.expiry);}});

test('closing or owner-resetting radio picker closes the actual dialog, invalidates retained rows and fences captured target callbacks',()=>{const {host,radio}=fixture();radio.value.targets.push({id:'kitchen',name:'Kitchen',availability:'available',selectable:true,default:false});const dialog={open:true,close(){this.open=false;}},button={disabled:false,radioSelectable:()=>true,radioChoose:()=>{throw Error('old row remains armed');}};let captured,cleared=0,effects=0;host.ownerDocument={getElementById:()=>dialog};host.liveOutputs={radioSheet:true,radioRows:new Map([['kitchen',button]]),rows:{replaceChildren(){cleared++;}},renderRadioOutputs:vm=>captured=vm};radio.outputOpen=true;radio.syncOutputs();assert.equal(captured.selectable(radio.value.targets[1]),true);radio.act=()=>effects++;radio.closeOutputs();assert.equal(dialog.open,false);assert.equal(button.disabled,true);assert.equal(button.radioSelectable(),false);button.radioChoose();assert.equal(cleared,1);assert.equal(host.liveOutputs.radioRows.size,0);assert.equal(host.liveOutputs.radioSheet,false);radio.epoch++;radio.value={...radio.value,ownerProcessId:'replacement'};radio.outputOpen=true;dialog.open=true;captured.onChoose(radio.value.targets[1]);assert.equal(effects,0,'old captured picker callback cannot borrow new owner authority');assert.equal(radio.nextTarget,undefined);});

test('radio uses one existing source-scoped notification for failures, no pending/success message and no Spotify feedback collision',async()=>{
 const {NotificationQueue}=await import('../../podvoice/gatekeeper/static/podview/ui/notification-queue.js');
 const {radio,host}=fixture(),shown=[],queue=new NotificationQueue(item=>shown.push(item),{setTimer:()=>1,clearTimer(){}});
 radio.render=LiveRadioView.prototype.render.bind(radio);host.showFeedback=(message,pending,options)=>queue.update(options.source,message,{pending});
 queue.update('action','Bevar Spotify-fejlen');
 const writer=held();host.liveTransport.radioOffer=async()=>({...snapshot,taskId:'t',optionId:'o',expiresAt:Date.now()/1000+5});host.liveTransport.radioAction=()=>writer.promise;
 const operation=radio.choose('p1');assert.equal(queue.signatures.get('radio'),JSON.stringify(['',false,false]));assert.equal(queue.pending.length,0);assert.equal(queue.current.source,'action');
 await Promise.resolve();writer.resolve({status:'rejected'});await operation;radio.render();radio.render();
 assert.equal(queue.current.source,'action');assert.equal(queue.pending.length,1);assert.equal(queue.pending[0].source,'radio');assert.equal(queue.pending[0].pending,false);assert.match(queue.pending[0].message,/Radio/);
 queue.dismiss();assert.equal(queue.current.source,'radio');assert.equal(shown.filter(item=>item?.source==='radio').length,1);
 radio.feedbackKind=null;radio.message='';radio.render();assert.equal(queue.current,null);assert.equal(queue.pending.length,0);
 radio.unknown=true;radio.render();radio.render();assert.equal(shown.filter(item=>item?.source==='radio').length,2);assert.match(queue.current.message,/ikke bekræftet/);assert.ok(Array.from(queue.current.message).length<=55);assert.equal(radio.can('start'),false);
 radio.invalidate(true);assert.equal(queue.current,null);queue.cleanup();
});

test('rejected radio presentation does not cross revoked boot/room or confirmed manager replacement',async()=>{
 const {NotificationQueue}=await import('../../podvoice/gatekeeper/static/podview/ui/notification-queue.js');
 for(const replaceOwner of [false,true]){
  const {radio,host}=fixture(value({ownerProcessId:'old-manager'})),queue=new NotificationQueue(()=>{},{setTimer:()=>1,clearTimer(){}});
  radio.render=LiveRadioView.prototype.render.bind(radio);host.showFeedback=(message,pending,options)=>queue.update(options.source,message,{pending});radio.ownerProcessId='old-manager';radio.feedbackKind='error';radio.message='Old rejected radio request';radio.render();assert.equal(queue.current.message,radio.message);
  if(!replaceOwner){radio.invalidate(true);assert.equal(queue.current,null);host.liveSnapshot={bootId:'new-boot',roomId:'new-room'};}
  const next=value({...host.liveSnapshot,ownerProcessId:replaceOwner?'new-manager':'old-manager'});host.liveTransport.radio=async()=>next;await radio.refresh({immediate:true});
  assert.equal(radio.feedbackKind,null);assert.equal(radio.message,'');assert.equal(queue.current,null);assert.equal(queue.pending.length,0);clearTimeout(radio.expiry);queue.cleanup();
 }
});

test('passive disabled radio UNKNOWN cannot create a command-failure notice while Spotify owns presentation',async()=>{
 const {NotificationQueue}=await import('../../podvoice/gatekeeper/static/podview/ui/notification-queue.js');
 const raw=value({enabled:false,ownerProcessId:null,validUntil:null,actions:[],state:{status:'unknown',stationId:null,targetId:null,generation:0,sourceKind:'unknown',ownerGeneration:0,volumePercent:null,observedAt:null}}),{radio,host}=fixture(raw),shown=[],queue=new NotificationQueue(item=>shown.push(item),{setTimer:()=>1,clearTimer(){}});
 radio.render=LiveRadioView.prototype.render.bind(radio);host.showFeedback=(message,pending,options)=>queue.update(options.source,message,{pending});host.playerView.sourceFocused=kind=>kind==='music';host.liveTransport.radio=async()=>raw;
 await radio.refresh({immediate:true});radio.render();radio.render();assert.equal(radio.unknown,false);assert.equal(radio.presentsPlayer(),false);assert.equal(queue.current,null);assert.equal(queue.pending.length,0);assert.equal(shown.filter(Boolean).length,0);assert.equal(radio.can('start'),false);
 radio.unknown=true;radio.render();assert.match(queue.current.message,/ikke bekræftet/);assert.equal(radio.can('start'),false);queue.cleanup();clearTimeout(radio.expiry);
});

test('radio logs one metadata correlation through intent offer receipt and observed values without changing action wire',async()=>{
 const {radio,host}=fixture(value({actions:['start','stop','move','volume'],state:{...value().state,volumePercent:30}})),records=[],offers=[],writes=[];host.liveTransport.recordDiagnostic=(stage,fields)=>records.push({stage,...fields});
 host.liveTransport.radioOffer=async body=>{offers.push(body);return {...snapshot,taskId:'task',optionId:'option',expiresAt:Date.now()/1000+5};};host.liveTransport.radioAction=async offer=>{writes.push(offer);return {status:'accepted'};};host.liveTransport.radio=async()=>value({revision:2,state:{...value().state,generation:2,volumePercent:31}});
 try{await radio.act('volume',{volumePercent:31,targetId:'stuen'});assert.equal(offers.length,1);assert.equal(writes.length,1);assert.equal(offers[0].diagnosticRef,undefined);assert.equal(writes[0].diagnosticRef,undefined);const phases=records.filter(row=>['control_intent','control_setup','control_action','control_observation'].includes(row.stage));assert.ok(phases.every(row=>row.domain==='radio'&&row.action==='volume'&&row.diagnosticRef===phases[0].diagnosticRef&&row.resourceId==='stuen'));assert.match(phases[0].diagnosticRef,/^[a-f0-9-]{36}$/);assert.ok(phases.some(row=>row.stage==='control_action'&&row.code==='accepted'));const observed=phases.find(row=>row.stage==='control_observation'&&row.code==='observed');assert.equal(observed.requestedValue,31);assert.equal(observed.observedValue,31);assert.equal(observed.source,'podradio');assert.equal(observed.trust,'state_observation');assert.equal(phases.some(row=>row.code==='confirmed'||row.requestId),false);}finally{clearTimeout(radio.expiry);}
});

test('radio logs read failure and recovery separately while retaining the existing read-only lifecycle',async()=>{
 const {radio,host}=fixture(),records=[];let reads=0;host.liveTransport.recordDiagnostic=(stage,fields)=>records.push({stage,...fields});host.liveTransport.radio=async()=>{reads++;if(reads===1)throw new TypeError('PRIVATE');return value({revision:2});};
 try{await radio.refresh({immediate:true});assert.equal(radio.current(),false);await radio.refresh({immediate:true});assert.equal(reads,2);assert.equal(radio.current(),true);assert.ok(records.some(row=>row.stage==='request'&&row.code==='network'));assert.ok(records.some(row=>row.stage==='request'&&row.code==='recovered'&&row.source==='podradio'&&row.trust==='state_observation'));assert.doesNotMatch(JSON.stringify(records),/PRIVATE/);}finally{clearTimeout(radio.expiry);}
});

test('radio logging failures never alter an accepted command or send extra effects',async()=>{
 const {radio,host}=fixture(value({state:{...value().state,status:'stopped'}}));let writes=0;host.liveTransport.recordDiagnostic=()=>{throw Error('inert sink failed');};host.liveTransport.radioOffer=async()=>({...snapshot,taskId:'task',optionId:'option',expiresAt:Date.now()/1000+5});host.liveTransport.radioAction=async()=>{writes++;return {status:'accepted'};};host.liveTransport.radio=async()=>value({revision:2,state:{...value().state,generation:2}});
 try{await radio.choose('p3');assert.equal(writes,1);assert.equal(radio.value.state.status,'playing');assert.equal(radio.pending,false);}finally{clearTimeout(radio.expiry);}
});

for(const result of ['accepted','preparing','rejected','unknown','owner-change','foreign-source']){
 test(`new station touches wait for scoped radio admission after ${result}`,async()=>{
  const {radio,host}=fixture(value({ownerProcessId:'old'})),first=held(),sent=[],offers=[];
  let revision=1,stationId='p3',queuedOffer;
  try{
   host.liveTransport.radioOffer=async body=>{
    offers.push(body);
    queuedOffer={...snapshot,taskId:`task-${offers.length}`,optionId:`choice-${offers.length}`,
     expiresAt:Date.now()/1000+5};
    return queuedOffer;
   };
   host.liveTransport.radioAction=async offer=>{
    const station=offers.at(-1).stationId;
    sent.push({station,taskId:offer.taskId});
    if(sent.length===1){
     const receipt=await first.promise;
     if(receipt.status!=='accepted')return receipt;
    }
    revision++;
    stationId=station;
    return {status:'accepted'};
   };
   host.liveTransport.radio=async()=>value({
    ownerProcessId:result==='owner-change'?'new':'old',revision,
    state:{...value().state,generation:revision,ownerGeneration:revision,stationId,
     ...(result==='foreign-source'?{status:'idle',sourceKind:'spotify'}:{})},
   });
   const choosing=radio.choose('p1');
   await Promise.resolve();
   assert.equal(radio.pendingStart()?.stationId,'p1');
   assert.equal(radio.can('start'),false,'pending never grants native write authority');
   if(result==='preparing'){
    radio.lastConfirmed={...radio.value.state};
    radio.value={...radio.value,actions:[],
     state:{...radio.value.state,status:'preparing',stationId:'p1'}};
    assert.equal(radio.observedStationId(),'p3');
   }
   assert.equal(radio.canChooseStation(),true);
   await radio.choose('p6-beat');
   assert.equal(radio.pendingStationChoice(),'p6-beat');
   assert.equal(radio.observedStationId(),'p3');
   assert.equal(offers.length,1);
   if(['owner-change','foreign-source'].includes(result))await radio.refresh({immediate:true});
   const status=['owner-change','preparing'].includes(result)?'accepted':result;
   first.resolve({status:result==='foreign-source'?'rejected':status});
   await choosing;
   if(['accepted','preparing','rejected'].includes(result)){
    assert.deepEqual(sent,[{station:'p1',taskId:'task-1'},{station:'p6-beat',taskId:'task-2'}]);
    assert.equal(radio.value.state.stationId,'p6-beat');
   }else{
    assert.deepEqual(sent,[{station:'p1',taskId:'task-1'}]);
    assert.equal(radio.stationChoices.length,0);
   }
  }finally{
   first.resolve({status:'unknown'});
   clearTimeout(radio.expiry);
  }
 });
}


test('a preparatory station does not replace the observed radio selection',()=>{
 const {radio}=fixture();
 radio.lastConfirmed={...radio.value.state};
 radio.value.state={...radio.value.state,status:'preparing',stationId:'p1'};
 assert.equal(radio.observedStationId(),'p3');
 radio.value.state={...radio.value.state,status:'playing'};
 assert.equal(radio.observedStationId(),'p1');
 radio.value.state={...radio.value.state,status:'idle',sourceKind:'spotify'};
 assert.equal(radio.observedStationId(),null);
});

test('short radio authority renews passively before expiry and a held read cannot extend it',async context=>{
 context.mock.timers.enable({apis:['Date','setTimeout'],now:now});
 const {radio,host}=fixture();
 let reads=0,actions=0,release;
 const live=()=>value({retrievedAt:Date.now()/1000,validUntil:Date.now()/1000+3,
  state:{...value().state,status:'idle',sourceKind:'spotify',stationId:null,observedAt:Date.now()/1000}});
 host.liveTransport.radio=async()=>{
  if(++reads===3)return new Promise(resolve=>{release=resolve;});
  return live();
 };
 host.liveTransport.radioOffer=async()=>{actions++;};
 host.liveTransport.radioAction=async()=>{actions++;};
 try{
  await radio.refresh({immediate:true});
  context.mock.timers.tick(2000);
  await radio.read;
  assert.equal(reads,2);
  assert.equal(radio.can('start'),true);
  context.mock.timers.tick(2000);
  const held=radio.read;
  assert.equal(reads,3);
  context.mock.timers.tick(1000);
  assert.equal(radio.can('start'),false);
  await radio.choose('p3');
  assert.equal(actions,0);
  release(live());
  await held;
  assert.equal(radio.can('start'),true);
  radio.invalidate(true);
  context.mock.timers.tick(5000);
  assert.equal(reads,3);
  assert.equal(actions,0);
 }finally{radio.invalidate(true);context.mock.timers.reset();}
});
// R2/R4: Stop is never dead while a station is starting; it waits for the start and is sent once.
test('Stop tapped while a station is starting is shown, queued and sent once when the start settles',async()=>{
 const {radio,host,calls}=fixture(),first=held(),offers=[],sent=[];let revision=1,status='playing',stationId='p3';
 try{
  host.liveTransport.radioOffer=async body=>{offers.push(body);return {...snapshot,taskId:'task-'+offers.length,optionId:'opt',expiresAt:Date.now()/1000+5};};
  host.liveTransport.radioAction=async()=>{const body=offers.at(-1);sent.push(body.action);if(sent.length===1)await first.promise;
   revision++;if(body.action==='stop')status='stopped';else stationId=body.stationId;return {status:'accepted'};};
  host.liveTransport.radio=async()=>value({revision,state:{...value().state,status,stationId,generation:revision}});
  const starting=radio.choose('p1');await Promise.resolve();
  calls.length=0;radio.renderControls();const controls=calls.at(-1)[1];
  assert.equal(controls.toggle,true,'Stop is tappable during the start');assert.equal(controls.blocked,false);
  radio.control({type:'toggle'});
  calls.length=0;radio.renderControls();assert.match(calls.at(-1)[1].pendingLabel,/Stopper/,'the Stop wish is shown at once');
  assert.deepEqual(sent,['start'],'Stop waits for the start');
  first.resolve();await starting;for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(sent,['start','stop'],'Stop is sent exactly once after the start');
  assert.equal(radio.value.state.status,'stopped');
 }finally{first.resolve();clearTimeout(radio.expiry);clearTimeout(radio.timer);}
});
