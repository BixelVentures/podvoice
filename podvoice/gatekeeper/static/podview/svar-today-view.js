import {answerCatalog,answerDomainIcon} from './answer-widget.js';
import {syncKitButtonContent,applyKitComponent} from './ui/kit.js';
// The Svar page's »I dag« column (lærred »A-SvarKort«, »SvarK-*«): while an answer card is shown, the player column
// lists the same answers as »Tidligere svar«, newest first; the answer being read is ringed. A row opens the answer
// through the existing history row, so browsing, grouping and follow-ups keep their one owner.
const KIND={'sport-result':'Resultat','fact-card':'Fakta','key-points':'Svar','answer-timeline':'Tidslinje'};
// The row's tone is the answer's own domain (SvarK-Spec »Valgt: hvid … øvrige: domænetone«): weather from the
// weather provenance, music from an album-cover image, every other answer the Svar tone.
export const svarDomain=a=>a?.provenance?.kind==='ha_weather'||a?.weatherPresentation?.kind==='local-weather'?'weather'
 :a?.kind==='sourced-image'&&a?.content?.image?.kind==='album_cover'?'music':'answer';
const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
export function svarTodayRows(groups,answers,focus,now=new Date()){
 const rows=groups.map(group=>{const first=group.items.reduce((a,b)=>b.observedAt<a.observedAt?b:a);
  const newest=Math.max(...group.items.map(item=>Number.isFinite(item.observedAt)?item.observedAt:0));
  return {id:first.id,title:first.title,kind:first.kind,observedAt:newest,domain:svarDomain(first),
   icon:answerDomainIcon(first),current:group.items.some(item=>item.id===focus)};});
 // A live answer is not history yet; while it is on screen it stands first.
 const live=answers.find(a=>a.id===focus&&!a.hidden&&!a.historical);
 if(live&&!rows.some(row=>row.current))rows.push({id:live.id,title:live.title,kind:live.kind,
  observedAt:Number.isFinite(live.observedAt)?live.observedAt:now.getTime()/1000,current:true,live:true,
  domain:svarDomain(live),icon:answerDomainIcon(live)});
 rows.sort((a,b)=>b.observedAt-a.observedAt);
 return rows.map(row=>{const at=new Date(row.observedAt*1000);
  const time=sameDay(at,now)?at.toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'})
   :at.toLocaleDateString('da-DK',{day:'numeric',month:'short'});
  return {...row,kindLabel:KIND[row.kind]||answerCatalog[row.kind]||'Visuelt svar',time,today:sameDay(at,now)};});
}
// »↑ 1 nyt svar« (lærred »SvarK-Historik«): answers that arrived while the user reads an older one, or has scrolled the
// list away from the top, are counted here. Only rows that were not on the list before count, so the number is real.
export function svarUnseenCount(rows,seen){return seen?rows.filter(row=>!row.current&&!seen.has(row.id)).length:0;}
// The arrow is the K-Btn »up« icon, not text.
export const svarNewLabel=count=>`${count} ${count===1?'nyt svar':'nye svar'}`;
export class SvarTodayView{
 constructor(root,open){this.root=root;this.open=open;this.title=root.querySelector('h2');
  this.list=root.querySelector('.svar-today-rows');this.signature='';this.rows=[];this.seen=null;
  const doc=root.ownerDocument;this.newer=doc.createElement('button');this.newer.type='button';this.newer.className='svar-today-new';
  // »1 nyt svar« floats over the list (K-Btn 44, primary, up icon); it never pushes the rows.
  applyKitComponent(this.newer,'button',{variant:'primary'});
  this.newer.hidden=true;this.list.before(this.newer);
  this.newer.addEventListener('click',()=>this.jumpToNewest());
  this.list.addEventListener('scroll',()=>this.updateNewer(),{passive:true});}
 atTop(){return !(this.list.scrollTop>8);}
 jumpToNewest(){const newest=this.rows[0];if(!newest)return;this.list.scrollTop=0;
  this.seen=new Set(this.rows.map(row=>row.id));this.updateNewer();if(!newest.current)this.open(newest.id);}
 updateNewer(){
  const rows=this.rows;if(!this.seen)this.seen=new Set(rows.map(row=>row.id));
  for(const row of rows)if(row.current)this.seen.add(row.id);
  if(rows[0]?.current&&this.atTop())for(const row of rows)this.seen.add(row.id);
  const count=svarUnseenCount(rows,this.seen),label=svarNewLabel(count);
  if(this.newer.hidden!==!count)this.newer.hidden=!count;
  if(count&&this.newer.textContent!==label){syncKitButtonContent(this.newer,{label,icon:'assets/icons/chevron-up.svg',size:'44'});this.newer.setAttribute('aria-label',`Vis nyeste svar · ${count} ${count===1?'nyt svar':'nye svar'}`);}
 }
 render(rows,visible){
  if(this.root.hidden!==!visible)this.root.hidden=!visible;if(!visible){this.seen=null;this.rows=[];this.signature='';return;}
  this.rows=rows;
  const signature=JSON.stringify(rows);if(signature===this.signature)return this.updateNewer();this.signature=signature;
  const heading=rows.every(row=>row.today)?'I dag':'Tidligere svar';
  if(this.title.textContent!==heading)this.title.textContent=heading;
  const doc=this.root.ownerDocument,nodes=rows.map(row=>{const b=doc.createElement('button');b.type='button';
   b.className='svar-today-row';b.dataset.answerId=row.id;b.dataset.domain=row.domain||'answer';
   if(row.current)b.setAttribute('aria-current','true');
   // Same anatomy as the card, small: head (icon 18 · kind · time), then the title in two lines.
   const head=doc.createElement('span');head.className='svar-today-head';const icon=doc.createElement('img');
   icon.className='svar-today-icon';icon.alt='';icon.src=`assets/icons/${row.icon||'chat-circle'}.svg`;
   const k=doc.createElement('small');k.textContent=row.kindLabel;const time=doc.createElement('time');
   time.textContent=row.time;head.append(icon,k,time);
   const t=doc.createElement('strong');t.className='svar-today-title';t.textContent=row.title;b.append(head,t);
   b.setAttribute('aria-label',`${row.kindLabel} · ${row.title} · ${row.time}`);
   b.addEventListener('click',()=>{if(!row.current)this.open(row.id);});return b;});
  this.list.replaceChildren(...nodes);this.updateNewer();
 }
}
