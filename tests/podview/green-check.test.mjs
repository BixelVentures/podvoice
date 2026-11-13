// The Green check's own rules (scripts/green-check-lib.mjs): flash detection, log diffing,
// the sound window and picking the rollback backup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PERSISTENT_ERROR, flashOf, flashes, isProblemLine, newLogLines, newSystemLogEntries, redact, rollbackBackup,
  soundAllowed, summary,
} from '../../scripts/green-check-lib.mjs';

test('one change per action is not a flash; back-and-forth or a second change is', () => {
  assert.equal(flashOf(['Pause', 'Pause', 'Fortsæt']), null);
  assert.deepEqual(flashOf(['normal', 'låst', 'normal']), ['normal', 'låst', 'normal']);
  assert.deepEqual(flashOf(['Afspil', 'arbejder', 'Pause']), ['Afspil', 'arbejder', 'Pause']);
  assert.equal(flashOf(['Afspil', 'arbejder', 'Pause'], 2), null);
  assert.deepEqual(
    flashes({'#play-pause': ['a', 'b'], '#output': ['x', 'låst', 'x']}).map(f => f.control),
    ['#output'],
  );
});

test('persistent error text from today is recognised', () => {
  for (const text of ['Højttaleren afviste handlingen', 'Sidste musikhandling har ukendt udfald',
    'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.'])
    assert.match(text, PERSISTENT_ERROR);
  assert.doesNotMatch('Spiller på Køkkenalrum', PERSISTENT_ERROR);
});

test('only new WARNING/ERROR log lines outside the allowlist count', () => {
  const before = 'a INFO start\nb WARNING old\n';
  const after = before + 'c ERROR r0: pause failed\nd INFO ok\n' +
    'e WARNING device_registry.async_update_device deprecated\n';
  const fresh = newLogLines(before, after);
  assert.deepEqual(fresh.filter(isProblemLine), ['c ERROR r0: pause failed']);
  assert.deepEqual(newLogLines('', 'x\ny'), ['x', 'y']);
  assert.deepEqual(newLogLines('gone', 'x'), ['x'], 'anchor scrolled out: everything is new');
  assert.ok(isProblemLine('time=1 level=error msg="room_queue_read failed"'));
  assert.ok(!isProblemLine('level=warn msg="retirement_prepare outcome=request_failed"'));
});

test('HA system log: only new warnings and errors outside the allowlist', () => {
  const entries = [
    {level: 'ERROR', timestamp: 200, name: 'custom_components.podconnect', message: ['pause failed']},
    {level: 'WARNING', timestamp: 50, name: 'old', message: ['before the run']},
    {level: 'INFO', timestamp: 300, name: 'x', message: ['info']},
    {level: 'WARNING', timestamp: 300, name: 'homeassistant.helpers.frame',
      message: ['calls device_registry.async_update_device']},
  ];
  assert.deepEqual(newSystemLogEntries(entries, 100).map(e => e.name), ['custom_components.podconnect']);
});

test('sound only between 08 and 18 Copenhagen time', () => {
  assert.equal(soundAllowed(new Date('2026-11-13T07:30:00Z')), true); // 08:30 CET
  assert.equal(soundAllowed(new Date('2026-11-13T06:59:00Z')), false); // 07:59 CET
  assert.equal(soundAllowed(new Date('2026-11-13T17:00:00Z')), false); // 18:00 CET
  assert.equal(soundAllowed(new Date('2026-07-01T15:59:00Z')), true); // 17:59 CEST
});

test('rollback picks the newest update backup of an older version', () => {
  const backups = [
    {slug: 'aa', type: 'partial', name: 'addon_23375871_podvoice_2.0.187', date: '2026-11-12T10:00:00Z',
      content: {addons: ['23375871_podvoice']}},
    {slug: 'bb', type: 'partial', name: 'addon_23375871_podvoice_2.0.188', date: '2026-11-13T07:30:00Z',
      content: {addons: ['23375871_podvoice']}},
    {slug: 'cc', type: 'full', name: 'Fuld', date: '2026-11-13T09:00:00Z', content: {addons: ['23375871_podvoice']}},
    {slug: 'dd', type: 'partial', name: 'addon_other_1.0', date: '2026-11-13T09:00:00Z', content: {addons: ['other']}},
  ];
  assert.equal(rollbackBackup(backups, '23375871_podvoice', '2.0.189').slug, 'bb');
  assert.equal(rollbackBackup(backups, '23375871_podvoice', '2.0.188').slug, 'aa');
  assert.equal(rollbackBackup(backups, 'missing', '1'), null);
});

test('the token never reaches output', () => {
  assert.equal(redact('Bearer abc.def fejlede', 'abc.def'), 'Bearer *** fejlede');
  const source = readFileSync(new URL('../../scripts/green-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.\w+\([^)]*[,(]\s*token\s*[,)]/, 'no console line prints the token variable');
  assert.doesNotMatch(source, /writeFileSync\([^)]*[,(]\s*token\s*[,)]/, 'the token is never written to disk');
});

test('summary is red when one check fails', () => {
  assert.equal(summary([{status: 'ok'}, {status: 'sprunget'}]).green, true);
  const red = summary([{status: 'ok'}, {status: 'fejl'}]);
  assert.equal(red.green, false);
  assert.match(red.line, /^RØD: 1 af 2/);
});
