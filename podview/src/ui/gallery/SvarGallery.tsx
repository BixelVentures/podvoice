// The Svar pieces of the kit gallery, with the design canvas's own sample content (A-SvarKort, SvarK-*, A-Svar's
// forms, Kit-SvarKnap): each board's card and »I dag« at the stage's own size (1132 × 696, the space under the
// topbar), so it lies next to the canvas board's crop; and the Svar key's seven states in the topbar.
import {useState} from 'react';
import {Notice} from '../Notice';
import {SvarAction, SvarCard, SvarChart, SvarChecklist, SvarChoices, SvarComparison, SvarFacts, SvarHome, SvarImage,
  SvarMedia, SvarMini, SvarNodes, SvarScore, SvarSteps, SvarTimeline, SvarToday} from '../Svar';
import type {SvarTone} from '../Svar';
import {SVAR_PILL, Topbar} from '../Topbar';
import type {SvarPillState} from '../Topbar';
import type {GlyphName} from '../glyphs';

const noop = () => undefined;
// Drawn stand-ins for the canvas's pictures (no photographs are shipped in the repository).
const picture = (from: string, to: string) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
  '<rect width="10" height="10" fill="url(#g)"/></svg>');
const LAKE = picture('#E8B7C2', '#3F5A52');
const BIKE = picture('#DAD6CC', '#7C766A');

interface Mini {
  id: string;
  tone: SvarTone;
  icon: GlyphName;
  kind: string;
  title: string;
  question: string;
}
// A-SvarKort's »I dag« pool, newest first.
const POOL: Mini[] = [
  {id: 'home-lys', tone: 'lys', icon: 'house', kind: 'I hjemmet', title: 'Lys tændt i køkkenet',
    question: 'Tænd lyset i køkkenet'},
  {id: 'fact', tone: 'svar', icon: 'info', kind: 'Fakta', title: 'Ja, den næste time ser bedst ud.',
    question: 'Skal vi gå en tur?'},
  {id: 'weather', tone: 'vejr', icon: 'rain', kind: 'Vejr · i morgen', title: 'I morgen 6°/2°, regn 2 mm',
    question: 'Hvordan bliver vejret i morgen?'},
  {id: 'music', tone: 'musik', icon: 'music', kind: 'Musik', title: 'Fast Car · Y.V.E. 48',
    question: 'Spil Fast Car i køkkenet'},
  {id: 'home-robot', tone: 'robot', icon: 'house', kind: 'I hjemmet', title: 'Robotten er startet',
    question: 'Start robotten'},
];
const TIMES = ['09.10', '08.30', '07.45', '07.20', '06.55'];

function Today({current, newer = false}: {current: Mini; newer?: boolean}) {
  const rest = POOL.filter(item => item.id !== current.id).slice(0, 3);
  return (
    <SvarToday title="I dag" newer={newer ? '1 nyt svar' : null} onNewer={noop}>
      <SvarMini {...current} time="11.32" current onPress={noop} />
      {rest.map(item => <SvarMini key={item.id} {...item}
        time={TIMES[POOL.indexOf(item)] ?? ''} current={false} onPress={noop} />)}
    </SvarToday>
  );
}

const SPORT: Mini = {id: 'sport', tone: 'svar', icon: 'ball', kind: 'Resultat · 8. nov.',
  title: 'Atlético 1–2 Barcelona', question: 'Hvordan gik Atlético mod Barcelona?'};
const TEXT: Mini = {id: 'text', tone: 'svar', icon: 'answer', kind: 'Svar', question: 'Hvad skal vi lave i dag?',
  title: 'Den næste time er tør, så det er et godt tidspunkt til en tur. Senere kommer der regn.'};
const byKey = (id: string) => POOL.find(item => item.id === id) ?? SPORT;
// The card's head from a board's sample (its id is the list's).
const head = ({tone, icon, kind, title, question}: Mini) => ({tone, icon, kind, title, question});

const score = (compact = false) => (
  <SvarScore compact={compact} home={{name: 'Atlético', tag: 'ATM', score: 1, scorers: '[målscorer]'}}
    away={{name: 'Barcelona', tag: 'FCB', score: 2, scorers: '[målscorere]'}} />
);
const FACTS = [{id: 'a', label: 'Bedste tidspunkt', value: 'Nu', detail: 'Den næste time er tør.'},
  {id: 'b', label: 'Temperatur', value: '15°', detail: 'Let skyet.'},
  {id: 'c', label: 'Regn', value: '3 t', detail: 'Regn om tre timer.'}];
const ACTS = [{id: 'p', title: 'Fold papir', detail: 'Et ark papir og plads ved bordet.', meta: '15 min · 1 materiale',
  minutes: 15, n: '1'}, {id: 'd', title: 'Tegn sammen', detail: 'Papir og farver. Skift til at tegne.',
  meta: '20 min · 2 materialer', minutes: 20, n: '2'}, {id: 'k', title: 'Lav et kort',
  detail: 'Papir, farver og lim til et lille kort.', meta: '30 min · 3 materialer', minutes: 30, n: '3'}];
const PAPER = ['Find et ark papir, og læg det på bordet.', 'Fold arket på midten, og åbn det igen.',
  'Fold de to øverste hjørner ind mod midten.', 'Fold siderne ind igen. Fold midten, og giv flyet vinger.'];
const PAUSE = {kind: 'Valgmuligheder', title: 'Tre aktiviteter ved bordet. Vælg det, der passer jer.',
  question: 'En pause uden skærm'};

function Checklist() {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(['paper']));
  return (
    <SvarMedia>
      <SvarChecklist items={[['paper', 'Papir'], ['colors', 'Farver'], ['glue', 'Lim']].map(([id = '', label = '']) =>
        ({id, label, checked: checked.has(id)}))} onToggle={id => {
        setChecked(previous => new Set(previous.has(id) ? [...previous].filter(x => x !== id) : [...previous, id]));
      }} />
    </SvarMedia>
  );
}

// Each canvas board: its card and its »I dag« beside it.
const BOARDS: {name: string; mini: Mini; card: React.JSX.Element; newer?: boolean}[] = [
  {name: 'sport', mini: SPORT, card: (
    <SvarCard {...head(SPORT)} time="11.32">{score()}</SvarCard>
  )},
  {name: 'opfoelg', mini: SPORT, card: (
    <SvarCard {...head(SPORT)} time="11.32" followUps={[{id: 'f', question: 'Hvem lavede assist?',
      answer: 'Assist: Pedri',
      time: '11.34'}]}>{score(true)}</SvarCard>
  )},
  {name: 'vejr', mini: byKey('weather'), card: (
    <SvarCard {...head(byKey('weather'))} title="I morgen" time="11.32"
      actions={<SvarAction label="Se vejret" variant="primaer" onPress={noop} />}>
      <SvarMedia className="grid grid-cols-[auto_1fr] items-end gap-8">
        <span className="font-pv-mono text-[160px] leading-[.8] font-medium tracking-[-0.09em]">6°</span>
        <span className="flex flex-col gap-2 pb-2">
          <span className="font-pv-mono text-[44px] leading-none font-medium tracking-[-0.05em] text-pv-ink-3">
            nat 2°</span>
          <span className="text-[22px] font-bold">Regn · 2 mm</span>
        </span>
      </SvarMedia>
    </SvarCard>
  )},
  {name: 'fakta', mini: byKey('fact'), card: (
    <SvarCard {...head(byKey('fact'))} time="11.32" actions={<SvarAction label="Kilder" onPress={noop} />}>
      <SvarFacts facts={FACTS} />
    </SvarCard>
  )},
  {name: 'historik', mini: byKey('fact'), newer: true, card: (
    <SvarCard {...head(byKey('fact'))} time="11.32" actions={<SvarAction label="Kilder" onPress={noop} />}>
      <SvarFacts facts={FACTS} />
    </SvarCard>
  )},
  {name: 'hjem', mini: byKey('home-lys'), card: (
    <SvarCard {...head(byKey('home-lys'))} title="Lys tændt" time="11.32" actions={<SvarAction label="Fortryd" onPress={noop} />}>
      <SvarHome glyph="bulb" device="Lys · Køkkenalrum" state="Tændt" detail="Pendler og Bordlys · 60 %"
        disc="bg-[#F6C94E]" />
    </SvarCard>
  )},
  {name: 'hjem-robot', mini: byKey('home-robot'), card: (
    <SvarCard {...head(byKey('home-robot'))} time="11.32"
      actions={<SvarAction label="Pause" icon="pause" onPress={noop} />}>
      <SvarHome glyph="robot" device="Robotstøvsuger" state="Rengør" detail="Støvsugning og gulvvask"
        disc="bg-pv-robot" />
    </SvarCard>
  )},
  {name: 'tekst', mini: TEXT, card: <SvarCard {...head(TEXT)} time="11.32" long />},
  {name: 'bygger', mini: byKey('weather'), card: (
    <SvarCard {...head(byKey('weather'))} time="11.32" building />
  )},
  // A-Svar's forms on the card (the product's own saved examples).
  {name: 'faktakort', mini: byKey('fact'), card: (
    <SvarCard tone="vejr" icon="info" kind="Faktakort" time="11.32" title="Ja, den næste time ser bedst ud."
      question="Skal vi gå en tur?"><SvarFacts facts={[{id: 'a', label: 'Bedste tidspunkt', value: 'Gå nu',
        detail: 'Den næste time er tør i dette vejrforløb.'}, {id: 'b', label: 'Temperatur nu', value: '15°',
        detail: 'Let skyet. Tag en let jakke med.'}, {id: 'c', label: 'Senere på turen', value: 'Regn om tre timer',
        detail: 'Vælg en kort tur, hvis I vil være hjemme inden regnen.'}]} /></SvarCard>
  )},
  {name: 'billede', mini: byKey('fact'), card: (
    <SvarCard icon="answer" kind="Billede med kilde" time="11.32"
      title="Søen ligger stille mellem bjergene i aftensolen." question="En pause ved vandet">
      <SvarImage image={<img src={LAKE} alt="Illustration af en stille sø" />}
        caption="Farverne i himlen spejler sig i den rolige sø." credit="Illustration · PodView · AI-genereret" />
    </SvarCard>
  )},
  {name: 'tidslinje', mini: byKey('fact'), card: (
    <SvarCard icon="clock" kind="Tidslinje" time="11.32"
      title="Spis morgenmad først, og find tasker og overtøj, inden I går." question="En rolig morgen">
      <SvarMedia><SvarTimeline events={[{id: 'a', time: '07.00', label: 'Morgenmad sammen',
        detail: 'Plads til en rolig start ved bordet.'}, {id: 'b', time: '07.25', label: 'Tasker og overtøj',
        detail: 'Find det, der skal med.'}, {id: 'c', time: '07.45', label: 'Ud ad døren',
        detail: 'Klar til dagens første tur.'}]} /></SvarMedia>
    </SvarCard>
  )},
  {name: 'diagram', mini: byKey('fact'), card: (
    <SvarCard icon="info" kind="Enkelt diagram" time="11.32"
      title="Et lavt gear gør det lettere at træde op ad bakke."
      question="Gear ændrer, hvor let du træder.">
      <SvarNodes image={<img src={BIKE} alt="AI-illustration af cyklens baghjul" />} nodes={[
        {id: 'p', label: 'Pedaler', detail: 'Du træder og drejer kranken.'},
        {id: 'k', label: 'Kæde', detail: 'Kæden forbinder tandhjulene foran og bagpå.'},
        {id: 'b', label: 'Baghjul', detail: 'Gearvalget ændrer forholdet mellem pedaltråd og hjulets omdrejninger.'},
      ]} />
    </SvarCard>
  )},
  {name: 'valg', mini: byKey('fact'), card: (
    <SvarCard icon="info" time="11.32" {...PAUSE}><SvarChoices items={ACTS} selected="p" /></SvarCard>
  )},
  {name: 'sammenligning', mini: byKey('fact'), card: (
    <SvarCard icon="info" time="11.32" {...PAUSE} kind="Sammenligning">
      <SvarMedia><SvarComparison columns={[{id: 't', label: 'Tid'}, {id: 'm', label: 'Materialer'}]}
        rows={ACTS.map(a => ({id: a.id, label: a.title, values: [`${String(a.minutes)} min`, a.n]}))} /></SvarMedia>
    </SvarCard>
  )},
  {name: 'graf', mini: byKey('fact'), card: (
    <SvarCard icon="info" time="11.32" {...PAUSE} kind="Datagraf">
      <SvarMedia><SvarChart unit="minutter" items={ACTS.map(a => ({id: a.id, label: a.title, value: a.minutes,
        text: `${String(a.minutes)} min`}))} /></SvarMedia>
    </SvarCard>
  )},
  {name: 'trin', mini: byKey('fact'), card: (
    <SvarCard icon="check" kind="Trin for trin" time="11.32" title="Fold papir" question="Fold et papirfly"
      actions={<><SvarAction label="Forrige trin" onPress={noop} />
        <SvarAction label="Næste trin" variant="primaer" onPress={noop} /></>}>
      <SvarMedia><SvarSteps steps={PAPER} index={1} /></SvarMedia>
    </SvarCard>
  )},
  {name: 'tjekliste', mini: byKey('fact'), card: (
    <SvarCard icon="check" kind="Tjekliste" time="11.32" title="Papir, farver og lim."
      question="Klar til at lave et kort?"><Checklist /></SvarCard>
  )},
  {name: 'afbrudt', mini: byKey('fact'), card: (
    <SvarCard icon="check" kind="Trin for trin" time="11.32" title="Fold papir" question="Fold et papirfly"
      notice={<Notice compact level="handling" title="Svaret blev afbrudt" text="Indholdet er bevaret." />}>
      <SvarMedia><SvarSteps steps={PAPER} index={1} /></SvarMedia>
    </SvarCard>
  )},
  {name: 'fejl', mini: byKey('fact'), card: (
    <SvarCard {...head(byKey('fact'))} time="11.32"
      notice={<Notice compact level="fejl" title="Svaret kom ikke frem" text="Prøv igen." />}>
      <SvarFacts facts={FACTS} />
    </SvarCard>
  )},
  {name: 'offline', mini: SPORT, card: (
    <SvarCard {...head(SPORT)} time="11.32"
      notice={<Notice compact level="info" title="Offline" text="seneste svar er bevaret." />}>{score(true)}</SvarCard>
  )},
];

export function SvarGallery() {
  return (
    <>
      <section aria-label="Svar-knappen" className="flex flex-col gap-4" data-gallery-kind="svarknap">
        {(Object.keys(SVAR_PILL) as SvarPillState[]).map(state => (
          <div key={state} className="-mx-6 w-[1180px]" data-gallery={`svarknap-${state}`}>
            <Topbar heading="Hjem" onRest={noop} svar={{onPress: noop, current: false}} svarState={state}
              clock="14.30" date="Man. 9. nov." />
          </div>
        ))}
      </section>
      <section aria-label="Svarkort" className="flex flex-col gap-6" data-gallery-kind="svarkort">
        {BOARDS.map(({name, mini, card, newer}) => (
          <div key={name} className="flex h-[696px] w-[1132px] gap-4" data-gallery={`svarkort-${name}`}>
            {card}
            <Today current={mini} {...(newer ? {newer} : {})} />
          </div>
        ))}
        <div className="flex h-[696px] w-[1132px] gap-4" data-gallery="svarkort-tom">
          <SvarCard className="h-[458px] w-[736px] bg-pv-surface" icon="answer" kind="Tidligere svar" time=""
            title="Ingen visuelle svar endnu">
            <p className="max-w-[520px] text-[17px] leading-6 text-pv-ink-3">
              Når PodVoice viser et visuelt svar, kan du finde det her igen.</p>
          </SvarCard>
        </div>
      </section>
    </>
  );
}
