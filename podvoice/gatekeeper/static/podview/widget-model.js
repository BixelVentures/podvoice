import {MUSIC_FIXTURE,MOCK_PLAYBACK_POLICY} from './music-fixture.js';
export const PLAYLISTS = [
 {id:'smooth-jazz',name:'Smooth Jazz',description:'Behagelig stemning',detail:'',track:7,art:'kitchen.png',jazz:true,instrumental:true},
 {id:'italian-favorites',name:'Italienske favoritter',description:'Pop · Klassikere · God madstemning',detail:'',track:8,art:'italian.png',jazz:false,instrumental:false},
 {id:'relaxed-indie',name:'Afslappet indie',description:'Rolig pop · Let og luftig',detail:'',track:1,art:'indie.png',jazz:false,instrumental:false},
 {id:'feel-good',name:'Lidt mere energi',description:'Funk · Godt humør',detail:'',track:6,art:'kitchen.png'},
 {id:'pop-kitchen',name:'Pop til køkkenet',description:'Velkendte sange · Syng med',detail:'',track:3,art:'indie.png'},
 {id:'quiet-evening',name:'Rolig aften',description:'Bløde toner · Lavt tempo',detail:'',track:5,art:'lake.png'},
];
// Subjective choices in the local demonstration, never inferred emotional state.
export const FEELING_PLAYLISTS=[
 {id:'feeling:energy',name:'Mere energi',description:'Funk · Lyst og levende',detail:'',track:6,art:'indie.png'},
 {id:'feeling:calm',name:'Helt ned i tempo',description:'Bløde toner · God tid',detail:'',track:7,art:'lake.png'},
 {id:'feeling:familiar',name:'Noget velkendt',description:'Favoritter · Syng med',detail:'',track:8,art:'italian.png'},
 {id:'feeling:sing',name:'Syng med',description:'Pop · Omkvæd du kender',detail:'',track:3,art:'indie.png'},
 {id:'feeling:soft',name:'Bløde toner',description:'Roligt · Akustisk',detail:'',track:5,art:'lake.png'},
 {id:'feeling:bright',name:'Et lyst øjeblik',description:'Let · God energi',detail:'',track:1,art:'kitchen.png'},
];
export const TRACKS=MUSIC_FIXTURE;
// Synthetic position for the local interaction example, not a track duration claim.
export const LOCAL_POSITION_EXAMPLE=Object.freeze({durationMs:180000,progressMs:84000});
export const musicArtwork=art=>art.startsWith('https://')?art:`assets/${art}`;
// Account collection membership is an explicit local scenario, never a claim about the user's account.
const COLLECTION_TRACKS={top:[0,1,2,3,4,5,6],recent:[1,3,5,0,2,4,6]};
// Local fixtures follow the typed PodConnect target contract; these are not discovered devices.
export const TARGETS=[
 {accountId:'household',kind:'configured_alias',targetId:'living-room',name:'Stuen',detail:'HomePod · Klar',available:true},
 {accountId:'household',kind:'configured_alias',targetId:'kitchen',name:'Køkkenet',detail:'HomePod · Klar',available:true},
 {accountId:'household',kind:'spotify_device',targetId:'office',name:'Kontoret',detail:'Ikke tilgængelig',available:false},
];
export const COLLECTIONS={mood:{title:'Hvad er stemningen?',description:'Lidt jazz, italienske klassikere eller rolig indie?'},feeling:{title:'Hvad har du lyst til at høre?',description:'Mere energi, noget roligt eller velkendte toner?'},top:{title:'For dig',description:'Dine topsange'},recent:{title:'Senest spillet',description:'Find tilbage til noget, du har hørt.'}};
export const MUSIC_OPTIONS=[...PLAYLISTS,...FEELING_PLAYLISTS,...['top','recent'].flatMap(collection=>[...TRACKS].map((t,i)=>({id:`${collection}:${t.id}`,name:t.title,description:t.artist,art:t.art,detail:'',collection,track:i})))];
export function initialWidgetState(){return {revision:1,filter:'all',collection:'mood',suggestionPage:0,collectionPages:{mood:0},refreshPending:null,refreshStatus:'',refreshSerial:0,collapsed:false,playback:{active:true,track:0,progressMs:LOCAL_POSITION_EXAMPLE.progressMs,room:'Stuen',accountId:'household',kind:'configured_alias',targetId:'living-room',playing:true,volume:MOCK_PLAYBACK_POLICY.startVolumePercent},pending:null,operation:0,message:''};}
export function musicRefreshFeedback(s){return s.refreshPending?'':s.refreshStatus==='error'?'Kunne ikke opdatere · prøv igen':s.refreshStatus==='empty'?'Ingen nye forslag · viser seneste udvalg':'';}
export function resultsFor(s){
 const pool=s.collection==='mood'||!s.collection?PLAYLISTS.filter(p=>s.filter==='all'||p[s.filter]):s.collection==='feeling'?FEELING_PLAYLISTS:(COLLECTION_TRACKS[s.collection]||[]).map(index=>MUSIC_OPTIONS.find(p=>p.collection===s.collection&&p.track===index));
 const start=((s.suggestionPage||0)*3)%Math.max(1,pool.length);
 return Array.from({length:Math.min(3,pool.length)},(_,i)=>pool[(start+i)%pool.length]);
}
export function widgetTransition(s,e){
 switch(e.type){
  case 'collection':return Object.hasOwn(COLLECTIONS,e.value)?{...s,collection:e.value,suggestionPage:s.collectionPages?.[e.value]||0,collectionPages:{...s.collectionPages,[s.collection]:s.suggestionPage||0},filter:'all',revision:s.revision+1,refreshPending:null,refreshStatus:'',message:''}:s;
  case 'refresh':{if(s.pending||s.refreshPending||e.revision!==s.revision)return s;const revision=s.revision+1,requestId=(s.refreshSerial||0)+1;return {...s,revision,refreshSerial:requestId,refreshPending:{requestId,revision,collection:s.collection,page:(s.suggestionPage||0)+1},refreshStatus:'',message:''};}
  case 'refresh-result':{const p=s.refreshPending;if(!p||e.requestId!==p.requestId||e.revision!==p.revision||s.revision!==p.revision||s.collection!==p.collection||!['ready','error','empty'].includes(e.status))return s;return {...s,refreshPending:null,refreshStatus:e.status==='ready'?'':e.status,suggestionPage:e.status==='ready'?p.page:s.suggestionPage,collectionPages:e.status==='ready'?{...s.collectionPages,[s.collection]:p.page}:s.collectionPages,revision:s.revision+1};}
  case 'refresh-cancel':return s.refreshPending?{...s,refreshPending:null,refreshStatus:'',revision:s.revision+1}:s;
  case 'clear-playback':return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,active:false,playing:false},message:''};
  // Legacy hidden filter events cannot silently replace already displayed choices.
  case 'filter':return s;
  case 'collapse':return {...s,collapsed:!s.collapsed};
  case 'select':{const choice=resultsFor(s).find(p=>p.id===e.id);if(e.revision!==s.revision||!choice||s.pending||s.refreshPending)return s;const operation=s.operation+1;const track=choice.track??PLAYLISTS.findIndex(p=>p.id===e.id);return {...s,operation,pending:{operation,id:e.id,room:s.playback.room,accountId:s.playback.accountId,kind:s.playback.kind,targetId:s.playback.targetId,track,art:TRACKS[track].art,playing:true,active:true,volume:MOCK_PLAYBACK_POLICY.startVolumePercent},message:''};}
  case 'target':{const t=TARGETS.find(t=>t.accountId===e.accountId&&t.kind===e.kind&&t.targetId===e.targetId);if(!t?.available||e.revision!==s.revision)return s;if(!s.playback.active){if(s.pending)return s;if(s.playback.accountId===t.accountId&&s.playback.kind===t.kind&&s.playback.targetId===t.targetId)return s;return {...s,playback:{...s.playback,room:t.name,accountId:t.accountId,kind:t.kind,targetId:t.targetId},message:''};}const operation=s.operation+1;return {...s,operation,pending:{...s.playback,operation,room:t.name,accountId:t.accountId,kind:t.kind,targetId:t.targetId},message:''};}
  case 'receipt':if(!s.pending||e.operation!==s.pending.operation)return s;return {...s,pending:null,playback:{...s.playback,room:s.pending.room,accountId:s.pending.accountId,kind:s.pending.kind,targetId:s.pending.targetId,track:s.pending.track,progressMs:s.pending.id?0:s.playback.progressMs,art:s.pending.art,volume:s.pending.volume??s.playback.volume,playing:s.pending.playing,active:s.pending.active},message:''};
  case 'toggle':if(!s.playback.active)return s;return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,playing:!s.playback.playing},message:''};
  case 'skip':{if(!s.playback.active)return s;const order=s.queueOrder||TRACKS.map(t=>t.id),position=order.indexOf(TRACKS[s.playback.track].id),id=order[(position+(e.delta<0?-1:1)+order.length)%order.length];return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,art:undefined,progressMs:0,track:TRACKS.findIndex(t=>t.id===id)},message:''};}
  case 'queue-reorder':{const base=s.queueOrder||TRACKS.map(t=>t.id),current=TRACKS[s.playback.track]?.id,start=base.indexOf(current),ids=[...base.slice(start),...base.slice(0,start)];if(s.pending||e.revision!==s.revision||e.id===current||e.beforeId===current||e.id===e.beforeId||!ids.includes(e.id)||e.beforeId!==null&&!ids.includes(e.beforeId))return s;const order=ids.filter(id=>id!==e.id),at=e.beforeId===null?order.length:order.indexOf(e.beforeId);order.splice(at,0,e.id);if(order.every((id,i)=>id===ids[i]))return s;return {...s,queueOrder:order,revision:s.revision+1};}
  case 'queue-select':{const index=TRACKS.findIndex(t=>t.id===e.id);if(e.revision!==s.revision||index<0||index===s.playback.track&&s.playback.active)return s;return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,track:index,progressMs:0,art:TRACKS[index].art,playing:true,active:true},message:''};}
  case 'seek':{if(!s.playback.active||s.pending||e.trackId!==TRACKS[s.playback.track]?.id||e.operation!==s.operation||!Number.isSafeInteger(e.positionMs)||e.positionMs<0||e.positionMs>LOCAL_POSITION_EXAMPLE.durationMs||e.positionMs===s.playback.progressMs)return s;return {...s,playback:{...s.playback,progressMs:e.positionMs}};}
  case 'volume':{const value=Number(e.value);return Number.isFinite(value)?{...s,playback:{...s.playback,volume:Math.max(0,Math.min(100,value))}}:s;}
  default:return s;
 }
}
