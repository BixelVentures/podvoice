// The radio screen's state outside React, in one place:
// - the live radio source (source.ts) on the registered API, the cached snapshot and the connection; the shell
//   registers the shared player and the speaker sheet it paints into (connectRadioPorts),
// - the local preview's radio scene (the shell's scene owns it while it owns navigation; it publishes it after each
//   render, publishRadioScene),
// - radioInput: what the radio screen is told, from either.
import {create} from 'zustand';
import {currentApi} from '../../lib/api/client';
import {homeConnectionPresentation} from '../../lib/api/connection';
import {readConnection, readSnapshot} from '../../lib/query/live';
import type {Connection} from '../../lib/query/live';
import type {RadioInput} from './model';
import {createRadioSource} from './source';
import type {RadioOutputs, RadioPlayer, RadioSource} from './source';

export interface RadioScene {
  live: boolean;
  // The local preview's own facts (the scene is their only authority).
  connected: boolean;
  blocked: boolean;
  stationId: string | null;
  playing: boolean;
  pendingStationId: string | null;
  speaker: string | null;
}

const EMPTY: RadioScene = {live: false, connected: true, blocked: false, stationId: null, playing: false,
  pendingStationId: null, speaker: null};

let sceneSignature = '';
export const useRadioScene = create<RadioScene>(() => EMPTY);

// The shell's scene after its render; an unchanged scene notifies nobody.
export function publishRadioScene(scene: RadioScene) {
  const signature = JSON.stringify(scene);
  if (signature === sceneSignature) return;
  sceneSignature = signature;
  useRadioScene.setState(scene, true);
}

interface RadioPorts {
  player: () => RadioPlayer | null | undefined;
  outputs: () => RadioOutputs | null | undefined;
  dialog: () => HTMLDialogElement | null | undefined;
}
let ports: RadioPorts = {player: () => null, outputs: () => null, dialog: () => null};

// The shell registers the shared player, the speaker sheet and its dialog once.
export function connectRadioPorts(next: RadioPorts) {
  ports = next;
}

export const radioSource = createRadioSource({
  api: currentApi,
  snapshot: readSnapshot,
  connection: readConnection,
  player: () => ports.player(),
  outputs: () => ports.outputs(),
  dialog: () => ports.dialog(),
  hidden: () => globalThis.document.visibilityState === 'hidden',
  storage: () => globalThis.localStorage,
});

// What the radio screen is told. Live: the admitted observation and the command lifecycle. Local preview: the
// scene.
export function radioInput(scene: RadioScene, source: RadioSource, connection: Connection): RadioInput {
  if (!scene.live)
    return {live: false, connected: scene.connected, blocked: scene.blocked, stationId: scene.stationId,
      playing: scene.playing, enabled: false, canStart: false, pending: !!scene.pendingStationId,
      pendingStationId: scene.pendingStationId, feedback: null, setupIssue: null, status: undefined,
      speaker: scene.speaker};
  const {value, pending, unknown} = source.getState(), status = value?.state.status;
  const home = homeConnectionPresentation({status: connection.status, blocked: connection.blocked,
    sessionExpired: connection.sessionExpired, browserOffline: connection.browserOffline});
  return {
    live: true,
    connected: connection.connected && !connection.blocked && !connection.browserOffline,
    blocked: home.reason === 'denied',
    stationId: source.observedStationId(),
    playing: status === 'playing' || status === 'stopped' ? status === 'playing' : null,
    enabled: source.current(),
    canStart: source.canChooseStation(),
    pending: pending || unknown,
    pendingStationId: source.pendingStationChoice(),
    feedback: null,
    setupIssue: source.setupIssue(),
    status,
    speaker: source.targetName(),
  };
}

export const currentRadioInput = () =>
  radioInput(useRadioScene.getState(), radioSource, readConnection());

// A fresh page life (tests; the shell's state lives as long as the page).
export function resetRadioState() {
  sceneSignature = '';
  useRadioScene.setState(EMPTY, true);
  radioSource.invalidate(true);
  ports = {player: () => null, outputs: () => null, dialog: () => null};
}
