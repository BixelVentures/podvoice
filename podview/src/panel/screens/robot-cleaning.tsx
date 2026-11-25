// Robot on HA, below the hero (A-Robot): »Rum« (the floor's rooms as chips with a dot, »Vælg alle«, the plan picker)
// or »Denne tur« while the robot works, »Rengøringsvalg« (Type as the main choice, then Sugeevne, Vandmængde, Rute and
// Antal gange), and »Seneste hændelser« beside »Vedligehold«. The data is podvoice.robot_cleaning_state
// (lib/ha/robot.ts) and the vacuum's own HA entities. At rest the choices are the next start's draft (UI state, per
// robot); the hero's Start sends it once to the integration, which checks rooms, settings and recipe again against
// what HA shows, and the vacuum cleaning is its proof. While the robot works the same rows set the setting directly,
// one tap one podvoice.robot_setting, HA's select its proof. »Vælg igen« fills the draft from a journal entry, and the
// next start names that recipe. Nothing is locked or resent.
import {useEffect, useId, useRef, useState} from 'react';
import {create, useStore} from 'zustand';
import {choiceLabel, cleaningMode, irrelevantSetting, settingConcept, settingLabel, visibleSettingChoices}
  from '../../screens/robot/model';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {SETTING_ORDER, settingWishKey, useRobotCleaning, useRobotCleaningCommands} from '../../lib/ha/robot';
import type {JournalItem, RobotCleaning, RobotRow, RobotSetting, SettingKey, StartRequest} from '../../lib/ha/robot';
import {dateLabel, robotValue} from '../../lib/robot/observation';
import type {TelemetryRow} from '../../lib/robot/observation';
import {useEntities} from '../../lib/ha/transport';
import {
  Button, ChoiceTile, DotChip, EventRow, MeterRow, Notice, OptionsCard, SectionTitle, Segment, SettingRow, Sheet,
} from '../../ui';
import {wishNotice} from '../ui';

export const READY = new Set(['idle', 'docked']);
export const UNKNOWN_START = 'Tidligere start er uvis; kontrollér robotten, gentag ikke';
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
// A hand edit: the draft no longer is the recipe it was filled from.
const edit = (entityId: string, next: (draft: Draft) => Draft) => {
  setDraft(entityId, current => ({...next(current), recipeId: null}));
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

// A setting's value as the old screen words it (model.ts choiceLabel), or the value itself.
export function valueLabel(key: SettingKey, value: string): string {
  if (key === 'map') return value;
  return choiceLabel(descriptor({key}), {id: value, label: value});
}

function roomsText(item: JournalItem): string {
  const names = item.areaNames.map(name => name ?? '').filter(Boolean);
  return names.length === item.areaIds.length ? names.join(', ') : 'Valgte rum er ikke oplyst';
}

function settingChoices(row: RobotSetting) {
  const d = descriptor(row);
  const offered = row.options.map(option => ({id: option, label: option}));
  return visibleSettingChoices(d, offered).map(choice => ({id: choice.id, label: choiceLabel(d, choice)}));
}

const ordered = (rows: RobotSetting[]) =>
  [...rows]
    .filter(row => row.key !== 'map')
    .sort((a, b) => SETTING_ORDER.indexOf(a.key) - SETTING_ORDER.indexOf(b.key));

// ---- The cleaning read and HA's live settings ----------------------------------------------------------------------

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

export interface CleaningView {
  read: ReturnType<typeof useRobotCleaning>;
  cleaning: RobotCleaning | undefined;
  live: Record<string, string | null>;
  state: string;
  rest: boolean;
}

/** The robot's rooms, settings and journal, re-read when the vacuum's state or floor changes. */
export function useCleaning(entityId: string, vacuum: HassEntityState | null, generation: number): CleaningView {
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
  return {read, cleaning, live, state, rest: READY.has(state)};
}

/** The draft as the screen reads it (re-renders on every edit). */
export function useDraft(entityId: string): Draft {
  return useRobotDraft(state => state.drafts[entityId]) ?? EMPTY;
}

// ---- The start: what the hero's Start sends --------------------------------------------------------------------

export interface StartOffer {
  /** »Start i Køkkenalrum«, »Start · 3 rum« or »Vælg rum«. */
  label: string;
  /** The request a press sends, or null while it cannot (no room, no repeat, not startable, blocked). */
  request: StartRequest | null;
}

export function startOffer(cleaning: RobotCleaning, live: Record<string, string | null>, draft: Draft): StartOffer {
  const offered = new Set(cleaning.rooms.map(room => room.id));
  const selected = draft.areaIds.filter(id => offered.has(id));
  const repeat = cleaning.repeat.max > 1 ? draft.repeat : 1;
  const chosen = draftSettings(cleaning, live, draft);
  const recipe = draft.recipeId ? cleaning.journal.items.find(item => item.id === draft.recipeId && item.reusable)
    : undefined;
  const first = cleaning.rooms.find(room => room.id === selected[0]);
  const label = !selected.length ? 'Vælg rum' : repeat === null ? 'Vælg antal gange'
    : selected.length === 1 && first ? `Start i ${first.name}` : `Start · ${String(selected.length)} rum`;
  const ready = selected.length > 0 && cleaning.startable && !cleaning.blocked;
  return {
    label,
    request: ready && repeat !== null
      ? {areaIds: selected, repeat, settings: chosen, ...(recipe ? {recipeId: recipe.id} : {})} : null,
  };
}

// ---- Rum ---------------------------------------------------------------------------------------------------------

function PlanPicker({vacuumId, row, live, connected}: {
  vacuumId: string;
  row: RobotSetting;
  live: string | null;
  connected: boolean;
}) {
  const {setting} = useRobotCleaningCommands();
  const wish = useStore(commands.store, state => state.wishes[settingWishKey(vacuumId, 'map')]);
  const [open, setOpen] = useState(false);
  const shown = pending(wish) ? (wish?.value as string) : live;
  const failed = wishNotice(wish);
  return (
    <>
      <Button variant="kant" size={44} isDisabled={!connected} busy={pending(wish)}
        aria-label={`Vælg etage · ${shown ?? 'ingen valgt'}`}
        onPress={() => {
          setOpen(true);
        }}>
        {shown ?? 'Vælg etage'}
      </Button>
      <Sheet isOpen={open} title="Vælg etage" description="Robotten viser rummene på den valgte etage."
        onClose={() => {
          setOpen(false);
        }}>
        <div className="grid grid-cols-2 gap-3" role="group" aria-label="Etager">
          {row.options.map(option => (
            <ChoiceTile key={option} tone="robot" title={option} isSelected={option === shown}
              isPending={pending(wish) && option === shown} isDisabled={!connected}
              onPress={() => {
                setOpen(false);
                if (option !== live) setting(vacuumId, {...row, current: live}, option);
              }} />
          ))}
        </div>
      </Sheet>
      {failed ? <Notice compact level="fejl" title={failed} /> : null}
    </>
  );
}

export function RoomsSection({cleaning, live, connected, rest}: {
  cleaning: RobotCleaning;
  live: Record<string, string | null>;
  connected: boolean;
  rest: boolean;
}) {
  const entityId = cleaning.entityId;
  const draft = useDraft(entityId);
  const titleId = useId();
  const rooms = cleaning.rooms;
  const offered = new Set(rooms.map(room => room.id));
  const selected = draft.areaIds.filter(id => offered.has(id));
  const everything = rooms.length > 0 && selected.length === rooms.length;
  const disabled = !connected || cleaning.blocked;
  const floor = cleaning.settings.find(row => row.key === 'map');
  const plan = live.map ?? cleaning.mapName ?? null;
  const picker = floor && rest && floor.options.length > 1 ? floor : null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <div className="flex items-end justify-between gap-4 px-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <SectionTitle id={titleId}>Rum</SectionTitle>
          <span className="text-base text-pv-ink-3">
            {[plan, rooms.length ? `${String(selected.length)} af ${String(rooms.length)} valgt` : '']
              .filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {picker ? <PlanPicker vacuumId={entityId} row={picker} live={live.map ?? picker.current}
            connected={connected} /> : null}
          {rooms.length ? (
            <Button variant="lys" size={44} isDisabled={disabled} onPress={() => {
              edit(entityId, current => ({...current, areaIds: everything ? [] : rooms.map(room => room.id)}));
            }}>
              {everything ? 'Fravælg alle' : 'Vælg alle'}
            </Button>
          ) : null}
        </div>
      </div>
      {rooms.length ? (
        <div className="grid grid-cols-4 gap-2.5" role="group" aria-label="Vælg rum">
          {rooms.map(room => {
            const on = selected.includes(room.id);
            return (
              <DotChip key={room.id} label={room.name} isSelected={on} isDisabled={disabled} data-room={room.id}
                onPress={() => {
                  edit(entityId, current => ({
                    ...current,
                    areaIds: on ? current.areaIds.filter(id => id !== room.id) : [...current.areaIds, room.id],
                  }));
                }} />
            );
          })}
        </div>
      ) : (
        <p className="m-0 px-1 text-[15px] text-pv-ink-3">Ingen rum at vælge på denne etage.</p>
      )}
    </section>
  );
}

// ---- Denne tur (while the robot works) -------------------------------------------------------------------------

/** The rooms of the running trip: the newest start the robot confirmed, when its job still matches it (repeat and
 * room count); otherwise nothing is claimed. */
export function tripRooms(cleaning: RobotCleaning, row: RobotRow): string[] | null {
  const job = row.job;
  const item = cleaning.journal.items.find(entry => entry.outcome === 'accepted');
  if (!job || job.scope === 'all' || !item) return null;
  if (item.repeat !== job.repeat || item.areaIds.length !== job.segmentIds.length) return null;
  const names = item.areaNames.filter((name): name is string => !!name);
  return names.length === item.areaIds.length ? names : null;
}

export function ThisTrip({cleaning, row, room}: {cleaning: RobotCleaning; row: RobotRow; room: string | null}) {
  const titleId = useId();
  const names = tripRooms(cleaning, row);
  const all = row.job?.scope === 'all';
  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <div className="flex flex-col gap-0.5 px-1">
        <SectionTitle id={titleId}>Denne tur</SectionTitle>
        {cleaning.mapName ? <span className="text-base text-pv-ink-3">{cleaning.mapName}</span> : null}
      </div>
      {names?.length ? (
        <ul className="m-0 grid list-none grid-cols-4 gap-2.5 p-0" aria-label="Rum på denne tur">
          {names.map(name => <li key={name}><DotChip isStatic label={name} isSelected /></li>)}
        </ul>
      ) : (
        <p className="m-0 px-1 text-[15px] text-pv-ink-3">
          {all ? 'Alle rum' : room ? `Rengør nu: ${room}` : 'Valgte rum er ikke oplyst'}
        </p>
      )}
    </section>
  );
}

// ---- Rengøringsvalg ----------------------------------------------------------------------------------------------

function DirectRow({vacuumId, row, live, connected, mode}: {
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
  const labelId = useId();
  const main = row.key === 'cleaning_mode';
  const choices = settingChoices(row);
  const failed = wishNotice(wish);
  return (
    <SettingRow label={settingLabel(descriptor(row))} labelId={labelId} main={main}
      hidden={irrelevantSetting(concept, mode)}>
      <Segment aria-labelledby={labelId} options={choices} value={wished ?? live} fill size={main ? 56 : 44}
        {...(main && choices.length === 3 ? {weights: [1.6, 1, 1]} : {})} isDisabled={!connected}
        data-busy={wished ?? undefined}
        onChange={value => {
          setting(vacuumId, {...row, current: live}, value);
        }} />
      {failed ? <Notice compact level="fejl" title={failed} className="self-start" /> : null}
    </SettingRow>
  );
}

export function OptionsSection({cleaning, live, connected, rest}: {
  cleaning: RobotCleaning;
  live: Record<string, string | null>;
  connected: boolean;
  rest: boolean;
}) {
  const entityId = cleaning.entityId;
  const draft = useDraft(entityId);
  const titleId = useId();
  const repeatId = useId();
  const rows = ordered(cleaning.settings);
  const max = cleaning.repeat.max;
  if (!rows.length && !(rest && max > 1)) return null;
  const disabled = !connected || cleaning.blocked;
  const chosen = draftSettings(cleaning, live, draft);
  const mode = cleaningMode(rest ? chosen.cleaning_mode : (live.cleaning_mode ?? undefined));
  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <SectionTitle id={titleId} className="px-1">Rengøringsvalg</SectionTitle>
      <OptionsCard role="group" aria-label="Indstillinger for valgt type">
        {rows.map(row => {
          if (!rest) {
            return <DirectRow key={row.key} vacuumId={entityId} row={row} live={live[row.key] ?? null}
              connected={connected} mode={mode} />;
          }
          const labelId = `${titleId}-${row.key}`;
          const main = row.key === 'cleaning_mode';
          const choices = settingChoices(row);
          return (
            <SettingRow key={row.key} label={settingLabel(descriptor(row))} labelId={labelId} main={main}
              hidden={irrelevantSetting(settingConcept(descriptor(row)), mode)}>
              <Segment aria-labelledby={labelId} options={choices} value={chosen[row.key] ?? null} fill
                size={main ? 56 : 44} {...(main && choices.length === 3 ? {weights: [1.6, 1, 1]} : {})}
                isDisabled={disabled}
                onChange={value => {
                  edit(entityId, current => ({...current, settings: {...current.settings, [row.key]: value}}));
                }} />
            </SettingRow>
          );
        })}
        {rest && max > 1 ? (
          <SettingRow label="Antal gange" labelId={repeatId}>
            <Segment aria-labelledby={repeatId} fill isDisabled={disabled}
              options={Array.from({length: max}, (_, index) => ({id: String(index + 1),
                label: `${String(index + 1)}×`}))}
              value={draft.repeat === null ? null : String(draft.repeat)}
              onChange={value => {
                edit(entityId, current => ({...current, repeat: Number(value)}));
              }} />
          </SettingRow>
        ) : null}
      </OptionsCard>
    </section>
  );
}

// ---- Seneste hændelser and Vedligehold ---------------------------------------------------------------------------

const clock = (seconds: number) => dateLabel(seconds).replace(' kl.', ' ·');

interface RobotEvent {
  key: string;
  at: number;
  title: string;
  detail: string;
  recipe?: JournalItem;
}

// The journal's starts (requested; confirmed or unknown) and the robot's last finished trip, newest first.
export function robotEvents(cleaning: RobotCleaning, telemetry: readonly TelemetryRow[]): RobotEvent[] {
  const events: RobotEvent[] = [];
  const end = telemetry.find(row => row.key === 'last_clean_end');
  if (typeof end?.value === 'number' && end.value > 0) {
    const area = telemetry.find(row => row.key === 'cleaning_area');
    const time = telemetry.find(row => row.key === 'cleaning_time');
    events.push({key: 'end', at: end.value, title: 'Senest afsluttet',
      detail: [cleaning.mapName ?? '', area ? robotValue(area) : '', time ? robotValue(time) : '']
        .filter(Boolean).join(' · ')});
  }
  for (const item of cleaning.journal.items) {
    const detail = [item.mapName ?? '', roomsText(item), times(item.repeat)].filter(Boolean).join(' · ');
    events.push({key: `${item.id}:asked`, at: item.recordedAt, title: 'Start anmodet', detail,
      ...(item.reusable ? {recipe: item} : {})});
    if (item.outcome === 'unknown') {
      events.push({key: `${item.id}:unknown`, at: item.recordedAt, title: 'Udfald ukendt', detail: UNKNOWN_START});
    } else if (typeof item.acceptedAt === 'number') {
      events.push({key: `${item.id}:started`, at: item.acceptedAt, title: 'Senest startet',
        detail: 'Robotten bekræftede start'});
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, 4);
}

// Roborock's own replacement intervals (hours), the base of each counter's bar.
const CARE: readonly [string, string, number][] = [
  ['main_brush_time_left', 'Hovedbørste', 300],
  ['side_brush_time_left', 'Sidebørste', 200],
  ['filter_time_left', 'Filter', 150],
  ['sensor_time_left', 'Sensorer', 30],
];

export function careRows(telemetry: readonly TelemetryRow[]) {
  return CARE.flatMap(([key, label, interval]) => {
    const row = telemetry.find(item => item.key === key);
    if (typeof row?.value !== 'number' || !['s', 'min', 'h'].includes(row.unit ?? '')) return [];
    const hours = row.unit === 's' ? row.value / 3600 : row.unit === 'min' ? row.value / 60 : row.value;
    const left = Math.max(0, Math.round(hours));
    const percent = (Math.max(0, hours) / interval) * 100;
    return [{key, label, value: hours <= 0 ? 'Nu' : `${left.toLocaleString('da-DK')} t`, percent,
      due: percent <= 10}];
  });
}

export function EventsSection({cleaning, telemetry, connected, rest}: {
  cleaning: RobotCleaning;
  telemetry: readonly TelemetryRow[];
  connected: boolean;
  rest: boolean;
}) {
  const draft = useDraft(cleaning.entityId);
  const eventsId = useId();
  const careId = useId();
  const events = robotEvents(cleaning, telemetry);
  const care = careRows(telemetry);
  if (!events.length && !care.length && cleaning.journal.addon !== 'addon_unavailable') return null;
  const choose = (recipe: JournalItem) => {
    setDraft(cleaning.entityId, () => ({areaIds: [...recipe.areaIds], repeat: recipe.repeat,
      settings: {...recipe.settings}, recipeId: recipe.id}));
  };
  return (
    <div className={care.length ? 'grid grid-cols-[1.5fr_1fr] items-start gap-4' : 'grid'}>
      <section className="flex flex-col gap-3.5 rounded-pv-widget bg-pv-surface p-6 shadow-pv-edge"
        aria-labelledby={eventsId}>
        <SectionTitle id={eventsId}>Seneste hændelser</SectionTitle>
        {events.map(event => {
          const recipe = event.recipe;
          return (
            <EventRow key={event.key} time={clock(event.at)} title={event.title} detail={event.detail}
              {...(recipe && rest && cleaning.startable ? {action: (
                <Button variant="sekundaer" size={44} className="text-[15px]"
                  isDisabled={!connected || cleaning.blocked} data-recipe={recipe.id}
                  onPress={() => {
                    choose(recipe);
                  }}>
                  {draft.recipeId === recipe.id ? 'Valgt' : 'Vælg igen'}
                </Button>
              )} : {})} />
          );
        })}
        {!events.length ? <p className="m-0 text-[15px] text-pv-ink-3">Ingen hændelser at vise endnu.</p> : null}
        {cleaning.journal.addon === 'addon_unavailable' ? (
          <p className="m-0 text-[15px] text-pv-ink-3" data-robot-journal="addon_unavailable">
            PodVoice svarer ikke lige nu – prøv igen om et minut
          </p>
        ) : null}
      </section>
      {care.length ? (
        <section className="flex flex-col gap-3.5 rounded-pv-widget bg-pv-surface p-6 shadow-pv-edge"
          aria-labelledby={careId}>
          <div className="flex items-baseline justify-between">
            <SectionTitle id={careId}>Vedligehold</SectionTitle>
            <span className="text-[15px] text-pv-ink-3">{`${String(care.length)} påmindelser`}</span>
          </div>
          {care.map(row => <MeterRow key={row.key} label={row.label} value={row.value} percent={row.percent}
            due={row.due} />)}
        </section>
      ) : null}
    </div>
  );
}

const NOTES: Record<string, string> = {
  area_mapping_not_configured: 'Ingen rum at vælge på denne etage.',
  no_rooms_on_map: 'Ingen rum at vælge på denne etage.',
  too_many_rooms: 'Ingen rum at vælge på denne etage.',
  unsupported_action: 'Kun status er tilgængelig.',
};
export const restNote = (cleaning: RobotCleaning) =>
  cleaning.reason ? (NOTES[cleaning.reason] ?? 'Du kan ikke ændre rengøringen her lige nu.') : '';
