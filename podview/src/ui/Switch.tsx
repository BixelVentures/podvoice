// An on/off row (a lamp, a setting) on React Aria Components' SwitchField and SwitchButton: a native checkbox with
// role=switch inside a label the whole row taps. The row's look is the caller's (children); the state is
// data-selected on the row.
import {SwitchButton, SwitchField} from 'react-aria-components';
import type {SwitchFieldProps} from 'react-aria-components';
import type {ReactNode} from 'react';
import {pressable} from './Button';
import {tv} from './tv';

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

export function Switch({className, children, ...props}: SwitchProps) {
  return (
    <SwitchField {...props} className="contents">
      <SwitchButton className={switchRow({className})}>{children}</SwitchButton>
    </SwitchField>
  );
}
