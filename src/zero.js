/* src/zero.js — Cribbage Zero net inference for the "Zero (experimental)" bot difficulty.
 *
 * The trained AlphaZero-style network (ZERO_NET — bundled from the cribbage-zero `net` branch at build
 * time) picks the HEADS-UP discard. The position encoding mirrors engine/az_game.js's encode() at the
 * discard decision exactly (per-card hand rank+suit, then zeros for the pegging/pile/starter slots), and
 * the policy is over the 15 two-card combos (ZERO_COMBOS6, i<j order). Heads-up only (the net's action
 * space is "throw 2 of 6"); pegging stays on the strong heuristic. The net is weak/experimental.
 */
var ZERO_COMBOS6 = (function () { var o = []; for (var i = 0; i < 6; i++) for (var j = i + 1; j < 6; j++) o.push([i, j]); return o; })();

function zeroReady() { return typeof ZERO_NET !== "undefined" && ZERO_NET && Array.isArray(ZERO_NET.W1) && ZERO_NET.W1.length === ZERO_NET.nHid; }

function zeroForwardLogits(net, x) {                       // hidden tanh -> policy logits (value head unused)
  var nHid = net.nHid, nPol = net.nPol, nIn = net.nIn, h = new Array(nHid), i, k, j, m, s;
  for (i = 0; i < nHid; i++) { s = net.b1[i]; var Wi = net.W1[i]; for (k = 0; k < nIn; k++) s += Wi[k] * x[k]; h[i] = Math.tanh(s); }
  var logits = new Array(nPol);
  for (j = 0; j < nPol; j++) { s = net.bp[j]; var Wj = net.Wp[j]; for (m = 0; m < nHid; m++) s += Wj[m] * h[m]; logits[j] = s; }
  return logits;
}

// encode a heads-up DISCARD position, matching engine/az_game.js encode() at phase "discard" (INPUT_DIM 207)
function zeroEncodeDiscard(six, dealerIsMe, yourToGo, oppToGo, target) {
  var f = [], i, k;
  // own hand by position: rank one-hot (13) + suit one-hot (4) per card, 6 positions
  for (i = 0; i < 6; i++) {
    var c = six[i], rr = new Array(13).fill(0), ss = new Array(4).fill(0);
    if (c) { rr[c.r - 1] = 1; ss[c.s] = 1; }
    for (k = 0; k < 13; k++) f.push(rr[k]); for (k = 0; k < 4; k++) f.push(ss[k]);
  }
  f.push(1, 0, dealerIsMe ? 1 : 0);                      // [discard, peg, dealer-is-me]  (to-act is always me)
  f.push(yourToGo / target, oppToGo / target);          // scores to-go, mine then opp
  f.push(0, 0, 0);                                       // pegging context (none at discard)
  f.push(0);                                             // opponent go-count (none)
  for (i = 0; i < 6 * 13; i++) f.push(0);               // pegging pile (none at discard)
  for (i = 0; i < 17; i++) f.push(0);                   // starter rank+suit (not cut yet)
  return f;
}

// encode a heads-up PEGGING position, matching engine/az_game.js encode() at phase "peg" (INPUT_DIM 206).
// hand = the player's CURRENT peg cards (policy slot k = play hand[k]); pileRanks = ranks played this
// sequence (oldest..newest); oppGoLow = the count the opponent last said "go" at this hand (0 = none).
function zeroEncodePeg(hand, dealerIsMe, yourToGo, oppToGo, count, oppHandLen, oppGoLow, pileRanks, starter, target) {
  var f = [], i, k;
  for (i = 0; i < 6; i++) {                              // own hand by position (rank + suit)
    var c = hand[i], rr = new Array(13).fill(0), ss = new Array(4).fill(0);
    if (c) { rr[c.r - 1] = 1; ss[c.s] = 1; }
    for (k = 0; k < 13; k++) f.push(rr[k]); for (k = 0; k < 4; k++) f.push(ss[k]);
  }
  f.push(0, 1, dealerIsMe ? 1 : 0);                      // [discard=0, peg=1, dealer-is-me]
  f.push(yourToGo / target, oppToGo / target);          // scores to-go
  f.push((count || 0) / 31, hand.length / 4, oppHandLen / 4);   // pegging context
  f.push((oppGoLow || 0) / 31);                          // opponent's go-count
  var last6 = (pileRanks || []).slice(-6), off = 6 - last6.length;   // last 6 cards of the sequence
  for (i = 0; i < 6; i++) { var r = i >= off ? last6[i - off] : 0; var rr2 = new Array(13).fill(0); if (r) rr2[r - 1] = 1; for (k = 0; k < 13; k++) f.push(rr2[k]); }
  var sr = new Array(13).fill(0), ssr = new Array(4).fill(0);   // starter rank + suit
  if (starter) { sr[starter.r - 1] = 1; ssr[starter.s] = 1; }
  for (k = 0; k < 13; k++) f.push(sr[k]); for (k = 0; k < 4; k++) f.push(ssr[k]);
  return f;
}

// the net's heads-up discard: returns the two indices into `six` to throw (argmax over the 15 combos)
function zeroDiscardIdxs(six, dealerIsMe, yourToGo, oppToGo, target) {
  var logits = zeroForwardLogits(ZERO_NET, zeroEncodeDiscard(six, dealerIsMe, yourToGo, oppToGo, target));
  var best = 0, bv = -Infinity;
  for (var j = 0; j < 15; j++) if (logits[j] > bv) { bv = logits[j]; best = j; }   // argmax logits = argmax softmax
  return ZERO_COMBOS6[best];
}
