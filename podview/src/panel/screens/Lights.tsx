// Lys: the room's lights (HA area), each a kit ListRow with its power switch and, for a dimmable light that is on,
// its brightness. A tap shows the wish at once; HA's next state of that light confirms it.
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {brightnessKey, lightModel, lights, powerKey} from '../../lib/ha/lights';
import {useEntities} from '../../lib/ha/transport';
import {KitButton} from '../../lib/ui/KitButton';
import {useRoom} from '../room';
import {icon, KitSlider, Notice, wishNotice} from '../ui';

const pending = (phase: string | undefined) => phase === 'sending' || phase === 'awaiting';

function LampRow({entity, entityId}: {entity: HassEntityState | null; entityId: string}) {
  const power = useStore(commands.store, state => state.wishes[powerKey(entityId)]);
  const level = useStore(commands.store, state => state.wishes[brightnessKey(entityId)]);
  if (!entity) return null;
  const model = lightModel(entity);
  const on = power && pending(power.phase) ? (power.value as boolean) : model.on;
  const brightness = level && pending(level.phase) ? (level.value as number) : model.brightness;
  const state = !model.available ? 'Ikke tilgængelig' : on ? (brightness !== null ? `Tændt · ${String(brightness)} %` : 'Tændt') : 'Slukket';
  const nameId = `lamp-name-${entityId}`;
  return (
    <section
      className="light-lamp-row pv-kit pv-kit-listrow pv-row"
      data-kit="listrow"
      data-kit-identity="light"
      data-lamp-id={entityId}
    >
      <KitButton
        className="light-lamp-heading light-lamp-toggle pv-kit pv-kit-toggle pv-toggle"
        data-kit="toggle"
        data-kit-identity="light"
        data-kit-variant="row"
        role="switch"
        aria-checked={model.available ? on : undefined}
        aria-busy={pending(power?.phase)}
        aria-label={`${model.name}: ${state}`}
        isDisabled={!model.available}
        onPress={() => {
          lights.power(entityId, !on);
        }}
      >
        <img className="light-lamp-icon pv-kit pv-kit-icon pv-icon" src={icon('lightbulb')} alt="" data-kit="icon" />
        <span className="light-lamp-name" data-kit-text="group-title" id={nameId}>
          {model.name}
        </span>
        <span className="light-lamp-state" data-kit-text="body">
          {state}
        </span>
      </KitButton>
      {model.dimmable && model.available && on ? (
        <div className="light-lamp-level">
          <KitSlider
            id={`brightness-${entityId}`}
            label="Lysstyrke"
            identity="light"
            min={1}
            value={brightness}
            format={value => `${String(value)} %`}
            onCommit={value => {
              lights.brightness(entityId, value);
            }}
          />
        </div>
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
  return (
    <section id="light-view" className="response-widget" aria-labelledby="light-title">
      <header className="response-heading">
        <div>
          <h1 id="light-title">Lys</h1>
          <p>{room ? `${room.name} · ${ids.length ? `${String(on)} af ${String(ids.length)} tændt` : 'ingen lamper'}` : 'Ingen rum i Home Assistant'}</p>
        </div>
      </header>
      {ids.length ? (
        <div className="light-lamp-list">
          {ids.map((id, index) => (
            <LampRow key={id} entityId={id} entity={states[index] ?? null} />
          ))}
        </div>
      ) : (
        <p className="screen-explanation">
          Home Assistant har ingen lamper i dette område. Placér lamperne i et område i Home Assistant for at styre dem
          her.
        </p>
      )}
    </section>
  );
}
