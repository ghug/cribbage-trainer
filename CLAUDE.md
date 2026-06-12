# CLAUDE.md — Cribbage Discard Trainer

> Read this first. It is the full context for the project. It was handed off from a
> claude.ai chat session; treat it as the source of truth and update it as you work.

## START HERE (plain version)

You already have a finished, working app. It's the file **`index.html`** in this
folder — fully self-contained (no in-browser build, no install, no internet needed
beyond a CDN for React). **To just use it: open `index.html` in any browser.**

**It is also deployed** to a live, public link via Cloudflare (see Running and
deploying below): **`https://cribbage-trainer.gabrielhug.workers.dev`**. Pushing to
`main` on the `ghug/cribbage-trainer` repo auto-redeploys. Edit the source, run
`./build.sh`, commit, push — that's the whole update loop.

If you're a Claude Code session picking this up: the app runs locally, is published,
and the current direction is **(c) keep improving it** (see Good next steps).

## What this is

An interactive React trainer for practicing **optimal discarding** in cribbage —
**4-/3-handed "cutthroat"** (every player for themselves) or **2-handed heads-up**,
selectable in the UI. It deals a hand, lets the user pick the card(s) to throw, then
reveals a ranked, fully-explained analysis of every possible discard (5 single-card
throws when dealt 5 cards, all 15 two-card combos when dealt 6).

The whole app is a single component: `src/CribbageTrainer.jsx` (inline styles,
cribbage-board aesthetic, no dependencies beyond React). The `engine/` folder
holds the Node verification scripts the engine was validated against — they are
not imported by the app, but they document and re-prove the math.

## Game rules being modeled

- **Selectable 4-handed (default), 3-handed, or 2-handed**, via the "players at the
  table" toggle in the UI (`players` state ∈ {4, 3, 2}). 4-/3-handed are "cutthroat"
  (every player for themselves); 2-handed is standard heads-up cribbage.
- **Deal & discard depend on table size:**
  - **4-/3-handed:** each player dealt **5 cards**, discards **exactly one**. UI
    ranks the **5** single-card discards.
  - **2-handed:** each player dealt **6 cards**, discards **two**. UI ranks all
    **15** two-card combos; the user taps two cards.
- The crib always holds **4 cards**, scored with the starter as a 5-card hand:
  - **4-handed:** the 4 crib cards are one discard from each player.
  - **3-handed:** the three players' discards make only 3, so the **dealer adds one
    card dealt straight off the deck** (a uniform random card) to fill the crib.
  - **2-handed:** your **two** discards + the opponent's **two**.
- The **dealer owns the crib**. You deal 1 of every `players` hands (1-in-4, 1-in-3,
  or 1-in-2); otherwise you are a non-dealer ("defender") throwing into the dealer's
  crib.
- Standard show scoring: fifteens, pairs, runs (with duplicates), flush (4-card
  flush counts in the **hand** only; the crib needs all 5 same suit), nobs.

## Architecture / data flow

`analyze(hand, role, mode, players=4, N=10000, Npeg=700)` is the core. It enumerates
the discard options (`discardCombos`: 5 single-card throws for 4-/3-handed, all 15
two-card combos for 2-handed) and for each computes three components and two
roll-ups. Each option carries `{ id, idxs, cards }` (the discard index set + the
actual card(s)); `id` is `idxs.join(",")`. `players` flows into the crib and pegging
models below.

1. **Hand EV — exact.** `handDetail(four, dealt)` enumerates every possible cut
   card (47 from a 5-card deal, 46 heads-up) and averages the kept-four score.
   Returns `ev, sd, min, max, p10, p90`, category breakdown, `locked` (guaranteed
   pre-cut) and top-3 best cuts. No estimation — flush upgrades, nobs, everything
   falls out of enumeration. Independent of `players` (you only know your own cards).
2. **Crib EV — Monte Carlo (N=10,000).** `cribDetail(discards, dealt, ...)` takes
   your **array** of discards (1 card for 4-/3-handed, 2 heads-up) and fills the
   rest of the 4-card crib by an empirical **role-split rank distribution** (suits
   uniform within rank; starter uniform). The crib is always 4 cards:
   - **4-handed** deal → your 1 + **3 defender** throws; defend → your 1 + **1
     dealer** + **2 defender**.
   - **3-handed** deal → your 1 + **2 defender** + **1 uniform deck card**; defend →
     your 1 + **1 dealer** + **1 defender** + **1 uniform deck card**.
   - **2-handed** deal → your 2 + **2 defender** throws; defend → your 2 + **2
     dealer** throws (heads-up, the only other contributor is the dealer).
   Composition is computed generally: `nUniform = players===3 ? 1 : 0`,
   `nThrows = 4 - discards.length - nUniform`; on defense `nDealer = players===2 ?
   nThrows : 1`. The deck card is drawn like the starter (uniform). Because a uniform
   card is "richer" than a defender's deliberate junk throw, 3-handed cribs run a
   touch higher than 4-handed (see crib-swing note below).
3. **Pegging EV — Monte Carlo (N=700).** `pegDetail(...)` simulates `players`-handed
   play (`playPegging` derives the seat count from `hands.length`). Your seat =
   dealer (last seat = `players-1`, plays last = best peg seat) when dealing, else a
   random non-dealer seat. Opponents play a greedy point-grabbing policy with
   light defense. Suits are dropped here (pegging never scores flushes), so
   cards are ranks 1..13. Scoring mechanics (15/31/pair-royals/runs in & out of
   order/go/last card) are unit-tested in `engine/pegging.js`.

### Scoring roll-up

```
sign  = +1 if dealing else -1
net   = handEV + pegEV + sign*cribEV                      # mode-neutral expected points
sd    = sqrt(handSd^2 + cribSd^2 + pegSd^2)
adj   = handEV + pegEV + sign*cribW*cribEV + riskSign*RISK*sd   # the ranking objective
```

`RISK = 0.5`. Modes:

| mode    | label         | riskSign | cribW (defend only) |
|---------|---------------|----------|---------------------|
| ev      | max EV        |  0       | 1.0                 |
| need    | chase points  | +1       | 0.9                 |
| protect | protect lead  | -1       | 1.3                 |

`suggestMode(you, leader)`: `leader>=106 && you<leader → need`;
`you>=leader+15 && you>=95 → protect`; else `ev`. The board panel auto-applies the
suggestion but the user can override (Auto / ev / need / protect).

Performance: a full `analyze()` is ~175 ms at these sample sizes. Keep it under
~300 ms; it runs synchronously on each pick.

## Calibrated constants (baked into the JSX — do not regenerate casually)

Index 0 = A … 12 = K. Produced by an iterative fixed-point self-play calibration,
**averaged over passes 2–3** to cancel Monte-Carlo noise.

```
DEALER_DISCARD_PROBS   = [0.0639, 0.08325, 0.09032, 0.05659, 0.07681, 0.06226,
                          0.08103, 0.0937, 0.06772, 0.04889, 0.09511, 0.07993, 0.10046]
DEFENDER_DISCARD_PROBS = [0.09388, 0.06719, 0.04547, 0.04428, 0.00398, 0.06537,
                          0.0818, 0.08531, 0.08712, 0.09632, 0.0411, 0.11445, 0.17376]
```

Pattern sanity: dealers favor K/J/8/3 into their own crib and protect 10s;
defenders dump K (17%) / Q / 10 / A and **almost never a 5** (0.4%). Re-run with
`node engine/calibrate_split.js` (it reads/writes `engine/state.json` between
passes). NOTE: further passes are not worth it — they move displayed crib EV by
<0.05 pt. This was a deliberate stopping point.

**3-handed reuses these same distributions.** They were calibrated under 4-handed
self-play, but how players dump junk barely shifts with table size, so 3-handed
borrows them (the third crib slot is a uniform deck card anyway, not a throw). The
UI says so in the crib-model panel. Re-calibrating a separate 3-handed model is a
possible future step but low value.

## Reference: per-rank crib value ("crib swing")

Validation numbers from the model (avg crib pts when you contribute that rank).
The 5 dominates; everything else is connectedness. Use these to sanity-check any
engine change.

```
rank: A    2    3    4    5     6    7    8    9    10   J    Q    K
your: 3.96 3.95 4.05 4.06 6.38 4.10 4.21 4.34 4.09 3.74 4.19 3.73 3.85
their:4.13 4.28 4.37 4.28 6.52 4.32 4.45 4.46 4.26 3.99 4.41 4.02 4.03
```
The dealer's crib runs ~0.15 richer than yours for the same card, because it
collects the dealer's offensive "salt" throw plus your card, while your crib gets
your card + three defensive junk throws.

`engine/verify_players.js` reprints this table for both 4- and 3-handed and asserts
the 4-handed column still matches (tol 0.12). 3-handed runs ~0.1–0.2 richer across
the board because the deck card beats a defender's junk throw on average.

## Known limitations (be honest about these in the UI)

- **Pegging is an estimate, not a solve.** Greedy opponent policy; no lookahead.
  The relative ranking across holds is the trustworthy part, not the absolute pts.
- **Board mode is a risk heuristic, not win-probability.** It rewards/penalizes
  volatility (`±RISK·σ`) and stiffens crib defense; it does not model the race to
  121 or who is about to peg out beyond the simple `suggestMode` thresholds.
- **Opponent suit choice is uniform within rank.** Fine — the only thing it
  affects is the ~0.2%/~0.01-pt crib flush.

## How to verify the engine

```
node engine/pegging.js          # pegging unit tests + full-game sanity (dealer seat pegs most)
node engine/breakdown.js        # category breakdown reconciles to totals; perfect-29 check
node engine/calibrate_split.js  # one self-play calibration pass (mutates state.json)
node engine/verify_players.js   # 2-/3-/4-handed: regression (players=4 == original) + crib/peg sanity
```
If you change `scoreInto`, re-run breakdown/pegging tests AND re-check the crib
swing table above before trusting `analyze()`. If you touch `cribDetail`,
`pegDetail`, or `playPegging`, also run `verify_players.js` — it guarantees the
4-handed path is bit-for-bit unchanged and the 3-/2-handed paths stay sane.

## Running and deploying

**Run locally (already works):** open `index.html` in a browser. It is the whole
app, pre-compiled to plain JS (no Babel, no in-browser build). React/ReactDOM load
from a CDN. `src/CribbageTrainer.jsx` is the editable source.

**Rebuild after editing the source:** run `./build.sh` (needs a global `tsc`; one is
present in this environment). It transpiles the JSX → `React.createElement` with
`tsc --jsx react --target es2020 --removeComments`, swaps the ESM import/export for
CDN globals, and wraps it in the HTML shell — regenerating `index.html`
deterministically. The script was validated to reproduce the committed `index.html`
**byte-for-byte** from the source, so its output is trustworthy. Deploy = commit the
regenerated `index.html` (see below); never hand-edit `index.html`.

**Deploying is now SET UP — a live Cloudflare pipeline exists.** The app is published
via **Cloudflare Pages/Workers Git integration** connected to the GitHub repo
**`ghug/cribbage-trainer`** (a public repo on the human's secondary GitHub account,
used specifically for deploy because the primary account is private/locked and can't
authorize Cloudflare). Live URL: **`https://cribbage-trainer.gabrielhug.workers.dev`**.

**To ship a change:** edit `src/CribbageTrainer.jsx` → `./build.sh` → commit → push
to `main` on the `ghug/cribbage-trainer` remote. Cloudflare auto-builds and the live
URL updates in ~30s. No tokens, no manual upload. (Pushing requires a fine-grained
GitHub PAT for the `ghug` account scoped to that repo's Contents; the human pastes it
per session — it is not stored.) The canonical dev repo is still
`vanderoi/cribbage-trainer`; `ghug` is the deploy mirror. The exact deploy push (no
named remote; the PAT goes inline in the URL and must not be committed/logged):

```
git push "https://x-access-token:<GHUG_PAT>@github.com/ghug/cribbage-trainer.git" HEAD:main
```

Note: the sandbox network allowlist blocks `*.workers.dev` / `*.pages.dev`, so the
agent canNOT fetch the live URL to smoke-test it — ask the human to eyeball it.

Legacy fallback routes (only if the pipeline above is ever torn down): Cloudflare
Direct Upload (drag `index.html` in the dashboard), or the REST API with an
`Account → Cloudflare Pages → Edit` token + Account ID.

**ANDROID / TERMUX CAVEAT (important, learned the hard way):** `npm install -g
wrangler` FAILS on Android/Termux — Wrangler bundles `workerd`, a native binary
with no Android build (`Error: Unsupported platform: android arm64`). So on an
Android/Termux environment, do NOT use the Wrangler CLI. Use Direct Upload (route 1)
or the REST API (route 2), or run Wrangler only inside a real Linux arm64 userland
(e.g. `proot-distro` Debian), never bare Termux.

## Good next steps (roughly in value order)

0. **IN PROGRESS — playable game vs AI.** A full plan for a separate `play.html`
   (4-player cutthroat cribbage you play against 3 computer opponents, with `index.html`
   becoming a welcome page that links to the trainer and the game) is committed at
   **`docs/cribbage-play-plan.md`**. To resume: re-paste the `ghug` GitHub PAT (it is never
   stored — see deploy note above), check out branch `claude/claude-md-review-m77h8q`, and
   build per that plan. Reachability caveat: the sandbox can only `curl` the live URL if
   `*.gabrielhug.workers.dev` is added under the environment's Network access (Custom).
1. Decide with the human whether they even want hosting — it already runs locally.
2. If hosting: Cloudflare Pages Direct Upload (route 1 above) is the lowest-effort.
3. Add an in-repo test runner (port the `engine/` checks to a `test/` dir, e.g.
   vitest) so changes are guarded.
4. Stronger pegging: shallow expectiminimax or a learned policy instead of greedy.
5. Real win-probability board model (game-to-121 race) to replace the σ heuristic.
6. Exploit-mode: let the user enter observed opponent tendencies and re-weight the
   crib distributions away from the self-play equilibrium.

## Style / working preferences carried over from the original session

- Rigor first: verify scoring changes numerically before wiring into the UI.
- When showing rank tables, show **all 13 ranks A–K**, never a partial list.
- Be upfront about model limitations rather than overstating precision.
