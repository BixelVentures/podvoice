// A press is a tap, never the end of a drag. React Aria fires a press (and a label toggles its checkbox) when the
// finger lifts over the control it went down on, however far it travelled in between; on the wall a horizontal drag
// that starts on a lamp row (a swipe back, a scroll that the browser did not take) must never switch the lamp.
// One listener per window follows each pointer from down to up; `wasDrag()` says whether the pointer that just
// lifted moved further than a tap's slop. The kit's presses ask it before they act (`tapOnly`).

// How far (px) a finger may wander and still tap: Apple's own tap slop is about 10 pt.
export const TAP_SLOP = 10;
// A release this old no longer explains a press (a keyboard or assistive-technology press after a drag).
const RELEASE_MS = 600;

interface Track {
  x: number;
  y: number;
  far: boolean;
}

const tracks = new Map<number, Track>();
let last: {far: boolean; at: number} | null = null;
const installed = new WeakSet<Window>();

function install(win: Window) {
  if (installed.has(win)) return;
  installed.add(win);
  const options = {capture: true, passive: true};
  win.addEventListener('pointerdown', event => {
    tracks.set(event.pointerId, {x: event.clientX, y: event.clientY, far: false});
  }, options);
  win.addEventListener('pointermove', event => {
    const track = tracks.get(event.pointerId);
    if (track && !track.far && Math.hypot(event.clientX - track.x, event.clientY - track.y) > TAP_SLOP)
      track.far = true;
  }, options);
  const end = (event: PointerEvent) => {
    const track = tracks.get(event.pointerId);
    tracks.delete(event.pointerId);
    if (!track) return;
    // pointerup's own position counts too: a drag can lift without a move event in between.
    const far = track.far || Math.hypot(event.clientX - track.x, event.clientY - track.y) > TAP_SLOP;
    last = {far: event.type === 'pointercancel' || far, at: performance.now()};
  };
  win.addEventListener('pointerup', end, options);
  win.addEventListener('pointercancel', end, options);
}

/** Starts following pointers in this window (the kit's pressables call it on mount; it is idempotent). */
export function installTapGuard(win?: Window): void {
  const target = win ?? (typeof window === 'undefined' ? null : window);
  if (target) install(target);
}

/** The pointer that just lifted was dragged, not tapped. */
export function wasDrag(): boolean {
  return !!last && last.far && performance.now() - last.at < RELEASE_MS;
}

/** Wraps a press handler so a drag's release never runs it (keyboard and assistive presses always do). */
export function tapOnly<A extends unknown[]>(handler: (...args: A) => void): (...args: A) => void;
export function tapOnly<A extends unknown[]>(handler: ((...args: A) => void) | undefined):
  ((...args: A) => void) | undefined;
export function tapOnly<A extends unknown[]>(handler: ((...args: A) => void) | undefined):
  ((...args: A) => void) | undefined {
  if (!handler) return undefined;
  return (...args: A) => {
    if (wasDrag()) return;
    handler(...args);
  };
}

/** For tests: forget the last release. */
export function resetTapGuard(): void {
  last = null;
  tracks.clear();
}

installTapGuard();
