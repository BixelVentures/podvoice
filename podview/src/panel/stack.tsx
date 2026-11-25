// The screen stack, as an iPad navigation stack (docs/MOTION.md §1, P1). Each mounted screen is a layer with two
// motion values: `x` (its place) and `fade`. A push slides the new screen in over the whole column from the right
// while the one it covers moves a third of the way left and dims; a back is the reverse. Every move is a physics
// spring (TRANSITION.page) on the motion value itself, so a tap mid-transition retargets from where the screen is,
// with the velocity it has. Only transform and opacity change.
//
// Back is the topbar's »Tilbage«; there is no swipe back (the wall is tapped, and a horizontal drag stays the
// screen's own: shelves, sliders).
//
// Reduced motion: nothing moves by itself; screens cross-fade (TRANSITION.reduced).
import {animate, motion, useMotionValue, useReducedMotion, useTransform} from 'motion/react';
import type {MotionValue} from 'motion/react';
import type {ReactNode} from 'react';
import {useLayoutEffect, useState} from 'react';
import {holdMeter} from '../lib/diagnostics/frame-meter';
import {Shown} from '../lib/motion/shown';
import {TRANSITION} from '../lib/motion/tokens';
import {useNav} from './nav';
import type {ScreenId} from './nav';

// The stack's width in stage px: the whole content width (Shell.tsx), so a screen without the player (Opskrifter)
// has all of it; a screen with the player keeps to its 736 column under it. The parallax is measured on that 736
// column.
export const WIDTH = 1132;
export const COLUMN = 736;
const PARALLAX = 0.3;
const UNDER = -PARALLAX * COLUMN;
// The opacity of the screen a push leaves behind, at its parallax place.
const DIM = 0.6;
// A screen out of sight is drawn at opacity .001, never 0: WebKit keeps the pixels of a layer it still draws, so
// showing it again repaints nothing (a screen at 0 is repainted whole on the first frame of its push).
const WAITING = 0.001;

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

function ScreenLayer({id, role, z, reduced, entering, layers, children}: {
  id: ScreenId;
  role: Role;
  z: number;
  reduced: boolean;
  entering: 1 | -1 | null;
  layers: Map<ScreenId, Layer>;
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
    const moves = [
      animate(x, to.x, reduced ? TRANSITION.reduced : TRANSITION.page),
      animate(fade, to.fade, reduced ? TRANSITION.reduced : TRANSITION.fade),
    ];
    const done = holdMeter();
    void Promise.all(moves.map(move => move.finished)).then(done, done);
    return () => {
      for (const move of moves) move.stop();
      done();
    };
  }, [role, reduced, id, x, fade]);
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

export function ScreenStack({mounted, render}: {mounted: ScreenId[]; render: (id: ScreenId) => ReactNode}) {
  const stack = useNav(state => state.stack);
  const direction = useNav(state => state.direction);
  const reduced = useReducedMotion() ?? false;
  const [layers] = useState(() => new Map<ScreenId, Layer>());
  const screens = stack.map(route => route.screen);
  const center = screens.at(-1) ?? 'home';
  const under = screens.length > 1 ? (screens.at(-2) ?? null) : null;
  const roleOf = (id: ScreenId): Role =>
    id === center ? 'center' : id === under ? 'under' : screens.includes(id) ? 'below' : 'after';
  // Deeper in the stack is further down; a screen leaving to the right stays over the one it reveals.
  const zOf = (id: ScreenId) => (screens.includes(id) ? screens.lastIndexOf(id) + 1 : screens.length + 1);

  return (
    <section className="relative min-h-0 flex-1 overflow-hidden contain-[layout_paint]" aria-label="Hjemmet">
      {mounted.map(id => {
        const role = roleOf(id);
        // Built for this move: enter from the side it comes from. Hjem is mounted from the first render and never
        // enters.
        const entering = id === 'home' || role !== 'center' ? null : direction;
        return (
          <ScreenLayer key={id} id={id} role={role} z={zOf(id)} reduced={reduced} entering={entering}
            layers={layers}>
            {render(id)}
          </ScreenLayer>
        );
      })}
    </section>
  );
}
