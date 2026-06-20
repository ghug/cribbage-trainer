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

// encode a heads-up DISCARD position, matching engine/az_game.js encode() at phase "discard" (INPUT_DIM 270)
function zeroEncodeDiscard(six, dealerIsMe, yourToGo, oppToGo, target) {
  var f = [], i;
  for (i = 0; i < 6; i++) zeroPushCard(f, six[i]);      // own hand by position
  f.push(1, 0, dealerIsMe ? 1 : 0);                      // [discard, peg, dealer-is-me]  (to-act is always me)
  f.push(yourToGo / target, oppToGo / target);          // scores to-go, mine then opp
  f.push(0, 0, 0);                                       // pegging context (none at discard)
  f.push(0);                                             // opponent go-count (none)
  for (i = 0; i < 6; i++) zeroPushCard(f, null);        // played-this-hand window (none at discard)
  for (i = 0; i < 6; i++) f.push(0);                    // live-pile mask (none)
  for (i = 0; i < 2; i++) zeroPushCard(f, null);        // my discards (none yet)
  zeroPushCard(f, null);                                 // starter (not cut yet)
  return f;
}

// encode a heads-up PEGGING position, matching engine/az_game.js encode() at phase "peg" (INPUT_DIM 270).
// hand = the player's CURRENT peg cards (policy slot k = play hand[k]); playedSuited = every card played
// THIS HAND in order (oldest..newest, survives 31/go resets); pileLen = #cards in the current sub-pile (the
// live suffix of playedSuited); discards = my two crib cards; oppGoLow = the count the opponent last said
// "go" at this hand (0 = none).
function zeroEncodePeg(hand, dealerIsMe, yourToGo, oppToGo, count, oppHandLen, oppGoLow, playedSuited, pileLen, discards, starter, target) {
  var f = [], i;
  for (i = 0; i < 6; i++) zeroPushCard(f, hand[i]);     // own hand by position
  f.push(0, 1, dealerIsMe ? 1 : 0);                      // [discard=0, peg=1, dealer-is-me]
  f.push(yourToGo / target, oppToGo / target);          // scores to-go
  f.push((count || 0) / 31, hand.length / 4, oppHandLen / 4);   // pegging context
  f.push((oppGoLow || 0) / 31);                          // opponent's go-count
  var last6 = (playedSuited || []).slice(-6), off = 6 - last6.length;   // played-this-hand, last 6 in order
  for (i = 0; i < 6; i++) zeroPushCard(f, i >= off ? last6[i - off] : null);
  var pl = Math.min(pileLen || 0, 6);                    // live-pile mask: trailing pl slots = current sub-pile
  for (i = 0; i < 6; i++) f.push(i >= 6 - pl ? 1 : 0);
  for (i = 0; i < 2; i++) zeroPushCard(f, (discards || [])[i]);   // my two discards
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
