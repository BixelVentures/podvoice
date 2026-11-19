// Radio: the controller the pre-React shell (widget-view.js) drives for the radio screen (#radio-view). Same
// public API as the old radio-view.js: render(input) projects the shell's radio state, explicit station choices go
// to onSelect, and the named parts (hero, list, stationTitle, ...) stay the same elements for the shell and tests.
// The parent owns navigation and the shared right-hand PlayerView; the source owner alone requests playback
// (live: LiveRadioView in live-radio-view.js). Rendering is React, synchronous (flushSync), so the page is current
// when a call returns, as before. An unchanged input renders nothing.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {radioStation, stations} from '../../../radio-model.js';
import type {RadioStation} from '../../../radio-model.js';
import {applyKitTemplate} from '../../../ui/kit.js';
import {radioDefaults, radioScreen, radioState, stationPosition} from './model';
import type {RadioInput, RadioListData, RadioState} from './model';
import {RadioDetail} from './RadioDetail';

export {stations};

export interface RadioViewOptions {
  onSelect?: (stationId: string, station: RadioStation) => void;
  onOpenPlayer?: () => void;
}

type ChoiceList = HTMLElement & {data: RadioListData};

interface PvActionDetail {
  action_id?: string;
  option_id?: string | null;
}

const ignore = () => undefined;

function part<T extends Element>(node: ParentNode, selector: string, type: abstract new () => T): T {
  const found = node.querySelector(selector);
  if (!(found instanceof type)) throw Error(`Radio screen is missing ${selector}`);
  return found;
}

export class RadioView {
  root: HTMLElement;
  onSelect: (stationId: string, station: RadioStation) => void;
  onOpenPlayer: () => void;
  state: RadioState | {live: boolean; connected: boolean; blocked: boolean; stationId: string | null;
    selectable?: undefined; playing?: undefined; pending?: undefined};
  renderSignature: string | undefined;
  // Named parts, found once after the first render.
  header!: HTMLElement;
  subtitle!: HTMLElement;
  hero!: HTMLElement;
  stationArt!: HTMLImageElement;
  stationStatusLine!: HTMLElement;
  stationTitle!: HTMLElement;
  stationStatus!: HTMLElement;
  feedback!: HTMLElement;
  scale!: HTMLElement;
  marks!: HTMLElement[];
  needle!: HTMLElement;
  list: ChoiceList | undefined;
  playerButton!: HTMLButtonElement;
  private reactRoot: Root | undefined;
  private art = '';
  private needleLeft = '';
  private destroyed = false;
  private readonly handleAction: (event: Event) => void;

  constructor(root: HTMLElement, {onSelect = ignore, onOpenPlayer = ignore}: RadioViewOptions = {}) {
    this.root = root;
    applyKitTemplate(root, 'detail');
    this.onSelect = onSelect;
    this.onOpenPlayer = onOpenPlayer;
    this.state = {live: true, connected: false, blocked: false, stationId: null};
    this.handleAction = event => {
      const detail = (event as CustomEvent<PvActionDetail | undefined>).detail;
      if (event.target !== this.list || detail?.action_id !== 'choose') return;
      event.stopPropagation();
      if (!this.state.selectable) return;
      const station = radioStation(detail.option_id);
      if (!station) return;
      const same = station.id === this.state.stationId;
      if (same && (!this.state.live || this.state.playing === true && !this.state.pending)) return;
      if (!this.state.live) this.render({...this.state, stationId: station.id, playing: null});
      this.onSelect(station.id, station);
    };
    root.addEventListener('pv-action', this.handleAction);
  }

  // The redundant player row is always hidden, so it never navigates; kept for the shell's contract.
  readonly openPlayer = () => {
    if (this.destroyed || this.playerButton.hidden || !this.state.stationId) return;
    this.onOpenPlayer();
  };

  build() {
    this.root.replaceChildren();
    this.reactRoot = createRoot(this.root);
  }

  render(input: RadioInput = {}): this {
    if (!this.reactRoot) this.build();
    const values = radioDefaults(input);
    const {live, connected, blocked, stationId, playing, enabled, canStart, pending, pendingStationId, feedback,
      status, setupIssue, speaker} = values;
    const selected = !live || enabled ? radioStation(stationId)?.id ?? null : null;
    const playback = selected && typeof playing === 'boolean' ? playing : null;
    const signature = JSON.stringify([live, connected, blocked, selected, playback, enabled, canStart, pending,
      pendingStationId, feedback, status, setupIssue, speaker]);
    if (this.renderSignature === signature) return this;
    this.renderSignature = signature;
    this.state = radioState(values, selected, playback);
    const model = radioScreen(values, selected, playback, this.state.selectable);
    // The logo and the needle keep the last station shown while hidden, so they never jump on return.
    const station = model.hero.station;
    if (station) {
      this.art = `assets/radio-${station.id}.svg`;
      this.needleLeft = stationPosition(model.hero.index);
    }
    const reactRoot = this.reactRoot;
    flushSync(() => {
      reactRoot?.render(
        <RadioDetail model={model} art={this.art} needleLeft={this.needleLeft} onOpenPlayer={this.openPlayer} />,
      );
    });
    if (!this.list) this.name();
    return this;
  }

  private name() {
    const root = this.root;
    this.header = part(root, ':scope > header', HTMLElement);
    this.subtitle = part(this.header, 'p', HTMLElement);
    this.hero = part(root, ':scope > .radio-hero', HTMLElement);
    this.stationArt = part(this.hero, '.radio-hero-art', HTMLImageElement);
    this.stationStatusLine = part(this.hero, '.radio-hero-status', HTMLElement);
    this.stationTitle = part(this.hero, '[data-kit-slot="title"]', HTMLElement);
    this.stationStatus = part(this.hero, '[data-kit-slot="body"]', HTMLElement);
    this.feedback = part(this.hero, '[data-kit-slot="feedback"]', HTMLElement);
    this.scale = part(this.hero, '.radio-scale', HTMLElement);
    this.marks = [...this.scale.querySelectorAll<HTMLElement>(':scope > .radio-scale-mark')];
    this.needle = part(this.scale, '.radio-scale-needle', HTMLElement);
    this.playerButton = part(root, ':scope > .radio-open-player', HTMLButtonElement);
    this.list = part(root, ':scope > pv-choice-list', HTMLElement) as ChoiceList;
  }

  destroy() {
    this.destroyed = true;
    this.root.removeEventListener('pv-action', this.handleAction);
  }
}
