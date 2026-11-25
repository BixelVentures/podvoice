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
import {weatherOverviewDetail} from '../../screens/weather/view-model';
import {Widget} from '../../ui';
import type {GlyphName, WidgetHour} from '../../ui';
import {useNav} from '../nav';
import {useRoom} from '../room';
import {useLightRooms} from './Lights';
import {HA_AWAY, useRadioNow} from './radio-now';
import {RecipesTile} from './Recipes';
import {RobotTile} from './Robot';
import {useTimerWidget} from './Timers';
import {VehicleTile} from './Vehicle';
import {todayRange, useHaWeather} from './Weather';

// A weather icon (assets/icons names) as the kit's glyph.
export function weatherGlyph(icon: string | null | undefined): GlyphName {
  if (!icon) return 'cloud';
  if (/rain|drizzle|lightning|snow|storm/.test(icon)) return 'rain';
  if (icon.includes('sun')) return 'sun';
  return 'cloud';
}

// »7 °C« or »7°«: the widget and the topbar show degrees without the unit.
export const degrees = (value: string) => value.replace(/\s*°[CF]$/, '°');

export {todayRange} from './Weather';

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

// Lys (K-Widget): this screen's room, from the same model as the Lys page (a Hue room group is not a lamp and counts
// nowhere); »+N« when other rooms have lights too (one press: it opens Lys with every room).
function LightWidget() {
  const push = useNav(state => state.push);
  const {room} = useRoom();
  const {models, own} = useLightRooms(false);
  const name = room?.name ?? '';
  const more = models.filter(model => !model.own).length;
  const state = !own ? 'ikkeforbundet' : own.state === 'tom' ? 'ikkeforbundet' : own.state;
  const prim = !models.length ? 'Ikke forbundet' : !own ? 'Ingen lamper i rummet' : STATUS_PRIM[own.state];
  return (
    <Widget
      id="home-lights"
      kind="lys"
      state={state}
      opens="lights"
      prim={prim}
      more={more}
      ctx={own?.on && own.level !== null ? `${name} · ${String(own.level)} %` : name}
      description={own ? `${String(own.lampsOn)} af ${String(own.lampsKnown)} tændt` : ''}
      onPress={() => {
        push('lights');
      }}
    />
  );
}

const STATUS_PRIM = {taendt: 'Tændt', slukket: 'Slukket', ukendt: 'Status ukendt', tom: 'Ingen lamper i rummet'};

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

// Radio (K-Widget radio): what the radio does now (radio-now.ts): »Vælg station« with the stations, the station
// starting or playing with its logo and where, or »Ikke tilgængelig«. Always the white entry surface.
function RadioWidget() {
  const push = useNav(state => state.push);
  const {phase, station, stations, current, destination, reason} = useRadioNow();
  const where = (phase === 'spiller' ? current : destination)?.name ?? '';
  const lines = phase === 'ikketilg' ? {prim: 'Ikke tilgængelig', ctx: reason === HA_AWAY ? 'HA svarer ikke' : reason}
    : !station ? {prim: 'Vælg station', ctx: stations.map(row => row.mark).join(' · ')}
      : phase === 'starter' ? {prim: station.name, ctx: `Starter ${station.name}…`}
        : {prim: station.name, ctx: where};
  return (
    <Widget
      id="home-radio"
      kind="radio"
      state={phase === 'spiller' || phase === 'starter' ? phase : phase === 'ikketilg' ? 'ikketilg' : 'vaelg'}
      opens="radio"
      {...(station && phase !== 'ikketilg' ? {logo: station.logo} : {tile: 'radio' as const})}
      prim={lines.prim}
      ctx={lines.ctx}
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
        <Slot><LightWidget /></Slot>
        <Slot><VehicleTile /></Slot>
        <Slot><MusicWidget players={room?.players ?? []} /></Slot>
        <Slot><RadioWidget /></Slot>
        <Slot><RecipesTile /></Slot>
        <Slot><TimerWidget /></Slot>
      </div>
    </section>
  );
}
