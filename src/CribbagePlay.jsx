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
function Card({ card, onClick, clickable, badge, dim, selected, small }) {
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
        }}>{badge ? badge.text : "THROW"}</span>
      )}
      <button
        onClick={clickable ? onClick : undefined}
        onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
        aria-label={`${rankLabel(card.r)} of ${["spades", "hearts", "diamonds", "clubs"][card.s]}`}
        style={{
          width: "100%", aspectRatio: "68 / 96", containerType: "inline-size",
          borderRadius: small ? 7 : 9, padding: 0, background: T.ivory, position: "relative",
          cursor: clickable ? "pointer" : "default",
          border: edge ? `2px solid ${edge}` : "1px solid rgba(0,0,0,0.25)",
          boxShadow: badge || selected ? "0 8px 18px rgba(0,0,0,0.45)" : "0 4px 10px rgba(0,0,0,0.35)",
          transform: `translateY(${lift}px)`, transition: "transform 140ms ease, box-shadow 140ms ease",
          opacity: dim ? 0.42 : 1, outlineOffset: 3,
        }}
      >
        <span style={{
          position: "absolute", top: "8.8cqw", left: "10.3cqw", lineHeight: 1, textAlign: "center",
          color: isRed(card.s) ? T.suitRed : T.ink, fontFamily: serif, fontWeight: 700,
        }}>
          <span style={{ fontSize: "25cqw", display: "block" }}>{rankLabel(card.r)}</span>
          <span style={{ fontSize: "19cqw" }}>{SUIT[card.s]}</span>
        </span>
        <span style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "50cqw", color: isRed(card.s) ? T.suitRed : T.ink,
        }}>{SUIT[card.s]}</span>
      </button>
    </div>
  );
}

function CardBack({ small }) {
  const base = small ? 30 : 50;
  return (
    <div style={{
      width: base, aspectRatio: "68 / 96", borderRadius: small ? 6 : 8,
      background: `repeating-linear-gradient(45deg, ${T.woodD}, ${T.woodD} 5px, ${T.woodM} 5px, ${T.woodM} 10px)`,
      border: "1px solid rgba(0,0,0,0.4)", boxShadow: "0 3px 8px rgba(0,0,0,0.35)",
      position: "relative",
    }}>
      <span style={{ position: "absolute", inset: small ? 3 : 5, border: "1px solid rgba(236,224,182,0.25)", borderRadius: 4 }} />
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
const award = (seats, i, delta) => seats.map((s, j) => (j === i ? { ...s, score: s.score + delta } : s));
const initPeg = (seats, dealerIdx) => ({
  hands: seats.map((s) => s.kept.slice()),
  turn: (dealerIdx + 1) % 4,
  count: 0, pile: [], pileSuited: [], played: [[], [], [], []],
  passes: 0, lastPlayer: -1,
});
const initShow = (dealerIdx) => ({
  order: [(dealerIdx + 1) % 4, (dealerIdx + 2) % 4, (dealerIdx + 3) % 4, dealerIdx, "CRIB"],
  step: 0, claimSubmitted: false, claimValue: null,
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

function scoreCallout(pile, count, pts) {
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
  const label = parts.length ? parts.join(" + ") : "points";
  return `${label} for ${pts}`;
}

function dealNewHand(state) {
  const deck = freshDeck();
  const seats = [0, 1, 2, 3].map((i) => ({
    score: state.seats[i].score, isAI: i !== 0,
    dealt: sortHand(deck.slice(i * 5, i * 5 + 5)), kept: null, discard: null,
  }));
  for (let i = 1; i < 4; i++) {
    const { discard, kept } = aiDiscard(seats[i].dealt, i, state.dealerIdx);
    seats[i].discard = discard; seats[i].kept = sortHand(kept);
  }
  return {
    ...state, seats, deck, starter: null, crib: [], hisHeels: false,
    peg: null, show: null, winner: null, phase: "discard", message: "",
  };
}

function reduce(state, action) {
  switch (action.type) {
    case "DEAL":
      return dealNewHand(state);

    case "TOGGLE_COUNTING":
      return { ...state, settings: { ...state.settings, counting: state.settings.counting === "auto" ? "muggins" : "auto" } };

    case "DISCARD": {
      const dealt = state.seats[0].dealt;
      const discard = dealt[action.idx];
      const kept = sortHand(dealt.filter((_, j) => j !== action.idx));
      const seats = state.seats.map((s, i) => (i === 0 ? { ...s, discard, kept } : s));
      const crib = seats.map((s) => s.discard); // one throw from each of the four seats
      return { ...state, seats, crib, phase: "cut" };
    }

    case "CUT": {
      const starter = state.deck[20]; // the next undealt card after 4 hands of 5
      const hisHeels = starter.r === 11;
      let seats = state.seats, winner = null, message = `Cut: ${tag(starter)}.`;
      if (hisHeels) {
        seats = award(seats, state.dealerIdx, 2);
        message = `His heels — ${sv(state.dealerIdx, "peg", "pegs")} 2 for the Jack (${tag(starter)}).`;
        if (seats[state.dealerIdx].score >= TARGET) winner = state.dealerIdx;
      }
      if (winner !== null) return { ...state, starter, hisHeels, seats, winner, phase: "over", message };
      return { ...state, starter, hisHeels, seats, peg: initPeg(seats, state.dealerIdx), phase: "play", message };
    }

    case "PLAY_CARD": {
      const { seat, card } = action;
      const peg = state.peg;
      const hands = peg.hands.map((h, i) => (i === seat ? h.filter((c) => !sameCard(c, card)) : h));
      const count = peg.count + pval(card.r);
      const pile = peg.pile.concat(card.r);
      const pileSuited = peg.pileSuited.concat(card);
      const played = peg.played.map((p, i) => (i === seat ? p.concat(card) : p));
      const pts = pegScore(pile, count);
      let seats = award(state.seats, seat, pts);
      let message = pts > 0 ? `${seatName(seat)}: ${scoreCallout(pile, count, pts)}.` : `${sv(seat, "play", "plays")} ${tag(card)} (count ${count}).`;
      let np = { ...peg, hands, count, pile, pileSuited, played, lastPlayer: seat, passes: 0 };
      if (count === 31) { np.count = 0; np.pile = []; np.pileSuited = []; np.lastPlayer = -1; }
      if (seats[seat].score >= TARGET) return { ...state, seats, peg: np, phase: "over", winner: seat, message };

      const remaining = hands.reduce((a, h) => a + h.length, 0);
      if (remaining === 0) {
        if (np.lastPlayer >= 0) { // not already reset by a 31; award last-card +1
          seats = award(seats, seat, 1);
          message += ` ${seatName(seat)} +1 for last card.`;
          if (seats[seat].score >= TARGET) return { ...state, seats, peg: np, phase: "over", winner: seat, message };
        }
        return { ...state, seats, peg: np, phase: "show", show: initShow(state.dealerIdx), message };
      }
      np.turn = (seat + 1) % 4;
      return { ...state, seats, peg: np, message };
    }

    case "PASS_GO": {
      const peg = state.peg, seat = action.seat;
      const passes = peg.passes + 1;
      if (passes >= 4) { // a full rotation with nobody able to play -> award the go
        let seats = state.seats, message = `${sv(seat, "say", "says")} "go".`;
        const np = { ...peg, passes: 0, turn: (seat + 1) % 4 };
        if (peg.lastPlayer >= 0 && peg.count !== 31) {
          seats = award(seats, peg.lastPlayer, 1);
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

    case "SHOW_NEXT": {
      const info = computeShow(state);
      const counting = state.settings.counting;
      let seats = state.seats, message = "", winner = null;
      const humanCount = counting === "muggins" && info.owner === 0;
      if (humanCount) {
        const claim = state.show.claimValue || 0;
        const awarded = Math.min(claim, info.total);
        seats = award(seats, info.owner, awarded);
        if (seats[info.owner].score >= TARGET) winner = info.owner;
        const missed = info.total - awarded;
        if (missed > 0 && winner === null) {
          const rest = state.show.order.slice(state.show.step + 1).map((e) => (e === "CRIB" ? state.dealerIdx : e));
          let recip = rest.find((o) => o !== 0);
          if (recip === undefined) recip = (state.dealerIdx + 1) % 4; // no opponent left to count -> eldest
          seats = award(seats, recip, missed);
          message = `Muggins! ${seatName(recip)} claims the ${missed} you missed (had ${info.total}).`;
          if (seats[recip].score >= TARGET) winner = recip;
        } else {
          message = `You count ${awarded}${claim > info.total ? " — over-claim corrected down" : ""}.`;
        }
      } else {
        seats = award(seats, info.owner, info.total);
        message = `${entLabel(info)} scores ${info.total}.`;
        if (seats[info.owner].score >= TARGET) winner = info.owner;
      }
      if (winner !== null) return { ...state, seats, phase: "over", winner, message };

      const nextStep = state.show.step + 1;
      if (nextStep >= state.show.order.length)
        return { ...state, seats, phase: "deal", dealerIdx: (state.dealerIdx + 1) % 4, show: null, peg: null, message: "Hand complete — deal the next." };
      return { ...state, seats, show: { ...state.show, step: nextStep, claimSubmitted: false, claimValue: null }, message };
    }

    case "PLAY_AGAIN":
      return dealNewHand({ ...state, seats: state.seats.map((s) => ({ ...s, score: 0 })), dealerIdx: (Math.random() * 4) | 0 });

    default:
      return state;
  }
}

function initGame() {
  return {
    seats: [0, 1, 2, 3].map((i) => ({ score: 0, isAI: i !== 0, dealt: [], kept: null, discard: null })),
    dealerIdx: (Math.random() * 4) | 0,
    deck: [], starter: null, crib: [], hisHeels: false,
    peg: null, show: null, winner: null, phase: "deal", message: "", settings: { counting: "auto" },
  };
}

/* ============================ UI BITS ============================ */
function ScoreRow({ seats, dealerIdx, turn, winner }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, margin: "0 0 6px" }}>
      {seats.map((s, i) => {
        const isTurn = turn === i;
        const isWin = winner === i;
        return (
          <div key={i} style={{
            padding: "8px 8px 9px", borderRadius: 9, textAlign: "center",
            background: isWin ? "rgba(95,164,124,0.28)" : isTurn ? "rgba(91,149,194,0.22)" : "rgba(0,0,0,0.22)",
            border: `1px solid ${isWin ? T.good : isTurn ? T.selBlue : T.line}`,
          }}>
            <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, display: "flex", justifyContent: "center", gap: 4, alignItems: "center" }}>
              {seatName(i)}{dealerIdx === i && <span style={{ color: T.pegIvory, fontWeight: 700 }} title="dealer">⬤D</span>}
            </div>
            <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 22, color: isWin ? T.good : T.ivory }}>{s.score}</div>
            <div style={{ marginTop: 4 }}><PegTrack pct={(s.score / TARGET) * 100} /></div>
          </div>
        );
      })}
    </div>
  );
}

function Panel({ children, tone }) {
  const bg = tone === "good" ? "rgba(95,164,124,0.16)" : tone === "red" ? "rgba(200,65,43,0.14)" : "rgba(0,0,0,0.22)";
  const bd = tone === "good" ? "rgba(95,164,124,0.5)" : tone === "red" ? "rgba(200,65,43,0.45)" : T.line;
  return <div style={{ padding: "11px 14px", borderRadius: 10, background: bg, border: `1px solid ${bd}` }}>{children}</div>;
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
  const { phase, seats, dealerIdx, peg, show, starter, crib, winner, message, settings } = state;

  // Self-clocking play loop: AI moves and all forced "go"s fire on a timer; a
  // human with a legal card blocks for a tap. Re-runs whenever the peg state changes.
  useEffect(() => {
    if (phase !== "play" || !peg) return;
    const hand = peg.hands[peg.turn];
    const legal = hand.filter((c) => pval(c.r) + peg.count <= 31);
    if (peg.turn === 0) {
      // The human always acts by tapping: a legal card, or the "Go" button when
      // stuck with cards in hand. Only auto-skip once they're out of cards (no
      // decision to make), mirroring how an empty seat just passes the rotation.
      if (hand.length > 0) return;
      const t = setTimeout(() => dispatch({ type: "PASS_GO", seat: 0 }), 450);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (legal.length === 0) { dispatch({ type: "PASS_GO", seat: peg.turn }); return; }
      const rank = pegChoose(legal.map((c) => c.r), peg.count, peg.pile, hand.map((c) => c.r));
      const chosen = legal.find((c) => c.r === rank) || legal[0];
      dispatch({ type: "PLAY_CARD", seat: peg.turn, card: chosen });
    }, 760);
    return () => clearTimeout(t);
  }, [phase, peg]);

  const dealer = dealerIdx === 0;
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 22, color: "#2A1B0E", letterSpacing: 0.3, fontWeight: 700 }}>Cribbage — Play</h1>
          <span style={{ fontFamily: mono, fontSize: 11, color: "rgba(42,27,14,0.75)" }}>4-handed cutthroat · first to 121</span>
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 0" }}>
        <ScoreRow seats={seats} dealerIdx={dealerIdx} turn={turnNow} winner={phase === "over" ? winner : null} />

        {message && (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, margin: "10px 2px 4px", minHeight: 16, lineHeight: 1.45 }}>
            {message}
          </div>
        )}

        {phase === "deal" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel tone={dealer ? "good" : null}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{dealer ? "Your deal — the crib is yours." : `${seatName(dealerIdx)} deals — the crib is theirs.`}</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>Each player gets 5 cards and throws one to the crib. First to 121 wins.</div>
            </Panel>
            <div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 6 }}>counting</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["auto", "Auto-count"], ["muggins", "Muggins"]].map(([k, label]) => {
                  const on = settings.counting === k;
                  return (
                    <button key={k} onClick={() => settings.counting !== k && dispatch({ type: "TOGGLE_COUNTING" })} style={{
                      flex: 1, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: 11.5,
                      background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
                      border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
                    }}>{label}</button>
                  );
                })}
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>
                {settings.counting === "muggins"
                  ? "Muggins: you claim your own hand (and crib when you deal). Miss points and the next opponent takes them; over-claims are corrected down."
                  : "Auto-count: every hand is tallied for you, in order, so nothing is missed."}
              </div>
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
            <OpponentBacks dealerIdx={dealerIdx} n={5} label="5 cards" />
            <div className="dealwrap" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "nowrap" }}>
              {seats[0].dealt.map((card, i) => (
                <Card key={cardId(card)} card={card} clickable onClick={() => dispatch({ type: "DISCARD", idx: i })} />
              ))}
            </div>
          </div>
        )}

        {phase === "cut" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel>
              <div style={{ fontWeight: 700, fontSize: 15 }}>The crib is set</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>Four cards in {dealer ? "your" : `${seatName(dealerIdx)}'s`} crib. Cut for the starter.</div>
            </Panel>
            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
              {[0, 1, 2, 3].map((i) => <CardBack key={i} />)}
            </div>
            {bigBtn("Cut the starter", () => dispatch({ type: "CUT" }), "wood")}
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
            {starter && <StarterStrip starter={starter} />}
            {bigBtn("Play again", () => dispatch({ type: "PLAY_AGAIN" }), "good")}
          </div>
        )}
      </main>
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
function PlayedStack({ cards, backs }) {
  if (!cards || cards.length === 0) {
    return <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>{Array.from({ length: backs }).map((_, k) => <CardBack key={k} small />)}</div>;
  }
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      {cards.map((c, i) => (
        <div key={cardId(c)} style={{ position: "relative", zIndex: i, marginLeft: i === 0 ? 0 : -33 }}>
          <Card card={c} small />
        </div>
      ))}
    </div>
  );
}

function SeatCell({ i, dealerIdx, active, played, backs, label }) {
  return (
    <div style={{ textAlign: "center", minWidth: 0 }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: active ? T.selBlue : T.muted, marginBottom: 4 }}>
        {seatName(i)}{dealerIdx === i ? " (D)" : ""}{label ? ` · ${label}` : ""}
      </div>
      <div style={{ display: "flex", justifyContent: "center", minHeight: 64 }}>
        <PlayedStack cards={played} backs={backs} />
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

function OpponentBacks({ dealerIdx, n, label }) {
  return <OpponentRows dealerIdx={dealerIdx} render={(i) => (
    <SeatCell key={i} i={i} dealerIdx={dealerIdx} backs={n} label={label} />
  )} />;
}

function PlayScreen({ state, dispatch }) {
  const { peg, starter, dealerIdx } = state;
  const yourHand = peg.hands[0];
  const legalSet = new Set(yourHand.filter((c) => pval(c.r) + peg.count <= 31).map(cardId));
  const yourTurn = peg.turn === 0 && legalSet.size > 0;
  const stuck = peg.turn === 0 && legalSet.size === 0 && yourHand.length > 0; // must say "go"
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* starter + count, held well apart so the count never tucks under the card */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 34 }}>
        <StarterStrip starter={starter} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "5px 16px", borderRadius: 10, background: "rgba(0,0,0,0.28)", border: `1px solid ${T.line}` }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>count</span>
          <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 30, lineHeight: 1.05, color: peg.count === 31 ? T.good : T.ivory }}>{peg.count}</span>
        </div>
      </div>

      {/* opponents' laid cards — North centered above West & East */}
      <OpponentRows dealerIdx={dealerIdx} render={(i) => (
        <SeatCell key={i} i={i} dealerIdx={dealerIdx} active={peg.turn === i}
          played={peg.played[i]} backs={peg.hands[i].length} label={`${peg.hands[i].length} left`} />
      )} />

      {/* the running pile */}
      <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px" }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 6 }}>the pile</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minHeight: 64 }}>
          {peg.pileSuited.length
            ? peg.pileSuited.map((c, k) => <Card key={k} card={c} small />)
            : <span style={{ fontFamily: mono, fontSize: 11, color: T.muted, alignSelf: "center" }}>cleared — new count from 0</span>}
        </div>
      </div>

      {/* your seat: status, played stack, remaining hand */}
      <div>
        <div style={{ fontFamily: mono, fontSize: 11, color: (yourTurn || stuck) ? T.selBlue : T.muted, marginBottom: 6 }}>
          {peg.turn === 0
            ? (yourTurn ? "Your turn — tap a card to play." : stuck ? "No legal card — tap Go to pass." : "Your cards are all played.")
            : `${seatName(peg.turn)} to play…`}
        </div>
        {peg.played[0].length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <PlayedStack cards={peg.played[0]} backs={0} />
          </div>
        )}
        {stuck && (
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
            return (
              <Card key={cardId(card)} card={card} clickable={yourTurn && legal} dim={!legal && peg.turn === 0}
                onClick={() => dispatch({ type: "PLAY_CARD", seat: 0, card })} />
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

function StepBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 52, height: 52, borderRadius: 12, cursor: "pointer", border: `1px solid ${T.line}`,
      background: "rgba(0,0,0,0.3)", color: T.ivory, fontSize: 26, fontFamily: serif, fontWeight: 700,
    }}>{children}</button>
  );
}
