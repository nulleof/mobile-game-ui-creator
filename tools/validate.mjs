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
  const { design, states, initialState, actions, motion } = recipe;
  assert.ok(design.width > 0 && Object.keys(design.profiles).length > 0, 'Design profiles are required');
  for (const profile of Object.values(design.profiles)) {
    assert.ok(tuple(profile.viewport, 2) && profile.viewport.every((edge) => edge > 0), 'Invalid viewport');
    assert.ok(tuple(profile.safeInsets, 4) && profile.safeInsets.every((edge) => edge >= 0), 'Invalid safe area');
  }
  assert.ok(Object.hasOwn(states, initialState), 'Initial state missing');
  const assetExists = (id) => assert.ok(Object.hasOwn(pack.assets, id), `Unknown asset: ${id}`);
  const knownStates = (state) => assert.ok(Object.hasOwn(states, state), `Unknown state: ${state}`);
  const ids = new Set();
  function visit(nodes) {
    for (const node of nodes) {
      assert.ok(componentId.test(node.id) && !ids.has(node.id), `Invalid or duplicate node ID: ${node.id}`);
      ids.add(node.id);
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
      if (node.action) assert.ok(Object.hasOwn(actions, node.action), `Unknown action: ${node.action}`);
      for (const text of [node.text, ...Object.values(node.textByState ?? {})]) {
        if (text?.key) assert.ok(Object.hasOwn(recipe.data, text.key), `Missing fixture: ${text.key}`);
      }
      if (node.children) visit(node.children);
    }
  }
  visit(recipe.nodes);
  const seenMotions = new Set();
  for (const sequence of Object.values(motion)) {
    assert.ok(numeric(sequence.duration) && sequence.duration > 0, 'Motion duration is required');
    if (sequence.trigger) {
      assert.ok(Object.hasOwn(actions, sequence.trigger), `Unknown motion trigger: ${sequence.trigger}`);
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
    const validTime = (time, previous) => numeric(time) && time >= 0 && time >= previous && time <= sequence.duration;
    for (const list of [sequence.phases ?? [], sequence.events ?? []]) {
      let previous = 0;
      for (const step of list) {
        assert.ok(validTime(step.at, previous), `Step outside timeline: ${step.at}`);
        if (step.state) knownStates(step.state);
        if (step.action) assert.ok(Object.hasOwn(actions, step.action), `Unknown event action: ${step.action}`);
        previous = step.at;
      }
    }
    for (const track of sequence.tracks) {
      assert.ok(ids.has(track.node) && properties.has(track.property), `Invalid track: ${track.node}/${track.property}`);
      for (const [profile, keys] of Object.entries({ default: track.keys, ...track.keysByProfile })) {
        assert.ok(profile === 'default' || Object.hasOwn(design.profiles, profile), `Unknown keyframe profile: ${profile}`);
        assert.ok(keys.length > 0, `Track has no keyframes: ${track.node}`);
        let previous = 0;
        for (const [time, value, ease = 'linear'] of keys) {
          assert.ok(validTime(time, previous) && numeric(value) && easing.has(ease), `Invalid keyframe: ${track.node}`);
          previous = time;
        }
      }
    }
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
