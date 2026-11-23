// Bil's state outside React, in one place:
// - the screen's store (store.ts) on the app's owners: the live vehicle owner (live.ts) on the shell's transport and
//   the local preview command (preview-command.ts) on the shell's scene;
// - what the shell tells it after each render (publishVehicleScene): the scene's facts, and the car itself from the
//   query cache (live: the home read's admitted observation, ingestVehicle) or the scene (the local fixture);
// - the Home card's data (useHomeVehicle): the same car and its own charge acknowledgement.
// The shell registers its ports once (bindVehicle) and never renders the screen or the card itself.
import {create} from 'zustand';
import {readVehicle} from '../../lib/query/vehicle';
import {createLiveVehicle} from './live';
import type {LiveVehicle, VehicleLivePort, VehicleOperation, VehicleProposal, VehicleSnapshot} from './live';
import {vehicleChargeUpdate, vehicleModel} from './model';
import type {ChargeContext, ChargePresentation, VehicleModel} from './model';
import {createPreviewCommand} from './preview-command';
import type {PreviewCommand, PreviewHost} from './preview-command';
import {createVehicleStore} from './store';
import type {VehicleStore} from './store';

export interface VehicleShellPort extends VehicleLivePort {
  // The shell itself for the local preview command: its `live`, `state` and `dispatch`.
  previewHost: PreviewHost;
}

export interface VehicleScene {
  live: boolean;
  focus: string;
  // The local fixture (the scene's own vehicle); live, the car comes from the query cache.
  value?: unknown;
  connectionDetail: string | null;
  // The charge context without the navigation's suppression (connected, scope, sourceScope, readGranted).
  chargeContext: ChargeContext;
  // The actions the current authority offers (live: the snapshot's; local: the scene's preview actions).
  vehicleActions: string[];
  // The live snapshot's identity, which scopes the screen's command feedback (null in the local preview).
  snapshot: VehicleSnapshot | null;
}

let shell: VehicleShellPort | null = null;
let live: LiveVehicle | null = null;
let preview: PreviewCommand | null = null;
let liveScene = false;

// Labels for the local fixture's offered actions: an example proposal, never a car's.
const LOCAL_LABELS: Record<string, string> = {
  unlock: 'Lås op',
  climateOff: 'Sluk klima',
  temperature: 'Indstil temperatur',
  defrostOff: 'Stop afrimning',
  driverSeatHeat: 'Førersæde',
  passengerSeatHeat: 'Passagersæde',
};

function localProposal(action: string, args: Record<string, unknown>): VehicleProposal | null {
  const host = shell?.previewHost;
  const state = host?.state as {vehicle?: {exampleOnly?: unknown}; vehiclePreviewActions?: unknown} | undefined;
  const offered = state?.vehiclePreviewActions;
  if (liveScene || state?.vehicle?.exampleOnly !== true || !Array.isArray(offered) || !offered.includes(action)) {
    return null;
  }
  const label =
    action === 'rearTrunkToggle' ? (args.direction === 'open' ? 'Åbn bagagerum' : 'Luk bagagerum') : LOCAL_LABELS[action];
  return {
    confirmation: {
      action,
      ...(label !== undefined ? {label} : {}),
      args,
      effects: action === 'rearTrunkToggle' ? [['trunk', 'actuate']] : [],
      requiresConfirmation: true,
      nativeWakePossible: true,
      priorUnresolved: {access: [], climate: []},
      riskRevision: 0,
      requiresOverride: false,
    },
    operation: {exampleOnly: true},
  } as unknown as VehicleProposal;
}

export const vehicleStore = createVehicleStore({
  onAction: (event, options) => {
    if (liveScene || !shell) return undefined;
    preview ??= createPreviewCommand(shell.previewHost);
    return preview.send(event, options);
  },
  onVehicleSetup: (action, args, presented) =>
    localProposal(action, args) ?? live?.prepare(action, args, presented) ?? null,
  onVehicleSend: (operation: VehicleOperation) =>
    !liveScene && operation.exampleOnly === true ? {status: 'example'} : (live?.send(operation) ?? {status: 'failed'}),
  onVehicleCancel: operation => {
    if (!operation?.exampleOnly) live?.cancel(operation);
  },
});

// The shell's ports, registered once.
export function bindVehicle(port: VehicleShellPort) {
  shell = port;
  live = createLiveVehicle(port);
}

// The live owner's operation between setup and send (the shared device journal reads it for diagnostics).
export const vehicleOperation = () => live?.operation ?? null;

// The feedback scope: boot and room, with the session and provider generation kept while they are absent from a
// snapshot of the same boot and room. A real replacement clears the screen's command feedback.
function feedbackScopeFor(prior: string | null, snapshot: VehicleSnapshot | null): string | null {
  if (!snapshot) return prior;
  let previous: unknown[] = [];
  try {
    previous = JSON.parse(prior || '[]') as unknown[];
  } catch {
    // An unreadable scope is no scope.
  }
  const same = previous[0] === snapshot.bootId && previous[1] === snapshot.roomId;
  return JSON.stringify([
    snapshot.bootId,
    snapshot.roomId,
    snapshot.sessionId ?? (same ? (previous[2] ?? null) : null),
    snapshot.providerGeneration ?? (same ? (previous[3] ?? null) : null),
  ]);
}

// ---- The Home card ----

export interface HomeVehicle {
  model: VehicleModel;
  // Grows by one for each finite charge acknowledgement on the card's battery value.
  cue: number;
}

let homeCharge: ChargePresentation | null = null;
let homeAnimation: Animation | null = null;
export const useHomeVehicle = create<HomeVehicle>(() => ({model: vehicleModel(null), cue: 0}));
export function setHomeChargeAnimation(animation: Animation | null | undefined) {
  homeAnimation = animation ?? null;
}

// ---- What the shell tells the screen ----

export interface ScenePublisher {
  publish: (scene: VehicleScene, options?: {viewChanged?: boolean}) => VehicleModel;
  reset: () => void;
}

// After each shell render, for one screen store. The screen renders when it is (or will be) shown and something it
// shows changed, or when its page comes into view (a charge cue is then suppressed: navigation seeds current data
// without replay). While its page is not in front, a live proposal is cancelled and the dialog closes.
export function createScenePublisher(
  store: VehicleStore,
  hooks: {before?: (scene: VehicleScene) => void; leave?: () => void} = {},
): ScenePublisher {
  let signature: string | null = null;
  let rendered = false;
  return {
    publish(scene, {viewChanged = false} = {}) {
      hooks.before?.(scene);
      const value = scene.live ? readVehicle() : scene.value;
      const model = vehicleModel(value);
      const state = store.getState();
      const feedbackScope = scene.live ? feedbackScopeFor(state.input.feedbackScope, scene.snapshot) : null;
      const options = {
        connected: scene.chargeContext.connected === true,
        connectionDetail: scene.connectionDetail,
        vehicleActions: scene.vehicleActions,
        feedbackScope,
      };
      const next = JSON.stringify([value, model, scene.chargeContext, options]);
      const entering = viewChanged && scene.focus === 'vehicle';
      // A known car's page is built in the background, so it opens complete (native feel, 13 Nov).
      const shown = scene.focus === 'vehicle' || rendered || (scene.live && model.mode === 'observed');
      if (shown && (entering || signature !== next)) {
        signature = next;
        rendered = true;
        state.render(value, {...options, chargeContext: {...scene.chargeContext, suppress: viewChanged}});
      }
      if (scene.focus !== 'vehicle' && rendered) {
        hooks.leave?.();
        store.getState().leave();
      }
      return model;
    },
    reset() {
      signature = null;
      rendered = false;
    },
  };
}

const publisher = createScenePublisher(vehicleStore, {
  before: scene => {
    liveScene = scene.live;
    preview?.sync();
  },
  leave: () => {
    live?.cancel(live.operation);
  },
});

// The app's scene: the screen, then the Home card (the same car; its acknowledgement plays only while Home is in
// front).
export function publishVehicleScene(scene: VehicleScene, {viewChanged = false} = {}) {
  const model = publisher.publish(scene, {viewChanged});
  const charge = vehicleChargeUpdate(homeCharge, scene.live ? readVehicle() : scene.value, {
    ...scene.chargeContext,
    suppress: viewChanged,
    visible: scene.focus === 'now',
  });
  homeCharge = charge;
  if (charge.cancel || charge.cue) {
    homeAnimation?.cancel();
    homeAnimation = null;
  }
  const home = useHomeVehicle.getState();
  const cue = charge.cue ? home.cue + 1 : home.cue;
  const homeModel = JSON.stringify(home.model) === JSON.stringify(model) ? home.model : model;
  if (homeModel !== home.model || cue !== home.cue) useHomeVehicle.setState({model: homeModel, cue});
}

// The shell is detached: in-flight work is dropped, and a later attach starts a fresh screen.
export function resetVehicle() {
  preview?.dispose();
  preview = null;
  live?.cancel(live.operation);
  vehicleStore.getState().dispose();
  vehicleStore.getState().reset();
  homeAnimation?.cancel();
  homeAnimation = null;
  homeCharge = null;
  publisher.reset();
}

// For diagnostics and the browser journeys (the shell exposes it as `vehicleView`): the car shown and the running
// live commands, read-only.
export function vehicleInspection() {
  const state = vehicleStore.getState();
  return {
    model: state.model,
    liveVehicleCommands: new Map(Object.entries(state.commands)),
  };
}
