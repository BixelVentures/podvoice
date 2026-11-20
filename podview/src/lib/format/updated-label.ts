// One plain wording for "when was this last reported": "Opdateret: 17.40",
// "Opdateret: i går 17.40" or "Opdateret: 9. nov. 17.40". Times in the future
// (beyond a minute of clock skew) or invalid times give no label.
import {formatDate} from './date-format.ts';

const PREFIX = 'Opdateret: ';

export function updatedLabel(ms: unknown, now: Date = new Date()): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || ms > now.getTime() + 60000) return '';
  const at = new Date(ms);
  const clock = formatDate(at, {hour: '2-digit', minute: '2-digit'});
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const age = Math.round((day(now) - day(at)) / 86400000);
  const date = () => formatDate(at, {day: 'numeric', month: 'short'});
  const when = age === 0 ? clock : age === 1 ? `i går ${clock}` : `${date()} ${clock}`;
  return `${PREFIX}${when}`;
}

// The same time wording without the prefix: "09.44", "i går 09.44", "9. nov. 09.44".
export function updatedWhen(ms: unknown, now: Date = new Date()): string {
  const label = updatedLabel(ms, now);
  return label ? label.slice(PREFIX.length) : '';
}
