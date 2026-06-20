#!/usr/bin/env node
/* engine/ismcts.js — determinized search for cribbage's imperfect information (layer 1 of the
 * IS-MCTS / AlphaZero-inspired self-play loop).
 *
 * Cribbage hides the opponents' hands and the crib, so a plain searcher can't evaluate a position.
 * This handles it the right way: at decision time it DETERMINIZES — samples concrete opponent hands
 * from the genuinely-unseen pool (52 − your cards − the public pile − the starter), consistent with
 * how many cards each opponent still holds — then evaluates each of your legal plays by its average
 * outcome across many such samples. The determinization distribution IS the opponent model, drawn
 * from the real unseen cards rather than any hand-tuned weighting.
 *
 * PURE (tabula rasa): the only knowledge is the rules and the real terminal margin — no policy or
 * heuristic. PIMC-style: sample a determinization, then EXACTLY solve the resulting perfect-information
 * pegging subgame (alpha-beta minimax to terminal) to score each candidate move, and average over
 * determinizations. Pegging is short enough to solve exactly, so no rollout policy (greedy or random)
 * is needed. Later layers: a learned value to approximate this for speed / extend past the pegging
 * horizon, and the proper IS-MCTS tree (the endgoal). Heads-up pegging for now.
 *
 * Run standalone for a self-test:  node engine/ismcts.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

// Load the shipped pegging primitives (browser-global scripts → Function factory, like the other
// engine/ harnesses) so the search scores exactly as the app does.
const eng = fs.readFileSync(path.join(__dirname, "..", "src", "engine.js"), "utf8");
const { pegScore, pegChoose, pval } = new Function(eng + "\n return { pegScore, pegChoose, pval };")();

// PURE exact solve of a heads-up determinized (perfect-information) pegging subgame: returns the
// optimal points differential (seat0 − seat1) from this state to the end, seat 0 maximising and
// seat 1 minimising. No policy/heuristic — only the rules and the real terminal margin (incl. the
// last-card point). Pegging is short, so alpha-beta to terminal is cheap. (Heads-up only.)
function solvePeg(hands, turn, count, pile, last, passes, alpha, beta) {
  if (hands[0].length === 0 && hands[1].length === 0) return last >= 0 ? (last === 0 ? 1 : -1) : 0;
  const hand = hands[turn], legal = hand.filter((c) => pval(c) + count <= 31);
  if (legal.length === 0) {                                // "go"
    let add = 0, nc = count, npile = pile, nlast = last, np = passes + 1;
    if (np >= 2) { if (last >= 0 && count !== 31) add = last === 0 ? 1 : -1; nc = 0; npile = []; nlast = -1; np = 0; }
    return add + solvePeg(hands, turn ^ 1, nc, npile, nlast, np, alpha, beta);
  }
  let best = turn === 0 ? -Infinity : Infinity;
  for (const c of legal) {
    const h2 = [hands[0].slice(), hands[1].slice()];
    h2[turn].splice(h2[turn].indexOf(c), 1);
    let nc = count + pval(c); const npile = pile.concat(c);
    const imm = pegScore(npile, nc) * (turn === 0 ? 1 : -1);
    let fpile = npile, nlast = turn, ncount = nc;
    if (nc === 31) { ncount = 0; fpile = []; nlast = -1; }
    const v = imm + solvePeg(h2, turn ^ 1, ncount, fpile, nlast, 0, alpha, beta);
    if (turn === 0) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;                              // alpha-beta cutoff
  }
  return best;
}

/* Determinized pegging search. The acting seat `me` knows only `myHand` (ranks), the public pile and
 * the rank counts everyone has played; opponents' specific cards are sampled.
 *   view = { myHand, seatSizes, me, count, pile, played, starter, P, last, passes }
 *     seatSizes[s] = cards seat s still holds (seatSizes[me] === myHand.length)
 *     played       = flat array of ranks already played this hand (public)
 *     starter      = the cut card's rank (public) or null
 * Returns the chosen rank (or the only/least card when the choice is forced).
 */
function pegSearch(view, iters = 200) {
  const { myHand, seatSizes, me, count, pile, played, starter, P, last = -1, passes = 0 } = view;
  const legal = myHand.filter((c) => pval(c) + count <= 31);
  if (legal.length <= 1) return legal.length ? legal[0] : null;

  // the unseen pool: a full deck minus what `me` can see (own hand, the played pile, the starter)
  const avail = new Array(14).fill(4);
  for (const r of played) avail[r]--;
  for (const r of myHand) avail[r]--;
  if (starter) avail[starter]--;
  const pool = [];
  for (let r = 1; r <= 13; r++) for (let k = 0; k < Math.max(0, avail[r]); k++) pool.push(r);

  const sum = new Map(legal.map((c) => [c, 0])), n = new Map(legal.map((c) => [c, 0]));
  for (let it = 0; it < iters; it++) {
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    const det = new Array(P);
    det[me] = myHand.slice();
    let oi = 0;
    for (let s = 0; s < P; s++) { if (s === me) continue; det[s] = pool.slice(oi, oi + seatSizes[s]); oi += seatSizes[s]; }
    // evaluate every legal first move by EXACTLY solving the determinized subgame (pure: optimal
    // continuation for both sides, real terminal margin — no rollout policy). Paired across moves.
    for (const c of legal) {
      const h2 = [det[0].slice(), det[1].slice()];
      h2[me].splice(h2[me].indexOf(c), 1);
      let nc = count + pval(c); const npile = pile.concat(c);
      const imm = pegScore(npile, nc) * (me === 0 ? 1 : -1);
      let fpile = npile, nlast = me, ncount = nc;
      if (nc === 31) { ncount = 0; fpile = []; nlast = -1; }
      const diff = imm + solvePeg(h2, me ^ 1, ncount, fpile, nlast, 0, -Infinity, Infinity);   // (seat0 − seat1)
      const margin = me === 0 ? diff : -diff;             // → from my perspective
      sum.set(c, sum.get(c) + margin); n.set(c, n.get(c) + 1);
    }
  }
  let best = legal[0], bv = -1e9;
  for (const c of legal) { const v = sum.get(c) / Math.max(1, n.get(c)); if (v > bv) { bv = v; best = c; } }
  return best;
}

module.exports = { pegSearch, solvePeg };

/* ---------------- self-test ---------------- */
if (require.main === module) {
  let ok = 0, fail = 0;
  const check = (c, m) => { if (c) ok++; else { fail++; console.error("  ✗ " + m); } };
  const base = { seatSizes: [1, 1], me: 0, pile: [], played: [], starter: null, P: 2 };

  // forced move: a single legal card is returned
  check(pegSearch({ ...base, myHand: [7], count: 20 }, 50) === 7, "returns the only legal card");

  // obvious tactics (search should pick the high-value play almost always)
  const mode = (view, iters, trials = 40) => { const t = {}; for (let i = 0; i < trials; i++) { const c = pegSearch(view, iters); t[c] = (t[c] || 0) + 1; } return +Object.keys(t).reduce((a, b) => (t[b] > (t[a] || 0) ? b : a)); };
  // hold {5, 9}; count is 6 → playing the 9 makes fifteen (2 pts). Should strongly prefer the 9.
  check(mode({ ...base, seatSizes: [2, 2], myHand: [5, 9], count: 6 }, 150) === 9, "takes the fifteen (plays 9 to reach 15)");
  // hold {6, 10}; count is 21 → playing the 10 hits 31 (2). Prefer the 10.
  check(mode({ ...base, seatSizes: [2, 2], myHand: [6, 10], count: 21 }, 150) === 10, "takes 31 (plays 10 to reach 31)");
  // legality: never returns a card that busts 31
  let legalOK = true;
  for (let i = 0; i < 200; i++) { const c = pegSearch({ ...base, seatSizes: [3, 3], myHand: [4, 8, 12], count: 22, played: [9, 9] }, 30); if (pval(c) + 22 > 31) legalOK = false; }
  check(legalOK, "never returns an illegal (>31) card");

  console.log(`\nismcts pegging search self-test: ${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
