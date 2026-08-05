# exlab platform contract

The platform owns the game catalog, shared roster, last-used game, four
streamer identity themes, and cross-game navigation. The shell keeps a
practical light base and stores the selected profile's product-chrome colours.
Roulette and Showdown continue to own their rules, preview, run state, physics
or selection logic, participant/semantic colours, and detailed result
presentation. Showdown alone keeps its independent game-specific light/dark
map toggle, defaulting to light.

## Lifecycle

| Platform state | Meaning | Game switch |
| --- | --- | --- |
| `editing` | Inputs may be edited safely | allowed |
| `generating` | A run is being prepared | locked |
| `waiting` | Broadcast view is prepared | locked |
| `active` | Countdown or game is running | locked |
| `settling` | Physical/result gate is completing | locked |
| `result` | Current run result is being presented | locked |
| `failed` | Recovery is required before editing | locked |

Each engine can keep finer internal states. Its adapter reports
`onActivityChange(true)` for every locked state and reports `false` only after
returning to a safe editing state. Unmount cleanup also reports `false`.

Only the last-selected game is lazy-loaded at startup. A surface stays mounted
after its first visit so switching games does not discard that engine's setup
draft. The shell hides the inactive surface and passes `active={false}`;
adapters pause previews, timers, and animations while inactive, then resume
from the preserved draft when selected again.

The header's `참가자 N명` button opens the one shared roster dialog. Duplicate
names are rejected by default. When the persisted shared policy allows them,
parsing preserves every occurrence and each engine assigns a distinct
participant number instead of deduplicating the list.

## Invariants

1. The catalog in `catalog.ts` stays data-only and JSON-serializable.
2. The shell never reads or changes engine-specific result or physics state.
3. The shared roster has one owner (`ExlabApp`) and is passed to every game as a
   controlled value.
4. The platform, both previews, and standalone Showdown share the exact
   `레또 / 레카 / 세나 / 망징` default from `defaultRoster.ts`. Every exact
   known 5-, 7-, or 8-person product default migrates regardless of snapshot
   revision or participant IDs. Every non-matching custom roster, including
   one containing hidden Coco or Torori aliases, remains untouched.
5. Previous `ex-lab:roster:v1` and Race-engine rosters migrate to
   `exlab:roster:v1`. Every subsequent shared-roster write mirrors the legacy
   keys for rollback
   compatibility.
6. A game cannot be switched while its adapter reports an active session.
7. New games register one catalog entry and one component implementing
   `EmbeddedGameProps`; the shell layout does not change.
8. Editing-state game surfaces stay mounted so their local setup drafts survive
   a switch; inactive previews and other continuous work must not advance.
9. Unvisited game modules are not loaded.
10. Showdown styles stay inside `.showdown-game` and Roulette styles stay inside
   `.roulette-game`; the common shell overrides descendants with the
   Inter → Pretendard → system sans stack.
11. Stored Showdown history validates rows, drops malformed legacy data, and
    migrates a valid legacy `winnerName` into `winnerNames`.
