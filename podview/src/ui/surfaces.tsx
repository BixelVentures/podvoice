// The panel's surfaces: a Card (a screen's block), a ListRow (one line in a list) and a Disclosure (a block that
// opens and closes, React Aria Components). Plain elements with PodView's tokens; screens add their own layout.
import type {ComponentPropsWithoutRef, ReactNode} from 'react';
import {Button as AriaButton, Disclosure as AriaDisclosure, DisclosurePanel, Heading} from 'react-aria-components';
import {pressable} from './Button';
import {Icon} from './Icon';
import {cx, tv} from './tv';

export const card = tv({
  base: 'min-w-0 rounded-pv-l text-pv-ink',
  variants: {
    tone: {
      surface: 'bg-pv-surface',
      quiet: 'bg-pv-surface-2',
      outline: 'border border-pv-line bg-pv-surface',
      // The canvas's own page card (.cd): radius 24 with a 1-px inner line.
      kit: 'rounded-pv-widget bg-pv-surface shadow-pv-edge',
    },
    inset: {none: '', md: 'p-pv-s3', lg: 'p-pv-s4'},
  },
  defaultVariants: {tone: 'surface', inset: 'md'},
});

export function Card({className, tone, inset, ...props}: ComponentPropsWithoutRef<'section'> &
  {tone?: 'surface' | 'quiet' | 'outline' | 'kit'; inset?: 'none' | 'md' | 'lg'}) {
  return <section {...props} className={card({tone, inset, className})} />;
}

export const listRow = tv({
  base: 'flex min-h-pv-hit min-w-0 items-center gap-pv-s2 rounded-pv-l px-pv-s2 text-pv-body text-pv-ink',
  variants: {
    tone: {
      quiet: 'bg-pv-surface-2', plain: '', feedback: 'bg-pv-warning-tint text-pv-ink',
      // Kit-Kontroller's list row: 48 high on a hairline, the label 17 and its value 15 grey (ListValue).
      line: 'min-h-12 gap-3 rounded-none border-b border-pv-ink/8 px-0 font-pv text-[17px]',
    },
  },
  defaultVariants: {tone: 'quiet'},
});

export function ListRow({className, tone, ...props}: ComponentPropsWithoutRef<'div'> &
  {tone?: 'quiet' | 'plain' | 'feedback' | 'line'}) {
  return <div {...props} className={listRow({tone, className})} />;
}

/** A line row's value on the right (»500 g«, »Ikke oplyst«). */
export function ListValue({className, ...props}: ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={cx('shrink-0 text-[15px] leading-5 text-pv-ink-3', className)} />;
}

export function Disclosure({title, label, children, className, defaultExpanded = false}: {
  title: ReactNode;
  /** The trigger's accessible name, when it says more than the visible title. */
  label?: string;
  children: ReactNode;
  className?: string;
  defaultExpanded?: boolean;
}) {
  return (
    <AriaDisclosure defaultExpanded={defaultExpanded} className={cx('group min-w-0', className)}>
      <Heading className="m-0">
        <AriaButton
          slot="trigger"
          {...(label ? {'aria-label': label} : {})}
          className={cx(pressable, 'flex min-h-pv-hit w-full items-center justify-between gap-pv-s2 rounded-pv-l',
            'text-left text-pv-label font-semibold text-pv-ink')}
        >
          {title}
          <Icon name="chevron-down" className="group-data-[expanded]:rotate-180" />
        </AriaButton>
      </Heading>
      <DisclosurePanel>{children}</DisclosurePanel>
    </AriaDisclosure>
  );
}
