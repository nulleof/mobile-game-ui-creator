# UI handoff

## Files and status

Place the pack manifest at `asset-pack.json`, and each screen in its own directory with `recipe.md`, `recipe.json`, and a `preview.png` or explicitly named viewport/state captures. Use paths relative to the handoff or an explicitly declared project asset root. A whole-game request also gets `screen-map.md`. Keep rejected concepts and intermediate generation files outside the runtime asset manifest. An approved pack can be extended with a new version while existing references remain resolvable.

The caller receives the status (`ready`, `awaiting-style-selection`, or `blocked`), artifact paths, the supported states and profiles, instructions to bind the data/actions and play the motion, and concrete gaps. Use `ready` after the real layered PNG and its mandatory assets have been checked. Use `blocked` with a precise missing input and the partial recipe when progress can continue independently.

## JSON fields

| File | Required fields |
| --- | --- |
| Asset pack | `id`, `version`, `assets`. Every asset entry has a stable ID (the key), `path`, `size` [width, height] for images, and `fit`. Options include `contain`, `cover`, `stretch`, and `slice`. A sliced asset includes `slice` for source pixels and `border` for logical destination units, both [top, right, bottom, left]. A font uses `fit: "font"` and includes its license when supplied. Pack provenance identifies the source or approved concept. |
| Screen | `id`, `pack` [ID and version at the top level of the pack reference], `design` (logical width, viewport profiles and safe insets), `data`, `actions`, `states`, `initialState`, `nodes`, and `motion`. Declare an empty array or object for a category with no entries. |
| Node | Stable `id`, logical `box` [x, y, width, height] and optional `boxes` overrides keyed by viewport profile. Siblings are listed back to front and children are relative to the parent. Root coordinates use the safe area unless `space: "screen"` is set. A node may reference an `asset`, a data-bound `text`, an `action`, state visibility, and other declared layout or typography properties. Implement touch areas separately where the visible art is small. |
| Motion | Named sequences with triggering action or state, duration in milliseconds, ordered visual phases, and tracks. A track names a node and property, and gives relative keyframes with values, times, and easing. Include skip target, replay/duplicate-input behavior, cancellation, and a reduced-motion result. Include sound/haptic events when they belong to the design and label missing sources explicitly. |

The recipe is the authority for layout, visual states, and timing. Expose actual text and values as data, with example fixtures for visually significant states. Describe how to map the target game's authoritative state and commands, including asynchronous, unavailable, or expired states where applicable. The handoff uses logical units and asset IDs. Native UI node names and import settings are decisions for the receiving project.

Each profile declares `viewport` [width, height] and `safeInsets` [top, right, bottom, left] in that viewport's pixels. Convert insets to the logical coordinate system by scaling with the ratio of logical width to viewport width. A keyframe in the pilot has form `[timeMs, value, easing]` and uses the destination keyframe's easing for interpolation. Use `keysByProfile` to override a path when the source and destination move between viewport profiles.

Record a QA pass with a real rendered frame. Test both supported extremes of viewport and safe insets, long localized text where applicable, larger numbers, and legibility over art or gameplay. Inspect input capture on modal open, Skip and Back behavior, interrupted transitions, and final focus. Triggering an animation should never grant a reward twice. Stepping through frames should never dispatch an action.
