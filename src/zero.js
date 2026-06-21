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

function zeroPushCard(f, c) {                            // rank one-hot (13) + suit one-hot (4)
  var k, rr = new Array(13).fill(0), ss = new Array(4).fill(0);
  if (c) { rr[c.r - 1] = 1; ss[c.s] = 1; }
  for (k = 0; k < 13; k++) f.push(rr[k]); for (k = 0; k < 4; k++) f.push(ss[k]);
}

// encode a heads-up DISCARD position, matching engine/az_game.js encode() at phase "discard" (INPUT_DIM 247)
function zeroEncodeDiscard(six, dealerIsMe, yourToGo, oppToGo, target) {
  var f = [], i;
  for (i = 0; i < 6; i++) zeroPushCard(f, six[i]);      // own hand by position (the six dealt cards)
  f.push(0, dealerIsMe ? 1 : 0);                         // [phase=discard(0), dealer-is-me]
  f.push(yourToGo / target, oppToGo / target);          // scores to-go, mine then opp
  f.push(0);                                             // pip count (none at discard)
  for (i = 0; i < 7; i++) zeroPushCard(f, null);        // played-this-hand window (none)
  f.push(0, 0);                                          // my/opp peg-hand sizes (none)
  f.push(0);                                             // opponent go-headroom (none)
  f.push(0);                                             // cards in current sub-pile (none)
  zeroPushCard(f, null);                                 // starter (not cut yet)
  return f;
}

// encode a heads-up PEGGING position, matching engine/az_game.js encode() at phase "peg" (INPUT_DIM 247).
// hand = the player's CURRENT peg cards (policy slot k = play hand[k]); discards = my two crib cards (parked
// in hand slots 4,5); playedSuited = every card played THIS HAND in order (oldest..newest, survives 31/go
// resets); pileLen = #cards in the current sub-pile (the live suffix); oppGoLow = the lowest count the
// opponent said "go" at this hand (0 = none).
function zeroEncodePeg(hand, dealerIsMe, yourToGo, oppToGo, count, oppHandLen, oppGoLow, playedSuited, pileLen, discards, starter, target) {
  var f = [], i, d = discards || [];
  var slots = [hand[0], hand[1], hand[2], hand[3], d[0], d[1]];   // peg hand in 0..3, my discards in 4,5
  for (i = 0; i < 6; i++) zeroPushCard(f, slots[i]);
  f.push(1, dealerIsMe ? 1 : 0);                         // [phase=peg(1), dealer-is-me]
  f.push(yourToGo / target, oppToGo / target);          // scores to-go
  f.push((count || 0) / 31);                             // pip count to 31
  var last7 = (playedSuited || []).slice(-7), off = 7 - last7.length;   // played-this-hand, last 7 in order
  for (i = 0; i < 7; i++) zeroPushCard(f, i >= off ? last7[i - off] : null);
  f.push(hand.length / 4, oppHandLen / 4);               // my/opp peg-hand sizes
  f.push(oppGoLow > 0 ? Math.min(31 - oppGoLow, 10) / 10 : 0);   // opponent go-headroom (0 = no go)
  f.push(Math.min(pileLen || 0, 7) / 7);                 // cards in the current sub-pile
  zeroPushCard(f, starter);                              // starter rank + suit
  return f;
}

// the net's heads-up discard: returns the two indices into `six` to throw (argmax over the 15 combos)
function zeroDiscardIdxs(six, dealerIsMe, yourToGo, oppToGo, target) {
  var logits = zeroForwardLogits(ZERO_NET, zeroEncodeDiscard(six, dealerIsMe, yourToGo, oppToGo, target));
  var best = 0, bv = -Infinity;
  for (var j = 0; j < 15; j++) if (logits[j] > bv) { bv = logits[j]; best = j; }   // argmax logits = argmax softmax
  return ZERO_COMBOS6[best];
}
