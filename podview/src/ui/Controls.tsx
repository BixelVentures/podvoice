// Kit-Kontroller (design canvas): the controls that used to live inside the pages, at the same measures everywhere.
// Segment 44 in a grey pill (the chosen one a dark pill), section title 24/800, icon key 44 round, and the K-Switch
// as a key of its own (56×34 visible in a 44+ hit area). React Aria Components carry the behaviour; a press is a tap,
// never a drag's release (tap.ts).
import {LayoutGroup, motion, useReducedMotion} from 'motion/react';
import {useId} from 'react';
import type {ComponentPropsWithoutRef, ReactNode} from 'react';
import {
  Button as AriaButton, SwitchButton, SwitchField, ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
} from 'react-aria-components';
import type {Key} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {pressable} from './Button';
import {Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {SwitchMark} from './Switch';
import {tapOnly} from './tap';
import {cx, tv} from './tv';

// ---- Segment -----------------------------------------------------------------------------------------------------

export interface SegmentOption<K extends Key> {
  id: K;
  label: ReactNode;
  isDisabled?: boolean;
}

interface SegmentBase<K extends Key> {
  options: readonly SegmentOption<K>[];
  /** The chosen option, or null for none yet. */
  value: K | null;
  onChange: (value: K) => void;
  /** 44 (Kit-Kontroller) or 56 (a main choice, A-Robot »Type«). */
  size?: 44 | 56;
  /** Full width, the options sharing it equally (Tesla's seats, Robot's settings); else as wide as its labels. */
  fill?: boolean;
  isDisabled?: boolean;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}

/** The group must be named, by its own label or the visible title it sits under. */
export type SegmentProps<K extends Key> = SegmentBase<K> &
  ({'aria-label': string; 'aria-labelledby'?: never} | {'aria-labelledby': string; 'aria-label'?: never});

const segmentItem = tv({
  base: [
    pressable,
    'relative isolate flex min-w-0 items-center justify-center rounded-pv-pill px-5 font-pv font-semibold',
    'whitespace-nowrap text-pv-ink data-[selected]:text-pv-on-dark data-[pressed]:brightness-[.92]',
  ],
  variants: {
    size: {44: 'h-11 text-base', 56: 'h-14 text-[17px]'},
    fill: {true: 'flex-1', false: ''},
  },
});

/** One choice among a few, as a radiogroup: arrow keys move, the dark pill glides to the new choice (quick spring). */
export function Segment<K extends Key>({options, value, onChange, size = 44, fill = false, isDisabled, className,
  ...rest}: SegmentProps<K>) {
  const reduced = useReducedMotion() ?? false;
  return (
    <LayoutGroup id={useId()}>
      <AriaToggleButtonGroup
        {...rest}
        isDisabled={isDisabled ?? false}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={value === null ? [] : [value]}
        onSelectionChange={tapOnly((keys: Set<Key>) => {
          const [next] = keys;
          if (next !== undefined && next !== value) onChange(next as K);
        })}
        className={cx('flex gap-1 rounded-pv-pill bg-pv-line p-1', fill ? 'w-full' : 'w-max max-w-full', className)}
      >
        {options.map(option => (
          <AriaToggleButton key={option.id} id={option.id} isDisabled={option.isDisabled ?? false}
            className={segmentItem({size, fill})}>
            {({isSelected}) => (
              <>
                {isSelected ? (
                  <motion.span layoutId="segment" aria-hidden="true"
                    className="absolute inset-0 -z-1 rounded-[inherit] bg-pv-ink"
                    transition={reduced ? {duration: 0} : TRANSITION.quick} />
                ) : null}
                <span className="truncate">{option.label}</span>
              </>
            )}
          </AriaToggleButton>
        ))}
      </AriaToggleButtonGroup>
    </LayoutGroup>
  );
}

// ---- Section title -------------------------------------------------------------------------------------------------

/** A section's title: 24/800, as Kit-Kontroller's »Rengøringsvalg« and A-Lys's »Rum«. */
export function SectionTitle({as: Tag = 'h2', className, ...props}: ComponentPropsWithoutRef<'h2'> &
  {as?: 'h2' | 'h3' | 'span'}) {
  return <Tag {...props} className={cx('m-0 font-pv text-2xl leading-[30px] font-extrabold tracking-[-0.015em]',
    'text-pv-ink', className)} />;
}

/** A section's quiet label above its content (A-Lys »Scener«, A-Skaerm »Om skærmen«): 15/600 grey. */
export function SectionLabel({className, ...props}: ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={cx('font-pv text-[15px] leading-5 font-semibold text-pv-ink-3', className)} />;
}

// ---- Icon key ------------------------------------------------------------------------------------------------------

export interface IconKeyProps {
  icon: GlyphName;
  'aria-label': string;
  onPress?: () => void;
  isDisabled?: boolean;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}

/** A round 44 key with one glyph (a sheet's »Luk«, a list's menu). It names itself. */
export function IconKey({icon, onPress, className, ...props}: IconKeyProps) {
  return (
    <AriaButton {...props} {...(onPress ? {onPress: tapOnly(onPress)} : {})}
      className={cx(pressable, 'inline-flex size-11 shrink-0 items-center justify-center rounded-pv-pill',
        'bg-pv-surface-2 text-pv-ink data-[pressed]:brightness-[.92]', className)}>
      <Glyph name={icon} size={20} stroke={icon === 'close' ? 2.2 : 1.8} />
    </AriaButton>
  );
}

// ---- Switch key ----------------------------------------------------------------------------------------------------

export interface SwitchKeyProps {
  /** What it switches, and what a press does (»Sluk alle lys i Køkkenalrum«). */
  'aria-label': string;
  isSelected: boolean;
  onChange: (next: boolean) => void;
  isDisabled?: boolean;
  /** On, but the source is not current: the track greys (K-Switch »dim«). */
  dim?: boolean;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}

/** K-Switch as a control of its own: the 56×34 mark in a 44+ hit area with 5 px of air (K-Kit »Kontakt«). */
export function SwitchKey({isSelected, onChange, isDisabled = false, dim = false, className, ...props}:
  SwitchKeyProps) {
  return (
    <SwitchField {...props} isSelected={isSelected} isDisabled={isDisabled} onChange={tapOnly(onChange)}
      className="contents">
      <SwitchButton className={cx(pressable, 'inline-flex shrink-0 rounded-pv-pill px-1.5', className)}>
        <SwitchMark on={isSelected} dim={dim || isDisabled} />
      </SwitchButton>
    </SwitchField>
  );
}
