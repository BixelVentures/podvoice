// The kit gallery's screen pieces for Vejr, Radio, Ro and Find musik: every state of A-Vejr's hero (frisk,
// raadventer, regel, raadfejl, gammel, ukendt) and its days, A-Radio's hero (vaelg, starter, spiller, ikketilg) and
// tiles, A-FotoRo's glass cards and Foto-Nat's face, and Hylder's quick picks, shelf and search field, with the design
// canvas's own sample content, so each can be laid next to its board.
import {RadioHero, StationTile} from '../Radio';
import type {RadioPhase} from '../Radio';
import {GlassCard, NightFace, RestClock, RestWeather} from '../Rest';
import {QuickPick, SearchBox, Shelf, ShelfTile} from '../Shelf';
import {WeatherDays, WeatherHero} from '../Weather';
import type {WeatherAdvice, WeatherHeroProps} from '../Weather';

const noop = () => undefined;
const CLOUD = 'assets/icons/cloud.svg';
const AI = 'Det bliver køligere i aften, fra 5 °C kl. 20 til 2 °C ved midnat; tag en varm jakke på.';
const HOURS = ([['20', '5°', '10 %', '6,2 m/s', 307], ['21', '4°', '9 %', '6,1 m/s', 300],
  ['22', '4°', '9 %', '5,6 m/s', 290], ['23', '3°', '', '5,4 m/s', 285], ['00', '2°', '', '5,1 m/s', 280]] as const)
  .map(([time, temperature, rain, wind, degrees]) => ({id: time, time: `${time}.00`, icon: CLOUD, condition: 'Skyet',
    temperature, rain, wind, windDegrees: degrees, label: `${time}.00`}));
const DAYS = ([['I dag', '6°', '9°', 20, 30], ['Tirsdag', '5°', '10°', 15, 40], ['Onsdag', '4°', '8°', 10, 32],
  ['Torsdag', '3°', '7°', 6, 30], ['Fredag', '5°', '11°', 16, 46]] as const)
  .map(([day, low, high, start, length]) => ({id: day, day, icon: CLOUD, condition: 'Skyet', low, high, start, length,
    label: day}));

const aiAdvice: WeatherAdvice = {state: 'text', text: AI, ai: true};
const BASE: WeatherHeroProps = {place: 'Mårslet', big: '5°', line: 'Skyet', advice: aiAdvice,
  sub: 'Højst 5° · Lavest 4°', tone: 'cloudy', hours: HOURS, hoursLabel: 'Timeprognose'};
const VEJR: Record<string, Partial<WeatherHeroProps>> = {
  frisk: {},
  raadventer: {advice: {state: 'pending', label: 'Et vejrråd er på vej'}},
  regel: {advice: {state: 'none'}, line: 'Skyet · Overvej en varm jakke.'},
  raadfejl: {advice: {state: 'text', text: 'Vejrrådet er ikke tilgængeligt lige nu.', ai: false, muted: true}},
  gammel: {advice: {state: 'none'}, line: 'Skyet · Overvej en varm jakke.', fresh: 'Opdateret 11.02', state: 'stale'},
  ukendt: {advice: {state: 'none'}, big: '—', unknown: true, line: 'Vejret kunne ikke hentes', sub: 'Met.no',
    notice: 'Home Assistant svarer ikke lige nu', state: 'empty'},
};

const STATIONS = [
  {id: 'p1', name: 'P1', colour: '#FF6600'}, {id: 'p3', name: 'P3', colour: '#4DFF4D'},
  {id: 'p4-ostjylland', name: 'P4 Østjylland', colour: '#FF9900'}, {id: 'p6-beat', name: 'P6 Beat', colour: '#4F4A4F'},
  {id: 'p8-jazz', name: 'P8 Jazz', colour: '#7E57C8'},
].map(row => ({...row, logo: `assets/radio-${row.id}.svg`}));
const MARKS = ['P1', 'P3', 'P4', 'P6', 'P8'];
const RADIO: Record<RadioPhase, {index: number | null; status: string; title: string; sub: string}> = {
  vaelg: {index: null, status: 'Ingen station valgt', title: 'Vælg station', sub: '5 stationer'},
  starter: {index: 2, status: 'Starter P4 Østjylland…', title: 'P4 Østjylland', sub: 'Musik og regionalt indhold'},
  spiller: {index: 4, status: 'Spiller på Køkkenalrum HomePod', title: 'P8 Jazz', sub: 'Jazz'},
  stoppet: {index: null, status: 'Ingen station valgt', title: 'Vælg station', sub: '5 stationer'},
  ikketilg: {index: null, status: 'Ikke tilgængelig', title: 'Radio', sub: 'Home Assistant svarer ikke lige nu'},
};

const COVER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">' +
  '<rect width="8" height="8" fill="#4A5A66"/></svg>');

export function ScreenPieces() {
  return (
    <section aria-label="Skærmenes dele" className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-6">
        {Object.entries(VEJR).map(([name, extra]) => (
          <div key={name} className="w-[736px]" data-gallery={`vejr-hero-${name}`}>
            <WeatherHero {...BASE} {...extra} />
          </div>
        ))}
        <div className="w-[736px]" data-gallery="vejr-days">
          <WeatherDays days={DAYS} credit="Kilde: Met.no · Stednavn: GeoNames · CC BY 4.0" />
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        {(['vaelg', 'starter', 'spiller', 'ikketilg'] as const).map(phase => {
          const {index, ...lines} = RADIO[phase];
          const station = index === null ? null : STATIONS[index] ?? null;
          return (
            <div key={phase} className="w-[736px]" data-gallery={`radio-hero-${phase}`}>
              <RadioHero phase={phase} station={station} marks={MARKS} index={index} {...lines} />
            </div>
          );
        })}
        <div className="grid h-[160px] w-[736px] grid-cols-5 gap-4" data-gallery="radio-tiles">
          {STATIONS.map((row, index) => (
            <StationTile key={row.id} {...row} selected={index === 4} label={row.name} onPress={noop} />
          ))}
        </div>
        <div className="grid h-[160px] w-[736px] grid-cols-5 gap-4" data-gallery="radio-tiles-off">
          {STATIONS.map(row => (
            <StationTile key={row.id} {...row} selected={false} disabled label={row.name} onPress={noop} />
          ))}
        </div>
      </div>
      <div className="relative h-[820px] w-[1180px] overflow-hidden bg-[#3F5A52]" data-gallery="rest-aktiv">
        <span className="absolute top-9 left-12"><RestClock time="14.30" date="mandag 9. november" /></span>
        <span className="absolute top-11 right-12"><RestWeather temperature="8°" condition="Skyet" /></span>
        <span className="absolute bottom-10 left-10">
          <GlassCard chip={{glyph: 'timer', surface: 'bg-pv-ink', ink: 'text-pv-timer-accent'}} prim="3:42"
            ctx="Timer · tæller ned" label="Timer" onOpen={noop} />
        </span>
        <span className="absolute right-10 bottom-10">
          <GlassCard chip={{picture: 'assets/radio-p8-jazz.svg'}} prim="P8 Jazz" ctx="Direkte · Køkkenalrum HomePod"
            label="Radio" onOpen={noop} control={{icon: 'stop', label: 'Stop radio', onPress: noop}} />
        </span>
      </div>
      <div className="flex gap-6 bg-[#3F5A52] p-10" data-gallery="rest-cards">
        <GlassCard chip={{glyph: 'music', surface: 'bg-pv-music'}} prim="Vælg musik" ctx="Til eftermiddagen"
          label="Musik" onOpen={noop} />
        <GlassCard chip={{picture: COVER}} prim="Fast Car" ctx="Y.V.E. 48" label="Musik" onOpen={noop}
          control={{icon: 'pause', label: 'Pause', onPress: noop}} />
      </div>
      <div className="relative h-[820px] w-[1180px] overflow-hidden bg-black" data-gallery="rest-nat">
        <NightFace time="23.14" sub="6° · Klart" timer="Timer · 3:42" />
      </div>
      <div className="flex w-[736px] flex-col gap-7" data-gallery="find-musik">
        <SearchBox value="" onChange={noop} onSubmit={noop} onClear={noop} label="Søg" placeholder="Søg efter en sang" />
        <div className="grid grid-cols-3 gap-2.5">
          {['Kind of Blue', 'Regnvejrs-jazz', 'Søndagsmorgen', 'Radiofortællinger', 'Stille folk', 'Fokus uden ord']
            .map((title, index) => (
              <QuickPick key={title} title={title} badge={index === 1 || index === 5 ? 'AI-valgt' : ''} cover={COVER}
                label={title} onPress={noop} />
            ))}
        </div>
        <Shelf id="gallery" title="Til en regnvejrs-torsdag" ai
          why="Fordi det regner, og I hører mest rolig musik på hverdage efter kl. 14.">
          {['Regnvejrs-jazz', 'Klaver og te', 'Grå dag, varm lyd', 'Bossa i regnen', 'Nordisk lys'].map(title => (
            <ShelfTile key={title} title={title} line="AI-valgt" ai cover={COVER} label={title} onPress={noop} />
          ))}
        </Shelf>
      </div>
    </section>
  );
}
