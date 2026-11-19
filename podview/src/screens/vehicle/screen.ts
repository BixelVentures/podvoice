// Bil: what each changeable element of the vehicle screen shows. The controller (VehicleView.tsx) keeps one
// Face per element it updates (hidden, disabled, text or kit icon+label content, and the attributes the kit and
// the controller write), and React renders the screen from a copy of them (VehicleDetail.tsx). The kit helpers
// below are the face form of podview/ui/kit.js (applyKitComponent, syncKitButtonContent, syncKitPowerToggle and
// the disclosure/choice-group setters), so a control keeps exactly the attributes the old renderer gave it.

export type Attrs = Record<string, string>;

// Kit icon + label inside a button (syncKitButtonContent). `icon` undefined keeps the previous icon.
export interface ButtonContent {
  label: string;
  icon: string | undefined;
  // The icon's source as a CSS custom property, kept after the icon is cleared (as the old span kept its style).
  source: string | null;
}

export interface Face {
  hidden: boolean;
  disabled: boolean;
  text: string;
  content: ButtonContent | null;
  attrs: Attrs;
}

export interface GroupFaces {
  detail: Face;
  status: Face;
  body: Face;
  rows: Face[];
  values: Face[];
}

export interface SeatGroupFaces {
  node: Face;
  inputs: Face[];
}

export interface VehicleScreen {
  title: string;
  hero: Face;
  carLevel: string;
  heroIcon: Face;
  status: Face;
  connectionNote: Face;
  content: Face;
  figure: Face;
  image: Face;
  context: Face;
  measurements: Face;
  batteryGroup: Face;
  battery: {number: string; unit: boolean};
  rangeGroup: Face;
  rangeValue: Face;
  cabinValue: Face;
  powerGroup: Face;
  powerValue: Face;
  finishGroup: Face;
  finishValue: Face;
  rail: Face;
  meter: Face;
  meterValue: number | null;
  climate: GroupFaces;
  access: GroupFaces;
  health: GroupFaces;
  more: GroupFaces;
  climateBatteryNote: Face;
  climateToggle: Face;
  temperatureControls: Face;
  temperatureValue: Face;
  temperatureDown: Face;
  temperatureUp: Face;
  live: {lock: Face; unlock: Face; climateOn: Face; climateOff: Face};
  lockControls: Face;
  lockButton: Face;
  rearTrunkButton: Face;
  climateActions: Face;
  defrostButton: Face;
  seatControls: {node: Face; trigger: Face; description: Face; panel: Face};
  seatGroups: {driver: SeatGroupFaces; passenger: SeatGroupFaces};
  accessFeedback: Face;
  climateFeedback: Face;
  secondary: Face;
  history: Face;
  timeline: Face;
  empty: Face;
  confirmTitle: Face;
  confirmationNote: Face;
  lockConfirm: Face;
  lockCancel: Face;
  // Grows by one for each finite charge acknowledgement; the meter's layout effect plays it.
  chargeCue: number;
}

export type LiveAction = keyof VehicleScreen['live'];
export type Seat = keyof VehicleScreen['seatGroups'];

export function face(attrs: Attrs = {}, {text = '', hidden = false} = {}): Face {
  return {hidden, disabled: false, text, content: null, attrs};
}

export function setAttr(target: Face, name: string, value: string | boolean | number): void {
  target.attrs[name] = String(value);
}

export function removeAttr(target: Face, name: string): void {
  if (name in target.attrs) target.attrs = Object.fromEntries(Object.entries(target.attrs).filter(([k]) => k !== name));
}

export interface KitOptions {
  variant?: string;
  identity?: string;
  label?: string;
  selected?: boolean;
  feedback?: 'label' | 'progress';
  tone?: 'neutral' | 'warning' | 'danger';
  loading?: boolean;
}

// applyKitComponent for a face. The kit classes are static in the markup; the data and aria attributes live here.
export function kit(target: Face, type: string, options: KitOptions = {}): Face {
  setAttr(target, 'data-kit', type);
  if (options.variant !== undefined) setAttr(target, 'data-kit-variant', options.variant);
  if (options.identity !== undefined) setAttr(target, 'data-kit-identity', options.identity);
  if (options.label !== undefined) setAttr(target, 'aria-label', options.label);
  if (options.selected !== undefined) setAttr(target, type === 'toggle' ? 'aria-checked' : 'aria-pressed', options.selected);
  if (options.feedback !== undefined) setAttr(target, 'data-feedback', options.feedback);
  if (options.tone !== undefined) setAttr(target, 'data-tone', options.tone);
  if (options.loading !== undefined) setAttr(target, 'aria-busy', options.loading);
  if (type === 'toggle') setAttr(target, 'role', 'switch');
  return target;
}

// syncKitButtonContent for a face: the first call turns plain text into the icon + label anatomy.
export function buttonContent(target: Face, {label, icon}: {label: string; icon?: string}): void {
  if (icon !== undefined && icon !== '' && !/^assets\/icons\/[a-z0-9-]+\.svg$/.test(icon)) {
    throw new TypeError('Button icon must be a canonical local asset');
  }
  if (!target.content) {
    target.content = {label: '', icon: undefined, source: null};
    target.text = '';
    setAttr(target, 'data-kit-content', 'icon-label');
  }
  const next = icon ?? target.content.icon;
  target.content = {
    label,
    icon: next,
    source: next ? `url("${next}")` : target.content.source,
  };
}

// syncKitPowerToggle: checked always means the observed state is on.
export function powerToggle(target: Face, {checked = false}: {checked?: boolean} = {}): void {
  kit(target, 'toggle', {variant: 'power', selected: checked, label: 'Klima', feedback: 'progress'});
  buttonContent(target, {label: checked ? 'Tændt' : 'Slukket', icon: 'assets/icons/power.svg'});
}

// The old renderer's `assign`: a kit icon + label button changes its label, anything else its text.
export function assign(target: Face, text: string): void {
  if (target.attrs['data-kit-content'] === 'icon-label') {
    buttonContent(target, {label: text});
    return;
  }
  target.text = text;
}

// The visible text of a face, as the old node's textContent read it.
export function faceText(target: Face): string {
  return target.content ? target.content.label : target.text;
}

const button = (variant: 'primary' | 'secondary', text = '') =>
  kit(face({}, {text}), 'button', {identity: 'neutral', variant});

const group = (rows: number): GroupFaces => ({
  detail: face(),
  status: face({'data-kit-text': 'body'}),
  body: face(),
  rows: Array.from({length: rows}, () => face({'data-kit': 'listrow'})),
  values: Array.from({length: rows}, () => face()),
});

const seatGroup = (): SeatGroupFaces => ({
  node: face(),
  inputs: Array.from({length: 4}, () => face()),
});

// The screen as the old constructor left it, before its first render.
export function initialScreen(): VehicleScreen {
  const iconButton = (text: string, label: string) => {
    const target = kit(button('secondary', text), 'button', {variant: 'icon'});
    buttonContent(target, {label: text});
    setAttr(target, 'aria-label', label);
    return target;
  };
  const live = (label: string, slot?: string) => {
    const target = button('secondary');
    target.hidden = true;
    setAttr(target, 'data-live-vehicle-label', label);
    if (slot) setAttr(target, 'data-kit-slot', slot);
    return target;
  };
  const feedback = () =>
    face({
      'data-kit': 'listrow',
      'data-kit-variant': 'feedback',
      role: 'status',
      'aria-live': 'polite',
      'data-kit-slot': 'status',
    });
  const screen: VehicleScreen = {
    title: '',
    hero: face({'data-kit': 'hero', 'data-kit-identity': 'tesla'}),
    carLevel: '',
    heroIcon: face({'data-kit': 'icon'}, {hidden: true}),
    status: face(),
    connectionNote: face({}, {text: 'Forbind bilen i Home Assistant for at se status her.'}),
    content: face(),
    figure: face(),
    image: face(),
    context: face(),
    measurements: face(),
    batteryGroup: face(),
    battery: {number: '', unit: false},
    rangeGroup: face(),
    rangeValue: face(),
    cabinValue: face({}, {hidden: true}),
    powerGroup: face(),
    powerValue: face(),
    finishGroup: face(),
    finishValue: face(),
    rail: face(),
    meter: face(),
    meterValue: null,
    climate: group(4),
    access: group(3),
    health: group(3),
    more: group(5),
    climateBatteryNote: face({}, {hidden: true}),
    climateToggle: kit(face({'data-kit-slot': 'header-action'}), 'toggle', {variant: 'power'}),
    temperatureControls: face(),
    temperatureValue: face(),
    temperatureDown: iconButton('−', 'Sænk temperatur'),
    temperatureUp: iconButton('+', 'Hæv temperatur'),
    live: {
      lock: kit(live('Lås bilen'), 'button', {variant: 'secondary', tone: 'neutral'}),
      unlock: kit(live('Lås op'), 'button', {variant: 'primary', tone: 'danger'}),
      climateOn: kit(live('Tænd klima', 'header-action'), 'button', {variant: 'secondary'}),
      climateOff: kit(live('Sluk klima', 'header-action'), 'button', {variant: 'secondary'}),
    },
    lockControls: face(),
    lockButton: button('secondary'),
    rearTrunkButton: button('secondary'),
    climateActions: face(),
    defrostButton: button('secondary', 'Afrim ruder'),
    seatControls: {
      node: face(),
      trigger: face({'data-kit': 'listrow', 'aria-expanded': 'false'}),
      description: face(),
      panel: face({}, {hidden: true}),
    },
    seatGroups: {driver: seatGroup(), passenger: seatGroup()},
    accessFeedback: feedback(),
    climateFeedback: feedback(),
    secondary: face(),
    history: face(),
    timeline: face(),
    empty: face(),
    confirmTitle: face(),
    confirmationNote: face(),
    lockConfirm: button('primary'),
    lockCancel: button('secondary', 'Annuller'),
    chargeCue: 0,
  };
  // The disclosure starts without a summary (createKitDisclosure's setDescription('')).
  const {trigger, description} = screen.seatControls;
  setAttr(trigger, 'data-has-summary', false);
  description.hidden = true;
  setAttr(description, 'aria-hidden', true);
  for (const target of [
    screen.lockButton,
    screen.rearTrunkButton,
    screen.defrostButton,
    screen.temperatureDown,
    screen.temperatureUp,
  ]) {
    kit(target, 'button', {feedback: 'progress'});
  }
  powerToggle(screen.climateToggle);
  return screen;
}
