// Mounts the shell into the page's body, synchronously, before the host and the HA kiosk integration start: both
// look for the shell's nodes when they load. The host (pv-widget-host) starts only once the whole shell is in the
// document; the custom element can be defined before or after this mount (see shellReady).
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import '../../ui/library/components.js';
import {Shell} from './Shell';
import {ShellStore} from './store';

const mounted = new WeakMap<Document, ShellStore>();
const roots = new WeakMap<Document, Root>();

// The shell of a document, once mounted; the host takes its store from here.
export function shellStore(doc: Document): ShellStore | undefined {
  return mounted.get(doc);
}

interface StartableHost extends HTMLElement {
  startShell?: () => void;
}

export function mountShell(doc: Document = document): ShellStore {
  const existing = mounted.get(doc);
  if (existing) return existing;
  const store = new ShellStore();
  // The root lives off-page; the shell is a portal into <body>, so the body holds exactly the shell's nodes.
  const root = createRoot(doc.createElement('div'));
  flushSync(() => {
    root.render(<Shell store={store} body={doc.body} />);
  });
  mounted.set(doc, store);
  roots.set(doc, root);
  // A host defined before the mount was connected while the shell was still being inserted: it starts now.
  for (const host of doc.querySelectorAll<StartableHost>('pv-widget-host')) host.startShell?.();
  return store;
}

// Takes the shell out of the document again (tests mount one page after another in the same document).
export function unmountShell(doc: Document = document): void {
  const root = roots.get(doc);
  roots.delete(doc);
  mounted.delete(doc);
  if (!root) return;
  flushSync(() => {
    root.unmount();
  });
}
