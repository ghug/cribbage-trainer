"use strict";
/* Verification for the 3-/4-handed split added to CribbageTrainer.jsx.
   Two goals:
   1) REGRESSION — the refactor that introduced the `players` argument must be
      bit-for-bit identical to the original 4-handed code (same RNG stream, same
      output). We keep the ORIGINAL functions here and assert equality at players=4.
   2) SANITY — 3-handed crib swing still has the 5 dominating, and the dealer seat
      still pegs the most. 3-handed differs because one crib card is dealt straight
      off the deck (uniform) instead of being an opponent throw.
   Run: node engine/verify_players.js                                            */

const fifteenVal = (r) => Math.min(r, 10);
function scoreInto(four, starter, isCrib, acc) {
  const all = [...four, starter];
  let f = 0, p = 0, ru = 0, fl = 0, no = 0;
  for (let m = 1; m < 32; m++) { let s = 0; for (let i = 0; i < 5; i++) if (m & (1 << i)) s += fifteenVal(all[i].r); if (s === 15) f += 2; }
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) if (all[i].r === all[j].r) p += 2;
  const c = new Array(14).fill(0); for (const x of all) c[x.r]++;
  let r = 1; while (r <= 13) { if (!c[r]) { r++; continue; } let len = 0, pr = 1, rr = r; while (rr <= 13 && c[rr] > 0) { len++; pr *= c[rr]; rr++; } if (len >= 3) ru += len * pr; r = rr; }
  const s0 = four[0].s; if (four.every((x) => x.s === s0)) { if (starter.s === s0) fl += 5; else if (!isCrib) fl += 4; }
  for (const x of four) if (x.r === 11 && x.s === starter.s) no += 1;
  acc[0] += f; acc[1] += p; acc[2] += ru; acc[3] += fl; acc[4] += no;
  return f + p + ru + fl + no;
}
const cardId = (c) => (c.r - 1) * 4 + c.s;
function deckExcluding(cards) {
  const used = new Set(cards.map(cardId)); const d = [];
  for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) { const c = { r, s }; if (!used.has(cardId(c))) d.push(c); }
  return d;
}
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DEALER_DISCARD_PROBS = [0.0639, 0.08325, 0.09032, 0.05659, 0.07681, 0.06226, 0.08103, 0.0937, 0.06772, 0.04889, 0.09511, 0.07993, 0.10046];
const DEFENDER_DISCARD_PROBS = [0.09388, 0.06719, 0.04547, 0.04428, 0.00398, 0.06537, 0.0818, 0.08531, 0.08712, 0.09632, 0.0411, 0.11445, 0.17376];
const cumOf = (p) => { const c = []; let s = 0; for (const x of p) { s += x; c.push(s); } return c; };
const DEALER_CUM = cumOf(DEALER_DISCARD_PROBS), DEFENDER_CUM = cumOf(DEFENDER_DISCARD_PROBS);
function pickWeightedRank(rng, cum) { const u = rng() * cum[12]; for (let i = 0; i < 13; i++) if (u <= cum[i]) return i + 1; return 13; }
const pval = (r) => Math.min(r, 10);
function pegScore(pile, count) {
  let pts = 0; if (count === 15) pts += 2; if (count === 31) pts += 2;
  const n = pile.length, last = pile[n - 1]; let k = 1; for (let i = n - 2; i >= 0; i--) { if (pile[i] === last) k++; else break; } if (k >= 2) pts += k * (k - 1);
  for (let m = Math.min(n, 7); m >= 3; m--) { const tail = pile.slice(n - m); if (new Set(tail).size === m && Math.max(...tail) - Math.min(...tail) === m - 1) { pts += m; break; } }
  return pts;
}
function pegChoose(legal, count, pile, hand) {
  let best = null, bestKey = -1e9;
  for (const c of legal) { const nc = count + pval(c); let key = pegScore(pile.concat(c), nc) * 10; if (nc === 5 || nc === 21) key -= 2; if (count === 0) { if (c === 5) key -= 2; key -= pval(c) * 0.1; if (hand.filter((x) => x === c).length >= 2) key += 0.5; } else key -= pval(c) * 0.02; if (key > bestKey) { bestKey = key; best = c; } }
  return best;
}

/* ---------- ORIGINAL (4-handed only) ---------- */
function OLD_cribDetail(discard, dealt5, N, rng, role) {
  const pool = deckExcluding(dealt5);
  const suitsByRank = Array.from({ length: 14 }, () => []);
  for (const c of pool) suitsByRank[c.r].push(c.s);
  const cums = role === "deal" ? [DEFENDER_CUM, DEFENDER_CUM, DEFENDER_CUM] : [DEALER_CUM, DEFENDER_CUM, DEFENDER_CUM];
  const acc = [0, 0, 0, 0, 0]; let total = 0, sq = 0, hits = 0; const used = new Set();
  for (let k = 0; k < N; k++) {
    used.clear(); const draw = [];
    for (let d = 0; d < 3; d++) {
      let card = null;
      for (let tries = 0; tries < 48 && !card; tries++) { const r = pickWeightedRank(rng, cums[d]); const suits = suitsByRank[r]; if (!suits.length) continue; const free = suits.filter((s) => !used.has(r * 4 + s)); if (!free.length) continue; const s = free[(rng() * free.length) | 0]; card = { r, s }; used.add(r * 4 + s); }
      if (!card) { for (let t = 0; t < 80; t++) { const c = pool[(rng() * pool.length) | 0]; if (!used.has(c.r * 4 + c.s)) { card = c; used.add(c.r * 4 + c.s); break; } } }
      draw.push(card);
    }
    let starter = null; for (let t = 0; t < 80; t++) { const c = pool[(rng() * pool.length) | 0]; if (!used.has(c.r * 4 + c.s)) { starter = c; break; } }
    const t = scoreInto([discard, draw[0], draw[1], draw[2]], starter, true, acc); total += t; sq += t * t; if (t > 0) hits++;
  }
  const ev = total / N; return { ev, sd: Math.sqrt(Math.max(0, sq / N - ev * ev)), cats: acc.map((x) => x / N), hitRate: hits / N };
}
function OLD_playPegging(hands, dealerIdx) {
  hands = hands.map((h) => h.slice()); const pts = [0, 0, 0, 0];
  let turn = (dealerIdx + 1) % 4, count = 0, pile = [], passes = 0, last = -1; let remaining = hands.reduce((s, h) => s + h.length, 0);
  while (remaining > 0) {
    const hand = hands[turn]; const legal = hand.filter((c) => pval(c) + count <= 31);
    if (legal.length === 0) { if (++passes >= 4) { if (last >= 0 && count !== 31) pts[last] += 1; count = 0; pile = []; passes = 0; last = -1; } turn = (turn + 1) % 4; continue; }
    const card = pegChoose(legal, count, pile, hand); hand.splice(hand.indexOf(card), 1); remaining--; count += pval(card); pile.push(card); pts[turn] += pegScore(pile, count); last = turn; passes = 0; if (count === 31) { count = 0; pile = []; last = -1; } turn = (turn + 1) % 4;
  }
  if (last >= 0) pts[last] += 1; return pts;
}
function OLD_pegDetail(four, dealt5, N, rng, role) {
  const pool = deckExcluding(dealt5); const ourR = four.map((c) => c.r); let total = 0, sq = 0;
  for (let k = 0; k < N; k++) {
    const seen = new Set(); const opp = []; while (opp.length < 12) { const i = (rng() * pool.length) | 0; if (!seen.has(i)) { seen.add(i); opp.push(pool[i].r); } }
    const ourSeat = role === "deal" ? 3 : (rng() * 3) | 0; const hands = [[], [], [], []]; hands[ourSeat] = ourR.slice();
    let oi = 0; for (let s = 0; s < 4; s++) { if (s === ourSeat) continue; hands[s] = opp.slice(oi, oi + 4); oi += 4; }
    const p = OLD_playPegging(hands, 3)[ourSeat]; total += p; sq += p * p;
  }
  const ev = total / N; return { ev, sd: Math.sqrt(Math.max(0, sq / N - ev * ev)) };
}

/* ---------- NEW (parameterized) — copied verbatim from CribbageTrainer.jsx ---------- */
function NEW_cribDetail(discard, dealt5, N, rng, role, players) {
  const pool = deckExcluding(dealt5);
  const suitsByRank = Array.from({ length: 14 }, () => []);
  for (const c of pool) suitsByRank[c.r].push(c.s);
  const weighted = role === "deal"
    ? (players === 3 ? [DEFENDER_CUM, DEFENDER_CUM] : [DEFENDER_CUM, DEFENDER_CUM, DEFENDER_CUM])
    : (players === 3 ? [DEALER_CUM, DEFENDER_CUM] : [DEALER_CUM, DEFENDER_CUM, DEFENDER_CUM]);
  const nUniform = 3 - weighted.length;
  const acc = [0, 0, 0, 0, 0]; let total = 0, sq = 0, hits = 0; const used = new Set();
  const drawUniform = () => { for (let t = 0; t < 80; t++) { const c = pool[(rng() * pool.length) | 0]; if (!used.has(c.r * 4 + c.s)) { used.add(c.r * 4 + c.s); return c; } } return pool[0]; };
  for (let k = 0; k < N; k++) {
    used.clear(); const draw = [];
    for (let d = 0; d < weighted.length; d++) {
      let card = null;
      for (let tries = 0; tries < 48 && !card; tries++) { const r = pickWeightedRank(rng, weighted[d]); const suits = suitsByRank[r]; if (!suits.length) continue; const free = suits.filter((s) => !used.has(r * 4 + s)); if (!free.length) continue; const s = free[(rng() * free.length) | 0]; card = { r, s }; used.add(r * 4 + s); }
      if (!card) card = drawUniform();
      draw.push(card);
    }
    for (let u = 0; u < nUniform; u++) draw.push(drawUniform());
    const starter = drawUniform();
    const t = scoreInto([discard, draw[0], draw[1], draw[2]], starter, true, acc); total += t; sq += t * t; if (t > 0) hits++;
  }
  const ev = total / N; return { ev, sd: Math.sqrt(Math.max(0, sq / N - ev * ev)), cats: acc.map((x) => x / N), hitRate: hits / N };
}
function NEW_playPegging(hands, dealerIdx) {
  hands = hands.map((h) => h.slice()); const P = hands.length; const pts = new Array(P).fill(0);
  let turn = (dealerIdx + 1) % P, count = 0, pile = [], passes = 0, last = -1; let remaining = hands.reduce((s, h) => s + h.length, 0);
  while (remaining > 0) {
    const hand = hands[turn]; const legal = hand.filter((c) => pval(c) + count <= 31);
    if (legal.length === 0) { if (++passes >= P) { if (last >= 0 && count !== 31) pts[last] += 1; count = 0; pile = []; passes = 0; last = -1; } turn = (turn + 1) % P; continue; }
    const card = pegChoose(legal, count, pile, hand); hand.splice(hand.indexOf(card), 1); remaining--; count += pval(card); pile.push(card); pts[turn] += pegScore(pile, count); last = turn; passes = 0; if (count === 31) { count = 0; pile = []; last = -1; } turn = (turn + 1) % P;
  }
  if (last >= 0) pts[last] += 1; return pts;
}
function NEW_pegDetail(four, dealt5, N, rng, role, players) {
  const pool = deckExcluding(dealt5); const ourR = four.map((c) => c.r);
  const dealerSeat = players - 1; const oppCards = (players - 1) * 4; let total = 0, sq = 0;
  for (let k = 0; k < N; k++) {
    const seen = new Set(); const opp = []; while (opp.length < oppCards) { const i = (rng() * pool.length) | 0; if (!seen.has(i)) { seen.add(i); opp.push(pool[i].r); } }
    const ourSeat = role === "deal" ? dealerSeat : (rng() * (players - 1)) | 0; const hands = Array.from({ length: players }, () => []); hands[ourSeat] = ourR.slice();
    let oi = 0; for (let s = 0; s < players; s++) { if (s === ourSeat) continue; hands[s] = opp.slice(oi, oi + 4); oi += 4; }
    const p = NEW_playPegging(hands, dealerSeat)[ourSeat]; total += p; sq += p * p;
  }
  const ev = total / N; return { ev, sd: Math.sqrt(Math.max(0, sq / N - ev * ev)) };
}

/* ---------- helpers ---------- */
function handFrom(rng) { const d = deckExcluding([]); for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; } return d.slice(0, 5).sort((a, b) => a.r - b.r || a.s - b.s); }
const rankLabel = (r) => (r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r));
let failures = 0;
function approx(a, b, tol, msg) { if (Math.abs(a - b) > tol) { console.log(`  ✗ ${msg}: ${a} vs ${b} (Δ${Math.abs(a - b).toFixed(4)})`); failures++; } }

/* ===== 1) REGRESSION: NEW(players=4) must equal ORIGINAL exactly ===== */
console.log("1) Regression — refactored players=4 vs original 4-handed code (exact):");
{
  const handRng = mulberry32(12345);
  let checked = 0;
  for (let h = 0; h < 40; h++) {
    const hand = handFrom(handRng);
    for (const role of ["deal", "defend"]) {
      const four = hand.slice(1);
      const discard = hand[0];
      const seed = (hand.reduce((a, c) => (a * 53 + cardId(c) + 1) >>> 0, 7));
      const a = OLD_cribDetail(discard, hand, 500, mulberry32(seed), role);
      const b = NEW_cribDetail(discard, hand, 500, mulberry32(seed), role, 4);
      if (a.ev !== b.ev || a.sd !== b.sd || a.hitRate !== b.hitRate || a.cats.some((v, i) => v !== b.cats[i])) { console.log(`  ✗ cribDetail mismatch h=${h} role=${role}`); failures++; }
      const pa = OLD_pegDetail(four, hand, 400, mulberry32(seed + 1), role);
      const pb = NEW_pegDetail(four, hand, 400, mulberry32(seed + 1), role, 4);
      if (pa.ev !== pb.ev || pa.sd !== pb.sd) { console.log(`  ✗ pegDetail mismatch h=${h} role=${role}`); failures++; }
      checked += 2;
    }
  }
  console.log(`   ${checked} crib + ${checked} peg comparisons, ${failures === 0 ? "all identical ✓" : failures + " mismatches ✗"}`);
}

/* ===== 2) SANITY: crib swing per rank (your=deal, their=defend), 4- vs 3-handed ===== */
console.log("\n2) Crib swing per rank (avg crib pts when you contribute that rank):");
function cribSwing(players) {
  const yourSum = new Array(14).fill(0), yourN = new Array(14).fill(0);
  const theirSum = new Array(14).fill(0), theirN = new Array(14).fill(0);
  const rng = mulberry32(999);
  for (let h = 0; h < 400; h++) {
    const hand = handFrom(rng);
    for (let i = 0; i < 5; i++) {
      const r = hand[i].r;
      yourSum[r] += NEW_cribDetail(hand[i], hand, 600, rng, "deal", players).ev; yourN[r]++;
      theirSum[r] += NEW_cribDetail(hand[i], hand, 600, rng, "defend", players).ev; theirN[r]++;
    }
  }
  const your = [], their = [];
  for (let r = 1; r <= 13; r++) { your[r] = yourSum[r] / yourN[r]; their[r] = theirSum[r] / theirN[r]; }
  return { your, their };
}
const s4 = cribSwing(4), s3 = cribSwing(3);
console.log("   rank  | 4h-your 4h-their | 3h-your 3h-their");
for (let r = 1; r <= 13; r++) {
  console.log(`   ${rankLabel(r).padStart(2)}    |  ${s4.your[r].toFixed(2)}    ${s4.their[r].toFixed(2)}   |  ${s3.your[r].toFixed(2)}    ${s3.their[r].toFixed(2)}`);
}
// Documented 4-handed table (CLAUDE.md) — regression guard on the calibrated values.
const DOC_YOUR = [null, 3.96, 3.95, 4.05, 4.06, 6.38, 4.10, 4.21, 4.34, 4.09, 3.74, 4.19, 3.73, 3.85];
const DOC_THEIR = [null, 4.13, 4.28, 4.37, 4.28, 6.52, 4.32, 4.45, 4.46, 4.26, 3.99, 4.41, 4.02, 4.03];
console.log("\n   4-handed vs documented CLAUDE.md table (tol 0.12):");
for (let r = 1; r <= 13; r++) { approx(s4.your[r], DOC_YOUR[r], 0.12, `your[${rankLabel(r)}]`); approx(s4.their[r], DOC_THEIR[r], 0.12, `their[${rankLabel(r)}]`); }
// The 5 must dominate in both formats.
const max4 = Math.max(...s4.your.slice(1)), max3 = Math.max(...s3.your.slice(1));
if (s4.your[5] !== max4) { console.log("  ✗ 5 is not the top crib card (4-handed)"); failures++; }
if (s3.your[5] !== max3) { console.log("  ✗ 5 is not the top crib card (3-handed)"); failures++; }
console.log(`   5 dominates: 4-handed ${s4.your[5] === max4 ? "✓" : "✗"}, 3-handed ${s3.your[5] === max3 ? "✓" : "✗"}`);

/* ===== 3) SANITY: dealer seat pegs the most, 3- and 4-handed ===== */
console.log("\n3) Pegging seat means (dealer is the last seat — should peg most):");
function pegSeatMeans(P) {
  const sums = new Array(P).fill(0); const rng = mulberry32(2024); const games = 4000;
  for (let g = 0; g < games; g++) {
    const d = deckExcluding([]); for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    const hands = []; let idx = 0; for (let s = 0; s < P; s++) { hands.push(d.slice(idx, idx + 4).map((c) => c.r)); idx += 4; }
    const pts = NEW_playPegging(hands, P - 1); for (let s = 0; s < P; s++) sums[s] += pts[s];
  }
  return sums.map((x) => x / games);
}
for (const P of [4, 3]) {
  const m = pegSeatMeans(P);
  const dealer = P - 1; const dealerTop = m[dealer] === Math.max(...m);
  console.log(`   ${P}-handed seats [${m.map((x) => x.toFixed(2)).join(", ")}]  dealer=seat${dealer}=${m[dealer].toFixed(2)} ${dealerTop ? "(top ✓)" : "(NOT top ✗)"}`);
  if (!dealerTop) failures++;
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✓" : failures + " CHECK(S) FAILED ✗"}`);
process.exit(failures === 0 ? 0 : 1);
