import {stations,radioStation} from './radio-model.js';

// The parent owns navigation and the shared right-hand PlayerView. This view
// only reports an explicit, local station choice; it never starts playback.
export class RadioView{
 constructor(root,{onSelect=()=>{}}={}){
  this.root=root;
  this.onSelect=onSelect;
  this.state={live:true,connected:false,stationId:null};
  this.handleAction=event=>{
   if(event.target!==this.list||event.detail?.action_id!=='choose')return;
   event.stopPropagation();
   if(this.state.live!==false||this.state.connected!==true)return;
   const station=radioStation(event.detail.option_id);
   if(!station||station.id===this.state.stationId)return;
   this.render({...this.state,stationId:station.id});
   this.onSelect(station.id,station);
  };
  root.addEventListener('pv-action',this.handleAction);
 }
 build(){
  const doc=this.root.ownerDocument||document;
  const header=doc.createElement('header'),copy=doc.createElement('div'),title=doc.createElement('h1'),subtitle=doc.createElement('p');
  header.className='response-heading';
  copy.dataset.customize='radio';
  title.textContent='Radio';
  subtitle.textContent='Vælg en station';
  copy.append(title,subtitle);header.append(copy);
  const list=doc.createElement('pv-choice-list');
  list.setAttribute('aria-label','Radiostationer');
  this.root.replaceChildren(header,list);
  this.header=header;this.subtitle=subtitle;this.list=list;
 }
 render({live=true,connected=false,stationId=null}={}){
  if(!this.list)this.build();
  const selected=radioStation(stationId)?.id??null;
  this.state={live,connected,stationId:selected};
  const selectable=live===false&&connected===true;
  this.subtitle.textContent=selectable?'Vælg en station':'Stationerne kan ses, men afspilning er ikke forbundet.';
  this.list.data={
   items:stations.map(({id,label})=>({id,label})),selected,
   connected:selectable,state:selectable?'ready':'unsupported',
   stateText:selectable?'':'Radioafspilning er ikke forbundet endnu.',
  };
  return this;
 }
 destroy(){this.root.removeEventListener('pv-action',this.handleAction);}
}

export {stations};
