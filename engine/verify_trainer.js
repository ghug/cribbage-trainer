#!/usr/bin/env node
/* Verifies the Discard Trainer's player-count handling (trainer.html) without a
 * browser. `analyze` is a top-level function in the compiled <script>; we eval it in
 * a vm sandbox (React/ReactDOM stubbed) and check the discard ranking at every table
 * size the global "Players" setting can pick (2..6):
 *   - 2-handed: dealt 6, rank all 15 two-card throws.
 *   - 3-/4-/5-/6-handed: dealt 5, rank the 5 single throws.
 *   - hand EV is players-independent (same kept four → same EV at every P).
 *   - 5-/6-handed defend cribs are leaner than 4-handed (the dealer is dealt 4 and
 *     throws none, so the crib has no dealer "salt" — analyze is deterministic per
 *     hand, so this is an exact comparison, not a noisy one).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "trainer.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const sandbox = {
  React: { createElement: () => ({}), useState: () => [0, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: () => ({ current: null }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null },
  Math, console,
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const { analyze } = sandbox;

// Deterministic hands (analyze seeds its RNG from the hand, so results are stable).
const hand6 = [{ r: 5, s: 0 }, { r: 5, s: 1 }, { r: 7, s: 2 }, { r: 8, s: 3 }, { r: 10, s: 0 }, { r: 11, s: 1 }];
const hand5 = [{ r: 5, s: 0 }, { r: 5, s: 1 }, { r: 6, s: 2 }, { r: 9, s: 3 }, { r: 11, s: 0 }];

/* ---- 2-handed: deal 6, throw two -> 15 ranked combos ---- */
{
  const opts = analyze(hand6, "defend", "ev", 2, 4000, 400);
  check(opts.length === 15, `2-handed ranks 15 two-card throws (got ${opts.length})`);
  check(opts.every((o) => o.cards.length === 2), "2-handed throws are two cards");
  check(opts.every((o) => Number.isFinite(o.netEV) && o.hand.ev >= 0), "2-handed options are finite");
}

/* ---- 3-/4-/5-/6-handed: deal 5, throw one -> 5 ranked throws ---- */
const cribEV = {};
const handEV = {};
for (const P of [3, 4, 5, 6]) {
  const opts = analyze(hand5, "defend", "ev", P, 8000, 400);
  check(opts.length === 5, `P=${P}: ranks 5 single throws (got ${opts.length})`);
  check(opts.every((o) => o.cards.length === 1), `P=${P}: throws are one card`);
  check(opts.every((o) => Number.isFinite(o.netEV) && Number.isFinite(o.cribEV) && o.hand.ev >= 0), `P=${P}: options are finite`);
  // record the best throw's components for cross-P comparison
  cribEV[P] = opts[0].cribEV;
  handEV[P] = opts[0].handEV;
}

/* ---- hand EV is players-independent ---- */
for (const P of [4, 5, 6]) check(Math.abs(handEV[P] - handEV[3]) < 1e-9, `P=${P}: hand EV matches the 3-handed value (players-independent)`);

/* ---- 5-/6-handed defend cribs are leaner than 4-handed (no dealer salt) ---- */
check(cribEV[5] < cribEV[4], `5-handed defend crib is leaner than 4-handed (${cribEV[5].toFixed(3)} < ${cribEV[4].toFixed(3)})`);
check(cribEV[6] < cribEV[4], `6-handed defend crib is leaner than 4-handed (${cribEV[6].toFixed(3)} < ${cribEV[4].toFixed(3)})`);

console.log(`\ntrainer.html discard checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
