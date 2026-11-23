// Højttalere: the speaker picker's owner (ported from SpeakerOutputView). It reads PodConnect's current catalogue
// (lib/api/speakers.ts; kept in the query cache), decides every row's state and makes the speaker the user taps
// once: a move of the playing music, the next start's destination, or the player's speaker. Rules (music memory):
// - Status = the speaker: a chosen speaker shows at once as the player's speaker; last tap wins.
// - Errors never lock or stick: an unknown outcome never greys a speaker; the next choice goes through.
// - A tap during a music start is queued and made once, when the started music is observed (within 30 s).
// - Right after a restart the player shows the room's last report: the picker stays usable and a choice waits for
//   the room's own read (warm-up), then it is an ordinary choice against what the room said, made once.
// - Nothing is sent on a guess: a move needs a current catalogue and PodConnect's session in the room's read.
// The command lifecycle (next destination, pending choice, queued move) and the sheet's view are one Zustand store;
// SpeakerSheet.tsx draws the view. The shell owns the dialog element (#rooms): it opens and closes it.
import {createStore} from 'zustand/vanilla';
import {mediaRoomBinding, playbackBinding, playbackObservationCurrent, roomObservationCurrent}
  from '../../lib/api/media';
import type {MediaSnapshot, Playback, PlaybackRoomBinding} from '../../lib/api/media';
import {CATALOGUE_VALID_MS, catalogueValue, configuredSpeakerLabel, musicBusy, speakerCatalogue, speakerRowState}
  from '../../lib/api/speakers';
import type {SpeakerCatalogueValue, SpeakerRow} from '../../lib/api/speakers';
import {queryClient} from '../../lib/query/client';
import {bindSpeakers} from './store';

export const speakersKey = (scope: string) => ['podvoice', 'speakers', scope] as const;

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024;

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

export interface Choice {
  speakerId: string;
  name: string;
  accountId: string;
  bootId?: unknown;
  roomId?: unknown;
  transport?: unknown;
}

export interface Destination {
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

export interface QueuedMove {
  row: SpeakerRow;
  at: number;
  warmup?: boolean;
}

// One drawn speaker row.
export interface SpeakerRowView {
  key: string;
  row: SpeakerRow;
  disabled: boolean;
  pressed: boolean;
  label: string;
  detail: string;
  status: string;
}

export interface SpeakersState {
  // The command lifecycle.
  nextDestination: Destination | null;
  pendingChoice: Choice | null;
  queuedMove: QueuedMove | null;
  // The sheet as drawn.
  rows: readonly SpeakerRowView[];
  note: {hidden: boolean; text: string};
  busy: boolean;
  refreshDisabled: boolean;
}

// The shell and its live owners as the picker reads them.
export interface SpeakerHost {
  ownerDocument: Document;
  isConnected: boolean;
  liveSnapshot?: (MediaSnapshot & {capabilities?: {musicRead?: string[]; controlSetup?: string[];
    musicSelection?: boolean}}) | null;
  liveTransport?: SpeakerTransport | null;
  liveMedia?: {account?: unknown; playback?: Playback | null; render?: () => void;
    lastKnownPlayback?: () => {state?: string} | null} | null;
  liveRadio?: {getState: () => {outputOpen: boolean}; ownsPlayer: () => boolean; openOutputs: () => void;
    closeOutputs: () => void} | null;
  liveControls?: {
    musicContext: (current: boolean) => {key?: unknown} | null | undefined;
    musicFence?: {key?: unknown; outcome?: string; settlementStatus?: string} | null;
    musicIntentPending?: unknown;
    pending?: unknown;
    activeOperation?: {domain?: unknown} | null;
    moveSpeaker: (row: SpeakerRow, current: () => boolean, choice: Choice) => unknown;
  } | null;
  liveSelection?: {controlHold?: () => unknown} | null;
  playerView?: {
    chooseSpeaker?: (row: SpeakerRow) => void;
    playerSpeaker?: () => {homepodId?: string} | null;
  } | null;
}

const LIST_NOTE = 'Åbn listen for at hente aktuelle højttalere.';

export class SpeakerPicker {
  host: SpeakerHost;
  store = createStore<SpeakersState>(() => ({nextDestination: null, pendingChoice: null, queuedMove: null, rows: [],
    note: {hidden: false, text: LIST_NOTE}, busy: false, refreshDisabled: false}));
  generation = 0;
  scope: Context | null = null;
  validUntil = 0;
  moveAvailable = false;
  readPending = false;
  pendingRosterWait: Promise<void> | null = null;
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
  expiry: ReturnType<typeof setTimeout> | undefined;
  // The catalogue rows the sheet shows, and which of them the room was last seen playing on.
  catalogue: SpeakerRow[] = [];
  observedOutput = new Map<string, boolean>();
  private epoch = 0;

  constructor(host: SpeakerHost) {
    this.host = host;
    bindSpeakers(this);
  }

  get nextDestination(): Destination | null {
    return this.store.getState().nextDestination;
  }

  set nextDestination(value: Destination | null) {
    this.store.setState({nextDestination: value});
  }

  get pendingChoice(): Choice | null {
    return this.store.getState().pendingChoice;
  }

  set pendingChoice(value: Choice | null) {
    this.store.setState({pendingChoice: value});
  }

  get queuedMove(): QueuedMove | null {
    return this.store.getState().queuedMove;
  }

  set queuedMove(value: QueuedMove | null) {
    this.store.setState({queuedMove: value});
  }

  private dialog(): HTMLDialogElement | null {
    return this.host.ownerDocument.getElementById('rooms') as HTMLDialogElement | null;
  }

  private dialogOpen(): boolean {
    return this.dialog()?.open === true;
  }

  private closeDialog() {
    const dialog = this.dialog();
    if (dialog?.open) dialog.close();
  }

  private setNote(textValue: string, hidden = !textValue) {
    const note = this.store.getState().note;
    if (note.text !== textValue || note.hidden !== hidden) this.store.setState({note: {text: textValue, hidden}});
  }

  private setRefreshDisabled(disabled: boolean) {
    if (this.store.getState().refreshDisabled !== disabled) this.store.setState({refreshDisabled: disabled});
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

  // One catalogue read for this room and account; the answer is kept in the query cache.
  private async readCatalogue(context: Context): Promise<unknown> {
    const value = await context.transport.music('speakers', context.accountId);
    queryClient.setQueryData(speakersKey(context.displayKey), value);
    return value;
  }

  // The player shows the room's last report (kept across an add-on restart) until this screen's own read of the
  // room lands. Music may still play there, so the picker stays usable and a choice waits for that read.
  warmingUp(): boolean {
    const last = this.host.liveMedia?.lastKnownPlayback?.();
    return !!last && ['playing', 'paused'].includes(last.state ?? '');
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

  clearLabel(preserveDisplay = false) {
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
      const value = await this.readCatalogue(context);
      if (!current()) return;
      const catalogue = speakerCatalogue(value, context) && catalogueValue(value);
      if (!catalogue) {
        this.configuredDisplay = null;
        throw Error('invalid_catalogue');
      }
      const name = configuredSpeakerLabel(catalogue, this.host.liveSnapshot, context.accountId);
      this.configuredDisplay = name ? Object.freeze({name, key: context.displayKey, transport: context.transport})
        : null;
      this.labelValue = catalogue;
      clearTimeout(this.labelExpiry);
      this.labelExpiry = setTimeout(() => {
        if (current() && this.labelValue === catalogue) {
          this.labelValue = null;
          this.host.liveMedia?.render?.();
        }
      }, Math.max(0, catalogue.retrievedAt * 1000 + CATALOGUE_VALID_MS - Date.now()));
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
    return !(this.context() ?? (radio?.getState().outputOpen === true || radio?.ownsPlayer() === true));
  }

  private setRows(rows: SpeakerRow[]) {
    this.catalogue = rows;
    if (!rows.length) this.observedOutput.clear();
  }

  invalidate(message = 'Højttalerlisten skal hentes igen.', preserveDestination = false) {
    const context = this.context();
    if (!preserveDestination || (this.nextDestination && (this.nextDestination.key !== context?.key ||
      this.nextDestination.transport !== context.transport))) this.nextDestination = null;
    this.clearLabel(preserveDestination);
    this.generation++;
    this.readPending = false;
    clearTimeout(this.expiry);
    this.setRows([]);
    this.store.setState({rows: [], busy: false, refreshDisabled: this.refreshOff(), note: {hidden: false,
      text: message}});
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
        row.nativeRoomId === binding.nativeRoomId && row.homepodId === binding.nativeHomepodId);
      this.actualDisplay = matches.length === 1 && matches[0]
        ? Object.freeze({key, transport: context.transport, name: matches[0].name}) : null;
    } else if (value && !speakerCatalogue(value, context, value.retrievedAt * 1000)) this.actualDisplay = null;
    return this.actualDisplay?.name ?? '';
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
      return this.selectionDestination()?.name ?? '';
    } catch {
      return '';
    }
  }

  pendingChoiceLabel(): string {
    const choice = this.pendingChoice, context = this.context();
    if (!choice || !context || choice.transport !== context.transport || choice.accountId !== context.accountId ||
      choice.bootId !== context.bootId || choice.roomId !== context.roomId) {
      if (choice) this.pendingChoice = null;
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
        value = await this.readCatalogue(context);
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
    this.nextDestination = destination(row, context);
  }

  selectionDestination(): {speakerId: string; name: string} | null {
    const selected = this.nextDestination;
    if (!selected) return null;
    const context = this.context();
    if (selected.key !== context?.key || selected.transport !== context.transport ||
      this.host.liveSnapshot?.capabilities?.musicSelection !== true) throw Error('destination_selection_expired');
    return {speakerId: selected.speakerId, name: selected.name};
  }

  // Decide every row's state (and the note) from the room, the catalogue and the music lane.
  sync(): void {
    if (this.host.liveRadio?.getState().outputOpen) return;
    if (!this.readPending) this.setRefreshDisabled(this.refreshOff());
    const context = this.context();
    if (this.labelScope && (context?.key !== this.labelScope.key || context.transport !== this.labelScope.transport))
      this.clearLabel(true);
    if (this.scope && (context?.key !== this.scope.key || context.transport !== this.scope.transport))
      this.scopeChanged(this.scope, context);
    this.runQueuedMove();
    const controls = this.host.liveControls, music = controls?.musicContext(true);
    const fence = controls?.musicFence;
    // An unknown outcome never greys a speaker: the next choice goes through.
    const fenced = music && fence?.key === music.key && fence?.outcome === 'accepted' &&
      !['confirmed', 'rejected', 'superseded'].includes(fence.settlementStatus ?? '') ? 'accepted' : null;
    const busy = musicBusy(controls), warmup = !music && this.warmingUp();
    const queued = this.queuedMove;
    const waiting = warmup && queued?.warmup ? queued.row.speakerId : null;
    const playback = this.host.liveMedia?.playback, snapshot = this.host.liveSnapshot;
    const binding = context && roomObservationCurrent(playback, snapshot) && playbackBinding(playback, snapshot,
      context.accountId);
    const catalogueInScope = !!context && this.scope?.key === context.key && this.scope.transport === context.transport;
    const catalogueCurrent = catalogueInScope && this.validUntil > Date.now();
    const currentOutputLabels = catalogueInScope && (catalogueCurrent || this.readPending);
    const configured = context && mediaRoomBinding(snapshot, context.accountId);
    const confirmedIdle = playback?.observationStatus === 'idle' &&
      playback.state === ('no_active_playback' as never) &&
      playback.config_entry_id === context?.accountId && playbackObservationCurrent(playback, snapshot);
    const defaultDestination = catalogueCurrent && !music && !warmup && (!playback || confirmedIdle) &&
      !this.actualDisplay && !this.nextDestination && ![...this.observedOutput.values()].some(Boolean);
    const selection = snapshot?.capabilities?.musicSelection;
    const keyed = this.store.getState().rows;
    const rows = this.catalogue.map((row, index): SpeakerRowView => {
      const actualOutput = !!(currentOutputLabels && binding && row.accountId === binding.accountId &&
        row.nativeRoomId === binding.nativeRoomId && row.homepodId === binding.nativeHomepodId);
      if (currentOutputLabels && binding) this.observedOutput.set(row.speakerId, actualOutput);
      const knownOutput = actualOutput || this.observedOutput.get(row.speakerId) === true;
      const state = speakerRowState(row, {busy, music: !!music, warmup, selection, moveAvailable: this.moveAvailable,
        fenced, actualOutput});
      const canStart = !music && selection === true && row.startSelectable === true;
      const defaultSelected = !!(defaultDestination && configured && canStart &&
        row.accountId === configured.accountId && row.nativeRoomId === configured.nativeRoomId &&
        row.homepodId === configured.nativeHomepodId);
      const nextSelected = waiting ? waiting === row.speakerId
        : this.nextDestination?.speakerId === row.speakerId || defaultSelected;
      const pressed = waiting || this.nextDestination ? nextSelected : knownOutput || defaultSelected;
      const outputLabel = actualOutput ? 'Aktuelt output' : 'Seneste output';
      const kept = keyed[index];
      return {key: kept?.row.speakerId === row.speakerId ? kept.key : '', row,
        disabled: state.disabled, pressed,
        label: [row.name, nextSelected ? 'Valgt' : '', actualOutput ? 'Aktuelt output'
          : knownOutput ? 'Seneste output' : ''].filter(Boolean).join(' · '),
        detail: state.label,
        status: nextSelected ? 'Valgt' : knownOutput ? outputLabel : row.default ? 'Standardrum' : ''};
    });
    this.store.setState({rows: rows.map(view => view.key ? view : {...view, key: `s:${String(this.epoch)}:` +
      view.row.speakerId})});
    if (this.scope && rows.length && this.validUntil > Date.now()) {
      const startAvailable = !music && selection === true && rows.some(view => view.row.startSelectable === true);
      const message = busy ? 'Musikhandlingen behandles.' : startAvailable ? '' : !this.moveAvailable
        ? 'Aktuelle højttalere fra PodConnect · rumskift er endnu ikke tilgængeligt.' : !music
          ? 'Afspilningen i rummet skal bekræftes, før du kan flytte musikken.' : fenced === 'accepted'
            ? 'Afventer bekræftelse af afspilningen.' : 'Vælg en højttaler til den aktuelle afspilning.';
      this.setNote(message);
    }
  }

  // The room, account, connection or grants changed under an open list: read it again (a lost grant first clears).
  private scopeChanged(old: Context, context: Context | null) {
    const same = !!context && old.hardKey === context.hardKey && old.transport === context.transport;
    const revoked = same && Object.keys(old.grants).some(key => old.grants[key] && !context.grants[key]);
    if (!same || revoked) {
      this.invalidate(undefined, true);
      if (context && this.dialogOpen())
        queueMicrotask(() => {
          if (this.dialogOpen() && this.context() && !this.readPending) void this.open();
        });
      return;
    }
    this.generation++;
    this.readPending = false;
    this.setRefreshDisabled(this.refreshOff());
    clearTimeout(this.expiry);
    this.scope = context;
    this.validUntil = 0;
    if (this.dialogOpen() && !this.scopeRefreshScheduled) {
      this.scopeRefreshScheduled = true;
      queueMicrotask(() => {
        this.scopeRefreshScheduled = false;
        if (this.dialogOpen() && this.scope && this.context()?.key === this.scope.key && !this.readPending)
          void this.open();
      });
    }
  }

  // A speaker tapped while a music start was on its way is one explicit move, made once when the started music is
  // observed (a tap during a command is queued, never dropped; owner 17/11: »det tog to tryk«). Within 30 s only.
  runQueuedMove(): void {
    const queued = this.queuedMove, controls = this.host.liveControls;
    if (!queued) return;
    if (queued.warmup) {
      // A choice made while the player showed the room's last report waits for the room's own read; then it is an
      // ordinary choice against what the room said (last tap wins, made once).
      if (this.warmingUp()) return;
      this.queuedMove = null;
      if (this.pendingChoice?.speakerId === queued.row.speakerId) this.pendingChoice = null;
      const row = queued.row;
      if (!controls?.musicContext(true) && !this.host.liveMedia?.playback) {
        // Nothing plays: the speaker is the next start's destination when its start rule allows it, else no choice.
        if (this.scope && row.startSelectable === true &&
          this.host.liveSnapshot?.capabilities?.musicSelection === true)
          this.nextDestination = destination(row, this.scope);
        return;
      }
      const live = this.host.liveMedia?.playback, snapshot = this.host.liveSnapshot;
      const binding = roomObservationCurrent(live, snapshot) && playbackBinding(live, snapshot, row.accountId);
      // The room already plays on the chosen speaker: nothing to send.
      if (binding && binding.nativeRoomId === row.nativeRoomId && binding.nativeHomepodId === row.homepodId) return;
      this.queuedMove = Object.freeze({row, at: Date.now()});
      this.runQueuedMove();
      return;
    }
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

  // The tap on one speaker row: one explicit choice, made once.
  async choose(key: string): Promise<void> {
    this.sync();
    const view = this.store.getState().rows.find(row => row.key === key), row = view?.row, scope = this.scope;
    if (!view || !row || !scope || view.disabled || this.selectionLookupPending) return;
    if (this.validUntil <= Date.now()) {
      // The list is older than 30 s: read it again, then make the same choice if that speaker is still offered.
      const prior = this.context(), epoch = this.selectionLookupEpoch;
      if (!this.dialogOpen() || prior?.key !== scope.key || prior.transport !== scope.transport) return;
      this.selectionLookupPending = true;
      try {
        await this.open();
      } finally {
        this.selectionLookupPending = false;
      }
      const after = this.context();
      if (after?.key !== prior.key || after.transport !== prior.transport || this.validUntil <= Date.now() ||
        !this.dialogOpen() || this.selectionLookupEpoch !== epoch) return;
      const matches = this.store.getState().rows.filter(next => next.row.speakerId === row.speakerId &&
        next.row.accountId === row.accountId && next.row.nativeRoomId === row.nativeRoomId &&
        next.row.homepodId === row.homepodId);
      if (matches.length === 1 && matches[0] && !matches[0].disabled) await this.choose(matches[0].key);
      return;
    }
    const catalogueCurrent = () => {
      const now = this.context();
      return this.scope?.key === scope.key && this.scope.transport === scope.transport && now?.key === scope.key &&
        now.transport === scope.transport && this.validUntil > Date.now() &&
        this.store.getState().rows.some(next => next.key === key && next.row === row);
    };
    if (!catalogueCurrent()) return;
    const controls = this.host.liveControls;
    const choice = (): Choice => Object.freeze({speakerId: row.speakerId, name: row.name, accountId: row.accountId,
      bootId: scope.bootId, roomId: scope.roomId, transport: scope.transport});
    if (controls?.musicContext(true) && (this.observedOutput.get(row.speakerId) === true ||
      this.observedDestination(row.speakerId))) {
      // The music already plays there: it is the player's speaker; nothing is sent.
      this.host.playerView?.chooseSpeaker?.(row);
      this.closeDialog();
      this.host.liveMedia?.render?.();
      return;
    }
    if (controls?.musicContext(true)) {
      this.host.playerView?.chooseSpeaker?.(row);
      const made = (this.pendingChoice = choice());
      this.closeDialog();
      this.host.liveMedia?.render?.();
      void Promise.resolve(controls.moveSpeaker(row, () => catalogueCurrent() && this.moveAvailable, made))
        .then(sent => {
          if (!sent || ['unknown', 'rejected', 'unavailable'].includes(this.host.liveControls?.musicFence?.outcome ??
            '')) {
            if (this.pendingChoice === made) this.pendingChoice = null;
            this.host.liveMedia?.render?.();
          }
        });
      return;
    }
    if (this.warmingUp()) {
      // Warm-up: shown at once as the player's speaker, sent when the room's own read lands (runQueuedMove).
      this.host.playerView?.chooseSpeaker?.(row);
      this.pendingChoice = choice();
      this.queuedMove = Object.freeze({row, at: Date.now(), warmup: true});
      this.sync();
      this.closeDialog();
      this.host.liveMedia?.render?.();
      return;
    }
    if (row.startSelectable !== true || this.host.liveSnapshot?.capabilities?.musicSelection !== true) return;
    this.host.playerView?.chooseSpeaker?.(row);
    this.nextDestination = destination(row, scope);
    this.queuedMove = this.host.liveSelection?.controlHold?.() ? Object.freeze({row, at: Date.now()}) : null;
    this.sync();
    this.host.liveMedia?.render?.();
    this.closeDialog();
  }

  // The sheet was opened: radio takes it when radio holds the player, else PodConnect's current speakers are read.
  async open(): Promise<void> {
    const radio = this.host.liveRadio;
    if (radio?.getState().outputOpen || radio?.ownsPlayer()) {
      radio.openOutputs();
      return;
    }
    const context = this.context();
    if (this.readPending && this.scope?.key === context?.key && this.scope?.transport === context?.transport)
      return this.pendingRosterWait ?? undefined;
    const retained = !!context && this.scope?.key === context.key && this.scope.transport === context.transport;
    if (retained) {
      this.generation++;
      clearTimeout(this.expiry);
    } else this.invalidate('Højttalerlisten skal hentes igen.', true);
    if (!context) {
      this.setNote('Højttalerlisten er ikke tilgængelig.', false);
      return;
    }
    this.scope = context;
    const generation = this.generation;
    this.store.setState({busy: !(retained && this.validUntil > Date.now())});
    if (!retained) this.setNote('', true);
    if (retained && this.validUntil > Date.now()) this.armExpiry(this.validUntil, generation, context);
    this.readPending = true;
    let resolveRoster: () => void = () => undefined;
    const rosterWait = new Promise<void>(resolve => {
      resolveRoster = resolve;
    });
    this.pendingRosterWait = rosterWait;
    this.setRefreshDisabled(true);
    this.sync();
    if (retained && this.validUntil <= Date.now()) this.setNote('Henter aktuelle højttalere…', false);
    const current = () => {
      const next = this.context();
      return generation === this.generation && next?.key === context.key && next.transport === context.transport;
    };
    try {
      const value = await this.readCatalogue(context);
      if (!current()) {
        if (generation === this.generation) this.invalidate();
        return;
      }
      const rows = speakerCatalogue(value, context), catalogue = catalogueValue(value);
      if (!rows || !catalogue) {
        this.configuredDisplay = null;
        throw Error('invalid_catalogue');
      }
      const next = this.nextDestination;
      if (next && !rows.some(row => row.speakerId === next.speakerId && row.accountId === next.accountId &&
        row.nativeRoomId === next.nativeRoomId && row.homepodId === next.nativeHomepodId)) this.nextDestination = null;
      // The same speakers with the same choosability keep their rows (and focus); otherwise the list is new.
      const old = this.catalogue;
      const reuse = old.length === rows.length && rows.every((row, index) => {
        const was = old[index];
        return was?.speakerId === row.speakerId && was.accountId === row.accountId &&
          was.nativeRoomId === row.nativeRoomId && was.homepodId === row.homepodId &&
          !!((this.moveAvailable && was.selectable) || was.startSelectable) ===
          !!((catalogue.moveAvailable && row.selectable) || row.startSelectable);
      });
      if (!reuse) {
        this.epoch++;
        this.observedOutput.clear();
        this.store.setState({rows: []});
      }
      this.setRows(rows);
      this.moveAvailable = catalogue.moveAvailable;
      this.setNote(this.moveAvailable ? 'Vælg en højttaler til den aktuelle afspilning.'
        : 'Aktuelle højttalere fra PodConnect · rumskift er endnu ikke tilgængeligt.', false);
      this.validUntil = catalogue.retrievedAt * 1000 + CATALOGUE_VALID_MS;
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
          this.setNote('Højttalerlisten kunne ikke opdateres · prøv Opdater liste.', false);
        } else this.invalidate('Højttalerlisten kunne ikke hentes.', true);
      }
    } finally {
      if (generation === this.generation) {
        this.readPending = false;
        this.store.setState({busy: false, refreshDisabled: this.refreshOff()});
        this.sync();
      }
      resolveRoster();
      if (this.pendingRosterWait === rosterWait) this.pendingRosterWait = null;
    }
  }

  // The sheet closed: a pending re-read lookup no longer chooses.
  closed() {
    this.selectionLookupEpoch++;
  }

  cleanup(): void {
    this.selectionLookupEpoch++;
    this.invalidate();
  }
}

function destination(row: SpeakerRow, scope: {key: string; transport: unknown}): Destination {
  return Object.freeze({speakerId: row.speakerId, name: row.name, accountId: row.accountId,
    nativeRoomId: row.nativeRoomId, nativeHomepodId: row.homepodId, key: scope.key, transport: scope.transport});
}
