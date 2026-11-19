// The robot control panel on React: an identical render writes nothing, the hero keeps the library instrument's own
// anatomy in place, an open direct confirmation survives a same-scope rebuild, and the live host's busy marking goes
// through the panel (showOptionBusy) instead of writing into the panel's buttons.
import {afterEach, test} from 'vitest';
import assert from 'node:assert/strict';
import '../../../ui/library/components.js';
import {RobotControlPanel} from './RobotControlPanel';

afterEach(() => {
 document.body.replaceChildren();
});

const mount = () => {
 const form = document.createElement('form'), panel = new RobotControlPanel();
 form.append(panel);
 document.body.append(form);
 return panel;
};
const now = () => Date.now() / 1000;
const areas = [{id: 'b'.repeat(24), label: 'Køkkenet'}, {id: 'c'.repeat(24), label: 'Stue'}];
const choices = (labels, prefix) => labels.map((label, i) => ({id: `${prefix}${i}`, label}));
const settings = [
 {id: 'mode', key: 'cleaning_mode', label: 'Rengøringstype',
  choices: choices(['Støvsug og vask', 'Støvsug', 'Vask'], 'm')},
 {id: 'fan', key: 'suction', label: 'Sugestyrke', choices: choices(['quiet', 'balanced', 'max', 'off'], 'f')},
 {id: 'water', key: 'mop_intensity', label: 'Vandmængde', choices: choices(['low', 'medium', 'high'], 'w')},
];
const start = {id: 'a'.repeat(24), action: 'start', label: 'Start rengøring', argsSchema: {kind: 'cleaning', areas,
 repeat: {min: 1, max: 3}, settings: settings.map(row => ({...row, current: row.choices[1].id}))}};
const setOptions = settings.map(row => ({id: row.id, action: 'set_option', label: row.label, settingKey: row.key,
 argsSchema: {kind: 'choice', choices: row.choices, current: row.choices[1].id}}));
const transport = ['pause', 'return', 'stop'].map(action => ({id: `${action}-id`, action, label: action,
 argsSchema: {kind: 'none'}}));
const dock = {id: 'wash', action: 'dock', label: 'Vask', argsSchema: {kind: 'dock', operation: 'wash_start'}};
const task = (options, extra = {}) => ({domain: 'vacuum', bootId: 'boot', roomId: 'room', taskId: 'task', revision: 1,
 expiresAt: now() + 300, mapName: 'Stueplan', options, ...extra});
const telemetry = rows => ({status: 'observed', items: rows.map(([key, value, unit = null]) => ({key, value, unit,
 updatedAt: now(), retrievedAt: now(), stale: false}))});
const scope = {bootId: 'boot', roomId: 'room', deviceId: 'vacuum.robot', transport: {}, generation: 1};

function recordMutations(root) {
 const observer = new MutationObserver(() => {});
 observer.observe(root, {subtree: true, childList: true, attributes: true, characterData: true});
 return () => {
  const records = observer.takeRecords();
  observer.disconnect();
  return records.map(record => [record.type, record.attributeName, record.target.nodeName]);
 };
}

test('an identical robot render writes nothing to the DOM', () => {
 const cleaning = {id: 'vacuum.robot', status: 'cleaning', live: false, exampleOnly: true,
  telemetry: telemetry([['clean_percent', 40, '%'], ['cleaning_mode', 'Støvsug og vask']])};
 const cases = [
  {task: task([start, dock]), device: {id: 'vacuum.robot', status: 'docked'}, connected: true, localOnly: true},
  {task: task([...transport, ...setOptions, dock]), device: cleaning, connected: true, localOnly: true,
   currentSetup: {repeat: 2, repeatRange: {min: 1, max: 3}, mapName: 'Stueplan', areas: [areas[0]]}},
  {task: task(setOptions), device: {...cleaning, live: true, exampleOnly: false}, connected: true,
   presentationScope: scope, directActions: ['pause', 'return', 'stop'], directBlocked: false, readOnly: false},
  {task: null, device: {id: 'vacuum.robot', status: 'fault'}, connected: false, readOnly: true},
 ];
 for (const value of cases) {
  const panel = mount();
  panel.data = structuredClone(value);
  panel.querySelector('[name=areaIds]')?.click();
  const done = recordMutations(panel);
  for (let i = 0; i < 3; i++) {
   // (without an offer, `data` rebuilds the panel, as before; an observation still writes nothing)
   if (value.task) panel.data = structuredClone(value);
   panel.observed(structuredClone(value.device), {connected: value.connected});
  }
  assert.deepEqual(done(), [], `no writes for ${value.device.status}`);
  panel.parentNode.remove();
 }
});

test('the hero keeps the library instrument anatomy between its eyebrow and the panel parts', () => {
 const panel = mount();
 panel.data = {task: task([start]), device: {id: 'vacuum.robot', status: 'docked'}, connected: true};
 const hero = panel.observation;
 assert.deepEqual([...hero.children].map(node => node.className), ['robot-hero-eyebrow', 'pv-state-note',
  'pv-content', 'player-progress', 'pv-actions transport', 'pv-meta robot-settings-context']);
 assert.equal(hero.dataset.component, 'vacuum-widget');
 assert.equal(hero.data.title, 'Robotstøvsuger');
 assert.equal(panel.heroEyebrow.textContent, 'Ved basen');
});

test('an open direct confirmation keeps its element and stays open through a same-scope rebuild', () => {
 const panel = mount(), device = {id: 'vacuum.robot', status: 'cleaning', live: true};
 const value = {connected: true, presentationScope: scope, directActions: ['pause', 'stop'], directBlocked: false,
  readOnly: false, device};
 panel.data = {...value, task: task(setOptions)};
 panel.querySelector('[data-direct-robot=true][data-action-id=stop]').click();
 const dialog = panel.confirmation;
 assert.equal(dialog.open, true);
 panel.data = {...value, task: task(setOptions, {taskId: 'renewed', revision: 2})};
 assert.equal(panel.confirmation, dialog);
 assert.equal(dialog.open, true);
 assert.equal(dialog.dataset.directAction, 'stop');
 dialog.querySelectorAll('button')[0].click();
 assert.equal(dialog.open, false);
});

test('the live host marks only its pending option busy through the panel', () => {
 const panel = mount();
 panel.data = {task: task([start, dock]), device: {id: 'vacuum.robot', status: 'docked'}, connected: true};
 const submit = panel.cleaningSubmit, wash = panel.querySelector('[data-dock-operation=wash_start]');
 panel.showOptionBusy('wash');
 assert.equal(wash.getAttribute('aria-busy'), 'true');
 assert.equal(wash.dataset.feedback, 'progress');
 assert.equal(submit.getAttribute('aria-busy'), 'false');
 panel.showOptionBusy(null);
 assert.equal(wash.getAttribute('aria-busy'), 'false');
 for (const room of panel.querySelectorAll('[name=areaIds]')) assert.equal(room.getAttribute('aria-busy'), 'false');
});
