'use strict';
// PodView's screens as pictures: every screen and its main states in WebKit at the wall iPad's 1180×820, compared
// with the committed baselines in tests/browser/ha_panel/screens/ (the same fake `hass` and built panel as
// ha_panel_actual_e2e.cjs). The clock is fixed, so the topbar, timers and forecasts draw the same every run.
// A screen differs when more than MAX_DIFF of its pixels move by more than TOLERANCE in a channel; the actual
// picture and a diff are written to PODVIEW_TEST_ARTIFACT_DIR. A deliberate change updates the baselines:
//   UPDATE_BASELINES=1 node tests/browser/ha_panel_screens.cjs
// Baselines are drawn by Playwright's own Linux image (as CI runs it, PODVIEW_TEST_WEBKIT_ENDPOINT); a Mac's WebKit
// draws text differently.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const env = require('./podview_actual_env.cjs');

const root = path.resolve(__dirname, '../..');
const esbuild = require(path.join(root, 'node_modules/esbuild'));
const BASELINES = path.join(__dirname, 'ha_panel/screens');
const UPDATE = process.env.UPDATE_BASELINES === '1';
const ONLY = process.env.SCREENS ? new Set(process.env.SCREENS.split(',')) : null;
const TOLERANCE = 40;
const MAX_DIFF = Number(process.env.MAX_DIFF ?? 0.002);
const NOW = new Date('2026-11-19T16:24:00+01:00');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json'};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function serve() {
  const fixture = esbuild.buildSync({entryPoints: [path.join(root, 'podview/src/lib/ha/ha-fixture.ts')], bundle: true,
    format: 'esm', write: false, target: 'safari16'}).outputFiles[0].text;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/ha_panel/fixture.js') {
      response.writeHead(200, {'Content-Type': 'text/javascript'});
      response.end(fixture);
      return;
    }
    const versioned = /^\/podvoice_static\/frontend\/[0-9a-f]{12}\/(.+)$/.exec(url.pathname);
    let file = null;
    if (versioned) file = path.join(root, 'custom_components/podvoice/frontend', versioned[1]);
    else if (url.pathname.startsWith('/ha_panel/')) file = path.join(__dirname, 'ha_panel', url.pathname.slice(10));
    try {
      if (!file || !path.resolve(file).startsWith(root)) throw Error('outside');
      const body = await fsp.readFile(file);
      response.writeHead(200, {'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream'});
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

// Pixels compared in the browser itself (canvas), so the journey needs no image library.
async function compare(page, actual, expected) {
  return page.evaluate(async ([a, b, tolerance]) => {
    const load = async data => createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const [one, two] = await Promise.all([load(a), load(b)]);
    if (one.width !== two.width || one.height !== two.height) return {ratio: 1, diff: null};
    const pixels = bitmap => {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const x = pixels(one), y = pixels(two), out = new ImageData(one.width, one.height);
    let changed = 0;
    for (let i = 0; i < x.data.length; i += 4) {
      const delta = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]),
        Math.abs(x.data[i + 2] - y.data[i + 2]));
      const gray = (y.data[i] + y.data[i + 1] + y.data[i + 2]) / 12 + 160;
      if (delta > tolerance) {
        changed++;
        out.data.set([255, 0, 80, 255], i);
      } else out.data.set([gray, gray, gray, 255], i);
    }
    const canvas = new OffscreenCanvas(one.width, one.height);
    canvas.getContext('2d').putImageData(out, 0, 0);
    const blob = await canvas.convertToBlob({type: 'image/png'});
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {ratio: changed / (x.data.length / 4), diff: btoa(binary)};
  }, [actual.toString('base64'), expected.toString('base64'), TOLERANCE]);
}

(async () => {
  let server, browser;
  const failures = [];
  try {
    server = await serve();
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await env.webkit();
    // Reduced motion: the screens are judged at rest. Springs and ambient loops run as JavaScript (motion/react), so
    // the run asks for the system's reduced motion: nothing moves by itself, a transition is a short fade, and a
    // loop stands still at its resting look. The motion itself is the journey's (ha_panel_actual_e2e.cjs).
    const context = await browser.newContext({hasTouch: true, viewport: {width: 1180, height: 820},
      timezoneId: 'Europe/Copenhagen', locale: 'da-DK', reducedMotion: 'reduce'});
    await context.clock.setFixedTime(NOW);
    const PIXEL = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
    await context.route(url => url.protocol === 'https:', route =>
      route.request().resourceType() === 'image'
        ? route.fulfill({status: 200, contentType: 'image/gif', body: PIXEL}) : route.continue());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const scratch = await context.newPage();
    await scratch.setContent('<!doctype html><title>diff</title>');
    await page.goto(base + '/ha_panel/host.html', {waitUntil: 'load'});
    const frame = await (await page.waitForSelector('iframe')).contentFrame();
    const panel = page.frameLocator('iframe');
    const home = () => panel.getByRole('heading', {level: 1, name: 'Køkkenalrum'}).waitFor();
    await home();
    await frame.waitForFunction(() => document.fonts.status === 'loaded');
    const back = async () => {
      await panel.getByRole('button', {name: 'Tilbage'}).tap();
      await sleep(150);
    };
    // Settled: no running finite animation, then two frames.
    let shown = frame;
    const settle = async () => {
      await sleep(250);
      await shown.waitForFunction(() => !document.getAnimations().some(animation =>
        animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity), null,
      {timeout: 5000}).catch(() => {});
      await shown.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await sleep(150);
    };
    const shoot = async (name, capture = () => page.screenshot({animations: 'disabled', caret: 'hide',
      mask: [panel.locator('[data-diag]')], maskColor: '#888888'})) => {
      if (ONLY && !ONLY.has(name)) return;
      await settle();
      const actual = await capture();
      const file = path.join(BASELINES, `${name}.png`);
      if (UPDATE || !fs.existsSync(file)) {
        fs.mkdirSync(BASELINES, {recursive: true});
        fs.writeFileSync(file, actual);
        console.log(`  ${name}: baseline written`);
        return;
      }
      const {ratio, diff} = await compare(scratch, actual, fs.readFileSync(file));
      const percent = (ratio * 100).toFixed(3);
      if (ratio <= MAX_DIFF) {
        console.log(`  ${name}: ok (${percent} % differ)`);
        return;
      }
      const out = env.artifactDir();
      fs.writeFileSync(path.join(out, `${name}.actual.png`), actual);
      if (diff) fs.writeFileSync(path.join(out, `${name}.diff.png`), Buffer.from(diff, 'base64'));
      console.log(`  ${name}: DIFFERS (${percent} % of the pixels; ${out})`);
      failures.push(name);
    };

    // Hjem.
    await panel.getByRole('button', {name: /^Vis kø · Holocene af Bon Iver/}).waitFor();
    await panel.getByRole('button', {name: 'Musik, Regnvejr og torsdag aften'}).waitFor();
    await shoot('hjem');
    // Lys.
    await panel.getByRole('button', {name: /^Lys/}).tap();
    await panel.getByRole('switch', {name: /Køkkenø/}).waitFor();
    await shoot('lys');
    // Lys: Stue (three lamps, two unplugged: the fold starts closed), »Sluk alt« → »Gendan lys«, and no link.
    const lys = panel.locator('[data-screen=lights]');
    await lys.locator('[data-room-id="stue"] button').first().tap();
    await lys.getByRole('region', {name: 'Stue'}).waitFor();
    await shoot('lys-stue');
    await lys.getByRole('button', {name: /^Lamper/}).tap();
    await lys.getByRole('switch', {name: /Mushroom/}).waitFor();
    await shoot('lys-stue-lamper');
    await lys.locator('[data-room-id="kokken"] button').first().tap();
    await lys.getByRole('button', {name: 'Sluk alle lys i hjemmet'}).tap();
    await lys.getByRole('button', {name: 'Gendan lyset i hjemmet som før slukning'}).waitFor();
    await page.waitForFunction(() => window.fakeHass.hass.states['light.stue_lampe'].state === 'off');
    await shoot('lys-slukket');
    await lys.getByRole('button', {name: 'Gendan lyset i hjemmet som før slukning'}).tap();
    await page.waitForFunction(() => window.fakeHass.hass.states['light.stue_lampe'].state === 'on');
    await lys.getByRole('button', {name: 'Sluk alle lys i hjemmet'}).waitFor();
    await page.evaluate(() => {
      window.fakeHass.setConnected(false);
    });
    await lys.getByText('Lysoplysninger kunne ikke hentes. Prøv igen.').waitFor();
    await shoot('lys-ukendt');
    await page.evaluate(() => {
      window.fakeHass.setConnected(true);
    });
    await lys.getByText('Lysoplysninger kunne ikke hentes. Prøv igen.').waitFor({state: 'detached'});
    await back();
    // Afspiller with its queue, the room sheet with »Afspil på«; Find musik and Radio from Hjem's tiles.
    await panel.getByRole('button', {name: /^Vis kø/}).first().tap();
    const music = panel.locator('[data-screen=music]');
    await music.getByRole('button', {name: /^Afspil 2 · /}).waitFor();
    await shoot('musik');
    await panel.getByRole('complementary', {name: 'Rummets musik'}).getByRole('button', {name: /^Rum: /}).tap();
    // The sheet's own »Luk« (React Aria's hidden dismiss button for screen readers has the same name).
    const close = panel.getByRole('dialog', {name: 'Vælg rum'}).getByRole('button', {name: 'Luk'});
    await close.waitFor();
    await shoot('musik-afspil-paa');
    await close.tap();
    await close.waitFor({state: 'detached'});
    await back();
    await home();
    await panel.locator('#home-view').getByRole('button', {name: /^Musik, /}).tap();
    const find = panel.locator('[data-screen=find]');
    await find.getByRole('group', {name: 'Regnvejr og torsdag aften'}).getByRole('button').first().waitFor();
    await shoot('find-musik');
    await back();
    await home();
    await panel.locator('#home-view').getByRole('button', {name: /^Radio, /}).tap();
    const radio = panel.locator('[data-screen=radio]');
    await radio.getByRole('button', {name: /^P3/}).waitFor();
    await shoot('radio');
    // A station plays: the hero in its colour, the needle on the scale, the player in radio mode.
    await radio.getByRole('button', {name: /^P8 Jazz/}).tap();
    await radio.locator('[data-radio-phase=spiller] [data-needle]').waitFor();
    await shoot('radio-spiller');
    await panel.getByRole('complementary', {name: 'Rummets musik'}).getByRole('button', {name: 'Stop'}).tap();
    await radio.locator('[data-radio-phase=vaelg]').waitFor();
    // The room's speaker plays its track again, as before the radio (the other screens are drawn with it).
    await page.evaluate(() => {
      window.fakeHass.patch('media_player.kokkenalrum', 'playing', {media_title: 'Holocene', media_artist: 'Bon Iver',
        media_content_id: 'spotify:track:0', volume_level: 0.3, podconnect_source: 'spotify',
        supported_features: 1 | 4 | 16 | 32 | 16384});
    });
    await panel.getByRole('button', {name: /^Vis kø · Holocene af Bon Iver/}).waitFor();
    await back();
    await home();
    // Vejr.
    await panel.getByRole('button', {name: /Let skyet/}).tap();
    await panel.locator('[data-screen=weather]').getByRole('heading').first().waitFor();
    // G7 #13: the add-on's AI advice (podvoice.weather_advice), started once on the visit, in A-Vejr's slot.
    await panel.locator('[data-screen=weather]').getByLabel(/^AI-råd baseret på vejrudsigten: /).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fakeHass.calls.filter(call => call.service === 'weather_advice')
      .map(call => call.data)), [{start: true}]);
    await shoot('vejr');
    // The rest of Vejr under the fold: »De næste dage« and the source.
    await frame.evaluate(() => {
      const view = document.querySelector('#weather-view');
      for (let node = view?.parentElement; node; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
          node.scrollTop = node.scrollHeight;
          break;
        }
      }
    });
    await shoot('vejr-dage');
    await back();
    // Timer: the draft, the full-screen alarm, the page's own done state, and running again (»Start igen«; the
    // running timer's chip stays in the topbar for the screens after it).
    await panel.getByRole('button', {name: /^Timer/}).tap();
    const timers = panel.locator('[data-screen=timers]');
    await timers.getByRole('button', {name: '5 min', exact: true}).tap();
    // G7 #15: the chosen preset reads as chosen, and the draft is the L hero's 458 (as the running face).
    assert.equal(await timers.getByRole('button', {name: '5 min', exact: true}).getAttribute('aria-pressed'), 'true');
    assert.equal(Math.round((await timers.getByRole('form', {name: 'Ny timer'}).boundingBox()).height), 458);
    await shoot('timer-ny');
    await timers.getByRole('button', {name: 'Start timer'}).tap();
    await timers.getByRole('article', {name: /^Timer · /}).waitFor();
    await page.evaluate(() => {
      window.fakeHass.finishTimers();
    });
    const alarm = panel.getByRole('alertdialog', {name: 'Timeren er færdig'});
    await alarm.waitFor();
    await shoot('timer-alarm');
    await alarm.getByRole('button', {name: 'Luk visning'}).tap();
    await alarm.waitFor({state: 'detached'});
    await timers.getByRole('button', {name: /^Start igen/}).waitFor();
    await shoot('timer-faerdig');
    await timers.getByRole('button', {name: /^Start igen/}).tap();
    await timers.getByText(/5:00|4:59/).first().waitFor();
    // G7 #15: the running time is in mono, as the draft's, and +1 min stands before −1 min (A-Timer).
    const face = timers.locator('article[data-status=running]');
    assert.match(await face.locator('[data-pv-digit]').first().evaluate(node => getComputedStyle(node).fontFamily),
      /Plex Mono/);
    assert.deepEqual(await face.getByRole('button', {name: /^1 minut m/})
      .evaluateAll(keys => keys.map(key => key.getAttribute('aria-label'))), ['1 minut mere', '1 minut mindre']);
    await shoot('timer');
    await back();
    // Robot while it cleans, and its confirmation step.
    await page.evaluate(() => {
      window.fakeHass.patch('vacuum.qrevo', 'cleaning');
    });
    await panel.locator('#home-robot').tap();
    const robot = panel.locator('[data-screen=robot]');
    await robot.getByRole('radiogroup', {name: 'Sugeevne'}).waitFor();
    await shoot('robot');
    // »Mere ▾« folds out what else is possible now (A-Robot, Robot-Mere).
    await robot.getByRole('button', {name: 'Mere'}).tap();
    await robot.getByRole('button', {name: 'Kør til basen'}).waitFor();
    await sleep(400);
    await shoot('robot-mere');
    await robot.getByRole('button', {name: 'Kør til basen'}).tap();
    const ask = panel.getByRole('alertdialog', {name: 'Kør til basen?'});
    await ask.waitFor();
    await shoot('robot-bekraeft');
    await ask.getByRole('button', {name: 'Behold turen'}).tap();
    await ask.waitFor({state: 'detached'});
    // The robot's other states (A-Robot, Robot-Pause/Fejl/Ukendt): the hero says each as its title.
    for (const [state, name, title] of [['docked', 'robot-oplader', 'I basen'], ['paused', 'robot-pause', 'På pause'],
      ['error', 'robot-fejl', 'Robotten melder en fejl'], ['unavailable', 'robot-ukendt', 'Status ukendt']]) {
      await page.evaluate(value => {
        window.fakeHass.patch('vacuum.qrevo', value);
      }, state);
      await robot.getByRole('heading', {name: title, exact: true}).waitFor();
      await sleep(300);
      if (state === 'docked') {
        // G7 #6/#17: docked, the hero has a primary that starts (every room, once) and »Mere ▾« beside it.
        const start = robot.locator('#robot-hero [data-action-id=start]');
        assert.equal(await start.textContent(), 'Start · alle rum');
        assert.equal(await start.isDisabled(), false);
        await robot.locator('#robot-hero').getByRole('button', {name: 'Mere'}).waitFor();
      }
      await shoot(name);
    }
    await page.evaluate(() => {
      window.fakeHass.patch('vacuum.qrevo', 'cleaning');
    });
    await robot.getByRole('heading', {name: 'Rengør', exact: true}).waitFor();
    await back();
    await home();
    // Tesla (A-Tesla, Tesla-Handling, Tesla-Lader).
    await panel.locator('#home-vehicle').tap();
    const car = panel.locator('[data-screen=vehicle]');
    await car.getByRole('button', {name: /^Døre: Låst/}).waitFor();
    // G7 #18/#7/#22: the seats' words stand whole (never »Mell…«), the hero's metrics are not under the car, and
    // its words are black.
    const cutSeats = await car.getByRole('radio').evaluateAll(radios => radios.map(radio => radio.querySelector('span'))
      .filter(span => span && span.scrollWidth > span.clientWidth + 0.5).map(span => span.textContent));
    assert.deepEqual(cutSeats, [], 'seat levels are not ellipsised');
    const heroBox = car.getByRole('region', {name: 'Bilens status'});
    const [metrics, art] = await Promise.all([heroBox.locator('dl').boundingBox(),
      heroBox.locator('svg[viewBox="0 0 540 168"]').boundingBox()]);
    assert.ok(metrics.y >= art.y + art.height - 1, 'the hero metrics stand below the car');
    assert.equal(await heroBox.getByRole('heading').evaluate(node => getComputedStyle(node).color),
      'rgb(23, 23, 26)');
    await shoot('bil');
    await car.getByRole('button', {name: /^Døre: Låst/}).tap();
    const unlock = panel.getByRole('alertdialog', {name: 'Lås bilen op?'});
    await unlock.waitFor();
    await shoot('bil-bekraeft');
    await unlock.getByRole('button', {name: 'Annuller'}).tap();
    await unlock.waitFor({state: 'detached'});
    await page.evaluate(() => {
      window.fakeHass.patch('sensor.model_y_charging', 'charging');
    });
    await car.getByRole('heading', {name: 'Lader', exact: true}).waitFor();
    await sleep(300);
    await shoot('bil-lader');
    await page.evaluate(() => {
      window.fakeHass.patch('sensor.model_y_charging', 'disconnected');
    });
    await car.getByRole('heading', {name: 'Parkeret', exact: true}).waitFor();
    // Tesla-RobotFejl: another domain's fault is the red badge by the clock; a press goes there.
    await page.evaluate(() => {
      window.fakeHass.patch('vacuum.qrevo', 'error');
    });
    await panel.getByRole('button', {name: 'Robotfejl. Gå til Robotstøvsuger'}).waitFor();
    await sleep(500);
    await shoot('bil-robotfejl');
    await page.evaluate(() => {
      window.fakeHass.patch('vacuum.qrevo', 'cleaning');
    });
    await panel.getByRole('button', {name: 'Robotfejl. Gå til Robotstøvsuger'}).waitFor({state: 'detached'});
    await back();
    // Svar.
    await panel.getByRole('button', {name: 'Se tidligere svar'}).tap();
    await panel.locator('[data-screen=answers]').getByRole('button', {name: /En rolig morgen/}).waitFor();
    await shoot('svar');
    // Svar's states (A-SvarKort, Kit-SvarKnap): a follow-up in the same card, the card being built, the voice
    // listening and a failed answer in the key, every answer form, and the empty history beside the player.
    const answers = panel.locator('[data-screen=answers]');
    const addon = async (change, check, arg = null) => {
      await page.evaluate(change, arg);
      await check();
    };
    const phase = value => window.fakeHass.patch('sensor.podvoice_voice_phase', value, {rooms: {kokken: value}});
    await addon(() => {
      window.addonAnswers.followUp = true;
      window.fakeHass.pushAll('podvoice/answers_subscribe');
    }, () => answers.locator('[data-follow-up]').waitFor());
    await shoot('svar-opfoelg');
    await addon(phase, () => panel.locator('[data-svar-state=lytter]').waitFor(), 'listening');
    await shoot('svar-lytter');
    await addon(() => {
      window.addonAnswers.pending = true;
      window.fakeHass.patch('sensor.podvoice_voice_phase', 'thinking', {rooms: {kokken: 'thinking'}});
      window.fakeHass.pushAll('podvoice/answers_subscribe');
    }, () => answers.getByRole('status', {name: 'Svaret bygges'}).waitFor());
    await shoot('svar-bygger');
    await addon(() => {
      window.addonAnswers.pending = false;
      window.addonAnswers.followUp = false;
      window.fakeHass.patch('sensor.podvoice_voice_phase', 'error', {rooms: {kokken: 'error'}});
      window.fakeHass.pushAll('podvoice/answers_subscribe');
    }, () => answers.getByText('Svaret kom ikke frem').waitFor());
    await shoot('svar-fejl');
    await addon(() => {
      window.fakeHass.patch('sensor.podvoice_voice_phase', 'rest', {rooms: {kokken: 'rest'}});
      window.addonAnswers.forms = true;
      window.fakeHass.pushAll('podvoice/answers_subscribe');
    }, () => answers.getByRole('button', {name: / · El Clásico · /}).waitFor());
    for (const [name, title] of [['resultat', 'El Clásico'], ['billede', 'En pause ved vandet'],
      ['diagram', 'Gear ændrer'], ['trin', 'Fold et papirfly'], ['tjekliste', 'Klar til at lave et kort'],
      ['tekst', 'Skal jeg tage en jakke med']]) {
      await answers.getByRole('button', {name: new RegExp(` · ${title}`)}).tap();
      await answers.locator('[data-answer-card]').filter({hasText: title}).waitFor();
      await shoot(`svar-${name}`);
    }
    await addon(() => {
      window.addonAnswers.forms = false;
      window.addonAnswers.state = 'empty';
      window.fakeHass.pushAll('podvoice/answers_subscribe');
    }, () => answers.getByText('Ingen visuelle svar endnu').waitFor());
    await shoot('svar-tom');
    await page.evaluate(() => {
      window.addonAnswers.state = 'ready';
      window.fakeHass.pushAll('podvoice/answers_subscribe');
    });
    await back();
    // Opskrifter (A-Opskrifter, Opskrifter-Bog, A-Opskrift, Opskrift-TimerKoerer): the catalogue, a recipe before
    // and while it is cooked (step 2 with its timer key, a step timer running), Udforsk, and the catalogue's band.
    await panel.locator('#home-recipes').tap();
    const recipes = panel.locator('[data-screen=recipes]');
    await recipes.getByRole('button', {name: /^Burgerboller/}).waitFor();
    await shoot('opskrifter');
    await recipes.getByRole('button', {name: /^Burgerboller/}).tap();
    const recipeView = panel.locator('[data-screen=recipe]');
    await recipeView.getByRole('button', {name: 'Start opskrift'}).waitFor();
    await shoot('opskrift');
    await recipeView.getByRole('button', {name: 'Markér trin 1 færdigt'}).tap();
    await recipeView.getByRole('button', {name: '350 ml koldt vand'}).tap();
    await recipeView.getByRole('button', {name: 'Start timer på 30 min'}).waitFor();
    await shoot('opskrift-igang');
    await recipeView.getByRole('button', {name: 'Start timer på 30 min'}).tap();
    await recipeView.getByRole('button', {name: /^Timer kører/}).waitFor();
    await shoot('opskrift-timer');
    await back();
    await recipes.locator('#recipe-resume').waitFor();
    await shoot('opskrifter-igang');
    await recipes.getByRole('button', {name: 'Udforsk'}).tap();
    await recipes.getByRole('group', {name: 'Udforsk opskrifter'}).waitFor();
    await shoot('opskrifter-udforsk');
    await recipes.getByRole('radio', {name: 'Katalog'}).tap();
    await recipes.getByRole('list', {name: 'Alle opskrifter'}).waitFor();
    await back();
    await home();
    // Skærm og enhed (A-Skaerm) from the clock: the wall's brightness through the Companion app's kiosk mode.
    await panel.getByRole('button', {name: /Skærm og enhed$/}).tap();
    await panel.getByRole('dialog', {name: 'Skærm og enhed'}).waitFor();
    // G7 #23: the room row says »Rum«; the build is the labelled »Version« row.
    await panel.getByRole('dialog', {name: 'Skærm og enhed'}).getByText('Rum', {exact: true}).waitFor();
    await panel.getByRole('dialog', {name: 'Skærm og enhed'}).getByText('Version', {exact: true}).waitFor();
    await shoot('skaerm');
    await page.keyboard.press('Escape');
    await panel.getByRole('dialog', {name: 'Skærm og enhed'}).waitFor({state: 'detached'});
    // Ro.
    await panel.getByRole('button', {name: 'Gå til Ro'}).tap();
    await frame.waitForSelector('#photo-view', {state: 'visible'});
    await sleep(800);
    await shoot('ro');
    // Lys without lights in HA: »Ikke forbundet« with »Opdater lys«.
    await panel.locator('#photo-view').tap();
    await home();
    await page.evaluate(() => {
      window.fakeHass.removeEntities(Object.keys(window.fakeHass.hass.states).filter(id => id.startsWith('light.')));
    });
    await panel.getByRole('button', {name: /^Lys, Ikke forbundet/}).tap();
    await panel.getByRole('button', {name: 'Opdater lys'}).waitFor();
    await shoot('lys-ikke-forbundet');

    // The kit (src/ui, docs/PODVIEW-PARITY.md G1): every piece of the kit gallery at the stage's own size, without
    // safe areas, as it was laid next to the design canvas's boards (the canvas pictures are in
    // tests/browser/ha_panel/reference/). A kit piece that drifts from its baseline fails here.
    await page.goto(base + '/ha_panel/host.html?kit=1&safeTop=0px&safeBottom=0px', {waitUntil: 'load'});
    const kitFrame = await (await page.waitForSelector('iframe')).contentFrame();
    shown = kitFrame;
    await kitFrame.waitForSelector('[data-gallery="vejr-frisk"]');
    await kitFrame.waitForFunction(() => document.fonts.status === 'loaded');
    // No widget title is cut short at any size (K-Widget: »Opskrifter ›« stands whole in an S widget).
    const cut = await kitFrame.evaluate(() => [...document.querySelectorAll('[data-widget-title]')]
      .filter(node => node.scrollWidth > node.clientWidth + 0.5).map(node => node.textContent));
    assert.deepEqual(cut, [], 'widget titles are not ellipsised');
    // G7 #18: the Musik widget's lines stand whole too (»Regnvejr og t…«, »Dagens AI-valg · …« and »Fortsæt og
    // playli…« were cut): the copy fits the S widget, as on the canvas.
    const cutLines = await kitFrame.evaluate(() => [...document.querySelectorAll(
      '[data-kind=musik] [data-widget-prim], [data-kind=musik] [data-widget-ctx]')]
      .filter(node => node.scrollWidth > node.clientWidth + 0.5).map(node => node.textContent));
    assert.deepEqual(cutLines, [], 'Musik widget lines are not ellipsised');
    // A primary line that may wrap (Musik's AI pick, up to 48 characters) stands whole in its up to three lines.
    const clipped = await kitFrame.evaluate(() => [...document.querySelectorAll('[data-widget-prim="wrap"]')]
      .filter(node => node.scrollHeight > node.clientHeight + 0.5 || node.scrollWidth > node.clientWidth + 0.5)
      .map(node => node.textContent));
    assert.deepEqual(clipped, [], 'a wrapping widget title is never cut');
    const pieces = await kitFrame.evaluate(() => [...document.querySelectorAll('[data-gallery]')]
      .map(node => node.getAttribute('data-gallery')).filter(name => name !== 'notice-lifecycle'));
    for (const piece of pieces) {
      const element = kitFrame.locator(`[data-gallery="${piece}"]`);
      await shoot(`kit-${piece}`, async () => {
        await element.scrollIntoViewIfNeeded();
        return element.screenshot({animations: 'disabled', caret: 'hide'});
      });
    }

    // Kit-Kontroller's dialog and the sheet, each open over a fresh gallery (React Aria ignores a press it reads as
    // the opening one while the test's clock stands still, so the overlay is left open rather than closed).
    for (const [key, name, role] of [['Vis dialog', 'kit-dialog', 'alertdialog'], ['Vis ark', 'kit-sheet', 'dialog']]) {
      if (ONLY && !ONLY.has(name)) continue;
      await page.goto(base + '/ha_panel/host.html?kit=1&safeTop=0px&safeBottom=0px', {waitUntil: 'load'});
      const gallery = await (await page.waitForSelector('iframe')).contentFrame();
      shown = gallery;
      await gallery.waitForFunction(() => document.fonts.status === 'loaded');
      const open = gallery.getByRole('button', {name: key});
      await open.scrollIntoViewIfNeeded();
      await open.tap();
      await gallery.getByRole(role).first().waitFor();
      await shoot(name);
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(failures, [], 'screens differ from their baselines');
    console.log('ha_panel_screens: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.close();
  }
})();
