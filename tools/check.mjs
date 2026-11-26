import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { examples, makePreview } from './preview.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const artifacts = resolve(repo, '.artifacts');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const chromium = process.env.UI_CHROMIUM ?? (process.platform === 'win32' ? edge : 'chromium');

async function until(test, message, timeout = 15000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    const match = await test();
    if (match) return match;
    await delay(40);
  }
  throw new Error(message);
}

async function browserSession() {
  if (process.platform === 'win32' && chromium === edge) await access(edge);
  const profile = await mkdtemp(join(artifacts, 'chromium-'));
  const browser = spawn(chromium, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--disable-extensions',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let socket;
  const exit = new Promise((ready) => {
    browser.once('close', ready);
    browser.once('error', ready);
  });
  async function close() {
    socket?.close();
    if (browser.exitCode === null) browser.kill();
    await exit;
    if (dirname(profile) === artifacts) {
      await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  }
  try {
    const [port] = await until(async () => {
      assert.equal(browser.exitCode, null, 'Chromium exited before opening its debugger');
      return readFile(join(profile, 'DevToolsActivePort'), 'utf8').then((text) => text.trim().split('\n'), () => null);
    }, 'Chromium did not open its local debugger');
    const targets = await fetch(`http://127.0.0.1:${port.trim()}/json/list`, { signal: AbortSignal.timeout(5000) });
    const tab = (await targets.json()).find((candidate) => candidate.type === 'page');
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ready, reject) => {
      socket.addEventListener('open', ready, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const packet = JSON.parse(data);
      const waiter = pending.get(packet.id);
      if (!waiter) return;
      pending.delete(packet.id);
      clearTimeout(waiter.timer);
      if (packet.error) waiter.reject(new Error(packet.error.message));
      else waiter.resolve(packet.result);
    });
    const run = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chromium protocol timeout: ${method}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    async function read(expression) {
      const { result, exceptionDetails } = await run('Runtime.evaluate', { expression, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    }
    async function page(preview, profile, { touch = false, ...settings } = {}) {
      const [width, height] = preview.recipe.design.profiles[profile].viewport;
      await run('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
      await run('Emulation.setTouchEmulationEnabled', { enabled: touch });
      await run('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: settings.reduced ? 'reduce' : 'no-preference' }],
      });
      const url = `${preview.url}?${new URLSearchParams({ profile, clean: '1', ...settings })}`;
      await run('Page.navigate', { url });
      await until(async () => {
        const state = await read(`location.href === ${JSON.stringify(url)} && (document.querySelector('#failure')?.textContent ||
          (document.documentElement.dataset.ready === '1' && document.querySelector('#stage').dataset.profile === '${profile}' ? 'ready' : ''))`).catch(() => '');
        if (state && state !== 'ready') throw new Error(state);
        return state === 'ready';
      }, `Preview did not load: ${profile}`);
    }
    async function capture(path, [width, height]) {
      const { data } = await run('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const png = Buffer.from(data, 'base64');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, png);
    }
    async function point(id) {
      const hit = await read(`(() => {
        const target = document.querySelector('[data-node="${id}"]');
        const box = target.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        return [x, y, target.contains(document.elementFromPoint(x, y))];
      })()`);
      assert.ok(hit[2], `Input hit another layer: ${id}`);
      return hit;
    }
    async function click(id) {
      const [x, y] = await point(id);
      await run('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await run('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    async function tapAt(x, y) {
      await run('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await run('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    async function tap(id) {
      const [x, y] = await point(id);
      await tapAt(x, y);
      return [x, y];
    }
    const escape = async () => {
      await run('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await run('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    };
    const lifecycle = (state) => run('Page.setWebLifecycleState', { state });
    return { page, read, capture, click, tapAt, tap, lifecycle, escape, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function assertBounds(browser, minTouch = 44) {
  const errors = await browser.read(`Array.from(document.querySelectorAll('[data-qa]')).flatMap(element => {
    if (!element.getClientRects().length) return [];
    const stage = document.querySelector('#stage');
    const outer = stage.getBoundingClientRect();
    const scale = outer.width / parseFloat(stage.style.width);
    const [top, right, bottom, left] = stage.dataset.safe.split(',').map(Number);
    const rect = element.getBoundingClientRect();
    const ok = rect.left >= outer.left + left * scale - 1 && rect.right <= outer.right - right * scale + 1 &&
      rect.top >= outer.top + top * scale - 1 && rect.bottom <= outer.bottom - bottom * scale + 1;
    const touch = element.dataset.qa !== 'touch' || Math.min(rect.width, rect.height) / scale >= ${minTouch} - 0.01;
    return ok && touch ? [] : [element.dataset.node];
  })`);
  assert.deepEqual(errors, [], 'Design elements exceed safe insets or the touch fixture is too small');
}

async function assertCopy(browser, ids) {
  const errors = await browser.read(`(${JSON.stringify(ids)}).flatMap(id => {
    const copy = document.querySelector('[data-node="' + id + '"] .copy');
    const range = document.createRange();
    range.selectNodeContents(copy);
    const text = range.getBoundingClientRect();
    const rect = copy.getBoundingClientRect();
    return text.width <= rect.width + 1 && text.height <= rect.height + 1 ? [] : [id];
  })`);
  assert.deepEqual(errors, [], 'Text exceeds its allocated area');
}

const logged = (browser) => browser.read('window.preview.counts');
const settled = (browser, state) => until(
  () => browser.read(`window.preview.state === '${state}' && window.preview.time === undefined`),
  `Did not settle to ${state}`,
);
const focus = (browser) => browser.read('document.activeElement.dataset.node');
const transform = (browser, id) => browser.read(`document.querySelector('[data-node="${id}"]').style.transform`);
const opacity = (browser, id) => browser.read(`Number(document.querySelector('[data-node="${id}"]').style.opacity)`);

async function waitForOffset(browser, id, axis, predicate) {
  return until(async () => {
    const value = await browser.read(`(() => {
      const node = document.querySelector('[data-node="${id}"]');
      const matrix = getComputedStyle(node).transform;
      return matrix === 'none' ? 0 : new DOMMatrix(matrix).${axis};
    })()`);
    return predicate(value);
  }, `Idle track did not move: ${id}`, 5500);
}

async function checkRewards(browser, preview, profile) {
  let summary;
  for (const scenario of ['normal', 'skip', 'rapid', 'reduced']) {
    await browser.page(preview, profile, scenario === 'reduced' ? { reduced: '1' } : {});
    await browser.click('reward-trigger');
    assert.equal(await transform(browser, 'reward-trigger-icon'), '');
    if (scenario === 'skip') {
      const { after, at } = preview.recipe.motion.reveal.skip;
      await until(() => browser.read(`window.preview.time >= ${after}`), 'Skip debounce did not elapse');
      await browser.click('reveal-tap');
      assert.ok(await browser.read(`window.preview.time >= ${at}`), 'Skip did not reach the opening phase');
    }
    if (scenario === 'rapid') {
      await browser.read(`Array.from({length: 8}, () => document.querySelector('[data-node="reward-trigger"]').click()) && true`);
      await browser.click('reveal-tap');
      await browser.click('reveal-tap');
    }
    await settled(browser, 'summary');
    assert.deepEqual(await logged(browser), { 'claim-chapter-tasks': 1 });
    assert.equal(await focus(browser), 'reward-dismiss');
    const result = await browser.read(`[...document.querySelectorAll('[data-node^="card-value-"] .copy')].map(node => node.textContent)`);
    summary ??= result;
    assert.deepEqual(result, summary);
    await browser.click('reward-dismiss');
    await settled(browser, 'claimed');
    assert.deepEqual(await logged(browser), { 'claim-chapter-tasks': 1, 'dismiss-last-grant': 1 });
    assert.equal(await focus(browser), 'reward-later');
    assert.equal(await browser.read(`document.querySelector('[data-node="reward-trigger"]').disabled`), true);
    console.log(`OK reward ${profile} ${scenario}`);
  }
  await browser.click('arena-title');
  await settled(browser, 'chapter-detail');
  await browser.click('chapter-back');
  await settled(browser, 'claimed');
  assert.deepEqual(await logged(browser), { 'claim-chapter-tasks': 1, 'dismiss-last-grant': 1 });
  assert.equal(await transform(browser, 'reward-trigger-icon'), '');
  await browser.page(preview, profile, { sequence: 'reveal', t: '2110' });
  assert.equal(await browser.read('window.preview.state'), 'summary');
  assert.deepEqual(await logged(browser), {});
  await browser.read(`window.preview.seek('reveal', 420)`);
  assert.equal(await browser.read('window.preview.state'), 'chest-flight');
  assert.deepEqual(await logged(browser), {});
}

async function checkChestIdle(browser, preview) {
  await browser.page(preview, 'tall');
  const target = () => browser.read(`document.querySelector('[data-node="reward-trigger"]').getBoundingClientRect().toJSON()`);
  const hitArea = await target();
  await waitForOffset(browser, 'reward-trigger-icon', 'm42', (value) => value < -3);
  assert.deepEqual(await target(), hitArea);
  await browser.click('arena-title');
  await settled(browser, 'chapter-detail');
  assert.equal(await transform(browser, 'reward-trigger-icon'), '');
  await browser.page(preview, 'tall', { sequence: 'ready-reward', t: '545' });
  const still = await transform(browser, 'reward-trigger-icon');
  assert.match(still, /-9px/);
  await delay(150);
  assert.equal(await transform(browser, 'reward-trigger-icon'), still);
  assert.deepEqual(await logged(browser), {});
  await browser.page(preview, 'tall', { reduced: '1' });
  await delay(380);
  assert.equal(await transform(browser, 'reward-trigger-icon'), '');
  console.log('OK chest cue, stable hit area, navigation and scrub');
}

async function checkRoute(browser, preview, { profile, enter, back, initial, destination, reduced }) {
  await browser.page(preview, profile, reduced ? { reduced: '1' } : {});
  await settled(browser, initial);
  if (reduced) {
    await browser.click(enter);
    assert.equal(await browser.read('window.preview.time'), undefined);
  } else {
    const locked = await browser.read(`(() => {
      const entry = document.querySelector('[data-node="${enter}"]');
      entry.click();
      entry.click();
      document.querySelector('[data-node="${back}"]').click();
      return [...document.querySelectorAll('.screen:not([hidden])')].every(layer => layer.inert)
        && document.querySelectorAll('.screen:not([hidden])').length === 2;
    })()`);
    assert.ok(locked, 'Both visible layers must suppress taps during a transition');
  }
  await settled(browser, destination);
  assert.equal(await focus(browser), back);
  await browser.escape();
  await settled(browser, initial);
  assert.equal(await focus(browser), enter);
  assert.deepEqual(await logged(browser), {});
}

async function checkVisibility(browser, preview) {
  await browser.page(preview, 'tall', { sequence: 'reveal', t: '80' });
  async function assertFading() {
    const hint = await browser.read(`(() => {
      const node = document.querySelector('[data-node="skip-hint"]');
      return { visible: !node.hidden, opacity: Number(node.style.opacity) };
    })()`);
    assert.ok(hint.visible && hint.opacity > 0 && hint.opacity < 1, 'The hint should interpolate visibility');
  }
  await assertFading();
  await browser.read("window.preview.seek('reveal', 1780)");
  await assertFading();
  await browser.read("window.preview.seek('reveal', 1850)");
  assert.ok(await browser.read(`document.querySelector('[data-node="skip-hint"]').hidden`));
  assert.deepEqual(await logged(browser), {});
}

async function checkReactorImpacts(browser, preview, captures, viewport) {
  await browser.page(preview, 'landscape', { sequence: 'upgrade', t: '0' });
  async function sample(time, ...ids) {
    return browser.read(`(() => {
      window.preview.seek('upgrade', ${time});
      return ${JSON.stringify(ids)}.map(id => {
        const element = document.querySelector('[data-node="' + id + '"]');
        const transform = getComputedStyle(element).transform;
        return {
          visible: !element.hidden,
          opacity: Number(element.style.opacity),
          text: element.querySelector('.copy')?.textContent,
          asset: element.querySelector('.art')?.dataset.asset,
          left: element.offsetLeft,
          x: transform === 'none' ? 0 : new DOMMatrix(transform).m41,
        };
      });
    })()`);
  }
  const expectations = {
    'cost-applied': ['text', '380', '140'],
    'level-landed': ['text', '02', '03'],
    'power-landed': ['text', '120', '165'],
    'fifth-filled': ['asset', 'progress-track', 'progress-fill'],
    'sixth-filled': ['asset', 'progress-track', 'progress-fill'],
  };
  for (const { event, target, effect, at, end } of preview.recipe.motion.upgrade.impacts) {
    const [peakTarget, peakEffect] = await sample(at, target, effect);
    const [after] = await sample(at + 20, effect);
    const [rest] = await sample(end, effect);
    assert.ok(peakEffect.visible && peakEffect.opacity > after.opacity && after.opacity > rest.opacity, `Missing impact and decay: ${event}`);
    assert.equal(rest.opacity, 0);
    if (at === 0) continue;
    const [beforeTarget, beforeEffect] = await sample(at - 1, target, effect);
    assert.equal(beforeEffect.opacity, 0, `Effect starts ahead of its change: ${event}`);
    const expected = expectations[event];
    if (expected) {
      const [property, prior, next] = expected;
      assert.deepEqual([beforeTarget[property], peakTarget[property]], [prior, next], event);
    }
  }

  for (const [id, forecast, start, landing, value] of [
    ['level-value', 'level-next', 140, 380, '03'],
    ['output-value', 'output-next', 210, 450, '165'],
  ]) {
    const [origin] = await sample(start, forecast);
    const [mid] = await sample((start + landing) / 2, forecast);
    const [approach] = await sample(landing - 1, forecast);
    const [departed, applied] = await sample(landing, forecast, id);
    assert.equal(origin.x, 0);
    assert.ok(mid.visible && mid.text === value && mid.x < 0 && approach.x < mid.x, `Missing transfer: ${forecast}`);
    assert.ok(Math.abs(approach.left + approach.x - applied.left) < 0.1, `Value misses destination: ${forecast}`);
    assert.ok(!departed.visible && applied.visible && applied.text === value, `Transfer handoff failed: ${forecast}`);
  }

  const [fifth, sixth, button] = await sample(600, 'meter-5', 'meter-6', 'upgrade-status');
  assert.deepEqual([fifth.asset, sixth.asset, button.text], ['progress-fill', 'progress-fill', 'UPGRADED']);
  assert.deepEqual(await logged(browser), {});
  for (const [name, time] of [['upgrade-transfer', 300], ['upgrade-landing', 450], ['upgrade-impact', 520]]) {
    await sample(time);
    await browser.capture(join(captures, `${name}-landscape.png`), viewport);
  }
  console.log('OK reactor value transfer and synchronized impacts');
}

async function checkStation(browser, preview) {
  const route = { profile: 'landscape', enter: 'reactor-entry', back: 'reactor-back', initial: 'station', destination: 'ready' };
  for (const reduced of [false, true]) {
    await checkRoute(browser, preview, { ...route, reduced });
    if (!reduced) await waitForOffset(browser, 'overview-reactor-icon', 'm42', (value) => value < -2);
    else assert.equal(await transform(browser, 'overview-reactor-icon'), '');
    await browser.click('reactor-entry');
    await settled(browser, 'ready');
    await assertBounds(browser);
    await assertCopy(browser, ['orbital-title', 'sector-heading', 'level-value', 'output-value', 'upgrade-label']);
    const count = await browser.read(`new Set([...document.querySelectorAll('.art')].filter(art => art.getClientRects().length).map(art => art.dataset.asset)).size`);
    assert.ok(count >= 8, 'Station capture needs independently composed assets');
    assert.equal(await transform(browser, 'overview-reactor-icon'), '');
    if (!reduced) await until(async () => await opacity(browser, 'upgrade-sheen') > 0.4, 'No shine on an available upgrade');
    else assert.equal(await opacity(browser, 'upgrade-sheen'), 0);
    await browser.click('upgrade');
    assert.equal(await opacity(browser, 'upgrade-sheen'), 0);
    if (reduced) {
      assert.equal(await browser.read('window.preview.time'), undefined);
      assert.ok(await browser.read(`document.querySelector('[data-node="output-flare"]').hidden`));
    }
    await browser.read(`document.querySelector('[data-node="upgrade"]').click()`);
    await settled(browser, 'upgraded');
    assert.deepEqual(await logged(browser), { 'upgrade-sector': 1 });
    await browser.click('reactor-back');
    await settled(browser, 'station-upgraded');
    assert.equal(await focus(browser), 'reactor-entry');
    const overview = await browser.read(`['balance-value', 'overview-reactor-level', 'overview-reactor-output']
      .map(id => document.querySelector('[data-node="' + id + '"] .copy').textContent.trim())`);
    assert.deepEqual(overview, ['140', 'Level 03', 'Power output   165']);
    await browser.click('reactor-entry');
    await settled(browser, 'upgraded');
    assert.deepEqual(await logged(browser), { 'upgrade-sector': 1 });
    assert.ok(await browser.read(`document.querySelector('[data-node="upgrade"]').disabled`));
    assert.equal(await transform(browser, 'upgrade-sheen'), '');
  }
  console.log('OK station navigation, focus, reduced motion and persistent upgrade');
}

async function checkLoading(browser, preview, captures, viewport) {
  const progress = () => browser.read(`(() => {
    const meter = document.querySelector('[data-node="loading-meter"]');
    const fill = document.querySelector('[data-node="loading-fill"]');
    return {
      value: meter.getAttribute('aria-valuenow'),
      caption: document.querySelector('[data-node="loading-value"] .copy').textContent,
      clip: fill.style.clipPath,
      status: document.querySelector('[data-node="loading-status"] .copy').textContent,
    };
  })()`);
  async function choose(id) {
    await browser.read(`(() => {
      const option = document.querySelector('select[aria-label="Demo"]');
      option.value = '${id}';
      option.dispatchEvent(new Event('change'));
    })()`);
  }
  await browser.page(preview, 'landscape', { clean: '0' });
  await choose('measured');
  assert.equal((await progress()).value, '20');
  await until(() => browser.read("window.preview.state === 'loading-hold'"), 'Measured demo never reached 55%');
  const before = await progress();
  assert.deepEqual([before.value, before.caption, before.clip], ['55', '55%', 'inset(0px 45% 0px 0px)']);
  const shine = await transform(browser, 'loading-sheen');
  await until(async () => {
    const current = await transform(browser, 'loading-sheen');
    return current !== shine && await opacity(browser, 'loading-sheen') > 0.5;
  }, 'Shine stopped while progress was held at 55%', 1800);
  assert.deepEqual(await progress(), before);
  await settled(browser, 'loading-done');
  assert.equal((await progress()).value, '100');
  assert.equal(await opacity(browser, 'loading-sheen'), 0);
  assert.deepEqual(await logged(browser), {});

  await choose('unknown');
  await waitForOffset(browser, 'loading-unknown-band', 'm41', (value) => value > 12);
  const unknown = await progress();
  assert.equal(unknown.value, null);
  assert.equal(unknown.caption, '');
  await choose('paused');
  assert.equal((await progress()).status, 'Loading paused');
  assert.equal((await progress()).value, '55');
  assert.equal(await opacity(browser, 'loading-sheen'), 0);
  assert.equal(await transform(browser, 'loading-unknown-band'), '');
  await choose('');
  await settled(browser, 'station');

  await browser.page(preview, 'landscape', { reduced: '1', demo: 'measured' });
  await until(() => browser.read("window.preview.state === 'loading-hold'"), 'Reduced motion stopped progress updates');
  assert.equal((await progress()).value, '55');
  assert.equal(await transform(browser, 'loading-sheen'), '');
  await settled(browser, 'loading-done');

  for (const [name, options] of [
    ['loading-hold', { sequence: 'loading-shine', t: '450' }],
    ['loading-unknown', { sequence: 'loading-indeterminate', t: '630' }],
    ['loading-paused', { state: 'loading-paused' }],
  ]) {
    await browser.page(preview, 'landscape', options);
    await assertBounds(browser);
    await assertCopy(browser, ['loading-status']);
    assert.deepEqual(await logged(browser), {});
    await browser.capture(join(captures, `${name}-landscape.png`), viewport);
  }
  console.log('OK measured, held, unknown, paused, done and reduced progress states');
}

async function freezeAndResume(browser, expectedState) {
  await browser.read(`(() => {
    window.lifecycleEvents = [];
    for (const type of ['freeze', 'resume']) {
      document.addEventListener(type, () => window.lifecycleEvents.push(type), { once: true });
    }
  })()`);
  await browser.lifecycle('frozen');
  await browser.lifecycle('active');
  await settled(browser, expectedState);
  assert.deepEqual(await browser.read('window.lifecycleEvents'), ['freeze', 'resume']);
}

async function checkDrillSuspension(preview) {
  for (const { demo, state, visible, hidden, claim, counts } of [
    { state: 'guided', visible: 'guided-note', counts: {} },
    { demo: 'practice', state: 'practice', visible: 'shield-practice', hidden: 'guided-note', counts: {} },
    {
      demo: 'lost-after-commit', state: 'lost-committed', claim: 'claim-commit',
      visible: 'retry-after-commit', counts: { 'request-reward': 1, 'grant-reward': 1 },
    },
  ]) {
    // A forced freeze leaves headless Chromium's input and navigation unreliable.
    const browser = await browserSession();
    try {
      await browser.page(preview, 'compact', { touch: true, ...(demo ? { demo } : {}) });
      if (claim) await browser.tap(claim);
      await settled(browser, state);
      await freezeAndResume(browser, state);
      assert.deepEqual(await logged(browser), counts);
      assert.equal(await browser.read(`document.querySelector('[data-node="${visible}"]').hidden`), false);
      if (hidden) assert.equal(await browser.read(`document.querySelector('[data-node="${hidden}"]').hidden`), true);
    } finally {
      await browser.close();
    }
  }
  console.log('OK tutorial and pending reward survive browser freeze and resume');
}

async function checkShieldDrill(browser, preview, captures) {
  const touch = { touch: true };
  const copy = (id) => browser.read(`document.querySelector('[data-node="${id}"] .copy').textContent`);
  const visible = (id) => browser.read(`!document.querySelector('[data-node="${id}"]').closest('[hidden]')`);

  for (const [profile, { viewport }] of Object.entries(preview.recipe.design.profiles)) {
    for (const [state, button, options] of [
      ['guided', 'shield-guided', {}],
      ['practice', 'shield-practice', { fixture: 'long-label' }],
      ['complete', 'replay', {}],
    ]) {
      await browser.page(preview, profile, { ...touch, state, ...options });
      await assertBounds(browser, 48);
      await assertCopy(browser, ['relay-title', 'integrity', button]);
      await browser.capture(join(captures, `${state}-${profile}.png`), viewport);
    }
  }

  await browser.page(preview, 'compact', { ...touch, demo: 'practice', fixture: 'long-label' });
  assert.ok(await browser.read("'ontouchstart' in window && navigator.maxTouchPoints > 0"));
  assert.equal(await copy('shield-practice'), 'Schutzschild aktivieren');
  assert.equal(await visible('guided-note'), false);
  await browser.tapAt(160, 270);
  await settled(browser, 'practice');
  assert.deepEqual(await logged(browser), {});
  await browser.tap('shield-practice');
  await settled(browser, 'complete');
  assert.deepEqual([await copy('final-status'), await copy('integrity')], ['Shot deflected', '100%']);
  assert.deepEqual(await logged(browser), { 'deflect-shot': 1 });
  assert.equal(await focus(browser), 'final-status');

  await browser.tap('replay');
  await settled(browser, 'guided');
  assert.equal(await visible('guided-note'), true);
  await browser.tap('skip');
  await settled(browser, 'free');
  assert.equal(await visible('shield-practice'), true);
  assert.equal(await visible('guided-note'), false);
  await browser.tap('replay');
  await settled(browser, 'guided');
  await browser.tap('shield-guided');
  await settled(browser, 'practice');
  assert.equal(await visible('guided-note'), false);
  await browser.tap('shield-practice');
  await settled(browser, 'complete');
  assert.deepEqual(await logged(browser), { 'deflect-shot': 3 });

  await browser.page(preview, 'compact', { ...touch, reduced: '1' });
  await browser.tap('shield-guided');
  await settled(browser, 'practice');
  assert.equal(await transform(browser, 'shot-core'), '');
  await browser.tap('shield-practice');
  await settled(browser, 'complete');
  assert.equal(await copy('final-status'), 'Shot deflected');
  console.log('OK shield touch, off-target tap, guided and independent shots, skip and replay, reduced motion');

  for (const branch of [
    { committed: true, demo: 'lost-after-commit', claim: 'claim-commit', lost: 'lost-committed', retry: 'retry-after-commit' },
    { committed: false, demo: 'lost-before-commit', claim: 'claim-uncommitted', lost: 'lost-uncommitted', retry: 'retry-before-commit' },
  ]) {
    await browser.page(preview, 'compact', { ...touch, demo: branch.demo, reduced: branch.committed ? '1' : '0' });
    const { initialBalance, reward, confirmedBalance } = preview.recipe.data;
    assert.equal(await copy('reward-before'), `Balance: ${initialBalance} Alloy`);
    const claimPoint = await browser.tap(branch.claim);
    await browser.tapAt(...claimPoint);
    await settled(browser, branch.lost);
    assert.equal(await browser.read('window.preview.claimed'), branch.committed);
    assert.match(await copy('reward-offline'), /Connection lost/);
    assert.equal(await visible('reward-confirmed'), false);
    const retryPoint = await browser.tap(branch.retry);
    await browser.tapAt(...retryPoint);
    await settled(browser, 'received');
    assert.equal(await focus(browser), 'reward-confirmed');
    await browser.tapAt(...retryPoint);
    assert.equal(confirmedBalance, initialBalance + reward);
    assert.equal(await copy('reward-confirmed'), `Reward received.\nBalance: ${confirmedBalance} Alloy`);
    assert.equal(await browser.read('window.preview.claimed'), true);
    assert.deepEqual(await logged(browser), {
      'request-reward': 1, 'check-status': 1, 'grant-reward': 1,
      ...(branch.committed ? {} : { 'retry-reward': 1 }),
    });
    console.log(`OK ${branch.demo}, one grant after repeat taps`);
  }
  await browser.page(preview, 'compact', { ...touch, sequence: 'recover-uncommitted', t: '650' });
  assert.deepEqual(await logged(browser), {});
  assert.equal(await browser.read('window.preview.claimed'), false);
  await browser.page(preview, 'compact', { ...touch, state: 'received' });
  await assertBounds(browser, 48);
  await assertCopy(browser, ['reward-confirmed']);
  await browser.capture(join(captures, 'reward-compact.png'), [320, 568]);

  await checkDrillSuspension(preview);
}

const selectedExamples = process.argv[2] ? [process.argv[2]] : examples;
await mkdir(artifacts, { recursive: true });
const browser = await browserSession();
try {
  for (const name of selectedExamples) {
    const preview = await makePreview(name);
    const captures = resolve(repo, 'examples', name, 'captures');
    if (name === 'shield-drill') {
      await checkShieldDrill(browser, preview, captures);
      console.log(`OK ${name} PNGs in ${captures}`);
      continue;
    }
    for (const [profile, { viewport }] of Object.entries(preview.recipe.design.profiles)) {
      const states = name === 'catsurvivor' ? ['journey', 'summary', 'chapter-detail'] : ['station', 'ready', 'upgraded', 'station-upgraded'];
      for (const state of states) {
        await browser.page(preview, profile, { state });
        await assertBounds(browser);
        await browser.capture(join(captures, `${state}-${profile}.png`), viewport);
      }
      if (name === 'catsurvivor') {
        const route = { profile, enter: 'arena-title', back: 'chapter-back', initial: 'journey', destination: 'chapter-detail' };
        for (const reduced of [false, true]) await checkRoute(browser, preview, { ...route, reduced });
        await checkRewards(browser, preview, profile);
        await browser.page(preview, profile, { state: 'journey', fixture: 'stress' });
        await assertCopy(browser, ['chapter', 'value-coin']);
        await browser.page(preview, profile, { state: 'summary', fixture: 'stress' });
        await assertCopy(browser, ['reward-description', 'card-value-coin']);
        console.log(`OK ${profile} safe area and stress text`);
      }
    }
    if (name === 'catsurvivor') {
      const { viewport } = preview.recipe.design.profiles.tall;
      await browser.page(preview, 'tall', { sequence: 'reveal', t: '1880' });
      await browser.capture(join(captures, 'opening-tall.png'), viewport);
      await checkVisibility(browser, preview);
      await checkChestIdle(browser, preview);
      await browser.page(preview, 'tall', { sequence: 'show-enemies', t: '80' });
      assert.equal(await browser.read('window.preview.screen'), 'chapter');
      assert.deepEqual(await logged(browser), {});
      await browser.capture(join(captures, 'transition-enemies-tall.png'), viewport);
    } else {
      const { viewport } = preview.recipe.design.profiles.landscape;
      await checkStation(browser, preview);
      await checkReactorImpacts(browser, preview, captures, viewport);
      await checkLoading(browser, preview, captures, viewport);
      await browser.page(preview, 'landscape', { sequence: 'open-reactor', t: '80' });
      assert.equal(await browser.read('window.preview.screen'), 'reactor');
      assert.deepEqual(await logged(browser), {});
      await browser.capture(join(captures, 'transition-reactor-landscape.png'), viewport);
    }
    console.log(`OK ${name} PNGs in ${captures}`);
  }
} finally {
  await browser.close();
}
