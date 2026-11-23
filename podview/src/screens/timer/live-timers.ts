// The native timers of a snapshot, as the screen's records (ported from liveScene / liveTimerHistory in
// podvoice-view.js, which now use these). Remaining time, duration and revision are the owner's; nothing is counted
// here. A finished native timer is `done` with nothing left.
import type {Snapshot, TimerRow} from '../../lib/api/schemas';
import type {Timer, TimerHistoryItem} from './model';

const ALERTS = ['pending', 'requested', 'started', 'drained', 'stopped', 'unknown'];
const REVISION = /^(0|[1-9][0-9]{0,23})$/;
const duration = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 86400;

export interface LiveHistoryRow extends TimerHistoryItem {
  id: string;
  name: string;
  acceptedAt: number;
}

// The product's own timer history (core lifetime), newest first; any malformed row voids it.
export function liveTimerHistory(value: unknown, now = Date.now()): LiveHistoryRow[] {
  const history = value as {status?: unknown; scope?: unknown; items?: unknown} | null | undefined;
  if (history?.status !== 'observed' || history.scope !== 'core_lifetime' || !Array.isArray(history.items)) return [];
  if (history.items.length > 12) return [];
  const seen = new Set<string>();
  const rows: LiveHistoryRow[] = [];
  for (const item of history.items as Record<string, unknown>[]) {
    const {id, name, seconds, acceptedAt} = item as {id?: unknown; name?: unknown; seconds?: unknown; acceptedAt?: unknown};
    if (typeof id !== 'string' || !id || id.length > 200 || seen.has(id)) return [];
    if (typeof name !== 'string' || name.length > 120 || !duration(seconds)) return [];
    if (typeof acceptedAt !== 'number' || !Number.isFinite(acceptedAt) || acceptedAt <= 0 || acceptedAt * 1000 > now + 5000)
      return [];
    seen.add(id);
    rows.push({id, name: name || 'Timer', seconds, acceptedAt});
  }
  return rows.sort((a, b) => b.acceptedAt - a.acceptedAt);
}

// The row's known total: the owner's duration with its revision, else the history's duration for this id.
function totalOf(row: DrawnRow, history: LiveHistoryRow[]): number | null {
  if (Object.hasOwn(row, 'durationSeconds') || Object.hasOwn(row, 'sourceRevision'))
    return duration(row.durationSeconds) && typeof row.sourceRevision === 'string' && REVISION.test(row.sourceRevision)
      ? row.durationSeconds
      : null;
  const entry = history.find(item => item.id === row.id);
  return entry && entry.seconds >= row.secondsLeft ? entry.seconds : null;
}

type DrawnRow = TimerRow & {name: string; secondsLeft: number; status: 'running' | 'paused' | 'finished'};
const drawn = (row: TimerRow): row is DrawnRow =>
  typeof row.name === 'string' && typeof row.secondsLeft === 'number' && Number.isFinite(row.secondsLeft) &&
  (row.status === 'running' || row.status === 'paused' || row.status === 'finished');

export function liveTimers(snapshot: Pick<Snapshot, 'bootId' | 'timers' | 'timerHistory'>): Timer[] {
  if (snapshot.timers.status !== 'observed') return [];
  const history = liveTimerHistory(snapshot.timerHistory);
  return snapshot.timers.items.filter(drawn).slice(0, 32).map(row => {
    const done = row.status === 'finished';
    return {
      id: row.id,
      name: row.name.slice(0, 120),
      remaining: done ? 0 : Math.max(0, row.secondsLeft),
      duration: totalOf(row, history),
      sourceRevision: typeof row.sourceRevision === 'string' ? row.sourceRevision : undefined,
      status: done ? 'done' : row.status,
      deadline: null,
      hidden: false,
      ownerBootId: snapshot.bootId,
      alertState: typeof row.alertState === 'string' && ALERTS.includes(row.alertState) ? row.alertState : null,
      physicalStopped: typeof row.physicalStopped === 'boolean' ? row.physicalStopped : null,
      physicalDrained: typeof row.physicalDrained === 'boolean' ? row.physicalDrained : null,
    };
  });
}
