// One choice among a few (a room, a mood, a suction level): React Aria Components' ToggleButtonGroup with single
// selection, so the group is a radiogroup and each chip a radio, with arrow keys moving between them. A chip shows
// the choice at once; the caller decides what a press sends. The chosen chip's dark fill is one shared element per
// group (motion/react layoutId in its own LayoutGroup): a new choice moves it there on the quick spring, as an iPad
// segmented control does (in place with reduced motion).
import {LayoutGroup, motion} from 'motion/react';
import {useId} from 'react';
import {ToggleButton as AriaToggleButton, ToggleButtonGroup as AriaToggleButtonGroup} from 'react-aria-components';
import type {Key, ToggleButtonGroupProps, ToggleButtonProps} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {pressable} from './Button';
import {tv} from './tv';

export const chip = tv({
  base: [
    pressable,
    'relative isolate inline-flex min-h-pv-hit shrink-0 items-center justify-center gap-pv-s1 rounded-pv-pill',
    'bg-pv-surface-2 px-pv-s3 py-0 font-pv text-pv-body whitespace-nowrap text-pv-ink',
    // The chosen fill is the shared indicator under the label (Chip).
    'data-[selected]:bg-transparent data-[selected]:text-pv-on-dark',
  ],
  variants: {
    size: {md: '', sm: 'min-h-12 px-pv-s2'},
  },
  defaultVariants: {size: 'md'},
});

interface ChoicesBase<K extends Key> extends Omit<ToggleButtonGroupProps, 'className' | 'selectionMode' |
  'selectedKeys' | 'defaultSelectedKeys' | 'onSelectionChange' | 'aria-label' | 'aria-labelledby'> {
  className?: string;
  /** The chosen chip's id, or null for none. */
  value: K | null;
  onChange: (value: K) => void;
  /** Given, a press on the chosen chip un-chooses it (the group may have none chosen). */
  onClear?: () => void;
}

/** The group must be named: by its own label, or by the visible label it sits under. */
export type ChoicesProps<K extends Key> = ChoicesBase<K> &
  ({'aria-label': string; 'aria-labelledby'?: never} | {'aria-labelledby': string; 'aria-label'?: never});

export function Choices<K extends Key>({className, value, onChange, onClear, ...props}: ChoicesProps<K>) {
  return (
    <LayoutGroup id={useId()}>
      <AriaToggleButtonGroup
        {...props}
        className={className ?? 'flex flex-wrap gap-pv-s1'}
        selectionMode="single"
        // A press on the chosen chip keeps it chosen, unless the group can be cleared.
        disallowEmptySelection={!onClear}
        selectedKeys={value === null ? [] : [value]}
        onSelectionChange={keys => {
          const [next] = keys;
          if (next !== undefined) onChange(next as K);
          else onClear?.();
        }}
      />
    </LayoutGroup>
  );
}

export interface ChipProps extends Omit<ToggleButtonProps, 'className' | 'id'> {
  id: Key;
  className?: string;
  size?: 'md' | 'sm';
  [data: `data-${string}`]: string | undefined;
}

export function Chip({className, size, children, ...props}: ChipProps) {
  return (
    <AriaToggleButton {...props} className={chip({size, className})}>
      {values => (
        <>
          {values.isSelected ? (
            <motion.span
              layoutId="chosen"
              aria-hidden="true"
              className="absolute inset-0 -z-1 rounded-[inherit] bg-pv-dark"
              transition={TRANSITION.quick}
            />
          ) : null}
          {typeof children === 'function' ? children(values) : children}
        </>
      )}
    </AriaToggleButton>
  );
}
