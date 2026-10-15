const TRACK=/^spotify:track:[A-Za-z0-9]{22}$/;
const HEX64=/^[a-f0-9]{64}$/;
const OPTION=/^[a-f0-9]{24}$/;
const TASK=/^music-selection:[a-f0-9]{32}$/;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;

export function searchSample(body,account,query,snapshot){
 const data=body?.data,context=body?.candidateSet;
 if(body?.ok!==true||data?.ok!==true||data.schema!=='podconnect.search_tracks.v1'||data.config_entry_id!==account||data.source!=='spotify_web_api'||data.coverage!=='spotify_search_sample'||data.query!==query||data.limit!==3||!Array.isArray(data.tracks)||data.tracks.length>3||data.returned_count!==data.tracks.length||data.source_sample_count!==data.tracks.length)return null;
 const tracks=[];
 for(const row of data.tracks){if(!text(row?.name,256)||!text(row?.artist,512)||!TRACK.test(row?.uri))return null;tracks.push({name:row.name,artist:row.artist,uri:row.uri,artwork:row.artwork});}
 if(!tracks.length)return {tracks,context:null};
 if(context?.schema!=='podview.music-search-context.v1'||!HEX64.test(context.candidateSetId)||context.bootId!==snapshot?.bootId||context.roomId!==snapshot?.roomId||context.configEntryId!==account||context.source!=='spotify_web_api'||context.query!==query||!['music_selection','answer_task'].includes(context.revisionScope)||!integer(context.revision,0,Number.MAX_SAFE_INTEGER)||!integer(context.inputRevision,0,Number.MAX_SAFE_INTEGER)||['sessionId','turnId','taskId'].some(key=>!text(context[key],1024)))return {tracks,context:null};
 return {tracks,context};
}

export function directTargets(body,account){
 if(body?.ok!==true||body.coverage!=='account_targets'||!Array.isArray(body.data?.targets)||body.data.targets.length>256)return null;
 const seen=new Set(),targets=[];
 for(const row of body.data.targets){if(row?.accountId!==account||!['spotify_device','configured_alias','observed_output'].includes(row.kind)||!text(row.targetId,1024)||!text(row.name,1024)||typeof row.restricted!=='boolean'||typeof row.readOnly!=='boolean')return null;if(row.kind!=='spotify_device'||row.restricted||row.readOnly)continue;if(seen.has(row.targetId))return null;seen.add(row.targetId);targets.push({accountId:account,kind:'spotify_device',targetId:row.targetId,name:row.name});}
 return targets;
}

export function selectionOffer(body,source,target,requestedAt=Date.now()){
 if(!source?.context||!target||body?.ok!==true||body.schema!=='podview.music-selection.v1'||body.candidateSetId!==source.context.candidateSetId||body.accountId!==target.accountId||body.target?.kind!=='spotify_device'||body.target.targetId!==target.targetId||!TASK.test(body.taskId)||body.revision!==source.context.revision||!integer(body.observedVolumePercent,0,100)||!integer(body.expiresIn,1,60)||!Array.isArray(body.options)||body.options.length!==source.tracks.length)return null;
 if(!Number.isFinite(requestedAt)||requestedAt+body.expiresIn*1000<=Date.now())return null;
 const ids=new Set();
 for(let i=0;i<body.options.length;i++){const option=body.options[i],track=source.tracks[i];if(!OPTION.test(option?.id)||ids.has(option.id)||option.label!==track.name||option.artist!==track.artist)return null;ids.add(option.id);}
 return {bootId:source.context.bootId,roomId:source.context.roomId,accountId:target.accountId,candidateSetId:source.context.candidateSetId,target,taskId:body.taskId,revision:body.revision,observedVolumePercent:body.observedVolumePercent,options:body.options.map(row=>({id:row.id,label:row.label,artist:row.artist})),expiresAt:requestedAt+body.expiresIn*1000};
}

export function selectionCurrent(offer,snapshot,account,source){
 if(!offer||!snapshot||offer.expiresAt<=Date.now()||snapshot.bootId!==offer.bootId||snapshot.roomId!==offer.roomId||snapshot.capabilities?.musicSelection!==true||offer.accountId!==account||offer.candidateSetId!==source?.context?.candidateSetId)return false;
 const context=source.context;
 if(context.revisionScope==='answer_task')return ['sessionId','turnId','taskId','inputRevision','revision'].every(key=>snapshot.answers?.[key]===context[key])&&snapshot.voice?.sessionId===context.sessionId;
 return context.revisionScope==='music_selection';
}
