#!/usr/bin/env node
/* Verifies the heads-up game (headsup.html) without a browser, the same way
 * verify_play.js does for the 4-player game: eval the compiled <script> in a vm
 * with React/ReactDOM stubs (so the component never renders), exposing the reducer
 * and pure helpers, then drive whole 2-player hands and assert the rules:
 *   - deal 6 / discard 2 / 2+2 crib; go/31/last-card; his heels = +2;
 *   - the show order is [pone, dealer, CRIB] and stops at 121;
 *   - every point is logged (history sums to score); scores only go up.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "headsup.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

function makeMath(seed) {
  let a = seed >>> 0;
  const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math); M.random = rng; return M;
}
function load(seed) {
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

const S = load(7);
const { reduce, initGame, computeShow, scoreInto, pegScore, pegChoose, drawForDealer, aiDiscard } = S;
const pval = (r) => Math.min(r, 10);

/* ---- pegScore + perfect-29 (shared engine sanity) ---- */
check(pegScore([7, 8], 15) === 2, "fifteen = 2");
check(pegScore([6, 6, 6], 18) === 6, "pair royal = 6");
check(pegScore([4, 5, 6, 7], 22) === 4, "run of 4 = 4");
{
  const four = [{ r: 5, s: 3 }, { r: 5, s: 2 }, { r: 5, s: 1 }, { r: 11, s: 0 }];
  const acc = [0, 0, 0, 0, 0];
  check(scoreInto(four, { r: 5, s: 0 }, false, acc) === 29 && JSON.stringify(acc) === JSON.stringify([16, 12, 0, 0, 1]), "perfect 29");
}

/* ---- cut for deal: lowest unique of two draws deals; game starts in cutdeal ---- */
{
  for (let i = 0; i < 60; i++) {
    const { dealerIdx, draw } = drawForDealer();
    check(draw.length === 2, "two players draw for deal");
    const ranks = draw.map((c) => c.r), lo = Math.min(...ranks);
    check(ranks[dealerIdx] === lo && ranks.filter((r) => r === lo).length === 1, "dealer holds the unique lowest draw");
  }
  const g = initGame();
  check(g.phase === "cutdeal" && g.seats.length === 2, "new game: cutdeal, 2 seats");
}

/* ---- AI discards exactly two; keeps four ---- */
{
  let st = reduce(initGame(), { type: "DEAL" });
  check(st.phase === "discard", "DEAL -> discard");
  check(st.seats[1].discard.length === 2 && st.seats[1].kept.length === 4, "AI throws two, keeps four");
  check(st.seats[0].dealt.length === 6, "you are dealt six");
}

/* ---- drive whole hands; invariants hold ---- */
function playHand(state) {
  state = reduce(state, { type: "DEAL" });
  check(state.phase === "discard", "deal -> discard");
  state = reduce(state, { type: "DISCARD", idxs: [0, 1] }); // throw your lowest two (sorted)
  check(state.phase === "cut" && state.crib.length === 4, "discard -> cut, 4-card crib");
  check(state.seats[0].kept.length === 4, "you keep four");

  state = reduce(state, { type: "CUT" });
  check(state.starter && typeof state.starter.s === "number", "starter is a suited card");
  if (state.phase === "over") return state;
  check(state.phase === "play", "cut -> play");
  check(state.peg.hands[0].length === 4 && state.peg.hands[1].length === 4, "each side pegs four cards");

  let guard = 0;
  while (state.phase === "play" && guard++ < 200) {
    const { hands, turn, count } = state.peg;
    const legal = hands[turn].filter((c) => pval(c.r) + count <= 31);
    if (legal.length === 0) { state = reduce(state, { type: "PASS_GO", seat: turn }); continue; }
    const rank = pegChoose(legal.map((c) => c.r), count, state.peg.pile, hands[turn].map((c) => c.r));
    const card = legal.find((c) => c.r === rank) || legal[0];
    state = reduce(state, { type: "PLAY_CARD", seat: turn, card });
  }
  check(guard < 200, "pegging terminates");
  if (state.phase === "over") return state;
  check(state.phase === "show", "pegging -> show");
  check(state.show.order.length === 3, "show order is [pone, dealer, CRIB]");

  guard = 0;
  // each step is scored when shown (SHOW_SCORE), then Continue (SHOW_NEXT) advances
  while (state.phase === "show" && guard++ < 18) state = reduce(state, state.show.scored ? { type: "SHOW_NEXT" } : { type: "SHOW_SCORE" });
  check(state.phase === "deal" || state.phase === "over", "show -> deal/over");
  return state;
}

{
  let state = initGame();
  let prev = state.seats.map((s) => s.score), hands = 0, exceptions = 0;
  for (let h = 0; h < 80 && state.phase !== "over"; h++) {
    try {
      state = playHand(state); hands++;
      const maxScore = Math.max(...state.seats.map((s) => s.score));
      state.seats.forEach((s, i) => {
        check(Number.isFinite(s.score) && s.score >= prev[i], `seat ${i} score finite & monotonic`);
        const sum = (s.history || []).reduce((a, x) => a + x.pts, 0);
        check(sum === s.score, `seat ${i} history sums to score (${sum} vs ${s.score})`);
      });
      if (maxScore >= 121) check(state.phase === "over", "reaching 121 ends the game");
      if (state.phase === "deal") check(maxScore < 121, "no winner left uncrowned between hands");
      prev = state.seats.map((s) => s.score);
    } catch (e) { exceptions++; console.error("  ✗ exception in hand", h, e.message); }
  }
  check(exceptions === 0, "no exceptions across many hands");
  check(hands >= 1, "played at least one full hand");
}

/* ---- his heels = +2 at the cut (force a Jack as deck[12]) ---- */
{
  let st = reduce(initGame(), { type: "DEAL" });
  st = reduce(st, { type: "DISCARD", idxs: [0, 1] });
  const d = st.dealerIdx, before = st.seats[d].score;
  st = { ...st, deck: st.deck.map((c, i) => (i === 12 ? { r: 11, s: 0 } : c)) };
  st = reduce(st, { type: "CUT" });
  check(st.hisHeels === true && st.seats[d].score === before + 2, "Jack cut -> dealer +2 (his heels)");
}

console.log(`\nheadsup.html engine checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
