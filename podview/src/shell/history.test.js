// »Tidligere svar«, ported to Vitest with the real page when the shell moved to React. Five tests were identical in
// tests/podview/root-visual-history.test.mjs, answer-history-integration-visual-history.test.mjs,
// canonical-next-visual-history.test.mjs and canonical-packet-visual-history.test.mjs (the last test only in the
// first two); they moved here and the rest of those files stays in node:test. Same assertions. Conversions:
// - index.html's topbar and dialog markup is the shell's: the topbar as React draws it before the host starts (the
//   voice surface later moves the Svar button into .header-activity), the dialog on the mounted page;
// - the source-text checks on the history rows are made on the rendered rows (ListRow buttons, one per answer, no
//   miniature pv-answer, a tap opens the same answer id, the format label from the answer catalogue);
// - the fake host's answer loop is the real render; the HistoryNode write counters are a MutationObserver on the
//   row; the pv-answer's update() count is a spy on the real element;
// - the label expression read from the source is the rendered row's aria-label.
import {afterEach, test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Topbar} from './Topbar';
import {ShellStore} from './store';
import {answerCatalog} from '../screens/answers/AnswerWidget';
import {mountPage, unmountPage} from './shell-fixture.js';
import {previewScene} from '../../preview-scenes.js';

afterEach(unmountPage);
const hostSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../widget-view.js'), 'utf8');

test('header reuses one history dialog/control and reserves far-right clock after weather', async () => {
  const nav = renderToStaticMarkup(createElement(Topbar, {store: new ShellStore()}));
  const f = await mountPage('/?stage=now');
  assert.equal(document.querySelectorAll('#history').length, 1);
  assert.equal(f.host.querySelectorAll('.view-nav #open-history').length, 1);
  assert.equal((nav.match(/id="open-history"/g) || []).length, 1);
  assert(nav.indexOf('header-activity') < nav.indexOf('header-context'));
  assert(nav.indexOf('header-context') < nav.indexOf('open-history'));
  assert(nav.indexOf('open-history') < nav.indexOf('header-weather'));
  assert(nav.indexOf('header-weather') < nav.indexOf('header-clock'));
  assert(!nav.includes('disabled'));
});

test('history uses compact canonical ListRows and opens the original same-ID answer without a miniature renderer', async () => {
  const f = await mountPage('/?stage=visual-history');
  f.host.motion.page = undefined;
  const rows = [...f.$('retained').children];
  assert.equal(rows.length, f.host.state.answers.length);
  for (const row of rows) {
    assert.equal(row.localName, 'article');
    assert.equal(row.className, 'retained-answer');
    const open = row.querySelector(':scope>.history-open');
    assert.equal(open.dataset.kit, 'listrow');
  }
  assert.equal(f.$('retained').querySelector('pv-answer'), null);
  assert.equal(f.$('retained').querySelector('.history-preview'), null);
  const answer = f.host.state.answers.find(item => !item.transcriptSegment && !item.historical);
  const row = rows.find(node => node.querySelector('strong').textContent === answer.title);
  assert.equal(
    row.querySelector('small').textContent,
    answer.transcriptSegment ? 'Registreret tale' : answerCatalog[answer.kind],
  );
  assert.doesNotMatch(row.textContent, /^Eksempel/);
  row.querySelector('.history-open').click();
  assert.equal(f.host.state.focus, answer.id);
});

test('unrelated snapshots preserve answer and compact list rows; authority changes still render immediately', async () => {
  const f = await mountPage('/?stage=now');
  const {host} = f;
  host.motion.page = undefined;
  host.live = true;
  host.liveTransport = {connected: true};
  const answer = {
    id: 'stable-answer',
    kind: 'concise',
    title: 'Et svar',
    revision: 1,
    status: 'ready',
    content: {summary: 'Bevar dette'},
  };
  host.state = {...host.state, sessionId: 'one', connected: true, answers: [answer], focus: 'now'};
  host.render();
  const widget = host.answerNodes.get(answer.id);
  let updates = 0;
  const update = widget.update.bind(widget);
  widget.update = (...args) => {
    updates++;
    return update(...args);
  };
  const retained = f.$('retained').querySelector('.retained-answer'),
    open = retained.querySelector('.history-open');
  const label = open.querySelector('strong');
  const writes = [];
  const observer = new MutationObserver(records => writes.push(...records));
  observer.observe(retained, {subtree: true, attributes: true, childList: true, characterData: true});
  host.state = {
    ...host.state,
    timer: {...previewScene('timer-overview-running').timer, remaining: 11},
    answers: [{...structuredClone(answer), observedAt: 123}],
  };
  host.render();
  writes.push(...observer.takeRecords());
  observer.disconnect();
  assert.equal(updates, 0);
  assert.equal(retained.querySelector('pv-answer'), null);
  assert.equal(open.getAttribute('data-kit'), 'listrow');
  assert.equal(open.querySelector('.history-excerpt').textContent, 'Bevar dette');
  assert.equal(writes.length, 0);
  assert.equal(open.querySelector('strong'), label);
  assert.equal(widget.scene.timer, host.state.timer);
  assert.equal(widget.answer, host.state.answers[0]);
  host.liveTransport.connected = false;
  host.render();
  assert.equal(updates, 1);
  assert.equal(widget.scene.connected, false);
  host.state = {...host.state, sessionId: 'two'};
  host.render();
  assert.equal(updates, 2);
  assert.equal(widget.scene.sessionId, 'two');
  host.state = {...host.state, answers: [{...answer, historical: true, readStatus: 'expired', revision: 2}]};
  host.render();
  assert.equal(updates, 3);
  assert.equal(widget.answer.historical, true);
  assert.equal(retained.querySelector('pv-answer'), null);
  assert.equal(open.querySelector('strong'), label);
  host.state = {...host.state, focus: answer.id};
  host.render();
  assert.equal(updates, 3);
  assert.equal(widget.hidden, false);
  assert.equal(widget.inert, false);
});

test('history markup uses the response pane and explains how real answers become available', async () => {
  const f = await mountPage('/?stage=now');
  const history = f.$('history');
  assert.equal(history.parentElement, document.querySelector('pv-widget-host .responses'));
  assert.equal(history.getAttribute('aria-modal'), 'false');
  assert(hostSource.includes('Når PodVoice viser et visuelt svar, kan du finde det her igen.'));
  assert(!hostSource.includes(":'Ingen gemte'"));
  assert(hostSource.includes('this.musicResults?.cleanup?.()'));
});

test('history accessible name starts with all visible format/date/title copy', async () => {
  const f = await mountPage('/?stage=now');
  const answer = {
    id: 'blue',
    kind: 'fact-card',
    title: 'Hvorfor er himlen blå?',
    revision: 1,
    status: 'ready',
    content: {summary: ''},
    historical: true,
    observedAt: 1792000000,
  };
  f.host.state = {...f.host.state, answers: [answer]};
  f.host.render();
  const open = f.$('retained').querySelector('.history-open'),
    formatText = open.querySelector('small').textContent;
  assert.match(formatText, / · /);
  assert.equal(open.getAttribute('aria-label'), formatText + ' · ' + answer.title + ' · Åbn svar');
});
