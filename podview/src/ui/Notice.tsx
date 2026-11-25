// K-Notice, the kit's message line: fejl (red), handling (amber), info (grey) or ok (a confirmation, ✓), only in the
// product's own words. Full: a 72-px line; compact: one 40-px line inside a hero, so nothing below moves.
// NoticeSlot is its lifecycle: one at a time; in over 280 ms (it slides 12 px down and fades in, and the content under
// it is pushed softly), out over 220 ms (a fade and a collapse). Fejl and handling cannot be closed (they stand while
// their state holds), info has its ×, and a confirmation goes by itself after 3 s.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {pressable} from './Button';
import {Glyph} from './glyphs';
import {cx, tv} from './tv';

export type NoticeLevel = 'fejl' | 'handling' | 'info' | 'ok';

const notice = tv({
  slots: {
    box: 'flex items-center font-pv',
    mark: 'flex flex-none items-center justify-center rounded-full font-extrabold text-white',
  },
  variants: {
    level: {
      fejl: {box: 'bg-pv-danger-tint text-pv-notice-error-ink', mark: 'bg-pv-danger'},
      handling: {box: 'bg-pv-notice-action text-pv-notice-action-ink', mark: 'bg-pv-alert'},
      info: {box: 'bg-pv-notice-info text-pv-ink-2', mark: 'bg-pv-notice-info-icon'},
      ok: {box: 'bg-pv-notice-info text-pv-ink-2', mark: 'bg-pv-ok'},
    },
    compact: {
      true: {box: 'inline-flex h-10 max-w-full gap-2.5 rounded-xl pr-3.5 pl-2', mark: 'size-6 text-sm'},
      false: {box: 'min-h-[72px] w-full gap-4 rounded-[20px] px-5 py-3.5', mark: 'size-9 text-[19px]'},
    },
  },
});

export function Notice({level, title, text = '', compact = false, onClose, className}: {
  level: NoticeLevel;
  title: string;
  text?: string;
  compact?: boolean;
  /** Info only: the × that closes it. */
  onClose?: () => void;
  className?: string;
}) {
  const {box, mark} = notice({level, compact});
  const glyph = level === 'info' ? 'i' : level === 'ok' ? '✓' : '!';
  if (compact) {
    return (
      <div role="status" className={box({className})}>
        <span className={mark()} aria-hidden="true">{glyph}</span>
        <span className="truncate text-[15px] leading-5"><b className="font-extrabold">{title}</b>
          {text ? ` · ${text}` : ''}</span>
      </div>
    );
  }
  return (
    <div role="status" className={box({className})}>
      <span className={mark()} aria-hidden="true">{glyph}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[17px] leading-[22px] font-extrabold">{title}</span>
        {text ? <span className="text-[15px] leading-5 font-medium">{text}</span> : null}
      </span>
      {level === 'info' && onClose ? (
        <AriaButton aria-label="Luk besked" onPress={onClose}
          className={cx(pressable, 'ml-auto flex size-11 flex-none items-center justify-center rounded-pv-pill')}>
          <Glyph name="close" size={18} stroke={2.2} />
        </AriaButton>
      ) : null}
    </div>
  );
}

export interface ShownNotice {
  /** A new id is a new event (an info closed before comes back with the next one). */
  id: string;
  level: NoticeLevel;
  title: string;
  text?: string;
}

const IN_MS = 280;
const OUT_MS = 220;
const OK_MS = 3000;

export function NoticeSlot({notice: shown, compact = false, onClose, className}: {
  notice: ShownNotice | null;
  compact?: boolean;
  /** Info's × and a confirmation's own end. */
  onClose?: (id: string) => void;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    if (shown?.level !== 'ok' || !onClose) return;
    const handle = setTimeout(() => {
      onClose(shown.id);
    }, OK_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [shown, onClose]);
  const ease = TRANSITION.fade;
  return (
    <AnimatePresence initial={false} mode="wait">
      {shown ? (
        <motion.div key={shown.id} className={cx('overflow-hidden', className)}
          initial={reduced || compact ? {opacity: 0} : {opacity: 0, y: -12, height: 0}}
          animate={reduced || compact ? {opacity: 1} : {opacity: 1, y: 0, height: 'auto'}}
          exit={reduced || compact ? {opacity: 0} : {opacity: 0, height: 0}}
          transition={reduced ? TRANSITION.reduced : {...ease, duration: IN_MS / 1000}}
          {...(reduced ? {} : {variants: {}})}
        >
          <Notice level={shown.level} title={shown.title} compact={compact}
            {...(shown.text ? {text: shown.text} : {})}
            {...(shown.level === 'info' && onClose ? {onClose: () => {
              onClose(shown.id);
            }} : {})} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
export const NOTICE_MS = {in: IN_MS, out: OUT_MS, ok: OK_MS};
