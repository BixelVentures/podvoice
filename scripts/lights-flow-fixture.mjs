// Authored loopback-only source DTOs. No household transport or effect execution.
export const lightsRoom='lights-scoped';
const bootId='authored-lights-boot',bindingId='b'.repeat(64),sourceEpoch='a'.repeat(64);
export const lightsSnapshot=(now=Date.now()/1000)=>({schema:'podview.snapshot.v1',bootId,roomId:lightsRoom,revision:1,observedAt:now,voice:{phase:'IDLE',sessionId:null,active:false},timers:{status:'observed',epoch:'authored-empty',items:[]},capabilities:{timerActions:[],musicRead:['targets','playback'],musicActions:[],homeRead:['light'],controlSetup:['light'],visualEnrichment:false}});
export function lightsHome(area='kitchen',{now=Math.floor(Date.now()/1000),epoch=sourceEpoch,removed=false}={}){
 const items=[{areaId:'kitchen',areaName:'Køkken'},{areaId:'living',areaName:'Stue'},{areaId:'empty',areaName:'Tomt rum'}];
 const home={schema:'podview.home.v1',bootId,roomId:lightsRoom,revision:1,observedAt:now,vacuum:{status:'unavailable',items:[]}};
 if(removed)return {...home,lightAreas:{status:'unbound',source:'home_assistant_area_registry',sourceEpoch:null,observedAt:null,validUntil:null,bindingId:null,placementRevision:null,ownAreaId:null,selectedAreaId:null,items:[]},lightPlacement:{status:'unbound',areaId:null,areaName:null,bindingId:null,placementRevision:null},lights:{status:'unbound',source:'home_assistant_state',sourceEpoch:null,observedAt:null,validUntil:null,scope:null,complete:false,items:[],countUnit:'light_entities'}};
 const selected=items.find(row=>row.areaId===area),scope=selected?{kind:'ha_area',areaId:area,areaName:selected.areaName,bindingId,placementRevision:1,isOwnArea:area==='kitchen'}:null;
 const rows=area==='kitchen'?[{entityId:'light.fixture_dimmer',areaId:area,name:'Loftlys',state:'on',brightness:128,supportsBrightness:true},{entityId:'light.fixture_contact',areaId:area,name:'Bordlampe',state:'off',brightness:null,supportsBrightness:false}]:area==='living'?[{entityId:'light.fixture_living',areaId:area,name:'Gulvlampe',state:'unknown',brightness:null,supportsBrightness:false}]:[];
 return {...home,lightAreas:{status:'observed',source:'home_assistant_area_registry',sourceEpoch:epoch,observedAt:now,validUntil:now+15,bindingId,placementRevision:1,ownAreaId:'kitchen',selectedAreaId:selected?area:null,items},lightPlacement:{status:'bound',areaId:'kitchen',areaName:'Køkken',bindingId,placementRevision:1},lights:selected?{status:'observed',source:'home_assistant_state',sourceEpoch:epoch,observedAt:now,validUntil:now+15,scope,complete:true,items:rows,countUnit:'light_entities'}:{status:'unavailable',source:'home_assistant_state',sourceEpoch:null,observedAt:null,validUntil:null,scope:null,complete:false,items:[],countUnit:'light_entities'}};
}
export function lightsTask(target,now=Math.floor(Date.now()/1000)){
 const source=lightsHome(target?.areaId,{now}).lights,rows=source.items.filter(row=>!target.entityId||row.entityId===target.entityId);
 if(source.status!=='observed'||!rows.length||rows.some(row=>!['on','off'].includes(row.state)))return null;
 const options=[{id:'1'.repeat(24),label:'Tænd',action:'turn_on',argsSchema:{kind:'none'}},{id:'2'.repeat(24),label:'Sluk',action:'turn_off',argsSchema:{kind:'none'}}];
 if(rows.every(row=>row.supportsBrightness))options.push({id:'3'.repeat(24),label:'Lysstyrke',action:'brightness',argsSchema:{kind:'percent',min:0,max:100}});
 return {ok:true,schema:'podview.control.v1',bootId,roomId:lightsRoom,taskId:'control:'+'c'.repeat(32),revision:1,expiresAt:now+14,domain:'light',options,setup:{areaId:target.areaId,entityIds:rows.map(row=>row.entityId),scope:source.scope}};
}
export async function lightsFlowFixture(req,res,url){let room=url.searchParams.get('room'),input=null;
 if(['/view/api/control/setup','/view/api/control/actions'].includes(url.pathname)){let referer;try{referer=new URL(req.headers?.referer).searchParams.get('room');}catch{}if(referer===lightsRoom){let raw='';for await(const chunk of req)raw+=chunk;try{input=JSON.parse(raw);room=input.roomId;}catch{}}}
 if(room!==lightsRoom||!url.pathname.startsWith('/view/api/'))return false;res.setHeader('Content-Type','application/json');
 if(url.pathname.endsWith('/snapshot')){res.end(JSON.stringify(lightsSnapshot()));return true;}
 if(url.pathname.endsWith('/events')){res.writeHead(200,{'Content-Type':'text/event-stream'});const send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify(lightsSnapshot())}\n\n`);send();const timer=setInterval(send,1000);req.on('close',()=>clearInterval(timer));return true;}
 if(url.pathname.endsWith('/home')){const area=url.searchParams.get('lightArea')||'kitchen';console.log('Authored lights home '+area);res.end(JSON.stringify(lightsHome(area)));return true;}
 if(url.pathname.endsWith('/music')){if(url.searchParams.get('kind')==='targets')res.end(JSON.stringify({ok:true,data:{accounts:[{config_entry_id:'authored-lights-account',title:'Forfattet konto · ingen lyd'}]}}));else res.end(JSON.stringify({ok:true,schema:'podview.room-playback.v1',bootId,roomId:lightsRoom,configEntryId:'authored-lights-account',status:'unavailable',binding:null,data:null}));return true;}
 if(url.pathname.endsWith('/control/setup')){const valid=input?.bootId===bootId&&input?.roomId===lightsRoom&&input?.domain==='light'&&input.target&&Object.keys(input.target).sort().join(',')===(input.target.entityId?'areaId,entityId':'areaId'),task=valid&&lightsTask(input.target);if(!task){res.writeHead(409);res.end(JSON.stringify({ok:false,error:'authored_invalid_target'}));return true;}console.log('Authored lights setup '+JSON.stringify(input.target));const timer=setTimeout(()=>res.end(JSON.stringify(lightsTask(input.target))),1000);res.once('close',()=>clearTimeout(timer));return true;}
 // Effects are always denied; no service or external transport is present.
 res.writeHead(403);res.end(JSON.stringify({ok:false,outcome:'rejected',retryAllowed:false,physicalResultVerified:false,error:'authored_no_effect'}));return true;
}
