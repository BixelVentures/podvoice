// PodView has one layout: the 1180×820 wall-iPad canvas. Whatever frame HA gives the page (status bar, sidebar,
// header, safe areas, portrait), the stage keeps the canvas scale that fits and is centred in the frame on the page's
// background colour (docs/PODVIEW-PARITY.md, decision 9): a wider or taller frame never shows a stray strip of
// stretched layout. The canvas has fixed placements (the topbar's keys 24 from the top, content 104–796, edges 24),
// so the layout itself never moves for a safe area. The safe areas are taken out of the canvas's own 24 px margins
// instead: the stage may run under a status bar or home indicator (Ro's photo, the topbar's surface) as long as the
// 24 px margin covers it; when an inset is larger than what the margin covers, the whole stage scales down
// uniformly and moves clear of it. Nothing is ever clipped and no content leaves its cell.

export const STAGE_WIDTH = 1180;
export const STAGE_HEIGHT = 820;
// The canvas's margin on every side: the topbar's keys sit 24 from the top, content ends 24 above the bottom, and
// the edges are 24. Only the stage's background lives in it, so a safe area may cover it.
export const STAGE_MARGIN = 24;

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// One axis: the largest scale (≤ fit) at which the stage lies in the frame and its inner box (the stage less its
// margins) lies in the safe part of the frame; then the position nearest the centre that keeps both.
function axis(frame: number, size: number, start: number, end: number, scale: number) {
  return Math.min(scale, (frame - start) / (size - STAGE_MARGIN), (frame - end) / (size - STAGE_MARGIN),
    (frame - start - end) / (size - 2 * STAGE_MARGIN));
}

function place(frame: number, size: number, start: number, end: number, scale: number) {
  const low = Math.max(0, start - STAGE_MARGIN * scale);
  const high = Math.min(frame - size * scale, frame - end - (size - STAGE_MARGIN) * scale);
  const centre = (frame - size * scale) / 2;
  return Math.min(Math.max(centre, low), Math.max(low, high));
}

export function stageGeometry(width: number, height: number, inset: Inset = {top: 0, right: 0, bottom: 0, left: 0}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const t = Math.max(0, inset.top);
  const r = Math.max(0, inset.right);
  const b = Math.max(0, inset.bottom);
  const l = Math.max(0, inset.left);
  // At 1180×820 with insets the margins cover (the wall iPad: 0 top, 20 bottom) the stage stays exactly 1:1 (no
  // transform on <body>, crisp text, cheap compositing).
  let scale = Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT);
  scale = axis(w, STAGE_WIDTH, l, r, scale);
  scale = Math.max(0.01, axis(h, STAGE_HEIGHT, t, b, scale));
  return {
    scale,
    x: place(w, STAGE_WIDTH, l, r, scale),
    y: place(h, STAGE_HEIGHT, t, b, scale),
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
  };
}

export function installStage(win: Window = window) {
  const root = win.document.documentElement;
  if (root.dataset.pvStage !== undefined) return;
  root.dataset.pvStage = '';
  // The safe areas: --pv-safe-* on the root (styles/app.css maps HA's --safe-area-inset-*, which HA copies onto the
  // panel iframe's root); 'pv-safe-area' asks for a new reading.
  const inset = (): Inset => {
    const style = win.getComputedStyle(root);
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
    return {top: px('--pv-safe-top'), right: px('--pv-safe-right'), bottom: px('--pv-safe-bottom'),
      left: px('--pv-safe-left')};
  };
  let last = '';
  const apply = () => {
    const g = stageGeometry(root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight, inset());
    const next = `${String(g.scale)}|${String(g.x)}|${String(g.y)}`;
    if (next === last) return;
    last = next;
    root.style.setProperty('--pv-stage-scale', String(g.scale));
    root.style.setProperty('--pv-stage-x', `${String(g.x)}px`);
    root.style.setProperty('--pv-stage-y', `${String(g.y)}px`);
    root.style.setProperty('--pv-stage-w', `${String(g.width)}px`);
    root.style.setProperty('--pv-stage-h', `${String(g.height)}px`);
    // At exactly 1:1 the body carries no transform at all (styles/app.css), so nothing is composited for the stage.
    root.dataset.pvStage = g.scale === 1 ? 'flat' : '';
  };
  apply();
  win.addEventListener('resize', apply);
  win.visualViewport?.addEventListener('resize', apply);
  win.addEventListener('orientationchange', apply);
  win.addEventListener('pv-safe-area', apply);
}

