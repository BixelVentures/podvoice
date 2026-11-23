// Test harness for the weather page: data goes into the query cache exactly as the shell writes it, and the page
// (mounted once, as the shell mounts it) renders from there. The named parts let tests check that an update keeps
// the same elements and that unchanged data writes nothing.
import {act} from 'react';
import type {Root} from 'react-dom/client';
import {afterEach} from 'vitest';
import {ingestWeather} from '../../lib/query/live';
import type {WeatherDetailModel} from './model.ts';
import {localWeatherModel} from './view-model.ts';
import {mountWeather} from './WeatherScreen';

const roots = new Map<Element, Root>();
const named = new WeakMap<Element, WeatherNodes>();

afterEach(() => {
  act(() => {
    for (const root of roots.values()) root.unmount();
  });
  roots.clear();
});

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
  readonly metadataRows: Map<string, HTMLElement>;
}

function part(node: Element, selector: string): HTMLElement {
  const found = node.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw Error(`Weather page is missing ${selector}`);
  return found;
}

function nodesOf(node: Element): WeatherNodes {
  const known = named.get(node);
  if (known) return known;
  const copy = ':scope > .weather-current > [data-kit-slot="copy"]';
  const metadata = part(node, `${copy} > .weather-metadata`);
  const nodes: WeatherNodes = {
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
  named.set(node, nodes);
  return nodes;
}

// The page in `node`, mounted on first use.
export function weatherPage(node: Element): WeatherNodes {
  if (!roots.has(node))
    act(() => {
      roots.set(node, mountWeather(node));
    });
  return nodesOf(node);
}

// The local stage: `model` is the preview source.
export function renderWeather(node: Element, model: WeatherDetailModel = localWeatherModel()): WeatherNodes {
  weatherPage(node);
  act(() => {
    ingestWeather({kind: 'preview', model});
  });
  return nodesOf(node);
}

// Runs a callback (a fired timer) and lets the page render what it caused.
export function flush(callback: () => unknown) {
  act(() => {
    callback();
  });
}
