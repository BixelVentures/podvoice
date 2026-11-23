// The player's state outside React, in one Zustand store (see src/README.md):
// - what the music owner publishes: the live room player (room-player.ts) or the local preview scene (the shell)
//   write the model, the transport and volume, the queue and the running command's marks; React draws them,
// - the shell (widget-view.js) that the player belongs to: its live owners (bindPlayer) and the requests the player
//   makes of it (connectPlayer: a tap on play, a speaker chip, Find musik, back). React never writes the shell's DOM
//   and the shell never writes inside the player's containers.
import {create} from 'zustand';
import {touchClock} from '../../lib/hooks/clock';
import type {Playback} from '../../lib/api/media';
import type {RadioSource} from '../radio/source';
import type {ControlsModel, PlayerModel, QueueItem, QueueOptions, SeekEvent, SeekState} from './types';

// The running room player command (room-commands.ts): which action, and whether it is slow enough for its ring.
export interface BusyMarks {
  ring: string | null;
  transport: boolean;
  volume: boolean;
}

export interface QueueView {
  items: readonly QueueItem[];
  options: QueueOptions;
  // A revoked room clears the rows at once; the next rows enter without a list motion from the old ones.
  epoch: number;
}

// The shell and its live owners as the player reads them.
export interface PlayerHost {
  live?: boolean;
  isConnected?: boolean;
  liveSnapshot?: {bootId?: unknown; roomId?: unknown; capabilities?: unknown; [key: string]: unknown} | null;
  liveTransport?: {connected?: boolean; generation?: unknown; base?: string;
    recordDiagnostic?: (stage: string, fields: Record<string, unknown>) => void} | null;
  liveRadio?: RadioSource | null;
  liveMedia?: {playback?: Playback | null; account?: unknown; render?: () => void;
    observedPlayerModel?: () => PlayerModel | null | undefined} | null;
  liveControls?: {musicSeekState?: (uri: string | undefined) => SeekState | null | undefined;
    player?: {can: (action: string) => boolean; playback?: () => Playback | null} | null} | null;
  state?: {sessionId?: unknown; music?: {pending?: unknown; playback?: {accountId?: unknown; kind?: unknown;
    targetId?: unknown; room?: unknown}}};
  music?: (event: Record<string, unknown>) => void;
}

// What the player asks of the shell. Navigation, dispatch and the music lane stay there.
export interface PlayerPorts {
  // A transport or volume tap (the shell routes it to the room player, live radio or the local scene).
  music: (event: Record<string, unknown>) => void;
  seek: (event: SeekEvent) => void;
  chooseQueue: (item: QueueItem) => void;
  // The full player (from the card), back from it, the speaker sheet, »Flyt til«, Find musik.
  openDetail: (opener: HTMLElement) => void;
  back: () => void;
  openSpeakers: (opener: HTMLElement) => void;
  moveHere: (opener: HTMLElement) => void;
  findMusic: (action: 'music' | 'account') => void;
  // A short notice in the shell's toast (»Højst 60 %«).
  showFeedback: (text: string, source: string) => void;
}

const NOOP: PlayerPorts = {
  music: () => undefined,
  seek: () => undefined,
  chooseQueue: () => undefined,
  openDetail: () => undefined,
  back: () => undefined,
  openSpeakers: () => undefined,
  moveHere: () => undefined,
  findMusic: () => undefined,
  showFeedback: () => undefined,
};

export interface PlayerStore {
  model: PlayerModel;
  controls: ControlsModel;
  queue: QueueView;
  busy: BusyMarks;
  host: PlayerHost;
  ports: PlayerPorts;
  // The live speaker picker (speakers.ts), which the speaker sheet draws.
  speakers: unknown;
  // Bumped when something the player derives from outside its store changed (the live owners' own fields).
  revision: number;
}

const IDLE_MARKS: BusyMarks = {ring: null, transport: false, volume: false};
const INITIAL = (): PlayerStore => ({
  model: {},
  controls: {blocked: true},
  queue: {items: [], options: {}, epoch: 0},
  busy: IDLE_MARKS,
  host: {},
  ports: NOOP,
  speakers: null,
  revision: 0,
});

export const usePlayer = create<PlayerStore>(INITIAL);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// New data is judged by the current time (lib/hooks/clock.ts).
const write = (patch: Partial<PlayerStore>) => {
  touchClock();
  usePlayer.setState(patch);
};

// The music owner's writes. An equal value notifies nobody (a heartbeat draws nothing).
export function publishPlayer(model: PlayerModel) {
  if (!same(usePlayer.getState().model, model)) write({model});
}

export function publishControls(controls: ControlsModel) {
  if (!same(usePlayer.getState().controls, controls)) write({controls});
}

export function publishQueue(items: readonly QueueItem[], options: QueueOptions = {}) {
  const queue = usePlayer.getState().queue;
  if (!same(queue.items, items) || !same(queue.options, options))
    write({queue: {items, options, epoch: queue.epoch}});
}

// A revoked room: the rows are gone at once, and the next rows are a new list (no motion from the old ones).
export function clearQueue() {
  const queue = usePlayer.getState().queue;
  usePlayer.setState({queue: {items: [], options: queue.options, epoch: queue.epoch + 1}});
}

export function publishBusy(busy: BusyMarks) {
  if (!same(usePlayer.getState().busy, busy)) usePlayer.setState({busy});
}

// The live owners' own fields changed (a radio read, the speaker labels): redraw what derives from them.
export function touchPlayer() {
  usePlayer.setState(state => ({revision: state.revision + 1}));
}

// The shell registers itself and its ports once.
export function bindPlayer(host: PlayerHost, ports: Partial<PlayerPorts> = {}) {
  usePlayer.setState({host, ports: {...NOOP, ...ports}});
}

// The live speaker picker registers itself for the sheet.
export function bindSpeakers(speakers: unknown) {
  usePlayer.setState({speakers});
}

// A fresh page life (tests).
export function resetPlayer() {
  usePlayer.setState(INITIAL(), true);
}

export const playerHost = () => usePlayer.getState().host;
export const playerPorts = () => usePlayer.getState().ports;
