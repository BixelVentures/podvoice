// A modal <dialog> makes everything else on the page inert. If it is open but not drawn (an ancestor hidden by a
// navigation, a transition that never ran, placed off screen) the wall screen looks normal and ignores every tap.
// Two rules make that impossible:
// 1. openModal() opens a dialog modally only when it is drawn; otherwise it is not opened (never a trap).
// 2. installModalWatchdog() closes an open modal that is not drawn on the next touch and when the page becomes visible
//    again, so the first tap brings the screen back. A dialog that is still fading in counts as drawn.

// Whether an open dialog has a box on the screen that is not hidden (opacity aside).
function placed(dialog: HTMLDialogElement): boolean {
  if (!dialog.isConnected || !dialog.open) return false;
  const view = dialog.ownerDocument.defaultView;
  const box = dialog.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  if (view && (box.right <= 0 || box.bottom <= 0 || box.left >= view.innerWidth || box.top >= view.innerHeight))
    return false;
  return typeof dialog.checkVisibility !== 'function' || dialog.checkVisibility({visibilityProperty: true});
}

// Whether an open dialog is drawn: placed, and not fully transparent.
export function modalDrawn(dialog: HTMLDialogElement): boolean {
  return placed(dialog) &&
    (typeof dialog.checkVisibility !== 'function' || dialog.checkVisibility({opacityProperty: true}));
}

const moving = (dialog: HTMLDialogElement) =>
  typeof dialog.getAnimations === 'function' &&
  dialog.getAnimations().some(animation => animation.playState === 'running');

// showModal() only when the dialog will be drawn: connected, and not inside something hidden.
export function openModal(dialog: HTMLDialogElement): boolean {
  if (dialog.open) return typeof dialog.matches !== 'function' || dialog.matches(':modal');
  // (Test doubles may have no isConnected.)
  if (('isConnected' in dialog && !dialog.isConnected) || dialog.hidden) return false;
  const parent = dialog.parentElement;
  if (parent && typeof parent.checkVisibility === 'function' && !parent.checkVisibility()) return false;
  dialog.showModal();
  // Laid out at once: no box means a hidden ancestor (or display:none), so the page would be inert behind nothing.
  if (typeof dialog.getClientRects === 'function' && !dialog.getClientRects().length) {
    dialog.close();
    return false;
  }
  return true;
}

// Closes every open modal that is not drawn and not fading in. Returns how many it closed.
export function closeUndrawnModals(doc: Document): number {
  let closed = 0;
  for (const dialog of doc.querySelectorAll('dialog')) {
    if (!dialog.open || !dialog.matches(':modal') || modalDrawn(dialog)) continue;
    // Transparent while it fades in is fine; hidden, without a box or off screen never is.
    if (placed(dialog) && moving(dialog)) continue;
    dialog.close();
    closed++;
  }
  return closed;
}

const watched = new WeakSet<Document>();

export function installModalWatchdog(doc: Document | null | undefined) {
  if (!doc?.addEventListener || watched.has(doc)) return;
  watched.add(doc);
  const check = () => {
    if (doc.querySelector('dialog:modal')) closeUndrawnModals(doc);
  };
  // Capture on the document: an inert page still delivers the touch there.
  doc.addEventListener('pointerdown', check, {capture: true, passive: true});
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') check();
  });
}
