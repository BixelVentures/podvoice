// Strip mode for weak wall screens. A Frameo frame (RK3126, Android 6, WebView/Chrome 107) scrolled
// at 14–24 fps with 1.5–2.2 s freezes because the main thread was busy with decoration. Strip mode
// keeps every function and text but drops scroll-edge fades, motion and painted effects.
// Chrome before 111 is the automatic signal: it is also missing color-mix() and is only found on
// old Android WebViews today. localStorage['podview.lite'] = '1' / '0' forces it per screen.
export const LITE_KEY = 'podview.lite';

export function liteMode({
  storage = globalThis.localStorage,
  userAgent = globalThis.navigator?.userAgent || '',
} = {}) {
  let forced = null;
  try {
    forced = storage?.getItem(LITE_KEY) ?? null;
  } catch {
    forced = null;
  }
  if (forced === '1') return true;
  if (forced === '0') return false;
  const chrome = /Chrome\/(\d+)/.exec(userAgent);
  return Boolean(chrome) && Number(chrome[1]) < 111;
}

// Applies strip mode to a document: CSS hook, no zoom, and every Web Animation finishing at once.
// Instant (duration 0) animations still resolve `finished` and fire their events, so code that waits
// for an animation keeps working; only the motion itself is gone.
export function applyLiteMode(doc = globalThis.document) {
  doc.documentElement.setAttribute('data-lite', '');
  const viewport = doc.querySelector('meta[name="viewport"]');
  const content = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no';
  viewport?.setAttribute('content', content); // index.html always declares one.
  const proto = doc.defaultView?.Element?.prototype;
  if (typeof proto?.animate !== 'function' || proto.animate.podviewLite) return;
  const animate = proto.animate;
  const instant = function (keyframes, options) {
    const timing = typeof options === 'object' && options ? { ...options } : {};
    Object.assign(timing, { duration: 0, delay: 0, endDelay: 0 });
    return animate.call(this, keyframes, timing);
  };
  instant.podviewLite = true;
  proto.animate = instant;
}
