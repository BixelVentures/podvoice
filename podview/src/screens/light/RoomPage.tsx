// Lys: the room page inside section.light-room-view, drawn with exactly the elements, classes, kit data attributes
// and aria the pre-React light-room-view.js built (applyKitComponent, applyKitTextRole, createKitChoiceGroup), so
// the stage stylesheet applies unchanged. The rooms are cards (»A-Lys«): the card chooses the room, the switch
// bottom right is the room's power. The shell's own nodes (scene section, scene status, lamp disclosure) are placed
// in the panel by the controller after React's elements, which React never moves.

export interface RoomRowFace {
  id: string;
  tag: string;
  name: string;
  status: string;
  selected: boolean;
  powerOn: boolean;
  // aria-pressed on the switch; null when the room's state is unknown (no attribute).
  pressed: boolean | null;
  powerLabel: string;
  enabled: boolean;
  busy: boolean;
}

export interface NavigationFace {
  signature: string;
  choices: {value: string; label: string}[];
}

export interface RoomFace {
  listHidden: boolean;
  noticeHidden: boolean;
  toolbarHidden: boolean;
  panelHidden: boolean;
  headingText: string;
  kickerText: string;
  kickerHidden: boolean;
  statusText: string;
  statusHidden: boolean;
  emptyText: string;
  emptyHidden: boolean;
  refreshHidden: boolean;
  refreshDisabled: boolean;
  homeHidden: boolean;
  homeDisabled: boolean;
  homeLabel: string;
  // aria-label and title of »Sluk alt«/»Gendan lys«; null before the first room render (no attribute).
  homeTitle: string | null;
  rows: RoomRowFace[];
  navigation: NavigationFace | null;
}

export const initialRoomFace = (): RoomFace => ({
  listHidden: false,
  noticeHidden: true,
  toolbarHidden: false,
  panelHidden: true,
  headingText: '',
  kickerText: '',
  kickerHidden: true,
  statusText: '',
  statusHidden: false,
  emptyText: '',
  emptyHidden: true,
  refreshHidden: true,
  refreshDisabled: false,
  homeHidden: false,
  homeDisabled: false,
  homeLabel: '',
  homeTitle: null,
  rows: [],
  navigation: null,
});

export interface RoomHandlers {
  onSelect: (id: string) => void;
  onChoose: (id: string) => void;
  onPower: (id: string) => void;
  onHome: () => void;
  onRefresh: (button: HTMLButtonElement) => void;
}

const bool = (value: boolean) => String(value) as 'true' | 'false';

function RoomRow({row, handlers}: {row: RoomRowFace; handlers: RoomHandlers}) {
  const {id} = row;
  return (
    <div className="light-room-row" data-selected={bool(row.selected)} data-power-on={bool(row.powerOn)}>
      <button
        className="light-room-select"
        type="button"
        aria-pressed={bool(row.selected)}
        aria-label={`Vis ${row.name}`}
        onClick={() => {
          handlers.onSelect(id);
        }}
      >
        <span className="light-room-copy">
          <span className="light-room-tag">{row.tag}</span>
          <strong className="light-room-name" data-kit-text="group-title">
            {row.name}
          </strong>
          <span className="light-room-status" data-kit-text="body">
            {row.status}
          </span>
        </span>
      </button>
      <button
        className="light-room-power pv-kit pv-kit-tile pv-tile"
        type="button"
        data-kit="tile"
        data-kit-identity="light"
        data-kit-variant="power"
        data-pv-press="quiet"
        data-feedback="progress"
        aria-busy={bool(row.busy)}
        data-power-on={bool(row.powerOn)}
        aria-pressed={row.pressed === null ? undefined : bool(row.pressed)}
        aria-label={row.powerLabel}
        aria-disabled={bool(!row.enabled)}
        disabled={!row.enabled}
        onClick={() => {
          handlers.onPower(id);
        }}
      >
        <img
          className="light-room-icon pv-kit pv-kit-icon pv-icon"
          src="assets/icons/lightbulb.svg"
          alt=""
          data-kit="icon"
        />
      </button>
    </div>
  );
}

// The room navigation: native radios on kit Chips (createKitChoiceGroup, variant navigation), rebuilt when the
// rooms change. Which radio is checked is the radio's own state, which the controller keeps (setValue).
function RoomNavigation({face, onChoose}: {face: NavigationFace; onChoose: (id: string) => void}) {
  return (
    <fieldset className="pv-kit-choice-group" data-choice-variant="navigation">
      <legend data-kit-text="field-label">Rum</legend>
      <div className="pv-kit-choice-options">
        {face.choices.map((choice, index) => (
          <label key={choice.value} className="pv-kit pv-kit-chip pv-chip pv-kit-choice-label" data-kit="chip">
            <input
              type="radio"
              name="light-room"
              value={choice.value}
              id={`light-room-${String(index)}`}
              onChange={event => {
                if (event.currentTarget.checked) onChoose(event.currentTarget.value);
              }}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RoomPage({face, handlers}: {face: RoomFace; handlers: RoomHandlers}) {
  return (
    <>
      <div className="light-room-list" hidden={face.listHidden}>
        {face.rows.map(row => (
          <RoomRow key={row.id} row={row} handlers={handlers} />
        ))}
      </div>
      {/* Lærred »Lys-Ukendt«: when the light status could not be read, one compact info line under the rooms. */}
      <p className="light-room-notice" role="status" hidden={face.noticeHidden}>
        <i className="" aria-hidden="true">
          i
        </i>
        <span className="">Lysoplysninger kunne ikke hentes. Prøv igen.</span>
      </p>
      <div className="light-room-toolbar" hidden={face.toolbarHidden}>
        <div className="light-room-navigation">
          {face.navigation && (
            <RoomNavigation key={face.navigation.signature} face={face.navigation} onChoose={handlers.onChoose} />
          )}
        </div>
        <button
          className="light-home-power pv-kit pv-kit-button pv-btn"
          type="button"
          data-kit="button"
          data-kit-variant="secondary"
          hidden={face.homeHidden}
          disabled={face.homeDisabled}
          aria-label={face.homeTitle ?? undefined}
          title={face.homeTitle ?? undefined}
          onClick={handlers.onHome}
        >
          <img className="pv-kit pv-kit-icon pv-icon" src="assets/icons/house.svg" alt="" data-kit="icon" />
          <span className="">{face.homeLabel}</span>
        </button>
      </div>
      <section
        className="light-room-panel pv-kit pv-kit-card pv-card"
        data-kit="card"
        hidden={face.panelHidden}
        id="light-room-controls"
        aria-labelledby="light-room-panel-title"
      >
        <header
          className="pv-kit pv-kit-sectionheader pv-section-header"
          data-kit="sectionheader"
          data-kit-layout="stacked"
        >
          <span className="light-room-kicker" hidden={face.kickerHidden}>
            {face.kickerText}
          </span>
          <h2 className="light-room-panel-title" data-kit-text="headline" id="light-room-panel-title">
            {face.headingText}
          </h2>
          <span className="light-room-panel-status" hidden={face.statusHidden}>
            {face.statusText}
          </span>
        </header>
        <p className="" data-kit-text="body" hidden={face.emptyHidden}>
          {face.emptyText}
        </p>
        <button
          className="light-room-refresh"
          type="button"
          hidden={face.refreshHidden}
          disabled={face.refreshDisabled}
          onClick={event => {
            handlers.onRefresh(event.currentTarget);
          }}
        >
          Opdater lys
        </button>
      </section>
    </>
  );
}
