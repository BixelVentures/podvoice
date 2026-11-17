// PodView has one layout: the 1180×820 wall-iPad canvas. Whatever frame HA gives the page (status bar,
// sidebar, header, safe areas, portrait), the stage keeps the canvas scale that fits and stretches the
// other direction, so the page always fills the frame edge to edge: never letterboxed. Safe areas do not
// move the stage (Ro's photo runs under the status bar); they come back as --pv-safe-*-s in stage px,
// and the topbar and the content keep clear of them.
export const STAGE_WIDTH=1180,STAGE_HEIGHT=820;
export function stageGeometry(width,height,inset={top:0,right:0,bottom:0,left:0}){
 const w=Math.max(1,width),h=Math.max(1,height);
 const scale=Math.min(Math.max(1,w-inset.left-inset.right)/STAGE_WIDTH,Math.max(1,h-inset.top-inset.bottom)/STAGE_HEIGHT);
 return {scale,x:0,y:0,width:w/scale,height:h/scale,
  safe:{top:inset.top/scale,right:inset.right/scale,bottom:inset.bottom/scale,left:inset.left/scale}};
}
export function installStage(win=globalThis.window){
 const doc=win?.document,root=doc?.documentElement;if(!root||root.dataset.pvStage!==undefined)return;
 root.dataset.pvStage='';
 // iPadOS safe areas come from env() on the root (ui-kit.css) or, inside HA's iframe, from the parent
 // page (ingress-kiosk.js sets --pv-safe-* inline and fires 'pv-safe-area').
 const inset=()=>{const style=win.getComputedStyle(root),px=name=>parseFloat(style.getPropertyValue(name))||0;
  return {top:px('--pv-safe-top'),right:px('--pv-safe-right'),
   bottom:px('--pv-safe-bottom'),left:px('--pv-safe-left')};};
 let last='';
 const apply=()=>{const g=stageGeometry(root.clientWidth||win.innerWidth,root.clientHeight||win.innerHeight,inset());
  const next=`${g.scale}|${g.width}|${g.height}|${Object.values(g.safe)}`;if(next===last)return;last=next;
  root.style.setProperty('--pv-stage-scale',String(g.scale));
  root.style.setProperty('--pv-stage-x',`${g.x}px`);root.style.setProperty('--pv-stage-y',`${g.y}px`);
  root.style.setProperty('--pv-stage-w',`${g.width}px`);root.style.setProperty('--pv-stage-h',`${g.height}px`);
  for(const side of ['top','right','bottom','left'])root.style.setProperty(`--pv-safe-${side}-s`,`${g.safe[side]}px`);
  // At exactly 1:1 the body carries no transform at all (ui-kit.css), so nothing is composited for the stage.
  root.dataset.pvStage=g.scale===1?'flat':'';};
 apply();win.addEventListener('resize',apply);win.visualViewport?.addEventListener?.('resize',apply);
 win.addEventListener('orientationchange',apply);
 win.addEventListener('pv-safe-area',apply);
}
installStage();
