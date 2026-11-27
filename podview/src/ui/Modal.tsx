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
import {Dialog as AriaDialog, Heading, Modal as AriaModal, ModalOverlay} from 'react-aria-components';
import {SPRING, springParams, TRANSITION} from '../lib/motion/tokens';
import {Button} from './Button';
import {IconKey} from './Controls';
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
  /** `dialog` (Kit-Kontroller: 480 wide, radius 26, a 24/800 title) or `sheet` (A-Skaerm, »Afspil på«: 560 wide,
   * a 28/800 title and a quieter line under it). */
  variant?: 'dialog' | 'sheet';
}

const SURFACE = {dialog: 'w-[480px] p-7', sheet: 'w-[560px] p-8'} as const;
const GAP = {dialog: 'gap-5', sheet: 'gap-6'} as const;
const TITLE = {
  dialog: 'text-2xl leading-[30px] font-extrabold tracking-[-0.01em]',
  sheet: 'text-[28px] leading-[34px] font-extrabold tracking-[-0.02em]',
} as const;
const DESCRIPTION = {
  dialog: 'text-[17px] leading-6 text-pv-ink-2',
  sheet: 'text-base leading-[22px] text-pv-ink-3',
} as const;

function Overlay({onClose, title, role = 'dialog', isDismissable = true, action, description, className, children,
  variant = 'dialog', ...rest}: Omit<ModalProps, 'isOpen'>) {
  const present = useIsPresent();
  const descriptionId = useId();
  const reduced = useReducedMotion() ?? false;
  const transition = reduced ? TRANSITION.reduced : {...TRANSITION.quick, opacity: TRANSITION.fade};
  const pullable = isDismissable && role === 'dialog';
  // A sheet is an iPad sheet: anchored to the bottom edge, it rises from below on the navigation spring and goes
  // back down the same way (thrown, with the finger's velocity); it never floats in the middle or drifts as its
  // content changes height. A dialog appears in place.
  const sheet = variant === 'sheet';
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
      className={cx('fixed inset-0 z-20 grid bg-pv-scrim',
        sheet ? 'items-end justify-items-center' : 'place-items-center')}
      style={{pointerEvents: present ? 'auto' : 'none'}}
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      transition={transition}
    >
      <MotionModal
        className={cx('max-w-[calc(100vw-48px)] rounded-pv-dialog bg-pv-surface font-pv text-pv-ink outline-none',
          'shadow-[0_24px_48px_-20px_rgba(23,23,26,.55)]', SURFACE[variant],
          pullable && 'touch-none', className)}
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
        <AriaDialog
          role={role}
          className={cx('flex flex-col outline-none', GAP[variant])}
          {...rest}
          {...(description ? {'aria-describedby': descriptionId} : {})}
        >
          <div className="flex items-start justify-between gap-pv-s2">
            <div className="flex min-w-0 flex-col gap-1">
              <Heading slot="title" className={cx('m-0', TITLE[variant])}>{title}</Heading>
              {description && variant === 'sheet' ? (
                <p id={descriptionId} className={cx('m-0', DESCRIPTION.sheet)}>{description}</p>
              ) : null}
            </div>
            {action}
          </div>
          {description && variant === 'dialog' ? (
            <p id={descriptionId} className={cx('m-0', DESCRIPTION.dialog)}>{description}</p>
          ) : null}
          {children}
        </AriaDialog>
      </MotionModal>
    </MotionOverlay>
  );
}

export function Modal({isOpen, ...props}: ModalProps) {
  return <AnimatePresence>{isOpen ? <Overlay {...props} /> : null}</AnimatePresence>;
}

export interface DialogProps {
  isOpen: boolean;
  /** The question (»Kør til basen?«). */
  title: ReactNode;
  /** What happens if it is answered yes, in the product's words. */
  description?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** `fare` for an action that ends something (Afslut), else the dark primary key. */
  confirmVariant?: 'primaer' | 'fare';
  /** The action cannot be sent now (no link to Home Assistant): the key is dimmed; cancel still answers. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  id?: string;
}

/** Kit-Kontroller's confirmation: an alertdialog (it must be answered: no tap outside, no pull) with K-Btn 56 keys,
 * Annullér first and the action last, right-aligned. Escape cancels. */
export function Dialog({isOpen, title, description, cancelLabel, confirmLabel, confirmVariant = 'primaer',
  confirmDisabled = false, onConfirm, onCancel, id}: DialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} role="alertdialog" isDismissable={false}
      {...(description ? {description} : {})} {...(id ? {id} : {})}>
      <div className="flex justify-end gap-3">
        <Button variant="sekundaer" size={56} onPress={onCancel}>{cancelLabel}</Button>
        <Button variant={confirmVariant} size={56} isDisabled={confirmDisabled} onPress={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export interface SheetProps extends Omit<ModalProps, 'variant' | 'action' | 'role'> {
  /** The close key's name (default »Luk«). */
  closeLabel?: string;
}

/** A sheet over the page (A-Skaerm, »Afspil på«, the sticky line's »Mere ▾«): 560 wide, a 28/800 title with a quiet
 * line under it, a round 44 close key, and pull down to close. */
export function Sheet({closeLabel = 'Luk', onClose, ...props}: SheetProps) {
  return (
    <Modal {...props} onClose={onClose} variant="sheet"
      action={<IconKey icon="close" aria-label={closeLabel} onPress={onClose} />} />
  );
}
