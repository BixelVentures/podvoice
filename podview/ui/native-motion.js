// The one place PodView imports Motion (npm `motion`, MIT; provenance in motion.source.txt). Only bundled code may
// import this module: the unbundled pages (scenes, workshop, ordbog) cannot resolve the bare specifier.
// Motion's spring() solves Apple's duration/bounce model (docs/MOTION.md) and renders it as a CSS linear() easing,
// so a spring runs as a plain Web Animation on the compositor: no JavaScript runs while it plays.
import {spring} from 'motion';

const timings=new Map();
// {duration, bounce} (SPRING in ui/motion.js) -> {duration:ms, easing:'linear(...)'} for element.animate().
export function springTiming({duration,bounce=0}){
 const key=`${duration}|${bounce}`;
 if(!timings.has(key)){
  const css=String(spring(duration,bounce)),gap=css.indexOf(' ');
  timings.set(key,Object.freeze({duration:Number.parseFloat(css.slice(0,gap)),easing:css.slice(gap+1)}));
 }
 return timings.get(key);
}
