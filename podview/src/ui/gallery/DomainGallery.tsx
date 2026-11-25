// The domain pages' surfaces (A-Robot, A-Tesla, Robot-Sticky*) with the canvas's own sample content: the status
// hero (Robot S with its arcs, Tesla L with the car), »Mere ▾« with its fold and its menu, the sticky line, the room
// chips, the options card, the −/+ stepper, the maintenance meters, an event row and Tesla's Adgang surfaces.
import {useState} from 'react';
import {ActionTile} from '../ActionTile';
import {Button} from '../Button';
import {Segment} from '../Controls';
import {
  ActionDrawer, ActionMenu, DotChip, EventRow, HeroBig, HeroMetrics, MeterRow, MoreKey, OptionsCard, ProgressCells,
  SettingRow, StatusHero, Stepper, StickyLine,
} from '../Domain';
import type {MenuGroup} from '../Domain';
import {HeroArcs, HeroCar} from '../DotMaterial';
import {Fresh} from '../Fresh';

const noop = () => undefined;
const GROUPS: MenuGroup[] = [
  {id: 'transport', title: 'Rengøring', actions: [{id: 'return', label: 'Kør til basen', onPress: noop},
    {id: 'stop', label: 'Afslut rengøring', tone: 'fare', onPress: noop}]},
  {id: 'base', title: 'Basen', actions: [{id: 'empty', label: 'Tøm støvbeholder', icon: 'empty', onPress: noop},
    {id: 'wash', label: 'Stop moppevask', icon: 'wash', tone: 'amber', onPress: noop},
    {id: 'dry', label: 'Tør moppe', icon: 'dry', onPress: noop}]},
];
const ROOMS = ['Køkkenalrum', "Frida's Værelse", 'Entré', 'Gang'];

export function DomainGallery() {
  const [open, setOpen] = useState(true);
  const [rooms, setRooms] = useState<Record<string, boolean>>({Køkkenalrum: true, Entré: true});
  const [type, setType] = useState('both');
  const [suction, setSuction] = useState('max');
  const [temp, setTemp] = useState(21);
  return (
    <div className="flex w-[744px] flex-col gap-8">
      <div className="flex flex-col gap-8" data-gallery="robot-hero">
        <StatusHero variant="robot" surface="robotActive" eyebrow="Støvsugning og gulvvask" title="Rengør"
          sub="Stueplan (2025) · 6 områder" art={<HeroArcs running className="fill-pv-robot-dot" />}
          footer={(
            <div className="flex flex-row-reverse items-center gap-3">
              <Button variant="primaer" size={56}>Pause</Button>
              <MoreKey isExpanded={open} controls="gallery-more" onPress={() => {
                setOpen(value => !value);
              }} />
              <div className="ml-3"><ProgressCells percent={38} label="38 %" /></div>
            </div>
          )} />
        <ActionDrawer id="gallery-more" groups={GROUPS} isOpen={open} />
      </div>
      <div data-gallery="robot-hero-fejl">
        <StatusHero variant="robot" surface="robot" eyebrow="Robotfejl" title="Hovedbørsten sidder fast"
          titleTone="danger" notice={{id: 'f', level: 'fejl', title: 'Sluk robotten før du fjerner hår og genstande.'}}
          corner={<Fresh text="Opdateret 9. nov., 11.02" />}
          art={<HeroArcs broken className="fill-pv-grey opacity-45" />}
          footer={<div className="flex flex-row-reverse"><Button variant="primaer" size={56}>Fortsæt</Button></div>} />
      </div>
      <div className="relative h-[280px]" data-gallery="sticky-line">
        <StickyLine isShown surface="robot" dot="robot" title="Rengør" label="Robotstøvsuger, handlinger"
          sub="Støvsugning og gulvvask · 6 områder" primary={<Button variant="primaer" size={44}>Pause</Button>}
          more={<MoreKey size={44} isExpanded onPress={noop} />} />
        <div className="absolute top-20 right-0"><ActionMenu id="gallery-menu" groups={GROUPS} isOpen /></div>
      </div>
      <div className="grid grid-cols-4 gap-2.5" data-gallery="dot-chips">
        {ROOMS.map(room => (
          <DotChip key={room} label={room} isSelected={!!rooms[room]} onPress={() => {
            setRooms(current => ({...current, [room]: !current[room]}));
          }} />
        ))}
      </div>
      <div data-gallery="options-card">
        <OptionsCard>
          <SettingRow label="Type" labelId="g-type" main>
            <Segment aria-labelledby="g-type" size={56} fill weights={[1.6, 1, 1]} value={type} onChange={setType}
              options={[{id: 'both', label: 'Støvsug og vask'}, {id: 'vac', label: 'Støvsug'},
                {id: 'mop', label: 'Vask'}]} />
          </SettingRow>
          <SettingRow label="Sugeevne" labelId="g-suction">
            <Segment aria-labelledby="g-suction" fill value={suction} onChange={setSuction}
              options={[{id: 'quiet', label: 'Stille'}, {id: 'balanced', label: 'Balanceret'},
                {id: 'turbo', label: 'Turbo'}, {id: 'max', label: 'Maks.'}]} />
          </SettingRow>
        </OptionsCard>
      </div>
      <div className="grid grid-cols-[1.5fr_1fr] gap-4" data-gallery="events-care">
        <div className="flex flex-col gap-3.5 rounded-pv-widget bg-pv-surface p-6 shadow-pv-edge">
          <EventRow time="9. nov. · 14.18" title="Senest afsluttet" detail="Stueplan (2025) · 0,2 m² · 1,1 min" />
          <EventRow time="8. nov. · 11.22" title="Start anmodet" detail="Stueplan (2025) · 6 områder · 2 gange"
            action={<Button variant="sekundaer" size={44} className="text-[15px]">Vælg igen</Button>} />
        </div>
        <div className="flex flex-col gap-3.5 rounded-pv-widget bg-pv-surface p-6 shadow-pv-edge">
          <MeterRow label="Hovedbørste" value="142 t" percent={47} due={false} />
          <MeterRow label="Filter" value="12 t" percent={8} due />
        </div>
      </div>
      <div data-gallery="tesla-hero">
        <StatusHero variant="tesla" size="L" surface="teslaLive" eyebrow="Ikke tilsluttet" title="Klimaet kører"
          titleTone="teslaOn" sub="Varmer kabinen til 21 °C"
          corner={<span className="text-[15px] font-semibold text-pv-ink-3">Model Y</span>}
          big={<HeroBig value="64" tone="teslaOn" />} art={<HeroCar level={0.64} tone="climate" warm />}
          footer={<HeroMetrics items={[{value: '14 °C', label: 'inde nu'}, {value: '21 °C', label: 'mål'},
            {value: 'Høj', label: 'førersæde'}]} />} />
      </div>
      <div className="grid grid-cols-[repeat(4,170px)] gap-3" data-gallery="access-tiles">
        <ActionTile label="Døre" value="Ulåst" hint="Tryk for at låse" icon="unlock" tone="attention" height={196} />
        <ActionTile label="Døre" value="Låser op…" hint="Anmodning modtaget." icon="unlock" tone="busy" height={196} />
        <ActionTile label="Døre" value="Låst" hint="Bekræftet" icon="lock" tone="done" height={196} />
        <ActionTile label="Bagagerum" value="Åbent" hint="Tryk for at lukke" icon="trunkOpen" tone="attention"
          height={196} />
      </div>
      <div className="flex items-center gap-6" data-gallery="stepper">
        <Stepper value={`${String(temp)}°`} decrementLabel="Sænk temperatur" incrementLabel="Hæv temperatur"
          onDecrement={() => {
            setTemp(value => value - 1);
          }} onIncrement={() => {
            setTemp(value => value + 1);
          }} />
        <Stepper value="21°" muted canDecrement={false} canIncrement={false} decrementLabel="Sænk temperatur"
          incrementLabel="Hæv temperatur" onDecrement={noop} onIncrement={noop} />
      </div>
    </div>
  );
}
