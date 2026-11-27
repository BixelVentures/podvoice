// The screen stack (docs/MOTION.md §1, P1). Each mounted screen is a layer with one motion value, `p`: how much it
// is shown (1 shown, 0 not). A change of screen springs the two layers it concerns to their new `p` on the same
// spring at the same moment (TRANSITION.nav), so a tap mid-flight retargets both from where they are, with the
// velocity they have, and push and back are the same motion reversed. Every look (opacity, scale, the growing
// surface) is a function of `p`, written straight to the DOM: nothing re-renders per frame.
//
// Two ways to change screens:
// - »The widget grows« (a Hjem widget opens its screen, like iOS opening an app from its icon): a surface in the
//   widget's tint starts on the widget's exact rect and grows to the screen's area (the 736 column, or all 1132 for
//   a screen without the player). A copy of the widget rides the surface's corner and fades out in the first 40 %;
//   the screen fades in over the surface (with an 8 px settle) in the last 60 %; the rest of Hjem recedes to .1 and
//   .98. Back is the reverse, into the widget's rect as it is then.
// - Everything else (Find musik from the player, Svar, a list row, Tilbage from a screen that did not grow) is a
//   plain cross-fade of the screen above, on the same spring.
// Nothing ever passes over the player column: each screen is clipped to its area, and a screen with the player
// keeps to its 736 column.
//
// Back is the topbar's »Tilbage«; there is no swipe back. Reduced motion: a short cross-fade (TRANSITION.reduced).
//
// A push starts two frames after the tap (the screen was built when the finger landed, data-opens prewarm): its
// first frame and the surface are laid out and painted while nothing moves yet. A back starts at once. A screen that
// is not shown is `inert`: out of the tab order and the accessibility tree.
import {animate, motion, useMotionValue, useReducedMotion} from 'motion/react';
import type {MotionValue} from 'motion/react';
import type {ReactNode} from 'react';
import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {holdMeter} from '../lib/diagnostics/frame-meter';
import {Shown} from '../lib/motion/shown';
import {TRANSITION} from '../lib/motion/tokens';
import {useNav} from './nav';
import type {ScreenId} from './nav';

// The stack's width in stage px: the whole content width (Shell.tsx). A screen with the player keeps to the 736
// column; one without it (Opskrifter) has all 1132.
export const WIDTH = 1132;
export const COLUMN = 736;
// A screen out of sight is drawn at opacity .001, never 0: WebKit keeps the pixels of a layer it still draws, so
// showing it again repaints nothing.
export const WAITING = 0.001;
// The growing widget: its copy is gone by 40 % of the way, the screen comes in over the last 60 %.
export const CONTENT_OUT = 0.4;
export const SCREEN_IN = 0.4;
const SETTLE = 8;
// Hjem behind a widget that grows: the other widgets recede to .1 and .98.
export const RECEDE_OPACITY = 0.1;
export const RECEDE_SCALE = 0.98;
// The spring rests when `p` is within 1/2000 of its target (under half a pixel over the 1132 width).
const REST = {restDelta: 0.0005, restSpeed: 0.005};

// center: shown. under: the screen a back reveals. below: deeper in the stack. after: not in the stack (left by a
// back, or built ahead of its push).
export type Role = 'center' | 'under' | 'below' | 'after';
type Place = 'center' | 'before' | 'after';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Look {
  opacity: number;
  y: number;
  scale: number;
}

// How a layer looks at `p` (0 not shown, 1 shown), as the upper or the lower screen of a move, when the move is a
// widget growing (`grow`) or a cross-fade.
export function look(p: number, upper: boolean, grow: boolean, reduced: boolean): Look {
  if (p <= REST.restDelta) return {opacity: WAITING, y: 0, scale: 1};
  if (reduced || !grow) return {opacity: upper ? p : 1, y: 0, scale: 1};
  if (upper) {
    const q = clamp((p - SCREEN_IN) / (1 - SCREEN_IN));
    return {opacity: Math.max(WAITING, q), y: (1 - q) * SETTLE, scale: 1};
  }
  return {opacity: RECEDE_OPACITY + (1 - RECEDE_OPACITY) * p, y: 0, scale: RECEDE_SCALE + (1 - RECEDE_SCALE) * p};
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The surface's rect at `p` (the upper screen's): from the widget's rect, as Hjem draws it then (receded about its
// centre, at Hjem's own p = 1 − p), to the screen's area.
export function surfaceRect(p: number, widget: Rect, hjem: {w: number; h: number}, area: {w: number; h: number}): Rect {
  const s = RECEDE_SCALE + (1 - RECEDE_SCALE) * (1 - p);
  const cx = hjem.w / 2, cy = hjem.h / 2;
  const from = {x: cx + (widget.x - cx) * s, y: cy + (widget.y - cy) * s, w: widget.w * s, h: widget.h * s};
  return {x: lerp(from.x, 0, p), y: lerp(from.y, 0, p), w: lerp(from.w, area.w, p), h: lerp(from.h, area.h, p)};
}

interface Layer {
  p: MotionValue<number>;
  node: () => HTMLElement | null;
}

// A screen's place and opacity as it moves, for what it draws outside its own layer (the sticky action line hangs
// in the panel's main area, sticky.ts). Outside the stack (tests, the gallery): null.
export const ScreenMotion = createContext<{x: MotionValue<number>; opacity: MotionValue<number>} | null>(null);
export const useScreenMotion = () => useContext(ScreenMotion);

// The widget the finger landed on (pointerdown on Hjem): the screen it opens grows from it.
let pressed: {screen: string; widget: HTMLElement; at: number} | null = null;
function notePress(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const widget = target?.closest<HTMLElement>('[data-screen="home"] [data-widget]') ?? null;
  const opens = widget?.matches('[data-opens]') ? widget : widget?.querySelector<HTMLElement>('[data-opens]');
  const screen = opens?.getAttribute('data-opens');
  pressed = widget && screen && !target?.closest('[data-widget-action]') ? {screen, widget, at: performance.now()}
    : null;
}

// The widget a screen grew from, as it is now (Hjem may have drawn it anew since).
function widgetFor(screen: ScreenId, known: HTMLElement): HTMLElement | null {
  if (known.isConnected) return known;
  const opens = document.querySelector<HTMLElement>(`[data-screen="home"] [data-widget] [data-opens="${screen}"],` +
    `[data-screen="home"] [data-widget][data-opens="${screen}"]`);
  return opens?.closest<HTMLElement>('[data-widget]') ?? null;
}

// The surface and the copy of the widget, built in the screen's own clip box (under its layer) for one grow or
// shrink, and removed when the move rests.
interface Morph {
  update: (p: number) => void;
  remove: () => void;
}

function buildMorph(box: HTMLElement, widget: HTMLElement, hjem: HTMLElement, hjemScale: number, wide: boolean): Morph {
  const boxRect = box.getBoundingClientRect();
  const hjemRect = hjem.getBoundingClientRect();
  // What the finger pressed may still be drawn smaller (the press's .97): the surface starts on what is seen.
  const drawn = widget.querySelector<HTMLElement>('[data-pressed]') ??
    (widget.matches('button') ? widget : widget.querySelector<HTMLElement>('button')) ?? widget;
  // Rects in Hjem's own box at rest (its recede about its centre undone), relative to the clip box.
  const unrecede = (r: DOMRect): Rect => {
    const cx = hjemRect.left + hjemRect.width / 2, cy = hjemRect.top + hjemRect.height / 2;
    return {x: cx + (r.left - cx) / hjemScale - boxRect.left, y: cy + (r.top - cy) / hjemScale - boxRect.top,
      w: r.width / hjemScale, h: r.height / hjemScale};
  };
  const start = unrecede(drawn.getBoundingClientRect());
  const own = unrecede(widget.getBoundingClientRect());
  const area = {w: wide ? WIDTH : COLUMN, h: box.offsetHeight};
  const hjemBox = {w: hjem.offsetWidth, h: hjem.offsetHeight};
  const style = getComputedStyle(drawn);
  const radius = parseFloat(style.borderTopLeftRadius) || 24;

  const surface = document.createElement('div');
  surface.setAttribute('aria-hidden', 'true');
  surface.dataset.morph = 'surface';
  Object.assign(surface.style, {
    position: 'absolute', left: '0', top: '0', width: `${String(area.w)}px`, height: `${String(area.h)}px`,
    transformOrigin: '0 0', background: style.backgroundColor, willChange: 'transform', pointerEvents: 'none',
  });
  // The copy: the widget as Hjem draws it, never a target.
  const copy = widget.cloneNode(true) as HTMLElement;
  const originals = [widget, ...widget.querySelectorAll<HTMLElement>('*')];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  copies.forEach((node, index) => {
    // A press still on: its scale and brightness as they are now, let go a frame later (the kit's transition).
    const original = originals[index];
    if (original?.hasAttribute('data-pressed')) {
      const now = getComputedStyle(original);
      node.style.scale = now.scale;
      node.style.filter = now.filter;
      requestAnimationFrame(() => {
        node.style.scale = '';
        node.style.filter = '';
      });
    }
    for (const name of ['id', 'data-opens', 'data-widget', 'data-pressed', 'data-hovered', 'data-focused',
      'data-focus-visible']) node.removeAttribute(name);
    if (node.matches('button, a, input, [tabindex]')) node.setAttribute('tabindex', '-1');
  });
  copy.dataset.morph = 'content';
  copy.setAttribute('aria-hidden', 'true');
  Object.assign(copy.style, {
    position: 'absolute', left: '0', top: '0', margin: '0', width: `${String(own.w)}px`, height: `${String(own.h)}px`,
    transformOrigin: '0 0', willChange: 'transform, opacity', pointerEvents: 'none',
  });
  box.prepend(surface, copy);
  // Its material's loops at the widget's own time.
  try {
    const running = widget.getAnimations({subtree: true});
    const twins = copy.getAnimations({subtree: true});
    running.forEach((animation, index) => {
      const twin = twins[index];
      if (twin && animation.currentTime !== null) twin.currentTime = animation.currentTime;
    });
  } catch {
    // An engine without getAnimations: the copy's loops start from their beginning.
  }
  // The widget's own place stays empty while its surface is out (as an app's icon does).
  const kept = widget.style.opacity;
  widget.style.opacity = '0';
  return {
    update: p => {
      const r = surfaceRect(p, start, hjemBox, area);
      const sx = r.w / area.w, sy = r.h / area.h;
      surface.style.transform = `translate(${r.x.toFixed(2)}px, ${r.y.toFixed(2)}px) ` +
        `scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`;
      surface.style.borderRadius = `${(radius / sx).toFixed(2)}px / ${(radius / sy).toFixed(2)}px`;
      // The copy rides the surface's corner at its own size (never stretched), receding with Hjem.
      const c = surfaceRect(p, own, hjemBox, area);
      const s = Math.min(1, c.w / own.w, c.h / own.h);
      copy.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) scale(${s.toFixed(5)})`;
      copy.style.opacity = String(1 - clamp(p / CONTENT_OUT));
    },
    remove: () => {
      surface.remove();
      copy.remove();
      widget.style.opacity = kept;
    },
  };
}

function ScreenLayer({id, role, shown, upper, grow: pair, growOf, z, wide, reduced, layers, children}: {
  id: ScreenId;
  shown: boolean;
  role: Role;
  upper: boolean;
  // The screen whose widget grows in this move (this layer is one of its two), or null for a cross-fade.
  grow: ScreenId | null;
  growOf: (pair: ScreenId) => HTMLElement | null;
  z: number;
  wide: boolean;
  reduced: boolean;
  layers: Map<ScreenId, Layer>;
  children: ReactNode;
}) {
  // The screen shown on the stack's first render is simply there; every other screen starts unseen.
  const [startP] = useState(() => (role === 'center' && shown ? 1 : 0));
  const p = useMotionValue(startP);
  const opacity = useMotionValue(look(startP, true, false, reduced).opacity);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const [moving] = useState(() => ({x, opacity}));
  const box = useRef<HTMLDivElement>(null);
  const node = useRef<HTMLDivElement>(null);
  const mode = useRef<{upper: boolean; grow: boolean; morph: Morph | null}>({upper, grow: false, morph: null});
  useLayoutEffect(() => {
    layers.set(id, {p, node: () => node.current});
    return () => {
      layers.delete(id);
    };
  }, [layers, id, p]);
  // Every look follows `p`, written to the motion values (and the morph's DOM) directly.
  useLayoutEffect(() => {
    const paint = (value: number) => {
      const next = look(value, mode.current.upper, mode.current.grow, reduced);
      opacity.set(next.opacity);
      y.set(next.y);
      scale.set(next.scale);
      mode.current.morph?.update(value);
    };
    paint(p.get());
    return p.on('change', paint);
  }, [p, opacity, y, scale, reduced]);
  useLayoutEffect(() => {
    const target = role === 'center' ? 1 : 0;
    const state = mode.current;
    const grow = pair ? growOf(pair) : null;
    state.upper = upper;
    state.grow = grow !== null && !reduced;
    const settle = () => {
      state.morph?.remove();
      state.morph = null;
    };
    // The upper screen of a grow builds its surface now, at the widget (nothing changes on screen).
    if (state.grow && upper && !state.morph && p.get() !== target) {
      const hjem = layers.get('home');
      const hjemNode = hjem?.node();
      const widget = grow ? widgetFor(id, grow) : null;
      if (widget && hjemNode && box.current) {
        // Hjem's scale as drawn now (1 while it waits unseen under a screen).
        const hjemScale = look(hjem?.p.get() ?? 1, false, true, reduced).scale;
        state.morph = buildMorph(box.current, widget, hjemNode, hjemScale, wide);
      } else state.grow = false;
    }
    const next = look(p.get(), state.upper, state.grow, reduced);
    opacity.set(next.opacity);
    y.set(next.y);
    scale.set(next.scale);
    state.morph?.update(p.get());
    let move: ReturnType<typeof animate> | null = null;
    let done: (() => void) | null = null;
    let first = 0, second = 0;
    const go = () => {
      if (p.get() === target) {
        settle();
        return;
      }
      move = animate(p, target, reduced ? TRANSITION.reduced : {...TRANSITION.nav, ...REST});
      const held = holdMeter();
      done = held;
      void move.finished.then(() => {
        if (p.get() === target) settle();
        held();
      }, held);
    };
    // A push (a screen comes to the top that is not shown yet) starts once its first frame and its surface have been
    // laid out and painted; the screen under it waits with it. Everything else moves at once.
    const nav = useNav.getState();
    const top = nav.stack.at(-1)?.screen ?? 'home';
    const wait = !reduced && nav.direction === 1 && (role === 'center' || role === 'under') &&
      (layers.get(top)?.p.get() ?? 0) === 0;
    if (wait) {
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(go);
      });
    } else go();
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      move?.stop();
      done?.();
    };
  }, [role, upper, pair, growOf, wide, reduced, id, p, layers, opacity, y, scale]);
  useEffect(() => () => {
    mode.current.morph?.remove();
  }, []);
  const place: Place = role === 'center' ? 'center' : role === 'after' ? 'after' : 'before';
  return (
    // The screen's area (the 736 column, or all 1132 without the player): it clips the screen and its surface, so
    // nothing passes over the player column.
    <div ref={box} className="pointer-events-none absolute top-0 bottom-0 left-0 overflow-hidden"
      style={{width: wide ? WIDTH : COLUMN, zIndex: z}}>
      <motion.div
        ref={node}
        // Its own compositing layer at rest too (translateZ), so starting or ending a move never repaints. Opaque, as
        // a screen covers the one below.
        className="absolute inset-0 flex translate-z-0 flex-col overflow-y-auto overscroll-contain bg-pv-bg
          will-change-transform backface-hidden"
        data-screen={id}
        data-place={place}
        aria-hidden={role === 'center' ? undefined : true}
        inert={role !== 'center'}
        layoutScroll
        style={{opacity, y, scale, pointerEvents: role === 'center' ? 'auto' : 'none'}}
      >
        <ScreenMotion value={moving}>
          <Shown value={role === 'center'}>{children}</Shown>
        </ScreenMotion>
      </motion.div>
    </div>
  );
}

export function ScreenStack({mounted, render, wide}: {
  mounted: ScreenId[];
  render: (id: ScreenId) => ReactNode;
  wide: (id: ScreenId) => boolean;
}) {
  const stack = useNav(state => state.stack);
  const direction = useNav(state => state.direction);
  const previous = useNav(state => state.previous);
  const reduced = useReducedMotion() ?? false;
  const [layers] = useState(() => new Map<ScreenId, Layer>());
  // The screens that grew from a Hjem widget, and which widget.
  const [grown] = useState(() => new Map<ScreenId, HTMLElement>());
  const screens = stack.map(route => route.screen);
  const center = screens.at(-1) ?? 'home';
  const under = screens.length > 1 ? (screens.at(-2) ?? null) : null;
  // The screen on the stack's first render is simply there.
  const [initial] = useState(center);
  useEffect(() => {
    window.addEventListener('pointerdown', notePress, {capture: true, passive: true});
    return () => {
      window.removeEventListener('pointerdown', notePress, {capture: true});
    };
  }, []);
  // A push from Hjem grows from the widget the finger pressed (when it opens that screen); any other push fades.
  // Decided once per push, by the first of its two layers to start moving (in their layout effects).
  const [growOf] = useState(() => {
    const decided = new WeakSet<object>();
    return (pair: ScreenId): HTMLElement | null => {
      const nav = useNav.getState();
      if (nav.direction === 1 && !decided.has(nav.stack)) {
        decided.add(nav.stack);
        const top = nav.stack.at(-1)?.screen ?? 'home';
        const below = nav.stack.at(-2)?.screen ?? null;
        const press = pressed;
        if (below === 'home' && press?.screen === top && press.widget.isConnected &&
          performance.now() - press.at < 3000) grown.set(top, press.widget);
        else grown.delete(top);
        // Let go only after it is read (the bundler's minifier once inlined `press` past an earlier reset).
        pressed = null;
      }
      return grown.get(pair) ?? null;
    };
  });
  const roleOf = (id: ScreenId): Role =>
    id === center ? 'center' : id === under ? 'under' : screens.includes(id) ? 'below' : 'after';
  // The two screens of the move: the new one over the one it covers on a push, the one leaving over the one it
  // reveals on a back. They grow and shrink when the upper one grew from a Hjem widget.
  const upperId = direction === 1 ? center : previous;
  const lowerId = direction === 1 ? under : center;
  const pair = upperId && lowerId === 'home' ? upperId : null;
  // Deeper in the stack is further down; a screen leaving stays over the one it reveals.
  const zOf = (id: ScreenId) => (screens.includes(id) ? screens.lastIndexOf(id) + 1 : screens.length + 1);

  return (
    <section className="relative min-h-0 flex-1 overflow-hidden contain-[layout_paint]" aria-label="Hjemmet">
      {mounted.map(id => (
        <ScreenLayer key={id} id={id} role={roleOf(id)} shown={id === initial} upper={id === upperId} z={zOf(id)}
          wide={wide(id)} reduced={reduced} grow={id === upperId || id === lowerId ? pair : null} growOf={growOf}
          layers={layers}>
          {render(id)}
        </ScreenLayer>
      ))}
    </section>
  );
}
