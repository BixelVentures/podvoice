// Lys at the wire: Home Assistant's light areas, this screen's placement and the scoped light observation of one
// area (the home read and the area read, podview.home.v1), and the light control offer (podview.control.v1). Ported
// from ha-home-observation.js and control-model.js with the same rules: a payload is admitted only with exactly its
// own fields, fresh (validUntil = observedAt + 15 s) and joined to the catalogue it belongs to; anything else is
// null (an honest unknown). An observation never grants command authority; only an admitted offer can be sent.
import {z} from 'zod';

// ---- Shared field rules ----------------------------------------------------------------------------------------

const finite = (value: unknown, min = 0, max = Infinity): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
// A display text: bounded, trimmed, without control or separator characters other than plain spaces.
const lightText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() &&
  !/[\p{C}\p{Z}]/u.test(value.replaceAll(' ', ''));
const areaId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().refine(value => Number.isSafeInteger(value) && value >= 0);
const text = (max: number) => z.string().refine(value => lightText(value, max));
const ENTITY = /^light\.[a-z0-9_]+$/;

// Fresh now: the server's 15 s window, observed no later than now.
function current(value: {observedAt: unknown; validUntil: unknown}, now: number) {
  return Number.isFinite(now) && finite(value.observedAt) && finite(value.validUntil) &&
    value.validUntil === value.observedAt + 15 && Math.floor(value.observedAt * 1000) <= now &&
    now < value.validUntil * 1000;
}

// ---- Light areas (the Home Assistant area registry, as far as this screen may see it) ---------------------------

export interface LightArea {
  areaId: string;
  areaName: string;
}

export interface ObservedLightAreas {
  status: 'observed';
  source: 'home_assistant_area_registry';
  sourceEpoch: string;
  observedAt: number;
  validUntil: number;
  bindingId: string;
  placementRevision: number;
  ownAreaId: string;
  selectedAreaId: string | null;
  items: LightArea[];
}

export interface MissingLightAreas {
  status: 'unavailable' | 'unbound';
  source: 'home_assistant_area_registry';
  sourceEpoch: null;
  observedAt: null;
  validUntil: null;
  bindingId: null;
  placementRevision: null;
  ownAreaId: null;
  selectedAreaId: null;
  items: [];
}

export type LightAreas = ObservedLightAreas | MissingLightAreas;

const areaRowSchema = z.strictObject({areaId, areaName: text(160)});

const missingAreasSchema = z.strictObject({
  status: z.enum(['unavailable', 'unbound']),
  source: z.literal('home_assistant_area_registry'),
  sourceEpoch: z.null(),
  observedAt: z.null(),
  validUntil: z.null(),
  bindingId: z.null(),
  placementRevision: z.null(),
  ownAreaId: z.null(),
  selectedAreaId: z.null(),
  items: z.tuple([]),
});

const observedAreasSchema = z.strictObject({
  status: z.literal('observed'),
  source: z.literal('home_assistant_area_registry'),
  sourceEpoch: hash,
  observedAt: z.number(),
  validUntil: z.number(),
  bindingId: hash,
  placementRevision: revision,
  ownAreaId: areaId,
  selectedAreaId: areaId.nullable(),
  items: z.array(areaRowSchema).min(1).max(64),
});

export function lightAreasObservation(value: unknown, now = Date.now()): LightAreas | null {
  const missing = missingAreasSchema.safeParse(value);
  if (missing.success) return {...missing.data, items: []};
  const parsed = observedAreasSchema.safeParse(value);
  if (!parsed.success) return null;
  const areas = parsed.data;
  const ids = new Set(areas.items.map(row => row.areaId));
  if (!current(areas, now) || ids.size !== areas.items.length || !ids.has(areas.ownAreaId)) return null;
  if (areas.selectedAreaId !== null && !ids.has(areas.selectedAreaId)) return null;
  return areas;
}

// ---- This screen's placement (the area it is in) --------------------------------------------------------------

export interface BoundLightPlacement {
  status: 'bound';
  areaId: string;
  areaName: string;
  bindingId: string;
  placementRevision: number;
}

export interface MissingLightPlacement {
  status: 'unavailable' | 'unbound';
  areaId: null;
  areaName: null;
  bindingId: null;
  placementRevision: null;
}

export type LightPlacement = BoundLightPlacement | MissingLightPlacement;

const missingPlacementSchema = z.strictObject({
  status: z.enum(['unavailable', 'unbound']),
  areaId: z.null(),
  areaName: z.null(),
  bindingId: z.null(),
  placementRevision: z.null(),
});

const boundPlacementSchema = z.strictObject({
  status: z.literal('bound'),
  areaId,
  areaName: text(160),
  bindingId: hash,
  placementRevision: revision,
});

export function lightPlacementObservation(value: unknown, areas: LightAreas | null = null): LightPlacement | null {
  const missing = missingPlacementSchema.safeParse(value);
  if (missing.success) return !areas || areas.status === missing.data.status ? missing.data : null;
  const parsed = boundPlacementSchema.safeParse(value);
  if (!parsed.success) return null;
  const placement = parsed.data;
  if (areas && (areas.status !== 'observed' || placement.areaId !== areas.ownAreaId ||
    placement.areaName !== areas.items.find(row => row.areaId === placement.areaId)?.areaName ||
    placement.bindingId !== areas.bindingId || placement.placementRevision !== areas.placementRevision)) return null;
  return placement;
}

// ---- Scenes (a passive catalogue: never evidence that a scene is active or offered) -----------------------------

export interface LightSceneDefinition {
  id: string;
  name: string;
  entityIds: string[];
}

const sceneSchema = z.strictObject({
  id: hash,
  name: text(160),
  entityIds: z.array(z.string()).min(1).max(64),
});

export function lightScenesObservation(value: unknown, entityIds: unknown): LightSceneDefinition[] | null {
  if (!Array.isArray(value) || value.length > 64 || !Array.isArray(entityIds)) return null;
  const members = new Set(entityIds), seen = new Set<string>(), scenes: LightSceneDefinition[] = [];
  for (const row of value) {
    const parsed = sceneSchema.safeParse(row);
    if (!parsed.success) return null;
    const scene = parsed.data;
    if (seen.has(scene.id) || new Set(scene.entityIds).size !== scene.entityIds.length ||
      scene.entityIds.some(id => !members.has(id))) return null;
    seen.add(scene.id);
    scenes.push({id: scene.id, name: scene.name, entityIds: [...scene.entityIds]});
  }
  return scenes;
}

// ---- The scoped light observation of one area -----------------------------------------------------------------

export type LampState = 'on' | 'off' | 'unknown' | 'unavailable';

export interface ObservedLight {
  entityId: string;
  areaId: string;
  name: string;
  state: LampState;
  brightness: number | null;
  supportsBrightness: boolean;
}

export interface LightScope {
  kind: 'ha_area';
  areaId: string;
  areaName: string;
  bindingId: string;
  placementRevision: number;
  isOwnArea: boolean;
}

export interface ObservedLights {
  status: 'observed';
  source: 'home_assistant_state';
  sourceEpoch: string;
  observedAt: number;
  validUntil: number;
  scope: LightScope;
  complete: true;
  items: ObservedLight[];
  countUnit: 'light_entities';
  scenes?: LightSceneDefinition[];
}

export interface MissingLights {
  status: 'unavailable' | 'unbound';
  source: 'home_assistant_state';
  sourceEpoch: string | null;
  observedAt: null;
  validUntil: null;
  scope: null;
  complete: false;
  items: [];
  countUnit: 'light_entities';
  scenes?: [];
}

export type ScopedLights = ObservedLights | MissingLights;

const missingLightsSchema = z.strictObject({
  status: z.enum(['unavailable', 'unbound']),
  source: z.literal('home_assistant_state'),
  sourceEpoch: text(256).nullable(),
  observedAt: z.null(),
  validUntil: z.null(),
  scope: z.null(),
  complete: z.literal(false),
  items: z.tuple([]),
  countUnit: z.literal('light_entities'),
  scenes: z.tuple([]).optional(),
});

const lightRowSchema = z.strictObject({
  entityId: z.string().regex(ENTITY),
  areaId: z.string(),
  name: text(160),
  state: z.enum(['on', 'off', 'unknown', 'unavailable']),
  brightness: z.number().int().min(0).max(255).nullable(),
  supportsBrightness: z.boolean(),
});

const observedLightsSchema = z.strictObject({
  status: z.literal('observed'),
  source: z.literal('home_assistant_state'),
  sourceEpoch: text(256),
  observedAt: z.number(),
  validUntil: z.number(),
  scope: z.strictObject({
    kind: z.literal('ha_area'),
    areaId,
    areaName: text(160),
    bindingId: text(256),
    placementRevision: revision,
    isOwnArea: z.boolean(),
  }),
  complete: z.literal(true),
  items: z.array(lightRowSchema).max(64),
  countUnit: z.literal('light_entities'),
  scenes: z.unknown().optional(),
});

export interface LightsJoin {
  now?: number;
  areas?: LightAreas | null;
  placement?: LightPlacement | null;
}

// A `scenes` key that is present must be a scene list, also when it holds undefined.
const scenesPresent = (value: unknown) =>
  !!value && typeof value === 'object' && Object.hasOwn(value, 'scenes');

export function scopedLightsObservation(value: unknown, {now = Date.now(), areas = null, placement = null}:
  LightsJoin = {}): ScopedLights | null {
  const withScenes = scenesPresent(value);
  const missing = missingLightsSchema.safeParse(value);
  if (missing.success) {
    if (withScenes && !Array.isArray(missing.data.scenes)) return null;
    const {scenes, ...rest} = missing.data;
    return {...rest, items: [], ...(scenes ? {scenes: []} : {})};
  }
  const parsed = observedLightsSchema.safeParse(value);
  if (!parsed.success) return null;
  const {scenes: rawScenes, ...lights} = parsed.data;
  const scope = lights.scope;
  if (!current(lights, now)) return null;
  if (areas && (areas.status !== 'observed' || !current(areas, now) || lights.sourceEpoch !== areas.sourceEpoch ||
    scope.areaId !== areas.selectedAreaId ||
    scope.areaName !== areas.items.find(row => row.areaId === scope.areaId)?.areaName ||
    scope.bindingId !== areas.bindingId || scope.placementRevision !== areas.placementRevision ||
    scope.isOwnArea !== (scope.areaId === areas.ownAreaId))) return null;
  if (placement && (placement.status !== 'bound' || scope.bindingId !== placement.bindingId ||
    scope.placementRevision !== placement.placementRevision ||
    scope.isOwnArea !== (scope.areaId === placement.areaId) ||
    scope.isOwnArea && scope.areaName !== placement.areaName)) return null;
  const seen = new Set<string>();
  for (const row of lights.items) {
    if (seen.has(row.entityId) || row.areaId !== scope.areaId) return null;
    seen.add(row.entityId);
  }
  const scenes = withScenes ? lightScenesObservation(rawScenes, [...seen]) : null;
  if (withScenes && !scenes) return null;
  return {...lights, scope: {...scope}, items: lights.items.map(row => ({...row})), ...(scenes ? {scenes} : {})};
}

export interface LightSummary {
  status: 'stale' | 'unavailable' | 'unbound' | 'empty' | 'unknown' | 'on' | 'off' | 'mixed';
  onCount: number | null;
  knownCount: number | null;
  unknownCount: number | null;
  totalCount: number | null;
  countUnit: 'light_entities';
}

export function scopedLightSummary(value: unknown, now = Date.now()): LightSummary {
  const lights = scopedLightsObservation(value, {now});
  if (!lights) {
    const status = (value as {status?: unknown} | null)?.status === 'observed' ? 'stale' : 'unavailable';
    return {status, onCount: null, knownCount: null, unknownCount: null, totalCount: null,
      countUnit: 'light_entities'};
  }
  if (lights.status !== 'observed') {
    return {status: lights.status, onCount: null, knownCount: null, unknownCount: null, totalCount: null,
      countUnit: lights.countUnit};
  }
  const totalCount = lights.items.length, onCount = lights.items.filter(row => row.state === 'on').length;
  const knownCount = lights.items.filter(row => row.state === 'on' || row.state === 'off').length;
  const unknownCount = totalCount - knownCount;
  const status = !totalCount ? 'empty' : unknownCount ? 'unknown' : onCount === totalCount ? 'on'
    : onCount === 0 ? 'off' : 'mixed';
  return {status, onCount, knownCount, unknownCount, totalCount, countUnit: lights.countUnit};
}

// ---- The light device the screens draw (one observed area) ----------------------------------------------------

export interface ObservedLightDevice extends Omit<LightSummary, 'status'> {
  id: 'podview-ha-lights';
  kind: 'light';
  name: string;
  scope: 'ha_area';
  lightScope: LightScope;
  lightSourceEpoch: string;
  lightObservation: ObservedLights;
  validUntil: number;
  live: true;
  source: 'home_assistant_state';
  observedAt: number;
  revision: unknown;
  status: LightSummary['status'];
  displayState: string;
  observedLights: ObservedLight[];
  lightScenes: LightSceneDefinition[];
  pending: null;
  hidden: false;
  timeline: never[];
  stale?: boolean;
}

// The device for one admitted area observation (the own area in the home read, or a browsed area). Whether it is
// the screen's own area for the overview is decided where the home read is applied (home-model.js applyHome).
export function scopedLightDevice(observation: unknown, revision: unknown, now = Date.now()):
  ObservedLightDevice | null {
  const lights = scopedLightsObservation(observation, {now});
  if (lights?.status !== 'observed') return null;
  const summary = scopedLightSummary(lights, now);
  const on = String(summary.onCount), total = String(summary.totalCount), unknown = summary.unknownCount ?? 0;
  const displayState = summary.status === 'empty' ? 'Ingen lys i rummet'
    : unknown ? summary.knownCount
      ? `${on} af ${total} bekræftet tændt · ${String(unknown)} ${unknown === 1 ? 'ukendt' : 'ukendte'}`
      : 'Lysstatus ukendt'
      : `${on} af ${total} tændt`;
  return {
    id: 'podview-ha-lights',
    kind: 'light',
    name: `Lys · ${lights.scope.areaName}`,
    scope: 'ha_area',
    lightScope: lights.scope,
    lightSourceEpoch: lights.sourceEpoch,
    lightObservation: lights,
    validUntil: lights.validUntil,
    live: true,
    source: lights.source,
    observedAt: lights.observedAt,
    revision,
    displayState,
    observedLights: lights.items,
    lightScenes: lights.scenes ?? [],
    ...summary,
    pending: null,
    hidden: false,
    timeline: [],
  };
}

// ---- The light control offer (podview.control.v1, domain light) -----------------------------------------------

export interface LightTarget {
  areaId: string;
  entityId?: string;
  sceneId?: string;
}

export type LightAction = 'turn_on' | 'turn_off' | 'brightness' | 'scene';

export type LightArgsSchema =
  | {kind: 'none'}
  | {kind: 'percent'; min: 0; max: number}
  | {kind: 'choice'; choices: {id: string; label: string}[]};

export interface LightOption {
  id: string;
  label: string;
  action: LightAction;
  argsSchema: LightArgsSchema;
}

export interface LightSetup {
  areaId: string;
  entityIds: string[];
  scope: LightScope;
  sceneId?: string;
  scenes?: LightSceneDefinition[];
}

// What the transport sends an action for (podvoice-transport.js controlAction reads these fields).
export interface LightTask {
  roomId: string;
  bootId: string;
  taskId: string;
  revision: 1;
  expiresAt: number;
  domain: 'light';
  options: LightOption[];
  mapName: null;
  volume: null;
  lightSetup: LightSetup;
}

const shortText = (max: number) => z.string().min(1).max(max);

const optionSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  label: shortText(120),
  action: z.enum(['turn_on', 'turn_off', 'brightness', 'scene']),
  argsSchema: z.unknown(),
});

const setupScopeSchema = z.strictObject({
  kind: z.literal('ha_area'),
  areaId: shortText(128),
  areaName: shortText(128),
  bindingId: hash,
  placementRevision: z.number().refine(value => Number.isSafeInteger(value) && value >= 1),
  isOwnArea: z.boolean(),
});

const taskSchema = z.strictObject({
  ok: z.literal(true),
  schema: z.literal('podview.control.v1'),
  roomId: z.string(),
  bootId: z.string(),
  taskId: z.string().regex(/^control:[a-f0-9]{32}$/),
  revision: z.literal(1),
  expiresAt: z.number().refine(Number.isFinite),
  domain: z.literal('light'),
  options: z.array(optionSchema).min(1).max(3),
  setup: z.strictObject({
    areaId: z.string(),
    entityIds: z.array(z.string().max(255).regex(ENTITY)).min(1).max(64),
    scope: setupScopeSchema,
    sceneId: hash.optional(),
    scenes: z.unknown().optional(),
  }),
});

const noneSchema = z.strictObject({kind: z.literal('none')});
const percentSchema = z.strictObject({kind: z.literal('percent'), min: z.literal(0), max: z.literal(100)});
const choiceSchema = z.strictObject({
  kind: z.literal('choice'),
  choices: z.tuple([z.strictObject({id: z.string(), label: z.string()})]),
});

export class LightTaskError extends Error {
  constructor() {
    super('invalid_control_task');
  }
}

// The offer of one light action, for this boot and room only, or a thrown LightTaskError.
export function readLightTask(raw: unknown, snapshot: {bootId?: unknown; roomId?: unknown} | null,
  now = Date.now()): LightTask {
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) throw new LightTaskError();
  const offer = parsed.data, setup = offer.setup, scene = Object.hasOwn(setup, 'sceneId');
  if (offer.roomId !== snapshot?.roomId || offer.bootId !== snapshot.bootId || offer.taskId.length > 160 ||
    offer.expiresAt * 1000 <= now || Math.floor(offer.expiresAt * 1000) > now + 15000 ||
    setup.areaId !== setup.scope.areaId || scene !== Object.hasOwn(setup, 'scenes') ||
    new Set(setup.entityIds).size !== setup.entityIds.length) throw new LightTaskError();
  const scenes = scene ? lightScenesObservation(setup.scenes, setup.entityIds) : null;
  const only = scenes?.length === 1 ? scenes[0] : undefined;
  if (scene && (!setup.sceneId || only?.id !== setup.sceneId ||
    only.entityIds.length !== setup.entityIds.length)) throw new LightTaskError();
  const allowed: LightAction[] = scene ? ['scene', 'brightness'] : ['turn_on', 'turn_off', 'brightness'];
  const actions = new Set<string>(), ids = new Set<string>();
  const options = offer.options.map((row): LightOption => {
    if (actions.has(row.action) || ids.has(row.id) || !allowed.includes(row.action)) throw new LightTaskError();
    actions.add(row.action);
    ids.add(row.id);
    if (row.action === 'scene') {
      const schema = choiceSchema.safeParse(row.argsSchema);
      const choice = schema.data?.choices[0];
      if (!choice || choice.id !== setup.sceneId || choice.label !== only?.name) throw new LightTaskError();
      return {id: row.id, label: row.label, action: row.action,
        argsSchema: {kind: 'choice', choices: [{id: choice.id, label: choice.label}]}};
    }
    if (row.action === 'brightness') {
      if (!percentSchema.safeParse(row.argsSchema).success) throw new LightTaskError();
      return {id: row.id, label: row.label, action: row.action, argsSchema: {kind: 'percent', min: 0, max: 100}};
    }
    if (!noneSchema.safeParse(row.argsSchema).success) throw new LightTaskError();
    return {id: row.id, label: row.label, action: row.action, argsSchema: {kind: 'none'}};
  });
  return {
    roomId: offer.roomId,
    bootId: offer.bootId,
    taskId: offer.taskId,
    revision: offer.revision,
    expiresAt: offer.expiresAt,
    domain: 'light',
    options,
    mapName: null,
    volume: null,
    lightSetup: {
      areaId: setup.areaId,
      entityIds: [...setup.entityIds],
      scope: {...setup.scope},
      ...(scene && setup.sceneId && scenes ? {sceneId: setup.sceneId, scenes} : {}),
    },
  };
}

export type LightArgs = Record<string, never> | {percent: number} | {choiceId: string};

// The arguments of one offered option, or a thrown Error when the input does not fit its schema.
export function lightArgs(task: LightTask, optionId: string, input: unknown = {}, now = Date.now()): LightArgs {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('unexpected_control_args');
  if (task.expiresAt * 1000 <= now) throw Error('expired_control_task');
  const option = task.options.find(row => row.id === optionId);
  if (!option) throw Error('unknown_control_option');
  const keys = Object.keys(input), values = input as Record<string, unknown>;
  const schema = option.argsSchema;
  if (schema.kind === 'none') {
    if (keys.length) throw Error('unexpected_control_args');
    return {};
  }
  if (schema.kind === 'percent') {
    const percent = values.percent;
    if (keys.some(key => key !== 'percent') || typeof percent !== 'number' || !Number.isInteger(percent) ||
      percent < schema.min || percent > schema.max) throw Error('invalid_volume');
    return {percent};
  }
  const choiceId = values.choiceId;
  if (keys.some(key => key !== 'choiceId') || typeof choiceId !== 'string' ||
    !schema.choices.some(row => row.id === choiceId)) throw Error('invalid_setting_choice');
  return {choiceId};
}

// The answer to a sent action: the transport's receipt, or unknown when it cannot be read.
export interface LightReceipt {
  ok: boolean;
  outcome: 'accepted' | 'rejected' | 'unknown';
  requestId?: string;
}

const receiptSchema = z.looseObject({
  ok: z.boolean(),
  outcome: z.enum(['accepted', 'rejected', 'unknown']),
  requestId: z.string().optional(),
});

export function readLightReceipt(value: unknown): LightReceipt {
  const parsed = receiptSchema.safeParse(value);
  const receipt = parsed.data;
  if (!receipt) return {ok: false, outcome: 'unknown'};
  if (receipt.ok !== (receipt.outcome === 'accepted')) return {ok: false, outcome: 'unknown'};
  return {ok: receipt.ok, outcome: receipt.outcome, ...(receipt.requestId ? {requestId: receipt.requestId} : {})};
}
