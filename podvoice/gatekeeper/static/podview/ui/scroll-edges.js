// Fades indicate actual remaining scroll, never a permanent decorative overlay.
const SELECTORS='.responses, .weather-hours, .answer-scroll, #queue, #music-response .expandable, #device-view, #now-view .now-activities, .live-music-list';
export function scrollEdgeState({position,viewport,content}){
 if(!Number.isFinite(position)||!Number.isFinite(viewport)||!Number.isFinite(content)||viewport<=0)return '';
 const maxPosition=Math.max(0,content-viewport),current=Math.min(maxPosition,Math.max(0,position));
 return maxPosition>1?[current>1?'start':'',current<maxPosition-1?'end':''].filter(Boolean).join(' '):'';
}
export class ScrollEdges {
 constructor(host){this.host=host;this.nodes=new Map();this.onChange=()=>this.refresh();}
 attach(){if(this.resize)return;this.resize=new ResizeObserver(this.onChange);this.mutations=new MutationObserver(this.onChange);this.mutations.observe(this.host,{childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open'],subtree:true});this.resize.observe(this.host);this.host.addEventListener('load',this.onChange,true);this.refresh();}
 refresh(){if(this.frame||!this.resize)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.scan();});}
 scan(){
  const current=new Set(this.host.querySelectorAll(SELECTORS));
  for(const [node,listener] of this.nodes)if(!current.has(node)){node.removeEventListener('scroll',listener);this.resize.unobserve(node);delete node.dataset.scrollAxis;delete node.dataset.scrollEdge;this.nodes.delete(node);}
  for(const node of current){if(!this.nodes.has(node)){const listener=()=>this.measure(node);node.addEventListener('scroll',listener,{passive:true});this.resize.observe(node);this.nodes.set(node,listener);}this.measure(node);}
 }
 measure(node){
  const style=getComputedStyle(node),horizontal=node.classList.contains('weather-hours')||style.scrollSnapType.startsWith('x'),overflow=horizontal?style.overflowX:style.overflowY;
  if(!['auto','scroll','overlay'].includes(overflow)){delete node.dataset.scrollAxis;delete node.dataset.scrollEdge;return;}
  node.dataset.scrollAxis=horizontal?'x':'y';
  const value=node.getClientRects().length?scrollEdgeState(horizontal?{position:node.scrollLeft,viewport:node.clientWidth,content:node.scrollWidth}:{position:node.scrollTop,viewport:node.clientHeight,content:node.scrollHeight}):'';
  if(node.dataset.scrollEdge!==value)node.dataset.scrollEdge=value;
 }
 detach(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.resize?.disconnect();this.resize=null;this.mutations?.disconnect();this.mutations=null;this.host.removeEventListener('load',this.onChange,true);for(const [node,listener] of this.nodes){node.removeEventListener('scroll',listener);delete node.dataset.scrollAxis;delete node.dataset.scrollEdge;}this.nodes.clear();}
}
