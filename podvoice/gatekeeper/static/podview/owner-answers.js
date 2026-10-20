import {validateVisualContent,validateTypedAnswerContent,visualFamilies,typedAnswerFamilies} from './visual-content.js';
import {researchAnswer} from './research-answers.js';
const text=(v,n=160)=>typeof v==='string'&&v.length>0&&v.length<=n;
const receipt=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
function provenance(v,now){
 if(v?.kind==='tool_result')return {kind:v.kind};
 if(v?.kind!=='ha_weather'||!text(v.source,120)||!Number.isFinite(Date.parse(v.retrievedAt))||!Number.isFinite(Date.parse(v.stateUpdatedAt))||!Number.isFinite(v.validUntil))throw Error('invalid_source_provenance');
 const retrieved=Date.parse(v.retrievedAt),updated=Date.parse(v.stateUpdatedAt);if(retrieved>now+5000||updated>now+5000||v.validUntil*1000<=now||v.validUntil*1000>Math.min(retrieved+900000,updated+7200000))throw Error('expired_weather_source');
 return {kind:v.kind,source:v.source,retrievedAt:v.retrievedAt,stateUpdatedAt:v.stateUpdatedAt,validUntil:v.validUntil};
}
export function answerSession(snapshot){const id=snapshot?.answers?.sessionId;if(!text(id))return null;if(snapshot.answers.readOnlyCompleted===true)return snapshot.voice?.active===false&&snapshot.voice.sessionId===null?id:null;return snapshot.voice?.sessionId===id?id:null;}
// A source receipt is an opaque read reference. It never authorizes an action.
export function presentationAnswer(row,context,now=Date.now()){
 const fields=['roomId','sessionId','turnId','taskId'];
 if(row?.schema!=='podview.presentation.v1'||!fields.every(key=>text(row[key])&&row[key]===context[key])||!['inputRevision','answerRevision','providerGeneration'].every(key=>Number.isSafeInteger(row[key])&&row[key]>=0&&row[key]===context[key])||!Number.isFinite(row.sessionEpoch)||row.sessionEpoch!==context.sessionEpoch||!receipt(row.receiptId)||!Number.isFinite(row.observedAt)||row.observedAt*1000>now+5000||row.observedAt*1000<now-120000||!Number.isFinite(row.validUntil)||row.validUntil*1000<=now||row.validUntil>row.observedAt+120||row.displaySuggested!==true||!Array.isArray(row.allowedActions)||row.allowedActions.length||!text(row.title,160)||![...visualFamilies,...typedAnswerFamilies].includes(row.family))throw Error('invalid_presentation_binding');
 const p=row.provenance,ai=p?.kind==='ai_explanation';
 if(ai){if(Object.keys(p).length!==1||['fact-card','chart'].includes(row.family)||row.family==='answer-timeline'&&row.content?.events?.some(event=>event.status!=='planned')||row.family==='checklist'&&row.content?.items?.some(item=>item.checked!==false))throw Error('invalid_explanation_provenance');const art=row.family==='sourced-image'?row.content?.image:row.content?.illustration;if(art&&(art.url!=='assets/bicycle-drivetrain-illustration.webp'||art.kind!=='illustration'))throw Error('unadmitted_explanation_image');}
 else if(p?.kind!=='owner_sources'||Object.keys(p).some(key=>!['kind','receiptIds'].includes(key))||!Array.isArray(p.receiptIds)||!p.receiptIds.length||p.receiptIds.length>8||p.receiptIds.some(id=>!receipt(id)||id===row.receiptId)||new Set(p.receiptIds).size!==p.receiptIds.length)throw Error('invalid_presentation_sources');
 if(!Array.isArray(row.content?.sources)||row.content.sources.length!==1||row.content.sources.some(source=>source.kind!=='owner_receipt'||source.receiptId!==row.receiptId||source.scope!==(ai?'conversation_answer':'tool_result')))throw Error('invalid_presentation_receipt');
 const options={ownerReceiptIds:[row.receiptId],allowConversation:ai},content=typedAnswerFamilies.includes(row.family)?validateTypedAnswerContent(row.family,row.content,options):validateVisualContent(row.family,row.content,options);
 return {id:'receipt:'+row.receiptId,kind:row.family,title:row.title,status:'ready',live:true,presentation:true,content,ownerReceiptIds:[row.receiptId],allowedActions:[],observedAt:row.observedAt,validUntil:row.validUntil,provenance:ai?{kind:'ai_explanation'}:{kind:'owner_sources',receiptIds:[...p.receiptIds]}};
}
export function ownedAnswers(value,snapshot,previousRevision=0,now=Date.now()){
 if(value?.schema!=='podview.answers.v1'||value.roomId!==snapshot.roomId||!Number.isInteger(value.revision)||value.revision<previousRevision||value.revision!==snapshot.answers?.revision||!Array.isArray(value.items)||value.items.length>3)throw Error('invalid_owned_answers');
 const seen=new Set();const items=value.items.map(row=>{
  if(!receipt(row.receiptId)||seen.has(row.receiptId)||!text(row.sessionId)||row.sessionId!==answerSession(snapshot)||row.sessionId!==snapshot.answers.sessionId||!text(row.turnId)||row.turnId!==snapshot.answers.turnId||!text(row.taskId)||row.taskId!==snapshot.answers.taskId||row.inputRevision!==snapshot.answers.inputRevision||!Number.isInteger(row.inputRevision)||row.inputRevision<0||!Number.isFinite(row.observedAt)||row.observedAt*1000>now+5000||row.observedAt*1000<now-120000||row.family!=='fact-card'&&row.schema!=='podview.research.v1'&&row.schema!=='podview.presentation.v1'||typeof row.displaySuggested!=='boolean')throw Error('invalid_owned_answer');
  seen.add(row.receiptId);if(row.schema==='podview.presentation.v1'){
   if(snapshot.capabilities?.answerRead!==true)throw Error('presentation_not_admitted');
   const parsed=presentationAnswer(row,{...snapshot.answers,roomId:snapshot.roomId},now);return {...parsed,receiptId:row.receiptId,sessionId:row.sessionId,turnId:row.turnId,taskId:row.taskId,inputRevision:row.inputRevision,revision:value.revision,meta:parsed.provenance.kind==='ai_explanation'?'AI-forklaring':'Svar fra PodVoice',hidden:false,displaySuggested:true};
  }if(row.schema==='podview.research.v1'){if(snapshot.capabilities?.researchVisual!==true)throw Error('research_not_admitted');const parsed=researchAnswer(row,{...snapshot.answers,roomId:snapshot.roomId},now);return {...parsed,receiptId:row.receiptId,sessionId:row.sessionId,turnId:row.turnId,taskId:row.taskId,inputRevision:row.inputRevision,revision:value.revision,title:'Svar fra PodVoice',meta:new Date(row.observedAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),hidden:false,displaySuggested:true};}if(!Array.isArray(row.content?.sources)||row.content.sources.some(s=>s.kind!=='owner_receipt'||s.receiptId!==row.receiptId))throw Error('unbound_source_receipt');
  const sourceProvenance=provenance(row.provenance,now);const content=validateVisualContent(row.family,row.content,{ownerReceiptIds:[row.receiptId]});
  return {id:'receipt:'+row.receiptId,receiptId:row.receiptId,sessionId:row.sessionId,turnId:row.turnId,taskId:row.taskId,inputRevision:row.inputRevision,revision:value.revision,observedAt:row.observedAt,kind:row.family,title:'Svar fra PodVoice',meta:new Date(row.observedAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),status:'ready',live:true,hidden:false,displaySuggested:row.displaySuggested,content,ownerReceiptIds:[row.receiptId],provenance:sourceProvenance};
 });
 // UI-only display binding: derive from admitted rows in this exact owner envelope,
 // never from model labels or a wire-supplied display hint. Canonical content stays raw.
 for(const answer of items){
  if(answer.presentation!==true||answer.kind!=='fact-card'||answer.provenance.kind!=='owner_sources')continue;
  const weather=items.filter(source=>answer.provenance.receiptIds.includes(source.receiptId)&&source.kind==='fact-card'&&source.provenance.kind==='ha_weather');
  answer.weatherDisplayFactIds=answer.content.facts.filter(fact=>fact.detail==='Aktuel måling'&&weather.some(source=>source.content.facts.some(original=>original.detail==='Aktuel måling'&&original.label===fact.label&&original.value===fact.value))).map(fact=>fact.id);
 }
 return {revision:value.revision,items};
}
export function ownedSource(value,id,now=Date.now(),snapshot=null){
 if(value?.schema==='podview.presentation.source.v1'){
  if(!receipt(id)||value.receiptId!==id||snapshot?.capabilities?.answerRead!==true||value.sessionId!==answerSession(snapshot))throw Error('invalid_presentation_source');
  const parsed=presentationAnswer({...value,schema:'podview.presentation.v1'},{...snapshot.answers,roomId:snapshot.roomId},now);
  if(value.sourceText!==undefined&&!text(value.sourceText,1200))throw Error('invalid_source_excerpt');
  return {receiptId:id,summary:parsed.content.summary,observedAt:parsed.observedAt,validUntil:parsed.validUntil,provenance:parsed.provenance,family:parsed.kind,facts:parsed.content.facts||[],events:parsed.content.events||[],...(value.sourceText===undefined?{}:{sourceText:value.sourceText})};
 }

 if(value?.schema==='podview.research.source.v1'){
  if(!receipt(id)||value.receiptId!==id||value.kind!=='owner_receipt'||value.externalSourcesProvided!==false||!text(value.toolName)||snapshot?.capabilities?.researchVisual!==true||value.sessionId!==answerSession(snapshot))throw Error('invalid_research_source');
  const parsed=researchAnswer({...value,schema:'podview.research.v1'},{...snapshot.answers,roomId:snapshot.roomId},now);
  if(value.sourceText!==undefined&&!text(value.sourceText,1200))throw Error('invalid_source_excerpt');
  return {receiptId:id,toolName:value.toolName,summary:parsed.content.summary,observedAt:parsed.observedAt,validUntil:parsed.validUntil,provenance:parsed.provenance,family:parsed.kind,facts:parsed.content.facts||[],events:parsed.content.events||[],...(value.sourceText===undefined?{}:{sourceText:value.sourceText})};
 }

 if(!receipt(id)||value?.schema!=='podview.source.v1'||value.kind!=='owner_receipt'||value.receiptId!==id||value.externalSourcesProvided!==false||!text(value.toolName)||!text(value.summary,600)||!Number.isFinite(value.observedAt)||value.observedAt*1000<now-120000||value.observedAt*1000>now+5000||!Array.isArray(value.facts)||!value.facts.length||value.facts.length>6)throw Error('invalid_owned_source');
 const seen=new Set();const facts=value.facts.map(row=>{if(!text(row.id,80)||seen.has(row.id)||!text(row.label,80)||!text(row.value,80)||!text(row.detail,200))throw Error('invalid_source_fact');seen.add(row.id);return {id:row.id,label:row.label,value:row.value,detail:row.detail};});return {provenance:provenance(value.provenance,now),receiptId:id,toolName:value.toolName,summary:value.summary,observedAt:value.observedAt,facts};
}

// Archived display is separate from current receipt/source authority; timestamps stay original.
export function historicalAnswers(value,snapshot,now=Date.now()){
 if(value?.schema!=='podview.answer-history.v1'||Object.keys(value).sort().join(',')!=='bootId,items,receiptIds,removalRevision,revision,roomId,schema'||value.bootId!==snapshot?.bootId||value.roomId!==snapshot?.roomId||snapshot?.capabilities?.answerRead!==true||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision!==snapshot.answerHistoryRevision||!Number.isSafeInteger(value.removalRevision)||value.removalRevision<0||value.removalRevision>value.revision||value.removalRevision!==snapshot.answerHistoryRemovalRevision||!Array.isArray(value.items)||value.items.length>20||!Array.isArray(value.receiptIds)||!Array.isArray(snapshot.answerHistoryReceiptIds)||value.receiptIds.length!==value.items.length||JSON.stringify(value.receiptIds)!==JSON.stringify(snapshot.answerHistoryReceiptIds)||value.items.some((row,index)=>row?.receiptId!==value.receiptIds[index]))throw Error('invalid_answer_history');
 const seen=new Set(),items=value.items.map(row=>{
  if(!row||Object.keys(row).sort().join(',')!=='content,family,observedAt,provenance,receiptId,title'||!receipt(row.receiptId)||seen.has(row.receiptId)||![...typedAnswerFamilies,...visualFamilies].includes(row.family)||!text(row.title,160)||!Number.isFinite(row.observedAt)||row.observedAt<0||row.observedAt*1000>now+5000||!row.provenance||Object.keys(row.provenance).join(',')!=='kind'||!['tool_result','ha_weather','owner_sources','ai_explanation'].includes(row.provenance.kind)||new TextEncoder().encode(JSON.stringify(row)).length>65536)throw Error('invalid_historical_answer');
  seen.add(row.receiptId);const ai=row.provenance.kind==='ai_explanation',options={ownerReceiptIds:[row.receiptId],allowConversation:ai};
  if(ai){if(['fact-card','chart'].includes(row.family)||row.family==='answer-timeline'&&row.content?.events?.some(event=>event.status!=='planned')||row.family==='checklist'&&row.content?.items?.some(item=>item.checked!==false))throw Error('invalid_historical_explanation');const art=row.content?.image||row.content?.illustration;if(art&&(art.url!=='assets/bicycle-drivetrain-illustration.webp'||art.kind!=='illustration'))throw Error('invalid_historical_image');}
  const content=typedAnswerFamilies.includes(row.family)?validateTypedAnswerContent(row.family,row.content,options):validateVisualContent(row.family,row.content,options),keys=new Set();JSON.stringify(row.content,(key,v)=>{keys.add(key);return v;});const order=[...keys].sort();if(JSON.stringify(row.content,order)!==JSON.stringify(content,order))throw Error('unclosed_historical_content');
  return {id:'receipt:'+row.receiptId,receiptId:row.receiptId,kind:row.family,title:row.title,observedAt:row.observedAt,content,provenance:{kind:row.provenance.kind},status:'ready',live:true,historical:true,presentation:true,ownerReceiptIds:[row.receiptId],allowedActions:[],readContext:null,readConnected:false,readStatus:'ready',displaySuggested:false,hidden:false};
 });return {revision:value.revision,removalRevision:value.removalRevision,items};
}
