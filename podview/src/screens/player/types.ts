// The player's view model and the parts of the shell (widget-view.js) and its live owners the player reads.
import type {PlaybackRoomBinding} from '../../../media-observation.js';
import type {SourceFocus} from '../../../player-model.js';

export interface PositionAnchor {
  key: string;
  observedAt: number;
  expiresAt: number;
}

// What the player shows (player-model.js, the live media view and live radio make it).
export interface PlayerModel {
  active?: boolean | undefined;
  playing?: boolean | undefined;
  fresh?: boolean | undefined;
  loading?: boolean | undefined;
  title?: unknown;
  artist?: unknown;
  target?: unknown;
  selectedTarget?: unknown;
  configuredTarget?: unknown;
  nextDestinationLabel?: unknown;
  targetPending?: boolean | undefined;
  canOutput?: boolean | undefined;
  canDiscover?: boolean | undefined;
  canChooseAccount?: boolean | undefined;
  canSeek?: boolean | undefined;
  emptyState?: string | undefined;
  empty?: string | undefined;
  feedback?: {message?: unknown; pending?: boolean} | null | undefined;
  controlStatus?: unknown;
  sourceKind?: string | undefined;
  exampleOnly?: boolean | undefined;
  previewLabel?: unknown;
  readOnly?: boolean | undefined;
  placement?: string | undefined;
  metadataKnown?: boolean | undefined;
  uri?: string | undefined;
  artwork?: unknown;
  artworkUrl?: unknown;
  fixtureArt?: string | null | undefined;
  trackId?: string | undefined;
  id?: string | undefined;
  themeArt?: string | undefined;
  themeId?: string | undefined;
  examplePosition?: boolean | undefined;
  progressMs?: number | null | undefined;
  durationMs?: number | null | undefined;
  positionFresh?: boolean | undefined;
  interpolatedPosition?: boolean | undefined;
  positionAnchor?: PositionAnchor | null | undefined;
  seekOperation?: unknown;
  volume?: number | null | undefined;
}

export interface QueueItem {
  id: string;
  displayId?: string | undefined;
  uri?: string | undefined;
  title?: unknown;
  artist?: unknown;
  artwork?: unknown;
  artworkUrl?: unknown;
  fixtureArt?: string | null | undefined;
  trackId?: string | undefined;
  order?: number | undefined;
  current?: boolean | undefined;
  playing?: boolean | undefined;
  pending?: boolean | undefined;
  selectable?: boolean | undefined;
  revision?: unknown;
  queueTaskId?: string | undefined;
  renewUnknown?: boolean | undefined;
  sourceKind?: string | undefined;
  loading?: boolean | undefined;
  themeArt?: string | undefined;
  themeId?: string | undefined;
}

export interface QueueOptions {
  status?: string | undefined;
  empty?: string | undefined;
  sourceKind?: string | undefined;
  errorKind?: string | null | undefined;
  placeholders?: boolean | undefined;
}

export interface VolumeModel {
  volume?: number | null | undefined;
  blocked?: boolean | undefined;
  canVolume?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

export interface SeekWitness {
  key?: string;
  transport?: unknown;
  trackId?: string | undefined;
  trackUri?: string;
  operation?: unknown;
  durationMs?: number;
}

export interface SeekState {
  witness: SeekWitness;
  positionMs?: number | null;
}

export interface VolumeWitness {
  readonly binding: string;
  readonly sourceKind: 'music' | 'radio';
  readonly transport: unknown;
  readonly transportGeneration: unknown;
  readonly mode: string;
  readonly pointerHeld: boolean;
}

export interface Snapshot {
  bootId?: string;
  roomId?: string;
}

export interface Playback {
  state?: string;
  source?: string;
  observedAt?: string;
  config_entry_id?: string;
}

export interface SpeakerChoice {
  homepodId: string;
  nativeRoomId: string | null;
  name: string;
  at?: number;
  scope?: string | null;
}

export interface RadioHistory {
  scope: string | null;
  superseded?: boolean;
  targetId?: unknown;
  observedAt?: number;
}

export interface PlayerTransport {
  connected?: boolean;
  generation?: unknown;
  base?: string;
}

export interface LiveRadio {
  value?: {bootId?: unknown; roomId?: unknown; ownerProcessId?: unknown; state?: Record<string, unknown>} | null;
  ownsPlayer?: () => boolean;
  hasSource?: () => boolean;
  can?: (action: string) => boolean;
  closeOutputs?: () => void;
  playerModel?: () => PlayerModel | null | undefined;
  pendingStart?: () => unknown;
  presentsPlayer?: () => boolean;
}

// The shell (widget-view.js) as the player reads it.
export interface PlayerHost {
  live?: boolean;
  ownerDocument: Document;
  dataset: DOMStringMap;
  isConnected?: boolean;
  querySelector: (selector: string) => Element | null;
  state?: {focus?: string; connected?: boolean; sessionId?: unknown; music?: {pending?: unknown; playback?: {
    accountId?: unknown; kind?: unknown; targetId?: unknown; room?: unknown;
  }}};
  liveSnapshot?: Snapshot | null;
  liveTransport?: PlayerTransport | null;
  liveRadio?: LiveRadio | null;
  liveMedia?: {
    playback?: Playback | null;
    account?: unknown;
    render?: () => void;
    observedPlayerModel?: () => PlayerModel | null | undefined;
  } | null;
  liveControls?: {
    musicSeekState?: (uri: string | undefined) => SeekState | null | undefined;
    player?: {can: (action: string) => boolean} | null;
  } | null;
  browserOffline?: boolean;
  connectionNotice?: {state?: string} | null;
  playerView?: unknown;
  music: (event: Record<string, unknown>) => void;
}

export type {PlaybackRoomBinding, SourceFocus};
