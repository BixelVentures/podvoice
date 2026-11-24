// Lys: the room's lights (HA area), each a row with its power switch and, for a dimmable light that is on, its
// brightness. A tap shows the wish at once; HA's next state of that light confirms it.
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {brightnessKey, lightModel, lights, powerKey} from '../../lib/ha/lights';
import {useEntities} from '../../lib/ha/transport';
import {Icon, Slider, Switch} from '../../ui';
import {useRoom} from '../room';
import {Notice, wishNotice} from '../ui';

const pending = (phase: string | undefined) => phase === 'sending' || phase === 'awaiting';

function LampRow({entity, entityId}: {entity: HassEntityState | null; entityId: string}) {
  const power = useStore(commands.store, state => state.wishes[powerKey(entityId)]);
  const level = useStore(commands.store, state => state.wishes[brightnessKey(entityId)]);
  if (!entity) return null;
  const model = lightModel(entity);
  const on = power && pending(power.phase) ? (power.value as boolean) : model.on;
  const brightness = level && pending(level.phase) ? (level.value as number) : model.brightness;
  const state = !model.available
    ? 'Ikke tilgængelig'
    : on
      ? brightness !== null
        ? `Tændt · ${String(brightness)} %`
        : 'Tændt'
      : 'Slukket';
  return (
    // Offline the row shows the last known state, dimmed (never disabled: a tap reports »Ikke sendt«).
    <section className="grid gap-pv-s2 p-pv-s3 group-data-[link=offline]/host:opacity-55" data-lamp-id={entityId}>
      <Switch
        aria-label={`${model.name}: ${state}`}
        isSelected={model.available && on}
        isDisabled={!model.available}
        onChange={() => {
          lights.power(entityId, !on);
        }}
        className="group/lamp px-pv-s2 py-pv-s1 text-pv-body"
      >
        <Icon name="lightbulb" className="size-pv-icon-m opacity-45 group-data-[selected]/lamp:opacity-100" />
        <span className="min-w-0 flex-1 truncate font-semibold">{model.name}</span>
        <span className="shrink-0">{state}</span>
      </Switch>
      {model.dimmable && model.available && on ? (
        <Slider
          className="w-full gap-x-pv-s2 gap-y-pv-s1"
          label="Lysstyrke"
          min={1}
          value={brightness}
          format={value => `${String(value)} %`}
          onCommit={value => {
            lights.brightness(entityId, value);
          }}
        />
      ) : null}
      <Notice text={wishNotice(power) || wishNotice(level)} />
    </section>
  );
}

export function LightsScreen() {
  const {room} = useRoom();
  const ids = room?.lights ?? [];
  const states = useEntities(ids);
  const on = states.filter(state => state?.state === 'on').length;
  const summary = ids.length ? `${String(on)} af ${String(ids.length)} tændt` : 'ingen lamper';
  return (
    <section
      id="light-view"
      className="flex flex-[1_0_auto] flex-col overflow-hidden rounded-pv-l bg-pv-surface p-pv-s3"
      aria-labelledby="light-title"
    >
      <header className="pb-pv-s3">
        <h1 id="light-title" className="mt-0 mb-2.5 text-pv-title leading-[1.08] font-medium tracking-[-0.035em]">
          Lys
        </h1>
        <p className="text-pv-meta leading-[19px] text-pv-ink-3">
          {room ? `${room.name} · ${summary}` : 'Ingen rum i Home Assistant'}
        </p>
      </header>
      {ids.length ? (
        <div className="grid gap-pv-s2">
          {ids.map((id, index) => (
            <LampRow key={id} entityId={id} entity={states[index] ?? null} />
          ))}
        </div>
      ) : (
        <p className="max-w-[36ch] text-pv-body leading-normal text-pv-ink-3">
          Home Assistant har ingen lamper i dette område. Placér lamperne i et område i Home Assistant for at styre dem
          her.
        </p>
      )}
    </section>
  );
}
