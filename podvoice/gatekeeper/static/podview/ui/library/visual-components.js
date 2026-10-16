import {validateVisualContent,visualFamilies} from '../../visual-content.js';
const make=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=value;return el;};
const copy=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
class VisualComponent extends HTMLElement {
 set data(value){this._data=value||{};if(this.isConnected)this.render();}
 get data(){return this._data||{};}
 connectedCallback(){this.render();}
 build(){
  if(this.built)return;this.built=true;this.family=this.localName.slice(3);this.classList.add('pv-component','pv-visual');this.dataset.component=this.family;
  this.note=make('p','pv-state-note');this.note.setAttribute('role','status');
  this.body=make('div','pv-visual-body');this.lead=make('div','pv-visual-lead');this.summary=make('p','pv-visual-summary');this.lead.append(this.summary);this.body.append(this.lead);this.rows=new Map();
  if(['sourced-image','simple-diagram'].includes(this.family)){
   this.figure=make('figure','pv-answer-image');this.image=make('img');this.image.decoding='async';this.image.referrerPolicy='no-referrer';this.image.width=1000;this.image.height=600;
   this.imageError=make('p','pv-image-fallback','Billedet kunne ikke indlæses. Forklaring og kilde er bevaret.');this.imageError.hidden=true;
   this.caption=make('figcaption');this.captionText=make('p');this.credit=make('span','pv-image-credit');this.caption.append(this.captionText,this.credit);
   this.figure.append(this.image,this.imageError,this.caption);this.body.append(this.figure);
   if(this.family==='simple-diagram'){this.figure.classList.add('pv-diagram-image');this.figure.hidden=true;this.list=make('ol','pv-visual-list');this.body.append(this.list);}
   this.image.addEventListener('error',()=>{this.image.hidden=true;this.imageError.hidden=false;});
   this.image.addEventListener('load',()=>{this.image.hidden=false;this.imageError.hidden=true;});
  }else{this.list=make(this.family==='fact-card'?'dl':'ol','pv-visual-list');this.body.append(this.list);}
  this.sources=make('details','pv-visual-sources');const sourceToggle=make('summary');sourceToggle.setAttribute('aria-label','Kilder og grundlag');sourceToggle.title='Kilder og grundlag';const sourceIcon=make('img');sourceIcon.src='assets/icons/three-dots.svg';sourceIcon.alt='';sourceToggle.append(sourceIcon);this.sources.append(sourceToggle);this.sourcePanel=make('div','pv-visual-source-panel');this.sourceList=make('ul');this.sourcePanel.append(this.sourceList);this.sources.append(this.sourcePanel);this.sourceNodes=new Map();this.lead.append(this.sources);this.append(this.note,this.body);
  this.sources.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.sources.open){event.stopPropagation();this.sources.open=false;sourceToggle.focus();}});
 }
 reconcile(parent,map,items,build,update){
  const wanted=new Set(items.map(x=>x.id));for(const [id,node] of map)if(!wanted.has(id)){node.remove();map.delete(id);}
  items.forEach((item,index)=>{let row=map.get(item.id);if(!row){row=build();map.set(item.id,row);}update(row,item,index);if(parent.children[index]!==row)parent.insertBefore(row,parent.children[index]||null);});
 }
 render(){
  this.build();const d=this.data,state=d.state||'ready',busy=state==='loading'||state==='pending';this.dataset.state=state;this.setAttribute('aria-busy',String(state==='loading'||state==='pending'));
  const labels={loading:'',pending:'',empty:'Der er ikke noget at vise endnu.',error:'Visningen kunne ikke hentes.',offline:'Offline · sidst kendte oplysninger',unsupported:'Denne visning er ikke tilgængelig.'};
  this.body.hidden=['empty','unsupported'].includes(state);this.sources.hidden=this.body.hidden;copy(this.note,labels[state]||'');this.note.hidden=!this.note.textContent;
  if(this.body.hidden)return;
  for(const row of this.placeholders||[])row.remove();
  let content;try{content=validateVisualContent(this.family,d.content,{ownerReceiptIds:d.ownerReceiptIds||[],allowConversation:d.allowConversation===true});}catch{if(busy){this.body.hidden=false;this.sources.hidden=!this.lastContent;this.note.hidden=true;if(!this.lastContent){this.dataset.empty='true';this.summary.hidden=true;if(this.figure&&this.family==='sourced-image'){this.image.style.visibility='hidden';this.caption.hidden=true;}else{this.placeholders??=Array.from({length:3},()=>{const row=make(this.family==='fact-card'?'div':'li','pv-visual-item');row.setAttribute('aria-hidden','true');row.append(make(this.family==='fact-card'?'dt':'span','pv-visual-label'),make(this.family==='fact-card'?'dd':'h2','pv-visual-value'),make('p','pv-visual-detail'));return row;});this.list.append(...this.placeholders);}}return;}this.body.hidden=!this.lastContent;this.sources.hidden=this.body.hidden;copy(this.note,labels[state]||'Visningen kunne ikke læses.');this.note.hidden=false;return;}
  this.dataset.empty='false';if(this.figure){this.image.style.visibility='';this.caption.hidden=false;}this.lastContent=content;copy(this.summary,content.summary);this.summary.hidden=d.hideSummary===true;
  this.dataset.count=String((content.facts||content.events||content.nodes||[]).length);
  if(this.figure){
   const img=content.image||content.illustration;this.figure.hidden=!img;this.dataset.illustrated=String(!!img);
   if(img){if(this.image.getAttribute('src')!==img.url){this.image.hidden=false;this.imageError.hidden=true;this.image.src=img.url;}this.image.alt=img.alt;copy(this.captionText,img.caption);copy(this.credit,`${img.kind==='album_cover'?'Omslag':img.kind==='illustration'?'Illustration':'Foto'} · ${img.credit}`);
   }
  }
  if(this.family==='simple-diagram'){
   if(content.illustration)this.caption.append(this.note);
   else this.insertBefore(this.note,this.body);
  }
  const plannedTimeline=this.family==='answer-timeline'&&d.forecast!==true&&content.events.every(event=>event.status==='planned');
  if(this.family==='answer-timeline'){this.timelineContext??=make('p','pv-timeline-context');if(!this.timelineContext.parentNode)this.body.insertBefore(this.timelineContext,this.list);copy(this.timelineContext,plannedTimeline?'Planlagt forløb':'');this.timelineContext.hidden=!plannedTimeline;}
  if(this.list){
   const items=content.facts||content.events||content.nodes;
   this.reconcile(this.list,this.rows,items,()=>{
    const row=make(this.family==='fact-card'?'div':'li','pv-visual-item');
    row.append(make(this.family==='fact-card'?'dt':'span','pv-visual-label'),make(this.family==='fact-card'?'dd':'h2','pv-visual-value'),make('p','pv-visual-detail'));return row;
   },(row,item,index)=>{
    const [label,value,detail]=row.children;
    copy(label,this.family==='fact-card'?item.label:this.family==='answer-timeline'?plannedTimeline?item.time:`${item.time}\n${d.forecast===true?'Prognose':item.status==='planned'?'Planlagt':'Registreret'}`:String(index+1).padStart(2,'0'));
    copy(value,this.family==='fact-card'?item.value:item.label);copy(detail,item.detail);row.dataset.position=String(index+1);
   });
  }
  this.reconcile(this.sourceList,this.sourceNodes,content.sources,()=>{const li=make('li');const a=make('a');a.target='_blank';a.rel='noopener noreferrer';li.append(a,make('p'));return li;},(li,s)=>{const owner=s.kind==='owner_receipt';if((li.children[0].tagName==='BUTTON')!==owner){const control=make(owner?'button':'a');if(owner){control.type='button';control.className='text-control';control.addEventListener('click',()=>control.dispatchEvent(new CustomEvent('owner-source',{bubbles:true,composed:true,detail:{receiptId:li.dataset.receiptId}})));}else{control.target='_blank';control.rel='noopener noreferrer';}li.children[0].replaceWith(control);}copy(li.children[0],s.label);if(owner)li.children[0].disabled=['offline','loading','pending'].includes(state);li.dataset.receiptId=owner?s.receiptId:'';if(!owner)li.children[0].href=s.url;copy(li.children[1],owner?(s.scope==='conversation_answer'?'AI-forklaring':'Modtaget værktøjsresultat'):s.scope);});
 }
}
for(const family of visualFamilies)customElements.define(`pv-${family}`,class extends VisualComponent{});
