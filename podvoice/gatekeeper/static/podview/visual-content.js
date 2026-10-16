import {spotifyArtwork} from './spotify-artwork.js';
// Read-only visual payloads. This validates shape, not the truth of source data.
export const visualFamilies = ['fact-card','sourced-image','answer-timeline','simple-diagram'];
const string = (value, max = 300) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const fail = () => { throw new Error('Invalid visual content'); };
function link(value, image = false) {
 if (!string(value, 2048) || /[\s\\]/.test(value)) return false;
 // Relative content must be an app-owned asset or an explicit local source page.
 if (image && /^assets\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$/.test(value) && !value.includes('..')) return true;
 if (!image && value === 'example-sources.html') return true;
 try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
function rows(items, max, check) {
 if (!Array.isArray(items) || !items.length || items.length > max) fail();
 const ids = new Set();
 for (const item of items) {
  if (!item || !string(item.id, 80) || ids.has(item.id) || !check(item)) fail();
  ids.add(item.id);
 }
}
function validateSources(raw,{ownerReceiptIds=[],allowConversation=false}={}){
 rows(raw,4,s=>string(s.label,120)&&(s.kind==='owner_receipt'?/^[a-f0-9]{32}$/.test(s.receiptId)&&ownerReceiptIds.includes(s.receiptId)&&(s.scope==='tool_result'||allowConversation&&s.scope==='conversation_answer'):link(s.url)&&string(s.scope,240)));
 return raw.map(s=>s.kind==='owner_receipt'?{id:s.id,label:s.label,kind:'owner_receipt',receiptId:s.receiptId,scope:s.scope}:{id:s.id,label:s.label,url:s.url,scope:s.scope});
}
export function validateVisualContent(family, raw, {ownerReceiptIds=[],allowConversation=false}={}) {
 if (!visualFamilies.includes(family) || !raw || !string(raw.summary, 600)) fail();
 const sources=validateSources(raw.sources,{ownerReceiptIds,allowConversation});
 const sourceIds = new Set(raw.sources.map(s => s.id));
 const sourced = x => sourceIds.has(x.sourceId);
 if (family === 'fact-card') rows(raw.facts, 6, f => string(f.label, 80) && string(f.value, 80) && string(f.detail, 200) && sourced(f));
 if (family === 'sourced-image' && (!link(raw.image?.url, true) || !string(raw.image?.alt, 300) || !string(raw.image?.caption, 300) || !string(raw.image?.credit, 160) || !['photo','illustration','album_cover'].includes(raw.image?.kind) || raw.image.kind==='album_cover'&&(raw.image.credit!=='Spotify'||!spotifyArtwork({kind:'album_cover',provider:'spotify',url:raw.image.url})) || !sourced(raw.image))) fail();
 if (family === 'answer-timeline') rows(raw.events, 8, e => string(e.time, 80) && string(e.label, 120) && string(e.detail, 240) && ['planned','observed'].includes(e.status) && sourced(e));
 if (family === 'simple-diagram') {
  rows(raw.nodes, 5, n => string(n.label, 80) && string(n.detail, 200) && sourced(n));
  // Optional explanatory art uses the same bounded source contract as an image answer.
  // It never accepts model HTML, labels positioned through CSS, or new actions.
  const art=raw.illustration;
  if(art && (!link(art.url,true)||!string(art.alt,300)||!string(art.caption,300)||!string(art.credit,160)||art.kind!=='illustration'||!sourced(art))) fail();
 }
 // Return a closed shape: model-supplied HTML/styles/actions never enter the renderer.
 const result = {summary: raw.summary, sources};
 if (family === 'fact-card') result.facts = raw.facts.map(({id,label,value,detail,sourceId}) => ({id,label,value,detail,sourceId}));
 if (family === 'sourced-image') { const {url,alt,caption,credit,kind,sourceId} = raw.image; result.image = {url,alt,caption,credit,kind,sourceId}; }
 if (family === 'answer-timeline') result.events = raw.events.map(({id,time,label,detail,status,sourceId}) => ({id,time,label,detail,status,sourceId}));
 if (family === 'simple-diagram') {
  result.nodes = raw.nodes.map(({id,label,detail,sourceId}) => ({id,label,detail,sourceId}));
  if(raw.illustration){const {url,alt,caption,credit,kind,sourceId}=raw.illustration;result.illustration={url,alt,caption,credit,kind,sourceId};}
 }
 return result;
}

// Six existing canonical presentation forms. No raw model HTML, styles or effects.
export const typedAnswerFamilies=['concise','choices','comparison','chart','steps','checklist'];
export function validateTypedAnswerContent(family,raw,options={}){
 if(!typedAnswerFamilies.includes(family)||!raw||!string(raw.summary,600))fail();
 const sources=validateSources(raw.sources,options),sourceIds=new Set(sources.map(source=>source.id)),sourced=row=>sourceIds.has(row.sourceId);
 const result={summary:raw.summary,sources};
 const allowed={concise:[],choices:['items'],comparison:['columns','items'],chart:['unit','unitSingular','items'],steps:['steps'],checklist:['items']}[family];
 if(Object.keys(raw).some(key=>!['summary','sources',...allowed].includes(key)))fail();
 if(family==='concise')return result;
 if(family==='comparison'){
  rows(raw.columns,3,column=>string(column.label,80));
  rows(raw.items,6,row=>string(row.label,80)&&Array.isArray(row.values)&&row.values.length===raw.columns.length&&row.values.every(value=>string(value,80))&&sourced(row));
  result.columns=raw.columns.map(({id,label})=>({id,label}));result.items=raw.items.map(({id,label,values,sourceId})=>({id,label,values:[...values],sourceId}));
 }else if(family==='chart'){
  if(!string(raw.unit,24)||!string(raw.unitSingular,24))fail();
  rows(raw.items,8,row=>string(row.label,80)&&Number.isFinite(row.value)&&row.value>=-1e9&&row.value<=1e9&&sourced(row));
  result.unit=raw.unit;result.unitSingular=raw.unitSingular;result.items=raw.items.map(({id,label,value,sourceId})=>({id,label,value,sourceId}));
 }else if(family==='steps'){
  rows(raw.steps,12,row=>string(row.text,300)&&sourced(row));result.steps=raw.steps.map(({id,text,sourceId})=>({id,text,sourceId}));
 }else if(family==='checklist'){
  rows(raw.items,12,row=>string(row.label,160)&&typeof row.checked==='boolean'&&sourced(row));result.items=raw.items.map(({id,label,checked,sourceId})=>({id,label,checked,sourceId}));
 }else{
  rows(raw.items,6,row=>string(row.label,80)&&string(row.detail,200)&&sourced(row));result.items=raw.items.map(({id,label,detail,sourceId})=>({id,label,detail,sourceId}));
 }
 return result;
}
