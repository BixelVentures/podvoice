// Hjem (the design canvas's »Main«): a 4×3 grid of K-Widgets in fixed slots beside the room player. Vejr L, Robot
// M, Lys and Tesla S, then Musik, Radio, Opskrifter and Timer; a state never moves a widget, and a domain HA does not
// have leaves its slot empty. Every widget's content is HA's own data (the weather entity, the vacuum, the room's
// lights and player, the car, the recipe catalogue, the timer bridge); the room is chosen at the top of the player.
import type {ReactNode} from 'react';
import {usePicks} from '../../lib/ha/find-music';
import {playerModel, roomPlayer} from '../../lib/ha/media';
import {accountOf, isActive} from '../../lib/ha/podconnect';
import {useCatalog, useEntities} from '../../lib/ha/transport';
import {useNow} from '../../lib/hooks/clock';
import type {WeatherDetailModel} from '../../screens/weather/model';
import {weatherOverviewDetail} from '../../screens/weather/view-model';
import {Widget} from '../../ui';
import type {GlyphName, WidgetHour} from '../../ui';
import {useNav} from '../nav';
import {useRoom} from '../room';
import {RecipesTile} from './Recipes';
import {RobotTile} from './Robot';
import {useTimerWidget} from './Timers';
import {VehicleTile} from './Vehicle';
import {useHaWeather} from './Weather';

// A weather icon (assets/icons names) as the kit's glyph.
export function weatherGlyph(icon: string | null | undefined): GlyphName {
  if (!icon) return 'cloud';
  if (/rain|drizzle|lightning|snow|storm/.test(icon)) return 'rain';
  if (icon.includes('sun')) return 'sun';
  return 'cloud';
}

// »7 °C« or »7°«: the widget and the topbar show degrees without the unit.
export const degrees = (value: string) => value.replace(/\s*°[CF]$/, '°');

const dayKey = (at: number) => new Date(at).toLocaleDateString('da-DK', {timeZone: 'Europe/Copenhagen'});

// The day's high and low (»Højst 17° · lavest 9°«): HA's daily forecast for today, else today's hours in its hourly
// forecast with the temperature now; only when neither is known, the overview's own words.
export function todayRange(model: WeatherDetailModel, now: number): string {
  const range = weatherOverviewDetail(model);
  if (!model.current || model.current.range) return range;
  const today = dayKey(now);
  const temperatures = [
    Number.parseFloat(model.current.temperature.replace(',', '.').replace('−', '-')),
    ...model.hours.filter(hour => dayKey(Date.parse(hour.id)) === today)
      .map(hour => hour.temperatureNumber),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (temperatures.length < 2) return range;
  const format = (value: number) => `${String(Math.round(value)).replace('-', '−')}°`;
  return `Højst ${format(Math.max(...temperatures))} · lavest ${format(Math.min(...temperatures))}`;
}

function WeatherWidget() {
  const {model} = useHaWeather();
  const now = useNow();
  const push = useNav(state => state.push);
  const current = model.current;
  const hours: WidgetHour[] = model.hours.slice(0, 5).map(hour => ({time: hour.time,
    value: degrees(hour.temperature), glyph: weatherGlyph(hour.icon)}));
  const state = !current ? 'ukendt' : model.sourceStale || model.timeStale ? 'sidstkendt' : 'frisk';
  return (
    <Widget
      id="home-weather"
      kind="vejr"
      state={state}
      opens="weather"
      big={current ? degrees(current.temperature) : '—'}
      prim={current ? weatherOverviewDetail(model, {role: 'condition'}) : (model.overviewStatus ?? model.subtitle)}
      ctx={todayRange(model, now)}
      hours={current ? hours : []}
      onPress={() => {
        push('weather');
      }}
    />
  );
}

function LightWidget({lights, room}: {lights: string[]; room: string}) {
  const push = useNav(state => state.push);
  const states = useEntities(lights);
  const known = states.filter(state => state && state.state !== 'unavailable' && state.state !== 'unknown');
  const on = known.filter(state => state?.state === 'on');
  const levels = on.map(state => state?.attributes.brightness).filter((value): value is number =>
    typeof value === 'number');
  const level = levels.length ? Math.round((levels.reduce((sum, value) => sum + value, 0) / levels.length / 255) * 100)
    : null;
  const state = !lights.length ? 'ikkeforbundet' : !known.length ? 'ukendt' : on.length ? 'taendt' : 'slukket';
  const prim = !lights.length ? 'Ingen lamper i rummet' : !known.length ? 'Status ukendt' : on.length ? 'Tændt'
    : 'Slukket';
  return (
    <Widget
      id="home-lights"
      kind="lys"
      state={state}
      opens="lights"
      prim={prim}
      ctx={on.length && level !== null ? `${room} · ${String(level)} %` : room}
      description={lights.length ? `${String(on.length)} af ${String(lights.length)} tændt` : ''}
      onPress={() => {
        push('lights');
      }}
    />
  );
}

// Musik (owner decision 25 Nov): the player beside it already shows what plays, so while music plays the widget is
// the way to Find musik with today's AI pick (the first »ai_moment« shelf, its title and cover); with nothing
// playing it reads »Vælg musik« and opens Musik.
function MusicWidget({players}: {players: string[]}) {
  const push = useNav(state => state.push);
  const entity = roomPlayer(useEntities(players));
  const model = entity ? playerModel(entity) : null;
  // Another account playing here is not the room's own music: the widget stays »Vælg musik«.
  const playing = !!model?.title && model.state === 'playing' && !(accountOf(entity) === 'other' && isActive(entity));
  const {weather} = useCatalog();
  const picks = usePicks(playing, weather[0] ?? null);
  const pick = picks.data?.find(shelf => shelf.id === 'ai_moment') ?? null;
  const cover = pick?.items.find(item => item.artwork)?.artwork ?? null;
  if (playing && pick) {
    return (
      <Widget
        id="home-music"
        kind="musik"
        state="forslag"
        opens="find"
        prim={pick.title}
        ctx="Dagens AI-valg · Find musik"
        {...(cover ? {cover} : {tile: 'disc' as const})}
        onPress={() => {
          push('find');
        }}
      />
    );
  }
  return (
    <Widget
      id="home-music"
      kind="musik"
      state="ikketilg"
      opens="music"
      prim="Vælg musik"
      ctx="Fortsæt og playlister"
      tile="disc"
      onPress={() => {
        push('music');
      }}
    />
  );
}

function RadioWidget() {
  const push = useNav(state => state.push);
  return (
    <Widget
      id="home-radio"
      kind="radio"
      state="vaelg"
      opens="radio"
      tile="radio"
      prim="Vælg station"
      ctx="P1 · P3 · P4 · P6 · P8"
      onPress={() => {
        push('radio');
      }}
    />
  );
}

function TimerWidget() {
  const push = useNav(state => state.push);
  const {state, prim, ctx, ring, name} = useTimerWidget();
  return (
    <Widget
      id="home-timers"
      kind="timer"
      state={state}
      opens="timers"
      prim={prim}
      ctx={ctx}
      {...(ring === undefined ? {} : {ring})}
      {...(name ? {description: name} : {})}
      onPress={() => {
        push('timers');
      }}
    />
  );
}

// A fixed slot: its place in the grid, whatever the widget in it shows.
function Slot({area = '', children}: {area?: string; children: ReactNode}) {
  return <div className={`min-h-0 min-w-0 ${area}`}>{children}</div>;
}

export function HomeScreen() {
  const {room} = useRoom();
  return (
    <section id="home-view" className="flex min-h-0 flex-1 flex-col" aria-labelledby="now-title">
      <h1 id="now-title" className="sr-only">{room ? room.name : 'Hjem'}</h1>
      <div className="grid h-full max-h-[692px] min-h-0 grid-cols-[repeat(4,172px)]
        grid-rows-[repeat(3,minmax(0,220px))] gap-4">
        <Slot area="col-span-2 row-span-2"><WeatherWidget /></Slot>
        <Slot area="col-span-2"><RobotTile /></Slot>
        <Slot><LightWidget lights={room?.lights ?? []} room={room?.name ?? ''} /></Slot>
        <Slot><VehicleTile /></Slot>
        <Slot><MusicWidget players={room?.players ?? []} /></Slot>
        <Slot><RadioWidget /></Slot>
        <Slot><RecipesTile /></Slot>
        <Slot><TimerWidget /></Slot>
      </div>
    </section>
  );
}
