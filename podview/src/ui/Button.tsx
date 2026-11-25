// PodView's buttons on React Aria Components: press handling for touch, mouse, keyboard and assistive technology,
// the states as data attributes (data-pressed, data-focus-visible, data-disabled) the variants style. A button with
// a command in flight stays enabled (taps queue, they are never locked); `busy` only marks it (data-busy).
import {Button as AriaButton, ToggleButton as AriaToggleButton} from 'react-aria-components';
import type {ButtonProps as AriaButtonProps, ToggleButtonProps as AriaToggleButtonProps} from 'react-aria-components';
import {Glyph} from './glyphs';
import type {FilledName, GlyphName} from './glyphs';
import {tapOnly} from './tap';
import {tv} from './tv';
import type {VariantProps} from './tv';

// Press feedback is the only CSS transition here, and one token for every pressable in the kit (G7 ruling): while the
// finger is down it scales to .97 and darkens to brightness .92, over 120 ms (--duration-pv-tap).
export const pressable =
  'cursor-pointer touch-manipulation select-none outline-none [-webkit-tap-highlight-color:transparent] ' +
  'transition-[scale,background-color,color,filter] duration-(--duration-pv-tap) ease-pv-out ' +
  'data-[pressed]:scale-[.97] data-[pressed]:brightness-[.92] ' +
  'data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-4 data-[focus-visible]:outline-pv-ink ' +
  'data-[disabled]:cursor-default data-[disabled]:opacity-40';

export const button = tv({
  base: [
    pressable,
    'inline-flex min-w-0 max-w-full shrink-0 items-center justify-center gap-pv-s1 overflow-hidden rounded-pv-pill',
    'font-pv text-pv-label leading-6 font-semibold text-ellipsis whitespace-nowrap',
  ],
  variants: {
    variant: {
      secondary: 'bg-pv-surface-2 text-pv-ink',
      primary: 'bg-pv-dark text-pv-on-dark',
      quiet: 'bg-transparent text-pv-ink',
      danger: 'bg-pv-danger text-pv-on-danger',
      // K-Btn (design canvas): the kit's seven looks.
      primaer: 'bg-pv-ink text-pv-on-dark data-[pressed]:brightness-[.92]',
      sekundaer: 'bg-pv-surface-2 text-pv-ink data-[pressed]:brightness-[.92]',
      kant: 'bg-transparent text-pv-ink shadow-[inset_0_0_0_1.5px_rgba(23,23,26,.2)] ' +
        'data-[pressed]:brightness-[.92]',
      fare: 'bg-pv-entry text-pv-danger shadow-[inset_0_0_0_2px_var(--color-pv-danger)] ' +
        'data-[pressed]:brightness-[.92]',
      lys: 'bg-pv-surface text-pv-ink data-[pressed]:brightness-[.92]',
      moerk: 'bg-pv-dark-2 text-pv-on-dark data-[pressed]:brightness-[.92]',
      alarm: 'bg-pv-timer-accent text-pv-ink data-[pressed]:brightness-[.92]',
    },
    size: {
      md: 'min-h-pv-hit px-pv-s4 py-pv-s2',
      sm: 'min-h-12 px-pv-s3 py-pv-s1 text-pv-body font-medium',
      // An icon alone, as wide as a finger needs.
      icon: 'min-h-pv-hit min-w-pv-hit px-pv-s3 py-0',
      round: 'size-12 min-h-12 p-0',
      // A chip's look for a plain action among chips (»Vælg musik«, »Prøv igen«).
      chip: 'min-h-pv-hit px-pv-s3 py-0 text-pv-body font-normal',
      // K-Btn: 56 is the primary height, 44 the secondary minimum; an icon alone is round (h × h).
      56: 'h-14 min-w-14 gap-2.5 px-[26px] text-[17px] font-semibold has-[svg:first-child]:pl-[22px]',
      44: 'h-11 min-w-11 gap-2 px-[18px] text-base font-semibold has-[svg:first-child]:pl-[14px]',
    },
    iconOnly: {true: 'px-0 has-[svg:first-child]:pl-0', false: ''},
    // How a disabled key looks: faded (the default), or `solid`, a quiet grey key whose words keep their contrast
    // (≥ 4.5:1) where a faded dark key on a tinted hero would not (A-Robot's Start while it cannot start).
    disabledLook: {
      fade: '',
      solid: 'data-[disabled]:bg-pv-surface-2 data-[disabled]:text-pv-ink-3 data-[disabled]:opacity-100 ' +
        'data-[disabled]:shadow-none',
    },
  },
  defaultVariants: {variant: 'secondary', size: 'md', iconOnly: false, disabledLook: 'fade'},
});

type Data = Partial<Record<`data-${string}`, string>>;

export interface ButtonProps extends Omit<AriaButtonProps, 'className'>, VariantProps<typeof button>, Data {
  className?: string;
  /** A command started by this button is in flight (styling only; the button stays enabled). */
  busy?: boolean;
  /** K-Btn's optional leading glyph (alone: a round icon key). */
  icon?: GlyphName | FilledName;
}

export function Button({variant, size, disabledLook, className, busy, icon, children, onPress, ...props}:
  ButtonProps) {
  const iconOnly = !!icon && children === undefined;
  return (
    // A drag's release is no press (tap.ts).
    <AriaButton {...props} {...(onPress ? {onPress: tapOnly(onPress)} : {})} data-busy={busy ? 'true' : undefined}
      className={button({variant, size, iconOnly, disabledLook, className})}>
      {icon ? (
        <>
          <Glyph name={icon} size={size === 44 ? 18 : 20} stroke={1.9} />
          {typeof children === 'function' ? null : children}
        </>
      ) : children}
    </AriaButton>
  );
}

/** A button with only an icon: it must name itself (aria-label). */
export function IconButton(props: ButtonProps & {'aria-label': string}) {
  return <Button size="icon" {...props} />;
}

export const toggleButton = tv({
  extend: button,
  base: 'data-[selected]:bg-pv-dark data-[selected]:text-pv-on-dark',
});

export interface ToggleButtonProps
  extends Omit<AriaToggleButtonProps, 'className'>, VariantProps<typeof button>, Data {
  className?: string;
}

/** An on/off button (aria-pressed); selected it is dark. */
export function ToggleButton({variant, size, disabledLook, className, onChange, ...props}: ToggleButtonProps) {
  return (
    <AriaToggleButton {...props} {...(onChange ? {onChange: tapOnly(onChange)} : {})}
      className={toggleButton({variant, size, disabledLook, className})} />
  );
}
