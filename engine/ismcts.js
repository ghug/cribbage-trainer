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
 * This first cut is PIMC-style (Perfect-Information Monte-Carlo): sample a determinization, play each
 * candidate first move out greedily, average the pegging margin. That already reasons about hidden
 * cards correctly and is the foundation; the tree/UCB refinements and a learned leaf value replace the
 * greedy rollout in later layers. Pure pegging for now (discard search comes next).
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

// Greedy perfect-information playout from a pegging state → points each seat scores to the end.
function pegRollout(hands, turn, count, pile, last, passes, P) {
  hands = hands.map((h) => h.slice());
  const pts = new Array(P).fill(0);
  let remaining = hands.reduce((s, h) => s + h.length, 0);
  while (remaining > 0) {
    const hand = hands[turn], legal = hand.filter((c) => pval(c) + count <= 31);
    if (legal.length === 0) {
      if (++passes >= P) { if (last >= 0 && count !== 31) pts[last] += 1; count = 0; pile = []; passes = 0; last = -1; }
      turn = (turn + 1) % P; continue;
    }
    const card = pegChoose(legal, count, pile, hand);
    hand.splice(hand.indexOf(card), 1); remaining--; count += pval(card); pile.push(card);
    pts[turn] += pegScore(pile, count); last = turn; passes = 0;
    if (count === 31) { count = 0; pile = []; last = -1; }
    turn = (turn + 1) % P;
  }
  if (last >= 0) pts[last] += 1;
  return pts;
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
    // evaluate every legal first move against THIS determinization (paired → low variance)
    for (const c of legal) {
      const hands = det.map((h) => h.slice());
      let cnt = count, pl = pile.slice(), lst = last;
      hands[me].splice(hands[me].indexOf(c), 1);
      cnt += pval(c); pl.push(c);
      const pts = new Array(P).fill(0);
      pts[me] += pegScore(pl, cnt); lst = me;
      if (cnt === 31) { cnt = 0; pl = []; lst = -1; }
      const rp = pegRollout(hands, (me + 1) % P, cnt, pl, lst, 0, P);
      for (let s = 0; s < P; s++) pts[s] += rp[s];
      let others = 0; for (let s = 0; s < P; s++) if (s !== me) others += pts[s];
      const margin = pts[me] * (P - 1) - others;          // heads-up: pts[me] − pts[opp]
      sum.set(c, sum.get(c) + margin); n.set(c, n.get(c) + 1);
    }
  }
  let best = legal[0], bv = -1e9;
  for (const c of legal) { const v = sum.get(c) / Math.max(1, n.get(c)); if (v > bv) { bv = v; best = c; } }
  return best;
}

module.exports = { pegSearch, pegRollout };

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
