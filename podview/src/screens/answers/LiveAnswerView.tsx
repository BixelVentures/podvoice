// Svar, live: the owner of the live answers on the wall screen (the shell's this.liveAnswers). Same API as the
// pre-React live-answer-view.js: it reads the owner's answers, history and transcripts through the transport,
// fences every late result by boot, room, transport generation and read context, keeps the saved history, expires
// live cards, presents a suggested answer when the screen is quiet, and shows an answer's source in its dialog
// ("Kilde og grundlag"). The dialog is a native <dialog> the view appends to the host; React draws its inside
// (SourceDialog) synchronously (flushSync), so the dialog is current when a call returns.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {
  answerSession,
  groupAnswerHistory,
  historicalAnswers,
  ownedAnswers,
  ownedSource,
  transcriptHistory,
} from '../../../owner-answers.js';
import {applyKitComponent} from '../../../ui/kit.js';
import type {Answer, AnswerSnapshot, OwnedSource} from './types';

export interface AnswerTransport {
  connected: boolean;
  generation?: number;
  answers: (mode?: boolean | 'segments') => Promise<unknown>;
  source: (id: string) => Promise<unknown>;
}

export interface LiveAnswerState {
  answers: Answer[];
  focus?: string | undefined;
  [key: string]: unknown;
}

// The shell (widget-view.js) as this view uses it.
export interface LiveAnswerHost {
  append: (node: Node) => void;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  contains: (node: Node | null) => boolean;
  isConnected: boolean;
  dataset: DOMStringMap;
  state: LiveAnswerState;
  liveSnapshot?: AnswerSnapshot | null;
  liveTransport?: AnswerTransport | null;
  answerNodes?: Map<string, Element>;
  historyBrowse?: unknown;
  lastInteractionAt?: number;
  screenLifecycle?: {pointers?: {size: number}};
  suspendForAnswer?: () => boolean;
  render: () => void;
  focusHeading: () => void;
  dispatch: (event: {type: string; id: string}) => void;
}

interface SourceView {
  note: string;
  busy: boolean | null;
  source: OwnedSource | null;
  stamp: string;
}

const readCode = (error: unknown) => (error as {code?: unknown} | null)?.code;

export function answerReadContext(snapshot: AnswerSnapshot | null | undefined): string | null {
  const a = snapshot?.answers;
  if (snapshot?.capabilities?.answerRead !== true || !a || !snapshot.bootId || !snapshot.roomId || !a.sessionId ||
    a.sessionId !== answerSession(snapshot) || !a.turnId || !a.taskId || !Number.isInteger(a.inputRevision) ||
    (a.inputRevision ?? -1) < 0 || !Number.isInteger(a.revision) || (a.revision ?? -1) < 0) return null;
  return JSON.stringify([snapshot.bootId, snapshot.roomId, a.sessionId, a.turnId, a.taskId, a.inputRevision,
    a.revision, a.sessionEpoch ?? null, a.providerGeneration ?? null, a.answerRevision ?? null]);
}

export function answerOwnerContext(snapshot: AnswerSnapshot | null | undefined): string | null {
  const key = answerReadContext(snapshot);
  if (!key) return null;
  const values = JSON.parse(key) as unknown[];
  return JSON.stringify([...values.slice(0, 6), values[7], values[8]]);
}

const expiresAt = (answer: Answer) => Math.min(
  ((answer.observedAt ?? NaN) + 120) * 1000,
  Number.isFinite(answer.validUntil) ? (answer.validUntil ?? 0) * 1000 : Infinity,
  Number.isFinite(answer.provenance?.validUntil) ? (answer.provenance?.validUntil ?? 0) * 1000 : Infinity,
);

const scopeOf = (snapshot: AnswerSnapshot | null | undefined) => JSON.stringify([snapshot?.bootId, snapshot?.roomId]);

function SourceDialog({view, onClose}: {view: SourceView; onClose: () => void}) {
  const {source} = view;
  return (
    <>
      <header className="pv-dialog-header">
        <h2 id="owner-source-title">Kilde og grundlag</h2>
        <button
          type="button"
          className="dialog-close pv-kit pv-kit-button pv-btn pv-dialog-close"
          data-kit="button"
          data-kit-variant="icon"
          onClick={onClose}
        >
          Luk
        </button>
      </header>
      <p className="pv-meta pv-dialog-description" role="status">
        {view.note}
      </p>
      <div className="pv-content pv-dialog-content" aria-busy={view.busy ?? undefined}>
        {source && (
          <>
            <p>{source.summary}</p>
            {source.sourceText && <p>{source.sourceText}</p>}
            <dl>
              {source.facts.map((fact, index) => (
                <div key={`fact-${String(index)}`}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                  <p>{fact.detail}</p>
                </div>
              ))}
              {(source.events ?? []).map((event, index) => (
                <div key={`event-${String(index)}`}>
                  <dt>{event.time}</dt>
                  <dd>{event.label}</dd>
                  <p>{event.detail}</p>
                </div>
              ))}
            </dl>
            <p>{view.stamp}</p>
          </>
        )}
      </div>
    </>
  );
}

export class LiveAnswerView {
  host: LiveAnswerHost;
  history = new Map<string, Answer>();
  historyScope: string | null = null;
  historyRevision: number | undefined;
  historySerial = 0;
  historyPending = false;
  historyReadStatus: string | undefined;
  historyReadScope: string | null = null;
  transcripts: Map<string, Answer> | undefined;
  transcriptSerial = 0;
  transcriptPending = false;
  transcriptScope: string | null = null;
  transcriptTransport: AnswerTransport | null | undefined = null;
  transcriptStatus: string | undefined;
  initialReceiptIds: Set<string> | undefined;
  initialReceiptsUnknown = false;
  generation = 0;
  lastRead = 0;
  revision = 0;
  presented = new Set<string>();
  pending = false;
  sourceSerial = 0;
  sourceId: string | undefined;
  sourceContext: string | null | undefined;
  sourceScroll: number | undefined;
  opener: HTMLElement | null | undefined;
  expiryTimer: ReturnType<typeof setTimeout> | undefined;
  dialog: HTMLDialogElement;
  body!: HTMLElement;
  note!: HTMLElement;
  private readonly reactRoot: Root;
  private source: SourceView = {note: '', busy: null, source: null, stamp: ''};
  private drawn = false;

  constructor(host: LiveAnswerHost) {
    this.host = host;
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'pv-component';
    dialog.setAttribute('aria-labelledby', 'owner-source-title');
    applyKitComponent(dialog, 'dialog', {variant: 'default'});
    this.reactRoot = createRoot(dialog);
    this.paint();
    const part = (selector: string) => {
      const node = dialog.querySelector<HTMLElement>(selector);
      if (!node) throw Error(`Source dialog is missing ${selector}`);
      return node;
    };
    this.note = part(':scope > .pv-meta');
    this.body = part(':scope > .pv-content');
    host.append(dialog);
    dialog.addEventListener('close', () => {
      if (dialog.dataset.presentationClose === 'true') {
        delete dialog.dataset.presentationClose;
        return;
      }
      this.sourceSerial++;
      this.setBusy(false);
      if (this.opener?.isConnected) this.opener.focus();
    });
    host.addEventListener('owner-answer-retry', event => {
      event.stopPropagation();
      const detail = (event as CustomEvent<{receiptId?: string} | undefined>).detail;
      if (!host.liveTransport?.connected || this.pending || !this.currentAnswer(detail?.receiptId)) return;
      this.lastRead = 0;
      void this.refresh(true);
    });
    host.addEventListener('owner-source', event => {
      event.stopPropagation();
      const detail = (event as CustomEvent<{receiptId: string}>).detail;
      void this.showSource(detail.receiptId, event.target as HTMLElement);
    });
  }

  private paint(change: Partial<SourceView> = {}) {
    const next = {...this.source, ...change};
    const same = (Object.keys(next) as (keyof SourceView)[]).every(key => next[key] === this.source[key]);
    if (same && this.drawn) return;
    this.drawn = true;
    this.source = next;
    flushSync(() => {
      this.reactRoot.render(<SourceDialog view={next} onClose={() => {
        this.dialog.close();
      }} />);
    });
  }

  private setBusy(busy: boolean) {
    this.paint({busy});
  }

  private setNote(note: string) {
    this.paint({note});
  }

  // The dialog's content goes; its note and busy state stay.
  private clearSource() {
    this.paint({source: null, stamp: ''});
  }

  private live(): boolean {
    return this.host.liveTransport?.connected === true;
  }

  currentAnswer(id: string | undefined): Answer | undefined | null | '' {
    const key = answerReadContext(this.host.liveSnapshot);
    return key && this.host.state.answers.find(a =>
      a.live && !a.historical && a.receiptId === id && a.readContext === key && expiresAt(a) > Date.now());
  }

  remember(items: Answer[]) {
    const snapshot = this.host.liveSnapshot;
    if (Number.isSafeInteger(snapshot?.answerHistoryRevision)) return;
    this.historyRevision = undefined; // A legacy page cache does not attest the server archive.
    const scope = scopeOf(snapshot);
    if (this.historyScope !== scope) {
      this.history.clear();
      this.historyScope = scope;
    }
    // Closed content: at most 8 rows, 4 sources, 2048-char URLs and bounded text.
    // 64KiB covers UTF-8 expansion plus receipt metadata; 20 whole records <= 1.25MiB.
    for (const answer of items) {
      if (answer.status !== 'ready' || !answer.live || answer.historical || this.history.has(answer.id)) continue;
      const copy = structuredClone({...answer, historical: true, readConnected: false, readContext: null,
        readStatus: 'ready', allowedActions: []});
      if (new TextEncoder().encode(JSON.stringify(copy)).length > 65536) continue;
      this.history.set(answer.id, copy);
    }
    while (this.history.size > 20) {
      const oldest = this.history.keys().next().value;
      if (oldest === undefined) break;
      this.history.delete(oldest);
    }
  }

  retained(items: Answer[]): Answer[] {
    this.checkTranscriptScope();
    items = items.filter(a => !a.transcriptSegment);
    const hidden = new Map(this.host.state.answers.map(a => [a.id, a.hidden]));
    const ids = new Set(items.map(a => a.id));
    const saved = [...this.history.values()].reverse().filter(a => !ids.has(a.id))
      .map(a => ({...structuredClone(a), hidden: hidden.has(a.id) ? hidden.get(a.id) : a.hidden} as Answer));
    const transcripts = [...(this.transcripts?.values() ?? [])].map(a => ({...a, hidden: hidden.get(a.id) ?? false}));
    return [...items, ...saved, ...transcripts];
  }

  onSnapshot(previous: AnswerSnapshot | null | undefined, next: AnswerSnapshot) {
    const host = this.host;
    if (!previous || previous.bootId !== next.bootId || previous.roomId !== next.roomId) {
      this.initialReceiptIds = new Set(next.answerHistoryReceiptIds ?? []);
      this.initialReceiptsUnknown = !Array.isArray(next.answerHistoryReceiptIds);
    } else if (answerReadContext(previous) !== answerReadContext(next)) this.initialReceiptsUnknown = false;
    this.checkTranscriptScope();
    if (previous && (previous.bootId !== next.bootId || previous.roomId !== next.roomId)) {
      this.invalidate(true, true);
      return;
    }
    if (previous && Number.isSafeInteger(next.answerHistoryRemovalRevision) &&
      previous.answerHistoryRemovalRevision !== next.answerHistoryRemovalRevision) {
      if (!Array.isArray(next.answerHistoryReceiptIds)) {
        this.invalidate(true, true);
        return;
      }
      const ids = new Set(next.answerHistoryReceiptIds);
      this.generation++;
      this.sourceSerial++;
      this.pending = false;
      this.lastRead = 0;
      this.historySerial++;
      this.historyPending = false;
      this.historyRevision = undefined;
      for (const [id, answer] of this.history) if (!ids.has(answer.receiptId ?? '')) this.history.delete(id);
      const old = host.state.answers;
      const items = old.filter(answer => !answer.live || !!answer.transcriptSegment || ids.has(answer.receiptId ?? ''));
      const removed = old.some(answer => answer.id === host.state.focus) &&
        !items.some(answer => answer.id === host.state.focus);
      host.state = {...host.state, answers: items, focus: removed ? 'now' : host.state.focus};
      if (this.dialog.open && !ids.has(this.sourceId ?? '')) {
        this.dialog.close();
        this.clearSource();
      }
      this.setBusy(false);
      if (removed) host.focusHeading();
    }
    if (previous && previous.answerHistoryRemovalRevision === next.answerHistoryRemovalRevision &&
      previous.answerHistoryRevision !== next.answerHistoryRevision) {
      this.generation++;
      this.pending = false;
      this.lastRead = 0;
      this.historySerial++;
      this.historyPending = false;
    }
    const before = answerOwnerContext(previous), after = answerOwnerContext(next);
    if ((previous && before !== after) || (!after && host.state.answers.some(answer => answer.live &&
      !answer.historical))) {
      this.invalidate(true, false);
      return;
    }
    this.pruneExpired();
    if (!previous || answerReadContext(previous) === answerReadContext(next)) return;
    this.generation++;
    this.sourceSerial++;
    this.pending = false;
    this.lastRead = 0;
    // Display retention only: original readContext still fences every source/retry.
    host.state = {...host.state, answers: host.state.answers.map(answer => answer.live && !answer.historical
      ? {...answer, revision: next.answers?.revision, readStatus: 'pending', readConnected: false} as Answer
      : answer)};
    if (this.dialog.open) {
      this.sourceScroll = this.body.scrollTop || 0;
      this.clearSource();
      this.setBusy(true);
      this.setNote('');
    }
  }

  pruneExpired() {
    clearTimeout(this.expiryTimer);
    const host = this.host, old = host.state.answers;
    const items = this.retained(old.filter(answer => !answer.live || (!answer.historical &&
      expiresAt(answer) > Date.now())));
    if (items.length !== old.length ||
      items.some((a, i) => {
        const before = old[i];
        return a.id !== before?.id || a.historical !== before.historical;
      })) {
      const previousFocus = document.activeElement;
      const closingSource = this.dialog.open &&
        !items.some(answer => !answer.historical && answer.receiptId === this.sourceId);
      const recoverFocus = old.some(answer => !items.some(item => item.id === answer.id) &&
        host.answerNodes?.get(answer.id)?.contains(previousFocus)) ||
        (closingSource && this.dialog.contains(previousFocus));
      const removed = old.some(answer => answer.id === host.state.focus) &&
        !items.some(answer => answer.id === host.state.focus);
      // An expired live card the user is reading stays on screen as its saved history copy.
      const focused = old.find(answer => answer.id === host.state.focus);
      const saved = removed && focused?.receiptId &&
        items.find(answer => answer.historical && answer.receiptId === focused.receiptId);
      host.state = {...host.state, answers: items, focus: saved ? saved.id : removed ? 'now' : host.state.focus};
      if (this.dialog.open && !items.some(answer => !answer.historical && answer.receiptId === this.sourceId)) {
        this.dialog.close();
        this.clearSource();
      }
      if (host.isConnected) {
        host.render();
        const active = document.activeElement;
        if (recoverFocus && !document.querySelector('dialog[open]') &&
          (active === document.body || active === previousFocus || !active?.isConnected)) host.focusHeading();
      }
    }
    const deadlines = items.filter(answer => answer.live && !answer.historical).map(expiresAt)
      .filter(Number.isFinite);
    if (host.isConnected && deadlines.length) {
      this.expiryTimer = setTimeout(() => {
        this.pruneExpired();
      }, Math.max(1, Math.min(...deadlines) - Date.now()));
      (this.expiryTimer as {unref?: () => void}).unref?.();
    }
  }

  setReadStatus(status: string) {
    const host = this.host;
    host.state = {...host.state, answers: host.state.answers.map(a => a.live && !a.historical ? {...a,
      readStatus: status, readConnected: !['offline', 'pending'].includes(status) &&
        a.readContext === answerReadContext(host.liveSnapshot) && expiresAt(a) > Date.now()} : a)};
  }

  invalidate(revoke = false, clearHistory = revoke) {
    if (clearHistory) this.clearTranscripts();
    if (clearHistory || !revoke) {
      this.historySerial++;
      this.historyPending = false;
    }
    if (clearHistory) {
      this.historyReadStatus = undefined;
      this.historyReadScope = null;
      this.historyRevision = undefined;
      this.history.clear();
      this.historyScope = null;
    }
    this.generation++;
    this.sourceSerial++;
    this.setBusy(false);
    this.pending = false;
    this.lastRead = 0;
    if (revoke) {
      clearTimeout(this.expiryTimer);
      this.sourceScroll = undefined;
      this.revision = 0;
      this.presented.clear();
      this.dialog.close();
      this.clearSource();
      const host = this.host, focus = host.state.focus ?? '';
      const focused = host.state.answers.some(a => a.live && a.id === focus);
      host.state = {...host.state, answers: this.retained(host.state.answers.filter(a => !a.live)),
        focus: focused && !(this.history.has(focus) || this.transcripts?.has(focus)) ? 'now' : host.state.focus};
    } else {
      this.setReadStatus('offline');
      if (this.dialog.open) this.setNote('Forbindelsen mangler · viser seneste grundlag.');
      this.pruneExpired();
    }
  }

  clearTranscripts() {
    this.transcriptSerial++;
    this.transcriptPending = false;
    this.transcripts = new Map();
    this.transcriptScope = null;
    this.transcriptTransport = null;
    this.transcriptStatus = undefined;
  }

  checkTranscriptScope() {
    const host = this.host, s = host.liveSnapshot;
    if (this.transcriptScope && (this.transcriptScope !== scopeOf(s) ||
      this.transcriptTransport !== host.liveTransport || s?.capabilities?.answerRead !== true)) this.clearTranscripts();
  }

  async refreshTranscripts() {
    this.checkTranscriptScope();
    const host = this.host, s = host.liveSnapshot, transport = host.liveTransport;
    if (this.transcriptPending || !host.isConnected || !transport?.connected || s?.capabilities?.answerRead !== true)
      return;
    const scope = scopeOf(s), serial = ++this.transcriptSerial, generation = transport.generation;
    this.transcriptScope = scope;
    this.transcriptTransport = transport;
    this.transcriptPending = true;
    this.transcriptStatus = 'loading';
    host.render();
    const scoped = () => host.isConnected && host.liveTransport === transport && scopeOf(host.liveSnapshot) === scope &&
      serial === this.transcriptSerial;
    const current = () => scoped() && transport.connected && transport.generation === generation &&
      host.liveSnapshot?.capabilities?.answerRead === true;
    try {
      const value = await transport.answers('segments');
      if (!current() || !host.liveSnapshot) return;
      const result = transcriptHistory(value, host.liveSnapshot);
      this.transcripts = new Map(result.items.map((segment, index) => {
        const id = `transcript:${segment.segmentId || `read:${String(serial)}:${String(index)}`}`;
        const title = segment.role === 'user' ? 'Du' : segment.role === 'assistant' ? 'PodVoice' : 'Samtaleudskrift';
        return [id, {id, kind: 'concise', title, live: true, historical: true, transcriptSegment: segment,
          status: 'ready', observedAt: segment.ts, content: {summary: segment.text}, allowedActions: [],
          readConnected: false}];
      }));
      this.transcriptStatus = 'ready';
    } catch (error) {
      if (current() && readCode(error) === 'read_access_denied') {
        this.invalidate(true, true);
        this.transcriptStatus = 'error';
        host.render();
        return;
      }
      if (current()) this.transcriptStatus = 'error';
    } finally {
      if (serial === this.transcriptSerial) {
        this.transcriptPending = false;
        if (current()) {
          if (this.transcriptStatus === 'loading') this.transcriptStatus = 'error';
          const old = host.state.answers, items = this.retained(old);
          const removed = old.some(a => a.id === host.state.focus) && !items.some(a => a.id === host.state.focus);
          host.state = {...host.state, answers: items, focus: removed ? 'now' : host.state.focus};
          host.render();
          if (removed) host.focusHeading();
        }
      }
    }
  }

  historyPresentation(): {hidden: boolean; data: {state: string; quietStatus: true; text: string; detail: string}} {
    const host = this.host, s = host.liveSnapshot;
    const retained = groupAnswerHistory(host.state.answers, this).length > 0;
    if (!Number.isSafeInteger(s?.answerHistoryRevision)) {
      return {hidden: retained, data: {state: 'empty', quietStatus: true, text: 'Ingen visuelle svar endnu',
        detail: 'Når PodVoice viser et visuelt svar, kan du finde det her igen.'}};
    }
    const scope = scopeOf(s);
    const ready = this.historyRevision === s?.answerHistoryRevision && this.historyScope === scope;
    const status = !host.liveTransport?.connected ? 'offline'
      : s?.capabilities?.answerRead !== true ? 'unsupported'
        : this.historyReadScope === scope && this.historyReadStatus === 'error' ? 'error'
          : this.historyPending || !ready ? 'loading' : 'empty';
    const copy: Record<string, [string, string]> = {
      loading: ['Henter tidligere svar…', retained ? 'De kendte svar bevares imens.' : ''],
      error: ['Tidligere svar kunne ikke hentes', retained
        ? 'De kendte svar er bevaret. Historikken opdateres, når forbindelsen tillader det.'
        : 'Historikken opdateres, når forbindelsen tillader det.'],
      offline: ['Forbindelsen mangler', retained ? 'Viser de kendte svar.' : 'Tidligere svar kan ikke hentes lige nu.'],
      unsupported: ['Tidligere svar er ikke tilgængelige', 'Adgangen til historikken mangler.'],
      empty: ['Ingen visuelle svar endnu', 'Når PodVoice viser et visuelt svar, kan du finde det her igen.'],
    };
    const [text, detail] = copy[status] ?? ['', ''];
    return {hidden: retained && (status === 'loading' || (ready && status === 'empty')),
      data: {state: status, quietStatus: true, text, detail}};
  }

  async refreshHistory() {
    const host = this.host, s = host.liveSnapshot, transport = host.liveTransport, revision = s?.answerHistoryRevision;
    if (!s || !Number.isSafeInteger(revision) || s.capabilities?.answerRead !== true || !transport?.connected ||
      this.historyPending || (this.historyRevision === revision && this.historyScope === scopeOf(s))) return;
    const serial = ++this.historySerial, transportGeneration = transport.generation, boot = s.bootId,
      room = s.roomId, removalRevision = s.answerHistoryRemovalRevision;
    this.historyPending = true;
    this.historyReadStatus = 'loading';
    this.historyReadScope = JSON.stringify([boot, room]);
    host.render();
    const scoped = () => host.isConnected && host.liveTransport === transport &&
      transport.generation === transportGeneration && host.liveSnapshot?.bootId === boot &&
      host.liveSnapshot?.roomId === room;
    const current = () => scoped() && transport.connected && serial === this.historySerial &&
      host.liveSnapshot?.answerHistoryRevision === revision &&
      host.liveSnapshot?.answerHistoryRemovalRevision === removalRevision &&
      host.liveSnapshot?.capabilities?.answerRead === true;
    try {
      const value = await transport.answers(true);
      if (!current() || !host.liveSnapshot) return;
      const result = historicalAnswers(value, host.liveSnapshot), old = host.state.answers;
      this.history = new Map([...result.items].reverse().map(answer => [answer.id, answer]));
      this.historyReadStatus = 'ready';
      this.historyPending = false;
      this.historyRevision = result.revision;
      this.historyScope = JSON.stringify([boot, room]);
      const items = this.retained(old.filter(answer => !answer.live || !answer.historical));
      const removed = old.some(answer => answer.id === host.state.focus) &&
        !items.some(answer => answer.id === host.state.focus);
      host.state = {...host.state, answers: items, focus: removed ? 'now' : host.state.focus};
      host.render();
      if (removed) host.focusHeading();
    } catch (error) {
      if (readCode(error) === 'read_access_denied' && scoped()) {
        this.invalidate(true, true);
        this.historyReadStatus = 'error';
        this.historyReadScope = JSON.stringify([boot, room]);
        host.render();
      } else if (current()) {
        this.historyReadStatus = 'error';
        this.historyPending = false;
        host.render();
      }
      // Transient reads retain admitted history, never manufacture an empty response.
    } finally {
      if (serial === this.historySerial) this.historyPending = false;
    }
  }

  async refresh(retry = false) {
    this.pruneExpired();
    const host = this.host, s = host.liveSnapshot;
    if (Number.isSafeInteger(s?.answerHistoryRevision)) {
      const history = this.refreshHistory();
      if (!answerReadContext(s)) {
        await history;
        return;
      }
    }
    if (s?.capabilities?.answerRead !== true) {
      this.invalidate(true, false);
      return;
    }
    if (this.pending || Date.now() - this.lastRead < 5000) return;
    this.pending = true;
    this.lastRead = Date.now();
    const readKey = answerReadContext(s);
    if (retry) {
      this.setReadStatus('pending');
      host.render();
    }
    const transport = host.liveTransport;
    // As before, a read without a transport fails here (the shell always has one when it reads).
    if (!transport) throw TypeError('No answer transport');
    const transportGeneration = transport.generation, generation = this.generation, boot = s.bootId,
      room = s.roomId, session = s.voice?.sessionId, context = JSON.stringify(s.answers);
    const current = () => {
      const now = host.liveSnapshot;
      return generation === this.generation && host.isConnected && host.liveTransport === transport &&
        transport.generation === transportGeneration && transport.connected &&
        !!now && now.answerHistoryRevision === s.answerHistoryRevision &&
        now.answerHistoryRemovalRevision === s.answerHistoryRemovalRevision && now.bootId === boot &&
        now.roomId === room && JSON.stringify(now.answers) === context && now.voice?.sessionId === session &&
        now.capabilities?.answerRead === true;
    };
    try {
      const value = await transport.answers();
      const snapshot = host.liveSnapshot;
      if (!current() || !snapshot) return;
      const result = ownedAnswers(value, snapshot, this.revision);
      this.revision = result.revision;
      const old = host.state.answers;
      const receipts = snapshot.answerHistoryReceiptIds;
      const liveItems = result.items.filter(answer => !Array.isArray(receipts) ||
        receipts.includes(answer.receiptId ?? ''))
        .map(answer => ({...answer, readContext: readKey, readConnected: true,
          hidden: old.find(item => item.id === answer.id)?.hidden ?? false}));
      if (this.initialReceiptsUnknown) {
        for (const answer of liveItems) this.initialReceiptIds?.add(answer.receiptId ?? '');
        this.initialReceiptsUnknown = false;
      }
      this.remember(liveItems);
      const items = this.retained(liveItems);
      const removed = old.some(answer => answer.id === host.state.focus) &&
        !items.some(answer => answer.id === host.state.focus);
      host.state = {...host.state, answers: items, focus: removed ? 'now' : host.state.focus};
      const suggestion = !host.historyBrowse && items.find(answer => !answer.historical &&
        answer.displaySuggested && !answer.hidden && !this.presented.has(answer.id) &&
        !this.initialReceiptIds?.has(answer.receiptId ?? ''));
      const quiet = Date.now() - (host.lastInteractionAt ?? 0) > 1000 && !document.hidden &&
        document.visibilityState !== 'hidden' && !host.screenLifecycle?.pointers?.size &&
        host.dataset.edgeDrag !== 'true' && (host.suspendForAnswer?.() ?? !document.querySelector('dialog[open]'));
      if (suggestion && quiet) {
        this.presented.add(suggestion.id);
        const previousFocus = document.activeElement as HTMLElement | null;
        host.dispatch({type: 'present-answer', id: suggestion.id});
        if (previousFocus && host.contains(previousFocus) && !previousFocus.getClientRects().length)
          host.focusHeading();
      } else host.render();
      this.pruneExpired();
      if (this.dialog.open) {
        if (!this.currentAnswer(this.sourceId)) {
          this.dialog.close();
          this.clearSource();
        } else if (this.sourceContext !== readKey && this.sourceId) {
          void this.showSource(this.sourceId, this.opener);
        }
      }
    } catch (error) {
      const now = host.liveSnapshot;
      if (readCode(error) === 'read_access_denied' && host.isConnected && host.liveTransport === transport &&
        transport.generation === transportGeneration && now?.bootId === boot && now?.roomId === room) {
        this.invalidate(true, true);
        host.render();
        return;
      }
      if (current()) {
        this.setReadStatus('error');
        host.render();
        if (this.dialog.open) this.setNote('Grundlaget kunne ikke opdateres · tidligere indhold er bevaret.');
      }
    } finally {
      if (generation === this.generation) this.pending = false;
    }
  }

  async showSource(id: string, opener: HTMLElement | null | undefined) {
    const host = this.host;
    if (!host.liveTransport?.connected || !this.currentAnswer(id)) return;
    const serial = ++this.sourceSerial;
    this.opener = opener;
    const sourceContext = answerReadContext(host.liveSnapshot);
    if (this.sourceId !== id || this.sourceContext !== sourceContext) this.clearSource();
    this.sourceId = id;
    this.sourceContext = sourceContext;
    this.setNote('');
    this.setBusy(true);
    if (!this.dialog.open) this.dialog.showModal();
    const generation = this.generation, transport = host.liveTransport, transportGeneration = transport.generation,
      boot = host.liveSnapshot?.bootId, room = host.liveSnapshot?.roomId;
    try {
      const value = await transport.source(id);
      if (serial !== this.sourceSerial || generation !== this.generation || !host.isConnected ||
        !this.live() || !this.currentAnswer(id) || this.sourceId !== id || !this.dialog.open) return;
      const source = ownedSource(value, id, Date.now(), host.liveSnapshot);
      const kind = source.provenance.kind;
      const weather = kind === 'ha_weather';
      const at = weather ? source.provenance.retrievedAt ?? '' : source.observedAt * 1000;
      const stamp = (weather ? 'Vejrdata hentet ' : 'Modtaget ') +
        new Date(at).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'});
      const note = kind === 'ai_explanation' ? 'AI-forklaring til dette svar'
        : kind === 'owner_sources' ? 'Grundlag fra PodVoice'
          : 'Modtaget værktøjsresultat · uden eksternt kildelink';
      this.paint({source, stamp, note});
      if (this.sourceScroll !== undefined) {
        this.body.scrollTop = this.sourceScroll;
        this.sourceScroll = undefined;
      }
    } catch (error) {
      const now = host.liveSnapshot;
      if (readCode(error) === 'read_access_denied' && host.isConnected && host.liveTransport === transport &&
        transport.generation === transportGeneration && now?.bootId === boot && now?.roomId === room) {
        this.invalidate(true, true);
        host.render();
        return;
      }
      if (serial === this.sourceSerial && generation === this.generation && this.sourceId === id &&
        this.currentAnswer(id)) this.setNote('Grundlaget er udløbet eller kunne ikke hentes.');
    } finally {
      if (serial === this.sourceSerial) this.setBusy(false);
    }
  }
}
