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

function visibleIn(source, state, playing) {
  return (!source.timelineOnly || playing) && (!source.visibleIn || source.visibleIn.includes(state));
}

function sampleTracks(tracks, profile, time) {
  const result = new Map();
  for (const track of tracks) {
    const values = result.get(track.node) ?? {};
    values[track.property] = sample(track.keysByProfile?.[profile] ?? track.keys, time);
    result.set(track.node, values);
  }
  return result;
}

function transformStyle(values) {
  return `translate(${px(values.x ?? 0)}, ${px(values.y ?? 0)}) rotate(${values.rotate ?? 0}deg) scale(${values.scaleX ?? 1}, ${values.scaleY ?? 1})`;
}

function visibilityChanges(nodes, sequence, start, defaults) {
  const changes = new Map();
  let duration = sequence.duration;
  if (!defaults) return { changes, duration };
  const authored = new Set((sequence.tracks ?? []).map((track) => track.node));
  let from = start;
  for (const { at, state } of sequence.phases ?? []) {
    const changed = new Set();
    for (const [id, { source, ancestors }] of nodes) {
      const wasVisible = visibleIn(source, from, at !== 0);
      const nowVisible = visibleIn(source, state, true);
      if (wasVisible === nowVisible) continue;
      changed.add(id);
      if (source.visibilityMotion === 'instant' || authored.has(id) || ancestors.some((parent) => changed.has(parent))) continue;
      const timing = nowVisible ? defaults.enter : defaults.exit;
      const events = changes.get(id) ?? [];
      events.push({ at, from, entering: nowVisible, ...timing });
      changes.set(id, events);
      duration = Math.max(duration, at + timing.ms);
    }
    from = state;
  }
  return { changes, duration };
}

async function mount(pack, recipe) {
  const profiles = recipe.design.profiles;
  const profileNames = Object.keys(profiles);
  let profile = Object.hasOwn(profiles, params.get('profile')) ? params.get('profile') : profileNames[0];
  let fixture = Object.hasOwn(recipe.fixtures ?? {}, params.get('fixture')) ? params.get('fixture') : 'default';
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = params.get('reduced') === '1' || motionPreference.matches;
  let state = recipe.initialState;
  let counts = {};
  let claimed = false;
  let animation = null;
  let manual = false;
  let request = 0;
  let previousTime = 0;
  let scale = 1;
  let manualLoop = null;
  let demo = null;
  let loopRequest = 0;
  const activeLoops = new Map();
  const nodes = new Map();
  const screens = new Map();
  const remembered = new Map();
  const history = [];
  const screenOf = (id) => recipe.states[id]?.screen;
  const visuals = new Map(Object.entries(recipe.motion));
  const loops = Object.entries(recipe.loops ?? {});
  const demos = Object.entries(recipe.previewDemos ?? {});
  for (const [id, loop] of loops) visuals.set(id, { label: loop.label, loop });
  for (const [id, spec] of Object.entries(recipe.actions)) {
    if (spec.navigate) visuals.set(id, { label: spec.navigate.label, routeAction: id });
  }
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

  function create(source, parent, screen, inheritedSpace = 'safe', ancestors = []) {
    const enabled = source.action && recipe.actions[source.action].type === 'input';
    const element = document.createElement(enabled ? 'button' : 'div');
    element.className = 'element';
    element.dataset.node = source.id;
    if (source.action) element.dataset.action = source.action;
    if (source.qa) element.dataset.qa = source.qa;
    if (source.origin) element.style.transformOrigin = source.origin;
    if (source.fill) element.style.background = source.fill;
    if (source.shadow) element.style.filter = `drop-shadow(${source.shadow})`;
    if (source.mirror) element.style.scale = '-1 1';
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
    if (source.progress) {
      element.setAttribute('role', 'progressbar');
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
    const node = { source, element, art, pressedArt, copy, screen, ancestors, space: source.space ?? inheritedSpace, root: ancestors.length === 0 };
    nodes.set(source.id, node);
    for (const child of source.children ?? []) create(child, element, screen, node.space, [...ancestors, source.id]);
  }
  for (const node of recipe.nodes) {
    let parent = stage;
    if (node.screen) {
      if (!screens.has(node.screen)) {
        const layer = document.createElement('div');
        layer.className = 'screen';
        layer.dataset.screen = node.screen;
        stage.append(layer);
        screens.set(node.screen, layer);
      }
      parent = screens.get(node.screen);
    }
    create(node, parent, node.screen);
  }

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

  function getText(text, state) {
    if (typeof text !== 'object') return text;
    if (text.progress) {
      const value = recipe.states[state].progress?.value;
      return value === undefined ? '' : `${value}%`;
    }
    const value = recipe.fixtures?.[fixture]?.[text.key] ?? recipe.data[text.key];
    return `${text.prefix ?? ''}${value}${text.suffix ?? ''}`;
  }

  function paintLoop(loop, time) {
    for (const [id, values] of sampleTracks(loop.tracks, profile, time)) {
      const { element, source } = nodes.get(id);
      element.style.transform = transformStyle(values);
      element.style.opacity = values.opacity ?? source.opacity ?? 1;
    }
  }

  function stopLoops() {
    for (const { loop } of activeLoops.values()) {
      for (const track of loop.tracks) {
        const { element, source } = nodes.get(track.node);
        element.style.transform = '';
        element.style.opacity = source.opacity ?? 1;
      }
    }
    activeLoops.clear();
    cancelAnimationFrame(loopRequest);
    loopRequest = 0;
  }

  function paintActiveLoops(now) {
    for (const { loop, start } of activeLoops.values()) {
      paintLoop(loop, Math.max(0, now - start) % loop.period);
    }
  }

  function loopFrame(now) {
    paintActiveLoops(now);
    loopRequest = requestAnimationFrame(loopFrame);
  }

  function syncLoops(visual) {
    if (reduced || document.hidden) return;
    if (manualLoop) {
      paintLoop(manualLoop.loop, manualLoop.time);
      return;
    }
    if (manual || (animation && !animation.sequence?.allowLoops)) return;
    const now = performance.now();
    const modal = [...nodes.values()].some(({ source, element }) => source.modal && !element.closest('[hidden], [inert]'));
    for (const [id, loop] of loops) {
      const control = nodes.get(loop.control)?.element;
      const available = (!control || (!control.disabled && !control.closest('[hidden], [inert]'))) &&
        loop.tracks.some(({ node }) => !nodes.get(node).element.closest('[hidden], [inert]'));
      if (!modal && loop.states.includes(visual) && available) {
        if (!activeLoops.has(id)) activeLoops.set(id, { loop, start: now });
      } else if (activeLoops.has(id)) {
        activeLoops.delete(id);
      }
    }
    if (activeLoops.size) {
      paintActiveLoops(now);
      if (!loopRequest) loopRequest = requestAnimationFrame(loopFrame);
    } else if (loopRequest) {
      cancelAnimationFrame(loopRequest);
      loopRequest = 0;
    }
  }

  function draw() {
    const sequence = animation?.sequence;
    const time = animation?.time ?? 0;
    const latest = sequence?.phases?.findLast(({ at }) => at <= time);
    const route = animation?.route;
    const visual = route?.to ?? latest?.state ?? state;
    const currentScreen = screenOf(visual);
    const outgoingScreen = screenOf(route?.from);
    const duration = route?.duration ?? 0;
    const transition = route && time < duration;
    const progress = transition ? easing.outCubic(time / duration) : 1;
    const incomingOpacity = transition ? easing.outCubic(Math.max(0, time - 45) / (duration - 45)) : 1;
    const outgoingOpacity = transition ? 1 - easing.outCubic(Math.min(time / 110, 1)) : 0;
    for (const [id, layer] of screens) {
      const entering = id === currentScreen;
      const leaving = transition && id === outgoingScreen;
      layer.hidden = !entering && !leaving;
      layer.inert = !!transition || layer.hidden;
      layer.style.zIndex = transition ? (entering ? 2 : 1) : '';
      layer.style.opacity = leaving ? outgoingOpacity : entering ? incomingOpacity : 1;
      const distance = route?.direction * 28 || 0;
      layer.style.transform = transition ? `translateX(${px(leaving ? -distance * progress : distance * (1 - progress))})` : '';
    }
    const tracks = sampleTracks(sequence?.tracks ?? [], profile, time);
    for (const [id, node] of nodes) {
      const { source, element, art, pressedArt, copy, box, screen } = node;
      const sceneState = transition && screen === outgoingScreen ? route.from : visual;
      const event = animation?.changes?.get(id)?.findLast(({ at }) => at <= time);
      const changing = event && time < event.at + event.ms;
      const exiting = changing && !event.entering;
      const paintState = exiting ? event.from : sceneState;
      const visible = visibleIn(source, sceneState, !!sequence);
      const skipAction = sequence?.skip?.action;
      element.hidden = !visible && !exiting;
      const hasClaim = claimed || recipe.states[paintState].claimed;
      if (source.progress) {
        const value = recipe.states[paintState].progress?.value;
        if (value === undefined) element.removeAttribute('aria-valuenow');
        else element.setAttribute('aria-valuenow', value);
        nodes.get(source.progress.fill).element.style.clipPath = `inset(0 ${100 - (value ?? 0)}% 0 0)`;
      }
      if (element instanceof HTMLButtonElement) {
        element.disabled = source.disabled === true || source.disabledIn?.includes(sceneState) === true ||
          (source.disableWhenClaimed === true && hasClaim) || manual || !visible ||
          (!!animation && source.action !== skipAction);
      }
      if (art) {
        const selected = (hasClaim && source.claimedAsset) || source.assetByState?.[paintState] || source.asset;
        const paintKey = [selected, scale, ...box].join(':');
        if (selected && node.lastPaint !== paintKey) {
          setArt(art, selected, pack.assets, box, scale);
          if (pressedArt) setArt(pressedArt, source.pressedAsset, pack.assets, box, scale);
          node.lastPaint = paintKey;
        }
      }
      if (copy) {
        const value = getText((hasClaim && source.claimedText) || source.textByState?.[paintState] || source.text, paintState);
        if (copy.textContent !== String(value)) copy.textContent = value;
        if (source.font?.minSize && !element.hidden && node.lastTextFit !== value && copy.getClientRects().length) {
          fitCopy(copy, source.font);
          node.lastTextFit = value;
        }
      }
      const transform = tracks.get(id);
      const baseOpacity = source.opacity ?? 1;
      const fraction = changing ? easing.outCubic((time - event.at) / event.ms) : 1;
      const visibilityOpacity = changing ? (event.entering ? fraction : 1 - fraction) : 1;
      element.style.opacity = transform?.opacity ?? baseOpacity * visibilityOpacity;
      element.style.transform = transform
        ? transformStyle(transform)
        : changing ? `translateY(${px(event.y * (event.entering ? 1 - fraction : fraction))})` : '';
    }
    stage.dataset.state = visual;
    if (currentScreen) stage.dataset.screen = currentScreen;
    if (animation) stage.dataset.time = String(Math.round(time));
    else delete stage.dataset.time;
    if (loops.length) syncLoops(visual);
  }

  function emit(action) {
    counts[action] = (counts[action] ?? 0) + 1;
    const spec = recipe.actions[action];
    if (spec.setsClaimed) claimed = true;
    for (const [screen, next] of Object.entries(spec.remember ?? {})) remembered.set(screen, next);
  }

  function finish() {
    const { route, sequence } = animation;
    animation = null;
    previousTime = 0;
    state = route?.to ?? sequence?.phases?.at(-1)?.state ?? state;
    draw();
    sync();
    const target = nodes.get(route?.focus ?? sequence?.focus)?.element;
    if (target) target.focus({ preventScroll: true });
  }

  function advance(time) {
    const active = animation;
    active.time = Math.min(active.duration, time);
    if (!manual) {
      for (const [index, event] of (active.sequence?.events ?? []).entries()) {
        if (event.at <= active.time && !active.fired.has(index)) {
          active.fired.add(index);
          emit(event.action);
        }
      }
      if (active.time >= active.duration) {
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

  function makeRoute(action, from, trigger) {
    const { navigate } = recipe.actions[action];
    const origin = screenOf(from);
    const previous = navigate.back && history.at(-1)?.screen === navigate.to ? history.at(-1) : null;
    const to = remembered.get(navigate.to) ?? recipe.screens[navigate.to].initial;
    if (!manual) {
      remembered.set(origin, from);
      if (previous) history.pop();
      else if (!navigate.back) history.push({ screen: origin, focus: trigger });
    }
    const duration = 260;
    const route = { from, to, duration, direction: navigate.back ? -1 : 1, focus: previous?.focus ?? navigate.focus };
    return { id: action, route, duration, time: 0 };
  }

  function makeAnimation(id, sequence, start) {
    return { id, sequence, time: 0, fired: new Set(), ...visibilityChanges(nodes, sequence, start, recipe.motionDefaults) };
  }

  function play(active, finishReduced) {
    stopLoops();
    animation = active;
    if (reduced && finishReduced) {
      advance(active.duration);
      return;
    }
    advance(0);
    nodes.get(active.sequence?.skip?.focus)?.element.focus({ preventScroll: true });
    request = requestAnimationFrame(frame);
  }

  function activate(action, id) {
    if (manual) return;
    const spec = recipe.actions[action];
    if (spec.type !== 'input') return;
    if (spec.skip) {
      const skip = animation?.sequence?.skip;
      if (skip && animation.time < skip.at && animation.time >= (skip.after ?? 0)) advance(skip.at);
      return;
    }
    if (animation || (spec.from && !spec.from.includes(state))) return;
    if (nodes.get(id)?.source.disableWhenClaimed && claimed) return;
    if (spec.navigate) {
      play(makeRoute(action, state, id), true);
      return;
    }
    const sequence = Object.entries(recipe.motion).find(([, item]) => item.trigger === action);
    if (sequence) {
      play(makeAnimation(sequence[0], sequence[1], state), sequence[1].reduced === 'finish');
      return;
    }
    emit(action);
    if (spec.next && recipe.motionDefaults && spec.next !== state) {
      const implicit = { duration: 0, phases: [{ at: 0, state: spec.next }] };
      play(makeAnimation(action, implicit, state), true);
      return;
    }
    state = spec.next ?? state;
    draw();
  }

  function resetState() {
    stopLoops();
    cancelAnimationFrame(request);
    request = 0;
    previousTime = 0;
    manual = false;
    manualLoop = null;
    demo = null;
    animation = null;
    state = recipe.initialState;
    counts = {};
    claimed = false;
    remembered.clear();
    history.length = 0;
  }

  function reset() {
    resetState();
    draw();
    sync();
  }

  function show(stateId) {
    if (!Object.hasOwn(recipe.states, stateId)) return;
    resetState();
    state = stateId;
    manual = true;
    draw();
    sync();
  }

  function seek(sequenceId, time) {
    const sequence = visuals.get(sequenceId);
    if (!sequence) return;
    resetState();
    manual = true;
    const frameTime = Math.max(0, Number(time) || 0);
    if (sequence.loop) {
      const { loop } = sequence;
      state = loop.states[0];
      manualLoop = { id: sequenceId, loop, time: Math.min(frameTime, loop.period) };
      draw();
      sync();
      return;
    }
    if (sequence.routeAction) {
      state = recipe.actions[sequence.routeAction].from[0];
      animation = makeRoute(sequence.routeAction, state);
    } else {
      const source = sequence.trigger ? recipe.actions[sequence.trigger].from?.[0] : undefined;
      state = source ?? sequence.phases?.[0]?.state ?? recipe.initialState;
      animation = makeAnimation(sequenceId, sequence, state);
    }
    advance(frameTime);
  }

  function openDemo(id) {
    const entry = recipe.previewDemos?.[id];
    if (!entry) {
      reset();
      return;
    }
    resetState();
    demo = id;
    state = entry.state;
    if (entry.motion) play(makeAnimation(entry.motion, recipe.motion[entry.motion], state), false);
    else {
      draw();
      sync();
    }
  }

  function select(name, items, value, change) {
    const label = document.createElement('label');
    label.append(name);
    const field = document.createElement('select');
    field.setAttribute('aria-label', name);
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
  const demoControl = demos.length ? select('Demo', [
    ['', 'Off'], ...demos.map(([id, entry]) => [id, entry.label]),
  ], '', openDemo) : null;
  let timeline;
  let position;
  let reducedControl;
  if (visuals.size) {
    timeline = select('Timeline', [['', 'Choose timeline'], ...[...visuals].map(([id, entry]) => [id, entry.label])], '', (value) => {
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
    reducedControl = document.createElement('input');
    reducedControl.type = 'checkbox';
    reducedControl.checked = reduced;
    reducedControl.addEventListener('change', () => updateReduced(reducedControl.checked));
    reducedLabel.append(reducedControl, 'Reduce motion');
    tools.append(reducedLabel);
  }
  const restart = document.createElement('button');
  restart.textContent = 'Reset';
  restart.addEventListener('click', reset);
  tools.append(restart);

  function sync() {
    stateControl.value = manual ? state : 'live';
    if (demoControl) demoControl.value = demo ?? '';
    if (timeline && position) {
      const inspected = manual ? manualLoop ?? animation : null;
      timeline.value = inspected?.id ?? '';
      position.disabled = !timeline.value;
      position.max = inspected?.loop?.period ?? inspected?.duration ?? 0;
      position.value = inspected?.time ?? 0;
      position.title = inspected ? `${Math.round(inspected.time)} ms` : '';
    }
  }

  function updateReduced(next) {
    reduced = next;
    if (reducedControl) reducedControl.checked = reduced;
    stopLoops();
    if (reduced && !manual && (animation?.route || animation?.sequence?.reduced === 'finish')) {
      cancelAnimationFrame(request);
      advance(animation.duration);
    } else {
      draw();
    }
  }

  stage.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || manual) return;
    const action = animation ? animation.sequence?.skip?.action : recipe.states[state].escape;
    if (recipe.actions[action]) activate(action);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoops();
    else draw();
  });
  motionPreference.addEventListener('change', () => updateReduced(motionPreference.matches));
  addEventListener('resize', resize);
  resize();
  if (params.has('sequence')) seek(params.get('sequence'), params.get('t'));
  else if (params.has('state')) show(params.get('state'));
  else if (params.has('demo')) openDemo(params.get('demo'));
  window.preview = {
    get state() { return stage.dataset.state; },
    get screen() { return stage.dataset.screen; },
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
