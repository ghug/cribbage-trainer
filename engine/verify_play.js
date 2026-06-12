#!/usr/bin/env node
/* Verifies the consolidated play page (play.html), which adapts to the table size
 * in settings.players. Currently supports P = 2 (heads-up), 3 and 4 (cutthroat).
 *
 * We eval the compiled play.html <script> in a vm sandbox and drive whole hands for
 * each supported P, asserting the per-P rules:
 *   P=2: deal 6, throw 2; crib = your 2 + opponent 2; starter deck[12]; show 3 steps.
 *   P=3: deal 5, throw 1; crib = 3 throws + a deck card (deck[15]); starter deck[16];
 *        show 4 steps.
 *   P=4: deal 5, throw 1; crib = 4 throws; starter deck[20]; show 5 steps.
 * Plus the shared invariants: go/31/last-card never double-count, his heels = +2,
 * suits survive pegging, scores only go up, history reconciles, the 121 stop.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "play.html"), "utf8");
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

// Per-P facts the harness checks against.
const FACTS = {
  2: { dealt: 6, throws: 2, idxs: [0, 1], starterIdx: 12, deckCard: false, showLen: 3 },
  3: { dealt: 5, throws: 1, idxs: [0], starterIdx: 16, deckCard: true, deckIdx: 15, showLen: 4 },
  4: { dealt: 5, throws: 1, idxs: [0], starterIdx: 20, deckCard: false, showLen: 5 },
};
const SUPPORTED = [2, 3, 4];

/* ---- A. pegScore + perfect-29 spot checks ---- */
check(pegScore([7, 8], 15) === 2, "fifteen = 2");
check(pegScore([6, 6, 6], 18) === 6, "pair royal = 6");
check(pegScore([3, 1, 2], 6) === 3, "out-of-order run of 3 = 3");
{
  const acc = [0, 0, 0, 0, 0];
  const total = scoreInto([{ r: 5, s: 3 }, { r: 5, s: 2 }, { r: 5, s: 1 }, { r: 11, s: 0 }], { r: 5, s: 0 }, false, acc);
  check(total === 29, `perfect 29 total (got ${total})`);
}

// Start a fresh game for a given table size.
function gameFor(P) {
  return reduce(initGame(), { type: "SET_SETTING", key: "players", value: P });
}

function playHand(state, P) {
  const F = FACTS[P];
  state = reduce(state, { type: "DEAL" });
  check(state.seats.length === P, `P=${P}: ${P} seats`);
  for (let i = 0; i < P; i++) check(state.seats[i].dealt.length === F.dealt, `P=${P}: seat ${i} dealt ${F.dealt}`);
  check(state.phase === "discard", `P=${P}: DEAL -> discard`);
  for (let i = 1; i < P; i++) check(state.seats[i].kept.length === 4 && state.seats[i].discard.length === F.throws, `P=${P}: bot ${i} threw ${F.throws}`);
  const deckBefore = state.deck;
  state = reduce(state, { type: "DISCARD", idxs: F.idxs });
  check(state.phase === "cut", `P=${P}: DISCARD -> cut`);
  check(state.seats[0].kept.length === 4, `P=${P}: human kept 4`);
  check(state.crib.length === 4, `P=${P}: crib of 4`);
  check(state.crib.every((c) => typeof c.s === "number"), `P=${P}: crib cards suited`);
  // every throw is in the crib
  let thrown = [];
  state.seats.forEach((s) => { if (s.discard) thrown = thrown.concat(s.discard); });
  check(thrown.length === (F.deckCard ? 3 : 4), `P=${P}: ${F.deckCard ? 3 : 4} thrown cards`);
  for (const t of thrown) check(state.crib.some((c) => sameCard(c, t)), `P=${P}: each throw in the crib`);
  if (F.deckCard) check(state.crib.some((c) => sameCard(c, deckBefore[F.deckIdx])), `P=${P}: crib includes the deck filler (deck[${F.deckIdx}])`);

  // force a known non-Jack starter to keep pegging deterministic-ish, then cut
  state = reduce(state, { type: "CUT" });
  check(state.starter && sameCard(state.starter, deckBefore[F.starterIdx]), `P=${P}: starter is deck[${F.starterIdx}]`);
  if (state.phase === "over") return state;
  check(state.phase === "play", `P=${P}: CUT -> play`);
  check(state.peg.hands.length === P, `P=${P}: ${P} pegging hands`);
  check(state.peg.hands.every((h) => h.length === 4), `P=${P}: everyone pegs from 4`);

  let guard = 0;
  while (state.phase === "play" && guard++ < 400) {
    const { hands, turn, count } = state.peg;
    const legal = hands[turn].filter((c) => pval(c.r) + count <= 31);
    if (legal.length === 0) { state = reduce(state, { type: "PASS_GO", seat: turn }); continue; }
    const rank = pegChoose(legal.map((c) => c.r), count, state.peg.pile, hands[turn].map((c) => c.r));
    const card = legal.find((c) => c.r === rank) || legal[0];
    check(typeof card.s === "number", `P=${P}: played card keeps suit`);
    state = reduce(state, { type: "PLAY_CARD", seat: turn, card });
  }
  check(guard < 400, `P=${P}: pegging terminated`);
  if (state.phase === "over") return state;
  check(state.phase === "show", `P=${P}: pegging -> show`);
  check(state.show.order.length === F.showLen, `P=${P}: show has ${F.showLen} steps`);

  guard = 0;
  while (state.phase === "show" && guard++ < 20) state = reduce(state, state.show.scored ? { type: "SHOW_NEXT" } : { type: "SHOW_SCORE" });
  check(guard < 18, `P=${P}: show terminated`);
  check(state.phase === "deal" || state.phase === "over", `P=${P}: show -> deal/over`);
  return state;
}

/* ---- B. for each supported P: drive many hands; scores sane ---- */
for (const P of SUPPORTED) {
  let state = gameFor(P);
  check(state.phase === "cutdeal" && state.seats.length === P, `P=${P}: new game is cutdeal with ${P} seats`);
  check(Array.isArray(state.dealDraw) && state.dealDraw.length === P, `P=${P}: ${P}-card cut-for-deal`);
  let prev = state.seats.map((s) => s.score);
  let hands = 0, exceptions = 0;
  for (let h = 0; h < 80 && state.phase !== "over"; h++) {
    try {
      state = playHand(state, P);
      hands++;
      const maxScore = Math.max(...state.seats.map((s) => s.score));
      state.seats.forEach((s, i) => {
        check(s.score >= prev[i], `P=${P}: seat ${i} score monotonic`);
        const sum = (s.history || []).reduce((a, x) => a + x.pts, 0);
        check(sum === s.score, `P=${P}: seat ${i} history sums to score (${sum} vs ${s.score})`);
      });
      if (maxScore >= 121) check(state.phase === "over", `P=${P}: game ends at 121 (max ${maxScore})`);
      if (state.phase === "deal") check(maxScore < 121, `P=${P}: no uncrowned winner between hands`);
      prev = state.seats.map((s) => s.score);
    } catch (e) { exceptions++; console.error("  ✗ exception", P, h, e.message); }
  }
  check(exceptions === 0, `P=${P}: no exceptions across many hands`);
  check(hands >= 1, `P=${P}: played at least one full hand`);
}

/* ---- C. his heels = +2 at the cut, per P ---- */
for (const P of SUPPORTED) {
  const F = FACTS[P];
  let state = reduce(gameFor(P), { type: "DEAL" });
  state = reduce(state, { type: "DISCARD", idxs: F.idxs });
  const d = state.dealerIdx;
  const before = state.seats[d].score;
  state = { ...state, deck: state.deck.map((c, i) => (i === F.starterIdx ? { r: 11, s: 0 } : c)) };
  state = reduce(state, { type: "CUT" });
  check(state.hisHeels === true, `P=${P}: Jack cut flags his heels`);
  check(state.seats[d].score === before + 2, `P=${P}: his heels +2 (got +${state.seats[d].score - before})`);
}

/* ---- D. changing players restarts the game with the new seat count ---- */
{
  let state = gameFor(2);
  check(state.seats.length === 2, "players=2 -> 2 seats");
  state = reduce(state, { type: "SET_SETTING", key: "players", value: 3 });
  check(state.seats.length === 3 && state.phase === "cutdeal", "switching to players=3 restarts with 3 seats");
}

console.log(`\nplay.html engine checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
