// Lys (the design canvas's A-Lys, Lys-Taendt/Slukket/Ukendt; DECISIONS §8): the home's light rooms with this screen's
// room first, each a card that a tap chooses and whose switch powers the room; »Sluk alt« / »Gendan lys« for the
// whole home; the chosen room's scenes, its brightness and its lamps (folded when there are more than two), each lamp
// with its own switch and slider. Everything is HA's own data (lib/ha/light-rooms.ts): a Hue room group is the room's
// power and brightness, never a lamp; Hue's scene select says which scene is active. A tap shows the wish at once and
// HA's next state confirms it; nothing is ever locked, and a drag never switches anything (ui/tap.ts).
import {create, useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import {lightRooms, roomEntities, roomLights, sceneKey} from '../../lib/ha/light-rooms';
import type {LampView, RoomLights} from '../../lib/ha/light-rooms';
import {brightnessKey, lights, powerKey, rooms as roomCommands} from '../../lib/ha/lights';
import {transport, useEntities, useLink} from '../../lib/ha/transport';
import {
  Button, Card, ChoiceTile, DeviceNote, DeviceRow, FoldRow, Hero, Notice, NoticeSlot, SectionLabel, SectionTitle,
  Slider, ToggleCard,
} from '../../ui';
import type {ShownNotice} from '../../ui';
import {useRoom} from '../room';
import {NOT_SENT_TEXT, REJECTED_TEXT, UNKNOWN_TEXT} from '../ui';

interface Snapshot {
  entityId: string;
  level: number | null;
}

// The page's own memory for this session: the chosen room, each room's lamp fold, and what »Sluk alt« turned off.
interface LightSession {
  selected: string | null;
  folds: Record<string, boolean | undefined>;
  restore: Snapshot[] | null;
}
export const useLightSession = create<LightSession>(() => ({selected: null, folds: {}, restore: null}));

const STATUS: Record<RoomLights['state'], string> = {
  taendt: 'Tændt', slukket: 'Slukket', ukendt: 'Status ukendt', tom: 'Ingen lamper',
};
const percent = (value: number) => `${String(value)} %`;

/** Every room with lights, as the page and Hjem's widget read them (this screen's room first). Hjem asks for the
 * summary (`detail` false): power and levels, without the colour modes only the page's controls need. */
export function useLightRooms(detail = true): {models: RoomLights[]; own: RoomLights | null; stale: boolean} {
  const {room, rooms} = useRoom();
  const list = lightRooms(rooms, room?.id ?? null);
  const ids = list.flatMap(roomEntities);
  const states = useEntities(ids);
  const wishes = useStore(commands.store, state => state.wishes);
  const {connected} = useLink();
  const known = new Map(ids.map((id, index) => [id, states[index] ?? null]));
  const read = (id: string) => known.get(id) ?? null;
  const stale = !connected;
  const models = list.map(item => roomLights(item, read, key => wishes[key],
    {own: item.id === room?.id, stale, detail}));
  return {models, own: models.find(model => model.own) ?? null, stale};
}

// A wish HA did not confirm, as the kit's compact line.
function wishLine(wish: Wish | undefined): ShownNotice | null {
  if (!wish) return null;
  const id = `${wish.key}:${String(wish.seq)}`;
  if (wish.phase === 'not_sent') return {id, level: 'info', title: NOT_SENT_TEXT};
  if (wish.phase === 'unknown') return {id, level: 'info', title: UNKNOWN_TEXT};
  if (wish.phase === 'rejected') return {id, level: 'fejl', title: REJECTED_TEXT};
  return null;
}

// The newest unconfirmed wish among the room's own controls (its switch, brightness, scenes and lamps).
function useRoomNotice(model: RoomLights): ShownNotice | null {
  const wishes = useStore(commands.store, state => state.wishes);
  const keys = [sceneKey(model.id), ...(model.group ? [powerKey(model.group), brightnessKey(model.group)] : []),
    ...model.lamps.flatMap(lamp => [powerKey(lamp.entityId), brightnessKey(lamp.entityId)])];
  const ended = keys.map(key => wishes[key]).filter(wish => wishLine(wish) !== null)
    .sort((a, b) => (b?.seq ?? 0) - (a?.seq ?? 0));
  return wishLine(ended[0]);
}

function Lamp({lamp, stale}: {lamp: LampView; stale: boolean}) {
  // A lamp HA does not know is locked; without a link the last known lamp stays usable (a tap says »Ikke sendt«).
  const locked = !lamp.known;
  return (
    <DeviceRow tone="lys" name={lamp.name} status={lamp.status} dot={lamp.dot} data-lamp-id={lamp.entityId}
      power={{
        'aria-label': `${lamp.on ? 'Sluk' : 'Tænd'} ${lamp.name}`,
        isSelected: lamp.on,
        isDisabled: locked,
        dim: stale,
        onChange: next => {
          lights.power(lamp.entityId, next);
        },
      }}>
      {lamp.dimmable ? (
        // An off or unknown lamp's slider is dimmed and locked: turn it on with the switch first (A-Lys).
        <Slider variant="kit" tone="lys" compact label={`Lysstyrke for ${lamp.name}`} min={1}
          value={locked || stale ? null : lamp.on ? lamp.level : 0} isDisabled={locked || stale || !lamp.on}
          format={percent}
          onCommit={value => {
            lights.brightness(lamp.entityId, value);
          }} />
      ) : (
        <DeviceNote>Kun tænd og sluk</DeviceNote>
      )}
    </DeviceRow>
  );
}

function RoomPanel({model, stale}: {model: RoomLights; stale: boolean}) {
  const fold = useLightSession(state => state.folds[model.id]);
  const open = fold ?? model.lamps.length <= 2;
  const notice = useRoomNotice(model);
  const status = stale || model.state === 'ukendt' ? 'Status ukendt'
    : `${String(model.lampsOn)} af ${String(model.lampsKnown)} lamper tændt`;
  // Canvas Lys-Ukendt: without a current state the scenes and the level wait (dimmed, »—«); the switches stay
  // pressable so a tap can say it was not sent (a lamp HA itself does not know is locked).
  const locked = stale || model.state === 'ukendt';
  return (
    <Card tone="kit" inset="md" id="light-panel" aria-labelledby="light-room-title"
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <div className="relative flex shrink-0 items-baseline justify-between gap-4">
        <SectionTitle id="light-room-title">{model.name}</SectionTitle>
        <span className="text-[15px] leading-5 text-pv-ink-3" hidden={!!notice}>{status}</span>
        <NoticeSlot compact notice={notice} className="absolute top-1/2 right-0 -translate-y-1/2" />
      </div>
      <div className="flex shrink-0 flex-col gap-3">
        <SectionLabel>Scener</SectionLabel>
        {model.scenes.length ? (
          <div role="group" aria-label={`Scener i ${model.name}`} className="grid grid-cols-3 gap-3">
            {model.scenes.map(scene => (
              <ChoiceTile key={scene.entityId} tone="lys" title={scene.name}
                meta={scene.level === null ? null : percent(scene.level)}
                isSelected={!locked && model.activeScene === scene.entityId}
                isPending={model.scenePending && model.activeScene === scene.entityId}
                isDisabled={locked} data-scene-id={scene.entityId}
                onPress={() => {
                  const select = model.select ? transport.read(model.select) : null;
                  roomCommands.scene(model.id, scene.entityId,
                    select ? {entityId: select.entity_id, name: scene.name} : null);
                }} />
            ))}
          </div>
        ) : (
          <DeviceNote>Der er ingen scener i dette rum.</DeviceNote>
        )}
      </div>
      <Slider variant="kit" tone="lys" showLabel label="Lysstyrke" min={1} className="shrink-0"
        value={locked ? null : model.on ? model.level : 0} isDisabled={locked || !model.dimmable} format={percent}
        onCommit={value => {
          roomCommands.brightness(model, value);
        }} />
      <FoldRow title="Lamper" icon="bulb" count={`${String(model.lamps.length)} stk.`} isExpanded={open}
        onExpandedChange={expanded => {
          useLightSession.setState(state => ({folds: {...state.folds, [model.id]: expanded}}));
        }}>
        <div className="grid grid-cols-2 gap-x-6">
          {model.lamps.map(lamp => <Lamp key={lamp.entityId} lamp={lamp} stale={stale} />)}
        </div>
      </FoldRow>
    </Card>
  );
}

function HomeKey({models, stale}: {models: RoomLights[]; stale: boolean}) {
  const restore = useLightSession(state => state.restore);
  const anyOn = models.some(model => model.on);
  const back = !anyOn && !!restore?.length;
  return (
    <Button variant="lys" size={44} icon="house" id="light-home-power"
      aria-label={back ? 'Gendan lyset i hjemmet som før slukning' : 'Sluk alle lys i hjemmet'}
      isDisabled={stale || (!anyOn && !back)}
      onPress={() => {
        if (anyOn) {
          useLightSession.setState({restore: models.flatMap(model => model.lamps).filter(lamp => lamp.on)
            .map(lamp => ({entityId: lamp.entityId, level: lamp.dimmable ? lamp.level : null}))});
          for (const model of models) if (model.on) roomCommands.power(model, false);
          return;
        }
        for (const lamp of restore ?? []) {
          if (lamp.level === null) lights.power(lamp.entityId, true);
          else lights.brightness(lamp.entityId, lamp.level);
        }
        useLightSession.setState({restore: null});
      }}>
      {back ? 'Gendan lys' : 'Sluk alt'}
    </Button>
  );
}

export function LightsScreen() {
  const {models, stale} = useLightRooms();
  const {room} = useRoom();
  const chosen = useLightSession(state => state.selected);
  const selected = models.find(model => model.id === chosen) ?? models[0] ?? null;
  if (!selected) {
    return (
      <section id="light-view" className="flex min-h-0 flex-1 flex-col" aria-labelledby="light-title">
        <h1 id="light-title" className="sr-only">Lys</h1>
        <Hero tone="lys" title="Ikke forbundet" text="Forbind lys i Home Assistant for at se og styre dem her."
          {...(room ? {eyebrow: `${room.name} · denne skærms rum`} : {})}
          action={<Button variant="primaer" size={56} onPress={() => {
            transport.resync();
          }}>Opdater lys</Button>} />
      </section>
    );
  }
  return (
    <section id="light-view" className="flex min-h-0 flex-1 flex-col gap-8" aria-labelledby="light-title">
      <h1 id="light-title" className="sr-only">Lys</h1>
      <section className="flex shrink-0 flex-col gap-4" aria-labelledby="light-rooms-title">
        <div className="flex h-11 items-center justify-between">
          <SectionTitle id="light-rooms-title">Rum</SectionTitle>
          <HomeKey models={models} stale={stale} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {models.map(model => (
            <ToggleCard key={model.id} tone="lys" data-room-id={model.id}
              tag={model.own ? 'Denne skærms rum' : 'Rum'} name={model.name}
              status={stale ? 'Status ukendt' : STATUS[model.state]} on={!stale && model.on}
              isSelected={model.id === selected.id}
              onSelect={() => {
                useLightSession.setState({selected: model.id});
              }}
              power={{
                'aria-label': `${model.on ? 'Sluk' : 'Tænd'} alle lys i ${model.name}`,
                isSelected: model.on,
                isDisabled: model.state === 'ukendt' || model.state === 'tom',
                dim: stale,
                onChange: next => {
                  roomCommands.power(model, next);
                },
              }} />
          ))}
        </div>
        {stale ? (
          <Notice compact level="info" title="Lysoplysninger kunne ikke hentes. Prøv igen." className="-mt-2 self-start" />
        ) : null}
      </section>
      <RoomPanel key={selected.id} model={selected} stale={stale} />
    </section>
  );
}
