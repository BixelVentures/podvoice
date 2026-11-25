// The kit gallery: every K-Widget state at its slot size, and the kit's keys, switches, notices, chips, action
// surfaces, the topbar and the player's modes, with the design canvas's own sample content. The panel's test host
// shows it at /podview/_kit (tests/browser/ha_panel/host.html?kit=1), so each piece can be screenshotted next to its
// canvas board (W-*.dc.html, K-*.dc.html, A-Player, Player-*).
import {ActionTile} from '../ActionTile';
import {Button} from '../Button';
import {Fresh} from '../Fresh';
import {Notice, NoticeSlot} from '../Notice';
import type {ShownNotice} from '../Notice';
import {useState} from 'react';
import {Player} from '../Player';
import type {PlayerProps} from '../Player';
import {SwitchMark} from '../Switch';
import {Topbar} from '../Topbar';
import type {GlyphName} from '../glyphs';
import {WIDGET_KINDS, WIDGET_STATES, Widget} from '../Widget';
import type {WidgetKind, WidgetState} from '../Widget';
import {QueueCard, QueuePlaceholder, QueueRow} from '../Queue';
import {SheetChoice, SheetRow, SheetSection} from '../SheetRows';
import {RecentTimers, TimerDraft, TimerFace} from '../Timer';
import {WIDGET_SAMPLES} from './samples';
import {SvarGallery} from './SvarGallery';
import {IconKey, SectionLabel, SectionTitle, Segment, SwitchKey} from '../Controls';
import {Dialog, Sheet} from '../Modal';
import {Slider} from '../Slider';
import {ListRow, ListValue} from '../surfaces';
import {ChoiceTile, DeviceNote, DeviceRow, FoldRow, Hero, ToggleCard} from '../Tiles';

const BOX: Record<string, string> = {S: 'h-[220px] w-[172px]', M: 'h-[220px] w-[360px]', L: 'h-[456px] w-[360px]'};
const SIZE: Record<WidgetKind, 'S' | 'M' | 'L'> = {vejr: 'L', robot: 'M', lys: 'S', tesla: 'S', musik: 'S',
  radio: 'S', opskrift: 'S', timer: 'S', svar: 'S'};

const noop = () => undefined;
// A cover picture for the gallery's own players (a drawn sleeve, so no album art is shipped in the repository).
const COVER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 252 252"><defs><radialGradient id="g" cx=".3" cy=".2" r="1">' +
  '<stop offset="0" stop-color="#D8BC9E"/><stop offset=".55" stop-color="#B98E66"/>' +
  '<stop offset="1" stop-color="#7C6650"/>' +
  '</radialGradient></defs><rect width="252" height="252" fill="url(#g)"/><circle cx="126" cy="131" r="46" ' +
  'fill="#E2A673" opacity=".85"/><text x="126" y="36" text-anchor="middle" font-family="sans-serif" font-size="11" ' +
  'letter-spacing="4" fill="#fff" opacity=".8">Y.V.E. 48</text></svg>');

// K-Notice's lifecycle: one at a time; each press shows the next level (in 280 ms, out 220 ms); info closes with ×,
// the confirmation goes by itself after 3 s.
const DEMO: ShownNotice[] = [
  {id: 'fejl', level: 'fejl', title: 'Robotfejl', text: 'Hovedbørsten sidder fast'},
  {id: 'handling', level: 'handling', title: 'Robotten mangler vand'},
  {id: 'info', level: 'info', title: 'Vejret er ikke opdateret', text: 'Opdateret 11.02'},
  {id: 'ok', level: 'ok', title: 'Robotten er sendt til basen'},
];
function NoticeDemo() {
  const [index, setIndex] = useState<number | null>(null);
  const shown = index === null ? null : (DEMO[index] ?? null);
  return (
    <div className="flex flex-col gap-4">
      <Button variant="sekundaer" size={44} onPress={() => {
        setIndex(current => (current === null ? 0 : (current + 1) % DEMO.length));
      }}>Næste besked</Button>
      <NoticeSlot notice={shown} onClose={() => {
        setIndex(null);
      }} />
      <p className="text-[15px] text-pv-ink-3">Indholdet under beskeden skubbes blødt.</p>
    </div>
  );
}
const volume = {value: 35, disabled: false, onCommit: noop, onMute: noop};
const PLAYERS: (Omit<PlayerProps, 'picker'> & {name: string; label?: string; icon?: GlyphName})[] = [
  {name: 'mine', mode: 'mine', title: 'Fast Car', artist: 'Y.V.E. 48', tone: '#B98E66', playing: false,
    cover: COVER,
    progress: {position: '0:44', duration: '2:37', fraction: 0.28}, onToggle: noop, onNext: noop, onPrevious: noop,
    volume},
  {name: 'away', mode: 'away', title: 'Fast Car', artist: 'Y.V.E. 48', tone: '#B98E66', playing: true,
    progress: {position: '0:44', duration: '2:37', fraction: 0.28}, onToggle: noop, onNext: noop, onPrevious: noop,
    volume, away: {device: 'Telefon', moveLabel: 'Flyt til Køkkenalrum', onMove: noop}},
  {name: 'anden-enhed', label: 'Mads’ iPhone', icon: 'phone', mode: 'away', title: 'Fast Car', artist: 'Y.V.E. 48',
    tone: '#B98E66',
    playing: true, progress: {position: '0:44', duration: '2:37', fraction: 0.28}, onToggle: noop, onNext: noop,
    onPrevious: noop, volume, away: {device: 'Mads’ iPhone', moveLabel: 'Flyt til Køkkenalrum', onMove: noop}},
  {name: 'andet-sted', label: 'Et andet sted', icon: 'elsewhere', mode: 'away', title: 'Fast Car',
    artist: 'Y.V.E. 48', tone: '#B98E66',
    playing: true, progress: {position: '0:44', duration: '2:37', fraction: 0.28}, onToggle: noop, onNext: noop,
    onPrevious: noop, away: {device: 'Et andet sted', moveLabel: 'Flyt til Køkkenalrum', onMove: noop}},
  {name: 'other', mode: 'other', title: 'Heartless', artist: 'Kanye West · en anden konto', onFindMusic: noop},
  {name: 'optaget', mode: 'other', title: 'AirPlay', artist: 'Emmas iPhone',
    takeOver: {title: 'Fast Car · Y.V.E. 48', line: 'Din musik · spiller på iPhone', label: 'Flyt Fast Car hertil',
      onPress: noop}},
  {name: 'mute', mode: 'mine', title: 'Fast Car', artist: 'Y.V.E. 48', tone: '#B98E66', playing: true, cover: COVER,
    progress: {position: '0:44', duration: '2:37', fraction: 0.28}, onToggle: noop, onNext: noop, onPrevious: noop,
    volume: {...volume, muted: true, onMute: noop}},
  {name: 'radio', mode: 'radio', tone: '#7E57C8', playing: true, onToggle: noop, volume,
    radio: {station: 'P8 Jazz', line: 'Direkte radio', live: 'direkte'}},
  {name: 'idle', mode: 'idle', onFindMusic: noop},
  {name: 'tom', mode: 'idle', onFindMusic: noop, idleRows: [
    {label: 'Til eftermiddagen', rows: [{title: 'Pop Remix', sub: 'Spotify-playliste', label: 'Afspil Pop Remix',
      onPress: noop}]},
    {label: 'Hør igen', rows: [{title: 'End of Beginning', sub: 'Djo', label: 'Afspil End of Beginning', onPress: noop},
      {title: 'Flowers', sub: 'Miley Cyrus', label: 'Afspil Flowers', onPress: noop}]}]},
  {name: 'offline', mode: 'offline',
    offline: {note: 'PodView kan ikke nå musikken lige nu.', retryLabel: 'Prøv igen', onRetry: noop}},
];

const pct = (value: number) => `${String(value)} %`;

// Kit-Kontroller's controls, live: the segment glides, the sliders follow a finger 1:1 and glide to a value set from
// outside (»Sæt 30 %«), the switches and the fold answer a tap.
function ControlsDemo() {
  const [seat, setSeat] = useState<'fra' | 'lav' | 'mellem' | 'hoej'>('lav');
  const [level, setLevel] = useState(60);
  const [on, setOn] = useState(true);
  return (
    <div className="flex flex-col gap-7" data-gallery="controls">
      <Segment aria-label="Sædevarme" value={seat} onChange={setSeat}
        options={[{id: 'fra', label: 'Fra'}, {id: 'lav', label: 'Lav'}, {id: 'mellem', label: 'Mellem'},
          {id: 'hoej', label: 'Høj'}]} />
      <div className="flex w-[520px] flex-col gap-3">
        <Slider variant="kit" tone="lys" label="Lysstyrke" value={level} format={pct} onCommit={setLevel} />
        <Slider variant="kit" tone="lys" showLabel label="Lysstyrke" value={level} format={pct} onCommit={setLevel} />
        <Slider variant="kit" tone="lys" compact label="Lampe" value={level} format={pct} onCommit={setLevel} />
        <Slider variant="kit" tone="lys" compact label="Slukket lampe" value={0} isDisabled format={pct}
          onCommit={noop} />
        <Slider variant="kit" tone="lys" showLabel label="Lysstyrke" value={null} isDisabled format={pct}
          onCommit={noop} />
        <Slider variant="kit" tone="robot" label="Robot" value={40} format={pct} onCommit={noop} />
        <Slider variant="kit" tone="tesla" label="Tesla" value={80} format={pct} onCommit={noop} />
        <Button variant="sekundaer" size={44} onPress={() => {
          setLevel(current => (current === 30 ? 85 : 30));
        }}>Sæt 30 % / 85 %</Button>
      </div>
      <div className="flex items-start gap-6">
        <div className="flex w-[520px] flex-col gap-3">
          <SectionTitle>Rengøringsvalg</SectionTitle>
          <ListRow tone="line"><span className="flex-1">Hvedemel</span><ListValue>500 g</ListValue></ListRow>
          <ListRow tone="line"><span className="flex-1">Gær</span><ListValue>25 g</ListValue></ListRow>
        </div>
        <IconKey icon="menu" aria-label="Menu" />
        <IconKey icon="close" aria-label="Luk" />
        <SwitchKey aria-label="Kontakt" isSelected={on} onChange={setOn} />
        <SwitchKey aria-label="Kontakt slukket" isSelected={false} onChange={noop} />
        <SwitchKey aria-label="Kontakt låst" isSelected={false} isDisabled onChange={noop} />
      </div>
    </div>
  );
}

// The confirmation dialog and the sheet open over the gallery.
function OverlayDemo() {
  const [open, setOpen] = useState<'dialog' | 'sheet' | null>(null);
  const close = () => {
    setOpen(null);
  };
  return (
    <div className="flex gap-4">
      <Button variant="sekundaer" size={44} onPress={() => {
        setOpen('dialog');
      }}>Vis dialog</Button>
      <Button variant="sekundaer" size={44} onPress={() => {
        setOpen('sheet');
      }}>Vis ark</Button>
      <Dialog isOpen={open === 'dialog'} title="Kør til basen?" id="kit-dialog"
        description="Rengøringen stopper, og robotten kører tilbage." cancelLabel="Annullér"
        confirmLabel="Kør til basen" onCancel={close} onConfirm={close} />
      <Sheet isOpen={open === 'sheet'} onClose={close} title="Skærm og enhed" id="kit-sheet"
        description="iPad · styres via Home Assistant-appens kiosktilstand.">
        <div className="flex flex-col">
          <SectionLabel>Om skærmen</SectionLabel>
          <ListRow tone="line"><span className="flex-1 font-semibold">Wi-Fi</span><ListValue>Ikke oplyst</ListValue>
          </ListRow>
          <ListRow tone="line"><span className="flex-1 font-semibold">Enhed</span>
            <ListValue>iPad Air · i holderen</ListValue></ListRow>
        </div>
      </Sheet>
    </div>
  );
}

// A-Lys's page surfaces with the canvas's own sample content.
function SurfacesDemo() {
  const [selected, setSelected] = useState('kok');
  const [scene, setScene] = useState('Morgen');
  const [open, setOpen] = useState(true);
  const power = (label: string, on: boolean, disabled = false) => ({'aria-label': label, isSelected: on,
    isDisabled: disabled, onChange: noop});
  return (
    <div className="flex w-[744px] flex-col gap-6">
      <div className="grid grid-cols-2 gap-4" data-gallery="toggle-card">
        <ToggleCard tone="lys" tag="Denne skærms rum" name="Køkkenalrum" status="Tændt" on
          isSelected={selected === 'kok'} onSelect={() => {
            setSelected('kok');
          }} power={power('Sluk alle lys i Køkkenalrum', true)} />
        <ToggleCard tone="lys" tag="Rum" name="Stue · 1. sal" status="Slukket" on={false}
          isSelected={selected === 'stue'} onSelect={() => {
            setSelected('stue');
          }} power={power('Tænd alle lys i Stue · 1. sal', false)} />
        <ToggleCard tone="lys" tag="Rum" name="Kontor" status="Status ukendt" on={false} isSelected={false}
          onSelect={noop} power={power('Lys i Kontor kræver aktuel status', false, true)} />
      </div>
      <div className="grid grid-cols-3 gap-3" data-gallery="choice-tile">
        {[['Morgen', 60], ['Madlavning', 100], ['Aften', 30]].map(([name, level]) => (
          <ChoiceTile key={name} tone="lys" title={String(name)} meta={pct(Number(level))}
            isSelected={scene === name} onPress={() => {
              setScene(String(name));
            }} />
        ))}
        <ChoiceTile tone="lys" title="Slap af" isSelected={false} onPress={noop} />
        <ChoiceTile tone="lys" title="Natlys" meta="6 %" isSelected isPending onPress={noop} />
        <ChoiceTile tone="lys" title="Læs" meta="100 %" isSelected={false} isDisabled onPress={noop} />
      </div>
      <div className="w-[696px]" data-gallery="device-row">
        <FoldRow title="Lamper" icon="bulb" count="4 stk." isExpanded={open} onExpandedChange={setOpen}>
          <div className="grid grid-cols-2 gap-x-6">
            <DeviceRow tone="lys" name="Pendler" status="Tændt" dot="on" power={power('Sluk Pendler', true)}>
              <Slider variant="kit" tone="lys" compact label="Lysstyrke for Pendler" value={60} format={pct}
                onCommit={noop} />
            </DeviceRow>
            <DeviceRow tone="lys" name="Bordlys" status="Slukket" dot="off" power={power('Tænd Bordlys', false)}>
              <Slider variant="kit" tone="lys" compact label="Lysstyrke for Bordlys" value={0} isDisabled
                format={pct} onCommit={noop} />
            </DeviceRow>
            <DeviceRow tone="lys" name="Mushroom" status="Ikke forbundet" dot="unknown"
              power={power('Tænd Mushroom', false, true)}>
              <Slider variant="kit" tone="lys" compact label="Lysstyrke for Mushroom" value={null} isDisabled
                format={pct} onCommit={noop} />
            </DeviceRow>
            <DeviceRow tone="lys" name="Køkkenø" status="Tændt" dot="on" power={power('Sluk Køkkenø', true)}>
              <DeviceNote>Kun tænd og sluk</DeviceNote>
            </DeviceRow>
          </div>
        </FoldRow>
      </div>
      <div data-gallery="hero">
        <Hero tone="lys" eyebrow="Køkkenalrum · denne skærms rum" title="Ikke forbundet"
          text="Forbind lys i Home Assistant for at se og styre dem her."
          action={<Button variant="primaer" size={56}>Opdater lys</Button>} />
      </div>
    </div>
  );
}
const QUEUE = [['End of Beginning', 'Djo'], ['Cruel Summer', 'Taylor Swift'], ['Flowers', 'Miley Cyrus'],
  ['Lost', 'Frank Ocean'], ['Take Five', 'The Dave Brubeck Quartet']] as const;

export function KitGallery() {
  return (
    <main className="fixed inset-0 flex flex-col gap-10 overflow-auto bg-pv-bg p-6 font-pv text-pv-ink"
      aria-label="Kit">
      <section aria-label="Widgets" className="flex flex-col gap-6">
        {WIDGET_KINDS.map(kind => (
          <div key={kind} className="flex flex-wrap items-start gap-4" data-gallery-kind={kind}>
            {(WIDGET_STATES[kind] as readonly string[]).map(state => {
              const sample = WIDGET_SAMPLES[kind][state] ?? {prim: ''};
              return (
                <div key={state} className={BOX[SIZE[kind]]} data-gallery={`${kind}-${state}`}>
                  <Widget kind={kind} state={state as WidgetState} {...sample} />
                </div>
              );
            })}
          </div>
        ))}
      </section>
      <section aria-label="Knapper" className="flex flex-wrap items-center gap-4" data-gallery="buttons">
        {(['primaer', 'sekundaer', 'kant', 'fare', 'lys', 'moerk', 'alarm'] as const).map(variant => (
          <Button key={variant} variant={variant} size={56} icon="play">{variant}</Button>
        ))}
        <Button variant="primaer" size={44}>Start</Button>
        <Button variant="sekundaer" size={44} icon="pause" aria-label="Pause" />
      </section>
      <section aria-label="Kontakter" className="flex gap-4" data-gallery="switches">
        <SwitchMark on />
        <SwitchMark on={false} />
        <SwitchMark on dim />
      </section>
      <section aria-label="Beskeder" className="flex w-[844px] flex-col gap-4" data-gallery="notices">
        <Notice level="fejl" title="Robotfejl" text="Hovedbørsten sidder fast" />
        <Notice level="handling" title="Robotten mangler vand" />
        <Notice level="info" title="Vejret er ikke opdateret" text="Opdateret 11.02" onClose={noop} />
        <Notice level="handling" title="Robotten mangler vand" text="Fyld tanken" compact />
        <Fresh text="Opdateret 9. nov., 11.02" />
        <Fresh text="Opdateret 9. nov., 11.02" solid />
      </section>
      <section aria-label="Handlingsflader" className="grid w-[1100px] grid-cols-5 gap-4" data-gallery="actions">
        {(['calm', 'attention', 'busy', 'done', 'error'] as const).map(tone => (
          <ActionTile key={tone} tone={tone} label="Døre" value="Ulåst" hint="Tryk for at låse" icon="unlock" />
        ))}
      </section>
      <section aria-label="Topbar" className="-mx-6 flex flex-col gap-4" data-gallery="topbar">
        <Topbar heading="Hjem" onRest={noop} svar={{onPress: noop, current: false}}
          weather={{temperature: '8°', condition: 'Skyet', glyph: 'sun'}} clock="14.30" date="Man. 9. nov." />
        <Topbar heading="Lys" back={{onPress: noop}} onRest={noop} svar={{onPress: noop, current: false}}
          weather={{temperature: '8°', condition: 'Skyet', glyph: 'sun'}} clock="14.30" date="Man. 9. nov." />
        <Topbar heading="Tesla" back={{onPress: noop}} onRest={noop} svar={{onPress: noop, current: false}}
          weather={{temperature: '8°', condition: 'Skyet', glyph: 'sun'}} clock="14.30" date="Man. 9. nov."
          timer={{count: '3:42', name: 'Pasta', left: 0.97, onPress: noop}}
          alert={{text: 'Robotfejl', domain: 'Robot', onPress: noop}} />
      </section>
      <section aria-label="Stemme" className="flex flex-wrap gap-4" data-gallery="voice">
        {(['rest', 'ripple', 'sweep', 'voice', 'chat'] as const).map(phase => (
          <div key={phase} className="-mx-6 w-[1180px]" data-gallery={`voice-${phase}`}>
            <Topbar heading="Hjem" onRest={noop} svar={{onPress: noop, current: false}} voice={phase} clock="14.30"
              date="Man. 9. nov." />
          </div>
        ))}
      </section>
      <SvarGallery />
      <section aria-label="Kontroller" className="flex flex-col gap-6">
        <ControlsDemo />
        <OverlayDemo />
      </section>
      <section aria-label="Sideflader" className="flex flex-col gap-6">
        <SurfacesDemo />
      </section>
      <section aria-label="Beskedforløb" className="w-[844px]" data-gallery="notice-lifecycle">
        <NoticeDemo />
      </section>
      <section aria-label="Afspiller" className="flex flex-wrap gap-6">
        {PLAYERS.map(({name, label = 'Køkkenalrum', icon, ...player}) => (
          <div key={name} className="h-[692px] w-[372px]" data-gallery={`player-${name}`}>
            <Player {...player}
              picker={{label, 'aria-label': `Rum: ${label}`, onPress: noop, ...(icon ? {icon} : {})}} />
          </div>
        ))}
      </section>
      <section aria-label="Kø" className="flex flex-wrap gap-6">
        {(['playing', 'paused', 'starting', 'loading'] as const).map(state => (
          <div key={state} className="flex h-[520px] w-[736px]" data-gallery={`queue-${state}`}>
            <QueueCard className="flex-1" heading="Kø" meta="20 numre · Køkkenalrum"
              status={state === 'loading' ? 'loading' : 'ready'}>
              <QueueRow index={1} title="Fast Car" artist="Y.V.E. 48" cover={COVER}
                mark={state === 'starting' ? null : state === 'paused' ? 'paused' : 'playing'} label="Fast Car" />
              {state === 'loading' ? [2, 3, 4].map(index => <QueuePlaceholder key={index} index={index} />)
                : QUEUE.map(([title, artist], index) => (
                  <QueueRow key={title} index={index + 2} title={title} artist={artist}
                    mark={state === 'starting' && index === 1 ? 'starting' : null} label={title} onPress={noop} />
                ))}
            </QueueCard>
          </div>
        ))}
      </section>
      <section aria-label="Ark" className="flex w-[560px] flex-col gap-pv-s3 bg-pv-surface p-pv-s4"
        data-gallery="sheet-rows">
        <SheetChoice aria-label="Rum" value="kitchen" onChange={noop} items={[
          {id: 'kitchen', name: 'Køkkenalrum', detail: 'Spiller · Fast Car'},
          {id: 'living', name: 'Stue', detail: '1 højttaler · 1 lampe'},
          {id: 'office', name: 'Kontoret', detail: 'Ikke tilgængelig', disabled: true}]} />
        <SheetSection id="gallery-sheet-section" title="Afspil på">
          <SheetRow name="Køkkenalrum" detail="Spiller · Fast Car" status="Aktuelt output" chosen onPress={noop} />
          <SheetRow name="Stue" detail="Klar" onPress={noop} />
        </SheetSection>
      </section>
      <section aria-label="Timer" className="flex w-[736px] flex-col gap-4">
        {([['koerer', '8:42', 87, 'Timer · 10 min', 'Tæller ned', 'Færdig kl. 14.39'],
          ['pause', '4:10', 42, 'Timer på pause', 'På pause', 'Ringen står stille, til du fortsætter.'],
          ['faerdig', '0:00', 100, 'Timeren ringede 14.30', 'Tiden er gået', 'Alarmen ringer, til du stopper den.'],
        ] as const).map(([tone, time, progress, kicker, title, sub]) => (
          <div key={tone} data-gallery={`timer-face-${tone}`}>
            <TimerFace tone={tone} time={time} total="af 10:00" progress={progress} kicker={kicker} title={title}
              sub={sub} actions={tone === 'faerdig' ? (
                <>
                  <Button variant="alarm" size={56} icon="stop">Stop alarm</Button>
                  <Button variant="moerk" size={56} icon="restart">Start igen · 10 min</Button>
                </>
              ) : (
                <>
                  <Button variant="lys" size={56}>+1 min</Button>
                  <Button variant="moerk" size={56}>−1 min</Button>
                  <Button variant="moerk" size={56}>Annuller</Button>
                </>
              )} />
          </div>
        ))}
        <div data-gallery="timer-draft">
          <TimerDraft time="5:00" unit="min : sek" onMinus={noop} onPlus={noop} onStart={noop}
            presets={[3, 5, 10, 15].map(minutes => ({minutes, chosen: false, onPress: noop}))} />
        </div>
        <div className="flex h-[218px]" data-gallery="timer-recent">
          <RecentTimers onChoose={noop} choices={[['10:00', 'Seneste'], ['12:00', 'Tidligere'], ['30:00', 'Tidligere'],
            ['3:00', 'Tidligere'], ['45:00', 'Tidligere']].map(([time = '', label = ''], index) =>
            ({seconds: index + 1, time, label}))} />
        </div>
      </section>
    </main>
  );
}
