#!/usr/bin/env node
/* engine/verify_winprob.js — checks the win-probability model in src/winprob.js (engine item #2).
 *
 * Asserts the structural properties a win-prob surface must have, and pins the heads-up dynamic
 * program against an independent Monte-Carlo rollout drawn from the same baked increment pmfs.
 *
 * Run: node engine/verify_winprob.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const stats = require("./winprob_stats.json");

// src/winprob.js is a browser-global script (no module.exports — that would trip the build's tsc
// name guard on `module`). Load it by evaluating its source and capturing the globals it defines,
// the same spirit as how verify_play.js pulls functions out of the built page.
const wpSrc = fs.readFileSync(path.join(__dirname, "..", "src", "winprob.js"), "utf8");
const wp = new Function(wpSrc + "\n return { winProb, winProbHand, WINPROB_STATS, _wpHeadsUp, _wpRace, _phi, _buildHeadsUp: function(){ _huTable = null; _buildHeadsUp(); } };")();

// Use the freshly-generated stats so the harness tracks the latest self-play run even before the
// numbers are baked into src/winprob.js. (After baking, these match the module's own constants.)
wp.WINPROB_STATS.headsUp.dealer.pmf = stats.headsUp.dealer.pmf;
wp.WINPROB_STATS.headsUp.pone.pmf = stats.headsUp.pone.pmf;
wp.WINPROB_STATS.headsUp.dealer.mean = stats.headsUp.dealer.mean;
wp.WINPROB_STATS.headsUp.pone.mean = stats.headsUp.pone.mean;
for (const k of Object.keys(stats.general)) wp.WINPROB_STATS.general[k] = stats.general[k];
wp._buildHeadsUp();

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) ok++; else { fail++; console.error("  ✗ " + msg); } };
const approx = (a, b, tol, msg) => check(Math.abs(a - b) <= tol, `${msg} (${a.toFixed(4)} vs ${b.toFixed(4)}, Δ${Math.abs(a - b).toFixed(4)})`);
const board = (a, b, deal, P = 2, teams = 2) => ({ yourToGo: a, oppToGo: b, youDeal: deal, P, teams });

/* ---- A. boundaries ---- */
check(wp.winProb(board(0, 50, true)) === 1, "yourToGo<=0 ⇒ already won");
check(wp.winProb(board(50, 0, true)) === 0, "oppToGo<=0 ⇒ already lost");
check(wp.winProb(board(1, 121, true)) > 0.97, "need 1 vs 121 ⇒ ~certain win");
check(wp.winProb(board(121, 1, true)) < 0.03, "need 121 vs 1 ⇒ ~certain loss");

/* ---- B. heads-up: zero-sum symmetry  WP(a,b,deal) == 1 - WP(b,a,!deal) ---- */
let symOK = true;
for (const [a, b, d] of [[121, 121, true], [60, 40, true], [10, 30, false], [5, 5, true], [90, 100, false]]) {
  if (Math.abs(wp.winProb(board(a, b, d)) - (1 - wp.winProb(board(b, a, !d)))) > 1e-9) symOK = false;
}
check(symOK, "heads-up WP is zero-sum symmetric");

/* ---- C. monotonicity: more to-go (yours) never raises your WP; more opp to-go never lowers it ---- */
let monoY = true, monoO = true;
for (let a = 2; a <= 121; a++) if (wp.winProb(board(a, 60, true)) > wp.winProb(board(a - 1, 60, true)) + 1e-9) monoY = false;
for (let b = 2; b <= 121; b++) if (wp.winProb(board(60, b, true)) < wp.winProb(board(60, b - 1, true)) - 1e-9) monoO = false;
check(monoY, "WP non-increasing in your own to-go");
check(monoO, "WP non-decreasing in opponent to-go");

/* ---- D. heads-up DP vs Monte-Carlo rollout from the same pmfs ---- */
function sampleFrom(pmf) { let u = Math.random(), i = 0; while (i < pmf.length - 1 && (u -= pmf[i]) > 0) i++; return i; }
function rolloutWin(a0, b0, deal0) {
  let a = a0, b = b0, deal = deal0;                       // deal: true = you deal this hand
  for (let h = 0; h < 200; h++) {
    const you = sampleFrom(deal ? stats.headsUp.dealer.pmf : stats.headsUp.pone.pmf);
    const opp = sampleFrom(deal ? stats.headsUp.pone.pmf : stats.headsUp.dealer.pmf);
    a -= you; b -= opp;
    if (a <= 0 && b <= 0) return deal ? 0 : 1;            // both out: pone (non-dealer) wins
    if (a <= 0) return 1;
    if (b <= 0) return 0;
    deal = !deal;
  }
  return a <= b ? 1 : 0;
}
for (const [a, b, d] of [[30, 30, true], [20, 40, false], [50, 15, true], [15, 50, false]]) {
  const N = 40000; let w = 0; for (let i = 0; i < N; i++) w += rolloutWin(a, b, d);
  approx(w / N, wp.winProb(board(a, b, d)), 0.02, `DP matches rollout at (${a},${b},${d ? "you" : "opp"} deal)`);
}

/* ---- E. ranking convexity: behind ⇒ variance helps; ahead ⇒ variance hurts ---- */
{
  const behind = board(15, 5, false);
  check(wp.winProbHand(behind, 8, 7, 0) > wp.winProbHand(behind, 8, 3, 0) + 0.01, "behind: higher-variance hold has higher win-prob");
  const ahead = board(5, 40, true);
  check(wp.winProbHand(ahead, 8, 3, 0) > wp.winProbHand(ahead, 8, 7, 0) - 1e-6, "ahead: lower-variance hold is at least as good");
  // your crib gift (oppAdd) when you're the pone only ever lowers your win-prob
  check(wp.winProbHand(board(40, 40, false), 8, 3, 0) >= wp.winProbHand(board(40, 40, false), 8, 3, 6) - 1e-9, "gifting the opponent's crib never raises your win-prob");
}

/* ---- F. analytic race (general configs): boundaries + sane mid-game, every config present ---- */
for (const [P, teams] of [[3, 3], [4, 4], [4, 2], [5, 5], [6, 6], [6, 3], [6, 2]]) {
  check(wp.winProb(board(10, 60, true, P, teams)) > 0.9, `${P}-${teams}: far ahead ⇒ high WP`);
  check(wp.winProb(board(60, 10, true, P, teams)) < 0.1, `${P}-${teams}: far behind ⇒ low WP`);
  const mid = wp.winProb(board(60, 60, true, P, teams));
  check(mid > 0.3 && mid < 0.85, `${P}-${teams}: even race is mid-range (${mid.toFixed(2)})`);
}

/* ---- G. baked stats present (guards against shipping empty pmfs) ---- */
check(wp.WINPROB_STATS.headsUp.dealer.pmf.length > 10 && wp.WINPROB_STATS.headsUp.pone.pmf.length > 10, "heads-up pmfs are populated");

console.log(`\nwin-prob model checks: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
