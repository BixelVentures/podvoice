// What the player's elements say for one model: pure functions, read by the components (Player.tsx). The texts and
// labels are the pre-React player-view.js's, word for word (the browser journeys and the owner's canvases name them).
import {discoveryPeriodLabel} from '../../lib/format/discovery';
import {OTHER_ACCOUNT, txt} from './player-model';
import type {ControlsModel, PlayerModel, QueueItem, QueueOptions} from './types';

export const formatTime = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;

export interface OutputFace {
  disabled: boolean;
  label: string;
}

export interface PlayerFaces {
  active: boolean;
  // An empty player still reading the room (»Henter afspilningsstatus«).
  placeholder: boolean;
  pending: boolean;
  busy: boolean;
  emptyState: string;
  readState: string;
  selectionFeedback: boolean;
  message: string;
  find: {label: string; context: string; action: 'account' | 'music'; disabled: boolean; hidden: boolean};
  // The speaker chip when the player is empty (it sits in the empty card, in place of its title).
  idleOutput: OutputFace & {room: string};
  detailStatus: string;
  title: string;
  artist: string;
  room: string;
  stateLabel: string;
  stateHidden: boolean;
  routineOutput: boolean;
  output: OutputFace;
  detailOutput: OutputFace;
  placement: 'room' | 'elsewhere' | 'other-account';
  sourceKind: 'music' | 'radio';
  moveHere: {action: 'music' | 'move'; icon: string; hidden: boolean; pending: boolean; label: string};
  radioLive: {hidden: boolean; phase: 'starting' | 'live' | 'stopped'; word: string};
  playIcon: string;
}

export function playerFaces(vm: PlayerModel, focus: string, now = Date.now()): PlayerFaces {
  const radio = vm.sourceKind === 'radio', active = vm.active === true;
  const feedback = radio ? '' : txt(vm.feedback?.message), controlStatus = radio ? '' : txt(vm.controlStatus);
  const pending = vm.feedback?.pending === true, placeholder = !active && vm.loading === true;
  const choosingAccount = vm.emptyState === 'account-selection';
  const message = feedback || (placeholder ? 'Henter afspilningsstatus' : vm.emptyState === 'error'
    ? 'Afspilningen kunne ikke hentes.' : vm.emptyState === 'offline' ? 'Afspilningen kan ikke hentes offline.'
      : vm.empty || 'Vælg en stemning eller sang.');
  const nextLabel = txt(vm.nextDestinationLabel);
  const idleOutput = {
    disabled: vm.canOutput !== true,
    label: nextLabel ? `Næste afspilning: ${nextLabel}` : vm.configuredTarget
      ? `Konfigureret højttaler: ${txt(vm.configuredTarget)}` : vm.canOutput === true
        ? 'Musik · Se aktuelle højttalere' : 'Musik',
    room: nextLabel || txt(vm.configuredTarget) || 'Musik',
  };
  const base = {
    active, placeholder, pending, busy: vm.loading === true || pending,
    emptyState: placeholder ? 'loading' : pending ? 'pending' : vm.emptyState || 'empty',
    readState: vm.emptyState || '', selectionFeedback: !!feedback, message,
    find: {label: choosingAccount ? 'Vælg musikkonto' : 'Vælg musik',
      context: choosingAccount ? '' : discoveryPeriodLabel(now), action: choosingAccount ? 'account' as const
        : 'music' as const,
      disabled: choosingAccount ? vm.canChooseAccount !== true : vm.canDiscover !== true,
      hidden: !choosingAccount && focus === 'music'},
    idleOutput,
  };
  if (!active)
    return {...base, detailStatus: message, title: '', artist: '', room: '', stateLabel: '', stateHidden: radio,
      routineOutput: false, output: {disabled: true, label: ''}, detailOutput: {disabled: true, label: ''},
      placement: 'room', sourceKind: radio ? 'radio' : 'music',
      moveHere: {action: 'move', icon: 'assets/icons/speaker-output.svg', hidden: true, pending: false,
        label: 'Flyt til '},
      radioLive: {hidden: true, phase: 'stopped', word: 'Stoppet'}, playIcon: 'assets/icons/play-fill.svg'};
  const artist = (txt(vm.artist) || (radio ? 'Direkte radio' : '')) + (vm.exampleOnly === true && radio
    ? ' · ingen lyd' : '');
  const room = txt(vm.selectedTarget) || txt(vm.target);
  const previewLabel = vm.exampleOnly === true && radio ? txt(vm.previewLabel) : '';
  const explained = vm.connectionExplained === true;
  const playingLabel = vm.placement === 'elsewhere' && !txt(vm.target) ? 'Spiller et andet sted' : 'Spiller på';
  const otherAccount = vm.placement === 'other-account';
  const readOnlyLabel = otherAccount ? OTHER_ACCOUNT : vm.fresh === false && !explained
    ? (vm.playing ? 'Ikke opdateret' : 'Ikke opdateret · på pause') : vm.playing ? playingLabel : 'På pause';
  const failure = explained ? 'Forbindelsen mangler' : 'Status kunne ikke hentes';
  const stateLabel = vm.selectedTarget ? 'Skifter til' : vm.readOnly
    ? [feedback, readOnlyLabel].filter(Boolean).join(' · ')
    : feedback || controlStatus || (vm.emptyState === 'error' ? failure
      : vm.exampleOnly === true && radio ? '' : vm.fresh ? (vm.playing ? 'Spiller på' : '')
        : explained ? '' : 'Ikke opdateret');
  const detailStatus = vm.readOnly
    ? [feedback, otherAccount ? OTHER_ACCOUNT : vm.fresh === false && !explained
      ? 'Afspilningen er ikke opdateret' : vm.playing ? (vm.placement === 'elsewhere'
        ? (txt(vm.target) ? `Spiller på ${txt(vm.target)}` : 'Spiller et andet sted') : '') : 'På pause']
      .filter(Boolean).join(' · ')
    : feedback || controlStatus || (vm.emptyState === 'error' ? failure
      : vm.exampleOnly === true && radio ? '' : vm.fresh ? '' : explained ? '' : 'Afspilningen er ikke opdateret');
  const outputLabel = (card: boolean) => [
    card ? stateLabel || (vm.exampleOnly === true && radio ? previewLabel : vm.fresh && !vm.playing ? 'På pause' : '')
      : '',
    vm.selectedTarget ? `Valgt: ${txt(vm.selectedTarget)} · skifter højttaler` : txt(vm.target),
    vm.canOutput ? (vm.targetPending ? 'Vælg højttaler' : vm.readOnly
      ? (vm.placement === 'elsewhere' && txt(vm.configuredTarget) ? `Flyt til ${txt(vm.configuredTarget)}`
        : 'Vælg højttaler')
      : `${vm.selectedTarget ? 'Afventer bekræftelse' : vm.fresh ? 'Aktuelt output' : 'Seneste output'} · Vælg højttaler`)
      : '',
  ].filter(Boolean).join(' · ');
  const configured = txt(vm.configuredTarget);
  const away = vm.readOnly === true && vm.placement === 'elsewhere';
  const other = vm.readOnly === true && otherAccount;
  // f) Own music on another device (lærred »Player-AndenEnhed«): one primary "Flyt til <rum>" at the bottom of the
  // card does what the chip does; it says "Flytter til <rum>…" until the room plays it. Anden konto (lærred
  // »Player-AndenKonto«): the same bottom button starts own music instead.
  const moveHidden = other ? vm.canDiscover !== true : !(away && configured && vm.canOutput);
  const moving = !other && !moveHidden && !!vm.selectedTarget;
  // Radio's live state (lærred »Player-Radio«): starting, playing live or stopped.
  const phase = vm.loading === true ? 'starting' : vm.playing ? 'live' : 'stopped';
  return {
    ...base, detailStatus, title: txt(vm.title), artist, room, stateLabel, stateHidden: radio,
    routineOutput: ['Spiller på', 'På pause'].includes(stateLabel),
    output: {disabled: !vm.canOutput, label: outputLabel(true)},
    detailOutput: {disabled: !vm.canOutput, label: outputLabel(false)},
    placement: away ? 'elsewhere' : other ? 'other-account' : 'room', sourceKind: radio ? 'radio' : 'music',
    moveHere: {action: other ? 'music' : 'move',
      icon: `assets/icons/${other ? 'music-note-beamed' : 'speaker-output'}.svg`, hidden: moveHidden,
      pending: moving, label: other ? 'Vælg musik' : moving ? `Flytter til ${configured}…` : `Flyt til ${configured}`},
    radioLive: {hidden: !radio, phase, word: {starting: 'Forbinder', live: 'Direkte', stopped: 'Stoppet'}[phase]},
    playIcon: `assets/icons/${vm.playing ? (radio ? 'stop' : 'pause') : 'play'}-fill.svg`,
  };
}

export interface ProgressFaces {
  known: boolean;
  label: string;
  elapsed: string;
  duration: string;
  stale: boolean;
  progressMs: number;
  durationMs: number;
}

// Position is a display value only; live interpolation never creates seek authority.
export function progressFaces(vm: PlayerModel): ProgressFaces {
  const progress = vm.progressMs ?? NaN, durationMs = vm.durationMs ?? NaN;
  const known = vm.active === true && Number.isSafeInteger(progress) && progress >= 0 &&
    Number.isSafeInteger(durationMs) && durationMs > 0 && progress <= durationMs;
  const elapsed = known ? Math.floor(progress / 1000) : 0, total = known ? Math.floor(durationMs / 1000) : 0;
  const label = known ? `${vm.examplePosition === true ? 'Eksempelposition' : vm.positionFresh === true
    ? (vm.interpolatedPosition ? 'Beregnet position fra seneste observation' : 'Observeret position')
    : 'Position ikke opdateret'}: ${formatTime(elapsed)} af ${formatTime(total)}. Kun visning.` : '';
  return {known, label, elapsed: known ? formatTime(elapsed) : '', duration: known ? formatTime(total) : '',
    stale: known && vm.positionFresh !== true, progressMs: known ? progress : 0, durationMs: known ? durationMs : 1};
}

export interface TransportFaces {
  // Radio shows only its play/stop toggle.
  skipHidden: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  toggleDisabled: boolean;
  toggleLabel: string;
  radio: boolean;
}

export function transportFaces(c: ControlsModel): TransportFaces {
  const radio = c.sourceKind === 'radio', blocked = c.blocked === true;
  return {
    skipHidden: radio,
    previousDisabled: blocked || !c.previous,
    nextDisabled: blocked || !c.next,
    toggleDisabled: blocked || !c.toggle,
    toggleLabel: radio && c.pendingLabel ? c.pendingLabel : radio ? (c.playing ? 'Stop radio'
      : 'Start radio ved livepunkt') : c.playing ? 'Sæt musik på pause' : 'Fortsæt musikken',
    radio,
  };
}

export const volumeKnown = (volume: number | null | undefined): volume is number =>
  typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100;

export interface QueueFaces {
  hidden: boolean;
  items: QueueItem[];
  meta: string;
  label: string;
  status: string;
  busy: boolean;
  placeholders: boolean;
  empty: string;
}

// The queue as shown: titled rows only, the playing song first when the room plays one that is not listed.
export function queueFaces(input: readonly QueueItem[], options: QueueOptions, vm: PlayerModel, live: boolean,
  room: string): QueueFaces {
  const {status = 'ready', empty = 'Ingen sange i køen.', sourceKind = 'music', errorKind = null,
    placeholders = false} = options;
  let items = input.filter(item => typeof item.title === 'string' && !!item.title.trim());
  if (live && sourceKind !== 'radio' && vm.active && vm.fresh && !vm.readOnly && vm.metadataKnown !== false &&
    vm.uri && !items.some(item => item.current))
    items = [{id: `current:${vm.uri}`, uri: vm.uri, title: vm.title, artist: vm.artist, artwork: vm.artwork, order: 0,
      current: true, playing: vm.playing === true, selectable: false}, ...items];
  // Musik-Koe: the title is always »Kø«; the line beside it says »N numre · <højttaler>« or the queue's state.
  const stateLine = status === 'error' ? (errorKind === 'choice' ? 'Køvalget blev afvist' : 'Køen kunne ikke hentes')
    : status === 'unknown' ? 'Afspilning ikke bekræftet' : status === 'stale' ? 'Køen er ikke opdateret' : '';
  const countLine = status === 'loading' || !items.length ? ''
    : [`${String(items.length)} ${items.length === 1 ? 'nummer' : 'numre'}`, room].filter(Boolean).join(' · ');
  const upcoming = items.some(item => !item.current);
  return {
    hidden: sourceKind === 'radio',
    items,
    meta: stateLine || countLine,
    label: status === 'stale' ? 'Køen er ikke opdateret' : status === 'error'
      ? (errorKind === 'choice' ? 'Køvalget blev afvist' : 'Køen kunne ikke opdateres') : 'Kø',
    status,
    busy: ['loading', 'pending'].includes(status),
    // Loading keeps the list's height: four empty rows of the real row anatomy (K2/K4).
    placeholders: placeholders && status === 'loading' && !upcoming,
    empty: status !== 'loading' && !upcoming && empty ? empty : '',
  };
}

export interface QueueRowFaces {
  key: string;
  label: string;
  slot: 'eq' | 'icon' | 'text';
  slotLabel: string;
  icon: string;
  playIcon: string;
  playback: 'playing' | 'paused' | 'unknown' | 'upcoming';
  pending: boolean;
}

export function queueRowFaces(item: QueueItem): QueueRowFaces {
  const pending = !item.current && item.pending === true;
  const aria = `${item.current ? (item.playing === true ? 'Spiller nu:' : item.playing === false ? 'På pause:'
    : 'Aktuelt nummer:') : pending ? 'Starter:' : item.selectable ? 'Afspil' : 'Kun visning:'} ${[
    item.current ? '' : String(item.order), txt(item.title), txt(item.artist)].filter(Boolean).join(' · ')}`;
  return {
    key: item.displayId ?? item.id,
    label: item.current && typeof item.playing === 'boolean' ? `${aria} · ${item.playing ? 'Sæt på pause' : 'Fortsæt'}`
      : aria,
    slot: item.current ? (item.playing === true ? 'eq' : 'icon') : 'text',
    slotLabel: item.current ? (item.playing === true ? 'Spiller nu' : item.playing === false ? 'På pause'
      : 'Aktuelt nummer') : 'Placering',
    icon: `assets/icons/${item.playing === false ? 'pause-fill' : 'music-note-beamed'}.svg`,
    playIcon: `assets/icons/${item.current && item.playing ? 'pause' : 'play'}-fill.svg`,
    playback: item.current ? (item.playing === true ? 'playing' : item.playing === false ? 'paused' : 'unknown')
      : 'upcoming',
    pending,
  };
}
