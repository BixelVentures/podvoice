// Small parts the panel's screens share.
import {motion} from 'motion/react';
import type {ReactNode} from 'react';
import {Button} from 'react-aria-components';
import type {Wish} from '../lib/ha/commands';
import {TRANSITION} from '../lib/motion/tokens';
import {cx, Icon, pressable, tv} from '../ui';
import type {ScreenId} from './nav';

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

// The live region is always there (a status must exist before it speaks); a new line settles in from just above.
export function Notice({text}: {text: string}) {
  return (
    <p className="col-span-full text-pv-meta text-pv-ink-2" role="status" hidden={!text}>
      {text ? (
        <motion.span
          key={text}
          className="block"
          initial={{opacity: 0, y: -4}}
          animate={{opacity: 1, y: 0}}
          transition={{...TRANSITION.quick, opacity: TRANSITION.fade}}
        >
          {text}
        </motion.span>
      ) : null}
    </p>
  );
}

// A hero's mark while there is no link to Home Assistant: what it shows is the last known state.
export function LastKnown({className}: {className?: string}) {
  return (
    <span
      className={cx('pointer-events-none absolute top-pv-s2 right-pv-s3 z-[2] hidden text-pv-meta text-pv-ink-2',
        'group-data-[link=offline]/host:block', className)}
      aria-hidden="true"
    >
      Sidst kendt
    </span>
  );
}
