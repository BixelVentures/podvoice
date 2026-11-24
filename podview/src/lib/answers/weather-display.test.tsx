// Ported from src/screens/answers/weather-fact-display.test.js (and tests/podview/root-weather-fact-display.test.mjs
// before it). Same assertions on the display copies; the last test now renders the React answer card.
import {render, screen} from '@testing-library/react';
import {expect, test} from 'vitest';
import {AnswerCard} from '../../panel/screens/AnswerCard';
import type {Answer} from '../../screens/answers/types';
import type {Fact, Source} from './content';
import {weatherFacts} from './weather-display';
import type {WeatherFactsInput} from './weather-display';

const RECEIPT = 'a'.repeat(32);
const source = {id: 'source:actual', kind: 'owner_receipt', receiptId: RECEIPT, label: 'Met.no', scope: 'tool_result'};
const facts = (): Fact[] => [
  {id: 'temp', sourceId: 'source:actual', label: 'Temperatur', value: '15.1 °C', detail: 'Aktuel måling'},
  {id: 'condition', sourceId: 'source:actual', label: 'Vejrforhold', value: 'partlycloudy', detail: 'Aktuel måling'},
];
const fact = (index: number): Fact => {
  const row = facts()[index];
  if (!row) throw Error(`no fact ${String(index)}`);
  return row;
};
const input = (): WeatherFactsInput => ({live: true, kind: 'fact-card', provenance: {kind: 'ha_weather'},
  receiptId: RECEIPT, ownerReceiptIds: [RECEIPT], facts: facts(), sources: [source as Source]});
const values = (rows: readonly Fact[]) => rows.map(fact => fact.value);

test('owned weather gets the shared Danish display while the canonical values stay', () => {
  const raw = input();
  const shown = weatherFacts(raw);
  expect(values(shown)).toEqual(['15°', 'Let skyet']);
  expect(values(raw.facts)).toEqual(['15.1 °C', 'partlycloudy']);
  expect(shown[0]?.id).toBe('temp');
  expect(shown[0]?.sourceId).toBe('source:actual');
});

test('whole degrees round halves away from zero, never relabel another unit or parse prose', () => {
  const cases: [string, string][] = [['-2.5 °C', '-3°'], ['-0.4 °C', '0°'], ['0.5 °C', '1°'],
    ['100.1 °C', '100.1 °C'], ['72.3 °F', '72.3 °F'], ['15,1 °C', '15,1 °C'], ['15.1 °C senere', '15.1 °C senere'],
    ['1e2 °C', '1e2 °C']];
  for (const [raw, expected] of cases) {
    const answer = input();
    answer.facts = [{...fact(0), value: raw}];
    expect(weatherFacts(answer)[0]?.value).toBe(expected);
  }
});

test('generic facts, unbound sources and non-current weather detail stay untouched', () => {
  const mutations: ((a: WeatherFactsInput) => WeatherFactsInput)[] = [
    a => ({...a, live: false}),
    a => ({...a, kind: 'comparison'}),
    a => ({...a, provenance: {kind: 'completed_tool'}}),
    a => ({...a, ownerReceiptIds: []}),
    a => ({...a, sources: [{...source, receiptId: 'b'.repeat(32)} as Source]}),
    a => ({...a, sources: [{...source, kind: 'url'} as unknown as Source]}),
  ];
  for (const mutate of mutations) {
    const answer = mutate(input());
    expect(weatherFacts(answer)).toBe(answer.facts);
  }
  const answer = input();
  answer.facts = [{...fact(0), detail: 'Et citat'}, {...fact(1), value: 'unknown_enum'}];
  expect(weatherFacts(answer)[0]).toBe(answer.facts[0]);
  expect(weatherFacts(answer)[1]?.value).toBe('unknown_enum');
});

test('unknown condition prose and inherited object keys stay exact source strings', () => {
  for (const raw of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'unknown_enum',
    'partlycloudy later', 'Let skyet og koldt', ' sunny ']) {
    const answer = input();
    answer.facts = facts().map(fact => (fact.label === 'Vejrforhold' ? {...fact, value: raw} : fact));
    const shown = weatherFacts(answer);
    expect(shown[1]?.value).toBe(raw);
    expect(shown[1]).toBe(answer.facts[1]);
  }
});

test('the answer card draws the display copy and keeps the canonical answer', () => {
  const answer = {id: `receipt:${RECEIPT}`, kind: 'fact-card', title: 'Vejret', live: true, status: 'ready',
    receiptId: RECEIPT, ownerReceiptIds: [RECEIPT], provenance: {kind: 'ha_weather'},
    content: {summary: 'Vejret i Mårslet', sources: [source], facts: facts()}} as Answer;
  render(<AnswerCard answer={answer} connected />);
  expect(screen.getByText('15°')).toBeTruthy();
  expect(screen.getByText('Let skyet')).toBeTruthy();
  expect(answer.content?.facts?.map(fact => fact.value)).toEqual(['15.1 °C', 'partlycloudy']);
});
