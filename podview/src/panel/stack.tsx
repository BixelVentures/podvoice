// The screen stack, as an iPad navigation stack (docs/MOTION.md §1, P1). Each mounted screen is a layer with two
// motion values: `x` (its place) and `fade`. A push slides the new screen in over the whole column from the right
// while the one it covers moves a third of the way left and dims; a back is the reverse. Every move is a physics
// spring (TRANSITION.page) on the motion value itself, so a tap mid-transition retargets from where the screen is,
// with the velocity it has. Only transform and opacity change.
//
// Swipe back: a finger that starts in the column's left edge zone (EDGE, which is at least 24 px from the glass, so
// iPadOS's own edge gestures keep theirs) and moves sideways drags the screen 1:1, the one below following at its
// parallax. The release projects the finger's velocity (PROJECT): past half the width it goes back, else it springs
// home; either way the spring starts with the finger's velocity. A vertical start is left to scrolling.
//
// Reduced motion: nothing moves by itself; screens cross-fade (TRANSITION.reduced). A swipe still follows the finger
// (direct manipulation), and the screen below fades in under it.
import {animate, motion, useMotionValue, useReducedMotion, useTransform} from 'motion/react';
import type {MotionValue, PanInfo} from 'motion/react';
import type {ReactNode} from 'react';
import {useLayoutEffect, useRef, useState} from 'react';
import {holdMeter} from '../lib/diagnostics/frame-meter';
import {Shown} from '../lib/motion/shown';
import {TRANSITION} from '../lib/motion/tokens';
import {useNav} from './nav';
import type {ScreenId} from './nav';

// The screen column's width in stage px (Shell.tsx: grid-cols-[736px_372px]).
export const WIDTH = 736;
const PARALLAX = 0.3;
const UNDER = -PARALLAX * WIDTH;
// The opacity of the screen a push leaves behind, at its parallax place.
const DIM = 0.6;
// A screen out of sight is drawn at opacity .001, never 0: WebKit keeps the pixels of a layer it still draws, so
// showing it again repaints nothing (a screen at 0 is repainted whole on the first frame of its push).
const WAITING = 0.001;
// Where a swipe back may start: the first EDGE stage px of the column.
export const EDGE = 32;
// The share of the width the projected release must pass to go back, and the projection's lookahead (s).
const COMMIT = 0.5;
const PROJECT = 0.2;

// center: shown. under: the screen a back reveals. below: deeper in the stack. after: not in the stack (left by a
// back, or built ahead of its push).
export type Role = 'center' | 'under' | 'below' | 'after';
type Place = 'center' | 'before' | 'after';

interface Layer {
  x: MotionValue<number>;
  fade: MotionValue<number>;
}

interface Pose {
  x: number;
  fade: number;
}

export function target(role: Role, reduced: boolean): Pose {
  if (role === 'center') return {x: 0, fade: 1};
  if (reduced) return {x: 0, fade: WAITING};
  if (role === 'after') return {x: WIDTH, fade: 1};
  return {x: UNDER, fade: role === 'under' ? 1 : WAITING};
}

// Where a layer starts when it mounts: Hjem on the page's first render is simply there; a screen built for a move
// starts on the side it comes from.
export function initial(role: Role, reduced: boolean, entering: 1 | -1 | null): Pose {
  if (role !== 'center' || entering === null) return target(role, reduced);
  if (reduced) return {x: 0, fade: WAITING};
  return {x: entering === 1 ? WIDTH : UNDER, fade: 1};
}

// A screen at its parallax place is dimmed; one wholly off to the right waits unseen (WAITING).
const dim = (x: number) => (x >= WIDTH - 0.5 ? WAITING : x >= 0 ? 1 : 1 - (1 - DIM) * Math.min(1, -x / -UNDER));

function ScreenLayer({id, role, z, reduced, entering, layers, releaseRef, children}: {
  id: ScreenId;
  role: Role;
  z: number;
  reduced: boolean;
  entering: 1 | -1 | null;
  layers: Map<ScreenId, Layer>;
  releaseRef: {current: Partial<Record<ScreenId, number>>};
  children: ReactNode;
}) {
  const [start] = useState(() => initial(role, reduced, entering));
  const x = useMotionValue(start.x);
  const fade = useMotionValue(start.fade);
  const opacity = useTransform(() => fade.get() * dim(x.get()));
  useLayoutEffect(() => {
    layers.set(id, {x, fade});
    return () => {
      layers.delete(id);
    };
  }, [layers, id, x, fade]);
  useLayoutEffect(() => {
    const to = target(role, reduced);
    // A swipe's release hands its velocity to the spring that finishes it.
    const velocity = releaseRef.current[id];
    releaseRef.current = Object.fromEntries(Object.entries(releaseRef.current).filter(([key]) => key !== id));
    const spring = velocity === undefined ? TRANSITION.page : {...TRANSITION.page, velocity};
    const moves = [
      animate(x, to.x, reduced ? TRANSITION.reduced : spring),
      animate(fade, to.fade, reduced ? TRANSITION.reduced : TRANSITION.fade),
    ];
    const done = holdMeter();
    void Promise.all(moves.map(move => move.finished)).then(done, done);
    return () => {
      for (const move of moves) move.stop();
      done();
    };
  }, [role, reduced, id, x, fade, releaseRef]);
  const place: Place = role === 'center' ? 'center' : role === 'after' ? 'after' : 'before';
  return (
    <motion.div
      // Its own compositing layer at rest too (translateZ), so starting or ending a move never repaints. Opaque, as
      // a pushed screen covers the one below.
      className="absolute inset-0 flex translate-z-0 flex-col overflow-y-auto overscroll-contain bg-pv-bg
        will-change-transform backface-hidden"
      data-screen={id}
      data-place={place}
      aria-hidden={role === 'center' ? undefined : true}
      layoutScroll
      style={{x, opacity, zIndex: z, pointerEvents: role === 'center' ? 'auto' : 'none'}}
    >
      <Shown value={role === 'center'}>{children}</Shown>
    </motion.div>
  );
}

interface Gesture {
  center: ScreenId;
  under: ScreenId;
  scale: number;
}

export function ScreenStack({mounted, render}: {mounted: ScreenId[]; render: (id: ScreenId) => ReactNode}) {
  const stack = useNav(state => state.stack);
  const direction = useNav(state => state.direction);
  const reduced = useReducedMotion() ?? false;
  const [layers] = useState(() => new Map<ScreenId, Layer>());
  const releaseRef = useRef<Partial<Record<ScreenId, number>>>({});
  const gestureRef = useRef<Gesture | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const screens = stack.map(route => route.screen);
  const center = screens.at(-1) ?? 'home';
  const under = screens.length > 1 ? (screens.at(-2) ?? null) : null;
  const roleOf = (id: ScreenId): Role =>
    id === center ? 'center' : id === under ? 'under' : screens.includes(id) ? 'below' : 'after';
  // Deeper in the stack is further down; a screen leaving to the right stays over the one it reveals.
  const zOf = (id: ScreenId) => (screens.includes(id) ? screens.lastIndexOf(id) + 1 : screens.length + 1);

  // The finger's start in stage px from the column's left edge, and the stage scale (1 on the wall).
  const edgeOf = (clientX: number) => {
    const box = sectionRef.current?.getBoundingClientRect();
    if (!box?.width) return null;
    const scale = box.width / WIDTH;
    return {at: (clientX - box.left) / scale, scale};
  };
  const onPointerDown = (event: React.PointerEvent) => {
    // A finger in the edge zone builds the screen below now, so a swipe reveals a screen that exists.
    if (!under || mounted.includes(under)) return;
    if ((edgeOf(event.clientX)?.at ?? Infinity) <= EDGE) useNav.getState().prewarm(under);
  };
  const onPanStart = (_: PointerEvent, info: PanInfo) => {
    const edge = under ? edgeOf(info.point.x - info.offset.x) : null;
    if (!under || (edge?.at ?? Infinity) > EDGE || !edge) return;
    // Sideways and to the right, else it is a scroll (or nothing).
    if (info.offset.x <= 0 || Math.abs(info.offset.y) > Math.abs(info.offset.x)) return;
    gestureRef.current = {center, under, scale: edge.scale};
    layers.get(center)?.x.stop();
    layers.get(under)?.x.stop();
  };
  const follow = (g: Gesture, offset: number) => {
    const x = Math.min(WIDTH, Math.max(0, offset / g.scale));
    layers.get(g.center)?.x.set(x);
    const below = layers.get(g.under);
    if (!below) return;
    if (reduced) below.fade.set(x / WIDTH);
    else below.x.set(UNDER * (1 - x / WIDTH));
  };
  const onPan = (_: PointerEvent, info: PanInfo) => {
    const g = gestureRef.current;
    // Another move took the stack meanwhile (an idle return, a new answer): the gesture is over.
    if (g?.center !== center) return;
    follow(g, info.offset.x);
  };
  const onPanEnd = (_: PointerEvent, info: PanInfo) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g?.center !== center) return;
    const top = layers.get(g.center);
    const velocity = info.velocity.x / g.scale;
    const x = top?.x.get() ?? 0;
    if (x + velocity * PROJECT > WIDTH * COMMIT && velocity > -200) {
      releaseRef.current = {[g.center]: velocity, [g.under]: velocity * PARALLAX};
      useNav.getState().back();
      return;
    }
    // Not far enough: both spring back to where they were, with the finger's velocity.
    const below = layers.get(g.under);
    const spring = (v: number) => (reduced ? TRANSITION.reduced : {...TRANSITION.page, velocity: v});
    const moves = [
      ...(top ? [animate(top.x, 0, spring(velocity))] : []),
      ...(below && !reduced ? [animate(below.x, UNDER, spring(velocity * PARALLAX))] : []),
      ...(below && reduced ? [animate(below.fade, WAITING, TRANSITION.reduced)] : []),
    ];
    const done = holdMeter();
    void Promise.all(moves.map(move => move.finished)).then(done, done);
  };

  return (
    <motion.section
      ref={sectionRef}
      className="relative min-h-0 overflow-hidden contain-[layout_paint]"
      aria-label="Hjemmet"
      onPointerDownCapture={onPointerDown}
      onPanStart={onPanStart}
      onPan={onPan}
      onPanEnd={onPanEnd}
    >
      {mounted.map(id => {
        const role = roleOf(id);
        // Built for this move: enter from the side it comes from. Hjem is mounted from the first render and never
        // enters.
        const entering = id === 'home' || role !== 'center' ? null : direction;
        return (
          <ScreenLayer key={id} id={id} role={role} z={zOf(id)} reduced={reduced} entering={entering}
            layers={layers} releaseRef={releaseRef}>
            {render(id)}
          </ScreenLayer>
        );
      })}
    </motion.section>
  );
}
