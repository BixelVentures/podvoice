// Robot: the control panel's parts as React components that own their DOM, drawn from the panel's store
// (panel-store.ts) with what each part shows from present.ts. Same anatomy, classes, kit data attributes, aria and
// text as the pre-React robot-control-panel.js, so the stage stylesheet, the hosts and the browser journeys apply
// unchanged: the hero (the robot instrument, its transport row with Start and »Mere«), the confirmation, the start
// form (rooms, type, levels, repeat), the daily settings, the running job's card and the iPad sticky line.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, DetailedHTMLProps, HTMLAttributes, ReactNode, SyntheticEvent} from 'react';
import {useStore} from 'zustand';
import {KitButton} from '../../lib/ui/KitButton';
import type {CleaningDef, ControlsDef, MapDef, RailDef, SettingDef, StartSettingDef} from './layout';
import {activeJob, choiceLabel, cleaningMode, irrelevantSetting, roomIcon, settingConcept, settingLabel} from './model';
import type {RobotOption} from './model';
import {cleaningOf, productHidden, selectedSetting, specialCurrent, startBlocked, startRow} from './panel-store';
import type {Actions, PanelState, Store} from './panel-store';
import {
  access,
  availabilityText,
  control,
  currentAreas,
  currentMapName,
  currentRoomText,
  dailyMode,
  heroView,
  repeatStatusText,
} from './present';
import type {Access, Control} from './present';
import {settingCurrent} from './value';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-vacuum-widget': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {class?: string};
    }
  }
}

interface Ctx {
  state: PanelState;
  actions: Actions;
  rules: Access;
}

const ICON = '--24 pv-kit pv-kit-icon pv-icon';
const KIT_BUTTON = 'pv-kit pv-kit-button pv-btn';
const SECTION_HEADER = 'pv-section-header pv-kit pv-kit-sectionheader';
const CARD = 'pv-kit pv-kit-card pv-card';
const LISTROW = 'pv-kit pv-kit-listrow pv-row';
const yes = (value: boolean): 'true' | 'false' => (value ? 'true' : 'false');
const activeJobOf = (state: PanelState) => activeJob(state.value?.device);

function Icon({src, variant, decorative}: {src: string; variant?: string | undefined; decorative?: true}) {
  return (
    <img
      className={ICON}
      data-kit="icon"
      data-kit-variant={variant}
      src={src}
      alt=""
      aria-hidden={decorative ? 'true' : undefined}
      width={24}
      height={24}
    />
  );
}

// A kit icon drawn as a mask (the »Afslut« cross and »Vælg alle«'s check).
function MaskIcon({src, mask}: {src: string; mask?: true}) {
  return (
    <span
      className={ICON}
      data-kit="icon"
      data-kit-variant={mask ? 'mask' : undefined}
      aria-hidden="true"
      style={{'--pv-icon-source': `url("${src}")`} as CSSProperties}
    />
  );
}

// ----- the hero -----

// The robot instrument (the library's vacuum-widget anatomy, drawn here; data-kit-owner keeps the library element
// from building its own), the eyebrow over the title (lærred »A-Robot«), the progress, the transport row and the one
// feedback line.
function Hero({ctx, onNode, children}: {ctx: Ctx; onNode: (node: HTMLElement | null) => void; children: ReactNode}) {
  const view = heroView(ctx.state);
  return (
    <pv-vacuum-widget
      ref={onNode}
      class="pv-hero pv-kit pv-kit-hero pv-component"
      data-kit-owner="react"
      data-component="vacuum-widget"
      data-kit="hero"
      data-kit-identity="robot"
      data-detail-zone="hero"
      data-kit-tone="tinted"
      data-kit-density="compact"
      data-kit-state={view.kitState}
      data-kit-variant={view.kitVariant ?? undefined}
      data-state={view.state}
      data-resource-status={view.resourceStatus}
      data-resource-value-kind="status"
      data-setup-pending={yes(view.setupPending)}
      aria-busy={yes(view.state === 'pending')}
    >
      <p className="robot-hero-eyebrow" data-kit-text="body">
        {view.eyebrow}
      </p>
      <p className="pv-state-note" role="status" hidden />
      <div className="pv-content" data-kit-slot="copy">
        <div className="pv-instrument" aria-hidden="true" data-kit-slot="icon">
          <img src="assets/icons/vacuum.svg" alt="" />
        </div>
        <img className="pv-resource-art" alt="" hidden />
        <h3 hidden={view.titleHidden}>{view.title}</h3>
        <p className="pv-meta" data-kit-slot="body">
          {view.meta}
        </p>
        <p className="pv-resource-value" data-kit-slot="title">
          {view.text}
        </p>
        <div className="pv-actions" />
      </div>
      <Progress percent={view.progress} />
      <div className="pv-actions transport">{children}</div>
      <p
        className="pv-meta robot-settings-context"
        data-kit-text="meta"
        role="status"
        data-feedback-state={view.feedback.state}
      >
        {view.feedback.text}
      </p>
    </pv-vacuum-widget>
  );
}

function Progress({percent}: {percent: number | null}) {
  const meter = useRef<HTMLProgressElement>(null);
  // A hidden progress keeps its last label and value.
  const [label, setLabel] = useState('');
  const text = percent === null ? label : `${percent.toLocaleString('da-DK', {maximumFractionDigits: 1})} % færdig`;
  if (text !== label) setLabel(text);
  // The meter keeps the last known value while hidden (its value is the element's own state, as before).
  useLayoutEffect(() => {
    if (meter.current && percent !== null && meter.current.value !== percent) meter.current.value = percent;
  }, [percent]);
  return (
    <div className="player-progress" hidden={percent === null}>
      <p className="pv-meta" data-kit-text="meta">
        {text}
      </p>
      <progress ref={meter} max={100} aria-label="Rengøringens fremdrift" />
    </div>
  );
}

// The current primary command (Pause while cleaning, Fortsæt while paused, else Start).
function primaryOf(state: PanelState): string | null {
  const {layout, value} = state;
  if (!layout) return null;
  const status = value?.device?.status,
    wanted = status === 'cleaning' ? 'pause' : status === 'paused' ? 'resume' : null;
  const commands = layout.transport.filter(item => item.kind !== 'base');
  const found =
    commands.find(item => item.kind === 'action' && layout.actions[item.key]?.option.action === wanted) ??
    commands.find(item => item.kind === 'submit');
  return found ? (found.kind === 'action' ? found.key : 'submit') : null;
}

function Transport({ctx}: {ctx: Ctx}) {
  const layout = ctx.state.layout;
  if (!layout) return null;
  const primary = primaryOf(ctx.state);
  return layout.transport.map(item => {
    if (item.kind === 'submit') return <StartButton key="submit" ctx={ctx} primary={primary === 'submit'} />;
    if (item.kind === 'base') return <Base key={`base-${layout.base?.id ?? ''}`} ctx={ctx} />;
    return <ActionButton key={item.key} ctx={ctx} name={item.key} row={primary === item.key ? 'primary' : 'row'} />;
  });
}

// A command of the offer: in the transport row, in »Mere« (base) or the reuse section's Start (reuse).
function ActionButton({ctx, name, row}: {ctx: Ctx; name: string; row: 'primary' | 'row' | 'base' | 'reuse'}) {
  const action = ctx.state.layout?.actions[name];
  if (!action) return null;
  const option = action.option,
    direct = option.direct === true,
    actionId = action.attrs['data-action-id'],
    inRow = row === 'primary' || row === 'row';
  const view = control(ctx.state, ctx.rules, {
    optionId: action.attrs['data-control-option-id'],
    actionId,
    direct,
    command: !direct,
  });
  const context = ['pause', 'resume'].includes(actionId ?? '');
  const own = action.className.split(/\s+/);
  const classes = [...own.filter(token => !inRow || token !== 'pv-primary'), ...KIT_BUTTON.split(' ')];
  if (row === 'primary') classes.push('pv-primary');
  const variant = inRow
    ? actionId === 'stop'
      ? 'destructive'
      : row === 'primary' && !context
        ? 'primary'
        : 'secondary'
    : direct
      ? actionId === 'stop'
        ? 'destructive'
        : 'secondary'
      : own.includes('pv-primary')
        ? 'primary'
        : 'secondary';
  // Afslut and Kør til basen ask first; every other command is one tap, one send.
  const press = () => {
    if (row !== 'reuse' && ['stop', 'return'].includes(option.action)) ctx.actions.confirm(option);
    else ctx.actions.act(option);
  };
  return (
    <KitButton
      className={classes.join(' ')}
      {...action.attrs}
      type="button"
      data-kit="button"
      data-kit-identity="robot"
      data-kit-variant={variant}
      data-kit-action-role={inRow && context ? 'context' : undefined}
      data-feedback="progress"
      aria-busy={yes(view.busy)}
      isDisabled={view.disabled}
      onPress={press}
    >
      {action.icon.tag === 'img' ? (
        <Icon src={action.icon.src} variant={action.icon.variant} />
      ) : (
        <MaskIcon src={action.icon.src} mask />
      )}
      {action.label}
    </KitButton>
  );
}

function startLabel(state: PanelState, cleaning: CleaningDef): {label: string; icon: string; needsRooms: boolean} {
  const rooms = cleaning.areas.filter(area => state.draft.rooms.includes(area.id)),
    first = rooms[0];
  return {
    label:
      rooms.length === 1 && first
        ? `Start i ${first.label}`
        : rooms.length
          ? `Start · ${String(rooms.length)} rum`
          : 'Vælg rum',
    icon: rooms.length ? 'assets/icons/play-fill.svg' : 'assets/icons/check2.svg',
    // Without a chosen room Start stays live and leads to the room picker; nothing starts without rooms (S12).
    needsRooms: !rooms.length,
  };
}

const startUnready = (state: PanelState): boolean =>
  !!state.draft.rooms.length && (state.draft.repeat === null || startBlocked(state));

// Start sits in the hero and submits the start form below it.
function StartButton({ctx, primary}: {ctx: Ctx; primary: boolean}) {
  const cleaning = cleaningOf(ctx.state.layout);
  if (!cleaning) return null;
  const {label, icon, needsRooms} = startLabel(ctx.state, cleaning),
    unready = startUnready(ctx.state);
  const view = control(ctx.state, ctx.rules, {optionId: cleaning.option.id, draft: true, unready, command: true});
  return (
    <KitButton
      className={`pv-button start ${KIT_BUTTON}${primary ? ' pv-primary' : ''}`}
      type="submit"
      form={cleaning.formId}
      data-kit="button"
      data-kit-identity="robot"
      data-kit-variant={primary ? 'primary' : 'secondary'}
      data-kit-shape="pill"
      data-control-option-id={cleaning.option.id}
      data-unready={yes(unready)}
      data-needs-rooms={yes(needsRooms)}
      data-feedback="progress"
      aria-busy={yes(view.busy)}
      hidden={activeJobOf(ctx.state)}
      isDisabled={view.disabled}
    >
      <Icon src={icon} />
      <span>{label}</span>
    </KitButton>
  );
}

// »Mere« is a local disclosure; its commands still follow the current offer. It closes while the robot cannot be
// commanded, unless a direct Kør til basen inside it is live.
function baseDisabled(ctx: Ctx): boolean {
  const value = ctx.state.value ?? {},
    layout = ctx.state.layout;
  const blocked =
    value.connected === false || ctx.rules.knownPending || !!value.device?.stale || value.readOnly === true;
  if (!blocked) return false;
  const home = layout?.base?.items
    .map(key => layout.actions[key])
    .find(action => action?.option.direct && action.option.action === 'return');
  return !home || control(ctx.state, ctx.rules, {actionId: 'return', direct: true}).disabled;
}

function Base({ctx}: {ctx: Ctx}) {
  const base = ctx.state.layout?.base;
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const disabled = baseDisabled(ctx),
    expanded = ctx.state.baseOpen && !disabled;
  const was = useRef(expanded);
  useLayoutEffect(() => {
    // Closing while focus is inside the panel hands focus back to the trigger.
    if (was.current && !expanded && panel.current?.contains(document.activeElement)) trigger.current?.focus();
    was.current = expanded;
  }, [expanded]);
  const focus = ctx.state.focus,
    {focused} = ctx.actions;
  useEffect(() => {
    if (focus?.target !== 'base') return;
    focused();
    if (trigger.current && !trigger.current.disabled) trigger.current.focus({preventScroll: true});
  }, [focus, focused]);
  if (!base) return null;
  return (
    <section className="pv-kit-disclosure robot-dock-actions" data-kit-layout="header-more">
      <KitButton
        ref={trigger}
        className={LISTROW}
        data-kit="listrow"
        id={`${base.id}-trigger`}
        aria-controls={`${base.id}-panel`}
        aria-expanded={yes(expanded)}
        aria-disabled={yes(disabled)}
        data-leading-icon="true"
        data-kit-shape="pill"
        data-has-summary="false"
        isDisabled={disabled}
        onPress={() => {
          if (!disabled) ctx.actions.toggleBase();
        }}
      >
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
          <small data-kit-text="meta" data-kit-slot="description" hidden aria-hidden="true" />
        </span>
      </KitButton>
      <div ref={panel} id={`${base.id}-panel`} aria-labelledby={`${base.id}-trigger`} role="region" hidden={!expanded}>
        <div className="pv-actions">
          {base.items.map(key => (
            <ActionButton key={key} ctx={ctx} name={key} row="base" />
          ))}
        </div>
      </div>
    </section>
  );
}

// ----- the confirmation (Afslut / Kør til basen) -----

function Confirmation({ctx}: {ctx: Ctx}) {
  const dialog = ctx.state.dialog,
    node = useRef<HTMLDialogElement>(null),
    opener = useRef<Element | null>(null),
    cancel = useRef<HTMLButtonElement>(null);
  const {focused} = ctx.actions,
    focus = ctx.state.focus;
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    if (dialog.open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
    } else if (!dialog.open && element.open) element.close();
  }, [dialog.open]);
  useLayoutEffect(() => {
    if (focus?.target !== 'cancel') return;
    focused();
    cancel.current?.focus();
  }, [focus, focused]);
  const confirm = dialog.confirm,
    option = confirm?.option;
  const onClose = () => {
    const element = node.current;
    // A presentation close (the shell suspends dialogs while it shows something else) keeps the confirmation.
    if (element?.dataset.presentationClose === 'true') {
      delete element.dataset.presentationClose;
      return;
    }
    ctx.actions.dialogClosed();
    // Focus returns to the button that opened it; after a same-scope rebuild, to its successor.
    let target = opener.current;
    if (!target?.isConnected && dialog.direct)
      target =
        element?.parentElement?.querySelector(
          `.transport [data-direct-robot=true][data-action-id=${dialog.direct}]`,
        ) ?? null;
    if (target?.isConnected) (target as HTMLElement).focus();
    opener.current = null;
  };
  const back = option?.action === 'return';
  const accept = option
    ? control(ctx.state, ctx.rules, {
        optionId: option.id,
        actionId: option.direct ? option.action : undefined,
        direct: option.direct,
        command: !option.direct,
      })
    : null;
  const keep = control(ctx.state, ctx.rules, {localDraft: true});
  const acceptVariant = option?.direct ? (option.action === 'stop' ? 'destructive' : 'secondary') : 'primary';
  return (
    <dialog
      ref={node}
      className={confirm ? 'robot-action-confirm pv-kit pv-kit-dialog pv-dialog' : 'robot-action-confirm'}
      data-kit={confirm ? 'dialog' : undefined}
      data-kit-variant={confirm ? 'default' : undefined}
      data-direct-action={dialog.direct ?? undefined}
      aria-labelledby={confirm?.titleId}
      aria-describedby={confirm ? `${confirm.titleId}-description` : undefined}
      onClose={onClose}
      onCancel={event => {
        event.preventDefault();
        node.current?.close();
      }}
    >
      {confirm && option ? (
        <>
          <header key={`${confirm.titleId}-header`} className="pv-dialog-header">
            <h2 id={confirm.titleId} data-kit-text="headline">
              {back ? 'Kør til basen?' : 'Afslut rengøringen?'}
            </h2>
          </header>
          <p
            key={`${confirm.titleId}-copy`}
            className="pv-meta pv-dialog-description"
            id={`${confirm.titleId}-description`}
            data-kit-text="body"
          >
            {back
              ? 'Robotten sendes til basen.'
              : 'Rengøringen afsluttes. Robotten sendes ikke til basen. Brug Pause, hvis du vil fortsætte senere.'}
          </p>
          <div key={`${confirm.titleId}-actions`} className="pv-actions pv-dialog-actions">
            <KitButton
              ref={cancel}
              className={`pv-button ${KIT_BUTTON}`}
              type="button"
              data-kit="button"
              data-kit-identity="robot"
              data-kit-variant="secondary"
              data-local-draft="true"
              aria-busy="false"
              isDisabled={keep.disabled}
              onPress={() => {
                ctx.actions.closeDialog();
              }}
            >
              Behold turen
            </KitButton>
            <KitButton
              className={`pv-button pv-primary ${KIT_BUTTON}`}
              type="button"
              data-kit="button"
              data-kit-identity="robot"
              data-kit-variant={acceptVariant}
              data-tone={option.action === 'stop' ? 'danger' : undefined}
              data-control-option-id={option.id}
              data-direct-robot={option.direct ? 'true' : undefined}
              data-action-id={option.direct ? option.action : undefined}
              data-feedback="progress"
              aria-busy={yes(!!accept?.busy)}
              isDisabled={!!accept?.disabled}
              onPress={() => {
                if (!accept?.disabled) ctx.actions.acceptConfirm();
              }}
            >
              <Icon src={`assets/icons/${back ? 'arrow-u-down-left' : 'x-lg'}.svg`} />
              {back ? 'Kør til basen' : 'Afslut rengøring'}
            </KitButton>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

// ----- rails: level choices on kit chips (native radios) -----

interface RailProps {
  ctx: Ctx;
  rail: RailDef;
  value: string | null;
  // The chips the product hides for the chosen type, and the »Aktuel indstilling« text (null: none).
  hiddenChoices?: Set<string>;
  special?: string | null;
  hidden?: boolean;
  extraAttrs?: Record<string, string>;
  inputControl: (value: string) => Control;
  onChoose: (value: string) => void;
}

function Rail({ctx, rail, value, hiddenChoices, special, hidden, extraAttrs, inputControl, onChoose}: RailProps) {
  // The note appears once a special current needed it and then stays (hidden when not needed), as before.
  const noted = ctx.state.noted.includes(rail.id);
  const count = rail.choices.filter(choice => !hiddenChoices?.has(choice.value)).length;
  const views = rail.choices.map(choice => control(ctx.state, ctx.rules, inputControl(choice.value)));
  return (
    <fieldset
      className={['pv-kit-choice-group', ...rail.classes].join(' ')}
      data-choice-variant="level"
      {...rail.attrs}
      {...extraAttrs}
      aria-busy={yes(views.some(view => view.busy))}
      hidden={hidden}
    >
      <legend data-kit-text="field-label">
        {rail.icon ? <Icon src={rail.icon} decorative /> : null}
        {rail.label}
      </legend>
      <div
        className="pv-kit-choice-options"
        data-choice-count={String(count)}
        hidden={rail.choices.length === 0}
        style={count ? ({'--pv-choice-columns': String(count)} as CSSProperties) : undefined}
      >
        {rail.choices.map((choice, index) => {
          const view = views[index];
          return (
            <label
              key={choice.value}
              className="pv-kit pv-kit-chip pv-chip pv-kit-choice-label"
              data-kit="chip"
              hidden={!!hiddenChoices?.has(choice.value)}
            >
              <input
                type="radio"
                name={rail.name}
                value={choice.value}
                id={`${rail.id}-${String(index)}`}
                {...rail.inputAttrs}
                data-unready={rail.readOnly ? 'true' : undefined}
                aria-busy={yes(!!view?.busy)}
                checked={choice.value === value}
                disabled={!!view?.disabled}
                onChange={event => {
                  if (event.currentTarget.checked) onChoose(choice.value);
                }}
              />
              <span>{choice.label}</span>
            </label>
          );
        })}
      </div>
      {noted || special ? (
        <p className="pv-meta" data-kit-text="meta" data-special-selection="true" role="status" hidden={!special}>
          {special ? `Aktuel indstilling: ${special}. Kan ikke vælges her; vælg et andet niveau.` : ''}
        </p>
      ) : null}
    </fieldset>
  );
}

// The level rails' type-dependent attributes: the chosen type on suction and water, and the route rail's width
// (wide only while mopping with four visible routes).
function levelAttrs(rail: RailDef, concept: string, hidden: Set<string>, mode: string | null): RailDef {
  const attrs = {...rail.attrs};
  if (['suction', 'water'].includes(concept)) attrs['data-robot-mode'] = mode || '';
  if (concept === 'mop_mode') {
    if (mode === 'mop' && rail.choices.filter(choice => !hidden.has(choice.value)).length >= 4)
      delete attrs['data-kit-size'];
    else attrs['data-kit-size'] = 'compact';
  }
  return {...rail, attrs};
}

// ----- the start form -----

function startMode(state: PanelState): string | null {
  const row = cleaningOf(state.layout)?.settings.find(item => item.concept === 'mode');
  if (!row) return null;
  return cleaningMode(row.setting.choices.find(choice => choice.id === selectedSetting(state, row))?.label);
}

function StartSetting({ctx, row}: {ctx: Ctx; row: StartSettingDef}) {
  const view = startRow(ctx.state, row);
  return (
    <Rail
      ctx={ctx}
      rail={levelAttrs(row.rail, row.concept, view.hiddenChoices, startMode(ctx.state))}
      value={selectedSetting(ctx.state, row)}
      hiddenChoices={view.hiddenChoices}
      special={view.special}
      hidden={view.hidden}
      inputControl={value => ({radio: value, draft: true})}
      onChoose={value => {
        ctx.actions.chooseStart(row, value);
      }}
    />
  );
}

function RoomTiles({ctx, cleaning}: {ctx: Ctx; cleaning: CleaningDef}) {
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const focus = ctx.state.focus,
    {focused} = ctx.actions;
  // Start without a room leads to the room picker.
  useEffect(() => {
    if (focus?.target !== 'rooms') return;
    focused();
    (fieldset.current as Partial<HTMLElement> | null)?.scrollIntoView?.({block: 'center', behavior: 'smooth'});
    fieldset.current?.querySelector('button')?.focus({preventScroll: true});
  }, [focus, focused]);
  const view = control(ctx.state, ctx.rules, {draft: true});
  return (
    <fieldset ref={fieldset} className="choices pv-tiles">
      <legend className="robot-room-legend" data-kit-text="field-label">
        Vælg rum
      </legend>
      {cleaning.areas.map(area => {
        const checked = ctx.state.draft.rooms.includes(area.id);
        return (
          <KitButton
            key={area.id}
            className="pv-button pv-tile choice robot-room-tile pv-kit pv-kit-tile"
            type="button"
            data-kit="tile"
            data-kit-identity="robot"
            data-kit-variant="compact"
            name="areaIds"
            value={area.id}
            data-selected={yes(checked)}
            aria-pressed={yes(checked)}
            aria-busy="false"
            isDisabled={view.disabled}
            onPress={() => {
              ctx.actions.toggleRoom(area.id);
            }}
          >
            <img
              className="robot-room-icon"
              src={roomIcon(area.label)}
              alt=""
              width={32}
              height={32}
              draggable={false}
            />
            <span className="robot-room-label" data-kit-text="field-label">
              {area.label}
            </span>
          </KitButton>
        );
      })}
    </fieldset>
  );
}

function CleaningForm({ctx, cleaning, controls}: {ctx: Ctx; cleaning: CleaningDef; controls: ControlsDef | null}) {
  const state = ctx.state;
  const all = cleaning.areas.every(area => state.draft.rooms.includes(area.id));
  const allView = control(state, ctx.rules, {draft: true});
  const rooms = cleaning.areas.filter(area => state.draft.rooms.includes(area.id)),
    count = state.draft.repeat;
  const summary =
    rooms.length && count !== null
      ? `${rooms.map(area => area.label).join(', ')} · ${String(count)} ${count === 1 ? 'gang' : 'gange'}`
      : count === null
        ? 'Vælg antal gange'
        : 'Vælg mindst ét rum';
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    ctx.actions.submitCleaning();
  };
  const typed = cleaning.settings.filter(row => row.concept !== 'mode'),
    modes = cleaning.settings.filter(row => row.concept === 'mode');
  return (
    <form className="robot-cleaning-form" id={cleaning.formId} onSubmit={submit}>
      <section
        className={`device-history robot-cleaning-zone ${CARD}`}
        data-kit="card"
        data-kit-identity="robot"
        data-kit-layout="controls"
        data-detail-zone="controls"
      >
        <div className="heading robot-room-heading">
          <div className="robot-room-context">
            <h2 className={SECTION_HEADER} data-kit-text="section-title" data-kit="sectionheader">
              Rum
            </h2>
            <MapView ctx={ctx} map={cleaning.map} />
          </div>
          <KitButton
            className={`pv-button pv-ghost ${KIT_BUTTON}`}
            type="button"
            data-kit="button"
            data-kit-identity="neutral"
            data-kit-variant="quiet"
            data-kit-slot="header-action"
            data-kit-content="icon-label"
            aria-busy="false"
            isDisabled={allView.disabled}
            onPress={() => {
              ctx.actions.toggleAll();
            }}
          >
            <MaskIcon src={all ? 'assets/icons/x-lg.svg' : 'assets/icons/check2.svg'} />
            <span data-kit-slot="label">{all ? 'Fravælg alle' : 'Vælg alle'}</span>
          </KitButton>
        </div>
        <RoomTiles ctx={ctx} cleaning={cleaning} />
      </section>
      <section
        className={`robot-settings-zone ${CARD}`}
        data-kit="card"
        data-kit-identity="robot"
        data-kit-layout="controls"
        data-detail-zone="controls"
      >
        <h2 className={SECTION_HEADER} data-kit-text="section-title" data-kit="sectionheader">
          Rengøringsvalg
        </h2>
        {cleaning.recipe !== null ? (
          <section
            className={`robot-recipe-summary ${LISTROW}`}
            data-kit="listrow"
            data-kit-variant="read-only"
            data-kit-identity="robot"
            aria-label="Valgt opskrift til denne start"
          >
            <p className="pv-meta" data-kit-text="meta">
              {cleaning.recipe}
            </p>
          </section>
        ) : null}
        <section className="settings robot-cleaning-options">
          {modes.map(row => (
            <StartSetting key={row.rail.id} ctx={ctx} row={row} />
          ))}
          {controls?.mode.map(row => (
            <Setting key={settingKey(row)} ctx={ctx} row={row} />
          ))}
          <div className="robot-type-options" role="group" aria-label="Indstillinger for valgt type">
            {typed.map(row => (
              <StartSetting key={row.rail.id} ctx={ctx} row={row} />
            ))}
            {controls?.typed.map(row => (
              <Setting key={settingKey(row)} ctx={ctx} row={row} />
            ))}
            {controls?.note ? (
              <p className="pv-meta" data-kit-text="meta">
                {controls.note}
              </p>
            ) : null}
            <Rail
              ctx={ctx}
              rail={cleaning.repeatRail}
              value={state.draft.repeat === null ? null : String(state.draft.repeat)}
              inputControl={value => ({radio: value, draft: true})}
              onChoose={value => {
                ctx.actions.chooseRepeat(Number(value));
              }}
            />
          </div>
        </section>
        <p className="summary" data-kit-text="body" hidden>
          {summary}
        </p>
      </section>
    </form>
  );
}

// ----- the daily settings -----

const settingKey = (row: SettingDef): string => ('rail' in row ? row.rail.id : `${row.kind}-${row.option.id}`);

function Setting({ctx, row}: {ctx: Ctx; row: SettingDef}) {
  const state = ctx.state,
    option = row.option,
    current = settingCurrent(state.value, option),
    mode = dailyMode(state),
    concept = settingConcept(option);
  if (row.kind === 'readonly') {
    const choice = option.argsSchema.choices?.find(item => item.id === current),
      known = !!choice || (option.argsSchema.kind === 'number' && Number.isFinite(current));
    let text = choice ? choiceLabel(option, choice) : known ? String(current) : 'Ikke oplyst';
    if (state.value?.connected === false || state.value?.device?.stale) text += ' · ikke opdateret';
    return (
      <section
        className={`setting robot-setting-readonly ${LISTROW}`}
        data-kit="listrow"
        data-kit-identity="robot"
        data-kit-variant="read-only"
        data-setting-concept={row.concept}
        hidden={known && irrelevantSetting(concept, mode)}
      >
        <h4 data-kit-text="field-label">
          {row.icon ? <Icon src={row.icon} decorative /> : null}
          {settingLabel(option)}
        </h4>
        <p className="robot-setting-value" data-kit-text="control-value">
          {text}
        </p>
      </section>
    );
  }
  if (row.kind === 'repeat-number')
    return (
      <form
        className={`setting ${LISTROW} robot-setting-wrapper`}
        data-kit="listrow"
        data-kit-identity="robot"
        data-kit-variant="settings"
        data-setting-concept="repeat"
        onSubmit={event => {
          event.preventDefault();
        }}
      >
        <Rail
          ctx={ctx}
          rail={row.rail}
          value={String(current)}
          inputControl={value => ({radio: value, optionId: option.id})}
          onChoose={value => {
            // The observed count stays selected until the robot reports the new one.
            if (Number(value) !== current) ctx.actions.act(option, {value: Number(value)});
          }}
        />
      </form>
    );
  if (row.kind === 'level') {
    const choices = option.argsSchema.choices ?? [];
    const hidden = productHidden(option, choices, mode);
    const special = specialCurrent(option, choices, current, hidden.has(String(current)));
    return (
      <fieldset
        className={`setting ${LISTROW} robot-setting-wrapper`}
        data-kit="listrow"
        data-kit-identity="robot"
        data-kit-variant="settings"
        data-setting-concept={concept}
        hidden={choices.some(choice => choice.id === current) && irrelevantSetting(concept, mode)}
      >
        <Rail
          ctx={ctx}
          rail={levelAttrs(row.rail, concept, hidden, mode)}
          value={current as string | null}
          hiddenChoices={hidden}
          special={special}
          inputControl={value => ({radio: value, optionId: option.id})}
          onChoose={value => {
            // A frequent level sends its exact choice at once; the observed value stays selected until reported.
            if (current !== value) ctx.actions.act(option, {choiceId: value});
          }}
        />
      </fieldset>
    );
  }
  return <Field ctx={ctx} option={option} />;
}

// A typed number the owner offers without a bounded repeat range.
function Field({ctx, option}: {ctx: Ctx; option: RobotOption}) {
  const schema = option.argsSchema,
    input = useRef<HTMLInputElement>(null);
  const title = `${option.label}${schema.kind === 'number' ? ` (${schema.unit ?? ''})` : ''}`;
  const ready = ctx.state.fieldReady[option.id] === true;
  useLayoutEffect(() => {
    // The typed value is the input's own state (the old renderer set input.value, never the attribute).
    if (input.current) input.current.value = String(schema.current);
  }, [schema]);
  const valid = () => {
    const node = input.current;
    if (!node) return false;
    return schema.kind === 'number'
      ? Number.isFinite(node.valueAsNumber) &&
          node.valueAsNumber >= (schema.min ?? 0) &&
          node.valueAsNumber <= (schema.max ?? 0) &&
          node.valueAsNumber !== schema.current &&
          node.checkValidity()
      : /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(node.value) &&
          (node.value.length === 5 || node.value.length === 8) &&
          node.value !== schema.current;
  };
  const field = control(ctx.state, ctx.rules, {});
  const submit = control(ctx.state, ctx.rules, {optionId: option.id, unready: !ready, command: true});
  return (
    <form
      className={`setting ${LISTROW} robot-setting-wrapper`}
      data-kit="listrow"
      data-kit-identity="robot"
      data-kit-variant="settings"
      onSubmit={event => {
        event.preventDefault();
        const node = input.current;
        if (ctx.state.disabled || !ready || !valid() || !node) return;
        ctx.actions.act(option, schema.kind === 'number' ? {value: node.valueAsNumber} : {time: node.value});
      }}
    >
      <h4 className="pv-section-header" data-kit-text="field-label">
        {title}
      </h4>
      <input
        ref={input}
        type={schema.kind}
        aria-label={title}
        {...(schema.kind === 'number'
          ? {min: String(schema.min), max: String(schema.max), step: String(schema.step)}
          : {step: '1'})}
        disabled={field.disabled}
        required
        onInput={() => {
          ctx.actions.setFieldReady(option, valid());
        }}
        onChange={() => {
          ctx.actions.setFieldReady(option, valid());
        }}
      />
      <KitButton
        className={`pv-button ${KIT_BUTTON}`}
        type="submit"
        data-kit="button"
        data-kit-identity="robot"
        data-kit-variant="secondary"
        data-control-option-id={option.id}
        data-unready={yes(!ready)}
        data-feedback="progress"
        aria-busy={yes(submit.busy)}
        isDisabled={submit.disabled}
      >
        {`Anvend ${option.label.toLocaleLowerCase('da-DK')}`}
      </KitButton>
    </form>
  );
}

function Controls({ctx, controls}: {ctx: Ctx; controls: ControlsDef}) {
  const repeat = ctx.state.value?.currentSetup?.repeat;
  return (
    <div className="robot-current-controls">
      {controls.mode.map(row => (
        <Setting key={settingKey(row)} ctx={ctx} row={row} />
      ))}
      <div className="robot-type-options" role="group" aria-label="Indstillinger for valgt type">
        {controls.typed.map(row => (
          <Setting key={settingKey(row)} ctx={ctx} row={row} />
        ))}
        {controls.repeat?.kind === 'rail' ? (
          <Rail
            ctx={ctx}
            rail={controls.repeat.rail}
            value={Number.isInteger(repeat) ? String(repeat) : null}
            inputControl={value => ({radio: value, unready: true})}
            onChoose={() => undefined}
          />
        ) : controls.repeat?.kind === 'row' ? (
          <section
            className={`robot-repeat-status ${LISTROW}`}
            data-kit="listrow"
            data-kit-identity="robot"
            data-kit-variant="read-only"
          >
            <h3 className="pv-section-header" data-kit-text="field-label">
              <Icon src="assets/icons/arrow-refresh.svg" decorative />
              Antal gange
            </h3>
            <p className="robot-repeat-value" data-kit-text="control-value">
              {repeatStatusText(ctx.state)}
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

// The floor: a navigation select when the owner offers a map choice, else the map's name.
function MapView({ctx, map}: {ctx: Ctx; map: MapDef | null}) {
  if (!map) return null;
  if (map.kind === 'meta') {
    const name = map.current ? currentMapName(ctx.state) : map.name || null;
    return (
      <p className="pv-meta robot-map-meta" data-kit-text="meta" hidden={!name}>
        {name ?? ''}
      </p>
    );
  }
  const current = settingCurrent(ctx.state.value, map.option),
    matches = map.choices.filter(choice => choice.label === map.name);
  const selected = map.choices.some(choice => choice.id === current)
    ? (current as string)
    : matches.length === 1
      ? (matches[0]?.id ?? '')
      : '';
  const view = control(ctx.state, ctx.rules, {optionId: map.option.id});
  return (
    <select
      className="robot-map-select"
      data-choice-variant="navigation"
      aria-label={map.option.label}
      data-control-option-id={map.option.id}
      value={selected}
      disabled={view.disabled}
      onChange={event => {
        const chosen = event.currentTarget.value;
        if (!event.currentTarget.disabled && map.choices.some(choice => choice.id === chosen))
          ctx.actions.act(map.option, {choiceId: chosen});
      }}
    >
      <option value="" disabled>
        {map.name || 'Vælg etage'}
      </option>
      {map.choices.map(choice => (
        <option key={choice.id} value={choice.id}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

// ----- sections -----

function Sections({ctx}: {ctx: Ctx}) {
  const layout = ctx.state.layout;
  if (!layout) return null;
  return layout.sections.map((section, index) => {
    const key = `${section.kind}-${String(index)}`;
    switch (section.kind) {
      case 'cleaning':
        return <CleaningForm key={key} ctx={ctx} cleaning={section.cleaning} controls={section.controls} />;
      case 'empty-rooms':
        return (
          <section
            key={key}
            className={`device-history robot-cleaning-zone ${CARD}`}
            data-kit="card"
            data-kit-identity="robot"
            data-kit-layout="controls"
            data-detail-zone="controls"
          >
            <div className="heading robot-room-heading">
              <div className="robot-room-context">
                <h2 className={SECTION_HEADER} data-kit-text="section-title" data-kit="sectionheader">
                  Rum
                </h2>
                <MapView ctx={ctx} map={section.map} />
              </div>
            </div>
            <p className="pv-meta empty" data-kit-text="meta">
              Ingen rum at vælge på denne etage.
            </p>
          </section>
        );
      case 'settings-zone':
      case 'current-settings':
        return (
          <section
            key={key}
            className={
              section.kind === 'settings-zone'
                ? `robot-settings-zone ${CARD}`
                : `device-history settings robot-current-settings ${CARD}`
            }
            data-kit="card"
            data-kit-identity="robot"
            data-kit-layout="controls"
            data-detail-zone="controls"
          >
            <h2 className={SECTION_HEADER} data-kit-text="section-title" data-kit="sectionheader">
              Rengøringsvalg
            </h2>
            <Controls ctx={ctx} controls={section.controls} />
          </section>
        );
      case 'current-rooms':
        return <CurrentRooms key={key} ctx={ctx} map={section.map} />;
      case 'reuse':
        return (
          <section key={key} className="device-history">
            <h3 data-kit-text="section-title">Gentag den valgte rengøring</h3>
            <p className="pv-meta history-note" data-kit-text="meta">
              Dit tidligere rumvalg
            </p>
            <ActionButton ctx={ctx} name={section.key} row="reuse" />
          </section>
        );
      case 'availability': {
        const text = availabilityText(ctx.state);
        return (
          <p key={key} className="pv-meta empty" data-kit-text="meta" role="status" hidden={!text}>
            {text}
          </p>
        );
      }
      default:
        return null;
    }
  });
}

// »Denne tur«: the running job's map and the rooms the owner says it cleans.
function CurrentRooms({ctx, map}: {ctx: Ctx; map: MapDef | null}) {
  const areas = currentAreas(ctx.state);
  return (
    <section
      className={`robot-current-rooms ${CARD}`}
      data-kit="card"
      data-kit-identity="robot"
      data-kit-layout="controls"
      data-detail-zone="controls"
    >
      <header
        className="robot-current-heading pv-kit pv-kit-sectionheader pv-section-header"
        data-kit="sectionheader"
        data-kit-layout="stacked"
      >
        <h2 className="pv-section-header" data-kit-text="section-title">
          Denne tur
        </h2>
        <MapView ctx={ctx} map={map} />
      </header>
      <ul className="choices pv-tiles robot-current-room-list" aria-label="Valgte rum" hidden={!areas}>
        {(areas ?? []).map(area => (
          <li
            key={area.id}
            className="pv-tile robot-room-tile robot-current-room-tile pv-kit pv-kit-tile"
            data-kit="tile"
            data-kit-identity="robot"
            data-kit-variant="compact"
            data-selected="true"
            aria-label={area.label}
          >
            <img
              className="robot-room-icon"
              src={roomIcon(area.label)}
              alt=""
              width={32}
              height={32}
              draggable={false}
            />
            <span className="robot-room-label" data-kit-text="field-label">
              {area.label}
            </span>
          </li>
        ))}
      </ul>
      <p
        className="robot-current-rooms-unknown pv-kit pv-kit-listrow pv-row"
        data-kit-text="body"
        data-kit="listrow"
        data-kit-identity="robot"
        data-kit-variant="read-only"
        hidden={!!areas}
      >
        {currentRoomText(ctx.state)}
      </p>
    </section>
  );
}

// ----- the iPad sticky line -----

// The hero's first visible, non-destructive command.
function stickyTarget(ctx: Ctx): {label: string; disabled: boolean; selector: string} | null {
  const layout = ctx.state.layout;
  for (const item of layout?.transport ?? []) {
    if (item.kind === 'base') continue;
    if (item.kind === 'submit') {
      const cleaning = cleaningOf(layout);
      if (!cleaning || activeJobOf(ctx.state)) continue;
      return {
        label: startLabel(ctx.state, cleaning).label,
        disabled: control(ctx.state, ctx.rules, {draft: true, unready: startUnready(ctx.state)}).disabled,
        selector: '.transport > button[type=submit]',
      };
    }
    const action = layout?.actions[item.key];
    if (!action || action.attrs['data-action-id'] === 'stop') continue;
    const view = control(ctx.state, ctx.rules, {
      optionId: action.attrs['data-control-option-id'],
      actionId: action.attrs['data-action-id'],
      direct: action.option.direct,
    });
    return {
      label: action.label,
      disabled: view.disabled,
      selector: `.transport > button[data-control-option-id="${action.option.id}"]`,
    };
  }
  return null;
}

// When the hero has scrolled away (iPad, lærred »Robot-Sticky«), a 72-px line under the topbar repeats its title,
// line and primary action and offers »Mere«. It owns no state: both taps go to the hero's own controls, whose rules
// stay the only ones. A touch shortcut, hidden from assistive technology; its texts are drawn from data-text in CSS.
function Sticky({ctx, hero}: {ctx: Ctx; hero: HTMLElement | null}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!hero || !('IntersectionObserver' in globalThis)) return;
    const observer = new IntersectionObserver(entries => {
      setShown(!entries[entries.length - 1]?.isIntersecting);
    });
    observer.observe(hero);
    return () => {
      observer.disconnect();
    };
  }, [hero]);
  const view = heroView(ctx.state),
    target = stickyTarget(ctx);
  // Without a target the line hides its primary and keeps what it last said.
  const [said, setSaid] = useState<{label: string; disabled: boolean} | null>(null);
  const says = target ? {label: target.label.trim(), disabled: target.disabled} : said;
  if (says !== said && (says?.label !== said?.label || says?.disabled !== said?.disabled)) setSaid(says);
  return (
    <div className="robot-sticky" aria-hidden="true" data-shown={yes(shown)}>
      <span className="robot-sticky-dot" />
      <span className="robot-sticky-copy">
        <span className="robot-sticky-title" data-text={view.text.trim()} />
        <span className="robot-sticky-sub" data-text={view.meta.trim()} />
      </span>
      <span
        className="robot-sticky-primary"
        hidden={!target}
        data-text={says?.label}
        data-disabled={says ? yes(says.disabled) : undefined}
        onClick={() => {
          const node = target ? hero?.querySelector<HTMLButtonElement>(target.selector) : null;
          if (node && !node.disabled) node.click();
        }}
      />
      <span
        className="robot-sticky-more"
        data-text="Mere"
        hidden={!ctx.state.layout?.base}
        onClick={() => {
          const trigger = hero?.querySelector<HTMLButtonElement>('.robot-dock-actions > button');
          if (!trigger) return;
          if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
          (hero as Partial<HTMLElement> | null)?.scrollIntoView?.({block: 'start', behavior: 'smooth'});
        }}
      />
    </div>
  );
}

export function RobotPanel({store}: {store: Store}) {
  const state = useStore(store),
    actions = store.getState();
  const [hero, setHero] = useState<HTMLElement | null>(null);
  const layout = state.layout;
  if (!layout) return null;
  const ctx: Ctx = {state, actions, rules: access(state)};
  const confirmation = <Confirmation key={state.dialog.key} ctx={ctx} />;
  const heroNode = (
    <Hero key={`hero-${layout.build}`} ctx={ctx} onNode={setHero}>
      <Transport ctx={ctx} />
    </Hero>
  );
  return (
    <>
      {layout.dialogFirst ? [confirmation, heroNode] : [heroNode, confirmation]}
      <Sections key={`sections-${layout.build}`} ctx={ctx} />
      <Sticky key={`sticky-${layout.build}`} ctx={ctx} hero={hero} />
    </>
  );
}
