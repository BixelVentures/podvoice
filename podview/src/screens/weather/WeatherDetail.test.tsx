// Vejr (A-Vejr, Vejr-Ukendt) as the screen draws its model: the freshness rule, the advice slot's states, the hours
// with rain and wind, the days and the unknown state.
import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import type {WeatherDetailModel} from './model';
import {HA_AWAY, WeatherDetail} from './WeatherDetail';

const hour = (time: string, rain: string, bearing: number | null) => ({
  id: `2026-11-16T${time}:00Z`, time: `${time}.00`, temperature: '5 °C', temperatureNumber: 5, rainNumber: 0,
  condition: 'Skyet', icon: 'cloud', rain, wind: 'Frisk vind', windSpeed: '6,2 m/s', windBearing: bearing,
});

const MODEL: WeatherDetailModel = {
  title: 'Mårslet',
  subtitle: 'Vejret i dag',
  appearance: {tone: 'cloudy', phase: 'day', photo: false},
  current: {temperature: '5 °C', condition: 'Skyet', icon: 'cloud', range: 'Højst 5° · Lavest 4°'},
  sourceStale: false,
  summary: 'Det bliver køligere i aften; tag en varm jakke på.',
  summaryKind: 'ai',
  summaryState: 'ready',
  summaryLabel: 'AI-råd baseret på vejrudsigten',
  hours: [hour('20', '10 %', 307), hour('21', '', null)],
  days: [{id: 'd1', day: 'I dag', condition: 'Skyet', icon: 'cloud', low: '6 °C', high: '9 °C', start: 20, length: 30},
    {id: 'd2', day: 'Tirsdag', condition: 'Regn', icon: 'cloud-rain', low: '5 °C', high: '10 °C', start: 15,
      length: 40}],
  source: 'Kilde: Met.no',
};

const hero = () => document.querySelector<HTMLElement>('[data-weather-state]');

describe('Vejr', () => {
  it('frisk: the place, 5°, the condition, the AI advice with its badge, Højst · Lavest; no freshness chip', () => {
    render(<WeatherDetail model={MODEL} />);
    expect(screen.getByRole('heading', {level: 1, name: 'Mårslet'})).toBeTruthy();
    expect(hero()?.querySelector('[data-weather=temperature]')?.textContent).toBe('5°');
    expect(hero()?.querySelector('[data-weather=condition]')?.textContent).toBe('Skyet');
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText(/Det bliver køligere i aften/)).toBeTruthy();
    expect(screen.getByText('Højst 5° · Lavest 4°')).toBeTruthy();
    expect(screen.queryByText(/^Opdateret/)).toBeNull();
    expect(hero()?.getAttribute('data-weather-state')).toBe('current');
  });

  it('the hours: rain »10 %« and the wind with an arrow turned to its direction; an empty rain keeps its place', () => {
    render(<WeatherDetail model={MODEL} />);
    const hours = screen.getByRole('list', {name: 'Timeprognose'});
    const [first, second] = within(hours).getAllByRole('listitem');
    expect(first?.textContent).toContain('10 %');
    expect(first?.textContent).toContain('6,2 m/s');
    expect(first?.querySelector<HTMLElement>('i')?.style.transform).toMatch(/^rotate\(/);
    // No direction: no arrow, and the empty rain line is still there (invisible), so the hours stay in step.
    expect(second?.querySelector('i')).toBeNull();
    expect(second?.querySelectorAll('span.invisible')).toHaveLength(1);
  });

  it('»De næste dage« reads »I dag«, then the weekday, each with a range bar; the credit under it', () => {
    render(<WeatherDetail model={MODEL} />);
    const days = screen.getByRole('region', {name: 'Vejrudsigt for de næste dage'});
    expect(within(days).getByText('I dag')).toBeTruthy();
    expect(within(days).getByText('Tirsdag')).toBeTruthy();
    expect(days.querySelectorAll('i[style*="left"]')).toHaveLength(2);
    expect(within(days).getByText('Kilde: Met.no')).toBeTruthy();
  });

  it('gammel: data over 30 minutes shows »Opdateret …« on the hero in full colour, never »Sidst kendt«', () => {
    render(<WeatherDetail model={{...MODEL, sourceStale: true, updated: 'Opdateret: 11.02', summary: '',
      summaryState: null, conditionAdvice: 'Overvej en varm jakke.'}} />);
    expect(screen.getByText('Opdateret 11.02')).toBeTruthy();
    expect(screen.queryByText(/Sidst kendt/)).toBeNull();
    expect(hero()?.getAttribute('data-weather-state')).toBe('stale');
    expect(hero()?.querySelector('[data-weather-art]')?.className).toContain('opacity-45');
    // Without AI the rule sentence follows the condition in the title (regel).
    expect(hero()?.querySelector('[data-weather=condition]')?.textContent).toBe('Skyet · Overvej en varm jakke.');
  });

  it('raadventer and raadfejl: the advice on its way breathes in its slot; a failed one says so, without »AI«', () => {
    const {unmount} = render(<WeatherDetail model={{...MODEL, summary: '', summaryState: 'pending'}} />);
    expect(screen.getByRole('status', {name: 'Et vejrråd er på vej'})).toBeTruthy();
    unmount();
    render(<WeatherDetail model={{...MODEL, summary: 'Vejrrådet er ikke tilgængeligt lige nu.', summaryKind: '',
      summaryState: 'error', summaryLabel: ''}} />);
    expect(screen.getByText('Vejrrådet er ikke tilgængeligt lige nu.')).toBeTruthy();
    expect(screen.queryByText('AI')).toBeNull();
  });

  it('ukendt: »—«, the reason, the art at 20 % and the hours faded; Home Assistant away is a compact notice', () => {
    render(<WeatherDetail connected={false} model={{...MODEL, current: null, summary: '', summaryState: null,
      emptyTitle: 'Vejret kunne ikke hentes', source: 'Met.no'}} />);
    expect(hero()?.querySelector('[data-weather=temperature]')?.textContent).toBe('—');
    expect(screen.getByText('Vejret kunne ikke hentes')).toBeTruthy();
    expect(screen.getByText(HA_AWAY)).toBeTruthy();
    expect(hero()?.querySelector('[data-weather-art]')?.className).toContain('opacity-9');
    expect(screen.getByRole('list', {name: 'Timeprognose'}).className).toContain('opacity-30');
  });
});
