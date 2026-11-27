// The lock watchdog: a tap that lands on something the eye cannot see (opacity under .05 along its ancestors) and
// that is still unseen and still a target a moment later (longer than any fade or spring in the product) is a layer
// that swallows taps: the panel is locked. It is reported as a console error (the journeys fail on console errors)
// and counted on window.__podviewLocks; it never changes what the tap does. A layer arriving (Ro or a dialog fading
// in) is visible by then and is no lock.
export const INVISIBLE = 0.05;
export const LOCK_CHECK_MS = 700;

export function drawnOpacity(node: Element | null): number {
  let opacity = 1;
  for (let at = node; at; at = at.parentElement) {
    const value = Number.parseFloat(getComputedStyle(at).opacity);
    if (Number.isFinite(value)) opacity *= value;
    if (opacity < INVISIBLE) return opacity;
  }
  return opacity;
}

function targetable(node: Element): boolean {
  if (!node.isConnected || node.closest('[inert]')) return false;
  return getComputedStyle(node).pointerEvents !== 'none';
}

function describe(node: Element): string {
  const layer = node.closest('[data-screen],[data-rest],[role=dialog],[role=alertdialog]');
  const name = (element: Element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`;
  return layer ? `${name(node)} in ${name(layer)}${[...layer.attributes].filter(a => a.name.startsWith('data-'))
    .map(a => `[${a.name}=${a.value}]`).join('')}` : name(node);
}

declare global {
  interface Window {
    __podviewLocks?: string[];
  }
}

export function installHitGuard(win: Window = window): () => void {
  const down = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || drawnOpacity(target) >= INVISIBLE) return;
    win.setTimeout(() => {
      if (!targetable(target) || drawnOpacity(target) >= INVISIBLE) return;
      const what = describe(target);
      (win.__podviewLocks ??= []).push(what);
      console.error(`[podview] lock: an invisible layer took a tap (${what})`);
    }, LOCK_CHECK_MS);
  };
  win.addEventListener('pointerdown', down, {capture: true, passive: true});
  win.addEventListener('touchstart', down, {capture: true, passive: true});
  return () => {
    win.removeEventListener('pointerdown', down, {capture: true});
    win.removeEventListener('touchstart', down, {capture: true});
  };
}
