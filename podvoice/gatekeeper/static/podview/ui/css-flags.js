// Page-wide conditions the stylesheet reacts to, written as attributes on the element a rule is about.
// A :has() anchored on html, body, the host or the frame makes WebKit and Blink re-match the whole page each
// time anything inside changes (a hidden page, a scroll fade, a toast). An attribute that only flips when the
// condition flips invalidates just the elements the rule styles. Each flag is the exact former :has() argument.
import {pressOnly} from './scroll-edges.js';

// [anchor, attribute, the former :has() argument]
export const CSS_FLAGS=[
 ['root','data-pv-rest-night','pv-widget-host[data-view=rest][data-night=true]'],
 ['body','data-pv-rest-night','pv-widget-host[data-view=rest][data-night=true]'],
 ['body','data-pv-rest',':scope>pv-widget-host[data-view=rest]'],
 ['body','data-pv-rest-host','pv-widget-host[data-view=rest]'],
 ['body','data-pv-topbar-active',':scope>pv-widget-host[data-topbar=true][data-view=active]'],
 ['body','data-pv-action-feedback','.action-feedback:not([hidden])'],
 ['body','data-pv-timer-alert','#timer-alert:not([hidden])'],
 ['body','data-pv-connecting','.connection-note[data-state=connecting]'],
 ['body','data-pv-playback-status','#playback-status:not([hidden])'],
 ['host','data-pv-connection-note',':scope>.connection-note:not([hidden])'],
 ['host','data-pv-rail-preview','#resource-rail:not([hidden])>.resource-preview:not([hidden])'],
 ['host','data-pv-recipes','#recipe-view:not([hidden])'],
 ['host','data-pv-scroll-y-start','.responses [data-scroll-axis=y][data-scroll-edge~="start"]'],
 ['frame','data-pv-recipes','#recipe-view:not([hidden])'],
 ['frame','data-pv-scroll-y-start','.responses [data-scroll-axis=y][data-scroll-edge~="start"]'],
 ['frame','data-pv-scroll-y-end','.responses [data-scroll-axis=y][data-scroll-edge~="end"]'],
 ['frame','data-pv-fade-start','.responses[data-scroll-edge~="start"],#weather-view:not([hidden])[data-scroll-edge~="start"],'+
  '#music-detail:not([hidden]) #queue[data-scroll-edge~="start"]'],
 ['frame','data-pv-fade-end','.responses[data-scroll-edge~="end"],#weather-view:not([hidden])[data-scroll-edge~="end"],'+
  '#music-detail:not([hidden]) #queue[data-scroll-edge~="end"]'],
 ['frame','data-pv-weather-start','#weather-view:not([hidden])[data-scroll-edge~="start"]'],
];
// Every attribute a flag above reads; class covers .connection-note, .responses and friends.
const WATCHED=['hidden','class','id','data-view','data-night','data-topbar','data-state','data-scroll-axis','data-scroll-edge'];

export class CssFlags {
 constructor(host){this.host=host;}
 attach(){
  if(this.observer)return;const doc=this.host.ownerDocument;
  this.observer=new MutationObserver(records=>{if(records.some(record=>!pressOnly(record)))this.sync();});
  this.observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:WATCHED,
   attributeOldValue:true});
  this.sync();
 }
 anchor(name){
  const doc=this.host.ownerDocument;
  return name==='root'?doc.documentElement:name==='body'?doc.body:name==='host'?this.host:
   this.host.querySelector(':scope>.frame');
 }
 // Called by the host right after a render, so layout read in the same task already sees the new flags.
 sync(){
  for(const [where,attribute,selector] of CSS_FLAGS){
   const anchor=this.anchor(where);if(!anchor)continue;
   const on=anchor.querySelector(selector)!==null;
   if(anchor.hasAttribute(attribute)!==on)anchor.toggleAttribute(attribute,on);
  }
 }
 detach(){this.observer?.disconnect();this.observer=null;}
}
