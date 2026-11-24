// On-device frame meter, a measurement tool, not product behaviour (docs/MOTION.md, "Måling på iPad'en"). Every touch
// opens a short session: from the finger down until the motion it started has settled (at most 1.5 s after release),
// requestAnimationFrame deltas are sampled. Each session becomes one small summary; the panel takes them (takeFrames)
// and folds them into its »frames« health report (src/panel/health.ts).
// Idle cost is zero: no rAF loop and no timer without a session. The meter never reads geometry or computed style and
// never writes the DOM; motion is seen through CSS transition/animation events, Web Animations started during the
// session (document.getAnimations) and scroll events. The kind comes from the shown screen before and after.
const RELEASE_MAX_MS = 1500;
const HOLD_MAX_MS = 3000;
const QUIET_MS = 200;
const SLOP_PX = 10;
const QUEUE_MAX = 50;

export interface FrameSummary {
  frames: number;
  over17: number;
  over20: number;
  over34: number;
  over50: number;
  maxFrameMs: number | null;
  p95FrameMs: number | null;
}

export interface MeteredSession extends FrameSummary {
  kind: string;
  from: string | null;
  to: string | null;
  startLatencyMs: number | null;
  durationMs: number;
  at: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

function percentile(sorted: number[], p: number): number | null {
  return sorted.length ? (sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? null) : null;
}

export function summarizeFrames(deltas: readonly number[]): FrameSummary {
  const sorted = [...deltas].sort((a, b) => a - b);
  const over = (ms: number) => deltas.filter(delta => delta > ms).length;
  const max = sorted.at(-1);
  const p95 = percentile(sorted, 0.95);
  return {
    frames: deltas.length,
    over17: over(17),
    over20: over(20),
    over34: over(34),
    over50: over(50),
    maxFrameMs: max === undefined ? null : round(max),
    p95FrameMs: p95 === null ? null : round(p95),
  };
}

export interface ShownScreen {
  // The panel's centred screen (Shell.tsx: .pv-panel-screen[data-place=center][data-screen]), or null.
  screen: string | null;
  // Ro (the rest photo) is up.
  rest: boolean;
}

// The kind of motion a touch started, from the screen before and after (no geometry).
export function inferKind(
  before: ShownScreen,
  after: ShownScreen,
  {scrolled, animations}: {scrolled: boolean; animations: number},
): string {
  if (before.rest !== after.rest) return after.rest ? 'ro-open' : 'ro-close';
  if (before.screen !== after.screen) return after.screen === 'home' ? 'pop' : 'push';
  if (scrolled) return 'scroll';
  return animations > 0 ? 'press' : 'tap';
}

function shownScreen(doc: Document): ShownScreen {
  const centre = doc.querySelector<HTMLElement>('.pv-panel-screen[data-place="center"]');
  return {screen: centre?.dataset.screen ?? null, rest: doc.getElementById('photo-view') !== null};
}

interface Session {
  downAt: number;
  releaseAt: number | null;
  before: ShownScreen;
  frameTimes: number[];
  deltas: number[];
  lastTs: number | null;
  css: number;
  animationsBefore: number;
  scrolled: boolean;
  x: number;
  y: number;
  movedAfter: number | null;
  lastActivity: number;
}

export interface FrameMeter {
  take: () => MeteredSession[];
  pending: () => number;
  active: () => boolean;
  dispose: () => void;
}

export function installFrameMeter(win: Window = window): FrameMeter {
  const doc = win.document;
  const now = () => win.performance.now();
  const queue: MeteredSession[] = [];
  let session: Session | null = null;
  const running = () => (typeof doc.getAnimations === 'function' ? doc.getAnimations().length : 0);
  const activity = () => {
    if (session) session.lastActivity = now();
  };
  const markMoved = () => {
    if (!session) return;
    activity();
    if (session.releaseAt !== null && session.movedAfter === null) session.movedAfter = now();
  };

  function finish() {
    const s = session;
    if (!s) return;
    session = null;
    const releaseAt = s.releaseAt ?? s.downAt;
    const after = shownScreen(doc);
    const anchor = s.movedAfter ?? releaseAt;
    const first = s.frameTimes.find(t => t >= anchor);
    const animations = Math.max(0, running() - s.animationsBefore) + Math.max(0, s.css);
    queue.push({
      kind: inferKind(s.before, after, {scrolled: s.scrolled, animations}),
      from: s.before.screen,
      to: after.screen,
      ...summarizeFrames(s.deltas),
      startLatencyMs: first === undefined ? null : round(Math.max(0, first - releaseAt)),
      durationMs: round(Math.min(60_000, Math.max(s.lastActivity, releaseAt) - releaseAt)),
      at: Date.now(),
    });
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
  }

  function start(x: number, y: number) {
    const t = now();
    const s: Session = {
      downAt: t,
      releaseAt: null,
      before: shownScreen(doc),
      frameTimes: [],
      deltas: [],
      lastTs: null,
      css: 0,
      animationsBefore: running(),
      scrolled: false,
      x,
      y,
      movedAfter: null,
      lastActivity: t,
    };
    session = s;
    const tick = (ts: number) => {
      if (session !== s) return;
      const at = now();
      if (s.lastTs !== null) s.deltas.push(ts - s.lastTs);
      s.lastTs = ts;
      s.frameTimes.push(at);
      if (running() > s.animationsBefore) markMoved();
      const quiet = s.css <= 0 && running() <= s.animationsBefore && at - s.lastActivity >= QUIET_MS;
      const done = s.releaseAt === null
        ? at - s.downAt >= HOLD_MAX_MS
        : at - s.releaseAt >= RELEASE_MAX_MS || (quiet && at - s.releaseAt >= QUIET_MS);
      if (done) finish();
      else win.requestAnimationFrame(tick);
    };
    win.requestAnimationFrame(tick);
  }

  const release = () => {
    if (session?.releaseAt === null) session.releaseAt = now();
  };
  const controller = new AbortController();
  const opts = {capture: true, passive: true, signal: controller.signal};
  win.addEventListener('pointerdown', event => {
    if (doc.hidden) return;
    finish();
    start(event.clientX, event.clientY);
  }, opts);
  win.addEventListener('pointermove', event => {
    const s = session;
    if (s?.releaseAt !== null || s.scrolled) return;
    if (Math.abs(event.clientX - s.x) > SLOP_PX || Math.abs(event.clientY - s.y) > SLOP_PX) s.scrolled = true;
  }, opts);
  win.addEventListener('pointerup', release, opts);
  win.addEventListener('pointercancel', () => {
    if (session) session.scrolled = true;
    release();
  }, opts);
  doc.addEventListener('scroll', () => {
    if (!session) return;
    session.scrolled = true;
    markMoved();
  }, opts);
  for (const type of ['transitionrun', 'animationstart']) {
    doc.addEventListener(type, () => {
      if (!session) return;
      session.css++;
      markMoved();
    }, opts);
  }
  for (const type of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']) {
    doc.addEventListener(type, () => {
      if (!session) return;
      session.css--;
      activity();
    }, opts);
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) finish();
  }, opts);
  win.addEventListener('pagehide', finish, opts);

  return {
    take: () => queue.splice(0),
    pending: () => queue.length,
    active: () => session !== null,
    dispose: () => {
      controller.abort();
      session = null;
    },
  };
}
