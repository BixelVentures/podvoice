// Højttalere: the speaker picker in the shell's native dialog (#rooms). The live owner of the speaker list with the
// API of the pre-React speaker-output-view.js: open() reads PodConnect's current catalogue, sync() decides every
// row's state, the speaker the user taps is chosen once (a move, the next start's destination or the player's
// speaker), the remembered configured and actual labels, and live radio's outputs (renderRadioOutputs). React draws
// the rows inside #room-options (SpeakerRows) synchronously; each row keeps the old element contract (speakerRow,
// observedOutput, chooseSpeaker; radioEntry for radio). The dialog, its note and the refresh button stay native.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {
  mediaRoomBinding,
  playbackBinding,
  playbackObservationCurrent,
  roomObservationCurrent,
} from '../../../media-observation.js';
import type {PlaybackRoomBinding} from '../../../media-observation.js';
import {configuredSpeakerLabel, musicBusy, speakerCatalogue, speakerRowState} from '../../../speaker-catalogue.js';
import type {SpeakerCatalogueValue, SpeakerRow} from '../../../speaker-catalogue.js';
import {applyKitComponent, applyKitDialog, runKitButtonAction} from '../../../ui/kit.js';
import {Paint, props, text as faceText} from './paint';
import type {Faces} from './paint';

export {configuredSpeakerLabel, musicBusy, speakerCatalogue, speakerRowState} from '../../../speaker-catalogue.js';

function byId(doc: Document, id: string): HTMLElement {
  const node = doc.getElementById(id);
  if (!node) throw Error(`Speaker picker is missing #${id}`);
  return node;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024;

export interface RadioTarget {
  id: string;
  name: string;
  availability?: string;
  default?: boolean;
}

export type SpeakerButton = HTMLButtonElement & {
  speakerRow?: SpeakerRow;
  observedOutput?: boolean;
  chooseSpeaker?: () => Promise<void>;
  chooseAttached?: boolean;
  radioEntry?: RadioTarget;
  radioSelectable?: (row: RadioTarget) => boolean;
  radioChoose?: (row: RadioTarget) => void;
};

interface Context {
  bootId: unknown;
  roomId: unknown;
  accountId: string;
  displayKey: string;
  hardKey: string;
  key: string;
  grants: Record<string, boolean>;
  transport: SpeakerTransport;
}

interface SpeakerTransport {
  connected?: boolean;
  generation?: unknown;
  music: (kind: string, account: string) => Promise<unknown>;
}

interface Choice {
  speakerId: string;
  name: string;
  accountId: string;
  bootId?: unknown;
  roomId?: unknown;
  transport?: unknown;
}

interface Destination {
  speakerId: string;
  name: string;
  accountId: string;
  nativeRoomId: string;
  nativeHomepodId: string | null;
  key: string;
  transport: unknown;
}

interface Labelled {
  name: string;
  key: string;
  transport: unknown;
}

// The shell (widget-view.js) as the speaker picker reads it.
export interface SpeakerHost {
  ownerDocument: Document;
  isConnected: boolean;
  liveSnapshot?: {
    bootId?: unknown;
    roomId?: unknown;
    mediaRoomBindings?: unknown;
    capabilities?: {musicRead?: string[]; controlSetup?: string[]; musicSelection?: boolean};
  } | null;
  liveTransport?: SpeakerTransport | null;
  liveMedia?: {account?: unknown; playback?: {observationStatus?: string; state?: string;
    config_entry_id?: unknown} | null; render?: () => void} | null;
  liveRadio?: {getState: () => {outputOpen: boolean}; ownsPlayer?: () => boolean; openOutputs: () => void;
    syncOutputs: () => void; closeOutputs: () => void} | null;
  liveControls?: {
    musicContext: (current: boolean) => {key?: unknown} | null | undefined;
    musicFence?: {key?: unknown; outcome?: string; settlementStatus?: string} | null;
    musicIntentPending?: unknown;
    moveSpeaker: (row: SpeakerRow, current: () => boolean, choice: Choice) => unknown;
  } | null;
  liveSelection?: {controlHold?: () => unknown} | null;
  playerView?: {
    chooseSpeaker?: (row: SpeakerRow) => void;
    playerSpeaker?: () => {homepodId?: string} | null;
  } | null;
}

interface RowShape {
  key: string;
  speakerId?: string;
}

function SpeakerRows({paint, faces, rows}: {paint: Paint; faces: Faces; rows: readonly RowShape[]}) {
  return rows.map(row => (
    <button
      key={row.key}
      ref={paint.ref(row.key)}
      type="button"
      className="pv-row pv-btn pv-kit pv-kit-listrow"
      data-kit="listrow"
      data-speaker-id={row.speakerId}
      {...props(faces[row.key])}
    >
      <img src="assets/icons/speaker-output.svg" alt="" />
      <span>
        <strong>{faceText(faces[`${row.key}:name`], '')}</strong>
        <small ref={paint.ref(`${row.key}:detail`)} {...props(faces[`${row.key}:detail`])}>
          {faceText(faces[`${row.key}:detail`], '')}
        </small>
      </span>
      <span ref={paint.ref(`${row.key}:status`)} className="target-status" {...props(faces[`${row.key}:status`])}>
        {faceText(faces[`${row.key}:status`], '')}
      </span>
    </button>
  ));
}

export class SpeakerOutputView {
  host: SpeakerHost;
  doc: Document;
  rows: HTMLElement;
  note: HTMLElement;
  refresh: HTMLButtonElement;
  generation = 0;
  scope: Context | null = null;
  validUntil = 0;
  moveAvailable = false;
  readPending = false;
  pendingRosterWait: Promise<void> | null = null;
  radioSheet = false;
  radioRows = new Map<string, SpeakerButton>();
  nextDestination: Destination | null = null;
  pendingChoice: Choice | null = null;
  queuedMove: {row: SpeakerRow; at: number} | null = null;
  configuredDisplay: Labelled | null = null;
  actualDisplay: Labelled | null = null;
  labelGeneration = 0;
  labelExpiry: ReturnType<typeof setTimeout> | undefined;
  labelValue: SpeakerCatalogueValue | null = null;
  labelScope: Context | null = null;
  labelAttempt: string | null = null;
  labelRetryAt = 0;
  labelPending = false;
  selectionLookupEpoch = 0;
  selectionLookupPending = false;
  scopeRefreshScheduled = false;
  radioCloseAttached = false;
  expiry: ReturnType<typeof setTimeout> | undefined;
  onDialogClose: () => void;
  private readonly paint = new Paint();
  private readonly root: Root;
  private shapes: RowShape[] = [];
  private epoch = 0;

  constructor(host: SpeakerHost) {
    this.host = host;
    this.doc = host.ownerDocument;
    this.rows = byId(this.doc, 'room-options');
    const dialog = this.doc.getElementById('rooms') as HTMLDialogElement;
    this.note = dialog.querySelector('p') as HTMLElement;
    dialog.classList.add('pv-card');
    this.rows.replaceChildren();
    this.root = createRoot(this.rows);
    byId(this.doc, 'room-title').textContent = 'Højttalere';
    this.note.setAttribute('role', 'status');
    this.note.setAttribute('aria-live', 'polite');
    this.note.textContent = 'Åbn listen for at hente aktuelle højttalere.';
    this.refresh = this.doc.createElement('button');
    this.refresh.type = 'button';
    this.refresh.className = 'speaker-list-refresh pv-button pv-ghost';
    applyKitComponent(this.refresh, 'button');
    this.refresh.textContent = 'Opdater liste';
    this.refresh.addEventListener('click', () => {
      if (!this.refresh.disabled) void runKitButtonAction(this.refresh, () => this.open());
    });
    const form = dialog.querySelector('form') ?? dialog;
    this.onDialogClose = () => {
      this.selectionLookupEpoch++;
    };
    dialog.addEventListener('close', this.onDialogClose);
    let actions = form.querySelector('.pv-dialog-actions');
    if (!actions) {
      actions = this.doc.createElement('div');
      actions.className = 'pv-actions';
      form.append(actions);
    }
    applyKitDialog(dialog, {actions});
    actions.append(this.refresh);
    this.draw();
  }

  private dialog(): HTMLDialogElement {
    return this.doc.getElementById('rooms') as HTMLDialogElement;
  }

  private draw(): void {
    const faces = this.paint.view(), rows = this.shapes, paint = this.paint;
    flushSync(() => {
      this.root.render(<SpeakerRows paint={paint} faces={faces} rows={rows} />);
    });
    paint.settle();
  }

  // The drawn rows, in order (also live radio's rows).
  private buttons(): SpeakerButton[] {
    return [...this.rows.children] as SpeakerButton[];
  }

  private keyOf(button: Element): string | undefined {
    return this.shapes.find(shape => this.paint.element(shape.key) === button)?.key;
  }

  private setRows(shapes: RowShape[]): void {
    for (const shape of this.shapes)
      if (!shapes.some(next => next.key === shape.key))
        for (const part of ['', ':name', ':detail', ':status']) this.paint.drop(`${shape.key}${part}`);
    this.shapes = shapes;
  }

  context(): Context | null {
    const h = this.host, s = h.liveSnapshot, account = h.liveMedia?.account, t = h.liveTransport, c = s?.capabilities;
    if (!h.isConnected || !t?.connected || !c?.musicRead?.includes('targets') || !text(account) || !s) return null;
    const bindings = s.mediaRoomBindings;
    const bindingScope = Array.isArray(bindings)
      ? (bindings as ({accountId?: unknown} | null)[]).filter(row => !row?.accountId || row.accountId === account)
      : bindings;
    const grants = {playback: c.musicRead.includes('playback'), control: c.controlSetup?.includes('music') === true,
      selection: c.musicSelection === true};
    return {bootId: s.bootId, roomId: s.roomId, accountId: account,
      displayKey: JSON.stringify([s.bootId, s.roomId, account, mediaRoomBinding(s, account)]),
      hardKey: JSON.stringify([s.bootId, s.roomId, account, t.generation ?? null]),
      key: JSON.stringify([s.bootId, s.roomId, account, t.generation ?? null, bindingScope, grants]), grants,
      transport: t};
  }

  // Remembered configuration text is display custody only; catalogue freshness still owns observation and actions.
  configuredLabel(): string {
    const context = this.context(), label = this.configuredDisplay;
    if (!context || !mediaRoomBinding(this.host.liveSnapshot, context.accountId) || label?.key !== context.displayKey ||
      label.transport !== context.transport) {
      this.configuredDisplay = null;
      return '';
    }
    return label.name;
  }

  clearLabel(preserveDisplay = false): void {
    const context = this.context();
    if (!preserveDisplay) this.actualDisplay = null;
    if (!preserveDisplay || !context || this.configuredDisplay?.key !== context.displayKey ||
      this.configuredDisplay.transport !== context.transport) this.configuredDisplay = null;
    this.labelGeneration++;
    clearTimeout(this.labelExpiry);
    this.labelValue = null;
    this.labelScope = null;
    this.labelAttempt = null;
    this.labelPending = false;
  }

  async refreshConfiguredLabel(): Promise<void> {
    const context = this.context();
    if (!context) {
      this.clearLabel();
      return;
    }
    if (this.labelScope && (this.labelScope.key !== context.key || this.labelScope.transport !== context.transport))
      this.clearLabel(true);
    if (this.labelPending || (this.labelAttempt === context.key && Date.now() < this.labelRetryAt)) return;
    this.labelScope = context;
    this.labelAttempt = context.key;
    this.labelRetryAt = Date.now() + 30000;
    this.labelPending = true;
    const generation = this.labelGeneration;
    const current = () => {
      const next = this.context();
      return generation === this.labelGeneration && next?.key === context.key && next.transport === context.transport;
    };
    try {
      const value = await context.transport.music('speakers', context.accountId);
      if (!current()) return;
      if (!speakerCatalogue(value, context)) {
        this.configuredDisplay = null;
        throw Error('invalid_catalogue');
      }
      const catalogue = value as SpeakerCatalogueValue;
      const name = configuredSpeakerLabel(catalogue, this.host.liveSnapshot, context.accountId);
      this.configuredDisplay = name
        ? Object.freeze({name, key: context.displayKey, transport: context.transport}) : null;
      this.labelValue = catalogue;
      clearTimeout(this.labelExpiry);
      this.labelExpiry = setTimeout(() => {
        if (current() && this.labelValue === catalogue) {
          this.labelValue = null;
          this.host.liveMedia?.render?.();
        }
      }, Math.max(0, catalogue.retrievedAt * 1000 + 30000 - Date.now()));
    } catch (error) {
      if (current()) {
        this.labelValue = null;
        if ((error as {code?: unknown} | null)?.code === 'read_access_denied') {
          this.configuredDisplay = null;
          this.actualDisplay = null;
        }
      }
    } finally {
      if (generation === this.labelGeneration) {
        this.labelPending = false;
        if (this.host.isConnected) this.host.liveMedia?.render?.();
      }
    }
  }

  private refreshOff(): boolean {
    const radio = this.host.liveRadio;
    return !(this.context() ?? (radio?.getState().outputOpen === true || radio?.ownsPlayer?.() === true));
  }

  invalidate(message = 'Højttalerlisten skal hentes igen.', preserveDestination = false): void {
    const context = this.context();
    if (!preserveDestination || (this.nextDestination && (this.nextDestination.key !== context?.key ||
      this.nextDestination.transport !== context.transport))) this.nextDestination = null;
    this.clearLabel(preserveDestination);
    this.generation++;
    this.readPending = false;
    this.refresh.disabled = this.refreshOff();
    clearTimeout(this.expiry);
    this.setRows([]);
    this.draw();
    this.rows.setAttribute('aria-busy', 'false');
    this.note.hidden = false;
    this.note.textContent = message;
    this.scope = null;
    this.validUntil = 0;
    this.moveAvailable = false;
  }

  // A catalogue formats an already admitted actual binding; it never proves output.
  actualLabel(binding: PlaybackRoomBinding | null | undefined): string {
    const context = this.context();
    const key = context && binding?.accountId === context.accountId
      ? JSON.stringify([context.key, binding.accountId, binding.nativeRoomId, binding.nativeHomepodId]) : null;
    if (!key || (this.actualDisplay && (this.actualDisplay.key !== key ||
      this.actualDisplay.transport !== context?.transport))) this.actualDisplay = null;
    if (!key || !context || !binding) return '';
    const value = this.labelScope?.key === context.key && this.labelScope.transport === context.transport
      ? this.labelValue : null;
    const rows = value && speakerCatalogue(value, context);
    if (rows) {
      const matches = rows.filter(row => row.accountId === binding.accountId &&
        row.nativeRoomId === binding.nativeRoomId &&
        row.homepodId === binding.nativeHomepodId);
      this.actualDisplay = matches.length === 1 && matches[0]
        ? Object.freeze({key, transport: context.transport, name: matches[0].name}) : null;
    } else if (value && !speakerCatalogue(value, context, value.retrievedAt * 1000)) this.actualDisplay = null;
    return this.actualDisplay?.name || '';
  }

  observedDestination(speakerId: string): boolean {
    const context = this.context(), playback = this.host.liveMedia?.playback;
    const binding = context && roomObservationCurrent(playback, this.host.liveSnapshot) &&
      playbackBinding(playback, this.host.liveSnapshot, context.accountId);
    const rows = context && this.labelScope?.key === context.key && this.labelScope.transport === context.transport &&
      speakerCatalogue(this.labelValue, context);
    return !!(binding && rows && rows.some(row => row.speakerId === speakerId && row.accountId === binding.accountId &&
      row.nativeRoomId === binding.nativeRoomId && row.homepodId === binding.nativeHomepodId));
  }

  // Captured identity is comparison evidence, not a fresh roster or an action grant.
  selectionWitness() {
    const selected = this.nextDestination;
    if (!selected || !this.selectionDestination()) return null;
    return Object.freeze({accountId: selected.accountId, nativeRoomId: selected.nativeRoomId,
      nativeHomepodId: selected.nativeHomepodId});
  }

  // Presentation uses the exact same fence as the remembered setup destination.
  nextDestinationLabel(): string {
    try {
      return this.selectionDestination()?.name || '';
    } catch {
      return '';
    }
  }

  pendingChoiceLabel(): string {
    const choice = this.pendingChoice, context = this.context();
    if (!choice || !context || choice.transport !== context.transport || choice.accountId !== context.accountId ||
      choice.bootId !== context.bootId || choice.roomId !== context.roomId) {
      this.pendingChoice = null;
      return '';
    }
    if (this.observedDestination(choice.speakerId)) {
      this.pendingChoice = null;
      return '';
    }
    return choice.name;
  }

  // The player's speaker (status = speaker: the last speaker chosen for radio or music, or where music plays) is
  // where Find musik starts (owner 17/11: radio on Frida, stopped, Musik took Køkkenalrum). True while the remembered
  // music destination does not name it yet; a start then resolves it first (playerDestination).
  playerDestinationMismatch(): boolean {
    const speaker = this.host.playerView?.playerSpeaker?.(), selected = this.nextDestination, context = this.context();
    if (!speaker?.homepodId || !context) return false;
    if (selected?.key === context.key && selected.transport === context.transport)
      return selected.nativeHomepodId !== speaker.homepodId;
    return mediaRoomBinding(this.host.liveSnapshot, context.accountId)?.nativeHomepodId !== speaker.homepodId;
  }

  // Resolve the player's speaker against a current catalogue into the music destination. Last tap wins: a speaker
  // chosen for radio replaces an older music-only choice. Nothing found: the remembered destination stays as it is.
  async playerDestination(): Promise<void> {
    if (!this.playerDestinationMismatch()) return;
    const speaker = this.host.playerView?.playerSpeaker?.(), context = this.context();
    if (!speaker || !context) return;
    const fresh = this.labelScope?.key === context.key && this.labelScope.transport === context.transport;
    let rows = fresh ? speakerCatalogue(this.labelValue, context) : null;
    if (!rows) {
      let value: unknown;
      try {
        value = await context.transport.music('speakers', context.accountId);
      } catch {
        return;
      }
      const now = this.context();
      if (now?.key !== context.key || now.transport !== context.transport) return;
      rows = speakerCatalogue(value, context);
    }
    const matches = (rows ?? []).filter(row => row.startSelectable === true && row.availability === 'available' &&
      row.homepodId === speaker.homepodId);
    const row = matches[0];
    if (matches.length !== 1 || !row || this.host.liveSnapshot?.capabilities?.musicSelection !== true) return;
    this.nextDestination = Object.freeze({speakerId: row.speakerId, name: row.name, accountId: row.accountId,
      nativeRoomId: row.nativeRoomId, nativeHomepodId: row.homepodId, key: context.key, transport: context.transport});
  }

  selectionDestination(): {speakerId: string; name: string} | null {
    const selected = this.nextDestination;
    if (!selected) return null;
    const context = this.context();
    if (selected.key !== context?.key || selected.transport !== context.transport ||
      this.host.liveSnapshot?.capabilities?.musicSelection !== true) throw Error('destination_selection_expired');
    return {speakerId: selected.speakerId, name: selected.name};
  }

  sync(): void {
    if (this.host.liveRadio?.getState().outputOpen) {
      this.host.liveRadio.syncOutputs();
      return;
    }
    if (!this.readPending) {
      const off = this.refreshOff();
      if (this.refresh.disabled !== off) this.refresh.disabled = off;
    }
    const context = this.context();
    if (this.labelScope && (context?.key !== this.labelScope.key || context.transport !== this.labelScope.transport))
      this.clearLabel(true);
    if (this.scope && (context?.key !== this.scope.key || context.transport !== this.scope.transport)) {
      const old = this.scope;
      const same = !!context && old.hardKey === context.hardKey && old.transport === context.transport;
      const revoked = same && Object.keys(old.grants).some(key => old.grants[key] && !context.grants[key]);
      if (!same || revoked) {
        this.invalidate(undefined, true);
        if (context && this.dialog().open)
          queueMicrotask(() => {
            if (this.dialog().open && this.context() && !this.readPending) void this.open();
          });
      } else {
        this.generation++;
        this.readPending = false;
        this.refresh.disabled = this.refreshOff();
        clearTimeout(this.expiry);
        this.scope = context;
        this.validUntil = 0;
        if (this.dialog().open && !this.scopeRefreshScheduled) {
          this.scopeRefreshScheduled = true;
          queueMicrotask(() => {
            this.scopeRefreshScheduled = false;
            if (this.dialog().open && this.scope && this.context()?.key === this.scope.key && !this.readPending)
              void this.open();
          });
        }
      }
    }
    this.runQueuedMove();
    const controls = this.host.liveControls, music = controls?.musicContext(true);
    const fence = controls?.musicFence;
    // An unknown outcome never greys a speaker: the next choice goes through.
    const fenced = music && fence?.key === music.key && fence?.outcome === 'accepted' &&
      !['confirmed', 'rejected', 'superseded'].includes(fence.settlementStatus ?? '') ? 'accepted' : null;
    const busy = musicBusy(controls);
    const playback = this.host.liveMedia?.playback, snapshot = this.host.liveSnapshot;
    const binding = context && roomObservationCurrent(playback, snapshot) && playbackBinding(playback, snapshot,
      context.accountId);
    const catalogueInScope = !!context && this.scope?.key === context.key && this.scope.transport === context.transport;
    const catalogueCurrent = catalogueInScope && this.validUntil > Date.now();
    const currentOutputLabels = catalogueInScope && (catalogueCurrent || this.readPending);
    const configured = context && mediaRoomBinding(this.host.liveSnapshot, context.accountId);
    const confirmedIdle = playback?.observationStatus === 'idle' && playback.state === 'no_active_playback' &&
      playback.config_entry_id === context?.accountId && playbackObservationCurrent(playback, this.host.liveSnapshot);
    const buttons = this.buttons();
    const defaultDestination = catalogueCurrent && !music && (!playback || confirmedIdle) && !this.actualDisplay &&
      !this.nextDestination && !buttons.some(b => b.observedOutput === true);
    const selection = this.host.liveSnapshot?.capabilities?.musicSelection;
    for (const b of buttons) {
      const key = this.keyOf(b);
      if (!key) continue;
      const row = b.speakerRow;
      const actualOutput = !!(currentOutputLabels && binding && row?.accountId === binding.accountId &&
        row.nativeRoomId === binding.nativeRoomId && row.homepodId === binding.nativeHomepodId);
      if (currentOutputLabels && binding) b.observedOutput = actualOutput;
      const knownOutput = actualOutput || b.observedOutput === true;
      const rowState = speakerRowState(row, {busy, music: !!music, selection, moveAvailable: this.moveAvailable,
        fenced, actualOutput});
      const canStart = !music && selection === true && row?.startSelectable === true;
      const disabled = rowState.disabled;
      if (!disabled && b.chooseSpeaker && !b.chooseAttached) {
        b.chooseAttached = true;
        b.addEventListener('click', b.chooseSpeaker as EventListener);
      }
      this.paint.set(key, 'disabled', disabled);
      const defaultSelected = !!(defaultDestination && configured && canStart &&
        row.accountId === configured.accountId &&
        row.nativeRoomId === configured.nativeRoomId && row.homepodId === configured.nativeHomepodId);
      const nextSelected = this.nextDestination?.speakerId === row?.speakerId || defaultSelected;
      const pressed = this.nextDestination ? nextSelected : knownOutput || defaultSelected;
      this.paint.set(key, 'aria-pressed', String(pressed));
      this.paint.set(key, 'aria-label', [row?.name, nextSelected ? 'Valgt' : '',
        actualOutput ? 'Aktuelt output' : knownOutput ? 'Seneste output' : ''].filter(Boolean).join(' · '));
      const outputLabel = actualOutput ? 'Aktuelt output' : 'Seneste output';
      this.paint.set(`${key}:status`, 'text', nextSelected ? 'Valgt' : knownOutput ? outputLabel
        : row?.default ? 'Standardrum' : '');
      this.paint.set(`${key}:detail`, 'text', rowState.label);
    }
    this.draw();
    if (this.scope && buttons.length && this.validUntil > Date.now()) {
      const startAvailable = !music && selection === true && buttons.some(b => b.speakerRow?.startSelectable === true);
      const message = busy ? 'Musikhandlingen behandles.' : startAvailable ? '' : !this.moveAvailable
        ? 'Aktuelle højttalere fra PodConnect · rumskift er endnu ikke tilgængeligt.' : !music
          ? 'Afspilningen i rummet skal bekræftes, før du kan flytte musikken.' : fenced === 'accepted'
            ? 'Afventer bekræftelse af afspilningen.' : 'Vælg en højttaler til den aktuelle afspilning.';
      if (this.note.hidden !== !message) this.note.hidden = !message;
      if (this.note.textContent !== message) this.note.textContent = message;
    }
  }

  // A speaker tapped while a music start was on its way is one explicit move, made once when the started music is
  // observed (a tap during a command is queued, never dropped; owner 17/11: »det tog to tryk«). Within 30 s only.
  runQueuedMove(): void {
    const queued = this.queuedMove, controls = this.host.liveControls;
    if (!queued) return;
    if (Date.now() - queued.at > 30000) {
      this.queuedMove = null;
      return;
    }
    if (!controls?.musicContext(true) || musicBusy(controls) || controls.musicIntentPending) return;
    this.queuedMove = null;
    if (this.observedDestination(queued.row.speakerId)) return;
    const choice = (this.pendingChoice = Object.freeze({speakerId: queued.row.speakerId, name: queued.row.name,
      accountId: queued.row.accountId, bootId: this.scope?.bootId, roomId: this.scope?.roomId,
      transport: this.scope?.transport}));
    void Promise.resolve(controls.moveSpeaker(queued.row, () => this.validUntil > Date.now() && this.moveAvailable,
      choice)).then(sent => {
      if (!sent && this.pendingChoice === choice) {
        this.pendingChoice = null;
        this.host.liveMedia?.render?.();
      }
    });
  }

  armExpiry(until: number, generation: number, context: Context): void {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => {
      if (generation === this.generation && this.scope === context) {
        this.validUntil = 0;
        this.sync();
      }
    }, Math.max(0, until - Date.now()));
  }

  // The click on one speaker row: one explicit choice, made once.
  private chooser(b: SpeakerButton): () => Promise<void> {
    return async () => {
      this.sync();
      const row = b.speakerRow, scope = this.scope;
      if (!row || !scope || b.disabled || this.selectionLookupPending) return;
      if (this.validUntil <= Date.now()) {
        const expected = {speakerId: row.speakerId, accountId: row.accountId, nativeRoomId: row.nativeRoomId,
          homepodId: row.homepodId};
        const prior = this.context(), dialog = this.dialog(), epoch = this.selectionLookupEpoch;
        if (!dialog.open) return;
        if (prior?.key !== scope.key || prior.transport !== scope.transport) return;
        this.selectionLookupPending = true;
        try {
          await this.open();
        } finally {
          this.selectionLookupPending = false;
        }
        const after = this.context();
        if (after?.key !== prior.key || after.transport !== prior.transport || this.validUntil <= Date.now() ||
          !this.dialog().open || this.selectionLookupEpoch !== epoch) return;
        const matches = this.buttons().filter(node => {
          const r = node.speakerRow;
          return r?.speakerId === expected.speakerId && r.accountId === expected.accountId &&
            r.nativeRoomId === expected.nativeRoomId && r.homepodId === expected.homepodId;
        });
        if (matches.length === 1 && matches[0] && !matches[0].disabled) matches[0].click();
        return;
      }
      const catalogueCurrent = () => {
        const now = this.context();
        return this.scope?.key === scope.key && this.scope.transport === scope.transport && now?.key === scope.key &&
          now.transport === scope.transport && this.validUntil > Date.now() &&
          this.buttons().some(node => node === b && node.speakerRow === row);
      };
      if (!catalogueCurrent()) return;
      const controls = this.host.liveControls;
      if (controls?.musicContext(true) && (b.observedOutput === true || this.observedDestination(row.speakerId))) {
        this.host.playerView?.chooseSpeaker?.(row);
        this.dialog().close();
        this.host.liveMedia?.render?.();
        return;
      }
      if (controls?.musicContext(true)) {
        this.host.playerView?.chooseSpeaker?.(row);
        const choice = (this.pendingChoice = Object.freeze({speakerId: row.speakerId, name: row.name,
          accountId: row.accountId, bootId: scope.bootId, roomId: scope.roomId, transport: scope.transport}));
        this.dialog().close();
        this.host.liveMedia?.render?.();
        void Promise.resolve(controls.moveSpeaker(row, () => catalogueCurrent() && this.moveAvailable, choice))
          .then(sent => {
            if (!sent || ['unknown', 'rejected', 'unavailable'].includes(this.host.liveControls?.musicFence?.outcome ??
              '')) {
              if (this.pendingChoice === choice) this.pendingChoice = null;
              this.host.liveMedia?.render?.();
            }
          });
        return;
      }
      if (row.startSelectable !== true || this.host.liveSnapshot?.capabilities?.musicSelection !== true) return;
      this.host.playerView?.chooseSpeaker?.(row);
      this.nextDestination = Object.freeze({speakerId: row.speakerId, name: row.name, accountId: row.accountId,
        nativeRoomId: row.nativeRoomId, nativeHomepodId: row.homepodId, key: scope.key, transport: scope.transport});
      this.queuedMove = this.host.liveSelection?.controlHold?.() ? Object.freeze({row, at: Date.now()}) : null;
      this.sync();
      this.host.liveMedia?.render?.();
      this.dialog().close();
    };
  }

  async open(): Promise<void> {
    if (this.host.liveRadio?.getState().outputOpen || this.host.liveRadio?.ownsPlayer?.()) {
      this.host.liveRadio.openOutputs();
      return;
    }
    const wasRadioSheet = this.radioSheet;
    this.radioSheet = false;
    const context = this.context();
    if (this.readPending && this.scope?.key === context?.key && this.scope?.transport === context?.transport)
      return this.pendingRosterWait ?? undefined;
    const retained = !wasRadioSheet && !!context && this.scope?.key === context.key &&
      this.scope.transport === context.transport;
    if (retained) {
      this.generation++;
      clearTimeout(this.expiry);
    } else this.invalidate('Højttalerlisten skal hentes igen.', true);
    if (!context) {
      this.note.textContent = 'Højttalerlisten er ikke tilgængelig.';
      return;
    }
    this.scope = context;
    const generation = this.generation;
    this.rows.setAttribute('aria-busy', String(!(retained && this.validUntil > Date.now())));
    if (!retained) {
      this.note.textContent = '';
      this.note.hidden = true;
    }
    if (retained && this.validUntil > Date.now()) this.armExpiry(this.validUntil, generation, context);
    this.readPending = true;
    let resolveRoster: () => void = () => undefined;
    const rosterWait = new Promise<void>(resolve => {
      resolveRoster = resolve;
    });
    this.pendingRosterWait = rosterWait;
    this.refresh.disabled = true;
    this.sync();
    if (retained && this.validUntil <= Date.now()) {
      this.note.hidden = false;
      this.note.textContent = 'Henter aktuelle højttalere…';
    }
    const current = () => {
      const next = this.context();
      return generation === this.generation && next?.key === context.key && next.transport === context.transport;
    };
    try {
      const value = await context.transport.music('speakers', context.accountId);
      if (!current()) {
        if (generation === this.generation) this.invalidate();
        return;
      }
      const rows = speakerCatalogue(value, context);
      if (!rows) {
        this.configuredDisplay = null;
        throw Error('invalid_catalogue');
      }
      const catalogue = value as SpeakerCatalogueValue, next = this.nextDestination;
      if (next && !rows.some(row => row.speakerId === next.speakerId && row.accountId === next.accountId &&
        row.nativeRoomId === next.nativeRoomId && row.homepodId === next.nativeHomepodId)) this.nextDestination = null;
      const buttons = this.buttons();
      const reuse = buttons.length === rows.length && rows.every((row, index) => {
        const old = buttons[index]?.speakerRow;
        return old?.speakerId === row.speakerId && old.accountId === row.accountId &&
          old.nativeRoomId === row.nativeRoomId && old.homepodId === row.homepodId &&
          !!((this.moveAvailable && old.selectable) || old.startSelectable) ===
          !!((catalogue.moveAvailable && row.selectable) || row.startSelectable);
      });
      if (reuse) {
        for (const [index, row] of rows.entries()) {
          const button = buttons[index], key = button && this.keyOf(button);
          if (!button || !key) continue;
          button.speakerRow = row;
          this.paint.set(`${key}:name`, 'text', row.name);
        }
        this.draw();
      } else {
        const epoch = String(++this.epoch), shapes = rows.map(row => ({key: `s:${epoch}:${row.speakerId}`,
          speakerId: row.speakerId}));
        for (const [index, row] of rows.entries()) {
          const key = shapes[index]?.key ?? '';
          this.paint.set(`${key}:name`, 'text', row.name);
          this.paint.set(`${key}:detail`, 'text', row.availability === 'available' ? 'Fundet i PodConnect'
            : row.availability === 'unknown' ? 'Status ukendt' : 'Ikke tilgængelig');
          this.paint.set(`${key}:status`, 'text', row.default ? 'Standardrum' : '');
          this.paint.set(key, 'disabled', true);
        }
        this.setRows(shapes);
        this.draw();
        for (const [index, row] of rows.entries()) {
          const b = this.paint.element(shapes[index]?.key ?? '') as SpeakerButton | undefined;
          if (!b) continue;
          b.speakerRow = row;
          b.chooseSpeaker = this.chooser(b);
        }
      }
      this.note.hidden = false;
      this.moveAvailable = catalogue.moveAvailable;
      this.note.textContent = this.moveAvailable ? 'Vælg en højttaler til den aktuelle afspilning.'
        : 'Aktuelle højttalere fra PodConnect · rumskift er endnu ikke tilgængeligt.';
      this.validUntil = catalogue.retrievedAt * 1000 + 30000;
      this.sync();
      this.armExpiry(this.validUntil, generation, context);
    } catch (error) {
      if (current()) {
        const code = (error as {code?: unknown} | null)?.code;
        if (code === 'read_access_denied') {
          this.configuredDisplay = null;
          this.actualDisplay = null;
        }
        if (retained && code !== 'read_access_denied') {
          this.validUntil = 0;
          this.sync();
          this.note.hidden = false;
          this.note.textContent = 'Højttalerlisten kunne ikke opdateres · prøv Opdater liste.';
        } else this.invalidate('Højttalerlisten kunne ikke hentes.', true);
      }
    } finally {
      if (generation === this.generation) {
        this.readPending = false;
        this.refresh.disabled = this.refreshOff();
        this.rows.setAttribute('aria-busy', 'false');
        this.sync();
      }
      resolveRoster();
      if (this.pendingRosterWait === rosterWait) this.pendingRosterWait = null;
    }
  }

  bindRadioClose(): void {
    if (this.radioCloseAttached) return;
    this.radioCloseAttached = true;
    for (const event of ['cancel', 'close'])
      this.dialog().addEventListener(event, () => {
        this.host.liveRadio?.closeOutputs();
      });
  }

  renderRadioOutputs({targets = [], actualTargetId = null, lastTargetId = null, nextTargetId = null, message = '',
    selectable = () => false, onChoose = () => undefined}: {
    targets?: RadioTarget[];
    actualTargetId?: string | null;
    lastTargetId?: string | null;
    nextTargetId?: string | null;
    message?: string;
    selectable?: (row: RadioTarget) => boolean;
    onChoose?: (row: RadioTarget) => void;
  } = {}): void {
    if (!this.radioSheet) {
      this.radioSheet = true;
      this.radioRows = new Map();
      this.setRows([]);
    }
    this.note.hidden = false;
    this.note.textContent = message;
    const wanted = new Set(targets.map(row => row.id));
    let refocus = false;
    for (const [id, button] of this.radioRows) {
      if (wanted.has(id)) continue;
      if (this.doc.activeElement === button) refocus = true;
      this.radioRows.delete(id);
    }
    const shapes = targets.map(row => ({key: `r:${row.id}`}));
    for (const row of targets) {
      const key = `r:${row.id}`, actual = actualTargetId === row.id;
      this.paint.set(`${key}:name`, 'text', row.name);
      this.paint.set(`${key}:detail`, 'text', row.availability === 'available' ? 'Tilgængelig' : 'Ikke tilgængelig');
      this.paint.set(`${key}:status`, 'text', actual ? 'Aktuelt output' : nextTargetId === row.id ? 'Næste afspilning'
        : lastTargetId === row.id ? 'Seneste output' : row.default ? 'Standardrum' : '');
      this.paint.set(key, 'aria-pressed', String(actual));
      this.paint.set(key, 'disabled', !selectable(row));
    }
    this.setRows(shapes);
    this.draw();
    if (refocus) this.refresh.focus();
    for (const row of targets) {
      const button = this.paint.element(`r:${row.id}`) as SpeakerButton | undefined;
      if (!button) continue;
      if (!this.radioRows.has(row.id)) {
        this.radioRows.set(row.id, button);
        button.addEventListener('click', () => {
          const entry = button.radioEntry;
          if (button.disabled || !entry || !button.radioSelectable?.(entry)) return;
          button.radioChoose?.(entry);
        });
      }
      button.radioEntry = row;
      button.radioSelectable = selectable;
      button.radioChoose = onChoose;
    }
  }

  // Live radio closed its picker: its rows are disarmed (a captured row can no longer choose) and the sheet is gone.
  closeRadioSheet(): void {
    for (const button of this.radioRows.values()) {
      button.disabled = true;
      button.radioSelectable = () => false;
      button.radioChoose = () => undefined;
    }
    this.radioRows.clear();
    if (this.radioSheet) {
      this.radioSheet = false;
      this.setRows([]);
    }
    this.draw();
  }

  cleanup(): void {
    this.dialog().removeEventListener('close', this.onDialogClose);
    this.selectionLookupEpoch++;
    this.invalidate();
  }
}
