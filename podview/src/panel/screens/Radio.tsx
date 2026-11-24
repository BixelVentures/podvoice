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
import {Button as AriaButton} from 'react-aria-components';
import {Button, cx, Icon} from '../../ui';
import {Notice, wishNotice} from '../ui';
import {hero, ScreenHeading, SCREEN} from './Music';
import {TARGET_ROW, TargetCopy} from './music-speakers';

const SECTION_TITLE = 'mb-pv-s2 text-pv-label font-semibold tracking-[-0.4px]';
const EXPLANATION = 'text-pv-body text-pv-ink-3';

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
      <article className={hero({compact: false, offline: true})} data-radio-state={playing ? 'live' : 'stopped'}
        aria-label={`Radio: ${status}`}>
        <div className="flex min-w-0 items-center gap-pv-s3">
          <span className="grid size-24 shrink-0 place-items-center rounded-pv-l bg-pv-surface-2" aria-hidden="true">
            {station ? (
              <img className="pointer-events-none size-12" src={`assets/radio-${station.id}.svg`} alt="" />
            ) : (
              <Icon name="boombox" className="size-10" />
            )}
          </span>
          <div className="grid min-w-0 flex-1 gap-pv-s1">
            <p className="truncate text-pv-label font-semibold">{station?.name ?? 'Radio'}</p>
            <span className="text-pv-meta text-pv-ink-2">
              {status}
              {current && playing ? ` · ${current.name}` : ''}
            </span>
          </div>
          <Button
            hidden={!playing}
            busy={stoppedWish}
            isDisabled={!live.actions.includes('stop')}
            onPress={() => {
              radio.stop(current);
            }}
          >
            <Icon name="stop-fill" /> Stop
          </Button>
        </div>
      </article>
      {!live.enabled ? (
        <p className={EXPLANATION} role="status">Radioen er ikke slået til i PodConnect Speakers.</p>
      ) : null}
      <section aria-labelledby="radio-stations-title">
        <h2 id="radio-stations-title" className={SECTION_TITLE}>Stationer</h2>
        <div className="grid gap-pv-s1" role="group" aria-label="Stationer">
          {live.stations.map(row => {
            const on = (wishedStation ?? (playing ? live.station_id : null)) === row.id;
            return (
              <AriaButton
                key={row.id}
                className={cx(TARGET_ROW, 'min-h-pv-hit')}
                data-station={row.id}
                aria-pressed={on}
                aria-label={`${row.name}${destination ? ` · Afspil på ${destination.name}` : ''}`}
                isDisabled={!destination || !live.actions.includes('start')}
                onPress={() => {
                  if (destination) radio.start(row.id, destination);
                }}
              >
                <img className="pointer-events-none size-pv-icon-m" src={`assets/radio-${row.id}.svg`} alt="" />
                <strong className="truncate text-pv-body font-bold">{row.name}</strong>
                <span className="text-pv-meta text-pv-ink-2">{on ? 'Direkte' : ''}</span>
              </AriaButton>
            );
          })}
        </div>
      </section>
      {playing ? (
        <section aria-labelledby="radio-targets-title">
          <h2 id="radio-targets-title" className={SECTION_TITLE}>Afspil på</h2>
          <div className="grid gap-pv-s2" role="group" aria-label="Højttalere">
            {live.targets.map(row => (
              <AriaButton
                key={row.id}
                className={TARGET_ROW}
                aria-pressed={row.id === live.target_id}
                isDisabled={!row.selectable || row.id === live.target_id || !live.actions.includes('move')}
                onPress={() => {
                  radio.move(row);
                }}
              >
                <TargetCopy icon={<Icon name="speaker-output" className="size-pv-icon-m" />} name={row.name}
                  detail={row.available ? 'Tilgængelig' : 'Ikke tilgængelig'}
                  status={row.id === live.target_id ? 'Aktuelt output' : ''} />
              </AriaButton>
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
    <section id="radio-view" className={cx(SCREEN, 'gap-pv-s3')} aria-labelledby="radio-title">
      <ScreenHeading id="radio-title" title="Radio" line="Direkte radio" className="pb-0" />
      {data?.available ? <Live live={data} /> : null}
      {data && !data.available ? (
        <p className={EXPLANATION} role="status">
          {UNAVAILABLE_TEXT[data.reason] ?? 'Radioen kan ikke nås lige nu.'}
        </p>
      ) : null}
      {isError && !data ? (
        <p className={EXPLANATION} role="status">
          Radioen kunne ikke hentes.{' '}
          <Button size="chip" onPress={() => void refetch()}>
            Prøv igen
          </Button>
        </p>
      ) : null}
    </section>
  );
}
