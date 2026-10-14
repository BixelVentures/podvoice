import {visualFamilies,validateVisualContent} from './visual-content.js';
// Proposed PodView boundary. No network, credentials, provider session or device dispatch here.
import {widgetCatalog} from './ui/library/catalog.js';
const families=new Set(widgetCatalog.map(c=>c.id));
const nonempty=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const integer=x=>Number.isSafeInteger(x)&&x>=1;
export function validateVisualSnapshot(raw,now=Date.now()){
 if(!raw||raw.protocol_version!==1||!['room_id','display_id','session_id','scene_id','task_owner_id'].every(k=>nonempty(raw[k]))||!integer(raw.revision)||!Number.isFinite(raw.expires_at)||raw.expires_at<=now||!Array.isArray(raw.widgets)||raw.widgets.length>30)throw new Error('Invalid or expired visual snapshot');
 const ids=new Set();for(const w of raw.widgets){if(!w||!nonempty(w.id)||ids.has(w.id)||!families.has(w.family)||!nonempty(w.task_id)||!integer(w.revision)||!Array.isArray(w.allowed_actions)||!w.allowed_actions.every(nonempty)||new Set(w.allowed_actions).size!==w.allowed_actions.length)throw new Error('Invalid widget identity or action catalogue');ids.add(w.id);if(visualFamilies.includes(w.family)){validateVisualContent(w.family,w.content);if(w.allowed_actions.length)throw new Error('Visual content is read-only');}const optionIds=new Set();for(const o of w.options||[]){if(!nonempty(o.id)||optionIds.has(o.id))throw new Error('Invalid option IDs');optionIds.add(o.id);}if(w.family==='data-chart'&&(!nonempty(w.unit)||!Array.isArray(w.values)||!w.values.every(v=>Number.isFinite(v.value))))throw new Error('Chart requires numeric values and a unit');if(w.sources&&!w.sources.every(s=>{try{const u=new URL(s.url);return ['http:','https:'].includes(u.protocol)&&nonempty(s.label);}catch{return false;}}))throw new Error('Unsafe source link');}
 const clean=structuredClone(raw);for(const w of clean.widgets)if(visualFamilies.includes(w.family))w.content=validateVisualContent(w.family,w.content);return clean;
}
export function initialVisualConnection(){return {snapshot:null,connected:false,generation:0,pending:{},completed:[]};}
export function visualConnectionTransition(s,e){
 switch(e.type){
 case 'disconnect':return {...s,completed:[...new Set([...s.completed,...Object.keys(s.pending)])],connected:false,generation:s.generation+1,pending:Object.fromEntries(Object.entries(s.pending).map(([id,p])=>[id,{...p,outcome:'unknown'}]))};
 case 'snapshot':{if(e.generation!==s.generation)return s;let snapshot;try{snapshot=validateVisualSnapshot(e.snapshot,e.now);}catch{return s;}if(s.connected&&s.snapshot?.session_id===snapshot.session_id&&snapshot.revision<=s.snapshot.revision)return s;return {...s,connected:true,snapshot,pending:{}};}
 case 'request':{const snap=s.snapshot,a=e.action;if(!Number.isFinite(e.now)||!s.connected||!snap||snap.expires_at<=e.now||!a||!nonempty(a.request_id)||s.pending[a.request_id]||s.completed.includes(a.request_id)||a.session_id!==snap.session_id||a.scene_id!==snap.scene_id||a.scene_revision!==snap.revision||a.display_id!==snap.display_id)return s;const w=snap.widgets.find(w=>w.id===a.widget_id);if(!w||a.task_id!==w.task_id||a.revision!==w.revision||!w.allowed_actions.includes(a.action_id)||a.option_id!=null&&!(w.options||[]).some(o=>o.id===a.option_id))return s;return {...s,completed:[...s.completed,a.request_id],pending:{...s.pending,[a.request_id]:{action:structuredClone(a),outcome:'requested',generation:s.generation}}};}
 case 'receipt':{const p=s.pending[e.request_id];if(!s.connected||!p||p.generation!==s.generation||e.generation!==s.generation||e.session_id!==p.action.session_id||e.task_id!==p.action.task_id||e.revision!==p.action.revision)return s;const ranks={requested:0,accepted:1,executed:2,verified:3};if(!['accepted','executed','verified','failed','unknown'].includes(e.outcome)||['failed','unknown','verified'].includes(p.outcome)||ranks[e.outcome]!=null&&ranks[e.outcome]<=ranks[p.outcome])return s;return {...s,pending:{...s.pending,[e.request_id]:{...p,outcome:e.outcome}},completed:['verified','failed','unknown'].includes(e.outcome)?[...new Set([...s.completed,e.request_id])]:s.completed};}
 default:return s;
 }
}
