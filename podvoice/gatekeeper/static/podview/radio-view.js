import {createKitComponent,applyKitTemplate} from './ui/kit.js';
import {stations,radioStation} from './radio-model.js';

// Editorial channel descriptions, not live programme metadata.
// Source: https://kum.dk/kulturomraader/film-og-medier/public-service (19 Oct 2026).
const DESCRIPTIONS={'p3':'Musik og underholdning','p1':'Nyheder og samtaler','p4-ostjylland':'Musik og regionalt indhold','p6-beat':'Alternativ musik','p8-jazz':'Jazz'};

// The parent owns navigation and the shared right-hand PlayerView. This view
// only reports an explicit, local station choice; it never starts playback.
export class RadioView{
 constructor(root,{onSelect=()=>{},onOpenPlayer=()=>{}}={}){
  this.root=root;applyKitTemplate(root,'detail');
  this.onSelect=onSelect;this.onOpenPlayer=onOpenPlayer;
  this.state={live:true,connected:false,blocked:false,stationId:null};
  this.handleAction=event=>{
   if(event.target!==this.list||event.detail?.action_id!=='choose')return;
   event.stopPropagation();
   if(this.state.live!==false||this.state.connected!==true||this.state.blocked)return;
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
  header.className='response-heading pv-topbar';header.dataset.detailZone='header';
  copy.dataset.customize='radio';
  title.textContent='Radio';
  subtitle.textContent='Vælg en station';
  copy.append(title,subtitle);header.append(copy);
  const list=doc.createElement('pv-choice-list');
  list.setAttribute('aria-label','Radiostationer');list.className='radio-station-tiles pv-tiles';list.dataset.detailZone='controls';
  const hero=createKitComponent('hero',{document:doc,tag:'section',className:'radio-hero pv-hero',identity:'neutral',variant:'message',label:'Radio'});hero.dataset.detailZone='hero';hero.dataset.kitDensity='compact';this.stationArt=doc.createElement('img');this.stationArt.className='radio-hero-art';this.stationArt.dataset.kitSlot='icon';this.stationArt.alt='';this.stationArt.width=96;this.stationArt.height=96;this.stationTitle=doc.createElement('h2');this.stationTitle.dataset.kitSlot='title';this.stationStatus=doc.createElement('p');this.stationStatus.className='pv-meta';this.stationStatus.dataset.kitSlot='body';const stationCopy=doc.createElement('div');stationCopy.dataset.kitSlot='copy';stationCopy.append(this.stationTitle,this.stationStatus);hero.append(this.stationArt,stationCopy);this.hero=hero;this.playerButton=createKitComponent('listrow',{document:doc,tag:'button',className:'radio-open-player pv-button',label:'Se afspiller'});this.playerButton.textContent='Se afspiller';this.playerButton.type='button';this.playerButton.hidden=true;this.openPlayer=()=>{if(this.playerButton.hidden||!this.state.stationId)return;this.onOpenPlayer();};this.playerButton.addEventListener('click',this.openPlayer);this.root.replaceChildren(header,hero,list,this.playerButton);
  this.header=header;this.subtitle=subtitle;this.list=list;
 }
 render({live=true,connected=false,blocked=false,stationId=null,playing=null}={}){
  if(!this.list)this.build();
  const selected=live?null:radioStation(stationId)?.id??null,playback=selected&&typeof playing==='boolean'?playing:null;
  const signature=JSON.stringify([live,connected,blocked,selected,playback]);
  if(this.renderSignature===signature)return this;
  this.renderSignature=signature;this.state={live,connected,blocked,stationId:selected,playing:playback};
  const selectable=live===false&&connected===true&&!blocked;
  this.subtitle.textContent=selectable?'Vælg eller skift station nedenfor.':blocked?'Adgang afvist. Dine stationer er bevaret. Kontrollér adgangen i Home Assistant.':!connected?'Ikke forbundet. Dine stationer er bevaret. Kontrollér forbindelsen i Home Assistant.':'Radioafspilning er endnu ikke tilgængelig via Home Assistant.';
  // Station identity belongs to the selected Tile and retained PlayerView.
  // This Hero remains the same introduction before and after a local choice.
  this.hero.dataset.kitState=selectable?'ready':'empty';this.stationArt.src='assets/icons/boombox.svg';this.stationTitle.textContent=selectable?'Vælg radiostation':'Radio';this.stationStatus.textContent=selectable?'Vælg eller skift station nedenfor.':this.subtitle.textContent;this.playerButton.hidden=true;this.list.data={
   items:stations.map(({id,label})=>({id,label,detail:(selected===id?(playback===true?'Valgt · ':playback===false?'På pause · ':'Valgt · '):'')+DESCRIPTIONS[id],icon:`radio-${id}`,current:false})),selected,
   connected:selectable,state:selectable?'ready':blocked||connected?'unsupported':'offline',
   stateText:'',quietStatus:true,
  };
  return this;
 }
 destroy(){this.root.removeEventListener('pv-action',this.handleAction);this.playerButton?.removeEventListener('click',this.openPlayer);}
}

export {stations};
