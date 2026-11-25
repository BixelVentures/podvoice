// An on/off row (a lamp, a setting) on React Aria Components' SwitchField and SwitchButton: a native checkbox with
// role=switch inside a label the whole row taps. The row's look is the caller's (children); the state is
// data-selected on the row.
import {SwitchButton, SwitchField} from 'react-aria-components';
import type {SwitchFieldProps} from 'react-aria-components';
import type {ReactNode} from 'react';
import {pressable} from './Button';
import {motion, useReducedMotion} from 'motion/react';
import {TRANSITION} from '../lib/motion/tokens';
import {tapOnly} from './tap';
import {cx, tv} from './tv';

export const switchRow = tv({
  base: [
    pressable,
    'flex min-h-pv-hit w-full min-w-0 items-center gap-pv-s2 rounded-pv-pill bg-pv-surface-2 px-pv-s2 text-pv-ink',
    'data-[selected]:bg-pv-light data-[selected]:text-pv-light-ink',
  ],
});

export interface SwitchProps extends Omit<SwitchFieldProps, 'className' | 'children'> {
  /** The row's classes (the label the finger taps). */
  className?: string;
  children: ReactNode;
}

export function Switch({className, children, onChange, ...props}: SwitchProps) {
  // A drag that starts on the row and lifts on it is no tap: it never switches (tap.ts).
  return (
    <SwitchField {...props} {...(onChange ? {onChange: tapOnly(onChange)} : {})} className="contents">
      <SwitchButton className={switchRow({className})}>{children}</SwitchButton>
    </SwitchField>
  );
}

// K-Switch's look: a 56×34 track in a 44-high box, the knob left (off) or right (on); `dim` greys an on switch whose
// source is not there. The press belongs to the row around it (Switch).
export function SwitchMark({on, dim = false, className}: {on: boolean; dim?: boolean; className?: string}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <span className={cx('inline-flex h-11 w-14 shrink-0 items-center justify-center', className)} aria-hidden="true">
      <span className={cx('relative block h-[34px] w-14 rounded-[17px] transition-colors duration-300',
        on && !dim ? 'bg-pv-ink' : 'bg-pv-ink/16')}>
        {/* The knob travels on the quick spring (canvas .25 s); first paint stands where it is. */}
        <motion.i className="absolute top-[3px] left-[3px] block size-7 rounded-full bg-pv-surface
          shadow-[0_1px_3px_rgba(0,0,0,.25)]" initial={false} animate={{x: on ? 22 : 0}}
          transition={reduced ? TRANSITION.reduced : TRANSITION.quick} />
      </span>
    </span>
  );
}
