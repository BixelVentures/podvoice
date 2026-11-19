// Radio: what the shell passes in (RadioInput) and what the screen shows (RadioScreenModel). Pure; no DOM.
import {radioStation, stations} from '../../../radio-model.js';
import type {RadioStation} from '../../../radio-model.js';

// Editorial channel descriptions, not live programme metadata.
// Source: https://kum.dk/kulturomraader/film-og-medier/public-service (19 Oct 2026).
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'p3': 'Musik og underholdning',
  'p1': 'Nyheder og samtaler',
  'p4-ostjylland': 'Musik og regionalt indhold',
  'p6-beat': 'Alternativ musik',
  'p8-jazz': 'Jazz',
};
// The scale: 61 ticks (long every 10th, medium every 5th) and one mark per station, evenly spaced.
export const TICKS: readonly number[] = Array.from({length: 61}, (_, index) =>
  index % 10 === 0 ? 96 : index % 5 === 0 ? 64 : 38);
export const stationPosition = (index: number) => `${String(10 + index * 20)}%`;

export interface RadioFeedback {
  state?: string;
  message?: string;
}

// The shell's radio projection (widget-view.js). Every field is optional, as before; the shell is plain JS, so
// flags are compared strictly (=== true / === false), as the old renderer did.
export interface RadioInput {
  live?: boolean | null | undefined;
  connected?: boolean | null | undefined;
  blocked?: boolean | null | undefined;
  stationId?: string | null | undefined;
  playing?: boolean | null | undefined;
  enabled?: boolean | null | undefined;
  canStart?: boolean | null | undefined;
  pending?: boolean | null | undefined;
  pendingStationId?: string | null | undefined;
  feedback?: RadioFeedback | null | undefined;
  status?: string | undefined;
  setupIssue?: string | null | undefined;
  speaker?: string | null | undefined;
}

// What the view remembers between renders, for the choice rule and local selection.
export interface RadioState {
  live: boolean | null;
  connected: boolean | null;
  blocked: boolean | null;
  stationId: string | null;
  playing: boolean | null;
  enabled: boolean | null;
  canStart: boolean | null;
  pending: boolean | null;
  status: string;
  selectable: boolean | null;
}

export interface RadioListItem {
  id: string;
  label: string;
  feedback: 'label';
  loading: boolean;
  detail: string;
  icon: string;
  current: false;
}

// The data of the station <pv-choice-list> (podview/ui/library/components.js).
export interface RadioListData {
  items: RadioListItem[];
  selected: string | null;
  connected: boolean | null;
  state: 'ready' | 'unsupported' | 'offline';
  stateText: '';
  quietStatus: true;
}

export type RadioPhase = 'unavailable' | 'starting' | 'choose' | 'playing' | 'stopped' | 'chosen';

export interface RadioHero {
  available: boolean;
  phase: RadioPhase;
  // The station shown (starting, else selected), or null.
  station: RadioStation | null;
  index: number;
  statusLine: string;
  title: string;
  body: string;
  scaleLabel: string;
}

export interface RadioScreenModel {
  subtitle: string;
  feedback: {hidden: boolean; text: string; state: string};
  hero: RadioHero;
  list: RadioListData;
}

const SETUP_MESSAGES: Readonly<Record<string, string>> = {
  radio_native_not_configured:
    'Radio mangler opsætning. Kontrollér PodConnect-adressen og radiotokenet i PodVoice.',
  radio_native_auth_rejected:
    'PodConnect afviste radiotokenet. Kontrollér, at Speakers og PodVoice bruger samme radiotoken.',
};

// Defaults as the old renderer's parameters (only an absent value takes the default): canStart follows
// enabled, status is idle.
function given<T, D>(value: T | undefined, fallback: D): T | D {
  if (value !== undefined) return value;
  return fallback;
}
export function radioDefaults(input: RadioInput = {}) {
  const enabled = given(input.enabled, false);
  return {
    live: given(input.live, true),
    connected: given(input.connected, false),
    blocked: given(input.blocked, false),
    stationId: given(input.stationId, null),
    playing: given(input.playing, null),
    enabled,
    canStart: given(input.canStart, enabled),
    pending: given(input.pending, false),
    pendingStationId: given(input.pendingStationId, null),
    feedback: given(input.feedback, null),
    status: given(input.status, 'idle'),
    setupIssue: given(input.setupIssue, null),
    speaker: given(input.speaker, null),
  };
}
export type RadioValues = ReturnType<typeof radioDefaults>;

export function radioState(values: RadioValues, selected: string | null, playback: boolean | null): RadioState {
  const {live, connected, blocked, enabled, canStart, pending, status} = values;
  return {
    live, connected, blocked, stationId: selected, playing: playback, enabled, canStart, pending, status,
    selectable: connected === true && !blocked && (live === false ? !pending : enabled && canStart),
  };
}

// Hero (lærred »A-Radio«): status line, title and description for choose, starting, playing, stopped and
// not available; the station's logo, colour and needle on the scale follow the station shown.
function radioHero(
  {available, selected, playback, pendingStationId, speaker, subtitle}: {
    available: boolean; selected: string | null; playback: boolean | null;
    pendingStationId: string | null; speaker: string | null; subtitle: string;
  },
): RadioHero {
  const starting = available ? radioStation(pendingStationId) : null;
  const station = starting ?? (available ? radioStation(selected) : null);
  const index = station ? stations.findIndex(({id}) => id === station.id) : -1;
  const phase: RadioPhase = !available ? 'unavailable' : starting ? 'starting' : !station ? 'choose'
    : playback === true ? 'playing' : playback === false ? 'stopped' : 'chosen';
  const label = station?.label ?? '';
  const description = station ? DESCRIPTIONS[station.id] ?? '' : '';
  const lines: Record<RadioPhase, [string, string, string]> = {
    choose: ['Ingen station valgt', 'Vælg station', `${String(stations.length)} stationer`],
    starting: [`Starter ${label}…`, label, description],
    playing: [speaker ? `Spiller på ${speaker}` : 'Spiller', label, description],
    stopped: ['Stoppet', label, description],
    chosen: ['Valgt', label, description],
    unavailable: ['Ikke tilgængelig', 'Radio', subtitle],
  };
  const [statusLine, title, body] = lines[phase];
  return {
    available, phase, station, index, statusLine, title, body,
    scaleLabel: station ? `Stationsskala, valgt ${station.label}` : 'Stationsskala',
  };
}

export function radioScreen(values: RadioValues, selected: string | null, playback: boolean | null,
  selectable: boolean | null): RadioScreenModel {
  const {live, connected, blocked, enabled, pendingStationId, feedback, setupIssue, speaker} = values;
  const available = connected === true && !blocked && (live === false || Boolean(enabled));
  const setupMessage = setupIssue && Object.hasOwn(SETUP_MESSAGES, setupIssue) ? SETUP_MESSAGES[setupIssue] : null;
  const subtitle = available ? 'Vælg eller skift station nedenfor.'
    : blocked ? 'Adgang afvist. Dine stationer er bevaret. Kontrollér adgangen i Home Assistant.'
      : !connected ? 'Ikke forbundet. Dine stationer er bevaret. Kontrollér forbindelsen i Home Assistant.'
        : setupMessage ?? 'Radioen er ikke klar på højttalerne endnu.';
  const speakerName = typeof speaker === 'string' && speaker.trim() ? speaker.trim() : null;
  const hero = radioHero({available, selected, playback, pendingStationId, speaker: speakerName, subtitle});
  const detail = (id: string) => {
    if (available && pendingStationId === id) return 'Starter…';
    const prefix = selected !== id ? '' : playback === false ? 'Stoppet · ' : 'Valgt · ';
    return prefix + (DESCRIPTIONS[id] ?? '');
  };
  return {
    subtitle,
    feedback: {hidden: !feedback?.message, text: feedback?.message || '', state: feedback?.state || ''},
    hero,
    list: {
      items: stations.map(({id, label}) => ({
        id, label, feedback: 'label', loading: available && pendingStationId === id, detail: detail(id),
        icon: `radio-${id}`, current: false,
      })),
      selected,
      connected: selectable,
      state: available ? 'ready' : blocked || connected ? 'unsupported' : 'offline',
      stateText: '',
      quietStatus: true,
    },
  };
}
