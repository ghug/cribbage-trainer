#!/usr/bin/env node
/* engine/az_train.js — the from-random self-play training loop (AlphaZero loop, layer 4).
 *
 * Ties layers 1-3 together into the actual learning loop, tabula rasa:
 *   1. self-play games where every move is chosen by IS-MCTS guided by the CURRENT net; record
 *      (encoded state, MCTS visit-policy π, player) at each decision; label z = ±1 by who won.
 *   2. train the net by SGD on those targets (value ← z, policy ← π).
 *   3. iterate: the improved net plays stronger self-play → better data → retrain.
 *
 * The honest bar this proves is climbing above RANDOM (the from-zero baseline) and improving across
 * iterations — NOT beating the shipped heuristic engine, which needs far more self-play/compute than
 * a plain-JS CPU sandbox affords. Checkpoints to engine/az_checkpoint.json.
 *
 * Run: node engine/az_train.js [iters] [gamesPerIter] [sims]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { Net } = require("./az_net.js");
const { CribGame } = require("./az_game.js");
const { search } = require("./az_mcts.js");

let _a = (Date.now() & 0x7fffffff) || 1;
const rng = () => { _a |= 0; _a = (_a + 0x6d2b79f5) | 0; let t = Math.imul(_a ^ (_a >>> 15), 1 | _a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const NPOL = CribGame.NPOL;
function sampleSlot(policy) { let u = rng(), c = 0; for (let s = 0; s < NPOL; s++) { c += policy[s]; if (u <= c) return s; } for (let s = NPOL - 1; s >= 0; s--) if (policy[s] > 0) return s; return 0; }
function argmaxLegal(probs, legal) { let m = -1, b = -Infinity; for (let s = 0; s < NPOL; s++) if (legal[s] && probs[s] > b) { b = probs[s]; m = s; } return m; }
function randomLegal(legal) { const ls = []; for (let s = 0; s < NPOL; s++) if (legal[s]) ls.push(s); return ls[(rng() * ls.length) | 0]; }

// one self-play game → labeled training samples
function selfPlay(net, sims, cPuct) {
  const g = new CribGame(rng), samples = [];
  let guard = 0;
  while (!g.done && guard++ < 4000) {
    const player = g.toAct;
    const { policy } = search(g, net, sims, cPuct, rng);
    samples.push({ x: g.encode(player), pi: policy, legal: g.decision.slots.slice(), player });
    g.step(sampleSlot(policy));                            // sample (temp 1) for self-play diversity
  }
  for (const s of samples) s.z = s.player === g.winner ? 1 : -1;
  return samples;
}

function train(net, data, epochs, lr) {
  let loss = 0, n = 0;
  for (let e = 0; e < epochs; e++) {
    for (let i = data.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = data[i]; data[i] = data[j]; data[j] = t; }
    for (const d of data) { loss += net.trainStep(d.x, d.z, d.pi, d.legal, lr); n++; }
  }
  return loss / Math.max(1, n);
}

// net (greedy on its raw policy) vs a random player; seats swapped each game
function evalVsRandom(net, games) {
  let wins = 0;
  for (let gi = 0; gi < games; gi++) {
    const g = new CribGame(rng), netSeat = gi & 1;
    let guard = 0;
    while (!g.done && guard++ < 4000) {
      const p = g.toAct, legal = g.decision.slots;
      let move;
      if (p === netSeat) { const f = net.forward(g.encode(p)); move = argmaxLegal(Net.softmax(f.logits, legal), legal); }
      else move = randomLegal(legal);
      g.step(move);
    }
    if (g.winner === netSeat) wins++;
  }
  return wins / games;
}

/* ---------------- run ---------------- */
const ITERS = parseInt(process.argv[2], 10) || 5;
const GAMES = parseInt(process.argv[3], 10) || 40;
const SIMS = parseInt(process.argv[4], 10) || 20;
const HID = 32, CPUCT = 1.5, LR = 0.02, EPOCHS = 2, EVAL = 300;

const net = new Net(CribGame.INPUT_DIM, HID, NPOL, 0.3);
console.log(`from-random AlphaZero loop: ${ITERS} iters × ${GAMES} games × ${SIMS} sims  (hidden ${HID})`);
console.log(`  baseline (random net, greedy) vs random: ${(100 * evalVsRandom(net, EVAL)).toFixed(1)}%`);
const t0 = Date.now();
for (let it = 1; it <= ITERS; it++) {
  let data = [];
  for (let g = 0; g < GAMES; g++) data = data.concat(selfPlay(net, SIMS, CPUCT));
  const loss = train(net, data, EPOCHS, LR);
  const wr = 100 * evalVsRandom(net, EVAL);
  console.log(`  iter ${it}: ${data.length} samples, train loss ${loss.toFixed(3)}, vs random ${wr.toFixed(1)}%   [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
  fs.writeFileSync(path.join(__dirname, "az_checkpoint.json"), JSON.stringify({ iter: it, nIn: CribGame.INPUT_DIM, nHid: HID, nPol: NPOL, W1: net.W1, b1: net.b1, Wv: net.Wv, bv: net.bv, Wp: net.Wp, bp: net.bp }));
}
console.log(`\nwrote engine/az_checkpoint.json`);
