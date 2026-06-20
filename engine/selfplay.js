#!/usr/bin/env node
/* engine/selfplay.js — full-game self-play harness (engine item #2, Phase 1).
 *
 * The existing engine/calibrate_split.js calibrates single-hand discard behavior; nothing
 * yet plays a COMPLETE game (deal → … → someone reaches the target) and tracks the outcome.
 * The win-probability model needs the distribution of points a side scores in ONE hand, by
 * role, so it can model the race to the target. This harness produces exactly that.
 *
 * Like engine/verify_play.js, it evals the compiled play.html <script> in a vm sandbox and
 * drives the real reducer (no reimplementation — zero divergence risk). Every seat is set to
 * a bot, so the reducer auto-throws and we only drive the phase transitions + pegging choices.
 *
 * Two products, both printed and written to engine/winprob_stats.json:
 *   1) HEADS-UP per-hand increment histograms (dealer-side total, pone-side total) — feed the
 *      heads-up dynamic-program win-prob table in src/winprob.js.
 *   2) Per-config (P, teams) per-hand team increment mean/var — feed the analytic race model.
 *
 * Increments are sampled at NEUTRAL scores (each sample is one hand from a fresh 0-0 game), so
 * the bots play board-mode "ev" (the σ heuristic is off) and no hand is truncated by a win.
 * That is the board-neutral natural distribution; the win-prob model re-introduces the
 * strategic (risk) adjustment itself.
 *
 * Run:  node engine/selfplay.js [hands] [--full]
 *   hands   per-config sample count (default 20000; use 100000+ for a bake-quality run)
 *   --full  also run the policy-mirror win-rate sanity (full games to target)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "play.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

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
const { reduce, initGame, pegChoose, plan, teamOf } = S;
const pval = (r) => Math.min(r, 10);
const targetFor = (P) => (P >= 5 ? 61 : 121);
const allBots = (P) => Array.from({ length: P }, () => "hard");

/* --- reducer drivers (mirrors verify_play.js) --- */
function cutAll(state) {
  let guard = 0;
  while (state.phase === "cutdeal" && state.cutDeal && !state.cutDeal.settled && guard++ < 600)
    state = reduce(state, state.cutDeal.tie ? { type: "CUT_REDRAW" } : { type: "CUT_NEXT" });
  return state;
}
function dealAll(state) {
  state = cutAll(state);
  state = reduce(state, { type: "DEAL" });
  let guard = 0;
  while (state.phase === "dealing" && guard++ < 80) state = reduce(state, { type: "DEAL_NEXT" });
  return state;
}
// Start a fresh all-bot game for size P / teams.
function newGame(P, teams) {
  let s = reduce(initGame(), { type: "SET_SETTING", key: "autoCut", value: false });
  s = reduce(s, { type: "SET_SETTING", key: "counting", value: "auto" });
  s = reduce(s, { type: "SET_SETTING", key: "players", value: P });
  s = reduce(s, { type: "SET_SETTING", key: "teams", value: teams });
  return reduce(s, { type: "SET_SETTING", key: "seats", value: allBots(P) });
}
// Drive one full hand from a deal/cutdeal phase through the show back to deal/over. All seats
// are bots, so discards are automatic; we only clock pegging + the show. Returns the new state
// and `dealer` = the seat that dealt THIS hand (captured before the reducer rotates it for the
// next hand on the show→deal transition).
function playHand(state, P) {
  state = dealAll(state);                                   // through discard (bots auto-throw) to cut
  const dealer = state.dealerIdx;                           // this hand's dealer, before any rotation
  if (state.phase === "cribbing") state = reduce(state, { type: "CRIB_DONE" });
  if (state.phase === "cut") state = reduce(state, { type: "CUT" });
  let guard = 0;
  while (state.phase === "play" && guard++ < 400) {
    if (state.peg.pending31) { state = reduce(state, { type: "RESET_31" }); continue; }
    const { hands, turn, count } = state.peg;
    const legal = hands[turn].filter((c) => pval(c.r) + count <= 31);
    if (legal.length === 0) { state = reduce(state, { type: "PASS_GO", seat: turn }); continue; }
    const rank = pegChoose(legal.map((c) => c.r), count, state.peg.pile, hands[turn].map((c) => c.r));
    state = reduce(state, { type: "PLAY_CARD", seat: turn, card: legal.find((c) => c.r === rank) || legal[0] });
  }
  guard = 0;
  while (state.phase === "show" && guard++ < 20) state = reduce(state, state.show.scored ? { type: "SHOW_NEXT" } : { type: "SHOW_SCORE" });
  return { state, dealer };
}

/* --- histogram helpers --- */
const CAP = 60;                                            // a single hand+crib+peg side rarely exceeds this
function newHist() { return new Array(CAP + 1).fill(0); }
function add(h, v) { h[Math.max(0, Math.min(CAP, v | 0))]++; }
function statsOf(h) {
  let n = 0, s = 0, s2 = 0;
  for (let v = 0; v <= CAP; v++) { n += h[v]; s += v * h[v]; s2 += v * v * h[v]; }
  const mean = n ? s / n : 0;
  return { n, mean, var: n ? Math.max(0, s2 / n - mean * mean) : 0 };
}
// Normalize a histogram to a probability array (trailing zeros trimmed) for baking.
function pmf(h) {
  const st = statsOf(h); if (!st.n) return [];
  let top = CAP; while (top > 0 && h[top] === 0) top--;
  return h.slice(0, top + 1).map((c) => +(c / st.n).toFixed(6));
}

/* --- 1) HEADS-UP per-hand increment histograms (board-neutral) --- */
function headsUpHist(hands) {
  const dealerH = newHist(), poneH = newHist();
  for (let k = 0; k < hands; k++) {
    const r = playHand(newGame(2, 2), 2);                 // one hand from 0-0 → no win truncation, "ev" mode
    const st = r.state, d = r.dealer, p = 1 - d;
    add(dealerH, st.seats[d].score);                       // started at 0, so score == this hand's points
    add(poneH, st.seats[p].score);
  }
  return { dealer: dealerH, pone: poneH };
}

/* --- 2) Per-config team increment mean/var (board-neutral, one hand from 0-0) --- */
function configStats(P, teams, hands) {
  // Track the dealer's team vs a representative non-dealer team, one hand at a time.
  const dealTeamH = newHist(), defTeamH = newHist();
  for (let k = 0; k < hands; k++) {
    const r = playHand(newGame(P, teams), P);
    const st = r.state;
    const dTeam = teamOf(r.dealer, P, teams);
    // a team's running score is shared across its seats, so seats[i].score already equals the
    // team total — take one representative per team and classify dealer-team vs the rest
    const seen = new Set(); const perTeam = [];
    for (let i = 0; i < P; i++) { const t = teamOf(i, P, teams); if (!seen.has(t)) { seen.add(t); perTeam.push({ t, pts: st.seats[i].score }); } }
    for (const { t, pts } of perTeam) { if (t === dTeam) add(dealTeamH, pts); else add(defTeamH, pts); }
  }
  return { deal: statsOf(dealTeamH), def: statsOf(defTeamH) };
}

/* --- main --- */
const HANDS = parseInt(process.argv[2], 10) || 20000;
const FULL = process.argv.includes("--full");
const t0 = Date.now();
console.log(`self-play increment sampling: ${HANDS} hands/config …`);

const hu = headsUpHist(HANDS);
const huDealer = statsOf(hu.dealer), huPone = statsOf(hu.pone);
console.log(`\nHEADS-UP per-hand points (board-neutral, ${HANDS} hands):`);
console.log(`  dealer side: mean ${huDealer.mean.toFixed(2)}  sd ${Math.sqrt(huDealer.var).toFixed(2)}`);
console.log(`  pone   side: mean ${huPone.mean.toFixed(2)}  sd ${Math.sqrt(huPone.var).toFixed(2)}`);

const CONFIGS = [[2, 2], [3, 3], [4, 4], [4, 2], [5, 5], [6, 6], [6, 3], [6, 2]];
const general = {};
console.log(`\nPER-CONFIG team per-hand points (mean / sd), dealer-team vs other-team:`);
for (const [P, teams] of CONFIGS) {
  const cs = configStats(P, teams, Math.min(HANDS, 5000));   // mean/var converge fast; cap the config sweep
  general[`${P}-${teams}`] = {
    target: targetFor(P),
    deal: { mean: +cs.deal.mean.toFixed(3), var: +cs.deal.var.toFixed(3) },
    def: { mean: +cs.def.mean.toFixed(3), var: +cs.def.var.toFixed(3) },
  };
  console.log(`  ${P}-${teams}: deal ${cs.deal.mean.toFixed(2)}/${Math.sqrt(cs.deal.var).toFixed(2)}  def ${cs.def.mean.toFixed(2)}/${Math.sqrt(cs.def.var).toFixed(2)}  (target ${targetFor(P)})`);
}

const out = {
  generatedHands: HANDS,
  headsUp: {
    dealer: { mean: +huDealer.mean.toFixed(4), var: +huDealer.var.toFixed(4), pmf: pmf(hu.dealer) },
    pone: { mean: +huPone.mean.toFixed(4), var: +huPone.var.toFixed(4), pmf: pmf(hu.pone) },
  },
  general,
};

/* --- optional: policy-mirror win-rate sanity (full games to target) --- */
if (FULL) {
  let dealerWins = 0, games = 2000;
  for (let g = 0; g < games; g++) {
    let st = newGame(2, 2);
    const firstDealer = cutAll(st).dealerIdx;
    let guard = 0;
    while (st.phase !== "over" && guard++ < 200) st = playHand(st, 2).state;
    const winner = st.seats[0].score >= 121 ? 0 : 1;
    if (winner === firstDealer) dealerWins++;
  }
  out.firstDealerWinRate = +(dealerWins / games).toFixed(3);
  console.log(`\nfull-game sanity: first dealer wins ${(100 * dealerWins / games).toFixed(1)}% of ${games} heads-up games (expect a modest dealer edge)`);
}

fs.writeFileSync(path.join(__dirname, "winprob_stats.json"), JSON.stringify(out, null, 2));
console.log(`\nwrote engine/winprob_stats.json  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
