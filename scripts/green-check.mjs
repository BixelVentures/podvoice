#!/usr/bin/env node
// Green-tjek: fast regressionstjek mod det rigtige PodView-panel (/podview) på HA Green efter hver installation.
//
//   node scripts/green-check.mjs              lydløst tjek (altid tilladt)
//   node scripts/green-check.mjs --sound      + musikgrundtræk i Køkkenalrum, ≤10 %, kun kl. 08–18
//   node scripts/green-check.mjs rollback     viser, hvad der rulles tilbage (ændrer intet)
//   node scripts/green-check.mjs --help       alle valg
//
// PodView er et Home Assistant-panel (React, embed_iframe): HA tegner /podview som en iframe på samme oprindelse,
// og dens dokument holder skallen (Shell.tsx, data-link). Den viste side er den [data-screen], der har
// data-place="center" (Shell.tsx); Ro er #photo-view. Tjekket kører i WebKit (Safaris motor, som væg-iPad'en) ved
// 1180×820 med touch; GREEN_BROWSER=chromium bruger Chromium i stedet.
//
// Dækning af docs/BRUGERHISTORIER.md (110 aktive historier; G9 og K8 er fjernet). S = lydløst, L = med lyd (--sound),
// M = ikke i dette tjek (manuelt, browserrejse eller enhedstest; se historiens kolonne Automatisk tjek).
// | Område     | S (lydløst)        | L (--sound)      | M (manuelt, hvorfor)                                  |
// |------------|--------------------|------------------|-------------------------------------------------------|
// | Fælles G   | G1 G4              |                  | G2 G3 G5–G8 (dvale, race, visuel, +N, knap-busy)      |
// | Afspiller A|                    | A1 A2 A11        | A3–A10 A12–A15 (Spotify-app, stemme, touch, Foto-Ro)  |
// | Kø K       | K1 K7 (ved musik)  | K3 K5            | K2 K4 K6 (sangskift, auto-fortsæt, dubletter)         |
// | Musik F    | F1 F5 F11          | F2 F10           | F3 F4 F6–F9 F12 (idé, visuelt, AI, tid på dagen)      |
// | Højttaler H| H4 H6              | H1 (Køkkenalrum) | H2 H3 H5 H7–H11 (andre rum, konti, AirPlay, låsegrund)|
// | Radio R    | R3 R5              | R1 R2            | R4 R6 (fejlende stream, forkert opsætning)            |
// | Robot S    | S1 S12 S13         |                  | S2–S11 S14–S16 (fysisk robot får ingen kommandoer)    |
// | Lys L      |                    |                  | L1–L4 (lys må ikke styres)                            |
// | Opskrift O | O1 (O5 ved aktiv)  |                  | O2–O4 O6–O10 (start/afkrydsning ændrer data, upload)  |
// | Timer T    | (siden, G4)        |                  | T1–T3 (start ændrer data, alarm giver lyd)            |
// | Vejr V     | V1 V4              |                  | V2 V3 (kræver fejlende kilde)                         |
// | Bil B      |                    |                  | B1–B11 (bilen røres aldrig, heller ikke dens side)    |
// | Svar Q     | (siden, G4)        |                  | Q1–Q3 (Voice PE-tale)                                 |
// I alt: 17 lydløst, 10 med lyd, 83 uden for tjekket. Tværgående for alle sider: første billede uden
// indlæsning, ingen blink (MutationObserver/rAF), ingen stående fejltekst, ingen låste vælgere,
// forsidekort genopbygges ikke, ingen JavaScript-fejl i panelet, ingen nye WARNING/ERROR i PodVoice-/PodConnect-/
// HA-loggen.
//
// Login: et langtidsholdbart HA-token, som brugeren selv opretter. Det læses fra $GREEN_HA_TOKEN eller
// macOS-nøgleringen (tjenesten "podvoice-green-check") og skrives aldrig ud eller til disk.
// Lydregler: kun Køkkenalrum, lydstyrke sættes til 8 % før afspilning, stop til sidst, aldrig 18–08.
// Robot, bil, lys, timere og andre rum får aldrig en kommando. Uden --sound trykker tjekket kun på navigation og
// læsende knapper (sider, Tilbage, »Afspil på«-listen og dens Luk, Find musiks Stemning/Humør).

import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PERSISTENT_ERROR, flashes, isProblemLine, newLogLines, newSystemLogEntries, redact, rollbackBackup,
  soundAllowed, summary,
} from './green-check-lib.mjs';
import {
  GREEN_BASE, GREEN_PANEL, greenBrowserContext, greenLaunchOptions, openGreenPodView, readGreenToken,
} from './green-login.mjs';

const HELP = `Green-tjek for PodView-panelet på HA Green

Brug:
  node scripts/green-check.mjs [--sound] [--headed] [--out <mappe>]
  node scripts/green-check.mjs rollback [--yes] [--component <update.entitet>=<version>]

Tjek (lydløst, i panelet /podview):
  Hver side (Hjem, Musik med afspiller og »Afspil på«, Find musik og Stemning/Humør, radio, robot, vejr, timer,
  Svar) viser indhold i første billede efter navigation; ingen knap blinker; ingen stående "afvist"/"udfald
  ukendt"/"kunne ikke hentes"/"ingen forbindelse"; højttalervælger, kø og Find musik er aldrig låst; Hjem åbner i
  Køkkenalrum; forsidekort genopbygges ikke; ingen JavaScript-fejl i panelet; ingen nye WARNING/ERROR i PodVoice-,
  PodConnect- og HA-loggen (undtagen kendt liste). Opskrifter åbner med kataloget (eller den igangværende opskrift).
--sound (kun 08–18, kun Køkkenalrum, lydstyrke 8 %):
  kold start i Køkkenalrum (/podview/<område>) → afspil fra køen → pause → afspil → vælg højttaler →
  start fra Find musik → radio → stop. HA-tilstanden tjekkes efter hvert trin, og Køkkenalrum sættes på pause
  til sidst, også ved fejl.

Login:
  Opret i HA: Profil → Sikkerhed → Langtidsholdbare adgangstokens → "green-check", kopiér det, og gem det
  i nøgleringen direkte fra udklipsholderen (prompten i "security -w" klipper ved 128 tegn):
    security add-generic-password -U -a "$USER" -s podvoice-green-check -w "$(pbpaste)"
  Ryd derefter udklipsholderen. Alternativt GREEN_HA_TOKEN. Tokenet skrives aldrig ud.
Miljø:
  GREEN_HA_URL      (standard http://homeassistant.lan:8123)
  GREEN_PANEL       PodView-panelets sti (standard podview)
  GREEN_BROWSER     webkit (standard, som væg-iPad'en) eller chromium

Tilbagerulning (rollback):
  Når et grønt tjek er gennemført, gemmes de installerede versioner i
  ~/.config/podvoice/green-check-last-green.json (ingen hemmeligheder).
  "rollback" viser planen uden at ændre noget:
    - add-ons (PodVoice, PodConnect Speakers): gendanner den delvise backup, som update.install med
      backup: true lavede før den nuværende version (Supervisor-navn "<navn> <version>", fx "PodVoice 2.0.188").
    - HA-komponenter (PodVoice, PodConnect Control): update.install med version fra sidste grønne tjek
      eller --component update.x=1.2.3. Kræver HA-genstart, som kun sker kl. 08–18.
  "rollback --yes" udfører planen.

Exitkode 0 = grøn, 1 = rød, 2 = kunne ikke køre (fx manglende token).`;

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const BASE = GREEN_BASE;
const LAST_GREEN = path.join(os.homedir(), '.config', 'podvoice', 'green-check-last-green.json');
const KITCHEN = /Køkkenalrum/i;
let SECRET = null; // set once in main(); only used to redact error text
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The room's player beside the screens (A-Player; on every screen but Ro, Opskrifter and an opened Svar card): its
// card, its room chip (»Rum: Køkkenalrum · Vælg rum«, which opens the room sheet with »Afspil på«), and »Vis kø«,
// the way to Afspiller (the queue). The room sheet is a dialog holding #room-options.
const PLAYER = 'aside[aria-label="Rummets musik"]';
const PLAYER_CARD = `${PLAYER} article`;
const ROOM_CHIP = `${PLAYER} button[aria-haspopup="dialog"]`;
const QUEUE_KEY = `${PLAYER} button[data-opens="music"]`;
const SHEET = '[role="dialog"]:has(#room-options)';
const SHEET_CLOSE = `${SHEET} button[aria-label="Luk"]`;

function loadPlaywright() {
  const require = createRequire(new URL('../tests/browser/package.json', import.meta.url));
  try {
    return require('playwright');
  } catch {
    console.error('Playwright mangler. Kør først: npm ci --prefix tests/browser');
    process.exit(2);
  }
}

// ---------- Home Assistant ----------

function haClient(token) {
  const rest = async (method, route, body) => {
    const response = await fetch(BASE + route, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HA ${method} ${route.split('?')[0]} gav ${response.status}`);
    return (response.headers.get('content-type') || '').includes('json') ? response.json() : response.text();
  };
  return {
    get: route => rest('GET', route),
    post: (route, body) => rest('POST', route, body ?? {}),
    state: entityId => rest('GET', `/api/states/${entityId}`),
    service: (domain, service, data) => rest('POST', `/api/services/${domain}/${service}`, data),
  };
}

// WebSocket calls go through Home Assistant's own frontend connection in the browser page.
const callWS = (page, message) =>
  page.evaluate(async msg => {
    for (let n = 0; n < 150; n++) {
      const hass = document.querySelector('home-assistant')?.hass;
      if (hass?.connection) return hass.callWS(msg);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Home Assistant-frontenden blev ikke klar');
  }, message);

const supervisor = (page, endpoint, method = 'get', data) =>
  callWS(page, {type: 'supervisor/api', endpoint, method, ...(data ? {data} : {}), timeout: null});

async function ourAddons(page) {
  const {addons} = await supervisor(page, '/addons');
  const pick = re => addons.find(a => re.test(a.name || '') && a.installed !== false) || null;
  return [
    ['PodVoice', pick(/podvoice/i)],
    ['PodConnect Speakers', pick(/podconnect|speakers/i)],
  ].filter(([, addon]) => addon);
}

// HA components (PodVoice, PodConnect Control) are update entities that Supervisor does not own.
async function ourComponents(page, ha) {
  const registry = await callWS(page, {type: 'config/entity_registry/list'});
  const ids = new Set(
    registry
      .filter(e => e.entity_id.startsWith('update.') && e.platform !== 'hassio')
      .filter(e => /podvoice|podconnect/i.test(e.entity_id))
      .map(e => e.entity_id),
  );
  return (await ha.get('/api/states')).filter(s => ids.has(s.entity_id));
}

async function readLogs(page, ha, addons) {
  const out = {addons: {}, errors: []};
  for (const [name, addon] of addons) {
    try {
      out.addons[name] = String(await ha.get(`/api/hassio/addons/${addon.slug}/logs`));
    } catch (error) {
      out.errors.push(`${name}-loggen kunne ikke læses (${error.message})`);
    }
  }
  try {
    out.system = await callWS(page, {type: 'system_log/list'});
  } catch (error) {
    out.errors.push(`HA-loggen kunne ikke læses (${error.message})`);
  }
  return out;
}

// The area id of the room named Køkkenalrum (the panel's rooms are HA areas: /podview/<area_id>).
async function kitchenArea(page) {
  const areas = await callWS(page, {type: 'config/area_registry/list'});
  return areas.find(area => KITCHEN.test(area.name || ''))?.area_id ?? null;
}

// ---------- In-page instrumentation (runs inside the panel's frame) ----------

function installProbe() {
  if (window.__gc) return;
  const CONTROLS = 'button, input, select, [role=button], [role=switch], [role=tab], [role=radio]';
  // Hjem's widgets and the room's player beside the stack.
  const CARDS = '#home-view button[data-opens], aside[aria-label="Rummets musik"] article';
  // The page shown: Ro (#photo-view) covers everything; else the screen in the centre of the stack (Shell.tsx).
  const screen = () => {
    if (document.querySelector('#photo-view')) return 'rest';
    return document.querySelector('[data-screen][data-place="center"]')?.dataset.screen ?? null;
  };
  // Screens waiting beside the current one stay mounted at opacity .001 with aria-hidden: they are not shown.
  const shown = el => {
    if (!el.isConnected || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) return false;
    if (rect.right < 0 || rect.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const ids = new WeakMap();
  let counter = 0;
  const keyOf = el => {
    if (!ids.has(el)) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.name || '').replace(/\s+/g, ' ').trim();
      const id = el.id && !el.id.startsWith('react-aria') ? `#${el.id}`
        : el.dataset.actionId ? `[${el.dataset.actionId}]` : el.tagName.toLowerCase();
      ids.set(el, `${id} «${label.slice(0, 32)}» (${++counter})`);
    }
    return ids.get(el);
  };
  const digits = text => String(text || '').replace(/\s+/g, ' ').trim().replace(/\d+([.,:]\d+)*/g, '#');
  const signature = el => {
    if (!shown(el)) return 'skjult';
    const parts = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('låst');
    if (el.getAttribute('aria-busy') === 'true') parts.push('arbejder');
    if (el.matches('input[type=checkbox], input[type=radio]')) parts.push(el.checked ? 'valgt' : 'fravalgt');
    for (const name of ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current'])
      if (el.hasAttribute(name)) parts.push(`${name}=${el.getAttribute(name)}`);
    if (!el.matches('input, select')) parts.push(digits(el.getAttribute('aria-label') || el.textContent).slice(0, 40));
    return parts.join('|') || 'normal';
  };
  const loadingText = /\b(Henter|Indlæser|Opdaterer)\b[^.\n]{0,40}/;
  const visibleTextOf = el => {
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.nodeValue.trim() && node.parentElement && shown(node.parentElement)) text += node.nodeValue.trim();
    return text;
  };
  const snapshot = () => {
    let text = 0;
    const loading = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue.trim();
      if (!value || !node.parentElement || !shown(node.parentElement)) continue;
      text += value.length;
      const match = value.match(loadingText);
      if (match) loading.push(match[0]);
    }
    // Placeholders and skeletons always; aria-busy only where nothing is shown yet (a queue refreshing in the
    // background keeps its rows, a starting tile keeps its cover: that is not a loading screen).
    for (const el of document.querySelectorAll('[data-placeholder="true"], .skeleton, [data-status="loading"]'))
      if (shown(el)) loading.push(`pladsholder: ${keyOf(el)}`);
    for (const el of document.querySelectorAll('[aria-busy="true"]'))
      if (shown(el) && !visibleTextOf(el)) loading.push(`travl uden indhold: ${keyOf(el)}`);
    const controls = [...document.querySelectorAll(CONTROLS)].filter(shown);
    return {focus: screen(), text, controls: controls.length, loading};
  };
  const visibleText = () => {
    const parts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.nodeValue.trim() && node.parentElement && shown(node.parentElement)) parts.push(node.nodeValue.trim());
    return parts.join(' · ');
  };
  // JavaScript errors inside the panel's frame from now on (the page's own pageerror covers the start).
  const errors = [];
  addEventListener('error', event => errors.push(`fejl: ${event.message || event.error}`));
  addEventListener('unhandledrejection', event =>
    errors.push(`afvist løfte: ${event.reason?.message ?? event.reason}`));
  const consoleError = console.error.bind(console);
  console.error = (...items) => {
    errors.push(`console.error: ${items.map(String).join(' ').slice(0, 200)}`);
    consoleError(...items);
  };
  let win = null;
  const sample = () => {
    if (!win) return;
    for (const el of document.querySelectorAll(CONTROLS)) {
      const key = keyOf(el);
      const value = signature(el);
      const seq = win.history[key];
      if (!seq) {
        if (value !== 'skjult') win.history[key] = [value];
      } else if (seq.at(-1) !== value) seq.push(value);
    }
    if (++win.frames % 3 === 0) for (const item of snapshot().loading) win.loading.add(item);
    win.raf = requestAnimationFrame(sample);
  };
  const observer = new MutationObserver(records => {
    if (!win?.watchCards) return;
    for (const record of records)
      for (const node of record.removedNodes)
        if (node.nodeType === 1 && (node.matches(CARDS) || node.querySelector(CARDS)))
          win.cardsRemoved.push(node.id || String(node.className).slice(0, 40) || node.tagName);
  });
  observer.observe(document.body, {childList: true, subtree: true});
  window.__gc = {
    snapshot,
    visibleText,
    errors: () => errors.slice(),
    focus: screen,
    begin(watchCards = false) {
      if (win) cancelAnimationFrame(win.raf);
      win = {history: {}, loading: new Set(), cardsRemoved: [], frames: 0, watchCards};
      sample();
    },
    end() {
      if (!win) return null;
      cancelAnimationFrame(win.raf);
      const result = {history: win.history, loading: [...win.loading], cardsRemoved: win.cardsRemoved};
      win = null;
      return result;
    },
    // Resolves in the first animation frame where another page is shown.
    waitFocus(before, timeout) {
      const start = performance.now();
      return new Promise(resolve => {
        const tick = () => {
          const now = screen();
          if (now !== before) return resolve({ms: Math.round(performance.now() - start), ...snapshot()});
          if (performance.now() - start > timeout) return resolve(null);
          requestAnimationFrame(tick);
        };
        tick();
      });
    },
    locked(selector) {
      return [...document.querySelectorAll(selector)]
        .filter(el => shown(el) && (el.disabled || el.getAttribute('aria-disabled') === 'true'))
        .map(keyOf);
    },
    count(selector) {
      return [...document.querySelectorAll(selector)].filter(shown).length;
    },
  };
}

// ---------- The check ----------

class Check {
  constructor(page, frame, out) {
    this.page = page;
    this.frame = frame;
    this.out = out;
    this.results = [];
    this.ownLogLines = [];
    this.frameErrors = []; // errors the probe saw in frames that were since replaced (a reload)
  }

  async readFrameErrors() {
    return this.frame.evaluate(() => window.__gc?.errors() ?? []).catch(() => []);
  }

  record(id, stories, status, detail = '') {
    this.results.push({id, stories, status, detail});
    const mark = {ok: '✓', fejl: '✗', sprunget: '–'}[status];
    console.log(`${mark} ${id} (${stories})${detail ? ': ' + detail : ''}`);
  }

  async shot(name) {
    try {
      await this.page.screenshot({path: path.join(this.out, `${name.replace(/[^\w-]+/g, '-')}.png`)});
    } catch {}
  }

  gc(fn, arg) {
    return this.frame.evaluate(([body, value]) => window.__gc[body](value), [fn, arg]);
  }

  async focus() {
    return this.frame.evaluate(() => window.__gc.focus());
  }

  // Only visible matches count (the screens beside the current one stay mounted, invisible).
  async count(selector) {
    return this.gc('count', selector);
  }

  // Back to Hjem the way a finger goes: close the room sheet (»Afspil på«), wake Ro, then the topbar's Tilbage.
  async home() {
    for (let n = 0; n < 20; n++) {
      const focus = await this.focus();
      const sheet = await this.count(SHEET);
      if (focus === 'home' && !sheet) return;
      if (focus === null) {
        await sleep(300);
        continue;
      }
      // A sheet that is already closing has nothing left to tap: wait for it to leave.
      if (sheet) await this.frame.locator(SHEET_CLOSE).tap({timeout: 2000}).catch(() => {});
      else if (focus === 'rest') await this.frame.locator('#photo-view').tap();
      else await this.frame.locator('nav button[aria-label="Tilbage"]').tap();
      await sleep(700);
    }
    throw new Error('kom ikke tilbage til Hjem');
  }

  // Opens a page with real taps (`route`: the tiles and chips on the way; the last one is measured) and measures it:
  // first frame, content arriving later, flashes, and error text that is still there seconds later.
  async visit(id, stories, route, {screen, extra, reopen = false} = {}) {
    const problems = [];
    try {
      await this.home();
      const steps = [].concat(route);
      for (const selector of steps.slice(0, -1)) {
        const before = await this.focus();
        await this.frame.locator(selector).first().tap();
        await this.frame.waitForFunction(b => window.__gc.focus() !== b, before, {timeout: 4000});
        await sleep(600);
      }
      const before = await this.focus();
      const target = this.frame.locator(steps.at(-1)).first();
      await target.waitFor({state: 'visible', timeout: 8000});
      await this.gc('begin', false);
      await target.tap();
      const first = await this.gc('waitFocus', before, 4000);
      if (!first) throw new Error('siden åbnede ikke inden for 4 s');
      if (screen && first.focus !== screen) throw new Error(`åbnede »${first.focus}« i stedet for »${screen}«`);
      await sleep(400);
      const settled = await this.gc('snapshot');
      await sleep(2600);
      const later = await this.gc('snapshot');
      const window = await this.gc('end');
      const loading = [...new Set([...first.loading, ...settled.loading, ...window.loading])];
      if (loading.length) problems.push(`indlæsning synlig: ${loading.slice(0, 4).join(', ')}`);
      const grew = later.controls - settled.controls >= 3 ||
        (later.text > settled.text * 1.4 && later.text - settled.text > 80);
      if (grew)
        problems.push(
          `indhold kom ind efter første billede (knapper ${settled.controls}→${later.controls}, ` +
            `tekst ${settled.text}→${later.text} tegn)`,
        );
      const flash = flashes(window.history, 1);
      if (flash.length) problems.push(`blink: ${describeFlashes(flash)}`);
      if (extra) problems.push(...(await extra()));
      const error = await this.persistentError();
      if (error) problems.push(`stående fejltekst: "${error}"`);
    } catch (error) {
      problems.push(error.message.split('\n')[0]);
    }
    if (problems.length) await this.shot(id + (reopen ? '-genaabnet' : ''));
    this.record(id + (reopen ? ' (genåbnet)' : ''), stories, problems.length ? 'fejl' : 'ok', problems.join('; '));
  }

  async persistentError() {
    const pattern = new RegExp(`[^·]{0,60}(${PERSISTENT_ERROR.source})[^·]{0,60}`, 'i');
    const read = async () => (await this.gc('visibleText')).match(pattern);
    if (!(await read())) return null;
    await sleep(3000);
    return (await read())?.[0]?.trim() || null;
  }

  async locked(selector) {
    return this.gc('locked', selector);
  }
}

function describeFlashes(found) {
  return found
    .slice(0, 3)
    .map(f => `${f.control}: ${f.changes.map(c => c || 'normal').join(' → ')}`)
    .join(' | ') + (found.length > 3 ? ` (+${found.length - 3} flere)` : '');
}

async function openPodView(page, options) {
  const frame = await openGreenPodView(page, options);
  await frame.evaluate(installProbe);
  return frame;
}

const text = async (locator, fallback = '') =>
  ((await locator.first().innerText({timeout: 2000}).catch(() => fallback)) || '').replace(/\s+/g, ' ').trim();

// The speaker picker »Afspil på« in the room sheet, opened from the player's room chip. Opening and closing it moves
// nothing; a row is only locked when its speaker is unavailable (or another Spotify account plays here).
async function speakerPicker(check) {
  const {frame} = check;
  const chip = frame.locator(ROOM_CHIP);
  if (!(await chip.isVisible())) return ['rumvælgeren i afspilleren (»Rum: … · Vælg rum«) vises ikke'];
  const label = (await chip.getAttribute('aria-label')) || '';
  const card = (await frame.locator(PLAYER_CARD).first().getAttribute('aria-label').catch(() => '')) || '';
  if ((await check.locked(ROOM_CHIP)).length) return [`rumvælgeren er låst (${label || 'uden tekst'})`];
  await chip.tap();
  const rows = frame.locator(`${SHEET} #room-options [data-speaker-id]`);
  const opened = await rows.first().waitFor({state: 'visible', timeout: 3000}).then(() => true, () => false);
  const problems = [];
  if (!opened) problems.push('»Afspil på« åbnede ikke med højttalere');
  else {
    await sleep(1500); // the list must not change while it is open (H6)
    const listed = await text(frame.locator(SHEET));
    // Another Spotify account playing here locks every row on purpose (it says so); otherwise only an unavailable
    // speaker is locked.
    if (!/En anden Spotify-konto spiller her/.test(listed)) {
      const locked = await frame.locator('#room-options [data-speaker-id]').evaluateAll(nodes =>
        nodes.filter(n => n.disabled && !/Ikke tilgængelig/.test(n.textContent || ''))
          .map(n => n.getAttribute('aria-label')));
      if (locked.length) problems.push(`tilgængelige højttalere låst: ${locked.join(', ')}`);
    }
    if (PERSISTENT_ERROR.test(listed)) problems.push(`»Afspil på« siger: ${listed.match(PERSISTENT_ERROR)[0]}`);
  }
  if (await check.count(SHEET)) await frame.locator(SHEET_CLOSE).tap();
  const closed = await frame.locator(SHEET).waitFor({state: 'detached', timeout: 3000})
    .then(() => true, () => false);
  if (!closed) problems.push('»Afspil på« lukkede ikke på Luk');
  const after = (await chip.getAttribute('aria-label').catch(() => '')) || '';
  const cardAfter = (await frame.locator(PLAYER_CARD).first().getAttribute('aria-label').catch(() => '')) || '';
  if (after !== label || cardAfter.split(':')[0] !== card.split(':')[0])
    problems.push(`at åbne »Afspil på« ændrede rummet eller højttaleren (${card} → ${cardAfter})`);
  return problems;
}

// The way to Find musik from Hjem as the panel offers it now: Hjem's Musik widget while music plays (today's AI
// pick), else the empty player's »Find musik«. Null when neither is shown (e.g. paused: the widget opens Afspiller).
async function findRoute(check) {
  await check.home();
  const opens = await check.frame.locator('#home-music').getAttribute('data-opens', {timeout: 3000}).catch(() => null);
  if (opens === 'find') return ['#home-music'];
  if (await check.count(`${PLAYER} [data-opens="find"]`)) return [`${PLAYER} [data-opens="find"]`];
  return null;
}

// The queue under the full player: shown while the room's speaker plays or pauses (not for radio).
async function queueProblems(check) {
  const {frame} = check;
  if (!(await check.count('#music-view #queue'))) return [];
  const problems = [];
  const rows = await check.count('#queue button:not([data-placeholder])');
  const empty = await check.count('#queue [data-empty]');
  const meta = await text(frame.locator('#queue-meta'));
  if (!rows && !empty) problems.push(`køen er tom uden forklaring${meta ? ` (${meta})` : ''}`);
  if (await check.count('#queue [data-placeholder="true"]')) problems.push('køen viser stadig pladsholdere');
  const locked = await frame.locator('#queue button[disabled]').evaluateAll(nodes =>
    nodes.map(n => n.getAttribute('aria-label') || '').filter(label => !/^Kun visning:/.test(label)));
  if (locked.length) problems.push(`kø-rækker låst: ${locked.slice(0, 3).join(', ')}`);
  return problems;
}

async function silentChecks(check, kitchen) {
  const {frame} = check;
  // G1: opens on the HA login alone and connects without setup or refresh: the shell's link is live and Hjem
  // shows its tiles.
  const connected = await frame
    .waitForFunction(() => {
      const host = document.querySelector('[data-link]');
      return host?.dataset.link === 'live' && document.querySelector('#home-view button[data-opens]');
    }, null, {timeout: 20000})
    .then(() => true, () => false);
  const link = await frame.evaluate(() => document.querySelector('[data-link]')?.dataset.link ?? 'ingen skal');
  check.record('opstart', 'G1', connected ? 'ok' : 'fejl',
    connected ? '' : `panelet fik ikke forbindelse inden 20 s (${link})`);
  await check.home();

  // H4: without a room in the URL the panel opens in Køkkenalrum (the integration's default area, Indstillinger).
  const room = await text(frame.locator('#home-view #now-title'));
  check.record('standardrum', 'H4', KITCHEN.test(room) ? 'ok' : 'fejl', KITCHEN.test(room) ? '' :
    `/${GREEN_PANEL} åbner i »${room || 'intet rum'}«, ikke Køkkenalrum` +
    (kitchen ? `; sæt standardområdet i PodVoice-integrationens indstillinger, eller brug ` +
      `/${GREEN_PANEL}/${kitchen}` : ''));

  // Hjem: stay 20 s while updates arrive; nothing may flash, load or be rebuilt.
  await check.gc('begin', true);
  await sleep(20000);
  const idle = await check.gc('end');
  const home = [];
  if (idle.cardsRemoved.length) home.push(`forsidekort genopbygget: ${[...new Set(idle.cardsRemoved)].join(', ')}`);
  const homeFlash = flashes(idle.history, 1);
  if (homeFlash.length) home.push(`blink: ${describeFlashes(homeFlash)}`);
  if (idle.loading.length) home.push(`indlæsning synlig: ${idle.loading.slice(0, 3).join(', ')}`);
  // V1: the Vejr widget shows the weather (a temperature), not its empty state.
  const weatherTile = await text(frame.locator('#home-weather'));
  if (!/-?\d+°/.test(weatherTile)) home.push(`Vejr-kortet viser intet vejr (${weatherTile})`);
  if (!(await check.count('#home-robot'))) home.push('Robot-kortet mangler på Hjem');
  const homeError = await check.persistentError();
  if (homeError) home.push(`stående fejltekst: "${homeError}"`);
  if (home.length) await check.shot('hjem');
  check.record('Hjem i ro 20 s', 'S12 V1', home.length ? 'fejl' : 'ok', home.join('; '));

  // The room's player sits beside every screen; its »Vis kø« opens Afspiller with the queue while its speaker plays
  // or pauses. »Afspil på« is the room sheet from the player's room chip.
  const player = async () => [...(await queueProblems(check)), ...(await speakerPicker(check))];
  if (await check.count(QUEUE_KEY)) {
    await check.visit('afspiller + højttalervælger', 'K1 H6', QUEUE_KEY, {screen: 'music', extra: player});
    await check.visit('afspiller + kø', 'K7', QUEUE_KEY, {screen: 'music', reopen: true, extra: player});
  } else {
    const problems = await speakerPicker(check);
    check.record('højttalervælger', 'H6', problems.length ? 'fejl' : 'ok',
      problems.length ? problems.join('; ') : 'intet spiller i rummet; køen tjekkes med --sound');
  }

  // Find musik: Hjem's Musik widget while music plays, else the empty player's »Find musik« (F1 F11), then
  // Stemning/Humør (F5).
  const find = await findRoute(check);
  if (find) {
    await check.visit('Find musik', 'F1 F11', find, {screen: 'find', extra: () => findMusicLocks(check)});
    await findMusicMoods(check, find);
  } else {
    check.record('Find musik', 'F1 F5 F11', 'sprunget',
      'musikken står på pause: Hjem og afspilleren viser ingen vej til Find musik i den tilstand');
  }

  const radio = async () => {
    const total = await check.count('#radio-view [data-station]');
    const locked = await check.locked('#radio-view [data-station]');
    const status = await text(frame.locator('#radio-view p[role="status"]'));
    return [
      ...(total ? [] : [`ingen radiokanaler vises${status ? ` (${status})` : ''}`]),
      ...(total && locked.length === total ? ['alle radiokanaler er låst'] : []),
    ];
  };
  await check.visit('radio', 'R3 R5', '#home-radio', {screen: 'radio', extra: radio});
  await check.visit('radio', 'R5', '#home-radio', {screen: 'radio', extra: radio, reopen: true});

  // Robot: its hero with the status, the transport buttons and the rooms of Rengøring are never locked while HA is
  // connected (»Start« reads »Vælg rum« and waits for a room choice by design). Nothing is tapped.
  const robot = async () => {
    await sleep(1000);
    const hero = await text(frame.locator('#robot-view [data-resource-status]'));
    const heading = await text(frame.locator('nav #header-title'));
    const locked = (await check.locked('#robot-view :is([data-action-id], [data-room])'))
      .filter(key => !/^\[start\] «Vælg rum»/.test(key));
    return [
      ...(hero ? [] : [`robotpanelet vises ikke (${heading || 'tomt'})`]),
      ...(locked.length ? [`robotknapper låst: ${locked.slice(0, 3).join(', ')}`] : []),
    ];
  };
  await check.visit('robot', 'S1 S12 S13', '#home-robot', {screen: 'robot', extra: robot});
  await check.visit('robot', 'S1 S13', '#home-robot', {screen: 'robot', extra: robot, reopen: true});

  // V4: the Vejr page says what the widget said (its temperature and condition are on the widget).
  const weather = async () => {
    const tile = await text(frame.locator('#home-weather'));
    const page = [await text(frame.locator('#weather-view [data-weather=temperature]')),
      await text(frame.locator('#weather-view [data-weather=condition]'))];
    if (!page[0]) return [`Vejr-siden viser ingen temperatur (${page[1] || 'tom'})`];
    if (page.every(part => tile.includes(part))) return [];
    return [`Hjem siger »${tile}«, Vejr siger »${page.join(' ')}«`];
  };
  await check.visit('vejr', 'V4', '#home-weather', {screen: 'weather', extra: weather});
  await check.visit('vejr', 'G4', '#home-weather', {screen: 'weather', extra: weather, reopen: true});

  // Timer and Svar: the pages open with their content (read only: no timer is started, no answer is asked).
  const timers = async () => {
    const locked = await check.locked('#timers-view form[aria-label="Ny timer"] button');
    return locked.length ? [`timerknapper låst: ${locked.slice(0, 3).join(', ')}`] : [];
  };
  await check.visit('timer', 'G4', '#home-timers', {screen: 'timers', extra: timers});
  const answers = async () => {
    const rows = await check.count('#answers-view button[data-answer-id]');
    const status = await text(frame.locator('#answers-view [role=status]'));
    return rows || status ? [] : ['Svar viser hverken svar eller forklaring'];
  };
  await check.visit('Svar', 'G4', '#open-history', {screen: 'answers', extra: answers});

  // O1: Opskrifter opens from Hjem (whose widget says »N opskrifter«) with the catalogue's cards and the categories
  // in the first frame.
  // With a recipe in progress the tile opens that recipe (O5) instead: its hero and steps must be there. Read only:
  // nothing is started, ticked or ended.
  const opens = await frame.locator('#home-recipes').getAttribute('data-opens', {timeout: 3000}).catch(() => null);
  if (!opens) {
    check.record('opskrifter', 'O1', 'fejl', 'Hjem viser intet Opskrifter-kort (kataloget kunne ikke læses)');
  } else {
    const recipes = async () => {
      if (opens === 'recipe') {
        const title = await text(frame.locator('#recipe-view #recipe-hero-title'));
        const steps = await check.count('#recipe-view li[data-step]');
        return title && steps ? [] : [`den igangværende opskrift viser ${title ? 'ingen trin' : 'ingen titel'}`];
      }
      const cards = await check.count('#recipes-view li button');
      const categories = await check.count('#recipes-view [role="radiogroup"][aria-label="Kategori"]');
      const count = (await text(frame.locator('#home-recipes'))).match(/\d+ opskrift(er)?/)?.[0] ?? '';
      const problems = [];
      if (!cards) problems.push(`kataloget viser ingen opskrifter (${count || 'tomt'})`);
      if (!categories) problems.push('kategorierne mangler');
      if (!count) problems.push('Hjem viser ikke antallet af opskrifter');
      return problems;
    };
    const stories = opens === 'recipe' ? 'O1 O5' : 'O1';
    await check.visit('opskrifter', stories, '#home-recipes', {screen: opens, extra: recipes});
  }
  await check.home();
}

async function findMusicLocks(check) {
  const total = await check.count('#find-view button[data-kind]');
  if (!total) {
    const status = await text(check.frame.locator('#find-view [role="status"]'));
    return [`Find musik viser ingen forslag${status ? ` (${status})` : ''}`];
  }
  const locked = await check.locked('#find-view button[data-kind]');
  return locked.length ? [`Find musik-forslag låst: ${locked.length} af ${total}`] : [];
}

// F5: Find musik's Stemning/Humør chips (the panel's collections) open their shelf; the second round finds every
// shelf in the cache at once, without loading, flashes or locks. A chip tap only reads (podvoice.music_search);
// the last tap on the chosen chip closes it again, so the page is left as it was.
async function findMusicMoods(check, route) {
  const {frame} = check;
  const problems = [];
  try {
    await check.home();
    for (const selector of route) {
      const before = await check.focus();
      await frame.locator(selector).first().tap();
      await frame.waitForFunction(b => window.__gc.focus() !== b, before, {timeout: 4000});
      await sleep(600);
    }
    const groups = frame.locator('#find-view [role="radiogroup"]');
    await groups.first().waitFor({state: 'visible', timeout: 8000});
    const chips = [];
    for (const group of await groups.all()) {
      const name = await group.getAttribute('aria-label');
      for (const chip of (await group.locator('[role="radio"]').allInnerTexts()).slice(0, 2)) chips.push([name, chip]);
    }
    let chosen = null;
    for (const [round, [group, chip]] of [...chips.map(c => [1, c]), ...chips.map(c => [2, c])]) {
      const locator = frame.locator(`#find-view [role="radiogroup"][aria-label="${group}"] [role="radio"]`)
        .filter({hasText: new RegExp(`^${chip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)}).first();
      // Bring the chip into view first: the tap's own scroll is the test's, not the page's.
      await locator.scrollIntoViewIfNeeded();
      await sleep(300);
      await check.gc('begin', false);
      await locator.tap();
      chosen = locator;
      await sleep(round === 1 ? 2500 : 1500);
      const window = await check.gc('end');
      const where = `${chip} (runde ${round})`;
      if (round === 2 && window.loading.length) problems.push(`${where}: indlæsning synlig (${window.loading[0]})`);
      // The opened shelf may push the other group's chips out of view: leaving the view at the end is no flash.
      const seen = Object.fromEntries(Object.entries(window.history).map(([key, seq]) => {
        const kept = [...seq];
        while (kept.length > 1 && kept.at(-1) === 'skjult') kept.pop();
        return [key, kept];
      }));
      const flash = flashes(seen, 1);
      if (flash.length) problems.push(`${where}: blink ${describeFlashes(flash)}`);
      if ((await locator.getAttribute('aria-checked')) !== 'true') problems.push(`${where}: valget vises ikke`);
      const shelf = await text(frame.locator('#find-view [role="radiogroup"] + section p[role="status"]'));
      if (shelf) problems.push(`${where}: ${shelf}`);
      problems.push(...(await findMusicLocks(check)).map(p => `${where}: ${p}`));
    }
    if (chosen && (await chosen.getAttribute('aria-checked')) === 'true') await chosen.tap();
    if (!chips.length) problems.push('Find musik har ingen Stemning/Humør');
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  }
  const unique = [...new Set(problems)];
  if (unique.length) await check.shot('find-musik-stemning');
  check.record('Find musik Stemning/Humør', 'F5', unique.length ? 'fejl' : 'ok', unique.join('; '));
}

// ---------- Sound ----------

async function kitchenPlayer(page, ha) {
  const registry = await callWS(page, {type: 'config/entity_registry/list'});
  const states = await ha.get('/api/states');
  const players = states.filter(s => s.entity_id.startsWith('media_player.'));
  const podconnect = new Set(registry.filter(e => e.platform === 'podconnect').map(e => e.entity_id));
  // Control's hidden engine entity follows whichever room plays; it is not another room.
  const hidden = new Set(registry.filter(e => e.platform === 'podconnect' && e.hidden_by).map(e => e.entity_id));
  const ours = players.filter(s => podconnect.has(s.entity_id) && !hidden.has(s.entity_id));
  const kitchen = ours.find(s => KITCHEN.test(s.attributes.friendly_name || '')) ||
    players.find(s => KITCHEN.test(s.attributes.friendly_name || ''));
  const others = ours.map(s => s.entity_id).filter(id => id !== kitchen?.entity_id);
  return {kitchen: kitchen?.entity_id || null, others};
}

async function waitState(ha, entityId, predicate, timeout = 6000) {
  const start = Date.now();
  let state;
  while (Date.now() - start < timeout) {
    state = await ha.state(entityId);
    if (predicate(state)) return {ok: true, state, ms: Date.now() - start};
    await sleep(300);
  }
  return {ok: false, state, ms: Date.now() - start};
}

// The panel's sound journey, only in Køkkenalrum (/podview/<area>): every play tap first proves on screen that its
// destination is Køkkenalrum, and HA's state is checked after each step.
async function soundChecks(check, ha, area) {
  if (!soundAllowed()) {
    check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget', 'lyd er kun tilladt kl. 08–18');
    return;
  }
  const {kitchen, others} = await kitchenPlayer(check.page, ha);
  if (!kitchen || !area) {
    const missing = kitchen ? 'området Køkkenalrum' : 'Køkkenalrum-afspilleren';
    check.record('lyd', 'A1 A2 H1 R1 R2', 'fejl', `${missing} blev ikke fundet i HA; ingen lyd afspillet`);
    return;
  }
  const busy = [];
  for (const id of others) if ((await ha.state(id)).state === 'playing') busy.push(id);
  if (busy.length) {
    check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget', `${busy.join(', ')} spiller; rører den ikke`);
    return;
  }
  const quiet = () => ha.service('media_player', 'volume_set', {entity_id: kitchen, volume_level: 0.08});
  const guard = async () => {
    const state = await ha.state(kitchen);
    if ((state.attributes.volume_level ?? 0) > 0.1) {
      await ha.service('media_player', 'media_pause', {entity_id: kitchen});
      throw new Error(`lydstyrken var ${Math.round(state.attributes.volume_level * 100)} %; sat på pause`);
    }
    for (const id of others)
      if ((await ha.state(id)).state === 'playing') {
        await ha.service('media_player', 'media_pause', {entity_id: id});
        throw new Error(`${id} begyndte at spille; sat på pause med det samme`);
      }
  };
  const step = async (id, stories, body) => {
    try {
      const problems = (await body()) || [];
      if (problems.length) await check.shot(`lyd-${id}`);
      check.record(`lyd: ${id}`, stories, problems.length ? 'fejl' : 'ok', problems.join('; '));
      return !problems.length;
    } catch (error) {
      await check.shot(`lyd-${id}`);
      check.record(`lyd: ${id}`, stories, 'fejl', error.message.split('\n')[0]);
      return false;
    }
  };
  const f = () => check.frame;
  const playing = () => waitState(ha, kitchen, s => s.state === 'playing');
  const notPlaying = () => waitState(ha, kitchen, s => s.state !== 'playing');
  const unlocked = async () => {
    const problems = [];
    for (const [name, selector] of [['rumvælger', ROOM_CHIP], ['kø', '#queue button']]) {
      const locked = await check.locked(selector);
      if (locked.length && !(name === 'kø' && (await f().locator(`${selector}[disabled]`).evaluateAll(nodes =>
        nodes.every(n => /^Kun visning:/.test(n.getAttribute('aria-label') || '')))))) problems.push(`${name} låst`);
    }
    const error = await check.persistentError();
    if (error) problems.push(`stående fejltekst: "${error}"`);
    return problems;
  };
  // The room's player beside the screens (Hjem and Afspiller show it), for the kitchen's speaker only.
  const card = PLAYER_CARD;
  const openPlayer = async () => {
    if (!['home', 'music'].includes(await check.focus())) await check.home();
    await f().locator(card).waitFor({state: 'visible', timeout: 5000});
    const name = (await f().locator(card).getAttribute('aria-label')) || '';
    if (!KITCHEN.test(name))
      throw new Error(`afspilleren står ikke på Køkkenalrum (${name || 'tom'}); intet trykket`);
  };
  // Afspiller (the queue): the player's »Vis kø«; null when the player has none (nothing in the room's player).
  const openQueue = async () => {
    await openPlayer();
    if ((await check.focus()) === 'music') return true;
    if (!(await check.count(QUEUE_KEY))) return false;
    await f().locator(QUEUE_KEY).tap();
    await f().locator('#music-view #queue').waitFor({state: 'visible', timeout: 5000}).catch(() => {});
    return true;
  };
  const transport = label =>
    f().locator(`${card} [role="group"][aria-label="Afspilning"] button[aria-label="${label}"]`);
  const openFind = async () => {
    await openPlayer();
    const route = await findRoute(check);
    if (!route) throw new Error('ingen vej til Find musik fra Hjem i denne tilstand; intet trykket');
    for (const selector of route) await f().locator(selector).first().tap();
    await f().locator('#find-view button[data-kind]').first().waitFor({state: 'visible', timeout: 8000});
    const to = await text(f().locator('#find-view header p'));
    if (!KITCHEN.test(to)) throw new Error(`Find musik spiller ikke på Køkkenalrum (${to}); intet trykket`);
    return f().locator('#find-view button[data-kind]:not([disabled])');
  };
  const tapWatched = async (locator, after) => {
    await check.gc('begin', false);
    await locator.first().tap();
    const result = await after();
    const window = await check.gc('end');
    const flash = flashes(window.history, 1);
    return {result, flash};
  };

  // The volume must be at most 10 % before the first sound. If the speaker refuses a volume change
  // while it is quiet, no sound is made at all.
  try {
    await quiet();
  } catch {
    // The refused volume call is our own; its log lines are not a product regression.
    check.ownLogLines.push(/volume failed|Native route unavailable/i);
  }
  const level = (await waitState(ha, kitchen, s => (s.attributes.volume_level ?? 1) <= 0.1, 4000)).state;
  if ((level?.attributes?.volume_level ?? 1) > 0.1) {
    const percent = Math.round((level?.attributes?.volume_level ?? 1) * 100);
    check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget',
      `${kitchen} kan ikke sættes til ≤10 % før afspilning (står på ${percent} %); ingen lyd afspillet`);
    return;
  }
  try {
    if ((await ha.state(kitchen)).state === 'playing') {
      await ha.service('media_player', 'media_pause', {entity_id: kitchen});
      await notPlaying();
    }
    await step('kold start', 'H4', async () => {
      check.frameErrors.push(...(await check.readFrameErrors()));
      check.frame = await openPodView(check.page, {room: area});
      await check.home();
      const room = await text(f().locator('#home-view #now-title'));
      const aside = (await f().locator('aside[aria-label="Rummets musik"] article').first()
        .getAttribute('aria-label')) || '';
      return [
        ...(KITCHEN.test(room) ? [] : [`Hjem står ikke i Køkkenalrum (${room || 'tom'})`]),
        ...(KITCHEN.test(aside) ? [] : [`rummets afspiller er ikke Køkkenalrum (${aside || 'tom'})`]),
      ];
    });
    const upcoming = '#queue button[data-current="false"]:not([disabled])';
    await step('afspil fra kø', 'K3 K5 A11', async () => {
      if (!(await openQueue()) || !(await check.count(upcoming))) {
        // Cold start with an empty player: start something from Find musik so there is a queue.
        const choice = await openFind();
        await quiet();
        await choice.first().tap();
        const first = await waitState(ha, kitchen, s => s.state === 'playing', 8000);
        await guard();
        if (!first.ok) return ['kold start fra Find musik spillede ikke på Køkkenalrum inden 8 s'];
        await sleep(3000);
        await openQueue();
        await f().locator(upcoming).first().waitFor({state: 'visible', timeout: 6000}).catch(() => {});
        if (!(await check.count(upcoming))) return ['køen viser ingen kommende sange efter start'];
      }
      await quiet();
      const {result, flash} = await tapWatched(f().locator(upcoming), playing);
      await guard();
      await sleep(1500);
      return [
        ...(result.ok ? [] : [`Køkkenalrum spillede ikke efter 6 s (${result.state?.state})`]),
        ...(flash.length ? [`blink: ${describeFlashes(flash)}`] : []),
        ...(await unlocked()),
      ];
    });
    await step('pause', 'A1', async () => {
      await openPlayer();
      const {result, flash} = await tapWatched(transport('Pause'), notPlaying);
      return [
        ...(result.ok ? [] : ['musikken stoppede ikke inden 6 s']),
        ...(flash.length ? [`blink: ${describeFlashes(flash)}`] : []),
        ...(await unlocked()),
      ];
    });
    await step('afspil', 'A2', async () => {
      await openPlayer();
      await quiet();
      const {result, flash} = await tapWatched(transport('Afspil'), playing);
      await guard();
      return [
        ...(result.ok ? [] : ['musikken startede ikke igen inden 6 s']),
        ...(flash.length ? [`blink: ${describeFlashes(flash)}`] : []),
        ...(await unlocked()),
      ];
    });
    await step('vælg højttaler Køkkenalrum', 'H1 H6', async () => {
      await openPlayer();
      if ((await check.locked(ROOM_CHIP)).length) return ['rumvælgeren er låst'];
      await f().locator(ROOM_CHIP).tap();
      const option = f().locator(`${SHEET} #room-options [data-speaker-id="${kitchen}"]`);
      await option.waitFor({state: 'visible', timeout: 4000});
      if (await option.isDisabled()) return ['Køkkenalrum er låst i »Afspil på«'];
      await option.tap();
      await sleep(2500);
      await guard();
      if (await check.count(SHEET)) await f().locator(SHEET_CLOSE).tap();
      await f().locator(SHEET).waitFor({state: 'detached', timeout: 3000}).catch(() => {});
      const room = (await f().locator(card).first().getAttribute('aria-label')) || '';
      const state = await ha.state(kitchen);
      return [
        ...(KITCHEN.test(room) ? [] : [`afspilleren viser ikke Køkkenalrum (${room})`]),
        ...(state.state === 'playing' ? [] : [`Køkkenalrum spiller ikke efter valget (${state.state})`]),
        ...(await unlocked()),
      ];
    });
    await step('start fra Find musik', 'F2 F10', async () => {
      const title = (await ha.state(kitchen)).attributes.media_title;
      const choice = await openFind();
      // Another tile than the one playing now.
      const pick = choice.nth(1);
      await quiet();
      await pick.tap();
      const started = s => s.state === 'playing' && s.attributes.media_title !== title;
      const result = await waitState(ha, kitchen, started, 8000);
      await guard();
      return [
        ...(result.ok ? [] : [`ny musik startede ikke på Køkkenalrum inden 8 s (${result.state?.state})`]),
        ...(await unlocked()),
      ];
    });
    await step('radio på valgt højttaler', 'R1', async () => {
      await check.home();
      await f().locator('#home-radio').tap();
      const station = f().locator('#radio-view [data-station]:not([disabled])');
      await station.first().waitFor({state: 'visible', timeout: 5000});
      const to = (await station.first().getAttribute('aria-label')) || '';
      if (!/Afspil på Køkkenalrum/i.test(to)) return [`radioen spiller ikke på Køkkenalrum (${to}); intet trykket`];
      await quiet();
      await station.first().tap();
      const result = await waitState(ha, kitchen, s => s.state === 'playing', 8000);
      await sleep(1500);
      await guard();
      // Radio's destination line (»Afspilles på Køkkenalrum«) and the room's player card.
      const hero = [await text(f().locator('#radio-view button[aria-haspopup="dialog"]')),
        (await f().locator(card).first().getAttribute('aria-label')) || ''];
      return [
        ...(result.ok ? [] : ['radioen spillede ikke på Køkkenalrum inden 8 s']),
        ...(hero.every(part => KITCHEN.test(part)) ? [] : [`radioen viser en anden højttaler (${hero.join(' · ')})`]),
      ];
    });
    await step('stop', 'R2', async () => {
      const stop = f().locator(`${card} button[aria-label="Stop"]`);
      if (await stop.isVisible()) await stop.tap();
      const result = await notPlaying();
      return result.ok ? [] : ['radioen stoppede ikke inden 6 s'];
    });
  } finally {
    try {
      if ((await ha.state(kitchen)).state === 'playing')
        await ha.service('media_player', 'media_pause', {entity_id: kitchen});
    } catch {}
  }
}

// ---------- Logs ----------

function logResults(check, before, after, startedAt) {
  const problems = [...after.errors];
  for (const [name, text] of Object.entries(after.addons)) {
    const fresh = newLogLines(before.addons[name] || '', text)
      .filter(line => isProblemLine(line) && !check.ownLogLines.some(rule => rule.test(line)));
    if (fresh.length) problems.push(`${name}: ${fresh.length} nye linjer, fx "${fresh[0].slice(0, 160)}"`);
  }
  if (after.system) {
    const fresh = newSystemLogEntries(after.system, startedAt).filter(
      entry => !check.ownLogLines.some(rule => rule.test([].concat(entry.message).join(' '))),
    );
    if (fresh.length) {
      const first = fresh[0];
      problems.push(`HA: ${fresh.length} nye, fx ${first.name}: "${[].concat(first.message)[0]?.slice(0, 160)}"`);
    }
  }
  check.record('logge under kørslen', 'alle', problems.length ? 'fejl' : 'ok', problems.join('; '));
}

// ---------- Rollback ----------

async function rollback(page, ha) {
  const execute = flag('--yes');
  const lastGreen = fs.existsSync(LAST_GREEN) ? JSON.parse(fs.readFileSync(LAST_GREEN, 'utf8')) : null;
  const {backups} = await supervisor(page, '/backups');
  const plan = [];
  for (const [name, addon] of await ourAddons(page)) {
    const backup = rollbackBackup(backups, addon);
    const wanted = lastGreen?.addons?.[addon.slug];
    if (!backup) plan.push({name, note: `ingen update-backup fundet (installeret ${addon.version})`});
    else if (wanted && backup.version !== wanted && addon.version === wanted)
      plan.push({name, note: `allerede på sidste grønne version ${wanted}`});
    else {
      const note = `${addon.version} → ${backup.version} fra "${backup.name}" (${backup.date})`;
      plan.push({name, addon, backup, note});
    }
  }
  const requested = Object.fromEntries(
    args.filter((a, i) => args[i - 1] === '--component').map(a => a.split('=')),
  );
  for (const entity of await ourComponents(page, ha)) {
    const installed = entity.attributes.installed_version;
    const wanted = requested[entity.entity_id] || lastGreen?.components?.[entity.entity_id];
    if (!wanted) plan.push({name: entity.entity_id, note: `ingen kendt grøn version (installeret ${installed})`});
    else if (wanted === installed) plan.push({name: entity.entity_id, note: `allerede ${installed}`});
    else {
      const note = `${installed} → ${wanted}`;
      plan.push({name: entity.entity_id, component: entity.entity_id, version: wanted, note});
    }
  }
  console.log(lastGreen ? `Sidste grønne tjek: ${lastGreen.at}` : 'Ingen sidste grønne tjek gemt endnu.');
  for (const item of plan) console.log(`- ${item.name}: ${item.note}`);
  if (!execute) {
    console.log('\nIntet er ændret. Kør med --yes for at rulle tilbage.');
    return 0;
  }
  let restart = false;
  for (const item of plan) {
    if (item.backup) {
      console.log(`Gendanner ${item.name} …`);
      await supervisor(page, `/backups/${item.backup.slug}/restore/partial`, 'post', {addons: [item.addon.slug]});
    }
    if (item.component) {
      console.log(`Installerer ${item.name} ${item.version} …`);
      await ha.service('update', 'install', {entity_id: item.component, version: item.version, backup: false});
      restart = true;
    }
  }
  if (restart) {
    if (soundAllowed()) {
      console.log('Genstarter Home Assistant for at indlæse komponenten …');
      await ha.service('homeassistant', 'restart', {});
    } else console.log('Komponenten kræver en HA-genstart. Den må først ske kl. 08–18 (kan genoptage lyd).');
  }
  console.log('Tilbagerulning sendt. Kør green-check igen bagefter.');
  return 0;
}

async function rememberGreen(page, ha) {
  const addons = Object.fromEntries((await ourAddons(page)).map(([, a]) => [a.slug, a.version]));
  const components = Object.fromEntries(
    (await ourComponents(page, ha)).map(s => [s.entity_id, s.attributes.installed_version]),
  );
  fs.mkdirSync(path.dirname(LAST_GREEN), {recursive: true});
  fs.writeFileSync(LAST_GREEN, JSON.stringify({at: new Date().toISOString(), addons, components}, null, 2));
  return {addons, components};
}

// ---------- Main ----------

async function main() {
  if (flag('--help') || flag('-h')) {
    console.log(HELP);
    return 0;
  }
  const token = readGreenToken();
  SECRET = token;
  if (!token) {
    console.error('Intet HA-token. Se "node scripts/green-check.mjs --help" under Login.');
    return 2;
  }
  const playwright = loadPlaywright();
  const engine = process.env.GREEN_BROWSER === 'chromium' ? 'chromium' : 'webkit';
  const out = option('--out') || fs.mkdtempSync(path.join(os.tmpdir(), 'green-check-'));
  fs.mkdirSync(out, {recursive: true});
  const ha = haClient(token);
  try {
    await ha.get('/api/');
  } catch (error) {
    console.error(`HA afviste tokenet eller svarede ikke (${error.message}). Se --help under Login.`);
    return 2;
  }
  const browser = await playwright[engine].launch(
    engine === 'chromium' ? greenLaunchOptions(flag('--headed')) : {headless: !flag('--headed')},
  );
  try {
    const context = await greenBrowserContext(browser, token);
    const page = await context.newPage();
    // Uncaught errors (any frame) and console errors from the panel's own frame and bundle; HA's own frontend
    // is not ours to judge here.
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(redact(error.message, token)));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const where = message.location()?.url || '';
      if (where && !/podvoice|podview|^about:/i.test(where)) return;
      pageErrors.push(redact(`console: ${message.text()}`, token).slice(0, 240));
    });

    if (args[0] === 'rollback') {
      await page.goto(`${BASE}/`, {waitUntil: 'domcontentloaded'});
      return await rollback(page, ha);
    }

    const startedAt = Date.now() / 1000;
    const frame = await openPodView(page);
    const addons = await ourAddons(page);
    const versions = addons.map(([name, a]) => `${name} ${a.version}`).join(', ');
    const when = new Date().toLocaleString('da-DK', {timeZone: 'Europe/Copenhagen'});
    const shown = engine === 'webkit' ? 'WebKit' : 'Chromium';
    console.log(`Green-tjek ${when} · ${versions} · /${GREEN_PANEL} i ${shown}`);
    const before = await readLogs(page, ha, addons);
    const check = new Check(page, frame, out);
    const kitchen = await kitchenArea(page).catch(() => null);
    await silentChecks(check, kitchen);
    if (flag('--sound')) await soundChecks(check, ha, kitchen);
    else check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget', 'kør med --sound kl. 08–18');
    await sleep(2000);
    logResults(check, before, await readLogs(page, ha, addons), startedAt);
    const jsErrors = [...new Set([...check.frameErrors, ...(await check.readFrameErrors()), ...pageErrors])];
    check.record('JavaScript-fejl', 'G1', jsErrors.length ? 'fejl' : 'ok', jsErrors.slice(0, 3).join('; '));

    const result = summary(check.results);
    fs.writeFileSync(path.join(out, 'rapport.json'), JSON.stringify({versions, results: check.results}, null, 2));
    console.log(`\n${result.line}. Rapport og skærmbilleder: ${out}`);
    if (result.green) {
      await rememberGreen(page, ha);
      console.log(`Versionerne er gemt som sidste grønne i ${LAST_GREEN}.`);
    } else console.log('Ved rød efter en installation: node scripts/green-check.mjs rollback');
    return result.green ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().then(
  code => process.exit(code),
  error => {
    console.error('Green-tjek kunne ikke køre:', redact(error?.message || error, SECRET));
    process.exit(2);
  },
);
