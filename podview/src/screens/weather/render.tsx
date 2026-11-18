// Bridge between the pre-React shell (widget-view.js, live-home-view.js) and the React
// weather screen. The shell owns state and calls renderWeather on every change; the screen
// renders synchronously, so the page is current when the call returns, as before.
// Retires when the shell itself moves to React.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {applyKitTemplate} from '../../../ui/kit.js';
import {weatherAppearance} from '../../../weather-observation.js';
import {localWeatherModel, renderLocalWeatherSurfaces} from '../../../weather-view.js';
import type {WeatherDetailModel} from './model';
import {WeatherDetail} from './WeatherDetail';

const roots = new WeakMap<Element, Root>();
const named = new WeakMap<Element, WeatherNodes>();

// Named parts of the rendered screen, for the shell and its tests.
export interface WeatherNodes {
  title: HTMLElement;
  subtitle: HTMLElement;
  card: HTMLElement;
  value: HTMLElement;
  description: HTMLElement;
  conditionAdvice: HTMLElement;
  summary: HTMLElement;
  range: HTMLElement;
  metadata: HTMLElement;
  icon: HTMLImageElement;
  hours: HTMLElement;
  days: HTMLElement;
  daysTitle: HTMLElement;
  source: HTMLElement;
  sourceCopy: HTMLElement;
  // Current metadata rows by id (live: reflects the latest render).
  readonly metadataRows: Map<string, HTMLElement>;
}

function part(node: Element, selector: string): HTMLElement {
  const found = node.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw Error(`Weather screen is missing ${selector}`);
  return found;
}

function weatherNodes(node: Element): WeatherNodes {
  const copy = ':scope > .weather-current > [data-kit-slot="copy"]';
  const metadata = part(node, `${copy} > .weather-metadata`);
  return {
    get metadataRows() {
      const rows = [...metadata.children].filter(row => row instanceof HTMLElement);
      return new Map(rows.map(row => [row.dataset.metaId ?? '', row]));
    },
    title: part(node, '#weather-title'),
    subtitle: part(node, ':scope > .response-heading p'),
    card: part(node, ':scope > .weather-current'),
    value: part(node, `${copy} > strong`),
    description: part(node, `${copy} > p[data-kit-slot="title"]`),
    conditionAdvice: part(node, `${copy} > .weather-condition-advice`),
    summary: part(node, `${copy} > .weather-summary`),
    range: part(node, `${copy} > span[data-kit-slot="body"]`),
    metadata,
    icon: part(node, ':scope > .weather-current > img[data-kit-slot="icon"]') as HTMLImageElement,
    hours: part(node, ':scope > .weather-hours'),
    days: part(node, ':scope > .weather-days'),
    daysTitle: part(node, ':scope > .weather-days > h2'),
    source: part(node, ':scope > .weather-source'),
    sourceCopy: part(node, '#weather-source-info'),
  };
}

// The overview card is still pre-React; it carries the same source-bound appearance.
function tintOverview(doc: Document, model: WeatherDetailModel) {
  const home = doc.getElementById('home-weather');
  if (!home) return;
  const appearance = model.appearance ?? weatherAppearance(null);
  const values: [string, string][] = [
    ['data-weather-tone', appearance.tone],
    ['data-weather-phase', appearance.phase],
    ['data-weather-photo', String(appearance.photo)],
  ];
  for (const [name, value] of values) if (home.getAttribute(name) !== value) home.setAttribute(name, value);
}

export function renderWeather(node: HTMLElement, model: WeatherDetailModel = localWeatherModel()): WeatherNodes {
  let root = roots.get(node);
  if (!root) {
    applyKitTemplate(node, 'detail');
    node.replaceChildren();
    root = createRoot(node);
    roots.set(node, root);
  }
  const mounted = root;
  flushSync(() => {
    mounted.render(<WeatherDetail model={model} />);
  });
  tintOverview(node.ownerDocument, model);
  // The screen's anatomy is fixed, so its named parts are found once and stay the same elements.
  let nodes = named.get(node);
  if (!nodes) {
    nodes = weatherNodes(node);
    named.set(node, nodes);
  }
  return nodes;
}

export function renderLocalWeather(
  doc: Document,
  model: WeatherDetailModel = localWeatherModel(),
  {detail = true}: {detail?: boolean} = {},
): WeatherNodes | null {
  renderLocalWeatherSurfaces(doc, model);
  const view = doc.getElementById('weather-view');
  return detail && view ? renderWeather(view, model) : null;
}
