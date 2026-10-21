import {applyKitComponent,applyKitTemplate} from '../kit.js';
import {conclusionDisclosure} from '../conclusion-disclosure.js';
import {validateVisualContent,visualFamilies} from '../../visual-content.js';
const weatherIcons=Object.freeze({'Let skyet':'cloud-sun','Skyet':'cloud','Regn':'cloud-rain','Sol':'sun'});
// Authored local illustration only: the generic/live fact contract stays unchanged.
const weatherPresentation=(family,data,content)=>family==='fact-card'&&data.exampleOnly===true&&data.weatherPresentation?.kind==='local-weather'&&content.facts?.length===4&&content.facts.every((fact,index)=>Object.hasOwn(weatherIcons,fact.detail)&&/^-?\d{1,2}°$/.test(fact.value)&&(index===0?fact.label==='Nu':/^(?:[01]?\d|2[0-3])$/.test(fact.label)));
const make=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=value;return el;};
// Existing retained owner: update only the field whose presented value changed.
const copy=(node,value,key='textContent',kind='property')=>{
 if(kind==='attribute'){if(value===null){if(node.getAttribute(key)!=null)node.removeAttribute(key);}else if(node.getAttribute(key)!==String(value))node.setAttribute(key,String(value));return;}
 if(kind==='delete'){if(node[key]!==undefined)delete node[key];return;}
 if(node[key]!==value)node[key]=value;
};
class VisualComponent extends HTMLElement {
 // Authority/provenance is always current, including a visually unchanged read.
 set data(value){this._data=value||{};if(this.isConnected)this.render();}
 get data(){return this._data||{};}
 connectedCallback(){this.render();this.conclusion?.update();}
 disconnectedCallback(){this.conclusion?.disconnect();}
 build(){
  if(this.built)return;this.built=true;this.family=this.localName.slice(3);this.classList.add('pv-component','pv-visual');this.dataset.component=this.family;applyKitTemplate(this,'response');
  this.note=make('p','pv-state-note');this.note.setAttribute('role','status');
  this.body=make('div','pv-visual-body');this.lead=make('div','pv-visual-lead');this.domainIcon=make('img','pv-answer-domain-icon');this.domainIcon.alt='';applyKitComponent(this.domainIcon,'icon');this.lead.append(this.domainIcon);this.summary=make('p','pv-visual-summary');this.summary.dataset.responseZone='conclusion';this.lead.append(this.summary);this.body.append(this.lead);this.body.dataset.responseZone='body';this.rows=new Map();
  if(['sourced-image','simple-diagram'].includes(this.family)){
   this.figure=make('figure','pv-answer-image');this.image=make('img');this.image.decoding='async';this.image.referrerPolicy='no-referrer';this.image.width=1000;this.image.height=600;
   this.imageError=make('p','pv-image-fallback','Billedet kunne ikke indlæses. Forklaring og kilde er bevaret.');this.imageError.hidden=true;
   this.caption=make('figcaption');this.captionText=make('p');this.credit=make('span','pv-image-credit');this.caption.append(this.captionText,this.credit);
   this.figure.append(this.image,this.imageError,this.caption);this.body.append(this.figure);
   if(this.family==='simple-diagram'){this.figure.classList.add('pv-diagram-image');this.figure.hidden=true;this.list=make('ol','pv-visual-list');this.body.append(this.list);}
   this.image.addEventListener('error',()=>{this.image.hidden=true;this.imageError.hidden=false;});
   this.image.addEventListener('load',()=>{if(this.data.historical===true&&this.image.getAttribute('src')!=='assets/bicycle-drivetrain-illustration.webp')return;this.image.hidden=false;this.imageError.hidden=true;});
  }else{this.list=make(this.family==='fact-card'?'dl':'ol','pv-visual-list');this.body.append(this.list);}
  this.sources=make('details','pv-visual-sources');const sourceToggle=make('summary',undefined,'Kilder');sourceToggle.setAttribute('aria-label','Kilder og grundlag');sourceToggle.title='Kilder og grundlag';this.sources.append(sourceToggle);this.sourcePanel=make('div','pv-visual-source-panel');this.sourcePanel.dataset.responseZone='metadata';this.sourceList=make('ul');this.sourcePanel.append(this.sourceList);this.sources.append(this.sourcePanel);this.sourceNodes=new Map();this.sources.dataset.responseZone='metadata';this.append(this.note,this.body,this.sources);
  this.sources.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.sources.open){event.stopPropagation();this.sources.open=false;sourceToggle.focus({preventScroll:true});}});
 }
 reconcile(parent,map,items,build,update){
  const wanted=new Set(items.map(x=>x.id));for(const [id,node] of map)if(!wanted.has(id)){node.remove();map.delete(id);}
  items.forEach((item,index)=>{let row=map.get(item.id);if(!row){row=build();map.set(item.id,row);}update(row,item,index);if(parent.children[index]!==row)parent.insertBefore(row,parent.children[index]||null);});
 }
 render(){
  this.build();const d=this.data;const presentation=JSON.stringify([d.historical===true?'ready':d.state||'ready',d.content,d.ownerReceiptIds||[],d.allowConversation===true,d.historical===true,d.hideSummary===true,d.hideOfflineStatus===true,d.forecast===true,d.exampleOnly===true,d.weatherPresentation,d.domainIcon,d.contextTitle],(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);if(this.lastPresentation===presentation)return;this.lastPresentation=presentation;const state=d.historical===true?'ready':d.state||'ready',busy=state==='loading'||state==='pending';copy(this.dataset,state,'state');copy(this,state==='loading'||state==='pending','aria-busy','attribute');
  if(this.imageError)copy(this.imageError,d.historical===true?'Billedet hentes ikke igen i historikken. Forklaring og kilde er bevaret.':'Billedet kunne ikke indlæses. Forklaring og kilde er bevaret.');
  copy(this.domainIcon,`assets/icons/${['moon','cloud-sun','timer','lightbulb','music-note-beamed'].includes(d.domainIcon)?d.domainIcon:'chat-circle'}.svg`,'src');
  const labels={loading:'',pending:'',empty:'Der er ikke noget at vise endnu.',error:'Visningen kunne ikke hentes.',interrupted:'Svaret blev afbrudt.',offline:'Offline · sidst kendte oplysninger',unsupported:'Denne visning er ikke tilgængelig.'};
  if(d.historical===true&&this.image&&this.image.getAttribute('src')!=='assets/bicycle-drivetrain-illustration.webp'){copy(this.image,null,'src','attribute');copy(this.image,true,'hidden');copy(this.imageError,false,'hidden');}
  if(['empty','unsupported'].includes(state)&&this.note.parentNode!==this)this.insertBefore(this.note,this.body);copy(this.body,['empty','unsupported'].includes(state),'hidden');copy(this.sources,d.historical===true||this.body.hidden,'hidden');copy(this.note,labels[state]||'');copy(this.note,!this.note.textContent||(state==='offline'&&d.hideOfflineStatus===true),'hidden');
  if(this.body.hidden)return;
  let content;try{content=validateVisualContent(this.family,d.content,{ownerReceiptIds:d.ownerReceiptIds||[],allowConversation:d.allowConversation===true});}catch{for(const row of this.sourceNodes.values()){const control=row.children[0];if(control.tagName==='BUTTON')copy(control,true,'disabled');}if(busy){copy(this.body,false,'hidden');copy(this.sources,d.historical===true||!this.lastContent,'hidden');copy(this.note,true,'hidden');if(!this.lastContent){copy(this.dataset,'true','empty');copy(this.summary,true,'hidden');if(this.figure&&this.family==='sourced-image'){copy(this.image.style,'hidden','visibility');copy(this.caption,true,'hidden');}else{this.placeholders??=Array.from({length:3},()=>{const row=make(this.family==='fact-card'?'div':'li','pv-visual-item');row.setAttribute('aria-hidden','true');row.append(make(this.family==='fact-card'?'dt':'span','pv-visual-label'),make(this.family==='fact-card'?'dd':'h2','pv-visual-value'),make(this.family==='fact-card'?'dd':'p','pv-visual-detail'));return row;});if(this.placeholders.some(row=>row.parentNode!==this.list))this.list.append(...this.placeholders);}}return;}copy(this.body,!this.lastContent,'hidden');copy(this.sources,d.historical===true||this.body.hidden,'hidden');if(!labels[state])copy(this.dataset,'error','state');if(this.note.parentNode!==this)this.insertBefore(this.note,this.body);copy(this.note,state==='offline'&&!this.lastContent?'Offline · ingen gemte oplysninger.':labels[state]||'Visningen kunne ikke læses.');copy(this.note,state==='offline'&&d.hideOfflineStatus===true,'hidden');return;}
  for(const row of this.placeholders||[])row.remove();
  copy(this.dataset,'false','empty');if(this.figure){copy(this.image.style,'','visibility');copy(this.caption,false,'hidden');}this.lastContent=content;copy(this.summary,content.summary);copy(this.summary,d.hideSummary===true||typeof d.contextTitle==='string'&&content.summary.trim()===d.contextTitle.trim(),'hidden');copy(this.dataset,content.summary.length>100?'prose':'brief','conclusionDensity');if(this.summary.after){this.conclusion??=conclusionDisclosure(this.summary);this.conclusion.update();}
  copy(this.dataset,String((content.facts||content.events||content.nodes||[]).length),'count');
  const weather=weatherPresentation(this.family,d,content);copy(this.dataset,weather?'weather':'','presentation');
  if(weather){
   this.weatherContext??=make('p','pv-visual-detail');if(!this.weatherContext.parentNode)this.lead.append(this.weatherContext);
   copy(this.weatherContext,typeof d.weatherPresentation.subtitle==='string'?d.weatherPresentation.subtitle.slice(0,160):'');
   this.weatherCaption??=make('small','pv-visual-detail');if(this.weatherCaption.parentNode!==this.sourcePanel)this.sourcePanel.append(this.weatherCaption);copy(this.weatherCaption,'Vejrforløb · forhåndsvisning');
  }
  if(this.weatherContext)copy(this.weatherContext,!weather,'hidden');if(this.weatherCaption)copy(this.weatherCaption,!weather,'hidden');
  if(this.figure){
   const img=content.image||content.illustration;copy(this.figure,!img,'hidden');copy(this.dataset,String(!!img),'illustrated');
   if(img){copy(this.dataset,img.kind,'imageKind');if(d.historical===true&&img.url!=='assets/bicycle-drivetrain-illustration.webp'){copy(this.image,null,'src','attribute');copy(this.image,true,'hidden');copy(this.imageError,false,'hidden');}else if(this.image.getAttribute('src')!==img.url){copy(this.image,false,'hidden');copy(this.imageError,true,'hidden');this.image.src=img.url;}copy(this.image,img.alt,'alt');copy(this.captionText,img.caption);copy(this.credit,`${img.kind==='album_cover'?'Omslag':img.kind==='illustration'?'Illustration':'Foto'} · ${img.credit}`);
   }
   else copy(this.dataset,null,'imageKind','delete');
  }
  if(this.family==='simple-diagram'){
   if(content.illustration){if(this.note.parentNode!==this.caption)this.caption.append(this.note);}
   else if(this.note.parentNode!==this)this.insertBefore(this.note,this.body);
  }
  const plannedTimeline=this.family==='answer-timeline'&&d.forecast!==true&&content.events.every(event=>event.status==='planned');
  if(this.family==='answer-timeline'){this.timelineContext??=make('p','pv-timeline-context');if(!this.timelineContext.parentNode)this.body.insertBefore(this.timelineContext,this.list);copy(this.timelineContext,plannedTimeline?'Planlagt forløb':'');copy(this.timelineContext,!plannedTimeline,'hidden');}
  if(this.list){
   const items=content.facts||content.events||content.nodes;
   this.reconcile(this.list,this.rows,items,()=>{
    const row=make(this.family==='fact-card'?'div':'li','pv-visual-item');applyKitComponent(row,'listrow');
    row.append(make(this.family==='fact-card'?'dt':'span','pv-visual-label'),make(this.family==='fact-card'?'dd':'h2','pv-visual-value'),make(this.family==='fact-card'?'dd':'p','pv-visual-detail'));return row;
   },(row,item,index)=>{
    const [label,value,detail]=row.children;copy(row.dataset,this.family==='fact-card'&&index===0?'primary':'supporting','answerRole');
    if(this.family==='fact-card'){const numeric=/^[-+]?\d[\d.,:\s]*\s*(?:°[CF]?|%|km|m|cm|mm|kg|g|W|kW|kWh|min|t)?$/.test(item.value);copy(row.dataset,numeric?'numeric':'text','valueKind');copy(row.dataset,numeric&&item.value.length>16?'long':'short','valueDensity');}
    copy(label,this.family==='fact-card'?item.label:this.family==='answer-timeline'?plannedTimeline?item.time:`${item.time}\n${d.forecast===true?'Prognose':item.status==='planned'?'Planlagt':'Registreret'}`:String(index+1).padStart(2,'0'));
    copy(value,this.family==='fact-card'?item.value:item.label);copy(detail,item.detail);copy(row.dataset,String(index+1),'position');
    if(weather){if(!row.weatherIcon){row.weatherIcon=make('img');row.weatherIcon.alt='';row.weatherDecoration=make('dd');row.weatherDecoration.setAttribute('aria-hidden','true');row.weatherDecoration.append(row.weatherIcon);row.append(row.weatherDecoration);}copy(row.weatherIcon,`assets/icons/${weatherIcons[item.detail]}.svg`,'src');copy(row.weatherIcon,false,'hidden');copy(row.weatherDecoration,false,'hidden');}
    else if(row.weatherIcon){copy(row.weatherIcon,true,'hidden');copy(row.weatherDecoration,true,'hidden');}
   });
  }
  copy(this.sources,d.historical===true,'hidden');if(d.historical===true)copy(this.sources,false,'open');
  this.reconcile(this.sourceList,this.sourceNodes,content.sources,()=>{const li=make('li');const a=make('a');a.target='_blank';a.rel='noopener noreferrer';li.append(a,make('p'));return li;},(li,s)=>{const owner=s.kind==='owner_receipt';if((li.children[0].tagName==='BUTTON')!==owner){const control=make(owner?'button':'a');if(owner){control.type='button';control.className='text-control';applyKitComponent(control,'button',{variant:'secondary'});control.addEventListener('click',()=>{if(this.data.historical===true||control.disabled)return;control.dispatchEvent(new CustomEvent('owner-source',{bubbles:true,composed:true,detail:{receiptId:li.dataset.receiptId}}));});}else{control.target='_blank';control.rel='noopener noreferrer';}li.children[0].replaceWith(control);}copy(li.children[0],s.label);if(owner)copy(li.children[0],d.historical===true||['offline','loading','pending'].includes(state),'disabled');copy(li.dataset,owner?s.receiptId:'','receiptId');if(!owner){if(d.historical===true)copy(li.children[0],null,'href','attribute');else copy(li.children[0],s.url,'href','attribute');}copy(li.children[1],owner?(s.scope==='conversation_answer'?'AI-forklaring':'Modtaget værktøjsresultat'):s.scope);});
 }
}
for(const family of visualFamilies)customElements.define(`pv-${family}`,class extends VisualComponent{});
