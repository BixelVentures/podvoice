// Lys: what the light page shows, as a pure function of the shell's facts (host.ts), the area reads (area.ts) and the
// live commands (commands.ts). The rules are those of the pre-React views, unchanged: a local example is a preview
// with its own authority (scene-model.js), a live room or lamp is only controllable while its scoped Home Assistant
// observation is current, the transport is connected and the screen may control light; anything else is shown
// honestly as »Status ukendt«, and only a pending command for a room or lamp blocks that one (L1).
import {scopedLightsObservation} from '../../lib/api/light';
import type {ObservedLights} from '../../lib/api/light';
import {lightLocalFeedback} from './area';
import type {AreaState, LocalFeedback} from './area';
import {canQueueLightInput, lightActionFeedbackCurrent} from './commands';
import type {ActionState, Entry} from './commands';
import {currentLightDevice, transportLive} from './host';
import type {ExampleLamp, ExampleScene, LightDevice, LightFacts, LightTransport, PreviewReceipt} from './host';
import {lightHomeRestoreAvailable, lightSelection} from './selection';

export interface LightInputs {
  facts: LightFacts;
  area: AreaState;
  entries: ReadonlyMap<string, Entry>;
}

const known = (status: unknown) => status === 'on' || status === 'off' || status === 'mixed';
const observed = (value: unknown): ObservedLights | null => {
  const lights = scopedLightsObservation(value);
  return lights?.status === 'observed' ? lights : null;
};
const entryOf = (entries: ReadonlyMap<string, Entry>, target: unknown[]) => entries.get(JSON.stringify(target));
const local = (facts: LightFacts, light: LightDevice | null | undefined) =>
  !facts.live && light?.exampleOnly === true && light.live !== true;

// The scene event binding of a device (scene-model.js binding).
export const sceneBinding = (facts: LightFacts, light: LightDevice) =>
  ({sessionId: facts.state.sessionId, taskId: light.id, revision: light.revision});

// ---- The command a control shows progress for -----------------------------------------------------------------

export type Receipt = ActionState | PreviewReceipt;

// The receipt of the newest command in the shown area while it is preparing or sending (live), or the local
// preview's stand-in; null otherwise.
export function commandFeedback({facts, entries}: LightInputs, light: LightDevice | null | undefined):
  Receipt | null {
  const example = local(facts, light), selection = example ? lightSelection(light) : null;
  const area = example ? selection?.roomId : light?.lightScope?.areaId;
  const preview = example && light?.feedbackPreview?.revision === light?.revision ? light?.feedbackPreview : null;
  const latest = facts.live ? [...entries.values()].findLast(entry => entry.state?.target.areaId === area) : null;
  const receipt: Receipt | null | undefined = facts.live ? latest?.state : preview;
  const current = !!light && !!receipt && !receipt.late && !light.stale && receipt.target?.areaId === area &&
    (!facts.live || lightActionFeedbackCurrent(latest?.feedback));
  const phase = current ? receipt.phase : '';
  return receipt && (phase === 'preparing' || phase === 'sending') ? receipt : null;
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

function liveRooms({facts, area, entries}: LightInputs, light: LightDevice): RoomModel {
  const catalogue = facts.state.lightAreas as {items?: unknown; ownAreaId?: unknown} | null | undefined;
  const items: unknown[] = Array.isArray(catalogue?.items) ? catalogue.items : [];
  const source = !light.stale ? observed(light.lightObservation) : null;
  const connected = facts.live && facts.isConnected && transportLive(facts);
  const permitted = connected && facts.snapshot?.capabilities?.controlSetup?.includes('light') && !area.pending;
  const rows = items.filter(isArea).map((row): RoomRow => {
    const current = source?.scope.areaId === row.areaId;
    const sure = !!source && current && source.items.length > 0 &&
      source.items.every(item => item.state === 'on' || item.state === 'off');
    const on = sure ? source.items.filter(item => item.state === 'on').length : null;
    // Only a pending command for this room's own light blocks its tile (L1).
    const pending = entryOf(entries, [row.areaId, null, null])?.state?.pending;
    const enabled = permitted && sure && (!pending || canQueueLightInput({areaId: row.areaId}, 'toggle'));
    return {
      id: row.areaId,
      name: row.areaName,
      own: row.areaId === catalogue?.ownAreaId,
      selected: light.lightScope?.areaId === row.areaId,
      lamps: current ? source.items.length : null,
      lampsOn: on,
      status: sure ? on ? 'Tændt' : 'Slukket' : 'Status ukendt',
      action: sure ? on ? 'turn_off' : 'turn_on' : null,
      enabled: !!enabled,
      live: true,
    };
  });
  const placement = items.filter(isArea).find(row => row.areaId === catalogue?.ownAreaId)?.areaName || '';
  return {live: true, stale: light.stale === true || !connected, rows, placement, globalEnabled: false};
}

interface RoomGroup {
  id: string;
  name: string;
  lamps: ExampleLamp[];
}

function localRooms({facts}: LightInputs, light: LightDevice): RoomModel | null {
  const selection = lightSelection(light);
  if (!selection) return null;
  const lamps = light.lights ?? [];
  const groups = new Map<string, RoomGroup>();
  for (const lamp of lamps) {
    let group = groups.get(lamp.roomId);
    if (!group) {
      group = {id: lamp.roomId, name: lamp.roomName, lamps: []};
      groups.set(lamp.roomId, group);
    }
    group.lamps.push(lamp);
  }
  const connected = facts.state.connected === true;
  const sure = connected && !light.stale && known(light.status);
  const enabled = sure && light.exampleOnly === true && !light.pending && facts.state.focus === light.id;
  const rows = [...groups.values()].map((room): RoomRow => {
    const on = room.lamps.filter(row => row.on).length;
    const roomKnown = room.lamps.every(row => row.state === undefined || row.state === 'on' || row.state === 'off');
    return {
      id: room.id,
      name: room.name,
      own: room.id === light.ownRoomId,
      selected: selection.roomId === room.id,
      lamps: room.lamps.length,
      lampsOn: connected && !light.stale && sure && roomKnown ? on : null,
      status: !connected || light.stale ? 'Status ukendt' : sure && roomKnown ? on ? 'Tændt' : 'Slukket'
        : 'Status ukendt',
      action: sure && roomKnown ? on ? 'turn_off' : 'turn_on' : null,
      enabled: enabled && roomKnown,
      live: false,
    };
  });
  rows.sort((a, b) => Number(b.id === light.ownRoomId) - Number(a.id === light.ownRoomId));
  const placement = light.ownRoomId ? groups.get(light.ownRoomId)?.name : undefined;
  return {
    live: false,
    stale: !connected || !!light.stale,
    rows,
    placement: placement ?? '',
    globalRestore: lightHomeRestoreAvailable(facts.state, light),
    globalEnabled: enabled && rows.every(row => row.action !== null) && light.scope === 'home' &&
      lamps.some(row => row.on),
  };
}

export function roomModel(inputs: LightInputs, light: LightDevice | null | undefined): RoomModel | null {
  if (light?.kind !== 'light') return null;
  return light.live === true ? liveRooms(inputs, light) : localRooms(inputs, light);
}

// ---- Lamps -----------------------------------------------------------------------------------------------------

// The authority a lamp's control was drawn with; a tap or a released gesture acts only while it is still current.
export interface LampBinding {
  key: string;
  authorityKey: string;
  canQueueBrightness: boolean;
  local: boolean;
  sessionId: unknown;
  taskId: string;
  revision: unknown;
  optionId: string;
  transport: LightTransport | null;
  inputQueue: {blocked?: boolean | undefined} | null | undefined;
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

interface Lamp {
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

const LIGHT_ENTITY = /^light\.[a-z0-9_]+$/;

function lampLevel(example: boolean, row: Lamp, sure: boolean, on: boolean | null): number | null {
  const raw = row.brightness;
  const level = example ? raw
    : typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 255 ? Math.round(raw / 255 * 100) : null;
  if (sure && on === false) return 0;
  return sure && typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 100 ? level : null;
}

export function lampRows({facts, area, entries}: LightInputs, light: LightDevice | null | undefined): LampRow[] {
  const example = !facts.live && light?.exampleOnly === true && light.live !== true;
  const selection = example ? lightSelection(light) : null;
  const source = light?.live === true ? observed(light.lightObservation) : null;
  const areaId = example ? selection?.roomId : light?.lightScope?.areaId;
  const scopeName = example ? selection?.label : light?.lightScope?.areaName;
  const connected = facts.live ? transportLive(facts) : facts.state.connected !== false;
  const active = !!light && facts.isConnected && facts.state.focus === light.id && connected && !light.stale &&
    !light.pending && !area.pending;
  const authority = example
    ? typeof facts.state.sessionId === 'string' && !!facts.state.sessionId && Number.isSafeInteger(light.revision) &&
      !!selection && known(light.status)
    : facts.live && !!source && source.scope.areaId === areaId && facts.transport?.connected === true &&
      facts.snapshot?.capabilities?.controlSetup?.includes('light') === true;
  let raw: Lamp[] = [];
  if (example) {
    const lamps: Lamp[] = light.lights ?? [];
    raw = selection?.kind === 'home' ? lamps : areaId ? lamps.filter(row => row.roomId === areaId) : [];
  } else if (light?.live === true && Array.isArray(light.observedLights)) {
    raw = (light.observedLights as Lamp[]).filter(row => row.areaId === areaId);
  }
  const rows: LampRow[] = [];
  if (!light) return rows;
  const seen = new Set<string>(), snapshot = facts.snapshot;
  const owner = JSON.stringify([snapshot?.bootId, snapshot?.roomId, snapshot?.sessionId, snapshot?.taskId,
    snapshot?.inputRevision, snapshot?.providerGeneration, facts.transport?.generation]);
  for (const row of raw) {
    const id = example ? row.id : row.entityId;
    if (typeof id !== 'string' || seen.has(id) || !example && !LIGHT_ENTITY.test(id)) continue;
    seen.add(id);
    const lampName = typeof row.name === 'string' && row.name.trim() ? row.name.slice(0, 160) : 'Lys';
    const name = example && selection?.kind === 'home' ? `${String(row.roomName)} · ${lampName}` : lampName;
    const sure = example ? typeof row.on === 'boolean' : row.state === 'on' || row.state === 'off';
    const on = sure ? example ? row.on === true : row.state === 'on' : null;
    const dimmable = example ? row.dimmable === true : row.supportsBrightness === true;
    const level = lampLevel(example, row, sure, on);
    const authorityKey = JSON.stringify([example, facts.state.sessionId, light.id, facts.state.focus, areaId,
      source?.sourceEpoch, source?.scope.bindingId, source?.scope.placementRevision,
      source?.items.map(item => item.entityId).sort(), dimmable, owner]);
    const key = JSON.stringify([authorityKey, light.revision, on, level]);
    const admitted = example || !!source?.items.some(item => item.entityId === id && item.areaId === areaId &&
      item.state === row.state && item.brightness === row.brightness &&
      item.supportsBrightness === row.supportsBrightness);
    // Only a pending command for this lamp blocks it; other lamps stay live (L1).
    const pending = !example && entryOf(entries, [areaId, id, null])?.state?.pending === true;
    const canQueueBrightness = !example && pending && canQueueLightInput({areaId, entityId: id}, 'brightness');
    const binding: LampBinding | null = active && authority && admitted && sure && (!pending || canQueueBrightness)
      ? {key, authorityKey, canQueueBrightness, local: example, sessionId: facts.state.sessionId, taskId: light.id,
        revision: light.revision, optionId: id, transport: facts.transport,
        inputQueue: canQueueBrightness ? entryOf(entries, [areaId, id, null])?.queue : null}
      : null;
    // A turn-on the user already asked for (this lamp or its room) is pending: the slider takes the level behind it.
    const turningOn = (target: unknown[]) => {
      const state = entryOf(entries, target)?.state;
      return state?.pending === true && state.action === 'turn_on';
    };
    const switchingOn = !example && (turningOn([areaId, id, null]) || turningOn([areaId, null, null]));
    const stale = light.stale === true || !connected ||
      light.live === true && (!source || facts.live && facts.transport?.connected !== true) ||
      example && !known(light.status);
    rows.push({id, name, on, level, dimmable, binding, switchingOn, stale,
      unavailable: !example && row.state === 'unavailable', scopeName});
  }
  return rows;
}

export const sameBinding = (a: LampBinding | null | undefined, b: LampBinding | null | undefined) =>
  a?.key === b?.key && a?.transport === b?.transport;

// A brightness queued behind a pending command stays editable while its authority is unchanged.
export const sameQueuedBinding = (wish: LampBinding | null | undefined, current: LampBinding | null | undefined) =>
  wish?.canQueueBrightness === true && wish.inputQueue?.blocked !== true && !!current &&
  wish.authorityKey === current.authorityKey && wish.transport === current.transport;

export interface SliderModel {
  value: number | null;
  valueText?: string;
  scope?: string;
  disabled?: boolean;
  pending?: boolean;
  mixed?: boolean;
  editableWhilePending?: boolean;
}

// What one lamp row shows.
export interface LampFace {
  id: string;
  name: string;
  state: string;
  label: string;
  busy: boolean;
  disabled: boolean;
  checked: boolean | null;
  levelHidden: boolean;
  live: boolean;
  binding: LampBinding | null;
  slider: SliderModel;
}

export function lampFaces(rows: LampRow[], command: Receipt | null): LampFace[] {
  return rows.map(row => {
    const binding = row.binding;
    const busy = !!command && command.target?.entityId === row.id &&
      (command.action === 'turn_on' || command.action === 'turn_off');
    const status = row.on === null ? row.unavailable ? 'Ikke tilgængelig' : 'Status ukendt'
      : row.stale ? `${row.on ? 'Tændt' : 'Slukket'} · ikke opdateret` : row.on ? 'Tændt' : 'Slukket';
    // The toggle is enabled exactly when the lamp has a binding and no brightness is queued behind a pending command.
    const disabled = !binding || binding.canQueueBrightness;
    const pending = command?.action === 'brightness' && command.target?.entityId === row.id;
    const requested = (command as ActionState | null)?.requestedPercent;
    const value = pending && typeof requested === 'number' && Number.isInteger(requested) ? requested : row.level;
    // Lærred »A-Lys« v193: the level sits beside the slider in mono; a lamp that is off or whose state is unknown
    // keeps its slider dimmed and inert (switch it on first; a pending turn-on counts). Unknown »—«, off »0 %«.
    const live = (row.on === true || row.switchingOn) && !row.stale;
    return {
      id: row.id,
      name: row.name,
      state: status,
      label: `Tænd/sluk ${row.name}`,
      busy: busy && !!binding,
      disabled,
      checked: row.on,
      levelHidden: !row.dimmable,
      live,
      binding,
      slider: {value, valueText: value === null || row.stale ? '—' : `${String(value)} %`, scope: '',
        disabled: !binding || !row.dimmable || row.level === null || !live, pending,
        editableWhilePending: binding?.canQueueBrightness === true},
    };
  });
}

// ---- Scenes ----------------------------------------------------------------------------------------------------

export interface SceneChip {
  id: string;
  name: string;
  level: string;
  selected: boolean;
  loading: boolean;
  description: string;
  binding: {sessionId: unknown; taskId: string; revision: unknown; optionId: string};
}

export interface SceneLevelBinding {
  sessionId: unknown;
  taskId: string;
  revision: unknown;
  roomId?: unknown;
  optionId: string | null;
}

export interface ScenesModel {
  visible: boolean;
  chips: SceneChip[];
  enabled: boolean;
  binding: SceneLevelBinding | null;
  slider: SliderModel;
  // The level of a room's lamps relative to the brightest one (local preview), read out as such.
  ariaValueText: string | null;
}

interface LevelLamp {
  id: string;
  roomId?: unknown;
  on: boolean | null;
  brightness: number | null;
  dimmable: boolean;
}

export function scenesModel(inputs: LightInputs, light: LightDevice | null | undefined,
  command: Receipt | null): ScenesModel {
  const {facts, area, entries} = inputs;
  const example = local(facts, light), selection = example ? lightSelection(light) : null;
  const areaId = example ? selection?.roomId : light?.lightScope?.areaId;
  const all = (light?.lightScenes ?? []) as ExampleScene[];
  const scenes = all.filter(row => !example || row.roomId === areaId);
  const visible = !!light && !!scenes.length && (!example || selection?.kind === 'room');
  const hidden: ScenesModel = {visible: false, chips: [], enabled: false, binding: null, slider: {value: null},
    ariaValueText: null};
  if (!visible) return hidden;
  const selected = example ? areaId ? light.lightSceneSelections?.[areaId] : undefined
    : area.sceneRecent?.area === areaId ? area.sceneRecent : null;
  const chosen = scenes.find(row => row.id === selected?.id);
  const connected = facts.live ? facts.transport?.connected === true : facts.state.connected === true;
  const pending = !!(light.pending || area.pending || [...entries.values()].some(entry => entry.state?.pending &&
    entry.state.target.areaId === areaId && !entry.state.target.entityId));
  const enabled = (example || facts.live) && connected && !light.stale && !pending && known(light.status) &&
    (!facts.live || facts.snapshot?.capabilities?.controlSetup?.includes('light') === true);
  const chips = scenes.map((scene): SceneChip => {
    const levels = Object.values(scene.levels ?? {}), first = levels[0];
    const level = levels.length && levels.every(value => Number.isInteger(value) && value === first)
      ? `${String(first)} %` : '';
    const loading = !!command && command.action === 'scene' && command.target?.sceneId === scene.id;
    const phase = command?.phase;
    return {
      id: scene.id,
      name: scene.name,
      level,
      selected: chosen?.id === scene.id,
      loading,
      description: loading ? phase === 'preparing' ? 'Forbereder handling' : 'Afventer svar'
        : chosen?.id === scene.id ? 'Valgt scene til lysstyrkejustering' : 'Vælg scene',
      binding: {sessionId: facts.state.sessionId, taskId: light.id, revision: light.revision, optionId: scene.id},
    };
  });
  const lamps: LevelLamp[] = example
    ? (light.lights ?? []).map(row => ({id: row.id, roomId: row.roomId, on: row.on,
      brightness: typeof row.brightness === 'number' ? row.brightness : null, dimmable: row.dimmable === true}))
    : (light.observedLights ?? []).map(row => ({id: row.entityId,
      on: row.state === 'on' ? true : row.state === 'off' ? false : null,
      brightness: typeof row.brightness === 'number' && Number.isFinite(row.brightness)
        ? Math.round(row.brightness / 255 * 100) : null,
      dimmable: row.supportsBrightness}));
  const members = example ? lamps.filter(row => row.roomId === areaId)
    : chosen ? lamps.filter(row => chosen.entityIds?.includes(row.id)) : [];
  const levels = members.map(row => row.on === false ? 0 : row.on === true ? row.brightness : null);
  const complete = example ? members.length > 0 : !!chosen && members.length === chosen.entityIds?.length;
  const sure = complete && levels.length > 0 && levels.every(value => Number.isInteger(value));
  const firstLevel = levels[0] ?? null;
  const uniform = sure && levels.every(value => value === firstLevel);
  const level = sure ? example ? Math.max(...levels as number[]) : uniform ? firstLevel : null : null;
  const binding: SceneLevelBinding | null = example && complete
    ? {sessionId: facts.state.sessionId, taskId: light.id, revision: light.revision, roomId: areaId,
      optionId: chosen?.id || null}
    : chosen ? {sessionId: facts.state.sessionId, taskId: light.id, revision: light.revision, optionId: chosen.id}
      : null;
  return {
    visible,
    chips,
    enabled,
    binding,
    slider: {
      value: level,
      valueText: sure && level !== null ? `${String(level)} %` : !chosen && !example ? 'Vælg scene'
        : complete && !uniform ? 'Forskellige niveauer' : 'Niveau ukendt',
      scope: '',
      mixed: complete && !uniform,
      disabled: !enabled || !complete || members.some(row => !row.dimmable || typeof row.on !== 'boolean'),
      pending,
    },
    ariaValueText: example && sure && !uniform
      ? `${String(level)} procent af maksimal lysstyrke. Relative niveauer bevares` : null,
  };
}

// ---- The page's status line ------------------------------------------------------------------------------------

export function statusLine(inputs: LightInputs, light: LightDevice | null | undefined): LocalFeedback {
  const {facts, area} = inputs;
  const preview = local(facts, light) && light?.feedbackPreview?.revision === light?.revision
    ? light?.feedbackPreview : null;
  if (preview && (preview.phase === 'unknown' || preview.phase === 'rejected') &&
    preview.target?.areaId === lightSelection(light)?.roomId) {
    return preview.phase === 'unknown' ? {state: 'unknown', text: 'Lysets tilstand er ikke bekræftet.'}
      : {state: 'error', text: 'Den seneste lysændring blev afvist.'};
  }
  return lightLocalFeedback(area, light, facts);
}

// ---- The whole page --------------------------------------------------------------------------------------------

export interface RoomFace {
  id: string;
  tag: string;
  name: string;
  status: string;
  selected: boolean;
  powerOn: boolean;
  // aria-pressed on the switch; null when the room's state is unknown (no attribute).
  pressed: boolean | null;
  powerLabel: string;
  enabled: boolean;
  busy: boolean;
}

export interface LightPage {
  deviceId: string;
  // No rooms: »Ikke forbundet« or an honest read/access problem.
  empty: boolean;
  stale: boolean;
  live: boolean;
  rooms: RoomFace[];
  selected: RoomRow | undefined;
  headingText: string;
  statusText: string;
  kickerText: string;
  emptyText: string;
  refreshDisabled: boolean;
  homeEnabled: boolean;
  homeLabel: string;
  homeTitle: string;
  lampCount: string;
  status: LocalFeedback;
  scenes: ScenesModel;
  lamps: LampFace[];
}

export function lightPage(inputs: LightInputs): LightPage | null {
  const {facts} = inputs;
  const light = currentLightDevice(facts.state, facts.live);
  if (light?.kind !== 'light') return null;
  const model = roomModel(inputs, light);
  const command = commandFeedback(inputs, light);
  const scenes = scenesModel(inputs, light, command);
  const lamps = lampFaces(lampRows(inputs, light), command);
  const status = statusLine(inputs, light);
  const base = {deviceId: light.id, stale: !!model?.stale, live: !!model?.live, status, scenes, lamps,
    homeEnabled: false, homeLabel: '', homeTitle: '', lampCount: '', statusText: '', kickerText: '', emptyText: '',
    refreshDisabled: false, selected: undefined, rooms: []};
  if (!model?.rows.length) {
    const state = facts.state;
    const placement = state.lightPlacement, catalogue = state.lightAreas;
    const unbound = placement?.status === 'unbound' || catalogue?.status === 'unbound';
    const read = state.homeReadStatus?.light;
    const copy = !unbound && read === 'denied'
      ? 'Adgang til lysoplysninger mangler. Kontrollér adgangen i Home Assistant.'
      : !unbound && (read === 'error' || catalogue?.status === 'unavailable')
        ? 'Lysoplysninger kunne ikke hentes. Prøv igen, når forbindelsen er klar.' : '';
    const place = placement?.areaName;
    return {...base, empty: true, headingText: copy ? 'Lys' : 'Ikke forbundet',
      emptyText: copy || 'Forbind lys i Home Assistant for at se og styre dem her.',
      kickerText: typeof place === 'string' && place ? `${place} · denne skærms rum` : '',
      refreshDisabled: !(facts.live && facts.transport?.connected === true && !facts.liveHomePending)};
  }
  const rooms = model.rows.map((row): RoomFace => ({
    id: row.id,
    tag: row.own ? 'Denne skærms rum' : 'Rum',
    name: row.name,
    status: row.status,
    selected: row.selected,
    powerOn: row.action === 'turn_off',
    pressed: row.action ? row.action === 'turn_off' : null,
    powerLabel: row.action ? `${row.action === 'turn_off' ? 'Sluk' : 'Tænd'} alle lys i ${row.name}`
      : `Lys i ${row.name} kræver aktuel status`,
    enabled: row.enabled,
    busy: !!command && command.target?.areaId === row.id && !command.target.sceneId && !command.target.entityId &&
      (command.action === 'turn_on' || command.action === 'turn_off') && row.enabled,
  }));
  const selected = model.rows.find(row => row.selected);
  const counted = Number.isInteger(selected?.lamps) && Number.isInteger(selected?.lampsOn);
  return {
    ...base,
    empty: false,
    rooms,
    selected,
    headingText: selected?.name || 'Lys',
    statusText: counted && selected ? `${String(selected.lampsOn)} af ${String(selected.lamps)} lamper tændt`
      : selected?.status || '',
    emptyText: 'Der er ingen scener tilgængelige i dette rum.',
    homeEnabled: !!(model.globalEnabled || model.globalRestore),
    homeLabel: model.globalRestore ? 'Gendan lys' : 'Sluk alt',
    homeTitle: model.globalRestore ? 'Gendan lyset i hjemmet som før slukning' : 'Sluk alle lys i hjemmet',
    lampCount: Number.isInteger(selected?.lamps) ? `${String(selected?.lamps)} stk.` : '',
  };
}

// The live »Opdater lys« under the page: shown for an observed area, usable while the transport is connected and no
// read is under way.
export function refreshModel(inputs: LightInputs): {hidden: boolean; disabled: boolean} {
  const {facts, area} = inputs;
  const light = currentLightDevice(facts.state, facts.live);
  return {hidden: !light?.lightScope?.areaId,
    disabled: facts.transport?.connected !== true || area.pending || facts.liveHomePending};
}
