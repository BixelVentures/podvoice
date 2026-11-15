import {answerCatalog} from './answer-widget.js';
// The Svar page's »I dag« column (lærred »A-SvarKort«, »SvarK-*«): while an answer card is shown, the player column
// lists the same answers as »Tidligere svar«, newest first; the answer being read is ringed. A row opens the answer
// through the existing history row, so browsing, grouping and follow-ups keep their one owner.
const KIND={'sport-result':'Resultat','fact-card':'Fakta','key-points':'Svar','answer-timeline':'Tidslinje'};
const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
export function svarTodayRows(groups,answers,focus,now=new Date()){
 const rows=groups.map(group=>{const first=group.items.reduce((a,b)=>b.observedAt<a.observedAt?b:a);
  const newest=Math.max(...group.items.map(item=>Number.isFinite(item.observedAt)?item.observedAt:0));
  return {id:first.id,title:first.title,kind:first.kind,observedAt:newest,
   current:group.items.some(item=>item.id===focus)};});
 // A live answer is not history yet; while it is on screen it stands first.
 const live=answers.find(a=>a.id===focus&&!a.hidden&&!a.historical);
 if(live&&!rows.some(row=>row.current))rows.push({id:live.id,title:live.title,kind:live.kind,
  observedAt:Number.isFinite(live.observedAt)?live.observedAt:now.getTime()/1000,current:true,live:true});
 rows.sort((a,b)=>b.observedAt-a.observedAt);
 return rows.map(row=>{const at=new Date(row.observedAt*1000);
  const time=sameDay(at,now)?at.toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'})
   :at.toLocaleDateString('da-DK',{day:'numeric',month:'short'});
  return {...row,kindLabel:KIND[row.kind]||answerCatalog[row.kind]||'Visuelt svar',time,today:sameDay(at,now)};});
}
export class SvarTodayView{
 constructor(root,open){this.root=root;this.open=open;this.title=root.querySelector('h2');
  this.list=root.querySelector('.svar-today-rows');this.signature='';}
 render(rows,visible){
  if(this.root.hidden!==!visible)this.root.hidden=!visible;if(!visible)return;
  const signature=JSON.stringify(rows);if(signature===this.signature)return;this.signature=signature;
  const heading=rows.every(row=>row.today)?'I dag':'Tidligere svar';
  if(this.title.textContent!==heading)this.title.textContent=heading;
  const doc=this.root.ownerDocument,nodes=rows.map(row=>{const b=doc.createElement('button');b.type='button';
   b.className='svar-today-row';b.dataset.answerId=row.id;if(row.current)b.setAttribute('aria-current','true');
   const copy=doc.createElement('span');copy.className='svar-today-copy';const t=doc.createElement('strong');
   t.textContent=row.title;const k=doc.createElement('small');k.textContent=row.kindLabel;copy.append(t,k);
   const time=doc.createElement('time');time.textContent=row.time;b.append(copy,time);
   b.setAttribute('aria-label',`${row.kindLabel} · ${row.title} · ${row.time}`);
   b.addEventListener('click',()=>{if(!row.current)this.open(row.id);});return b;});
  this.list.replaceChildren(...nodes);
 }
}
