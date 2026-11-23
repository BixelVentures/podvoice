// Lys in the local preview: what the example light (scene-model.js) has selected, the whole home, a room or one
// lamp, and whether »Gendan lys« may restore the home as it was before »Sluk alt«. Ported from scene-model.js, which
// imports them from here. A local example is never live authority.
import type {ExampleLamp, LightDevice} from './host';

export type SelectionStatus = 'on' | 'off' | 'mixed' | 'unknown' | 'fault' | 'unavailable';

export interface LightSelection {
  id: string;
  kind: 'light' | 'home' | 'room';
  roomId: string;
  title: string;
  label: string;
  detail: string;
  status: SelectionStatus;
  power: boolean;
  onCount: number;
  total: number;
  targetIds: string[];
  exampleOnly: true;
}

const UNCONFIRMED: Partial<Record<SelectionStatus, string>> = {
  unknown: 'Lysstatus ukendt',
  fault: 'Lysstatus kunne ikke hentes',
  unavailable: 'Ikke forbundet',
};

const isLamp = (row: unknown): row is ExampleLamp => {
  const lamp = row as Partial<ExampleLamp> | null;
  return !!lamp && typeof lamp.id === 'string' && typeof lamp.roomId === 'string' &&
    typeof lamp.roomName === 'string' && typeof lamp.name === 'string' && typeof lamp.on === 'boolean';
};

export function lightSelection(device: unknown): LightSelection | null {
  const d = device as Partial<LightDevice> | null | undefined;
  const lamps: unknown[] = Array.isArray(d?.lights) ? d.lights : [];
  if (d?.kind !== 'light' || d.live === true || d.exampleOnly !== true || !Array.isArray(d.lights) ||
    lamps.length < 1 || lamps.length > 128 || !lamps.every(isLamp) ||
    new Set(lamps.map(row => row.id)).size !== lamps.length) return null;
  const all = lamps;
  const id = d.lightSelectionId || 'home';
  if (typeof id !== 'string') return null;
  const lamp = id.startsWith('light:') ? all.find(row => `light:${row.id}` === id) : undefined;
  const roomId = lamp?.roomId || (id.startsWith('room:') ? id.slice(5) : id === 'home' ? 'home' : null);
  const lights = id === 'home' ? all : lamp ? [lamp] : all.filter(row => row.roomId === roomId);
  const first = lights[0];
  if (!first || !roomId) return null;
  const kind = lamp ? 'light' : id === 'home' ? 'home' : 'room', roomName = first.roomName;
  const label = lamp ? `${roomName} · ${lamp.name}` : kind === 'home' ? 'Hele hjemmet' : roomName;
  const onCount = lights.filter(row => row.on).length, total = lights.length;
  const status: SelectionStatus = d.status === 'unknown' || d.status === 'fault' || d.status === 'unavailable'
    ? d.status : onCount === 0 ? 'off' : onCount === total ? 'on' : 'mixed';
  return {
    id,
    kind,
    roomId,
    title: lamp ? lamp.name : kind === 'home' ? 'Lys' : `Lys · ${roomName}`,
    label,
    detail: UNCONFIRMED[status] || (total === 1 ? onCount ? 'Tændt' : 'Slukket'
      : `${String(onCount)} af ${String(total)} tændt`),
    status,
    power: status === 'on' || status === 'mixed',
    onCount,
    total,
    targetIds: lights.map(row => row.id),
    exampleOnly: true,
  };
}

interface RestoreScene {
  connected?: unknown;
  focus?: unknown;
  sessionId?: unknown;
  generation?: unknown;
}

interface Restore {
  sessionId?: unknown;
  generation?: unknown;
  revision?: unknown;
  selectionId?: unknown;
  ownRoomId?: unknown;
  source?: unknown;
  sourceEpoch?: unknown;
  after?: unknown;
}

// Local review fixtures only. A remembered state is not provider authority and must never become an indiscriminate
// live »turn all on« command.
export function lightHomeRestoreAvailable(scene: unknown, device: unknown): boolean {
  const s = scene as RestoreScene | null | undefined, d = device as Partial<LightDevice> | null | undefined;
  const restore = d?.lightHomeRestore as Restore | null | undefined;
  return !!(restore && d && s?.connected === true && s.focus === d.id && !d.live && d.exampleOnly === true &&
    d.scope === 'home' && !d.pending && !d.stale && d.status === 'off' && lightSelection(d) &&
    restore.sessionId === s.sessionId && restore.generation === s.generation && restore.revision === d.revision &&
    restore.selectionId === d.lightSelectionId && restore.ownRoomId === d.ownRoomId && restore.source === d.source &&
    restore.sourceEpoch === d.lightSourceEpoch && restore.after === JSON.stringify(d.lights));
}

export interface LightChoice {
  id: string;
  label: string;
  detail: string;
  status?: string;
  icon: 'lightbulb';
}

export interface LightChoices {
  rooms: {selected: string | null; items: LightChoice[]};
  lamps: {selected: string | null; items: LightChoice[]};
}

// What the example may select: the whole home, each room (the screen's own first, the home last) and the lamps of the
// selected room. An unconfirmed example offers nothing; anything but a local example is null.
export function lightChoices(device: unknown): LightChoices | null {
  const selected = lightSelection(device);
  if (!selected) return null;
  if (UNCONFIRMED[selected.status]) return {rooms: {selected: null, items: []}, lamps: {selected: null, items: []}};
  const d = device as LightDevice, lamps = d.lights ?? [];
  const count = (rows: ExampleLamp[]) => `${String(rows.filter(row => row.on).length)} af ${String(rows.length)} tændt`;
  const rooms: LightChoice[] = [{id: 'home', label: 'Hele hjemmet', detail: count(lamps), icon: 'lightbulb'}];
  for (const roomId of new Set(lamps.map(row => row.roomId))) {
    const rows = lamps.filter(row => row.roomId === roomId);
    rooms.push({id: `room:${roomId}`, label: rows[0]?.roomName ?? '', detail: count(rows), icon: 'lightbulb'});
  }
  const own = d.ownRoomId ? `room:${d.ownRoomId}` : null;
  const home = selected.roomId === 'home';
  return {
    rooms: {
      selected: home ? 'home' : `room:${selected.roomId}`,
      items: own ? [...rooms.filter(row => row.id === own), ...rooms.filter(row => row.id !== own && row.id !== 'home'),
        ...rooms.filter(row => row.id === 'home')] : rooms,
    },
    lamps: {
      selected: selected.kind === 'light' ? selected.id : null,
      items: lamps.filter(row => home || row.roomId === selected.roomId).map(row => ({
        id: `light:${row.id}`,
        label: home ? `${row.roomName} · ${row.name}` : row.name,
        detail: row.on ? 'Tændt' : 'Slukket',
        status: row.on ? 'on' : 'off',
        icon: 'lightbulb',
      })),
    },
  };
}
