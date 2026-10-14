export const PLAYLISTS = [
 {id:'smooth-jazz',name:'Smooth Jazz',description:'Behagelig stemning',detail:'',art:'kitchen.png',jazz:true,instrumental:true},
 {id:'italian-favorites',name:'Italienske favoritter',description:'Pop · Klassikere · God madstemning',detail:'',art:'italian.png',jazz:false,instrumental:false},
 {id:'relaxed-indie',name:'Afslappet indie',description:'Rolig pop · Let og luftig',detail:'',art:'indie.png',jazz:false,instrumental:false},
];
export const TRACKS=[{id:'soft-light',title:'Soft Light',artist:'North',art:'lake.png'},{id:'evening-kitchen',title:'Evening Kitchen',artist:'Juniper',art:'kitchen.png'},{id:'slow-sunday',title:'Slow Sunday',artist:'The Quiet Hours',art:'indie.png'}];
// Local fixtures follow the typed PodConnect target contract; these are not discovered devices.
export const TARGETS=[
 {accountId:'household',kind:'configured_alias',targetId:'living-room',name:'Stuen',detail:'HomePod · Klar',available:true},
 {accountId:'household',kind:'configured_alias',targetId:'kitchen',name:'Køkkenet',detail:'HomePod · Klar',available:true},
 {accountId:'household',kind:'spotify_device',targetId:'office',name:'Kontoret',detail:'Ikke tilgængelig',available:false},
];
export const COLLECTIONS={mood:{title:'Hvad er stemningen i køkkenet?',description:'Lidt jazz, italienske klassikere eller rolig indie?'},top:{title:'Dine topsange',description:'Et udvalg fra din tilsluttede Spotify-konto.'},recent:{title:'Senest spillet',description:'Find tilbage til noget, du har hørt.'},liked:{title:'Sange, du har liket',description:'Et udvalg af dine gemte sange.'}};
export const MUSIC_OPTIONS=[...PLAYLISTS,...['top','recent','liked'].flatMap(collection=>[...TRACKS].map((t,i)=>({id:`${collection}:${t.id}`,name:t.title,description:t.artist,art:t.art,detail:'',collection,track:i})))];
export function initialWidgetState(){return {revision:1,filter:'all',collection:'mood',collapsed:false,playback:{active:true,track:0,room:'Stuen',accountId:'household',kind:'configured_alias',targetId:'living-room',playing:true,volume:45},pending:null,operation:0,message:''};}
export const resultsFor=s=>s.collection==='mood'||!s.collection?PLAYLISTS.filter(p=>s.filter==='all'||p[s.filter]):MUSIC_OPTIONS.filter(p=>p.collection===s.collection);
export function widgetTransition(s,e){
 switch(e.type){
  case 'collection':return Object.hasOwn(COLLECTIONS,e.value)?{...s,collection:e.value,filter:'all',revision:s.revision+1,message:''}:s;
  case 'clear-playback':return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,active:false,playing:false},message:''};
  case 'filter': if(!['all','jazz','instrumental'].includes(e.value))return s;return {...s,filter:s.filter===e.value?'all':e.value,revision:s.revision+1,message:''};
  case 'collapse':return {...s,collapsed:!s.collapsed};
  case 'select':{const choice=resultsFor(s).find(p=>p.id===e.id);if(e.revision!==s.revision||!choice||s.pending)return s;const operation=s.operation+1;const track=choice.track??PLAYLISTS.findIndex(p=>p.id===e.id);return {...s,operation,pending:{operation,id:e.id,room:s.playback.room,accountId:s.playback.accountId,kind:s.playback.kind,targetId:s.playback.targetId,track,art:TRACKS[track].art,playing:true,active:true},message:`Starter i ${s.playback.room.toLowerCase()}…`};}
  case 'target':{const t=TARGETS.find(t=>t.accountId===e.accountId&&t.kind===e.kind&&t.targetId===e.targetId);if(!t?.available||e.revision!==s.revision||!s.playback.active)return s;const operation=s.operation+1;return {...s,operation,pending:{...s.playback,operation,room:t.name,accountId:t.accountId,kind:t.kind,targetId:t.targetId},message:`Flytter til ${t.name.toLowerCase()}…`};}
  case 'receipt':if(!s.pending||e.operation!==s.pending.operation)return s;return {...s,pending:null,playback:{...s.playback,room:s.pending.room,accountId:s.pending.accountId,kind:s.pending.kind,targetId:s.pending.targetId,track:s.pending.track,art:s.pending.art,playing:s.pending.playing,active:s.pending.active},message:''};
  case 'toggle':if(!s.playback.active)return s;return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,playing:!s.playback.playing},message:''};
  case 'skip':if(!s.playback.active)return s;return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,art:undefined,track:(s.playback.track+(e.delta<0?-1:1)+TRACKS.length)%TRACKS.length},message:''};
  case 'queue-select':{const index=TRACKS.findIndex(t=>t.id===e.id);if(e.revision!==s.revision||index<0)return s;return {...s,pending:null,operation:s.operation+1,playback:{...s.playback,track:index,art:TRACKS[index].art,playing:true,active:true},message:''};}
  case 'volume':{const value=Number(e.value);return Number.isFinite(value)?{...s,playback:{...s.playback,volume:Math.max(0,Math.min(100,value))}}:s;}
  default:return s;
 }
}
