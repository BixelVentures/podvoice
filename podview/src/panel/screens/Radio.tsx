// Radio (the design canvas's A-Radio and Radio-Starter/Spiller/IkkeTilg): the stations PodConnect Speakers plays,
// through the PodVoice integration's radio bridge, composed of the kit's radio pieces (src/ui/Radio.tsx). The hero
// shows the station starting or playing over the station scale; the tiles start a station on the next destination
// (»Afspil på«), else on the speaker playing radio now, else on Speakers' default room. Start, stop and volume live in
// the player (the radio always plays through it); »Afspilles på …« opens »Afspil på«, where a speaker tap moves the
// playing radio. The room's media_player confirms each; an unreachable radio is said so with the reason, never
// guessed (the hybrid rule: the reason is the hero's sub line, no extra notice).
import {useState} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import {radio, RADIO_KEY} from '../../lib/ha/radio';
import {Button, cx, Icon, pressable, SectionTitle, Sheet, tapOnly} from '../../ui';
import {RadioHero, StationTile} from '../../ui/Radio';
import {Notice, wishNotice} from '../ui';
import {ScreenHeading} from './Music';
import {TARGET_ROW, TargetCopy} from './music-speakers';
import {useRadioNow} from './radio-now';
import type {RadioNow} from './radio-now';

function heroLines(now: RadioNow): {status: string; title: string; sub: string} {
  const {phase, station, current, stations, stopping, reason} = now;
  if (phase === 'ikketilg') return {status: 'Ikke tilgængelig', title: 'Radio', sub: reason};
  if (!station) return {status: 'Ingen station valgt', title: 'Vælg station', sub: `${String(stations.length)} stationer`};
  if (phase === 'starter') return {status: `Starter ${station.name}…`, title: station.name, sub: station.description};
  return {status: stopping ? 'Stopper…' : current ? `Spiller på ${current.name}` : 'Spiller', title: station.name,
    sub: station.description};
}

// »Afspil på« for the radio: every target Speakers offers; a tap moves the playing radio there.
function TargetSheet({now, isOpen, onClose}: {now: RadioNow; isOpen: boolean; onClose: () => void}) {
  const {live} = now;
  const playing = now.phase === 'spiller';
  return (
    <Sheet
      id="radio-targets"
      isOpen={isOpen}
      onClose={onClose}
      title="Afspil på"
      description={playing ? 'Vælg højttaler til radioen.' : 'Radioen starter her, når du vælger en station.'}
    >
      <div className="grid gap-pv-s2" role="group" aria-label="Højttalere">
        {(live?.targets ?? []).map(row => (
          <AriaButton
            key={row.id}
            className={TARGET_ROW}
            aria-pressed={row.id === (playing ? live?.target_id : now.destination?.id)}
            isDisabled={!row.selectable || !playing || row.id === live?.target_id ||
              !live?.actions.includes('move')}
            onPress={tapOnly(() => {
              radio.move(row);
            })}
          >
            <TargetCopy icon={<Icon name="speaker-output" className="size-pv-icon-m" />} name={row.name}
              detail={row.available ? 'Tilgængelig' : 'Ikke tilgængelig'}
              status={row.id === live?.target_id && playing ? 'Aktuelt output' : ''} />
          </AriaButton>
        ))}
      </div>
    </Sheet>
  );
}

export function RadioScreen() {
  const now = useRadioNow();
  const wish = useStore(commands.store, state => state.wishes[RADIO_KEY]);
  const [sheet, setSheet] = useState(false);
  const {phase, station, stations, live, destination, retry} = now;
  const off = phase === 'ikketilg';
  const lines = heroLines(now);
  const where = now.current && phase === 'spiller' ? now.current : destination;
  return (
    <section id="radio-view" className="flex h-full min-h-[692px] flex-col gap-8" aria-labelledby="radio-title"
      data-radio-state={phase === 'spiller' ? 'live' : phase}>
      <ScreenHeading id="radio-title" title="Radio" line="Direkte radio" />
      <RadioHero
        phase={phase}
        station={station}
        status={lines.status}
        title={lines.title}
        sub={lines.sub}
        marks={stations.map(row => row.mark)}
        index={station ? stations.findIndex(row => row.id === station.id) : null}
      />
      <section className="flex min-h-0 flex-1 flex-col gap-4" aria-labelledby="radio-stations-title">
        <div className="flex items-baseline justify-between gap-4">
          <SectionTitle id="radio-stations-title">Radiostationer</SectionTitle>
          {retry ? (
            <Button variant="sekundaer" size={44} onPress={retry}>Prøv igen</Button>
          ) : where && !off ? (
            <AriaButton className={cx(pressable, 'min-h-11 rounded-pv-pill px-2 text-[15px] text-pv-ink-3')}
              aria-haspopup="dialog" onPress={tapOnly(() => { setSheet(true); })}>
              {`Afspilles på ${where.name}`}
            </AriaButton>
          ) : null}
        </div>
        <div className="grid flex-1 grid-cols-5 gap-4" role="group" aria-label="Stationer">
          {stations.map(row => (
            <StationTile
              key={row.id}
              id={row.id}
              name={row.name}
              logo={row.logo}
              colour={row.colour}
              selected={!off && station?.id === row.id}
              disabled={off || !live || !destination || !live.actions.includes('start')}
              label={`${row.name}${destination ? ` · Afspil på ${destination.name}` : ''}`}
              onPress={() => {
                if (destination) radio.start(row.id, destination);
              }}
            />
          ))}
        </div>
      </section>
      <Notice text={wishNotice(wish)} />
      <TargetSheet now={now} isOpen={sheet} onClose={() => { setSheet(false); }} />
    </section>
  );
}
