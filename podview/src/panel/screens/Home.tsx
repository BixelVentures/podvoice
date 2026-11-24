// Hjem: the room picker (HA areas) and one tile per thing the room has: Vejr, Musik, Lys and Timer (then Radio,
// Opskrifter, Robot and Bil). Each tile's
// line is HA's own data (the weather entity, the room's player, its lights, the timer bridge).
import {playerModel, roomPlayer} from '../../lib/ha/media';
import {useEntities} from '../../lib/ha/transport';
import {KitButton} from '../../lib/ui/KitButton';
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
            <span className="home-temperature">{current.temperature}</span>
            <span className="home-condition">{current.condition}</span>
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
      id="open-timers"
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
    <section id="home-view" className="response-widget pv-panel-home" aria-labelledby="now-title">
      <header className="response-heading">
        <div>
          <h1 id="now-title">{room ? room.name : 'Hjem'}</h1>
          <p>{room ? 'Det, der er i rummet' : 'Home Assistant har ingen områder med lys eller højttalere'}</p>
        </div>
      </header>
      {rooms.length > 1 ? (
        <div className="pv-panel-chips" role="radiogroup" aria-label="Rum">
          {rooms.map(item => (
            <KitButton
              key={item.id}
              role="radio"
              aria-checked={item.id === room?.id}
              className="pv-panel-chip"
              onPress={() => {
                setRoom(item.id);
              }}
            >
              {item.name}
            </KitButton>
          ))}
        </div>
      ) : null}
      <div className="home-shortcuts pv-panel-tiles">
        <WeatherTile />
        <MusicTile players={room?.players ?? []} />
        <LightTile lights={room?.lights ?? []} />
        <TimerTile />
      </div>
      <div className="home-shortcuts home-extensions pv-panel-tiles">
        <RadioTile />
        <RecipesTile />
        <RobotTile />
        <VehicleTile />
      </div>
    </section>
  );
}
