// Lys: the controller the pre-React shell (widget-view.js) drives for the room page (section.light-room-view after
// the shell's room picker). Same public API as the old light-room-view.js: render(light) projects the current light
// device, cleanup() cancels a pending reveal, and the named parts (node, list, notice, toolbar, home, panel,
// panelHeader, panelHeading, panelStatus, kicker, empty, refresh, rows, navigation) stay the same elements for the
// shell and tests. The host owns every real effect: a room tap dispatches (local example) or asks the host to act
// on the live light; nothing here sends on its own. What each element shows is kept here (RoomFace) and React draws
// it (RoomPage.tsx) synchronously (flushSync), so the page is current when a call returns, as before; a branch that
// did not touch an element before leaves it as it was. An unchanged render writes nothing to the DOM.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {revealKitItem} from '../../../ui/kit.js';
import {binding} from '../../../scene-model.js';
import {roomModel} from './model';
import type {LightDevice, LightHost, RoomModel} from './model';
import {initialRoomFace, RoomPage} from './RoomPage';
import type {RoomFace, RoomHandlers, RoomRowFace} from './RoomPage';

// The shell's own light nodes the room page groups into its panel (widget-view.js renderLightScenes).
export interface RoomShell extends LightHost {
  lightRooms?: Element | null;
  lightSceneStatus?: HTMLElement | null;
  lightScenes?: HTMLElement | null;
  lightLampDisclosure?: HTMLElement | null;
  lightLampDisclosurePanel?: HTMLElement | null;
  lightLampDisclosureControl?: {setExpanded: (expanded: boolean) => void} | null;
  lightLampCount?: HTMLElement | null;
  inlineLamps?: {node: HTMLElement} | null;
}

export interface RoomEntry {
  node: HTMLElement;
  select: HTMLButtonElement;
  tag: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  power: HTMLButtonElement;
}

export interface RoomNavigationParts {
  node: HTMLFieldSetElement;
  inputs: HTMLInputElement[];
  setValue: (value: string) => void;
}

const text = (node: Node, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};

function part<T extends Element>(node: ParentNode, selector: string, type: abstract new () => T): T {
  const found = node.querySelector(selector);
  if (!(found instanceof type)) throw Error(`Light room page is missing ${selector}`);
  return found;
}

export class LightRoomView {
  host: RoomShell;
  node: HTMLElement;
  rows = new Map<string, RoomEntry>();
  deviceId: string | undefined;
  selectedRoom: string | undefined;
  navigation: RoomNavigationParts | null = null;
  navigationSignature: string | undefined;
  revealFrame: number | null = null;
  // Named parts, found after the first render.
  list!: HTMLElement;
  notice!: HTMLElement;
  toolbar!: HTMLElement;
  navigationHost!: HTMLElement;
  home!: HTMLButtonElement;
  homeLabel!: HTMLElement;
  panel!: HTMLElement;
  panelHeader!: HTMLElement;
  panelHeading!: HTMLElement;
  panelStatus!: HTMLElement;
  kicker!: HTMLElement;
  empty!: HTMLElement;
  refresh!: HTMLButtonElement;
  private face: RoomFace = initialRoomFace();
  private named = false;
  private reactRoot: Root | undefined;
  // The room the navigation shows as chosen: the model's, or the user's own tap until the next render.
  private navigationValue: string | undefined;
  private readonly handlers: RoomHandlers;

  constructor(host: RoomShell) {
    this.host = host;
    const doc = host.ownerDocument ?? globalThis.document;
    this.node = doc.createElement('section');
    this.node.className = 'light-room-view';
    this.node.hidden = true;
    this.handlers = {
      onSelect: id => {
        this.selectRoom(id);
      },
      onChoose: id => {
        this.navigationValue = id;
        this.selectRoom(id);
      },
      onPower: id => {
        this.power(id);
      },
      onHome: () => {
        this.homePower();
      },
      onRefresh: button => {
        if (!button.disabled) void this.host.loadLiveHome?.();
      },
    };
  }

  current(): LightDevice | null | undefined {
    return this.host.currentLightDevice?.() ?? this.host.state?.devices?.find(row => row.id === this.deviceId);
  }

  model(light: LightDevice | null | undefined): RoomModel | null {
    return roomModel(this.host, light);
  }

  selectRoom(id: string) {
    const d = this.current();
    const model = this.model(d);
    const row = model?.rows.find(item => item.id === id);
    if (!d || !model || !row || row.selected) return;
    if (model.live) {
      void Promise.resolve(this.host.readLightArea?.(id)).finally(() => this.render(this.current()));
      this.render(d);
    } else {
      this.host.dispatch?.({type: 'light-select', ...binding(this.host.state ?? {}, d), optionId: `room:${id}`});
    }
  }

  private power(id: string) {
    const d = this.current();
    const model = this.model(d);
    const row = model?.rows.find(item => item.id === id);
    if (!d || !model || !row?.enabled || !row.action) return;
    if (model.live) this.host.actCurrentLight?.('toggle', {}, {areaId: id});
    else this.host.dispatch?.({type: 'light-room-power', ...binding(this.host.state ?? {}, d), roomId: id,
      action: row.action});
  }

  private homePower() {
    const d = this.current();
    const model = this.model(d);
    if (!d || !model || model.live) return;
    if (model.globalRestore) this.host.dispatch?.({type: 'light-home-restore', ...binding(this.host.state ?? {}, d)});
    else if (model.globalEnabled) {
      this.host.dispatch?.({type: 'light-home-power', ...binding(this.host.state ?? {}, d), action: 'turn_off'});
    }
  }

  revealSelection(id: string) {
    const reveal = () => {
      this.revealFrame = null;
      if (this.host.isConnected === false || this.selectedRoom !== id) return;
      revealKitItem(this.rows.get(id)?.node, this.list);
      const navigation = this.navigation;
      if (navigation) {
        revealKitItem(navigation.inputs.find(input => input.checked)?.parentElement, navigation.node.children[1]);
      }
    };
    if (this.revealFrame) globalThis.cancelAnimationFrame(this.revealFrame);
    if (typeof globalThis.requestAnimationFrame === 'function') {
      this.revealFrame = globalThis.requestAnimationFrame(reveal);
    } else reveal();
  }

  cleanup() {
    if (this.revealFrame) globalThis.cancelAnimationFrame(this.revealFrame);
    this.revealFrame = null;
  }

  render(light: LightDevice | null | undefined): HTMLElement {
    this.deviceId = light?.id;
    const model = this.model(light);
    if (light?.kind !== 'light') {
      if (!this.node.hidden) this.node.hidden = true;
      this.paint(this.face);
      return this.node;
    }
    if (!this.node.parentNode) this.host.lightRooms?.after(this.node);
    if (this.node.hidden) this.node.hidden = false;
    const empty = !model?.rows.length;
    const face: RoomFace = {...this.face, listHidden: empty, noticeHidden: !(!empty && model.stale),
      toolbarHidden: empty, emptyHidden: !empty};
    if (!model || empty) return this.renderEmpty(face);
    return this.renderRooms(face, model);
  }

  // No rooms: »Ikke forbundet« (Lærred »A-Lys«) or an honest read/access problem, and »Opdater lys« re-reads.
  private renderEmpty(face: RoomFace): HTMLElement {
    const host = this.host;
    const state = host.state;
    const unbound = state?.lightPlacement?.status === 'unbound' || state?.lightAreas?.status === 'unbound';
    const read = state?.homeReadStatus?.light;
    const copy = !unbound && read === 'denied'
      ? 'Adgang til lysoplysninger mangler. Kontrollér adgangen i Home Assistant.'
      : !unbound && (read === 'error' || state?.lightAreas?.status === 'unavailable')
        ? 'Lysoplysninger kunne ikke hentes. Prøv igen, når forbindelsen er klar.' : '';
    const place = state?.lightPlacement?.areaName;
    const kicker = typeof place === 'string' && place ? `${place} · denne skærms rum` : '';
    const refreshable = host.live === true && !!host.liveTransport?.connected && !host.liveHomePending;
    this.paint({...face, panelHidden: false, statusHidden: true, headingText: copy ? 'Lys' : 'Ikke forbundet',
      emptyText: copy || 'Forbind lys i Home Assistant for at se og styre dem her.', kickerText: kicker,
      kickerHidden: !kicker, refreshHidden: false, refreshDisabled: !refreshable});
    if (host.lightSceneStatus && host.lightSceneStatus.parentNode !== this.panelHeader) {
      this.panelHeader.append(host.lightSceneStatus);
    }
    if (host.lightScenes) host.lightScenes.hidden = true;
    if (host.lightLampDisclosure) host.lightLampDisclosure.hidden = true;
    if (host.inlineLamps?.node) host.inlineLamps.node.hidden = true;
    return this.node;
  }

  private renderRooms(face: RoomFace, model: RoomModel): HTMLElement {
    const host = this.host;
    const command = host.lightCommandFeedback;
    const rows = model.rows.map((row): RoomRowFace => ({
      id: row.id,
      tag: row.own ? 'Denne skærms rum' : 'Rum',
      name: row.name,
      status: row.status,
      selected: row.selected,
      powerOn: row.action === 'turn_off',
      pressed: row.action ? row.action === 'turn_off' : null,
      powerLabel: row.action ? `${row.action === 'turn_off' ? 'Sluk' : 'Tænd'} alle lys i ${row.name}`
        : `Lys i ${row.name} kræver aktuel status`,
      enabled: row.enabled,
      busy: !!command && command.target?.areaId === row.id && !command.target.sceneId && !command.target.entityId
        && ['turn_on', 'turn_off'].includes(command.action ?? '') && row.enabled,
    }));
    const signature = JSON.stringify(model.rows.map(row => [row.id, row.name]));
    const rebuilt = this.navigationSignature !== signature;
    const selectedId = model.rows.find(row => row.selected)?.id;
    if (rebuilt) {
      this.navigationSignature = signature;
      this.navigationValue = selectedId;
    }
    const navigation = rebuilt
      ? {signature, choices: model.rows.map(row => ({value: row.id, label: row.name}))} : face.navigation;
    const selected = model.rows.find(row => row.selected);
    const lampsKnown = Number.isInteger(selected?.lamps) && Number.isInteger(selected?.lampsOn);
    const status = lampsKnown && selected ? `${String(selected.lampsOn)} af ${String(selected.lamps)} lamper tændt`
      : selected?.status || '';
    const scenes = host.lightScenes;
    const hasScenes = !!scenes && !scenes.hidden;
    const lamps = host.inlineLamps?.node;
    const hasLamps = !!lamps && !lamps.hidden;
    const homeEnabled = !!(model.globalEnabled || model.globalRestore);
    const homeTitle = model.globalRestore ? 'Gendan lyset i hjemmet som før slukning' : 'Sluk alle lys i hjemmet';
    this.paint({...face, refreshHidden: true, kickerHidden: true, rows, navigation,
      headingText: selected?.name || 'Lys', statusText: status, statusHidden: !selected, panelHidden: false,
      emptyHidden: hasScenes, emptyText: 'Der er ingen scener tilgængelige i dette rum.',
      homeHidden: model.live, homeDisabled: !homeEnabled, homeLabel: model.globalRestore ? 'Gendan lys' : 'Sluk alt',
      homeTitle});
    this.navigation?.setValue(selected?.id || '');
    const count = host.lightLampCount;
    if (count) text(count, Number.isInteger(selected?.lamps) ? `${String(selected?.lamps)} stk.` : '');
    // A room with one or two lamps shows them at once; more stay folded until »Lamper« is tapped.
    if (selected && this.selectedRoom !== selected.id) {
      this.selectedRoom = selected.id;
      this.revealSelection(selected.id);
      if (Number.isInteger(selected.lamps)) host.lightLampDisclosureControl?.setExpanded((selected.lamps ?? 0) <= 2);
    }
    if (host.lightSceneStatus && host.lightSceneStatus.parentNode !== this.panelHeader) {
      this.panelHeader.append(host.lightSceneStatus);
    }
    if (scenes && scenes.parentNode !== this.panel) this.panel.append(scenes);
    const disclosure = host.lightLampDisclosure;
    if (disclosure) {
      disclosure.hidden = !hasLamps;
      if (hasLamps) {
        if (disclosure.parentNode !== this.panel) this.panel.append(disclosure);
        if (lamps.parentNode !== host.lightLampDisclosurePanel) host.lightLampDisclosurePanel?.append(lamps);
      }
    }
    return this.node;
  }

  private paint(face: RoomFace) {
    this.face = face;
    this.reactRoot ??= createRoot(this.node);
    const reactRoot = this.reactRoot;
    flushSync(() => {
      reactRoot.render(<RoomPage face={face} handlers={this.handlers} />);
    });
    this.name();
  }

  // The named parts and the room rows, read after each render (rows come and go with the rooms).
  private name() {
    const root = this.node;
    if (!this.named) {
      this.named = true;
      this.list = part(root, ':scope > .light-room-list', HTMLElement);
      this.notice = part(root, ':scope > .light-room-notice', HTMLElement);
      this.toolbar = part(root, ':scope > .light-room-toolbar', HTMLElement);
      this.navigationHost = part(this.toolbar, ':scope > .light-room-navigation', HTMLElement);
      this.home = part(this.toolbar, ':scope > .light-home-power', HTMLButtonElement);
      this.homeLabel = part(this.home, ':scope > span', HTMLElement);
      this.panel = part(root, ':scope > .light-room-panel', HTMLElement);
      this.panelHeader = part(this.panel, ':scope > header', HTMLElement);
      this.kicker = part(this.panelHeader, ':scope > .light-room-kicker', HTMLElement);
      this.panelHeading = part(this.panelHeader, ':scope > h2', HTMLElement);
      this.panelStatus = part(this.panelHeader, ':scope > .light-room-panel-status', HTMLElement);
      this.empty = part(this.panel, ':scope > p', HTMLElement);
      this.refresh = part(this.panel, ':scope > .light-room-refresh', HTMLButtonElement);
    }
    const nodes = [...this.list.children];
    const ids = new Set(this.face.rows.map(row => row.id));
    for (const id of this.rows.keys()) if (!ids.has(id)) this.rows.delete(id);
    this.face.rows.forEach((row, index) => {
      const node = nodes[index];
      if (!(node instanceof HTMLElement) || this.rows.get(row.id)?.node === node) return;
      this.rows.set(row.id, {
        node,
        select: part(node, ':scope > .light-room-select', HTMLButtonElement),
        tag: part(node, '.light-room-tag', HTMLElement),
        name: part(node, '.light-room-name', HTMLElement),
        status: part(node, '.light-room-status', HTMLElement),
        power: part(node, ':scope > .light-room-power', HTMLButtonElement),
      });
    });
    const group = this.navigationHost.querySelector(':scope > fieldset');
    if (!(group instanceof HTMLFieldSetElement)) this.navigation = null;
    else if (this.navigation?.node !== group) this.navigation = this.navigationParts(group);
  }

  // createKitChoiceGroup's setValue: write which radio is checked, and reveal a newly chosen room in the row.
  private navigationParts(node: HTMLFieldSetElement): RoomNavigationParts {
    const inputs = [...node.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const row = node.children[1];
    const setValue = (next: string) => {
      const changed = this.navigationValue !== next;
      this.navigationValue = next;
      for (const input of inputs) if (input.checked !== (input.value === next)) input.checked = input.value === next;
      if (changed) revealKitItem(inputs.find(input => input.checked)?.parentElement, row);
    };
    // A new group starts on the model's room, checked without a reveal (createKitChoiceGroup's first setValue).
    const first = this.navigationValue;
    for (const input of inputs) if (input.checked !== (input.value === first)) input.checked = input.value === first;
    return {node, inputs, setValue};
  }
}
