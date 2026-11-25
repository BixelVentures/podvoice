// K-ActionTile: one surface that is a status and its action (Tesla's doors, the robot's base). The press runs the
// action and the feedback happens in the surface: calm (nothing to do), attention (something should be done),
// busy (sending: it fills from the left, three dots), done (confirmed: ✓) and error (outcome unknown).
import {motion, useReducedMotion} from 'motion/react';
import {Button as AriaButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {pressable} from './Button';
import {tapOnly} from './tap';
import {Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {cx, tv} from './tv';

export type ActionTone = 'calm' | 'attention' | 'busy' | 'done' | 'error';

const tile = tv({
  slots: {
    root: [pressable, 'relative flex h-44 w-full flex-col justify-between overflow-hidden rounded-[22px] px-[18px]',
      'pt-[18px] pb-4 text-left font-pv'],
    icon: 'flex size-11 items-center justify-center rounded-pv-s',
  },
  variants: {
    tone: {
      calm: {root: 'bg-pv-surface text-pv-ink shadow-[inset_0_0_0_1.5px_rgba(23,23,26,.10)]',
        icon: 'bg-pv-surface-2 text-pv-ink'},
      attention: {root: 'bg-pv-warning-tint text-pv-notice-action-ink shadow-[inset_0_0_0_2px_var(--color-pv-warning)]',
        icon: 'bg-pv-notice-action text-pv-attention-icon'},
      busy: {root: 'bg-pv-ink text-pv-on-dark', icon: 'bg-white/12 text-pv-on-dark'},
      done: {root: 'bg-pv-ok text-white', icon: 'bg-white/18 text-white'},
      error: {root: 'bg-pv-danger-tint text-pv-notice-error-ink shadow-[inset_0_0_0_2px_var(--color-pv-danger)]',
        icon: 'bg-pv-entry text-pv-danger'},
    },
  },
});

export function ActionTile({label, value, hint = '', icon, tone, onPress, className, height, isDisabled, ...data}: {
  label: string;
  value: string;
  hint?: string;
  icon: GlyphName;
  tone: ActionTone;
  onPress?: () => void;
  className?: string;
  /** The surface's height when its card gives it more than 176 (A-Tesla's Adgang: 196). */
  height?: number;
  isDisabled?: boolean;
  [data: `data-${string}`]: string | undefined;
}) {
  const {root, icon: iconBox} = tile({tone});
  const reduced = useReducedMotion() ?? false;
  return (
    <AriaButton {...data} className={root({className})} aria-label={`${label}: ${value}. ${hint}`}
      isDisabled={isDisabled ?? false} {...(height ? {style: {height}} : {})}
      data-busy={tone === 'busy' ? 'true' : undefined} {...(onPress ? {onPress: tapOnly(onPress)} : {})}>
      {tone === 'busy' && !reduced ? (
        // Sending: the surface fills from the left, again and again, until the outcome is known (canvas 1.6 s).
        <motion.i className="absolute inset-0 block origin-left bg-white/14" aria-hidden="true"
          initial={{scaleX: 0, opacity: 0.9}} animate={{scaleX: [0, 1, 1], opacity: [0.9, 0.9, 0]}}
          transition={{duration: 1.6, times: [0, 0.8, 1], ease: [0.4, 0, 0.2, 1], repeat: Infinity}} />
      ) : null}
      <span className="relative flex w-full items-start justify-between">
        <span className={iconBox()}>
          {tone === 'done' ? (
            // Confirmed: the ✓ pops in on the snappy spring.
            <motion.span className="block" initial={reduced ? {opacity: 0} : {scale: 0.6, opacity: 0}}
              animate={{scale: 1, opacity: 1}} transition={reduced ? TRANSITION.reduced : TRANSITION.snappy}>
              <Glyph name="check" size={24} stroke={2.6} />
            </motion.span>
          ) : <Glyph name={icon} size={24} stroke={1.8} />}
        </span>
        {tone === 'busy' ? (
          <span className="flex gap-1 pt-[18px]" aria-hidden="true">
            {[0, 150, 300].map(delay => (
              <i key={delay}
                className="block size-1.5 animate-pv-pulse rounded-full bg-current motion-reduce:animate-none"
                style={{animationDelay: `${String(delay)}ms`}} />
            ))}
          </span>
        ) : null}
      </span>
      <span className={cx('relative flex flex-col')}>
        <span className="text-[15px] leading-5 opacity-80">{label}</span>
        <span className="truncate text-2xl leading-[30px] font-extrabold tracking-[-0.01em]">{value}</span>
        <span className="h-5 truncate text-[15px] leading-5 font-semibold opacity-85">{hint}</span>
      </span>
    </AriaButton>
  );
}
