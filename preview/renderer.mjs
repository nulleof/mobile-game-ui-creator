const stage = document.querySelector('#stage');
const viewport = document.querySelector('#viewport');
const tools = document.querySelector('#tools');
const params = new URLSearchParams(location.search);
const clean = params.get('clean') === '1';
document.body.classList.toggle('clean', clean);
const px = (value) => `${value}px`;
const { pack, recipe, urls } = JSON.parse(document.querySelector('#data').textContent);
const assetUrl = (id) => `url("${urls[id]}")`;
const decoded = new Map();
const easing = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) ** 2,
  outCubic: (t) => 1 - (1 - t) ** 3,
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  smooth: (t) => t * t * (3 - 2 * t),
  step: (t) => Number(t === 1),
};

function sample(keys, time) {
  const next = keys.findIndex(([at]) => at > time);
  if (next < 0) return keys.at(-1)[1];
  if (!next) return keys[0][1];
  const [start, from] = keys[next - 1];
  const [end, to, ease = 'linear'] = keys[next];
  return from + (to - from) * easing[ease]((time - start) / (end - start));
}

function grid(width, height, [top, right, bottom, left]) {
  return [[0, left, width - right, width], [0, top, height - bottom, height]];
}

function drawSlice(canvas, id, size, slices, border, box, scale) {
  const density = scale * devicePixelRatio;
  const width = Math.max(1, Math.round(box[2] * density));
  const height = Math.max(1, Math.round(box[3] * density));
  const edges = border.map((edge) => Math.round(edge * density));
  const key = [id, width, height, ...edges].join(':');
  if (canvas.dataset.paint === key) return;
  canvas.dataset.paint = key;
  canvas.width = width;
  canvas.height = height;
  const [xs, ys] = grid(...size, slices);
  const [dx, dy] = grid(width, height, edges);
  const context = canvas.getContext('2d');
  const image = decoded.get(id);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const sw = xs[x + 1] - xs[x];
      const sh = ys[y + 1] - ys[y];
      const dw = dx[x + 1] - dx[x];
      const dh = dy[y + 1] - dy[y];
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) context.drawImage(image, xs[x], ys[y], sw, sh, dx[x], dy[y], dw, dh);
    }
  }
}

function setArt(target, id, assets, box, scale) {
  const { fit, size, slice, border } = assets[id];
  target.dataset.asset = id;
  target.querySelector('canvas').hidden = fit !== 'slice';
  if (fit === 'slice') {
    target.style.background = '';
    drawSlice(target.firstElementChild, id, size, slice, border, box, scale);
    return;
  }
  const fitValue = fit === 'stretch' ? '100% 100%' : fit;
  target.style.background = `${assetUrl(id)} center / ${fitValue} no-repeat`;
}

function fitCopy(copy, font) {
  const range = document.createRange();
  range.selectNodeContents(copy);
  const space = copy.getBoundingClientRect();
  for (let size = font.size; size >= font.minSize; size--) {
    copy.style.fontSize = px(size);
    const text = range.getBoundingClientRect();
    if (text.width <= space.width && text.height <= space.height) break;
  }
}

function placeCopy(element, font = {}) {
  const copy = document.createElement('span');
  copy.className = font.single ? 'copy single' : 'copy';
  copy.style.fontSize = px(font.size ?? 24);
  if (font.align === 'left' || font.align === 'right') {
    copy.style.justifyContent = font.align === 'left' ? 'flex-start' : 'flex-end';
    copy.style.textAlign = font.align;
  }
  if (font.color) copy.style.color = font.color;
  if (font.weight) copy.style.fontWeight = font.weight;
  if (font.tracking) copy.style.letterSpacing = px(font.tracking);
  if (font.stroke) copy.style.webkitTextStroke = font.stroke;
  if (font.shadow) copy.style.textShadow = font.shadow;
  element.append(copy);
  return copy;
}

async function mount(pack, recipe) {
  const profiles = recipe.design.profiles;
  const profileNames = Object.keys(profiles);
  let profile = Object.hasOwn(profiles, params.get('profile')) ? params.get('profile') : profileNames[0];
  let fixture = Object.hasOwn(recipe.fixtures ?? {}, params.get('fixture')) ? params.get('fixture') : 'default';
  const defaultReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let reduced = params.get('reduced') === '1' || defaultReduced;
  let state = recipe.initialState;
  let counts = {};
  let claimed = false;
  let animation = null;
  let manual = false;
  let request = 0;
  let previousTime = 0;
  let scale = 1;
  const nodes = new Map();
  const font = Object.entries(pack.assets).find(([, data]) => data.fit === 'font');
  if (font) {
    const face = new FontFace('GameUI', assetUrl(font[0]));
    document.fonts.add(face);
    await face.load();
    stage.style.setProperty('--game-font', 'GameUI');
  }
  for (const [key, value] of Object.entries(recipe.theme ?? {})) stage.style.setProperty(`--${key}`, value);
  stage.setAttribute('aria-label', recipe.title);
  document.title = recipe.title;

  function create(source, parent, inheritedSpace = 'safe') {
    const enabled = source.action && recipe.actions[source.action].type === 'input';
    const element = document.createElement(enabled ? 'button' : 'div');
    element.className = 'element';
    element.dataset.node = source.id;
    if (source.action) element.dataset.action = source.action;
    if (source.qa) element.dataset.qa = source.qa;
    if (source.origin) element.style.transformOrigin = source.origin;
    if (source.fill) element.style.background = source.fill;
    if (source.clip) element.style.overflow = 'hidden';
    if (source.radius) element.style.borderRadius = px(source.radius);
    if (source.passThrough) element.style.pointerEvents = 'none';
    if (source.focusable) element.tabIndex = -1;
    if (source.opacity !== undefined) element.style.opacity = source.opacity;
    if (source.modal) {
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-modal', 'true');
      element.setAttribute('aria-label', source.label);
    }
    if (enabled) {
      element.type = 'button';
      element.disabled = source.disabled === true;
      if (source.label) element.setAttribute('aria-label', source.label);
      if (source.press) element.style.setProperty('--press-scale', source.press);
      element.addEventListener('click', () => activate(source.action, source.id));
    }
    let art;
    let pressedArt;
    if (source.asset || source.assetByState) {
      art = document.createElement('span');
      art.className = 'art';
      art.setAttribute('aria-hidden', 'true');
      art.append(document.createElement('canvas'));
      element.append(art);
      if (source.pressedAsset) {
        art.classList.add('resting-art');
        pressedArt = art.cloneNode(true);
        pressedArt.className = 'art pressed-art';
        element.append(pressedArt);
      }
    }
    let copy;
    if (source.text !== undefined) copy = placeCopy(element, source.font);
    parent.append(element);
    const node = { source, element, art, pressedArt, copy, space: source.space ?? inheritedSpace, root: parent === stage };
    nodes.set(source.id, node);
    for (const child of source.children ?? []) create(child, element, node.space);
  }
  for (const node of recipe.nodes) create(node, stage);

  function resize() {
    const { viewport: [width, height], safeInsets: [top, right, bottom, left] } = profiles[profile];
    const deviceScale = width / recipe.design.width;
    const designHeight = height / deviceScale;
    const padding = clean ? 0 : 24;
    scale = Math.max(0.1, Math.min(
      (innerWidth - padding) / recipe.design.width,
      (innerHeight - (clean ? 0 : tools.offsetHeight + 36)) / designHeight,
    ));
    stage.style.width = px(recipe.design.width);
    stage.style.height = px(designHeight);
    stage.style.transform = `scale(${scale})`;
    viewport.style.width = px(recipe.design.width * scale);
    viewport.style.height = px(designHeight * scale);
    const safe = [top, right, bottom, left].map((edge) => edge / deviceScale);
    stage.dataset.safe = safe.join(',');
    stage.dataset.profile = profile;
    for (const node of nodes.values()) {
      const box = [...(node.source.boxes?.[profile] ?? node.source.box)];
      if (node.root && node.space === 'safe') {
        box[0] += safe[3];
        box[1] += safe[0];
      }
      const [x, y, w, h] = box.map(px);
      Object.assign(node.element.style, { left: x, top: y, width: w, height: h });
      node.box = box;
      node.lastTextFit = undefined;
    }
    draw();
  }

  function getText(text) {
    if (typeof text !== 'object') return text;
    const value = recipe.fixtures?.[fixture]?.[text.key] ?? recipe.data[text.key];
    return `${text.prefix ?? ''}${value}${text.suffix ?? ''}`;
  }

  function draw() {
    const sequence = animation?.sequence;
    const time = animation?.time ?? 0;
    const latest = sequence?.phases?.findLast(({ at }) => at <= time);
    const visual = latest?.state ?? state;
    const tracks = new Map();
    for (const track of sequence?.tracks ?? []) {
      const values = tracks.get(track.node) ?? {};
      values[track.property] = sample(track.keysByProfile?.[profile] ?? track.keys, time);
      tracks.set(track.node, values);
    }
    for (const [id, node] of nodes) {
      const { source, element, art, pressedArt, copy, box } = node;
      element.hidden = (source.timelineOnly && !sequence) || (source.visibleIn !== undefined && !source.visibleIn.includes(visual));
      const hasClaim = claimed || recipe.states[visual].claimed;
      if (element instanceof HTMLButtonElement) {
        element.disabled = source.disabled === true || source.disabledIn?.includes(visual) === true ||
          (source.disableWhenClaimed === true && hasClaim) || manual;
      }
      if (art) {
        const selected = (hasClaim && source.claimedAsset) || source.assetByState?.[visual] || source.asset;
        const paintKey = [selected, scale, ...box].join(':');
        if (selected && node.lastPaint !== paintKey) {
          setArt(art, selected, pack.assets, box, scale);
          if (pressedArt) setArt(pressedArt, source.pressedAsset, pack.assets, box, scale);
          node.lastPaint = paintKey;
        }
      }
      if (copy) {
        const value = getText((hasClaim && source.claimedText) || source.textByState?.[visual] || source.text);
        if (copy.textContent !== String(value)) copy.textContent = value;
        if (source.font?.minSize && !element.hidden && node.lastTextFit !== value && copy.getClientRects().length) {
          fitCopy(copy, source.font);
          node.lastTextFit = value;
        }
      }
      const transform = tracks.get(id);
      const baseOpacity = source.opacity ?? 1;
      element.style.opacity = transform?.opacity ?? baseOpacity;
      element.style.transform = transform
        ? `translate(${px(transform.x ?? 0)}, ${px(transform.y ?? 0)}) rotate(${transform.rotate ?? 0}deg) scale(${transform.scaleX ?? 1}, ${transform.scaleY ?? 1})`
        : '';
    }
    stage.dataset.state = visual;
    if (animation) stage.dataset.time = String(Math.round(time));
    else delete stage.dataset.time;
  }

  function emit(action) {
    counts[action] = (counts[action] ?? 0) + 1;
    if (recipe.actions[action].setsClaimed) claimed = true;
  }

  function finish() {
    const end = animation.sequence;
    animation = null;
    previousTime = 0;
    state = end.phases?.at(-1)?.state ?? state;
    draw();
    sync();
    const target = nodes.get(end.focus)?.element;
    if (target) target.focus({ preventScroll: true });
  }

  function advance(time) {
    const active = animation;
    active.time = Math.min(active.sequence.duration, time);
    if (!manual) {
      for (const [index, event] of (active.sequence.events ?? []).entries()) {
        if (event.at <= active.time && !active.fired.has(index)) {
          active.fired.add(index);
          emit(event.action);
        }
      }
      if (active.time >= active.sequence.duration) {
        finish();
        return;
      }
    }
    draw();
    sync();
  }

  function frame(now) {
    if (!animation || manual) return;
    const elapsed = previousTime ? now - previousTime : 0;
    previousTime = now;
    advance(animation.time + elapsed);
    if (animation) request = requestAnimationFrame(frame);
  }

  function activate(action, id) {
    if (manual) return;
    const spec = recipe.actions[action];
    if (spec.type !== 'input') return;
    if (spec.skip) {
      const skip = animation?.sequence.skip;
      if (skip && animation.time < skip.at && animation.time >= (skip.after ?? 0)) advance(skip.at);
      return;
    }
    if (animation || (spec.from && !spec.from.includes(state))) return;
    if (nodes.get(id)?.source.disableWhenClaimed && claimed) return;
    const sequence = Object.values(recipe.motion).find((item) => item.trigger === action);
    if (sequence) {
      animation = { sequence, time: 0, fired: new Set() };
      if (reduced && sequence.reduced === 'finish') advance(sequence.duration);
      else {
        advance(0);
        nodes.get(sequence.skip?.focus)?.element.focus({ preventScroll: true });
        request = requestAnimationFrame(frame);
      }
    } else {
      emit(action);
      state = spec.next ?? state;
      draw();
    }
  }

  function reset() {
    cancelAnimationFrame(request);
    request = 0;
    previousTime = 0;
    manual = false;
    animation = null;
    state = recipe.initialState;
    counts = {};
    claimed = false;
    draw();
    sync();
  }

  function show(stateId) {
    reset();
    if (!Object.hasOwn(recipe.states, stateId)) return;
    state = stateId;
    manual = true;
    draw();
    sync();
  }

  function seek(sequenceId, time) {
    const sequence = recipe.motion[sequenceId];
    if (!sequence) return;
    reset();
    manual = true;
    state = sequence.phases?.[0]?.state ?? recipe.initialState;
    animation = { sequence, time: 0 };
    advance(Math.max(0, Number(time) || 0));
  }

  function select(name, items, value, change) {
    const label = document.createElement('label');
    label.append(name);
    const field = document.createElement('select');
    for (const [id, labelText] of items) field.add(new Option(labelText, id));
    field.value = value;
    field.addEventListener('change', () => change(field.value));
    label.append(field);
    tools.append(label);
    return field;
  }
  const stateControl = select('View', [['live', 'Interactive'], ...Object.entries(recipe.states).map(([id, entry]) => [id, entry.label])], 'live', (value) => {
    if (value === 'live') reset();
    else show(value);
  });
  select('Profile', profileNames.map((name) => [name, profiles[name].viewport.join(' × ')]), profile, (value) => {
    profile = value;
    resize();
  });
  if (recipe.fixtures) select('Data', [['default', 'Normal'], ...Object.keys(recipe.fixtures).map((key) => [key, key])], fixture, (value) => {
    fixture = value;
    draw();
  });
  let timeline;
  let position;
  if (Object.keys(recipe.motion).length) {
    timeline = select('Timeline', [['', 'Choose timeline'], ...Object.entries(recipe.motion).map(([id, entry]) => [id, entry.label])], '', (value) => {
      if (value) seek(value, 0);
      else reset();
    });
    const label = document.createElement('label');
    label.append('Frame (ms)');
    position = document.createElement('input');
    position.type = 'range';
    position.min = 0;
    position.step = 1;
    position.disabled = true;
    position.addEventListener('input', () => seek(timeline.value, position.value));
    label.append(position);
    tools.append(label);
    const reducedLabel = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = reduced;
    box.addEventListener('change', () => { reduced = box.checked; reset(); });
    reducedLabel.append(box, 'Reduce motion');
    tools.append(reducedLabel);
  }
  const restart = document.createElement('button');
  restart.textContent = 'Reset';
  restart.addEventListener('click', reset);
  tools.append(restart);

  function sync() {
    stateControl.value = manual ? state : 'live';
    if (timeline && position) {
      timeline.value = manual && animation ? Object.keys(recipe.motion).find((id) => recipe.motion[id] === animation.sequence) : '';
      position.disabled = !timeline.value;
      position.max = timeline.value ? animation.sequence.duration : 0;
      position.value = timeline.value ? animation.time : 0;
      position.title = timeline.value ? `${Math.round(animation.time)} ms` : '';
    }
  }

  stage.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || manual) return;
    const action = animation ? animation.sequence.skip?.action : recipe.states[state].escape;
    if (recipe.actions[action]) activate(action);
  });
  addEventListener('resize', resize);
  resize();
  if (params.has('sequence')) seek(params.get('sequence'), params.get('t'));
  else if (params.has('state')) show(params.get('state'));
  window.preview = {
    get state() { return stage.dataset.state; },
    get time() { return animation?.time; },
    get counts() { return { ...counts }; },
    get claimed() { return claimed; },
    reset,
    seek,
  };
}

function showError(error) {
  const feedback = document.querySelector('#failure');
  feedback.hidden = false;
  feedback.textContent = error.message;
  console.error(error);
}

try {
  await Promise.all(Object.entries(pack.assets)
    .filter(([, entry]) => entry.fit !== 'font')
    .map(async ([id]) => {
      const image = new Image();
      image.src = urls[id];
      await image.decode();
      decoded.set(id, image);
    }));
  await mount(pack, recipe);
  await document.fonts.ready;
  document.documentElement.dataset.ready = '1';
} catch (error) {
  showError(error);
}
