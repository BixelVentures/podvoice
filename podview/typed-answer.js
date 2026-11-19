// Svar: a live owner answer in one of the six typed shapes (concise, choices, comparison, chart, steps, checklist),
// as the answer card (src/screens/answers) shows it: read-only content, its status and its source receipt. A pure
// model in plain JS: the server tests run it directly in Node (tests/podview/helpers/render-owned-chart.mjs).
import {typedAnswerFamilies,validateTypedAnswerContent} from './visual-content.js';

export function typedAnswerPresentation(answer){
 if(answer?.live!==true||answer.presentation!==true||!typedAnswerFamilies.includes(answer.kind))
  throw Error('unadmitted_typed_answer');
 return validateTypedAnswerContent(answer.kind,answer.content,{ownerReceiptIds:answer.ownerReceiptIds||[],
  allowConversation:answer.provenance?.kind==='ai_explanation'});
}

const LABELS={error:'Grundlaget kunne ikke opdateres. Tidligere indhold er bevaret.',
 offline:'Offline · seneste svar er bevaret.',interrupted:'Svaret blev afbrudt. Indholdet er bevaret.',
 empty:'Der er ikke noget at vise endnu.'};

// The answer's kit component (by the card's part name) and its data.
function component(kind,content,common){
 const items=content.items||[];
 if(kind==='choices')return {part:'choices',count:String(items.length),data:{...common,items}};
 if(kind==='comparison'){
  const columns=[{key:'label',label:'Valg'},...content.columns.map((column,index)=>({key:'column'+index,
   label:column.label}))];
  const rows=items.map(row=>({id:row.id,label:row.label,
   ...Object.fromEntries(row.values.map((value,index)=>['column'+index,value]))}));
  return {part:'comparison',data:{...common,selectable:false,columns,items:rows}};
 }
 if(kind==='chart')return {part:'chart',data:{...common,unit:content.unit,unitSingular:content.unitSingular,items}};
 if(kind==='steps')return {part:'guide',data:{...common,stepItems:content.steps,
  steps:content.steps.map(step=>step.text)}};
 if(kind==='checklist')return {part:'checklist',data:{...common,items,
  checked:items.filter(item=>item.checked).map(item=>item.id)}};
 return null;
}

// null: the content could not be admitted (the card then says so).
export function typedAnswerView(answer,scene){
 let content;
 try{content=typedAnswerPresentation(answer);}catch{return null;}
 const status=answer.historical===true?'ready':answer.readStatus||answer.status;
 const connected=answer.historical!==true&&answer.readConnected===true,pending=['pending','loading'].includes(status);
 const label=LABELS[status];
 const common={quietStatus:true,readOnly:true,connected:false,state:'ready',
  context:{sessionId:answer.sessionId,taskId:answer.taskId,revision:answer.revision}};
 return {content,busy:pending,
  status:{data:{state:status,quietStatus:true,text:label||''},
   hidden:!label||(status==='offline'&&scene.connectionNoticeVisible===true)},
  intro:{text:content.summary,hidden:content.summary.trim()===String(answer.title||'').trim()},
  retry:{hidden:status!=='error',disabled:!connected},
  component:component(answer.kind,content,common),
  sources:{hidden:answer.historical===true},
  sourceList:{items:content.sources,connected:connected&&!pending,state:pending?'pending':'ready',
   sourceOrigin:answer.provenance?.kind}};
}
