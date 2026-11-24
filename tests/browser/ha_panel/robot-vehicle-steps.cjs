'use strict';
// Robot and Bil in the HA panel journey (wired in by tests/browser/ha_panel_actual_e2e.cjs with the screen already
// open). Drives every new interaction against the fake hass (podview/src/lib/ha/fixtures/robot-vehicle.ts):
// - Robot, while it cleans: a setting rail is one podvoice.robot_setting, shown at once, confirmed by HA.
// - Robot, at rest: rooms, Antal gange and Start are one podvoice.robot_start from the offer the user saw; »Brug
//   seneste valg« fills the draft from the journal and the next start names that recipe.
// - Bil: the old hero (dot car filled to the battery, its tone), »Seneste hændelser«, and the wake step before a lock.
// Nothing is inert or modal afterwards, and no tap waits for an earlier one.

const calls = (page, service) =>
  page.evaluate(name => window.fakeHass.calls.filter(c => c.service === name).map(c => c.data), service);

async function noModal(page, assert) {
  const frame = page.frames().find(item => item !== page.mainFrame());
  const left = await frame.evaluate(() => ({
    inert: [...document.querySelectorAll('[inert]')].filter(node => !node.closest('pv-answer')).length,
    modal: document.querySelectorAll('dialog[open]').length,
  }));
  assert.deepEqual(left, {inert: 0, modal: 0}, 'nothing is inert or a native modal');
}

async function robotSteps(page, {sleep, assert}) {
  const panel = page.frameLocator('iframe');
  const frame = page.frames().find(item => item !== page.mainFrame());
  const robot = panel.locator('#robot-view');

  // While it cleans: Sugeevne Turbo is one robot_setting from the value the user saw; the rail shows it at once.
  const suction = robot.getByRole('group', {name: 'Sugeevne'});
  await suction.waitFor();
  const before = (await calls(page, 'robot_setting')).length;
  await suction.getByRole('radio', {name: 'Turbo'}).tap();
  await frame.waitForFunction(() => [...document.querySelectorAll('#robot-view input[type=radio]')].some(input =>
    input.checked && input.closest('label')?.textContent === 'Turbo'), null, {timeout: 100});
  await page.waitForFunction(() => window.fakeHass.hass.states['vacuum.qrevo'].attributes.fan_speed === 'turbo');
  const setting = (await calls(page, 'robot_setting')).slice(before);
  assert.equal(setting.length, 1, 'one tap, one setting');
  assert.deepEqual(
    {key: setting[0].key, value: setting[0].value, expected: setting[0].expected_current},
    {key: 'suction', value: 'turbo', expected: 'balanced'},
  );

  // At rest: the rooms of the floor, Antal gange and Start, sent once.
  await page.evaluate(() => {
    window.fakeHass.patch('vacuum.qrevo', 'docked');
  });
  const rooms = robot.getByRole('group', {name: 'Vælg rum'});
  await rooms.getByRole('button', {name: 'Køkkenalrum'}).tap();
  await frame.waitForFunction(() => document.querySelector('#robot-view .robot-room-tile[aria-pressed=true]'), null,
    {timeout: 100});
  await robot.getByRole('group', {name: 'Antal gange'}).getByRole('radio', {name: '2×'}).tap();
  await robot.getByText('Køkkenalrum · 2 gange').waitFor();
  await robot.getByRole('button', {name: 'Start i Køkkenalrum'}).tap();
  await page.waitForFunction(() => window.fakeHass.hass.states['vacuum.qrevo'].state === 'cleaning');
  const [first] = await calls(page, 'robot_start');
  assert.deepEqual([first.area_ids, first.repeat, first.expected_state], [['kokken'], 2, 'docked']);
  assert.match(first.revision, /^[a-f0-9]{64}$/);
  assert.equal(first.recipe_id, undefined, 'a hand-picked start names no recipe');

  // Brug seneste valg: the newest start fills the draft; the start names it.
  await page.evaluate(() => {
    window.fakeHass.patch('vacuum.qrevo', 'docked');
  });
  await robot.getByRole('button', {name: 'Brug seneste valg'}).tap();
  await robot.getByRole('button', {name: 'Valg brugt'}).waitFor();
  await robot.getByRole('button', {name: 'Start i Køkkenalrum'}).tap();
  await page.waitForFunction(() => window.fakeHass.calls.filter(c => c.service === 'robot_start').length === 2);
  const second = (await calls(page, 'robot_start'))[1];
  assert.match(second.recipe_id, /^[0-9a-f]{32}$/);
  assert.deepEqual([second.area_ids, second.repeat], [['kokken'], 2]);
  await robot.getByRole('region', {name: 'Seneste rumvalg'}).waitFor();
  await sleep(200);
  await noModal(page, assert);
}

async function vehicleSteps(page, {sleep, assert}) {
  const panel = page.frameLocator('iframe');
  const frame = page.frames().find(item => item !== page.mainFrame());
  const car = panel.locator('#vehicle-view');

  // The old hero: the dot car filled to the battery level, drawn by the stage stylesheet.
  const hero = car.getByRole('region', {name: 'Bilens status'});
  await hero.waitFor();
  const drawn = await frame.evaluate(() => {
    const node = document.querySelector('#vehicle-view > .vehicle-hero');
    const dots = node?.querySelector('.vehicle-dots');
    return {
      tone: node?.getAttribute('data-car-tone'),
      level: node?.style.getPropertyValue('--pv-car-level'),
      dots: dots ? getComputedStyle(dots).display : null,
      layers: dots ? dots.children.length : 0,
    };
  });
  assert.equal(drawn.level, '0.71');
  assert.notEqual(drawn.dots, 'none', 'the dot car is drawn for a Model Y');
  assert.equal(drawn.layers, 4);
  assert.ok(['parked', 'climate', 'unknown'].includes(drawn.tone));

  // Seneste hændelser: HA's recorded changes, or the old empty text.
  await car.getByRole('region', {name: 'Seneste hændelser'}).waitFor();

  // Lock can wake the car: the dialog says so before anything is sent.
  if (await car.getByRole('button', {name: 'Lås bilen'}).count()) {
    const sent = (await calls(page, 'vehicle_command')).length;
    await car.getByRole('button', {name: 'Lås bilen'}).tap();
    const ask = panel.getByRole('alertdialog', {name: 'Lås bilen?'});
    await ask.waitFor();
    await ask.getByText(/Handlingen kan vække bilen\./).waitFor();
    await ask.getByRole('button', {name: 'Lås bilen'}).tap();
    await page.waitForFunction(n => window.fakeHass.calls.filter(c => c.service === 'vehicle_command'
      && c.data.action === 'lock').length >= 1 && window.fakeHass.calls.filter(c => c.service === 'vehicle_command')
      .length > n, sent);
    await page.waitForFunction(() => window.fakeHass.hass.states['lock.model_y_lock'].state === 'locked');
  }
  await sleep(200);
  await noModal(page, assert);
}

module.exports = {robotSteps, vehicleSteps};
