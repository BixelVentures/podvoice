// Lys: the light page inside section.light-room-view (and, live, »Opdater lys« under it), drawn with exactly the
// elements, classes, kit data attributes and aria the pre-React views built (light-room-view.js, light-lamp-view.js
// and the shell's scene section, status line and »Lamper« disclosure), so the stage stylesheet and the browser
// journeys apply unchanged. The rooms are cards (»A-Lys«): the card chooses the room, the switch bottom right is the
// room's power. The panel groups the room's status line, its scenes with the shared level and its lamps.
// The shell mounts it once (mountLight) and only shows or hides the section; everything inside is drawn from the
// shell's published facts (host.ts), the area reads (area.ts) and the live commands (commands.ts).
import {useEffect, useRef, useState} from 'react';
import {mountScreen} from '../../app/mount';
import {KitButton} from '../../lib/ui/KitButton';
import {revealKitItem} from '../../../ui/kit.js';
import {commitSceneLevel, homePower, reloadHome, roomPower, selectRoom, selectScene} from './actions';
import {refreshLightArea, useLightArea} from './area';
import {useLightCommands} from './commands';
import {useLightScene} from './host';
import {LampList} from './LampList';
import {LightSlider} from './LightSlider';
import {lightPage, refreshModel} from './model';
import type {LightPage, RoomFace, SceneLevelBinding, ScenesModel} from './model';

const bool = (value: boolean) => String(value) as 'true' | 'false';

function useLightInputs() {
  const facts = useLightScene(state => state.scene);
  const area = useLightArea();
  const entries = useLightCommands(state => state.entries);
  return {facts, area, entries};
}

function RoomRow({room, deviceId, onNode}: {room: RoomFace; deviceId: string; onNode: (node: HTMLElement | null) =>
  void}) {
  const {id} = room;
  return (
    <div className="light-room-row" data-selected={bool(room.selected)} data-power-on={bool(room.powerOn)}
      ref={onNode}>
      <KitButton
        className="light-room-select"
        aria-pressed={bool(room.selected)}
        aria-label={`Vis ${room.name}`}
        onPress={() => {
          selectRoom(id, deviceId);
        }}
      >
        <span className="light-room-copy">
          <span className="light-room-tag">{room.tag}</span>
          <strong className="light-room-name" data-kit-text="group-title">
            {room.name}
          </strong>
          <span className="light-room-status" data-kit-text="body">
            {room.status}
          </span>
        </span>
      </KitButton>
      <KitButton
        className="light-room-power pv-kit pv-kit-tile pv-tile"
        data-kit="tile"
        data-kit-identity="light"
        data-kit-variant="power"
        data-pv-press="quiet"
        data-feedback="progress"
        aria-busy={bool(room.busy)}
        data-power-on={bool(room.powerOn)}
        aria-pressed={room.pressed === null ? undefined : bool(room.pressed)}
        aria-label={room.powerLabel}
        aria-disabled={bool(!room.enabled)}
        isDisabled={!room.enabled}
        onPress={() => {
          roomPower(id, deviceId);
        }}
      >
        <img
          className="light-room-icon pv-kit pv-kit-icon pv-icon"
          src="assets/icons/lightbulb.svg"
          alt=""
          data-kit="icon"
        />
      </KitButton>
    </div>
  );
}

// The room navigation: native radios on kit Chips (createKitChoiceGroup, variant navigation), drawn anew when the
// rooms change; the checked radio is the room the page shows.
function RoomNavigation({rooms, selected, deviceId}: {rooms: RoomFace[]; selected: string; deviceId: string}) {
  return (
    <fieldset className="pv-kit-choice-group" data-choice-variant="navigation">
      <legend data-kit-text="field-label">Rum</legend>
      <div className="pv-kit-choice-options">
        {rooms.map((room, index) => (
          <label key={room.id} className="pv-kit pv-kit-chip pv-chip pv-kit-choice-label" data-kit="chip">
            <input
              type="radio"
              name="light-room"
              value={room.id}
              id={`light-room-${String(index)}`}
              checked={room.id === selected}
              onChange={event => {
                if (event.currentTarget.checked) selectRoom(event.currentTarget.value, deviceId);
              }}
            />
            <span>{room.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function StatusLine({page}: {page: LightPage | null}) {
  const text = page?.status.text ?? '';
  const hidden = !text;
  return (
    <p
      className="pv-kit pv-kit-listrow pv-row"
      data-kit="listrow"
      data-kit-variant="feedback"
      role="status"
      aria-live="polite"
      data-kit-slot="status"
      data-state={page?.status.state ?? 'ready'}
      hidden={hidden}
      aria-hidden={bool(hidden)}
    >
      {text}
    </p>
  );
}

function Scenes({scenes, hidden}: {scenes: ScenesModel; hidden: boolean}) {
  const binding = scenes.binding;
  return (
    <section className="light-scenes" hidden={hidden}>
      <h3 data-kit-text="section-title">Scener</h3>
      <div className="light-scene-choices">
        {scenes.chips.map(chip => (
          <KitButton
            key={chip.id}
            className="pv-kit pv-kit-chip pv-chip"
            data-kit="chip"
            data-kit-identity="light"
            data-kit-variant="command"
            aria-pressed={bool(chip.selected)}
            data-feedback="progress"
            aria-busy={bool(chip.loading)}
            aria-disabled={bool(!scenes.enabled)}
            aria-description={chip.description}
            isDisabled={!scenes.enabled}
            onPress={() => {
              selectScene(chip);
            }}
          >
            <span className="light-scene-name">{chip.name}</span>
            <span className="light-scene-level" hidden={!chip.level}>
              {chip.level}
            </span>
          </KitButton>
        ))}
      </div>
      <LightSlider<null, SceneLevelBinding | null>
        id="light-scene-level"
        model={scenes.slider}
        session={null}
        keepDraft={() => true}
        context={() => (binding ? {...binding} : null)}
        valueTextOverride={scenes.ariaValueText}
        onCommit={(value, wish) => {
          commitSceneLevel(value, wish);
        }}
      />
    </section>
  );
}

function Lamps({page, hidden, expanded, onToggle}: {page: LightPage | null; hidden: boolean; expanded: boolean;
  onToggle: () => void}) {
  return (
    <section className="pv-kit-disclosure" hidden={hidden}>
      <KitButton
        className="pv-kit pv-kit-listrow pv-row"
        data-kit="listrow"
        id="light-lamps-trigger"
        aria-controls="light-lamps-panel"
        data-leading-icon="true"
        data-trailing-icon="true"
        aria-expanded={bool(expanded)}
        data-has-summary="false"
        onPress={onToggle}
      >
        <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src="assets/icons/lightbulb.svg" alt=""
          data-kit-slot="leading-icon" />
        <span data-kit-slot="copy">
          <strong data-kit-text="group-title" data-kit-slot="title">
            Lamper
          </strong>
          <small data-kit-text="meta" data-kit-slot="description" hidden aria-hidden="true" />
        </span>
        <span className="light-lamp-count">{page?.lampCount ?? ''}</span>
        <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src="assets/icons/chevron-down.svg" alt=""
          data-kit-slot="trailing-icon" />
      </KitButton>
      <div id="light-lamps-panel" aria-labelledby="light-lamps-trigger" role="region" hidden={!expanded}>
        <LampList lamps={page?.lamps ?? []} />
      </div>
    </section>
  );
}

export function LightScreen() {
  const page = lightPage(useLightInputs());
  const rows = useRef(new Map<string, HTMLElement>());
  const list = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [room, setRoom] = useState<string | undefined>(undefined);
  const selected = page?.selected;
  // A room with one or two lamps shows them at once; more stay folded until »Lamper« is tapped.
  if (selected && selected.id !== room) {
    setRoom(selected.id);
    if (Number.isInteger(selected.lamps)) setExpanded((selected.lamps ?? 0) <= 2);
  }
  // A newly selected room is revealed in its row (and in the navigation) without moving anything else.
  useEffect(() => {
    if (!room) return undefined;
    const reveal = () => {
      revealKitItem(rows.current.get(room), list.current);
      const checked = navigation.current?.querySelector('input:checked')?.parentElement;
      revealKitItem(checked, navigation.current?.querySelector('.pv-kit-choice-options'));
    };
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      reveal();
      return undefined;
    }
    const frame = globalThis.requestAnimationFrame(reveal);
    return () => {
      globalThis.cancelAnimationFrame(frame);
    };
  }, [room]);
  const empty = !page || page.empty;
  const deviceId = page?.deviceId ?? '';
  const signature = JSON.stringify(page?.rooms.map(row => [row.id, row.name]) ?? []);
  const toggle = () => {
    const collapsing = expanded;
    setExpanded(!expanded);
    const trigger = document.getElementById('light-lamps-trigger');
    if (collapsing && panel.current?.querySelector('#light-lamps-panel')?.contains(document.activeElement)) {
      trigger?.focus();
    }
  };
  return (
    <>
      <div className="light-room-list" hidden={empty} ref={list}>
        {page?.rooms.map(row => (
          <RoomRow key={row.id} room={row} deviceId={deviceId} onNode={node => {
            if (node) rows.current.set(row.id, node);
            else rows.current.delete(row.id);
          }} />
        ))}
      </div>
      {/* Lærred »Lys-Ukendt«: when the light status could not be read, one compact info line under the rooms. */}
      <p className="light-room-notice" role="status" hidden={!page || page.empty || !page.stale}>
        <i className="" aria-hidden="true">
          i
        </i>
        <span className="">Lysoplysninger kunne ikke hentes. Prøv igen.</span>
      </p>
      <div className="light-room-toolbar" hidden={empty}>
        <div className="light-room-navigation" ref={navigation}>
          {page && !page.empty && (
            <RoomNavigation key={signature} rooms={page.rooms} selected={selected?.id ?? ''} deviceId={deviceId} />
          )}
        </div>
        <KitButton
          className="light-home-power pv-kit pv-kit-button pv-btn"
          data-kit="button"
          data-kit-variant="secondary"
          hidden={!page || page.live}
          isDisabled={!page?.homeEnabled}
          aria-label={page && !page.empty ? page.homeTitle : undefined}
          title={page && !page.empty ? page.homeTitle : undefined}
          onPress={() => {
            homePower(page?.deviceId);
          }}
        >
          <img className="pv-kit pv-kit-icon pv-icon" src="assets/icons/house.svg" alt="" data-kit="icon" />
          <span className="">{page?.homeLabel ?? ''}</span>
        </KitButton>
      </div>
      <section
        className="light-room-panel pv-kit pv-kit-card pv-card"
        data-kit="card"
        hidden={!page}
        id="light-room-controls"
        aria-labelledby="light-room-panel-title"
        ref={panel}
      >
        <header
          className="pv-kit pv-kit-sectionheader pv-section-header"
          data-kit="sectionheader"
          data-kit-layout="stacked"
        >
          <span className="light-room-kicker" hidden={!page?.empty || !page.kickerText}>
            {page?.kickerText ?? ''}
          </span>
          <h2 className="light-room-panel-title" data-kit-text="headline" id="light-room-panel-title">
            {page?.headingText ?? ''}
          </h2>
          <span className="light-room-panel-status" hidden={!selected}>
            {page?.statusText ?? ''}
          </span>
          <StatusLine page={page} />
        </header>
        <p className="" data-kit-text="body" hidden={!page || !page.empty && page.scenes.visible}>
          {page?.emptyText ?? ''}
        </p>
        <KitButton
          className="light-room-refresh"
          hidden={!page?.empty}
          isDisabled={!!page?.refreshDisabled}
          onPress={reloadHome}
        >
          Opdater lys
        </KitButton>
        <Scenes scenes={page?.scenes ?? emptyScenes} hidden={!page || page.empty || !page.scenes.visible} />
        <Lamps page={page} hidden={!page || page.empty || !page.lamps.length} expanded={expanded}
          onToggle={toggle} />
      </section>
    </>
  );
}

const emptyScenes: ScenesModel = {visible: false, chips: [], enabled: false, binding: null, slider: {value: null},
  ariaValueText: null};

// The live »Opdater lys« under the page (renderLiveLightControl): read home again, then the shown area.
export function LightRefresh() {
  const inputs = useLightInputs();
  if (!inputs.facts.live) return null;
  const {hidden, disabled} = refreshModel(inputs);
  return (
    <KitButton
      className="light-control-refresh pv-kit pv-kit-button pv-btn"
      data-kit="button"
      data-kit-identity="light"
      data-kit-variant="secondary"
      data-kit-content="icon-label"
      hidden={hidden}
      isDisabled={disabled}
      onPress={() => {
        void refreshLightArea();
      }}
    >
      <span className="--24 pv-kit pv-kit-icon pv-icon" data-kit="icon" aria-hidden="true"
        style={{'--pv-icon-source': 'url("assets/icons/arrow-refresh.svg")'} as React.CSSProperties} />
      <span data-kit-slot="label">Opdater lys</span>
    </KitButton>
  );
}

// The shell mounts the page once into its section, and the live »Opdater lys« into the slot after it.
export function mountLight({room, refresh}: {room: Element; refresh?: Element | null}) {
  mountScreen(room, <LightScreen />);
  if (refresh) mountScreen(refresh, <LightRefresh />);
}
