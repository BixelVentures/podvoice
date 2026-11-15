// PodView has one layout: the 1180×820 wall-iPad canvas. Whatever frame HA gives the page
// (sidebar, header, safe areas, portrait), the stage is scaled uniformly, centred and letterboxed.
export const STAGE_WIDTH=1180,STAGE_HEIGHT=820;
export function stageGeometry(width,height,inset={top:0,right:0,bottom:0,left:0}){
 const w=Math.max(1,width-inset.left-inset.right),h=Math.max(1,height-inset.top-inset.bottom);
 const scale=Math.min(w/STAGE_WIDTH,h/STAGE_HEIGHT);
 return {scale,x:inset.left+(w-STAGE_WIDTH*scale)/2,y:inset.top+(h-STAGE_HEIGHT*scale)/2};
}
export function installStage(win=globalThis.window){
 const doc=win?.document,root=doc?.documentElement;if(!root||root.dataset.pvStage!==undefined)return;
 root.dataset.pvStage='';
 // iPadOS safe areas come from env() on the root (ui-kit.css), so the stage never sits under them.
 const inset=()=>{const style=win.getComputedStyle(root),px=name=>parseFloat(style.getPropertyValue(name))||0;
  return {top:px('--pv-safe-top'),right:px('--pv-safe-right'),
   bottom:px('--pv-safe-bottom'),left:px('--pv-safe-left')};};
 let last='';
 const apply=()=>{const g=stageGeometry(root.clientWidth||win.innerWidth,root.clientHeight||win.innerHeight,inset());
  const next=`${g.scale}|${g.x}|${g.y}`;if(next===last)return;last=next;
  root.style.setProperty('--pv-stage-scale',String(g.scale));
  root.style.setProperty('--pv-stage-x',`${g.x}px`);root.style.setProperty('--pv-stage-y',`${g.y}px`);};
 apply();win.addEventListener('resize',apply);win.visualViewport?.addEventListener?.('resize',apply);
 win.addEventListener('orientationchange',apply);
}
installStage();
