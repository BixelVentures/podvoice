// PodView's buttons on React Aria Components: press handling for touch, mouse, keyboard and assistive technology,
// the states as data attributes (data-pressed, data-focus-visible, data-disabled) the variants style. A button with
// a command in flight stays enabled (taps queue, they are never locked); `busy` only marks it (data-busy).
import {Button as AriaButton, ToggleButton as AriaToggleButton} from 'react-aria-components';
import type {ButtonProps as AriaButtonProps, ToggleButtonProps as AriaToggleButtonProps} from 'react-aria-components';
import {tv} from './tv';
import type {VariantProps} from './tv';

// Press feedback is the only CSS transition here: a short scale and colour change while the finger is down.
export const pressable =
  'cursor-pointer touch-manipulation select-none outline-none [-webkit-tap-highlight-color:transparent] ' +
  'transition-[scale,background-color,color] duration-pv-tap ease-pv-out data-[pressed]:scale-[.97] ' +
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
    },
    size: {
      md: 'min-h-pv-hit px-pv-s4 py-pv-s2',
      sm: 'min-h-12 px-pv-s3 py-pv-s1 text-pv-body font-medium',
      // An icon alone, as wide as a finger needs.
      icon: 'min-h-pv-hit min-w-pv-hit px-pv-s3 py-0',
      round: 'size-12 min-h-12 p-0',
    },
  },
  defaultVariants: {variant: 'secondary', size: 'md'},
});

type Data = Partial<Record<`data-${string}`, string>>;

export interface ButtonProps extends Omit<AriaButtonProps, 'className'>, VariantProps<typeof button>, Data {
  className?: string;
  /** A command started by this button is in flight (styling only; the button stays enabled). */
  busy?: boolean;
}

export function Button({variant, size, className, busy, ...props}: ButtonProps) {
  return <AriaButton {...props} data-busy={busy ? 'true' : undefined} className={button({variant, size, className})} />;
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
export function ToggleButton({variant, size, className, ...props}: ToggleButtonProps) {
  return <AriaToggleButton {...props} className={toggleButton({variant, size, className})} />;
}
