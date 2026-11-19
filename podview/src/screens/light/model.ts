// Lys: what the room page (LightRoomView) and the lamp rows (LightLampView) show, read from the shell's state.
// The rules are the old light-room-view.js model() and light-lamp-view.js snapshot(), unchanged: a local example
// is a preview with its own authority (scene-model.js), a live room or lamp is only controllable while its scoped
// Home Assistant observation is current, the transport is connected and the screen may control light; anything
// else is shown honestly as »Status ukendt«, and only a pending command for a room or lamp blocks that one (L1).
import {scopedLightsObservation} from '../../../ha-home-observation.js';
import type {ScopedLightsObservation} from '../../../ha-home-observation.js';
import {lightHomeRestoreAvailable, lightSelection} from '../../../scene-model.js';

export interface LightLamp {
  id?: unknown;
  entityId?: unknown;
  name?: unknown;
  roomId?: unknown;
  roomName?: unknown;
  areaId?: unknown;
  on?: unknown;
  state?: unknown;
  brightness?: unknown;
  dimmable?: unknown;
  supportsBrightness?: unknown;
}

export interface LightDevice {
  id: string;
  kind?: string;
  live?: boolean;
  stale?: boolean;
  pending?: boolean;
  exampleOnly?: boolean;
  status?: string;
  scope?: string;
  revision?: unknown;
  lights: LightLamp[];
  ownRoomId?: string;
  lightScope?: {areaId?: string; areaName?: string} | null;
  lightObservation?: unknown;
  observedLights?: unknown;
}

interface LightAction {
  state?: {pending?: unknown; action?: string};
  queue?: {blocked?: boolean} | null;
}

export interface LightControls {
  lightActions?: Map<string, LightAction>;
  canQueueLightInput?: (target: {areaId: unknown; entityId?: unknown}, kind: string) => unknown;
}

export interface LiveTransport {
  connected?: boolean;
  recoveryBlocked?: boolean;
  generation?: unknown;
}

export interface LightCommandFeedback {
  target?: {areaId?: unknown; entityId?: unknown; sceneId?: unknown} | null;
  action?: string;
  requestedPercent?: unknown;
}

export interface LightHostState {
  sessionId?: unknown;
  focus?: unknown;
  connected?: boolean;
  devices?: LightDevice[];
  lightAreas?: {status?: string; ownAreaId?: unknown; items?: unknown} | null;
  lightPlacement?: {status?: string; areaName?: unknown} | null;
  homeReadStatus?: {light?: string} | null;
}

// What the shell (widget-view.js) offers the light views.
export interface LightHost {
  state?: LightHostState;
  live?: boolean;
  isConnected?: boolean;
  browserOffline?: boolean;
  liveTransport?: LiveTransport | null;
  liveSnapshot?: {
    bootId?: unknown;
    roomId?: unknown;
    sessionId?: unknown;
    taskId?: unknown;
    inputRevision?: unknown;
    providerGeneration?: unknown;
    capabilities?: {controlSetup?: string[]};
  } | null;
  liveControls?: LightControls | null;
  lightAreaPending?: unknown;
  liveHomePending?: unknown;
  lightCommandFeedback?: LightCommandFeedback | null;
  currentLightDevice?: () => LightDevice | null | undefined;
  dispatch?: (event: Record<string, unknown>) => void;
  actCurrentLight?: (action: string, args: Record<string, unknown>, target: Record<string, unknown>) => unknown;
  readLightArea?: (areaId: string) => unknown;
  loadLiveHome?: () => unknown;
  ownerDocument?: Document;
}

// ---- Rooms -----------------------------------------------------------------------------------------------------

export interface RoomRow {
  id: string;
  name: string;
  own: boolean;
  selected: boolean;
  lamps: number | null;
  lampsOn: number | null;
  status: string;
  action: 'turn_on' | 'turn_off' | null;
  enabled: boolean;
  live: boolean;
}

export interface RoomModel {
  live: boolean;
  stale: boolean;
  rows: RoomRow[];
  placement: string;
  globalEnabled: boolean;
  globalRestore?: boolean;
}

interface Area {
  areaId: string;
  areaName: string;
}

const isArea = (row: unknown): row is Area =>
  typeof (row as Partial<Area> | null)?.areaId === 'string' && typeof (row as Partial<Area>).areaName === 'string';

function liveRooms(host: LightHost, light: LightDevice): RoomModel {
  const catalogue = host.state?.lightAreas;
  const items: unknown[] = Array.isArray(catalogue?.items) ? catalogue.items : [];
  const source = !light.stale ? scopedLightsObservation(light.lightObservation) : null;
  const transport = host.liveTransport;
  const connected = !!(host.live && host.isConnected && transport?.connected
    && !transport.recoveryBlocked && !host.browserOffline);
  const permitted = connected && host.liveSnapshot?.capabilities?.controlSetup?.includes('light')
    && !host.lightAreaPending;
  const controls = host.liveControls;
  const rows = items.filter(isArea).map((row): RoomRow => {
    const current = source?.status === 'observed' && source.scope.areaId === row.areaId;
    const known = current && source.items.length > 0
      && source.items.every(item => ['on', 'off'].includes(item.state));
    const on = known ? source.items.filter(item => item.state === 'on').length : null;
    // Only a pending command for this room's own light blocks its tile (L1).
    const pending = controls?.lightActions?.get(JSON.stringify([row.areaId, null, null]))?.state?.pending;
    const enabled = permitted && known
      && (!pending || controls.canQueueLightInput?.({areaId: row.areaId}, 'toggle'));
    return {
      id: row.areaId,
      name: row.areaName,
      own: row.areaId === catalogue?.ownAreaId,
      selected: light.lightScope?.areaId === row.areaId,
      lamps: current ? source.items.length : null,
      lampsOn: on,
      status: known ? (on ? 'Tændt' : 'Slukket') : 'Status ukendt',
      action: known ? (on ? 'turn_off' : 'turn_on') : null,
      enabled: !!enabled,
      live: true,
    };
  });
  const placement = items.filter(isArea).find(row => row.areaId === catalogue?.ownAreaId)?.areaName || '';
  return {live: true, stale: light.stale === true || !connected, rows, placement, globalEnabled: false};
}

interface RoomGroup {
  id: unknown;
  name: unknown;
  lamps: LightLamp[];
}

function localRooms(host: LightHost, light: LightDevice): RoomModel | null {
  const selection = lightSelection(light);
  if (!selection) return null;
  const groups = new Map<unknown, RoomGroup>();
  for (const lamp of light.lights) {
    let group = groups.get(lamp.roomId);
    if (!group) {
      group = {id: lamp.roomId, name: lamp.roomName, lamps: []};
      groups.set(lamp.roomId, group);
    }
    group.lamps.push(lamp);
  }
  const selected = selection.roomId;
  const connected = host.state?.connected === true;
  const known = connected && !light.stale && ['on', 'off', 'mixed'].includes(light.status ?? '');
  const enabled = known && light.exampleOnly === true && !light.pending && host.state?.focus === light.id;
  const rows = [...groups.values()].map((room): RoomRow => {
    const on = room.lamps.filter(row => row.on).length;
    const roomKnown = room.lamps.every(row => row.state === undefined || ['on', 'off'].includes(row.state as string));
    const status = !connected || light.stale ? 'Status ukendt'
      : known && roomKnown ? (on ? 'Tændt' : 'Slukket') : 'Status ukendt';
    return {
      // lightSelection admits only string room ids and names.
      id: room.id as string,
      name: room.name as string,
      own: room.id === light.ownRoomId,
      selected: selected === room.id,
      lamps: room.lamps.length,
      lampsOn: connected && !light.stale && known && roomKnown ? on : null,
      status,
      action: known && roomKnown ? (on ? 'turn_off' : 'turn_on') : null,
      enabled: enabled && roomKnown,
      live: false,
    };
  });
  rows.sort((a, b) => Number(b.id === light.ownRoomId) - Number(a.id === light.ownRoomId));
  const placement = groups.get(light.ownRoomId)?.name;
  return {
    live: false,
    stale: !connected || !!light.stale,
    rows,
    placement: typeof placement === 'string' ? placement : '',
    globalRestore: lightHomeRestoreAvailable(host.state, light),
    globalEnabled: enabled && rows.every(row => row.action !== null) && light.scope === 'home'
      && light.lights.some(row => row.on),
  };
}

export function roomModel(host: LightHost, light: LightDevice | null | undefined): RoomModel | null {
  if (light?.kind !== 'light') return null;
  return light.live === true ? liveRooms(host, light) : localRooms(host, light);
}

// ---- Lamps -----------------------------------------------------------------------------------------------------

export interface LampBinding {
  key: string;
  authorityKey: string;
  canQueueBrightness: unknown;
  local: boolean;
  sessionId: unknown;
  taskId: string;
  revision: unknown;
  optionId: string;
  transport: LiveTransport | null | undefined;
  inputQueue: {blocked?: boolean} | null | undefined;
}

export interface LampRow {
  id: string;
  name: string;
  on: boolean | null;
  level: number | null;
  dimmable: boolean;
  binding: LampBinding | null;
  switchingOn: boolean;
  stale: boolean;
  unavailable: boolean;
  scopeName: string | undefined;
}

const LIGHT_ENTITY = /^light\.[a-z0-9_]+$/;

function lampLevel(local: boolean, row: LightLamp, known: boolean, on: boolean | null): number | null {
  const raw = row.brightness;
  const observed = local ? raw
    : Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= 255
      ? Math.round((raw as number) / 255 * 100) : null;
  if (known && on === false) return 0;
  return known && Number.isFinite(observed) && (observed as number) >= 0 && (observed as number) <= 100
    ? observed as number : null;
}

export function lampRows(host: LightHost, light: LightDevice | null | undefined): LampRow[] {
  const h = host;
  const local = !h.live && light?.exampleOnly === true && light.live !== true;
  const selection = local ? lightSelection(light) : null;
  const source: ScopedLightsObservation | null = light?.live === true
    ? scopedLightsObservation(light.lightObservation) : null;
  const area = local ? selection?.roomId : light?.lightScope?.areaId;
  const scopeName = local ? selection?.label : light?.lightScope?.areaName;
  const connected = h.live === true
    ? h.liveTransport?.connected === true && !h.liveTransport.recoveryBlocked && !h.browserOffline
    : h.state?.connected !== false;
  const active = !!light && h.isConnected !== false && h.state?.focus === light.id && connected && !light.stale
    && !light.pending && !h.lightAreaPending;
  const controls = h.liveControls;
  const authority = local
    ? typeof h.state?.sessionId === 'string' && !!h.state.sessionId && Number.isSafeInteger(light.revision)
      && !!selection && ['on', 'off', 'mixed'].includes(light.status ?? '')
    : h.live === true && !!source && source.status === 'observed' && source.scope.areaId === area
      && h.liveTransport?.connected === true && h.liveSnapshot?.capabilities?.controlSetup?.includes('light');
  let raw: LightLamp[] = [];
  if (local) {
    raw = selection?.kind === 'home' ? light.lights : area ? light.lights.filter(row => row.roomId === area) : [];
  } else if (light?.live === true && Array.isArray(light.observedLights)) {
    raw = (light.observedLights as LightLamp[]).filter(row => row.areaId === area);
  }
  const seen = new Set<string>();
  const rows: LampRow[] = [];
  if (!light) return rows;
  for (const row of raw) {
    const id = local ? row.id : row.entityId;
    if (typeof id !== 'string' || seen.has(id) || (!local && !LIGHT_ENTITY.test(id))) continue;
    seen.add(id);
    const lampName = typeof row.name === 'string' && row.name.trim() ? row.name.slice(0, 160) : 'Lys';
    const name = local && selection?.kind === 'home' ? `${String(row.roomName)} · ${lampName}` : lampName;
    const known = local ? typeof row.on === 'boolean' : row.state === 'on' || row.state === 'off';
    const on = known ? (local ? row.on as boolean : row.state === 'on') : null;
    const dimmable = local ? row.dimmable === true : row.supportsBrightness === true;
    const level = lampLevel(local, row, known, on);
    const snapshot = h.liveSnapshot;
    const owner = JSON.stringify([snapshot?.bootId, snapshot?.roomId, snapshot?.sessionId, snapshot?.taskId,
      snapshot?.inputRevision, snapshot?.providerGeneration, h.liveTransport?.generation]);
    const authorityKey = JSON.stringify([local, h.state?.sessionId, light.id, h.state?.focus, area,
      source?.sourceEpoch, source?.scope.bindingId, source?.scope.placementRevision,
      source?.items.map(item => item.entityId).sort(), dimmable, owner]);
    const key = JSON.stringify([authorityKey, light.revision, on, level]);
    const admitted = local || !!source?.items.some(item => item.entityId === id && item.areaId === area
      && item.state === row.state && item.brightness === row.brightness
      && item.supportsBrightness === row.supportsBrightness);
    // Only a pending command for this lamp blocks it; other lamps stay live (L1).
    const actionKey = JSON.stringify([area, id, null]);
    const pending = !local && controls?.lightActions?.get(actionKey)?.state?.pending;
    const canQueueBrightness = !local && pending
      && controls.canQueueLightInput?.({areaId: area, entityId: id}, 'brightness');
    const binding: LampBinding | null = active && authority && admitted && known && (!pending || canQueueBrightness)
      ? {key, authorityKey, canQueueBrightness, local, sessionId: h.state?.sessionId, taskId: light.id,
        revision: light.revision, optionId: id, transport: h.liveTransport,
        inputQueue: canQueueBrightness ? controls.lightActions?.get(actionKey)?.queue : null}
      : null;
    // A turn-on the user already asked for (this lamp or its room) is pending: the slider takes the level behind it.
    const turningOn = (target: unknown[]) => {
      const state = controls?.lightActions?.get(JSON.stringify(target))?.state;
      return state?.pending === true && state.action === 'turn_on';
    };
    const switchingOn = !local && (turningOn([area, id, null]) || turningOn([area, null, null]));
    const stale = light.stale === true || !connected
      || light.live === true && (!source || !!h.live && h.liveTransport?.connected !== true)
      || local && !['on', 'off', 'mixed'].includes(light.status ?? '');
    rows.push({id, name, on, level, dimmable, binding, switchingOn, stale,
      unavailable: !local && row.state === 'unavailable', scopeName});
  }
  return rows;
}
