// Lys: which Home Assistant area the light page shows, read only (ported from widget-view.js lightAreaContext,
// syncLightArea, readLightArea, refreshLightArea and lightLocalFeedback, with the same rules):
// - An area read belongs to its scope: boot, room, the catalogue (source epoch, binding, placement revision, own area,
//   members), the placement and the transport. A change of scope drops the browsed area and any read under way; a
//   reply for an older scope, focus or a newer choice is never adopted (the latest chosen area wins).
// - Browsing replaces only the browsed area's observation, never the overview; an older or retained stale
//   observation never replaces a newer one, and a read that follows a newer home read stays stale until it catches up.
// - A failed read is a read problem (»Lysstatus for X kunne ikke hentes«), not an action problem; an action's unknown
//   or refused outcome stays until a newer observation of the same area and source arrives.
// - An observation is current until its validUntil; then it is marked stale and controls stop.
import {create} from 'zustand';
import {lightAreasObservation, scopedLightDevice, scopedLightsObservation} from '../../lib/api/light';
import type {ObservedLightAreas} from '../../lib/api/light';
import {currentLightDevice, lightPorts} from './host';
import type {LightDevice, LightFacts, LightPlacementLike, LightTransport} from './host';

export interface AreaContext {
  transport: LightTransport;
  key: string;
  boot: unknown;
  room: unknown;
  areas: ObservedLightAreas;
}

interface Problem {
  scopeKey: string;
  transport: LightTransport;
  focus: unknown;
  areaId: string;
  text: string;
}

export interface ReadProblem extends Problem {
  displayAreaId?: string | undefined;
}

export interface ActionProblem extends Problem {
  sourceEpoch: unknown;
  observedAt: number;
  phase: 'unknown' | 'rejected';
  operation: unknown;
}

interface ReadAttempt {
  context: AreaContext;
  focus: unknown;
  areaId: string;
  generation: number;
  passive: boolean;
  afterHomeRevision: {scope: string; revision: number} | null;
}

export interface AreaState {
  // An explicit area read is under way: controls wait for it.
  pending: boolean;
  readProblem: ReadProblem | null;
  actionProblem: ActionProblem | null;
  // The scene chosen last in an area (live): the scene the level slider adjusts.
  sceneRecent: {id: string; area: string} | null;
}

const INITIAL: AreaState = {pending: false, readProblem: null, actionProblem: null, sceneRecent: null};

export const useLightArea = create<AreaState>(() => INITIAL);
const set = (patch: Partial<AreaState>) => {
  useLightArea.setState(patch);
};

let generation = 0;
let scope: AreaContext | null = null;
let attempt: ReadAttempt | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
let expiryKey = '';

const facts = () => lightPorts().facts();
const lightOf = (current: LightFacts) => currentLightDevice(current.state, current.live);

// The area scope a read belongs to, or null when no area may be read now.
export function lightAreaContext(current: LightFacts = facts()): AreaContext | null {
  const snapshot = current.snapshot, transport = current.transport, state = current.state;
  const areas = state.lightAreas, placement = state.lightPlacement as LightPlacementLike | null | undefined;
  if (!current.live || !current.isConnected || current.browserOffline || !transport?.connected ||
    transport.recoveryBlocked || !snapshot?.capabilities?.homeRead?.includes('light') ||
    areas?.status !== 'observed' || placement?.status !== 'bound') return null;
  const observed = areas as ObservedLightAreas;
  return {
    transport,
    key: JSON.stringify([snapshot.bootId, snapshot.roomId, observed.sourceEpoch, observed.bindingId,
      observed.placementRevision, observed.ownAreaId, placement, observed.items]),
    boot: snapshot.bootId,
    room: snapshot.roomId,
    areas: observed,
  };
}

const sameScope = (a: {key: string; transport: unknown} | null, b: {key: string; transport: unknown} | null) =>
  !!a && !!b && a.key === b.key && a.transport === b.transport;

export const lightAreaPending = () => useLightArea.getState().pending;

function scheduleExpiry(at: number | undefined, check: () => boolean = () => true) {
  clearTimeout(expiry);
  if (at === undefined) return;
  expiry = setTimeout(() => {
    if (!check()) return;
    syncLightArea();
    lightPorts().render();
  }, Math.max(0, at * 1000 - Date.now()));
}

// After each live render: drop what belongs to an older scope and mark an expired observation stale.
export function syncLightArea(current: LightFacts = facts()) {
  if (!current.live) return;
  const context = lightAreaContext(current);
  if (scope && !sameScope(scope, context)) {
    generation++;
    scope = null;
    clearTimeout(expiry);
    set({pending: false});
    lightPorts().setDetail(null);
  }
  if (context && !scope) scope = context;
  const now = facts();
  const light = lightOf(now) ?? now.state.devices?.find(device => device.kind === 'light' && device.live);
  if (light?.live && (light.validUntil ?? 0) * 1000 <= Date.now() && !light.stale) lightPorts().markStale(light);
}

// The expiry of the light the page shows (or the own area's), set again when it changes.
export function scheduleLightExpiry(current: LightFacts = facts()) {
  if (!current.live) return;
  const timed = lightOf(current) ?? current.state.devices?.find(device => device.kind === 'light' && device.live);
  const key = timed?.live ? `${String(timed.lightSourceEpoch)}:${String(timed.lightScope?.areaId)}:` +
    String(timed.validUntil) : '';
  if (key === expiryKey) return;
  expiryKey = key;
  scheduleExpiry(timed?.live && !timed.stale ? timed.validUntil : undefined);
}

function observedArea(current: LightFacts, areaId: string) {
  const displayed = lightOf(current);
  if (displayed?.lightScope?.areaId === areaId) return displayed;
  return current.state.devices?.find(device => device.kind === 'light' && device.lightScope?.areaId === areaId);
}

export interface ReadOptions {
  // A re-read that keeps the page's controls (after an action, or to keep a browsed area fresh).
  preserveControls?: boolean;
  // Read quietly: no toast on failure, and nothing waits for it.
  passive?: boolean;
}

// Read one area of the catalogue. Resolves true when its observation was adopted, false when it was refused, and
// undefined when no read was made or its reply belonged to an older choice.
export async function readLightArea(areaId: string, {preserveControls = false, passive = false}: ReadOptions = {}):
  Promise<boolean | undefined> {
  const ports = lightPorts(), context = lightAreaContext();
  if (!context || !lightAreasObservation(context.areas) || !context.areas.items.some(row => row.areaId === areaId)) {
    return undefined;
  }
  const start = facts(), observedAtStart = observedArea(start, areaId);
  if (preserveControls && lightOf(start)?.lightScope?.areaId !== areaId) return false;
  const focus = start.state.focus;
  let adopted = false;
  const mine = ++generation;
  const read: ReadAttempt = {context, focus, areaId, generation: mine, passive, afterHomeRevision: null};
  attempt = read;
  scope = context;
  if (!preserveControls) set({pending: true});
  if (!passive) ports.render();
  const current = () => {
    const now = facts();
    return mine === generation && now.state.focus === focus && sameScope(lightAreaContext(now), context) &&
      (!preserveControls || lightOf(now)?.lightScope?.areaId === areaId);
  };
  try {
    const body = await context.transport.home({lightArea: areaId});
    if (!current()) return undefined;
    const home = ports.validateHome(body, context.room, context.boot);
    const areas = lightAreasObservation(home.lightAreas);
    const device = scopedLightDevice(home.lights, home.revision);
    if (device?.lightScope.areaId !== areaId || areas?.status !== 'observed' ||
      areas.sourceEpoch !== context.areas.sourceEpoch || areas.bindingId !== context.areas.bindingId ||
      areas.placementRevision !== context.areas.placementRevision || areas.ownAreaId !== context.areas.ownAreaId ||
      JSON.stringify(areas.items) !== JSON.stringify(context.areas.items)) throw new Error('light_area_changed');
    const after = read.afterHomeRevision;
    const source = (body as {sourceRevision?: {scope?: unknown; revision?: unknown}} | null)?.sourceRevision;
    if (after && source?.scope === after.scope && Number.isSafeInteger(source.revision) &&
      (source.revision as number) >= after.revision) read.afterHomeRevision = null;
    if (preserveControls && read.afterHomeRevision) return false;
    const observed = observedArea(facts(), areaId);
    if (observed) {
      if ((observed.observedAt ?? 0) > device.observedAt) return false;
      if (observed.stale && (observed !== observedAtStart || observed.observedAt === device.observedAt)) return false;
    }
    // Browsing may only replace the light detail, never overview, weather or output.
    const detail: LightDevice = read.afterHomeRevision ? {...device, stale: true} : device;
    ports.setDetail(detail);
    adopted = true;
    if (!detail.stale) {
      try {
        ports.journal()?.observeDeviceJournal(home as Record<string, unknown>);
      } catch {
        // Journal metadata never changes an outcome.
      }
    }
    const problem = useLightArea.getState().readProblem;
    if (problem?.areaId === areaId && sameScope({key: problem.scopeKey, transport: problem.transport}, context)) {
      set({readProblem: null});
    }
    pruneLightProblems(detail);
    scheduleExpiry(device.validUntil, current);
  } catch {
    if (current()) {
      const name = context.areas.items.find(row => row.areaId === areaId)?.areaName || 'området';
      set({readProblem: {scopeKey: context.key, transport: context.transport, focus, areaId,
        displayAreaId: lightOf(facts())?.lightScope?.areaId, text: `Lysstatus for ${name} kunne ikke hentes.`}});
      if (passive) {
        const detail = facts().state.liveLightDetail;
        if (detail?.lightScope?.areaId === areaId && !detail.stale) ports.setDetail({...detail, stale: true});
      } else ports.showFeedback('Hent lysstatus igen.', false, {source: 'light-read', eventId: read});
    }
  } finally {
    if (attempt === read) attempt = null;
    if (mine === generation) {
      set({pending: false});
      if (current()) {
        ports.render();
        if (read.afterHomeRevision && current() && lightOf(facts())?.lightScope?.areaId === areaId) {
          void readLightArea(areaId, {preserveControls: true, passive: true});
        }
      }
    }
  }
  return adopted;
}

// »Opdater lys«: read home again, then the area the page shows.
export async function refreshLightArea() {
  const context = lightAreaContext(), areaId = lightOf(facts())?.lightScope?.areaId;
  if (!context || !areaId || useLightArea.getState().pending) return;
  await lightPorts().loadLiveHome();
  if (sameScope(lightAreaContext(), context)) await readLightArea(areaId);
}

// After a newer home read was applied: keep a browsed foreign area fresh through the same read-only owner; an explicit
// read under way keeps priority, but its older reply must not consume the newer home revision.
export function lightAfterHomeRead(source: {scope: string; revision: number} | null | undefined,
  previous: {scope?: unknown; revision?: unknown} | null | undefined) {
  if (!source || previous?.scope !== source.scope || source.revision <= (previous.revision as number)) return;
  const current = facts(), detail = current.state.liveLightDetail, selected = detail?.lightScope;
  const read = attempt;
  if (read && !read.passive) {
    const placement = current.state.lightPlacement as LightPlacementLike | null | undefined;
    if (read.focus === current.state.focus && read.areaId !== placement?.areaId) read.afterHomeRevision = source;
  } else if (selected?.isOwnArea === false && detail?.id === current.state.focus) {
    void readLightArea(selected.areaId, {preserveControls: true, passive: true});
  }
}

// A problem belongs to the scope, transport and focus it arose in.
function problemCurrent(problem: Problem | null, current: LightFacts): boolean {
  const context = lightAreaContext(current);
  return !!problem && !!context && problem.scopeKey === context.key && problem.transport === context.transport &&
    problem.focus === current.state.focus;
}

// An action problem ends with a newer observation of its own area and source.
function resolvedBy(problem: ActionProblem, light: LightDevice | null | undefined) {
  const observation = light?.lightObservation ? scopedLightsObservation(light.lightObservation) : null;
  return observation?.status === 'observed' && observation.scope.areaId === problem.areaId &&
    observation.sourceEpoch === problem.sourceEpoch && observation.observedAt > problem.observedAt;
}

// Drop the problems that no longer belong to the page (after a render or an adopted read).
export function pruneLightProblems(light: LightDevice | null | undefined = lightOf(facts()),
  current: LightFacts = facts()) {
  const {readProblem, actionProblem} = useLightArea.getState();
  const patch: Partial<AreaState> = {};
  if (readProblem && !problemCurrent(readProblem, current)) patch.readProblem = null;
  if (actionProblem && (!problemCurrent(actionProblem, current) || resolvedBy(actionProblem, light))) {
    patch.actionProblem = null;
  }
  if (Object.keys(patch).length) set(patch);
}

export interface LocalFeedback {
  state: 'ready' | 'error' | 'unknown';
  text: string;
}

// The page's own status line: a read problem, and an action's unknown or refused outcome in the shown area.
export function lightLocalFeedback(area: AreaState, light: LightDevice | null | undefined,
  current: LightFacts): LocalFeedback {
  const read = problemCurrent(area.readProblem, current) ? area.readProblem : null;
  const action = area.actionProblem && problemCurrent(area.actionProblem, current) &&
    !resolvedBy(area.actionProblem, light) ? area.actionProblem : null;
  const text = [read?.text, action && action.areaId === light?.lightScope?.areaId ? action.text : '']
    .filter(Boolean).join(' ');
  return {state: read ? 'error' : action && text ? action.phase === 'unknown' ? 'unknown' : 'error' : 'ready', text};
}

export function setActionProblem(problem: ActionProblem | null) {
  set({actionProblem: problem});
}

export function rememberScene(id: string, area: string) {
  set({sceneRecent: {id, area}});
}

// The shell left the document: nothing read before belongs to it any more.
export function resetLightArea() {
  clearTimeout(expiry);
  expiryKey = '';
  generation++;
  attempt = null;
  set({pending: false});
}

// Tests only: forget every scope.
export function forgetLightArea() {
  resetLightArea();
  scope = null;
  useLightArea.setState(INITIAL, true);
}

export const currentReadAttempt = () => attempt;
