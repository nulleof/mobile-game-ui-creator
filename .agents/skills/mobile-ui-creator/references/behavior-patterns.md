# Behavior patterns for mobile games

Use the existing states, actions, fixtures and motion in the recipe. For each important transition, record the player-facing signal, enabled action, and source of truth for the destination state. Exercise the relevant paths through the live preview and inspect motion separately.

## First-use teaching

| Step | UI behavior |
| --- | --- |
| Contextual prompt | Enter where the mechanic matters. Place a brief cue next to the action or its target without covering the gameplay. Make the cue readable with reduced motion. |
| Guided action | Let the player perform the real action. Confirm the result from gameplay and give a useful recovery cue after a failed attempt. |
| Independent attempt | Present the mechanic in a fresh situation after removing the instructional cue. Define what counts as a successful independent action. Complete the lesson on gameplay confirmation and show normal gameplay feedback. |
| Skip, replay and resume | Skip leads to usable play, with a visible route to replay from Help or Settings. Preserve progress through backgrounding and resume at the appropriate step. In a timed drill, restore or restart the interrupted attempt so the player can react. Replay the lesson from its first step without resetting ordinary progression. |

In the runnable preview, exercise both success steps, Skip → Replay, return during the prompt and the first independent attempt. Check reduced motion and any input lock or focus transfer. [Apple Onboarding for Games](https://developer.apple.com/app-store/onboarding-for-games/)

## Rewards and upgrades awaiting confirmation

| State | UI behavior |
| --- | --- |
| Available → waiting | Acknowledge the tap immediately, hold the result UI until confirmed, and gate duplicate taps while the attempt is active. |
| Interrupted, outcome unknown | Say that the connection was lost or that the result is being checked. Keep the pending action identifiable after backgrounding. Restore the UI from authoritative status on resume when the game can check it. Offer a retry when the request can be safely repeated. When offline, communicate how to continue once connected. |
| Confirmed | Display the confirmed balance, reward or level and a clear completion cue. Repeated or late confirmations of the same operation converge on that outcome and do not replay the grant. |
| Definitive failure | Explain the useful reason and offer an applicable next step such as Retry, Close, or picking an available alternative. |

Use the game's existing operation identity and reconciliation behavior. If a request may already have succeeded, reconcile the original operation before offering a new one, or retry with the same identity when the game supports it. Keep the operation and grant under gameplay authority. Treat the preview as a fixture for that contract and keep timeline scrubbing passive.

Check both “committed, response lost” and “not committed before reconnect,” including a return from background and rapid retries. Verify a single grant, the confirmed value, and a stable result if a late response arrives. For simulated states, mark actual backend reconciliation as pending. [Apple Progress Indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
