// Shared real-DOM fixture for the radio screen's Vitest suites (ported from the node:test fake DOM in
// tests/podview/root-radio-*.test.mjs).
import {RadioView} from './RadioView';

export function shell(){
 document.body.innerHTML='<section id="radio-view" class="response-widget" aria-label="Radio"></section>';
 return document.getElementById('radio-view');
}
export function fixture(){
 const root=shell(),calls=[];
 const view=new RadioView(root,{onSelect:(id,station)=>calls.push([id,station])});
 return {root,view,calls};
}
// A pv-action from `target` (the choice list, normally), bubbling as the real one does. True when the radio view
// stopped it, like the old fake's emit().
export function emit(root,detail,target){
 let reached=false;const outside=()=>{reached=true;};
 document.addEventListener('pv-action',outside);
 try{target.dispatchEvent(new CustomEvent('pv-action',{bubbles:true,composed:true,detail}));}
 finally{document.removeEventListener('pv-action',outside);}
 return !reached;
}
