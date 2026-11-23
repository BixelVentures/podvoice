// The player's view models: what the card, the empty card and the full player show (player-model.ts, the room
// player and live radio make them), the transport and volume, and the queue rows.
export interface PositionAnchor {
  key: string;
  observedAt: number;
  expiresAt: number;
}

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
  feedback?: {message?: unknown; pending?: boolean | undefined; state?: string} | null | undefined;
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
  // The connection itself explains a stale player (offline, no access): no »Ikke opdateret« over it.
  connectionExplained?: boolean | undefined;
}

// Transport and volume, for every source.
export interface ControlsModel {
  playing?: boolean | undefined;
  previous?: boolean | undefined;
  next?: boolean | undefined;
  toggle?: boolean | undefined;
  blocked?: boolean | undefined;
  volumeBlocked?: boolean | undefined;
  volume?: number | null | undefined;
  canVolume?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  sourceKind?: string | undefined;
  loadingControlId?: string | null | undefined;
  pendingLabel?: string | null | undefined;
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
  reorderable?: boolean | undefined;
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

export interface SeekEvent {
  positionMs: number;
  witness?: SeekWitness;
  trackId?: string | undefined;
  operation?: unknown;
}

// Who a volume gesture belongs to: the source shown at its first input. It is never retargeted.
export interface VolumeWitness {
  readonly binding: string;
  readonly sourceKind: 'music' | 'radio';
  readonly transport: unknown;
  readonly transportGeneration: unknown;
  readonly mode: string;
  readonly pointerHeld: boolean;
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
  observedAt?: number | null | undefined;
}

// The shared player's source: music, radio or auto (no explicit choice, the observed room decides).
export interface SourceFocus {
  scope: string | null;
  kind: 'auto' | 'music' | 'radio';
  target: Readonly<Record<string, unknown>> | null;
}

export interface FocusTicket {
  previous?: SourceFocus | null;
  current: SourceFocus | null;
  scope: string | null;
}
