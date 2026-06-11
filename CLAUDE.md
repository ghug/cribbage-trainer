# CLAUDE.md — Cutthroat Cribbage Discard Trainer

> Read this first. It is the full context for the project. It was handed off from a
> claude.ai chat session; treat it as the source of truth and update it as you work.

## START HERE (plain version)

You already have a finished, working app. It's the file **`index.html`** in this
folder — fully self-contained (no build, no install, no internet needed beyond a
CDN for React). **To just use it: open `index.html` in any browser.** That's it.

Nothing is hosted or "deployed" yet, and you don't need to host it to use it.
Putting it on a public link is an *optional* extra (see Deployment below) that you
can do later or never. Don't let deployment block anything — the app works now.

If you're a Claude Code session picking this up: the human's open question is
"what do I do with this?" Reasonable answers are (a) nothing — it already runs
locally; (b) publish it for a shareable link; (c) keep improving it (see Good next
steps). Ask which they want before assuming deployment.

## What this is

An interactive React trainer for practicing **optimal discarding in 4-player
"cutthroat" cribbage** (every player for themselves). It deals a hand, lets the
user pick a card to throw, then reveals a ranked, fully-explained analysis of all
five possible discards.

The whole app is a single component: `src/CribbageTrainer.jsx` (inline styles,
cribbage-board aesthetic, no dependencies beyond React). The `engine/` folder
holds the Node verification scripts the engine was validated against — they are
not imported by the app, but they document and re-prove the math.

## Game rules being modeled (important — not 2-player cribbage)

- 4 players, each dealt **5 cards**, each discards **exactly one** to the crib.
- The crib therefore holds **4 cards = one from each player**, scored with the
  starter as a 5-card hand.
- The **dealer owns the crib**. You deal 1 of every 4 hands; the other 3 you are a
  non-dealer ("defender") throwing into someone else's crib.
- Standard show scoring: fifteens, pairs, runs (with duplicates), flush (4-card
  flush counts in the **hand** only; the crib needs all 5 same suit), nobs.

## Architecture / data flow

`analyze(hand5, role, mode, N=10000, Npeg=700)` is the core. For each of the 5
possible discards it computes three components and two roll-ups:

1. **Hand EV — exact.** `handDetail(four, dealt5)` enumerates all 47 possible cut
   cards and averages the kept-four score. Returns `ev, sd, min, max, p10, p90`,
   category breakdown, `locked` (guaranteed pre-cut) and top-3 best cuts. No
   estimation here — flush upgrades, nobs, everything falls out of enumeration.
2. **Crib EV — Monte Carlo (N=10,000).** `cribDetail(...)` samples opponents'
   crib cards by an empirical **role-split rank distribution** (suits uniform
   within rank; starter uniform). Composition:
   - you **deal** → your crib = your card + **3 defender** throws.
   - you **defend** → dealer's crib = your card + **1 dealer** throw + **2
     defender** throws.
3. **Pegging EV — Monte Carlo (N=700).** `pegDetail(...)` simulates 4-handed play.
   Your seat = dealer (seat 3, plays last = best peg seat) when dealing, else a
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
```
If you change `scoreInto`, re-run breakdown/pegging tests AND re-check the crib
swing table above before trusting `analyze()`.

## Running and deploying

**Run locally (already works):** open `index.html` in a browser. It is the whole
app, pre-compiled to plain JS (no Babel, no build step). React/ReactDOM load from a
CDN. `src/CribbageTrainer.jsx` is the editable source; if you change it, re-compile
to refresh `index.html` (JSX → JS, e.g. via esbuild or `tsc`/TypeScript transpile).

**Deploying for a public link is OPTIONAL and nothing is set up yet.** No hosting
account, no Cloudflare token, no Git remote exists. Don't assume any of these are
ready. If/when the human wants a public URL, ranked by least setup:

1. **Cloudflare Pages — Direct Upload (no CLI, no Git, all in the browser).**
   dash.cloudflare.com → Workers & Pages → Create → Pages → **Upload assets** →
   name it → drag in `index.html` → Deploy. Lands at `<name>.pages.dev`, public by
   link. Updates: project → Deployments → Create deployment → re-upload. Requires a
   (free) Cloudflare account, which the human does NOT yet have.
2. **Cloudflare Pages — REST API via curl** (scriptable, no Wrangler/workerd).
   Needs an API token (Account → Cloudflare Pages → Edit) + Account ID. Good if an
   agent should deploy non-interactively.
3. **GitHub Pages** if a usable account/repo exists. NOTE from the original session:
   the human's GitHub is on an account that can't be used for this, so this route
   was effectively blocked. Re-confirm before relying on it.

**ANDROID / TERMUX CAVEAT (important, learned the hard way):** `npm install -g
wrangler` FAILS on Android/Termux — Wrangler bundles `workerd`, a native binary
with no Android build (`Error: Unsupported platform: android arm64`). So on an
Android/Termux environment, do NOT use the Wrangler CLI. Use Direct Upload (route 1)
or the REST API (route 2), or run Wrangler only inside a real Linux arm64 userland
(e.g. `proot-distro` Debian), never bare Termux.

## Good next steps (roughly in value order)

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
