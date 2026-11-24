// The confirmation step of Robot (Kør til basen / Afslut rengøring) and Bil (the integration's confirmation): the
// panel's Modal as an alertdialog with the question, what it does, and Cancel / Accept. Escape and Cancel cancel; a
// tap outside does nothing. Accept goes once: the dialog closes at the tap, and while it fades out it takes no taps.
import {useIsPresent} from 'motion/react';
import type {ReactNode} from 'react';
import {Button, Icon, Modal} from '../../ui';

export interface ConfirmContent {
  title: string;
  description: string;
  cancelLabel: string;
  acceptLabel: string;
  acceptIcon?: string;
  tone?: 'danger';
  acceptDisabled?: boolean;
}

interface ConfirmProps {
  content: ConfirmContent;
  onCancel: () => void;
  onAccept: () => void;
}

function Actions({content, onCancel, onAccept}: ConfirmProps) {
  // While it leaves, the dialog is already answered: a second tap sends nothing.
  const open = useIsPresent();
  return (
    <div className="flex flex-wrap items-center justify-end gap-pv-s2 pt-pv-s1">
      <Button
        onPress={() => {
          if (open) onCancel();
        }}
      >
        {content.cancelLabel}
      </Button>
      <Button
        variant={content.tone === 'danger' ? 'danger' : 'primary'}
        isDisabled={content.acceptDisabled === true}
        onPress={() => {
          if (open) onAccept();
        }}
      >
        {content.acceptIcon ? <Icon name={content.acceptIcon} className="invert" /> : null}
        {content.acceptLabel}
      </Button>
    </div>
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
  // Closed, the Modal keeps its last content while it fades out (AnimatePresence holds the leaving element).
  return (
    <Modal
      isOpen={content !== null}
      onClose={onCancel}
      role="alertdialog"
      title={content?.title}
      description={content?.description}
    >
      {content ? <Actions content={content} onCancel={onCancel} onAccept={onAccept} /> : null}
    </Modal>
  );
}
