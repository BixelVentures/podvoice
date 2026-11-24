// Small parts the panel's screens share. Kit classes and data attributes are the ones the stage stylesheet styles.
import {useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {Button} from 'react-aria-components';
import type {Wish} from '../lib/ha/commands';
import {Icon, pressable, tv} from '../ui';
import type {ScreenId} from './nav';

export const BUTTON = 'pv-kit pv-kit-button pv-btn';
export const icon = (name: string) => `assets/icons/${name}.svg`;

// A Home tile: icon, title, detail, chevron. A tile that opens a screen names it (data-opens): the shell builds that
// screen as the finger lands (prewarm), so the push after the release animates a screen that already exists.
// Offline, a tile shows its last known line, dimmed and marked (never disabled: a tap reports »Ikke sendt«).
const tile = tv({
  base: [
    pressable,
    'relative flex min-h-[168px] min-w-0 items-start gap-pv-s2 rounded-pv-l p-pv-s3 text-left text-pv-ink',
    'group-data-[link=offline]/host:opacity-55',
  ],
  variants: {tone: {quiet: 'bg-pv-surface-2', tesla: 'bg-pv-tesla'}},
  defaultVariants: {tone: 'quiet'},
});

export function Shortcut({
  id,
  iconName,
  title,
  detail,
  extra,
  screen,
  tone,
  onPress,
}: {
  id: string;
  iconName: string;
  title: ReactNode;
  detail: string;
  extra?: ReactNode;
  screen?: ScreenId;
  tone?: 'quiet' | 'tesla';
  onPress: () => void;
}) {
  return (
    <Button id={id} className={tile({tone})} onPress={onPress} data-opens={screen}>
      <Icon name={iconName} className="size-pv-icon-m" />
      <span className="grid min-w-0 gap-pv-s1">
        <strong className="text-pv-body leading-[21px] font-medium">{title}</strong>
        <small className="text-pv-meta leading-[19px] text-pv-ink-2">{detail}</small>
        {extra}
      </span>
      <Icon name="chevron-right" className="ml-auto size-[18px]" />
      <span className="absolute top-pv-s2 right-pv-s3 hidden text-pv-meta text-pv-ink-2
        group-data-[link=offline]/host:block" aria-hidden="true">
        Sidst kendt
      </span>
    </Button>
  );
}

export const UNKNOWN_TEXT = 'Udfald ukendt · handlingen gentages ikke';
export const REJECTED_TEXT = 'Home Assistant afviste handlingen';
export const NOT_SENT_TEXT = 'Ikke sendt – ingen forbindelse';

// The honest end of a wish that HA did not confirm. A call that never left the page is not an unknown outcome.
export function wishNotice(wish: Wish | undefined): string {
  if (wish?.phase === 'not_sent') return NOT_SENT_TEXT;
  if (wish?.phase === 'unknown') return UNKNOWN_TEXT;
  if (wish?.phase === 'rejected') return wish.reason && wish.reason !== 'rejected' ? `${REJECTED_TEXT}: ${wish.reason}` : REJECTED_TEXT;
  return '';
}

export function Notice({text}: {text: string}) {
  return (
    <p className="col-span-full text-pv-meta text-pv-ink-2" role="status" hidden={!text}>
      {text}
    </p>
  );
}

// A kit slider (input.pv-kit-slider) that follows the finger locally and sends once when the gesture ends; while
// no gesture runs it shows `value` (the wish, else what HA reports).
export function KitSlider({
  id,
  label,
  identity,
  value,
  min = 0,
  max = 100,
  disabled = false,
  format,
  onCommit,
}: {
  id: string;
  label: string;
  identity: string;
  value: number | null;
  min?: number;
  max?: number;
  disabled?: boolean;
  format: (value: number) => string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value ?? min;
  const commit = () => {
    if (draft === null) return;
    onCommit(draft);
    setDraft(null);
  };
  const progress = `${String(((shown - min) / Math.max(1, max - min)) * 100)}%`;
  return (
    <div className="pv-kit-slider-field">
      <label htmlFor={id} data-kit-text="field-label">
        {label}
      </label>
      <output htmlFor={id}>{value === null && draft === null ? 'Ikke oplyst' : format(shown)}</output>
      <input
        id={id}
        className="pv-kit pv-kit-slider pv-slider"
        data-kit="slider"
        data-kit-identity={identity}
        data-kit-value-known={String(value !== null || draft !== null)}
        type="range"
        min={min}
        max={max}
        step={1}
        value={shown}
        disabled={disabled}
        aria-valuetext={value === null && draft === null ? 'Ikke oplyst' : format(shown)}
        style={{'--pv-slider-progress': progress} as CSSProperties}
        onChange={event => {
          setDraft(Number(event.currentTarget.value));
        }}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
}
