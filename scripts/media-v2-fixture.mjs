// QA-only authored playback observations. No provider, sound or device effects.
export const mediaV2Room='media-v2';
export const mediaV2Account='authored-v2-account',mediaV2Boot='authored-v2-boot';
export const mediaV2Phases=Object.freeze(['external-playing','external-paused','external-output-change','account-only','idle','unavailable','restored']);
const outputs=[{name:'Køkken · standard',targetId:'fixture-default',nativeRoomId:'fixture-kitchen',nativeHomepodId:'1',bindingId:'1'.repeat(64)},{name:'Svend · fixture',targetId:'fixture-external-svend',nativeRoomId:'fixture-svend',nativeHomepodId:'2',bindingId:'2'.repeat(64)},{name:'Frida · fixture',targetId:'fixture-external-frida',nativeRoomId:'fixture-frida',nativeHomepodId:'3',bindingId:'3'.repeat(64)}];
let step=0,revision=1,networkOnline=true;const clients=new Map(),journal=[],counts={passiveReads:0,passiveFailures:0,effectRequests:0,effectDispatches:0};const record=event=>{journal.push(event);if(journal.length>128)journal.shift();};
const selected=()=>outputs[step===2?2:1];
const binding=output=>({roomId:mediaV2Room,accountId:mediaV2Account,targetId:output.targetId,nativeRoomId:output.nativeRoomId,nativeHomepodId:output.nativeHomepodId,bindingId:output.bindingId});
export const mediaV2Snapshot=()=>({schema:'podview.snapshot.v1',bootId:mediaV2Boot,roomId:mediaV2Room,revision,observedAt:Date.now()/1000,voice:{phase:'IDLE',sessionId:null,active:false},timers:{status:'observed',epoch:'fixture-v2-empty-timers',items:[]},admission:{kind:'ha_ingress',authenticated:true},mediaRoomBindings:[binding(outputs[0])],capabilities:{timerActions:[],musicActions:[],musicRead:['targets','playback','speakers'],controlSetup:[],musicSelection:false,queueSelection:false,visualEnrichment:false}});
export function mediaV2Playback(){
 const status=step===3?'account_observed':step===4?'idle':step===5?'unavailable':'observed',output=selected(),idle=status==='idle';
 return {ok:true,schema:'podview.room-playback.v2',bootId:mediaV2Boot,roomId:mediaV2Room,configEntryId:mediaV2Account,status,reason:status==='unavailable'?'account_unavailable':status==='account_observed'?'route_unavailable':null,binding:status==='observed'?{...binding(output),validUntil:Date.now()/1000+15}:null,data:status==='unavailable'?null:{ok:true,schema:'podconnect.playback.v1',config_entry_id:mediaV2Account,owner_epoch:'authored-v2-owner',poll_sequence:revision,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:idle?{state:'no_active_playback',target:null,item:null}:{state:[1,6].includes(step)?'paused':'playing',target:{kind:'spotify_device',target_id:output.targetId,name:'Provider alias is not a native room label'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Forfattet ekstern afspilning',artists:['Lokal protokolfixture · ingen lyd'],duration_ms:200000,artwork:null},progress_ms:84000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}}};
}
export const mediaV2Speakers=()=>({ok:true,schema:'podview.speaker-catalogue.v1',bootId:mediaV2Boot,roomId:mediaV2Room,accountId:mediaV2Account,status:'observed',catalogueId:'a'.repeat(64),retrievedAt:Date.now()/1000,source:'podconnect.get_targets',moveAvailable:false,physicalResultVerified:false,speakers:outputs.map((row,index)=>({speakerId:String(index+1).repeat(64),accountId:mediaV2Account,kind:'configured_alias',nativeRoomId:row.nativeRoomId,homepodId:row.nativeHomepodId,name:row.name,availability:'available',default:index===0,nativeSelected:[0,1,2,6].includes(step)&&row===selected(),outputSelected:[0,1,2,6].includes(step)&&row===selected(),selectable:false,startSelectable:false}))});
const publish=()=>{if(networkOnline)for(const res of clients.keys())res.write(`event: snapshot\ndata: ${JSON.stringify(mediaV2Snapshot())}\n\n`);};
export async function mediaV2Fixture(req,res,url){
 const qa=url.pathname==='/fixture-media-v2',advance=url.pathname==='/fixture-media-v2/step',history=url.pathname==='/fixture-media-v2/journal',network=url.pathname==='/fixture-media-v2/network';
 let refRoom;try{refRoom=new URL(req.headers?.referer).searchParams.get('room');}catch{}
 if(!qa&&!advance&&!history&&!network&&!(url.pathname.startsWith('/view/api/')&&(url.searchParams.get('room')===mediaV2Room||req.method!=='GET'&&refRoom===mediaV2Room)))return false;
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));},deny=()=>json(403,{ok:false,error:'authored_read_only_fixture'});
 if(qa&&req.method==='GET'){
  const width=url.searchParams.get('width')==='980'?980:1280;
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="da"><meta charset="utf-8"><title>Forfattet v2 medieforløb · ingen lyd</title><body style="margin:0"><p>Kun lokal protokolfixture · ingen Spotify, Home Assistant eller lyd. Trin skifter serverobservation; produktets almindelige læsning viser ændringen.</p><form method="post" action="/fixture-media-v2/step" target="fixture-receipt"><input type="hidden" name="bootId" value="'+mediaV2Boot+'"><input type="hidden" name="roomId" value="'+mediaV2Room+'">'+mediaV2Phases.map((name,i)=>'<button name="step" value="'+i+'">'+i+' · '+name+'</button>').join('')+'</form><form method="post" action="/fixture-media-v2/network" target="fixture-receipt"><input type="hidden" name="bootId" value="'+mediaV2Boot+'"><input type="hidden" name="roomId" value="'+mediaV2Room+'"><button name="network" value="off">Netværk fra · lokal503</button><button name="network" value="on">Netværk til · normal recovery</button></form><iframe name="fixture-receipt" title="Lokal fixturekvittering" style="display:block;border:0;width:'+width+'px;height:48px"></iframe><iframe title="PodView ·'+width+'×800" src="/view/?room='+mediaV2Room+'" width="'+width+'" height="800" style="display:block;border:0;width:'+width+'px;height:800px"></iframe></body></html>');return true;
 }
 if(history&&req.method==='GET'){json(200,{fixture:true,step,phase:mediaV2Phases[step],networkOnline,counts:{...counts},events:journal});return true;}
 if(network){
  if(req.method!=='POST'||req.headers?.['content-type']!=='application/x-www-form-urlencoded')return deny(),true;
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)return deny(),true;}const params=new URLSearchParams(raw),body=Object.fromEntries(params);
  if(params.size!==3||Object.keys(body).sort().join(',')!=='bootId,network,roomId'||body.bootId!==mediaV2Boot||body.roomId!==mediaV2Room||!['off','on'].includes(body.network)||req.headers?.origin&&req.headers.origin!==`http://${req.headers.host}`)return deny(),true;
  networkOnline=body.network==='on';record({event:'authored_network_change',networkOnline});
  if(!networkOnline)for(const [stream,cleanup] of clients){cleanup();stream.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="da"><meta charset="utf-8"><p>Lokal fixture: netværk '+(networkOnline?'til · produktets normale recovery':'fra · snapshot/musik503, SSE lukket')+'. Ingen enhedshandling.</p></html>');return true;
 }
 if(advance){
  if(req.method!=='POST'||req.headers?.['content-type']!=='application/x-www-form-urlencoded')return deny(),true;
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)return deny(),true;}const params=new URLSearchParams(raw),body=Object.fromEntries(params);
  if(params.size!==3||Object.keys(body).sort().join(',')!=='bootId,roomId,step'||body.bootId!==mediaV2Boot||body.roomId!==mediaV2Room||! /^[0-6]$/.test(body.step)||req.headers?.origin&&req.headers.origin!==`http://${req.headers.host}`)return deny(),true;
  step=Number(body.step);revision++;record({event:'authored_observation_change',step,phase:mediaV2Phases[step],revision});publish();res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="da"><meta charset="utf-8"><p>Lokal observation: '+mediaV2Phases[step]+' · ingen enhedshandling. Afvent produktets næste læsning.</p></html>');return true;
 }
 if(req.method!=='GET'){counts.effectRequests++;record({event:'effect_denied',path:url.pathname});return deny(),true;}
 if(['/view/api/snapshot','/view/api/music','/view/api/events'].includes(url.pathname)){counts.passiveReads++;if(!networkOnline){counts.passiveFailures++;record({event:'passive_503',path:url.pathname});json(503,{ok:false,error:'authored_network_unavailable'});return true;}}
 if(url.pathname==='/view/api/snapshot'){json(200,mediaV2Snapshot());return true;}
 if(url.pathname==='/view/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});const heartbeat=setInterval(publish,1000),cleanup=()=>{clearInterval(heartbeat);clients.delete(res);};clients.set(res,cleanup);publish();req.on('close',cleanup);return true;}
 if(url.pathname==='/view/api/music'){
  const kind=url.searchParams.get('kind'),account=url.searchParams.get('account');
  if(kind==='targets'&&!account){json(200,{ok:true,data:{accounts:[{config_entry_id:mediaV2Account,title:'Forfattet v2 testkonto'}]}});return true;}
  if(account!==mediaV2Account){json(409,{ok:false,error:'authored_wrong_account'});return true;}
  if(kind==='playback'){record({event:'playback_read',phase:mediaV2Phases[step],revision});json(200,mediaV2Playback());return true;}
  if(kind==='speakers'){json(200,mediaV2Speakers());return true;}
 }
 deny();return true;
}
