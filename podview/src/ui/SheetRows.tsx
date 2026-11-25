// The rows of a kit Sheet (Modal.tsx; the room key's »Vælg rum« and »Afspil på«, docs/PODVIEW-PARITY.md decision 1):
// rows of 96 (an icon, the name, a line of detail, a status at the end), and `SheetBody`, the scrolling content. A chosen row is filled dark (the shared fill moves on the quick spring, as Choices does); a row that
// cannot be chosen fades and says why in its detail. `SheetChoice` is one choice among the rows (a radio group);
// `SheetRow` is an action row (aria-pressed marks the chosen one).
import type {ReactNode} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {pressable} from './Button';
import {Chip, Choices} from './Choices';
import type {ChoicesProps} from './Choices';
import {Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {cx} from './tv';
import type {Key} from 'react-aria-components';

/** A sheet's content when it may outgrow the screen: many rooms scroll inside it (a finger here scrolls; the sheet's
 *  own surface still pulls it down). */
export function SheetBody({children}: {children: ReactNode}) {
  return (
    <div className="-mx-1 flex max-h-[min(600px,calc(100vh-200px))] touch-pan-y flex-col gap-pv-s3 overflow-y-auto
      overscroll-contain px-1" data-no-drag="">
      {children}
    </div>
  );
}

/** A small heading over a group of rows in a sheet. */
export function SheetSection({title, children, id}: {title: string; children: ReactNode; id: string}) {
  return (
    <section className="flex flex-col gap-pv-s2" aria-labelledby={id}>
      <h3 id={id} className="pt-pv-s1 text-[15px] font-semibold text-pv-ink-3">{title}</h3>
      {children}
    </section>
  );
}

const ROW = 'min-h-24 w-full justify-start gap-pv-s2 rounded-pv-l px-pv-s2 text-left';

function Copy({icon, name, detail, status}: {icon: GlyphName; name: string; detail: string; status?: string}) {
  return (
    <>
      <Glyph name={icon} size={28} stroke={1.6} className="mx-1" />
      <span className="grid min-w-0 flex-1 gap-pv-s1">
        <strong className="truncate text-pv-label font-semibold">{name}</strong>
        <small className="truncate text-pv-meta opacity-75">{detail}</small>
      </span>
      {status ? <span className="shrink-0 text-pv-meta font-semibold">{status}</span> : null}
    </>
  );
}

export interface SheetItem<K extends Key> {
  id: K;
  name: string;
  detail: string;
  status?: string;
  icon?: GlyphName;
  disabled?: boolean;
  label?: string;
}

/** Rows as one choice (a radio group): the chosen row is filled dark. */
export function SheetChoice<K extends Key>({items, value, onChange, ...props}: {items: SheetItem<K>[]} &
  Pick<ChoicesProps<K>, 'value' | 'onChange'> & {'aria-label': string}) {
  return (
    <Choices aria-label={props['aria-label']} className="grid gap-pv-s2" value={value} onChange={onChange}>
      {items.map(item => (
        <Chip key={item.id} id={item.id} className={ROW} aria-label={item.label ?? item.name}
          isDisabled={item.disabled ?? false}>
          <Copy icon={item.icon ?? 'speaker'} name={item.name} detail={item.detail}
            {...(item.status ? {status: item.status} : {})} />
        </Chip>
      ))}
    </Choices>
  );
}

export interface SheetRowProps {
  icon?: GlyphName;
  name: string;
  detail: string;
  status?: string;
  chosen?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  label?: string;
  [data: `data-${string}`]: string | undefined;
}

/** An action row (aria-pressed: the chosen one is filled dark). */
export function SheetRow({icon = 'speaker', name, detail, status, chosen = false, isDisabled = false, onPress,
  label, ...data}: SheetRowProps) {
  return (
    <AriaButton {...data}
      className={cx(pressable, 'flex items-center bg-pv-surface-2 font-pv text-pv-ink', ROW,
        'aria-pressed:bg-pv-dark aria-pressed:text-pv-on-dark data-[pressed]:brightness-[.96]')}
      aria-pressed={chosen}
      aria-label={label ?? [name, status].filter(Boolean).join(' · ')}
      isDisabled={isDisabled}
      onPress={onPress}>
      <Copy icon={icon} name={name} detail={detail} {...(status ? {status} : {})} />
    </AriaButton>
  );
}
