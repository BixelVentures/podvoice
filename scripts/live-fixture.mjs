// Test-only fixture. Never included in dist or connected to a household.
import {basicFlowFixture,basicRooms} from './basic-flow-diagnostic.mjs';
import {artworkDiagnosticFixture} from './artwork-diagnostic.mjs';
import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';
const root=path.resolve('podvoice/gatekeeper/static/podview');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const snapshot={schema:'podview.snapshot.v1',bootId:'test-only',roomId:'kitchen',revision:1,observedAt:Date.now()/1000,voice:{phase:'LISTENING',sessionId:'test-session',active:true},timers:{status:'observed',epoch:'test-epoch',items:[{id:'fixture-native',name:'Testtimer fra serverfixture',secondsLeft:120,status:'running'}]},capabilities:{timerActions:[],musicRead:['recent'],musicActions:[],visualEnrichment:false}};

const voiceRooms={'voice-listening':'LISTENING','voice-thinking':'THINKING','voice-speaking':'AI_SPEAKING','voice-ready':'LOUNGE_WINDOW','voice-idle':'IDLE'};
const mediaRoom=room=>room in voiceRooms||['media','multi','empty','media-loss','answers'].includes(room);
const receiptId='a'.repeat(32),answerContext={revision:2,sessionId:'test-session',turnId:'test-turn',taskId:'test-task',inputRevision:1};
const answerFacts=[{id:'fact:0',label:'Temperatur',value:'12°C',detail:'Testmåling fra serverfixture',sourceId:'source:'+receiptId}];
const mediaSnapshot=room=>({...snapshot,roomId:room,...(room in voiceRooms?{voice:{phase:voiceRooms[room],sessionId:'test-session',turnId:'test-turn',active:voiceRooms[room]!=='IDLE'}}:{}),...(room==='answers'?{answers:answerContext}:{}),capabilities:{...snapshot.capabilities,...(room==='answers'?{answerRead:true}:{}),homeRead:['vacuum','weather'],musicRead:['targets','playback','queue','recent','top','liked']}});
const item={type:'track',uri:'spotify:track:fixture',name:'Observeret testmusik',artists:['Serverfixture'],duration_ms:200000};
const mediaReply=(kind,account,room)=>{const now=new Date().toISOString();if(kind==='targets')return {accounts:room==='multi'?[{config_entry_id:'test-a',title:'Testkonto A'},{config_entry_id:'test-b',title:'Testkonto B'}]:[{config_entry_id:'test-a',title:'Testkonto A'}]};if(kind==='playback'&&room==='empty')return {ok:true,schema:'podview.room-playback.v1',bootId:snapshot.bootId,roomId:room,configEntryId:account,status:'unavailable',binding:null,data:null};if(kind==='playback')return {ok:true,schema:'podconnect.playback.v1',config_entry_id:account,owner_epoch:'fixture-owner',poll_sequence:Math.floor(Date.now()/1000),physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:now,age_ms:0,max_age_ms:15000},playback:room==='empty'?{state:'no_active_playback',target:null,item:null}:{state:'paused',target:{kind:'spotify_device',target_id:'test-speaker',name:null},item:{...item,name:account==='test-b'?'Anden testkonto':item.name}}};if(kind==='queue')return {ok:true,schema:'podconnect.queue.v1',config_entry_id:account,owner_epoch:'fixture-owner',snapshot_id:'fixture-owner:q:1',observed_at:now,scope:'account',coverage:'provider_response',relation_to_playback:'not_atomic',currently_playing:item,returned_count:2,truncated:false,items:[{...item,option_id:'fixture-owner:q:1:0'},{...item,option_id:'fixture-owner:q:1:1'}]};return {tracks:[{name:'Testmusik fra serverfixture',artist:'Serverfixture'}]};};
const mediaHome=room=>({schema:'podview.home.v1',roomId:room,revision:1,observedAt:Date.now()/1000,vacuum:{status:'observed',items:[{entityId:'vacuum.fixture',name:'Testrobot',state:'cleaning',battery:67,observedAt:Date.now()/1000,source:'home_assistant_state',history:{status:'observed',source:'device_control_start_journal',items:[3,2,1].map(n=>({id:'test-recipe-'+n,recordedAt:Date.now()/1000-n*600,outcome:n===2?'unknown':'accepted_by_ha',physicalResultVerified:false,recipe:{areaIds:['test-area'],mapName:'Testkort',repeat:n}}))}}]},weather:{status:'observed',data:{source:'Home Assistant · serverfixture',location:'Testhjem',retrievedAt:new Date().toISOString(),observedAt:Date.now()/1000,units:{temperature:'°C'},current:{condition:'rainy',temperature:12},forecastType:'hourly',forecast:Array.from({length:24},(_,i)=>({datetime:new Date(Date.UTC(2026,9,14,18+i)).toISOString(),temperature:12-i/2,condition:'rainy'})),coverage:{truncated:false,totalRows:24,returnedRows:24}}}});

// Authored loopback-only timer transport cases; never a household or product renderer.
const timerRooms=new Map(['timer-receipt-first','timer-snapshot-first','timer-unknown','timer-no-observation','timer-boot-change','timer-room-change','timer-epoch-change','timer-transport-timeout','timer-cancel-unknown'].map(room=>[room,{revision:1,items:[],clients:new Set(),sequence:0}]));
const timerProjection=(room,state)=>({...snapshot,bootId:state.bootId||snapshot.bootId,roomId:state.roomId||room,revision:state.revision,observedAt:Date.now()/1000,voice:{phase:'IDLE',sessionId:null,active:false},timers:{status:'observed',epoch:state.epoch||'fixture-timer-epoch',items:state.items.map(item=>({...item}))},capabilities:{timerActions:[...snapshot.capabilities.timerActions],musicRead:[],musicActions:[],visualEnrichment:false}});
const publishTimer=(room,state)=>{const data=timerProjection(room,state);for(const client of state.clients)client.write(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`);};
async function timerFixture(req,res,url){
 const room=url.searchParams.get('room'),state=timerRooms.get(room);if(!state||!url.pathname.startsWith('/view/api/'))return false;
 res.setHeader('Content-Type','application/json');
 if(url.pathname.endsWith('/snapshot')){res.end(JSON.stringify(timerProjection(room,state)));return true;}
 if(url.pathname.endsWith('/events')){res.writeHead(200,{'Content-Type':'text/event-stream'});state.clients.add(res);publishTimer(room,state);const interval=setInterval(()=>publishTimer(room,state),1000);req.on('close',()=>{clearInterval(interval);state.clients.delete(res);});return true;}
 if(!url.pathname.endsWith('/actions'))return false;
 let raw='';for await(const chunk of req)raw+=chunk;const action=JSON.parse(raw);
 const reject=error=>{res.writeHead(409);res.end(JSON.stringify({ok:false,error,retryAllowed:false}));};
 if(!snapshot.capabilities.timerActions.includes(action.action)){reject('control_not_paired');return true;}
 if(action.bootId!==(state.bootId||snapshot.bootId)||action.roomId!==(state.roomId||room)||action.taskId!==`timers:${state.epoch||'fixture-timer-epoch'}`||action.revision!==state.revision){reject('stale_action');return true;}
 if(typeof action.requestId!=='string'||!action.requestId){reject('invalid_request');return true;}
 if(action.action==='timer.cancel'){
  if(!state.items.some(item=>item.id===action.args?.timer_id)){reject('invalid_action');return true;}
  if(room==='timer-cancel-unknown'){console.log(`Fixture action ${room} ${action.action} ${action.requestId}`);res.end(JSON.stringify({ok:false,requestId:action.requestId,outcome:'unknown',retryAllowed:false}));return true;}
  state.items=state.items.filter(item=>item.id!==action.args.timer_id);state.revision++;res.end(JSON.stringify({ok:true,requestId:action.requestId,outcome:'accepted',retryAllowed:false}));publishTimer(room,state);return true;
 }
 if(action.action!=='timer.start'||state.items.length||!Number.isInteger(action.args?.seconds)||action.args.seconds<1||action.args.seconds>86400){reject('invalid_action');return true;}
 console.log(`Fixture action ${room} ${action.action} ${action.requestId}`);
 if(room==='timer-transport-timeout'){res.on?.('close',()=>console.log(`Fixture client closed ${room} ${action.requestId}`));return true;}
 if(room==='timer-unknown'){res.end(JSON.stringify({ok:false,requestId:action.requestId,outcome:'unknown',retryAllowed:false}));return true;}
 const timerId=`${room}-native-${++state.sequence}`,receipt={ok:true,requestId:action.requestId,outcome:'accepted',retryAllowed:false,timerId};
 const observe=()=>{state.items=[{id:timerId,name:'',secondsLeft:action.args.seconds,status:'running'}];state.revision++;publishTimer(room,state);};
 // The delayed half is intentionally observable; periodic SSE only carries committed state.
 if(room==='timer-no-observation'){res.end(JSON.stringify(receipt));}
 else if(['timer-boot-change','timer-room-change','timer-epoch-change'].includes(room)){res.end(JSON.stringify(receipt));setTimeout(()=>{if(room==='timer-boot-change')state.bootId='fixture-next-boot';if(room==='timer-room-change')state.roomId='fixture-other-room';if(room==='timer-epoch-change')state.epoch='fixture-next-epoch';observe();},1500);}
 else if(room==='timer-receipt-first'){res.end(JSON.stringify(receipt));setTimeout(observe,1500);}
 else{observe();setTimeout(()=>res.end(JSON.stringify(receipt)),1500);}
 return true;
}
// Native queue UI cases are strictly loopback fixtures: no provider/client/audio.
const queueRooms=new Map(['queue-rejected','queue-unknown','queue-read-error'].map((room,index)=>[room,{reads:0,offers:new Map(),bindingId:String(index+1).repeat(64)}]));
const queueAccount='fixture-queue-account',queueTarget='fixture-queue-speaker',queueOwner='fixture-queue-owner';
const queueBinding=(room,state)=>({roomId:room,accountId:queueAccount,targetId:queueTarget,nativeRoomId:'fixture-native-room',nativeHomepodId:'fixture-native-speaker',bindingId:state.bindingId});
const queueProjection=(room,state)=>({...snapshot,roomId:room,revision:1,observedAt:Date.now()/1000,voice:{phase:'IDLE',sessionId:null,active:false},timers:{status:'observed',epoch:'fixture-queue-timers',items:[]},mediaRoomBindings:[queueBinding(room,state)],capabilities:{timerActions:[],musicActions:[],musicRead:['targets','playback','queue'],controlSetup:[],queueSelection:true,visualEnrichment:false}});
const queuePlayback=(room,state)=>({ok:true,schema:'podview.room-playback.v1',bootId:snapshot.bootId,roomId:room,configEntryId:queueAccount,status:'observed',binding:queueBinding(room,state),data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:queueAccount,owner_epoch:queueOwner,poll_sequence:4,physical_result_verified:false,room_proof_valid_until:Date.now()/1000+15,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:{state:'paused',progress_ms:84000,target:{kind:'spotify_device',target_id:queueTarget,name:'Fixturehøjttaler · ingen lyd'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Bevaret fixturesang',artists:['Serverfixture · ingen lyd'],duration_ms:200000,artwork:null}}}});
async function queueFixture(req,res,url){
 if(!url.pathname.startsWith('/view/api/'))return false;
 const paths=['/view/api/music/queue/offer','/view/api/music/queue/actions'],post=paths.includes(url.pathname),queryRoom=url.searchParams.get('room');
 if(!post&&!queueRooms.has(queryRoom))return false;
 res.setHeader('Content-Type','application/json');const fail=(status,error)=>{res.writeHead(status);res.end(JSON.stringify({ok:false,error,retryAllowed:false}));};
 let body,room=queryRoom,state=queueRooms.get(room);
 if(post){
  if(req.method!=='POST'||req.headers?.['content-type']!=='application/json'||req.headers?.['x-podview-request']!=='1'){fail(400,'invalid_fixture_request');return true;}
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048){fail(400,'invalid_fixture_request');return true;}}
  try{body=JSON.parse(raw);}catch{fail(400,'invalid_fixture_request');return true;}
  room=body?.roomId;state=queueRooms.get(room);if(!state||queryRoom&&queryRoom!==room){fail(409,'stale_fixture_scope');return true;}
 }else if(req.method&&req.method!=='GET'){fail(405,'fixture_method_not_allowed');return true;}
 if(url.pathname==='/view/api/snapshot'){res.end(JSON.stringify(queueProjection(room,state)));return true;}
 if(url.pathname==='/view/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});const send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify(queueProjection(room,state))}\n\n`);send();const interval=setInterval(send,1000);req.on('close',()=>{clearInterval(interval);res.end();});return true;}
 if(url.pathname==='/view/api/music'){
  const kind=url.searchParams.get('kind');if(kind==='targets'){res.end(JSON.stringify({ok:true,data:{accounts:[{config_entry_id:queueAccount,title:'Køfixture · ingen provider'}]}}));return true;}
  if(kind==='playback'&&url.searchParams.get('account')===queueAccount){res.end(JSON.stringify(queuePlayback(room,state)));return true;}
  fail(404,'fixture_music_unavailable');return true;
 }
 const exact=keys=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===keys.length&&keys.every(key=>Object.hasOwn(body,key));
 if(url.pathname==='/view/api/music/queue/offer'){
  if(!exact(['bootId','roomId','accountId','targetId'])||body.bootId!==snapshot.bootId||body.accountId!==queueAccount||body.targetId!==queueTarget){fail(409,'stale_fixture_scope');return true;}
  state.reads++;if(room==='queue-read-error'&&state.reads>1){fail(503,'fixture_queue_unavailable');return true;}
  for(const [id,record]of state.offers)if(record.expiresAt<=Date.now())state.offers.delete(id);
  if(state.offers.size>=32){fail(503,'fixture_capacity');return true;}
  const taskId='queue:'+crypto.randomUUID().replaceAll('-',''),items=[1,2].map((order)=>({id:crypto.randomUUID().replaceAll('-','').slice(0,24),title:`Bevaret køsang ${order}`,artist:'Serverfixture · ingen lyd',uri:`spotify:track:${order}123456789ABCDEFGHIJKL`,artwork:null,order})),offer={ok:true,schema:'podview.queue-offer.v1',bootId:snapshot.bootId,roomId:room,accountId:queueAccount,targetId:queueTarget,taskId,revision:1,expiresInMs:10000,ownerEpoch:queueOwner,pollSequence:4,truncated:false,items};
  state.offers.set(taskId,{offer,expiresAt:Date.now()+offer.expiresInMs,receipt:null});console.log(`Fixture queue offer ${room} ${taskId} read=${state.reads}`);res.end(JSON.stringify(offer));return true;
 }
 if(url.pathname==='/view/api/music/queue/actions'){
  if(!exact(['bootId','roomId','taskId','revision','requestId','optionId'])||body.bootId!==snapshot.bootId||body.revision!==1||typeof body.requestId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(body.requestId)){fail(409,'invalid_fixture_action');return true;}
  const record=state.offers.get(body.taskId);if(!record||record.expiresAt<=Date.now()||!record.offer.items.some(row=>row.id===body.optionId)){fail(409,'stale_fixture_action');return true;}
  if(record.receipt){if(record.receipt.requestId===body.requestId&&record.optionId===body.optionId)res.end(JSON.stringify(record.receipt));else fail(409,'spent_fixture_action');return true;}
  record.optionId=body.optionId;record.receipt={ok:false,requestId:body.requestId,outcome:room==='queue-unknown'?'unknown':'rejected',retryAllowed:false,physicalResultVerified:false};console.log(`Fixture queue action ${room} ${body.taskId} ${body.optionId} ${body.requestId} outcome=${record.receipt.outcome}`);res.end(JSON.stringify(record.receipt));return true;
 }
 fail(404,'fixture_unavailable');return true;
}
// Authored account-playlist protocol cases; loopback only, never Spotify or audio.
const accountPlaylistRooms=new Map(['account-playlists','account-playlists-readonly','account-playlists-empty','account-playlists-fail'].map((room,index)=>[room,{reads:0,candidates:new Map(),offers:new Map(),bindingId:String(index+5).repeat(64)}]));
const playlistAccount='fixture-playlist-account',playlistTarget='fixture-playlist-speaker',playlistOwner='fixture-playlist-owner';
const playlistRows=['Morgen ved køkkenbordet','Aftenens jazz','Musik til madlavningen','Rolige søndage','Familiefavoritter'].map((name,index)=>({uri:'spotify:playlist:'+String.fromCharCode(97+index).repeat(22),name}));
const playlistBinding=(room,state)=>({...queueBinding(room,state),accountId:playlistAccount,targetId:playlistTarget});
const playlistProjection=(room,state)=>({...queueProjection(room,state),mediaRoomBindings:[playlistBinding(room,state)],capabilities:{timerActions:[],musicActions:[],musicRead:['targets','playback','account_playlists'],controlSetup:[],musicSelection:room!=='account-playlists-readonly',visualEnrichment:false}});
const playlistPlayback=(room,state)=>{const value=queuePlayback(room,state);value.configEntryId=playlistAccount;value.binding=playlistBinding(room,state);value.data.config_entry_id=playlistAccount;value.data.owner_epoch=playlistOwner;value.data.playback.target.target_id=playlistTarget;return value;};
async function accountPlaylistFixture(req,res,url){
 if(!url.pathname.startsWith('/view/api/'))return false;
 const post=['/view/api/music/selection/setup','/view/api/music/selection/actions'].includes(url.pathname),queryRoom=url.searchParams.get('room');
 if(!post&&!accountPlaylistRooms.has(queryRoom))return false;
 res.setHeader('Content-Type','application/json');const fail=(status,error)=>{res.writeHead(status);res.end(JSON.stringify({ok:false,error,retryAllowed:false}));};
 let body,room=queryRoom,state=accountPlaylistRooms.get(room);
 if(post){
  if(req.method!=='POST'||req.headers?.['content-type']!=='application/json'||req.headers?.['x-podview-request']!=='1'){fail(400,'invalid_fixture_request');return true;}
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){fail(400,'invalid_fixture_request');return true;}}
  try{body=JSON.parse(raw);}catch{fail(400,'invalid_fixture_request');return true;}
  room=body?.roomId;state=accountPlaylistRooms.get(room);if(!state||queryRoom&&queryRoom!==room){fail(409,'stale_fixture_scope');return true;}
 }else if(req.method&&req.method!=='GET'){fail(405,'fixture_method_not_allowed');return true;}
 if(url.pathname==='/view/api/snapshot'){res.end(JSON.stringify(playlistProjection(room,state)));return true;}
 if(url.pathname==='/view/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});const send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify(playlistProjection(room,state))}\n\n`);send();const interval=setInterval(send,1000);req.on('close',()=>{clearInterval(interval);res.end();});return true;}
 if(url.pathname==='/view/api/music'){
  const kind=url.searchParams.get('kind'),account=url.searchParams.get('account');
  if(kind==='targets'&&!account){res.end(JSON.stringify({ok:true,data:{accounts:[{config_entry_id:playlistAccount,title:'Playlistfixture · ingen provider'}]}}));return true;}
  if(account!==playlistAccount){fail(409,'stale_fixture_account');return true;}
  if(kind==='targets'){res.end(JSON.stringify({ok:true,coverage:'account_targets',bootId:snapshot.bootId,roomId:room,roomBinding:playlistBinding(room,state),data:{targets:[{accountId:playlistAccount,kind:'spotify_device',targetId:playlistTarget,name:'Fixturehøjttaler · ingen lyd',restricted:false,readOnly:false}]}}));return true;}
  if(kind==='playback'){res.end(JSON.stringify(playlistPlayback(room,state)));return true;}
  if(kind!=='account_playlists'){fail(404,'fixture_music_unavailable');return true;}
  state.reads++;if(room==='account-playlists-fail'&&state.reads>1){console.log(`Fixture playlists read failure ${room} read=${state.reads}`);fail(503,'fixture_playlists_unavailable');return true;}
  const playlists=room==='account-playlists-empty'?[]:playlistRows.map(row=>({...row})),value={ok:true,data:{ok:true,schema:'podconnect.user_playlists.v1',config_entry_id:playlistAccount,owner_epoch:playlistOwner,source:'spotify_web_api',coverage:'first_page',limit:20,returned_count:playlists.length,source_has_more:false,playlists}};
  if(playlists.length&&room!=='account-playlists-readonly'){
   for(const [id,record]of state.candidates)if(record.expiresAt<=Date.now())state.candidates.delete(id);
   if(state.candidates.size>=32){fail(503,'fixture_capacity');return true;}
   const candidateSetId=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
   value.candidateSet={schema:'podview.music-search-context.v1',bootId:snapshot.bootId,roomId:room,configEntryId:playlistAccount,source:'spotify_web_api',query:'account_playlists:collection',revisionScope:'music_selection',sessionId:'touch:fixture',turnId:'touch:fixture-turn',taskId:'music:fixture-task',inputRevision:1,revision:1,candidateSetId,sourceKind:'account_playlists',items:playlists.map((_,index)=>({id:crypto.randomUUID().replaceAll('-','').slice(0,24),index}))};
   state.candidates.set(candidateSetId,{context:value.candidateSet,playlists,ownerEpoch:playlistOwner,expiresAt:Date.now()+60000});
  }
  console.log(`Fixture playlists read ${room} read=${state.reads} rows=${playlists.length} candidate=${!!value.candidateSet}`);res.end(JSON.stringify(value));return true;
 }
 const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 if(room==='account-playlists-readonly'||body?.bootId!==snapshot.bootId){fail(409,'stale_fixture_scope');return true;}
 if(url.pathname==='/view/api/music/selection/setup'){
  const record=state.candidates.get(body.candidateSetId);
  if(!exact(body,['bootId','roomId','candidateSetId','target','candidateIds'])||!exact(body.target,['accountId','kind','targetId'])||body.target.accountId!==playlistAccount||body.target.kind!=='spotify_device'||body.target.targetId!==playlistTarget||!record||record.expiresAt<=Date.now()||record.ownerEpoch!==playlistOwner||!Array.isArray(body.candidateIds)||body.candidateIds.length<1||body.candidateIds.length>3||new Set(body.candidateIds).size!==body.candidateIds.length||body.candidateIds.some(id=>!record.context.items.some(row=>row.id===id))){fail(409,'invalid_fixture_selection');return true;}
  for(const [id,offer]of state.offers)if(offer.expiresAt<=Date.now())state.offers.delete(id);
  if(state.offers.size>=32){fail(503,'fixture_capacity');return true;}
  const offer={ok:true,schema:'podview.music-selection.v1',candidateSetId:body.candidateSetId,accountId:playlistAccount,target:{kind:'spotify_device',targetId:playlistTarget},taskId:'music-selection:'+crypto.randomUUID().replaceAll('-',''),revision:1,startVolumePercent:35,expiresIn:60,options:body.candidateIds.map(id=>({id:crypto.randomUUID().replaceAll('-','').slice(0,24),label:record.playlists[record.context.items.find(row=>row.id===id).index].name,artist:'Playliste'}))};
  state.offers.set(offer.taskId,{offer,expiresAt:Date.now()+60000,receipt:null});console.log(`Fixture playlist setup ${room} ${offer.taskId}`);res.end(JSON.stringify(offer));return true;
 }
 if(url.pathname==='/view/api/music/selection/actions'){
  const record=state.offers.get(body.taskId);
  if(!exact(body,['bootId','roomId','taskId','revision','requestId','optionId','confirmedVolumePercent'])||body.revision!==1||body.confirmedVolumePercent!==35||typeof body.requestId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(body.requestId)||!record||record.expiresAt<=Date.now()||!record.offer.options.some(row=>row.id===body.optionId)){fail(409,'invalid_fixture_action');return true;}
  if(record.receipt){if(record.receipt.requestId===body.requestId&&record.optionId===body.optionId)res.end(JSON.stringify(record.receipt));else fail(409,'spent_fixture_action');return true;}
  record.optionId=body.optionId;record.receipt={ok:false,requestId:body.requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false};console.log(`Fixture playlist action ${room} ${body.taskId} outcome=unknown no-provider-no-audio`);res.end(JSON.stringify(record.receipt));return true;
 }
 fail(404,'fixture_unavailable');return true;
}
// Passive vehicle cue sequence uses the real home DTO and normal 15s UI read cadence.
export function vehicleCueHome(step=0,room='vehicle-charge-cue',baseAt=Date.now()/1000){
 const observedAt=baseAt+step,available=step<3;
 return {schema:'podview.home.v1',bootId:'test-only',roomId:room,revision:step+1,observedAt,vacuum:{status:'unavailable',items:[]},vehicle:available?{status:'observed',source:'home_assistant_state',observedAt,entityIds:['sensor.fixture_vehicle_battery','sensor.fixture_vehicle_charge'],data:{batteryPercent:step===0?71:72,rangeKm:312,charging:{status:'charging',powerKw:11,endsAt:baseAt+7200},climate:{}}}:{status:'unavailable'}};
}
const vehicleCue={reads:0,startedAt:null,baseAt:null};
function vehicleCueFixture(req,res,url){
 if(url.searchParams.get('room')!=='vehicle-charge-cue'||!url.pathname.startsWith('/view/api/'))return false;
 const projection=()=>({...snapshot,roomId:'vehicle-charge-cue',revision:Math.max(1,vehicleCue.reads),observedAt:Date.now()/1000,voice:{phase:'IDLE',sessionId:null,active:false},timers:{status:'observed',epoch:'fixture-vehicle-timers',items:[]},capabilities:{timerActions:[],musicRead:[],musicActions:[],homeRead:['vehicle'],visualEnrichment:false}});
 if(url.pathname.endsWith('/snapshot')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(projection()));return true;}
 if(url.pathname.endsWith('/home')){vehicleCue.startedAt??=Date.now();vehicleCue.baseAt??=Date.now()/1000;const step=Math.min(vehicleCue.reads++,3),value=vehicleCueHome(step,'vehicle-charge-cue',vehicleCue.baseAt);console.log(`Fixture vehicle observation step=${step} battery=${value.vehicle.data?.batteryPercent??'unavailable'} observedAt=${value.observedAt}`);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return true;}
 if(url.pathname.endsWith('/events')){res.writeHead(200,{'Content-Type':'text/event-stream'});const send=()=>{if(vehicleCue.startedAt&&Date.now()-vehicleCue.startedAt>=60000)return;res.write(`event: snapshot\ndata: ${JSON.stringify(projection())}\n\n`);};send();const interval=setInterval(send,1000);req.on('close',()=>{clearInterval(interval);res.end();});return true;}
 // Passive fixture offers no mutation endpoints.
 res.writeHead(404);res.end();return true;
}
export const fixtureRequest=async(req,res)=>{try{const url=new URL(req.url,'http://local');const room=url.searchParams.get('room');if(await basicFlowFixture(req,res,url))return;if(await artworkDiagnosticFixture(req,res,url))return;if(await queueFixture(req,res,url))return;if(await accountPlaylistFixture(req,res,url))return;if(vehicleCueFixture(req,res,url))return;if(await timerFixture(req,res,url))return;if(url.pathname==='/fixture-frame'){const size=url.searchParams.get('size'),dims={'1024x600':[1024,600],'1200x1038':[1200,1038],'1280x800':[1280,800],'390x844':[390,844]}[size]||[1024,600];if(!mediaRoom(room)&&!queueRooms.has(room)&&!accountPlaylistRooms.has(room)&&!basicRooms.has(room))throw Error();res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0;background:#dedede"><iframe title="Testskærm" src="/view/?room='+room+'" style="display:block;border:0;width:'+dims[0]+'px;height:'+dims[1]+'px"></iframe></body></html>');return;}if(mediaRoom(room)&&url.pathname.startsWith('/view/api/')){res.setHeader('Content-Type','application/json');if(room==='answers'&&url.pathname.endsWith('/answers')){res.end(JSON.stringify({schema:'podview.answers.v1',roomId:room,revision:2,items:[{receiptId,...answerContext,observedAt:Date.now()/1000,provenance:{kind:'tool_result'},family:'fact-card',displaySuggested:true,content:{summary:'Vejret i testhjemmet',facts:answerFacts,sources:[{id:'source:'+receiptId,kind:'owner_receipt',receiptId,label:'Serverfixturens resultat',scope:'tool_result'}]}}]}));return;}if(room==='answers'&&url.pathname==='/view/api/sources/'+receiptId){res.end(JSON.stringify({schema:'podview.source.v1',kind:'owner_receipt',receiptId,toolName:'weather_forecast',observedAt:Date.now()/1000,summary:'Vejret i testhjemmet',facts:answerFacts,provenance:{kind:'tool_result'},externalSourcesProvided:false}));return;}if(url.pathname.endsWith('/snapshot')){res.end(JSON.stringify(mediaSnapshot(room)));return;}if(url.pathname.endsWith('/home')){res.end(JSON.stringify(mediaHome(room)));return;}if(url.pathname.endsWith('/music')){const kind=url.searchParams.get('kind'),account=url.searchParams.get('account'),reply=mediaReply(kind,account,room);res.end(JSON.stringify(room==='empty'&&kind==='playback'?reply:{ok:true,data:reply}));return;}if(url.pathname.endsWith('/events')){res.writeHead(200,{'Content-Type':'text/event-stream'});let ticks=0;const send=()=>{ticks++;if(room==='media-loss'&&ticks>3)return;res.write(`event: snapshot\ndata: ${JSON.stringify(mediaSnapshot(room))}\n\n`);};send();const timer=setInterval(send,1000);req.on('close',()=>{clearInterval(timer);res.end();});return;}}if(url.searchParams.get('room')==='home'&&url.pathname==='/view/api/snapshot'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot,roomId:'home',capabilities:{...snapshot.capabilities,homeRead:['vacuum']}}));return;}if(url.searchParams.get('room')==='home'&&url.pathname==='/view/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});const send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify({...snapshot,roomId:'home',capabilities:{...snapshot.capabilities,homeRead:['vacuum']}})}\n\n`);send();const interval=setInterval(send,1000);req.on('close',()=>{clearInterval(interval);res.end();});return;}if(url.searchParams.get('room')==='home'&&url.pathname==='/view/api/home'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({schema:'podview.home.v1',roomId:'home',revision:1,observedAt:Date.now()/1000,vacuum:{status:'observed',items:[{entityId:'vacuum.fixture',name:'Testrobot fra serverfixture',state:'cleaning',battery:67,observedAt:Date.now()/1000,source:'home_assistant_state'}]}}));return;}if(url.searchParams.get('room')==='slow'&&url.pathname==='/view/api/snapshot'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot,roomId:'slow'}));return;}if(url.searchParams.get('room')==='slow'&&url.pathname==='/view/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});let ticks=0;const interval=setInterval(()=>{ticks++;if(ticks>3){clearInterval(interval);return;}res.write(`event: snapshot\ndata: ${JSON.stringify({...snapshot,roomId:'slow',revision:ticks+1,timers:ticks>1?{...snapshot.timers,status:'unavailable',items:[]}:snapshot.timers})}\n\n`);},1000);req.on('close',()=>{clearInterval(interval);res.end();});return;}if(url.searchParams.get('room')==='slow'&&url.pathname==='/view/api/music'){res.setHeader('Content-Type','application/json');const timer=setTimeout(()=>res.end(JSON.stringify({ok:true,data:{tracks:[{name:'Langsom test-sang',artist:'Serverfixture'}]}})),10000);req.on('close',()=>clearTimeout(timer));return;}if(url.pathname==='/view/api/pair'){snapshot.capabilities.timerActions=['timer.start','timer.cancel'];res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,paired:true,expiresIn:300}));return;}if(url.pathname==='/view/api/actions'){res.setHeader('Content-Type','application/json');let body='';for await(const c of req)body+=c;const action=JSON.parse(body);if(action.action==='timer.start')snapshot.timers.items.unshift({id:'fixture-created',name:action.args.name||'Testtimer',secondsLeft:action.args.seconds,status:'running'});if(action.action==='timer.cancel')snapshot.timers.items=snapshot.timers.items.filter(t=>t.id!==action.args.timer_id);snapshot.revision++;res.end(JSON.stringify({ok:true,outcome:'accepted'}));return;}if(url.pathname==='/view/api/snapshot'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot));return;}if(url.pathname==='/view/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);const interval=setInterval(()=>res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`),1000);req.on('close',()=>{clearInterval(interval);res.end();});return;}if(url.pathname==='/view/api/music'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data:{tracks:[{name:'Serverfixture-sang',artist:'Eksempelkunstner'}]}}));return;}const file=path.resolve(root,url.pathname==='/view/'?'index.html':url.pathname.replace(/^\/view\//,''));if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}};
export const fixtureServer=http.createServer(fixtureRequest);
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)fixtureServer.listen(Number(process.env.PODVIEW_FIXTURE_PORT)||4174,'127.0.0.1',()=>console.log('Test-only live fixture listening on '+fixtureServer.address().port));
