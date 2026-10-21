// Fades indicate actual remaining scroll, never a permanent decorative overlay.
const SELECTORS='.responses, #weather-view, .weather-hours, .answer-scroll, #queue, #music-response .expandable, #device-view, #device-detail, .device-history, #vehicle-view, #radio-view, #timers-view, #music-detail, #music-response, #now-view .now-activities, .live-music-list';
export function scrollEdgeState({position,viewport,content,threshold=1}){
 if(!Number.isFinite(position)||!Number.isFinite(viewport)||!Number.isFinite(content)||viewport<=0)return '';
 const maxPosition=Math.max(0,content-viewport),current=Math.min(maxPosition,Math.max(0,position));
 return maxPosition>1?[current>threshold?'start':'',current<maxPosition-threshold?'end':''].filter(Boolean).join(' '):'';
}
export class ScrollEdges {
 constructor(host){this.host=host;this.nodes=new Map();this.onChange=()=>this.refresh(false);this.discoveryDirty=true;}
 attach(){if(this.resize)return;this.resize=new ResizeObserver(this.onChange);this.mutations=new MutationObserver(records=>this.refresh(records.length===0||records.some(record=>record.type==='childList'||record.attributeName==='class')));
  // The canonical player dialog is a body sibling, not a child of WidgetHost.
  // Observe its real queue with the same owner, including native open/close.
  const detail=this.host.ownerDocument?.getElementById('music-detail');this.roots=[this.host];if(detail&&!this.host.contains(detail))this.roots.push(detail);
  for(const root of this.roots){this.mutations.observe(root,{childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open'],subtree:true});this.resize.observe(root);root.addEventListener('load',this.onChange,true);}this.refresh();}
 refresh(discover=true){if(discover)this.discoveryDirty=true;if(this.frame||!this.resize)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.scan();});}
 scan(){
  // Resizing or decoding an image cannot add a scroll container. Only query
  // membership again after DOM/class changes; still measure current geometry.
  const current=this.discoveryDirty?new Set((this.roots||[this.host]).flatMap(root=>[...root.querySelectorAll(SELECTORS)])):new Set(this.nodes.keys());
  this.discoveryDirty=false;
  // Snapshot all layout before applying edge attributes: these attributes can
  // affect styles, so alternating reads/writes forces layout during navigation.
  const measurements=[...current].map(node=>[node,this.read(node)]);
  for(const [node,listener] of this.nodes)if(!current.has(node)){node.removeEventListener('scroll',listener);this.resize.unobserve(node);if(node.dataset.scrollAxis!==undefined)delete node.dataset.scrollAxis;if(node.dataset.scrollEdge!==undefined)delete node.dataset.scrollEdge;this.nodes.delete(node);}
  for(const [node,measurement] of measurements){if(!this.nodes.has(node)){const listener=()=>this.measure(node);node.addEventListener('scroll',listener,{passive:true});this.resize.observe(node);this.nodes.set(node,listener);}this.apply(node,measurement);}
 }
 measure(node){this.apply(node,this.read(node));}
 read(node){
  const style=getComputedStyle(node),horizontal=node.classList.contains('weather-hours')||style.scrollSnapType.startsWith('x'),overflow=horizontal?style.overflowX:style.overflowY;
  if(!['auto','scroll','overlay'].includes(overflow))return null;
  const axis=horizontal?'x':'y';
  const value=node.getClientRects().length?scrollEdgeState(horizontal?{position:node.scrollLeft,viewport:node.clientWidth,content:node.scrollWidth}:{position:node.scrollTop,viewport:node.clientHeight,content:node.scrollHeight,threshold:8}):'';
  return {axis,value};
 }
 apply(node,measurement){
  if(!measurement){if(node.dataset.scrollAxis!==undefined)delete node.dataset.scrollAxis;if(node.dataset.scrollEdge!==undefined)delete node.dataset.scrollEdge;return;}
  const {axis,value}=measurement;
  if(node.dataset.scrollAxis!==axis)node.dataset.scrollAxis=axis;
  if(node.dataset.scrollEdge!==value)node.dataset.scrollEdge=value;
 }
 detach(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.resize?.disconnect();this.resize=null;this.mutations?.disconnect();this.mutations=null;for(const root of this.roots||[this.host])root.removeEventListener('load',this.onChange,true);this.roots=[];for(const [node,listener] of this.nodes){node.removeEventListener('scroll',listener);if(node.dataset.scrollAxis!==undefined)delete node.dataset.scrollAxis;if(node.dataset.scrollEdge!==undefined)delete node.dataset.scrollEdge;}this.nodes.clear();}
}
