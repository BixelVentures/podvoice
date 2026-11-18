import type {Timer} from './model';

export interface TimerPresentation {
  current: Timer | null;
  visible: Timer[];
  all: Timer[];
  canStart: boolean;
}

const priority = (t: Timer) => (t.status === 'done' ? 0 : t.status === 'running' ? 1 : t.status === 'paused' ? 2 : 3);
const finite = (value: unknown): value is number => Number.isFinite(value);
const end = (t: Timer) => (finite(t.deadline) ? t.deadline : t.remaining);

// The one timer the screen shows: an unfinished alarm first, then the running timer ending first.
export function timerPresentation(timers: Timer[]): TimerPresentation {
  const all = timers.filter(t => t.status !== 'cancelled');
  const selected = [...all].sort((a, b) => priority(a) - priority(b) || end(a) - end(b))[0] ?? null;
  // Normalize completed timer data to zero even if a snapshot includes an old secondsLeft value. The renderer
  // replaces the countdown with completion text. Keep the source records intact for owner actions.
  const current = selected?.status === 'done' ? {...selected, remaining: 0} : selected;
  return {current, visible: current ? [current] : [], all: timers, canStart: all.length === 0};
}
