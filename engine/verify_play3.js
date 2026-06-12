#!/usr/bin/env node
/* Verifies the 3-handed game (play3.html) without a browser — same harness as
 * verify_play.js, adapted for three seats and the 3-handed crib.
 *
 * The reducer and pure helpers are top-level declarations in the compiled
 * play3.html <script>. We eval it in a vm sandbox with React/ReactDOM stubs and
 * drive whole hands through `reduce`, asserting the 3-handed rules:
 *   - the crib is the three discards PLUS one card dealt off the deck (4 total)
 *   - go / 31 / last-card never double-count; turn rotates over three seats
 *   - his heels = +2 at the cut
 *   - the show counts pone, +2, dealer, crib and stops the instant a seat hits 121
 *   - suits survive pegging; scores only ever go up; totals reconcile
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "play3.html"), "utf8");
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
const { reduce, initGame, scoreInto, pegScore, pegChoose } = S;
const pval = (r) => Math.min(r, 10);
const sameCard = (a, b) => a.r === b.r && a.s === b.s;

/* ---- A. pegScore spot checks (engine identical to 4-handed) ---- */
check(pegScore([7, 8], 15) === 2, "fifteen = 2");
check(pegScore([9, 9, 9, 4], 31) === 2, "reaching 31 = 2");
check(pegScore([6, 6, 6], 18) === 6, "pair royal = 6");
check(pegScore([3, 1, 2], 6) === 3, "out-of-order run of 3 = 3");

/* ---- B. scoreInto perfect 29 ---- */
{
  const four = [{ r: 5, s: 3 }, { r: 5, s: 2 }, { r: 5, s: 1 }, { r: 11, s: 0 }];
  const acc = [0, 0, 0, 0, 0];
  const total = scoreInto(four, { r: 5, s: 0 }, false, acc);
  check(total === 29, `perfect 29 total (got ${total})`);
  check(JSON.stringify(acc) === JSON.stringify([16, 12, 0, 0, 1]), `perfect 29 cats (got ${JSON.stringify(acc)})`);
}

/* ---- helper: drive one hand to completion, auto-count ---- */
function playHand(state) {
  state = reduce(state, { type: "DEAL" });
  check(state.phase === "discard", "DEAL -> discard");
  check(state.crib.length === 0, "crib empty before discard");
  for (let i = 1; i < 3; i++) check(state.seats[i].kept.length === 4 && state.seats[i].discard, `seat ${i} AI discard computed`);
  const deckBefore = state.deck;
  state = reduce(state, { type: "DISCARD", idx: 0 });
  check(state.phase === "cut" && state.crib.length === 4, "DISCARD -> cut, crib of 4");
  check(state.seats[0].kept.length === 4, "human kept 4");
  // the crib = three discards + the deck filler (deck[15]); each is a suited card
  const discards = state.seats.map((s) => s.discard);
  check(state.crib.some((c) => sameCard(c, deckBefore[15])), "crib includes the deck filler (deck[15])");
  for (const d of discards) check(state.crib.some((c) => sameCard(c, d)), "each player's discard is in the crib");
  check(state.crib.every((c) => typeof c.s === "number"), "every crib card is suited");

  state = reduce(state, { type: "CUT" });
  check(state.starter && typeof state.starter.s === "number", "starter is a suited card");
  if (state.phase === "over") return state; // his heels won (rare)
  check(state.phase === "play", "CUT -> play");
  check(state.peg.hands.length === 3, "pegging has three hands");

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
  check(state.show.order.length === 4, "show counts three seats + crib");

  guard = 0;
  while (state.phase === "show" && guard++ < 30) state = reduce(state, state.show.scored ? { type: "SHOW_NEXT" } : { type: "SHOW_SCORE" });
  check(guard < 20, "show terminated");
  check(state.phase === "deal" || state.phase === "over", "show -> deal/over");
  return state;
}

/* ---- C. drive many hands; scores only go up, stay sane ---- */
{
  let state = initGame();
  let prev = state.seats.map((s) => s.score);
  let hands = 0, exceptions = 0;
  for (let h = 0; h < 80 && state.phase !== "over"; h++) {
    try {
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
  check(state.phase === "over" || hands === 80, "reached a winner or ran the cap");
}

/* ---- D. his heels = +2 at the cut (starter is deck[16] for 3-handed) ---- */
{
  let state = reduce(initGame(), { type: "DEAL" });
  state = reduce(state, { type: "DISCARD", idx: 0 });
  const d = state.dealerIdx;
  const before = state.seats[d].score;
  state = { ...state, deck: state.deck.map((c, i) => (i === 16 ? { r: 11, s: 0 } : c)) };
  state = reduce(state, { type: "CUT" });
  check(state.hisHeels === true, "Jack cut flags his heels");
  check(state.seats[d].score === before + 2, `his heels awards exactly +2 (got +${state.seats[d].score - before})`);
}

/* ---- E. show 121 short-circuit: pone (counted first) pegs out before others ---- */
{
  let state = reduce(initGame(), { type: "DEAL" });
  state = reduce(state, { type: "DISCARD", idx: 0 });
  state = reduce(state, { type: "CUT" });
  const dealerIdx = state.dealerIdx;
  const pone = (dealerIdx + 1) % 3;
  const second = (dealerIdx + 2) % 3;
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
    phase: "show", show: { order: [pone, second, dealerIdx, "CRIB"], step: 0, scored: false, claimSubmitted: false, claimValue: null },
    settings: { counting: "auto" },
  };
  const secondBefore = fab.seats[second].score;
  fab = reduce(fab, { type: "SHOW_SCORE" });
  check(fab.phase === "over", "show short-circuits to over when pone pegs out");
  check(fab.winner === pone, `pone is the winner (got ${fab.winner})`);
  check(fab.seats[second].score === secondBefore, "the next player in order is NOT counted after the win");
}

/* ---- F. muggins: under-claim hands missed points to the next opponent ---- */
{
  let base = reduce(initGame(), { type: "DEAL" });
  base = reduce(base, { type: "DISCARD", idx: 0 });
  base = reduce(base, { type: "CUT" });
  const human = 0;
  const order = [human, (human + 1) % 3, (human + 2) % 3, "CRIB"];
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

/* ---- G. cut for deal: lowest unique card deals; a game starts in cutdeal with 3 ---- */
{
  const { drawForDealer } = S;
  for (let i = 0; i < 80; i++) {
    const { dealerIdx, draw } = drawForDealer();
    check(draw.length === 3, "three players draw for deal");
    const ranks = draw.map((c) => c.r);
    const lo = Math.min(...ranks);
    check(ranks[dealerIdx] === lo, "dealer holds the lowest drawn card");
    check(ranks.filter((r) => r === lo).length === 1, "no tie for the lowest draw");
  }
  const g = initGame();
  check(g.phase === "cutdeal" && Array.isArray(g.dealDraw) && g.dealDraw.length === 3, "new game starts in cutdeal with a 3-card draw");
  check(reduce(g, { type: "DEAL" }).phase === "discard", "cutdeal -> DEAL deals the first hand");
}

console.log(`\nplay3.html engine checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
