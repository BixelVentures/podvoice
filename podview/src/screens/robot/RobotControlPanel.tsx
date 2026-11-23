// Robot: the control panel element pv-robot-control-panel, as the live device detail (live-control-view.js) and the
// local preview (local-robot-view.js) host it. The element only carries the panel: it mounts the React panel
// (RobotPanel.tsx) once into its content and holds the panel's store (panel-store.ts). The hosts write what they know
// (`data`, `observed()`, `disabled`, `suggest()`, a restored draft) and read the unsent draft back; the panel tells
// them about a tap with the robot-control-action, robot-direct-action, robot-control-expired-start and
// robot-draft-changed events. Nothing outside React writes inside the panel.
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {Providers} from '../../app/Providers';
import {RobotPanel} from './RobotPanel';
import {createPanelStore, readCleaningDraft, readModeDrafts, validSuggestion} from './panel-store';
import type {CleaningDraft, DraftInput, SavedModeDrafts, Store, Suggestion} from './panel-store';
import {cleaningReady} from './present';
import type {RobotDevice} from './model';
import type {PanelValue} from './value';

export {robotControlGroups} from './model';
export type {RobotOption, RobotTask, RobotDevice} from './model';
export type {PanelValue} from './value';

// Node (the legacy node:test suites) has no DOM; the class must still load there.
const HTMLBase: typeof HTMLElement =
  'HTMLElement' in globalThis ? HTMLElement : (Object as unknown as typeof HTMLElement);

export class RobotControlPanel extends HTMLBase {
  readonly content: HTMLDivElement;
  readonly store: Store;
  private root: Root | null = null;

  constructor() {
    super();
    this.content = document.createElement('div');
    this.content.className = 'pv-component robot-control-panel';
    this.store = createPanelStore({
      emit: (type, detail) => {
        this.dispatchEvent(new CustomEvent(type, {detail, bubbles: true, composed: true}));
      },
      connected: () => this.isConnected,
      baseTriggerFocused: () => {
        const active = document.activeElement;
        return !!active && this.contains(active) && !!active.closest('.robot-dock-actions') &&
          active.matches('.robot-dock-actions > button');
      },
    });
    // The element's own attributes: the compact layout and whether a start form is offered (the stage styles).
    this.store.subscribe(state => {
      const ready = String(cleaningReady(state));
      if (state.layout && this.dataset.cleaningReady !== ready) this.dataset.cleaningReady = ready;
    });
  }

  // The panel is drawn once there is an offer (or a status) to draw.
  private mount(): void {
    if (this.root) return;
    this.dataset.layout = 'compact';
    this.replaceChildren(this.content);
    this.root = createRoot(this.content);
    this.root.render(
      <Providers>
        <RobotPanel store={this.store} />
      </Providers>,
    );
  }

  set data(value: PanelValue) {
    this.store.getState().receive(value);
    this.mount();
  }

  get value(): PanelValue | undefined {
    return this.store.getState().value;
  }

  // Write-only, as before (`_disabled` reads it).
  set disabled(value: boolean) {
    this.store.getState().setDisabled(value);
  }

  get _disabled(): boolean {
    return this.store.getState().disabled;
  }

  get cleaningDirty(): boolean {
    return this.store.getState().dirty;
  }

  get cleaningOptionId(): string | null {
    const state = this.store.getState();
    for (const section of state.layout?.sections ?? [])
      if (section.kind === 'cleaning') return section.cleaning.option.id;
    return null;
  }

  get draftFeedback(): string | null {
    return this.store.getState().draftFeedback;
  }

  // The renewal the last offer change was (robot_rebind_*), read and cleared by the live host's journal.
  get renewalDiagnostic(): string | null {
    return this.store.getState().renewalDiagnostic;
  }

  set renewalDiagnostic(value: string | null) {
    this.store.setState({renewalDiagnostic: value});
  }

  get confirmation(): HTMLDialogElement | null {
    return this.content.querySelector(':scope > dialog.robot-action-confirm');
  }

  observed(device: RobotDevice | null | undefined, context: PanelValue = {}): void {
    this.store.getState().observed(device, context);
  }

  suggest(value: unknown): boolean {
    return this.store.getState().suggest(value);
  }

  validSuggestion(value: unknown): Suggestion | null {
    return validSuggestion(this.store.getState(), value);
  }

  readCleaningDraft(): CleaningDraft | null {
    return readCleaningDraft(this.store.getState());
  }

  applyCleaningDraft(draft: DraftInput): boolean | undefined {
    return this.store.getState().applyCleaningDraft(draft);
  }

  readModeDrafts(): SavedModeDrafts | null {
    return readModeDrafts(this.store.getState());
  }

  applyModeDrafts(saved: SavedModeDrafts | null | undefined): boolean | undefined {
    return this.store.getState().applyModeDrafts(saved);
  }

  // The live host marks its pending option's command buttons busy (and every other one not busy).
  showOptionBusy(optionId: string | null): void {
    this.store.getState().showOptionBusy(optionId);
  }

  disconnectedCallback(): void {
    this.store.getState().disconnected();
  }
}

if ('customElements' in globalThis && !customElements.get('pv-robot-control-panel'))
  customElements.define('pv-robot-control-panel', RobotControlPanel);
