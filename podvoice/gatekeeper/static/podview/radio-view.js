import {createKitComponent,applyKitTemplate} from './ui/kit.js';
import {stations,radioStation} from './radio-model.js';

// Editorial channel descriptions, not live programme metadata.
// Source: https://kum.dk/kulturomraader/film-og-medier/public-service (19 Oct 2026).
const DESCRIPTIONS={'p3':'Musik og underholdning','p1':'Nyheder og samtaler','p4-ostjylland':'Musik og regionalt indhold','p6-beat':'Alternativ musik','p8-jazz':'Jazz'};
// The scale: 61 ticks (long every 10th, medium every 5th) and one mark per station, evenly spaced.
const TICKS=Array.from({length:61},(_,index)=>index%10===0?96:index%5===0?64:38);
const stationPosition=index=>`${10+index*20}%`;

// The parent owns navigation and the shared right-hand PlayerView. This view
// reports explicit station choices; the source owner alone requests playback.
export class RadioView{
 constructor(root,{onSelect=()=>{},onOpenPlayer=()=>{}}={}){
  this.root=root;applyKitTemplate(root,'detail');
  this.onSelect=onSelect;this.onOpenPlayer=onOpenPlayer;
  this.state={live:true,connected:false,blocked:false,stationId:null};
  this.handleAction=event=>{
   if(event.target!==this.list||event.detail?.action_id!=='choose')return;
   event.stopPropagation();
   if(!this.state.selectable)return;
   const station=radioStation(event.detail.option_id);
   if(!station||station.id===this.state.stationId&&(!this.state.live||this.state.playing===true&&!this.state.pending))return;
   if(!this.state.live)this.render({...this.state,stationId:station.id,playing:null});
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
  this.feedback=createKitComponent('listrow',{document:doc,tag:'p',variant:'feedback'});this.feedback.dataset.kitSlot='feedback';this.feedback.hidden=true;this.feedback.setAttribute('role','status');this.feedback.setAttribute('aria-live','polite');copy.append(title,subtitle);header.append(copy);
  const list=doc.createElement('pv-choice-list');
  list.setAttribute('aria-label','Radiostationer');list.className='radio-station-tiles pv-tiles';list.dataset.detailZone='controls';
  const hero=createKitComponent('hero',{document:doc,tag:'section',className:'radio-hero pv-hero',
   identity:'neutral',variant:'message',label:'Radio'});
  hero.dataset.detailZone='hero';hero.dataset.kitDensity='compact';
  const element=(tag,className)=>{const node=doc.createElement(tag);if(className)node.className=className;return node;};
  this.stationArt=element('img','radio-hero-art');
  this.stationArt.dataset.kitSlot='icon';this.stationArt.alt='';this.stationArt.width=144;this.stationArt.height=144;
  this.stationStatusLine=element('p','radio-hero-status');
  this.stationTitle=element('h2');this.stationTitle.dataset.kitSlot='title';
  this.stationStatus=element('p','pv-meta radio-hero-sub');this.stationStatus.dataset.kitSlot='body';
  const stationCopy=element('div');stationCopy.dataset.kitSlot='copy';
  stationCopy.append(this.stationStatusLine,this.stationTitle,this.stationStatus,this.feedback);
  const top=element('div','radio-hero-top');top.append(this.stationArt,stationCopy);
  this.scale=element('div','radio-scale');this.scale.setAttribute('role','img');
  const ticks=element('div','radio-scale-ticks');
  for(const height of TICKS){
   const tick=element('i','radio-scale-tick');tick.setAttribute('style',`height:${height}px`);ticks.append(tick);
  }
  this.marks=stations.map(({label},index)=>{
   const mark=element('span','radio-scale-mark');mark.textContent=label.split(' ')[0];
   mark.setAttribute('style',`left:${stationPosition(index)}`);return mark;
  });
  this.needle=element('i','radio-scale-needle');this.needle.hidden=true;
  this.scale.append(ticks,...this.marks,this.needle);
  hero.append(top,this.scale);this.hero=hero;
  const stationsHead=element('div','radio-stations-head');
  const stationsTitle=element('h2','radio-stations-title');stationsTitle.textContent='Radiostationer';
  this.speakerLine=element('span','radio-stations-speaker');this.speakerLine.hidden=true;
  stationsHead.append(stationsTitle,this.speakerLine);
  this.playerButton=createKitComponent('listrow',{document:doc,tag:'button',className:'radio-open-player pv-button',label:'Se afspiller'});this.playerButton.textContent='Se afspiller';this.playerButton.type='button';this.playerButton.hidden=true;this.openPlayer=()=>{if(this.playerButton.hidden||!this.state.stationId)return;this.onOpenPlayer();};this.playerButton.addEventListener('click',this.openPlayer);this.root.replaceChildren(header,hero,stationsHead,list,this.playerButton);
  this.header=header;this.subtitle=subtitle;this.list=list;
 }
 render({live=true,connected=false,blocked=false,stationId=null,playing=null,enabled=false,canStart=enabled,pending=false,pendingStationId=null,feedback=null,status='idle',setupIssue=null,speaker=null}={}){
  if(!this.list)this.build();
  const selected=(!live||enabled)?radioStation(stationId)?.id??null:null,playback=selected&&typeof playing==='boolean'?playing:null;
  const signature=JSON.stringify([live,connected,blocked,selected,playback,enabled,canStart,pending,pendingStationId,feedback,status,setupIssue,speaker]);
  if(this.renderSignature===signature)return this;
  this.renderSignature=signature;this.feedback.hidden=!feedback?.message;this.feedback.textContent=feedback?.message||'';this.feedback.dataset.state=feedback?.state||'';this.state={live,connected,blocked,stationId:selected,playing:playback,enabled,canStart,pending,status,selectable:connected===true&&!blocked&&(live===false?!pending:enabled&&canStart)};
  const selectable=this.state.selectable,available=connected===true&&!blocked&&(live===false||enabled);
  const setupMessage=setupIssue==='radio_native_not_configured'
   ?'Radio mangler opsætning. Kontrollér PodConnect-adressen og radiotokenet i PodVoice.'
   :setupIssue==='radio_native_auth_rejected'
    ?'PodConnect afviste radiotokenet. Kontrollér, at Speakers og PodVoice bruger samme radiotoken.'
    :null;
  this.subtitle.textContent=available?'Vælg eller skift station nedenfor.':blocked?'Adgang afvist. Dine stationer er bevaret. Kontrollér adgangen i Home Assistant.':!connected?'Ikke forbundet. Dine stationer er bevaret. Kontrollér forbindelsen i Home Assistant.':setupMessage||'Radioen er ikke klar på højttalerne endnu.';
  const speakerName=typeof speaker==='string'&&speaker.trim()?speaker.trim():null;
  this.renderHero({available,selected,playback,pendingStationId,speaker:speakerName});
  this.playerButton.hidden=true;this.list.data={
   items:stations.map(({id,label})=>({id,label,feedback:'label',loading:pendingStationId===id,detail:pendingStationId===id?'Starter…':(selected===id?(playback===true?'Valgt · ':playback===false?'Stoppet · ':'Valgt · '):'')+DESCRIPTIONS[id],icon:`radio-${id}`,current:false})),selected,
   connected:selectable,state:available?'ready':blocked||connected?'unsupported':'offline',
   stateText:'',quietStatus:true,
  };
  return this;
 }
 // Hero (lærred »A-Radio«): status line, title and description for choose, starting, playing, stopped and
 // not available; the station's logo, colour and needle on the scale follow the station shown.
 renderHero({available,selected,playback,pendingStationId,speaker}){
  const starting=available?radioStation(pendingStationId):null;
  const station=starting||(available?radioStation(selected):null);
  const index=station?stations.findIndex(({id})=>id===station.id):-1;
  const phase=!available?'unavailable':starting?'starting':!station?'choose'
   :playback===true?'playing':playback===false?'stopped':'chosen';
  const lines={
   choose:['Ingen station valgt','Vælg station',`${stations.length} stationer`],
   starting:[`Starter ${station?.label}…`,station?.label,DESCRIPTIONS[station?.id]],
   playing:[speaker?`Spiller på ${speaker}`:'Spiller',station?.label,DESCRIPTIONS[station?.id]],
   stopped:['Stoppet',station?.label,DESCRIPTIONS[station?.id]],
   chosen:['Valgt',station?.label,DESCRIPTIONS[station?.id]],
   unavailable:['Ikke tilgængelig','Radio',this.subtitle.textContent],
  }[phase];
  this.hero.dataset.kitState=available?'ready':'empty';
  if(this.hero.dataset.radioPhase!==phase)this.hero.dataset.radioPhase=phase;
  if(this.stationStatusLine.textContent!==lines[0])this.stationStatusLine.textContent=lines[0];
  if(this.stationTitle.textContent!==lines[1])this.stationTitle.textContent=lines[1];
  if(this.stationStatus.textContent!==lines[2])this.stationStatus.textContent=lines[2];
  // The station colour (hero tint, needle and tile ring) comes from radio CSS keyed by data-radio-station.
  const stationId=station?.id||'';
  if((this.hero.dataset.radioStation||'')!==stationId){
   if(stationId)this.hero.dataset.radioStation=stationId;else delete this.hero.dataset.radioStation;
  }
  const art=station?`assets/radio-${station.id}.svg`:'';
  this.stationArt.hidden=!station;
  if(art&&this.stationArt.getAttribute('src')!==art){
   this.stationArt.src=art;
   // First choice or a new station: the logo pops in (500 ms, slight overshoot) unless motion is reduced.
   const still=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
   if(!still)this.stationArt.animate?.([{opacity:0,transform:'scale(.6) rotate(-6deg)'},{opacity:1,transform:'none'}],
    {duration:500,easing:'cubic-bezier(.2,1.3,.4,1)'});
  }
  this.needle.hidden=!station;
  const needleStyle=station?`left:${stationPosition(index)}`:'';
  if(station&&this.needle.getAttribute('style')!==needleStyle)this.needle.setAttribute('style',needleStyle);
  this.marks.forEach((mark,position)=>{
   const current=String(position===index);if(mark.dataset.current!==current)mark.dataset.current=current;
  });
  const label=station?`Stationsskala, valgt ${station.label}`:'Stationsskala';
  if(this.scale.getAttribute('aria-label')!==label)this.scale.setAttribute('aria-label',label);
  const speakerText=speaker?`Afspilles på ${speaker}`:'';
  if(this.speakerLine.textContent!==speakerText)this.speakerLine.textContent=speakerText;
  this.speakerLine.hidden=!speakerText;
 }
 destroy(){this.root.removeEventListener('pv-action',this.handleAction);this.playerButton?.removeEventListener('click',this.openPlayer);}
}

export {stations};
