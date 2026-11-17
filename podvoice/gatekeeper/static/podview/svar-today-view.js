import {answerCatalog,answerDomainIcon} from './answer-widget.js';
import {syncKitButtonContent,applyKitComponent} from './ui/kit.js';
import {animateList} from './ui/list-motion.js';
// The Svar page's »Tidligere svar« column (lærred »A-SvarKort«): while an answer is shown, the player column lists
// every saved answer as one compact row, newest first: icon chip · title in one line · time. A row opens its answer
// (with the rest of its round, owner-answers answerThread) through the existing history row, so browsing, grouping
// and follow-ups keep their one owner. The answer being read is the selected row.
const KIND={'sport-result':'Resultat','fact-card':'Fakta','key-points':'Svar','answer-timeline':'Tidslinje'};
// The answer's category, shown only as the icon chip's tint in the home widgets' colours: weather from the weather
// provenance, music from an album-cover image, every other answer the Svar category.
export const svarDomain=a=>a?.provenance?.kind==='ha_weather'||a?.weatherPresentation?.kind==='local-weather'?'weather'
 :a?.kind==='sourced-image'&&a?.content?.image?.kind==='album_cover'?'music':'answer';
const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
// »19.04« today, »i går 19.04« yesterday, otherwise »12. nov. 19.04«.
export function svarTime(seconds,now=new Date()){
 const at=new Date(seconds*1000),clock=at.toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'});
 const yesterday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
 if(sameDay(at,now))return clock;
 if(sameDay(at,yesterday))return `i går ${clock}`;
 return `${at.toLocaleDateString('da-DK',{day:'numeric',month:'short'})} ${clock}`;
}
export function svarTodayRows(groups,answers,focus,now=new Date()){
 const focused=answers.find(a=>a.id===focus),byReceipt=new Map();
 const row=(item,extra={})=>({id:item.id,title:item.title,kind:item.kind,domain:svarDomain(item),
  icon:answerDomainIcon(item),observedAt:Number.isFinite(item.observedAt)?item.observedAt:0,
  current:item.id===focus||!!item.receiptId&&item.receiptId===focused?.receiptId,...extra});
 for(const item of groups.flatMap(group=>group.items))byReceipt.set(item.receiptId||item.id,row(item));
 // A live answer is not history yet; while it is on screen it stands with the rest.
 const live=answers.find(a=>a.id===focus&&!a.hidden&&!a.historical);
 if(live&&!byReceipt.has(live.receiptId||live.id))byReceipt.set(live.receiptId||live.id,row(live,{live:true,
  observedAt:Number.isFinite(live.observedAt)?live.observedAt:now.getTime()/1000}));
 return [...byReceipt.values()].sort((a,b)=>b.observedAt-a.observedAt)
  .map(row=>({...row,kindLabel:KIND[row.kind]||answerCatalog[row.kind]||'Visuelt svar',
   time:svarTime(row.observedAt,now),today:sameDay(new Date(row.observedAt*1000),now)}));
}
// »↑ 1 nyt svar« (lærred »SvarK-Historik«): answers that arrived while the user reads an older one, or has scrolled the
// list away from the top, are counted here. Only rows that were not on the list before count, so the number is real.
export function svarUnseenCount(rows,seen){return seen?rows.filter(row=>!row.current&&!seen.has(row.id)).length:0;}
// The arrow is the K-Btn »up« icon, not text.
export const svarNewLabel=count=>`${count} ${count===1?'nyt svar':'nye svar'}`;
export class SvarTodayView{
 constructor(root,open){this.root=root;this.open=open;this.title=root.querySelector('h2');
  this.list=root.querySelector('.svar-today-rows');this.signature='';this.rows=[];this.seen=null;this.nodes=new Map();
  const doc=root.ownerDocument;this.newer=doc.createElement('button');this.newer.type='button';
  this.newer.className='svar-today-new';
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
  if(count&&this.newer.textContent!==label){
   syncKitButtonContent(this.newer,{label,icon:'assets/icons/chevron-up.svg',size:'44'});
   this.newer.setAttribute('aria-label',`Vis nyeste svar · ${count} ${count===1?'nyt svar':'nye svar'}`);}
 }
 render(rows,visible){
  if(this.root.hidden!==!visible)this.root.hidden=!visible;
  if(!visible){this.seen=null;this.rows=[];this.signature='';return;}
  this.rows=rows;
  const signature=JSON.stringify(rows);if(signature===this.signature)return this.updateNewer();this.signature=signature;
  const heading=rows.every(row=>row.today)?'I dag':'Tidligere svar';
  if(this.title.textContent!==heading)this.title.textContent=heading;
  // Rows are kept per answer, so an arriving answer enters with the list motion and the others make room.
  const nodes=rows.map(row=>this.rowNode(row)),ids=new Set(rows.map(row=>row.id));
  for(const id of [...this.nodes.keys()])if(!ids.has(id))this.nodes.delete(id);
  const children=[...this.list.children];
  if(nodes.length!==children.length||nodes.some((node,i)=>children[i]!==node))
   animateList(this.list,()=>this.list.replaceChildren(...nodes));
  this.updateNewer();
 }
 rowNode(row){
  let b=this.nodes.get(row.id);
  if(!b){const doc=this.root.ownerDocument;b=doc.createElement('button');b.type='button';b.className='svar-today-row';
   b.dataset.answerId=row.id;
   // One line: the kind's icon in its category chip, the title, the time.
   const chip=doc.createElement('span');chip.className='svar-today-chip';const icon=doc.createElement('img');
   icon.className='svar-today-icon';icon.alt='';chip.append(icon);
   const title=doc.createElement('strong');title.className='svar-today-title';
   b.append(chip,title,doc.createElement('time'));
   b.addEventListener('click',()=>{if(!b.row.current)this.open(b.row.id);});this.nodes.set(row.id,b);}
  b.row=row;const domain=row.domain||'answer';if(b.dataset.domain!==domain)b.dataset.domain=domain;
  if(row.current)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');
  const icon=b.querySelector('.svar-today-icon'),src=`assets/icons/${row.icon||'chat-circle'}.svg`;
  if(icon.getAttribute('src')!==src)icon.setAttribute('src',src);
  const title=b.querySelector('.svar-today-title'),time=b.querySelector('time');
  if(title.textContent!==row.title)title.textContent=row.title;
  if(time.textContent!==row.time)time.textContent=row.time;
  const label=`${row.kindLabel} · ${row.title} · ${row.time}`;
  if(b.getAttribute('aria-label')!==label)b.setAttribute('aria-label',label);
  return b;
 }
}
