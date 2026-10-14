import {validateVisualContent} from './visual-content.js';
const text=(v,n=160)=>typeof v==='string'&&v.length>0&&v.length<=n;
const receipt=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
function provenance(v,now){
 if(v?.kind==='tool_result')return {kind:v.kind};
 if(v?.kind!=='ha_weather'||!text(v.source,120)||!Number.isFinite(Date.parse(v.retrievedAt))||!Number.isFinite(Date.parse(v.stateUpdatedAt))||!Number.isFinite(v.validUntil))throw Error('invalid_source_provenance');
 const retrieved=Date.parse(v.retrievedAt),updated=Date.parse(v.stateUpdatedAt);if(retrieved>now+5000||updated>now+5000||v.validUntil*1000<=now||v.validUntil*1000>Math.min(retrieved+900000,updated+7200000))throw Error('expired_weather_source');
 return {kind:v.kind,source:v.source,retrievedAt:v.retrievedAt,stateUpdatedAt:v.stateUpdatedAt,validUntil:v.validUntil};
}
// A source receipt is an opaque read reference. It never authorizes an action.
export function ownedAnswers(value,snapshot,previousRevision=0,now=Date.now()){
 if(value?.schema!=='podview.answers.v1'||value.roomId!==snapshot.roomId||!Number.isInteger(value.revision)||value.revision<previousRevision||value.revision!==snapshot.answers?.revision||!Array.isArray(value.items)||value.items.length>3)throw Error('invalid_owned_answers');
 const seen=new Set();const items=value.items.map(row=>{
  if(!receipt(row.receiptId)||seen.has(row.receiptId)||!text(row.sessionId)||row.sessionId!==snapshot.voice.sessionId||row.sessionId!==snapshot.answers.sessionId||!text(row.turnId)||row.turnId!==snapshot.answers.turnId||!text(row.taskId)||row.taskId!==snapshot.answers.taskId||row.inputRevision!==snapshot.answers.inputRevision||!Number.isInteger(row.inputRevision)||row.inputRevision<0||!Number.isFinite(row.observedAt)||row.observedAt*1000>now+5000||row.observedAt*1000<now-120000||row.family!=='fact-card'||typeof row.displaySuggested!=='boolean')throw Error('invalid_owned_answer');
  seen.add(row.receiptId);if(!Array.isArray(row.content?.sources)||row.content.sources.some(s=>s.kind!=='owner_receipt'||s.receiptId!==row.receiptId))throw Error('unbound_source_receipt');
  const sourceProvenance=provenance(row.provenance,now);const content=validateVisualContent(row.family,row.content,{ownerReceiptIds:[row.receiptId]});
  return {id:'receipt:'+row.receiptId,receiptId:row.receiptId,sessionId:row.sessionId,turnId:row.turnId,taskId:row.taskId,inputRevision:row.inputRevision,revision:value.revision,observedAt:row.observedAt,kind:row.family,title:'Svar fra PodVoice',meta:new Date(row.observedAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),status:'ready',live:true,hidden:false,displaySuggested:row.displaySuggested,content,ownerReceiptIds:[row.receiptId],provenance:sourceProvenance};
 });return {revision:value.revision,items};
}
export function ownedSource(value,id,now=Date.now()){
 if(!receipt(id)||value?.schema!=='podview.source.v1'||value.kind!=='owner_receipt'||value.receiptId!==id||value.externalSourcesProvided!==false||!text(value.toolName)||!text(value.summary,600)||!Number.isFinite(value.observedAt)||value.observedAt*1000<now-120000||value.observedAt*1000>now+5000||!Array.isArray(value.facts)||!value.facts.length||value.facts.length>6)throw Error('invalid_owned_source');
 const seen=new Set();const facts=value.facts.map(row=>{if(!text(row.id,80)||seen.has(row.id)||!text(row.label,80)||!text(row.value,80)||!text(row.detail,200))throw Error('invalid_source_fact');seen.add(row.id);return {id:row.id,label:row.label,value:row.value,detail:row.detail};});return {provenance:provenance(value.provenance,now),receiptId:id,toolName:value.toolName,summary:value.summary,observedAt:value.observedAt,facts};
}
