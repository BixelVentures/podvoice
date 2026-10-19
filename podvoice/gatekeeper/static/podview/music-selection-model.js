import {mediaRoomBinding} from './media-observation.js';
import {spotifyArtwork} from './spotify-artwork.js';
const TRACK=/^spotify:track:[A-Za-z0-9]{22}$/;
const PLAYLIST=/^spotify:playlist:[A-Za-z0-9]{22}$/;
const THEMES={morning_acoustic:['En rolig morgen','assets/morning-acoustic.png'],evening_jazz:['Rolig aften','assets/lake.png'],cooking:['Musik til madlavningen','assets/kitchen.png'],italian:['En italiensk aften','assets/italian.png'],indie:['Indie i baggrunden','assets/indie.png'],calm:['En rolig stund','assets/lake.png']};
const FEELINGS={energy:['Mere energi','assets/indie.png'],calm:['Helt ned i tempo','assets/lake.png'],familiar:['Noget velkendt','assets/italian.png'],sing:['Syng med','assets/indie.png'],soft:['Bløde toner','assets/lake.png'],bright:['Et lyst øjeblik','assets/kitchen.png']};
const playlistKind=kind=>['mood','feeling'].includes(kind);
const themesFor=kind=>kind==='feeling'?FEELINGS:THEMES;
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

// Collection occurrence IDs are opaque source references, never play authority.
export function collectionSample(body,account,kind,snapshot,requestedAt=Date.now()){
 const data=body?.data,context=body?.candidateSet,selection=body?.selection,themes=themesFor(kind),playlist=playlistKind(kind);
 if(!['top','recent','liked','mood','feeling'].includes(kind)||body?.ok!==true||data?.config_entry_id!==account||!Array.isArray(data.tracks)||data.tracks.length<1||data.tracks.length>50||!selection||!['requested_limit','source_sample_count','returned_count'].every(key=>integer(selection[key],0,50))||selection.returned_count!==data.tracks.length||typeof selection.more_in_sample!=='boolean'||typeof selection.size_limited!=='boolean')return null;
 const tracks=[];for(const row of data.tracks){if(!text(row?.name,256)||!text(row?.artist,512)||!(playlist?PLAYLIST:TRACK).test(row?.uri))return null;if(playlist&&(!themes[row.themeId]||row.themeTitle!==themes[row.themeId][0]||row.themeArt!==themes[row.themeId][1]||row.artist!==row.themeTitle))return null;tracks.push({name:row.name,artist:row.artist,uri:row.uri,artwork:spotifyArtwork(row.artwork,row.uri),...(playlist?{themeId:row.themeId,themeTitle:row.themeTitle,themeArt:row.themeArt}:{})});}if(playlist&&(tracks.length!==3||new Set(tracks.map(row=>row.uri)).size!==3||new Set(tracks.map(row=>row.themeId)).size!==3))return null;
 if(context?.schema!=='podview.music-search-context.v1'||!HEX64.test(context.candidateSetId)||context.bootId!==snapshot?.bootId||context.roomId!==snapshot?.roomId||context.configEntryId!==account||context.source!=='spotify_web_api'||context.query!==`${kind}:collection`||context.sourceKind!==kind||!['music_selection','answer_task'].includes(context.revisionScope)||!integer(context.revision,0,Number.MAX_SAFE_INTEGER)||!integer(context.inputRevision,0,Number.MAX_SAFE_INTEGER)||['sessionId','turnId','taskId'].some(key=>!text(context[key],1024))||!Array.isArray(context.items)||context.items.length!==tracks.length||!Number.isFinite(requestedAt)||requestedAt>Date.now()||requestedAt+60000<=Date.now())return null;
 const ids=new Set(),indices=new Set(),items=[];for(const row of context.items){if(!row||Object.keys(row).sort().join(',')!=='id,index'||!OPTION.test(row.id)||ids.has(row.id)||!integer(row.index,0,tracks.length-1)||indices.has(row.index))return null;ids.add(row.id);indices.add(row.index);items.push({id:row.id,index:row.index});}
 return {tracks,context:{schema:context.schema,bootId:context.bootId,roomId:context.roomId,configEntryId:account,source:context.source,query:context.query,revisionScope:context.revisionScope,sessionId:context.sessionId,turnId:context.turnId,taskId:context.taskId,inputRevision:context.inputRevision,revision:context.revision,candidateSetId:context.candidateSetId},items,sourceKind:kind,expiresAt:requestedAt+60000};
}
export function collectionCurrent(source,snapshot,account){
 const c=source?.context;if(!c||!['top','recent','liked','mood','feeling'].includes(source.sourceKind)||!Number.isFinite(source.expiresAt)||source.expiresAt<=Date.now()||c.bootId!==snapshot?.bootId||c.roomId!==snapshot?.roomId||c.configEntryId!==account||snapshot?.capabilities?.musicSelection!==true||!snapshot.capabilities.musicRead?.includes(source.sourceKind))return false;
 return c.revisionScope==='answer_task'?['sessionId','turnId','taskId','inputRevision','revision'].every(key=>snapshot.answers?.[key]===c[key])&&snapshot.voice?.sessionId===c.sessionId:c.revisionScope==='music_selection';
}
export function collectionSelection(source,indices){
 if(!source?.context||!Array.isArray(source.items)||!Array.isArray(source.tracks)||!Array.isArray(indices)||indices.length<1||indices.length>3||new Set(indices).size!==indices.length)return null;
 const tracks=[],candidateIds=[];for(const index of indices){const item=source.items.find(row=>row.index===index);if(!Number.isInteger(index)||!source.tracks[index]||!item)return null;tracks.push(source.tracks[index]);candidateIds.push(item.id);}return {...source,tracks,candidateIds};
}
const identity=row=>JSON.stringify([row.uri,row.sourceName??row.name??row.title,row.sourceArtist??row.artist??row.description,spotifyArtwork(row.sourceArtwork??row.artwork,row.uri)]);
export function renewCollectionSelection(source,cards){
 if(!source||!Array.isArray(cards)||!cards.length||cards.length>3)return null;const indices=[];for(const card of cards){const matches=source.tracks.flatMap((track,index)=>identity(track)===identity(card)?[index]:[]);if(matches.length!==1||indices.includes(matches[0]))return null;indices.push(matches[0]);}return collectionSelection(source,indices);
}

export function directTargets(body,account,snapshot){
 const binding=mediaRoomBinding(snapshot,account),echoed=mediaRoomBinding({roomId:snapshot?.roomId,mediaRoomBindings:[body?.roomBinding]},account);if(!binding||!echoed||Object.keys(binding).some(key=>echoed[key]!==binding[key])||body?.bootId!==snapshot.bootId||body?.roomId!==snapshot.roomId)return null;
 if(body?.ok!==true||body.coverage!=='account_targets'||!Array.isArray(body.data?.targets)||body.data.targets.length>256)return null;
 const seen=new Set(),targets=[];
 for(const row of body.data.targets){if(row?.accountId!==account||!['spotify_device','configured_alias','observed_output'].includes(row.kind)||!text(row.targetId,1024)||!text(row.name,1024)||typeof row.restricted!=='boolean'||typeof row.readOnly!=='boolean')return null;if(row.kind!=='spotify_device'||row.restricted||row.readOnly||row.targetId!==binding.targetId)continue;if(seen.has(row.targetId))return null;seen.add(row.targetId);targets.push({accountId:account,kind:'spotify_device',targetId:row.targetId,name:row.name});}
 return targets;
}

export function selectionOffer(body,source,target,requestedAt=Date.now()){
 if(!source?.context||!target||body?.ok!==true||body.schema!=='podview.music-selection.v1'||body.candidateSetId!==source.context.candidateSetId||body.accountId!==target.accountId||body.target?.kind!=='spotify_device'||body.target.targetId!==target.targetId||!TASK.test(body.taskId)||body.revision!==source.context.revision||!integer(body.startVolumePercent,0,100)||!integer(body.expiresIn,1,60)||!Array.isArray(body.options)||body.options.length!==source.tracks.length)return null;
 if(!Number.isFinite(requestedAt)||requestedAt+body.expiresIn*1000<=Date.now())return null;
 const ids=new Set();
 for(let i=0;i<body.options.length;i++){const option=body.options[i],track=source.tracks[i];if(!OPTION.test(option?.id)||ids.has(option.id)||option.label!==track.name||option.artist!==track.artist)return null;ids.add(option.id);}
 return {bootId:source.context.bootId,roomId:source.context.roomId,accountId:target.accountId,candidateSetId:source.context.candidateSetId,target,taskId:body.taskId,revision:body.revision,startVolumePercent:body.startVolumePercent,options:body.options.map(row=>({id:row.id,label:row.label,artist:row.artist})),expiresAt:requestedAt+body.expiresIn*1000};
}

export function selectionCurrent(offer,snapshot,account,source){
 if(source?.sourceKind&&!collectionCurrent(source,snapshot,account))return false;
 if(!offer||!snapshot||offer.expiresAt<=Date.now()||snapshot.bootId!==offer.bootId||snapshot.roomId!==offer.roomId||snapshot.capabilities?.musicSelection!==true||offer.accountId!==account||offer.candidateSetId!==source?.context?.candidateSetId)return false;
 const context=source.context;
 if(context.revisionScope==='answer_task')return ['sessionId','turnId','taskId','inputRevision','revision'].every(key=>snapshot.answers?.[key]===context[key])&&snapshot.voice?.sessionId===context.sessionId;
 return context.revisionScope==='music_selection';
}

// Read-only preview is source data, never a MusicSelection task or candidate set.
export function moodPreview(body,account,snapshot,requestedAt=Date.now(),kind='mood'){
 const p=body?.preview,d=body?.data,now=Date.now(),themes=themesFor(kind);
 if(!playlistKind(kind)||body?.ok!==true||body.schema!==`podview.${kind}-preview.v1`||Object.keys(body).sort().join(',')!=='data,ok,preview,schema'||!p||Object.keys(p).sort().join(',')!=='bootId,configEntryId,expiresIn,ownerEpoch,readOnly,roomId,source,voiceSessionId,voiceTurnId'||p.readOnly!==true||p.bootId!==snapshot?.bootId||p.roomId!==snapshot?.roomId||p.configEntryId!==account||p.source!=='spotify_web_api'||!text(p.ownerEpoch,128)||p.expiresIn!==60||!snapshot?.capabilities?.musicRead?.includes(kind)||(p.voiceSessionId??null)!==(snapshot?.voice?.sessionId??null)||(p.voiceTurnId??null)!==(snapshot?.voice?.turnId??null)||![p.voiceSessionId,p.voiceTurnId].every(v=>v===null||text(v,1024))||!Number.isFinite(requestedAt)||requestedAt>now||requestedAt+60000<=now||!d||Object.keys(d).sort().join(',')!=='config_entry_id,owner_epoch,source,tracks'||d.config_entry_id!==account||d.owner_epoch!==p.ownerEpoch||d.source!=='spotify_web_api'||!Array.isArray(d.tracks)||d.tracks.length!==3)return null;
 const tracks=[];for(const row of d.tracks){if(!row||Object.keys(row).filter(key=>key!=='artwork').sort().join(',')!=='artist,name,themeArt,themeId,themeTitle,uri'||!text(row.name,256)||!PLAYLIST.test(row.uri)||!themes[row.themeId]||row.themeTitle!==themes[row.themeId][0]||row.artist!==row.themeTitle||row.themeArt!==themes[row.themeId][1])return null;tracks.push({...row,artwork:spotifyArtwork(row.artwork,row.uri)});}
 if(new Set(tracks.map(row=>row.uri)).size!==3||new Set(tracks.map(row=>row.themeId)).size!==3)return null;
 return {tracks,readOnly:true,expiresAt:requestedAt+60000};
}
