# Patterns from CatSurvivor (Last Survival)

The Dusk Outpost theme uses layered navy panels, a warm orange primary action, compact resource capsules, cream outlined type, and tactile illustrated icons. These form a vocabulary that extends from the Journey shell into overlays. Art that must resize uses explicit 9-slice guides, and controls keep text and touch feedback independent of the texture. Study the pattern and assign a visual language appropriate to the target game.

For the reference project, `docs/ui-style.md` identifies the approved direction and `docs/ui-concepts/F_home.png` shows the Journey composition. `docs/meta-ui.md` describes safe-area behavior and the two portrait profiles. `Assets/LastSurvival/MetaComposition/MetaViewJourney.cs` and `MetaViewRewards.cs` show how the chapter chest connects to reward presentation. `docs/hud-v2/README.md` provides a separate example of deterministic still-frame inspection and layered HUD effects.

The chapter chest moves from the activated control into a full-screen reveal. The model supplies the eligible rewards. Flight, anticipation, open art, rays and sparkles communicate the payoff. Skip joins the opening phase. A single claim transition hands off to the reward summary, which restores normal input on dismissal. Simulate that contract for preview tests and hand it back to the caller for connection to the target game.
