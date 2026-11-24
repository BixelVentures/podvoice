// The Svar card draws the admitted content of each family (formerly asserted on the wall page's kit elements by the
// server tests' DOM adapters and tests/podview): chart meters, the album cover with its credit and failure fallback,
// the read-only checklist, and the Kilder disclosure.
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect, test} from 'vitest';
import type {Answer} from '../../screens/answers/types';
import {AnswerCard} from './AnswerCard';

const RECEIPT = 'c'.repeat(32);
const source = {id: 'src', kind: 'owner_receipt', receiptId: RECEIPT, label: 'Værktøjsresultat', scope: 'tool_result'};
const answer = (kind: string, content: object): Answer => ({id: `receipt:${RECEIPT}`, kind, title: 'Svar', live: true,
  status: 'ready', receiptId: RECEIPT, ownerReceiptIds: [RECEIPT], provenance: {kind: 'owner_sources'},
  content: {summary: 'Opsummering', sources: [source], ...content}});

test('a chart draws one meter per row from 0 to the highest value, with its unit', () => {
  const items = [{id: 'a', label: 'Mandag', value: 4, sourceId: 'src'}, {id: 'b', label: 'Tirsdag', value: 1,
    sourceId: 'src'}];
  render(<AnswerCard connected answer={answer('chart', {unit: 'grader', unitSingular: 'grad', items})} />);
  const meters = [...document.querySelectorAll('meter')];
  const attributes = (meter: Element) => ['min', 'max', 'value'].map(name => meter.getAttribute(name));
  expect(meters.map(attributes)).toEqual([['0', '4', '4'], ['0', '4', '1']]);
  expect(meters.map(meter => meter.getAttribute('aria-label'))).toEqual(['Mandag: 4 grader', 'Tirsdag: 1 grad']);
  expect(screen.getByText('4 grader')).toBeTruthy();
});

test('an album cover shows the picture, the caption and Omslag · Spotify, and keeps them when it fails', () => {
  const url = 'https://i.scdn.co/image/ab67616d0000b273' + '0'.repeat(24);
  const image = {url, alt: 'Albumomslag til Blue', caption: 'Blue', credit: 'Spotify', kind: 'album_cover',
    sourceId: 'src'};
  render(<AnswerCard connected answer={answer('sourced-image', {image})} />);
  const img = screen.getByAltText('Albumomslag til Blue');
  expect(img.getAttribute('src')).toBe(url);
  expect(screen.getByText('Omslag · Spotify')).toBeTruthy();
  fireEvent.error(img);
  expect(img.hidden).toBe(true);
  expect(screen.getByText('Billedet kunne ikke indlæses. Forklaring og kilde er bevaret.').hidden).toBe(false);
  expect(screen.getByText('Blue')).toBeTruthy();
});

test('a checklist is read-only and says what is ticked', () => {
  const items = [{id: 'x', label: 'Mælk', checked: true, sourceId: 'src'}, {id: 'y', label: 'Brød', checked: false,
    sourceId: 'src'}];
  render(<AnswerCard connected answer={answer('checklist', {items})} />);
  expect(screen.getByText('Markeret')).toBeTruthy();
  expect(screen.getByText('Ikke markeret')).toBeTruthy();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
});

test('Kilder opens with React Aria and lists the receipt; content that cannot be admitted is said, not drawn', async () => {
  const facts = [{id: 'f', label: 'Temperatur', value: '12', detail: 'Aktuel måling', sourceId: 'src'}];
  const {unmount} = render(<AnswerCard connected answer={answer('fact-card', {facts})} />);
  const trigger = screen.getByRole('button', {name: 'Kilder og grundlag'});
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await userEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Modtaget værktøjsresultat')).toBeTruthy();
  unmount();
  render(<AnswerCard connected answer={answer('fact-card', {facts: [{...facts[0], sourceId: 'unknown'}]})} />);
  expect(screen.getByText('Visningen kunne ikke læses.')).toBeTruthy();
});
