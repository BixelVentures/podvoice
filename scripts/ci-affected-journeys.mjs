// CI: which browser journeys a pull request has to run. Main always runs everything.
// Rule of thumb: a file we cannot place with certainty runs every journey.
// Usage: node scripts/ci-affected-journeys.mjs <base-sha> <head-sha>   (no args: all journeys)
//   ha_panel: PodView as a Home Assistant panel in WebKit (tests/browser/ha_panel_actual_e2e.cjs).
//   panel:    the add-on's own settings page (tests/browser/<name>.cjs, PANEL_TESTS).
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';

const ALL = ['panel', 'ha_panel'];
const PANEL_TESTS = ['live_status', 'daily_ui', 'wake_words', 'settings_dirty'];

// PodView, its build and the integration that serves it, and the panel journey's own files.
const HA_PANEL = [/^podview\//, /^custom_components\/podvoice\//,
  /^tests\/browser\/ha_panel(\/|_actual_e2e\.cjs$|_screens\.cjs$)/,
  /^package(-lock)?\.json$/];
// The add-on's settings page and the server behind it.
const SETTINGS = [/^podvoice\/gatekeeper\/static\/index\.html$/];
// Files that never reach the add-on, the panel or the journey fixtures.
const NEUTRAL = [/^docs\//, /\.md$/, /^tests\/(unit|integration|ha_framework|firmware)\//,
  /^esphome\//, /^spikes\//, /^\.claude\//, /^hacs\.json$/, /^scripts\/green-check/, /^scripts\/green-login/];
const VERSION_FILES = new Set(['pyproject.toml', 'podvoice/config.yaml',
  'podvoice/gatekeeper/__init__.py']);

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});

function onlyVersionChanged(base, head, file) {
  const lines = git('diff', '-U0', base, head, '--', file).split('\n')
    .filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
  return lines.length > 0 && lines.every(line => /version/i.test(line));
}

function journeysFor(file, base, head) {
  if (VERSION_FILES.has(file) && onlyVersionChanged(base, head, file)) return [];
  if (HA_PANEL.some(pattern => pattern.test(file))) return ['ha_panel'];
  if (NEUTRAL.some(pattern => pattern.test(file))) return [];
  if (SETTINGS.some(pattern => pattern.test(file))) return ['panel'];
  const browser = file.match(/^tests\/browser\/([a-z_]+)\.cjs$/);
  if (browser && PANEL_TESTS.includes(browser[1])) return ['panel'];
  return ALL;
}

export function select(files, base, head) {
  const chosen = new Set();
  const reasons = [];
  for (const file of files) {
    const journeys = journeysFor(file, base, head);
    journeys.forEach(journey => chosen.add(journey));
    if (journeys === ALL) reasons.push(file);
  }
  return {journeys: ALL.filter(journey => chosen.has(journey)), allBecause: reasons};
}

const [base, head] = process.argv.slice(2);
let result = {journeys: ALL, allBecause: ['full run (main or no pull request base)']};
if (base && head) {
  const files = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
  result = select(files, base, head);
}
const include = result.journeys.map(journey => ({journey}));
const summary = result.journeys.length === ALL.length
  ? `All journeys. First reason: ${result.allBecause[0] || 'every journey touched'}`
  : `Journeys: ${result.journeys.join(', ') || 'none'}`;
console.log(summary);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify({include})}\nany=${include.length > 0}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
