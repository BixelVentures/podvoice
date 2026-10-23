import test from 'node:test';
import assert from 'node:assert/strict';
import {accountPlaylistsSample,collectionSample,collectionCurrent,collectionSelection,renewCollectionSelection,selectionOffer,selectionCurrent} from '../../podvoice/gatekeeper/static/podview/music-selection-model.js';
const uri=n=>'spotify:playlist:'+String(n).padStart(22,'0'),art={kind:'playlist_cover',provider:'spotify',url:'https://i.scdn.co/image/sourcecover'};
const snapshot=()=>({bootId:'boot',roomId:'room',capabilities:{musicRead:['account_playlists'],musicSelection:true},voice:{sessionId:null},answers:{}});
const body=(count=2)=>({ok:true,data:{ok:true,schema:'podconnect.user_playlists.v1',config_entry_id:'account',owner_epoch:'real-owner-epoch',source:'spotify_web_api',coverage:'first_page',limit:20,returned_count:count,source_has_more:true,playlists:Array.from({length:count},(_,index)=>({uri:uri(index),name:'Kildens playliste '+index,...(index===0?{artwork:art}:{})}))}});
const context=(count=2)=>({schema:'podview.music-search-context.v1',bootId:'boot',roomId:'room',configEntryId:'account',source:'spotify_web_api',query:'account_playlists:collection',sourceKind:'account_playlists',candidateSetId:'a'.repeat(64),revisionScope:'music_selection',sessionId:'touch:one',turnId:'touch:two',taskId:'music:three',inputRevision:1,revision:1,items:Array.from({length:count},(_,index)=>({id:String(index).padStart(24,'0'),index}))});
test('closed first-page account source preserves real order/cover and only adds literal playlist type copy',()=>{
 const wire=body(),before=structuredClone(wire),at=Date.now()-1000,parsed=accountPlaylistsSample(wire,'account',snapshot(),at);assert.ok(parsed);assert.deepEqual(parsed.tracks.map(row=>row.uri),[uri(0),uri(1)]);assert.equal(parsed.tracks[0].name,wire.data.playlists[0].name);assert.deepEqual(parsed.tracks[0].artwork,art);assert.equal(parsed.tracks[1].artwork,null);assert.deepEqual(parsed.tracks.map(row=>row.artist),['Playliste','Playliste']);assert.equal(parsed.ownerEpoch,'real-owner-epoch');assert.equal(parsed.coverage,'first_page');assert.equal(parsed.sourceHasMore,true);assert.equal(parsed.expiresAt,at+60000);assert.equal(parsed.context,null);assert.deepEqual(parsed.items,[]);assert.equal('themeId' in parsed.tracks[0],false);assert.equal('personalized' in parsed,false);assert.deepEqual(wire,before);
 parsed.tracks[0].artwork.url='changed';assert.equal(wire.data.playlists[0].artwork.url,art.url,'projection does not mutate source artwork');
});
test('optional current candidate context admits account collection without inventing play authority',()=>{
 const wire={...body(),candidateSet:context()},parsed=accountPlaylistsSample(wire,'account',snapshot());assert.ok(parsed.context);assert.deepEqual(parsed.items,wire.candidateSet.items);assert.equal(parsed.context.sourceKind,'account_playlists');assert.equal('ownerEpoch' in wire.candidateSet,false);assert.equal('expiresAt' in wire.candidateSet,false);
 assert.equal(collectionCurrent(parsed,snapshot(),'account'),true);assert.equal(selectionCurrent(null,snapshot(),'account',parsed),false);
});
test('no candidate means read-only for empty, unpaired or nonempty library; no inferred personal mix',()=>{
 for(const count of [0,1,20]){const parsed=accountPlaylistsSample(body(count),'account',{...snapshot(),capabilities:{musicRead:['account_playlists'],musicSelection:false}});assert.ok(parsed);assert.equal(parsed.context,null);assert.equal(parsed.tracks.length,count);assert.deepEqual(parsed.items,[]);}
 const wire=body();wire.data.playlists[0].name='Daily Mix 1';const parsed=accountPlaylistsSample(wire,'account',snapshot());assert.equal(parsed.tracks[0].name,'Daily Mix 1');assert.equal('personalized' in parsed.tracks[0],false);assert.equal('madeForYou' in parsed.tracks[0],false);
 assert.equal(accountPlaylistsSample({...body(0),candidateSet:context(0)},'account',snapshot()),null,'empty response must omit candidateSet, not fabricate an empty action source');
});
test('malformed envelope, owner/account/schema/coverage/count and missing read grant fail closed',()=>{
 for(const mutate of [w=>w.extra=true,w=>w.ok=false,w=>w.data.extra=true,w=>w.data.ok=false,w=>w.data.schema='podconnect.search_playlists.v1',w=>w.data.config_entry_id='other',w=>w.data.owner_epoch='',w=>w.data.owner_epoch='x'.repeat(129),w=>w.data.source='search',w=>w.data.coverage='all',w=>w.data.limit=50,w=>w.data.returned_count=1,w=>w.data.source_has_more='true',w=>w.data.playlists=null,w=>w.candidateSet=null]){const wire=body();mutate(wire);assert.equal(accountPlaylistsSample(wire,'account',snapshot()),null,String(mutate));}
 assert.equal(accountPlaylistsSample(body(21),'account',snapshot()),null);assert.equal(accountPlaylistsSample(body(),'other',snapshot()),null);assert.equal(accountPlaylistsSample(body(),'account',{...snapshot(),capabilities:{musicRead:['top'],musicSelection:true}}),null);assert.equal(accountPlaylistsSample(body(),'account',snapshot(),Date.now()+1000),null);assert.equal(accountPlaylistsSample(body(),'account',snapshot(),Date.now()-60000),null);
 for(const key of Object.keys(body().data)){const wire=body();delete wire.data[key];assert.equal(accountPlaylistsSample(wire,'account',snapshot()),null,key);}
});
test('only actual playlist identities and optional exact Spotify playlist-cover objects are admitted',()=>{
 for(const change of [{uri:'spotify:track:'+'0'.repeat(22)},{uri:'https://open.spotify.com/playlist/x'},{uri:uri(1)},{name:''},{name:' '},{name:'x'.repeat(257)},{owner:'invented creator'},{artwork:null},{artwork:{...art,kind:'album_cover'}},{artwork:{...art,url:'https://example.com/cover'}},{artwork:{...art,url:art.url+'?token=1'}},{artwork:{...art,extra:true}}]){const wire=body();Object.assign(wire.data.playlists[0],change);assert.equal(accountPlaylistsSample(wire,'account',snapshot()),null,JSON.stringify(change));}
});
test('candidate schema is closed and cannot alias public search, theme, task or occurrence identities',()=>{
 for(const change of [{extra:true},{schema:'other'},{source:'other'},{sourceKind:'mood'},{query:'top:collection'},{candidateSetId:'a'},{revisionScope:'unknown'},{sessionId:''},{revision:-1},{inputRevision:1.5},{ownerEpoch:'invented'},{expiresAt:Date.now()+60000},{items:[{id:'a'.repeat(24),index:0},{id:'a'.repeat(24),index:1}]},{items:[{id:'a'.repeat(24),index:0},{id:'b'.repeat(24),index:0}]},{items:[{id:'a'.repeat(24),index:2},{id:'b'.repeat(24),index:1}]},{items:[{id:'a'.repeat(24),index:0,uri:uri(0)},{id:'b'.repeat(24),index:1}]}])assert.equal(accountPlaylistsSample({...body(),candidateSet:{...context(),...change}},'account',snapshot()),null,JSON.stringify(change));
});
test('command revocation or superseded scope strips action context while retaining independently admitted native read',()=>{
 const wire={...body(),candidateSet:context()};
 for(const change of [{bootId:'next'},{roomId:'other'},{capabilities:{musicRead:['account_playlists'],musicSelection:false}}]){const parsed=accountPlaylistsSample(wire,'account',{...snapshot(),...change});assert.ok(parsed);assert.equal(parsed.tracks.length,2);assert.equal(parsed.context,null);assert.deepEqual(parsed.items,[]);}
 const answer=context();answer.revisionScope='answer_task';const snap=snapshot();snap.voice.sessionId=answer.sessionId;snap.answers={sessionId:answer.sessionId,turnId:answer.turnId,taskId:answer.taskId,inputRevision:answer.inputRevision,revision:answer.revision};assert.ok(accountPlaylistsSample({...body(),candidateSet:answer},'account',snap).context);snap.answers.inputRevision++;assert.equal(accountPlaylistsSample({...body(),candidateSet:answer},'account',snap).context,null);
});
const target={accountId:'account',kind:'spotify_device',targetId:'speaker'};
const offered=source=>({ok:true,schema:'podview.music-selection.v1',candidateSetId:source.context.candidateSetId,accountId:'account',target:{kind:'spotify_device',targetId:'speaker'},taskId:'music-selection:'+'f'.repeat(32),revision:source.context.revision,startVolumePercent:25,expiresIn:60,options:source.tracks.map((row,index)=>({id:String(index+10).padStart(24,'0'),label:row.name,artist:'Playliste'}))});
test('account occurrences use the existing subset, native offer and current-selection chain with exact playlist type',()=>{
 const snap=snapshot(),source=accountPlaylistsSample({...body(),candidateSet:context()},'account',snap),selected=collectionSelection(source,[1,0]);
 assert.equal(collectionCurrent(selected,snap,'account'),true);assert.deepEqual(selected.candidateIds,[context().items[1].id,context().items[0].id]);
 const receipt=offered(selected),offer=selectionOffer(receipt,selected,target);assert.ok(offer);assert.equal(selectionCurrent(offer,snap,'account',selected),true);assert.deepEqual(offer.options.map(row=>row.artist),['Playliste','Playliste']);
 for(const artist of ['', 'Spotify', 'Kildens ejer']){const changed=structuredClone(receipt);changed.options[0].artist=artist;assert.equal(selectionOffer(changed,selected,target),null,'type copy must match the source identity');}
 assert.equal(collectionSample({...body(),candidateSet:context()},'account','account_playlists',snap),null,'ordinary track/theme parser is not broadened');
});
test('account selection becomes unavailable on scope, read/control capability or deadline loss',()=>{
 const snap=snapshot(),source=accountPlaylistsSample({...body(),candidateSet:context()},'account',snap),selected=collectionSelection(source,[0]),offer=selectionOffer(offered(selected),selected,target);
 for(const change of [{bootId:'next'},{roomId:'other'},{capabilities:{musicRead:['account_playlists'],musicSelection:false}},{capabilities:{musicRead:['top'],musicSelection:true}}]){const current={...snap,...change};assert.equal(collectionCurrent(source,current,'account'),false);assert.equal(selectionCurrent(offer,current,'account',selected),false);}
 assert.equal(collectionCurrent(source,snap,'other'),false);assert.equal(selectionCurrent(offer,snap,'other',selected),false);
 for(const change of [{expiresAt:Date.now()-1},{ownerEpoch:''},{coverage:'all'},{sourceHasMore:null},{context:{...source.context,sourceKind:'top'}},{context:{...source.context,query:'top:collection'}}]){const stale={...selected,...change};assert.equal(collectionCurrent(stale,snap,'account'),false);assert.equal(selectionCurrent(offer,snap,'account',stale),false);}
 const unpaired=accountPlaylistsSample(body(),'account',snap);assert.equal(collectionCurrent(unpaired,snap,'account'),false);assert.equal(collectionSelection(unpaired,[0]),null);assert.equal(selectionCurrent(offer,snap,'account',unpaired),false);
 const expiredOffer={...offer,expiresAt:Date.now()-1};assert.equal(selectionCurrent(expiredOffer,snap,'account',selected),false);
});
test('renewal retains exact URI, source name, playlist type and cover while replacing opaque occurrence IDs',()=>{
 const snap=snapshot(),source=accountPlaylistsSample({...body(),candidateSet:context()},'account',snap),cards=[source.tracks[1],source.tracks[0]].map(row=>({uri:row.uri,title:row.name,description:'Playliste',sourceName:row.name,sourceArtist:'Playliste',sourceArtwork:row.artwork}));
 const next=context();next.candidateSetId='b'.repeat(64);next.items=next.items.map((row,index)=>({...row,id:String(index+20).padStart(24,'0')}));
 const fresh=accountPlaylistsSample({...body(),candidateSet:next},'account',snap),renewed=renewCollectionSelection(fresh,cards);assert.ok(renewed);assert.equal(renewed.context.candidateSetId,next.candidateSetId);assert.deepEqual(renewed.candidateIds,[next.items[1].id,next.items[0].id]);assert.equal(selectionCurrent(selectionOffer(offered(renewed),renewed,target),snap,'account',renewed),true);
 for(const change of [{sourceArtist:'Spotify'},{sourceName:'Changed'},{uri:uri(8)},{sourceArtwork:{...art,url:'https://i.scdn.co/image/anothercover'}}]){const changed=structuredClone(cards);Object.assign(changed[1],change);assert.equal(renewCollectionSelection(fresh,changed),null,JSON.stringify(change));}
 assert.equal(renewCollectionSelection(accountPlaylistsSample(body(),'account',snap),cards),null);
});
test('answer-owned account candidates retain existing answer and voice revision fences',()=>{
 const c={...context(),revisionScope:'answer_task'},snap=snapshot();snap.voice.sessionId=c.sessionId;snap.answers=Object.fromEntries(['sessionId','turnId','taskId','inputRevision','revision'].map(key=>[key,c[key]]));
 const source=accountPlaylistsSample({...body(),candidateSet:c},'account',snap),selected=collectionSelection(source,[0]),offer=selectionOffer(offered(selected),selected,target);assert.equal(collectionCurrent(source,snap,'account'),true);assert.equal(selectionCurrent(offer,snap,'account',selected),true);
 for(const key of ['sessionId','turnId','taskId','inputRevision','revision']){const stale=structuredClone(snap);stale.answers[key]=typeof stale.answers[key]==='number'?stale.answers[key]+1:'next';assert.equal(collectionCurrent(source,stale,'account'),false,key);assert.equal(selectionCurrent(offer,stale,'account',selected),false,key);}
 assert.equal(selectionCurrent(offer,{...snap,voice:{sessionId:'next'}},'account',selected),false);
});
