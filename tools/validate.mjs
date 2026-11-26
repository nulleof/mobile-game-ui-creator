import assert from 'node:assert/strict';

const componentId = /^[a-z0-9][a-z0-9.-]*$/;
const fits = new Set(['contain', 'cover', 'stretch', 'slice', 'font']);
const easing = new Set(['linear', 'inQuad', 'outQuad', 'outCubic', 'outBack', 'smooth', 'step']);
const properties = new Set(['x', 'y', 'scaleX', 'scaleY', 'rotate', 'opacity']);
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const tuple = (value, length) => Array.isArray(value) && value.length === length && value.every(numeric);

export async function validateExample(recipe, pack, loadAsset) {
  assert.equal(recipe.pack.id, pack.id, 'Pack ID mismatch');
  assert.equal(recipe.pack.version, pack.version, 'Pack version mismatch');
  const { design, states, initialState, actions, motion, screens, motionDefaults, loops = {}, previewDemos = {} } = recipe;
  assert.ok(design.width > 0 && Object.keys(design.profiles).length > 0, 'Design profiles are required');
  for (const profile of Object.values(design.profiles)) {
    assert.ok(tuple(profile.viewport, 2) && profile.viewport.every((edge) => edge > 0), 'Invalid viewport');
    assert.ok(tuple(profile.safeInsets, 4) && profile.safeInsets.every((edge) => edge >= 0), 'Invalid safe area');
  }
  assert.ok(Object.hasOwn(states, initialState), 'Initial state missing');
  const assetExists = (id) => assert.ok(Object.hasOwn(pack.assets, id), `Unknown asset: ${id}`);
  const knownStates = (state) => assert.ok(Object.hasOwn(states, state), `Unknown state: ${state}`);
  const screenExists = (id) => assert.ok(Object.hasOwn(screens ?? {}, id), `Unknown screen: ${id}`);
  const stateBelongsTo = (state, screen) => {
    knownStates(state);
    assert.equal(states[state].screen, screen, `State ${state} belongs to a different screen`);
  };
  if (screens) {
    for (const state of Object.values(states)) screenExists(state.screen);
    for (const [id, screen] of Object.entries(screens)) stateBelongsTo(screen.initial, id);
  }
  for (const [id, state] of Object.entries(states)) {
    if (!state.progress) continue;
    const { value } = state.progress;
    assert.ok(value === undefined || (numeric(value) && value >= 0 && value <= 100), `Invalid progress value: ${id}`);
  }
  if (motionDefaults) {
    for (const key of ['enter', 'exit']) {
      const timing = motionDefaults[key];
      assert.ok(numeric(timing?.ms) && timing.ms > 0 && numeric(timing.y), `Invalid visibility timing: ${key}`);
    }
  }
  const ids = new Map();
  const controls = new Set();
  function visit(nodes, root = true, screen) {
    for (const node of nodes) {
      assert.ok(componentId.test(node.id) && !ids.has(node.id), `Invalid or duplicate node ID: ${node.id}`);
      if (node.screen !== undefined) {
        assert.ok(root, `Only a root node can declare a screen: ${node.id}`);
        screenExists(node.screen);
      }
      ids.set(node.id, node.screen ?? screen);
      if (node.visibilityMotion !== undefined) assert.equal(node.visibilityMotion, 'instant');
      if (node.scroll !== undefined) {
        assert.ok(node.scroll === 'vertical' && !node.clip && !node.action && node.children?.length && (node.screen ?? screen),
          `Invalid scroll container: ${node.id}`);
      }
      for (const box of [node.box, ...Object.values(node.boxes ?? {})]) {
        assert.ok(tuple(box, 4) && box[2] > 0 && box[3] > 0, `Invalid box: ${node.id}`);
      }
      for (const profile of Object.keys(node.boxes ?? {})) assert.ok(Object.hasOwn(design.profiles, profile), profile);
      if (node.asset) assetExists(node.asset);
      if (node.claimedAsset) assetExists(node.claimedAsset);
      if (node.pressedAsset) assetExists(node.pressedAsset);
      for (const id of Object.values(node.assetByState ?? {})) assetExists(id);
      for (const state of [
        ...(node.visibleIn ?? []), ...(node.disabledIn ?? []),
        ...Object.keys(node.assetByState ?? {}), ...Object.keys(node.textByState ?? {}),
      ]) knownStates(state);
      if (node.action) {
        assert.ok(Object.hasOwn(actions, node.action), `Unknown action: ${node.action}`);
        if (actions[node.action].type === 'input') controls.add(node.id);
      }
      if (node.currentIn !== undefined) {
        assert.ok(Array.isArray(node.currentIn) && node.currentIn.length && controls.has(node.id) && actions[node.action].navigate?.section,
          `Invalid current-section control: ${node.id}`);
        for (const state of node.currentIn) knownStates(state);
      }
      if (node.progress) {
        assert.ok(node.label && node.children?.some((child) => child.id === node.progress.fill), `Invalid progress fill: ${node.id}`);
      }
      for (const text of [node.text, ...Object.values(node.textByState ?? {})]) {
        if (text?.key) assert.ok(Object.hasOwn(recipe.data, text.key), `Missing fixture: ${text.key}`);
      }
      if (node.children) visit(node.children, false, node.screen ?? screen);
    }
  }
  visit(recipe.nodes);
  const timelineIds = new Set(Object.keys(motion));
  for (const [id, action] of Object.entries(actions)) {
    for (const state of action.from ?? []) knownStates(state);
    if (action.next) knownStates(action.next);
    for (const [screen, state] of Object.entries(action.remember ?? {})) {
      screenExists(screen);
      stateBelongsTo(state, screen);
    }
    if (!action.navigate) continue;
    const { to, label, focus } = action.navigate;
    screenExists(to);
    if (action.navigate.section !== undefined) {
      assert.ok(action.navigate.section === true && !action.navigate.back, `Invalid section route: ${id}`);
    }
    assert.ok(action.type === 'input' && action.from?.length && label, `Invalid screen action: ${id}`);
    assert.ok(action.from.every((state) => states[state].screen !== to), `Screen action must change screens: ${id}`);
    assert.ok(ids.has(focus) && ids.get(focus) === to, `Invalid route focus target: ${id}`);
    assert.ok(!timelineIds.has(id), `Screen action and timeline share an ID: ${id}`);
    timelineIds.add(id);
  }
  const validTime = (time, previous, duration) => numeric(time) && time >= 0 && time >= previous && time <= duration;
  function validateTracks(tracks, duration, ambient = false) {
    for (const track of tracks) {
      assert.ok(ids.has(track.node) && properties.has(track.property), `Invalid track: ${track.node}/${track.property}`);
      if (ambient) assert.ok(!controls.has(track.node), `Animate a visual layer inside control: ${track.node}`);
      for (const [profile, keys] of Object.entries({ default: track.keys, ...track.keysByProfile })) {
        assert.ok(profile === 'default' || Object.hasOwn(design.profiles, profile), `Unknown keyframe profile: ${profile}`);
        assert.ok(keys.length > 0, `Track has no keyframes: ${track.node}`);
        let previous = 0;
        for (const [time, value, ease = 'linear'] of keys) {
          assert.ok(validTime(time, previous, duration) && numeric(value) && easing.has(ease), `Invalid keyframe: ${track.node}`);
          previous = time;
        }
      }
    }
  }
  for (const [id, loop] of Object.entries(loops)) {
    assert.ok(componentId.test(id) && !timelineIds.has(id) && loop.label, `Invalid loop ID or label: ${id}`);
    assert.ok(numeric(loop.period) && loop.period > 0 && loop.states?.length && loop.tracks?.length, `Incomplete loop: ${id}`);
    assert.ok(!loop.control || controls.has(loop.control), `Invalid loop control: ${loop.control}`);
    for (const state of loop.states) knownStates(state);
    validateTracks(loop.tracks, loop.period, true);
  }
  const seenMotions = new Set();
  for (const sequence of Object.values(motion)) {
    assert.ok(numeric(sequence.duration) && sequence.duration > 0, 'Motion duration is required');
    if (sequence.allowLoops) assert.ok(!sequence.trigger && !sequence.events?.length, 'Only a passive sequence can allow loops');
    if (sequence.trigger) {
      assert.ok(Object.hasOwn(actions, sequence.trigger), `Unknown motion trigger: ${sequence.trigger}`);
      assert.ok(!actions[sequence.trigger].navigate, 'Screen transitions provide their own timeline');
      assert.ok(!seenMotions.has(sequence.trigger), `Duplicate motion trigger: ${sequence.trigger}`);
      seenMotions.add(sequence.trigger);
    }
    if (sequence.skip) {
      assert.ok(sequence.skip.at >= 0 && sequence.skip.at <= sequence.duration, 'Invalid skip time');
      assert.ok(Object.hasOwn(actions, sequence.skip.action), 'Invalid skip action');
      if (sequence.skip.focus) assert.ok(ids.has(sequence.skip.focus), 'Invalid skip focus target');
    }
    if (sequence.focus) assert.ok(ids.has(sequence.focus), 'Invalid completion focus target');
    if (sequence.reduced !== undefined) assert.ok(['finish', 'omit', 'play'].includes(sequence.reduced), 'Invalid reduced-motion rule');
    for (const list of [sequence.phases ?? [], sequence.events ?? []]) {
      let previous = 0;
      for (const step of list) {
        assert.ok(validTime(step.at, previous, sequence.duration), `Step outside timeline: ${step.at}`);
        if (step.state) knownStates(step.state);
        if (step.action) assert.ok(Object.hasOwn(actions, step.action), `Unknown event action: ${step.action}`);
        previous = step.at;
      }
    }
    for (const { event, target, effect, at, end } of sequence.impacts ?? []) {
      assert.ok(event && ids.has(target) && ids.has(effect), `Invalid impact target: ${event}`);
      assert.ok(validTime(at, 0, sequence.duration) && validTime(end, at, sequence.duration) && end > at, `Invalid impact timing: ${event}`);
    }
    validateTracks(sequence.tracks, sequence.duration);
  }
  for (const [id, demo] of Object.entries(previewDemos)) {
    assert.ok(componentId.test(id) && demo.label, `Invalid demo ID or label: ${id}`);
    knownStates(demo.state);
    if (demo.motion) assert.ok(motion[demo.motion]?.allowLoops, `Invalid demo timeline: ${demo.motion}`);
  }

  await Promise.all(Object.entries(pack.assets).map(async ([id, entry]) => {
    assert.ok(componentId.test(id) && fits.has(entry.fit), `Invalid asset: ${id}`);
    assert.ok(entry.path && !entry.path.includes('\\'), `Use portable paths for ${id}`);
    const data = await loadAsset(entry);
    if (entry.fit === 'font') {
      assert.ok(entry.license, `Font license required: ${id}`);
      return;
    }
    assert.ok(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `Expected PNG: ${id}`);
    assert.deepEqual(entry.size, [data.readUInt32BE(16), data.readUInt32BE(20)], `Incorrect image size: ${id}`);
    if (entry.fit === 'slice') {
      assert.ok(tuple(entry.slice, 4) && tuple(entry.border, 4), `Missing slice guides: ${id}`);
      const [top, right, bottom, left] = entry.slice;
      assert.ok(entry.slice.every((edge) => edge >= 0) && top + bottom < entry.size[1] && left + right < entry.size[0], `Slice exceeds image: ${id}`);
    }
  }));
}
