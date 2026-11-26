# Screen map template

Copy the template into the handoff as `screen-map.md`. List permanent section entries and the actions players expect to repeat. Group catalog items by goal and keep a stable home for new events. Show enough on each row to decide what to open. Put the full conditions and instructions on its detail screen.

Use short visible labels for the permanent sections. Keep them available when a section has no entries and explain the empty state inside it. Write the next action as a verb. For a locked item, describe the unlock requirement and point to the relevant progress when there is a useful route. Keep the status readable without color.

## Template

**Starting screen and compact profile** — …

| Section and stable ID | Player goal | Permanent entry | Frequent routes from Home and taps | Back destination, restored focus and list position |
| --- | --- | --- | --- | --- |
| Progress · `progress` | Continue the main story | Progress tab and home screen | Continue chapter · 1 | Home · Continue |
| … | … | … | … | … |

| Activity and stable ID | Section and group | Status | Unlock condition | Next action | Detail screen |
| --- | --- | --- | --- | --- | --- |
| … | … | … | … | … | … |

**Next event** — Name its destination section and group. Record how the player will find it as the list grows.

## Check the draft before art

Populate the wireframe with representative names and states, including enough records to exercise scrolling and grouping. Start each task on Home, count taps separately from scroll gestures, and check that frequent actions take at most two taps. Record the actual route and outcome on the compact profile.

| Player situation | Task given to the player | Observable result |
| --- | --- | --- |
| New | Find something you can play now. | Starts an available mode and can explain why a locked one is unavailable. |
| Returning | Pick up the story where you stopped. | Opens the saved chapter. |
| Experienced | Find a named event in the catalog. | Opens its detail and returns to the same list position and control. |

Add the next event to the populated wireframe and repeat its route through the existing section. Label the evidence as a functional browser check or an observed player attempt using the [mobile QA report](handoff.md#mobile-qa-report).

[Apple Human Interface Guidelines — Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) · [Supercell — Clash of Clans navigation rework](https://supercell.com/en/games/clashofclans/blog/news/weve-revamped-the-clash-of-clans-user-interface/)
