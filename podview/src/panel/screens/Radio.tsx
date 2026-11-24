// Radio: the stations PodConnect Speakers plays, through the PodVoice integration's radio bridge. A station tap
// starts it on the next destination (»Afspil på«), else on the speaker playing radio now, else on Speakers' default
// room; a speaker tap moves the playing radio; »Stop« stops it. The room's media_player confirms each (it plays
// radio, or no longer does); an unreachable radio is said so with the reason, never guessed.
import {useEffect} from 'react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import {sourceOf, useSpeakers} from '../../lib/ha/podconnect';
import {radio, RADIO_KEY, radioPlaying, useRadio} from '../../lib/ha/radio';
import type {LiveRadio, RadioTarget} from '../../lib/ha/radio';
import {haKeys, useEntities, useLink} from '../../lib/ha/transport';
import {queryClient} from '../../lib/query/client';
import {KitButton} from '../../lib/ui/KitButton';
import {BUTTON, icon, Notice, wishNotice} from '../ui';

const ROW = 'pv-row pv-btn pv-kit pv-kit-listrow';

const UNAVAILABLE_TEXT: Record<string, string> = {
  not_configured: 'Radioen findes i PodConnect Speakers, som PodConnect ikke er sat op med.',
  not_installed: 'PodConnect Speakers er ikke installeret.',
  no_supervisor: 'Radioen kræver PodConnect Speakers-add-on’et.',
  no_token: 'PodConnect Speakers har ingen radio-adgangskode.',
  unauthorized: 'PodConnect Speakers afviste adgangen til radioen.',
  unreachable: 'PodConnect Speakers svarer ikke.',
  unreadable: 'Radioens svar kunne ikke læses.',
};

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

function Live({live}: {live: LiveRadio}) {
  const next = useSpeakers(state => state.nextDestination);
  // The speakers are the status: when one starts or stops playing radio, the radio is read again at once.
  const speakers = useEntities(live.targets.flatMap(row => (row.entity_id ? [row.entity_id] : [])));
  const heard = JSON.stringify(speakers.map(entity => [entity?.state, sourceOf(entity)]));
  useEffect(() => {
    void queryClient.invalidateQueries({queryKey: [...haKeys.read, 'radio']});
  }, [heard]);
  const wish = useStore(commands.store, state => state.wishes[RADIO_KEY]);
  const playing = radioPlaying(live);
  const shown = wish && (wish.phase === 'sending' || wish.phase === 'awaiting') ? wish.value : null;
  const wishedStation = typeof shown === 'object' && shown ? (shown as {station?: string}).station ?? null : null;
  const stoppedWish = shown === 'stop';
  const station = live.stations.find(row => row.id === (wishedStation ?? (playing ? live.station_id : null)));
  const destination = destinationOf(live, next);
  const current = live.targets.find(row => row.id === live.target_id) ?? null;
  // A wish whose proof is not an entity ends with the next read that shows it.
  useEffect(() => {
    if (!wish || (wish.phase !== 'sending' && wish.phase !== 'awaiting') || wish.entityId) return;
    if (wish.value === 'stop' ? !playing : playing) commands.settle(RADIO_KEY, true);
  }, [wish, playing]);
  const status = stoppedWish ? 'Stopper' : station ? `${station.name} · ${playing ? 'Direkte' : 'Forbinder'}`
    : live.state === 'preparing' ? 'Forbinder' : 'Stoppet';
  return (
    <>
      <article className="pv-kit pv-kit-hero pv-hero" data-kit="hero" data-kit-identity="music"
        data-radio-state={playing ? 'live' : 'stopped'} aria-label={`Radio: ${status}`}>
        <p data-kit-slot="title">{station?.name ?? 'Radio'}</p>
        <span data-kit-slot="body">
          {status}
          {current && playing ? ` · ${current.name}` : ''}
        </span>
        <KitButton
          className={BUTTON}
          data-kit="button"
          data-kit-variant="secondary"
          hidden={!playing}
          aria-busy={stoppedWish}
          isDisabled={!live.actions.includes('stop')}
          onPress={() => {
            radio.stop(current);
          }}
        >
          <img src={icon('stop-fill')} alt="" /> Stop
        </KitButton>
      </article>
      {!live.enabled ? (
        <p className="screen-explanation" role="status">Radioen er ikke slået til i PodConnect Speakers.</p>
      ) : null}
      <section aria-labelledby="radio-stations-title">
        <h2 id="radio-stations-title">Stationer</h2>
        <div className="pv-dialog-content" role="group" aria-label="Stationer">
          {live.stations.map(row => {
            const on = (wishedStation ?? (playing ? live.station_id : null)) === row.id;
            return (
              <KitButton
                key={row.id}
                className={ROW}
                data-kit="listrow"
                data-station={row.id}
                aria-pressed={on}
                aria-label={`${row.name}${destination ? ` · Afspil på ${destination.name}` : ''}`}
                isDisabled={!destination || !live.actions.includes('start')}
                onPress={() => {
                  if (destination) radio.start(row.id, destination);
                }}
              >
                <img src={`assets/radio-${row.id}.svg`} alt="" />
                <span>
                  <strong>{row.name}</strong>
                  <small>{on ? 'Direkte' : ''}</small>
                </span>
              </KitButton>
            );
          })}
        </div>
      </section>
      {playing ? (
        <section aria-labelledby="radio-targets-title">
          <h2 id="radio-targets-title">Afspil på</h2>
          <div className="pv-dialog-content" role="group" aria-label="Højttalere">
            {live.targets.map(row => (
              <KitButton
                key={row.id}
                className={ROW}
                data-kit="listrow"
                aria-pressed={row.id === live.target_id}
                isDisabled={!row.selectable || row.id === live.target_id || !live.actions.includes('move')}
                onPress={() => {
                  radio.move(row);
                }}
              >
                <img src={icon('speaker-output')} alt="" />
                <span>
                  <strong>{row.name}</strong>
                  <small>{row.available ? 'Tilgængelig' : 'Ikke tilgængelig'}</small>
                </span>
                <span className="target-status">{row.id === live.target_id ? 'Aktuelt output' : ''}</span>
              </KitButton>
            ))}
          </div>
        </section>
      ) : null}
      <Notice text={wishNotice(wish)} />
    </>
  );
}

export function RadioScreen() {
  const {generation} = useLink();
  const {data, isError, refetch} = useRadio(generation);
  return (
    <section id="radio-view" className="response-widget" aria-labelledby="radio-title">
      <header className="response-heading">
        <div>
          <h1 id="radio-title">Radio</h1>
          <p>Direkte radio</p>
        </div>
      </header>
      {data?.available ? <Live live={data} /> : null}
      {data && !data.available ? (
        <p className="screen-explanation" role="status">
          {UNAVAILABLE_TEXT[data.reason] ?? 'Radioen kan ikke nås lige nu.'}
        </p>
      ) : null}
      {isError && !data ? (
        <p className="screen-explanation" role="status">
          Radioen kunne ikke hentes.{' '}
          <KitButton className="pv-panel-chip" onPress={() => void refetch()}>
            Prøv igen
          </KitButton>
        </p>
      ) : null}
    </section>
  );
}
