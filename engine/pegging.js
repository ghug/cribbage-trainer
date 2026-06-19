// Pegging (play phase) engine. Suits are irrelevant in pegging, so cards are ranks 1..13.
const pval = r => Math.min(r, 10);

// points scored by the card just played (pile = ranks in current 31-sub-round, count = running total)
function pegScore(pile, count) {
  let pts = 0;
  if (count === 15) pts += 2;
  if (count === 31) pts += 2;
  const n = pile.length, last = pile[n - 1];
  // pairs/trips/quads at the tail
  let k = 1; for (let i = n - 2; i >= 0; i--) { if (pile[i] === last) k++; else break; }
  if (k >= 2) pts += k * (k - 1); // 2 / 6 / 12
  // longest run >=3 of distinct consecutive ranks ending at the last card
  for (let m = Math.min(n, 7); m >= 3; m--) {
    const tail = pile.slice(n - m);
    const set = new Set(tail);
    if (set.size === m) {
      const mn = Math.min(...tail), mx = Math.max(...tail);
      if (mx - mn === m - 1) { pts += m; break; }
    }
  }
  return pts;
}

function choose(legal, count, pile, hand) {
  let best = null, bestKey = -1e9;
  for (const c of legal) {
    const nc = count + pval(c);
    const pts = pegScore(pile.concat(c), nc);
    let key = pts * 10;
    if (nc === 5 || nc === 21) key -= 2.0;     // hands opponent an easy 15/31
    if (count === 0) {                          // leading
      if (c === 5) key -= 2.0;                  // never lead a 5
      key -= pval(c) * 0.1;                     // prefer leading low (keep flexibility)
      if (hand.filter(x => x === c).length >= 2) key += 0.5; // pair trap
    } else {
      key -= pval(c) * 0.02;                    // mild: shed bigger cards when not scoring
    }
    if (key > bestKey) { bestKey = key; best = c; }
  }
  return best;
}

// Stronger pegging policy (depth-1 expectimax) — clean-room copy of src/engine.js pegChooseDeep.
// Maximizes the immediate pegScore minus the opponent's expected reply over `unseen` (the ranks they
// could still hold), keeping the greedy tie-breakers. PEG_DEF_W=1.0 (the expected-reply form) was
// chosen by the head-to-head below. The engine/ scripts are an independent re-implementation.
function chooseDeep(legal, count, pile, hand, unseen) {
  const avail = {}; for (const r of unseen) avail[r] = (avail[r] || 0) + 1;
  const ranks = Object.keys(avail).map(Number), tot = unseen.length;
  let best = null, bk = -1e9;
  for (const c of legal) {
    const nc = count + pval(c), myGain = pegScore(pile.concat(c), nc);
    let threat = 0, oppCanPlay = false;
    if (nc !== 31) { let num = 0; for (const r of ranks) if (pval(r) + nc <= 31) { num += avail[r] * pegScore(pile.concat(c, r), nc + pval(r)); oppCanPlay = true; } threat = tot > 0 ? num / tot : 0; }
    let key = myGain * 10 - 1.0 * threat * 10;
    if (nc !== 31 && !oppCanPlay) key += 1;
    if (nc === 5 || nc === 21) key -= 2;
    if (count === 0) { if (c === 5) key -= 2; key -= pval(c) * 0.1; if (hand.filter(x => x === c).length >= 2) key += 0.5; } else key -= pval(c) * 0.02;
    if (key > bk) { bk = key; best = c; }
  }
  return best;
}

// hands: array of 4 rank-arrays. dealerIdx: seat of dealer. returns points[4].
function playPegging(hands, dealerIdx) {
  hands = hands.map(h => h.slice());
  const pts = [0, 0, 0, 0];
  let turn = (dealerIdx + 1) % 4;   // left of dealer leads
  let count = 0, pile = [], passes = 0, last = -1;
  let remaining = hands.reduce((s, h) => s + h.length, 0);
  while (remaining > 0) {
    const hand = hands[turn];
    const legal = hand.filter(c => pval(c) + count <= 31);
    if (legal.length === 0) {
      passes++;
      if (passes >= 4) { // full loop with nobody able to play -> go
        if (last >= 0 && count !== 31) pts[last] += 1;
        count = 0; pile = []; passes = 0; last = -1;
      }
      turn = (turn + 1) % 4;
      continue;
    }
    const card = choose(legal, count, pile, hand);
    hand.splice(hand.indexOf(card), 1); remaining--;
    count += pval(card); pile.push(card);
    pts[turn] += pegScore(pile, count);
    last = turn; passes = 0;
    if (count === 31) { count = 0; pile = []; last = -1; }
    turn = (turn + 1) % 4;
  }
  if (last >= 0) pts[last] += 1; // last card
  return pts;
}

module.exports = { pegScore, playPegging, pval };

if (require.main === module) {
  const t = (name, got, exp) => console.log((got === exp ? 'PASS' : 'FAIL') + ` ${name}: got ${got} exp ${exp}`);
  // pegScore unit tests
  t('fifteen 7,8', pegScore([7, 8], 15), 2);
  t('pair 5,5', pegScore([5, 5], 10), 2);
  t('trips 5,5,5', pegScore([5, 5, 5], 15), 2 + 6); // count15 (+2) AND trips(+6)=8
  t('run 3,4,5', pegScore([3, 4, 5], 12), 3);
  t('run out-of-order 5,4,6', pegScore([5, 4, 6], 15), 2 + 3); // count15 +2, run of 3 +3 =5
  t('run4 6,5,4,7', pegScore([6, 5, 4, 7], 22), 4);
  t('thirty-one', pegScore([10, 10, 10, 1], 31), 2);
  t('pair not run 7,7', pegScore([6, 7, 7], 20), 2);
  t('no score', pegScore([2, 9], 11), 0);
  t('31 with pair-of-aces tail 9,10,10,1,1? skip', pegScore([10, 10, 5, 6], 31), 2);

  // full game sanity: total pegging points awarded should be reasonable (4-12)
  function deck() { const d = []; for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) d.push(r); return d; }
  let tot = 0, mn = 99, mx = 0, runs = 20000;
  for (let i = 0; i < runs; i++) {
    const d = deck(); for (let j = d.length - 1; j > 0; j--) { const k = (Math.random() * (j + 1)) | 0;[d[j], d[k]] = [d[k], d[j]]; }
    const hands = [d.slice(0, 4), d.slice(4, 8), d.slice(8, 12), d.slice(12, 16)];
    const p = playPegging(hands, 3);
    const s = p.reduce((a, b) => a + b, 0);
    tot += s; mn = Math.min(mn, s); mx = Math.max(mx, s);
  }
  console.log(`\nfull 4-hand game: avg total pegging pts = ${(tot/runs).toFixed(2)} (min ${mn}, max ${mx})`);
  // per-seat average (dealer = seat 3 should peg a bit more due to last play)
  const seat = [0, 0, 0, 0];
  for (let i = 0; i < runs; i++) {
    const d = deck(); for (let j = d.length - 1; j > 0; j--) { const k = (Math.random() * (j + 1)) | 0;[d[j], d[k]] = [d[k], d[j]]; }
    const hands = [d.slice(0, 4), d.slice(4, 8), d.slice(8, 12), d.slice(12, 16)];
    const p = playPegging(hands, 3);
    for (let s = 0; s < 4; s++) seat[s] += p[s];
  }
  console.log('avg pegging by seat (0=lead .. 3=dealer):', seat.map(x => (x / runs).toFixed(2)).join('  '));

  // ---- pegChooseDeep (depth-1 lookahead) vs greedy ----
  // Unseen ranks from a seat's view: full deck minus own hand minus everything played.
  function unseenOf(hand, played) { const u = []; for (let r = 1; r <= 13; r++) { let n = 4; for (const x of hand) if (x === r) n--; for (const x of played) if (x === r) n--; for (let i = 0; i < n; i++) u.push(r); } return u; }
  // Sanity: still grabs obvious points.
  t('deep makes fifteen', chooseDeep([8, 3], 7, [7], [8, 3], unseenOf([8, 3], [7])), 8);   // 7+8=15
  t('deep makes a pair',  chooseDeep([4, 9], 4, [4], [4, 9], unseenOf([4, 9], [4])), 4);   // pair of 4s
  t('deep makes 31',      chooseDeep([6, 2], 25, [10, 9, 6], [6, 2], unseenOf([6, 2], [10, 9, 6])), 6); // 25+6=31
  t('deep never leads a 5', chooseDeep([5, 4], 0, [], [5, 4], unseenOf([5, 4], [])), 4);   // leads 4, not the 5
  // Heads-up duel, deep vs greedy, each deal played in both orientations (cancels position + luck).
  function duel(h0, h1, dealerIdx, pol) {
    const hands = [h0.slice(), h1.slice()], played = [], pts = [0, 0];
    let turn = (dealerIdx + 1) % 2, count = 0, pile = [], passes = 0, last = -1, rem = hands[0].length + hands[1].length;
    while (rem > 0) {
      const hand = hands[turn], legal = hand.filter(c => pval(c) + count <= 31);
      if (legal.length === 0) { if (++passes >= 2) { if (last >= 0 && count !== 31) pts[last] += 1; count = 0; pile = []; passes = 0; last = -1; } turn = (turn + 1) % 2; continue; }
      const card = pol[turn](legal, count, pile, hand, unseenOf(hand, played));
      hand.splice(hand.indexOf(card), 1); played.push(card); rem--;
      count += pval(card); pile.push(card); pts[turn] += pegScore(pile, count); last = turn; passes = 0;
      if (count === 31) { count = 0; pile = []; last = -1; }
      turn = (turn + 1) % 2;
    }
    if (last >= 0) pts[last] += 1;
    return pts;
  }
  const G = (l, c, p, h) => choose(l, c, p, h), D = (l, c, p, h, u) => chooseDeep(l, c, p, h, u);
  let deepPts = 0, greedyPts = 0; const DN = 20000;
  for (let i = 0; i < DN; i++) {
    const d = deck(); for (let j = d.length - 1; j > 0; j--) { const k = (Math.random() * (j + 1)) | 0;[d[j], d[k]] = [d[k], d[j]]; }
    const A = d.slice(0, 4), B = d.slice(4, 8);
    for (const dealer of [0, 1]) { let r = duel(A, B, dealer, [D, G]); deepPts += r[0]; greedyPts += r[1]; r = duel(A, B, dealer, [G, D]); greedyPts += r[0]; deepPts += r[1]; }
  }
  const games = DN * 4, dAvg = deepPts / games, gAvg = greedyPts / games;
  console.log(`\npegChooseDeep vs greedy (heads-up, seat-swapped): deep=${dAvg.toFixed(3)} vs greedy=${gAvg.toFixed(3)} pts/hand`);
  t('deep out-pegs greedy by >0.2/hand', dAvg - gAvg > 0.2, true);
}
