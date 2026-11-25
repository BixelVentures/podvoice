// K-Fresh: how old shown data is, as a chip with a clock (»Opdateret 11.02«). Data under 30 minutes old
// has no chip; older data shows its time, never the words »Sidst kendt«. Solid sits on a picture.
import {updatedWhen} from '../lib/format/updated-label';
import {Glyph} from './glyphs';
import {cx} from './tv';

export function Fresh({text, solid = false, className}: {text: string; solid?: boolean; className?: string}) {
  return (
    <span className={cx('inline-flex h-8 items-center gap-2 rounded-pv-pill px-3 font-pv text-[15px] font-semibold',
      'whitespace-nowrap text-pv-ink-2',
      solid ? 'bg-pv-surface shadow-[0_4px_12px_-6px_rgba(23,23,26,.35)]' : 'bg-pv-ink/8', className)}>
      <Glyph name="clock" size={16} stroke={2.2} />
      {text}
    </span>
  );
}

const FRESH_MS = 30 * 60_000;

/** The chip's words for data read at `at` (ms): none under 30 minutes, else »Opdateret 11.02« (today), »Opdateret i
 *  går 11.02« or »Opdateret 9. nov. 11.02«: one wording on every screen (G7 #8). */
export function freshText(at: number, now: number): string | null {
  if (!Number.isFinite(at) || now - at < FRESH_MS) return null;
  const when = updatedWhen(at, new Date(now));
  return when ? `Opdateret ${when}` : null;
}
