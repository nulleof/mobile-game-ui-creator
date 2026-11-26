# Motion mechanics for ready game UI

Name the screen's principal action and the states in which it makes sense. Use motion to indicate readiness, continuity, or a result. Start with one noticeable recurring cue and choose slower, softer motion for background art. Leave still areas for copy and numeric readouts. [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion)

| Mechanic | Use it when | Authoring choice |
| --- | --- | --- |
| Invitation | An object is ready and the player can act | Let a chest or tomato icon breathe, bob, or make a small hop. A button can have a short clipped shine and a longer rest. Keep its touch target fixed. |
| Background motion | A scene needs character during idle time | Float an object or breathe a soft light on a slow cycle. Keep the movement quiet around the principal action. |
| Touch feedback | A player presses, selects, or confirms | Give an immediate press or selection response. Play result effects when the operation is confirmed. |
| Attention guidance | A badge, tutorial step, or newly available action matters now | Briefly accent the relevant marker or target. Stop when acknowledged, ineligible, or hidden. |
| Appearance and navigation | A layer enters or the player changes context | Use a small directional or opacity change. Preserve shared references and restore focus on return. |
| Waiting and progress | An operation is still active | Sweep a shine through the measured fill. Show an indeterminate band when the amount is unknown. Show a clear static state on pause, error, or completion. |
| Update and reward | A number, slot, item, or reward changes | Anchor the effect to the change. Peak on impact, then decay so the next action is easy to see. |

For each selected mechanism record the affected layer, trigger, active states, timing, resting pose, stop conditions, and reduced-motion result. Check an available control, the first touch, the result, and an unavailable or dismissed state. In reduced motion, retain readable status and the actual state changes. Use the game's measurement as the progress source even when its value holds steady. [Apple progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
