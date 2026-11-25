// The Svar card (A-SvarKort) draws the admitted content of each family on the kit's media: chart meters, the album
// cover with its credit and failure fallback, the checklist ticked on the card, the steps, follow-ups newest on top,
// and the Kilder fold.
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
  const meters = screen.getAllByRole('meter');
  const attributes = (meter: Element) =>
    ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map(name => meter.getAttribute(name));
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

test('a checklist says what is ticked and is ticked on the card itself, sending nothing', async () => {
  const items = [{id: 'x', label: 'Mælk', checked: true, sourceId: 'src'}, {id: 'y', label: 'Brød', checked: false,
    sourceId: 'src'}];
  render(<AnswerCard connected answer={answer('checklist', {items})} />);
  const milk = screen.getByRole('button', {name: 'Mælk'});
  const bread = screen.getByRole('button', {name: 'Brød'});
  expect([milk, bread].map(row => row.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  await userEvent.click(bread);
  expect(bread.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(milk);
  expect(milk.getAttribute('aria-pressed')).toBe('false');
});

test('steps go one at a time with Forrige trin and Næste trin, and stop at the ends', async () => {
  const steps = ['Find papir.', 'Fold det.', 'Kast flyet.'].map((text, i) => ({id: String(i), text, sourceId: 'src'}));
  render(<AnswerCard connected answer={answer('steps', {steps})} />);
  expect(screen.getByText('Trin 1 af 3')).toBeTruthy();
  expect(screen.getByText('Find papir.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', {name: 'Forrige trin'}));
  expect(screen.getByText('Trin 1 af 3')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', {name: 'Næste trin'}));
  await userEvent.click(screen.getByRole('button', {name: 'Næste trin'}));
  await userEvent.click(screen.getByRole('button', {name: 'Næste trin'}));
  expect(screen.getByText('Trin 3 af 3')).toBeTruthy();
  expect(screen.getByText('Kast flyet.')).toBeTruthy();
});

test('a follow-up stands in the same card, newest on top, above the first answer', () => {
  const first = {...answer('concise', {}), observedAt: 100, title: 'Første spørgsmål'};
  const later = (id: string, title: string, summary: string, at: number): Answer =>
    ({...answer('concise', {summary}), id, title, observedAt: at});
  render(<AnswerCard connected answer={first} followUps={[later('b', 'Andet', 'Svar to', 300),
    later('a', 'Første opfølgning', 'Svar et', 200)]} />);
  const blocks = [...document.querySelectorAll('[data-follow-up]')].map(node => node.textContent);
  expect(blocks[0]).toContain('»Andet«');
  expect(blocks[0]).toContain('Svar to');
  expect(blocks[1]).toContain('Svar et');
  const card = document.querySelector('[data-answer-card]');
  const title = card?.querySelector('h2');
  expect(title?.textContent).toBe('Opsummering');
  expect(title && blocks.length && card?.querySelectorAll('[data-follow-up]')[1]?.compareDocumentPosition(title))
    .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test('a weather answer opens Vejr, an album cover opens the player', async () => {
  const opened: string[] = [];
  const facts = [{id: 'f', label: 'Temperatur', value: '12', detail: 'Aktuel måling', sourceId: 'src'}];
  const {unmount} = render(<AnswerCard connected onOpen={screen => opened.push(screen)}
    answer={{...answer('fact-card', {facts}), provenance: {kind: 'ha_weather'}}} />);
  await userEvent.click(screen.getByRole('button', {name: 'Se vejret'}));
  unmount();
  const url = 'https://i.scdn.co/image/ab67616d0000b273' + '0'.repeat(24);
  render(<AnswerCard connected onOpen={screen => opened.push(screen)} answer={answer('sourced-image', {image: {url,
    alt: 'Omslag', caption: 'Blue', credit: 'Spotify', kind: 'album_cover', sourceId: 'src'}})} />);
  await userEvent.click(screen.getByRole('button', {name: 'Åbn afspiller'}));
  expect(opened).toEqual(['weather', 'music']);
});

test('Kilder folds out and lists the receipt; content that cannot be admitted is said, not drawn', async () => {
  const facts = [{id: 'f', label: 'Temperatur', value: '12', detail: 'Aktuel måling', sourceId: 'src'}];
  const {unmount} = render(<AnswerCard connected answer={answer('fact-card', {facts})} />);
  const trigger = screen.getByRole('button', {name: 'Kilder'});
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await userEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(trigger.textContent).toBe('Skjul kilder');
  expect(screen.getByRole('list', {name: 'Kilder og grundlag'}).textContent).toContain('Modtaget værktøjsresultat');
  unmount();
  render(<AnswerCard connected answer={answer('fact-card', {facts: [{...facts[0], sourceId: 'unknown'}]})} />);
  expect(screen.getByText('Visningen kunne ikke læses.')).toBeTruthy();
});
