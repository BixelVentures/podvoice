// Pure parsing of the radio owner's observation (GET /view/api/radio, schema podview.radio.v1).
// No DOM and no state: LiveRadioView, the node tests and the Python contract test import it as is.
import {radioStation, ownerStationIds} from './radio-model.js';

// The server's validity window (podview_radio.py) and the user's 10-minute rule for a stopped station.
export const RADIO_VALID_S = 30, STOPPED_KEEP_MS = 10 * 60 * 1000;

// Radio has its own source catalogue. No Spotify account, device or DTO is admitted.
export const configurationReason = value => {
  const reasons = value?.blockedReasons;
  if (!Array.isArray(reasons) || reasons.length !== 1) return null;
  const [reason] = reasons;
  return ['radio_native_not_configured', 'radio_native_auth_rejected'].includes(reason) ? reason : null;
};

export const radioId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const id = radioId;

const ACTIONS = ['start', 'stop', 'move', 'volume'];
const STATUSES = ['idle', 'preparing', 'playing', 'stopped', 'error', 'unknown'];
const SOURCES = ['radio', 'spotify', 'none', 'unknown'];

// The observation itself when it is valid for this boot and room and not older than `previous`; else null.
export function radioObservation(value, snapshot, previous = null, now = Date.now()) {
  if (value?.schema !== 'podview.radio.v1' || value.ok !== true || value.bootId !== snapshot?.bootId
    || value.roomId !== snapshot?.roomId || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.enabled !== 'boolean' || value.physicalResultVerified !== false
    || !Array.isArray(value.actions) || value.actions.some(a => !ACTIONS.includes(a))
    || !Array.isArray(value.stations) || value.stations.length !== 5
    || !ownerStationIds.every((id, i) => value.stations[i]?.id === id)
    || !Array.isArray(value.targets) || value.targets.length > 64) return null;
  if (value.ownerProcessId !== undefined && value.ownerProcessId !== null && !id(value.ownerProcessId)) return null;
  const seen = new Set();
  for (const t of value.targets) {
    if (!id(t.id) || seen.has(t.id) || !id(t.name) || !['available', 'unavailable'].includes(t.availability)
      || typeof t.selectable !== 'boolean' || typeof t.default !== 'boolean') return null;
    seen.add(t.id);
  }
  const s = value.state;
  if (!s || !STATUSES.includes(s.status) || s.stationId !== null && !radioStation(s.stationId)
    || s.targetId !== null && !seen.has(s.targetId) || !Number.isSafeInteger(s.generation) || s.generation < 0) {
    return null;
  }
  if (value.enabled && (!SOURCES.includes(s.sourceKind) || !Number.isSafeInteger(s.ownerGeneration)
    || s.ownerGeneration < 0)) return null;
  if (value.enabled && (s.volumePercent !== null && (!Number.isInteger(s.volumePercent) || s.volumePercent < 0
    || s.volumePercent > 100))) return null;
  if (value.enabled && ['playing', 'stopped', 'preparing'].includes(s.status) && (!Number.isFinite(s.observedAt)
    || s.observedAt * 1000 > now + 5000 || now - s.observedAt * 1000 > 30000)) return null;
  if (value.enabled && (s.status === 'playing' && (s.sourceKind !== 'radio' || !s.stationId || !s.targetId)
    || s.sourceKind === 'radio' && !s.stationId)) return null;
  if (value.enabled && (!Number.isFinite(value.retrievedAt) || !Number.isFinite(value.validUntil)
    || value.retrievedAt * 1000 > now + 5000 || value.validUntil * 1000 <= now
    || value.validUntil - value.retrievedAt > RADIO_VALID_S)) return null;
  const ownerChanged = id(previous?.ownerProcessId) && id(value.ownerProcessId)
    && previous.ownerProcessId !== value.ownerProcessId;
  if (previous?.bootId === value.bootId && previous.roomId === value.roomId && !ownerChanged
    && (value.revision < previous.revision || s.generation < previous.state.generation
      || Number.isSafeInteger(s.ownerGeneration) && Number.isSafeInteger(previous.state.ownerGeneration)
      && s.ownerGeneration < previous.state.ownerGeneration)) return null;
  return value;
}
