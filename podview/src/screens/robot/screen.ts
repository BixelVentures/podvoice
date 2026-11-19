// Robot: what each element of the robot control panel shows. The controller (RobotControlPanel.tsx) keeps one Face
// per element it creates and changes (class, attributes, hidden, disabled, text), in the structure the pre-React
// robot-control-panel.js built, and React draws the panel from a copy (RobotPanel.tsx). The kit helpers below are
// the face form of podview/ui/kit.js (applyKitComponent, applyKitTextRole, syncKitButtonContent), so every element
// keeps exactly the classes and attributes the old renderer gave it.

export type Attrs = Record<string, string>;

export interface Face {
  // Stable per created element: the React key and the controller's handle on the drawn element.
  id: string;
  className: string;
  attrs: Attrs;
  hidden: boolean;
  disabled: boolean;
  text: string;
  // The style attribute exactly as the old renderer wrote it (written natively; React's style is an object).
  style: string | null;
}

// Every change to a face or the structure counts, so the controller paints only when something changed.
export const changes = {count: 0};
export const touch = (): void => {
  changes.count++;
};

let serial = 0;
export function face(className = '', attrs: Attrs = {}, text = ''): Face {
  return {id: `f${String(++serial)}`, className, attrs, hidden: false, disabled: false, text, style: null};
}

export function setAttr(target: Face, name: string, value: string | boolean | number): void {
  const next = String(value);
  if (target.attrs[name] === next) return;
  target.attrs = {...target.attrs, [name]: next};
  touch();
}

export function removeAttr(target: Face, name: string): void {
  if (!(name in target.attrs)) return;
  target.attrs = Object.fromEntries(Object.entries(target.attrs).filter(([key]) => key !== name));
  touch();
}

export const attr = (target: Face, name: string): string | null => target.attrs[name] ?? null;

export function setHidden(target: Face, hidden: boolean): void {
  if (target.hidden === hidden) return;
  target.hidden = hidden;
  touch();
}

export function setDisabled(target: Face, disabled: boolean): void {
  if (target.disabled === disabled) return;
  target.disabled = disabled;
  touch();
}

export function setText(target: Face, text: string): void {
  if (target.text === text) return;
  target.text = text;
  touch();
}

export function setClass(target: Face, className: string): void {
  if (target.className === className) return;
  target.className = className;
  touch();
}

export function setStyle(target: Face, style: string): void {
  if (target.style === style) return;
  target.style = style;
  touch();
}

// The dataset name of a data attribute (data-control-option-id → controlOptionId), as the old code read it.
export const dataName = (key: string): string => `data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;

export function addClasses(target: Face, ...tokens: (string | undefined)[]): void {
  const current = target.className.split(/\s+/).filter(Boolean);
  const missing = tokens.filter((token): token is string => !!token && !current.includes(token));
  if (missing.length) setClass(target, [...current, ...missing].join(' '));
}

export const hasClass = (target: Face, token: string): boolean => target.className.split(/\s+/).includes(token);

const KIT_CLASSES: Record<string, string> = {
  card: 'pv-card',
  hero: 'pv-hero',
  tile: 'pv-tile',
  chip: 'pv-chip',
  button: 'pv-btn',
  toggle: 'pv-toggle',
  listrow: 'pv-row',
  sectionheader: 'pv-section-header',
  dialog: 'pv-dialog',
  icon: 'pv-icon',
};

export interface KitOptions {
  identity?: string;
  variant?: string;
  label?: string;
  selected?: boolean;
  feedback?: 'label' | 'progress';
  tone?: 'neutral' | 'warning' | 'danger';
  loading?: boolean;
}

// applyKitComponent for a face.
export function kit(target: Face, type: string, options: KitOptions = {}): Face {
  addClasses(target, 'pv-kit', `pv-kit-${type}`);
  addClasses(target, KIT_CLASSES[type]);
  setAttr(target, 'data-kit', type);
  if (options.variant !== undefined) setAttr(target, 'data-kit-variant', options.variant);
  if (options.identity !== undefined) setAttr(target, 'data-kit-identity', options.identity);
  if (options.label !== undefined) setAttr(target, 'aria-label', options.label);
  if (options.selected !== undefined) {
    setAttr(target, type === 'toggle' ? 'aria-checked' : 'aria-pressed', options.selected);
  }
  if (options.feedback !== undefined) setAttr(target, 'data-feedback', options.feedback);
  if (options.tone !== undefined) setAttr(target, 'data-tone', options.tone);
  if (options.loading !== undefined) setAttr(target, 'aria-busy', options.loading);
  if (type === 'toggle') setAttr(target, 'role', 'switch');
  return target;
}

export function textRole(target: Face, role: string): Face {
  setAttr(target, 'data-kit-text', role);
  return target;
}

// The old `make(tag,text,className)`: a text role for headings, legends and paragraphs, and the robot kit Button for
// every button (the primary variant when its class says pv-primary).
export function made(tag: string, text: string | undefined, className = ''): Face {
  const target = face(className, {}, text ?? '');
  const classes = className.split(/\s+/);
  const role = ['h2', 'h3'].includes(tag)
    ? 'section-title'
    : ['h4', 'legend'].includes(tag)
      ? 'field-label'
      : tag === 'summary'
        ? 'group-title'
        : tag === 'p'
          ? classes.includes('pv-meta')
            ? 'meta'
            : className === 'robot-repeat-value'
              ? 'control-value'
              : 'body'
          : className === 'robot-room-label'
            ? 'field-label'
            : null;
  if (role) textRole(target, role);
  if (tag === 'button') {
    kit(target, classes.includes('pv-segment') ? 'chip' : 'button', {
      identity: 'robot',
      variant: classes.includes('pv-primary') ? 'primary' : 'secondary',
    });
  }
  return target;
}

// Icon + label inside a kit Button (syncKitButtonContent).
export interface ButtonContent {
  label: string;
  icon: string;
}

// A Button with a leading icon: an <img>, or the masked <span> the old Stop used.
export interface ActionIcon {
  tag: 'img' | 'span';
  src: string;
  // data-kit-variant of the icon: »default« on the transport's own icons, none elsewhere.
  variant?: string | undefined;
}

export interface ActionButton {
  face: Face;
  icon: ActionIcon;
  label: string;
}

export interface Rail {
  id: string;
  label: string;
  // The level icon decorateLevel put in front of the legend text.
  icon: string | null;
  node: Face;
  track: Face;
  // Additional (auxiliary) choices sit in their own row after the visible ones.
  additional: boolean;
  choices: {value: string; label: string; additional: boolean; chip: Face; input: Face}[];
  note: Face | null;
}

export interface MapSelect {
  kind: 'select';
  face: Face;
  placeholder: Face;
  options: Face[];
  // The value the controller wants selected; the select's value itself is native.
  value: string;
}

export interface MapMeta {
  kind: 'meta';
  face: Face;
}

export type MapPart = MapSelect | MapMeta | null;

export type Part =
  | {kind: 'rail'; rail: Rail}
  | {kind: 'group'; tag: 'div' | 'section'; face: Face; children: Part[]}
  | {kind: 'note'; face: Face}
  | {kind: 'readonly'; face: Face; title: Face; icon: string | null; value: Face}
  | {kind: 'wrapper'; tag: 'form' | 'fieldset'; face: Face; rail: Rail; submit: Face | null}
  | {kind: 'toggle'; face: Face; title: Face; toggle: Face}
  | {kind: 'field'; face: Face; title: Face; input: Face; submit: Face}
  | {kind: 'repeat-row'; face: Face; title: Face; value: Face};

export interface RoomTile {
  face: Face;
  label: string;
  icon: string;
}

export interface CleaningSection {
  kind: 'cleaning';
  form: Face;
  zone: Face;
  map: MapPart;
  all: Face;
  allContent: ButtonContent | null;
  choices: Face;
  rooms: RoomTile[];
  card: Face;
  recipe: string | null;
  options: Part & {kind: 'group'};
  summary: Face;
}

export type Section =
  | CleaningSection
  | {kind: 'empty-rooms'; zone: Face; map: MapPart}
  | {kind: 'settings-zone'; face: Face; controls: Part & {kind: 'group'}}
  | {kind: 'current-rooms'; card: Face; map: MapPart; list: Face; rooms: RoomTile[]; unknown: Face}
  | {kind: 'current-settings'; face: Face; controls: Part & {kind: 'group'}}
  | {kind: 'reuse'; button: string}
  | {kind: 'availability'; face: Face};

export type TransportItem = {kind: 'action'; key: string} | {kind: 'submit'} | {kind: 'base'};

export interface Submit {
  face: Face;
  icon: string;
  label: string;
}

export interface Base {
  id: string;
  node: Face;
  trigger: Face;
  description: Face;
  panel: Face;
  items: string[];
}

export interface Confirm {
  key: string;
  titleId: string;
  title: string;
  copy: string;
  cancel: Face;
  accept: Face;
  acceptIcon: string;
  acceptLabel: string;
}

export interface Hero {
  observation: Face;
  eyebrow: Face;
  progress: Face;
  progressLabel: Face;
  meter: number | null;
  transport: TransportItem[];
  settingsContext: Face;
}

export interface Sticky {
  line: Face;
  title: Face;
  sub: Face;
  primary: Face;
  more: Face;
}

export interface RobotScreen {
  // A new build draws new elements, as the old build() created them.
  build: string;
  dialogFirst: boolean;
  dialog: {face: Face; confirm: Confirm | null} | null;
  hero: Hero | null;
  actions: Record<string, ActionButton>;
  submit: Submit | null;
  base: Base | null;
  sections: Section[];
  sticky: Sticky | null;
}

export const emptyScreen = (): RobotScreen => ({
  build: '',
  dialogFirst: false,
  dialog: null,
  hero: null,
  actions: {},
  submit: null,
  base: null,
  sections: [],
  sticky: null,
});
