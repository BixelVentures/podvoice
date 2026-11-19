// The shell's view: what the host (widget-view.js, the one state machine) last decided the topbar, Ro, Home's fixed
// rows and the dialogs show. The host computes it and calls `set`; React renders it synchronously (flushSync), so the
// host can read and measure the DOM right after, as it did when it wrote the nodes itself. Equal values are skipped,
// so an identical render writes nothing.
import {flushSync} from 'react-dom';
import type {ShellHost, ShellView} from './view';
import {INITIAL_VIEW} from './view';

export class ShellStore {
  private current: ShellView = INITIAL_VIEW;
  private listeners = new Set<() => void>();
  host: ShellHost | null = null;
  // The connection's »Prøv igen«: the host moves it between »Om skærmen« and the toast.
  retryButton: HTMLButtonElement | null = null;
  keepRetryButton(node: HTMLButtonElement | null): void {
    this.retryButton = node;
  }

  get view(): ShellView {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): ShellView => this.current;

  // Merges one part of the view; renders at once when anything changed.
  set<K extends keyof ShellView>(key: K, value: ShellView[K]): void {
    if (same(this.current[key], value)) return;
    this.current = {...this.current, [key]: value};
    const notify = () => {
      for (const listener of this.listeners) listener();
    };
    flushSync(notify);
  }
}

// Plain values compare by content (the host builds fresh objects on every render).
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a),
    keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  return keysA.every(key => same(left[key], right[key]));
}
