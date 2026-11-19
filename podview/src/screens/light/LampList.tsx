// Lys: the lamp rows inside div.light-lamp-list, drawn with exactly the elements, classes, kit data attributes and
// aria the pre-React light-lamp-view.js built (createKitComponent listrow/toggle/icon, createKitSliderField), so the
// stage stylesheet applies unchanged. Each lamp is a ListRow: the heading is the lamp's Toggle, under it the
// brightness SliderField. The slider's live state (value, draft, progress, output text, disabled) is painted by the
// kit slider (bindKitSliderField), never by React, so a gesture keeps its draft through renders.

export interface LampToggleFace {
  label: string;
  busy: boolean;
  disabled: boolean;
  ariaDisabled: boolean;
  // aria-checked: the lamp's observed state; null when it is unknown (no attribute).
  checked: boolean | null;
}

export interface LampFace {
  id: string;
  hidden: boolean;
  name: string;
  state: string;
  toggle: LampToggleFace;
  levelHidden: boolean;
  live: boolean;
}

const bool = (value: boolean) => String(value) as 'true' | 'false';

function LampRow({lamp, onToggle}: {lamp: LampFace; onToggle: (id: string) => void}) {
  const {id, toggle} = lamp;
  const fieldId = `light-lamp-${encodeURIComponent(id)}`;
  const nameId = `light-lamp-name-${encodeURIComponent(id)}`;
  return (
    <section
      className="light-lamp-row pv-kit pv-kit-listrow pv-row"
      data-kit="listrow"
      data-kit-identity="light"
      data-lamp-id={id}
      hidden={lamp.hidden}
    >
      <button
        className="light-lamp-heading light-lamp-toggle pv-kit pv-kit-toggle pv-toggle"
        type="button"
        data-kit="toggle"
        data-kit-identity="light"
        data-kit-variant="row"
        role="switch"
        data-feedback="progress"
        aria-busy={bool(toggle.busy)}
        aria-label={toggle.label}
        aria-disabled={bool(toggle.ariaDisabled)}
        aria-checked={toggle.checked === null ? undefined : bool(toggle.checked)}
        disabled={toggle.disabled}
        onClick={() => {
          onToggle(id);
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
      </button>
      <div
        className="pv-kit-slider-field light-lamp-level"
        hidden={lamp.levelHidden}
        data-lamp-live={bool(lamp.live)}
        inert={!lamp.live}
      >
        <label id={`${fieldId}-label`} htmlFor={fieldId} data-kit-text="field-label">
          Lysstyrke
        </label>
        <output htmlFor={fieldId} />
        <p data-kit-text="meta" id={`${fieldId}-scope`} />
        <input
          className="pv-kit pv-kit-slider pv-slider"
          data-kit="slider"
          data-kit-identity="light"
          type="range"
          min="0"
          max="100"
          step="1"
          id={fieldId}
          aria-labelledby={`${nameId} ${fieldId}-label`}
          aria-describedby={`${fieldId}-scope`}
        />
      </div>
    </section>
  );
}

export function LampList({lamps, onToggle}: {lamps: LampFace[]; onToggle: (id: string) => void}) {
  return lamps.map(lamp => <LampRow key={lamp.id} lamp={lamp} onToggle={onToggle} />);
}
