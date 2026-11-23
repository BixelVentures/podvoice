// How the queue panel presents itself. A song or room starts a new run; events from an older run are ignored. A
// problem is named only once it has lasted QUEUE_TROUBLE_MS.
export const QUEUE_TROUBLE_MS = 10000;
export const QUEUE_PRESENTATION_PHASES = Object.freeze(['idle', 'loading', 'ready', 'empty', 'preview-pending',
  'retry-wait', 'unavailable', 'choosing'] as const);
export type QueuePhase = (typeof QUEUE_PRESENTATION_PHASES)[number];
export interface QueuePresentation {
  phase: QueuePhase;
  run: number;
  key: string | null;
  troubleSince: number | null;
}
export type QueueEvent =
  | {type: 'reset'; key: string | null}
  | {type: 'read' | 'not-allowed' | 'rows' | 'empty' | 'choice' | 'preview' | 'pending' | 'trouble'; run: number;
    at: number};

export const newQueuePresentation = (key: string | null = null): QueuePresentation =>
  ({phase: 'idle', run: 0, key, troubleSince: null});
// Phases that still wait for an answer: shown as loading rows until the trouble time has passed.
const WAITING = new Set<QueuePhase>(['idle', 'loading', 'preview-pending', 'retry-wait']);
const wait = (s: QueuePresentation, phase: QueuePhase, at: number): QueuePresentation =>
  ({...s, phase, troubleSince: s.troubleSince ?? at});

export function queuePresentation(s: QueuePresentation, e: QueueEvent): QueuePresentation {
  if (e.type === 'reset') return {...newQueuePresentation(e.key), run: s.run + 1};
  if (e.run !== s.run) return s;
  switch (e.type) {
    // A queue read was dispatched.
    case 'read':
      return s.phase === 'choosing' ? s : wait(s, 'loading', e.at);
    // The read could not be made yet (no current room binding); it is made again once allowed.
    case 'not-allowed':
      return s.phase === 'choosing' ? s : wait(s, 'retry-wait', e.at);
    case 'rows':
      return {...s, phase: 'ready', troubleSince: null};
    case 'empty':
      return {...s, phase: 'empty', troubleSince: null};
    // A queue choice (pending or accepted) is an answer, never a loading queue.
    case 'choice':
      return {...s, phase: 'choosing', troubleSince: null};
    case 'preview':
      return s.phase === 'unavailable' ? s : wait(s, 'preview-pending', e.at);
    // No settled answer at this render.
    case 'pending':
      if (s.phase === 'unavailable' || WAITING.has(s.phase) && s.phase !== 'idle') return s;
      return wait(s, 'loading', e.at);
    case 'trouble':
      return WAITING.has(s.phase) && s.troubleSince !== null && e.at - s.troubleSince >= QUEUE_TROUBLE_MS
        ? {...s, phase: 'unavailable'} : s;
    // An event from elsewhere (an older build, a typo) changes nothing.
    default:
      return s;
  }
}

export const queueWaiting = (s: QueuePresentation) => WAITING.has(s.phase) && s.troubleSince !== null;
