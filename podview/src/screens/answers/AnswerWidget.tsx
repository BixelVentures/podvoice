// Svar: the answer card element <pv-answer>, one per answer, created and placed by the shell (widget-view.js:
// #answer-host, the round's order and data-thread). Same element contract as the pre-React answer-widget.js: the
// shell assigns scene/answer/renderSignature and calls update(scene, answer); the card's own attributes (data-answer-*,
// data-kit-identity, aria-busy) are written here natively, React draws the inside (AnswerCard.tsx) synchronously
// (flushSync), so the card is current when update() returns. What the card shows comes from model.ts (paintAnswer);
// the kit components get their `data` natively after each draw, only when it changed. Hidden, disabled and inert are
// checked against the drawn elements after every draw, so a direct write from outside never sticks.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {applyKitComponent, applyKitTemplate} from '../../../ui/kit.js';
import '../../../ui/library/components.js';
import {AnswerCard} from './AnswerCard';
import type {AnswerCardView, PartView} from './AnswerCard';
import {initialMemory, initialParts, paintAnswer} from './model';
import type {AnswerParts, Part} from './model';
import type {Answer, AnswerScene} from './types';

export {answerCatalog, answerDomainIcon, typedAnswerPresentation} from './model';

type DataElement = HTMLElement & {data?: unknown};
type VisualElement = DataElement & {sources?: HTMLDetailsElement};
interface WidgetHost extends Element {
  motion?: {releaseGeometry: (immediate: boolean) => void};
}
interface ActionDetail {
  action_id?: string;
  option_id?: string;
  session_id?: string;
  task_id?: string;
  revision?: number;
}

// The kit parts by selector, as the old renderer named them.
const PART_SELECTORS: [keyof AnswerParts, string][] = [
  ['back', '.answer-back'],
  ['status', '.answer-status'],
  ['intro', '.intro'],
  ['choices', '.answer-choices'],
  ['comparison', '.comparison'],
  ['chart', '.chart'],
  ['guide', '.guide'],
  ['checklist', '.checklist'],
  ['retry', '.retry-answer'],
  ['actions', '.answer-actions'],
  ['followups', '.followups'],
  ['startGuide', '.start-guide'],
  ['sources', '.sources'],
  ['sourceList', 'pv-source-list'],
  ['weather', '.open-weather-answer'],
];
const VIEW_PARTS = ['back', 'status', 'intro', 'choices', 'comparison', 'chart', 'guide', 'checklist', 'retry',
  'actions', 'followups', 'startGuide', 'sources'] as const;

const flags = ({hidden, disabled, inert}: Part): PartView => ({hidden, disabled, inert});

function cardView(parts: AnswerParts): AnswerCardView {
  const view = {
    customize: parts.customize,
    title: parts.title,
    time: parts.time && {...parts.time},
    icon: parts.icon,
    dismiss: {...parts.dismiss},
    meta: {...parts.meta},
    choicesCount: parts.choicesCount,
    retryText: parts.retryText,
    weather: parts.weather && flags(parts.weather),
    weatherText: parts.weatherText,
    visual: parts.visual && {kind: parts.visual.kind, key: parts.visual.key},
  };
  return {...view, ...Object.fromEntries(VIEW_PARTS.map(name => [name, flags(parts[name])]))} as AnswerCardView;
}

const bound = new WeakSet<Element>();

export class AnswerWidget extends HTMLElement {
  built = false;
  scene: AnswerScene = {};
  answer: Answer | undefined;
  // Written by the shell: the last answer it asked this card to show.
  renderSignature: string | undefined;
  sourceFlowOwner: HTMLDetailsElement | null = null;
  parts: AnswerParts = initialParts();
  private memory = initialMemory();
  private reactRoot: Root | undefined;
  private readonly given = new WeakMap<Element, unknown>();
  private visual: VisualElement | null = null;

  get visualNode(): VisualElement | null {
    return this.visual;
  }

  connectedCallback() {
    if (this.built) return;
    this.built = true;
    this.className = 'answer-widget response-widget';
    applyKitComponent(this, 'card', {identity: 'neutral'});
    applyKitTemplate(this, 'response');
    applyKitComponent(this, 'card', {identity: 'neutral', variant: 'response-canvas'});
    this.reactRoot = createRoot(this);
    this.draw();
    const sources = this.named('.sources') as HTMLDetailsElement;
    const toggle = sources.querySelector('summary');
    this.addEventListener('owner-source', event => {
      if (this.answer?.historical === true) event.stopImmediatePropagation();
    }, true);
    this.bindSourceDisclosure(sources);
    sources.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !sources.open) return;
      event.stopPropagation();
      sources.open = false;
      toggle?.focus({preventScroll: true});
    });
    const retry = this.named('.retry-answer') as HTMLButtonElement;
    retry.addEventListener('click', () => {
      const answer = this.answer;
      if (!answer || answer.historical === true || retry.hidden || retry.disabled) return;
      if (answer.live) {
        this.dispatchEvent(new CustomEvent('owner-answer-retry',
          {bubbles: true, detail: {receiptId: answer.receiptId}}));
        return;
      }
      this.emit({type: 'request', kind: answer.kind});
    });
    this.named('.answer-back').addEventListener('click', () => {
      this.act('back', 'back');
    });
    const dismiss = this.named('.dismiss');
    dismiss.addEventListener('click', () => {
      if (dismiss.hidden) return;
      this.emit({type: 'show', id: 'now'});
    });
    this.named('.start-guide').addEventListener('click', () => {
      this.act('guide', this.answer?.selected);
    });
    this.addEventListener('pv-action', event => {
      event.stopPropagation();
      const detail = (event as CustomEvent<ActionDetail>).detail;
      const origin = (event.target as Element).closest('.pv-component');
      const action = origin?.classList.contains('followups') ? 'filter'
        : origin?.classList.contains('checklist') ? 'check'
          : detail.action_id === 'choose' ? 'choose' : detail.action_id;
      this.act(action ?? '', detail.option_id, detail);
    });
  }

  private named(selector: string): HTMLElement {
    const node = this.querySelector<HTMLElement>(selector);
    if (!node) throw Error(`Answer card is missing ${selector}`);
    return node;
  }

  // Native disclosure adds content below the retained answer: opening it keeps the body's footprint (measured
  // before it opens) while the canvas is released from viewport fitting; closing releases it again.
  bindSourceDisclosure(sources: HTMLDetailsElement) {
    if (bound.has(sources)) return;
    bound.add(sources);
    sources.querySelector('summary')?.addEventListener('click', () => {
      if (!sources.open) {
        const height = this.querySelector('.answer-scroll')?.getBoundingClientRect().height;
        if (Number.isFinite(height)) {
          this.sourceFlowOwner = sources;
          this.style.setProperty('--pv-answer-retained-body-height', `${String(height)}px`);
        }
      }
      // Pointer-down freezes the current pane against background data reflow. Explicit disclosure is a new layout
      // intent; release that freeze before the native default toggles details, including when closing it again.
      this.closest<WidgetHost>('pv-widget-host')?.motion?.releaseGeometry(false);
    });
    sources.addEventListener('toggle', () => {
      if (sources.open || this.sourceFlowOwner !== sources) return;
      this.sourceFlowOwner = null;
      this.style.removeProperty('--pv-answer-retained-body-height');
    });
  }

  emit(event: Record<string, unknown>) {
    if (this.answer?.historical === true && !['hide', 'show', 'back'].includes(String(event.type))) return;
    this.dispatchEvent(new CustomEvent('widget-action', {bubbles: true, detail: event}));
  }

  act(action: string, optionId: string | undefined, envelope?: ActionDetail) {
    const answer = this.answer;
    if (!answer || answer.historical === true) return;
    this.emit({type: 'answer-action', sessionId: envelope?.session_id ?? this.scene.sessionId,
      taskId: envelope?.task_id ?? answer.id, revision: envelope?.revision ?? answer.revision, action, optionId});
    if (action === 'back') {
      this.querySelector<HTMLElement>('.comparison button[aria-pressed=true],.answer-choices button[aria-pressed=true]')
        ?.focus({preventScroll: true});
    }
    if (action === 'guide')
      this.querySelector<HTMLElement>('.guide button:not(:disabled):not([hidden])')?.focus({preventScroll: true});
  }

  update(scene: AnswerScene, answer: Answer) {
    this.scene = scene;
    this.answer = answer;
    this.connectedCallback();
    const paint = paintAnswer(this.parts, this.memory, scene, answer, this.parentElement?.id === 'answer-host');
    if (paint.identityChanged) {
      this.sourceFlowOwner = null;
      this.style.removeProperty('--pv-answer-retained-body-height');
      const sources = this.querySelector<HTMLDetailsElement>('.sources');
      if (sources?.open) sources.open = false;
      if (this.visual?.sources?.open) this.visual.sources.open = false;
    }
    for (const [name, value] of Object.entries(paint.attributes))
      if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    this.draw();
  }

  private draw() {
    const root = this.reactRoot;
    if (!root) return;
    const view = cardView(this.parts);
    flushSync(() => {
      root.render(<AnswerCard view={view} />);
    });
    this.settle();
  }

  // After a draw: flags as drawn, data where it changed, and the visual component's Kilder below the content.
  private settle() {
    const parts = this.parts;
    for (const [name, selector] of PART_SELECTORS) {
      const part = parts[name] as Part | null;
      const node: DataElement | null = part && this.querySelector<DataElement>(selector);
      if (!part || !node) continue;
      if (node.hidden !== part.hidden) node.hidden = part.hidden;
      if (node.inert !== part.inert) node.inert = part.inert;
      if (part.data !== undefined && this.given.get(node) !== part.data) {
        this.given.set(node, part.data);
        node.data = part.data;
      }
      if (node instanceof HTMLButtonElement && node.disabled !== part.disabled) node.disabled = part.disabled;
    }
    const weather = this.querySelector('.open-weather-answer');
    if (weather && !bound.has(weather)) {
      bound.add(weather);
      weather.addEventListener('click', () => {
        this.emit({type: 'show', id: 'weather'});
      });
    }
    this.settleVisual();
  }

  private settleVisual() {
    const visual = this.querySelector<VisualElement>(':scope > .answer-content > .answer-scroll > .answer-visual');
    if (this.visual !== visual) {
      this.visual?.sources?.remove();
      this.visual = visual;
      const sources = visual?.sources;
      if (sources) {
        sources.classList.add('answer-source-menu');
        this.bindSourceDisclosure(sources);
        this.querySelector('.answer-content')?.append(sources);
      }
    }
    const data = this.parts.visual?.data;
    if (visual && data && this.given.get(visual) !== data) {
      this.given.set(visual, data);
      visual.data = data;
    }
  }
}

if ('customElements' in globalThis && !customElements.get('pv-answer'))
  customElements.define('pv-answer', AnswerWidget);
