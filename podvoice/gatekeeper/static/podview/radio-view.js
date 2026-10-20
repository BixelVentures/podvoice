import {stations,radioStation} from './radio-model.js';

// Editorial channel descriptions, not live programme metadata.
// Source: https://kum.dk/kulturomraader/film-og-medier/public-service (19 Oct 2026).
const DESCRIPTIONS={'p3':'Musik og underholdning','p1':'Nyheder og samtaler','p4-ostjylland':'Musik og regionalt indhold','p6-beat':'Alternativ musik','p8-jazz':'Jazz'};

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
   this.render({...this.state,stationId:station.id,playing:null});
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
 render({live=true,connected=false,stationId=null,playing=null}={}){
  if(!this.list)this.build();
  const selected=live?null:radioStation(stationId)?.id??null,playback=selected&&typeof playing==='boolean'?playing:null;
  const signature=JSON.stringify([live,connected,selected,playback]);
  if(this.renderSignature===signature)return this;
  this.renderSignature=signature;this.state={live,connected,stationId:selected,playing:playback};
  const selectable=live===false&&connected===true;
  this.subtitle.textContent=selectable?(selected?`${radioStation(selected).label} · ${playback===false?'På pause':playback===true?'Spiller':'Valgt'}`:'Vælg en station'):!connected?'Forbindelsen mangler. Dine stationer bliver her.':'Radioafspilning er ikke tilsluttet endnu.';
  this.list.data={
   items:stations.map(({id,label})=>({id,label,detail:(selected===id?(playback===true?'Spiller · ':playback===false?'På pause · ':'Valgt · '):'')+DESCRIPTIONS[id],icon:`radio-${id}`,current:selected===id&&playback===true})),selected,
   connected:selectable,state:selectable?'ready':connected?'unsupported':'offline',
   stateText:'',quietStatus:true,
  };
  return this;
 }
 destroy(){this.root.removeEventListener('pv-action',this.handleAction);}
}

export {stations};
