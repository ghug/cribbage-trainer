#!/usr/bin/env node
/* Verifies the consolidated play page (play.html), which adapts to the table size
 * in settings.players. Supports P = 2 (heads-up) through 6 (cutthroat).
 *
 * We eval the compiled play.html <script> in a vm sandbox and drive whole hands for
 * each supported P, asserting the per-P rules:
 *   P=2: deal 6, throw 2; crib = your 2 + opponent 2; starter deck[12]; show 3 steps.
 *   P=3: deal 5, throw 1; crib = 3 throws + a deck card (deck[15]); starter deck[16];
 *        show 4 steps.
 *   P=4: deal 5, throw 1; crib = 4 throws; starter deck[20]; show 5 steps.
 *   P=5: dealer dealt 4/throws none, others deal 5/throw 1; crib = 4 throws; starter
 *        deck[24]; show 6 steps; the human-as-dealer skips the discard.
 *   P=6: dealer + seat to their right dealt 4/throw none; crib = 4 throws; starter
 *        deck[28]; show 7 steps; either non-thrower (as human) skips the discard.
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
const { reduce, initGame, scoreInto, pegScore, pegChoose, gameRecord, plan } = S;
const pval = (r) => Math.min(r, 10);
const sameCard = (a, b) => a.r === b.r && a.s === b.s;

// Per-P facts the harness checks against.
const FACTS = {
  2: { dealt: 6, throws: 2, idxs: [0, 1], starterIdx: 12, deckCard: false, showLen: 3 },
  3: { dealt: 5, throws: 1, idxs: [0], starterIdx: 16, deckCard: true, deckIdx: 15, showLen: 4 },
  4: { dealt: 5, throws: 1, idxs: [0], starterIdx: 20, deckCard: false, showLen: 5 },
  5: { dealt: 5, throws: 1, idxs: [0], starterIdx: 24, deckCard: false, showLen: 6 },
  6: { dealt: 5, throws: 1, idxs: [0], starterIdx: 28, deckCard: false, showLen: 7 },
};
const SUPPORTED = [2, 3, 4, 5, 6];
// Seats dealt 4 that throw nothing: the dealer in 5-handed, the dealer + seat to
// their right in 6-handed. (None at 2/3/4.)
function noThrowSeat(P, d, i) {
  if (P === 5) return i === d;
  if (P === 6) return i === d || i === (d + 5) % 6;
  return false;
}

/* ---- A. pegScore + perfect-29 spot checks ---- */
check(pegScore([7, 8], 15) === 2, "fifteen = 2");
check(pegScore([6, 6, 6], 18) === 6, "pair royal = 6");
check(pegScore([3, 1, 2], 6) === 3, "out-of-order run of 3 = 3");
{
  const acc = [0, 0, 0, 0, 0];
  const total = scoreInto([{ r: 5, s: 3 }, { r: 5, s: 2 }, { r: 5, s: 1 }, { r: 11, s: 0 }], { r: 5, s: 0 }, false, acc);
  check(total === 29, `perfect 29 total (got ${total})`);
}

// Start a fresh game for a given table size. autoCut is forced off so these checks drive
// the explicit CUT action (the auto-cut path — which skips the cut phase — is covered
// separately by autoCutSkips()).
function gameFor(P) {
  // Pin counting to "auto" so this driver exercises the full auto-count show path (its per-step
  // scoring checks) regardless of the product default — which is "muggins". mixedGame leaves counting
  // at the default, so the muggins show path still gets coverage there.
  let s = reduce(initGame(), { type: "SET_SETTING", key: "autoCut", value: false });
  s = reduce(s, { type: "SET_SETTING", key: "counting", value: "auto" });
  return reduce(s, { type: "SET_SETTING", key: "players", value: P });
}

// The cut-for-deal is incremental too: from "cutdeal", each CUT_NEXT reveals one card until all P are
// out and a unique low decides the dealer (ties re-draw a fresh deck). Drain it before dealing.
function cutAll(state) {
  let guard = 0;
  while (state.phase === "cutdeal" && state.cutDeal && !state.cutDeal.settled && guard++ < 600)
    state = reduce(state, state.cutDeal.tie ? { type: "CUT_REDRAW" } : { type: "CUT_NEXT" });
  return state;
}
// The deal is incremental: DEAL starts it (phase "dealing"), then each DEAL_NEXT pushes one card off
// the deck until the hands are full and it finalizes (-> discard, or straight to cut). The live UI
// gates each push on a transitionend; the harness just drains them in one go.
function dealAll(state) {
  state = cutAll(state);                                 // settle the cut-for-deal first (first hand)
  state = reduce(state, { type: "DEAL" });
  let guard = 0;
  while (state.phase === "dealing" && guard++ < 80) state = reduce(state, { type: "DEAL_NEXT" });
  return state;
}

function playHand(state, P) {
  const F = FACTS[P];
  state = dealAll(state);
  const d = state.dealerIdx;
  check(state.seats.length === P, `P=${P}: ${P} seats`);
  for (let i = 0; i < P; i++) {
    const exp = noThrowSeat(P, d, i) ? 4 : F.dealt;
    check(state.seats[i].dealt.length === exp, `P=${P}: seat ${i} dealt ${exp}`);
  }
  for (let i = 1; i < P; i++) {
    if (noThrowSeat(P, d, i)) check(state.seats[i].kept.length === 4 && state.seats[i].discard.length === 0, `P=${P}: non-thrower bot ${i} keeps 4`);
    else check(state.seats[i].kept.length === 4 && state.seats[i].discard.length === F.throws, `P=${P}: bot ${i} threw ${F.throws}`);
  }
  const deckBefore = state.deck;
  if (noThrowSeat(P, d, 0)) {
    check(state.phase === "cut", `P=${P}: human non-thrower -> straight to cut`);
    check(state.seats[0].kept.length === 4 && state.seats[0].discard.length === 0, `P=${P}: human non-thrower keeps 4, throws none`);
  } else {
    check(state.phase === "discard", `P=${P}: DEAL -> discard`);
    state = reduce(state, { type: "DISCARD", idxs: F.idxs });
    if (state.phase === "cribbing") state = reduce(state, { type: "CRIB_DONE" });   // the completing throw holds for its animation; advance it
    check(state.phase === "cut", `P=${P}: DISCARD -> cut`);
    check(state.seats[0].kept.length === 4, `P=${P}: human kept 4`);
  }
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
    if (state.peg.pending31) { state = reduce(state, { type: "RESET_31" }); continue; }   // clear the frozen 31 pile
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
  check(state.dealDraw.length === 0 && state.cutDeal && !state.cutDeal.settled && state.cutDeal.contenders.length === P, `P=${P}: cut-for-deal starts empty, all P in contention`);
  const cut = cutAll(state);
  check(cut.cutDeal.settled && cut.dealDraw[cut.dealerIdx], `P=${P}: cut settles on a dealer holding a cut card`);
  { const cont = cut.cutDeal.contenders, r = cont.map((s) => cut.dealDraw[s].r), lo = Math.min(...r);
    check(r.filter((x) => x === lo).length === 1 && cut.dealerIdx === cont[r.indexOf(lo)], `P=${P}: unique low among the final contenders deals`); }
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
      const goal = P >= 5 ? 61 : 121; // 5-/6-handed are short games to 61
      if (maxScore >= goal) check(state.phase === "over", `P=${P}: game ends at ${goal} (max ${maxScore})`);
      if (state.phase === "deal") check(maxScore < goal, `P=${P}: no uncrowned winner between hands`);
      prev = state.seats.map((s) => s.score);
    } catch (e) { exceptions++; console.error("  ✗ exception", P, h, e.message); }
  }
  check(exceptions === 0, `P=${P}: no exceptions across many hands`);
  check(hands >= 1, `P=${P}: played at least one full hand`);
}

/* ---- B2. cut-for-deal TIE-BREAK: only the seats that tied re-cut (forced deck) ---- */
{
  const C = (r, s) => ({ r, s });
  let st = gameFor(4);
  // seats 0 & 1 draw an Ace (rank 1), seats 2 & 3 draw K/Q → 0 and 1 tie for low
  st = { ...st, cutDeal: { ...st.cutDeal, deck: [C(1, 0), C(1, 1), C(13, 0), C(12, 0), ...st.cutDeal.deck.slice(4)] } };
  for (let i = 0; i < 4; i++) st = reduce(st, { type: "CUT_NEXT" });
  check(st.cutDeal.tie && st.cutDeal.tied.join(",") === "0,1", "tie: seats 0 & 1 tie for the low Ace");
  check(!st.cutDeal.settled, "tie: cut not settled while holding the tie");
  st = reduce(st, { type: "CUT_REDRAW" });
  check(st.cutDeal.contenders.join(",") === "0,1" && st.dealDraw.length === 0 && !st.cutDeal.tie, "redraw: only the two tied seats re-cut, cards cleared");
  // re-cut: seat 0 draws a 2, seat 1 draws a 5 → seat 0 deals; seats 2 & 3 stay out
  st = { ...st, cutDeal: { ...st.cutDeal, deck: [C(2, 0), C(5, 0), ...st.cutDeal.deck.slice(2)] } };
  st = reduce(reduce(st, { type: "CUT_NEXT" }), { type: "CUT_NEXT" });
  check(st.cutDeal.settled && st.dealerIdx === 0, "tie-break: the lower of the two tied seats deals");
  check(st.dealDraw[0] && st.dealDraw[1] && !st.dealDraw[2] && !st.dealDraw[3], "tie-break: only the tied seats hold cards; the rest are out");
}

/* ---- C. his heels = +2 at the cut, per P ---- */
for (const P of SUPPORTED) {
  const F = FACTS[P];
  let state = dealAll(gameFor(P));
  if (state.phase === "discard") state = reduce(state, { type: "DISCARD", idxs: F.idxs });
  if (state.phase === "cribbing") state = reduce(state, { type: "CRIB_DONE" });
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

/* ---- E. teams setting (display only): options, defaults, and clamping ---- */
{
  const { teamOptions } = S;
  check(JSON.stringify(teamOptions(4)) === JSON.stringify([4, 2]), "team options at 4 are [4,2]");
  check(JSON.stringify(teamOptions(6)) === JSON.stringify([6, 3, 2]), "team options at 6 are [6,3,2]");
  for (const P of [2, 3, 5]) check(JSON.stringify(teamOptions(P)) === JSON.stringify([P]), `team options at ${P} are just [${P}]`);

  let st = gameFor(4);
  check(st.settings.teams === 4, "switching to 4 players defaults teams to 4 (cutthroat)");
  st = reduce(st, { type: "SET_SETTING", key: "teams", value: 2 });
  check(st.settings.teams === 2 && st.phase === "cutdeal" && st.seats.length === 4, "setting teams=2 updates the setting without restarting the game");
  st = reduce(st, { type: "SET_SETTING", key: "players", value: 6 });
  check(st.settings.players === 6 && st.settings.teams === 6, "switching players resets teams to the new player count");
  st = reduce(st, { type: "SET_SETTING", key: "teams", value: 3 });
  check(st.settings.teams === 3, "teams=3 is valid at 6 players");
  st = reduce(st, { type: "SET_SETTING", key: "players", value: 3 });
  check(st.settings.teams === 3, "at a size with no team choice, teams equals the player count");
}

/* ---- F. team play: partners share one running score (4/2, 6/3, 6/2) ---- */
const { teamOf } = S;
function groupsFor(P, teams) {
  const g = {};
  for (let i = 0; i < P; i++) { const t = teamOf(i, P, teams); (g[t] = g[t] || []).push(i); }
  return Object.keys(g).sort((a, b) => a - b).map((k) => g[k]);
}
function teamsCheck(P, teams, expected) {
  // the partnerships are exactly as specified
  check(JSON.stringify(groupsFor(P, teams)) === JSON.stringify(expected), `P=${P}/teams=${teams}: partnerships ${JSON.stringify(expected)}`);

  let state = reduce(reduce(reduce(initGame(), { type: "SET_SETTING", key: "autoCut", value: false }), { type: "SET_SETTING", key: "players", value: P }), { type: "SET_SETTING", key: "teams", value: teams });
  check(state.settings.teams === teams && state.seats.length === P && state.phase === "cutdeal", `P=${P}/teams=${teams}: game ready`);
  const groups = groupsFor(P, teams);
  let hands = 0, exceptions = 0;
  for (let h = 0; h < 70 && state.phase !== "over"; h++) {
    try {
      state = playHand(state, P);
      hands++;
      for (const m of groups) {
        for (const seat of m) check(state.seats[seat].score === state.seats[m[0]].score, `P=${P}/teams=${teams}: team {${m}} shares a score`);
        const sum = m.reduce((a, s) => a + (state.seats[s].history || []).reduce((x, y) => x + y.pts, 0), 0);
        check(sum === state.seats[m[0]].score, `P=${P}/teams=${teams}: team {${m}} history sums to the shared score`);
      }
      const maxTeam = Math.max(...groups.map((m) => state.seats[m[0]].score));
      const goal = P >= 5 ? 61 : 121; // 5-/6-handed are short games to 61
      if (maxTeam >= goal) check(state.phase === "over", `P=${P}/teams=${teams}: game ends once a team reaches ${goal}`);
      if (state.phase === "deal") check(maxTeam < goal, `P=${P}/teams=${teams}: no uncrowned team between hands`);
    } catch (e) { exceptions++; console.error("  ✗ teams exception", P, teams, h, e.message); }
  }
  check(exceptions === 0, `P=${P}/teams=${teams}: no exceptions across many hands`);
  check(hands >= 1, `P=${P}/teams=${teams}: played at least one full hand`);
}
teamsCheck(4, 2, [[0, 2], [1, 3]]);       // across-the-table pairs
teamsCheck(6, 3, [[0, 3], [1, 4], [2, 5]]); // across pairs
teamsCheck(6, 2, [[0, 2, 4], [1, 3, 5]]);   // every other seat, three to a team

/* ---- gameRecord: the finished-game history summary (React-path only, so the whole-hand
       drivers above never exercise it). Categorize team points by label, combine partners,
       and bucket the outcome by the per-target skunk lines. ---- */
{
  const mk = (P, teams, hist, winner) => ({
    settings: { players: P, teams }, winner,
    seats: hist.map((h) => ({ history: h, score: (h || []).reduce((a, x) => a + x.pts, 0) })),
  });
  // 4-handed solo: categories split by label; a win.
  let st = mk(4, 4, [[{ pts: 8, label: "pegging · run" }, { pts: 2, label: "his heels" }, { pts: 8, label: "hand · 15s" }, { pts: 5, label: "crib · run" }], [], [], []], 0);
  st.seats[0].score = 121;
  let r = gameRecord(st);
  check(r.peg === 10 && r.hand === 8 && r.crib === 5, `gameRecord categorizes peg/hand/crib (his-heels→peg) got ${r.peg}/${r.hand}/${r.crib}`);
  check(r.outcome === "won" && r.P === 4 && r.teams === 4, `gameRecord records a win + config (${r.outcome})`);
  // 4/2 teams: partners 0 & 2 combine.
  st = mk(4, 2, [[{ pts: 4, label: "pegging · pair" }, { pts: 4, label: "hand · 15s" }], [{ pts: 99, label: "pegging" }], [{ pts: 3, label: "crib · run" }, { pts: 2, label: "pegging · go" }], []], 0);
  st.seats[0].score = 60;
  r = gameRecord(st);
  check(r.peg === 6 && r.hand === 4 && r.crib === 3, `gameRecord combines partner points got ${r.peg}/${r.hand}/${r.crib}`);
  check(gameRecord(Object.assign(mk(2, 2, [[{ pts: 5, label: "muggins" }, { pts: 7, label: "hand" }], []], 1), {})).hand === 12, "gameRecord lumps muggins into hand");
  // outcome buckets vs the per-target skunk lines.
  const lossAt = (P, teams, score) => { const s = mk(P, teams, [[{ pts: score, label: "hand" }], [{ pts: 999, label: "x" }]], 1); s.seats[0].score = score; return gameRecord(s).outcome; };
  check(lossAt(2, 2, 100) === "lost" && lossAt(2, 2, 90) === "skunked" && lossAt(2, 2, 60) === "doubleSkunked", "gameRecord 121 skunk lines 90/60");
  check(lossAt(6, 6, 31) === "lost" && lossAt(6, 6, 30) === "skunked" && lossAt(6, 6, 15) === "doubleSkunked", "gameRecord 61 skunk lines 30/15");
}

/* ---- Mixed human/bot games (settings.seats): with 2+ human seats the discard phase
       cycles through each human thrower (discardSeat) and the rest still auto-throw; the
       reducer otherwise drives identically. Drive whole games through the reducer. ---- */
function seatHuman(i, roles) { var v = roles[i]; return v === "human" ? true : (v ? false : i === 0); }   // easy/medium/hard/bot are all bots
function mixedGame(P, roles, seed) {
  // build a cutdeal state then inject the seat roles before dealing
  let state = reduce(reduce(initGame(), { type: "SET_SETTING", key: "autoCut", value: false }), { type: "SET_SETTING", key: "players", value: P });
  state = reduce(state, { type: "SET_SETTING", key: "seats", value: roles });
  check(state.settings.seats === roles, `mixed P=${P}: seats stored`);
  let guard = 0, hands = 0;
  while (state.phase !== "over" && guard++ < 4000) {
    if (state.phase === "cutdeal" || state.phase === "deal") { state = dealAll(state); }
    else if (state.phase === "cribbing") { state = reduce(state, { type: "CRIB_DONE" }); }
    else if (state.phase === "discard") {
      const seat = state.discardSeat;
      check(seatHuman(seat, roles), `mixed P=${P}: discardSeat ${seat} is human`);
      const n = plan(P, state.dealerIdx).throws[seat];
      check(n > 0, `mixed P=${P}: discardSeat ${seat} actually throws`);
      state = reduce(state, { type: "DISCARD", idxs: n === 2 ? [0, 1] : [0] });
    } else if (state.phase === "cut") {
      // every human thrower committed; bots already threw → crib full
      check(state.crib.length === 4 && state.discardSeat === null, `mixed P=${P}: crib of 4, discard done`);
      state = reduce(state, { type: "CUT" });
    } else if (state.phase === "play") {
      if (state.peg.pending31) { state = reduce(state, { type: "RESET_31" }); continue; }   // clear the frozen 31 pile
      const { hands: h, turn, count } = state.peg;
      const legal = h[turn].filter((c) => pval(c.r) + count <= 31);
      if (legal.length === 0) { state = reduce(state, { type: "PASS_GO", seat: turn }); continue; }
      const rank = pegChoose(legal.map((c) => c.r), count, state.peg.pile, h[turn].map((c) => c.r));
      state = reduce(state, { type: "PLAY_CARD", seat: turn, card: legal.find((c) => c.r === rank) || legal[0] });
    } else if (state.phase === "show") {
      state = reduce(state, state.show.scored ? { type: "SHOW_NEXT" } : { type: "SHOW_SCORE" });
      if (state.phase === "deal") hands++;
    } else break;
  }
  check(state.phase === "over", `mixed P=${P} seed=${seed}: reaches a winner (phase ${state.phase})`);
  check(state.seats.every((s, i) => s.isAI === !seatHuman(i, roles)), `mixed P=${P}: each seat's isAI matches its configured role`);
}
mixedGame(4, ["human", "bot", "human", "bot"], 1);  // you + across partner human, others bots
mixedGame(6, ["human", "bot", "bot", "human", "bot", "bot"], 2);
mixedGame(2, ["human", "human"], 3);                 // both human (hot-seat heads-up)
mixedGame(4, ["bot", "human", "bot", "bot"], 4);     // South is a bot; lone human elsewhere
mixedGame(4, ["bot", "bot", "bot", "bot"], 5);       // all bots — a spectated game
mixedGame(4, ["human", "easy", "hard", "medium"], 6); // per-seat bot difficulty levels classify as bots

/* ---- Auto-cut (default on): the cut phase is skipped — after the last discard the state
   goes straight to play with the starter already turned, no visible "cut" phase. ---- */
function autoCutSkips(P) {
  let state = reduce(reduce(initGame(), { type: "SET_SETTING", key: "autoCut", value: true }), { type: "SET_SETTING", key: "players", value: P });
  check(state.settings.autoCut === true, `autoCut P=${P}: enabled`);
  state = dealAll(state);
  // human (seat 0) throws unless it's a non-thrower seat; either way we should land on play
  if (state.phase === "discard") {
    const n = plan(P, state.dealerIdx).throws[0];
    state = reduce(state, { type: "DISCARD", idxs: n === 2 ? [0, 1] : [0] });
  }
  if (state.phase === "cribbing") state = reduce(state, { type: "CRIB_DONE" });   // the completing throw holds for its animation; advance it
  check(state.phase === "play", `autoCut P=${P}: cut phase skipped → straight to play`);
  check(state.starter && typeof state.starter.r === "number", `autoCut P=${P}: starter turned automatically`);
  check(state.crib.length === 4, `autoCut P=${P}: crib of 4`);
}
for (const P of SUPPORTED) autoCutSkips(P);

console.log(`\nplay.html engine checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
