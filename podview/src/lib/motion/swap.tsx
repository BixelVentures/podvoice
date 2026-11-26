// Content that changes in place, as a keyed cross-fade (docs/MOTION.md §1, »Indhold, der skifter«).
//
// Why not AnimatePresence mode="popLayout": motion pops the leaving element out of the flow by inserting a <style>
// rule into the document, and a new stylesheet recalculates the style of the whole page in the frame of the change
// (measured on a push: the Topbar's key swap alone added 100–200 ms to the tap's frame in WebKit). Here the leaving
// face takes itself out of the flow with its own class (`out`, absolute in the item's relative box), so nothing but
// the face itself is restyled.
//
// - The new face enters from just below (text), from a smaller scale (icon) or by opacity alone (fade); the old one
//   leaves the other way, at once, out of reach (no taps, aria-hidden; never `inert`, which the panel keeps for
//   its hidden screens only). A text face that leaves keeps its glyphs in a
//   pseudo-element (`text`), so the element's text (what assistive technology and the checks read) is only ever the
//   current one.
// - Interruptible: a change mid-flight starts the new face from where the old one is going; nothing waits.
// - The first paint never animates (initial={false}). Reduced motion: opacity only.
import {AnimatePresence, motion, useIsPresent, useReducedMotion} from 'motion/react';
import type {Transition} from 'motion/react';
import type {ReactNode} from 'react';
import {cx} from '../../ui/tv';
import {TRANSITION} from './tokens';

export type SwapKind = 'text' | 'icon' | 'fade';

const FACE: Record<SwapKind, {enter: Record<string, number>; leave: Record<string, number>}> = {
  text: {enter: {opacity: 0, y: 6}, leave: {opacity: 0, y: -6}},
  icon: {enter: {opacity: 0, scale: 0.6}, leave: {opacity: 0, scale: 0.6}},
  fade: {enter: {opacity: 0}, leave: {opacity: 0}},
};

function Face({kind, text, className, out, transition, children}: {
  kind: SwapKind;
  text: string | undefined;
  className: string | undefined;
  out: string;
  transition: Transition | undefined;
  children: ReactNode;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion() ?? false;
  const face = reduced ? FACE.fade : FACE[kind];
  const move = transition ?? (kind === 'fade' ? TRANSITION.fade : {...TRANSITION.quick, opacity: TRANSITION.fade});
  const leaving = !present && text !== undefined;
  return (
    <motion.span
      className={cx(className, !present && out, !present && 'pointer-events-none',
        leaving && 'before:content-[attr(data-swap-text)]')}
     
      aria-hidden={present ? undefined : true}
      data-swap-text={leaving ? text : undefined}
      initial={face.enter}
      animate={{opacity: 1, y: 0, scale: 1}}
      exit={face.leave}
      transition={reduced ? TRANSITION.reduced : move}
    >
      {leaving ? null : children}
    </motion.span>
  );
}

/** A keyed cross-fade inside a relative box: `swapKey` is what changes; `out` places the leaving face. */
export function Swap({swapKey, kind = 'text', text, className, out = 'absolute inset-x-0 top-0', transition,
  children}: {
  swapKey: string;
  kind?: SwapKind;
  /** A text face: its text, kept by the leaving face in a pseudo-element. */
  text?: string;
  className?: string;
  out?: string;
  transition?: Transition;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      <Face key={swapKey} kind={kind} text={text} className={className} out={out} transition={transition}>
        {children}
      </Face>
    </AnimatePresence>
  );
}

/** A widget's or a hero's line (21° → 22°, »3 tændt« → »Slukket«): the new text cross-fades in with a small rise
 *  while the old one leaves upwards. The line's text stays one text node (what the checks and assistive technology
 *  read), and the same text never redraws. */
export function LiveLine({text, className, out}: {text: string; className?: string; out?: string}) {
  return (
    <Swap swapKey={text} text={text} {...(className ? {className} : {})} {...(out ? {out} : {})}>
      {text}
    </Swap>
  );
}
