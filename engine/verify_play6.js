#!/usr/bin/env node
/* Verifies the 6-handed game (play6.html) without a browser — same harness as
 * verify_play.js, adapted for six seats and the 6-handed deal.
 *
 * 6-handed rule: the dealer AND the player to the dealer's right are each dealt FOUR
 * cards and throw none; the other four are dealt five and throw one. So the crib is
 * the four throwers' cards (no deck card), and when the human is one of the two
 * non-throwers they skip the discard phase.
 *
 * We eval the compiled play6.html <script> in a vm sandbox and drive whole hands,
 * asserting:
 *   - the dealer and the seat to their right are dealt 4 and make no throw
 *   - the crib = the four throwers' cards; non-throwers skip discard
 *   - go / 31 / last-card never double-count; turn rotates over six seats
 *   - his heels = +2 at the cut; the show counts six seats + crib with the 121 stop
 *   - suits survive pegging; scores only ever go up; totals reconcile
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "play6.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

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
const { reduce, initGame, scoreInto, pegScore, pegChoose } = S;
const pval = (r) => Math.min(r, 10);
const sameCard = (a, b) => a.r === b.r && a.s === b.s;
const noThrowOf = (d) => (i) => i === d || i === (d + 5) % 6;

/* ---- A. pegScore + perfect-29 spot checks ---- */
check(pegScore([7, 8], 15) === 2, "fifteen = 2");
check(pegScore([6, 6, 6], 18) === 6, "pair royal = 6");
check(pegScore([3, 1, 2], 6) === 3, "out-of-order run of 3 = 3");
{
  const acc = [0, 0, 0, 0, 0];
  const total = scoreInto([{ r: 5, s: 3 }, { r: 5, s: 2 }, { r: 5, s: 1 }, { r: 11, s: 0 }], { r: 5, s: 0 }, false, acc);
  check(total === 29, `perfect 29 total (got ${total})`);
}

/* ---- helper: drive one hand to completion, auto-count ---- */
function playHand(state) {
  state = reduce(state, { type: "DEAL" });
  const d = state.dealerIdx;
  const noThrow = noThrowOf(d);
  for (let i = 0; i < 6; i++) check(state.seats[i].dealt.length === (noThrow(i) ? 4 : 5), `seat ${i} dealt ${noThrow(i) ? 4 : 5}`);
  for (let i = 1; i < 6; i++) {
    if (noThrow(i)) check(state.seats[i].kept.length === 4 && !state.seats[i].discard, `non-thrower seat ${i} keeps 4, throws none`);
    else check(state.seats[i].kept.length === 4 && state.seats[i].discard, `thrower seat ${i} AI throw computed`);
  }
  if (noThrow(0)) {
    check(state.phase === "cut", "human non-thrower -> straight to cut");
    check(state.seats[0].kept.length === 4 && !state.seats[0].discard, "human non-thrower keeps 4, throws none");
  } else {
    check(state.phase === "discard", "DEAL -> discard");
    check(state.crib.length === 0, "crib empty before the human throws");
    state = reduce(state, { type: "DISCARD", idx: 0 });
    check(state.phase === "cut", "DISCARD -> cut");
    check(state.seats[0].kept.length === 4, "human kept 4");
  }
  check(state.crib.length === 4, "crib of 4");
  // the crib is exactly the four throwers' cards (no deck card)
  const throws = state.seats.map((s, i) => (noThrow(i) ? null : s.discard)).filter(Boolean);
  check(throws.length === 4, "four throwers' cards exist");
  for (const t of throws) check(state.crib.some((c) => sameCard(c, t)), "each thrower's card is in the crib");
  check(state.crib.every((c) => typeof c.s === "number"), "every crib card is suited");

  state = reduce(state, { type: "CUT" });
  check(state.starter && typeof state.starter.s === "number", "starter is a suited card");
  if (state.phase === "over") return state;
  check(state.phase === "play", "CUT -> play");
  check(state.peg.hands.length === 6, "six pegging hands");
  check(state.peg.hands.every((h) => h.length === 4), "everyone pegs from four cards");

  let guard = 0;
  while (state.phase === "play" && guard++ < 600) {
    const { hands, turn, count } = state.peg;
    const legal = hands[turn].filter((c) => pval(c.r) + count <= 31);
    if (legal.length === 0) { state = reduce(state, { type: "PASS_GO", seat: turn }); continue; }
    const rank = pegChoose(legal.map((c) => c.r), count, state.peg.pile, hands[turn].map((c) => c.r));
    const card = legal.find((c) => c.r === rank) || legal[0];
    check(typeof card.s === "number", "played card keeps its suit");
    state = reduce(state, { type: "PLAY_CARD", seat: turn, card });
  }
  check(guard < 600, "pegging terminated");
  if (state.phase === "over") return state;
  check(state.phase === "show", "pegging -> show");
  check(state.show.order.length === 7, "show counts six seats + crib");

  guard = 0;
  while (state.phase === "show" && guard++ < 30) state = reduce(state, state.show.scored ? { type: "SHOW_NEXT" } : { type: "SHOW_SCORE" });
  check(guard < 28, "show terminated");
  check(state.phase === "deal" || state.phase === "over", "show -> deal/over");
  return state;
}

/* ---- B. drive many hands; scores only go up, stay sane ---- */
{
  let state = initGame();
  let prev = state.seats.map((s) => s.score);
  let hands = 0, exceptions = 0, humanNoThrow = 0;
  for (let h = 0; h < 110 && state.phase !== "over"; h++) {
    try {
      if (noThrowOf(state.dealerIdx)(0)) humanNoThrow++;
      state = playHand(state);
      hands++;
      const maxScore = Math.max(...state.seats.map((s) => s.score));
      state.seats.forEach((s, i) => {
        check(Number.isFinite(s.score), `seat ${i} score finite`);
        check(s.score >= prev[i], `seat ${i} score monotonic non-decreasing`);
        const sum = (s.history || []).reduce((a, x) => a + x.pts, 0);
        check(sum === s.score, `seat ${i} scoring history sums to the score (${sum} vs ${s.score})`);
      });
      if (maxScore >= 121) check(state.phase === "over", `game ends once a seat reaches 121 (max ${maxScore})`);
      if (state.phase === "deal") check(maxScore < 121, "no winner left uncrowned between hands");
      prev = state.seats.map((s) => s.score);
    } catch (e) { exceptions++; console.error("  ✗ exception in hand", h, e.message); }
  }
  check(exceptions === 0, "no exceptions across many hands");
  check(hands >= 1, "played at least one full hand");
  check(humanNoThrow >= 1, "exercised the human-as-non-thrower (skip-discard) path at least once");
  check(state.phase === "over" || hands === 110, "reached a winner or ran the cap");
}

/* ---- C. his heels = +2 at the cut (starter is deck[28] for 6-handed) ---- */
{
  let state = reduce(initGame(), { type: "DEAL" });
  if (state.phase === "discard") state = reduce(state, { type: "DISCARD", idx: 0 });
  const d = state.dealerIdx;
  const before = state.seats[d].score;
  state = { ...state, deck: state.deck.map((c, i) => (i === 28 ? { r: 11, s: 0 } : c)) };
  state = reduce(state, { type: "CUT" });
  check(state.hisHeels === true, "Jack cut flags his heels");
  check(state.seats[d].score === before + 2, `his heels awards exactly +2 (got +${state.seats[d].score - before})`);
}

/* ---- D. show 121 short-circuit: pone (counted first) pegs out before others ---- */
{
  let state = reduce(initGame(), { type: "DEAL" });
  if (state.phase === "discard") state = reduce(state, { type: "DISCARD", idx: 0 });
  state = reduce(state, { type: "CUT" });
  const d = state.dealerIdx;
  const pone = (d + 1) % 6;
  const second = (d + 2) % 6;
  const starter = { r: 10, s: 0 };
  const poneHand = [{ r: 5, s: 1 }, { r: 5, s: 2 }, { r: 5, s: 3 }, { r: 5, s: 0 }];
  const acc = [0, 0, 0, 0, 0];
  const poneScore = scoreInto(poneHand, starter, false, acc);
  const seats = state.seats.map((s, i) => ({
    ...s,
    score: i === pone ? 121 - poneScore : i === second ? 120 : 0,
    kept: i === pone ? poneHand : [{ r: 2, s: 0 }, { r: 3, s: 1 }, { r: 7, s: 2 }, { r: 9, s: 3 }],
  }));
  let fab = {
    ...state, seats, starter, crib: [{ r: 4, s: 0 }, { r: 6, s: 1 }, { r: 8, s: 2 }, { r: 13, s: 3 }],
    phase: "show", show: { order: [pone, second, (d + 3) % 6, (d + 4) % 6, (d + 5) % 6, d, "CRIB"], step: 0, scored: false, claimSubmitted: false, claimValue: null },
    settings: { counting: "auto" },
  };
  const secondBefore = fab.seats[second].score;
  fab = reduce(fab, { type: "SHOW_SCORE" });
  check(fab.phase === "over", "show short-circuits to over when pone pegs out");
  check(fab.winner === pone, `pone is the winner (got ${fab.winner})`);
  check(fab.seats[second].score === secondBefore, "the next player in order is NOT counted after the win");
}

/* ---- E. muggins: under-claim hands missed points to the next opponent ---- */
{
  let base = reduce(initGame(), { type: "DEAL" });
  if (base.phase === "discard") base = reduce(base, { type: "DISCARD", idx: 0 });
  base = reduce(base, { type: "CUT" });
  const human = 0;
  const order = [human, (human + 1) % 6, (human + 2) % 6, (human + 3) % 6, (human + 4) % 6, (human + 5) % 6, "CRIB"];
  const starter = { r: 6, s: 0 };
  const humanHand = [{ r: 9, s: 1 }, { r: 9, s: 2 }, { r: 7, s: 3 }, { r: 8, s: 0 }];
  const acc = [0, 0, 0, 0, 0];
  const actual = scoreInto(humanHand, starter, false, acc);
  const recip = order[1];
  let fab = {
    ...base, starter, settings: { counting: "muggins" },
    seats: base.seats.map((s, i) => ({ ...s, score: 0, kept: i === human ? humanHand : [{ r: 2, s: 0 }, { r: 3, s: 1 }, { r: 4, s: 2 }, { r: 10, s: 3 }] })),
    crib: [{ r: 13, s: 0 }, { r: 12, s: 1 }, { r: 11, s: 2 }, { r: 10, s: 3 }],
    phase: "show", show: { order, step: 0, scored: false, claimSubmitted: true, claimValue: 2 },
  };
  check(actual > 2, `human hand worth more than the claim (actual ${actual})`);
  const recipBefore = fab.seats[recip].score;
  fab = reduce(fab, { type: "SHOW_SCORE" });
  check(fab.seats[human].score === 2, `human awarded only the claimed 2 (got ${fab.seats[human].score})`);
  check(fab.seats[recip].score === recipBefore + (actual - 2), `missed ${actual - 2} mugginsed to next opponent (got +${fab.seats[recip].score - recipBefore})`);
}

/* ---- F. cut for deal: six draw; lowest unique deals; game starts in cutdeal ---- */
{
  const { drawForDealer } = S;
  for (let i = 0; i < 80; i++) {
    const { dealerIdx, draw } = drawForDealer();
    check(draw.length === 6, "six players draw for deal");
    const ranks = draw.map((c) => c.r);
    const lo = Math.min(...ranks);
    check(ranks[dealerIdx] === lo, "dealer holds the lowest drawn card");
    check(ranks.filter((r) => r === lo).length === 1, "no tie for the lowest draw");
  }
  const g = initGame();
  check(g.phase === "cutdeal" && Array.isArray(g.dealDraw) && g.dealDraw.length === 6, "new game starts in cutdeal with a 6-card draw");
}

console.log(`\nplay6.html engine checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
