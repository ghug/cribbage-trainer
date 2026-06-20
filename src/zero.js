/* src/zero.js — Cribbage Zero net inference for the "Zero (experimental)" bot difficulty.
 *
 * The trained AlphaZero-style network (ZERO_NET — bundled from the cribbage-zero `net` branch at build
 * time) picks the HEADS-UP discard. The position encoding mirrors engine/az_game.js's encode() at the
 * discard decision exactly, and the policy is over the 15 two-card combos (ZERO_COMBOS6, i<j order).
 * Heads-up only (the net's action space is "throw 2 of 6"); pegging stays on the strong heuristic.
 * The net is weak/experimental — its rank-histogram input caps how good its discards can get.
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

// encode a heads-up DISCARD position, matching engine/az_game.js encode() at phase "discard"
function zeroEncodeDiscard(six, dealerIsMe, yourToGo, oppToGo, target) {
  var f = [], rc = new Array(13).fill(0), i;
  for (i = 0; i < six.length; i++) rc[six[i].r - 1]++;
  for (i = 0; i < 13; i++) f.push(rc[i] / 2);            // own 6 cards: rank multiplicity / 2
  f.push(1, 0, dealerIsMe ? 1 : 0, 1);                   // [discard, peg, dealer-is-me, to-act-is-me]
  f.push(yourToGo / target, oppToGo / target);          // scores to-go, mine then opp
  f.push(0, 0, 0);                                       // pegging context (none at discard)
  for (i = 0; i < 13; i++) f.push(0);                   // pile tail (none)
  for (i = 0; i < 13; i++) f.push(0);                   // starter (not cut yet)
  return f;
}

// the net's heads-up discard: returns the two indices into `six` to throw (argmax over the 15 combos)
function zeroDiscardIdxs(six, dealerIsMe, yourToGo, oppToGo, target) {
  var logits = zeroForwardLogits(ZERO_NET, zeroEncodeDiscard(six, dealerIsMe, yourToGo, oppToGo, target));
  var best = 0, bv = -Infinity;
  for (var j = 0; j < 15; j++) if (logits[j] > bv) { bv = logits[j]; best = j; }   // argmax logits = argmax softmax
  return ZERO_COMBOS6[best];
}
