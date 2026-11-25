// Small parts the panel's screens share.
import {motion} from 'motion/react';
import type {Wish} from '../lib/ha/commands';
import {TRANSITION} from '../lib/motion/tokens';

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

// A hero's mark while there is no link to Home Assistant. Never »Sidst kendt« (G7 ruling): offline is the topbar's
// »Forbinder til Home Assistant …« and the dimmed cards, and old data carries K-Fresh, so the mark draws nothing.
export const LastKnown: (props: {className?: string}) => null = () => null;
