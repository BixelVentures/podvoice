// The confirmation step of Robot (Kør til basen / Afslut rengøring) and Bil (the integration's confirmation): a kit
// Dialog on React Aria's overlay hooks. It is not a native modal <dialog> and makes nothing inert: focus is held in the
// dialog (FocusScope), Escape and a tap outside cancel (useOverlay), and the page behind keeps its taps' meaning. It
// fades and scales in with motion/react (transform and opacity only, the kit's quick spring).
import {AnimatePresence, motion, useIsPresent, useReducedMotion} from 'motion/react';
import {useRef} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {FocusScope, useDialog, useOverlay, usePreventScroll} from 'react-aria';
import {TRANSITION} from '../../lib/motion/tokens';
import {KitButton} from '../../lib/ui/KitButton';
import {BUTTON, icon} from '../ui';

export interface ConfirmContent {
  id: string;
  title: string;
  description: string;
  cancelLabel: string;
  acceptLabel: string;
  acceptIcon?: string;
  tone?: 'danger';
  acceptDisabled?: boolean;
}

function Panel({content, onCancel, onAccept}: {content: ConfirmContent; onCancel: () => void; onAccept: () => void}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // While it fades out the dialog is already closed: it holds no focus and swallows no tap on the page.
  const open = useIsPresent();
  const {overlayProps} = useOverlay({isOpen: open, onClose: onCancel, isDismissable: open}, ref);
  const {dialogProps, titleProps} = useDialog({role: 'alertdialog'}, ref);
  usePreventScroll({isDisabled: !open});
  const titleId = `${content.id}-title`;
  return (
    <motion.div
      className="pv-panel-overlay"
      style={{position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--pv-scrim)',
        zIndex: 20, pointerEvents: open ? 'auto' : 'none'}}
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.quick}
    >
      <FocusScope contain={open} restoreFocus autoFocus>
        <motion.div
          {...(overlayProps as object)}
          {...(dialogProps as object)}
          ref={ref}
          id={content.id}
          className="pv-kit pv-kit-dialog pv-dialog"
          data-kit="dialog"
          data-kit-variant="default"
          aria-labelledby={titleId}
          aria-describedby={`${content.id}-description`}
          initial={reduced ? {opacity: 0} : {opacity: 0, transform: 'scale(0.96)'}}
          animate={reduced ? {opacity: 1} : {opacity: 1, transform: 'scale(1)'}}
          exit={reduced ? {opacity: 0} : {opacity: 0, transform: 'scale(0.98)'}}
          transition={reduced ? TRANSITION.reduced : TRANSITION.quick}
        >
          <header className="pv-dialog-header">
            <h2 {...titleProps} id={titleId} data-kit-text="headline">
              {content.title}
            </h2>
          </header>
          <p className="pv-meta pv-dialog-description" id={`${content.id}-description`} data-kit-text="body">
            {content.description}
          </p>
          <div className="pv-actions pv-dialog-actions">
            <KitButton className={BUTTON} data-kit="button" onPress={onCancel}>
              {content.cancelLabel}
            </KitButton>
            <KitButton
              className={BUTTON}
              data-kit="button"
              data-kit-variant="primary"
              data-tone={content.tone}
              isDisabled={content.acceptDisabled === true}
              onPress={onAccept}
            >
              {content.acceptIcon ? (
                <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src={icon(content.acceptIcon)} alt="" />
              ) : null}
              {content.acceptLabel}
            </KitButton>
          </div>
        </motion.div>
      </FocusScope>
    </motion.div>
  );
}

export function ConfirmOverlay({
  content,
  onCancel,
  onAccept,
}: {
  content: ConfirmContent | null;
  onCancel: () => void;
  onAccept: () => void;
}): ReactNode {
  const target = typeof document === 'undefined' ? null : document.body;
  if (!target) return null;
  return createPortal(
    <AnimatePresence>
      {content ? <Panel key={content.id} content={content} onCancel={onCancel} onAccept={onAccept} /> : null}
    </AnimatePresence>,
    target,
  );
}
