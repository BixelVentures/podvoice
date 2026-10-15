// Closed completed-receipt admission. Independent research reads stay inactive; no fetch or actions.
import {validateVisualContent} from './visual-content.js';
const text=(v,n=160)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
export function researchAnswer(row,context,now=Date.now()){
 const fields=['roomId','sessionId','turnId','taskId'];
 if(row?.schema!=='podview.research.v1'||!fields.every(k=>text(row[k])&&row[k]===context[k])||!['inputRevision','answerRevision','providerGeneration'].every(k=>integer(row[k])&&row[k]===context[k])||!Number.isFinite(row.sessionEpoch)||row.sessionEpoch!==context.sessionEpoch||!Number.isFinite(row.observedAt)||row.observedAt*1000>now+5000||row.observedAt*1000<now-120000||!Number.isFinite(row.validUntil)||row.validUntil*1000<=now||row.validUntil>row.observedAt+120||!/^\w{32}$/.test(row.receiptId)||!/^[a-f0-9]{32}$/.test(row.receiptId)||!['fact-card','answer-timeline'].includes(row.family)||row.displaySuggested!==true||!Array.isArray(row.allowedActions)||row.allowedActions.length)throw Error('invalid_research_binding');
 if(!Array.isArray(row.content?.sources)||row.content.sources.length!==1||row.content.sources[0].kind!=='owner_receipt'||row.content.sources[0].receiptId!==row.receiptId)throw Error('invalid_research_receipt');
 const p=row.provenance;
 if(row.family==='fact-card'&&(p?.kind!=='tool_result'||p.externalSourcesProvided!==false||p.retrievedAt!==row.observedAt||typeof p.textTruncated!=='boolean'))throw Error('invalid_web_excerpt');
 if(row.family==='answer-timeline'){
  const retrieved=Date.parse(p?.retrievedAt);
  if(p?.kind!=='ha_weather'||!text(p.source)||!Number.isFinite(retrieved)||retrieved>now||row.validUntil*1000>retrieved+900000||p.continuousCoverage!==false||!text(p.forecastType,32)||p.displayedPeriods!==row.content.events?.length||p.displayedStart!==row.content.events?.[0]?.time||p.displayedEnd!==row.content.events?.at(-1)?.time)throw Error('invalid_forecast_provenance');
  const c=p.coverage;if(!c||!integer(c.totalRows)||!integer(c.returnedRows)||c.totalRows<1||c.totalRows>512||c.returnedRows<1||c.returnedRows>c.totalRows||c.truncated!==(c.returnedRows<c.totalRows)||!Number.isFinite(Date.parse(c.start))||!Number.isFinite(Date.parse(c.end))||Date.parse(c.end)<Date.parse(c.start)||Date.parse(p.displayedStart)<Date.parse(c.start)||Date.parse(p.displayedEnd)>Date.parse(c.end))throw Error('invalid_forecast_coverage');
  let previous=-Infinity;for(const e of row.content.events){const stamp=Date.parse(e.time);if(!Number.isFinite(stamp)||stamp<row.observedAt*1000||stamp<=previous||e.status!=='planned')throw Error('invalid_forecast_period');previous=stamp;}
 }
 const content=validateVisualContent(row.family,row.content,{ownerReceiptIds:[row.receiptId]});
 const provenance=row.family==='fact-card'?{kind:'tool_result',retrievedAt:p.retrievedAt,externalSourcesProvided:false,textTruncated:p.textTruncated}:{kind:'ha_weather',source:p.source,retrievedAt:p.retrievedAt,continuousCoverage:false,forecastType:p.forecastType,displayedPeriods:p.displayedPeriods,displayedStart:p.displayedStart,displayedEnd:p.displayedEnd,coverage:{totalRows:p.coverage.totalRows,returnedRows:p.coverage.returnedRows,truncated:p.coverage.truncated,start:p.coverage.start,end:p.coverage.end}};
 return {id:'receipt:'+row.receiptId,kind:row.family,status:'ready',live:true,content,ownerReceiptIds:[row.receiptId],allowedActions:[],observedAt:row.observedAt,validUntil:row.validUntil,provenance};
}
