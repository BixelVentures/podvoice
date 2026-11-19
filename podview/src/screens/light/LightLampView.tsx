// Lys: the controller the pre-React shell (widget-view.js) drives for the lamp rows (div.light-lamp-list, which the
// shell places in the room page's »Lamper« disclosure or after its lamp picker). Same public API as the old
// light-lamp-view.js: render(light) projects the current light device, cleanup() disarms every row, and each row
// (rows: id -> entry) keeps its named parts (node, heading/toggle, icon, name, state, field) and its binding.
// The rows have no effect authority: every tap and every released slider gesture re-reads the exact lamp through
// the host and is dropped when its captured binding no longer matches (a gesture keeps its source until release;
// a queued brightness behind a pending command stays editable; a lamp switching on takes the level behind it).
// React draws the rows (LampList.tsx) synchronously (flushSync); the kit slider (bindKitSliderField) keeps each
// slider's gesture, draft and paint. A row once shown stays in place (hidden) when its lamp leaves the scope.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {bindKitSliderField} from '../../../ui/kit.js';
import type {KitSliderField, KitSliderModel} from '../../../ui/kit.js';
import {lampRows} from './model';
import type {LampBinding, LampRow, LightDevice, LightHost} from './model';
import {LampList} from './LampList';
import type {LampFace} from './LampList';

export interface LampEntry {
  id: string;
  node: HTMLElement;
  heading: HTMLButtonElement;
  toggle: HTMLButtonElement;
  icon: HTMLImageElement;
  name: HTMLElement;
  state: HTMLElement;
  field: KitSliderField<LampBinding | null>;
  binding: LampBinding | null;
  model: KitSliderModel;
}

function part<T extends Element>(node: ParentNode, selector: string, type: abstract new () => T): T {
  const found = node.querySelector(selector);
  if (!(found instanceof type)) throw Error(`Lamp row is missing ${selector}`);
  return found;
}

export class LightLampView {
  host: LightHost;
  document: Document;
  node: HTMLElement;
  rows = new Map<string, LampEntry>();
  // What each row shows, in the order the rows were first shown.
  private faces = new Map<string, LampFace>();
  private reactRoot: Root | undefined;

  constructor(host: LightHost) {
    this.host = host;
    this.document = host.ownerDocument ?? globalThis.document;
    this.node = this.document.createElement('div');
    this.node.className = 'light-lamp-list';
  }

  snapshot(light: LightDevice | null | undefined): LampRow[] {
    return lampRows(this.host, light);
  }

  current(id: string): LampRow | undefined {
    return this.snapshot(this.host.currentLightDevice?.()).find(row => row.id === id);
  }

  matches(binding: LampBinding | null | undefined, current: LampRow | undefined): boolean {
    return !!binding && !!current?.binding && binding.key === current.binding.key
      && binding.transport === current.binding.transport;
  }

  matchesQueuedBrightness(binding: LampBinding | null | undefined, current: LampRow | undefined): boolean {
    return binding?.canQueueBrightness === true && binding.inputQueue?.blocked !== true && !!current?.binding
      && binding.authorityKey === current.binding.authorityKey && binding.transport === current.binding.transport;
  }

  toggle(entry: LampEntry) {
    const current = this.current(entry.id);
    if (!current?.binding || !this.matches(entry.binding, current) || current.binding.canQueueBrightness) {
      entry.field.cancelDraft();
      this.render(this.host.currentLightDevice?.());
      return;
    }
    if (current.binding.local) {
      this.host.dispatch?.({type: 'light-toggle', sessionId: current.binding.sessionId,
        taskId: current.binding.taskId, revision: current.binding.revision, optionId: entry.id});
    } else void this.host.actCurrentLight?.(current.on ? 'turn_off' : 'turn_on', {}, {entityId: entry.id});
    this.render(this.host.currentLightDevice?.());
  }

  commit(entry: LampEntry, value: number, binding: LampBinding | null | undefined) {
    const current = this.current(entry.id);
    const sameBinding = binding?.canQueueBrightness
      ? this.matchesQueuedBrightness(binding, current) : this.matches(binding, current);
    if (!Number.isInteger(value) || value < 0 || value > 100 || !current?.dimmable || !current.binding
      || !sameBinding) {
      entry.field.cancelDraft();
      this.render(this.host.currentLightDevice?.());
      return;
    }
    if (current.binding.local) {
      this.host.dispatch?.({type: 'light-brightness', sessionId: current.binding.sessionId,
        taskId: current.binding.taskId, revision: current.binding.revision, optionId: entry.id, value});
    } else void this.host.actCurrentLight?.('brightness', {percent: value}, {entityId: entry.id});
    this.render(this.host.currentLightDevice?.());
  }

  render(light: LightDevice | null | undefined): HTMLElement {
    const rows = this.snapshot(light);
    const visible = new Set(rows.map(row => row.id));
    if (this.node.hidden !== !rows.length) this.node.hidden = !rows.length;
    const command = this.host.lightCommandFeedback;
    // Per row, before drawing: the binding the row keeps, whether its draft ends, and the slider's model.
    const steps: {id: string; cancel: boolean; model: KitSliderModel}[] = [];
    for (const row of rows) {
      const entry = this.rows.get(row.id);
      const current = this.current(row.id);
      const binding = this.matches(row.binding, current) ? row.binding : null;
      const previous = entry ? entry.binding : undefined;
      const cancel = (previous?.key !== binding?.key || previous?.transport !== binding?.transport)
        && !this.matchesQueuedBrightness(previous, current);
      if (entry) entry.binding = binding;
      const busy = !!command && command.target?.entityId === row.id
        && ['turn_on', 'turn_off'].includes(command.action ?? '');
      const status = row.on === null ? (row.unavailable ? 'Ikke tilgængelig' : 'Status ukendt')
        : row.stale ? `${row.on ? 'Tændt' : 'Slukket'} · ikke opdateret` : row.on ? 'Tændt' : 'Slukket';
      // The toggle is enabled exactly when the lamp has a binding and no brightness is queued behind a pending
      // command. (light-lamp-view.js left the toggle as it was when a live binding had no pending command at all,
      // so a toggle disabled during a stale moment stayed locked after the lamp became current again.)
      const disabled = !binding || !!binding.canQueueBrightness;
      const pending = command?.action === 'brightness' && command.target?.entityId === row.id;
      const value = pending && Number.isInteger(command.requestedPercent)
        ? command.requestedPercent as number : row.level;
      // Lærred »A-Lys« v193: the level sits beside the slider in mono; a lamp that is off or whose state is unknown
      // keeps its slider dimmed and inert (switch it on first; a pending turn-on counts). Unknown »—«, off »0 %«.
      const live = (row.on === true || row.switchingOn) && !row.stale;
      this.faces.set(row.id, {id: row.id, hidden: false, name: row.name, state: status,
        toggle: {label: `Tænd/sluk ${row.name}`, busy: busy && !!binding, disabled, ariaDisabled: disabled,
          checked: row.on},
        levelHidden: !row.dimmable, live});
      const valueText = value === null || row.stale ? '—' : `${String(value)} %`;
      steps.push({id: row.id, cancel, model: {value, valueText, scope: '',
        disabled: !binding || !row.dimmable || row.level === null || !live, pending,
        editableWhilePending: binding?.canQueueBrightness === true}});
      if (!entry) this.pendingBindings.set(row.id, binding);
    }
    for (const [id, face] of this.faces) {
      if (!visible.has(id)) this.faces.set(id, {...face, hidden: true, toggle: {...face.toggle, disabled: true}});
    }
    this.draw();
    for (const step of steps) {
      const entry = this.rows.get(step.id);
      if (!entry) continue;
      if (step.cancel) entry.field.cancelDraft();
      entry.model = step.model;
      entry.field.setModel(entry.model);
    }
    for (const [id, entry] of this.rows) {
      if (visible.has(id)) continue;
      entry.binding = null;
      entry.field.cancelDraft();
      entry.field.setModel({...entry.model, disabled: true});
    }
    return this.node;
  }

  cleanup() {
    for (const [id, face] of this.faces) this.faces.set(id, {...face, toggle: {...face.toggle, disabled: true}});
    if (this.faces.size) this.draw();
    for (const entry of this.rows.values()) {
      entry.binding = null;
      entry.field.cancelDraft();
      entry.field.setModel({...entry.model, disabled: true});
    }
  }

  // Bindings computed for rows drawn for the first time, taken over once their elements exist.
  private pendingBindings = new Map<string, LampBinding | null>();

  private readonly onToggle = (id: string) => {
    const entry = this.rows.get(id);
    if (entry) this.toggle(entry);
  };

  private draw() {
    this.reactRoot ??= createRoot(this.node);
    const reactRoot = this.reactRoot;
    const lamps = [...this.faces.values()];
    flushSync(() => {
      reactRoot.render(<LampList lamps={lamps} onToggle={this.onToggle} />);
    });
    for (const node of this.node.children) {
      const id = node instanceof HTMLElement ? node.dataset.lampId : undefined;
      if (id === undefined || this.rows.has(id) || !(node instanceof HTMLElement)) continue;
      this.rows.set(id, this.entry(id, node));
    }
  }

  private entry(id: string, node: HTMLElement): LampEntry {
    const heading = part(node, ':scope > button', HTMLButtonElement);
    const fieldNode = part(node, ':scope > .light-lamp-level', HTMLElement);
    const entry: LampEntry = {
      id,
      node,
      heading,
      toggle: heading,
      icon: part(heading, '.light-lamp-icon', HTMLImageElement),
      name: part(heading, '.light-lamp-name', HTMLElement),
      state: part(heading, '.light-lamp-state', HTMLElement),
      binding: this.pendingBindings.get(id) ?? null,
      model: {value: null},
      field: bindKitSliderField<LampBinding | null>({
        node: fieldNode,
        label: part(fieldNode, ':scope > label', HTMLLabelElement),
        output: part(fieldNode, ':scope > output', HTMLOutputElement),
        description: part(fieldNode, ':scope > p', HTMLElement),
        input: part(fieldNode, ':scope > input', HTMLInputElement),
      }, {
        getContext: () => entry.binding,
        onCommit: (value, binding) => {
          this.commit(entry, value, binding);
        },
      }),
    };
    this.pendingBindings.delete(id);
    return entry;
  }
}
