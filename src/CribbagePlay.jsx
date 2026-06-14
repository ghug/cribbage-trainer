import React, { useReducer, useEffect } from "react";

/* ============================================================
   CONSOLIDATED PLAY PAGE — one playable game that adapts to the table size set
   in Settings ("players"). Currently supports 2 (heads-up) and 3 (cutthroat).
   The engine is general (deal/crib/show/pegging are computed from the player
   count), so adding 4/5/6 later is mostly widening PLAYER_OPTIONS.

   VERIFIED CRIBBAGE ENGINE — copied verbatim from the other pages (independent,
   self-contained; the pages never share a module). scoreInto is unit-tested:
   perfect 29 -> 16/12/0/0/1.
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

function handDetail(four, dealt) {
  const deck = deckExcluding(dealt);
  const acc = [0, 0, 0, 0, 0];
  let total = 0, sq = 0, mn = 99, mx = 0;
  for (const st of deck) {
    const t = scoreInto(four, st, false, acc);
    total += t; sq += t * t; if (t < mn) mn = t; if (t > mx) mx = t;
  }
  const n = deck.length;
  const ev = total / n;
  const sd = Math.sqrt(Math.max(0, sq / n - ev * ev));
  const locked = lockedFour(four);
  return { ev, sd, mn, mx, cats: acc.map((x) => x / n), locked, fromCut: ev - locked };
}

/* ===== Pegging (play phase) ===== suits are irrelevant to pegging, so the
   pile / hand arrays handed to pegScore & pegChoose are ranks 1..13. Scoring
   mechanics unit-tested in engine/pegging.js. The bots play a greedy
   point-grabbing policy with light defense. */
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

/* Per-rank crib value ("crib swing"), the "your" row from CLAUDE.md (index 0=A .. 12=K). */
const CRIB_VALUE = [3.96, 3.95, 4.05, 4.06, 6.38, 4.10, 4.21, 4.34, 4.09, 3.74, 4.19, 3.73, 3.85];

// Two thrown cards' combined crib value as a seed (heads-up throws two): ~one-card
// value of each plus bonuses for a pair / fifteen / run adjacency they make together.
function cribSeed(a, b) {
  let v = (CRIB_VALUE[a.r - 1] + CRIB_VALUE[b.r - 1]) * 0.5;
  if (a.r === b.r) v += 2;
  else if (Math.abs(a.r - b.r) <= 2) v += 0.5;
  if (fifteenVal(a.r) + fifteenVal(b.r) === 15) v += 2;
  return v;
}
const twoCombos = (n) => { const out = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]); return out; };

// Bot discard: throw `n` cards (1 or 2) maximising kept-hand EV plus the crib swing
// of the throw. The crib helps whoever's TEAM the dealer is on, so a throw is +EV
// when this seat is on the dealer's team (the crib is "ours"), −EV otherwise.
// Returns { discard: [cards], kept: [cards] } — discard is always an array.
function aiDiscardN(dealt, seat, dealerIdx, n, P, teams) {
  const sign = teamOf(seat, P, teams) === teamOf(dealerIdx, P, teams) ? 1 : -1;
  if (n === 2) {
    let best = null, bv = -1e9;
    for (const idxs of twoCombos(dealt.length)) {
      const four = dealt.filter((_, j) => !idxs.includes(j));
      const thrown = idxs.map((i) => dealt[i]);
      const val = handDetail(four, dealt).ev + sign * cribSeed(thrown[0], thrown[1]);
      if (val > bv) { bv = val; best = { discard: thrown, kept: four }; }
    }
    return best;
  }
  let bi = 0, bv = -1e9;
  for (let idx = 0; idx < dealt.length; idx++) {
    const four = dealt.filter((_, j) => j !== idx);
    const val = handDetail(four, dealt).ev + sign * CRIB_VALUE[dealt[idx].r - 1];
    if (val > bv) { bv = val; bi = idx; }
  }
  return { discard: [dealt[bi]], kept: dealt.filter((_, j) => j !== bi) };
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

// Seat names adapt to the table size. Heads-up calls the bot "Opponent"; larger
// tables use compass seats with the human at seat 0. SEAT_NAMES is set per game.
// In a hot-seat game with 2+ humans, "You" is ambiguous, so seat 0 takes the compass
// name South (and the heads-up opponent becomes North) instead of You/Opponent.
// Position-based compass names (6-handed seats the lower flanks as Southwest/Southeast —
// a full hexagon S, SW, NW, N, NE, SE; 3-/4-/5-handed keep plain West/East). The lone
// human seat, if any, is overridden to "You".
function seatNamesFor(P, youSeat) {
  const names = new Array(P);
  names[0] = "South";
  if (P === 2) { names[1] = "North"; }
  else {
    names[1] = P === 6 ? "Southwest" : "West";
    names[P - 1] = P === 6 ? "Southeast" : "East";
    const tops = []; for (let i = 2; i <= P - 2; i++) tops.push(i);
    const labels = tops.length <= 1 ? ["North"] : tops.length === 2 ? ["Northwest", "Northeast"] : ["Northwest", "North", "Northeast"];
    tops.forEach((s, k) => { names[s] = labels[k]; });
  }
  if (youSeat != null && youSeat >= 0) names[youSeat] = "You";
  return names;
}
let SEAT_NAMES = seatNamesFor(2, 0);
const setSeatNames = (P, youSeat) => { SEAT_NAMES = seatNamesFor(P, youSeat); };
const seatName = (i) => SEAT_NAMES[i];
// Short compass labels for the tight grid spots (score columns, cut-for-deal row, the
// pegging seat cells) so 5-/6-handed tables don't overflow a narrow phone. Prose (the
// message line, banners, history) keeps the full names.
const SEAT_SHORT = { North: "N", South: "S", West: "W", East: "E", Northwest: "NW", Northeast: "NE", Southwest: "SW", Southeast: "SE" };
const seatShort = (i) => SEAT_SHORT[SEAT_NAMES[i]] || SEAT_NAMES[i];
const poss = (i) => (i === 0 ? "Your" : `${seatName(i)}'s`);
const sv = (i, first, third) => (i === 0 ? `You ${first}` : `${seatName(i)} ${third}`);
const sameCard = (a, b) => a.r === b.r && a.s === b.s;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

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
// Every card on the page — face up or down, in hand, stacked, the starter, the deck — is
// the same width: `--cw`, a CSS variable set on <main> and sized so six cards span the
// column (the heads-up hand). So one knob drives the whole table's card scale.
function Card({ card, onClick, clickable, badge, dim, selected, raised, selLabel }) {
  const [hover, setHover] = React.useState(false);
  const lift = badge || selected ? -8 : hover && clickable ? -6 : 0;
  const edge = badge ? badge.color : (selected || raised) ? T.selBlue : null;
  // `raised` (tap-to-select mode) lifts the card by 10% of its own height — a translateY
  // percentage is relative to the element, so it scales with the card automatically.
  const elevated = badge || selected || raised;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: "var(--cw)", flex: "0 0 auto" }}>
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
          width: "100%", borderRadius: 8, padding: 0, background: T.ivory, position: "relative",
          cursor: clickable ? "pointer" : "default",
          border: edge ? `2px solid ${edge}` : "1px solid rgba(0,0,0,0.25)",
          boxShadow: elevated ? "0 8px 18px rgba(0,0,0,0.45)" : "0 4px 10px rgba(0,0,0,0.35)",
          transform: raised ? "translateY(-10%)" : `translateY(${lift}px)`, transition: "transform 140ms ease, box-shadow 140ms ease",
          opacity: dim ? 0.42 : 1, outlineOffset: 3,
        }}
      >
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

function CardBack() {
  return (
    <div style={{
      width: "var(--cw)", aspectRatio: "68 / 96", borderRadius: 8,
      background: `repeating-linear-gradient(45deg, ${T.woodD}, ${T.woodD} 5px, ${T.woodM} 5px, ${T.woodM} 10px)`,
      border: "1px solid rgba(0,0,0,0.4)", boxShadow: "0 3px 8px rgba(0,0,0,0.35)",
      position: "relative",
    }}>
      <span style={{ position: "absolute", top: 5, left: 5, right: 5, bottom: 5, border: "1px solid rgba(236,224,182,0.25)", borderRadius: 5 }} />
    </div>
  );
}

// A slim progress rail that fills to the score's share of the target, with a peg at the
// head. Scales to any column width, so it never wraps into a cramped dot matrix the way
// a fixed row of holes did on narrow 5-/6-handed layouts.
function PegTrack({ pct }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: "relative", width: "100%", height: 8, borderRadius: 4, background: "rgba(0,0,0,0.4)", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${p}%`, borderRadius: 4, background: "rgba(95,164,124,0.55)" }} />
      <div style={{ position: "absolute", left: `${p}%`, top: "50%", width: 9, height: 9, transform: "translate(-50%,-50%)", borderRadius: "50%", background: T.pegRed, boxShadow: "0 0 0 2px rgba(236,220,180,0.5)" }} />
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
// 5- and 6-handed are short games to 61 (the skunk/double-skunk lines halve to
// match: 30 and 15); everyone else plays the full 121.
const targetFor = (P) => (P >= 5 ? 61 : 121);
const skunkLines = (P) => (P >= 5 ? { skunk: 30, dbl: 15 } : { skunk: 90, dbl: 60 });
const PLAYER_OPTIONS = [2, 3, 4, 5, 6]; // table sizes this page supports (2 heads-up … 6 cutthroat)
const clampPlayers = (p) => (PLAYER_OPTIONS.includes(p) ? p : 2);
// Team counts available at a given table size. Default is one team per player
// (cutthroat); 4 players may pair into 2 teams, 6 into 3 or 2. (Setting only for
// now — no scoring/gameplay change yet.) Sizes without a choice return just [P].
function teamOptions(P) {
  if (P === 4) return [4, 2];
  if (P === 6) return [6, 3, 2];
  return [P];
}
const clampTeams = (P, t) => (teamOptions(P).includes(t) ? t : P);
// Which team a seat belongs to: seat % teams (teams always divides the player count
// in the offered configs). This produces exactly the intended partnerships:
//   4-handed / 2 teams → across-the-table pairs {0,2} (You & North) and {1,3};
//   6-handed / 3 teams → across pairs {0,3}, {1,4}, {2,5};
//   6-handed / 2 teams → every other seat: {0,2,4} and {1,3,5}, three to a team.
// Cutthroat (teams === P) is seat % P === seat, i.e. each seat is its own team.
function teamOf(seat, P, teams) {
  return seat % teams;
}
// Seats grouped into teams, in seat order of each team's lowest member.
function teamsList(P, teams) {
  const groups = new Map();
  for (let i = 0; i < P; i++) { const t = teamOf(i, P, teams); if (!groups.has(t)) groups.set(t, []); groups.get(t).push(i); }
  return [...groups.values()];
}
const teamLabel = (members) => members.map(seatName).join(" & ");

// The deal plan for a table of P with this dealer: per-seat dealt count and throw
// count, whether the dealer flips a deck card into the crib (3-handed), and the
// starter's index in the shuffled deck. General for P = 2..6.
function plan(P, dealerIdx) {
  const right = (dealerIdx + P - 1) % P;
  const sizes = [], throws = [];
  for (let i = 0; i < P; i++) {
    let size, thr;
    if (P === 2) { size = 6; thr = 2; }
    else if (P <= 4) { size = 5; thr = 1; }
    else if (P === 5) { if (i === dealerIdx) { size = 4; thr = 0; } else { size = 5; thr = 1; } }
    else { if (i === dealerIdx || i === right) { size = 4; thr = 0; } else { size = 5; thr = 1; } }
    sizes.push(size); throws.push(thr);
  }
  const deckCard = P === 3;                  // dealer flips one off the deck to fill the crib
  const totalDealt = sizes.reduce((a, b) => a + b, 0);
  return { sizes, throws, deckCard, right, deckIdx: totalDealt, starterIdx: totalDealt + (deckCard ? 1 : 0) };
}

// The 4-card crib: every seat's throws, plus the deck card in 3-handed.
function assembleCrib(seats, deck, pl) {
  const crib = [];
  for (const s of seats) if (s.discard) for (const c of s.discard) crib.push(c);
  if (pl.deckCard) crib.push(deck[pl.deckIdx]);
  return crib;
}

// Award points. With teams enabled, partners share the running total: the points
// land on every seat of the scoring seat's team, but the history entry is logged
// only to the seat that actually earned them (so each player's history is their own,
// and a team's total is the sum of its members' histories). Cutthroat (the default)
// is just "one team per seat", so only the scorer is touched.
const addScore = (seats, i, pts, label, P, teams) => {
  const t = teamOf(i, P, teams);
  return seats.map((s, j) => {
    if (teamOf(j, P, teams) !== t) return s;
    if (j === i) return { ...s, score: s.score + pts, history: pts > 0 ? [...(s.history || []), { pts, label }] : (s.history || []) };
    return { ...s, score: s.score + pts };
  });
};
const initPeg = (seats, dealerIdx, P) => ({
  hands: seats.map((s) => s.kept.slice()),
  turn: (dealerIdx + 1) % P,
  count: 0, pile: [], pileSuited: [], played: seats.map(() => []),
  passes: 0, lastPlayer: -1,
});
const initShow = (dealerIdx, P) => {
  const order = [];
  for (let k = 1; k < P; k++) order.push((dealerIdx + k) % P); // pone first, around
  order.push(dealerIdx); order.push("CRIB");                   // dealer, then dealer's crib
  return { order, step: 0, scored: false, claimSubmitted: false, claimValue: null };
};

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

const CAT_SHORT = ["15s", "pairs", "runs", "flush", "nobs"];
const showLabel = (kind, acc) => {
  const parts = acc.map((v, i) => (v > 0 ? `${CAT_SHORT[i]} ${v}` : null)).filter(Boolean);
  return parts.length ? `${kind} · ${parts.join(", ")}` : kind;
};

// Rate the human's throws (single or two-card) the way the bots do: kept-hand EV
// plus the thrown card(s)' crib value, signed +1 when the crib is on your team
// (you or a partner deals) and −1 when it feeds the opponents. n = throw count.
function evalDiscards(dealt, dealerIdx, n, P, teams, seat = 0) {
  const sign = teamOf(seat, P, teams) === teamOf(dealerIdx, P, teams) ? 1 : -1;
  const combos = n === 2 ? twoCombos(dealt.length) : dealt.map((_, i) => [i]);
  const opts = combos.map((idxs) => {
    const four = dealt.filter((_, j) => !idxs.includes(j));
    const thrown = idxs.map((i) => dealt[i]);
    const hd = handDetail(four, dealt);
    const cribSwing = n === 2 ? cribSeed(thrown[0], thrown[1]) : CRIB_VALUE[thrown[0].r - 1];
    return { idxs, thrown, four, keptEV: hd.ev, cribSwing, value: hd.ev + sign * cribSwing };
  });
  const best = opts.reduce((a, b) => (b.value > a.value ? b : a));
  return { opts, best, sign };
}

// Seat 0 is always the human at this device; other seats are bots unless the landing
// page's seat diagram marked them human (settings.seats[i] === "human"). A game with
// 2+ human seats becomes hot-seat: the device passes between them with a privacy screen.
// Seat roles come from the landing page (settings.seats: per-seat "human"/"bot"). With no
// config the default is South (seat 0) human, the rest bots; an explicit role always wins,
// so even South can be a bot.
const seatIsHuman = (i, settings) => {
  const s = settings && settings.seats;
  if (s && (s[i] === "human" || s[i] === "bot")) return s[i] === "human";
  return i === 0;
};
function nHumans(P, settings) { let c = 0; for (let i = 0; i < P; i++) if (seatIsHuman(i, settings)) c++; return c; }
// The lone human's seat when exactly one is seated (else -1); and the first human seat (or
// 0 if the table is all bots — a spectated game).
function soleHuman(P, settings) { let found = -1; for (let i = 0; i < P; i++) if (seatIsHuman(i, settings)) { if (found >= 0) return -1; found = i; } return found; }
function firstHuman(P, settings) { for (let i = 0; i < P; i++) if (seatIsHuman(i, settings)) return i; return 0; }
// Muggins is only offered/active in a one-human (solo vs bots) game; a hot-seat table with
// 2+ humans always auto-counts.
const mugginsActive = (settings) => settings.counting === "muggins" && nHumans(clampPlayers(settings.players), settings) === 1;

// Commit the active discarder's throw (idxs into seats[discardSeat].dealt). With several
// human throwers, advance to the next; once they're all in, build the crib and cut.
function commitDiscard(state, idxs) {
  const P = clampPlayers(state.settings.players);
  const pl = plan(P, state.dealerIdx);
  const seat = state.discardSeat;
  const dealt = state.seats[seat].dealt;
  const discard = idxs.map((i) => dealt[i]);
  const kept = sortHand(dealt.filter((_, j) => !idxs.includes(j)));
  const seats = state.seats.map((s, i) => (i === seat ? { ...s, discard, kept } : s));
  let next = null;
  for (let i = seat + 1; i < P; i++) if (pl.throws[i] > 0 && seatIsHuman(i, state.settings) && seats[i].discard == null) { next = i; break; }
  if (next != null) return { ...state, seats, discardSeat: next, pendingDiscard: null };
  return afterCrib({ ...state, seats, crib: assembleCrib(seats, state.deck, pl), pendingDiscard: null, phase: "cut", discardSeat: null });
}

// Once the crib is built, either show the cut phase (manual cut) or — with auto-cut on —
// cut the starter right away, so the cut phase is skipped entirely.
function afterCrib(cutState) {
  return cutState.settings.autoCut ? applyCut(cutState) : cutState;
}

// Turn the starter from the deck and advance to play (or to "over" on a his-heels game
// point). Shared by the manual CUT action and the auto-cut path above.
function applyCut(state) {
  const P = clampPlayers(state.settings.players);
  const teams = clampTeams(P, state.settings.teams);
  const pl = plan(P, state.dealerIdx);
  const starter = state.deck[pl.starterIdx];
  const hisHeels = starter.r === 11;
  let seats = state.seats, winner = null, message = `Cut: ${tag(starter)}.`;
  if (hisHeels) {
    seats = addScore(seats, state.dealerIdx, 2, "his heels", P, teams);
    message = `His heels — ${sv(state.dealerIdx, "peg", "pegs")} 2 for the Jack (${tag(starter)}).`;
    if (seats[state.dealerIdx].score >= targetFor(P)) winner = state.dealerIdx;
  }
  if (winner !== null) return { ...state, starter, hisHeels, seats, winner, phase: "over", message };
  return { ...state, starter, hisHeels, seats, peg: initPeg(seats, state.dealerIdx, P), phase: "play", message };
}

function dealNewHand(state) {
  const P = clampPlayers(state.settings.players);
  const teams = clampTeams(P, state.settings.teams);
  const deck = freshDeck();
  const d = state.dealerIdx;
  const pl = plan(P, d);
  let off = 0;
  const seats = [];
  for (let i = 0; i < P; i++) {
    const dealt = sortHand(deck.slice(off, off + pl.sizes[i])); off += pl.sizes[i];
    seats.push({ score: state.seats[i].score, isAI: !seatIsHuman(i, state.settings), history: state.seats[i].history || [], dealt, kept: null, discard: null });
  }
  // Non-throwers keep their hand; throwing BOTS throw now; throwing HUMANS throw
  // interactively during the discard phase (one at a time, passing the device).
  for (let i = 0; i < P; i++) {
    if (pl.throws[i] === 0) { seats[i].kept = sortHand(seats[i].dealt); seats[i].discard = []; }
    else if (!seatIsHuman(i, state.settings)) { const r = aiDiscardN(seats[i].dealt, i, d, pl.throws[i], P, teams); seats[i].discard = r.discard; seats[i].kept = sortHand(r.kept); }
  }
  const humanThrowers = [];
  for (let i = 0; i < P; i++) if (pl.throws[i] > 0 && seatIsHuman(i, state.settings)) humanThrowers.push(i);
  const base = {
    ...state, seats, deck, starter: null, crib: [], hisHeels: false,
    peg: null, show: null, winner: null, phase: "discard", message: "", pendingDiscard: null, pendingPlay: null,
    holder: firstHuman(P, state.settings), discardSeat: humanThrowers.length ? humanThrowers[0] : null,
  };
  if (humanThrowers.length === 0) {
    // No human throws this hand — the crib is already complete, so skip to the cut. Frame
    // the note from the lone human's seat (if any); with no single human (all-bot spectate
    // or 2+ humans) keep it neutral rather than addressing a "you" who isn't there.
    const you = soleHuman(P, state.settings);
    const msg = you < 0 ? `${seatName(d)} deals — on to the cut.`
      : you === d ? "Your deal — no throw. The crib is yours."
      : "No throw for you this hand — on to the cut.";
    return afterCrib({ ...base, crib: assembleCrib(seats, deck, pl), phase: "cut", message: msg, discardSeat: null });
  }
  return base;
}

// Commit one pegging card for `seat`: score it, handle 31/last-card/go-to-show,
// win-check after every award, advance the turn.
function playCard(state, seat, card) {
  const P = clampPlayers(state.settings.players);
  const teams = clampTeams(P, state.settings.teams);
  const peg = state.peg;
  const hands = peg.hands.map((h, i) => (i === seat ? h.filter((c) => !sameCard(c, card)) : h));
  const count = peg.count + pval(card.r);
  const pile = peg.pile.concat(card.r);
  const pileSuited = peg.pileSuited.concat(card);
  const played = peg.played.map((p, i) => (i === seat ? p.concat(card) : p));
  const pts = pegScore(pile, count);
  let seats = addScore(state.seats, seat, pts, `pegging · ${pegReason(pile, count)}`, P, teams);
  let message = pts > 0 ? `${seatName(seat)}: ${scoreCallout(pile, count, pts)}.` : `${sv(seat, "play", "plays")} ${tag(card)} (count ${count}).`;
  const np = { ...peg, hands, count, pile, pileSuited, played, lastPlayer: seat, passes: 0 };
  if (count === 31) { np.count = 0; np.pile = []; np.pileSuited = []; np.lastPlayer = -1; }
  if (seats[seat].score >= targetFor(P)) return { ...state, seats, peg: np, phase: "over", winner: seat, message };

  const remaining = hands.reduce((a, h) => a + h.length, 0);
  if (remaining === 0) {
    if (np.lastPlayer >= 0) {
      seats = addScore(seats, seat, 1, "pegging · last card", P, teams);
      message += ` ${seatName(seat)} +1 for last card.`;
      if (seats[seat].score >= targetFor(P)) return { ...state, seats, peg: np, phase: "over", winner: seat, message };
    }
    return { ...state, seats, peg: np, phase: "show", show: initShow(state.dealerIdx, P), message };
  }
  np.turn = (seat + 1) % P;
  return { ...state, seats, peg: np, message };
}

function evalPlay(peg, card) {
  const legal = peg.hands[peg.turn].filter((c) => pval(c.r) + peg.count <= 31);
  const scoreOf = (c) => pegScore(peg.pile.concat(c.r), peg.count + pval(c.r));
  let bestCard = card, bestPts = -1;
  for (const c of legal) { const p = scoreOf(c); if (p > bestPts) { bestPts = p; bestCard = c; } }
  const chosenPts = scoreOf(card);
  return { chosenPts, bestCard, bestPts, delta: bestPts - chosenPts };
}

function reduce(state, action) {
  const P = clampPlayers(state.settings.players);
  const teams = clampTeams(P, state.settings.teams);
  switch (action.type) {
    case "DEAL":
      return dealNewHand(state);

    case "SET_SETTING": {
      const settings = { ...state.settings, [action.key]: action.value };
      // Changing the table size resets teams to the cutthroat default (one per player)
      // and restarts the game. The teams setting itself is display-only for now.
      if (action.key === "players") settings.teams = action.value;
      saveSettings(settings);
      if (action.key === "players") return newGameState({ settings });
      return { ...state, settings };
    }

    case "DISCARD": // commit straight away (programmatic / tests); action.idxs = [..]
      return commitDiscard(state, action.idxs);

    case "SELECT_DISCARD": {
      const seat = state.discardSeat;
      const n = plan(P, state.dealerIdx).throws[seat];
      if (!state.settings.warn) return commitDiscard(state, action.idxs);
      const { opts, best } = evalDiscards(state.seats[seat].dealt, state.dealerIdx, n, P, teams, seat);
      const chosen = opts.find((o) => sameSet(o.idxs, action.idxs));
      const delta = best.value - chosen.value;
      if (delta <= 0.1) return commitDiscard(state, action.idxs);
      return { ...state, pendingDiscard: { idxs: action.idxs, chosen, best, delta } };
    }

    case "CONFIRM_DISCARD":
      return commitDiscard(state, state.pendingDiscard.idxs);

    case "CANCEL_DISCARD":
      return { ...state, pendingDiscard: null };

    case "CUT":
      return applyCut(state);

    case "PLAY_CARD":
      return playCard(state, action.seat, action.card);

    case "SELECT_PLAY": {
      const seat = state.peg.turn;
      if (!state.settings.warn) return playCard(state, seat, action.card);
      const e = evalPlay(state.peg, action.card);
      if (e.delta >= 1) return { ...state, pendingPlay: { card: action.card, ...e } };
      return playCard(state, seat, action.card);
    }

    case "TAKE_DEVICE":
      return { ...state, holder: state.phase === "discard" ? state.discardSeat : (state.peg ? state.peg.turn : state.holder) };

    case "CONFIRM_PLAY":
      return playCard({ ...state, pendingPlay: null }, state.peg.turn, state.pendingPlay.card);

    case "CANCEL_PLAY":
      return { ...state, pendingPlay: null };

    case "PASS_GO": {
      const peg = state.peg, seat = action.seat;
      const passes = peg.passes + 1;
      if (passes >= P) {
        let seats = state.seats, message = `${sv(seat, "say", "says")} "go".`;
        const np = { ...peg, passes: 0, turn: (seat + 1) % P };
        if (peg.lastPlayer >= 0 && peg.count !== 31) {
          seats = addScore(seats, peg.lastPlayer, 1, "pegging · go", P, teams);
          message = `${seatName(peg.lastPlayer)} +1 for the go.`;
          if (seats[peg.lastPlayer].score >= targetFor(P)) return { ...state, seats, peg: np, phase: "over", winner: peg.lastPlayer, message };
        }
        np.count = 0; np.pile = []; np.pileSuited = []; np.lastPlayer = -1;
        return { ...state, seats, peg: np, message };
      }
      return { ...state, peg: { ...peg, passes, turn: (seat + 1) % P }, message: `${sv(seat, "say", "says")} "go".` };
    }

    case "SHOW_CLAIM":
      return { ...state, show: { ...state.show, claimSubmitted: true, claimValue: action.value } };

    case "SHOW_SCORE": {
      if (state.show.scored) return state;
      const info = computeShow(state);
      let seats = state.seats, message = "", winner = null;
      // Muggins applies only in a solo (one-human) game — in hot-seat it's auto-count.
      const humanClaim = mugginsActive(state.settings) && seatIsHuman(info.owner, state.settings);
      if (humanClaim) {
        const claim = state.show.claimValue || 0;
        const awarded = Math.min(claim, info.total);
        seats = addScore(seats, info.owner, awarded, info.isCrib ? "crib (claimed)" : "hand (claimed)", P, teams);
        if (seats[info.owner].score >= targetFor(P)) winner = info.owner;
        const missed = info.total - awarded;
        if (missed > 0 && winner === null) {
          // Missed points go to the next player in counting order who is NOT a partner.
          const rest = state.show.order.slice(state.show.step + 1).map((e) => (e === "CRIB" ? state.dealerIdx : e));
          let recip = rest.find((o) => teamOf(o, P, teams) !== teamOf(info.owner, P, teams));
          if (recip === undefined) recip = rest.find((o) => o !== info.owner);
          if (recip === undefined) recip = (state.dealerIdx + 1) % P;
          seats = addScore(seats, recip, missed, "muggins", P, teams);
          message = `Muggins! ${seatName(recip)} claims the ${missed} you missed (had ${info.total}).`;
          if (seats[recip].score >= targetFor(P)) winner = recip;
        } else {
          message = `You count ${awarded}${claim > info.total ? " — over-claim corrected down" : ""}.`;
        }
      } else {
        seats = addScore(seats, info.owner, info.total, showLabel(info.isCrib ? "crib" : "hand", info.acc), P, teams);
        message = `${entLabel(info)} scores ${info.total}.`;
        if (seats[info.owner].score >= targetFor(P)) winner = info.owner;
      }
      if (winner !== null) return { ...state, seats, phase: "over", winner, message };
      return { ...state, seats, show: { ...state.show, scored: true }, message };
    }

    case "SHOW_NEXT": {
      const nextStep = state.show.step + 1;
      if (nextStep >= state.show.order.length)
        return { ...state, phase: "deal", dealerIdx: (state.dealerIdx + 1) % P, show: null, peg: null, message: "Hand complete — deal the next." };
      return { ...state, show: { ...state.show, step: nextStep, scored: false, claimSubmitted: false, claimValue: null } };
    }

    case "PLAY_AGAIN":
      return newGameState(state);

    default:
      return state;
  }
}

const DEFAULT_SETTINGS = { players: 4, teams: 4, counting: "auto", tapToSelect: true, autoCut: true, autoGo: false, warn: true, autoDeal: false, autoContinue: false, autoPlayOne: false, autoPlayBest: false, autoDiscardBest: false };
// Settings persist across pages in localStorage under a shared key. try/catch keeps
// the verification harness (no localStorage) and private-mode browsers happy.
const SETTINGS_KEY = "cribbage:settings";
function loadSettings() {
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }

// ---- Finished-game history (per device) ----
const HISTORY_KEY = "cribbage:history";
function loadHistory() { try { const r = localStorage.getItem(HISTORY_KEY); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) {} }
function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch (e) {} }

// Summarize a finished game from your (team's) side: the outcome bucket plus the team's
// pegging / hand / crib point totals. A team's points are the sum of its members' own
// logged history entries (partners share the score but only the earner logs the entry),
// so iterating the team's seats captures every point exactly once.
function gameRecord(state) {
  const P = clampPlayers(state.settings.players);
  const teams = clampTeams(P, state.settings.teams);
  const you = soleHuman(P, state.settings) >= 0 ? soleHuman(P, state.settings) : 0;
  const mine = teamsList(P, teams).find((m) => m.includes(you)) || [you];
  let peg = 0, hand = 0, crib = 0;
  for (const seat of mine) for (const h of (state.seats[seat].history || [])) {
    const L = h.label || "";
    if (L.startsWith("pegging") || L === "his heels") peg += h.pts;
    else if (L.startsWith("hand")) hand += h.pts;
    else if (L.startsWith("crib")) crib += h.pts;
    else if (L === "muggins") hand += h.pts;        // claimed an opponent's missed count
  }
  const score = state.seats[mine[0]].score;
  const won = teamOf(state.winner, P, teams) === teamOf(you, P, teams);
  const { skunk, dbl } = skunkLines(P);
  const outcome = won ? "won" : score <= dbl ? "doubleSkunked" : score <= skunk ? "skunked" : "lost";
  return { t: Date.now(), P, teams, outcome, peg, hand, crib, score };
}

// Cut for deal: each seat draws one card; lowest rank deals. Re-draw on a tie.
function drawForDealer(P) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const draw = freshDeck().slice(0, P);
    const ranks = draw.map((c) => c.r);
    const lo = Math.min(...ranks);
    if (ranks.filter((r) => r === lo).length === 1) return { dealerIdx: ranks.indexOf(lo), draw };
  }
  return { dealerIdx: 0, draw: null };
}

function newGameState(prev) {
  const base = prev ? prev.settings : loadSettings();
  const P = clampPlayers(base.players);
  const settings = { ...base, players: P, teams: clampTeams(P, base.teams) };
  setSeatNames(P, soleHuman(P, settings));
  const { dealerIdx, draw } = drawForDealer(P);
  return {
    seats: Array.from({ length: P }, (_, i) => ({ score: 0, isAI: !seatIsHuman(i, settings), dealt: [], kept: null, discard: null, history: [] })),
    dealerIdx, dealDraw: draw,
    deck: [], starter: null, crib: [], hisHeels: false, pendingDiscard: null, pendingPlay: null,
    peg: null, show: null, winner: null, phase: "cutdeal", message: "",
    holder: firstHuman(P, settings), discardSeat: null, settings,
  };
}
function initGame() { return newGameState(null); }
/* ============================ UI BITS ============================ */
// One column per team (a team's members share a score and a peg track). Cutthroat
// is just "one team per seat", so it renders exactly as before.
function ScoreRow({ seats, dealerIdx, turn, winner, onPick, P, teams }) {
  const groups = teamsList(P, teams);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${groups.length},1fr)`, gap: 6, margin: "0 0 6px" }}>
      {groups.map((members, gi) => {
        const score = seats[members[0]].score;       // shared across the team
        const isTurn = members.includes(turn);
        const isWin = winner !== null && members.includes(winner);
        return (
          <button key={gi} onClick={() => onPick(members[0])} title="tap for scoring history" style={{
            padding: "8px 5px 9px", borderRadius: 9, textAlign: "center", cursor: "pointer", font: "inherit", color: "inherit", minWidth: 0, overflow: "hidden",
            background: isWin ? "rgba(95,164,124,0.28)" : isTurn ? "rgba(91,149,194,0.22)" : "rgba(0,0,0,0.22)",
            border: `1px solid ${isWin ? T.good : isTurn ? T.selBlue : T.line}`,
          }}>
            {/* the dealer is still an individual: mark whichever member deals/has the crib */}
            <div style={{ fontFamily: mono, fontSize: members.length > 1 ? 9.5 : 10.5, color: T.muted, display: "flex", justifyContent: "center", gap: 3, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
              {members.map((m, k) => (
                <React.Fragment key={m}>
                  {k > 0 && <span>&amp;</span>}
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    {seatShort(m)}{m === dealerIdx && <span style={{ color: T.pegIvory, fontWeight: 700 }} title="dealer — gets the crib this hand">⬤D</span>}
                  </span>
                </React.Fragment>
              ))}
            </div>
            <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 22, color: isWin ? T.good : T.ivory }}>{score}</div>
            <div style={{ marginTop: 6, padding: "0 2px" }}><PegTrack pct={(score / targetFor(P)) * 100} /></div>
          </button>
        );
      })}
    </div>
  );
}

function HistoryPanel({ seatIdx, seats, onClose, P, teams }) {
  const members = teamsList(P, teams).find((m) => m.includes(seatIdx)) || [seatIdx];
  const isTeam = members.length > 1;
  // Merge the team's per-player histories (each entry tagged with who earned it when
  // there's more than one member). The running total ends at the shared team score.
  const hist = [];
  members.forEach((m) => (seats[m].history || []).forEach((h) => hist.push({ ...h, who: m })));
  const total = seats[members[0]].score;
  let run = 0;
  const cols = "1fr 34px 42px";
  return (
    <div style={{ background: "rgba(0,0,0,0.32)", border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 16px 12px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{teamLabel(members)} — scoring this game</span>
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
              <span style={{ color: T.cream }}>{isTeam ? `${seatName(h.who)}: ` : ""}{h.label}</span>
              <span style={{ textAlign: "right", color: T.good }}>+{h.pts}</span>
              <span style={{ textAlign: "right", color: T.muted }}>{run}</span>
            </div>
          ); })}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${T.line}`, marginTop: 8, paddingTop: 8, fontFamily: mono, fontSize: 12 }}>
        <span style={{ color: T.muted }}>total</span>
        <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 18, color: T.ivory }}>{total}</span>
      </div>
    </div>
  );
}

function Panel({ children, tone }) {
  const bg = tone === "good" ? "rgba(95,164,124,0.16)" : tone === "red" ? "rgba(200,65,43,0.14)" : "rgba(0,0,0,0.22)";
  const bd = tone === "good" ? "rgba(95,164,124,0.5)" : tone === "red" ? "rgba(200,65,43,0.45)" : T.line;
  return <div style={{ padding: "11px 14px", borderRadius: 10, background: bg, border: `1px solid ${bd}` }}>{children}</div>;
}

// The "pass the device" privacy block for hot-seat games with 2+ humans. It replaces the
// active human's hand area (the rest of the table stays visible) so the previous player's
// hand is withheld until the named player taps to take over.
function PassPanel({ to, dispatch }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 16px", borderRadius: 12, background: "rgba(0,0,0,0.3)", border: `1px solid ${T.line}` }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>🤝</div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Pass the device to {seatName(to)}</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 14, lineHeight: 1.5 }}>{seatName(to)}’s hand stays hidden until they’re holding it.</div>
      <ConfirmButton label={`I’m ${seatName(to)} — show my hand`} enabled onClick={() => dispatch({ type: "TAKE_DEVICE" })} />
    </div>
  );
}

function SkunkPanel({ seats, winner, P, teams }) {
  const groups = teamsList(P, teams);
  const { skunk: skLine, dbl: dblLine } = skunkLines(P);
  const losers = groups.map((m) => ({ m, score: seats[m[0]].score })).filter((x) => !x.m.includes(winner));
  const dbl = losers.filter((x) => x.score <= dblLine);
  const sk = losers.filter((x) => x.score > dblLine && x.score <= skLine);
  if (!dbl.length && !sk.length) return null;
  const youSkunked = losers.some((x) => x.m.includes(0) && x.score <= skLine);
  const fmt = (arr) => arr.map((x) => `${teamLabel(x.m)} (${x.score})`).join(", ");
  return (
    <Panel tone={youSkunked ? "red" : "good"}>
      {dbl.length > 0 && <div style={{ fontWeight: 700, fontSize: 15 }}>Double skunk 🦨🦨 — {fmt(dbl)}</div>}
      {sk.length > 0 && <div style={{ fontWeight: 700, fontSize: 15, marginTop: dbl.length ? 4 : 0 }}>Skunk 🦨 — {fmt(sk)}</div>}
    </Panel>
  );
}

// The confirm bar for tap-to-select mode: greyed out until a valid selection exists,
// then commits the chosen play or crib throw.
function ConfirmButton({ label, enabled, onClick }) {
  return (
    <button onClick={enabled ? onClick : undefined} disabled={!enabled} style={{
      width: "100%", padding: "12px", borderRadius: 10, border: "none",
      cursor: enabled ? "pointer" : "default",
      background: enabled ? `linear-gradient(180deg, ${T.good}, ${T.goodDeep})` : "rgba(0,0,0,0.25)",
      color: enabled ? T.ivory : T.muted, opacity: enabled ? 1 : 0.6,
      fontSize: 15, fontWeight: 700, letterSpacing: 0.3,
      boxShadow: enabled ? "0 4px 12px rgba(0,0,0,0.35)" : "none",
    }}>{label}</button>
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

function dealBlurb(P) {
  if (P === 2) return "You're each dealt 6 and throw two to the crib. First to 121 wins.";
  if (P === 3) return "Each player is dealt 5 and throws one; the dealer adds a card off the deck to fill the crib to four. First to 121 wins.";
  if (P === 4) return "Each player is dealt 5 and throws one to the crib. First to 121 wins.";
  if (P === 5) return "Everyone is dealt 5 and throws one — except the dealer, dealt 4 and keeping them all. Short game: first to 61 wins.";
  return "Everyone is dealt 5 and throws one — except the dealer and the player to their right, dealt 4 and keeping them all. Short game: first to 61 wins.";
}

/* ============================ APP ============================ */
export default function CribbagePlay() {
  const [state, dispatch] = useReducer(reduce, undefined, initGame);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [historySeat, setHistorySeat] = React.useState(null);
  const [paused, setPaused] = React.useState(false);
  const [confirmHome, setConfirmHome] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const { phase, seats, dealerIdx, peg, show, starter, winner, message, settings } = state;
  const players = clampPlayers(settings.players);
  const teams = clampTeams(players, settings.teams);
  const multiHuman = nHumans(players, settings) > 1;            // 2+ humans → hot-seat hand-off
  setSeatNames(players, soleHuman(players, settings));
  const ds = state.discardSeat != null ? state.discardSeat : 0; // active discarder
  const playMe = state.holder == null ? firstHuman(players, settings) : state.holder; // device-holder perspective in play
  const needHandoff = multiHuman && (
    phase === "discard" ? (state.discardSeat != null && state.holder !== state.discardSeat)
    : (phase === "play" && peg) ? (seatIsHuman(peg.turn, settings) && state.holder !== peg.turn && peg.hands[peg.turn].length > 0)
    : false);
  // Header descriptor: "<P>-handed[, <teams>][, <N> bot(s)]" — teams shown only when
  // partnered, and with a count ("2 teams") only at sizes that allow more than one team
  // split (i.e. 6-handed); where there's a single option (4-handed) just "teams".
  const nB = players - nHumans(players, settings);
  const teamCounted = teamOptions(players).filter((t) => t < players).length > 1;
  const teamStr = teams < players ? `, ${teamCounted ? `${teams} teams` : "teams"}` : "";
  const botStr = nB > 0 ? `, ${nB} bot${nB === 1 ? "" : "s"}` : "";
  const headLine = `${players}-handed${teamStr}${botStr}`;

  // Record each finished game once (when the board reaches "over" with a winner).
  const recordedRef = React.useRef(false);
  useEffect(() => {
    if (phase === "over" && winner !== null) {
      if (!recordedRef.current) { recordedRef.current = true; saveHistory([...loadHistory(), gameRecord(state)]); }
    } else { recordedRef.current = false; }
  }, [phase, winner]);

  const goHome = () => { if (phase === "cutdeal") window.location.href = "index.html"; else setConfirmHome(true); };
  const canPause = settings.autoCut || settings.autoGo || settings.autoDeal || settings.autoContinue || settings.autoPlayOne || settings.autoPlayBest || settings.autoDiscardBest;
  const autoPaused = paused || settingsOpen || historySeat !== null;
  useEffect(() => { if (!canPause && paused) setPaused(false); }, [canPause, paused]);

  // Self-clocking play loop: bots move and forced "go"s fire on a timer; a human with
  // a legal card blocks for a tap. Re-runs whenever the peg state changes.
  useEffect(() => {
    if (phase !== "play" || !peg || autoPaused) return;
    const seat = peg.turn;
    const hand = peg.hands[seat];
    const legal = hand.filter((c) => pval(c.r) + peg.count <= 31);
    if (seatIsHuman(seat, settings)) {
      if (needHandoff) return;               // wait for the device to be handed to this player
      const out = hand.length === 0;
      if (out || (legal.length === 0 && settings.autoGo)) {
        const t = setTimeout(() => dispatch({ type: "PASS_GO", seat }), 450);
        return () => clearTimeout(t);
      }
      if (settings.autoPlayBest && legal.length >= 1 && !state.pendingPlay) {
        const rank = pegChoose(legal.map((c) => c.r), peg.count, peg.pile, hand.map((c) => c.r));
        const card = legal.find((c) => c.r === rank) || legal[0];
        const t = setTimeout(() => dispatch({ type: "PLAY_CARD", seat, card }), 450);
        return () => clearTimeout(t);
      }
      if (legal.length === 1 && settings.autoPlayOne && !state.pendingPlay) {
        const t = setTimeout(() => dispatch({ type: "PLAY_CARD", seat, card: legal[0] }), 450);
        return () => clearTimeout(t);
      }
      return; // wait for the human
    }
    const t = setTimeout(() => {
      if (legal.length === 0) { dispatch({ type: "PASS_GO", seat }); return; }
      const rank = pegChoose(legal.map((c) => c.r), peg.count, peg.pile, hand.map((c) => c.r));
      const chosen = legal.find((c) => c.r === rank) || legal[0];
      dispatch({ type: "PLAY_CARD", seat, card: chosen });
    }, 760);
    return () => clearTimeout(t);
  }, [phase, peg, settings, state.pendingPlay, autoPaused, needHandoff]);

  useEffect(() => {
    if (autoPaused || !settings.autoDeal) return;
    if (phase === "cutdeal") { const t = setTimeout(() => dispatch({ type: "DEAL" }), 1600); return () => clearTimeout(t); }
    if (phase === "deal") { const t = setTimeout(() => dispatch({ type: "DEAL" }), 650); return () => clearTimeout(t); }
  }, [phase, settings.autoDeal, autoPaused]);
  // Auto-discard the best throw for the active human discarder, when enabled (and once
  // they've taken the device in a hot-seat game).
  useEffect(() => {
    if (phase !== "discard" || autoPaused || !settings.autoDiscardBest || state.pendingDiscard || needHandoff) return;
    const n = plan(players, dealerIdx).throws[ds];
    const best = evalDiscards(state.seats[ds].dealt, dealerIdx, n, players, teams, ds).best;
    const t = setTimeout(() => dispatch({ type: "DISCARD", idxs: best.idxs }), 550);
    return () => clearTimeout(t);
  }, [phase, settings.autoDiscardBest, autoPaused, ds, needHandoff]);
  useEffect(() => {
    if (phase !== "cut" || autoPaused) return;
    // Auto-cut is on, or the cutter is a bot that can't tap — either way, cut on a timer.
    // (A human cutter in manual mode taps the button instead.)
    const cutter = (dealerIdx + players - 1) % players;
    if (!settings.autoCut && seatIsHuman(cutter, settings)) return;
    const t = setTimeout(() => dispatch({ type: "CUT" }), 650);
    return () => clearTimeout(t);
  }, [phase, autoPaused, settings.autoCut, dealerIdx, players, settings]);
  useEffect(() => {
    if (phase !== "show" || !show || show.scored) return;
    const info = computeShow(state);
    const needClaim = mugginsActive(settings) && seatIsHuman(info.owner, settings) && !show.claimSubmitted;
    if (needClaim) return;
    dispatch({ type: "SHOW_SCORE" });
  }, [phase, show, settings.counting]);
  useEffect(() => {
    if (phase !== "show" || !show || !settings.autoContinue || autoPaused || !show.scored) return;
    const t = setTimeout(() => dispatch({ type: "SHOW_NEXT" }), 1200);
    return () => clearTimeout(t);
  }, [phase, show, settings.autoContinue, autoPaused]);

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
        .dealwrap > *:nth-child(6){animation-delay:250ms}
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
            <span style={{ fontFamily: mono, fontSize: 12, color: "rgba(42,27,14,0.8)", lineHeight: 1.3 }}>{headLine}<br />play to {targetFor(players)}</span>
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

      <main style={{
        maxWidth: 560, margin: "0 auto", padding: "16px 16px 0",
        // One card width drives the whole table: six across the column (minus the 16px
        // gutters and five 6px gaps), capped so cards never get bigger than the old 68px.
        "--cw": "min(68px, calc((min(100vw, 560px) - 62px) / 6))",
        "--ch": "calc(var(--cw) * 1.41176)",
      }}>
        {settingsOpen && <SettingsPanel settings={settings} dispatch={dispatch} onClose={() => setSettingsOpen(false)} onAbout={() => { setSettingsOpen(false); setAboutOpen(true); }} onHistory={() => { setSettingsOpen(false); setHistoryOpen(true); }} />}
        <ScoreRow seats={seats} dealerIdx={dealerIdx} turn={turnNow} winner={phase === "over" ? winner : null}
          onPick={(i) => setHistorySeat((cur) => (cur === i ? null : i))} P={players} teams={teams} />
        {historySeat !== null && <HistoryPanel seatIdx={historySeat} seats={seats} onClose={() => setHistorySeat(null)} P={players} teams={teams} />}

        {paused && (
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.pegRed, textAlign: "center", marginTop: 8 }}>
            ⏸ Paused — automatic play is stopped. Tap ▶ to resume.
          </div>
        )}

        {/* Always rendered (even when empty) so the table below never jumps between phases
            that carry a message and those that don't. */}
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, margin: "10px 2px 4px", minHeight: 16, lineHeight: 1.45 }}>
          {message}
        </div>


        {(phase === "cutdeal" || phase === "deal" || phase === "discard" || phase === "cut" || (phase === "show" && show) || (phase === "play" && peg) || phase === "over") && (
          <PlayScreen state={state} dispatch={dispatch} me={phase === "discard" ? ds : playMe} needHandoff={needHandoff} />
        )}
      </main>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}

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
// A fanned row of cards: each later item sits partly on top of the previous one.
// Face-down backs stack tighter (they carry no info) than face-up cards. Every card is
// `--cw` wide, so the overlap is expressed as a fraction of that variable, not pixels.
const STACK_VISIBLE = 0.3;
const BACK_VISIBLE = 0.3;
const cardItems = (cards, vis = STACK_VISIBLE) => (cards || []).map((c) => ({ key: cardId(c), vis, el: <Card card={c} /> }));
const backItems = (n) => Array.from({ length: n || 0 }).map((_, k) => ({ key: "b" + k, vis: BACK_VISIBLE, el: <CardBack /> }));
function Fan({ items }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      {items.map((it, i) => (
        <div key={it.key} style={{ width: "var(--cw)", position: "relative", zIndex: i, marginLeft: i === 0 ? 0 : `calc(var(--cw) * ${-(1 - it.vis)})` }}>
          {it.el}
        </div>
      ))}
    </div>
  );
}
function PlayedStack({ cards, backs, vis }) {
  return <Fan items={(cards && cards.length) ? cardItems(cards, vis) : backItems(backs)} />;
}
// Overlap fraction that keeps an n-card fan within ~`budget` px (tightening as it grows),
// capped at the normal spacing. Used for the central play pile, which can run long before
// a 31/go reset and otherwise overflows a narrow phone. Sized against the widest a card
// gets (68px) so it always fits, whatever the responsive `--cw` works out to.
function fitVisible(n, budget) {
  if (n <= 1) return STACK_VISIBLE;
  return Math.max(0.24, Math.min(STACK_VISIBLE, (budget - 68) / ((n - 1) * 68)));
}

// One seat, used everywhere — the ring, the cut-for-deal, and your own bottom seat. A
// fixed-height label row (so the active chip's padding never nudges the cards) sits above
// a fixed --ch card slot holding a fan of whatever the seat is showing.
function Seat({ i, dealerIdx, active, dim, items }) {
  return (
    <div style={{ textAlign: "center", minWidth: 0, opacity: dim ? 0.7 : 1 }}>
      <div style={{ height: 18, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
        <SeatLabel i={i} dealerIdx={dealerIdx} active={active} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", height: "var(--ch)" }}>
        <Fan items={items} />
      </div>
    </div>
  );
}

// One seat's label. The active seat (current pegger / hand being counted / dealer at the
// cut-for-deal) gets a filled chip so it clearly stands out from the dimmed inactive seats.
function SeatLabel({ i, dealerIdx, active }) {
  const text = `${seatShort(i)}${dealerIdx === i ? " (D)" : ""}`;
  return (
    <span style={active
      ? { fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: T.ivory, background: T.selBlue, padding: "2px 8px", borderRadius: 999, boxShadow: "0 1px 4px rgba(0,0,0,0.45)" }
      : { fontFamily: mono, fontSize: 10, color: T.muted }}>{text}</span>
  );
}

// Opponent layout for a table of P: up to three seats across the top, the West (1)
// and East (P-1) seats flanking. Heads-up shows the single opponent on top.
function tableSeats(P) {
  if (P === 2) return { top: [1], left: null, right: null };
  const top = []; for (let i = 2; i <= P - 2; i++) top.push(i);
  return { top, left: 1, right: P - 1 };
}
// The table seen from seat `me` (at the bottom): the other seats keep their relative
// places around the ring. For me=0 this is exactly tableSeats; for another (human) seat
// it rotates so that seat sits at the bottom, the rest around it.
function seatsAround(P, me) {
  const ts = tableSeats(P), at = (rel) => (me + rel) % P;
  return { top: ts.top.map(at), left: ts.left != null ? at(ts.left) : null, right: ts.right != null ? at(ts.right) : null };
}

// The deck in the centre of the table: a face-down stack, with the starter laid face up on
// top once it's been cut. Same --cw footprint in every phase (the stacked backs are
// absolutely positioned and don't widen the box), so the table never shifts.
function StarterDeck({ starter }) {
  return (
    <div style={{ position: "relative", width: "var(--cw)", height: "var(--ch)", margin: "0 auto" }}>
      <div style={{ position: "absolute", left: 3, top: -6 }}><CardBack /></div>
      <div style={{ position: "absolute", left: 2, top: -4 }}><CardBack /></div>
      <div style={{ position: "absolute", left: 1, top: -2 }}><CardBack /></div>
      <div style={{ position: "absolute", left: 0, top: 0 }}>{starter ? <Card card={starter} /> : <CardBack />}</div>
    </div>
  );
}

// The single table. Every pre-show phase renders here: the discard, the cut, and the
// pegging all share one frame (seat ring + starter slot) and one "hand zone" at the
// bottom — a card grid with tap-to-select and a confirm. Only a small per-phase config
// (how many cards, what's legal, where the throw goes, the labels) differs.
function PlayScreen({ state, dispatch, me, needHandoff }) {
  const { peg, starter, dealerIdx, crib, seats, settings, phase, dealDraw, winner } = state;
  const discardPhase = phase === "discard";
  const cutPhase = phase === "cut";
  const cutdealPhase = phase === "cutdeal";              // the opening cut-for-deal reveal
  const dealPhase = phase === "deal";                    // the between-hands "ready to deal" rest
  const showPhase = phase === "show";                    // counting the hands + crib, one at a time
  const overPhase = phase === "over";                    // game won — final banner + play again
  const preDeal = cutdealPhase || dealPhase;             // no live hand yet: seats hold no cards
  const P = peg ? peg.hands.length : seats.length;
  const teams = clampTeams(P, settings.teams);
  const pl = plan(P, dealerIdx);
  const ts = seatsAround(P, me);
  // The show counts one owner at a time: their (face-up) hand or the crib, plus the cut.
  const info = showPhase ? computeShow(state) : null;
  const stepLabel = showPhase ? `${state.show.step + 1} of ${state.show.order.length}` : "";
  // What each seat is holding (face down for the others): nothing before a hand is dealt,
  // What each seat is holding (face down for the others): nothing before a hand is dealt,
  // the full dealt hand during the discard, the kept four at the cut, the live peg hand
  // during play — and, through the show, the same finished peg state (everyone's cards
  // played and face up), so nothing in the table view changes from play to show.
  const hands = peg ? peg.hands : seats.map((s) => (preDeal ? [] : discardPhase ? s.dealt : (s.kept || [])));
  const yourHand = hands[me];
  const turn = peg ? peg.turn : -1;
  const tapSelect = settings.tapToSelect;
  const cutter = (dealerIdx + P - 1) % P;
  const multiHuman = nHumans(P, settings) > 1;
  const meHuman = seatIsHuman(me, settings);               // false only in an all-bot (spectated) game

  // ---- shared hand zone: select + confirm the card(s) this phase needs ----
  const [sel, setSel] = React.useState([]);                // working selection (indices into yourHand)
  const legalSet = peg ? new Set(yourHand.filter((c) => pval(c.r) + peg.count <= 31).map(cardId)) : null;
  const count = discardPhase ? pl.throws[me] : 1;          // how many cards to pick
  const myTurn = discardPhase ? !needHandoff : (!!peg && turn === me && legalSet.size > 0);
  const stuck = !!peg && turn === me && legalSet.size === 0 && yourHand.length > 0;
  const pending = discardPhase ? state.pendingDiscard : state.pendingPlay;   // a confirmed-but-warned choice
  const pendIdxs = !pending ? null
    : discardPhase ? pending.idxs
    : [yourHand.findIndex((c) => sameCard(c, pending.card))];
  const isLegal = (c) => discardPhase || legalSet.has(cardId(c));
  // Drop the working selection whenever the actor / phase / turn moves on.
  useEffect(() => { setSel([]); }, [me, phase, turn]);
  // Muggins claim entry (solo only) resets each counting step.
  const [claim, setClaim] = React.useState(0);
  useEffect(() => { setClaim(0); }, [showPhase ? state.show.step : -1]);
  const muggins = showPhase && mugginsActive(settings) && seatIsHuman(info.owner, settings);
  const needClaim = muggins && !state.show.claimSubmitted;

  const commit = (idxs) => dispatch(discardPhase
    ? { type: "SELECT_DISCARD", idxs: idxs.slice().sort((a, b) => a - b) }
    : { type: "SELECT_PLAY", card: yourHand[idxs[0]] });
  const tapCard = (i) => {
    if (pending) { dispatch({ type: discardPhase ? "CANCEL_DISCARD" : "CANCEL_PLAY" }); setSel([]); return; }
    if (!myTurn || !isLegal(yourHand[i])) return;
    if (tapSelect) {                                        // lift a selection; the button confirms it
      setSel((s) => s.includes(i) ? s.filter((x) => x !== i)
        : s.length >= count ? (count === 1 ? [i] : s) : [...s, i]);
      return;
    }
    if (count === 1) { commit([i]); return; }               // immediate-commit mode
    const next = sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i];
    if (next.length === count) { setSel([]); commit(next); } else setSel(next);
  };

  // discard-time framing (from the discarder's seat): whose crib, defend vs be greedy.
  const cribOurs = teamOf(dealerIdx, P, teams) === teamOf(me, P, teams);
  const isDealer = me === dealerIdx;
  const teammateDeals = cribOurs && !isDealer;
  const discardPrompt = `Tap the ${count === 2 ? "two cards" : "card"} you'll throw to the crib.${count === 2 && sel.length === 1 ? " One more…" : ""}`;

  const cell = (i) => {
    if (cutdealPhase) {                                    // cut for deal: each seat's single draw, dealer lit
      const draw = dealDraw ? dealDraw[i] : null;
      return <Seat key={i} i={i} dealerIdx={dealerIdx} active={i === dealerIdx} dim={i !== dealerIdx}
        items={draw ? cardItems([draw]) : backItems(1)} />;
    }
    // Every seat (yours included) shows its played pile face up plus any cards still in hand
    // face down. The one exception: your own remaining hand lives in the interactive grid
    // below, not face down at your seat — so suppress those backs while the grid is active
    // (your discard / play turn). The active seat — your discard turn, the current pegger,
    // the hand being counted, or the winning team — is chip-highlighted.
    const gridActive = i === me && meHuman && !needHandoff && (discardPhase || (phase === "play" && peg));
    const remaining = gridActive ? 0 : hands[i].length;
    const played = peg ? peg.played[i] : [];
    const active = overPhase ? teamOf(i, P, teams) === teamOf(winner, P, teams)
      : showPhase ? i === info.owner
      : discardPhase ? (i === me && myTurn)
      : turn === i;
    return <Seat key={i} i={i} dealerIdx={dealerIdx} active={active}
      items={[...backItems(remaining), ...cardItems(played)]} />;
  };
  // The discard/play status line. A bot in the bottom seat (all-bot game) gets the same
  // spectator line as any other seat — it just plays/goes on its own, no human prompts.
  const actionPrompt = discardPhase ? discardPrompt
    : (phase === "play" && peg)
      ? (peg.turn === me && meHuman
          ? (myTurn ? (tapSelect ? "Your turn — tap a card to select, then Play." : "Your turn — tap a card to play.")
            : stuck ? (settings.autoGo ? "No legal card — passing…" : "No legal card — tap Go to pass.")
            : "Your cards are all played.")
          : `${seatName(peg.turn)} to play…`)
      : null;
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Fixed grids: every seat owns an equal column whatever it's holding, so the labels
          (and their hands) always center on the same spot in every phase. */}
      {ts.top.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${ts.top.length}, 1fr)`, gap: 8 }}>
          {ts.top.map(cell)}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "0 6px" }}>
        <div style={{ minWidth: 0 }}>{ts.left != null ? cell(ts.left) : null}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
          {/* no label — empty spacer keeps the deck bottom-aligned with the seat cards */}
          <div style={{ height: 18, marginBottom: 4 }} />
          <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", height: "var(--ch)" }}>
            <StarterDeck starter={(phase === "play" || showPhase || overPhase) ? starter : null} />
          </div>
        </div>
        <div style={{ minWidth: 0 }}>{ts.right != null ? cell(ts.right) : null}</div>
      </div>

      {/* your own seat at the bottom — rendered through the very same cell() as the others,
          so there's no separate "South" path; its slot is just pinned below the grid. */}
      {cell(me)}

      {/* middle zone: the crib (face down) before play, the live pile during it. The
          discard shows the crib-intent banner here instead, the cut-for-deal its own. */}
      {overPhase ? (
        <Panel tone="good">
          <div style={{ fontWeight: 700, fontSize: 18 }}>{winner !== null && teamOf(winner, P, teams) === teamOf(me, P, teams) ? "You win! 🎉" : `${teamLabel(teamsList(P, teams).find((m) => m.includes(winner)) || [winner])} wins.`}</div>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>First to {targetFor(P)}. Final: {teamsList(P, teams).map((m) => `${teamLabel(m)} ${seats[m[0]].score}`).join(" · ")}</div>
        </Panel>
      ) : cutdealPhase ? (
        <Panel tone={isDealer ? "good" : null}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Cut for deal</div>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>
            Lowest card deals — {isDealer ? "you deal" : `${seatName(dealerIdx)} deals`} first this game.
          </div>
        </Panel>
      ) : dealPhase ? (
        <Panel tone={cribOurs ? "good" : null}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{isDealer ? "Your deal — the crib is yours." : teammateDeals ? `${seatName(dealerIdx)} deals — your team's crib.` : `${seatName(dealerIdx)} deals — the crib is theirs.`}</div>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>{dealBlurb(P)}</div>
        </Panel>
      ) : showPhase ? (
        info.isCrib ? (
          // the crib has no seat — reveal it face up here, where the pile/crib normally sits.
          <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px", minHeight: 88, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{entLabel(info)} · counting {stepLabel}</span>
            <Fan items={cardItems(info.cards)} />
          </div>
        ) : (
          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>The show · {entLabel(info)}</div>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: T.muted }}>counting {stepLabel}</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>order: pone first, dealer's crib last.</div>
          </Panel>
        )
      ) : discardPhase ? (
        <Panel tone={cribOurs ? "good" : "red"}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{multiHuman ? `${seatName(me)}: ` : ""}{isDealer ? "Your crib — be greedy" : teammateDeals ? `${seatName(dealerIdx)}'s crib — your team's, be greedy` : `Feeds ${seatName(dealerIdx)}'s crib — defend`}</div>
        </Panel>
      ) : cutPhase ? (
        <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px", minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{me === dealerIdx ? "your crib" : `${seatName(dealerIdx)}'s crib`}</span>
          <Fan items={backItems(crib.length)} />
        </div>
      ) : (
        <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: "var(--ch)" }}>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 12px", borderRadius: 9, background: "rgba(0,0,0,0.3)", border: `1px solid ${T.line}` }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>pile count</span>
              <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 28, lineHeight: 1, color: peg.count === 31 ? T.good : T.ivory }}>{peg.count}</span>
            </div>
            <div style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", display: "flex", justifyContent: "center" }}>
              {peg.pileSuited.length
                ? <PlayedStack cards={peg.pileSuited} backs={0} vis={fitVisible(peg.pileSuited.length, 180)} />
                : <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>cleared — new count from 0</span>}
            </div>
          </div>
        </div>
      )}

      {overPhase ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SkunkPanel seats={seats} winner={winner} P={P} teams={teams} />
          {bigBtn("Play again", () => dispatch({ type: "PLAY_AGAIN" }), "good")}
        </div>
      ) : showPhase ? (
        needClaim ? (
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
              ? <CatBars cats={info.acc} scale={info.total} color={info.isCrib ? (seatIsHuman(info.owner, settings) ? T.good : T.pegRed) : T.good} />
              : <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>“nineteen” hand — no points.</div>}
            {muggins && state.show.claimSubmitted && (
              <div style={{ fontFamily: mono, fontSize: 11.5, color: state.show.claimValue >= info.total ? T.good : T.pegRed, marginTop: 10 }}>
                you claimed {state.show.claimValue}{state.show.claimValue < info.total ? ` · missed ${info.total - state.show.claimValue}` : state.show.claimValue > info.total ? " · over-claim, corrected down" : " · spot on"}
              </div>
            )}
            {bigBtn("Continue", () => dispatch({ type: "SHOW_NEXT" }), "wood")}
          </div>
        )
      ) : preDeal ? (
        settings.autoDeal
          ? <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>Dealing…</div>
          : (<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {dealPhase && (
                <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, lineHeight: 1.7, textAlign: "center" }}>
                  counting <b style={{ color: T.cream }}>{mugginsActive(settings) ? "muggins" : "auto"}</b> ·{" "}
                  go on no card <b style={{ color: T.cream }}>{settings.autoGo ? "auto" : "manual"}</b> ·{" "}
                  weak-play warnings <b style={{ color: T.cream }}>{settings.warn ? "on" : "off"}</b>
                  <span> — tap ⚙ to change</span>
                </div>
              )}
              {bigBtn(isDealer ? "Deal" : `Deal (${seatName(dealerIdx)}'s crib)`, () => dispatch({ type: "DEAL" }), "wood")}
            </div>)
      ) : cutPhase ? (
        // Auto-cut skips this phase entirely; when it's off, a human cutter taps to cut,
        // while a bot cutter just does it (announced here, advanced on a timer).
        seatIsHuman(cutter, settings)
          ? bigBtn(`Cut the deck for ${seatName(dealerIdx)}`, () => dispatch({ type: "CUT" }), "wood")
          : <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>{seatName(cutter)} cuts for the starter…</div>
      ) : needHandoff ? <PassPanel to={discardPhase ? me : peg.turn} dispatch={dispatch} /> : (
      <div>
        {/* Fixed two-line slot so the status text (which can wrap) never nudges the button. */}
        <div style={{ fontFamily: mono, fontSize: 11, color: (myTurn || stuck) ? T.selBlue : T.muted, marginBottom: 6, lineHeight: 1.45, minHeight: "2.9em", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          {actionPrompt}
        </div>
        {pending && (discardPhase
          ? <div style={{ marginBottom: 10 }}><DiscardWarning pd={pending} cribIsOurs={cribOurs} dispatch={dispatch} onCancel={() => setSel([])} /></div>
          : <div style={{ marginBottom: 10 }}><PlayWarning pp={pending} dispatch={dispatch} /></div>)}
        {(() => {
          const goBtn = stuck && !settings.autoGo && meHuman
            ? <button onClick={() => dispatch({ type: "PASS_GO", seat: me })} style={{
                width: "100%", padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                background: `linear-gradient(180deg, ${T.pegRed}, #9c3120)`, color: T.ivory,
                fontSize: 15, fontWeight: 700, letterSpacing: 0.3, boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
              }}>Say "Go"</button>
            : null;
          const confirmBtn = tapSelect && myTurn && !pending && meHuman
            ? <ConfirmButton label={discardPhase ? `Throw to crib${count === 2 ? ` (${sel.length}/2)` : ""}` : "Play"}
                enabled={sel.length === count && sel.every((i) => isLegal(yourHand[i]))}
                onClick={() => { const idxs = sel; setSel([]); commit(idxs); }} />
            : null;
          const action = goBtn || confirmBtn;
          // In tap-to-select mode keep a constant-height slot so the button appearing and
          // vanishing as the turn passes doesn't bounce the hand up/down.
          if (tapSelect) return <div style={{ minHeight: 44, marginBottom: 10 }}>{action}</div>;
          return action && <div style={{ marginBottom: 10 }}>{action}</div>;
        })()}
        {/* The interactive hand is only for a human in this seat; a bot (all-bot spectate)
            keeps its cards face down under its played pile, like every other seat. */}
        {meHuman && (
          <div className={discardPhase ? "dealwrap" : undefined} style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "nowrap" }}>
            {yourHand.map((card, i) => {
              const legal = isLegal(card);
              const chosen = pending ? pendIdxs.includes(i) : sel.includes(i);
              return (
                <Card key={cardId(card)} card={card} selLabel={discardPhase ? undefined : "PLAY"}
                  clickable={pending ? true : (myTurn && legal)}
                  selected={!tapSelect && chosen}
                  raised={tapSelect && chosen}
                  dim={!pending && !legal && turn === me}
                  onClick={() => tapCard(i)} />
              );
            })}
            {!discardPhase && yourHand.length === 0 && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>your cards are all played</span>}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// Warning when the human's throw isn't the best available. thrown is an array (1 or 2).
function DiscardWarning({ pd, cribIsOurs, dispatch, onCancel }) {
  const { chosen, best, delta } = pd;
  const side = cribIsOurs ? "for your side" : "to the opponents";
  const thrownTag = (o) => o.thrown.map(tag).join(" ");
  const Line = ({ label, o, strong }) => (
    <div style={{ fontFamily: mono, fontSize: 11.5, lineHeight: 1.6, color: strong ? T.cream : T.muted }}>
      <b style={{ color: strong ? T.good : T.ivory }}>{label}</b> throw {thrownTag(o)} · keep {o.four.map(tag).join(" ")} · hand {o.keptEV.toFixed(2)} · crib {o.cribSwing.toFixed(2)} {side} → net <b>{o.value.toFixed(2)}</b>
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
        “hand” = your kept cards averaged over every cut; “crib” = the thrown card(s)' average value in the crib
        ({cribIsOurs ? "added to your side's score" : "given to the opponents, so subtracted"}). Net is the two combined.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => dispatch({ type: "CONFIRM_DISCARD" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer",
          background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>Throw {thrownTag(chosen)} anyway</button>
        <button onClick={() => { dispatch({ type: "CANCEL_DISCARD" }); if (onCancel) onCancel(); }} style={{
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

function SettingsPanel({ settings, dispatch, onClose, onAbout, onHistory }) {
  const soloGame = nHumans(clampPlayers(settings.players), settings) === 1;
  const Row = ({ title, desc, k, options, disabled }) => (
    <div style={{ marginBottom: 14, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, margin: "2px 0 7px", lineHeight: 1.45 }}>{desc}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {options.map(([label, val]) => (
          <button key={String(val)} disabled={disabled} onClick={disabled ? undefined : () => dispatch({ type: "SET_SETTING", key: k, value: val })} style={{ ...segStyle(settings[k] === val), cursor: disabled ? "default" : "pointer" }}>{label}</button>
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
      <Row title="Tap to select, then confirm" k="tapToSelect"
        desc="Tapping a card lifts it to select (tap again to drop it); a Play or Throw-to-crib button above your hand commits the choice. Off: a tap plays or throws immediately."
        options={[["Off", false], ["On", true]]} />
      <Row title="Cut for the starter" k="autoCut"
        desc="Auto (default) turns the starter in the background and goes straight to the play; Manual waits for you to tap when you're the one cutting."
        options={[["Manual", false], ["Auto", true]]} />
      <Row title="Go on no playable card" k="autoGo"
        desc={'When you can’t play, Manual waits for you to tap “Go”; Auto passes for you.'}
        options={[["Manual", false], ["Auto", true]]} />
      <Row title="Warn on a weak play" k="warn"
        desc="Pause and explain when your throw to the crib — or a pegging card that leaves a point on the table — isn’t the best, with a chance to take it back."
        options={[["On", true], ["Off", false]]} />
      <Row title="Auto-play a forced card" k="autoPlayOne"
        desc="When only one of your cards is legal to peg, play it for you."
        options={[["Off", false], ["On", true]]} />
      <Row title="Auto-play the best card" k="autoPlayBest"
        desc="On your turn to peg, play the best card automatically — the same policy the bots use. Full autopilot for the play."
        options={[["Off", false], ["On", true]]} />
      <Row title="Auto-discard the best throw" k="autoDiscardBest"
        desc="At the discard, throw the best card(s) for your position automatically — accounting for whether the crib is yours or the dealer's."
        options={[["Off", false], ["On", true]]} />
      <Row title="Auto-continue the show" k="autoContinue"
        desc="Advance the counting automatically (still pauses for your muggins claim)."
        options={[["Off", false], ["On", true]]} />
      <Row title="Auto-deal the next hand" k="autoDeal"
        desc="Deal the next hand automatically once a hand is fully counted."
        options={[["Off", false], ["On", true]]} />
      <Row title="Counting" k="counting" disabled={!soloGame}
        desc={soloGame
          ? "Auto tallies every hand for you. Muggins: you claim your own hand (and crib when you deal) — miss points and the next opponent takes them."
          : "Auto tallies every hand. Muggins is only available in a solo (one-human) game; hot-seat tables auto-count."}
        options={[["Auto-count", "auto"], ["Muggins", "muggins"]]} />
      <div style={{ borderTop: `1px solid ${T.line}`, margin: "2px -16px 0", padding: "12px 16px 0" }}>
        <button onClick={onHistory} style={{ width: "100%", padding: "10px", borderRadius: 9, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 12, fontWeight: 700 }}>Game history</button>
      </div>
      <AboutRow onAbout={onAbout} />
      <button onClick={onClose} style={{
        width: "100%", margin: "12px 0 10px", padding: "12px", borderRadius: 9, border: "none", cursor: "pointer",
        background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory,
        fontFamily: mono, fontSize: 12.5, fontWeight: 700,
      }}>Continue game</button>
    </div>
  );
}

function AboutRow({ onAbout }) {
  return (
    <div style={{ margin: "0 -16px 0", padding: "8px 16px 4px" }}>
      <button onClick={onAbout} style={{
        width: "100%", padding: "10px", borderRadius: 9, cursor: "pointer",
        border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream,
        fontFamily: mono, fontSize: 12, fontWeight: 700,
      }}>About &amp; feedback</button>
    </div>
  );
}

function HistoryModal({ onClose }) {
  const [tick, setTick] = React.useState(0);
  const all = loadHistory();
  const [sel, setSel] = React.useState("all");
  const [confirmClear, setConfirmClear] = React.useState(false);
  const keyOf = (r) => `${r.P}/${r.teams}`;
  const cfgLabel = (P, t) => (t < P ? `${P}p · ${t} teams` : `${P}-handed`);
  const configs = Array.from(new Set(all.map(keyOf))).sort((a, b) => {
    const [pa, ta] = a.split("/").map(Number), [pb, tb] = b.split("/").map(Number);
    return pa - pb || tb - ta;
  });
  const filtered = sel === "all" ? all : all.filter((r) => keyOf(r) === sel);
  const games = filtered.length;
  const cnt = (o) => filtered.filter((r) => r.outcome === o).length;
  const won = cnt("won"), lost = cnt("lost"), sk = cnt("skunked"), dsk = cnt("doubleSkunked");
  const avg = (k) => (games ? filtered.reduce((a, r) => a + (r[k] || 0), 0) / games : 0);
  const winPct = games ? Math.round((won / games) * 100) : 0;
  const specific = sel !== "all";

  const chip = (key, label) => (
    <button key={key} onClick={() => { setSel(key); setConfirmClear(false); }} style={{
      padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontFamily: mono, fontSize: 11, fontWeight: 700,
      border: `1px solid ${sel === key ? T.pegIvory : T.line}`,
      background: sel === key ? T.pegIvory : "rgba(0,0,0,0.25)", color: sel === key ? "#2A1B0E" : T.cream,
    }}>{label}</button>
  );
  const Stat = ({ label, value, accent }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderBottom: `1px solid ${T.line}` }}>
      <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{label}</span>
      <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: accent || T.cream }}>{value}</span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%", maxHeight: "86vh", overflowY: "auto", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "20px", boxShadow: "0 14px 44px rgba(0,0,0,0.55)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>Game history</span>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>Done</button>
        </div>

        {all.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, lineHeight: 1.6 }} data-tick={tick}>No finished games yet. Play a game out to the finish and it'll show up here.</div>
        ) : (
          <React.Fragment>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {chip("all", "All")}
              {configs.map((k) => { const [P, t] = k.split("/").map(Number); return chip(k, cfgLabel(P, t)); })}
            </div>

            <Stat label="Games" value={games} />
            <Stat label="Won" value={`${won} (${winPct}%)`} accent={T.good} />
            <Stat label="Lost" value={lost} />
            <Stat label="Skunked 🦨" value={sk} accent={sk ? T.pegRed : T.cream} />
            <Stat label="Double skunked 🦨🦨" value={dsk} accent={dsk ? T.pegRed : T.cream} />

            {specific ? (
              <React.Fragment>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, margin: "14px 0 4px", letterSpacing: 0.3 }}>YOUR AVERAGE POINTS PER GAME</div>
                <Stat label="Pegging" value={avg("peg").toFixed(1)} />
                <Stat label="Hand (the show)" value={avg("hand").toFixed(1)} />
                <Stat label="Crib" value={avg("crib").toFixed(1)} />
              </React.Fragment>
            ) : (
              <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginTop: 12, lineHeight: 1.5 }}>Pick a specific size/teams above to see your average pegging, hand, and crib points.</div>
            )}

            <button onClick={() => { if (confirmClear) { clearHistory(); setSel("all"); setConfirmClear(false); setTick(tick + 1); } else setConfirmClear(true); }} style={{
              width: "100%", marginTop: 16, padding: "10px", borderRadius: 9, cursor: "pointer",
              border: `1px solid ${confirmClear ? T.pegRed : T.line}`, background: "rgba(0,0,0,0.25)",
              color: confirmClear ? T.pegRed : T.muted, fontFamily: mono, fontSize: 11.5, fontWeight: 700,
            }}>{confirmClear ? "Tap again to erase all history" : "Clear history"}</button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function AboutModal({ onClose }) {
  const REPO = "https://github.com/ghug/cribbage-trainer/";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "20px", boxShadow: "0 14px 44px rgba(0,0,0,0.55)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: "rgba(0,0,0,0.25)", color: T.ivory, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1 }}>♣</span>
            <span style={{ fontWeight: 700, fontSize: 17 }}>About Cribbage Trainer</span>
          </div>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>Done</button>
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, lineHeight: 1.6, marginBottom: 12 }}>
          An open-source cribbage trainer and game.
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, lineHeight: 1.6, marginBottom: 16 }}>
          Found a bug, or have feedback? The source lives on GitHub — feel free to go there to be part of the conversation.
        </div>
        <a href={REPO} target="_blank" rel="noopener noreferrer" style={{
          display: "block", textAlign: "center", padding: "12px", borderRadius: 9, textDecoration: "none", boxSizing: "border-box",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>Source, bugs &amp; feedback ↗</a>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, textAlign: "center", margin: "8px 0 4px", wordBreak: "break-all" }}>github.com/ghug/cribbage-trainer</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textAlign: "center" }}>v__APP_VERSION__</div>
      </div>
    </div>
  );
}

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
