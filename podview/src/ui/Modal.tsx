// The panel's one overlay: React Aria Components' ModalOverlay, Modal and Dialog in their single portal, so focus
// stays in the dialog, the page behind is hidden from assistive technology, and Escape or a tap outside closes it.
// It fades and scales in and out with motion/react (transform and opacity only, the quick spring). While it leaves
// it is already closed: it takes no taps and holds no focus.
import {AnimatePresence, motion, useIsPresent, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
import {Dialog, Heading, Modal as AriaModal, ModalOverlay} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {cx} from './tv';

const MotionOverlay = motion.create(ModalOverlay);
const MotionModal = motion.create(AriaModal);

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
  className?: string;
  children: ReactNode;
  'aria-describedby'?: string;
}

function Overlay({onClose, title, role = 'dialog', isDismissable = true, action, className, children,
  ...rest}: Omit<ModalProps, 'isOpen'>) {
  const present = useIsPresent();
  const reduced = useReducedMotion() ?? false;
  const transition = reduced ? TRANSITION.reduced : TRANSITION.quick;
  return (
    <MotionOverlay
      isOpen
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
          'outline-none', className)}
        initial={reduced ? {opacity: 0} : {opacity: 0, transform: 'scale(0.96)'}}
        animate={reduced ? {opacity: 1} : {opacity: 1, transform: 'scale(1)'}}
        exit={reduced ? {opacity: 0} : {opacity: 0, transform: 'scale(0.98)'}}
        transition={transition}
      >
        <Dialog role={role} className="flex flex-col gap-pv-s3 outline-none" {...rest}>
          <div className="flex items-center justify-between gap-pv-s2">
            <Heading slot="title" className="text-pv-title font-semibold tracking-[-0.02em]">{title}</Heading>
            {action}
          </div>
          {children}
        </Dialog>
      </MotionModal>
    </MotionOverlay>
  );
}

export function Modal({isOpen, ...props}: ModalProps) {
  return <AnimatePresence>{isOpen ? <Overlay {...props} /> : null}</AnimatePresence>;
}
