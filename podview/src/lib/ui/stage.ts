// PodView has one layout: the 1180×820 wall-iPad canvas. Whatever frame HA gives the page (status bar, sidebar,
// header, safe areas, portrait), the stage keeps the canvas scale that fits and is centred in the frame on the page's
// background colour (docs/PODVIEW-PARITY.md, decision 9): a wider or taller frame never shows a stray strip of
// stretched layout. Safe areas do not move the stage (Ro's photo runs under the status bar); they come back as
// --pv-safe-*-s in stage px, and the topbar and the content keep clear of them.

export const STAGE_WIDTH = 1180;
export const STAGE_HEIGHT = 820;

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function stageGeometry(width: number, height: number, inset: Inset = {top: 0, right: 0, bottom: 0, left: 0}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  // Safe areas never shrink the scale: at 1180×820 the stage stays exactly 1:1 (no transform on <body>, crisp text,
  // cheap compositing); the home indicator and status bar are absorbed by the layout's own top/bottom air.
  const scale = Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT);
  return {
    scale,
    x: (w - STAGE_WIDTH * scale) / 2,
    y: (h - STAGE_HEIGHT * scale) / 2,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    safe: {top: inset.top / scale, right: inset.right / scale, bottom: inset.bottom / scale, left: inset.left / scale},
  };
}

export function installStage(win: Window = window) {
  const root = win.document.documentElement;
  if (root.dataset.pvStage !== undefined) return;
  root.dataset.pvStage = '';
  // The safe areas: --pv-safe-* on the root (styles/app.css maps HA's --safe-area-inset-*); 'pv-safe-area' asks for a
  // new reading.
  const inset = (): Inset => {
    const style = win.getComputedStyle(root);
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
    return {top: px('--pv-safe-top'), right: px('--pv-safe-right'), bottom: px('--pv-safe-bottom'),
      left: px('--pv-safe-left')};
  };
  let last = '';
  const apply = () => {
    const g = stageGeometry(root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight, inset());
    const next = `${String(g.scale)}|${String(g.width)}|${String(g.height)}|${String(Object.values(g.safe))}`;
    if (next === last) return;
    last = next;
    root.style.setProperty('--pv-stage-scale', String(g.scale));
    root.style.setProperty('--pv-stage-x', `${String(g.x)}px`);
    root.style.setProperty('--pv-stage-y', `${String(g.y)}px`);
    root.style.setProperty('--pv-stage-w', `${String(g.width)}px`);
    root.style.setProperty('--pv-stage-h', `${String(g.height)}px`);
    for (const side of ['top', 'right', 'bottom', 'left'] as const)
      root.style.setProperty(`--pv-safe-${side}-s`, `${String(g.safe[side])}px`);
    // At exactly 1:1 the body carries no transform at all (styles/app.css), so nothing is composited for the stage.
    root.dataset.pvStage = g.scale === 1 ? 'flat' : '';
  };
  apply();
  win.addEventListener('resize', apply);
  win.visualViewport?.addEventListener('resize', apply);
  win.addEventListener('orientationchange', apply);
  win.addEventListener('pv-safe-area', apply);
}

