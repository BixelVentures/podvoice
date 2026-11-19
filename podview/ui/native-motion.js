// The one place PodView imports Motion (npm `motion`, MIT; provenance in motion.source.txt). Only bundled code may
// import this module: the unbundled pages (scenes, workshop, ordbog) cannot resolve the bare specifier.
// Motion's spring() solves Apple's duration/bounce model (docs/MOTION.md) and renders it as a CSS linear() easing.
// WebKit with Core Animation (the iPad) does not accelerate an animation whose easing is linear() with points
// (KeyframeEffect::canBeAccelerated): it would run on the main thread, a style recalc every frame. springFrames()
// turns the same curve into plain keyframes with linear easing between them, which Core Animation and Chromium both
// run on the compositor. springTiming() stays for CSS tokens and for code that has not moved yet.
import {spring} from 'motion';

const timings=new Map(),curves=new Map();
// {duration, bounce} (SPRING in ui/motion.js) -> {duration:ms, easing:'linear(...)'}.
export function springTiming({duration,bounce=0}){
 const key=`${duration}|${bounce}`;
 if(!timings.has(key)){
  const css=String(spring(duration,bounce)),gap=css.indexOf(' ');
  timings.set(key,Object.freeze({duration:Number.parseFloat(css.slice(0,gap)),easing:css.slice(gap+1)}));
 }
 return timings.get(key);
}
// The points of a CSS linear() easing as [time 0..1, progress] pairs. A point without a position is spaced evenly
// between its neighbours, as CSS does.
export function linearPoints(easing){
 const body=/^linear\((.*)\)$/.exec(String(easing).trim())?.[1];
 if(!body)return [[0,0],[1,1]];
 const points=body.split(',').map(part=>{
  const [value,at]=part.trim().split(/\s+/);
  return [at===undefined?null:Number.parseFloat(at)/100,Number.parseFloat(value)];
 });
 if(points[0][0]===null)points[0][0]=0;
 if(points.at(-1)[0]===null)points.at(-1)[0]=1;
 for(let i=1;i<points.length;i++){
  if(points[i][0]!==null)continue;
  let j=i;while(points[j][0]===null)j++;
  const start=points[i-1][0],step=(points[j][0]-start)/(j-i+1);
  for(let k=i;k<j;k++)points[k][0]=start+step*(k-i+1);
 }
 return points;
}
// A spring as Web Animations keyframes. frameAt(progress) builds the keyframe for a progress: 0 at the start, 1 at
// rest (a bouncy spring passes 1 on the way). Returns {keyframes, duration}; leave the animation's easing linear.
export function springFrames(spec,frameAt){
 const {duration,easing}=springTiming(spec),key=`${spec.duration}|${spec.bounce||0}`;
 if(!curves.has(key))curves.set(key,Object.freeze(linearPoints(easing).map(point=>Object.freeze(point))));
 const keyframes=curves.get(key).map(([offset,progress])=>({...frameAt(progress),offset}));
 return {keyframes,duration};
}
