#!/usr/bin/env node
/* Verifies the two-player pass-and-play page (passplay.html). Both seats are human, so
 * unlike the bot game we can drive the *reducer* directly through whole games (deal →
 * private discards → cut → pegging with go/31/last-card → the show → next hand → 121).
 * The privacy "pass the device" gate is pure UI (a holder/turn check), so it isn't
 * exercised here; this locks down the scoring/flow reducer.
 *
 * We eval the compiled <script> in a vm sandbox (seeded Math for determinism) and assert
 * per move: scores are monotonic and never pass 121 except at the win; the show awards
 * each match scoreInto; every game reaches a winner with >= 121.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "passplay.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (c, m) => { if (c) ok++; else { fail++; console.error("  ✗ " + m); } };

function makeMath(seed) {
  let a = seed >>> 0;
  const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math); M.random = rng; return M;
}
function load(seed) {
  const sandbox = {
    React: { createElement: () => ({}), useReducer: () => [null, () => {}], useState: () => [null, () => {}], useEffect: () => {} },
    ReactDOM: { createRoot: () => ({ render() {} }) },
    document: { getElementById: () => ({}) }, window: { location: {} },
    Math: makeMath(seed), console, Date,
  };
  vm.createContext(sandbox); vm.runInContext(body, sandbox);
  return sandbox;
}

const pvalT = (r) => Math.min(r, 10);

function playOneGame(seed) {
  const S = load(seed);
  const { reduce, initGame, scoreInto } = S;
  let s = initGame();
  check(s.phase === "start", `seed ${seed}: starts in 'start'`);
  s = reduce(s, { type: "DEAL" });
  let guard = 0, hands = 0, prev = [0, 0];
  while (s.phase !== "over" && guard++ < 8000) {
    if (s.phase === "discard") {
      s = reduce(s, { type: "DISCARD", idxs: [0, 1] });
    } else if (s.phase === "cut") {
      s = reduce(s, { type: "CUT" });
    } else if (s.phase === "play") {
      const h = s.hands[s.turn];
      if (h.length === 0) s = reduce(s, { type: "GO" });
      else {
        const legal = h.filter((c) => pvalT(c.r) + s.peg.count <= 31);
        s = legal.length ? reduce(s, { type: "PLAY", card: legal[0] }) : reduce(s, { type: "GO" });
      }
    } else if (s.phase === "show") {
      // each revealed show item's pts must equal a fresh scoreInto of those 4 + starter
      const it = s.show.items[s.show.step];
      const acc = [0, 0, 0, 0, 0];
      const expect = scoreInto(it.four, s.starter, it.isCrib, acc);
      check(expect === it.pts, `seed ${seed}: show item pts == scoreInto (${it.pts} vs ${expect})`);
      s = reduce(s, { type: "SHOW_NEXT" });
      if (s.phase === "discard") hands++;
    } else break;
    check(s.scores[0] >= prev[0] && s.scores[1] >= prev[1], `seed ${seed}: scores monotonic`);
    check(s.phase === "over" || (s.scores[0] < 121 && s.scores[1] < 121), `seed ${seed}: no score crosses 121 before the win`);
    if (s.phase === "discard" || s.phase === "show") prev = s.scores.slice();
  }
  check(s.phase === "over", `seed ${seed}: game reaches a winner (phase ${s.phase})`);
  check(s.winner === 0 || s.winner === 1, `seed ${seed}: winner is a seat`);
  check(s.scores[s.winner] >= 121, `seed ${seed}: winner has >= 121 (${s.scores[s.winner]})`);
  check(hands >= 1, `seed ${seed}: played at least one full hand`);
}

for (const seed of [1, 7, 42, 99, 2024, 31337]) playOneGame(seed);

console.log(`\npassplay.html reducer checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
