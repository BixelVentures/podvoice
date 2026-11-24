// The panel's one overlay: React Aria Components' ModalOverlay, Modal and Dialog in their single portal, so focus
// stays in the dialog, the page behind is hidden from assistive technology, and Escape or a tap outside closes it.
// It fades and scales in and out with motion/react (transform on the quick spring, opacity as a fade). While it
// leaves it is already closed: it takes no taps, holds no focus and leaves the page behind usable. A description
// under the title describes the dialog (aria-describedby), as an alertdialog's question needs.
// A dismissable dialog can be pulled down to close, as an iPad sheet: a finger on its surface (not on a control)
// drags it 1:1 (it barely gives upwards); let go far enough down or fast enough, it is thrown out with the finger's
// velocity, else it springs back (motion/react drag). An alertdialog must be answered, so it never drags.
import {AnimatePresence, motion, useDragControls, useIsPresent, useReducedMotion} from 'motion/react';
import type {PanInfo} from 'motion/react';
import {useId, useState} from 'react';
import type {ReactNode} from 'react';
import {Dialog, Heading, Modal as AriaModal, ModalOverlay} from 'react-aria-components';
import {SPRING, springParams, TRANSITION} from '../lib/motion/tokens';
import {cx} from './tv';

const MotionOverlay = motion.create(ModalOverlay);
const MotionModal = motion.create(AriaModal);

// How far down (px), or how fast (px/s), a pulled dialog must be let go to close.
const THROW_DISTANCE = 120;
const THROW_VELOCITY = 600;
// Let go short of that, it springs back on the flick spring (the reward for a gesture with momentum).
const FLICK = springParams(SPRING.flick);
// A finger on a control works the control; only the dialog's own surface drags it.
const CONTROLS = 'button, a, input, textarea, select, label, [role=slider], [role=switch], [role=radio], ' +
  '[role=checkbox], [role=button], [data-no-drag]';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  /** An alertdialog asks before something happens; a dialog shows a choice. */
  role?: 'dialog' | 'alertdialog';
  /** Tap outside closes (not for an alertdialog). */
  isDismissable?: boolean;
  /** Next to the title (a close button). */
  action?: ReactNode;
  /** Under the title: what the dialog asks or says (the dialog's description). */
  description?: ReactNode;
  className?: string;
  children: ReactNode;
  'aria-describedby'?: string;
  /** The dialog's id (a hook for tests and the wall's regression check). */
  id?: string;
}

function Overlay({onClose, title, role = 'dialog', isDismissable = true, action, description, className, children,
  ...rest}: Omit<ModalProps, 'isOpen'>) {
  const present = useIsPresent();
  const descriptionId = useId();
  const reduced = useReducedMotion() ?? false;
  const transition = reduced ? TRANSITION.reduced : {...TRANSITION.quick, opacity: TRANSITION.fade};
  const pullable = isDismissable && role === 'dialog';
  const drag = useDragControls();
  // Thrown down by a finger: it leaves downwards with the finger's velocity instead of shrinking in place.
  const [thrown, setThrown] = useState(false);
  const release = (_: PointerEvent, info: PanInfo) => {
    if (info.offset.y < THROW_DISTANCE && info.velocity.y < THROW_VELOCITY) return;
    setThrown(true);
    onClose();
  };
  return (
    <MotionOverlay
      // Leaving, it is closed for React Aria (the page behind is no longer inert, Escape and focus are released)
      // and only kept on screen for the fade.
      isOpen={present}
      isExiting={!present}
      onOpenChange={open => {
        if (!open && present) onClose();
      }}
      isDismissable={isDismissable && role === 'dialog'}
      className="fixed inset-0 z-20 grid place-items-center bg-pv-scrim"
      style={{pointerEvents: present ? 'auto' : 'none'}}
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      transition={transition}
    >
      <MotionModal
        className={cx('w-[520px] max-w-[calc(100vw-48px)] rounded-pv-dialog bg-pv-surface p-pv-s4 text-pv-ink',
          'outline-none', pullable && 'touch-none', className)}
        initial={reduced ? {opacity: 0} : {opacity: 0, scale: 0.96}}
        animate={reduced ? {opacity: 1} : {opacity: 1, scale: 1, y: 0}}
        exit={reduced ? {opacity: 0} : thrown ? {opacity: 0, y: 480} : {opacity: 0, scale: 0.98}}
        transition={thrown ? {...TRANSITION.page, opacity: TRANSITION.fade} : transition}
        {...(pullable
          ? {
              drag: 'y' as const,
              dragListener: false,
              dragControls: drag,
              dragConstraints: {top: 0, bottom: 0},
              dragElastic: {top: 0.05, bottom: 1},
              dragTransition: {bounceStiffness: FLICK.k, bounceDamping: FLICK.c},
              onPointerDown: (event: React.PointerEvent) => {
                if (event.target instanceof Element && !event.target.closest(CONTROLS)) drag.start(event);
              },
              onDragEnd: release,
            }
          : {})}
      >
        <Dialog
          role={role}
          className="flex flex-col gap-pv-s3 outline-none"
          {...rest}
          {...(description ? {'aria-describedby': descriptionId} : {})}
        >
          <div className="flex items-center justify-between gap-pv-s2">
            <Heading slot="title" className="text-pv-title font-semibold tracking-[-0.02em]">{title}</Heading>
            {action}
          </div>
          {description ? (
            <p id={descriptionId} className="-mt-pv-s1 text-pv-body text-pv-ink-2">
              {description}
            </p>
          ) : null}
          {children}
        </Dialog>
      </MotionModal>
    </MotionOverlay>
  );
}

export function Modal({isOpen, ...props}: ModalProps) {
  return <AnimatePresence>{isOpen ? <Overlay {...props} /> : null}</AnimatePresence>;
}
