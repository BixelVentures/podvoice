// What the radio is doing now, for every place that shows it (Radio's hero and tiles, the Radio widget on Hjem, the
// player's radio mode and Ro's music card): PodConnect Speakers' own pushed state (lib/ha/radio.ts), the radio
// command in flight (shown at once, never resent) and the room speakers that confirm it. One model, read the same way
// everywhere: vaelg (nothing chosen), starter (a start on its way, or Speakers preparing), spiller (it plays),
// ikketilg (Speakers or Home Assistant cannot be reached, with the product's reason).
import {useEffect} from 'react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import {sourceOf, useSpeakers} from '../../lib/ha/podconnect';
import {catalogueOrder, RADIO_KEY, radioPlaying, STATION_LOOK, STATION_ORDER, stationLogo, useRadio}
  from '../../lib/ha/radio';
import type {LiveRadio, RadioTarget} from '../../lib/ha/radio';
import {haKeys, useEntities, useLink} from '../../lib/ha/transport';
import {queryClient} from '../../lib/query/client';
import type {RadioPhase} from '../../ui/Radio';

export const UNAVAILABLE_TEXT: Record<string, string> = {
  not_configured: 'Radioen findes i PodConnect Speakers, som PodConnect ikke er sat op med.',
  not_installed: 'PodConnect Speakers er ikke installeret.',
  no_supervisor: 'Radioen kræver PodConnect Speakers-add-on’et.',
  no_token: 'PodConnect Speakers har ingen radio-adgangskode.',
  unauthorized: 'PodConnect Speakers afviste adgangen til radioen.',
  unreachable: 'PodConnect Speakers svarer ikke.',
  unreadable: 'Radioens svar kunne ikke læses.',
};
export const HA_AWAY = 'Home Assistant svarer ikke lige nu';
export const NOT_ENABLED = 'Radioen er ikke slået til i PodConnect Speakers.';
export const READ_FAILED = 'Radioen kunne ikke hentes.';

export interface RadioStationShown {
  id: string;
  name: string;
  logo: string;
  colour: string;
  mark: string;
  description: string;
}

export interface RadioNow {
  phase: RadioPhase;
  /** The station shown: the one starting, else the one playing. */
  station: RadioStationShown | null;
  /** Every station Speakers offers, P1 first. */
  stations: RadioStationShown[];
  live: LiveRadio | null;
  /** Where the radio plays now, and where a start goes (»Afspil på«, else where it plays, else the default). */
  current: RadioTarget | null;
  destination: RadioTarget | null;
  /** A stop on its way. */
  stopping: boolean;
  /** Why it is not available (the hero's sub line), or ''. */
  reason: string;
  /** A read that failed with nothing known: »Prøv igen« reads once. */
  retry: (() => void) | null;
}

export function stationShown(id: string, name: string): RadioStationShown {
  const look = STATION_LOOK[id];
  return {id, name, logo: stationLogo(id), colour: look?.colour ?? '#8C8A85', mark: look?.mark ?? name,
    description: look?.description ?? ''};
}

// Where a start goes: the chosen next destination, else where radio plays, else Speakers' default room.
function destinationOf(live: LiveRadio, next: string | null): RadioTarget | null {
  const selectable = live.targets.filter(row => row.selectable);
  return (
    selectable.find(row => next !== null && row.entity_id === next) ??
    selectable.find(row => row.id === live.target_id) ??
    selectable.find(row => row.default) ??
    selectable[0] ??
    null
  );
}

const pending = (phase: string | undefined) => phase === 'sending' || phase === 'awaiting';

export function useRadioNow(): RadioNow {
  const {generation, connected} = useLink();
  const {data, isError, refetch} = useRadio(generation);
  const live = data?.available ? data : null;
  const next = useSpeakers(state => state.nextDestination);
  // The speakers are the status: when one starts or stops playing radio, the radio is read again at once.
  const speakers = useEntities(live ? live.targets.flatMap(row => (row.entity_id ? [row.entity_id] : [])) : []);
  const heard = JSON.stringify(speakers.map(entity => [entity?.state, sourceOf(entity)]));
  useEffect(() => {
    if (live) void queryClient.invalidateQueries({queryKey: [...haKeys.read, 'radio']});
    // Only a change in the speakers asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard]);
  const wish = useStore(commands.store, state => state.wishes[RADIO_KEY]);
  const playing = live ? radioPlaying(live) : false;
  const shown = wish && pending(wish.phase) ? wish.value : null;
  const wishedStation = typeof shown === 'object' && shown ? (shown as {station?: string}).station ?? null : null;
  const stopping = shown === 'stop';
  // A wish whose proof is not an entity ends with the next read that shows it.
  useEffect(() => {
    if (!wish || !pending(wish.phase) || wish.entityId) return;
    if (wish.value === 'stop' ? !playing : playing) commands.settle(RADIO_KEY, true);
  }, [wish, playing]);
  // Before Speakers answers, or when it cannot, the catalogue's own stations stand in their places (disabled).
  const stations = live ? catalogueOrder(live.stations).map(row => stationShown(row.id, row.name))
    : STATION_ORDER.map(id => stationShown(id, STATION_LOOK[id]?.name ?? id));
  const stationId = wishedStation ?? (playing || live?.state === 'preparing' ? live?.station_id ?? null : null);
  const station = stations.find(row => row.id === stationId) ?? null;
  const reason = !connected ? HA_AWAY : data && !data.available
    ? (UNAVAILABLE_TEXT[data.reason] ?? 'Radioen kan ikke nås lige nu.')
    : live && !live.enabled ? NOT_ENABLED : isError && !data ? READ_FAILED : '';
  const phase: RadioPhase = reason ? 'ikketilg' : !station ? 'vaelg'
    : wishedStation || (live?.state === 'preparing' && !playing) ? 'starter' : 'spiller';
  return {
    phase,
    station: phase === 'ikketilg' ? null : station,
    stations,
    live,
    current: live?.targets.find(row => row.id === live.target_id) ?? null,
    destination: live ? destinationOf(live, next) : null,
    stopping,
    reason,
    retry: isError && !data ? () => void refetch() : null,
  };
}
