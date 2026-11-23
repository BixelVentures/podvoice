// Lys: the live light commands (ported from live-control-view.js lightActionContext, actLight, submitLightInput,
// sendLightOperation and widget-view.js actCurrentLight / onLightActionStatus, with the same rules, L1):
// - A tap is a wish for one target (an area, a lamp or a scene) bound to the observation it was made on: its area,
//   source epoch, members and the transport generation. It is sent only through an offer read for exactly that
//   target, once; nothing is shown as done before an area read observes it.
// - Each target keeps its own state (the latest update moves last); only a pending command for a target blocks that
//   target. One broker slot serves each area: a lamp in the same area waits for the previous intent, and an intent
//   whose lamps overlap an unknown or unobserved earlier one is refused (»Hent aktuel lysstatus ...«).
// - Taps during a command queue instead of locking: another toggle follows the first once it is observed; for
//   brightness the last wish wins (only the latest queued value is sent). A queue stops at the first outcome that is
//   not observed as wished.
// - An unknown outcome is never resent: the target stays fenced until a newer observation of the same source, and the
//   page says so until then (area.ts actionProblem) with one toast.
import {create} from 'zustand';
import {lightArgs, readLightReceipt, readLightTask, scopedLightsObservation} from '../../lib/api/light';
import type {
  LightReceipt,
  LightSceneDefinition,
  LightScope,
  LightTarget,
  LightTask,
  ObservedLights,
} from '../../lib/api/light';
import {lightAreaContext, lightAreaPending, readLightArea, setActionProblem, useLightArea} from './area';
import {controlAllowed, currentLightDevice, lightPorts} from './host';
import type {LightFacts, LightJournal, LightTransport} from './host';

export type LightKind = 'toggle' | 'turn_on' | 'turn_off' | 'brightness' | 'scene';
export type Phase = 'preparing' | 'sending' | 'accepted' | 'rejected' | 'unknown';

// The observation a command is bound to, and whether it is still the current one.
export interface LightContext {
  transport: LightTransport;
  ownerKey: string;
  sourceObservedAt: number;
  observation: () => unknown;
  brightnessPercent: number | null;
  scene: LightSceneDefinition | null;
  title: string;
  sourceEpoch: string;
  scope: LightScope;
  ids: string[];
  brightness: boolean;
  current: () => boolean;
}

export interface Operation {
  target: LightTarget;
  action: LightKind;
  context: LightContext;
  identity: string;
  sent: boolean;
  revoked: boolean;
  requestedPercent: number | undefined;
  observedBeforeSend?: number;
  label?: string;
  feedbackPhase?: Phase;
}

export interface ActionState {
  target: LightTarget;
  action: LightKind;
  phase: Phase;
  pending: boolean;
  message: string;
  requestedPercent?: number | undefined;
  outcome?: string;
  requestId?: string | undefined;
  refreshed?: boolean;
  late?: boolean;
  observedBeforeSend?: number | undefined;
}

export interface InputQueue {
  target: LightTarget;
  kind: 'toggle' | 'brightness';
  context: LightContext;
  pending: (number | null)[];
  blocked?: boolean;
}

// One target's command: the operation under way, the latest state and its producer, and the taps queued behind it.
export interface Entry {
  operation?: Operation | null;
  feedback?: Operation;
  state?: ActionState;
  queue?: InputQueue | null;
}

export interface Outcome {
  outcome: string;
  phase: Phase;
  pending: boolean;
  refreshed: boolean;
  action?: LightKind;
  late?: boolean;
  requestId?: string | undefined;
  observedBeforeSend?: number | undefined;
}

interface Completion {
  ids: string[];
  observedBeforeSend: number;
  refreshed: boolean;
  unknown: boolean;
}

interface Fence {
  sourceEpoch: string;
  observedAt: number;
  until: number;
}

// The entries by target (JSON [areaId, entityId|null, sceneId|null]), in the order they were last updated. The
// entries themselves are the command's own records; the map is published anew on every change so the page redraws.
export const useLightCommands = create<{entries: ReadonlyMap<string, Entry>}>(() => ({entries: new Map()}));

let entries = new Map<string, Entry>();
const unknowns = new Map<string, Fence>();
const lanes = new Map<string, Promise<Completion | null | undefined>>();
let suspending = false;

const publish = () => {
  useLightCommands.setState({entries: new Map(entries)});
};

const facts = () => lightPorts().facts();
const journal = (): LightJournal | null => lightPorts().journal();
const record = (transport: LightTransport | null, stage: string, fields: Record<string, unknown>) => {
  try {
    journal()?.journalDevice(transport, stage, fields);
  } catch {
    // Diagnostics never own dispatch or presentation.
  }
};

const keyOf = (target: {areaId?: unknown; entityId?: unknown; sceneId?: unknown}) =>
  JSON.stringify([target.areaId, target.entityId ?? null, target.sceneId ?? null]);
const inputKey = (target: {areaId?: unknown; entityId?: unknown}) =>
  JSON.stringify([target.areaId, target.entityId ?? null, null]);
const allowed = (current: LightFacts) => current.transport?.connected === true && controlAllowed(current);
const percentOf = (brightness: number | null) => brightness === null ? null : Math.round(brightness / 255 * 100);
const observe = (value: unknown) => {
  const lights = scopedLightsObservation(value);
  return lights?.status === 'observed' ? lights : null;
};
// The shared control owner is busy with a dialog of its own (music or robot).
const ownerBusy = () => {
  const owner = journal();
  return !!owner?.pending || !!owner?.setupPending;
};

export const lightActionEntries = () => entries;

// The command context of one target on the observation it is made on, or null/false when it cannot be made.
export function lightActionContext(target: LightTarget, observation: unknown, currentObservation: () => unknown):
  LightContext | null | false {
  const start = facts();
  const shape = Object.hasOwn(target, 'sceneId') ? 'areaId,sceneId'
    : Object.hasOwn(target, 'entityId') ? 'areaId,entityId' : 'areaId';
  if (!allowed(start) || !start.isConnected || typeof currentObservation !== 'function' ||
    Object.keys(target).sort().join(',') !== shape) return false;
  const source = scopedLightsObservation(observation), transport = start.transport;
  if (!transport || source?.status !== 'observed' || source.scope.areaId !== target.areaId || !source.items.length) {
    return false;
  }
  const transportGeneration = transport.generation;
  const scene = Object.hasOwn(target, 'sceneId') ? source.scenes?.find(row => row.id === target.sceneId) : null;
  if (Object.hasOwn(target, 'sceneId') && !scene) return false;
  const selected = source.items.filter(row => scene ? scene.entityIds.includes(row.entityId)
    : !Object.hasOwn(target, 'entityId') || row.entityId === target.entityId);
  if (!selected.length || selected.some(row => row.state !== 'on' && row.state !== 'off')) return false;
  const ids = selected.map(row => row.entityId).sort(), scope = source.scope;
  const members = JSON.stringify(source.items.map(row => row.entityId).sort());
  const owner = () => {
    const now = facts();
    return JSON.stringify([now.snapshot?.bootId, now.snapshot?.roomId, now.state.focus]);
  };
  const ownerKey = owner();
  const levels = selected.map(row => row.state === 'off' ? 0 : percentOf(row.brightness));
  const first = levels[0] ?? null;
  const context: LightContext = {
    transport,
    ownerKey,
    sourceObservedAt: source.observedAt,
    observation: currentObservation,
    brightnessPercent: levels.every(value => value !== null && value === first) ? first : null,
    scene: scene ? structuredClone(scene) : null,
    title: scene ? `${scope.areaName} · ${scene.name}`
      : Object.hasOwn(target, 'entityId') ? `${scope.areaName} · ${selected[0]?.name ?? ''}` : `Lys · ${scope.areaName}`,
    sourceEpoch: source.sourceEpoch,
    scope,
    ids,
    brightness: selected.every(row => row.supportsBrightness),
    current: () => {
      let now: ObservedLights | null;
      try {
        now = observe(currentObservation());
      } catch {
        return false;
      }
      const host = facts();
      return host.isConnected && host.transport === transport && transport.generation === transportGeneration &&
        allowed(host) && owner() === ownerKey && !!now && now.sourceEpoch === source.sourceEpoch &&
        (!scene || JSON.stringify(now.scenes?.find(row => row.id === scene.id)) === JSON.stringify(scene)) &&
        (Object.keys(scope) as (keyof LightScope)[]).every(key => now.scope[key] === scope[key]) &&
        JSON.stringify(now.items.map(row => row.entityId).sort()) === members &&
        ids.every(id => now.items.some(row => row.entityId === id && (row.state === 'on' || row.state === 'off') &&
          row.supportsBrightness === selected.find(item => item.entityId === id)?.supportsBrightness));
    },
  };
  return context.current() ? context : null;
}

function taskCurrent(context: LightContext, task: LightTask) {
  const setup = task.lightSetup;
  return context.current() && (setup.sceneId ?? null) === (context.scene?.id ?? null) &&
    (!context.scene || JSON.stringify(setup.scenes) === JSON.stringify([context.scene])) &&
    (Object.keys(context.scope) as (keyof LightScope)[]).every(key => setup.scope[key] === context.scope[key]) &&
    JSON.stringify([...setup.entityIds].sort()) === JSON.stringify(context.ids) &&
    (!task.options.some(option => option.action === 'brightness') || context.brightness) &&
    task.options.every(option => option.action !== 'scene' || !!context.scene &&
      option.argsSchema.kind === 'choice' && option.argsSchema.choices.length === 1 &&
      option.argsSchema.choices[0]?.id === context.scene.id);
}

const MESSAGES: Partial<Record<Phase, string>> = {
  accepted: 'Anmodningen er modtaget.',
  unknown: 'Udfaldet er ukendt · handlingen gentages ikke.',
  rejected: 'Handlingen kunne ikke udføres med den aktuelle adgang.',
};

// The latest state of one target; it moves last (L1).
function update(operation: Operation, phase: Phase, details: Partial<ActionState> = {}): ActionState {
  const state: ActionState = {target: {...operation.target}, action: operation.action, phase,
    pending: phase === 'preparing' || phase === 'sending', message: MESSAGES[phase] ?? '', ...details};
  const entry = entries.get(operation.identity) ?? {};
  entries.delete(operation.identity);
  entries.set(operation.identity, entry);
  if (state.pending && operation.action === 'brightness') {
    const queue = entry.queue;
    const latest = queue?.kind === 'brightness' && canQueueLightInput(operation.target, 'brightness')
      ? queue.pending.at(-1) : undefined;
    state.requestedPercent = latest ?? operation.requestedPercent;
  }
  entry.feedback = operation;
  entry.state = state;
  if (facts().isConnected && !operation.revoked && operation.context.current()) statusChanged(state, operation);
  publish();
  return state;
}

// An unknown or refused outcome in the area the page shows: one toast, and the page's own status line until a newer
// observation (routine progress belongs to the exact control's progress, never a text row).
function statusChanged(state: ActionState, operation: Operation) {
  const current = facts(), context = lightAreaContext(current);
  const light = currentLightDevice(current.state, current.live);
  if (!current.isConnected || !context || state.late || operation.revoked ||
    entries.get(operation.identity)?.feedback !== operation || !operation.context.current() ||
    light?.lightScope?.areaId !== operation.target.areaId) return;
  const phase = state.phase, problem = phase === 'unknown' || phase === 'rejected';
  if (problem) {
    const fence = unknowns.get(operation.identity);
    setActionProblem({scopeKey: context.key, transport: context.transport, focus: current.state.focus,
      areaId: operation.target.areaId, sourceEpoch: operation.context.sourceEpoch,
      observedAt: fence?.observedAt ?? operation.context.sourceObservedAt, phase, operation,
      text: phase === 'unknown' ? 'Lysets tilstand er ikke bekræftet.' : 'Den seneste lysændring blev afvist.'});
  } else if (state.pending && useLightArea.getState().actionProblem?.phase === 'rejected') setActionProblem(null);
  if (!problem || operation.feedbackPhase === phase) return;
  operation.feedbackPhase = phase;
  lightPorts().showFeedback(phase === 'unknown' ? 'Tjek lyset, før du gør noget igen.'
    : 'Hent aktuel lysstatus, før du prøver igen.', false, {source: 'light-action', eventId: operation});
}

// Whether a target's latest state still belongs to the page (its observation is current).
export function lightActionFeedbackCurrent(operation: Operation | undefined) {
  if (!operation || operation.revoked || suspending) return false;
  if (!operation.context.current()) {
    operation.revoked = true;
    return false;
  }
  return true;
}

// Another tap of this kind can queue behind the target's running command.
export function canQueueLightInput(target: {areaId?: unknown; entityId?: unknown}, kind: 'toggle' | 'brightness') {
  const entry = entries.get(inputKey(target)), queue = entry?.queue, operation = entry?.operation;
  return !!queue && !!operation && !operation.revoked && !suspending && queue.kind === kind &&
    queue.target.areaId === target.areaId && queue.target.entityId === target.entityId && queue.context.current();
}

// A toggle or a lamp's brightness: sent at once, or queued behind the target's running command.
export async function submitLightInput(target: LightTarget, observation: unknown, kind: 'toggle' | 'brightness',
  input: {percent?: unknown}, currentObservation: () => unknown): Promise<Outcome | undefined> {
  const brightness = kind === 'brightness';
  const percent = brightness ? input.percent : null;
  if (brightness && (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100)) {
    return undefined;
  }
  const key = inputKey(target), entry = entries.get(key) ?? {}, running = entry.queue;
  entries.set(key, entry);
  if (running) {
    if (!canQueueLightInput(target, kind)) return undefined;
    if (brightness) {
      running.pending[0] = percent as number;
      if (entry.operation && entry.state) update(entry.operation, entry.state.phase);
    } else if (running.pending.length < 32) running.pending.push(null);
    publish();
    return undefined;
  }
  const context = lightActionContext(target, observation, currentObservation);
  if (!context || brightness && !context.brightness || entry.operation) return undefined;
  const queue: InputQueue = {target: {...target}, kind, context, pending: [percent as number | null]};
  entry.queue = queue;
  publish();
  try {
    while (queue.pending.length && context.current()) {
      const wanted = queue.pending.shift() ?? null;
      const source = observe(currentObservation());
      const result = await actLight(target, source, kind, brightness ? {percent: wanted} : {}, currentObservation);
      if (result.outcome !== 'accepted' || result.late || !context.current()) {
        queue.blocked = true;
        return result;
      }
      const refreshed = observe(currentObservation());
      const observed = refreshed?.items.filter(item => context.ids.includes(item.entityId)) ?? [];
      const matches = observed.every(item => brightness
        ? (item.state === 'off' ? 0 : percentOf(item.brightness)) === wanted
        : item.state === (result.action === 'turn_on' ? 'on' : 'off'));
      if (!result.refreshed || !refreshed || refreshed.observedAt <= (result.observedBeforeSend ?? 0) || !matches) {
        queue.blocked = true;
        if (queue.pending.length) lightPorts().showFeedback('Hent aktuel lysstatus, før du prøver igen.', false);
        return result;
      }
      if (!queue.pending.length || brightness && queue.pending[0] === wanted) return result;
    }
    return undefined;
  } finally {
    if (entry.queue === queue) entry.queue = null;
    publish();
  }
}

const UNAVAILABLE: Outcome = {outcome: 'rejected', phase: 'rejected', pending: false, refreshed: false};

// One light command for one target, through the offer read for exactly it.
export async function actLight(rawTarget: LightTarget, observation: unknown, action: LightKind,
  rawInput: Record<string, unknown> = {}, currentObservation: () => unknown = () => null): Promise<Outcome> {
  const transport = facts().transport;
  let target: LightTarget, input: Record<string, unknown>;
  try {
    target = structuredClone(rawTarget);
    input = structuredClone(rawInput);
  } catch {
    return UNAVAILABLE;
  }
  const resourceId = target.entityId || target.sceneId || target.areaId;
  const identity = keyOf(target);
  if (entries.get(identity)?.operation || ownerBusy() ||
    !['toggle', 'turn_on', 'turn_off', 'brightness', 'scene'].includes(action)) return UNAVAILABLE;
  const context = lightActionContext(target, observation, currentObservation);
  if (!context || action === 'brightness' && !context.brightness || action === 'scene' && !context.scene) {
    return UNAVAILABLE;
  }
  const operation: Operation = {target, action, context, identity, sent: false, revoked: false,
    requestedPercent: action === 'brightness' ? input.percent as number : undefined};
  const entry = entries.get(identity) ?? {};
  entry.operation = operation;
  entries.set(identity, entry);
  // Independent lamp intents share the broker's one setup/action slot per HA area.
  const areaId = target.areaId, previous = lanes.get(areaId);
  let release: (value: Completion | null | undefined) => void = () => undefined;
  const turn = new Promise<Completion | null | undefined>(resolve => {
    release = resolve;
  });
  lanes.set(areaId, turn);
  update(operation, 'preparing');
  const current = () => entries.get(identity)?.operation === operation && !operation.revoked && !suspending &&
    context.current();
  let completion: Completion | null | undefined;
  try {
    const prior = previous ? await previous : null;
    completion = prior;
    if (!current() || ownerBusy()) return UNAVAILABLE;
    const source = observe(context.observation());
    if (!source) return UNAVAILABLE;
    const affected = prior?.ids.some(id => context.ids.includes(id));
    if (prior?.unknown || affected && (!prior?.refreshed || source.observedAt <= prior.observedBeforeSend)) {
      lightPorts().showFeedback('Hent aktuel lysstatus, før du prøver igen.', false);
      return UNAVAILABLE;
    }
    if (action === 'toggle') {
      const on = source.items.some(item => context.ids.includes(item.entityId) && item.state === 'on');
      operation.action = on ? 'turn_off' : 'turn_on';
    }
    const result = await send(operation, input, current, source, resourceId, transport);
    if (operation.sent && (result.outcome === 'accepted' || result.outcome === 'unknown')) {
      // Without an area read, a distinct lamp cannot clear an older overlapping intent's fence.
      const unobserved = !!prior && !prior.refreshed && !result.refreshed;
      const before = operation.observedBeforeSend ?? 0;
      completion = {ids: unobserved ? [...new Set([...prior.ids, ...context.ids])] : context.ids,
        observedBeforeSend: unobserved ? Math.max(prior.observedBeforeSend, before) : before,
        refreshed: result.refreshed, unknown: result.outcome === 'unknown'};
    }
    return {...result, action: operation.action};
  } finally {
    if (entry.operation === operation) {
      const late = !current();
      entry.operation = null;
      if (entry.state?.pending) update(operation, 'rejected', {late});
      publish();
    }
    if (lanes.get(areaId) === turn) lanes.delete(areaId);
    release(completion);
  }
}

async function send(operation: Operation, input: Record<string, unknown>, current: () => boolean,
  source: ObservedLights, resourceId: string, transport: LightTransport | null): Promise<Outcome> {
  const {identity, context, target, action} = operation;
  const requestedValue = action === 'turn_on' ? true : action === 'turn_off' ? false : operation.requestedPercent;
  const diagnostic = {domain: 'light', action, resourceId, ...(requestedValue !== undefined ? {requestedValue} : {})};
  const owner = journal();
  record(transport, 'control_intent', {...diagnostic, code: 'start'});
  owner?.pruneSpent();
  for (const [key, fence] of unknowns) if (fence.until <= Date.now()) unknowns.delete(key);
  const unknown = unknowns.get(identity);
  if (unknown?.sourceEpoch === context.sourceEpoch && source.observedAt <= unknown.observedAt) {
    record(transport, 'control_intent', {...diagnostic, code: 'unknown_fence'});
    return {outcome: 'unknown', phase: 'unknown', pending: false, refreshed: false};
  }
  unknowns.delete(identity);
  if (unknowns.size >= 64) {
    record(transport, 'control_intent', {...diagnostic, code: 'unknown_fence', count: 64});
    return UNAVAILABLE;
  }
  let task: LightTask | undefined, result: LightReceipt;
  try {
    record(transport, 'control_setup', {...diagnostic, code: 'start'});
    const raw = await context.transport.controlSetup('light', target);
    if (!current()) throw new Error('light_context_changed');
    task = readLightTask(raw, facts().snapshot);
    if (owner?.spent.has(task.taskId) || !taskCurrent(context, task)) throw new Error('light_offer_changed');
    const candidates = task.options.filter(row => row.action === action);
    const option = candidates[0];
    if (candidates.length !== 1 || !option) throw new Error('light_action_not_offered');
    const args = lightArgs(task, option.id, input);
    record(transport, 'control_setup', {...diagnostic, code: 'ok'});
    if (!current() || !taskCurrent(context, task)) throw new Error('light_context_changed');
    owner?.spent.set(task.taskId, task.expiresAt);
    update(operation, 'sending');
    if (!current()) throw new Error('light_context_changed');
    operation.observedBeforeSend = observe(context.observation())?.observedAt ?? 0;
    operation.sent = true;
    operation.label = option.label;
    result = readLightReceipt(await context.transport.controlAction(task, option.id, args));
  } catch {
    const code = operation.sent ? 'unknown' : current() ? 'setup_unavailable' : 'superseded';
    record(transport, operation.sent ? 'control_action' : 'control_setup', {...diagnostic, code});
    result = {ok: false, outcome: operation.sent ? 'unknown' : 'rejected'};
  }
  const outcome = result.outcome;
  if (operation.sent && task) {
    try {
      owner?.remember({key: `${task.bootId}:${task.taskId}`, bootId: task.bootId, roomId: task.roomId,
        taskId: task.taskId, domain: 'light', target, label: operation.label}, outcome, result.requestId, result);
    } catch {
      // The journal cannot lose the outcome.
    }
    if (outcome === 'unknown') {
      unknowns.set(identity, {sourceEpoch: context.sourceEpoch,
        observedAt: Math.max(source.observedAt, Date.now() / 1000), until: Date.now() + 15000});
    } else unknowns.delete(identity);
  }
  if (operation.sent && outcome !== 'rejected' && current()) {
    try {
      owner?.trackDeviceJournal('light', operation, result.requestId, requestedValue, resourceId,
        () => !operation.revoked && !suspending && context.current());
    } catch {
      // Optional journal metadata cannot change an outcome.
    }
  }
  let refreshed = false;
  if (outcome === 'accepted' && current()) {
    try {
      refreshed = await readLightArea(target.areaId, {preserveControls: true}) === true;
    } catch {
      refreshed = false;
    }
  }
  try {
    const snapshot = facts().snapshot;
    owner?.observeDeviceJournal({bootId: snapshot?.bootId, roomId: snapshot?.roomId,
      lights: scopedLightsObservation(context.observation())});
  } catch {
    // Observation logging cannot interrupt adoption.
  }
  const state = update(operation, outcome, {outcome, requestId: result.requestId, refreshed, late: !current(),
    observedBeforeSend: operation.observedBeforeSend});
  return {outcome, phase: state.phase, pending: state.pending, refreshed, late: !current(),
    requestId: result.requestId, observedBeforeSend: operation.observedBeforeSend};
}

// A live tap on the light the page shows: the exact target in its area, bound to its current observation.
export function actCurrentLight(action: LightKind, args: Record<string, unknown> = {},
  target: Partial<LightTarget> = {}): Promise<Outcome | undefined> | undefined {
  const start = facts(), light = currentLightDevice(start.state, start.live), context = lightAreaContext(start);
  const observation = light && !light.stale ? observe(light.lightObservation) : null;
  if (!start.live || !context || lightAreaPending() || !observation) return undefined;
  const exact: LightTarget = {areaId: observation.scope.areaId, ...target};
  if (exact.areaId !== observation.scope.areaId) return undefined;
  const currentObservation = () => {
    const now = facts(), next = lightAreaContext(now), shown = currentLightDevice(now.state, now.live);
    return next?.key === context.key && next.transport === context.transport && !shown?.stale && !lightAreaPending()
      ? shown?.lightObservation : null;
  };
  if (action === 'toggle' || action === 'brightness' && exact.entityId) {
    return submitLightInput(exact, observation, action, args, currentObservation);
  }
  return actLight(exact, observation, action, args, currentObservation);
}

// After each render: a command whose observation is no longer current is revoked (its late reply changes nothing).
export function revokeStaleLightActions() {
  for (const entry of entries.values()) {
    if (entry.operation && !entry.operation.context.current()) entry.operation.revoked = true;
    if (entry.feedback && !entry.feedback.context.current()) entry.feedback.revoked = true;
  }
}

// The shell left the document: every command under way is revoked and nothing is shown any more.
export function resetLightCommands() {
  suspending = true;
  for (const entry of entries.values()) if (entry.operation) entry.operation.revoked = true;
  entries = new Map();
  suspending = false;
  publish();
}

// Tests only: forget the fences and lanes too.
export function forgetLightCommands() {
  resetLightCommands();
  unknowns.clear();
  lanes.clear();
}
