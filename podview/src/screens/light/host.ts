// Lys and the legacy shell (widget-view.js), which still owns the scene, navigation and the live transport.
// The shell tells Lys what it shows by publishing its facts after each render (publishLightScene: the focused light,
// the area catalogue and placement, the connection); React draws from that store. Lys asks the shell for things
// through the ports it registers once (bindLight): the facts as they are at the moment of a tap or a reply, a scene
// event for the local preview, adopting a browsed area's observation into the scene, the toast and the home read.
import {create} from 'zustand';
import type {
  LightAreas,
  LightArgs,
  LightPlacement,
  LightSceneDefinition,
  LightScope,
  LightTarget,
  LightTask,
  ObservedLight,
  ObservedLights,
} from '../../lib/api/light';

// A lamp in the local preview's example (scene-model.js).
export interface ExampleLamp {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  on: boolean;
  state?: unknown;
  brightness?: unknown;
  dimmable?: unknown;
}

// A light device as the scene keeps it: the local preview's example (scene-model.js) or an observed Home Assistant
// area (lib/api/light.ts scopedLightDevice), retained with its stale mark.
export interface LightDevice {
  id: string;
  kind: string;
  revision?: unknown;
  live?: boolean;
  stale?: boolean;
  pending?: unknown;
  exampleOnly?: boolean;
  status?: string;
  scope?: string;
  source?: string;
  observedAt?: number;
  validUntil?: number;
  lights?: ExampleLamp[];
  ownRoomId?: string;
  lightSelectionId?: unknown;
  lightScope?: LightScope | null;
  lightSourceEpoch?: string;
  lightObservation?: ObservedLights | Record<string, unknown> | null;
  observedLights?: ObservedLight[];
  lightScenes?: LightSceneDefinition[] | ExampleScene[];
  lightSceneSelections?: Record<string, {id?: unknown} | undefined>;
  feedbackPreview?: PreviewReceipt | null;
  lightHomeRestore?: unknown;
}

// A local example scene (preview-scenes.js): a room's scene with its per-lamp levels.
export interface ExampleScene {
  id: string;
  name: string;
  roomId?: string;
  entityIds?: string[];
  levels?: Record<string, unknown>;
}

// The local preview's stand-in for a command receipt (preview-scenes.js feedbackPreview).
export interface PreviewReceipt {
  revision?: unknown;
  phase?: string;
  action?: string;
  late?: boolean;
  target?: {areaId?: unknown; entityId?: unknown; sceneId?: unknown} | null;
}

export interface LightTransport {
  connected?: boolean;
  recoveryBlocked?: boolean;
  generation?: unknown;
  home: (options: {lightArea: string}) => Promise<unknown>;
  controlSetup: (domain: 'light', target: LightTarget) => Promise<unknown>;
  controlAction: (task: LightTask, optionId: string, args: LightArgs) => Promise<unknown>;
  recordDiagnostic?: (stage: string, fields: Record<string, unknown>) => void;
}

export interface LightSnapshot {
  bootId?: unknown;
  roomId?: unknown;
  sessionId?: unknown;
  taskId?: unknown;
  inputRevision?: unknown;
  providerGeneration?: unknown;
  capabilities?: {controlSetup?: string[] | undefined; homeRead?: string[] | undefined} | undefined;
}

export interface LightPlacementLike {
  status?: string;
  areaId?: unknown;
  areaName?: unknown;
}

// The part of the shell's scene Lys reads.
export interface LightState {
  sessionId?: unknown;
  focus?: unknown;
  connected?: boolean;
  devices?: LightDevice[];
  liveLightDetail?: LightDevice | null;
  lightAreas?: LightAreas | {status?: string; items?: unknown; ownAreaId?: unknown} | null;
  lightPlacement?: LightPlacement | LightPlacementLike | null;
  homeReadStatus?: {light?: string} | null;
}

// What the shell shows and holds at one moment.
export interface LightFacts {
  live: boolean;
  // The shell is in the document.
  isConnected: boolean;
  browserOffline: boolean;
  transport: LightTransport | null;
  snapshot: LightSnapshot | null;
  liveHomePending: boolean;
  state: LightState;
}

// A validated home read (home-model.js validateHome), as far as Lys reads it.
export interface HomeRead {
  revision?: unknown;
  lights?: unknown;
  lightAreas?: unknown;
}

// The device journal the shared control owner keeps (live-control-view.js): Lys records its intents, setups,
// actions, receipts and observations there, never for an outcome.
export interface LightJournal {
  pending?: unknown;
  setupPending?: unknown;
  spent: {has: (taskId: string) => boolean; set: (taskId: string, expiresAt: number) => unknown};
  pruneSpent: () => void;
  journalDevice: (transport: LightTransport | null, stage: string, fields: Record<string, unknown>) => void;
  remember: (row: Record<string, unknown>, outcome: string, requestId: unknown, result: unknown) => void;
  trackDeviceJournal: (domain: 'light', operation: unknown, requestId: unknown, requestedValue: unknown,
    resourceId: unknown, current: () => boolean) => void;
  observeDeviceJournal: (home: Record<string, unknown>) => void;
}

export interface LightPorts {
  facts: () => LightFacts;
  dispatch: (event: {type: string} & Record<string, unknown>) => void;
  // Make a browsed area's observation (or none) the light the scene shows.
  setDetail: (detail: LightDevice | null) => void;
  // Mark a light the scene keeps as no longer current.
  markStale: (light: LightDevice) => void;
  // Draw the scene again (after a read settled or an observation expired).
  render: () => void;
  showFeedback: (text: string, persistent?: boolean, options?: Record<string, unknown>) => void;
  loadLiveHome: () => Promise<unknown>;
  validateHome: (body: unknown, roomId: unknown, bootId: unknown) => HomeRead;
  journal: () => LightJournal | null;
}

const DEFAULT_FACTS: LightFacts = {
  live: false,
  isConnected: false,
  browserOffline: false,
  transport: null,
  snapshot: null,
  liveHomePending: false,
  state: {},
};

let ports: LightPorts = {
  facts: () => DEFAULT_FACTS,
  dispatch: () => undefined,
  setDetail: () => undefined,
  markStale: () => undefined,
  render: () => undefined,
  showFeedback: () => undefined,
  loadLiveHome: () => Promise.resolve(),
  validateHome: () => {
    throw new Error('home_unavailable');
  },
  journal: () => null,
};

export function bindLight(next: Partial<LightPorts>) {
  ports = {...ports, ...next};
}

export const lightPorts = () => ports;
export const lightFacts = () => ports.facts();

// The facts the light screen last drew from, with the transport's own flags copied (the transport object is kept
// and changes in place).
export interface LightScene extends LightFacts {
  transportConnected: boolean;
  recoveryBlocked: boolean;
  generation: unknown;
}

const sceneOf = (facts: LightFacts): LightScene => ({
  ...facts,
  transportConnected: facts.transport?.connected === true,
  recoveryBlocked: facts.transport?.recoveryBlocked === true,
  generation: facts.transport?.generation,
});

export const useLightScene = create<{scene: LightScene}>(() => ({scene: sceneOf(DEFAULT_FACTS)}));

const KEYS = ['live', 'isConnected', 'browserOffline', 'transport', 'snapshot', 'liveHomePending', 'state',
  'transportConnected', 'recoveryBlocked', 'generation'] as const;

// After each shell render: what the shell shows now. Unchanged facts notify nobody; `force` draws again (a fact
// changed in place).
export function publishLightScene(facts: LightFacts, force = false) {
  const next = sceneOf(facts), before = useLightScene.getState().scene;
  if (!force && KEYS.every(key => Object.is(before[key], next[key]))) return;
  useLightScene.setState({scene: next});
}

// The light the scene shows: the focused light device, or the browsed area's observation while it belongs to it.
export function currentLightDevice(state: LightState, live: boolean): LightDevice | undefined {
  const own = state.devices?.find(device => device.kind === 'light' && device.id === state.focus);
  return own && live && state.liveLightDetail?.id === own.id ? state.liveLightDetail : own;
}

// The shell's live flags in one place: connected, not blocked, the browser online.
export const transportLive = (facts: LightFacts) =>
  facts.transport?.connected === true && facts.transport.recoveryBlocked !== true && !facts.browserOffline;

export const controlAllowed = (facts: LightFacts) =>
  facts.snapshot?.capabilities?.controlSetup?.includes('light') === true;
