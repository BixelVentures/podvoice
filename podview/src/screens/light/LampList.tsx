// Lys: the lamp rows (div.light-lamp-list inside the room card's »Lamper« disclosure), with exactly the elements,
// classes, kit data attributes and aria the pre-React light-lamp-view.js built, so the stage stylesheet applies
// unchanged. Each lamp is a ListRow: the heading is the lamp's Toggle, under it the brightness SliderField. A row once
// shown stays in place (hidden, its toggle disabled) when its lamp leaves the scope, and is the same row when it
// comes back.
import {useState} from 'react';
import {KitButton} from '../../lib/ui/KitButton';
import {commitLamp, toggleLamp} from './actions';
import {LightSlider} from './LightSlider';
import {sameBinding, sameQueuedBinding} from './model';
import type {LampBinding, LampFace} from './model';

const bool = (value: boolean) => String(value) as 'true' | 'false';
// A draft survives a render while the lamp keeps its authority, or while it is a brightness queued behind a pending
// command whose authority is unchanged.
const keepDraft = (before: LampBinding | null, after: LampBinding | null) =>
  sameBinding(before, after) || sameQueuedBinding(before, after);

function LampRow({lamp, hidden}: {lamp: LampFace; hidden: boolean}) {
  const {id, binding} = lamp;
  const fieldId = `light-lamp-${encodeURIComponent(id)}`;
  const nameId = `light-lamp-name-${encodeURIComponent(id)}`;
  const disabled = hidden || lamp.disabled;
  return (
    <section
      className="light-lamp-row pv-kit pv-kit-listrow pv-row"
      data-kit="listrow"
      data-kit-identity="light"
      data-lamp-id={id}
      hidden={hidden}
    >
      <KitButton
        className="light-lamp-heading light-lamp-toggle pv-kit pv-kit-toggle pv-toggle"
        data-kit="toggle"
        data-kit-identity="light"
        data-kit-variant="row"
        role="switch"
        data-feedback="progress"
        aria-busy={bool(lamp.busy)}
        aria-label={lamp.label}
        aria-disabled={bool(disabled)}
        aria-checked={lamp.checked === null ? undefined : bool(lamp.checked)}
        isDisabled={disabled}
        onPress={() => {
          toggleLamp(id, binding);
        }}
      >
        <img
          className="light-lamp-icon pv-kit pv-kit-icon pv-icon"
          src="assets/icons/lightbulb.svg"
          alt=""
          data-kit="icon"
        />
        <span className="light-lamp-name" data-kit-text="group-title" id={nameId}>
          {lamp.name}
        </span>
        <span className="light-lamp-state" data-kit-text="body">
          {lamp.state}
        </span>
      </KitButton>
      <LightSlider<LampBinding | null, LampBinding | null>
        id={fieldId}
        className="light-lamp-level"
        hidden={lamp.levelHidden}
        dataLampLive={bool(lamp.live)}
        inert={!lamp.live}
        labelledBy={`${nameId} ${fieldId}-label`}
        model={hidden ? {...lamp.slider, disabled: true} : lamp.slider}
        session={hidden ? null : binding}
        keepDraft={keepDraft}
        context={() => binding}
        onCommit={(value, wish) => {
          commitLamp(id, value, wish);
        }}
      />
    </section>
  );
}

// The lamps in the order they were first shown; a lamp no longer in scope keeps the face it had when the shown set
// last changed, hidden.
export function LampList({lamps}: {lamps: LampFace[]}) {
  const key = lamps.map(lamp => lamp.id).join('\n');
  const [kept, setKept] = useState(() => ({key, order: lamps.map(lamp => lamp.id),
    faces: new Map(lamps.map(lamp => [lamp.id, lamp]))}));
  if (kept.key !== key) {
    const order = [...kept.order, ...lamps.map(lamp => lamp.id).filter(id => !kept.order.includes(id))];
    setKept({key, order, faces: new Map([...kept.faces, ...lamps.map(lamp => [lamp.id, lamp] as const)])});
  }
  const visible = new Map(lamps.map(lamp => [lamp.id, lamp]));
  const order = [...kept.order, ...lamps.map(lamp => lamp.id).filter(id => !kept.order.includes(id))];
  return (
    <div className="light-lamp-list" hidden={!lamps.length}>
      {order.map(id => {
        const lamp = visible.get(id) ?? kept.faces.get(id);
        return lamp ? <LampRow key={id} lamp={lamp} hidden={!visible.has(id)} /> : null;
      })}
    </div>
  );
}
