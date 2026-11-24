// Hjem: the room picker (HA areas) and one tile per thing the room has: Vejr, Musik, Lys and Timer (then Radio,
// Opskrifter, Robot and Bil). Each tile's
// line is HA's own data (the weather entity, the room's player, its lights, the timer bridge).
import {playerModel, roomPlayer} from '../../lib/ha/media';
import {useEntities} from '../../lib/ha/transport';
import {Chip, Choices} from '../../ui';
import {useNav} from '../nav';
import {useRoom} from '../room';
import {Shortcut} from '../ui';
import {STATE_LABEL} from './Music';
import {RecipesTile} from './Recipes';
import {RobotTile} from './Robot';
import {VehicleTile} from './Vehicle';
import {useTimerLine} from './Timers';
import {useHaWeather} from './Weather';

function WeatherTile() {
  const {model} = useHaWeather();
  const push = useNav(state => state.push);
  const current = model.current;
  return (
    <Shortcut
      id="home-weather"
      screen="weather"
      iconName={current?.icon ?? 'cloud-sun'}
      title={
        current ? (
          <>
            <span data-weather="temperature">{current.temperature}</span>
            <span className="ml-pv-s1" data-weather="condition">{current.condition}</span>
          </>
        ) : (
          'Vejr'
        )
      }
      detail={current ? 'Se vejrudsigten' : (model.overviewStatus ?? model.subtitle)}
      onPress={() => {
        push('weather');
      }}
    />
  );
}

function MusicTile({players}: {players: string[]}) {
  const push = useNav(state => state.push);
  const states = useEntities(players);
  const entity = roomPlayer(states);
  const model = entity ? playerModel(entity) : null;
  const detail = !players.length
    ? 'Ingen højttaler i rummet'
    : !model
      ? 'Højttaleren er ikke tilgængelig'
      : model.title
        ? [model.title, model.artist].filter(Boolean).join(' · ')
        : `${model.name} · ${STATE_LABEL[model.state]}`;
  return (
    <Shortcut
      id="home-music"
      screen="music"
      iconName="music-note-beamed"
      title="Musik"
      detail={detail}
      onPress={() => {
        push('music');
      }}
    />
  );
}

function LightTile({lights}: {lights: string[]}) {
  const push = useNav(state => state.push);
  const states = useEntities(lights);
  const on = states.filter(state => state?.state === 'on').length;
  return (
    <Shortcut
      id="home-lights"
      screen="lights"
      iconName="lightbulb"
      title="Lys"
      detail={lights.length ? `${String(on)} af ${String(lights.length)} tændt` : 'Ingen lamper i rummet'}
      onPress={() => {
        push('lights');
      }}
    />
  );
}

function RadioTile() {
  const push = useNav(state => state.push);
  return (
    <Shortcut
      id="home-radio"
      screen="radio"
      iconName="boombox"
      title="Radio"
      detail="P3, P1, P4 og flere"
      onPress={() => {
        push('radio');
      }}
    />
  );
}

function TimerTile() {
  const push = useNav(state => state.push);
  return (
    <Shortcut
      id="home-timers"
      screen="timers"
      iconName="timer"
      title="Timer"
      detail={useTimerLine()}
      onPress={() => {
        push('timers');
      }}
    />
  );
}

export function HomeScreen() {
  const {room, rooms} = useRoom();
  const setRoom = useNav(state => state.setRoom);
  return (
    <section id="home-view" className="flex flex-[1_0_auto] flex-col gap-pv-s3 px-pv-s2" aria-labelledby="now-title">
      <header>
        <h1 id="now-title" className="mt-0 mb-2.5 text-pv-title leading-[1.08] font-medium tracking-[-0.035em]">
          {room ? room.name : 'Hjem'}
        </h1>
        <p className="text-pv-meta leading-[19px] text-pv-ink-3">
          {room ? 'Det, der er i rummet' : 'Home Assistant har ingen områder med lys eller højttalere'}
        </p>
      </header>
      {rooms.length > 1 ? (
        <Choices aria-label="Rum" value={room?.id ?? null} onChange={setRoom}>
          {rooms.map(item => (
            <Chip key={item.id} id={item.id}>
              {item.name}
            </Chip>
          ))}
        </Choices>
      ) : null}
      <div className="grid auto-rows-[minmax(168px,auto)] grid-cols-2 gap-pv-s2">
        <WeatherTile />
        <MusicTile players={room?.players ?? []} />
        <LightTile lights={room?.lights ?? []} />
        <TimerTile />
      </div>
      <div className="mt-pv-s3 grid auto-rows-[minmax(168px,auto)] grid-cols-2 gap-pv-s2 pb-pv-s3">
        <RadioTile />
        <RecipesTile />
        <RobotTile />
        <VehicleTile />
      </div>
    </section>
  );
}
