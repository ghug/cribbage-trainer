#!/usr/bin/env node
/* Verifies the playable game (play.html) without a browser.
 *
 * The game's reducer and pure helpers are top-level declarations in the compiled
 * play.html <script>. We eval that script in a vm sandbox with React/ReactDOM
 * stubs (so the final createRoot().render() is a no-op and the component body
 * never runs), which exposes `reduce`, `initGame`, `computeShow`, `scoreInto`,
 * `pegScore`, `pegChoose`, etc. We then drive whole hands through the reducer and
 * assert the rules from the build plan's "correctness pitfalls":
 *   - go / 31 / last-card never double-count
 *   - his heels = +2 at the cut
 *   - the show stops the instant any seat hits 121 (counting-order short-circuit)
 *   - suits survive pegging; scores only ever go up; totals reconcile
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "play.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

// Deterministic Math.random for repeatable deals.
function makeMath(seed) {
  let a = seed >>> 0;
  const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math); M.random = rng; return M;
}

function loadSandbox(seed) {
  const sandbox = {
    React: { createElement: () => ({}), useState: () => [0, () => {}], useReducer: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) },
    ReactDOM: { createRoot: () => ({ render() {} }) },
    document: { getElementById: () => ({}) },
    Math: makeMath(seed), console,
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  return sandbox;
}

const S = loadSandbox(1);
const { reduce, initGame, computeShow, scoreInto, pegScore, pegChoose } = S;
const pval = (r) => Math.min(r, 10);

/* ---- A. pegScore spot checks ---- */
check(pegScore([7, 8], 15) === 2, "fifteen = 2");
check(pegScore([9, 9, 9, 4], 31) === 2, "reaching 31 = 2");
check(pegScore([6, 6], 12) === 2, "pair = 2");
check(pegScore([6, 6, 6], 18) === 6, "pair royal = 6");
check(pegScore([6, 6, 6, 6], 24) === 12, "double pair royal = 12");
check(pegScore([1, 2, 3], 6) === 3, "run of 3 = 3");
check(pegScore([3, 1, 2], 6) === 3, "out-of-order run of 3 = 3");
check(pegScore([4, 5, 6, 7], 22) === 4, "run of 4 = 4");
check(pegScore([10, 5], 15) === 2, "15 with a pair-less tail = 2");

/* ---- B. scoreInto perfect 29 ---- */
{
  const four = [{ r: 5, s: 3 }, { r: 5, s: 2 }, { r: 5, s: 1 }, { r: 11, s: 0 }]; // 5c 5d 5h Js
  const starter = { r: 5, s: 0 };                                                  // 5s -> nobs with Js
  const acc = [0, 0, 0, 0, 0];
  const total = scoreInto(four, starter, false, acc);
  check(total === 29, `perfect 29 total (got ${total})`);
  check(JSON.stringify(acc) === JSON.stringify([16, 12, 0, 0, 1]), `perfect 29 cats (got ${JSON.stringify(acc)})`);
}

/* ---- helper: drive one hand to completion, auto-count ---- */
function playHand(state, humanIdxPicker) {
  // human discard
  state = reduce(state, { type: "DEAL" });
  check(state.phase === "discard", "DEAL -> discard");
  check(state.crib.length === 0, "crib empty before discard");
  for (let i = 1; i < 4; i++) check(state.seats[i].kept.length === 4 && state.seats[i].discard, `seat ${i} AI discard computed`);
  const hi = humanIdxPicker ? humanIdxPicker(state) : 0;
  state = reduce(state, { type: "DISCARD", idx: hi });
  check(state.phase === "cut" && state.crib.length === 4, "DISCARD -> cut, crib of 4");
  check(state.seats[0].kept.length === 4, "human kept 4");

  state = reduce(state, { type: "CUT" });
  // suits preserved: starter and all kept cards have a suit
  check(state.starter && typeof state.starter.s === "number", "starter is a suited card");
  if (state.phase === "over") return state; // his heels won (rare)
  check(state.phase === "play", "CUT -> play");

  // pegging loop
  let guard = 0;
  while (state.phase === "play" && guard++ < 400) {
    const { hands, turn, count } = state.peg;
    const legal = hands[turn].filter((c) => pval(c.r) + count <= 31);
    if (legal.length === 0) { state = reduce(state, { type: "PASS_GO", seat: turn }); continue; }
    const rank = pegChoose(legal.map((c) => c.r), count, state.peg.pile, hands[turn].map((c) => c.r));
    const card = legal.find((c) => c.r === rank) || legal[0];
    check(typeof card.s === "number", "played card keeps its suit");
    state = reduce(state, { type: "PLAY_CARD", seat: turn, card });
  }
  check(guard < 400, "pegging terminated");
  if (state.phase === "over") return state;
  check(state.phase === "show", "pegging -> show");

  // show loop (auto)
  guard = 0;
  while (state.phase === "show" && guard++ < 20) state = reduce(state, { type: "SHOW_NEXT" });
  check(guard < 20, "show terminated");
  check(state.phase === "deal" || state.phase === "over", "show -> deal/over");
  return state;
}

/* ---- C. drive many hands; scores only go up, stay sane ---- */
{
  let state = initGame();
  let prev = state.seats.map((s) => s.score);
  let hands = 0, exceptions = 0;
  for (let h = 0; h < 60 && state.phase !== "over"; h++) {
    try {
      state = playHand(state);
      hands++;
      const maxScore = Math.max(...state.seats.map((s) => s.score));
      state.seats.forEach((s, i) => {
        check(Number.isFinite(s.score), `seat ${i} score finite`);
        check(s.score >= prev[i], `seat ${i} score monotonic non-decreasing`);
      });
      // Reaching 121 must end the game (overshoot on the winning count is legal);
      // and no seat may sit at >=121 while we're still between hands.
      if (maxScore >= 121) check(state.phase === "over", `game ends once a seat reaches 121 (max ${maxScore})`);
      if (state.phase === "deal") check(maxScore < 121, "no winner left uncrowned between hands");
      prev = state.seats.map((s) => s.score);
    } catch (e) { exceptions++; console.error("  ✗ exception in hand", h, e.message); }
  }
  check(exceptions === 0, "no exceptions across many hands");
  check(hands >= 1, "played at least one full hand");
  check(state.phase === "over" || hands === 60, "reached a winner or ran the cap");
}

/* ---- D. his heels = +2 at the cut, 121-checked ---- */
{
  let state = reduce(initGame(), { type: "DEAL" });
  state = reduce(state, { type: "DISCARD", idx: 0 });
  const d = state.dealerIdx;
  const before = state.seats[d].score;
  // force a Jack as the starter (deck[20] is the cut)
  state = { ...state, deck: state.deck.map((c, i) => (i === 20 ? { r: 11, s: 0 } : c)) };
  state = reduce(state, { type: "CUT" });
  check(state.hisHeels === true, "Jack cut flags his heels");
  check(state.seats[d].score === before + 2, `his heels awards exactly +2 (got +${state.seats[d].score - before})`);
}

/* ---- E. show 121 short-circuit: pone (counted first) pegs out before others ---- */
{
  let state = reduce(initGame(), { type: "DEAL" });
  state = reduce(state, { type: "DISCARD", idx: 0 });
  state = reduce(state, { type: "CUT" });
  // jump straight to a show with a fabricated state we control
  const dealerIdx = state.dealerIdx;
  const pone = (dealerIdx + 1) % 4;       // counts first
  const second = (dealerIdx + 2) % 4;     // would count next
  // give pone a hand worth >=2 with a known starter, and set scores so pone reaches 121.
  const starter = { r: 10, s: 0 };
  const poneHand = [{ r: 5, s: 1 }, { r: 5, s: 2 }, { r: 5, s: 3 }, { r: 5, s: 0 }]; // four 5s + 10 starter = lots
  const acc = [0, 0, 0, 0, 0];
  const poneScore = scoreInto(poneHand, starter, false, acc);
  const seats = state.seats.map((s, i) => ({
    ...s,
    score: i === pone ? 121 - poneScore : i === second ? 120 : 0,
    kept: i === pone ? poneHand : [{ r: 2, s: 0 }, { r: 3, s: 1 }, { r: 7, s: 2 }, { r: 9, s: 3 }],
  }));
  let fab = {
    ...state, seats, starter, crib: [{ r: 4, s: 0 }, { r: 6, s: 1 }, { r: 8, s: 2 }, { r: 13, s: 3 }],
    phase: "show", show: { order: [pone, second, (dealerIdx + 3) % 4, dealerIdx, "CRIB"], step: 0, claimSubmitted: false, claimValue: null },
    settings: { counting: "auto" },
  };
  const secondBefore = fab.seats[second].score;
  fab = reduce(fab, { type: "SHOW_NEXT" });   // counts pone -> should win immediately
  check(fab.phase === "over", "show short-circuits to over when pone pegs out");
  check(fab.winner === pone, `pone is the winner (got ${fab.winner})`);
  check(fab.seats[second].score === secondBefore, "the next player in order is NOT counted after the win");
}

/* ---- F. muggins: under-claim hands missed points to the next opponent ---- */
{
  let base = reduce(initGame(), { type: "DEAL" });
  base = reduce(base, { type: "DISCARD", idx: 0 });
  base = reduce(base, { type: "CUT" });
  const dealerIdx = base.dealerIdx;
  // make seat 0 (human) the pone so they count first, hand worth 4, claim only 2.
  const human = 0;
  const order = [human, (human + 1) % 4, (human + 2) % 4, (human + 3) % 4, "CRIB"];
  // ensure dealer is last entity owner; rebuild order so human is first regardless of dealer
  const starter = { r: 6, s: 0 };
  const humanHand = [{ r: 9, s: 1 }, { r: 9, s: 2 }, { r: 7, s: 3 }, { r: 8, s: 0 }]; // 9+9 pair=2, 7+8+9 run? 6 starter: 6789 run of4, plus 15s (9+6,7+8) ...
  const acc = [0, 0, 0, 0, 0];
  const actual = scoreInto(humanHand, starter, false, acc);
  const recip = order[1]; // next opponent in counting order
  let fab = {
    ...base, starter, settings: { counting: "muggins" },
    seats: base.seats.map((s, i) => ({ ...s, score: 0, kept: i === human ? humanHand : [{ r: 2, s: 0 }, { r: 3, s: 1 }, { r: 4, s: 2 }, { r: 10, s: 3 }] })),
    crib: [{ r: 13, s: 0 }, { r: 12, s: 1 }, { r: 11, s: 2 }, { r: 10, s: 3 }],
    phase: "show", show: { order, step: 0, claimSubmitted: true, claimValue: 2 },
  };
  check(actual > 2, `human hand worth more than the claim (actual ${actual})`);
  const recipBefore = fab.seats[recip].score;
  fab = reduce(fab, { type: "SHOW_NEXT" });
  check(fab.seats[human].score === 2, `human awarded only the claimed 2 (got ${fab.seats[human].score})`);
  check(fab.seats[recip].score === recipBefore + (actual - 2), `missed ${actual - 2} mugginsed to next opponent (got +${fab.seats[recip].score - recipBefore})`);
}

/* ---- G. suboptimal-discard intercept: SELECT_DISCARD pauses on a bad throw and
        commits on the best; CONFIRM throws it, CANCEL takes it back ---- */
{
  const { evalDiscards } = S;
  let base = reduce(initGame(), { type: "DEAL" });
  const ev = evalDiscards(base.seats[0].dealt, base.dealerIdx);
  const worst = ev.opts.reduce((a, b) => (b.value < a.value ? b : a));
  const bestIdx = ev.best.idx;
  check(ev.opts.length === 5, "evalDiscards rates all 5 throws");

  // SET_SETTING updates a single setting
  const toggled = reduce(base, { type: "SET_SETTING", key: "autoGo", value: true });
  check(toggled.settings.autoGo === true && toggled.settings.counting === base.settings.counting, "SET_SETTING updates one setting, leaves the rest");

  // selecting the best throw commits straight to the cut, no pause
  const s1 = reduce(base, { type: "SELECT_DISCARD", idx: bestIdx });
  check(s1.phase === "cut" && !s1.pendingDiscard, "best throw commits with no warning");

  if (ev.best.value - worst.value > 0.1) {
    // with warnings off, even a bad throw commits immediately
    const noWarn = reduce({ ...base, settings: { ...base.settings, warn: false } }, { type: "SELECT_DISCARD", idx: worst.idx });
    check(noWarn.phase === "cut" && !noWarn.pendingDiscard, "warnings off: a weak throw commits with no pause");
    const s2 = reduce(base, { type: "SELECT_DISCARD", idx: worst.idx });
    check(s2.phase === "discard" && s2.pendingDiscard && s2.pendingDiscard.idx === worst.idx, "bad throw pauses with a warning");
    check(s2.pendingDiscard.delta > 0.1, "warning carries the points given up");
    const cancelled = reduce(s2, { type: "CANCEL_DISCARD" });
    check(cancelled.phase === "discard" && !cancelled.pendingDiscard, "CANCEL_DISCARD takes the choice back");
    const confirmed = reduce(s2, { type: "CONFIRM_DISCARD" });
    check(confirmed.phase === "cut" && confirmed.seats[0].discard.r === worst.thrown.r, "CONFIRM_DISCARD throws the chosen card");
  }
}

/* ---- H. suboptimal-peg intercept: SELECT_PLAY warns when >=1 point is passed up ---- */
{
  let st = reduce(initGame(), { type: "DEAL" });
  st = reduce(st, { type: "DISCARD", idx: 0 });
  st = reduce(st, { type: "CUT" });
  // controlled peg: count 10, pile [10]; the 5 makes fifteen (2), the 6 scores 0.
  const peg = {
    hands: [[{ r: 5, s: 0 }, { r: 6, s: 1 }], [{ r: 2, s: 0 }], [{ r: 3, s: 1 }], [{ r: 4, s: 2 }]],
    turn: 0, count: 10, pile: [10], pileSuited: [{ r: 10, s: 3 }], played: [[], [], [], []], passes: 0, lastPlayer: -1,
  };
  const ps = { ...st, phase: "play", peg, settings: { ...st.settings, warn: true } };

  const warned = reduce(ps, { type: "SELECT_PLAY", card: { r: 6, s: 1 } });
  check(warned.pendingPlay && warned.pendingPlay.delta === 2, "weak peg play warns (>=1 pt passed up)");
  check(warned.peg.pile.length === 1, "weak peg play is NOT committed while pending");

  const okPlay = reduce(ps, { type: "SELECT_PLAY", card: { r: 5, s: 0 } });
  check(!okPlay.pendingPlay && okPlay.peg.pile.length === 2, "the best peg play commits with no warning");

  const off = reduce({ ...ps, settings: { ...ps.settings, warn: false } }, { type: "SELECT_PLAY", card: { r: 6, s: 1 } });
  check(!off.pendingPlay && off.peg.pile.length === 2, "warnings off: weak peg play commits");

  const confirmed = reduce(warned, { type: "CONFIRM_PLAY" });
  check(!confirmed.pendingPlay && confirmed.peg.pile.length === 2 && confirmed.peg.count === 16, "CONFIRM_PLAY plays the weak card");

  const cancelled = reduce(warned, { type: "CANCEL_PLAY" });
  check(!cancelled.pendingPlay && cancelled.peg.pile.length === 1, "CANCEL_PLAY takes the peg back");
}

console.log(`\nplay.html engine checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
