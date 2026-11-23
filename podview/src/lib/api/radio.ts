// Radio's server payloads: the station catalogue and the owner's observation (GET …/api/radio, podview.radio.v1).
// The observation is admitted only when it is valid for this boot and room, fresh, coherent and not older than the
// last one admitted. No runtime imports: a server contract test (tests/integration/test_podview_radio.py) runs this
// parser in plain Node (type stripping), without node_modules.

export interface RadioStation {
  readonly id: string;
  readonly label: string;
}

// Station names are navigation choices, never stream URLs or playback authority. The owner's catalogue order is
// podview_radio.py STATIONS; an observation is checked against it as is.
const OWNER_STATIONS: readonly RadioStation[] = [
  {id: 'p3', label: 'P3'},
  {id: 'p1', label: 'P1'},
  {id: 'p4-ostjylland', label: 'P4 Østjylland'},
  {id: 'p6-beat', label: 'P6 Beat'},
  {id: 'p8-jazz', label: 'P8 Jazz'},
];

// DR stations are shown in their channel number order (P1, P3, P4 …); a station without a number keeps its place
// after them. The sort is stable, so equal numbers keep the given order.
const channel = (label: string) => {
  const match = /^P(\d+)\b/.exec(label);
  return match ? Number(match[1]) : Infinity;
};
export const orderStations = <T extends {label: string}>(list: readonly T[]): T[] =>
  list
    .map((station, index) => ({station, index}))
    .sort((a, b) => channel(a.station.label) - channel(b.station.label) || a.index - b.index)
    .map(row => row.station);

export const ownerStationIds: readonly string[] = Object.freeze(OWNER_STATIONS.map(station => station.id));
export const stations: readonly RadioStation[] = Object.freeze(
  orderStations(OWNER_STATIONS).map(station => Object.freeze({...station})),
);
const byId = new Map(stations.map(station => [station.id, station]));
export const radioStation = (id: unknown): RadioStation | null =>
  typeof id === 'string' ? (byId.get(id) ?? null) : null;

// The server's validity window (podview_radio.py) and the user's 10-minute rule for a stopped station.
export const RADIO_VALID_S = 30;
export const STOPPED_KEEP_MS = 10 * 60 * 1000;

export type RadioAction = 'start' | 'stop' | 'move' | 'volume';
export type RadioStatus = 'idle' | 'preparing' | 'playing' | 'stopped' | 'error' | 'unknown';
export type RadioSourceKind = 'radio' | 'spotify' | 'none' | 'unknown';
const ACTIONS: readonly unknown[] = ['start', 'stop', 'move', 'volume'];
const STATUSES: readonly unknown[] = ['idle', 'preparing', 'playing', 'stopped', 'error', 'unknown'];
const SOURCES: readonly unknown[] = ['radio', 'spotify', 'none', 'unknown'];

export interface RadioTarget {
  id: string;
  name: string;
  availability: 'available' | 'unavailable';
  selectable: boolean;
  default: boolean;
}

export interface RadioState {
  status: RadioStatus;
  stationId: string | null;
  targetId: string | null;
  generation: number;
  sourceKind?: RadioSourceKind;
  ownerGeneration?: number;
  volumePercent?: number | null;
  observedAt?: number | null;
}

export interface RadioObservation {
  schema: 'podview.radio.v1';
  ok: true;
  bootId: string;
  roomId: string;
  revision: number;
  enabled: boolean;
  physicalResultVerified: false;
  ownerProcessId?: string | null;
  blockedReasons?: string[];
  actions: RadioAction[];
  stations: {id: string; name?: string}[];
  targets: RadioTarget[];
  state: RadioState;
  retrievedAt: number | null;
  validUntil: number | null;
}

export type RadioSetupIssue = 'radio_native_not_configured' | 'radio_native_auth_rejected';

// The one configuration reason a disabled owner may name, else null.
export function configurationReason(value: unknown): RadioSetupIssue | null {
  const reasons = (value as {blockedReasons?: unknown} | null | undefined)?.blockedReasons;
  if (!Array.isArray(reasons) || reasons.length !== 1) return null;
  const [reason] = reasons as unknown[];
  return reason === 'radio_native_not_configured' || reason === 'radio_native_auth_rejected' ? reason : null;
}

export const radioId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const safe = (value: unknown): value is number => Number.isSafeInteger(value);
const finite = (value: unknown): value is number => Number.isFinite(value);

function targetsOf(value: unknown): Set<string> | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const seen = new Set<string>();
  for (const t of value as unknown[]) {
    if (!record(t) || !radioId(t.id) || seen.has(t.id) || !radioId(t.name)) return null;
    if (!['available', 'unavailable'].includes(t.availability as string)) return null;
    if (typeof t.selectable !== 'boolean' || typeof t.default !== 'boolean') return null;
    seen.add(t.id);
  }
  return seen;
}

// The live state is measured, coherent and bounded.
function stateValid(value: Record<string, unknown>, s: Record<string, unknown>, now: number): boolean {
  if (!value.enabled) return true;
  if (!SOURCES.includes(s.sourceKind) || !safe(s.ownerGeneration) || s.ownerGeneration < 0) return false;
  const volume = s.volumePercent;
  if (volume !== null && (typeof volume !== 'number' || !Number.isInteger(volume) || volume < 0 || volume > 100))
    return false;
  if (['playing', 'stopped', 'preparing'].includes(s.status as string)) {
    const at = s.observedAt;
    if (!finite(at) || at * 1000 > now + 5000 || now - at * 1000 > 30000) return false;
  }
  if (s.status === 'playing' && (s.sourceKind !== 'radio' || !s.stationId || !s.targetId)) return false;
  if (s.sourceKind === 'radio' && !s.stationId) return false;
  const {retrievedAt, validUntil} = value;
  return finite(retrievedAt) && finite(validUntil) && retrievedAt * 1000 <= now + 5000 && validUntil * 1000 > now &&
    validUntil - retrievedAt <= RADIO_VALID_S;
}

// The observation itself when it is valid for this boot and room and not older than `previous`; else null.
export function radioObservation(
  value: unknown,
  snapshot: {bootId?: unknown; roomId?: unknown} | null | undefined,
  previous: RadioObservation | null = null,
  now = Date.now(),
): RadioObservation | null {
  if (!record(value) || value.schema !== 'podview.radio.v1' || value.ok !== true) return null;
  if (value.bootId !== snapshot?.bootId || value.roomId !== snapshot?.roomId) return null;
  if (!safe(value.revision) || value.revision < 0 || typeof value.enabled !== 'boolean') return null;
  if (value.physicalResultVerified !== false) return null;
  if (!Array.isArray(value.actions) || (value.actions as unknown[]).some(a => !ACTIONS.includes(a))) return null;
  const listed = value.stations;
  if (!Array.isArray(listed) || listed.length !== ownerStationIds.length) return null;
  if (!ownerStationIds.every((id, i) => (listed[i] as {id?: unknown} | undefined)?.id === id)) return null;
  const owner = value.ownerProcessId;
  if (owner !== undefined && owner !== null && !radioId(owner)) return null;
  const seen = targetsOf(value.targets);
  if (!seen) return null;
  const s = value.state;
  if (!record(s) || !STATUSES.includes(s.status)) return null;
  if (s.stationId !== null && !radioStation(s.stationId)) return null;
  if (s.targetId !== null && !seen.has(s.targetId as string)) return null;
  if (!safe(s.generation) || s.generation < 0 || !stateValid(value, s, now)) return null;
  const observed = value as unknown as RadioObservation;
  const ownerChanged = radioId(previous?.ownerProcessId) && radioId(owner) && previous.ownerProcessId !== owner;
  if (previous?.bootId === observed.bootId && previous.roomId === observed.roomId && !ownerChanged) {
    const before = previous.state;
    if (observed.revision < previous.revision || observed.state.generation < before.generation) return null;
    if (safe(s.ownerGeneration) && safe(before.ownerGeneration) && s.ownerGeneration < before.ownerGeneration)
      return null;
  }
  return observed;
}
