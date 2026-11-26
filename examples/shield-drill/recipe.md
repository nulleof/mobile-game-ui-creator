# Shield Drill

The player enters Relay 07 during a salvo and protects the relay with Shield. A successful tap removes the shots, shows “Shot deflected,” and leaves integrity at 100%. The persistent HUD is the relay name and integrity. Incoming status, training guidance and the result appear when relevant. The bottom action sits outside the travel lane.

## Preview routes

Build with `node tools/preview.mjs shield-drill` and open `.artifacts/shield-drill.html`. The default run starts with a dark, guided frame. The first tap on Shield shows a confirmed deflection, then presents a fresh salvo in the bright arena. The second shot has no teaching cue and completes the drill. Skip opens the playable HUD. Replay drill returns to the guided shot.

- **Independent shot.** Choose `Demo → HUD · independent shot`. Set `Data → long-label` to exercise wrapping. Use `?clean=1&profile=compact&demo=practice` for a first-attempt playtest without preview controls.
- **Reward committed before the response is lost.** Choose the corresponding reward scenario in `Demo`, then tap Claim reward and Retry. Reconciliation returns the existing grant.
- **Connection lost before the grant.** Choose the other reward scenario and tap Claim reward and Retry. The fixture checks the pending operation and retries that operation once. The player-facing result in both scenarios is “Reward received” and a balance of 170 Alloy, up from 120.

The recipe records separate fixture events for sending a request, checking its status, retrying the original operation and granting a reward. In a game build, authoritative data supplies those outcomes. The preview simulates them with local transitions. The incoming shot is a repeatable visual fixture for evaluating the HUD. Keep timing, damage, and collision rules in the game implementation.

## QA evidence

| Check | Profile and outcome |
| --- | --- |
| Typical and busy gameplay | Chromium touch emulation at 320 × 568 and 390 × 844. The compact captures show the [dark guided shot](captures/guided-compact.png), the [bright independent shot with a long label](captures/practice-compact.png), and the [confirmed result](captures/complete-compact.png). Critical text has an opaque backing and each status includes a text cue. |
| Touch and copy | Chromium touch emulation checks the active boxes against the simulated safe insets and confirms the long label fits. The shield and replay boxes are 116 × 56 and 105 × 52 logical units. In Chrome on a physical OnePlus 6 (1080 × 2280), the German label wraps to two lines. A scripted tap in the middle left the salvo pending. A scripted tap on Shield showed “Shot deflected” at 100% integrity. |
| First use | Chromium exercises the guided and independent actions, Skip → Replay, and simulated page freeze/resume during each step. Reduced motion retains the result. |
| Rewards | Chromium exercises both loss branches, rapid repeat taps, and a freeze/resume with the pending operation. Each interactive branch produces one grant and shows the same confirmed balance. Timeline inspection keeps the command log empty. See the [settled result](captures/reward-compact.png). |

For the next first-attempt observation on a phone, start in independent practice with the default label. Ask the player to “Keep the relay safe from the next shot.” Record their first action, misses, requests for help, and how they understood the result. Pending checks include a new participant's grip and reach, OS edge gestures, native input units in the game, and reconciliation against a real server.

## Art source

The built-in ImageGen tool created the relay bay from the following prompt.

> Generate one original portrait 2:3 raster gameplay background for Shield Drill, a mobile sci-fi station defense arcade prototype. The same fixed frame will sit behind actual live UI. Art only: no UI, frame, text, lettering, numbers, icons, aim reticles, progress bars, logos, borders or projectiles. Near top-down view into a deep blue-black orbital industrial bay, layered technical flooring and dim cyan optical lighting, a single ivory and slate orbital relay near center but slightly below midpoint with a small luminous teal core. A clean central vertical approach lane above the relay and darkness around the outer top and bottom quarters leave clear foreground layering space. Tactile painted metal, credible 3D hand-painted indie game environment, understated restrained color, no people. Full bleed, sharp gameplay-scale silhouettes, polished illustration with small details around the sides.
