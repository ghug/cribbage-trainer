#!/usr/bin/env node
/* engine/ab_test.js — head-to-head STRENGTH measurement for the win-probability upgrade.
 *
 * The other harnesses prove correctness; this one measures whether the new engine actually WINS
 * more. It plays full heads-up games of NEW (win-probability discards + depth-1 lookahead pegging)
 * vs OLD (the retired σ/ev-need-protect heuristic + greedy pegging), isolating the two shipped
 * changes. Dealer and seat are swapped game-to-game so neither the dealer edge nor a seat artifact
 * biases the result.
 *
 * Both policies share the SAME EV machinery (handDetail, cribSeed crib estimate) and differ only in
 * (a) how they RANK throws and (b) their pegging policy — so the win-rate gap is attributable to the
 * upgrade, not to different inputs.
 *
 * Run: node engine/ab_test.js [games]   (default 4000)
 */
"use strict";
const fs = require("fs");
const path = require("path");

// Load the shipped primitives the same way verify_winprob.js does (browser-global scripts → captured
// via a Function factory; no module.exports to trip the build's tsc name guard).
const eng = fs.readFileSync(path.join(__dirname, "..", "src", "engine.js"), "utf8");
const wpSrc = fs.readFileSync(path.join(__dirname, "..", "src", "winprob.js"), "utf8");
const lib = new Function(eng + "\n" + wpSrc + "\n return { scoreInto, handDetail, pegScore, pegChoose, pegChooseDeep, pval, winProbHand };")();
const { scoreInto, handDetail, pegScore, pegChoose, pegChooseDeep, pval, winProbHand } = lib;

const CRIB_VALUE = [3.96, 3.95, 4.05, 4.06, 6.38, 4.10, 4.21, 4.34, 4.09, 3.74, 4.19, 3.73, 3.85];
const fifteenVal = (r) => Math.min(r, 10);
function cribSeed(a, b) {
  let v = (CRIB_VALUE[a.r - 1] + CRIB_VALUE[b.r - 1]) * 0.5;
  if (a.r === b.r) v += 2; else if (Math.abs(a.r - b.r) <= 2) v += 0.5;
  if (fifteenVal(a.r) + fifteenVal(b.r) === 15) v += 2;
  return v;
}
const TWO6 = (() => { const o = []; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) o.push([i, j]); return o; })();
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- the OLD σ heuristic (reconstructed from git history; RISK=0.5) ---------- */
const RISK = 0.5, TARGET = 121;
function suggestModeOLD(you, leader) {
  if (leader >= 106 && you < leader) return "need";
  if (you >= leader + 15 && you >= 95) return "protect";
  return "ev";
}
function discardOLD(dealt, cribOurs, myScore, oppScore) {
  const sign = cribOurs ? 1 : -1;
  const mode = suggestModeOLD(myScore, oppScore);
  const cribW = (mode === "protect" && !cribOurs) ? 1.3 : (mode === "need" && !cribOurs) ? 0.9 : 1.0;
  const riskSign = mode === "need" ? 1 : mode === "protect" ? -1 : 0;
  let best = null, bv = -1e9;
  for (const [i, j] of TWO6) {
    const four = dealt.filter((_, k) => k !== i && k !== j);
    const thrown = [dealt[i], dealt[j]];
    const hd = handDetail(four, dealt);
    const val = hd.ev + sign * cribW * cribSeed(thrown[0], thrown[1]) + riskSign * RISK * hd.sd;
    if (val > bv) { bv = val; best = { kept: four, crib: thrown }; }
  }
  return best;
}
/* ---------- the NEW win-probability ranking ---------- */
function discardNEW(dealt, cribOurs, myScore, oppScore) {
  const board = { yourToGo: TARGET - myScore, oppToGo: TARGET - oppScore, youDeal: cribOurs, P: 2, teams: 2 };
  let best = null, bv = -1e9;
  for (const [i, j] of TWO6) {
    const four = dealt.filter((_, k) => k !== i && k !== j);
    const thrown = [dealt[i], dealt[j]];
    const hd = handDetail(four, dealt);
    const cribVal = cribSeed(thrown[0], thrown[1]);
    const val = winProbHand(board, hd.ev + (cribOurs ? cribVal : 0), hd.sd, cribOurs ? 0 : cribVal);
    if (val > bv) { bv = val; best = { kept: four, crib: thrown }; }
  }
  return best;
}
const POLICY = {
  NEW: { discard: discardNEW, peg: "deep" },
  OLD: { discard: discardOLD, peg: "greedy" },
};

/* ---------- one heads-up game; returns { winner, loserScore } ---------- */
function shuffle(rng) { const d = []; for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) d.push({ r, s }); for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; } return d; }

// pegging for two seats with per-seat policy; mutates scores, returns winner seat or -1
function pegGame(kept, dealer, pol, scores) {
  const hands = [kept[0].map((c) => c.r), kept[1].map((c) => c.r)];   // suits dropped for pegging
  const played = new Array(14).fill(0);
  let turn = (dealer + 1) % 2, count = 0, pile = [], passes = 0, last = -1, remaining = 4 + 4;
  const award = (seat, pts) => { scores[seat] += pts; return scores[seat] >= TARGET; };
  while (remaining > 0) {
    const hand = hands[turn], legal = hand.filter((c) => pval(c) + count <= 31);
    if (legal.length === 0) {
      if (++passes >= 2) { if (last >= 0 && count !== 31) { if (award(last, 1)) return last; } count = 0; pile = []; passes = 0; last = -1; }
      turn = (turn + 1) % 2; continue;
    }
    let card;
    if (pol[turn].peg === "deep") {
      const unseen = []; for (let r = 1; r <= 13; r++) { let a = 4 - played[r]; for (const c of hand) if (c === r) a--; for (let k = 0; k < a; k++) unseen.push(r); }
      card = pegChooseDeep(legal, count, pile, hand, unseen);
    } else card = pegChoose(legal, count, pile, hand);
    hand.splice(hand.indexOf(card), 1); remaining--; played[card]++;
    count += pval(card); pile.push(card);
    if (award(turn, pegScore(pile, count))) return turn;
    last = turn; passes = 0;
    if (count === 31) { count = 0; pile = []; last = -1; }
    turn = (turn + 1) % 2;
  }
  if (last >= 0) { if (award(last, 1)) return last; }
  return -1;
}

function playGame(seed, polBySeat, firstDealer) {
  const rng = mulberry32(seed);
  const scores = [0, 0];
  let dealer = firstDealer, safety = 0;
  while (scores[0] < TARGET && scores[1] < TARGET && safety++ < 400) {
    const deck = shuffle(rng), pone = 1 - dealer;
    const kept = [null, null], crib = [];
    const dealt = [null, null];
    dealt[dealer] = deck.slice(0, 6); dealt[pone] = deck.slice(6, 12);
    const starter = deck[12];
    for (const seat of [dealer, pone]) {                              // dealer throws first, then pone
      const r = polBySeat[seat].discard(dealt[seat], seat === dealer, scores[seat], scores[1 - seat]);
      kept[seat] = r.kept; crib.push(...r.crib);
    }
    if (starter.r === 11) { scores[dealer] += 2; if (scores[dealer] >= TARGET) break; }   // his heels
    const pegWinner = pegGame(kept, dealer, polBySeat, scores);
    if (pegWinner >= 0) break;
    // the show: pone counts, then dealer, then dealer's crib — stop the instant someone hits 121
    const acc = [0, 0, 0, 0, 0];
    scores[pone] += scoreInto(kept[pone], starter, false, acc); if (scores[pone] >= TARGET) break;
    scores[dealer] += scoreInto(kept[dealer], starter, false, acc); if (scores[dealer] >= TARGET) break;
    scores[dealer] += scoreInto(crib, starter, true, acc); if (scores[dealer] >= TARGET) break;
    dealer = pone;
  }
  const winner = scores[0] >= TARGET ? 0 : 1;
  return { winner, loserScore: scores[1 - winner] };
}

/* ---------- run a match: each deck is played BOTH ways (A at seat 0 and A at seat 1) with the same
   first dealer, so the seat edge and the first-dealer edge both cancel exactly (identical policies ⇒
   exactly 50%). ---------- */
function match(label, polA, polB, decks) {
  let aWins = 0, aSkunks = 0, bSkunks = 0, n = 0;
  for (let g = 0; g < decks; g++) {
    const seed = (g * 2654435761) >>> 0, fd = g & 1;                 // first dealer fixed per deck
    for (const aSeat of [0, 1]) {                                    // cross the seat assignment
      const pol = aSeat === 0 ? [polA, polB] : [polB, polA];
      const { winner, loserScore } = playGame(seed, pol, fd);
      n++;
      if (winner === aSeat) { aWins++; if (loserScore <= 90) aSkunks++; }
      else if (loserScore <= 90) bSkunks++;
    }
  }
  const wr = 100 * aWins / n, ci = 1.96 * 100 * Math.sqrt(0.25 / n);
  console.log(`  ${label}: ${wr.toFixed(1)}% ±${ci.toFixed(1)}  (A skunks ${aSkunks} · B skunks ${bSkunks})`);
  return wr;
}

const GAMES = parseInt(process.argv[2], 10) || 4000;
console.log(`\nHEADS-UP A/B, ${GAMES} games each (win rate of the FIRST-named policy):`);
console.log(`  --- fairness mirrors (expect ~50%) ---`);
match("NEW vs NEW", POLICY.NEW, POLICY.NEW, GAMES);
match("OLD vs OLD", POLICY.OLD, POLICY.OLD, GAMES);
console.log(`  --- the upgrade (>50% ⇒ stronger) ---`);
match("NEW vs OLD       ", POLICY.NEW, POLICY.OLD, GAMES);
// decompose: which half of the upgrade carries it?
match("win-prob discard only", { discard: discardNEW, peg: "greedy" }, POLICY.OLD, GAMES);
match("deep pegging only    ", { discard: discardOLD, peg: "deep" }, POLICY.OLD, GAMES);
