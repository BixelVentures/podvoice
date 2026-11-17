// P4 list (docs/MOTION.md): rows that come, go and change places, as Web Animations on Motion's springs. mutate()
// changes the container's rows; every visible box is read before and after it (all reads before any write) and the
// difference of their centres animates on the translate property (a button's :active rule holds transform). New
// rows enter from 8px below on the snappy spring, 30 ms apart for the first five; removed rows leave where they
// stood (opacity and .98 scale in --pv-dur-quick) while their neighbours close the gap on the smooth spring. `track`
// names one element (the playing indicator) that travels from its old box to its new one, even into another row.
// A row still moving is measured where it is and continues from there. Reduced: rows fade in and out; a reorder is
// immediate. Only bundled code imports this module (Motion).
import {DUR,EASE,SPRING,isReduced} from './motion.js';
import {springTiming} from './native-motion.js';

const running=new WeakMap();
const centreShift=(from,to)=>({dx:from.x+from.width/2-to.x-to.width/2,dy:from.y+from.height/2-to.y-to.height/2});
function play(node,frames,options){
 running.get(node)?.cancel();
 const animation=node.animate(frames,options);running.set(node,animation);
 animation.finished?.catch(()=>{}).finally(()=>{if(running.get(node)===animation)running.delete(node);});
 return animation;
}
// A removed row is put back where it stood, out of the flow and out of reach, and fades away.
function leave(container,node,box,frame,reduced){
 if(typeof node.animate!=='function'||!box.width||!box.height)return;
 const left=box.x-frame.x-(container.clientLeft||0)+(container.scrollLeft||0);
 const top=box.y-frame.y-(container.clientTop||0)+(container.scrollTop||0);
 node.dataset.pvLeave='';node.inert=true;node.setAttribute?.('aria-hidden','true');
 Object.assign(node.style,{position:'absolute',left:`${left}px`,top:`${top}px`,width:`${box.width}px`,
  height:`${box.height}px`,margin:'0',pointerEvents:'none'});
 container.append(node);
 const frames=reduced?[{opacity:1},{opacity:0}]:[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.98)'}];
 const animation=play(node,frames,{duration:reduced?DUR.reduced:DUR.quick,easing:EASE.in,fill:'forwards'});
 animation.finished?.catch(()=>{}).finally(()=>{
  if(node.parentNode===container&&node.dataset.pvLeave!==undefined)node.remove();});
}
export function animateList(container,mutate,{items=':scope>*',stagger=30,track,reduced=isReduced(container)}={}){
 if(!container?.isConnected||!container.getClientRects?.().length){mutate();return;}
 const rows=()=>[...container.querySelectorAll(items)].filter(node=>node.dataset?.pvLeave===undefined);
 const before=new Map(rows().map(node=>[node,node.getBoundingClientRect()]));
 const trackBefore=track?container.querySelector(track)?.getBoundingClientRect():null;
 mutate();
 const after=rows().filter(node=>node.getClientRects().length),frame=container.getBoundingClientRect();
 const boxes=new Map(after.map(node=>[node,node.getBoundingClientRect()]));
 const trackNode=track?container.querySelector(track):null,trackAfter=trackNode?.getBoundingClientRect();
 const leaving=[...before].filter(([node])=>node.parentNode!==container);
 const snappy=springTiming(SPRING.snappy),smooth=springTiming(SPRING.smooth),shift=new Map();let entered=0;
 for(const [node,box]of boxes){
  const old=before.get(node);
  if(!old){
   const delay=Math.min(entered++,5)*stagger;
   play(node,reduced?[{opacity:0},{opacity:1}]:[{opacity:0,translate:'0 8px'},{opacity:1,translate:'0 0'}],
    reduced?{duration:DUR.reduced,easing:EASE.out,delay,fill:'backwards'}:{...snappy,delay,fill:'backwards'});
   continue;
  }
  if(reduced)continue;
  const {dx,dy}=centreShift(old,box);
  if(Math.abs(dx)+Math.abs(dy)<=.5)continue;
  shift.set(node,{dx,dy});
  play(node,[{translate:`${dx}px ${dy}px`},{translate:'0 0'}],smooth);
 }
 for(const [node,box]of leaving)leave(container,node,box,frame,reduced);
 if(trackNode&&trackBefore&&trackAfter&&!reduced){
  const owner=after.find(node=>node.contains?.(trackNode)),carried=shift.get(owner)||{dx:0,dy:0};
  const travel=centreShift(trackBefore,trackAfter),dx=travel.dx-carried.dx,dy=travel.dy-carried.dy;
  if(Math.abs(dx)+Math.abs(dy)>.5)play(trackNode,[{translate:`${dx}px ${dy}px`},{translate:'0 0'}],smooth);
 }
}
