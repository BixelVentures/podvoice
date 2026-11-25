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
import {WIDGET_SAMPLES} from './samples';

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
const volume = {value: 35, disabled: false, onCommit: noop};
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
  {name: 'radio', mode: 'radio', tone: '#7E57C8', playing: true, onToggle: noop, volume,
    radio: {station: 'P8 Jazz', line: 'Direkte radio', live: 'direkte'}},
  {name: 'idle', mode: 'idle', onFindMusic: noop},
  {name: 'offline', mode: 'offline',
    offline: {note: 'PodView kan ikke nå musikken lige nu.', retryLabel: 'Prøv igen', onRetry: noop}},
];

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
    </main>
  );
}
