// Find musik's controller (replaces live-music-view.js's four-tab catalogue). The shell (widget-view.js) keeps
// one instance as host.liveCatalogue: it reads PodVoice's shelves (GET music/shelves), keeps the last-known page
// (in memory and in this browser's storage) so Find musik shows content in its first frame, refreshes quietly in
// the background, and hands a tapped tile to the existing start flow (LiveMusicSelectionView: setup → offer →
// one action → the player shows the wish until the speaker reports it). The player owns the speaker choice.
//
// Owner rules: status is what the speaker reports (the player's job); every tap is sent and the last one wins —
// a tap while a start is under way waits and only the newest waiting tap is sent; nothing here ever locks; an
// error belongs to its tap and is a short toast that clears itself; nothing flashes (an unchanged page draws
// nothing, a refresh replaces content in place, covers appear when decoded).
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {collectionCurrent} from '../../../music-selection-model.js';
import {FindMusik} from './FindMusik';
import type {FindMusikModel} from './FindMusik';
import {shelvesPage, shelvesSource, tileSelection} from './model';
import type {ShelfItem, ShelvesPage, ShelvesSource} from './model';

export interface ShelfCard {
  id: string;
  uri: string;
  name: string;
}

export interface ShelvesEntry {
  kind: 'shelves';
  sourceKind: 'shelves';
  cards: ShelfCard[];
  source: ShelvesSource | null;
  fullSource: ShelvesSource | null;
  renewalScope: string;
  selectionSpent?: boolean;
  selectionExpired?: boolean;
  selectionUnavailable?: boolean;
  selectionConfirmed?: boolean;
  selectionSettlementStatus?: string;
  actionDispatched?: boolean;
}

interface Feedback {
  message?: string;
  pending?: boolean;
  outcome?: string;
}

interface Selection {
  pending?: boolean;
  recovery?: unknown;
  active?: boolean;
  feedback?: Feedback | null;
  chooseCard: (card: ShelfCard) => Promise<unknown>;
}

interface Transport {
  connected?: boolean;
  generation?: number;
  musicShelves?: (account: string) => Promise<unknown>;
}

interface Snapshot {
  bootId?: string;
  roomId?: string;
  providerGeneration?: unknown;
  mediaRoomBindings?: unknown;
  capabilities?: {musicRead?: string[]; musicSelection?: boolean};
}

export interface ShelvesHost {
  liveTransport?: Transport | null;
  liveSnapshot?: Snapshot | null;
  liveSelection?: Selection | null;
  liveMedia?: {render?: () => void} | null;
  state?: {focus?: string} | null;
  isConnected?: boolean;
  querySelector: (selector: string) => Element | null;
}

const STORAGE = 'podview.find-musik.v1';
const REREAD_MS = 4000;
const STALE_MS = 60000;
const TOAST_MS = 3500;
const IDLE_WAIT_MS = 30000;
const EMPTY = 'Der er ingen musik at vise endnu. Lyt til noget i Spotify, så kommer det her.';
const OFFLINE = 'Musikken kan ikke hentes lige nu.';

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

export class MusicShelvesView {
  readonly host: ShelvesHost;
  account: string | null = null;
  // The start flow's catalogue contract: one collection (»shelves«) with one entry.
  readonly selected = 'shelves';
  readonly entries = new Map<string, ShelvesEntry>();
  cards: ShelfCard[] = [];
  connected = false;
  capabilities: string[] = [];
  page: ShelvesPage | null = null;
  pageAt = 0;
  private reading: Promise<boolean> | null = null;
  private readTicket: object | null = null;
  private rereads = 0;
  private rereadTimer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private toast: string | null = null;
  private toastKey = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private latest: ShelfCard | null = null;
  private starting = false;
  private readonly cardsById = new Map<string, ShelfCard>();
  private reactRoot: Root | undefined;
  private mount: Element | null = null;
  private signature = '';
  private demo: {page: ShelvesPage; choose: (row: ShelfItem) => void} | null = null;

  constructor(host: ShelvesHost) {
    this.host = host;
  }

  readonly choose = (row: ShelfItem) => {
    if (this.demo) {
      this.demo.choose(row);
      return;
    }
    void this.chooseCard(this.card(row));
  };

  // --- shell contract ------------------------------------------------------------------------------------------

  scope(): string {
    const snapshot = this.host.liveSnapshot;
    return JSON.stringify([snapshot?.bootId ?? null, snapshot?.roomId ?? null]);
  }

  key(): string {
    return JSON.stringify([this.scope(), this.account, 'shelves']);
  }

  renewalScope(): string {
    const s = this.host.liveSnapshot;
    return JSON.stringify([this.scope(), this.account, s?.providerGeneration, s?.mediaRoomBindings]);
  }

  supported(): boolean {
    return this.capabilities.includes('shelves');
  }

  updateCapabilities(connected: boolean, capabilities: string[] = []) {
    const changed = JSON.stringify(capabilities) !== JSON.stringify(this.capabilities);
    this.connected = connected;
    this.capabilities = [...capabilities];
    if (changed) this.invalidateAuthority();
    if (!this.page) this.restore();
    this.render();
  }

  open() {
    this.restore();
    this.render();
    if (this.host.state?.focus !== 'music') {
      this.prefetch();
      return;
    }
    // A tap renews an expired choice set itself; the page only looks again when its content is old.
    if (!this.page || Date.now() - this.pageAt >= STALE_MS) void this.read();
  }

  // Off the page, read once in the background so Find musik opens with content.
  prefetch() {
    if (!this.page && !this.reading && this.connected && this.account) void this.read();
  }

  resetAccount(account: string | null = null) {
    if (this.account === account) {
      this.render();
      return;
    }
    this.account = account;
    this.page = null;
    this.entries.clear();
    this.cards = [];
    this.cardsById.clear();
    this.latest = null;
    this.restore();
    this.render();
  }

  offline() {
    this.connected = this.host.liveTransport?.connected === true;
    this.invalidateAuthority();
    this.render();
  }

  // The page's choice set may not outlive the authority it was issued under; the content stays.
  invalidateAuthority() {
    for (const entry of this.entries.values()) {
      entry.source = null;
      entry.fullSource = null;
    }
  }

  // The start flow asks whether a choice may be prepared again: always, while connected (last tap wins).
  canRenewEntry(entry: ShelvesEntry | undefined, card: ShelfCard | null = null): boolean {
    return !!entry && this.entries.get(this.key()) === entry && (!card || entry.cards.includes(card))
      && this.host.state?.focus === 'music' && this.connected && this.host.liveTransport?.connected === true
      && this.host.isConnected !== false && !!this.account && this.supported()
      && this.capabilities.includes('targets') && this.host.liveSnapshot?.capabilities?.musicSelection === true;
  }

  // A fresh choice set for this tile (the server answers from its cache; no new Spotify read).
  async renewForCard(card: ShelfCard): Promise<boolean> {
    const entry = this.entries.get(this.key());
    if (!entry || !this.canRenewEntry(entry, card)) return false;
    await this.read();
    const now = this.entries.get(this.key());
    return !!now && now === entry && this.prepare(entry, card);
  }

  observeIdlePlayback() {
    // A start never locks a tile, so there is nothing to release.
  }

  renewRetained() {
    if (this.host.state?.focus === 'music' && this.page && !this.entryCurrent()) void this.read();
  }

  select() {
    this.render();
  }

  refresh() {
    void this.read();
  }

  interrupt() {
    this.latest = null;
  }

  // --- reading -------------------------------------------------------------------------------------------------

  private entryCurrent(): boolean {
    const entry = this.entries.get(this.key());
    return !!entry?.fullSource && collectionCurrent(entry.fullSource, this.host.liveSnapshot, this.account);
  }

  read(): Promise<boolean> {
    if (this.reading) return this.reading;
    const transport = this.host.liveTransport;
    const account = this.account;
    const scope = this.scope();
    if (!transport?.connected || !account || !this.supported() || typeof transport.musicShelves !== 'function') {
      return Promise.resolve(false);
    }
    const requestedAt = Date.now();
    const ticket = {};
    this.readTicket = ticket;
    this.reading = (async () => {
      try {
        const body = await transport.musicShelves?.(account);
        if (this.account !== account || this.scope() !== scope || this.host.liveTransport !== transport) return false;
        const page = shelvesPage(body, account, this.host.liveSnapshot ?? null);
        if (!page) throw Error('invalid_shelves');
        this.failed = false;
        this.accept(page, Date.now());
        const entry = this.entry();
        entry.fullSource = shelvesSource(body, page, (this.host.liveSnapshot ?? null) as Record<string, unknown> | null,
          requestedAt);
        entry.renewalScope = this.renewalScope();
        this.persist(page);
        this.scheduleReread(page.refreshing);
        return true;
      } catch {
        if (this.account === account && this.scope() === scope) this.failed = true;
        return false;
      } finally {
        if (this.readTicket === ticket) {
          this.readTicket = null;
          this.reading = null;
        }
        this.render();
      }
    })();
    return this.reading;
  }

  // While PodVoice renews its cache in the background, look again a few times; the content updates in place.
  private scheduleReread(refreshing: boolean) {
    if (this.rereadTimer) clearTimeout(this.rereadTimer);
    this.rereadTimer = null;
    if (!refreshing) {
      this.rereads = 0;
      return;
    }
    if (this.rereads >= 3) return;
    this.rereads += 1;
    this.rereadTimer = setTimeout(() => {
      this.rereadTimer = null;
      if (this.host.isConnected !== false) void this.read();
    }, REREAD_MS);
  }

  private accept(page: ShelvesPage, at: number) {
    this.page = page;
    this.pageAt = at;
    const entry = this.entry();
    const cards = page.items.map(row => this.card(row));
    entry.cards = cards;
    this.cards = cards;
  }

  private entry(): ShelvesEntry {
    const key = this.key();
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {kind: 'shelves', sourceKind: 'shelves', cards: [], source: null, fullSource: null,
        renewalScope: this.renewalScope()};
      this.entries.clear();
      this.entries.set(key, entry);
    }
    return entry;
  }

  // One card object per URI for as long as this account is shown, so a renewed page keeps the tapped card.
  private card(row: ShelfItem): ShelfCard {
    const id = `shelf:${row.uri}`;
    let card = this.cardsById.get(id);
    if (!card) {
      card = {id, uri: row.uri, name: row.name};
      this.cardsById.set(id, card);
    } else if (card.name !== row.name) card.name = row.name;
    return card;
  }

  private storageKey(): string | null {
    const roomId = this.host.liveSnapshot?.roomId;
    return roomId && this.account ? `${STORAGE}:${roomId}:${this.account}` : null;
  }

  private persist(page: ShelvesPage) {
    const key = this.storageKey();
    if (!key) return;
    try {
      globalThis.localStorage.setItem(key, JSON.stringify({savedAt: Date.now(), page}));
    } catch {
      // Storage is a convenience: the page works without it.
    }
  }

  // The last-known page from this browser, shown at once (display only: a tap prepares a fresh choice set).
  private restore() {
    if (this.page || !this.account) return;
    const key = this.storageKey();
    if (!key) return;
    try {
      const raw = globalThis.localStorage.getItem(key);
      const saved = raw ? JSON.parse(raw) as {page?: Record<string, unknown>} : null;
      const stored = saved?.page;
      if (!stored) return;
      const page = shelvesPage({...stored, ok: true, schema: 'podview.music_shelves.v1',
        configEntryId: stored.account}, this.account, this.host.liveSnapshot ?? null);
      if (page) this.accept({...page, refreshing: false}, 0);
    } catch {
      // A damaged entry is ignored; the next read replaces it.
    }
  }

  // --- choosing ------------------------------------------------------------------------------------------------

  // Point the start flow's entry at this tile, from the page's current choice set when it has one.
  private prepare(entry: ShelvesEntry, card: ShelfCard): boolean {
    entry.source = tileSelection(entry.fullSource, card.uri);
    entry.actionDispatched = false;
    entry.selectionSpent = false;
    entry.selectionExpired = false;
    entry.selectionConfirmed = false;
    entry.selectionUnavailable = false;
    delete entry.selectionSettlementStatus;
    return !!entry.source;
  }

  // Every tap is sent; one under way finishes first and only the newest waiting tap follows (last wins).
  async chooseCard(card: ShelfCard) {
    this.latest = card;
    if (this.starting) return;
    this.starting = true;
    try {
      while (this.latest) {
        const next = this.latest;
        this.latest = null;
        await this.start(next);
      }
    } finally {
      this.starting = false;
    }
  }

  private async idle(selection: Selection): Promise<boolean> {
    const until = Date.now() + IDLE_WAIT_MS;
    while (selection.pending || selection.recovery) {
      if (Date.now() >= until || this.host.isConnected === false) return false;
      await sleep(50);
    }
    return true;
  }

  private async start(card: ShelfCard) {
    const selection = this.host.liveSelection;
    if (!selection || !(await this.idle(selection)) || this.latest) return;
    const entry = this.entries.get(this.key());
    if (!entry?.cards.includes(card)) return;
    this.prepare(entry, card);
    try {
      await selection.chooseCard(card);
    } catch {
      // The start flow reports its own outcome; an exception is that tap's error.
      this.say('Musikken kunne ikke startes. Prøv igen.');
      return;
    }
    const feedback = selection.feedback;
    if (feedback && feedback.pending !== true && !['accepted', 'unknown'].includes(feedback.outcome ?? '')
      && feedback.message) {
      // The error was this tap's: it is the toast alone, never also a lasting line on the player.
      selection.feedback = null;
      this.host.liveMedia?.render?.();
      this.say(feedback.message);
    }
  }

  private say(message: string, done?: () => void) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = message;
    this.toastKey += 1;
    this.render();
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.toast = null;
      done?.();
      this.render();
    }, TOAST_MS);
  }

  // --- drawing -------------------------------------------------------------------------------------------------

  model(): FindMusikModel {
    const page = this.demo?.page ?? this.page;
    const reading = !!this.reading;
    const empty = page ? EMPTY : !this.connected || this.failed ? OFFLINE : null;
    return {items: page?.items ?? [], quick: page?.quick ?? [], shelves: page?.shelves ?? [],
      empty: reading && !page ? null : empty, toast: this.toast, toastKey: this.toastKey,
      now: Date.now()};
  }

  render() {
    const mount = this.host.querySelector('#find-musik');
    if (!mount) return;
    if (mount !== this.mount || !this.reactRoot) {
      this.reactRoot?.unmount();
      this.mount = mount;
      mount.replaceChildren();
      this.reactRoot = createRoot(mount);
      this.signature = '';
    }
    const model = this.model();
    // The relative day labels change at most daily; an identical page draws nothing.
    const signature = JSON.stringify([model.items, model.quick, model.shelves, model.empty, model.toast,
      model.toastKey, new Date(model.now).toDateString()]);
    if (signature === this.signature) return;
    this.signature = signature;
    const root = this.reactRoot;
    flushSync(() => {
      root.render(<FindMusik model={model} actions={{choose: this.choose}} />);
    });
  }

  // The local preview (no PodVoice): the same page from the preview's own options.
  renderDemo(page: ShelvesPage, choose: (row: ShelfItem) => void) {
    this.demo = {page, choose};
    this.render();
  }

  dispose() {
    if (this.rereadTimer) clearTimeout(this.rereadTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.reactRoot?.unmount();
    this.reactRoot = undefined;
  }
}
