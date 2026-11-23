// Test support (not a test): the vehicle screen mounted as the shell mounts it, on its own store with the test's
// owners, and named parts of the rendered DOM for the assertions (status, lockButton, seatGroups, …). Everything the
// tests do goes through what the shell and the user do: render (the shell's data), clicks and native events (wrapped
// in act so React has drawn before the next assertion), and the owners' callbacks.
import {act} from 'react';
import {mountScreen} from '../../app/mount';
import type {VehicleProposal} from './live';
import type {PreviewEvent} from './model';
import {LIVE_ACTIONS, seatControl} from './rules';
import type {Control, Family, LiveAction, Seat} from './rules';
import {controlsEnabled, createVehicleStore} from './store';
import type {VehiclePorts, VehicleRenderOptions, VehicleStore} from './store';
import {VehicleScreen} from './VehicleScreen';

type Args = Record<string, unknown>;

export interface TestVehicleOptions {
  onAction?: (event: PreviewEvent, options: {signal: AbortSignal; onProgress: (progress?: object) => void}) => unknown;
  onVehicleSetup?: VehiclePorts['onVehicleSetup'];
  onVehicleSend?: VehiclePorts['onVehicleSend'];
  onVehicleCancel?: VehiclePorts['onVehicleCancel'];
}

const part = <T extends Element = HTMLElement>(node: ParentNode, selector: string): T => {
  const found = node.querySelector<T>(selector);
  if (!found) throw Error(`Vehicle screen is missing ${selector}`);
  return found;
};

// A click as the user makes it, drawn before the next assertion.
export function click(node: Element) {
  act(() => {
    (node as HTMLElement).click();
  });
}
export function fire(node: Element, type: string) {
  act(() => {
    node.dispatchEvent(new Event(type));
  });
}
// Lets pending promise callbacks run and React draw their result.
export async function tick() {
  await act(async () => {
    await Promise.resolve();
  });
}

interface Group {
  detail: HTMLElement;
  status: HTMLElement;
  body: HTMLElement;
  values: {id: string; value: HTMLElement}[];
}

export class TestVehicleView {
  readonly root: HTMLElement;
  readonly store: VehicleStore;
  onAction: NonNullable<TestVehicleOptions['onAction']>;

  constructor(root: HTMLElement, options: TestVehicleOptions = {}) {
    this.root = root;
    this.onAction = options.onAction ?? (() => undefined);
    this.store = createVehicleStore({
      onAction: (event, {signal, onProgress}) =>
        this.onAction(event, {
          signal,
          onProgress: progress => {
            act(() => {
              onProgress(progress);
            });
          },
        }),
      ...(options.onVehicleSetup ? {onVehicleSetup: options.onVehicleSetup} : {}),
      ...(options.onVehicleSend ? {onVehicleSend: options.onVehicleSend} : {}),
      ...(options.onVehicleCancel ? {onVehicleCancel: options.onVehicleCancel} : {}),
    });
    act(() => {
      mountScreen(root, <VehicleScreen store={this.store} container={root} />);
    });
  }

  // ---- What the shell and the tests do ----

  render(value?: unknown, options: VehicleRenderOptions = {}) {
    let model;
    act(() => {
      model = this.store.getState().render(value, options);
    });
    return model;
  }
  renderControls() {
    act(() => {
      this.store.getState().refresh();
    });
  }
  cleanup() {
    act(() => {
      this.store.getState().dispose();
    });
  }
  dismissConfirmation(options?: {restoreFocus?: boolean; resetDraft?: boolean}) {
    act(() => {
      this.store.getState().dismissConfirmation(options);
    });
  }
  async beginVehicle(action: string, trigger: Element | null, args: Args = {}) {
    await act(async () => {
      await this.store.getState().beginVehicle(action, this.control(trigger), args);
    });
  }
  async finishVehicle(proposal: VehicleProposal, trigger: Element | null) {
    // The car's answer may come from the test's own wait: drawn before the next assertion too.
    const operation = proposal.operation;
    const wait = operation.waitForObservation;
    if (wait) {
      operation.waitForObservation = callback =>
        wait(() => {
          act(() => {
            callback();
          });
        });
    }
    await act(async () => {
      await this.store.getState().finishVehicle(proposal, this.control(trigger));
    });
  }
  hasDraft() {
    return this.store.getState().hasDraft();
  }

  // ---- The store's state ----

  get model() {
    return this.store.getState().model;
  }
  get controlsEnabled() {
    return controlsEnabled(this.store.getState());
  }
  get vehicleActions() {
    return this.store.getState().input.vehicleActions;
  }
  get liveVehicleCommands() {
    return new Map(Object.entries(this.store.getState().commands)) as Map<Family, unknown>;
  }
  get draft() {
    return this.store.getState().draft;
  }
  get pending() {
    return this.store.getState().preview;
  }
  get commandResult() {
    return this.store.getState().commandResult;
  }
  set commandResult(value) {
    this.store.setState({commandResult: value});
  }
  get confirmAction() {
    return this.store.getState().confirm?.intent ?? null;
  }
  get chargePresentation() {
    return this.store.getState().charge;
  }

  // ---- The rendered parts ----

  get title() {
    return part(this.root, ':scope > header h1');
  }
  get hero() {
    return part(this.root, ':scope > .vehicle-hero');
  }
  get status() {
    return part(this.hero, ':scope > .vehicle-status');
  }
  get connectionNote() {
    return part(this.hero, ':scope > .vehicle-connection-note');
  }
  get content() {
    return part(this.hero, ':scope > .vehicle-content');
  }
  get heroIcon() {
    return part<HTMLImageElement>(this.hero, ':scope > [data-kit-slot="icon"]');
  }
  get figure() {
    return part(this.content, '.vehicle-artwork');
  }
  get image() {
    return part<HTMLImageElement>(this.figure, '.vehicle-image');
  }
  get context() {
    return part(this.figure, '.vehicle-context');
  }
  get measurements() {
    return part(this.content, '.vehicle-measurements');
  }
  get metrics() {
    return part(this.measurements, '.vehicle-metrics');
  }
  private metric(index: number) {
    const found = this.metrics.children[index];
    if (!(found instanceof HTMLElement)) throw Error('Vehicle screen is missing a metric');
    return found;
  }
  get batteryGroup() {
    return this.metric(0);
  }
  get batteryValue() {
    return part(this.batteryGroup, 'dd');
  }
  get rangeGroup() {
    return this.metric(1);
  }
  get rangeValue() {
    return part(this.rangeGroup, '.vehicle-range-value');
  }
  get powerGroup() {
    return this.metric(2);
  }
  get powerValue() {
    return part(this.powerGroup, 'dd');
  }
  get finishGroup() {
    return this.metric(3);
  }
  get finishValue() {
    return part(this.finishGroup, 'dd');
  }
  get rail() {
    return part(this.measurements, '.vehicle-battery-rail');
  }
  get meter() {
    return part<HTMLMeterElement>(this.rail, 'meter');
  }
  get secondary() {
    return part(this.root, ':scope > .vehicle-secondary');
  }
  get controlTiles() {
    return part(this.secondary, '.vehicle-control-tiles');
  }
  private groups = new WeakMap<HTMLElement, Group>();
  // One group object per rendered group (the same parts compare equal).
  private group(detail: HTMLElement, ids: string[]): Group {
    const known = this.groups.get(detail);
    if (known) return known;
    const group: Group = {
      detail,
      status: part(detail, ':scope > :first-child > small'),
      body: part(detail, ':scope > dl'),
      values: [...detail.querySelectorAll<HTMLElement>(':scope > dl > div > dd')].map((value, index) => ({
        id: ids[index] ?? '',
        value,
      })),
    };
    this.groups.set(detail, group);
    return group;
  }
  private get accessTile() {
    return this.controlTiles.children[0] as HTMLElement;
  }
  private get climateTile() {
    return this.controlTiles.children[1] as HTMLElement;
  }
  get access() {
    return this.group(this.accessTile, ['locks', 'luggage', 'windows']);
  }
  get climate() {
    return this.group(this.climateTile, ['state', 'temperature', 'defrost', 'seats']);
  }
  get health() {
    return this.group(this.secondary.querySelectorAll<HTMLElement>(':scope > details')[0] as HTMLElement,
      ['tires', 'sentry', 'software']);
  }
  get more() {
    return this.group(this.secondary.querySelectorAll<HTMLElement>(':scope > details')[1] as HTMLElement,
      ['wake', 'signal', 'homelink', 'keyless', 'media']);
  }
  get capabilities() {
    return [this.access, this.health, this.more];
  }
  get climateBatteryNote() {
    return part(this.climateTile, ':scope > .vehicle-climate-note');
  }
  get climateToggle() {
    return part<HTMLButtonElement>(this.climateTile, ':scope > [data-kit="toggle"]');
  }
  get temperatureControls() {
    return part(this.climateTile, ':scope > .vehicle-temperature-controls');
  }
  get temperatureValue() {
    return part<HTMLOutputElement>(this.temperatureControls, 'output');
  }
  get temperatureDown() {
    return this.temperatureControls.querySelectorAll('button')[0] as HTMLButtonElement;
  }
  get temperatureUp() {
    return this.temperatureControls.querySelectorAll('button')[1] as HTMLButtonElement;
  }
  get lockControls() {
    return part(this.accessTile, ':scope > .vehicle-lock-controls');
  }
  private lockControl(index: number) {
    return this.lockControls.querySelectorAll('button')[index] as HTMLButtonElement;
  }
  get liveVehicleButtons(): Record<LiveAction, HTMLButtonElement> {
    const [climateOn, climateOff] = this.climateTile.querySelectorAll<HTMLButtonElement>(
      ':scope > button[data-live-vehicle-label]',
    );
    return {
      lock: this.lockControl(0),
      unlock: this.lockControl(1),
      climateOn: climateOn as HTMLButtonElement,
      climateOff: climateOff as HTMLButtonElement,
    };
  }
  get lockButton() {
    return this.lockControl(2);
  }
  get rearTrunkButton() {
    return this.lockControl(3);
  }
  get climateActions() {
    return part(this.climateTile, ':scope > .vehicle-climate-actions');
  }
  get defrostButton() {
    return part<HTMLButtonElement>(this.climateActions, 'button');
  }
  get seatControls() {
    const node = part(this.climateTile, ':scope > .pv-kit-disclosure');
    return {
      node,
      trigger: part<HTMLButtonElement>(node, ':scope > button'),
      panel: part(node, ':scope > [role="region"]'),
    };
  }
  get seatGroups(): Record<Seat, {node: HTMLFieldSetElement; inputs: HTMLInputElement[]}> {
    const [driver, passenger] = this.seatControls.panel.querySelectorAll('fieldset');
    const group = (node: HTMLFieldSetElement | undefined) => {
      if (!node) throw Error('Vehicle screen is missing a seat group');
      return {node, inputs: [...node.querySelectorAll('input')]};
    };
    return {driver: group(driver), passenger: group(passenger)};
  }
  get accessFeedback() {
    return part(this.accessTile, ':scope > h2 > [data-kit-slot="status"]');
  }
  get climateFeedback() {
    return part(this.climateTile, ':scope > h2 > [data-kit-slot="status"]');
  }
  get commandNote() {
    return this.store.getState().commandNote === 'access' ? this.accessFeedback : this.climateFeedback;
  }
  get history() {
    return part(this.root, ':scope > .vehicle-history');
  }
  get timeline() {
    return part<HTMLElement & {data?: {items: unknown[]; readOnly: boolean}}>(this.history, 'pv-activity-timeline');
  }
  get empty() {
    return part(this.history, '.robot-history-note');
  }
  get confirmation() {
    return part<HTMLDialogElement>(this.root, ':scope > dialog');
  }
  get confirmTitle() {
    return part(this.confirmation, '#vehicle-confirm-title');
  }
  get confirmationNote() {
    return part(this.confirmation, '#vehicle-confirm-description');
  }
  get lockCancel() {
    return this.confirmation.querySelectorAll<HTMLButtonElement>('.pv-dialog-actions > button')[0] as HTMLButtonElement;
  }
  get lockConfirm() {
    return this.confirmation.querySelectorAll<HTMLButtonElement>('.pv-dialog-actions > button')[1] as HTMLButtonElement;
  }

  // The control an element is (a command's trigger).
  private control(node: Element | null): Control | null {
    if (!node) return null;
    const buttons = this.liveVehicleButtons;
    for (const action of LIVE_ACTIONS) if (buttons[action] === node) return action;
    const named: [Element, Control][] = [
      [this.climateToggle, 'climateToggle'],
      [this.temperatureDown, 'temperatureDown'],
      [this.temperatureUp, 'temperatureUp'],
      [this.lockButton, 'lockButton'],
      [this.rearTrunkButton, 'rearTrunkButton'],
      [this.defrostButton, 'defrostButton'],
    ];
    const found = named.find(([element]) => element === node);
    if (found) return found[1];
    for (const [seat, group] of Object.entries(this.seatGroups) as [Seat, {inputs: HTMLInputElement[]}][]) {
      const level = group.inputs.indexOf(node as HTMLInputElement);
      if (level >= 0) return seatControl(seat, level);
    }
    return null;
  }
}
