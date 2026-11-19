// The kit compositions the recipe screen is made of, drawn by React with exactly the elements, classes, kit data
// attributes and aria the pre-React helpers (ui/kit.js: createKitComponent, createKitDisclosure,
// createKitChoiceGroup, applyKitDialog, applyKitTextRole) produced, so the stage stylesheet applies unchanged.
import {useLayoutEffect, useRef} from 'react';
import type {DialogHTMLAttributes, HTMLAttributes, ReactNode, Ref} from 'react';
import {revealKitItem} from '../../../ui/kit.js';

type KitType = 'card' | 'hero' | 'chip' | 'button' | 'listrow' | 'sectionheader' | 'topbar' | 'dialog' | 'icon';
const KIT_CLASS: Record<KitType, string> = {
  card: 'pv-card',
  hero: 'pv-hero',
  chip: 'pv-chip',
  button: 'pv-btn',
  listrow: 'pv-row',
  sectionheader: 'pv-section-header',
  topbar: 'pv-topbar',
  dialog: 'pv-dialog',
  icon: 'pv-icon',
};
export type TextRole = 'section-title' | 'group-title' | 'field-label' | 'body' | 'meta' | 'headline';

interface KitOptions {
  variant?: string | undefined;
  tone?: string | undefined;
  label?: string | undefined;
  // Classes the element had before the kit classes (createKitComponent's className).
  before?: string | undefined;
  // Classes added after the kit classes (applyKitDialog's part classes, ...).
  after?: string | undefined;
}

// The attributes applyKitComponent writes for a kit component.
export function kit(type: KitType, {variant, tone, label, before, after}: KitOptions = {}) {
  const classes = [before, 'pv-kit', `pv-kit-${type}`, KIT_CLASS[type], after].filter(Boolean).join(' ');
  return {
    className: classes,
    'data-kit': type,
    'data-kit-variant': variant,
    'data-tone': tone,
    'aria-label': label,
  };
}

type Variant = 'primary' | 'secondary' | 'quiet' | 'icon';

interface ActionProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  onPress: () => void;
  variant?: Variant;
  tone?: 'danger';
  hidden?: boolean;
  ref?: Ref<HTMLButtonElement>;
  textRole?: TextRole;
}

// A kit Button with one action (recipe-view's action()).
export function Action({label, onPress, variant = 'secondary', tone, textRole, ref, ...rest}: ActionProps) {
  return (
    <button
      {...kit('button', {variant, tone})}
      type="button"
      data-kit-text={textRole}
      ref={ref}
      {...rest}
      onClick={() => {
        onPress();
      }}
    >
      {label}
    </button>
  );
}

interface TextProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  ref?: Ref<HTMLParagraphElement>;
}

export function Meta({children, ref, ...rest}: TextProps) {
  return (
    <p data-kit-text="meta" ref={ref} {...rest}>
      {children}
    </p>
  );
}

// A kit Card with a section header and its title (recipe-view's section()).
export function Section({title, children, header}: {title: string; children?: ReactNode; header?: ReactNode}) {
  return (
    <article {...kit('card')}>
      {header ?? (
        <header {...kit('sectionheader')}>
          <h2 data-kit-text="section-title">{title}</h2>
        </header>
      )}
      {children}
    </article>
  );
}

// A read-only kit ListRow.
export function ReadOnlyRow({children}: {children?: ReactNode}) {
  return <div {...kit('listrow', {variant: 'read-only'})}>{children}</div>;
}

export function Time({date, text}: {date: Date; text: string}) {
  return (
    <time data-kit-text="meta" dateTime={date.toISOString()}>
      {text}
    </time>
  );
}

interface DisclosureProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onToggle'> {
  id: string;
  title: string;
  description?: string;
  expanded: boolean;
  onToggle: (expanded: boolean, trigger: HTMLButtonElement, panel: HTMLElement) => void;
  titleRole?: TextRole;
  kitCard?: boolean;
  children?: ReactNode;
}

// The kit ListRow disclosure (createKitDisclosure): the owner keeps whether it is open.
export function Disclosure(props: DisclosureProps) {
  const {id, title, description = '', expanded, onToggle, titleRole = 'group-title', kitCard, children, ...rest} =
    props;
  const panel = useRef<HTMLDivElement>(null);
  const node = kitCard ? kit('card', {before: 'pv-kit-disclosure'}) : {className: 'pv-kit-disclosure'};
  return (
    <section {...node} {...rest}>
      <button
        {...kit('listrow')}
        type="button"
        id={`${id}-trigger`}
        aria-controls={`${id}-panel`}
        aria-expanded={String(expanded) as 'true' | 'false'}
        data-has-summary={String(Boolean(description))}
        onClick={event => {
          if (panel.current) onToggle(!expanded, event.currentTarget, panel.current);
        }}
      >
        <span data-kit-slot="copy">
          <strong data-kit-text={titleRole} data-kit-slot="title">
            {title}
          </strong>
          <small
            data-kit-text="meta"
            data-kit-slot="description"
            hidden={!description}
            aria-hidden={String(!description) as 'true' | 'false'}
          >
            {description}
          </small>
        </span>
      </button>
      <div id={`${id}-panel`} aria-labelledby={`${id}-trigger`} role="region" hidden={!expanded} ref={panel}>
        {children}
      </div>
    </section>
  );
}

// Closing a disclosure that holds the focus hands the focus to its trigger (createKitDisclosure).
export function keepFocusOnClose(expanded: boolean, trigger: HTMLElement, panel: HTMLElement) {
  if (!expanded && panel.contains(document.activeElement)) trigger.focus();
}

export interface Choice {
  value: string;
  label: string;
}

interface ChoiceGroupProps extends HTMLAttributes<HTMLFieldSetElement> {
  id: string;
  label: string;
  choices: Choice[];
  value: string;
  onChoose: (value: string) => void;
  labelData?: (choice: Choice) => Record<string, string>;
  after?: ReactNode;
  ref?: Ref<HTMLFieldSetElement>;
}

// A navigation choice group of native radios on kit Chips (createKitChoiceGroup). Which radio is checked is the
// radio's own state, written as before (the property, never the attribute); a new value is revealed in its row.
export function ChoiceGroup(props: ChoiceGroupProps) {
  const {id, label, choices, value, onChoose, labelData, after, ref, ...rest} = props;
  const row = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const inputs = [...(row.current?.querySelectorAll<HTMLInputElement>(':scope > label > input') ?? [])];
    for (const input of inputs) if (input.checked !== (input.value === value)) input.checked = input.value === value;
    if (shown.current !== null && shown.current !== value) {
      revealKitItem(inputs.find(input => input.checked)?.parentElement, row.current);
    }
    shown.current = value;
  }, [value]);
  return (
    <fieldset className="pv-kit-choice-group" data-choice-variant="navigation" ref={ref} {...rest}>
      <legend data-kit-text="field-label">{label}</legend>
      <div className="pv-kit-choice-options" ref={row}>
        {choices.map((choice, index) => (
          <label
            key={choice.value}
            {...kit('chip', {after: 'pv-kit-choice-label'})}
            {...labelData?.(choice)}
          >
            <input
              type="radio"
              name={id}
              value={choice.value}
              id={`${id}-${String(index)}`}
              onChange={event => {
                if (event.currentTarget.checked) onChoose(event.currentTarget.value);
              }}
            />
            <span>{choice.label}</span>
          </label>
        ))}
        {after}
      </div>
    </fieldset>
  );
}

interface DialogProps extends DialogHTMLAttributes<HTMLDialogElement> {
  children?: ReactNode;
  ref?: Ref<HTMLDialogElement>;
}

// A native <dialog> on the kit Dialog (applyKitDialog); showModal and close stay native.
export function Dialog({children, ref, ...rest}: DialogProps) {
  return (
    <dialog ref={ref} {...kit('dialog', {variant: 'default'})} {...rest}>
      {children}
    </dialog>
  );
}

// The page heading: a TopBar with the title (focusable from script), a subtitle and the page's actions.
export function PageHeader({title, subtitle, actions}: {title: string; subtitle: string; actions?: ReactNode}) {
  return (
    <header {...kit('topbar', {before: 'response-heading'})}>
      <div>
        <h1 data-kit-text="headline" tabIndex={-1}>
          {title}
        </h1>
        <Meta>{subtitle}</Meta>
      </div>
      {actions}
    </header>
  );
}

// Write an element's state only when it changes, so an unchanged render writes nothing.
export function setHidden(node: HTMLElement, hidden: boolean) {
  if (node.hidden !== hidden) node.hidden = hidden;
}
export function setText(node: Node, text: string) {
  if (node.textContent !== text) node.textContent = text;
}
export function setAttr(node: Element, name: string, value: string) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
