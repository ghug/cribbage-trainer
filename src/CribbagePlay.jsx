import React, { useReducer, useEffect } from "react";

/* ============================================================
   VERIFIED CRIBBAGE ENGINE — copied verbatim from CribbageTrainer.jsx.
   The two pages are independent self-contained HTML files and do not share a
   module, matching how the repo already works (the engine/ scripts also
   duplicate the math). scoreInto is unit-tested: perfect 29 -> 16/12/0/0/1.
   ============================================================ */
const fifteenVal = (r) => Math.min(r, 10);

function scoreInto(four, starter, isCrib, acc) {
  const all = [...four, starter];
  let f = 0, p = 0, ru = 0, fl = 0, no = 0;
  for (let m = 1; m < 32; m++) {
    let s = 0;
    for (let i = 0; i < 5; i++) if (m & (1 << i)) s += fifteenVal(all[i].r);
    if (s === 15) f += 2;
  }
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++) if (all[i].r === all[j].r) p += 2;
  const c = new Array(14).fill(0);
  for (const x of all) c[x.r]++;
  let r = 1;
  while (r <= 13) {
    if (!c[r]) { r++; continue; }
    let len = 0, pr = 1, rr = r;
    while (rr <= 13 && c[rr] > 0) { len++; pr *= c[rr]; rr++; }
    if (len >= 3) ru += len * pr;
    r = rr;
  }
  const s0 = four[0].s;
  if (four.every((x) => x.s === s0)) {
    if (starter.s === s0) fl += 5;
    else if (!isCrib) fl += 4;
  }
  for (const x of four) if (x.r === 11 && x.s === starter.s) no += 1;
  acc[0] += f; acc[1] += p; acc[2] += ru; acc[3] += fl; acc[4] += no;
  return f + p + ru + fl + no;
}

function lockedFour(four) {
  let f = 0, p = 0, ru = 0, fl = 0;
  for (let m = 1; m < 16; m++) {
    let s = 0;
    for (let i = 0; i < 4; i++) if (m & (1 << i)) s += fifteenVal(four[i].r);
    if (s === 15) f += 2;
  }
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) if (four[i].r === four[j].r) p += 2;
  const c = new Array(14).fill(0);
  for (const x of four) c[x.r]++;
  let r = 1;
  while (r <= 13) {
    if (!c[r]) { r++; continue; }
    let len = 0, pr = 1, rr = r;
    while (rr <= 13 && c[rr] > 0) { len++; pr *= c[rr]; rr++; }
    if (len >= 3) ru += len * pr;
    r = rr;
  }
  if (four.every((x) => x.s === four[0].s)) fl += 4;
  return f + p + ru + fl;
}

const cardId = (c) => (c.r - 1) * 4 + c.s;
function deckExcluding(cards) {
  const used = new Set(cards.map(cardId));
  const d = [];
  for (let r = 1; r <= 13; r++)
    for (let s = 0; s < 4; s++) { const c = { r, s }; if (!used.has(cardId(c))) d.push(c); }
  return d;
}

function handDetail(four, dealt5) {
  const deck = deckExcluding(dealt5);
  const acc = [0, 0, 0, 0, 0];
  let total = 0, sq = 0, mn = 99, mx = 0;
  const vals = [];
  for (const st of deck) {
    const t = scoreInto(four, st, false, acc);
    total += t; sq += t * t; if (t < mn) mn = t; if (t > mx) mx = t; vals.push(t);
  }
  const n = deck.length;
  const ev = total / n;
  const sd = Math.sqrt(Math.max(0, sq / n - ev * ev));
  const locked = lockedFour(four);
  return { ev, sd, mn, mx, cats: acc.map((x) => x / n), locked, fromCut: ev - locked };
}

/* ===== Pegging (play phase) ===== suits are irrelevant to pegging, so the
   pile / hand arrays handed to pegScore & pegChoose are ranks 1..13. Scoring
   mechanics unit-tested in engine/pegging.js (15s, 31s, pair royals, in/out-of-
   order runs, gos, last card). The AI plays a greedy point-grabbing policy with
   light defense — the same reference used by the trainer's pegging estimate. */
const pval = (r) => Math.min(r, 10);
function pegScore(pile, count) {
  let pts = 0;
  if (count === 15) pts += 2;
  if (count === 31) pts += 2;
  const n = pile.length, last = pile[n - 1];
  let k = 1; for (let i = n - 2; i >= 0; i--) { if (pile[i] === last) k++; else break; }
  if (k >= 2) pts += k * (k - 1);
  for (let m = Math.min(n, 7); m >= 3; m--) {
    const tail = pile.slice(n - m);
    if (new Set(tail).size === m && Math.max(...tail) - Math.min(...tail) === m - 1) { pts += m; break; }
  }
  return pts;
}
function pegChoose(legal, count, pile, hand) {
  let best = null, bestKey = -1e9;
  for (const c of legal) {
    const nc = count + pval(c);
    const key0 = pegScore(pile.concat(c), nc) * 10;
    let key = key0;
    if (nc === 5 || nc === 21) key -= 2;
    if (count === 0) { if (c === 5) key -= 2; key -= pval(c) * 0.1; if (hand.filter((x) => x === c).length >= 2) key += 0.5; }
    else key -= pval(c) * 0.02;
    if (key > bestKey) { bestKey = key; best = c; }
  }
  return best;
}

/* Per-rank crib value ("crib swing"), the "your" row from CLAUDE.md: average crib
   points contributed when you throw that rank into a crib (index 0=A .. 12=K).
   The 5 dominates; everything else is connectedness. The AI uses this to value a
   discard's crib impact without the (too-slow) Monte-Carlo cribDetail. */
const CRIB_VALUE = [3.96, 3.95, 4.05, 4.06, 6.38, 4.10, 4.21, 4.34, 4.09, 3.74, 4.19, 3.73, 3.85];

// AI discard: maximise kept-hand EV plus the crib swing of the thrown card,
// signed by whether this seat owns the crib (dealer) or feeds it (defender).
function aiDiscard(dealt5, seat, dealerIdx) {
  const sign = seat === dealerIdx ? 1 : -1;
  let bestIdx = 0, bestVal = -1e9;
  for (let idx = 0; idx < 5; idx++) {
    const four = dealt5.filter((_, j) => j !== idx);
    const thrown = dealt5[idx];
    const val = handDetail(four, dealt5).ev + sign * CRIB_VALUE[thrown.r - 1];
    if (val > bestVal) { bestVal = val; bestIdx = idx; }
  }
  return { discard: dealt5[bestIdx], kept: dealt5.filter((_, j) => j !== bestIdx) };
}

/* ============================ THEME ============================ */
const T = {
  baize: "#1F423A", baizeHi: "#28534A",
  woodD: "#5E3F26", woodM: "#8A5E37", woodL: "#B9824B",
  pegRed: "#C8412B", pegIvory: "#ECDCB4",
  ivory: "#F6EFDE", ink: "#241D14", suitRed: "#A8362A",
  cream: "#ECE0C6", muted: "#A99873", line: "rgba(236,224,182,0.16)",
  good: "#5FA47C", goodDeep: "#3F7E5E", selBlue: "#5B95C2",
};
const SUIT = ["♠", "♥", "♦", "♣"];
const CATS = ["fifteens", "pairs", "runs", "flush", "nobs"];
const isRed = (s) => s === 1 || s === 2;
const rankLabel = (r) => (r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r));
const tag = (c) => `${rankLabel(c.r)}${SUIT[c.s]}`;
const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const serif = "'Hoefler Text', 'Iowan Old Style', Georgia, 'Times New Roman', serif";

const SEAT_NAMES = ["You", "West", "North", "East"];
const seatName = (i) => SEAT_NAMES[i];
const poss = (i) => (i === 0 ? "Your" : `${seatName(i)}'s`);          // possessive: "Your hand" / "West's hand"
const sv = (i, first, third) => (i === 0 ? `You ${first}` : `${seatName(i)} ${third}`); // subject+verb agreement
const sameCard = (a, b) => a.r === b.r && a.s === b.s;

function freshDeck() {
  const d = deckExcluding([]);
  for (let i = d.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
const sortHand = (cs) => cs.slice().sort((a, b) => a.r - b.r || a.s - b.s);

/* ============================ CARDS ============================ */
function Card({ card, onClick, clickable, badge, dim, selected, small, selLabel }) {
  const [hover, setHover] = React.useState(false);
  const base = small ? 44 : 68;
  const lift = badge || selected ? -8 : hover && clickable ? -6 : 0;
  const edge = badge ? badge.color : selected ? T.selBlue : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: `0 0 ${base}px`, maxWidth: base }}>
      {(badge || selected) && (
        <span style={{
          fontFamily: mono, fontSize: 9.5, letterSpacing: 0.4, fontWeight: 700,
          color: T.ivory, background: badge ? badge.color : T.selBlue, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
        }}>{badge ? badge.text : (selLabel || "THROW")}</span>
      )}
      <button
        onClick={clickable ? onClick : undefined}
        onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
        aria-label={`${rankLabel(card.r)} of ${["spades", "hearts", "diamonds", "clubs"][card.s]}`}
        style={{
          width: "100%", borderRadius: small ? 7 : 9, padding: 0, background: T.ivory, position: "relative",
          cursor: clickable ? "pointer" : "default",
          border: edge ? `2px solid ${edge}` : "1px solid rgba(0,0,0,0.25)",
          boxShadow: badge || selected ? "0 8px 18px rgba(0,0,0,0.45)" : "0 4px 10px rgba(0,0,0,0.35)",
          transform: `translateY(${lift}px)`, transition: "transform 140ms ease, box-shadow 140ms ease",
          opacity: dim ? 0.42 : 1, outlineOffset: 3,
        }}
      >
        {/* aspect ratio via a padding spacer (no aspect-ratio CSS); the face is a
            scalable SVG (no container queries) so cards render on any WebView. */}
        <span style={{ display: "block", paddingBottom: "141.18%" }} />
        <svg viewBox="0 0 68 96" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "block" }}>
          <text x="13" y="15" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="17" fill={isRed(card.s) ? T.suitRed : T.ink}>{rankLabel(card.r)}</text>
          <text x="13" y="30" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="13" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
          <text x="34" y="49" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontSize="34" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
        </svg>
      </button>
    </div>
  );
}

function CardBack({ small }) {
  const base = small ? 44 : 68; // match the face-up Card sizes (44 small, 68 large)
  const inset = small ? 4 : 6;
  return (
    <div style={{
      width: base, height: Math.round(base * 96 / 68), borderRadius: small ? 7 : 9, // explicit height (no aspect-ratio CSS)
      background: `repeating-linear-gradient(45deg, ${T.woodD}, ${T.woodD} 5px, ${T.woodM} 5px, ${T.woodM} 10px)`,
      border: "1px solid rgba(0,0,0,0.4)", boxShadow: "0 3px 8px rgba(0,0,0,0.35)",
      position: "relative",
    }}>
      <span style={{ position: "absolute", top: inset, left: inset, right: inset, bottom: inset, border: "1px solid rgba(236,224,182,0.25)", borderRadius: 5 }} />
    </div>
  );
}

function PegTrack({ pct }) {
  const holes = 22;
  const pegAt = Math.min(holes - 1, Math.round((pct / 100) * (holes - 1)));
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
      {Array.from({ length: holes }).map((_, i) => {
        const on = i === pegAt;
        return (<span key={i} style={{
          width: on ? 9 : 6, height: on ? 9 : 6, borderRadius: "50%",
          background: on ? T.pegRed : "rgba(0,0,0,0.4)",
          boxShadow: on ? "0 0 0 2px rgba(236,220,180,0.5)" : "inset 0 1px 2px rgba(0,0,0,0.6)",
        }} />);
      })}
    </div>
  );
}

function CatBars({ cats, scale, color }) {
  const max = Math.max(scale, ...cats, 0.001);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {cats.map((v, i) =>
        v < 0.005 ? null : (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "58px 1fr 30px", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{CATS[i]}</span>
            <span style={{ height: 7, background: "rgba(0,0,0,0.28)", borderRadius: 4, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(v / max) * 100}%`, background: color }} />
            </span>
            <span style={{ fontFamily: mono, fontSize: 11.5, textAlign: "right" }}>{v}</span>
          </div>
        )
      )}
    </div>
  );
}

/* ============================ GAME STATE ============================ */
const TARGET = 121;
// Add points to a seat and log the award to that seat's per-game history (only when
// points are actually scored), so a player can review where their tally came from.
const addScore = (seats, i, pts, label) => seats.map((s, j) => (j === i
  ? { ...s, score: s.score + pts, history: pts > 0 ? [...(s.history || []), { pts, label }] : (s.history || []) }
  : s));
const initPeg = (seats, dealerIdx) => ({
  hands: seats.map((s) => s.kept.slice()),
  turn: (dealerIdx + 1) % 4,
  count: 0, pile: [], pileSuited: [], played: [[], [], [], []],
  passes: 0, lastPlayer: -1,
});
const initShow = (dealerIdx) => ({
  order: [(dealerIdx + 1) % 4, (dealerIdx + 2) % 4, (dealerIdx + 3) % 4, dealerIdx, "CRIB"],
  step: 0, scored: false, claimSubmitted: false, claimValue: null,
});

// The breakdown for the entity currently being counted in the show.
function computeShow(state) {
  const { show, seats, crib, starter, dealerIdx } = state;
  const ent = show.order[show.step];
  const isCrib = ent === "CRIB";
  const owner = isCrib ? dealerIdx : ent;
  const cards = isCrib ? crib : seats[ent].kept;
  const acc = [0, 0, 0, 0, 0];
  const total = scoreInto(cards, starter, isCrib, acc);
  return { ent, owner, cards, acc, total, isCrib };
}
const entLabel = (info) => `${poss(info.owner)} ${info.isCrib ? "crib" : "hand"}`;

function pegReason(pile, count) {
  const parts = [];
  if (count === 15) parts.push("fifteen");
  if (count === 31) parts.push("thirty-one");
  const n = pile.length, last = pile[n - 1];
  let k = 1; for (let i = n - 2; i >= 0; i--) { if (pile[i] === last) k++; else break; }
  if (k === 2) parts.push("pair"); else if (k === 3) parts.push("pair royal"); else if (k >= 4) parts.push("double pair royal");
  for (let m = Math.min(n, 7); m >= 3; m--) {
    const tail = pile.slice(n - m);
    if (new Set(tail).size === m && Math.max(...tail) - Math.min(...tail) === m - 1) { parts.push(`run of ${m}`); break; }
  }
  return parts.length ? parts.join(" + ") : "points";
}
const scoreCallout = (pile, count, pts) => `${pegReason(pile, count)} for ${pts}`;

// Score-history label for a counted hand/crib: append the category breakdown
// (e.g. "hand · 15s 4, pairs 2, runs 3") from the show's per-category points.
const CAT_SHORT = ["15s", "pairs", "runs", "flush", "nobs"];
const showLabel = (kind, acc) => {
  const parts = acc.map((v, i) => (v > 0 ? `${CAT_SHORT[i]} ${v}` : null)).filter(Boolean);
  return parts.length ? `${kind} · ${parts.join(", ")}` : kind;
};

// Score the human's 5 possible throws the same way the AI does: kept-hand EV over
// every cut, plus the thrown card's average crib value (signed for whose crib it is).
function evalDiscards(dealt5, dealerIdx) {
  const sign = dealerIdx === 0 ? 1 : -1; // human is seat 0; +1 if it's their own crib
  const opts = dealt5.map((thrown, idx) => {
    const four = dealt5.filter((_, j) => j !== idx);
    const hd = handDetail(four, dealt5);
    const cribSwing = CRIB_VALUE[thrown.r - 1];
    return { idx, thrown, four, keptEV: hd.ev, cribSwing, value: hd.ev + sign * cribSwing };
  });
  const best = opts.reduce((a, b) => (b.value > a.value ? b : a));
  return { opts, best, sign };
}

// Commit a chosen throw: assemble the 4-card crib (one throw per seat) and cut next.
function commitDiscard(state, idx) {
  const dealt = state.seats[0].dealt;
  const discard = dealt[idx];
  const kept = sortHand(dealt.filter((_, j) => j !== idx));
  const seats = state.seats.map((s, i) => (i === 0 ? { ...s, discard, kept } : s));
  return { ...state, seats, crib: seats.map((s) => s.discard), pendingDiscard: null, phase: "cut" };
}

function dealNewHand(state) {
  const deck = freshDeck();
  const seats = [0, 1, 2, 3].map((i) => ({
    score: state.seats[i].score, isAI: i !== 0, history: state.seats[i].history || [],
    dealt: sortHand(deck.slice(i * 5, i * 5 + 5)), kept: null, discard: null,
  }));
  for (let i = 1; i < 4; i++) {
    const { discard, kept } = aiDiscard(seats[i].dealt, i, state.dealerIdx);
    seats[i].discard = discard; seats[i].kept = sortHand(kept);
  }
  return {
    ...state, seats, deck, starter: null, crib: [], hisHeels: false,
    peg: null, show: null, winner: null, phase: "discard", message: "", pendingDiscard: null, pendingPlay: null,
  };
}

// Commit one pegging card for `seat`: score it, handle 31/last-card/go-to-show,
// win-check after every award, advance the turn. Mirrors the verified playPegging.
function playCard(state, seat, card) {
  const peg = state.peg;
  const hands = peg.hands.map((h, i) => (i === seat ? h.filter((c) => !sameCard(c, card)) : h));
  const count = peg.count + pval(card.r);
  const pile = peg.pile.concat(card.r);
  const pileSuited = peg.pileSuited.concat(card);
  const played = peg.played.map((p, i) => (i === seat ? p.concat(card) : p));
  const pts = pegScore(pile, count);
  let seats = addScore(state.seats, seat, pts, `pegging · ${pegReason(pile, count)}`);
  let message = pts > 0 ? `${seatName(seat)}: ${scoreCallout(pile, count, pts)}.` : `${sv(seat, "play", "plays")} ${tag(card)} (count ${count}).`;
  const np = { ...peg, hands, count, pile, pileSuited, played, lastPlayer: seat, passes: 0 };
  if (count === 31) { np.count = 0; np.pile = []; np.pileSuited = []; np.lastPlayer = -1; }
  if (seats[seat].score >= TARGET) return { ...state, seats, peg: np, phase: "over", winner: seat, message };

  const remaining = hands.reduce((a, h) => a + h.length, 0);
  if (remaining === 0) {
    if (np.lastPlayer >= 0) { // not already reset by a 31; award last-card +1
      seats = addScore(seats, seat, 1, "pegging · last card");
      message += ` ${seatName(seat)} +1 for last card.`;
      if (seats[seat].score >= TARGET) return { ...state, seats, peg: np, phase: "over", winner: seat, message };
    }
    return { ...state, seats, peg: np, phase: "show", show: initShow(state.dealerIdx), message };
  }
  np.turn = (seat + 1) % 4;
  return { ...state, seats, peg: np, message };
}

// Compare the human's chosen pegging card to the best-scoring legal card right now.
function evalPlay(peg, card) {
  const legal = peg.hands[0].filter((c) => pval(c.r) + peg.count <= 31);
  const scoreOf = (c) => pegScore(peg.pile.concat(c.r), peg.count + pval(c.r));
  let bestCard = card, bestPts = -1;
  for (const c of legal) { const p = scoreOf(c); if (p > bestPts) { bestPts = p; bestCard = c; } }
  const chosenPts = scoreOf(card);
  return { chosenPts, bestCard, bestPts, delta: bestPts - chosenPts };
}

function reduce(state, action) {
  switch (action.type) {
    case "DEAL":
      return dealNewHand(state);

    case "SET_SETTING":
      return { ...state, settings: { ...state.settings, [action.key]: action.value } };

    case "DISCARD": // commit straight away (used programmatically / by tests)
      return commitDiscard(state, action.idx);

    case "SELECT_DISCARD": {
      // The human tapped a throw. If warnings are off, just throw it. Otherwise, if
      // it's optimal (or a near-tie) throw it; if it gives up real value, pause and
      // explain so they can take it back.
      if (!state.settings.warn) return commitDiscard(state, action.idx);
      const { opts, best } = evalDiscards(state.seats[0].dealt, state.dealerIdx);
      const chosen = opts[action.idx];
      const delta = best.value - chosen.value;
      if (delta <= 0.1) return commitDiscard(state, action.idx);
      return { ...state, pendingDiscard: { idx: action.idx, chosen, best, delta } };
    }

    case "CONFIRM_DISCARD":
      return commitDiscard(state, state.pendingDiscard.idx);

    case "CANCEL_DISCARD":
      return { ...state, pendingDiscard: null };

    case "CUT": {
      const starter = state.deck[20]; // the next undealt card after 4 hands of 5
      const hisHeels = starter.r === 11;
      let seats = state.seats, winner = null, message = `Cut: ${tag(starter)}.`;
      if (hisHeels) {
        seats = addScore(seats, state.dealerIdx, 2, "his heels");
        message = `His heels — ${sv(state.dealerIdx, "peg", "pegs")} 2 for the Jack (${tag(starter)}).`;
        if (seats[state.dealerIdx].score >= TARGET) winner = state.dealerIdx;
      }
      if (winner !== null) return { ...state, starter, hisHeels, seats, winner, phase: "over", message };
      return { ...state, starter, hisHeels, seats, peg: initPeg(seats, state.dealerIdx), phase: "play", message };
    }

    case "PLAY_CARD": // direct commit (AI moves, tests)
      return playCard(state, action.seat, action.card);

    case "SELECT_PLAY": {
      // The human tapped a card to peg. Warn (if enabled) when a better-scoring legal
      // card is available and at least one point is being passed up.
      if (!state.settings.warn) return playCard(state, 0, action.card);
      const e = evalPlay(state.peg, action.card);
      if (e.delta >= 1) return { ...state, pendingPlay: { card: action.card, ...e } };
      return playCard(state, 0, action.card);
    }

    case "CONFIRM_PLAY":
      return playCard({ ...state, pendingPlay: null }, 0, state.pendingPlay.card);

    case "CANCEL_PLAY":
      return { ...state, pendingPlay: null };

    case "PASS_GO": {
      const peg = state.peg, seat = action.seat;
      const passes = peg.passes + 1;
      if (passes >= 4) { // a full rotation with nobody able to play -> award the go
        let seats = state.seats, message = `${sv(seat, "say", "says")} "go".`;
        const np = { ...peg, passes: 0, turn: (seat + 1) % 4 };
        if (peg.lastPlayer >= 0 && peg.count !== 31) {
          seats = addScore(seats, peg.lastPlayer, 1, "pegging · go");
          message = `${seatName(peg.lastPlayer)} +1 for the go.`;
          if (seats[peg.lastPlayer].score >= TARGET) return { ...state, seats, peg: np, phase: "over", winner: peg.lastPlayer, message };
        }
        np.count = 0; np.pile = []; np.pileSuited = []; np.lastPlayer = -1;
        return { ...state, seats, peg: np, message };
      }
      return { ...state, peg: { ...peg, passes, turn: (seat + 1) % 4 }, message: `${sv(seat, "say", "says")} "go".` };
    }

    case "SHOW_CLAIM":
      return { ...state, show: { ...state.show, claimSubmitted: true, claimValue: action.value } };

    case "SHOW_SCORE": {
      // Award the current show step's points immediately (so the score/history
      // update as soon as the step is shown, before Continue). Win-checked.
      if (state.show.scored) return state;
      const info = computeShow(state);
      const counting = state.settings.counting;
      let seats = state.seats, message = "", winner = null;
      const humanCount = counting === "muggins" && info.owner === 0;
      if (humanCount) {
        const claim = state.show.claimValue || 0;
        const awarded = Math.min(claim, info.total);
        seats = addScore(seats, info.owner, awarded, info.isCrib ? "crib (claimed)" : "hand (claimed)");
        if (seats[info.owner].score >= TARGET) winner = info.owner;
        const missed = info.total - awarded;
        if (missed > 0 && winner === null) {
          const rest = state.show.order.slice(state.show.step + 1).map((e) => (e === "CRIB" ? state.dealerIdx : e));
          let recip = rest.find((o) => o !== 0);
          if (recip === undefined) recip = (state.dealerIdx + 1) % 4; // no opponent left to count -> eldest
          seats = addScore(seats, recip, missed, "muggins");
          message = `Muggins! ${seatName(recip)} claims the ${missed} you missed (had ${info.total}).`;
          if (seats[recip].score >= TARGET) winner = recip;
        } else {
          message = `You count ${awarded}${claim > info.total ? " — over-claim corrected down" : ""}.`;
        }
      } else {
        seats = addScore(seats, info.owner, info.total, showLabel(info.isCrib ? "crib" : "hand", info.acc));
        message = `${entLabel(info)} scores ${info.total}.`;
        if (seats[info.owner].score >= TARGET) winner = info.owner;
      }
      if (winner !== null) return { ...state, seats, phase: "over", winner, message };
      return { ...state, seats, show: { ...state.show, scored: true }, message };
    }

    case "SHOW_NEXT": {
      // The step is scored eagerly (SHOW_SCORE) when shown; Continue just advances.
      const nextStep = state.show.step + 1;
      if (nextStep >= state.show.order.length)
        return { ...state, phase: "deal", dealerIdx: (state.dealerIdx + 1) % 4, show: null, peg: null, message: "Hand complete — deal the next." };
      return { ...state, show: { ...state.show, step: nextStep, scored: false, claimSubmitted: false, claimValue: null } };
    }

    case "PLAY_AGAIN":
      return newGameState(state); // fresh cut for deal, scores reset

    default:
      return state;
  }
}

const DEFAULT_SETTINGS = { counting: "auto", autoGo: false, warn: true, autoDeal: false, autoContinue: false, autoPlayOne: false };

// Cut for deal at the start of a game: each seat draws one card from a shuffled
// deck; the lowest rank deals. Re-draw all four on a tie for lowest, until unique.
function drawForDealer() {
  for (let attempt = 0; attempt < 500; attempt++) {
    const draw = freshDeck().slice(0, 4); // seat i draws draw[i]
    const ranks = draw.map((c) => c.r);
    const lo = Math.min(...ranks);
    if (ranks.filter((r) => r === lo).length === 1) return { dealerIdx: ranks.indexOf(lo), draw };
  }
  return { dealerIdx: 0, draw: null };
}

function newGameState(prev) {
  const { dealerIdx, draw } = drawForDealer();
  return {
    seats: [0, 1, 2, 3].map((i) => ({ score: 0, isAI: i !== 0, dealt: [], kept: null, discard: null, history: [] })),
    dealerIdx, dealDraw: draw,
    deck: [], starter: null, crib: [], hisHeels: false, pendingDiscard: null, pendingPlay: null,
    peg: null, show: null, winner: null, phase: "cutdeal", message: "",
    settings: prev ? prev.settings : DEFAULT_SETTINGS,
  };
}
function initGame() { return newGameState(null); }

/* ============================ UI BITS ============================ */
function ScoreRow({ seats, dealerIdx, turn, winner, onPick }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, margin: "0 0 6px" }}>
      {seats.map((s, i) => {
        const isTurn = turn === i;
        const isWin = winner === i;
        return (
          <button key={i} onClick={() => onPick(i)} title="tap for scoring history" style={{
            padding: "8px 8px 9px", borderRadius: 9, textAlign: "center", cursor: "pointer", font: "inherit", color: "inherit",
            background: isWin ? "rgba(95,164,124,0.28)" : isTurn ? "rgba(91,149,194,0.22)" : "rgba(0,0,0,0.22)",
            border: `1px solid ${isWin ? T.good : isTurn ? T.selBlue : T.line}`,
          }}>
            <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, display: "flex", justifyContent: "center", gap: 4, alignItems: "center" }}>
              {seatName(i)}{dealerIdx === i && <span style={{ color: T.pegIvory, fontWeight: 700 }} title="dealer">⬤D</span>}
            </div>
            <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 22, color: isWin ? T.good : T.ivory }}>{s.score}</div>
            <div style={{ marginTop: 4, display: "flex", justifyContent: "center" }}><PegTrack pct={(s.score / TARGET) * 100} /></div>
          </button>
        );
      })}
    </div>
  );
}

function HistoryPanel({ seatIdx, seats, onClose }) {
  const s = seats[seatIdx];
  const hist = s.history || [];
  let run = 0;
  const cols = "1fr 34px 42px";
  return (
    <div style={{ background: "rgba(0,0,0,0.32)", border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 16px 12px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{seatName(seatIdx)} — scoring this game</span>
        <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>Close</button>
      </div>
      {hist.length === 0 ? (
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>No points yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 3 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontFamily: mono, fontSize: 10, color: T.muted, paddingBottom: 2 }}>
            <span>for</span><span style={{ textAlign: "right" }}>pts</span><span style={{ textAlign: "right" }}>total</span>
          </div>
          {hist.map((h, k) => { run += h.pts; return (
            <div key={k} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontFamily: mono, fontSize: 11.5, alignItems: "baseline" }}>
              <span style={{ color: T.cream }}>{h.label}</span>
              <span style={{ textAlign: "right", color: T.good }}>+{h.pts}</span>
              <span style={{ textAlign: "right", color: T.muted }}>{run}</span>
            </div>
          ); })}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${T.line}`, marginTop: 8, paddingTop: 8, fontFamily: mono, fontSize: 12 }}>
        <span style={{ color: T.muted }}>total</span>
        <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 18, color: T.ivory }}>{s.score}</span>
      </div>
    </div>
  );
}

function Panel({ children, tone }) {
  const bg = tone === "good" ? "rgba(95,164,124,0.16)" : tone === "red" ? "rgba(200,65,43,0.14)" : "rgba(0,0,0,0.22)";
  const bd = tone === "good" ? "rgba(95,164,124,0.5)" : tone === "red" ? "rgba(200,65,43,0.45)" : T.line;
  return <div style={{ padding: "11px 14px", borderRadius: 10, background: bg, border: `1px solid ${bd}` }}>{children}</div>;
}

// Skunk callouts at game end: a loser who finishes with <=90 is skunked, <=60 is
// double-skunked. Red tone if you're the one skunked, otherwise a friendly green.
function SkunkPanel({ seats, winner }) {
  const losers = seats.map((s, i) => ({ i, score: s.score })).filter((x) => x.i !== winner);
  const dbl = losers.filter((x) => x.score <= 60);
  const sk = losers.filter((x) => x.score > 60 && x.score <= 90);
  if (!dbl.length && !sk.length) return null;
  const youSkunked = losers.some((x) => x.i === 0 && x.score <= 90);
  const fmt = (arr) => arr.map((x) => `${seatName(x.i)} (${x.score})`).join(", ");
  return (
    <Panel tone={youSkunked ? "red" : "good"}>
      {dbl.length > 0 && <div style={{ fontWeight: 700, fontSize: 15 }}>Double skunk 🦨🦨 — {fmt(dbl)}</div>}
      {sk.length > 0 && <div style={{ fontWeight: 700, fontSize: 15, marginTop: dbl.length ? 4 : 0 }}>Skunk 🦨 — {fmt(sk)}</div>}
    </Panel>
  );
}

function bigBtn(label, onClick, tone) {
  const grad = tone === "wood" ? `linear-gradient(180deg, ${T.woodL}, ${T.woodM})` : `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`;
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "13px", borderRadius: 10, border: "none", cursor: "pointer",
      background: grad, color: tone === "wood" ? "#2A1B0E" : T.ivory,
      fontSize: 16, fontWeight: 700, letterSpacing: 0.3, boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
    }}>{label}</button>
  );
}

/* ============================ APP ============================ */
export default function CribbagePlay() {
  const [state, dispatch] = useReducer(reduce, undefined, initGame);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [historySeat, setHistorySeat] = React.useState(null);
  const [paused, setPaused] = React.useState(false);
  const [confirmHome, setConfirmHome] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const { phase, seats, dealerIdx, peg, show, starter, crib, winner, message, settings, dealDraw } = state;
  // Home / logo: the game hasn't really begun at "cutdeal", so leave straight to the
  // menu; once a hand is underway, confirm first since leaving forfeits the game.
  const goHome = () => { if (phase === "cutdeal") window.location.href = "index.html"; else setConfirmHome(true); };
  // The pause control only matters when at least one auto setting is on (auto-count
  // doesn't count). Nothing happens automatically while paused, or while the
  // settings/history panels are open.
  const canPause = settings.autoGo || settings.autoDeal || settings.autoContinue || settings.autoPlayOne;
  const autoPaused = paused || settingsOpen || historySeat !== null;
  useEffect(() => { if (!canPause && paused) setPaused(false); }, [canPause, paused]);

  // Self-clocking play loop: AI moves and all forced "go"s fire on a timer; a
  // human with a legal card blocks for a tap. Re-runs whenever the peg state changes.
  useEffect(() => {
    if (phase !== "play" || !peg || autoPaused) return;
    const hand = peg.hands[peg.turn];
    const legal = hand.filter((c) => pval(c.r) + peg.count <= 31);
    if (peg.turn === 0) {
      // The human acts by tapping: a legal card, or the "Go" button when stuck with
      // cards in hand. Auto-pass when there's no decision (out of cards, or auto-go
      // on with no legal play); auto-play the only legal card if that setting is on.
      const out = hand.length === 0;
      if (out || (legal.length === 0 && settings.autoGo)) {
        const t = setTimeout(() => dispatch({ type: "PASS_GO", seat: 0 }), 450);
        return () => clearTimeout(t);
      }
      if (legal.length === 1 && settings.autoPlayOne && !state.pendingPlay) {
        const card = legal[0];
        const t = setTimeout(() => dispatch({ type: "PLAY_CARD", seat: 0, card }), 450);
        return () => clearTimeout(t);
      }
      return; // wait for the human
    }
    const t = setTimeout(() => {
      if (legal.length === 0) { dispatch({ type: "PASS_GO", seat: peg.turn }); return; }
      const rank = pegChoose(legal.map((c) => c.r), peg.count, peg.pile, hand.map((c) => c.r));
      const chosen = legal.find((c) => c.r === rank) || legal[0];
      dispatch({ type: "PLAY_CARD", seat: peg.turn, card: chosen });
    }, 760);
    return () => clearTimeout(t);
  }, [phase, peg, settings.autoGo, settings.autoPlayOne, state.pendingPlay, autoPaused]);

  // Auto-deal the next hand, auto-cut the starter, and auto-advance the show —
  // each gated by its own setting. The show auto-advance waits whenever the human
  // still has a muggins claim to make.
  useEffect(() => {
    if (autoPaused || !settings.autoDeal) return;
    if (phase === "cutdeal") { const t = setTimeout(() => dispatch({ type: "DEAL" }), 1600); return () => clearTimeout(t); }
    if (phase === "deal") { const t = setTimeout(() => dispatch({ type: "DEAL" }), 650); return () => clearTimeout(t); }
  }, [phase, settings.autoDeal, autoPaused]);
  useEffect(() => {
    if (phase !== "cut" || autoPaused) return;
    // The starter is always cut automatically, after a brief beat.
    const t = setTimeout(() => dispatch({ type: "CUT" }), 650);
    return () => clearTimeout(t);
  }, [phase, autoPaused]);
  // Score the current show step as soon as it's shown — so the score/history update
  // before Continue — except a muggins step waits for the human's claim.
  useEffect(() => {
    if (phase !== "show" || !show || show.scored) return;
    const info = computeShow(state);
    const needClaim = settings.counting === "muggins" && info.owner === 0 && !show.claimSubmitted;
    if (needClaim) return;
    dispatch({ type: "SHOW_SCORE" });
  }, [phase, show, settings.counting]);
  // Auto-advance the show once the step has been scored (if enabled).
  useEffect(() => {
    if (phase !== "show" || !show || !settings.autoContinue || autoPaused || !show.scored) return;
    const t = setTimeout(() => dispatch({ type: "SHOW_NEXT" }), 1200);
    return () => clearTimeout(t);
  }, [phase, show, settings.autoContinue, autoPaused]);

  const dealer = dealerIdx === 0;
  const cutter = (dealerIdx + 3) % 4; // the player to the dealer's right cuts
  const turnNow = phase === "play" && peg ? peg.turn : phase === "over" ? winner : -1;

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 90% at 50% 0%, ${T.baizeHi}, ${T.baize})`,
      color: T.cream, fontFamily: serif, padding: "0 0 40px",
    }}>
      <style>{`
        @keyframes dealIn {from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .dealwrap > * {animation:dealIn 240ms ease both}
        .dealwrap > *:nth-child(2){animation-delay:50ms}
        .dealwrap > *:nth-child(3){animation-delay:100ms}
        .dealwrap > *:nth-child(4){animation-delay:150ms}
        .dealwrap > *:nth-child(5){animation-delay:200ms}
        button{font-family:inherit}
        button:focus-visible{outline:2px solid ${T.pegIvory}}
        @media (prefers-reduced-motion: reduce){.dealwrap > *{animation:none}}
      `}</style>

      <header style={{
        background: `linear-gradient(180deg, ${T.woodL}, ${T.woodM} 55%, ${T.woodD})`,
        padding: "14px 18px 16px", boxShadow: "0 6px 18px rgba(0,0,0,0.4)", borderBottom: "2px solid rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button onClick={goHome} aria-label="Home" title="Home" style={{
              flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: T.baize, color: T.ivory, cursor: "pointer",
              border: "none", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1,
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.12), 0 2px 5px rgba(0,0,0,0.35)",
            }}>♣</button>
            <span style={{ fontFamily: mono, fontSize: 12, color: "rgba(42,27,14,0.8)", lineHeight: 1.3 }}>4-handed vs 3 bots<br />first to 121</span>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <button onClick={goHome} aria-label="Home" style={{
              width: 40, height: 40, borderRadius: 10, cursor: "pointer",
              border: "1px solid rgba(0,0,0,0.28)", background: "rgba(42,27,14,0.14)",
              color: "#2A1B0E", fontSize: 19, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>⌂</button>
            {canPause && (
              <button onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume" : "Pause"} aria-pressed={paused} style={{
                width: 40, height: 40, borderRadius: 10, cursor: "pointer",
                border: "1px solid rgba(0,0,0,0.28)", background: paused ? "rgba(200,65,43,0.32)" : "rgba(42,27,14,0.14)",
                color: "#2A1B0E", fontSize: 17, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
              }}>{paused ? "▶" : "⏸"}</button>
            )}
            <button onClick={() => setSettingsOpen((o) => !o)} aria-label="Settings" aria-expanded={settingsOpen} style={{
              width: 40, height: 40, borderRadius: 10, cursor: "pointer",
              border: "1px solid rgba(0,0,0,0.28)", background: settingsOpen ? "rgba(42,27,14,0.28)" : "rgba(42,27,14,0.14)",
              color: "#2A1B0E", fontSize: 20, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>⚙</button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 0" }}>
        {settingsOpen && <SettingsPanel settings={settings} dispatch={dispatch} onClose={() => setSettingsOpen(false)} onAbout={() => { setSettingsOpen(false); setAboutOpen(true); }} />}
        <ScoreRow seats={seats} dealerIdx={dealerIdx} turn={turnNow} winner={phase === "over" ? winner : null}
          onPick={(i) => setHistorySeat((cur) => (cur === i ? null : i))} />
        {historySeat !== null && <HistoryPanel seatIdx={historySeat} seats={seats} onClose={() => setHistorySeat(null)} />}

        {paused && (
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.pegRed, textAlign: "center", marginTop: 8 }}>
            ⏸ Paused — automatic play is stopped. Tap ▶ to resume.
          </div>
        )}

        {message && (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, margin: "10px 2px 4px", minHeight: 16, lineHeight: 1.45 }}>
            {message}
          </div>
        )}

        {phase === "cutdeal" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel tone={dealer ? "good" : null}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Cut for deal</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>
                Lowest card deals — {dealer ? "you deal first" : `${seatName(dealerIdx)} deals first`} this game.
              </div>
            </Panel>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              {[0, 1, 2, 3].map((i) => {
                const isD = i === dealerIdx;
                return (
                  <div key={i} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: isD ? T.good : T.muted, marginBottom: 4 }}>{seatName(i)}{isD ? " (D)" : ""}</div>
                    <div style={{ display: "flex", justifyContent: "center", opacity: isD ? 1 : 0.65 }}>
                      {dealDraw ? <div style={{ width: 44 }}><Card card={dealDraw[i]} small /></div> : <CardBack small />}
                    </div>
                  </div>
                );
              })}
            </div>
            {bigBtn(dealer ? "Deal" : `Deal (${seatName(dealerIdx)}'s crib)`, () => dispatch({ type: "DEAL" }), "wood")}
          </div>
        )}

        {phase === "deal" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel tone={dealer ? "good" : null}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{dealer ? "Your deal — the crib is yours." : `${seatName(dealerIdx)} deals — the crib is theirs.`}</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>Each player gets 5 cards and throws one to the crib. First to 121 wins.</div>
            </Panel>
            <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, lineHeight: 1.7 }}>
              counting <b style={{ color: T.cream }}>{settings.counting === "muggins" ? "muggins" : "auto"}</b> ·{" "}
              go on no card <b style={{ color: T.cream }}>{settings.autoGo ? "auto" : "manual"}</b> ·{" "}
              weak-play warnings <b style={{ color: T.cream }}>{settings.warn ? "on" : "off"}</b>
              <span> — tap ⚙ to change</span>
            </div>
            {bigBtn(dealer ? "Deal" : `Deal (${seatName(dealerIdx)}'s crib)`, () => dispatch({ type: "DEAL" }), "wood")}
          </div>
        )}

        {phase === "discard" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <Panel tone={dealer ? "good" : "red"}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{dealer ? "Your crib — be greedy" : `Feeds ${seatName(dealerIdx)}'s crib — defend`}</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>Tap the card you'll throw to the crib.</div>
            </Panel>
            <OpponentBacks dealerIdx={dealerIdx} n={5} />
            <div className="dealwrap" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "nowrap" }}>
              {seats[0].dealt.map((card, i) => {
                const pd = state.pendingDiscard;
                // While a warning is up, the cards stay live: tap the selected one to
                // unselect, or tap a different one to re-pick (which re-warns if weak).
                return (
                  <Card key={cardId(card)} card={card}
                    clickable selected={pd ? pd.idx === i : false}
                    onClick={() => dispatch(pd && pd.idx === i ? { type: "CANCEL_DISCARD" } : { type: "SELECT_DISCARD", idx: i })} />
                );
              })}
            </div>
            {state.pendingDiscard && <DiscardWarning pd={state.pendingDiscard} dealer={dealer} dispatch={dispatch} />}
          </div>
        )}

        {phase === "cut" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel>
              <div style={{ fontWeight: 700, fontSize: 15 }}>The crib is set</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>
                Four cards in {dealer ? "your" : `${seatName(dealerIdx)}'s`} crib.
              </div>
            </Panel>
            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
              {[0, 1, 2, 3].map((i) => <CardBack key={i} />)}
            </div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>
              {cutter === 0 ? "You cut" : `${seatName(cutter)} cuts`} the starter…
            </div>
          </div>
        )}

        {phase === "play" && peg && (
          <PlayScreen state={state} dispatch={dispatch} />
        )}

        {phase === "show" && show && (
          <ShowScreen state={state} dispatch={dispatch} />
        )}

        {phase === "over" && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel tone="good">
              <div style={{ fontWeight: 700, fontSize: 18 }}>{winner === 0 ? "You win! 🎉" : `${seatName(winner)} wins.`}</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>First to {TARGET}. Final: {seats.map((s, i) => `${seatName(i)} ${s.score}`).join(" · ")}</div>
            </Panel>
            <SkunkPanel seats={seats} winner={winner} />
            {bigBtn("Play again", () => dispatch({ type: "PLAY_AGAIN" }), "good")}
          </div>
        )}
      </main>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}

      {confirmHome && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setConfirmHome(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360, width: "100%", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "18px", boxShadow: "0 14px 44px rgba(0,0,0,0.55)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Leave to the home menu?</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, lineHeight: 1.5, marginBottom: 16 }}>This ends the current game — scores aren't saved.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmHome(false)} style={{
                flex: 1, padding: "12px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer",
                background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 13, fontWeight: 700,
              }}>Keep playing</button>
              <a href="index.html" style={{
                flex: 1, padding: "12px", borderRadius: 9, cursor: "pointer", textDecoration: "none", textAlign: "center", boxSizing: "border-box",
                background: `linear-gradient(180deg, ${T.pegRed}, #9c3120)`, color: T.ivory, fontFamily: mono, fontSize: 13, fontWeight: 700,
              }}>Leave</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StarterStrip({ starter }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", fontFamily: mono, fontSize: 11, color: T.muted }}>
      <span>starter</span>
      <Card card={starter} small />
    </div>
  );
}

// A seat's played cards, fanned so each later card sits ~75% on top of the prior
// one (only the newest is fully visible). Falls back to face-down backs pre-play.
// A fanned row of cards: each later item sits partly on top of the previous one
// (rightmost on top). A small Card's face is absolutely positioned, so each wrapper
// needs an explicit width or it would collapse to 0px.
const STACK_VISIBLE = 0.5; // fraction of each overlapped card left showing
const overlapMargin = (w) => -Math.round(w * (1 - STACK_VISIBLE));
const cardItems = (cards) => (cards || []).map((c) => ({ key: cardId(c), w: 44, el: <Card card={c} small /> }));
const backItems = (n) => Array.from({ length: n || 0 }).map((_, k) => ({ key: "b" + k, w: 44, el: <CardBack small /> }));
function Fan({ items }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      {items.map((it, i) => (
        <div key={it.key} style={{ width: it.w, position: "relative", zIndex: i, marginLeft: i === 0 ? 0 : overlapMargin(it.w) }}>
          {it.el}
        </div>
      ))}
    </div>
  );
}
function PlayedStack({ cards, backs }) {
  return <Fan items={(cards && cards.length) ? cardItems(cards) : backItems(backs)} />;
}

// A seat's cards: remaining cards face-down and layered to the left, the played
// cards fanned on top to the right. No running count — the backs show what's left.
function SeatCell({ i, dealerIdx, active, played, remaining }) {
  return (
    <div style={{ textAlign: "center", minWidth: 0 }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: active ? T.selBlue : T.muted, marginBottom: 4 }}>
        {seatName(i)}{dealerIdx === i ? " (D)" : ""}
      </div>
      <div style={{ display: "flex", justifyContent: "center", minHeight: 64 }}>
        <Fan items={[...backItems(remaining), ...cardItems(played)]} />
      </div>
    </div>
  );
}

// North (seat 2) centered on top; West (1) and East (3) flanking below.
function OpponentRows({ dealerIdx, render }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "center" }}>{render(2)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 6px" }}>
        {render(1)}{render(3)}
      </div>
    </div>
  );
}

function OpponentBacks({ dealerIdx, n }) {
  return <OpponentRows dealerIdx={dealerIdx} render={(i) => (
    <SeatCell key={i} i={i} dealerIdx={dealerIdx} remaining={n} />
  )} />;
}

function PlayScreen({ state, dispatch }) {
  const { peg, starter, dealerIdx } = state;
  const yourHand = peg.hands[0];
  const legalSet = new Set(yourHand.filter((c) => pval(c.r) + peg.count <= 31).map(cardId));
  const yourTurn = peg.turn === 0 && legalSet.size > 0;
  const stuck = peg.turn === 0 && legalSet.size === 0 && yourHand.length > 0; // must say "go"
  const cell = (i) => (
    <SeatCell i={i} dealerIdx={dealerIdx} active={peg.turn === i}
      played={peg.played[i]} remaining={peg.hands[i].length} />
  );
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* the table: North on top, then West — STARTER — East across the middle */}
      <div style={{ display: "flex", justifyContent: "center" }}>{cell(2)}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 6px" }}>
        {cell(1)}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 4 }}>starter</div>
          <div style={{ width: 44 }}><Card card={starter} small /></div>
        </div>
        {cell(3)}
      </div>

      {/* your own played cards, sitting just above the pile */}
      {peg.played[0].length > 0 && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: peg.turn === 0 ? T.selBlue : T.muted, marginBottom: 4 }}>You{dealerIdx === 0 ? " (D)" : ""}</div>
          <PlayedStack cards={peg.played[0]} backs={0} />
        </div>
      )}

      {/* the running pile — cards fan with overlap; the running count sits beside them */}
      <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 64 }}>
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 12px", borderRadius: 9, background: "rgba(0,0,0,0.3)", border: `1px solid ${T.line}` }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>pile count</span>
            <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 28, lineHeight: 1, color: peg.count === 31 ? T.good : T.ivory }}>{peg.count}</span>
          </div>
          <div style={{ flex: "1 1 auto", display: "flex", justifyContent: "center" }}>
            {peg.pileSuited.length
              ? <PlayedStack cards={peg.pileSuited} backs={0} />
              : <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>cleared — new count from 0</span>}
          </div>
        </div>
      </div>

      {/* your seat: status, played stack, remaining hand */}
      <div>
        <div style={{ fontFamily: mono, fontSize: 11, color: (yourTurn || stuck) ? T.selBlue : T.muted, marginBottom: 6 }}>
          {peg.turn === 0
            ? (yourTurn ? "Your turn — tap a card to play."
              : stuck ? (state.settings.autoGo ? "No legal card — passing…" : "No legal card — tap Go to pass.")
              : "Your cards are all played.")
            : `${seatName(peg.turn)} to play…`}
        </div>
        {state.pendingPlay && <div style={{ marginBottom: 10 }}><PlayWarning pp={state.pendingPlay} dispatch={dispatch} /></div>}
        {stuck && !state.settings.autoGo && (
          <div style={{ marginBottom: 10 }}>
            <button onClick={() => dispatch({ type: "PASS_GO", seat: 0 })} style={{
              width: "100%", padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
              background: `linear-gradient(180deg, ${T.pegRed}, #9c3120)`, color: T.ivory,
              fontSize: 15, fontWeight: 700, letterSpacing: 0.3, boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
            }}>Say "Go"</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {yourHand.map((card) => {
            const legal = legalSet.has(cardId(card));
            const pp = state.pendingPlay;
            // While a peg warning is up, tapping any card just unselects (clears the
            // warning) — it never plays. Tap again afterward to play normally.
            return (
              <Card key={cardId(card)} card={card} selLabel="PLAY"
                clickable={pp ? true : (yourTurn && legal)}
                selected={pp ? sameCard(pp.card, card) : false}
                dim={!pp && !legal && peg.turn === 0}
                onClick={() => dispatch(pp ? { type: "CANCEL_PLAY" } : { type: "SELECT_PLAY", card })} />
            );
          })}
          {yourHand.length === 0 && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>your cards are all played</span>}
        </div>
      </div>
    </div>
  );
}

function ShowScreen({ state, dispatch }) {
  const info = computeShow(state);
  const { show, settings, seats } = state;
  const muggins = settings.counting === "muggins" && info.owner === 0;
  const needClaim = muggins && !show.claimSubmitted;
  const [claim, setClaim] = React.useState(0);
  // reset the stepper whenever a new human-counted entity comes up
  React.useEffect(() => { setClaim(0); }, [show.step]);

  const stepLabel = `${show.step + 1} of ${show.order.length}`;
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
      <Panel>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>The show · {entLabel(info)}</div>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: T.muted }}>counting {stepLabel}</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>order: pone first, dealer's crib last.</div>
      </Panel>

      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {info.cards.map((c) => <Card key={cardId(c)} card={c} small />)}
        <span style={{ fontFamily: mono, fontSize: 14, color: T.muted, padding: "0 4px" }}>+</span>
        <Card card={state.starter} small />
      </div>

      {needClaim ? (
        <div style={{ background: "rgba(0,0,0,0.26)", borderRadius: 10, padding: "14px 14px 16px" }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>
            Count {info.isCrib ? "your crib" : "your hand"} with the starter. Claim what you see —
            miss any and the next opponent takes them.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 14 }}>
            <StepBtn onClick={() => setClaim((v) => Math.max(0, v - 1))}>−</StepBtn>
            <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 34, minWidth: 48, textAlign: "center" }}>{claim}</span>
            <StepBtn onClick={() => setClaim((v) => Math.min(29, v + 1))}>+</StepBtn>
          </div>
          {bigBtn(`Claim ${claim}`, () => dispatch({ type: "SHOW_CLAIM", value: claim }), "good")}
        </div>
      ) : (
        <div style={{ background: "rgba(0,0,0,0.26)", borderRadius: 10, padding: "12px 14px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>scoring</span>
            <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 20, color: T.ivory }}>{info.total}</span>
          </div>
          {info.total > 0
            ? <CatBars cats={info.acc} scale={info.total} color={info.isCrib ? (info.owner === 0 ? T.good : T.pegRed) : T.good} />
            : <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>nineteen — no points.</div>}
          {muggins && show.claimSubmitted && (
            <div style={{ fontFamily: mono, fontSize: 11.5, color: show.claimValue >= info.total ? T.good : T.pegRed, marginTop: 10 }}>
              you claimed {show.claimValue}{show.claimValue < info.total ? ` · missed ${info.total - show.claimValue}` : show.claimValue > info.total ? " · over-claim, corrected down" : " · spot on"}
            </div>
          )}
          {bigBtn("Continue", () => dispatch({ type: "SHOW_NEXT" }), "wood")}
        </div>
      )}
    </div>
  );
}

// Shown when the human throws a card that isn't the best available: spells out the
// hand/crib numbers for their throw vs the best, with a chance to take it back.
function DiscardWarning({ pd, dealer, dispatch }) {
  const { chosen, best, delta } = pd;
  const side = dealer ? "for you" : "to the dealer";
  const Line = ({ label, o, strong }) => (
    <div style={{ fontFamily: mono, fontSize: 11.5, lineHeight: 1.6, color: strong ? T.cream : T.muted }}>
      <b style={{ color: strong ? T.good : T.ivory }}>{label}</b> throw {tag(o.thrown)} · keep {o.four.map(tag).join(" ")} · hand {o.keptEV.toFixed(2)} · crib {o.cribSwing.toFixed(2)} {side} → net <b>{o.value.toFixed(2)}</b>
    </div>
  );
  return (
    <Panel tone="red">
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Not the best throw — off by {delta.toFixed(2)} pts</div>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        <Line label="Best:&nbsp;" o={best} strong />
        <Line label="Yours:" o={chosen} />
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.cream, marginBottom: 12 }}>
        “hand” = your kept four averaged over every cut; “crib” = the thrown card's average value in the crib
        ({dealer ? "added to your score" : "given to the dealer, so subtracted"}). Net is the two combined.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => dispatch({ type: "CONFIRM_DISCARD" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer",
          background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>Throw {tag(chosen.thrown)} anyway</button>
        <button onClick={() => dispatch({ type: "CANCEL_DISCARD" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: "none", cursor: "pointer",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>Pick again</button>
      </div>
    </Panel>
  );
}

const segStyle = (on) => ({
  flex: 1, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: 11.5,
  background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
  border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
});

function SettingsPanel({ settings, dispatch, onClose, onAbout }) {
  const Row = ({ title, desc, k, options }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, margin: "2px 0 7px", lineHeight: 1.45 }}>{desc}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {options.map(([label, val]) => (
          <button key={String(val)} onClick={() => dispatch({ type: "SET_SETTING", key: k, value: val })} style={segStyle(settings[k] === val)}>{label}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div style={{ background: "rgba(0,0,0,0.32)", border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 16px 4px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Settings</span>
        <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>Done</button>
      </div>
      <Row title="Counting" k="counting"
        desc="Auto tallies every hand for you. Muggins: you claim your own hand (and crib when you deal) — miss points and the next opponent takes them."
        options={[["Auto-count", "auto"], ["Muggins", "muggins"]]} />
      <Row title="Go on no playable card" k="autoGo"
        desc={'When you can’t play, Manual waits for you to tap “Go”; Auto passes for you.'}
        options={[["Manual", false], ["Auto", true]]} />
      <Row title="Warn on a weak play" k="warn"
        desc="Pause and explain when your throw to the crib — or a pegging card that leaves a point on the table — isn’t the best, with a chance to take it back."
        options={[["On", true], ["Off", false]]} />
      <Row title="Auto-play a forced card" k="autoPlayOne"
        desc="When only one of your cards is legal to peg, play it for you."
        options={[["Off", false], ["On", true]]} />
      <Row title="Auto-continue the show" k="autoContinue"
        desc="Advance the counting automatically (still pauses for your muggins claim)."
        options={[["Off", false], ["On", true]]} />
      <Row title="Auto-deal the next hand" k="autoDeal"
        desc="Deal the next hand automatically once a hand is fully counted."
        options={[["Off", false], ["On", true]]} />
      <AboutRow onAbout={onAbout} />
    </div>
  );
}

// A standard footer for the settings panel: an "About & feedback" entry that opens
// the About popup. Shared verbatim across the trainer and both games.
function AboutRow({ onAbout }) {
  return (
    <div style={{ borderTop: `1px solid ${T.line}`, margin: "2px -16px 0", padding: "12px 16px 4px" }}>
      <button onClick={onAbout} style={{
        width: "100%", padding: "10px", borderRadius: 9, cursor: "pointer",
        border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream,
        fontFamily: mono, fontSize: 12, fontWeight: 700,
      }}>About &amp; feedback</button>
    </div>
  );
}

// The About popup: open-source/public-domain note plus a link to the GitHub repo
// for reporting bugs or sharing feedback. Reached from the bottom of Settings.
function AboutModal({ onClose }) {
  const REPO = "https://github.com/ghug/cribbage-trainer/";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "20px", boxShadow: "0 14px 44px rgba(0,0,0,0.55)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span aria-hidden="true" style={{ flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: "rgba(0,0,0,0.25)", color: T.ivory, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1 }}>♣</span>
          <span style={{ fontWeight: 700, fontSize: 17 }}>About</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, lineHeight: 1.6, marginBottom: 12 }}>
          A free, open-source cribbage trainer and game — public domain, no accounts, no tracking.
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, lineHeight: 1.6, marginBottom: 16 }}>
          Found a bug, or have feedback? The source lives on GitHub — open an issue there to be part of the conversation.
        </div>
        <a href={REPO} target="_blank" rel="noopener noreferrer" style={{
          display: "block", textAlign: "center", padding: "12px", borderRadius: 9, textDecoration: "none", boxSizing: "border-box",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>Source, bugs &amp; feedback ↗</a>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, textAlign: "center", margin: "8px 0 16px", wordBreak: "break-all" }}>github.com/ghug/cribbage-trainer</div>
        <button onClick={onClose} style={{ width: "100%", padding: "11px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer", background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 12.5, fontWeight: 700 }}>Close</button>
      </div>
    </div>
  );
}

// Shown when the human pegs a card that scores fewer points than the best legal
// play (by at least one), with a chance to take it back.
function PlayWarning({ pp, dispatch }) {
  return (
    <Panel tone="red">
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>That leaves {pp.delta} point{pp.delta === 1 ? "" : "s"} on the table</div>
      <div style={{ fontFamily: mono, fontSize: 11.5, lineHeight: 1.6, color: T.cream, marginBottom: 12 }}>
        {tag(pp.card)} scores {pp.chosenPts} here · <b style={{ color: T.good }}>{tag(pp.bestCard)}</b> would score {pp.bestPts} (+{pp.delta}).
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => dispatch({ type: "CONFIRM_PLAY" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer",
          background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>Play {tag(pp.card)} anyway</button>
        <button onClick={() => dispatch({ type: "CANCEL_PLAY" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: "none", cursor: "pointer",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>Pick again</button>
      </div>
    </Panel>
  );
}

function StepBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 52, height: 52, borderRadius: 12, cursor: "pointer", border: `1px solid ${T.line}`,
      background: "rgba(0,0,0,0.3)", color: T.ivory, fontSize: 26, fontFamily: serif, fontWeight: 700,
    }}>{children}</button>
  );
}
