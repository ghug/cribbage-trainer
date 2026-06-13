#!/usr/bin/env node
/* Verifies the Discard Trainer's player-count and team handling (trainer.html) without
 * a browser. `analyze(hand, scenario, mode, players, teams, N, Npeg)` is a top-level
 * function in the compiled <script>; scenario = { youDeal, cribIsOurs }. We eval it in
 * a vm sandbox and check:
 *   - 2-handed ranks 15 two-card throws; 3-/4-/5-/6-handed rank the 5 single throws.
 *   - hand EV is players-independent (same kept four → same EV at every P).
 *   - 5-/6-handed (solo) defend cribs are leaner than 4-handed (no dealer salt).
 *   - TEAM crib composition: each other crib card is a DEALER-intent throw if its
 *     thrower is on the dealer's team, else DEFENDER junk. More dealer-intent throws →
 *     richer crib. So at 4/2 and 6/2 the opponents' crib (2 dealer + 1 def) beats your
 *     side's (1 dealer + 2 def); at 6/3, opponents' (1 dealer) beats yours (0 dealer).
 *   - the crib SIGN flips with cribIsOurs (added to your side vs subtracted).
 * analyze seeds its RNG from the hand, so every comparison below is exact, not noisy.
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
const sc = (youDeal, cribIsOurs) => ({ youDeal, cribIsOurs });

const hand6 = [{ r: 5, s: 0 }, { r: 5, s: 1 }, { r: 7, s: 2 }, { r: 8, s: 3 }, { r: 10, s: 0 }, { r: 11, s: 1 }];
const hand5 = [{ r: 5, s: 0 }, { r: 5, s: 1 }, { r: 6, s: 2 }, { r: 9, s: 3 }, { r: 11, s: 0 }];

/* ---- 2-handed: deal 6, throw two -> 15 ranked combos ---- */
{
  const opts = analyze(hand6, sc(false, false), "ev", 2, 2, 4000, 400);
  check(opts.length === 15, `2-handed ranks 15 two-card throws (got ${opts.length})`);
  check(opts.every((o) => o.cards.length === 2 && Number.isFinite(o.netEV)), "2-handed throws are two finite cards");
}

/* ---- 3-/4-/5-/6-handed cutthroat defend: deal 5, throw one -> 5 ranked throws ---- */
const cribEV = {}, handEV = {};
for (const P of [3, 4, 5, 6]) {
  const opts = analyze(hand5, sc(false, false), "ev", P, P, 8000, 400);
  check(opts.length === 5 && opts.every((o) => o.cards.length === 1), `P=${P}: ranks 5 single throws`);
  check(opts.every((o) => Number.isFinite(o.netEV) && Number.isFinite(o.cribEV) && o.hand.ev >= 0), `P=${P}: options finite`);
  cribEV[P] = opts[0].cribEV;
  handEV[P] = opts[0].handEV;
}
for (const P of [4, 5, 6]) check(Math.abs(handEV[P] - handEV[3]) < 1e-9, `P=${P}: hand EV is players-independent`);
check(cribEV[5] < cribEV[4], `5-handed defend crib leaner than 4-handed (${cribEV[5].toFixed(3)} < ${cribEV[4].toFixed(3)})`);
check(cribEV[6] < cribEV[4], `6-handed defend crib leaner than 4-handed (${cribEV[6].toFixed(3)} < ${cribEV[4].toFixed(3)})`);

/* ---- team crib composition (more dealer-intent throws → richer crib) ---- */
const tcrib = (P, T, ours) => analyze(hand5, sc(false, ours), "ev", P, T, 9000, 400)[0].cribEV;
{
  const o42 = tcrib(4, 2, true), t42 = tcrib(4, 2, false);   // ours 1 dealer+2 def · theirs 2 dealer+1 def
  const o62 = tcrib(6, 2, true), t62 = tcrib(6, 2, false);   // ours 1 dealer+2 def · theirs 2 dealer+1 def
  const o63 = tcrib(6, 3, true), t63 = tcrib(6, 3, false);   // ours 0 dealer+3 def · theirs 1 dealer+2 def
  check(t42 > o42, `4/2: opponents' crib richer than your side's (${t42.toFixed(3)} > ${o42.toFixed(3)})`);
  check(t62 > o62, `6/2: opponents' crib richer than your side's (${t62.toFixed(3)} > ${o62.toFixed(3)})`);
  check(t63 > o63, `6/3: opponents' crib richer than your side's (${t63.toFixed(3)} > ${o63.toFixed(3)})`);
  check(o63 < cribEV[4], `6/3 your-side crib (0 salt) leaner than 4-handed defend (${o63.toFixed(3)} < ${cribEV[4].toFixed(3)})`);
  // every team config yields 5 finite single throws
  for (const [P, T] of [[4, 2], [6, 2], [6, 3]]) for (const ours of [true, false]) {
    const opts = analyze(hand5, sc(false, ours), "ev", P, T, 2000, 200);
    check(opts.length === 5 && opts.every((o) => o.cards.length === 1 && Number.isFinite(o.netEV)), `${P}/${T} ${ours ? "ours" : "theirs"}: 5 finite throws`);
  }
}

/* ---- the crib SIGN flips with cribIsOurs (same kept four scores higher net when
        the crib is on your team, since the crib value is added rather than subtracted) ---- */
{
  const oursOpts = analyze(hand5, sc(false, true), "ev", 4, 2, 9000, 400);
  const theirsOpts = analyze(hand5, sc(false, false), "ev", 4, 2, 9000, 400);
  const id = oursOpts[0].id;                         // compare the same throw both ways
  const a = oursOpts.find((o) => o.id === id);
  const b = theirsOpts.find((o) => o.id === id);
  check(a.netEV > b.netEV, `same throw nets more when the crib is yours (${a.netEV.toFixed(3)} > ${b.netEV.toFixed(3)})`);
}

console.log(`\ntrainer.html discard checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
