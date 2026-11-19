// Robot: the robot control panel inside pv-robot-control-panel. Same anatomy, classes, kit data attributes and aria
// as the pre-React robot-control-panel.js, so the stage stylesheet, the shell and the browser journeys apply
// unchanged. Every element the controller changes is drawn from its Face (screen.ts); RobotControlPanel.tsx owns what
// they show, every listener and every action. Native element state stays native and is written by the controller:
// which room and radio is checked, the selected floor, a typed number, the dialog's open state, focus, the exact
// style attribute and the hero's own pv-vacuum-widget anatomy.
import type {DetailedHTMLProps, HTMLAttributes, ReactNode} from 'react';
import type {ActionButton, Face, MapPart, Part, Rail, RobotScreen, RoomTile, Section} from './screen';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-vacuum-widget': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export type Bind = (id: string) => (node: Element | null) => void;

const ICON = '--24 pv-kit pv-kit-icon pv-icon';

// The attributes a face carries, plus its class and hidden flag.
const show = (target: Face, bind: Bind) => ({
  ref: bind(target.id),
  className: target.className || undefined,
  hidden: target.hidden,
  ...target.attrs,
});
const control = (target: Face, bind: Bind) => ({...show(target, bind), disabled: target.disabled});

function Icon({src, variant}: {src: string; variant?: string | undefined}) {
  return <img className={ICON} data-kit="icon" data-kit-variant={variant} src={src} alt="" width={24} height={24} />;
}

function LevelIcon({src}: {src: string}) {
  return <img className={ICON} data-kit="icon" src={src} alt="" aria-hidden="true" width={24} height={24} />;
}

function Action({button, bind}: {button: ActionButton; bind: Bind}) {
  const {face: target, icon, label} = button;
  return (
    <button {...control(target, bind)}>
      {icon.tag === 'img' ? (
        <Icon src={icon.src} variant={icon.variant} />
      ) : (
        <span
          ref={bind(`${target.id}-icon`)}
          className={ICON}
          data-kit="icon"
          data-kit-variant="mask"
          aria-hidden="true"
        />
      )}
      {label}
    </button>
  );
}

function RailView({rail, bind}: {rail: Rail; bind: Bind}) {
  const chip = (choice: Rail['choices'][number]) => (
    <label key={choice.chip.id} {...show(choice.chip, bind)}>
      <input {...control(choice.input, bind)} />
      <span>{choice.label}</span>
    </label>
  );
  return (
    <fieldset {...show(rail.node, bind)}>
      <legend data-kit-text="field-label">
        {rail.icon ? <LevelIcon src={rail.icon} /> : null}
        {rail.label}
      </legend>
      <div {...show(rail.track, bind)}>{rail.choices.filter(choice => !choice.additional).map(chip)}</div>
      {rail.additional ? (
        <div className="pv-kit-choice-additional">{rail.choices.filter(choice => choice.additional).map(chip)}</div>
      ) : null}
      {rail.note ? <p {...show(rail.note, bind)}>{rail.note.text}</p> : null}
    </fieldset>
  );
}

function Title({tag, target, icon, bind}: {tag: 'h3' | 'h4'; target: Face; icon: string | null; bind: Bind}) {
  const Tag = tag;
  return (
    <Tag {...show(target, bind)}>
      {icon ? <LevelIcon src={icon} /> : null}
      {target.text}
    </Tag>
  );
}

function PartView({part, bind}: {part: Part; bind: Bind}): ReactNode {
  switch (part.kind) {
    case 'rail':
      return <RailView rail={part.rail} bind={bind} />;
    case 'group': {
      const children = part.children.map(child => <PartView key={partKey(child)} part={child} bind={bind} />);
      return part.tag === 'div' ? (
        <div {...show(part.face, bind)}>{children}</div>
      ) : (
        <section {...show(part.face, bind)}>{children}</section>
      );
    }
    case 'note':
      return <p {...show(part.face, bind)}>{part.face.text}</p>;
    case 'readonly':
      return (
        <section {...show(part.face, bind)}>
          <Title tag="h4" target={part.title} icon={part.icon} bind={bind} />
          <p {...show(part.value, bind)}>{part.value.text}</p>
        </section>
      );
    case 'repeat-row':
      return (
        <section {...show(part.face, bind)}>
          <Title tag="h3" target={part.title} icon="assets/icons/arrow-refresh.svg" bind={bind} />
          <p {...show(part.value, bind)}>{part.value.text}</p>
        </section>
      );
    case 'wrapper': {
      const children = (
        <>
          <RailView rail={part.rail} bind={bind} />
          {part.submit ? <button {...control(part.submit, bind)}>{part.submit.text}</button> : null}
        </>
      );
      return part.tag === 'form' ? (
        <form {...show(part.face, bind)}>{children}</form>
      ) : (
        <fieldset {...show(part.face, bind)}>{children}</fieldset>
      );
    }
    case 'toggle':
      return (
        <form {...show(part.face, bind)}>
          <h4 {...show(part.title, bind)}>{part.title.text}</h4>
          <button {...control(part.toggle, bind)}>{part.toggle.text}</button>
        </form>
      );
    case 'field':
      return (
        <form {...show(part.face, bind)}>
          <h4 {...show(part.title, bind)}>{part.title.text}</h4>
          <input {...control(part.input, bind)} required />
          <button {...control(part.submit, bind)}>{part.submit.text}</button>
        </form>
      );
  }
}

const partKey = (part: Part): string => (part.kind === 'rail' ? part.rail.node.id : part.face.id);

function MapView({map, bind}: {map: MapPart; bind: Bind}) {
  if (!map) return null;
  if (map.kind === 'meta') return <p {...show(map.face, bind)}>{map.face.text}</p>;
  return (
    <select {...control(map.face, bind)}>
      <option {...control(map.placeholder, bind)}>{map.placeholder.text}</option>
      {map.options.map(option => (
        <option key={option.id} {...control(option, bind)}>
          {option.text}
        </option>
      ))}
    </select>
  );
}

function Tile({tile, tag, bind}: {tile: RoomTile; tag: 'button' | 'li'; bind: Bind}) {
  const children = (
    <>
      <img className="robot-room-icon" src={tile.icon} alt="" width={32} height={32} draggable={false} />
      <span className="robot-room-label" data-kit-text="field-label">
        {tile.label}
      </span>
    </>
  );
  return tag === 'button' ? (
    <button {...control(tile.face, bind)}>{children}</button>
  ) : (
    <li {...show(tile.face, bind)}>{children}</li>
  );
}

const SECTION_HEADER = 'pv-section-header pv-kit pv-kit-sectionheader';

function SectionTitle({text}: {text: string}) {
  return (
    <h2 className={SECTION_HEADER} data-kit-text="section-title" data-kit="sectionheader">
      {text}
    </h2>
  );
}

function SectionView({section, screen, bind}: {section: Section; screen: RobotScreen; bind: Bind}): ReactNode {
  switch (section.kind) {
    case 'cleaning':
      return (
        <form {...show(section.form, bind)}>
          <section {...show(section.zone, bind)}>
            <div className="heading robot-room-heading">
              <div className="robot-room-context">
                <SectionTitle text="Rum" />
                <MapView map={section.map} bind={bind} />
              </div>
              <button {...control(section.all, bind)}>
                {section.allContent ? (
                  <>
                    <span ref={bind(`${section.all.id}-icon`)} className={ICON} data-kit="icon" aria-hidden="true" />
                    <span data-kit-slot="label">{section.allContent.label}</span>
                  </>
                ) : null}
              </button>
            </div>
            <fieldset {...show(section.choices, bind)}>
              <legend className="robot-room-legend" data-kit-text="field-label">
                Vælg rum
              </legend>
              {section.rooms.map(room => (
                <Tile key={room.face.id} tile={room} tag="button" bind={bind} />
              ))}
            </fieldset>
          </section>
          <section {...show(section.card, bind)}>
            <SectionTitle text="Rengøringsvalg" />
            {section.recipe !== null ? (
              <section
                className="robot-recipe-summary pv-kit pv-kit-listrow pv-row"
                data-kit="listrow"
                data-kit-variant="read-only"
                data-kit-identity="robot"
                aria-label="Valgt opskrift til denne start"
              >
                <p className="pv-meta" data-kit-text="meta">
                  {section.recipe}
                </p>
              </section>
            ) : null}
            <PartView part={section.options} bind={bind} />
            <p {...show(section.summary, bind)}>{section.summary.text}</p>
          </section>
        </form>
      );
    case 'empty-rooms':
      return (
        <section {...show(section.zone, bind)}>
          <div className="heading robot-room-heading">
            <div className="robot-room-context">
              <SectionTitle text="Rum" />
              <MapView map={section.map} bind={bind} />
            </div>
          </div>
          <p className="pv-meta empty" data-kit-text="meta">
            Ingen rum at vælge på denne etage.
          </p>
        </section>
      );
    case 'settings-zone':
      return (
        <section {...show(section.face, bind)}>
          <SectionTitle text="Rengøringsvalg" />
          <PartView part={section.controls} bind={bind} />
        </section>
      );
    case 'current-rooms':
      return (
        <section {...show(section.card, bind)}>
          <header
            className="robot-current-heading pv-kit pv-kit-sectionheader pv-section-header"
            data-kit="sectionheader"
            data-kit-layout="stacked"
          >
            <h2 className="pv-section-header" data-kit-text="section-title">
              Denne tur
            </h2>
            <MapView map={section.map} bind={bind} />
          </header>
          <ul {...show(section.list, bind)}>
            {section.rooms.map(room => (
              <Tile key={room.face.id} tile={room} tag="li" bind={bind} />
            ))}
          </ul>
          <p {...show(section.unknown, bind)}>{section.unknown.text}</p>
        </section>
      );
    case 'current-settings':
      return (
        <section {...show(section.face, bind)}>
          <SectionTitle text="Rengøringsvalg" />
          <PartView part={section.controls} bind={bind} />
        </section>
      );
    case 'reuse': {
      const button = screen.actions[section.button];
      return (
        <section className="device-history">
          <h3 data-kit-text="section-title">Gentag den valgte rengøring</h3>
          <p className="pv-meta history-note" data-kit-text="meta">
            Dit tidligere rumvalg
          </p>
          {button ? <Action button={button} bind={bind} /> : null}
        </section>
      );
    }
    case 'availability':
      return <p {...show(section.face, bind)}>{section.face.text}</p>;
  }
}

function Transport({screen, bind}: {screen: RobotScreen; bind: Bind}) {
  const {hero, submit, base} = screen;
  if (!hero) return null;
  return hero.transport.map(item => {
    if (item.kind === 'submit') {
      if (!submit) return null;
      return (
        <button key={submit.face.id} {...control(submit.face, bind)}>
          <Icon src={submit.icon} />
          <span>{submit.label}</span>
        </button>
      );
    }
    if (item.kind === 'base') {
      if (!base) return null;
      return (
        <section key={base.node.id} {...show(base.node, bind)}>
          <button {...control(base.trigger, bind)}>
            <img
              className="pv-kit pv-kit-icon pv-icon"
              data-kit="icon"
              src="assets/icons/house.svg"
              alt=""
              data-kit-slot="leading-icon"
            />
            <span data-kit-slot="copy">
              <strong data-kit-text="group-title" data-kit-slot="title">
                Mere
              </strong>
              <small {...show(base.description, bind)} />
            </span>
          </button>
          <div {...show(base.panel, bind)}>
            <div className="pv-actions">
              {base.items.map(key => {
                const button = screen.actions[key];
                return button ? <Action key={button.face.id} button={button} bind={bind} /> : null;
              })}
            </div>
          </div>
        </section>
      );
    }
    const button = screen.actions[item.key];
    return button ? <Action key={button.face.id} button={button} bind={bind} /> : null;
  });
}

function Dialog({screen, bind}: {screen: RobotScreen; bind: Bind}) {
  const dialog = screen.dialog;
  if (!dialog) return null;
  const confirm = dialog.confirm;
  return (
    <dialog {...show(dialog.face, bind)}>
      {confirm ? (
        <>
          <header key={`${confirm.key}-header`} className="pv-dialog-header">
            <h2 id={confirm.titleId} data-kit-text="headline">
              {confirm.title}
            </h2>
          </header>
          <p
            key={`${confirm.key}-copy`}
            className="pv-meta pv-dialog-description"
            id={`${confirm.titleId}-description`}
            data-kit-text="body"
          >
            {confirm.copy}
          </p>
          <div key={`${confirm.key}-actions`} className="pv-actions pv-dialog-actions">
            <button {...control(confirm.cancel, bind)}>{confirm.cancel.text}</button>
            <button {...control(confirm.accept, bind)}>
              <Icon src={confirm.acceptIcon} />
              {confirm.acceptLabel}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

export function RobotPanel({screen, bind}: {screen: RobotScreen; bind: Bind}) {
  const {hero, sticky} = screen;
  if (!hero) return null;
  const observation = (
    <pv-vacuum-widget key={hero.observation.id} {...show(hero.observation, bind)}>
      <p {...show(hero.eyebrow, bind)}>{hero.eyebrow.text}</p>
      <div {...show(hero.progress, bind)}>
        <p {...show(hero.progressLabel, bind)}>{hero.progressLabel.text}</p>
        <progress ref={bind(`${hero.progress.id}-meter`)} max={100} aria-label="Rengøringens fremdrift" />
      </div>
      <div className="pv-actions transport" ref={bind(`${hero.observation.id}-transport`)}>
        <Transport screen={screen} bind={bind} />
      </div>
      <p {...show(hero.settingsContext, bind)}>{hero.settingsContext.text}</p>
    </pv-vacuum-widget>
  );
  const dialog = <Dialog key={screen.dialog?.face.id ?? 'dialog'} screen={screen} bind={bind} />;
  return (
    <>
      {screen.dialogFirst ? [dialog, observation] : [observation, dialog]}
      {screen.sections.map(section => (
        <SectionView key={sectionKey(section)} section={section} screen={screen} bind={bind} />
      ))}
      {sticky ? (
        <div key={sticky.line.id} {...show(sticky.line, bind)}>
          <span className="robot-sticky-dot" />
          <span className="robot-sticky-copy">
            <span {...show(sticky.title, bind)} />
            <span {...show(sticky.sub, bind)} />
          </span>
          <span {...show(sticky.primary, bind)} />
          <span {...show(sticky.more, bind)} />
        </div>
      ) : null}
    </>
  );
}

const sectionKey = (section: Section): string => {
  switch (section.kind) {
    case 'cleaning':
      return section.form.id;
    case 'empty-rooms':
      return section.zone.id;
    case 'current-rooms':
      return section.card.id;
    case 'reuse':
      return section.button;
    default:
      return section.face.id;
  }
};
