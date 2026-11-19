// The player: the card on Home, its empty state and the full player with the queue. The controller the shell
// (widget-view.js) and its live owners (live media, live radio, the room player's controls) drive, with the API of
// the pre-React player-view.js: renderPlayer, renderControls, renderQueue, renderRadioProgress, the speaker choice,
// the source focus, volume gesture ownership, the seek gesture and the named parts (queue, rows, emptyCopy,
// seekControl, volumeMute, outputPlacement). React draws the elements (PlayerScreen.tsx) synchronously, so the
// player is current when a call returns; each write the old view made is now a face (paint.ts), settled against
// the real elements. Native, as before: the seek range (a gesture keeps its draft until release), the volume
// inputs and transport (player-controls.js), artwork (spotify-artwork.js), the cover tone on the card, the
// containers' state and the output control's place (card or empty card).
import {animateList} from '../../../ui/list-motion.js';
import {applyKitComponent} from '../../../ui/kit.js';
import {discoveryPeriodLabel, fixtureArtwork} from '../../../music-results.js';
import {
  cancelArtwork,
  generatedMoodArtwork,
  renderRetainedArtwork,
  renderSpotifyArtwork,
  spotifyArtwork,
} from '../../../spotify-artwork.js';
import {
  playbackBinding,
  playbackObservationCurrent,
  roomObservationCurrent,
  roomObservationDisplay,
} from '../../../media-observation.js';
import {OTHER_ACCOUNT, PLAYER_SPEAKER_IDLE_MS, autoSourceFocus, txt} from '../../../player-model.js';
import {renderPlayerControls} from '../../../player-controls.js';
import type {PlayerControlsModel} from '../../../player-controls.js';
import {Paint} from './paint';
import type {PaintValue} from './paint';
import {playerRoots} from './PlayerScreen';
import type {PlayerRoots, QueueRowShape} from './PlayerScreen';
import type {
  PlayerHost,
  PlayerModel,
  QueueItem,
  QueueOptions,
  RadioHistory,
  SeekState,
  SeekWitness,
  SourceFocus,
  SpeakerChoice,
  VolumeModel,
  VolumeWitness,
} from './types';

export {OTHER_ACCOUNT, autoSourceFocus};

export interface SeekEvent {
  positionMs: number;
  witness?: SeekWitness;
  trackId?: string | undefined;
  operation?: unknown;
}

export interface PlayerViewOptions {
  chooseQueue?: (item: QueueItem) => void;
  seek?: (event: SeekEvent) => void;
}

export interface OutputPlacement {
  output: HTMLButtonElement;
  parent: Element;
  next: Element | null;
  emptyTitle: Element;
  copy: Element;
}

type QueueRow = HTMLButtonElement & {queueItem?: QueueItem};
interface CoverRequest {
  source: string;
  image: HTMLImageElement;
}
type ImageConstructor = new () => HTMLImageElement;

const ignore = () => undefined;
const format = (seconds: number) => `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
const SPOTIFY_IMAGE = /^https:\/\/(?:i\.scdn\.co|image-cdn-(?:ak|fa)\.spotifycdn\.com)\/image\/[A-Za-z0-9_-]+$/;
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

// Mounts the player's elements in the shell's containers once (the shell calls it before it binds its listeners).
export function mountPlayerScreen(doc: Document = document): PlayerRoots {
  return playerRoots(doc, () => new Paint());
}

// Reuse the same canonical output control, without a second action identity.
export function placeOutputHeader(view: PlayerView, vm: PlayerModel): void {
  const slot = view.outputPlacement;
  if (!slot) return;
  const {output, parent, next, emptyTitle, copy} = slot, idle = !vm.active;
  if (idle) {
    if (output.parentNode !== copy) emptyTitle.replaceWith(output);
    const disabled = vm.canOutput !== true, nextLabel = txt(vm.nextDestinationLabel);
    const label = nextLabel ? `Næste afspilning: ${nextLabel}` : vm.configuredTarget
      ? `Konfigureret højttaler: ${txt(vm.configuredTarget)}`
      : vm.canOutput === true ? 'Musik · Se aktuelle højttalere' : 'Musik';
    view.set('output', 'disabled', disabled);
    view.set('output', 'aria-label', label);
    view.set('player-state', 'text', '');
    view.set('player-room', 'text', nextLabel || txt(vm.configuredTarget) || 'Musik');
  } else if (output.parentNode !== parent) {
    output.replaceWith(emptyTitle);
    parent.insertBefore(output, next?.parentNode === parent ? next : null);
  }
  view.draw();
}

export class PlayerView {
  host: PlayerHost;
  doc: Document;
  chooseQueue: (item: QueueItem) => void;
  volumeGestures = new Map<HTMLInputElement, VolumeWitness>();
  volumeInputListeners = new Map<HTMLInputElement, Record<string, EventListener>>();
  coverTones = new Map<string, string>();
  coverToneLoad: () => void;
  coverToneRequest: CoverRequest | null = null;
  seekControl: HTMLInputElement | undefined;
  seekGesture: {witness: SeekWitness | null | undefined} | null = null;
  seekDraft: {witness: SeekWitness; progressMs: number} | null = null;
  volumeMute: HTMLButtonElement | null;
  volumeMuteClick: (() => void) | undefined;
  volumeMuteBinding: string | undefined;
  volumeRestore: number | null = null;
  volumeMuteRequest: {from: number | null | undefined; value: number} | null = null;
  volumeMuteVM: VolumeModel | null = null;
  rows = new Map<string, QueueRow>();
  placeholders: HTMLButtonElement[] | undefined;
  empty: HTMLParagraphElement | undefined;
  queue: HTMLElement;
  queueSignature: string | undefined;
  emptyCopy: HTMLParagraphElement;
  outputPlacement: OutputPlacement | undefined;
  progressVM: PlayerModel | null = null;
  progressClockTimer: ReturnType<typeof setTimeout> | null = null;
  progressClockKey: string | null = null;
  progressDisplay: {key: string; sourceMs: number; durationMs: number; displayMs: number} | null = null;
  suspended = false;
  chosenSpeaker: SpeakerChoice | null = null;
  sourceFocus: SourceFocus | null = null;
  private readonly roots: PlayerRoots;
  private readonly paint: Paint;
  private readonly rowsBound = new WeakSet<Element>();
  private batching = 0;

  constructor(host: PlayerHost, {chooseQueue = ignore, seek = ignore}: PlayerViewOptions = {}) {
    this.host = host;
    this.doc = host.ownerDocument;
    this.chooseQueue = chooseQueue;
    this.roots = mountPlayerScreen(this.doc);
    this.paint = this.roots.paint;
    for (const selector of ['.player', '#player-empty']) {
      const node = host.querySelector(selector);
      if (node) applyKitComponent(node, 'card');
    }
    for (const id of ['volume', 'detail-volume']) {
      const input = this.doc.getElementById(id);
      if (input instanceof HTMLInputElement) {
        applyKitComponent(input, 'slider');
        this.bindVolumeInput(input);
      }
    }
    this.coverToneLoad = () => {
      this.updateCoverTone();
    };
    this.doc.getElementById('cover')?.addEventListener('load', this.coverToneLoad);
    this.doc.getElementById('cover')?.addEventListener('error', this.coverToneLoad);
    const root = this.doc.getElementById('player-progress');
    if (root) this.seekControl = this.createSeek(root, seek);
    this.volumeMute = this.doc.getElementById('volume-mute') as HTMLButtonElement | null;
    if (this.volumeMute) {
      this.volumeMuteClick = () => {
        this.toggleVolumeMute();
      };
      this.volumeMute.addEventListener('click', this.volumeMuteClick);
    }
    this.queue = this.part('queue') as HTMLElement;
    this.emptyCopy = this.part('empty-copy') as HTMLParagraphElement;
    // The output control sits before the volume in the card; the empty card borrows it (placeOutputHeader).
    const output = this.part('output') as HTMLButtonElement, emptyTitle = this.part('empty-title');
    const next = this.part('player-volume'), parent = next.parentNode as Element;
    const copy = this.part('empty-copy').parentNode as Element;
    if (output.parentNode !== parent) {
      output.replaceWith(emptyTitle);
      parent.insertBefore(output, next);
    }
    this.outputPlacement = {output, parent, next, emptyTitle, copy};
  }

  private container(selector: string): HTMLElement {
    const node = this.doc.querySelector<HTMLElement>(selector);
    if (!node) throw Error(`Player is missing ${selector}`);
    return node;
  }

  private part(key: string): Element {
    const node = this.paint.element(key);
    if (!node) throw Error(`Player is missing ${key}`);
    return node;
  }

  set(key: string, prop: string, value: PaintValue): void {
    this.paint.set(key, prop, value);
  }

  // One draw per call: a pass (renderPlayer) draws once at its end, whatever its parts asked for on the way.
  draw(): void {
    if (!this.batching) this.roots.draw();
  }

  private batch(work: () => void): void {
    this.batching++;
    try {
      work();
    } finally {
      this.batching--;
    }
    this.draw();
  }

  private createSeek(root: Element, seek: NonNullable<PlayerViewOptions['seek']>): HTMLInputElement {
    const range = this.doc.createElement('input');
    range.id = 'detail-seek';
    range.type = 'range';
    range.step = '1000';
    range.hidden = true;
    range.disabled = true;
    range.setAttribute('aria-label', 'Vælg afspilningsposition');
    root.insertBefore(range, this.doc.getElementById('player-progress-meter'));
    range.addEventListener('pointerdown', () => {
      this.seekGesture = {witness: this.seekState()?.witness};
    });
    range.addEventListener('input', () => {
      const vm = this.progressVM, state = this.seekState(), positionMs = Number(range.value);
      if (!state || !Number.isSafeInteger(positionMs) || positionMs < 0 || positionMs > (vm?.durationMs ?? -1) ||
        (this.seekGesture && !this.sameSeek(this.seekGesture.witness, state.witness))) {
        this.renderTimeline();
        return;
      }
      this.seekDraft = {witness: state.witness, progressMs: positionMs};
      this.renderTimeline();
    });
    range.addEventListener('change', () => {
      const state = this.seekState(), draft = this.seekDraft;
      this.seekDraft = null;
      this.seekGesture = null;
      if (draft && this.sameSeek(draft.witness, state?.witness)) {
        const {progressMs: positionMs, witness} = draft;
        seek(this.host.live ? {positionMs, witness}
          : {positionMs, trackId: witness.trackId, operation: witness.operation});
      }
      this.renderTimeline();
    });
    range.addEventListener('pointerup', () => {
      this.seekGesture = null;
    });
    for (const type of ['pointercancel', 'blur'])
      range.addEventListener(type, () => {
        this.seekDraft = null;
        this.seekGesture = null;
        this.renderTimeline();
      });
    return range;
  }

  // One scoped presentation focus; it never grants or repeats an effect.
  // The player owns the speaker choice (test 11): the user's last explicit speaker stays until the user
  // changes it, or until 10 min pass with nothing playing or paused. Radio and music start there.
  chooseSpeaker(row: {homepodId?: string | null; id?: string; nativeRoomId?: string | null; name?: string} | null):
    void {
    const homepodId = row?.homepodId ?? row?.id;
    if (!row || !homepodId) return;
    this.chosenSpeaker = {
      homepodId,
      nativeRoomId: row.nativeRoomId ?? null,
      name: row.name || '',
      at: Date.now(),
      scope: this.sourceScope(),
    };
  }

  playerSpeaker(): SpeakerChoice | null {
    const h = this.host, c = this.chosenSpeaker, p = h.liveMedia?.playback, radio = h.liveRadio?.value?.state;
    const active = (['playing', 'paused'].includes(p?.state ?? '') && roomObservationDisplay(p, h.liveSnapshot)) ||
      (['playing', 'stopped'].includes(radio?.status as string) && radio?.sourceKind === 'radio');
    if (c?.scope === this.sourceScope() && (active || Date.now() - (c.at ?? 0) < PLAYER_SPEAKER_IDLE_MS)) {
      if (active) c.at = Date.now();
      return c;
    }
    this.chosenSpeaker = null;
    const b = playbackBinding(p, h.liveSnapshot, h.liveMedia?.account);
    return b ? {homepodId: String(b.nativeHomepodId), nativeRoomId: b.nativeRoomId, name: ''} : null;
  }

  sourceScope(): string | null {
    const s = this.host.liveSnapshot;
    return s?.bootId && s.roomId ? JSON.stringify([s.bootId, s.roomId]) : null;
  }

  // The shared player's source focus is always explicit: music, radio or auto (no explicit choice,
  // the observed room decides). It is scoped to boot and room; a new scope starts at auto.
  currentSourceFocus(): SourceFocus {
    const scope = this.sourceScope();
    if (this.sourceFocus?.scope !== scope) this.sourceFocus = autoSourceFocus(scope);
    return this.sourceFocus;
  }

  focusSource(kind: string, target: Record<string, unknown> | null = null): boolean {
    if (!['music', 'radio'].includes(kind) || !this.sourceScope()) return false;
    const scope = this.sourceScope(), previous = this.currentSourceFocus(), changed = previous.kind !== kind;
    this.sourceFocus = Object.freeze({scope, kind: kind as 'music' | 'radio',
      target: target ? Object.freeze({...target}) : null});
    if (kind === 'music') this.host.liveRadio?.closeOutputs?.();
    return changed;
  }

  beginSourceFocus(kind: string, target: Record<string, unknown> | null = null) {
    const previous = this.currentSourceFocus();
    this.focusSource(kind, target);
    return Object.freeze({previous, current: this.sourceFocus, scope: this.sourceScope()});
  }

  // A refused or unknown outcome did not prove the new source, so the player returns to its previous focus.
  finishSourceFocus(ticket: {previous?: SourceFocus | null; current: SourceFocus | null; scope: string | null} | null,
    outcome: string): boolean {
    if (!['rejected', 'unknown'].includes(outcome) || this.sourceScope() !== ticket?.scope ||
      this.sourceFocus !== ticket.current) return false;
    this.sourceFocus = ticket.previous?.scope === ticket.scope ? ticket.previous : autoSourceFocus(ticket.scope);
    return true;
  }

  sourceFocused(kind: string): boolean {
    const scope = this.sourceScope();
    if (this.sourceFocus?.scope !== scope) this.sourceFocus = autoSourceFocus(scope);
    return this.sourceFocus.kind === 'auto' || this.sourceFocus.kind === kind;
  }

  radioHistorySuperseded(history: RadioHistory | null | undefined): boolean {
    if (history?.scope !== this.sourceScope()) return false;
    if (history.superseded) return true;
    const h = this.host, p = h.liveMedia?.playback, s = h.liveSnapshot;
    if (p?.source === 'spotify' && ['playing', 'buffering'].includes(p.state ?? '') && roomObservationCurrent(p, s))
      return (history.superseded = true);
    const b = p?.state === 'playing' && playbackObservationCurrent(p, s) && roomObservationCurrent(p, s)
      ? playbackBinding(p, s, h.liveMedia?.account) : null;
    if (b && b.nativeRoomId === history.targetId && Number.isFinite(history.observedAt) &&
      Date.parse(p?.observedAt ?? '') >= ((history.observedAt ?? 0) + 1) * 1000) history.superseded = true;
    return history.superseded === true;
  }

  sourceModel(kind: string): PlayerModel {
    if (this.host.live !== true) return this.progressVM ?? {};
    if (kind === 'music' && this.host.liveRadio?.ownsPlayer?.()) return {};
    return (kind === 'radio' ? this.host.liveRadio?.playerModel?.() : this.host.liveMedia?.observedPlayerModel?.()) ??
      {};
  }

  private setCoverTone(player: Element | null, tone: string): void {
    const style = (player as HTMLElement | null)?.style;
    for (const name of ['--pv-cover', '--player-cover-tone'])
      if (style && style.getPropertyValue(name) !== tone) style.setProperty(name, tone);
  }

  updateCoverTone(sample: HTMLImageElement | null = null): void {
    const cover = this.doc.getElementById('cover') as HTMLImageElement | null;
    const player = this.host.querySelector('.player');
    const source = this.progressVM?.active === true && !cover?.classList.contains('live-art-fallback')
      ? cover?.currentSrc || cover?.src || null : null;
    let tone = 'transparent';
    if (this.coverToneRequest && this.coverToneRequest.source !== source) {
      this.coverToneRequest.image.onload = null;
      this.coverToneRequest.image.onerror = null;
      this.coverToneRequest.image.removeAttribute('src');
      this.coverToneRequest = null;
    }
    const ImageClass = (this.doc.defaultView as (Window & {Image?: ImageConstructor}) | null)?.Image;
    if (source && !sample && !this.coverTones.has(source) && ImageClass && SPOTIFY_IMAGE.test(source)) {
      if (!this.coverToneRequest) {
        const image = new ImageClass(), request = {source, image};
        this.coverToneRequest = request;
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.onload = () => {
          if (this.coverToneRequest !== request) return;
          image.onload = null;
          image.onerror = null;
          this.coverToneRequest = null;
          this.updateCoverTone((cover?.currentSrc || cover?.src) === source ? image : null);
        };
        image.onerror = () => {
          if (this.coverToneRequest !== request) return;
          image.onload = null;
          image.onerror = null;
          this.coverToneRequest = null;
          this.coverTones.set(source, 'transparent');
          this.updateCoverTone();
        };
        image.src = source;
      }
      this.setCoverTone(player, tone);
      return;
    }
    const picture = sample ?? cover;
    if (source && this.coverTones.has(source)) tone = this.coverTones.get(source) ?? tone;
    else if (source && picture?.complete && picture.naturalWidth > 0) {
      try {
        const canvas = this.doc.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext('2d', {willReadFrequently: true});
        if (context) {
          context.drawImage(picture, 0, 0, 8, 8);
          const pixels = context.getImageData(0, 0, 8, 8).data, buckets = new Map<string, number[]>();
          for (let i = 0; i < pixels.length; i += 4) {
            const [r = 0, g = 0, b = 0, a = 0] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
            if (a < 128) continue;
            const key = [r >> 5, g >> 5, b >> 5].join(','), bucket = buckets.get(key) ?? [0, 0, 0, 0];
            bucket[0] = (bucket[0] ?? 0) + 1;
            bucket[1] = (bucket[1] ?? 0) + r;
            bucket[2] = (bucket[2] ?? 0) + g;
            bucket[3] = (bucket[3] ?? 0) + b;
            buckets.set(key, bucket);
          }
          const dominant = [...buckets.values()].sort((x, y) => (y[0] ?? 0) - (x[0] ?? 0))[0];
          if (dominant) {
            const n = dominant[0] ?? 1, channel = (index: number) => String(Math.round((dominant[index] ?? 0) / n));
            tone = `rgb(${channel(1)} ${channel(2)} ${channel(3)} / .12)`;
          }
        }
      } catch {
        // An unreadable image keeps the neutral tone.
      }
      if (this.coverTones.size >= 24) {
        const oldest = this.coverTones.keys().next().value;
        if (oldest !== undefined) this.coverTones.delete(oldest);
      }
      this.coverTones.set(source, tone);
    }
    this.setCoverTone(player, tone);
  }

  artwork(node: Element | null | undefined, item: PlayerModel | QueueItem): void {
    if (!node) return;
    const diagnosticOwner = (this.host.liveTransport as unknown) ?? undefined;
    const loading = (item as {loading?: boolean}).loading;
    const playlist = /^spotify:playlist:[A-Za-z0-9]{22}$/.test(item.uri || '');
    if (loading && playlist && !spotifyArtwork(item.artwork, item.uri)) {
      const illustration = generatedMoodArtwork(item.themeArt, item.themeId) ||
        (item.themeArt?.startsWith('assets/') ? fixtureArtwork(item.themeArt) : null);
      if (illustration) {
        renderRetainedArtwork(node, {url: illustration, identity: illustration, contentIdentity: item.uri,
          label: `Illustration til ${txt(item.title)}`, diagnosticOwner});
        return;
      }
    }
    const logo = /^assets\/radio-(p3|p1|p4-ostjylland|p6-beat|p8-jazz)\.svg$/.test(item.fixtureArt || '');
    if (item.sourceKind === 'radio' && logo) {
      const art = item.fixtureArt ?? '';
      renderRetainedArtwork(node, {url: art, identity: `radio|${art}`, contentIdentity: art,
        label: `Stationslogo til ${txt(item.title)}`, diagnosticOwner});
    } else if (typeof item.artworkUrl === 'string' && item.artworkUrl) {
      const base = this.host.liveTransport?.base;
      const url = base ? new URL(item.artworkUrl, base).href : item.artworkUrl;
      renderRetainedArtwork(node, {url, identity: `room|${item.artworkUrl}`,
        contentIdentity: item.uri || item.artworkUrl,
        label: `Albumomslag til ${txt(item.title)}`, diagnosticOwner});
    } else if (item.fixtureArt && fixtureArtwork(item.fixtureArt)) {
      renderRetainedArtwork(node, {url: item.fixtureArt, identity: `fixture|${item.fixtureArt}`,
        contentIdentity: item.trackId || item.id || item.fixtureArt, diagnosticOwner,
        label: `Albumomslag til ${txt(item.title)}`});
    } else renderSpotifyArtwork(node, {uri: item.uri, name: item.title, artwork: item.artwork}, undefined, false,
      diagnosticOwner);
  }

  seekState(vm: PlayerModel | null = this.progressVM): SeekState | null {
    if (this.suspended || !vm?.active || vm.sourceKind === 'radio' || vm.loading) return null;
    if (!this.host.live)
      return vm.canSeek && vm.examplePosition ? {witness: {trackId: vm.trackId, operation: vm.seekOperation}} : null;
    if (!vm.fresh || !vm.positionFresh) return null;
    return this.host.liveControls?.musicSeekState?.(vm.uri) ?? null;
  }

  sameSeek(a: SeekWitness | null | undefined, b: SeekWitness | null | undefined): boolean {
    if (!a || !b) return false;
    return this.host.live ? a.key === b.key && a.transport === b.transport
      : a.trackId === b.trackId && a.operation === b.operation;
  }

  // Position is a display value only; live interpolation never creates seek authority.
  private paintProgress(vm: PlayerModel, seek: HTMLInputElement | undefined): void {
    const progress = vm.progressMs ?? NaN, durationMs = vm.durationMs ?? NaN;
    const known = vm.active === true && Number.isSafeInteger(progress) && progress >= 0 &&
      Number.isSafeInteger(durationMs) && durationMs > 0 && progress <= durationMs;
    const elapsed = known ? Math.floor(progress / 1000) : 0, total = known ? Math.floor(durationMs / 1000) : 0;
    for (const prefix of ['player', 'detail']) {
      const root = `${prefix}-progress`, rail = `${prefix}-progress-meter`;
      this.set(root, 'hidden', !known);
      const label = known ? `${vm.examplePosition === true ? 'Eksempelposition' : vm.positionFresh === true
        ? (vm.interpolatedPosition ? 'Beregnet position fra seneste observation' : 'Observeret position')
        : 'Position ikke opdateret'}: ${format(elapsed)} af ${format(total)}. Kun visning.` : '';
      const editable = prefix === 'player' && !!seek && known &&
        (vm.examplePosition === true || vm.canSeek === true) && vm.sourceKind !== 'radio';
      this.set(rail, 'hidden', editable);
      if (prefix === 'player' && seek) {
        if (seek.hidden !== !editable) seek.hidden = !editable;
        const disabled = !editable || vm.canSeek !== true;
        if (seek.disabled !== disabled) seek.disabled = disabled;
        const percentage = editable ? `${String(progress / durationMs * 100)}%` : '0%';
        if (seek.style.getPropertyValue('--seek-progress') !== percentage)
          seek.style.setProperty('--seek-progress', percentage);
        for (const [key, value] of [['min', '0'], ['max', editable ? String(durationMs) : '1'],
          ['value', editable ? String(progress) : '0']] as const)
          if (seek[key] !== value) seek[key] = value;
        const spoken = editable ? `${format(elapsed)} af ${format(total)}` : '';
        if (seek.getAttribute('aria-valuetext') !== spoken) seek.setAttribute('aria-valuetext', spoken);
      }
      this.set(rail, 'value', known ? String(progress) : '0');
      this.set(rail, 'max', known ? String(durationMs) : '1');
      this.set(rail, 'aria-label', label);
      this.set(`${prefix}-elapsed`, 'text', known ? format(elapsed) : '');
      this.set(`${prefix}-duration`, 'text', known ? format(total) : '');
      this.set(root, 'data-stale', String(known && vm.positionFresh !== true));
    }
    this.draw();
  }

  renderTimeline(): void {
    const vm = this.progressVM ?? {};
    if (this.host.live === true) {
      this.renderLiveProgress(vm);
      return;
    }
    if (this.seekDraft && !this.sameSeek(this.seekDraft.witness, this.seekState(vm)?.witness)) this.seekDraft = null;
    this.paintProgress(this.seekDraft ? {...vm, progressMs: this.seekDraft.progressMs} : vm, this.seekControl);
  }

  renderLiveProgress(vm: PlayerModel): void {
    const state = this.seekState(vm);
    if (this.seekGesture && !this.sameSeek(this.seekGesture.witness, state?.witness)) this.seekGesture.witness = null;
    if (this.seekDraft && !this.sameSeek(this.seekDraft.witness, state?.witness)) this.seekDraft = null;
    const chosen = this.seekDraft?.progressMs ?? state?.positionMs;
    const paint = (observed: number | null | undefined, fresh: boolean, interpolated = false) => {
      this.paintProgress({...vm, canSeek: !!state, progressMs: chosen ?? observed, positionFresh: fresh,
        interpolatedPosition: chosen == null && interpolated}, this.seekControl);
    };
    const anchor = vm.positionAnchor, now = Date.now();
    const progressMs = vm.progressMs ?? NaN, durationMs = vm.durationMs ?? NaN;
    const eligible = this.host.live === true && !this.suspended && this.host.isConnected !== false &&
      this.host.liveTransport?.connected !== false && vm.active === true && vm.playing === true && vm.fresh === true &&
      vm.positionFresh === true && vm.examplePosition !== true && Number.isSafeInteger(progressMs) && progressMs >= 0 &&
      Number.isSafeInteger(durationMs) && durationMs > 0 && progressMs <= durationMs &&
      !!anchor && Number.isFinite(anchor.observedAt) && anchor.observedAt <= now && Number.isFinite(anchor.expiresAt) &&
      anchor.expiresAt > anchor.observedAt;
    const key = eligible
      ? JSON.stringify([anchor.key, anchor.observedAt, anchor.expiresAt, progressMs, durationMs]) : null;
    if (this.progressClockKey !== key) {
      if (this.progressClockTimer) clearTimeout(this.progressClockTimer);
      this.progressClockTimer = null;
      this.progressClockKey = key;
    }
    if (!eligible) {
      const retained = this.progressDisplay, keep = !!retained && vm.active === true && vm.playing === true &&
        vm.positionFresh !== true && anchor?.key === retained.key && vm.progressMs === retained.sourceMs &&
        vm.durationMs === retained.durationMs;
      if (!keep) this.progressDisplay = null;
      paint(keep ? retained.displayMs : vm.progressMs, !keep && vm.positionFresh === true);
      return;
    }
    const fresh = now < anchor.expiresAt;
    const shown = Math.min(durationMs, progressMs + Math.max(0, Math.min(now, anchor.expiresAt) - anchor.observedAt));
    this.progressDisplay = {key: anchor.key, sourceMs: progressMs, durationMs, displayMs: shown};
    paint(shown, fresh, shown !== progressMs);
    if (!fresh || shown >= durationMs || this.doc.hidden) return;
    if (!this.progressClockTimer) {
      const timer = setTimeout(() => {
        if (this.progressClockKey !== key) return;
        this.progressClockTimer = null;
        if (this.progressVM) this.renderLiveProgress(this.progressVM);
      }, Math.min(1000, anchor.expiresAt - now));
      (timer as {unref?: () => void}).unref?.();
      this.progressClockTimer = timer;
    }
  }

  renderPlayer(vm: PlayerModel): void {
    this.batch(() => {
      this.paintPlayer(vm);
    });
  }

  private paintPlayer(vm: PlayerModel): void {
    const doc = this.doc, set = this.set.bind(this), host = this.host;
    set('now-playing-detail', 'hidden', true);
    this.progressVM = vm;
    this.updateCoverTone();
    this.renderTimeline();
    const radioSource = vm.sourceKind === 'radio';
    const feedback = radioSource ? '' : txt(vm.feedback?.message);
    const controlStatus = radioSource ? '' : txt(vm.controlStatus);
    const pending = vm.feedback?.pending === true, selection = String(!!feedback);
    if (host.dataset.selectionFeedback !== selection) host.dataset.selectionFeedback = selection;
    for (const [key, value] of [['role', 'status'], ['aria-live', 'polite'], ['aria-atomic', 'true']] as const)
      set('player-state', key, value);
    const playback = vm.active ? 'active' : 'empty';
    if (host.dataset.playback !== playback) host.dataset.playback = playback;
    const player = host.querySelector('.player') as HTMLElement;
    const empty = this.container('#player-empty'), detail = this.container('#music-detail');
    const placeholder = !vm.active && vm.loading === true, playerHidden = !vm.active, emptyFlag = String(placeholder);
    const busy = String(vm.loading === true || pending);
    const state = placeholder ? 'loading' : pending ? 'pending' : vm.emptyState || 'empty';
    const emptyBusy = String(placeholder || pending);
    if (player.dataset.readState !== (vm.emptyState || '')) player.dataset.readState = vm.emptyState || '';
    if (player.hidden !== playerHidden) player.hidden = playerHidden;
    if (player.dataset.empty !== emptyFlag) player.dataset.empty = emptyFlag;
    if (player.getAttribute('aria-busy') !== busy) player.setAttribute('aria-busy', busy);
    if (detail.getAttribute('aria-busy') !== busy) detail.setAttribute('aria-busy', busy);
    if (empty.hidden !== !!vm.active) empty.hidden = !!vm.active;
    if (empty.dataset.state !== state) empty.dataset.state = state;
    if (empty.getAttribute('aria-busy') !== emptyBusy) empty.setAttribute('aria-busy', emptyBusy);
    set('empty-copy', 'hidden', false);
    const choosingAccount = vm.emptyState === 'account-selection';
    const discoveryDisabled = choosingAccount ? vm.canChooseAccount !== true : vm.canDiscover !== true;
    const hideDiscovery = !choosingAccount && host.state?.focus === 'music';
    set('empty-find-label', 'text', choosingAccount ? 'Vælg musikkonto' : 'Vælg musik');
    set('empty-find-context', 'text', choosingAccount ? '' : discoveryPeriodLabel(Date.now()));
    set('empty-find-music', 'data-action', choosingAccount ? 'account' : 'music');
    set('empty-find-music', 'disabled', discoveryDisabled);
    set('empty-find-music', 'hidden', hideDiscovery);
    if (!vm.active) {
      const message = feedback || (placeholder ? 'Henter afspilningsstatus' : vm.emptyState === 'error'
        ? 'Afspilningen kunne ikke hentes.' : vm.emptyState === 'offline' ? 'Afspilningen kan ikke hentes offline.'
          : vm.empty || 'Vælg en stemning eller sang.');
      set('detail-title', 'text', 'Afspiller');
      set('detail-status', 'text', message);
      if (placeholder) for (const id of ['cover', 'detail-cover']) set(id, 'style.visibility', 'hidden');
      for (const id of ['track', 'player-detail']) set(id, 'disabled', true);
      for (const id of ['track-name', 'track-artist', 'detail-track', 'detail-artist']) set(id, 'text', '');
      if (!this.outputPlacement) for (const id of ['player-room', 'player-state']) set(id, 'text', '');
      set('detail-output-room', 'text', '');
      for (const id of this.outputPlacement ? ['detail-output'] : ['output', 'detail-output']) {
        set(id, 'disabled', true);
        set(id, 'aria-label', '');
      }
      this.draw();
      for (const id of ['cover', 'detail-cover']) this.artwork(doc.getElementById(id), {});
      this.renderControls({blocked: true});
      set('empty-copy', 'text', message);
      placeOutputHeader(this, vm);
      return;
    }
    placeOutputHeader(this, vm);
    set('track', 'aria-label', null);
    set('track', 'aria-description', 'Åbn afspiller');
    for (const id of ['cover', 'detail-cover']) set(id, 'style.visibility', '');
    for (const id of ['track', 'player-detail']) set(id, 'disabled', false);
    for (const id of ['track-name', 'detail-track']) set(id, 'text', txt(vm.title));
    const artist = (txt(vm.artist) || (radioSource ? 'Direkte radio' : '')) +
      (vm.exampleOnly === true && radioSource ? ' · ingen lyd' : '');
    for (const id of ['track-artist', 'detail-artist']) set(id, 'text', artist);
    const displayedTarget = txt(vm.selectedTarget) || txt(vm.target);
    set('player-room', 'text', displayedTarget);
    const previewLabel = vm.exampleOnly === true && radioSource ? txt(vm.previewLabel) : '';
    const connectionExplained = host.browserOffline === true || host.state?.connected === false ||
      ['offline', 'denied'].includes(host.connectionNotice?.state ?? '');
    const playingLabel = vm.placement === 'elsewhere' && !txt(vm.target) ? 'Spiller et andet sted' : 'Spiller på';
    const otherAccount = vm.placement === 'other-account';
    const readOnlyLabel = otherAccount ? OTHER_ACCOUNT : vm.fresh === false && !connectionExplained
      ? (vm.playing ? 'Ikke opdateret' : 'Ikke opdateret · på pause') : vm.playing ? playingLabel : 'På pause';
    const stateLabel = vm.selectedTarget ? 'Skifter til' : vm.readOnly
      ? [feedback, readOnlyLabel].filter(Boolean).join(' · ')
      : feedback || controlStatus || (vm.emptyState === 'error'
        ? (connectionExplained ? 'Forbindelsen mangler' : 'Status kunne ikke hentes')
        : vm.exampleOnly === true && radioSource ? '' : vm.fresh ? (vm.playing ? 'Spiller på' : '')
          : connectionExplained ? '' : 'Ikke opdateret');
    const detailLabel = vm.readOnly
      ? [feedback, otherAccount ? OTHER_ACCOUNT : vm.fresh === false && !connectionExplained
        ? 'Afspilningen er ikke opdateret' : vm.playing ? (vm.placement === 'elsewhere'
          ? (txt(vm.target) ? `Spiller på ${txt(vm.target)}` : 'Spiller et andet sted') : '') : 'På pause']
        .filter(Boolean).join(' · ')
      : feedback || controlStatus || (vm.emptyState === 'error'
        ? (connectionExplained ? 'Forbindelsen mangler' : 'Status kunne ikke hentes')
        : vm.exampleOnly === true && radioSource ? '' : vm.fresh ? '' : connectionExplained ? ''
          : 'Afspilningen er ikke opdateret');
    set('player-state', 'data-routine-output', String(['Spiller på', 'På pause'].includes(stateLabel)));
    set('player-state', 'text', stateLabel);
    set('detail-title', 'text', 'Afspiller');
    set('detail-status', 'text', detailLabel);
    for (const id of ['player-state', 'detail-status']) set(id, 'hidden', radioSource);
    set('detail-output-room', 'text', displayedTarget);
    for (const id of ['output', 'detail-output']) {
      const label = [
        id === 'output' ? stateLabel || (vm.exampleOnly === true && radioSource ? previewLabel
          : vm.fresh && !vm.playing ? 'På pause' : '') : '',
        vm.selectedTarget ? `Valgt: ${txt(vm.selectedTarget)} · skifter højttaler` : txt(vm.target),
        vm.canOutput ? (vm.targetPending ? 'Vælg højttaler' : vm.readOnly
          ? (vm.placement === 'elsewhere' && txt(vm.configuredTarget) ? `Flyt til ${txt(vm.configuredTarget)}`
            : 'Vælg højttaler')
          : (vm.selectedTarget ? 'Afventer bekræftelse' : vm.fresh ? 'Aktuelt output' : 'Seneste output')
            + ' · Vælg højttaler')
          : '',
      ].filter(Boolean).join(' · ');
      set(id, 'disabled', !vm.canOutput);
      set(id, 'aria-label', label);
    }
    const room = txt(vm.configuredTarget);
    const away = vm.readOnly === true && vm.placement === 'elsewhere';
    const other = vm.readOnly === true && vm.placement === 'other-account';
    const placement = away ? 'elsewhere' : other ? 'other-account' : 'room';
    if (player.dataset.placement !== placement) player.dataset.placement = placement;
    const kind = radioSource ? 'radio' : 'music';
    if (player.dataset.sourceKind !== kind) player.dataset.sourceKind = kind;
    // f) Own music on another device (lærred »Player-AndenEnhed«): one primary "Flyt til <rum>" at the bottom of
    // the card does what the chip does; it says "Flytter til <rum>…" until the room plays it.
    // Anden konto (lærred »Player-AndenKonto«): the same bottom button starts own music instead.
    const hidden = other ? vm.canDiscover !== true : !(away && room && vm.canOutput);
    const moving = !other && !hidden && !!vm.selectedTarget;
    set('move-here', 'data-action', other ? 'music' : 'move');
    set('move-here-icon', 'src', `assets/icons/${other ? 'music-note-beamed' : 'speaker-output'}.svg`);
    set('move-here', 'hidden', hidden);
    set('move-here', 'data-pending', String(moving));
    set('move-here-label', 'text', other ? 'Vælg musik' : moving ? `Flytter til ${room}…` : `Flyt til ${room}`);
    // Radio's live state (lærred »Player-Radio«): starting, playing live or stopped.
    const radio = radioSource, phase = vm.loading === true ? 'starting' : vm.playing ? 'live' : 'stopped';
    set('radio-live', 'hidden', !radio);
    set('radio-live', 'data-phase', phase);
    set('radio-live-word', 'text', {starting: 'Forbinder', live: 'Direkte', stopped: 'Stoppet'}[phase]);
    const icon = `assets/icons/${vm.playing ? (radioSource ? 'stop' : 'pause') : 'play'}-fill.svg`;
    for (const id of ['play-icon', 'detail-play-icon']) set(id, 'src', icon);
    this.draw();
    for (const id of ['cover', 'detail-cover']) this.artwork(doc.getElementById(id), vm);
  }

  // A range gesture belongs to the source that was visible at its first input.
  // It may never be retargeted by a later radio/music ownership transition.
  bindVolumeInput(input: HTMLInputElement): void {
    if (this.volumeInputListeners.has(input)) return;
    const listeners: Record<string, EventListener> = {
      pointerdown: () => {
        this.beginVolumeGesture(input, 'pointer');
      },
      keydown: event => {
        const key = (event as KeyboardEvent).key;
        if (!(event as KeyboardEvent).repeat && KEYS.includes(key)) this.beginVolumeGesture(input, 'key');
      },
      input: () => {
        if (!this.volumeGestures.has(input)) this.beginVolumeGesture(input, 'input');
      },
      change: () => {
        this.commitVolumeInput(input);
      },
      pointerup: () => {
        const witness = this.volumeGestures.get(input);
        if (witness?.mode === 'pointer')
          this.volumeGestures.set(input, Object.freeze({...witness, pointerHeld: false}));
      },
      pointercancel: () => {
        this.volumeGestures.delete(input);
      },
      blur: () => {
        this.volumeGestures.delete(input);
      },
      keyup: () => {
        this.volumeGestures.delete(input);
      },
    };
    for (const [type, listener] of Object.entries(listeners)) input.addEventListener(type, listener);
    this.volumeInputListeners.set(input, listeners);
  }

  beginVolumeGesture(input: HTMLInputElement, mode = 'pointer'): VolumeWitness | null {
    if (this.host.live !== true || input.disabled) return null;
    const binding = this.volumeBinding();
    if (!binding) return null;
    const sourceKind = this.host.liveRadio?.ownsPlayer?.() ? 'radio' : 'music';
    const witness: VolumeWitness = Object.freeze({binding, sourceKind,
      transport: this.host.liveTransport, transportGeneration: this.host.liveTransport?.generation, mode,
      pointerHeld: mode === 'pointer'});
    this.volumeGestures.set(input, witness);
    return witness;
  }

  volumeGestureCurrent(witness: VolumeWitness | null | undefined): boolean {
    const h = this.host;
    if (!witness || h.live !== true || !h.isConnected || !h.liveTransport?.connected ||
      witness.transport !== h.liveTransport || witness.transportGeneration !== h.liveTransport.generation ||
      witness.binding !== this.volumeBinding() ||
      witness.sourceKind !== (h.liveRadio?.ownsPlayer?.() ? 'radio' : 'music'))
      return false;
    return witness.sourceKind === 'radio' ? h.liveRadio?.can?.('volume') === true
      : h.liveControls?.player?.can('volume') === true;
  }

  commitVolumeInput(input: HTMLInputElement): boolean {
    if (this.host.live !== true) return false;
    const witness = this.volumeGestures.get(input) ?? this.beginVolumeGesture(input, 'change');
    if (witness?.mode !== 'key') this.volumeGestures.delete(input);
    if (input.disabled || !this.volumeGestureCurrent(witness)) {
      this.host.liveMedia?.render?.();
      return false;
    }
    this.host.music({type: 'volume', value: input.value, volumeSource: witness});
    return true;
  }

  volumeBinding(): string {
    const h = this.host;
    if (h.live && h.liveRadio?.ownsPlayer?.()) {
      if (!h.liveRadio.hasSource?.()) return '';
      const r = h.liveRadio.value, s = r?.state;
      return JSON.stringify(['radio', r?.bootId, r?.roomId, r?.ownerProcessId, s?.targetId, s?.ownerGeneration]);
    }
    if (h.live) {
      const p = h.liveMedia?.playback, s = h.liveSnapshot;
      if (!p || !s) return '';
      return roomObservationDisplay(p, s) ? JSON.stringify(['room-player', s.bootId, s.roomId, p.config_entry_id]) : '';
    }
    const s = h.state, p = s?.music?.playback;
    return p ? JSON.stringify([s.sessionId, p.accountId, p.kind, p.targetId, p.room]) : '';
  }

  syncVolumeMute(vm: VolumeModel): void {
    if (!this.volumeMute) return;
    const binding = this.volumeBinding();
    if (binding !== this.volumeMuteBinding) {
      this.volumeMuteBinding = binding;
      this.volumeRestore = null;
      this.volumeMuteRequest = null;
    }
    const volume = vm.volume ?? NaN;
    const known = Number.isInteger(volume) && volume >= 0 && volume <= 100, muted = known && volume === 0;
    if (known && volume > 0 && binding) this.volumeRestore = volume;
    if (this.volumeMuteRequest && known && volume !== this.volumeMuteRequest.from) this.volumeMuteRequest = null;
    this.volumeMuteVM = vm;
    const restore = this.volumeRestore;
    const localPending = this.host.live !== true && !!this.host.state?.music?.pending;
    const allowed = !!binding && known && !vm.blocked && !localPending &&
      vm.canVolume === true && (vm.min ?? 0) === 0 &&
      (!muted || (restore !== null && Number.isInteger(restore) && restore > 0 && restore <= (vm.max ?? 100)));
    this.set('volume-mute', 'disabled', !allowed || !!this.volumeMuteRequest);
    this.set('volume-mute', 'aria-pressed', String(muted));
    this.set('volume-mute', 'aria-label', muted ? 'Slå lyden til' : 'Slå lyden fra');
    this.set('volume-mute-icon', 'src', `assets/icons/${muted ? 'volume-mute' : 'volume-up-fill'}.svg`);
    this.draw();
  }

  toggleVolumeMute(): void {
    const button = this.volumeMute, vm = this.volumeMuteVM;
    if (!button || button.disabled || !vm || this.volumeBinding() !== this.volumeMuteBinding) return;
    const value = vm.volume === 0 ? this.volumeRestore : 0;
    if (value === null || !Number.isInteger(value)) return;
    this.volumeMuteRequest = {from: vm.volume, value};
    this.set('volume-mute', 'disabled', true);
    this.draw();
    this.host.music({type: 'volume', value});
  }

  renderRadioProgress(progress: {kind?: string} | null | undefined): void {
    for (const id of ['output', 'detail-output']) {
      const button = this.doc.getElementById(id) as HTMLButtonElement | null;
      if (button && (progress?.kind === 'output' || button.dataset.radioProgress === 'true')) {
        const loading = progress?.kind === 'output' && id === 'output';
        applyKitComponent(button, 'button', {feedback: 'progress', loading});
        button.dataset.radioProgress = String(loading);
        if (loading) button.disabled = true;
      }
    }
  }

  renderControls(vm: PlayerControlsModel & VolumeModel): void {
    renderPlayerControls(this.host, vm);
    if (this.host.playerView !== this) this.syncVolumeMute(vm);
    const toggle = this.doc.getElementById('play-pause') as HTMLButtonElement | null;
    for (const row of this.rows.values()) if (row.queueItem?.current) row.disabled = toggle?.disabled ?? false;
  }

  private bindRow(row: QueueRow): void {
    if (this.rowsBound.has(row)) return;
    this.rowsBound.add(row);
    let pressed: QueueItem | null = null;
    row.addEventListener('pointerdown', () => {
      pressed = row.queueItem?.queueTaskId ? row.queueItem : null;
    });
    row.addEventListener('pointercancel', () => {
      pressed = null;
    });
    row.addEventListener('keydown', event => {
      if (!event.repeat && ['Enter', ' '].includes(event.key))
        pressed = row.queueItem?.queueTaskId ? row.queueItem : null;
    });
    row.addEventListener('click', () => {
      const item = row.queueItem, original = pressed;
      pressed = null;
      if (original && (original.queueTaskId !== item?.queueTaskId || original.id !== item?.id ||
        original.uri !== item.uri)) return;
      if (item?.current) {
        const toggle = this.doc.getElementById('play-pause') as HTMLButtonElement | null;
        if (toggle && !toggle.disabled) toggle.click();
      } else if (!row.disabled && item?.selectable) this.chooseQueue(item);
    });
  }

  renderQueue(input: QueueItem[], {status = 'ready', empty = 'Ingen sange i køen.', sourceKind = 'music',
    errorKind = null, placeholders = false}: QueueOptions = {}): void {
    const set = this.set.bind(this);
    if (this.host.liveRadio?.pendingStart?.() && this.host.liveRadio.presentsPlayer?.() !== false) {
      set('queue-title', 'hidden', true);
      set('queue', 'hidden', true);
      for (const key of this.rows.keys()) set(`row:${key}`, 'disabled', true);
      this.draw();
      return;
    }
    let items = input.filter(item => typeof item.title === 'string' && !!item.title.trim());
    const current = this.progressVM;
    if (this.host.live && sourceKind !== 'radio' && current?.active && current.fresh && !current.readOnly &&
      current.metadataKnown !== false && current.uri && !items.some(item => item.current)) {
      items = [{id: `current:${current.uri}`, uri: current.uri, title: current.title, artist: current.artist,
        artwork: current.artwork, order: 0, current: true, playing: current.playing === true, selectable: false},
      ...items];
    }
    const hidden = sourceKind === 'radio';
    set('queue-title', 'hidden', hidden);
    set('queue', 'hidden', hidden);
    // Musik-Koe: the title is always »Kø«; the line beside it says »N numre · <højttaler>« or the queue's state.
    const speaker = txt(this.doc.getElementById('player-room')?.textContent);
    const stateLine = status === 'error'
      ? (errorKind === 'choice' ? 'Køvalget blev afvist' : 'Køen kunne ikke hentes')
      : status === 'unknown' ? 'Afspilning ikke bekræftet' : status === 'stale' ? 'Køen er ikke opdateret' : '';
    const countLine = status === 'loading' || !items.length ? ''
      : [`${String(items.length)} ${items.length === 1 ? 'nummer' : 'numre'}`, speaker].filter(Boolean).join(' · ');
    set('queue-meta', 'text', stateLine || countLine);
    set('queue-meta', 'hidden', hidden);
    const label = status === 'stale' ? 'Køen er ikke opdateret' : status === 'error'
      ? (errorKind === 'choice' ? 'Køvalget blev afvist' : 'Køen kunne ikke opdateres') : 'Kø';
    set('queue-title', 'text', 'Kø');
    set('queue', 'data-status', status);
    set('queue', 'aria-busy', String(['loading', 'pending'].includes(status)));
    set('queue', 'aria-label', label);
    const key = (item: QueueItem) => item.displayId ?? item.id;
    const signature = JSON.stringify([placeholders && status === 'loading',
      ...items.map(item => [key(item), item.current === true])]);
    const changed = this.queueSignature !== undefined && this.queueSignature !== signature;
    this.queueSignature = signature;
    this.draw();
    const apply = () => {
      this.applyQueue(items, status, empty, placeholders);
    };
    // P4 (docs/MOTION.md §3.5): a change of membership, order or the current row runs as one list motion: new
    // rows enter, removed rows leave, the rest slide on the spring, and the playing indicator travels as one.
    if (changed && this.host.isConnected !== false)
      animateList(this.queue, apply, {items: ':scope>.queue-track:not([data-placeholder])', track: '.queue-eq'});
    else apply();
  }

  private applyQueue(items: QueueItem[], status: string, empty: string, placeholders: boolean): void {
    const set = this.set.bind(this), toggle = this.doc.getElementById('play-pause') as HTMLButtonElement | null;
    const wanted = new Set(items.map(item => item.displayId ?? item.id)), shapes: QueueRowShape[] = [];
    for (const item of items) {
      const displayKey = item.displayId ?? item.id, row = `row:${displayKey}`;
      const pending = !item.current && item.pending === true;
      set(row, 'aria-busy', pending ? 'true' : null);
      const disabled = item.current ? toggle?.disabled ?? false : item.selectable !== true;
      const aria = `${item.current ? (item.playing === true ? 'Spiller nu:' : item.playing === false ? 'På pause:'
        : 'Aktuelt nummer:') : pending ? 'Starter:' : item.selectable ? 'Afspil' : 'Kun visning:'} ${[
        item.current ? '' : String(item.order), txt(item.title), txt(item.artist)].filter(Boolean).join(' · ')}`;
      set(row, 'data-current', String(item.current === true));
      set(row, 'data-playback', item.current
        ? (item.playing === true ? 'playing' : item.playing === false ? 'paused' : 'unknown') : 'upcoming');
      set(row, 'aria-current', item.current ? 'true' : null);
      set(`${row}:slot`, 'aria-label', item.current ? (item.playing === true ? 'Spiller nu' : item.playing === false
        ? 'På pause' : 'Aktuelt nummer') : 'Placering');
      set(row, 'data-revision', String(item.revision as string | number | null | undefined ?? ''));
      set(row, 'disabled', disabled);
      set(row, 'aria-label', item.current && typeof item.playing === 'boolean'
        ? `${aria} · ${item.playing ? 'Sæt på pause' : 'Fortsæt'}` : aria);
      const slot = item.current ? (item.playing === true ? 'eq' : 'icon') : 'text';
      if (slot === 'icon')
        set(`${row}:icon`, 'src', `assets/icons/${item.playing === false ? 'pause-fill' : 'music-note-beamed'}.svg`);
      if (slot === 'text') set(`${row}:slot`, 'text', String(item.order));
      set(`${row}:play`, 'src', `assets/icons/${item.current && item.playing ? 'pause' : 'play'}-fill.svg`);
      set(`${row}:title`, 'text', txt(item.title));
      set(`${row}:artist`, 'text', txt(item.artist));
      shapes.push({key: displayKey, slot});
    }
    for (const [id, element] of this.rows) {
      if (wanted.has(id)) continue;
      const cover = element.children[1];
      if (cover) cancelArtwork(cover);
      this.rows.delete(id);
      for (const part of ['', ':slot', ':icon', ':play', ':title', ':artist']) this.paint.drop(`row:${id}${part}`);
    }
    // Loading keeps the list's height: four empty rows of the real row anatomy, hidden from assistive
    // technology and never queue items, instead of an empty list or spinner text (K2/K4).
    const loadingRows = placeholders && status === 'loading' && !items.some(item => !item.current);
    const emptyText = status !== 'loading' && !items.some(item => !item.current) && empty ? empty : '';
    if (emptyText) set('queue-empty', 'text', emptyText);
    this.roots.queue = {rows: shapes, placeholders: loadingRows, empty: !!emptyText};
    this.draw();
    for (const item of items) {
      const displayKey = item.displayId ?? item.id, row = this.paint.element(`row:${displayKey}`) as QueueRow;
      this.bindRow(row);
      row.queueItem = item;
      this.rows.set(displayKey, row);
      this.artwork(row.children[1], item);
    }
    if (loadingRows)
      this.placeholders = [0, 1, 2, 3].map(n => this.paint.element(`placeholder:${String(n)}`) as HTMLButtonElement);
    if (emptyText) this.empty = this.paint.element('queue-empty') as HTMLParagraphElement;
  }

  // A revoked room: the queue's rows are gone at once (the live media view's invalidate). The next renderQueue
  // draws whatever the new room has, without a list motion from the old rows.
  clearQueue(): void {
    for (const id of this.rows.keys())
      for (const part of ['', ':slot', ':icon', ':play', ':title', ':artist']) this.paint.drop(`row:${id}${part}`);
    this.rows.clear();
    this.roots.queue = {rows: [], placeholders: false, empty: false};
    this.draw();
  }

  resume(): void {
    if (!this.suspended || this.host.isConnected === false) return;
    this.suspended = false;
    for (const id of ['volume', 'detail-volume']) {
      const input = this.doc.getElementById(id);
      if (input instanceof HTMLInputElement) this.bindVolumeInput(input);
    }
    if (this.volumeMuteClick) this.volumeMute?.addEventListener('click', this.volumeMuteClick);
    this.doc.getElementById('cover')?.addEventListener('load', this.coverToneLoad);
    this.doc.getElementById('cover')?.addEventListener('error', this.coverToneLoad);
    const root = this.doc.getElementById('player-progress');
    if (this.seekControl && root && this.seekControl.parentNode !== root)
      root.insertBefore(this.seekControl, this.doc.getElementById('player-progress-meter'));
  }

  cleanup(): void {
    for (const [input, listeners] of this.volumeInputListeners)
      for (const [type, listener] of Object.entries(listeners)) input.removeEventListener(type, listener);
    this.volumeInputListeners.clear();
    this.volumeGestures.clear();
    if (this.progressClockTimer) clearTimeout(this.progressClockTimer);
    this.progressClockTimer = null;
    this.progressClockKey = null;
    this.progressDisplay = null;
    this.suspended = true;
    if (this.volumeMuteClick) this.volumeMute?.removeEventListener('click', this.volumeMuteClick);
    this.volumeRestore = null;
    this.volumeMuteRequest = null;
    this.volumeMuteVM = null;
    if (this.coverToneRequest) {
      this.coverToneRequest.image.onload = null;
      this.coverToneRequest.image.onerror = null;
      this.coverToneRequest.image.removeAttribute('src');
      this.coverToneRequest = null;
    }
    this.doc.getElementById('cover')?.removeEventListener('load', this.coverToneLoad);
    this.doc.getElementById('cover')?.removeEventListener('error', this.coverToneLoad);
    this.coverTones.clear();
    this.seekDraft = null;
    this.seekGesture = null;
    this.progressVM = null;
    this.sourceFocus = null;
    this.seekControl?.remove();
    const rows = [...this.rows.values(), ...(this.placeholders ?? [])].map(row => row.children[1]);
    for (const node of [this.doc.getElementById('cover'), this.doc.getElementById('detail-cover'), ...rows])
      if (node) cancelArtwork(node);
  }
}
