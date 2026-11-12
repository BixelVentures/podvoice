// CI: which browser journeys a pull request has to run. Main always runs everything.
// Rule of thumb: a file we cannot place with certainty runs every journey.
// Usage: node scripts/ci-affected-journeys.mjs <base-sha> <head-sha>   (no args: all journeys)
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';

const ALL = ['robot_ux', 'music_push', 'music', 'music_selection', 'radio', 'robot', 'light',
  'vehicle', 'timer', 'home_events', 'answers', 'recipe', 'panel'];
// Long journeys are split into parallel jobs (JOURNEY_SHARD); together they run every variant.
const SHARDS = {robot: 2, music: 2, music_selection: 2};
const MUSIC = ['music', 'music_push', 'music_selection', 'radio'];
const PANEL_TESTS = ['live_status', 'daily_ui', 'wake_words', 'settings_dirty', 'setup_flow'];

// PodView sources that only one feature's screens load. The built bundles are checked against
// their sources by the `ui` job, so the sources decide.
const PODVIEW_FEATURES = [
  [/^(robot-|local-robot-view\.js)/, ['robot', 'robot_ux']],
  [/^(music-|live-music|live-queue-view|player-view|speaker-output-view|spotify-artwork|library)/,
    MUSIC],
  [/^(radio-|live-radio-view)/, MUSIC],
  [/^light-/, ['light']],
  [/^timer-/, ['timer']],
  [/^recipe-view/, ['recipe']],
  [/^(answer-widget|live-answer-view|owner-answers|research-answers)/, ['answers']],
  [/^setup\./, ['panel']],
];
const PODVIEW_BUILT = new Set(['podview.bundle.js', 'library.bundle.js', 'podview.css',
  'asset-manifest.json']);
// Server modules named after one feature. Shared modules (podview.py, web.py, tools.py, ...) run all.
const SERVER_FEATURES = [
  [/^(podview_robot|podview_vacuum_|podview_dock_control|robot_settings|cleaning_journal)/,
    ['robot', 'robot_ux']],
  [/^(podview_music|podview_queue|podview_speakers|podview_room_media|podview_voice_music)/,
    [...MUSIC, 'robot', 'robot_ux']],
  [/^(podview_mood|podview_theme_art)/,
    [...MUSIC, 'robot', 'robot_ux']],
  [/^podview_radio/, MUSIC],
  [/^podview_lights?[_.]/, ['light']],
  [/^podview_vehicle/, ['vehicle']],
  [/^(podview_weather|weather_result)/, ['home_events']],
  [/^(timers|ha_timers)\.py$/, ['timer']],
  [/^recipe_/, ['recipe']],
  [/^podview_research/, ['answers']],
];
// Fixture servers shared by several journeys.
const SERVER_USERS = {music: ['music', 'music_push', 'robot', 'robot_ux'], music_selection: ['music',
  'music_selection']};
// Files that never reach the add-on or the journey fixtures.
const NEUTRAL = [/^docs\//, /\.md$/, /^tests\/(unit|integration|podview|ha_framework|firmware)\//,
  /^custom_components\//, /^esphome\//, /^spikes\//, /^\.claude\//, /^hacs\.json$/];
const VERSION_FILES = new Set(['pyproject.toml', 'podvoice/config.yaml',
  'podvoice/gatekeeper/__init__.py']);

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});

function onlyVersionChanged(base, head, file) {
  const lines = git('diff', '-U0', base, head, '--', file).split('\n')
    .filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
  return lines.length > 0 && lines.every(line => /version/i.test(line));
}

function journeysFor(file, base, head) {
  if (NEUTRAL.some(pattern => pattern.test(file))) return [];
  if (VERSION_FILES.has(file) && onlyVersionChanged(base, head, file)) return [];
  const podview = file.match(/^podvoice\/gatekeeper\/static\/podview\/([^/]+)$/);
  if (podview) {
    if (PODVIEW_BUILT.has(podview[1])) return [];
    const feature = PODVIEW_FEATURES.find(([pattern]) => pattern.test(podview[1]));
    return feature ? feature[1] : ALL;
  }
  const server = file.match(/^podvoice\/gatekeeper\/([a-z_]+\.py)$/);
  if (server) {
    const feature = SERVER_FEATURES.find(([pattern]) => pattern.test(server[1]));
    return feature ? feature[1] : ALL;
  }
  const browser = file.match(/^tests\/browser\/([a-z_]+?)(_actual_e2e\.cjs|_e2e_server\.py|\.cjs)$/);
  if (browser) {
    const [, name, kind] = browser;
    if (kind === '_e2e_server.py') return SERVER_USERS[name] || (ALL.includes(name) ? [name] : ALL);
    if (kind === '_actual_e2e.cjs' && ALL.includes(name)) return [name];
    if (kind === '.cjs' && PANEL_TESTS.includes(name)) return ['panel'];
  }
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

function matrix(journeys) {
  return journeys.flatMap(journey => {
    const total = SHARDS[journey] || 1;
    return Array.from({length: total}, (_, index) => ({journey, shard: `${index}/${total}`}));
  });
}

const [base, head] = process.argv.slice(2);
let result = {journeys: ALL, allBecause: ['full run (main or no pull request base)']};
if (base && head) {
  const files = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
  result = select(files, base, head);
}
const include = matrix(result.journeys);
const summary = result.journeys.length === ALL.length
  ? `All journeys. First reason: ${result.allBecause[0] || 'every journey touched'}`
  : `Journeys: ${result.journeys.join(', ') || 'none'}`;
console.log(summary);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify({include})}\nany=${include.length > 0}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
