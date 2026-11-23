// The player: the card on Home (aside.player), its empty state (#player-empty) and the full player with the queue
// (#music-detail). The shell mounts the three once (mountPlayer); React owns everything inside them and the
// containers' own state (hidden, busy, placement, the cover tone). They read one shown model: radio's while radio
// holds the player (screens/radio/source.ts), else what the music owner published (room-player.ts or the local
// preview scene). Same elements, ids, classes, kit attributes and aria as the pre-React player-view.js, so the stage
// stylesheet applies unchanged. Taps go to the shell through the player's ports (store.ts).
import {useQuery, skipToken} from '@tanstack/react-query';
import {AnimatePresence, motion, useIsPresent} from 'motion/react';
import type {ReactNode} from 'react';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {useShallow} from 'zustand/shallow';
import {mountScreen} from '../../app/mount';
import {TRANSITION} from '../../lib/motion/tokens';
import {useReducedMotion} from '../../lib/motion/reduced';
import {useNow, useRefreshAt} from '../../lib/hooks/clock';
import {useShell} from '../../lib/store/shell';
import type {RadioSource} from '../radio/source';
import {Artwork} from './Artwork';
import {playerFaces, progressFaces, queueFaces, queueRowFaces, transportFaces, volumeKnown} from './presentation';
import type {PlayerFaces} from './presentation';
import {roomPlayerKey} from './room-player';
import {beginVolumeGesture, commitVolume, endVolumeGesture, noteVolume, radioPlayerModel, releaseVolumePointer,
  sameSeek, seekState, toggleMute, useMute, volumeBinding, volumeGestureCurrent, volumeWitness} from './session';
import {usePlayer} from './store';
import type {ControlsModel, PlayerModel, QueueItem, SeekWitness} from './types';

const EMPTY_RADIO = createStore(() => ({}));

interface Shown {
  model: PlayerModel;
  controls: ControlsModel;
  live: boolean;
  radio: RadioSource | null;
  // Radio's speaker-button progress (a move or start on its way to a chosen speaker).
  outputLoading: boolean;
}

// The model on screen. Radio's derivations read its store, the room player's observation and the session; the
// component subscribes to all three and re-derives.
function useShown(): Shown {
  const {model, controls, host} = usePlayer(useShallow(state => ({model: state.model, controls: state.controls,
    host: state.host, revision: state.revision})));
  useQuery({queryKey: roomPlayerKey, queryFn: skipToken});
  const radio = host.live ? host.liveRadio ?? null : null;
  const signature = useStore((radio ?? EMPTY_RADIO), () => {
    if (!radio) return '';
    const shown = radioPlayerModel();
    const progress = !radio.presentsPlayer() || radio.pendingStart() ? null : radio.progress();
    return JSON.stringify([shown, shown ? radio.controls() : null, progress?.kind === 'output', volumeBinding()]);
  });
  const [radioModel, radioControls, outputLoading] = signature
    ? JSON.parse(signature) as [PlayerModel | null, ControlsModel | null, boolean] : [null, null, false];
  return {model: radioModel ?? model, controls: radioModel && radioControls ? radioControls : controls,
    live: host.live === true, radio, outputLoading};
}

// A container the shell owns (found by its selector), with the state this component draws on it: attributes, custom
// properties, hidden, and the kit's card recipe.
function useContainer(selector: string, attributes: Record<string, string>, hidden?: boolean,
  properties: Record<string, string> = {}, card = false) {
  useLayoutEffect(() => {
    const node = globalThis.document.querySelector<HTMLElement>(selector);
    if (!node) return;
    if (card && !node.classList.contains('pv-card')) {
      node.classList.add('pv-kit', 'pv-kit-card', 'pv-card');
      node.dataset.kit = 'card';
    }
    for (const [name, value] of Object.entries(attributes))
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    for (const [name, value] of Object.entries(properties))
      if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    if (hidden !== undefined && node.hidden !== hidden) node.hidden = hidden;
  });
}

const ports = () => usePlayer.getState().ports;

// ---------------------------------------------------------------------------------------------------------------
// Transport

interface TransportProps {
  controls: ControlsModel;
  prefix: 'card' | 'detail';
  icon: string;
}

function Transport({controls, prefix, icon}: TransportProps) {
  const faces = transportFaces(controls), ring = usePlayer(state => state.busy.ring);
  const detail = prefix === 'detail';
  const ids = detail ? {previous: 'detail-previous', toggle: 'detail-toggle', next: 'detail-next'}
    : {previous: 'previous', toggle: 'play-pause', next: 'next'};
  const radioLoading = (id: string) => faces.radio && (controls.loadingControlId === id ||
    controls.loadingControlId === 'play-pause' && id === 'detail-toggle');
  const busy = (id: string, action: string, disabled: boolean) => faces.radio ? radioLoading(id)
    : !disabled && (ring === action || action === 'toggle' && (ring === 'pause' || ring === 'resume'));
  const tap = (event: Record<string, unknown>, id: string) => {
    ports().music(faces.radio && event.type === 'toggle' ? {...event, controlId: id} : event);
  };
  return (
    <>
      <button
        id={ids.previous}
        type="button"
        className="round pv-kit pv-kit-button pv-btn"
        aria-label="Forrige nummer"
        data-kit="button"
        hidden={faces.skipHidden}
        disabled={faces.previousDisabled}
        aria-busy={busy(ids.previous, 'previous', faces.previousDisabled)}
        onClick={() => {
          tap({type: 'skip', delta: -1}, ids.previous);
        }}
      >
        <img src="assets/icons/skip-start-fill.svg" alt="" />
      </button>
      <button
        id={ids.toggle}
        type="button"
        className="round main-control pv-kit pv-kit-button pv-btn"
        aria-label={faces.toggleLabel}
        data-kit="button"
        {...(faces.radio ? {'data-kit-variant': 'icon', 'data-feedback': 'progress'} : {})}
        disabled={faces.toggleDisabled}
        aria-busy={busy(ids.toggle, 'toggle', faces.toggleDisabled)}
        onClick={() => {
          tap({type: 'toggle'}, ids.toggle);
        }}
      >
        <img id={detail ? 'detail-play-icon' : 'play-icon'} src={icon} alt="" />
      </button>
      <button
        id={ids.next}
        type="button"
        className="round pv-kit pv-kit-button pv-btn"
        aria-label="Næste nummer"
        data-kit="button"
        hidden={faces.skipHidden}
        disabled={faces.nextDisabled}
        aria-busy={busy(ids.next, 'next', faces.nextDisabled)}
        onClick={() => {
          tap({type: 'skip', delta: 1}, ids.next);
        }}
      >
        <img src="assets/icons/skip-end-fill.svg" alt="" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Progress and seek

const TICK_MS = 1000;

interface Anchor {
  key: string;
  sourceMs: number;
  durationMs: number;
  observedAt: number;
  expiresAt: number;
  // When the position stopped being fresh: the shown value stays where it was then.
  heldAt: number | null;
}

type Span = Pick<Anchor, 'sourceMs' | 'durationMs' | 'observedAt' | 'expiresAt'>;
const moved = (from: Span, at: number) =>
  Math.min(from.durationMs, from.sourceMs + Math.max(0, Math.min(at, from.expiresAt) - from.observedAt));

// The position on screen: a seek draft, the room player's seek wish, or the observed position moved on by the clock
// while the observation is fresh (a display value only: interpolation never grants a seek). When the observation
// stops being fresh the moved-on value stays where it was (no hop back to the old reading).
function useShownPosition(vm: PlayerModel, live: boolean, draft: number | null): PlayerModel {
  const state = seekState(vm), now = useNow();
  const chosen = draft ?? state?.positionMs ?? null;
  const [anchored, setAnchored] = useState<Anchor | null>(null);
  const connected = usePlayer(s => s.host.isConnected !== false && s.host.liveTransport?.connected !== false);
  const anchor = vm.positionAnchor;
  const progressMs = vm.progressMs ?? NaN, durationMs = vm.durationMs ?? NaN;
  const span = anchor && live && connected && vm.active === true && vm.playing === true && vm.fresh === true &&
    vm.positionFresh === true && vm.examplePosition !== true && Number.isSafeInteger(progressMs) && progressMs >= 0 &&
    Number.isSafeInteger(durationMs) && durationMs > 0 && progressMs <= durationMs &&
    Number.isFinite(anchor.observedAt) && anchor.observedAt <= now && Number.isFinite(anchor.expiresAt) &&
    anchor.expiresAt > anchor.observedAt
    ? {key: anchor.key, sourceMs: progressMs, durationMs, observedAt: anchor.observedAt, expiresAt: anchor.expiresAt}
    : null;
  const held = !span && !!anchored && vm.active === true && vm.playing === true && vm.positionFresh !== true &&
    anchor?.key === anchored.key && vm.progressMs === anchored.sourceMs && vm.durationMs === anchored.durationMs;
  if (span && (anchored?.key !== span.key || anchored.sourceMs !== span.sourceMs ||
    anchored.durationMs !== span.durationMs || anchored.observedAt !== span.observedAt ||
    anchored.expiresAt !== span.expiresAt || anchored.heldAt !== null)) setAnchored({...span, heldAt: null});
  else if (held && anchored.heldAt === null) setAnchored({...anchored, heldAt: now});
  else if (!span && !held && anchored) setAnchored(null);
  const display = span ? moved(span, now) : held ? moved(anchored, anchored.heldAt ?? now) : null;
  const fresh = !!span && now < span.expiresAt;
  const next = span && fresh && display !== null && display < durationMs
    ? now + Math.min(TICK_MS, span.expiresAt - now) : null;
  useRefreshAt(next);
  if (!live) return draft !== null ? {...vm, progressMs: draft} : vm;
  return {...vm, canSeek: !!state, progressMs: chosen ?? display ?? vm.progressMs,
    positionFresh: span ? fresh : !held && vm.positionFresh === true,
    interpolatedPosition: chosen === null && display !== null && display !== progressMs};
}

function Progress({vm, prefix, seek}: {vm: PlayerModel; prefix: 'player' | 'detail'; seek?: ReactNode;
  editable?: boolean}) {
  const faces = progressFaces(vm), editable = !!seek && faces.known && (vm.examplePosition === true ||
    vm.canSeek === true) && vm.sourceKind !== 'radio';
  return (
    <div id={`${prefix}-progress`} className="player-progress" hidden={!faces.known} data-stale={String(faces.stale)}>
      {seek}
      <progress
        id={`${prefix}-progress-meter`}
        max={String(faces.durationMs)}
        value={String(faces.progressMs)}
        aria-label={faces.label}
        hidden={editable}
      />
      <div className="player-progress-times">
        <span id={`${prefix}-elapsed`}>{faces.elapsed}</span>
        <span id={`${prefix}-duration`}>{faces.duration}</span>
      </div>
    </div>
  );
}

// A seek gesture's draft position, for the song it began on.
interface SeekDraft {
  witness: SeekWitness;
  positionMs: number;
}

// The draft still applies: the same song and grant as when the gesture began.
const draftFor = (draft: SeekDraft | null, vm: PlayerModel) =>
  draft && sameSeek(draft.witness, seekState(vm)?.witness) ? draft.positionMs : null;

// The card's seek range: a gesture keeps its draft until release; the release is one seek for the song it began on.
function Seek({vm, live, draft, setDraft}: {vm: PlayerModel; live: boolean; draft: SeekDraft | null;
  setDraft: (value: SeekDraft | null) => void}) {
  const faces = progressFaces(vm);
  const editable = faces.known && (vm.examplePosition === true || vm.canSeek === true) && vm.sourceKind !== 'radio';
  const gesture = useRef<{witness: SeekWitness | null | undefined} | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const range = ref.current;
    if (!range) return;
    const change = () => {
      const now = seekState(), witness = draft?.witness, positionMs = Number(range.value);
      gesture.current = null;
      setDraft(null);
      if (witness && sameSeek(witness, now?.witness))
        ports().seek(live ? {positionMs, witness} : {positionMs, trackId: witness.trackId,
          operation: witness.operation});
    };
    range.addEventListener('change', change);
    return () => {
      range.removeEventListener('change', change);
    };
  }, [live, draft, setDraft]);
  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };
  return (
    <input
      ref={ref}
      id="detail-seek"
      type="range"
      step="1000"
      min="0"
      max={editable ? String(faces.durationMs) : '1'}
      value={editable ? String(faces.progressMs) : '0'}
      hidden={!editable}
      disabled={!editable || vm.canSeek !== true}
      aria-label="Vælg afspilningsposition"
      aria-valuetext={editable ? `${faces.elapsed} af ${faces.duration}` : ''}
      style={{'--seek-progress': editable ? `${String(faces.progressMs / faces.durationMs * 100)}%` : '0%'} as
        Record<string, string>}
      onPointerDown={() => {
        gesture.current = {witness: seekState()?.witness};
      }}
      onChange={event => {
        const now = seekState(), positionMs = Number(event.currentTarget.value);
        if (!now || !Number.isSafeInteger(positionMs) || positionMs < 0 || positionMs > (vm.durationMs ?? -1) ||
          (gesture.current && !sameSeek(gesture.current.witness, now.witness))) return;
        setDraft({witness: now.witness, positionMs});
      }}
      onPointerUp={() => {
        gesture.current = null;
      }}
      onPointerCancel={cancel}
      onBlur={cancel}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Volume

const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

function Volume({controls, id, outputId, outputClass, label, labelText}: {controls: ControlsModel; id: string;
  outputId: string; outputClass?: string; label: string; labelText: string}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [last, setLast] = useState(35);
  const live = usePlayer(state => state.host.live === true);
  const volumeBusy = usePlayer(state => state.busy.volume);
  const ref = useRef<HTMLInputElement>(null);
  const radio = controls.sourceKind === 'radio', volume = controls.volume, known = volumeKnown(volume);
  const min = controls.min ?? 0, max = controls.max ?? 100;
  const disabled = (controls.volumeBlocked ?? controls.blocked) === true || !controls.canVolume || !known;
  // A draft belongs to its gesture's source: one that lost its owner or access shows the source's value again.
  const editing = draft !== null && known && (!live || !radio || volumeGestureCurrent(volumeWitness(id)));
  // An unknown volume leaves the range where it was.
  if (known && volume !== last) setLast(volume);
  const shown = editing ? draft : known ? volume : last;
  // The released value is one volume tap for the source the gesture began on.
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const change = () => {
      if (live) commitVolume(id, input.value, input.disabled);
      setDraft(null);
    };
    input.addEventListener('change', change);
    return () => {
      input.removeEventListener('change', change);
    };
  }, [id, live]);
  const progress = `${String(Math.max(0, Math.min(100, shown)))}%`;
  return (
    <>
      <label className="sr-only" htmlFor={id}>{labelText}</label>
      <input
        ref={ref}
        id={id}
        type="range"
        min="0"
        max="100"
        value={String(shown)}
        className="pv-kit pv-kit-slider pv-slider"
        data-kit="slider"
        aria-label={label}
        aria-valuetext={known ? `${String(shown)} %` : 'Ukendt lydstyrke'}
        aria-busy={!radio && volumeBusy}
        disabled={disabled}
        data-action-min={String(min)}
        data-action-max={String(max)}
        data-kit-value-known={String(known)}
        style={{'--pv-slider-progress': progress} as Record<string, string>}
        onPointerDown={() => {
          beginVolumeGesture(id, 'pointer');
        }}
        onKeyDown={event => {
          if (!event.repeat && KEYS.includes(event.key)) beginVolumeGesture(id, 'key');
        }}
        onChange={event => {
          if (!volumeWitness(id)) beginVolumeGesture(id, 'input');
          const attempted = Number(event.currentTarget.value);
          if (!live) {
            setDraft(attempted);
            ports().music({type: 'volume', value: event.currentTarget.value});
            return;
          }
          const witness = volumeWitness(id);
          if (witness && !volumeGestureCurrent(witness)) return;
          if (!Number.isInteger(attempted)) return;
          // The room player's own maximum: a higher value stops there and says so.
          const legal = radio ? attempted : Math.max(min, Math.min(max, attempted));
          if (legal !== attempted) ports().showFeedback(`Højst ${String(max)} %`, 'music-volume');
          setDraft(legal);
        }}
        onPointerUp={() => {
          releaseVolumePointer(id);
          if (!radio) setDraft(null);
        }}
        onPointerCancel={() => {
          endVolumeGesture(id);
          setDraft(null);
        }}
        onBlur={() => {
          endVolumeGesture(id);
          setDraft(null);
        }}
        onKeyUp={() => {
          endVolumeGesture(id);
        }}
      />
      <output id={outputId} htmlFor={id} {...(outputClass ? {className: outputClass} : {})}>
        {known ? `${String(shown)} %` : '—'}
      </output>
    </>
  );
}

// Mute: the last audible volume of this source comes back on unmute.
function Mute({controls}: {controls: ControlsModel}) {
  const localPending = usePlayer(state => !state.host.live && !!state.host.state?.music?.pending);
  const {binding, restore, request} = useMute();
  const volume = controls.volume, known = volumeKnown(volume), muted = known && volume === 0;
  useEffect(() => {
    noteVolume(volume);
  });
  const current = volumeBinding();
  const allowed = !!current && known && !(controls.volumeBlocked ?? controls.blocked) && !localPending &&
    controls.canVolume === true && (controls.min ?? 0) === 0 &&
    (!muted || (restore !== null && Number.isInteger(restore) && restore > 0 && restore <= (controls.max ?? 100)));
  return (
    <button
      id="volume-mute"
      type="button"
      className="volume-mute pv-kit pv-kit-button pv-btn"
      aria-label={muted ? 'Slå lyden til' : 'Slå lyden fra'}
      aria-pressed={muted}
      disabled={!allowed || !!request || binding !== current}
      data-kit="button"
      data-kit-variant="icon"
      onClick={() => {
        if (allowed) toggleMute(volume);
      }}
    >
      <img src={`assets/icons/${muted ? 'volume-mute' : 'volume-up-fill'}.svg`} alt="" />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The speaker chip

function OutputButton({faces, loading, kitTouched}: {faces: {disabled: boolean; label: string}; loading: boolean;
  kitTouched: boolean}) {
  const kit = kitTouched || loading;
  return {
    className: kit ? 'output pv-kit pv-kit-button pv-btn' : 'output',
    ...(kit ? {'data-kit': 'button', 'data-feedback': 'progress', 'aria-busy': loading} : {}),
    disabled: faces.disabled || loading,
    'aria-label': faces.label,
    'aria-haspopup': 'dialog' as const,
    'data-radio-progress': kit ? String(loading) : undefined,
  };
}

// Once radio has shown progress on a speaker button, it keeps the kit's progress anatomy (as before).
function useKitTouched(loading: boolean) {
  const [touched, setTouched] = useState(false);
  if (loading && !touched) setTouched(true);
  return touched || loading;
}

function SpeakerChip({faces, idle, loading}: {faces: PlayerFaces; idle: boolean; loading: boolean}) {
  const touched = useKitTouched(loading);
  const face = idle ? faces.idleOutput : faces.output;
  const props = OutputButton({faces: face, loading, kitTouched: touched});
  return (
    <button
      id="output"
      type="button"
      {...props}
      onClick={event => {
        ports().openSpeakers(event.currentTarget);
      }}
    >
      <h2 id="player-title">
        <span
          id="player-state"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          hidden={!idle && faces.stateHidden}
          data-routine-output={String(!idle && faces.routineOutput)}
        >
          {idle ? '' : faces.stateLabel}
        </span>
        <span className="output-room">
          <img src="assets/icons/speaker-output.svg" alt="" />
          <strong id="player-room">{idle ? faces.idleOutput.room : faces.room}</strong>
        </span>
      </h2>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The card on Home

function useCoverTone(active: boolean): [string, (image: HTMLImageElement | null) => void] {
  const [tone, setTone] = useState('transparent');
  const tones = useRef(new Map<string, string>());
  const onShown = useCallback((image: HTMLImageElement | null) => {
    const source = active && image && !image.classList.contains('live-art-fallback') ? image.currentSrc || image.src
      : null;
    if (!source) {
      setTone('transparent');
      return;
    }
    const known = tones.current.get(source);
    if (known !== undefined) {
      setTone(known);
      return;
    }
    const ImageClass = globalThis.Image as typeof Image | undefined;
    if (!ImageClass) return;
    const probe = new ImageClass();
    probe.crossOrigin = 'anonymous';
    probe.referrerPolicy = 'no-referrer';
    probe.onload = () => {
      const value = dominantTone(probe);
      if (tones.current.size >= 24) {
        const oldest = tones.current.keys().next().value;
        if (oldest !== undefined) tones.current.delete(oldest);
      }
      tones.current.set(source, value);
      setTone(value);
    };
    probe.onerror = () => {
      tones.current.set(source, 'transparent');
      setTone('transparent');
    };
    probe.src = source;
  }, [active]);
  return [active ? tone : 'transparent', onShown];
}

// The cover's dominant colour, faint, behind the card (an unreadable image keeps the neutral tone).
function dominantTone(picture: HTMLImageElement): string {
  try {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context || !picture.naturalWidth) return 'transparent';
    context.drawImage(picture, 0, 0, 8, 8);
    const pixels = context.getImageData(0, 0, 8, 8).data, buckets = new Map<string, number[]>();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] ?? 0, g = pixels[i + 1] ?? 0, b = pixels[i + 2] ?? 0, a = pixels[i + 3] ?? 0;
      if (a < 128) continue;
      const key = [r >> 5, g >> 5, b >> 5].join(','), bucket = buckets.get(key) ?? [0, 0, 0, 0];
      buckets.set(key, [(bucket[0] ?? 0) + 1, (bucket[1] ?? 0) + r, (bucket[2] ?? 0) + g, (bucket[3] ?? 0) + b]);
    }
    const dominant = [...buckets.values()].sort((x, y) => (y[0] ?? 0) - (x[0] ?? 0))[0];
    if (!dominant) return 'transparent';
    const n = dominant[0] ?? 1, channel = (index: number) => String(Math.round((dominant[index] ?? 0) / n));
    return `rgb(${channel(1)} ${channel(2)} ${channel(3)} / .12)`;
  } catch {
    return 'transparent';
  }
}

export function PlayerCard() {
  const shown = useShown(), focus = useShell(state => state.focus), now = useNow();
  const {model, controls, live, outputLoading} = shown;
  const [draft, setDraft] = useState<SeekDraft | null>(null);
  const position = useShownPosition(model, live, draftFor(draft, model));
  const faces = playerFaces(model, focus, now);
  const [tone, onCover] = useCoverTone(faces.active);
  const transportBusy = usePlayer(state => state.busy.transport && controls.sourceKind !== 'radio');
  useContainer('aside.player', {'data-read-state': faces.readState, 'data-empty': String(faces.placeholder),
    'aria-busy': String(faces.busy), 'data-placement': faces.placement, 'data-source-kind': faces.sourceKind},
  !faces.active, {'--pv-cover': tone, '--player-cover-tone': tone}, true);
  // The shell's own marks of the player (its stylesheet reads them).
  useLayoutEffect(() => {
    const data = (usePlayer.getState().host as {dataset?: DOMStringMap}).dataset;
    if (!data) return;
    if (data.selectionFeedback !== String(faces.selectionFeedback))
      data.selectionFeedback = String(faces.selectionFeedback);
    const playback = faces.active ? 'active' : 'empty';
    if (data.playback !== playback) data.playback = playback;
  });
  const openDetail = (event: {currentTarget: HTMLElement}) => {
    ports().openDetail(event.currentTarget);
  };
  return (
    <>
      <button
        id="track"
        type="button"
        className="track"
        aria-description={faces.active ? 'Åbn afspiller' : undefined}
        aria-label={faces.active ? undefined : 'Åbn afspilleren'}
        disabled={!faces.active}
        onClick={openDetail}
      >
        <strong id="track-name">{faces.title}</strong>
        <span id="track-artist">{faces.artist}</span>
      </button>
      <p id="radio-live" className="radio-live" hidden={faces.radioLive.hidden} data-phase={faces.radioLive.phase}>
        <i aria-hidden="true"></i>
        <span>{faces.radioLive.word}</span>
      </p>
      <button
        id="player-detail"
        type="button"
        className="cover-button"
        aria-label="Åbn afspilleren"
        disabled={!faces.active}
        onClick={openDetail}
      >
        <Artwork
          id="cover"
          className="cover"
          item={faces.active ? model : {}}
          style={faces.placeholder ? {visibility: 'hidden'} : {}}
          onShown={onCover}
        />
        <span className="cover-hint">
          <img src="assets/icons/chevron-up.svg" alt="" />
        </span>
      </button>
      <Progress
        vm={position}
        prefix="player"
        seek={<Seek vm={position} live={live} draft={draft} setDraft={setDraft} />}
      />
      <div className="transport" role="group" aria-label="Afspilningskontroller" aria-busy={transportBusy}>
        <Transport controls={controls} prefix="card" icon={faces.playIcon} />
      </div>
      {faces.active ? <SpeakerChip faces={faces} idle={false} loading={outputLoading} /> : null}
      <div className="volume">
        <Mute controls={controls} />
        <Volume
          controls={controls}
          id="volume"
          outputId="volume-value"
          outputClass="sr-only"
          label="Lydstyrke"
          labelText="Musikkens lydstyrke"
        />
      </div>
      <button
        id="move-here"
        className="move-here"
        type="button"
        hidden={faces.moveHere.hidden}
        data-action={faces.moveHere.action}
        data-pending={String(faces.moveHere.pending)}
        onClick={event => {
          ports().moveHere(event.currentTarget);
        }}
      >
        <span className="move-here-dots" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <img src={faces.moveHere.icon} alt="" />
        <span id="move-here-label">{faces.moveHere.label}</span>
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The empty card

export function EmptyCard() {
  const {model, outputLoading} = useShown(), focus = useShell(state => state.focus), now = useNow();
  // The shell decides whether Find musik can open now; until it says, the model's own rule applies.
  const findMusic = usePlayer(state => state.findMusic);
  const faces = playerFaces(model, focus, now);
  useContainer('#player-empty', {'data-state': faces.emptyState,
    'aria-busy': String(faces.placeholder || faces.pending)}, faces.active, {}, true);
  return (
    <>
      <div className="player-empty-art" aria-hidden="true">
        <img id="empty-cover" className="live-art-fallback" src="assets/icons/music-note-beamed.svg" alt="" />
      </div>
      <div className="player-empty-copy">
        {faces.active ? <h2>Musik</h2> : <SpeakerChip faces={faces} idle loading={outputLoading} />}
        <p role="status" aria-live="polite" aria-atomic="true">
          {faces.active ? 'Ingen musik spiller lige nu' : faces.message}
        </p>
      </div>
      <button
        id="empty-find-music"
        type="button"
        className="pv-kit pv-kit-button pv-btn"
        data-kit="button"
        data-kit-variant="secondary"
        data-action={faces.find.action}
        disabled={findMusic === null ? faces.find.disabled : !findMusic}
        hidden={faces.find.hidden}
        onClick={() => {
          ports().findMusic(faces.find.action);
        }}
      >
        {faces.find.label}
        <small className="empty-find-context">{faces.find.context}</small>
        <img src="assets/icons/chevron-right.svg" alt="" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The full player and the queue

function QueueRow({item, toggleDisabled}: {item: QueueItem; toggleDisabled: boolean}) {
  const faces = queueRowFaces(item), reduced = useReducedMotion(), present = useIsPresent();
  const pressed = useRef<QueueItem | null>(null);
  const disabled = item.current ? toggleDisabled : item.selectable !== true;
  // A removed row leaves where it stood: out of reach and out of the accessibility tree while it fades.
  const leaving = present ? {} : {'data-pv-leave': '', inert: true, 'aria-hidden': true,
    style: {pointerEvents: 'none' as const}};
  return (
    <motion.button
      layout={reduced ? false : 'position'}
      initial={reduced ? {opacity: 0} : {opacity: 0, y: 8}}
      animate={{opacity: 1, y: 0}}
      exit={reduced ? {opacity: 0} : {opacity: 0, scale: 0.98}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.smooth}
      type="button"
      className="queue-track pv-row pv-btn pv-kit pv-kit-listrow"
      data-kit="listrow"
      data-track-id={faces.key}
      data-current={String(item.current === true)}
      data-playback={faces.playback}
      data-revision={String(item.revision as string | number | null | undefined ?? '')}
      aria-current={item.current ? 'true' : undefined}
      aria-busy={faces.pending ? 'true' : undefined}
      aria-label={faces.label}
      disabled={disabled}
      {...leaving}
      onPointerDown={() => {
        pressed.current = item.queueTaskId ? item : null;
      }}
      onPointerCancel={() => {
        pressed.current = null;
      }}
      onKeyDown={event => {
        if (!event.repeat && ['Enter', ' '].includes(event.key)) pressed.current = item.queueTaskId ? item : null;
      }}
      onClick={() => {
        const original = pressed.current;
        pressed.current = null;
        // A row whose offer changed under the finger chooses nothing.
        if (original && (original.queueTaskId !== item.queueTaskId || original.id !== item.id ||
          original.uri !== item.uri)) return;
        if (item.current) {
          if (!toggleDisabled) ports().music({type: 'toggle'});
        } else if (!disabled && item.selectable) ports().chooseQueue(item);
      }}
    >
      <span className="queue-order" aria-label={faces.slotLabel}>
        {faces.slot === 'eq' ? (
          <motion.span layoutId="queue-eq" className="queue-eq">
            <i></i>
            <i></i>
            <i></i>
          </motion.span>
        ) : faces.slot === 'icon' ? (
          <img src={faces.icon} alt="" width="24" height="24" />
        ) : (
          String(item.order)
        )}
      </span>
      <Artwork className="queue-cover" item={item} />
      <span className="queue-copy">
        <strong>{typeof item.title === 'string' ? item.title : ''}</strong>
        <small>{typeof item.artist === 'string' ? item.artist : ''}</small>
      </span>
      <img className="queue-play" src={faces.playIcon} alt="" />
    </motion.button>
  );
}

// Loading keeps the list's height: empty rows of the real row anatomy, hidden from assistive technology.
function Placeholder({index}: {index: number}) {
  return (
    <button
      type="button"
      className="queue-track pv-row pv-btn pv-kit pv-kit-listrow"
      data-kit="listrow"
      data-track-id={`placeholder:${String(index)}`}
      data-placeholder="true"
      aria-hidden="true"
      tabIndex={-1}
      disabled
    >
      <span className="queue-order"></span>
      <img className="queue-cover" alt="" />
      <span className="queue-copy">
        <strong></strong>
        <small></small>
      </span>
      <img className="queue-play" src="assets/icons/play-fill.svg" alt="" />
    </button>
  );
}

function Queue({model, controls, live}: {model: PlayerModel; controls: ControlsModel; live: boolean}) {
  const {queue} = usePlayer(useShallow(state => ({queue: state.queue})));
  const focus = useShell(state => state.focus), now = useNow();
  const radioShown = model.sourceKind === 'radio';
  const pendingRadio = usePlayer(state => !!state.host.liveRadio?.pendingStart() &&
    state.host.liveRadio.presentsPlayer());
  const room = playerFaces(model, focus, now).room;
  const faces = queueFaces(queue.items, radioShown ? {...queue.options, sourceKind: 'radio'} : queue.options, model,
    live, room);
  const hidden = faces.hidden || pendingRadio;
  const toggleDisabled = transportFaces(controls).toggleDisabled;
  return (
    <section className="detail-queue" aria-labelledby="queue-title">
      <h2 id="queue-title" hidden={hidden}>Kø</h2>
      <p id="queue-meta" hidden={hidden}>{faces.meta}</p>
      <div id="queue" role="group" hidden={hidden} data-status={faces.status} aria-busy={faces.busy}
        aria-label={faces.label}>
        <AnimatePresence key={queue.epoch} initial={false} mode="popLayout">
          {faces.items.map(item => (
            <QueueRow key={item.displayId ?? item.id} item={item} toggleDisabled={toggleDisabled} />
          ))}
        </AnimatePresence>
        {faces.placeholders ? [0, 1, 2, 3].map(index => <Placeholder key={index} index={index} />) : null}
        {faces.empty ? <p className="queue-empty">{faces.empty}</p> : null}
      </div>
    </section>
  );
}

export function PlayerDetail() {
  const {model, controls, live, outputLoading} = useShown(), focus = useShell(state => state.focus), now = useNow();
  const faces = playerFaces(model, focus, now);
  const position = useShownPosition(model, live, null);
  const touched = useKitTouched(outputLoading);
  useContainer('#music-detail', {'aria-busy': String(faces.busy)});
  const detailOutput = OutputButton({faces: faces.detailOutput, loading: false, kitTouched: touched});
  return (
    <>
      <header className="response-heading">
        <button
          id="player-back"
          type="button"
          aria-label="Tilbage til forrige visning"
          onClick={() => {
            ports().back();
          }}
        >
          <img src="assets/icons/chevron-left.svg" alt="" />
        </button>
        <div>
          <h1 id="detail-title" tabIndex={-1}>Afspiller</h1>
          <p id="detail-status" hidden={faces.active && faces.stateHidden}>{faces.detailStatus}</p>
        </div>
      </header>
      <div className="now-playing-detail" hidden>
        <Artwork id="detail-cover" className="detail-cover" item={faces.active ? model : {}}
          style={faces.placeholder ? {visibility: 'hidden'} : {}} />
        <div className="detail-controls">
          <h2 id="detail-track">{faces.title}</h2>
          <p id="detail-artist">{faces.artist}</p>
          <Progress vm={position} prefix="detail" />
          <div className="transport" hidden>
            <Transport controls={controls} prefix="detail" icon={faces.playIcon} />
          </div>
          <button
            id="detail-output"
            type="button"
            {...detailOutput}
            className={detailOutput.className.replace(/^output/, 'detail-output')}
            onClick={event => {
              ports().openSpeakers(event.currentTarget);
            }}
          >
            <img src="assets/icons/speaker-output.svg" alt="" />
            <span>{faces.room}</span>
          </button>
          <div className="volume" hidden>
            <Volume controls={controls} id="detail-volume" outputId="detail-volume-value" label="Lydstyrke"
              labelText="Lydstyrke" />
          </div>
        </div>
      </div>
      <Queue model={model} controls={controls} live={live} />
    </>
  );
}

// The shell mounts the player once, before it binds its own listeners. Returns the unmount (tests).
export function mountPlayer(doc: Document = globalThis.document): () => void {
  const node = (selector: string) => {
    const found = doc.querySelector<HTMLElement>(selector);
    if (!found) throw Error(`Player is missing ${selector}`);
    return found;
  };
  const card = node('aside.player'), empty = node('#player-empty'), detail = node('#music-detail');
  const roots = [mountScreen(card, <PlayerCard />), mountScreen(empty, <EmptyCard />),
    mountScreen(detail, <PlayerDetail />)];
  return () => {
    for (const root of roots) root.unmount();
  };
}
