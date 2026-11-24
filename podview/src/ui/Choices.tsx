// One choice among a few (a room, a mood, a suction level): React Aria Components' ToggleButtonGroup with single
// selection, so the group is a radiogroup and each chip a radio, with arrow keys moving between them. A chip shows
// the choice at once; the caller decides what a press sends.
import {ToggleButton as AriaToggleButton, ToggleButtonGroup as AriaToggleButtonGroup} from 'react-aria-components';
import type {Key, ToggleButtonGroupProps, ToggleButtonProps} from 'react-aria-components';
import {pressable} from './Button';
import {tv} from './tv';

export const chip = tv({
  base: [
    pressable,
    'inline-flex min-h-pv-hit shrink-0 items-center justify-center gap-pv-s1 rounded-pv-pill bg-pv-surface-2 px-pv-s3 py-0',
    'font-pv text-pv-body whitespace-nowrap text-pv-ink',
    'data-[selected]:bg-pv-dark data-[selected]:text-pv-on-dark',
  ],
  variants: {
    size: {md: '', sm: 'min-h-12 px-pv-s2'},
  },
  defaultVariants: {size: 'md'},
});

export interface ChoicesProps<K extends Key> extends Omit<ToggleButtonGroupProps,
  'className' | 'selectionMode' | 'selectedKeys' | 'defaultSelectedKeys' | 'onSelectionChange'> {
  className?: string;
  /** The chosen chip's id, or null for none. */
  value: K | null;
  onChange: (value: K) => void;
  'aria-label': string;
}

export function Choices<K extends Key>({className, value, onChange, ...props}: ChoicesProps<K>) {
  return (
    <AriaToggleButtonGroup
      {...props}
      className={className ?? 'flex flex-wrap gap-pv-s1'}
      selectionMode="single"
      // A press on the chosen chip keeps it chosen.
      disallowEmptySelection
      selectedKeys={value === null ? [] : [value]}
      onSelectionChange={keys => {
        const [next] = keys;
        if (next !== undefined) onChange(next as K);
      }}
    />
  );
}

export interface ChipProps extends Omit<ToggleButtonProps, 'className' | 'id'> {
  id: Key;
  className?: string;
  size?: 'md' | 'sm';
  [data: `data-${string}`]: string | undefined;
}

export function Chip({className, size, ...props}: ChipProps) {
  return <AriaToggleButton {...props} className={chip({size, className})} />;
}
