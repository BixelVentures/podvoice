// Robot on HA: rooms, cleaning settings, recipes and the cleaning journal (podvoice.robot_cleaning_state;
// lib/ha/robot.ts). The anatomy, classes and words are the old Robot screen's (screens/robot/RobotPanel.tsx and
// model.ts): »Rum« with »Vælg alle« and the room tiles, »Rengøringsvalg« with the level rails (Type, Sugeevne,
// Vandmængde, Rute, Antal gange), »Seneste rumvalg« with »Brug seneste valg«, »Gentag den valgte rengøring« with
// »Start denne rengøring«, and »Start i <rum>« / »Start · N rum«. A start goes once to the integration, which checks
// the rooms, settings and recipe again against what HA shows; the vacuum cleaning is its proof. While the robot works
// the same rails set the setting directly, one tap one podvoice.robot_setting, HA's select its proof.
import {useEffect, useId, useRef} from 'react';
import type {ReactNode} from 'react';
import {useStore} from 'zustand';
import {create} from 'zustand';
import {
  choiceLabel,
  cleaningMode,
  irrelevantSetting,
  LEVEL_ICONS,
  roomIcon,
  settingConcept,
  settingLabel,
  visibleSettingChoices,
} from '../../screens/robot/model';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {
  SETTING_ORDER,
  settingWishKey,
  startWishKey,
  useRobotCleaning,
  useRobotCleaningCommands,
} from '../../lib/ha/robot';
import type {JournalItem, RobotCleaning, RobotSetting, SettingKey, StartRequest} from '../../lib/ha/robot';
import {useEntities} from '../../lib/ha/transport';
import {Button, Card, Chip, Choices, cx, Icon, ListRow, listRow, ToggleButton} from '../../ui';
import {Notice, wishNotice} from '../ui';

const READY = new Set(['idle', 'docked']);
const UNKNOWN_START = 'Tidligere start er uvis; kontrollér robotten, gentag ikke';
const HEADING = 'text-pv-label font-semibold tracking-[-0.02em]';
// The robot's cards: the surface, ringed in the robot's tint.
const CARD = 'flex flex-col shadow-pv ring-1 ring-pv-robot-strong ring-inset';
// The robot's start: its own dark tone.
const START = 'bg-pv-robot-ink';
const pending = (wish: Wish | undefined) => wish?.phase === 'sending' || wish?.phase === 'awaiting';

// ---- The draft: what the user picked for the next start, per robot (UI state only) -------------------------------

export interface Draft {
  areaIds: string[];
  repeat: number | null;
  settings: Partial<Record<SettingKey, string>>;
  // The journal entry the draft was filled from, while it is unchanged.
  recipeId: string | null;
}
const EMPTY: Draft = {areaIds: [], repeat: null, settings: {}, recipeId: null};

export const useRobotDraft = create<{drafts: Record<string, Draft | undefined>}>(() => ({drafts: {}}));
const setDraft = (entityId: string, next: (draft: Draft) => Draft) => {
  useRobotDraft.setState(state => ({
    drafts: {...state.drafts, [entityId]: next(state.drafts[entityId] ?? EMPTY)},
  }));
};

// The settings a draft starts from: what HA shows now, unless the user chose otherwise.
function draftSettings(cleaning: RobotCleaning, live: Record<string, string | null>, draft: Draft) {
  const result: Partial<Record<SettingKey, string>> = {};
  for (const row of cleaning.settings) {
    if (row.key === 'map') continue;
    const chosen = draft.settings[row.key] ?? live[row.key] ?? row.current;
    if (chosen && row.options.includes(chosen)) result[row.key] = chosen;
  }
  return result;
}

// The newest journal entry that can still be started as it was.
export const latestRecipe = (cleaning: RobotCleaning): JournalItem | null =>
  cleaning.journal.items.find(item => item.reusable) ?? null;

const descriptor = (row: Pick<RobotSetting, 'key'>) => ({settingKey: row.key === 'suction' ? 'suction' : row.key});
const times = (count: number) => `${String(count)} ${count === 1 ? 'gang' : 'gange'}`;
const clock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString('da-DK', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// A setting's value as the old screen words it (model.ts choiceLabel), or the value itself.
export function valueLabel(key: SettingKey, value: string): string {
  if (key === 'map') return value;
  return choiceLabel(descriptor({key}), {id: value, label: value});
}

function roomsText(item: JournalItem): string {
  const names = item.areaNames.map(name => name ?? '').filter(Boolean);
  return names.length === item.areaIds.length ? names.join(', ') : 'Valgte rum er ikke oplyst';
}

// ---- Rails (the old level rails): one choice of a few, a segmented radiogroup under its label -------------------

interface RailProps {
  label: string;
  iconName?: string | undefined;
  choices: {value: string; label: string}[];
  value: string | null;
  busy?: string | null;
  disabled: boolean;
  hidden?: boolean;
  onChange: (value: string) => void;
}

function Rail({label, iconName, choices, value, busy, disabled, hidden, onChange}: RailProps) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-pv-s1" hidden={hidden}>
      <span id={labelId} className="flex items-center gap-pv-s1 text-pv-body font-medium text-pv-ink-2">
        {iconName ? <Icon name={iconName} /> : null}
        {label}
      </span>
      <Choices
        aria-labelledby={labelId}
        className="flex flex-wrap rounded-pv-s bg-pv-surface-2 p-1"
        value={value}
        isDisabled={disabled}
        onChange={next => {
          onChange(next);
        }}
      >
        {choices.map(choice => (
          <Chip
            key={choice.value}
            id={choice.value}
            className="min-w-[min(100%,64px)] flex-[1_1_max-content] shrink rounded-pv-s bg-transparent px-pv-s1
              text-pv-meta font-semibold"
            data-busy={busy === choice.value ? 'true' : undefined}
          >
            {choice.label}
          </Chip>
        ))}
      </Choices>
    </div>
  );
}

// A section's heading row: its title (with a line under it), and what sits beside it.
function Heading({id, children, below, aside}: {id?: string; children: ReactNode; below?: ReactNode;
  aside?: ReactNode}) {
  return (
    <div className="flex items-start justify-between gap-pv-s2">
      <div className="flex min-w-0 flex-col gap-pv-s1">
        <h2 id={id} className={HEADING}>
          {children}
        </h2>
        {below}
      </div>
      {aside}
    </div>
  );
}

function settingChoices(row: RobotSetting) {
  const d = descriptor(row);
  const offered = row.options.map(option => ({id: option, label: option}));
  return visibleSettingChoices(d, offered).map(choice => ({value: choice.id, label: choiceLabel(d, choice)}));
}

const ordered = (rows: RobotSetting[]) =>
  [...rows]
    .filter(row => row.key !== 'map')
    .sort((a, b) => SETTING_ORDER.indexOf(a.key) - SETTING_ORDER.indexOf(b.key));

// ---- The live settings: what HA's select (or fan speed) shows now -------------------------------------------------

function useLiveSettings(cleaning: RobotCleaning | undefined, vacuum: HassEntityState | null) {
  const rows = cleaning?.settings ?? [];
  const ids = rows.filter(row => row.key !== 'suction').map(row => row.entityId);
  const states = useEntities(ids);
  const live: Record<string, string | null> = {};
  for (const row of rows) {
    if (row.key === 'suction') {
      const speed = vacuum?.attributes.fan_speed;
      live[row.key] = typeof speed === 'string' ? speed : row.current;
    } else {
      const state = states[ids.indexOf(row.entityId)]?.state;
      live[row.key] = state && row.options.includes(state) ? state : row.current;
    }
  }
  return live;
}

// ---- Direct settings while the robot works (and the floor while it rests) ---------------------------------------

function DirectRail({
  vacuumId,
  row,
  live,
  connected,
  mode,
}: {
  vacuumId: string;
  row: RobotSetting;
  live: string | null;
  connected: boolean;
  mode: string | null;
}) {
  const {setting} = useRobotCleaningCommands();
  const wish = useStore(commands.store, state => state.wishes[settingWishKey(vacuumId, row.key)]);
  const wished = pending(wish) ? (wish?.value as string) : null;
  const concept = settingConcept(descriptor(row));
  return (
    <>
      <Rail
        label={settingLabel(descriptor(row))}
        iconName={LEVEL_ICONS[concept]}
        choices={settingChoices(row)}
        value={wished ?? live}
        busy={wished}
        disabled={!connected}
        hidden={irrelevantSetting(concept, mode)}
        onChange={value => {
          setting(vacuumId, {...row, current: live}, value);
        }}
      />
      <Notice text={wishNotice(wish)} />
    </>
  );
}

function FloorSelect({vacuumId, row, live, connected}: {
  vacuumId: string;
  row: RobotSetting;
  live: string | null;
  connected: boolean;
}) {
  const {setting} = useRobotCleaningCommands();
  const wish = useStore(commands.store, state => state.wishes[settingWishKey(vacuumId, 'map')]);
  const shown = pending(wish) ? (wish?.value as string) : (live ?? '');
  return (
    <>
      <span className="relative inline-flex self-start">
        <select
          className="min-h-12 appearance-none rounded-pv-pill bg-pv-surface-2 pr-pv-s5 pl-pv-s2 text-pv-body text-pv-ink
            disabled:opacity-40"
          aria-label="Vælg etage"
          value={shown}
          disabled={!connected}
          aria-busy={pending(wish) ? true : undefined}
          onChange={event => {
            setting(vacuumId, {...row, current: live}, event.currentTarget.value);
          }}
        >
          {shown ? null : <option value="">Vælg etage</option>}
          {row.options.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          className="pointer-events-none absolute top-1/2 right-pv-s2 size-5 -translate-y-1/2"
        />
      </span>
      <Notice text={wishNotice(wish)} />
    </>
  );
}

// ---- The start form ---------------------------------------------------------------------------------------------

function StartForm({
  cleaning,
  vacuum,
  live,
  connected,
}: {
  cleaning: RobotCleaning;
  vacuum: HassEntityState | null;
  live: Record<string, string | null>;
  connected: boolean;
}) {
  const entityId = cleaning.entityId;
  const {start} = useRobotCleaningCommands();
  const draft = useRobotDraft(state => state.drafts[entityId]) ?? EMPTY;
  const wish = useStore(commands.store, state => state.wishes[startWishKey(entityId)]);
  const rooms = cleaning.rooms;
  const offered = new Set(rooms.map(room => room.id));
  const selected = draft.areaIds.filter(id => offered.has(id));
  const max = cleaning.repeat.max;
  const repeat = max > 1 ? draft.repeat : 1;
  const chosen = draftSettings(cleaning, live, draft);
  const mode = cleaningMode(chosen.cleaning_mode);
  const recipe = latestRecipe(cleaning);
  const fromRecipe = recipe !== null && draft.recipeId === recipe.id;
  const everything = rooms.length > 0 && selected.length === rooms.length;
  const first = rooms.find(room => room.id === selected[0]);
  const label =
    selected.length === 1 && first
      ? `Start i ${first.name}`
      : selected.length
        ? `Start · ${String(selected.length)} rum`
        : 'Vælg rum';
  const floor = cleaning.settings.find(row => row.key === 'map');
  const edit = (next: (draft: Draft) => Draft) => {
    setDraft(entityId, current => ({...next(current), recipeId: null}));
  };
  const send = (request: StartRequest) => {
    start(cleaning, vacuum, request);
  };
  const disabled = !connected || cleaning.blocked;
  return (
    <Card className={cx(CARD, 'gap-pv-s3')} aria-label="Rengøring">
      <Heading
        below={
          floor && READY.has(vacuum?.state ?? '') ? (
            <FloorSelect vacuumId={entityId} row={floor} live={live.map ?? floor.current} connected={connected} />
          ) : cleaning.mapName ? (
            <p className="text-pv-meta text-pv-ink-2">{cleaning.mapName}</p>
          ) : null
        }
        aside={
          rooms.length ? (
            <Button
              variant="quiet"
              size="sm"
              isDisabled={disabled}
              onPress={() => {
                edit(current => ({...current, areaIds: everything ? [] : rooms.map(room => room.id)}));
              }}
            >
              <Icon name={everything ? 'x-lg' : 'check2'} />
              {everything ? 'Fravælg alle' : 'Vælg alle'}
            </Button>
          ) : null
        }
      >
        Rum
      </Heading>
      {rooms.length ? (
        <fieldset className="grid min-w-0 grid-cols-3 gap-pv-s1">
          <legend className="sr-only">Vælg rum</legend>
          {rooms.map(room => {
            const on = selected.includes(room.id);
            return (
              <ToggleButton
                key={room.id}
                className="justify-start gap-pv-s2 rounded-pv-s bg-pv-robot px-pv-s2 text-pv-body font-medium
                  text-pv-ink data-[selected]:bg-pv-robot-ink"
                data-room={room.id}
                isSelected={on}
                isDisabled={disabled}
                onChange={() => {
                  edit(current => ({
                    ...current,
                    areaIds: on ? current.areaIds.filter(id => id !== room.id) : [...current.areaIds, room.id],
                  }));
                }}
              >
                <img
                  className="pointer-events-none size-pv-icon-m shrink-0 in-data-[selected]:invert"
                  src={roomIcon(room.name)}
                  alt=""
                  draggable={false}
                />
                <span className="min-w-0 truncate">{room.name}</span>
              </ToggleButton>
            );
          })}
        </fieldset>
      ) : (
        <p className="text-pv-meta text-pv-ink-2">Ingen rum at vælge på denne etage.</p>
      )}
      {recipe ? (
        <ListRow className="justify-between rounded-pv-s p-pv-s2">
          <p className="text-pv-meta text-pv-ink-2">
            {fromRecipe ? 'Dit tidligere rumvalg' : draft.areaIds.length ? 'Tilpassede valg' : 'Seneste rumvalg'}
          </p>
          <Button
            size="sm"
            className="bg-pv-robot-strong text-pv-robot-ink"
            isDisabled={disabled}
            onPress={() => {
              setDraft(entityId, () => ({
                areaIds: [...recipe.areaIds],
                repeat: recipe.repeat,
                settings: {...recipe.settings},
                recipeId: recipe.id,
              }));
            }}
          >
            {fromRecipe ? 'Valg brugt' : 'Brug seneste valg'}
          </Button>
        </ListRow>
      ) : null}
      <section className="flex flex-col gap-pv-s2" aria-label="Rengøringsvalg">
        <h2 className={HEADING}>Rengøringsvalg</h2>
        <div className="flex flex-col gap-pv-s2" role="group" aria-label="Indstillinger for valgt type">
          {ordered(cleaning.settings).map(row => {
            const concept = settingConcept(descriptor(row));
            return (
              <Rail
                key={row.key}
                label={settingLabel(descriptor(row))}
                iconName={LEVEL_ICONS[concept]}
                choices={settingChoices(row)}
                value={chosen[row.key] ?? null}
                disabled={disabled}
                hidden={irrelevantSetting(concept, mode)}
                onChange={value => {
                  edit(current => ({...current, settings: {...current.settings, [row.key]: value}}));
                }}
              />
            );
          })}
          {max > 1 ? (
            <Rail
              label="Antal gange"
              iconName={LEVEL_ICONS.repeat}
              choices={Array.from({length: max}, (_, index) => ({
                value: String(index + 1),
                label: `${String(index + 1)}×`,
              }))}
              value={repeat === null ? null : String(repeat)}
              disabled={disabled}
              onChange={value => {
                edit(current => ({...current, repeat: Number(value)}));
              }}
            />
          ) : null}
        </div>
      </section>
      <div className="flex flex-col gap-pv-s2">
        <p className="text-pv-body text-pv-ink-2" role="status">
          {selected.length && repeat !== null
            ? `${selected.map(id => rooms.find(room => room.id === id)?.name ?? '').join(', ')} · ${times(repeat)}`
            : repeat === null
              ? 'Vælg antal gange'
              : 'Vælg mindst ét rum'}
        </p>
        <Button
          variant="primary"
          className={cx(START, 'w-full')}
          busy={pending(wish)}
          isDisabled={disabled || !selected.length || repeat === null || !cleaning.startable}
          onPress={() => {
            if (repeat === null) return;
            send({
              areaIds: selected,
              repeat,
              settings: chosen,
              ...(fromRecipe ? {recipeId: recipe.id} : {}),
            });
          }}
        >
          <Icon name={selected.length ? 'play-fill' : 'check2'} className="invert" />
          {label}
        </Button>
        <Notice text={wishNotice(wish)} />
      </div>
    </Card>
  );
}

// »Gentag den valgte rengøring«: the newest reusable start, started again as it was.
interface ReuseProps {
  cleaning: RobotCleaning;
  vacuum: HassEntityState | null;
  connected: boolean;
}

function Reuse({cleaning, vacuum, connected}: ReuseProps) {
  const {start} = useRobotCleaningCommands();
  const recipe = latestRecipe(cleaning);
  if (!recipe) return null;
  const summary = [
    roomsText(recipe),
    times(recipe.repeat),
    ...Object.entries(recipe.settings).map(([key, value]) => valueLabel(key as SettingKey, value)),
  ].join(' · ');
  return (
    <section className="flex flex-col gap-pv-s2" aria-labelledby={`robot-reuse-${cleaning.entityId}`}>
      <h3 id={`robot-reuse-${cleaning.entityId}`} className={HEADING}>
        Gentag den valgte rengøring
      </h3>
      <p className="text-pv-meta text-pv-ink-2">Dit tidligere rumvalg</p>
      <section className={listRow({className: 'rounded-pv-s p-pv-s2'})} aria-label="Valgt opskrift til denne start">
        <p className="text-pv-meta">{summary}</p>
      </section>
      <Button
        variant="primary"
        className={cx(START, 'self-start')}
        isDisabled={!connected || cleaning.blocked || !cleaning.startable}
        onPress={() => {
          start(cleaning, vacuum, {
            areaIds: [...recipe.areaIds],
            repeat: recipe.repeat,
            settings: {...recipe.settings},
            recipeId: recipe.id,
          });
        }}
      >
        <Icon name="play-fill" className="invert" />
        Start denne rengøring
      </Button>
    </section>
  );
}

// The cleaning journal: the panel's and the add-on's last starts, newest first.
function Journal({cleaning}: {cleaning: RobotCleaning}) {
  const journal = cleaning.journal;
  if (!journal.items.length) return null;
  return (
    <section className="flex flex-col gap-pv-s2" aria-labelledby={`robot-journal-${cleaning.entityId}`}>
      <h2
        id={`robot-journal-${cleaning.entityId}`}
        className="text-pv-meta font-medium tracking-normal text-pv-ink-3"
      >
        Seneste rumvalg
      </h2>
      <dl className="grid gap-pv-s2">
        {journal.items.map(item => (
          <ListRow key={item.id} className="flex-wrap gap-x-pv-s3 rounded-pv-s p-pv-s2" data-outcome={item.outcome}>
            <dt className="text-pv-ink-2">{`Senest startet · ${clock(item.recordedAt)}`}</dt>
            <dd>
              {[roomsText(item), times(item.repeat)].join(' · ')}
              {item.outcome === 'unknown' ? (
                <small className="block text-pv-meta text-pv-ink-2">{UNKNOWN_START}</small>
              ) : null}
            </dd>
          </ListRow>
        ))}
      </dl>
    </section>
  );
}

const NOTES: Record<string, string> = {
  area_mapping_not_configured: 'Ingen rum at vælge på denne etage.',
  no_rooms_on_map: 'Ingen rum at vælge på denne etage.',
  too_many_rooms: 'Ingen rum at vælge på denne etage.',
  unsupported_action: 'Kun status er tilgængelig.',
};

// Everything below the hero: the start form while the robot rests, the direct settings while it works.
export function RobotCleaningSection({
  entityId,
  vacuum,
  generation,
  connected,
}: {
  entityId: string;
  vacuum: HassEntityState | null;
  generation: number;
  connected: boolean;
}) {
  const read = useRobotCleaning(entityId, generation);
  const cleaning = read.data?.status === 'observed' ? read.data : undefined;
  const live = useLiveSettings(cleaning, vacuum);
  const state = vacuum?.state ?? cleaning?.state ?? '';
  const {refetch} = read;
  // A new robot state or floor changes what may be started and which rooms the floor has: read again now.
  const seen = useRef(`${state}|${live.map ?? ''}`);
  useEffect(() => {
    const now = `${state}|${live.map ?? ''}`;
    if (seen.current === now) return;
    seen.current = now;
    if (state) void refetch();
  }, [state, live.map, refetch]);
  if (!cleaning) {
    return read.isPending ? (
      <p className="text-pv-meta text-pv-ink-2" role="status">
        Henter aktuel betjening…
      </p>
    ) : null;
  }
  const rest = READY.has(state);
  const mode = cleaningMode(live.cleaning_mode ?? undefined);
  return (
    <>
      {cleaning.blocked ? <Notice text={UNKNOWN_START} /> : null}
      {rest && cleaning.startable ? (
        <>
          <StartForm cleaning={cleaning} vacuum={vacuum} live={live} connected={connected} />
          <Reuse cleaning={cleaning} vacuum={vacuum} connected={connected} />
        </>
      ) : null}
      {rest && !cleaning.startable && cleaning.reason ? (
        <p className="text-pv-meta text-pv-ink-2" role="status">
          {NOTES[cleaning.reason] ?? 'Du kan ikke ændre rengøringen her lige nu.'}
        </p>
      ) : null}
      {!rest && ordered(cleaning.settings).length ? (
        <Card className={cx(CARD, 'gap-pv-s4')} aria-labelledby={`robot-settings-${entityId}`}>
          <h2 id={`robot-settings-${entityId}`} className={HEADING}>
            Rengøringsvalg
          </h2>
          <div className="flex flex-col gap-pv-s2" role="group" aria-label="Indstillinger for valgt type">
            {ordered(cleaning.settings).map(row => (
              <DirectRail
                key={row.key}
                vacuumId={entityId}
                row={row}
                live={live[row.key] ?? null}
                connected={connected}
                mode={mode}
              />
            ))}
          </div>
        </Card>
      ) : null}
      <Journal cleaning={cleaning} />
      {cleaning.journal.addon === 'addon_unavailable' ? (
        <p className="text-pv-meta text-pv-ink-2" data-robot-journal="addon_unavailable">
          PodVoice svarer ikke lige nu – prøv igen om et minut
        </p>
      ) : null}
    </>
  );
}
