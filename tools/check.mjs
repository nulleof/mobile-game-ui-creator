import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { makePreview } from './preview.mjs';

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
    async function page(preview, profile, settings = {}) {
      const [width, height] = preview.recipe.design.profiles[profile].viewport;
      await run('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await run('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: settings.reduced ? 'reduce' : 'no-preference' }],
      });
      await run('Page.navigate', { url: `${preview.url}?${new URLSearchParams({ profile, clean: '1', ...settings })}` });
      await until(async () => {
        const state = await read(`document.querySelector('#failure')?.textContent ||
          (document.documentElement.dataset.ready === '1' && document.querySelector('#stage').dataset.profile === '${profile}' ? 'ready' : '')`).catch(() => '');
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
    async function click(id) {
      const hit = await read(`(() => {
        const target = document.querySelector('[data-node="${id}"]');
        const box = target.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        return [x, y, target.contains(document.elementFromPoint(x, y))];
      })()`);
      assert.ok(hit[2], `Click hit another layer: ${id}`);
      await run('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit[0], y: hit[1], button: 'left', clickCount: 1 });
      await run('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit[0], y: hit[1], button: 'left', clickCount: 1 });
    }
    return { page, read, capture, click, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function assertBounds(browser) {
  const errors = await browser.read(`Array.from(document.querySelectorAll('[data-qa]')).flatMap(element => {
    if (!element.getClientRects().length) return [];
    const stage = document.querySelector('#stage');
    const outer = stage.getBoundingClientRect();
    const scale = outer.width / parseFloat(stage.style.width);
    const [top, right, bottom, left] = stage.dataset.safe.split(',').map(Number);
    const rect = element.getBoundingClientRect();
    const ok = rect.left >= outer.left + left * scale - 1 && rect.right <= outer.right - right * scale + 1 &&
      rect.top >= outer.top + top * scale - 1 && rect.bottom <= outer.bottom - bottom * scale + 1;
    const touch = element.dataset.qa !== 'touch' || Math.min(rect.width, rect.height) / scale >= 44;
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

async function checkRewards(browser, preview) {
  const logged = () => browser.read('window.preview.counts');
  const settled = async (state) => until(
    () => browser.read(`window.preview.state === '${state}' && window.preview.time === undefined`),
    `Did not settle to ${state}`,
  );
  let summary;
  for (const scenario of ['normal', 'skip', 'rapid', 'reduced']) {
    await browser.page(preview, 'compact', scenario === 'reduced' ? { reduced: '1' } : {});
    await browser.click('reward-trigger');
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
    await settled('summary');
    assert.deepEqual(await logged(), { 'claim-chapter-tasks': 1 });
    assert.equal(await browser.read('document.activeElement.dataset.node'), 'reward-dismiss');
    const result = await browser.read(`[...document.querySelectorAll('[data-node^="card-value-"] .copy')].map(node => node.textContent)`);
    summary ??= result;
    assert.deepEqual(result, summary);
    await browser.click('reward-dismiss');
    await settled('claimed');
    assert.deepEqual(await logged(), { 'claim-chapter-tasks': 1, 'dismiss-last-grant': 1 });
    assert.equal(await browser.read('document.activeElement.dataset.node'), 'reward-later');
    assert.equal(await browser.read(`document.querySelector('[data-node="reward-trigger"]').disabled`), true);
    console.log(`OK reward ${scenario}`);
  }
  await browser.page(preview, 'compact', { sequence: 'reveal', t: '2110' });
  assert.equal(await browser.read('window.preview.state'), 'summary');
  assert.deepEqual(await logged(), {});
  await browser.read(`window.preview.seek('reveal', 420)`);
  assert.equal(await browser.read('window.preview.state'), 'chest-flight');
  assert.deepEqual(await logged(), {});
  console.log('OK deterministic timeline without game events');
}

async function checkStation(browser, preview) {
  await browser.page(preview, 'landscape');
  await assertBounds(browser);
  await assertCopy(browser, ['orbital-title', 'sector-heading', 'level-value', 'output-value', 'upgrade-label']);
  const arts = await browser.read(`[...new Set([...document.querySelectorAll('.art')].map(art => art.dataset.asset))]`);
  assert.ok(arts.length >= 9, 'Station capture needs independently composed assets');
  await browser.click('upgrade');
  await until(() => browser.read("window.preview.state === 'upgraded' && window.preview.time === undefined"), 'Upgrade did not settle');
  assert.deepEqual(await browser.read('window.preview.counts'), { 'upgrade-sector': 1 });
  console.log('OK station layout and upgrade');
}

const examples = process.argv[2] ? [process.argv[2]] : ['catsurvivor', 'orbital-works'];
await mkdir(artifacts, { recursive: true });
const browser = await browserSession();
try {
  for (const name of examples) {
    const preview = await makePreview(name);
    const captures = resolve(repo, 'examples', name, 'captures');
    for (const [profile, { viewport }] of Object.entries(preview.recipe.design.profiles)) {
      const states = name === 'catsurvivor' ? ['journey', 'summary'] : [preview.recipe.initialState];
      for (const state of states) {
        await browser.page(preview, profile, { state });
        await assertBounds(browser);
        await browser.capture(join(captures, `${state}-${profile}.png`), viewport);
      }
      if (name === 'catsurvivor') {
        await browser.page(preview, profile, { state: 'journey', fixture: 'stress' });
        await assertCopy(browser, ['chapter', 'value-coin']);
        await browser.page(preview, profile, { state: 'summary', fixture: 'stress' });
        await assertCopy(browser, ['reward-description', 'card-value-coin']);
        console.log(`OK ${profile} safe area and stress text`);
      }
    }
    if (name === 'catsurvivor') {
      await browser.page(preview, 'tall', { sequence: 'reveal', t: '1880' });
      await browser.capture(join(captures, 'opening-tall.png'), preview.recipe.design.profiles.tall.viewport);
      await checkRewards(browser, preview);
    } else {
      await checkStation(browser, preview);
    }
    console.log(`OK ${name} PNGs in ${captures}`);
  }
} finally {
  await browser.close();
}
