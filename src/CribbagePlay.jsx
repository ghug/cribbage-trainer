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
  cream: "#ECE0C6", muted: "#C9BC9A", line: "rgba(236,224,182,0.16)",
  good: "#5FA47C", goodDeep: "#3F7E5E", selBlue: "#5B95C2",
};
// Render-only i18n: window.t (from i18n.js) with a key fallback. Used in the JSX (never in
// the reducer), so engine/verify_play.js — which exercises the reducer, not the render — is
// unaffected and needs no window shim.
const tr = (k, v) => (typeof window !== "undefined" && window.t) ? window.t(k, v) : k;
const SUIT = ["♠", "♥", "♦", "♣"];
// Scoring-category display names for the show panel's CatBars — reuses the trainer's
// shared category keys (fifteens/pairs/runs/flush/nobs) so all locales cover them.
const CAT_KEYS = ["trainer.cat.fifteens", "trainer.cat.pairs", "trainer.cat.runs", "trainer.cat.flush", "trainer.cat.nobs"];
const catName = (i) => tr(CAT_KEYS[i]);
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
// SEAT_NAMES holds the canonical English identity ("You"/"South"/"Northwest"/…). Identity
// checks use it directly (isYou); display goes through seatName/seatShort, which translate
// the canonical name to the active language via these key maps.
let SEAT_NAMES = seatNamesFor(2, 0);
// Per-seat custom names set on the landing diagram (settings.names, by seat index). They are
// DISPLAY-only — identity (isYou and every "you"-vs-other check) still keys off SEAT_NAMES.
let SEAT_CUSTOM = [];
const setSeatNames = (P, youSeat) => { SEAT_NAMES = seatNamesFor(P, youSeat); };
const setSeatCustom = (arr) => { SEAT_CUSTOM = Array.isArray(arr) ? arr : []; };
const customName = (i) => { const c = SEAT_CUSTOM[i]; return (c != null && c !== "") ? c : null; };
const SEAT_NAME_KEY = { You: "seat.you", South: "seat.south", North: "seat.north", West: "seat.west", East: "seat.east", Northwest: "seat.northwest", Northeast: "seat.northeast", Southwest: "seat.southwest", Southeast: "seat.southeast" };
const seatName = (i) => { const c = customName(i); return c ? (isYou(i) ? tr("seat.you") + " - " + c : c) : tr(SEAT_NAME_KEY[SEAT_NAMES[i]] || SEAT_NAMES[i]); };
const isYou = (i) => SEAT_NAMES[i] === "You";
// Short compass labels for the tight grid spots (score columns, cut-for-deal row, the
// pegging seat cells) so 5-/6-handed tables don't overflow a narrow phone. Prose (the
// message line, banners, history) keeps the full names. Translated like seatName.
const SEAT_SHORT_KEY = { You: "seat.youShort", North: "seat.n", South: "seat.s", West: "seat.w", East: "seat.e", Northwest: "seat.nw", Northeast: "seat.ne", Southwest: "seat.sw", Southeast: "seat.se" };
const seatShort = (i) => { const c = customName(i); return c ? (isYou(i) ? tr("seat.youShort") + " - " + c : c) : tr(SEAT_SHORT_KEY[SEAT_NAMES[i]] || SEAT_NAMES[i]); };
// "you" is whichever seat setSeatNames marked (the lone human), detected via the name —
// not a hard-coded seat 0, which is a bot in an all-bot or human-elsewhere game.
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
        }}>{badge ? badge.text : (selLabel || tr("play.sel.throw"))}</span>
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
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{catName(i)}</span>
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
// The counted entity's label ("Your hand" / "{seat}'s crib"), used in the show panels and
// the reducer's score message. It calls tr(), which falls back to the key under
// verify_play.js (no window) — harmless, since that harness never inspects the message text.
const entText = (info) => {
  const you = isYou(info.owner);
  if (info.isCrib) return you ? tr("play.show.yourCrib") : tr("play.show.seatCrib", { seat: seatName(info.owner) });
  return you ? tr("play.show.yourHand") : tr("play.show.seatHand", { seat: seatName(info.owner) });
};

// Detect the scoring reasons for the just-played card as a token list, so the same
// detection feeds two formatters: pegReason (English — the STORED history label, kept
// stable for gameRecord categorization + verify_play.js) and pegReasonTr (translated —
// the transient status message only). { t } is the token; runs carry their length m.
function pegParts(pile, count) {
  const parts = [];
  if (count === 15) parts.push({ t: "fifteen" });
  if (count === 31) parts.push({ t: "thirtyOne" });
  const n = pile.length, last = pile[n - 1];
  let k = 1; for (let i = n - 2; i >= 0; i--) { if (pile[i] === last) k++; else break; }
  if (k === 2) parts.push({ t: "pair" }); else if (k === 3) parts.push({ t: "pairRoyal" }); else if (k >= 4) parts.push({ t: "doublePairRoyal" });
  for (let m = Math.min(n, 7); m >= 3; m--) {
    const tail = pile.slice(n - m);
    if (new Set(tail).size === m && Math.max(...tail) - Math.min(...tail) === m - 1) { parts.push({ t: "run", m }); break; }
  }
  return parts;
}
const PEG_EN = { fifteen: "fifteen", thirtyOne: "thirty-one", pair: "pair", pairRoyal: "pair royal", doublePairRoyal: "double pair royal" };
const PEG_KEY = { fifteen: "play.peg.fifteen", thirtyOne: "play.peg.thirtyOne", pair: "play.peg.pair", pairRoyal: "play.peg.pairRoyal", doublePairRoyal: "play.peg.doublePairRoyal" };
function pegReason(pile, count) {
  const parts = pegParts(pile, count);
  return parts.length ? parts.map((p) => p.t === "run" ? `run of ${p.m}` : PEG_EN[p.t]).join(" + ") : "points";
}
const pegReasonTr = (pile, count) => {
  const parts = pegParts(pile, count);
  return parts.length ? parts.map((p) => p.t === "run" ? tr("play.peg.run", { m: p.m }) : tr(PEG_KEY[p.t])).join(" + ") : tr("play.peg.points");
};

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

// The throw/play turn order: the pone (the seat to the dealer's left) acts first, then
// clockwise around the table, the dealer last — standard cribbage order, matching pegging.
// Returns just the human-thrower seats in that order (bots throw automatically at the deal,
// so only humans cycle the device through the discard phase).
function throwOrder(P, dealerIdx, settings) {
  const pl = plan(P, dealerIdx);
  const order = [];
  for (let k = 1; k <= P; k++) { const i = (dealerIdx + k) % P; if (pl.throws[i] > 0 && seatIsHuman(i, settings)) order.push(i); }
  return order;
}

// Commit the active discarder's throw (idxs into seats[discardSeat].dealt). With several
// human throwers, advance to the next in turn order; once they're all in, build the crib and cut.
function commitDiscard(state, idxs) {
  const P = clampPlayers(state.settings.players);
  const pl = plan(P, state.dealerIdx);
  const seat = state.discardSeat;
  const dealt = state.seats[seat].dealt;
  const discard = idxs.map((i) => dealt[i]);
  const kept = sortHand(dealt.filter((_, j) => !idxs.includes(j)));
  const seats = state.seats.map((s, i) => (i === seat ? { ...s, discard, kept } : s));
  const order = throwOrder(P, state.dealerIdx, state.settings);
  let next = null;
  for (let k = order.indexOf(seat) + 1; k < order.length; k++) if (seats[order[k]].discard == null) { next = order[k]; break; }
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
  let seats = state.seats, winner = null, message = tr("play.msg.cut", { card: tag(starter) });
  if (hisHeels) {
    seats = addScore(seats, state.dealerIdx, 2, "his heels", P, teams);
    message = isYou(state.dealerIdx)
      ? tr("play.msg.hisHeelsYou", { card: tag(starter) })
      : tr("play.msg.hisHeelsSeat", { seat: seatName(state.dealerIdx), card: tag(starter) });
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
  const humanThrowers = throwOrder(P, d, state.settings);   // pone first, clockwise, dealer last
  const base = {
    ...state, seats, deck, starter: null, crib: [], hisHeels: false,
    peg: null, show: null, winner: null, phase: "discard", message: "", pendingDiscard: null, pendingPlay: null,
    holder: nHumans(P, state.settings) > 1 ? d : firstHuman(P, state.settings), discardSeat: humanThrowers.length ? humanThrowers[0] : null,
  };
  if (humanThrowers.length === 0) {
    // No human throws this hand — the crib is already complete, so skip to the cut. Frame
    // the note from the lone human's seat (if any); with no single human (all-bot spectate
    // or 2+ humans) keep it neutral rather than addressing a "you" who isn't there.
    const you = soleHuman(P, state.settings);
    const msg = you < 0 ? tr("play.msg.dealsCut", { seat: seatName(d) })
      : you === d ? tr("play.msg.yourDealNoThrow")
      : tr("play.msg.noThrowYou");
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
  let message = pts > 0
    ? tr("play.msg.pegScore", { seat: seatName(seat), reason: pegReasonTr(pile, count), pts })
    : (isYou(seat)
        ? tr("play.msg.pegPlayYou", { card: tag(card), count })
        : tr("play.msg.pegPlaySeat", { seat: seatName(seat), card: tag(card), count }));
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

    case "RESET_SETTINGS": {
      // Reset the gameplay preference toggles to defaults; keep the table setup
      // (players/teams/seats, set on the landing) so the current game isn't disturbed.
      const settings = { ...state.settings };
      for (const k in DEFAULT_SETTINGS) if (k !== "players" && k !== "teams" && k !== "seats" && k !== "names") settings[k] = DEFAULT_SETTINGS[k];
      saveSettings(settings);
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
      const goMsg = isYou(seat) ? tr("play.msg.goYou") : tr("play.msg.goSeat", { seat: seatName(seat) });
      if (passes >= P) {
        let seats = state.seats, message = goMsg;
        const np = { ...peg, passes: 0, turn: (seat + 1) % P };
        if (peg.lastPlayer >= 0 && peg.count !== 31) {
          seats = addScore(seats, peg.lastPlayer, 1, "pegging · go", P, teams);
          message = tr("play.msg.goPoint", { seat: seatName(peg.lastPlayer) });
          if (seats[peg.lastPlayer].score >= targetFor(P)) return { ...state, seats, peg: np, phase: "over", winner: peg.lastPlayer, message };
        }
        np.count = 0; np.pile = []; np.pileSuited = []; np.lastPlayer = -1;
        return { ...state, seats, peg: np, message };
      }
      return { ...state, peg: { ...peg, passes, turn: (seat + 1) % P }, message: goMsg };
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
          message = tr("play.msg.muggins", { seat: seatName(recip), missed, total: info.total });
          if (seats[recip].score >= targetFor(P)) winner = recip;
        } else {
          message = claim > info.total ? tr("play.msg.countOver", { n: awarded }) : tr("play.msg.count", { n: awarded });
        }
      } else {
        seats = addScore(seats, info.owner, info.total, showLabel(info.isCrib ? "crib" : "hand", info.acc), P, teams);
        message = tr("play.msg.scores", { ent: entText(info), total: info.total });
        if (seats[info.owner].score >= targetFor(P)) winner = info.owner;
      }
      if (winner !== null) return { ...state, seats, phase: "over", winner, message };
      return { ...state, seats, show: { ...state.show, scored: true }, message };
    }

    case "SHOW_NEXT": {
      const nextStep = state.show.step + 1;
      if (nextStep >= state.show.order.length)
        return { ...state, phase: "deal", dealerIdx: (state.dealerIdx + 1) % P, show: null, peg: null, message: tr("play.msg.handComplete") };
      return { ...state, show: { ...state.show, step: nextStep, scored: false, claimSubmitted: false, claimValue: null } };
    }

    case "PLAY_AGAIN":
      return newGameState(state);

    default:
      return state;
  }
}

const DEFAULT_SETTINGS = { players: 2, teams: 2, names: [], counting: "auto", tapToSelect: true, autoCut: true, autoGo: false, warn: true, autoDeal: false, autoContinue: false, autoPlayOne: false, autoPlayBest: false, autoDiscardBest: false };
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
  setSeatCustom(settings.names);
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
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${groups.length},1fr)`, gap: 6, margin: "0 0 2px" }}>
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
                    {seatShort(m)}{m === dealerIdx && <span style={{ marginLeft: 2 }} title={tr("play.dealerTip")}>🔘</span>}
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
        <span style={{ fontWeight: 700, fontSize: 15 }}>{tr("play.hist.scoringGame", { team: teamLabel(members) })}</span>
        <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>{tr("play.hist.close")}</button>
      </div>
      {hist.length === 0 ? (
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{tr("play.hist.noPoints")}</div>
      ) : (
        <div style={{ display: "grid", gap: 3 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontFamily: mono, fontSize: 10, color: T.muted, paddingBottom: 2 }}>
            <span>{tr("play.hist.colFor")}</span><span style={{ textAlign: "right" }}>{tr("play.hist.colPts")}</span><span style={{ textAlign: "right" }}>{tr("play.hist.total")}</span>
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
        <span style={{ color: T.muted }}>{tr("play.hist.total")}</span>
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
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>{tr("play.pass.to", { seat: seatName(to) })}</div>
      <ConfirmButton label={tr("play.pass.take", { seat: seatName(to) })} enabled onClick={() => dispatch({ type: "TAKE_DEVICE" })} />
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
      {dbl.length > 0 && <div style={{ fontWeight: 700, fontSize: 15 }}>{tr("play.skunk.double", { list: fmt(dbl) })}</div>}
      {sk.length > 0 && <div style={{ fontWeight: 700, fontSize: 15, marginTop: dbl.length ? 4 : 0 }}>{tr("play.skunk.single", { list: fmt(sk) })}</div>}
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
  if (P === 2) return tr("play.deal.blurb2");
  if (P === 3) return tr("play.deal.blurb3");
  if (P === 4) return tr("play.deal.blurb4");
  if (P === 5) return tr("play.deal.blurb5");
  return tr("play.deal.blurb6");
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
  // Live language switch: re-render the whole tree when i18n.choose() loads a new locale (the
  // game/reducer state is untouched — only the text from tr() changes). Render-only; no effect
  // on verify_play.js, which evals the reducer, not the React render.
  const [, bumpLang] = React.useState(0);
  useEffect(() => {
    const i = (typeof window !== "undefined") ? window.i18n : null;
    if (i && i.onChange) i.onChange(() => bumpLang((v) => v + 1));
  }, []);
  const { phase, seats, dealerIdx, peg, show, starter, winner, message, settings } = state;
  const players = clampPlayers(settings.players);
  const teams = clampTeams(players, settings.teams);
  const multiHuman = nHumans(players, settings) > 1;            // 2+ humans → hot-seat hand-off
  setSeatNames(players, soleHuman(players, settings));
  setSeatCustom(settings.names);
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
  const teamStr = teams < players ? (teamCounted ? tr("play.hdr.teamsN", { teams }) : tr("play.hdr.teams")) : "";
  const botStr = nB > 0 ? tr(nB === 1 ? "play.hdr.bot" : "play.hdr.bots", { n: nB }) : "";
  const headLine = tr("play.hdr.handed", { p: players }) + teamStr + botStr;

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
        padding: "8px 18px 9px", boxShadow: "0 6px 18px rgba(0,0,0,0.4)", borderBottom: "2px solid rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button onClick={goHome} aria-label="Home" title="Home" style={{
              flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: T.baize, color: T.ivory, cursor: "pointer",
              border: "none", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1,
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.12), 0 2px 5px rgba(0,0,0,0.35)",
            }}>♣</button>
            <span style={{ fontFamily: mono, fontSize: 12, color: "rgba(42,27,14,0.8)", lineHeight: 1.3 }}>{headLine}<br />{tr("play.hdr.playTo", { target: targetFor(players) })}</span>
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
        maxWidth: 560, margin: "0 auto", padding: "10px 16px 0",
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
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, margin: "5px 2px 3px", minHeight: 16, lineHeight: 1.45 }}>
          {message}
        </div>


        {(phase === "cutdeal" || phase === "deal" || phase === "discard" || phase === "cut" || (phase === "show" && show) || (phase === "play" && peg) || phase === "over") && (
          <PlayScreen state={state} dispatch={dispatch} me={phase === "discard" ? ds : (multiHuman && (phase === "cutdeal" || phase === "deal")) ? dealerIdx : playMe} needHandoff={needHandoff} />
        )}
      </main>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}

      {confirmHome && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setConfirmHome(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360, width: "100%", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "18px", boxShadow: "0 14px 44px rgba(0,0,0,0.55)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{tr("play.home.title")}</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, lineHeight: 1.5, marginBottom: 16 }}>{tr("play.home.body")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmHome(false)} style={{
                flex: 1, padding: "12px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer",
                background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 13, fontWeight: 700,
              }}>{tr("play.home.keep")}</button>
              <a href="index.html" style={{
                flex: 1, padding: "12px", borderRadius: 9, cursor: "pointer", textDecoration: "none", textAlign: "center", boxSizing: "border-box",
                background: `linear-gradient(180deg, ${T.pegRed}, #9c3120)`, color: T.ivory, fontFamily: mono, fontSize: 13, fontWeight: 700,
              }}>{tr("play.home.leave")}</a>
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
// The pegging pile shows only the top of each card face (the rank/suit index lives in the
// top-left corner), so the whole pile reads at a glance while taking far less vertical room.
const PILE_VISIBLE = 0.38;                       // keep the top 38% of each card; clip the bottom 62%
const cardItems = (cards, vis = STACK_VISIBLE) => (cards || []).map((c) => ({ key: cardId(c), vis, el: <Card card={c} /> }));
const backItems = (n) => Array.from({ length: n || 0 }).map((_, k) => ({ key: "b" + k, vis: BACK_VISIBLE, el: <CardBack /> }));
function Fan({ items, clip, hideFrom, clipBottom }) {
  if (!items.length) return null;
  // `clip` (a fraction of the full card height) keeps only part of each card, hiding the rest
  // behind an overflow clip — so a stack can be that much shorter without rescaling cards. By
  // default it keeps the TOP; `clipBottom` keeps the bottom instead (cards tucked up, only their
  // lower edge showing). `hideFrom` keeps items at/after that index in the layout but invisible
  // (placeholders for cards mid-flight), so the fan width — and the other cards — don't shift.
  const clipStyle = clip ? { height: `calc(var(--ch) * ${clip})`, overflow: "hidden", ...(clipBottom ? { display: "flex", alignItems: "flex-end" } : null) } : null;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      {items.map((it, i) => (
        <div key={it.key} style={{ width: "var(--cw)", position: "relative", zIndex: i, marginLeft: i === 0 ? 0 : `calc(var(--cw) * ${-(1 - it.vis)})`, ...clipStyle, ...(hideFrom != null && i >= hideFrom ? { visibility: "hidden" } : null) }}>
          {it.el}
        </div>
      ))}
    </div>
  );
}
// The central play pile. Cards sit at the normal 0.3 spacing whenever they fit, and tighten
// only as much as the *measured* available width requires — so a long run no longer crams
// itself into a fixed guess of the width and leaves the rest of the row empty.
function PileFan({ cards }) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = cards.length;
  // the actual card width (matches the --cw CSS formula)
  const cw = Math.min(68, (Math.min(typeof window !== "undefined" ? window.innerWidth : 560, 560) - 62) / 6);
  // vis fits n cards of width cw into w:  w = cw*(1 + (n-1)*vis)  →  vis = (w/cw - 1)/(n-1)
  const vis = (n <= 1 || w === 0 || cw === 0) ? STACK_VISIBLE
    : Math.max(0.12, Math.min(STACK_VISIBLE, (w / cw - 1) / (n - 1)));
  return (
    <div ref={ref} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <Fan items={cardItems(cards, vis)} clip={PILE_VISIBLE} />
    </div>
  );
}

// One seat, used everywhere — the ring, the cut-for-deal, and your own bottom seat. A
// fixed-height label row (so the active chip's padding never nudges the cards) sits above
// a fixed --ch card slot holding a fan of whatever the seat is showing.
function Seat({ i, dealerIdx, active, dim, items, settings, me }) {
  return (
    <div style={{ textAlign: "center", minWidth: 0, opacity: dim ? 0.7 : 1 }}>
      <div style={{ height: 18, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
        <SeatLabel i={i} dealerIdx={dealerIdx} active={active} settings={settings} me={me} />
      </div>
      <div data-slot={"seat-" + i} style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", height: "var(--ch)" }}>
        <Fan items={items} />
      </div>
    </div>
  );
}

// One seat's label. The active seat (current pegger / hand being counted / dealer at the
// cut-for-deal) gets a filled chip so it clearly stands out from the dimmed inactive seats.
// Only the seat at the bottom (`me`, the current player at the device) reads "You - {name}"
// when it's a named human; every other seat keeps its plain compass short-name.
function SeatLabel({ i, dealerIdx, active, settings, me }) {
  const named = customName(i);
  const base = (i === me && named && seatIsHuman(i, settings)) ? `${tr("seat.youShort")} - ${named}` : seatShort(i);
  const text = `${base}${dealerIdx === i ? " 🔘" : ""}`;
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

// The deck in the centre of the table: a face-down stack whose thickness tracks how many
// cards are still undealt, with the starter laid face up on top once it's been cut. The
// stacked backs are absolutely positioned (they rise up-left behind the top card) so the
// --cw footprint never changes and the table never shifts. `count` is the cards remaining
// in the deck; the stack starts full at the deal and thins as cards leave it.
const DECK_EDGE = 0.2;                            // px of offset per stacked card edge
function StarterDeck({ starter, count = 4 }) {
  const edges = Math.max(0, Math.min(51, (count || 1) - 1));   // one edge per undealt card behind the top
  return (
    <div style={{ position: "relative", width: "var(--cw)", height: "var(--ch)", margin: "0 auto" }}>
      {Array.from({ length: edges }).map((_, k) => {
        const d = (edges - k) * DECK_EDGE;         // bottom-most edge is offset furthest up-left
        return <div key={k} style={{ position: "absolute", left: d, top: -d }}><CardBack /></div>;
      })}
      <div style={{ position: "absolute", left: 0, top: 0 }}>{starter ? <Card card={starter} /> : <CardBack />}</div>
    </div>
  );
}

// Deal animation timing — one tunable knob (snappy by default). DEAL_STAGGER is the gap
// between successive cards leaving the deck; DEAL_MOVE is one card's deck→seat travel time.
// Set DEAL_STAGGER to 0 to deal the whole hand at once.
const DEAL_STAGGER = 105;
const DEAL_MOVE = 230;
const DEAL_THROW_PAUSE = 150;                     // beat between the deal landing and the discards flying to the crib
const THROW_STAGGER = 70;                         // gap between your two thrown cards flying to the crib
const CRIB_PEEK = 0.25;                           // at its home the crib shows only its bottom quarter (tucked under the score row)
const CRIB_HOME_LIFT = 0.72;                      // how far (× --ch) the crib home is pulled up under the score region — tune to taste
// A card flying through a path of waypoints (`legs`): it mounts at `from`, then steps to each
// leg's {x,y} at that leg's absolute `delay`, the CSS transition animating each hop. A deck→seat
// deal is one leg; a card a bot throws gets a second leg (seat→crib).
function DealFly({ from, legs }) {
  const [idx, setIdx] = React.useState(-1);
  React.useEffect(() => {
    const timers = legs.map((lg, i) => setTimeout(() => setIdx(i), lg.delay));
    return () => timers.forEach(clearTimeout);
  }, []);
  const p = idx < 0 ? from : legs[idx];
  return (
    <div style={{
      position: "absolute", left: 0, top: 0, width: "var(--cw)",
      transform: `translate(${p.x}px, ${p.y}px)`,
      transition: `transform ${idx < 0 ? 0 : legs[idx].dur}ms cubic-bezier(.2,.7,.3,1)`,
      zIndex: 6, pointerEvents: "none",
    }}><CardBack /></div>
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
  // Cards still sitting in the centre deck: full (52) before the deal; minus every dealt card
  // once hands are out; minus the starter (and the 3-handed deck-card) once the cut is taken.
  const totalDealt = pl.sizes.reduce((a, b) => a + b, 0);
  const deckCount = preDeal ? 52 : 52 - totalDealt - (phase === "discard" ? 0 : 1 + (pl.deckCard ? 1 : 0));

  // Deal animation: when a hand goes from "no cards" (pre-deal) to dealt, fly one card out of
  // the centre deck to each seat in round-robin order. Pure render layer — measures the live
  // deck/seat slots ([data-slot]) and floats CardBacks over them; the static hands are hidden
  // until the flight lands. Reducer/verify_play untouched.
  const tableRef = React.useRef(null);
  const [dealAnim, setDealAnim] = React.useState(null);
  const [dealtN, setDealtN] = React.useState(0);              // cards launched so far (deck thins by this)
  const dealSig = preDeal ? "" : seats.map((s) => (s.dealt || []).map(cardId).join(".")).join("|");
  const prevSig = React.useRef(null);
  React.useLayoutEffect(() => {
    const old = prevSig.current;
    prevSig.current = dealSig;
    if (old === null || dealSig === old || !(dealSig && old === "")) return;   // only the pre-deal → dealt transition
    const root = tableRef.current; if (!root) return;
    const rootR = root.getBoundingClientRect();
    const rel = (el) => { const r = el.getBoundingClientRect(); return { left: r.left - rootR.left, top: r.top - rootR.top, width: r.width }; };
    const deckEl = root.querySelector('[data-slot="deck"]'); if (!deckEl) return;
    const db = rel(deckEl);
    const cw = Math.min(68, (Math.min(typeof window !== "undefined" ? window.innerWidth : 560, 560) - 62) / 6);
    const from = { x: db.left + db.width / 2 - cw / 2, y: db.top };
    // Per-card destinations: each seat's n dealt cards land in their actual fan slots — the
    // human's interactive hand is a spaced row (gap 6), every other seat an overlapping fan —
    // so a card flies straight to where it will sit and never snaps on reveal. Every seat is
    // first dealt its WHOLE hand (round-robin), like a real player; then each bot's discards fly
    // on to the crib pile and its kept cards spread into their final fan — nothing is deleted.
    const handToGrid = seatIsHuman(me, settings) && !needHandoff && phase === "discard";
    const slot = { deck: db };
    for (let i = 0; i < P; i++) { const e = root.querySelector(`[data-slot="seat-${i}"]`); if (e) slot["seat" + i] = rel(e); }
    const he = root.querySelector('[data-slot="hand"]'); if (he) slot.hand = rel(he);
    const ce = root.querySelector('[data-slot="crib"]'); if (ce) slot.crib = rel(ce);
    const fanX = (b, n, j, gap) => gap                                 // x of card j of an n-card row: spaced (grid) or overlapping fan
      ? b.left + b.width / 2 - (n * cw + (n - 1) * gap) / 2 + j * (cw + gap)
      : b.left + b.width / 2 - cw * (1 + (n - 1) * BACK_VISIBLE) / 2 + j * BACK_VISIBLE * cw;
    const list = [];
    const maxSize = Math.max(...pl.sizes);
    for (let c = 0; c < maxSize; c++) for (let i = 0; i < P; i++) if (c < pl.sizes[i]) list.push({ i, j: c });   // round-robin, whole hand
    const T_throw = (list.length - 1) * DEAL_STAGGER + DEAL_MOVE + DEAL_THROW_PAUSE;
    const cribN = seats.reduce((a, s, i) => a + ((i === me && handToGrid) ? 0 : (s.discard ? s.discard.length : 0)), 0);
    const sprites = [];
    let cribM = 0;
    list.forEach((cd, k) => {
      const { i, j } = cd, n = pl.sizes[i];
      const grid = i === me && handToGrid;
      const sb = grid ? slot.hand : slot["seat" + i];
      const dealLeg = { x: sb ? fanX(sb, n, j, grid ? 6 : 0) : from.x, y: sb ? sb.top : from.y, delay: k * DEAL_STAGGER, dur: DEAL_MOVE };
      const legs = [dealLeg];
      const discardN = grid ? 0 : (seats[i].discard ? seats[i].discard.length : 0);
      const keptN = n - discardN;
      if (discardN > 0 && sb) {                                        // a bot's hand splits at the throw
        if (j < keptN) legs.push({ x: fanX(sb, keptN, j, 0), y: sb.top, delay: T_throw, dur: DEAL_MOVE });           // kept: spread into the kept fan
        else if (slot.crib) legs.push({ x: fanX(slot.crib, cribN, cribM++, 0), y: slot.crib.top, delay: T_throw, dur: DEAL_MOVE });   // thrown: on to the crib
      }
      sprites.push({ key: k, from, legs });
    });
    if (!sprites.length) return;
    setDealtN(0);
    setDealAnim(sprites);
    const timers = sprites.map((s, idx) => setTimeout(() => setDealtN(idx + 1), s.legs[0].delay));   // deck loses one as each card leaves it
    timers.push(setTimeout(() => setDealAnim(null), T_throw + DEAL_MOVE + 120));
    return () => timers.forEach(clearTimeout);
  }, [dealSig]);
  const shownDeck = dealAnim ? 52 - dealtN : deckCount;       // thin the deck card-by-card during the deal
  const cribSoFar = seats.reduce((a, s) => a + (s.discard ? s.discard.length : 0), 0);   // cards thrown to the crib so far

  // Your throw → crib: capture the selected cards' live grid positions at commit time (before
  // they leave the hand), then fly backs from there to the crib pile as it grows.
  const throwFromRef = React.useRef(null);
  const [throwAnim, setThrowAnim] = React.useState(null);
  const prevCrib = React.useRef(cribSoFar);
  const captureThrow = (idxs) => {
    const root = tableRef.current, handEl = root && root.querySelector('[data-slot="hand"]');
    if (!handEl) { throwFromRef.current = null; return; }
    const rootR = root.getBoundingClientRect(), kids = handEl.children;
    throwFromRef.current = idxs.map((ix) => { const el = kids[ix]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left - rootR.left, y: r.top - rootR.top }; }).filter(Boolean);
  };
  React.useLayoutEffect(() => {
    const grew = cribSoFar - prevCrib.current;
    prevCrib.current = cribSoFar;
    const froms = throwFromRef.current;
    if (dealAnim || grew <= 0 || !froms || !froms.length) { if (grew > 0) throwFromRef.current = null; return; }
    throwFromRef.current = null;
    const root = tableRef.current; if (!root) return;
    const cribEl = root.querySelector('[data-slot="crib"]'); if (!cribEl) return;
    const rootR = root.getBoundingClientRect(), r = cribEl.getBoundingClientRect();
    const cb = { left: r.left - rootR.left, top: r.top - rootR.top, width: r.width };
    const cw = Math.min(68, (Math.min(typeof window !== "undefined" ? window.innerWidth : 560, 560) - 62) / 6);
    const n = cribSoFar, use = froms.slice(0, grew);
    const sprites = use.map((f, q) => {
      const m = n - grew + q, x = cb.left + cb.width / 2 - cw * (1 + (n - 1) * BACK_VISIBLE) / 2 + m * BACK_VISIBLE * cw;
      return { key: q, from: f, legs: [{ x, y: cb.top, delay: q * THROW_STAGGER, dur: DEAL_MOVE }] };
    });
    if (!sprites.length) return;
    setThrowAnim({ sprites, hideN: grew });
    const t = setTimeout(() => setThrowAnim(null), (use.length - 1) * THROW_STAGGER + DEAL_MOVE + 100);
    return () => clearTimeout(t);
  }, [cribSoFar]);
  // The show counts one owner at a time: their (face-up) hand or the crib, plus the cut.
  const info = showPhase ? computeShow(state) : null;
  const stepLabel = showPhase ? tr("play.show.step", { n: state.show.step + 1, m: state.show.order.length }) : "";
  // What each seat is holding (face down for the others): nothing before a hand is dealt;
  // during the discard, its current hand — the kept four once it has thrown, else the full
  // dealt hand — so a seat drops to four as soon as it discards; the kept four at the cut;
  // the live peg hand during play and, through the show, the same finished peg state
  // (everyone's cards played and face up), so nothing in the view changes from play to show.
  const hands = peg ? peg.hands : seats.map((s) => (preDeal ? [] : discardPhase ? (s.kept || s.dealt) : (s.kept || [])));
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

  const commit = (idxs) => { if (discardPhase) captureThrow(idxs); dispatch(discardPhase
    ? { type: "SELECT_DISCARD", idxs: idxs.slice().sort((a, b) => a - b) }
    : { type: "SELECT_PLAY", card: yourHand[idxs[0]] }); };
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

  const cell = (i) => {
    if (cutdealPhase) {                                    // cut for deal: each seat's single draw, dealer lit
      const draw = dealDraw ? dealDraw[i] : null;
      return <Seat key={i} i={i} dealerIdx={dealerIdx} active={i === dealerIdx} dim={i !== dealerIdx}
        items={draw ? cardItems([draw]) : backItems(1)} settings={settings} me={me} />;
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
      items={dealAnim ? [] : [...backItems(remaining), ...cardItems(played)]} settings={settings} me={me} />;
  };
  return (
    <div ref={tableRef} style={{ position: "relative", marginTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
      {dealAnim && dealAnim.map((s) => <DealFly key={s.key} from={s.from} legs={s.legs} />)}
      {throwAnim && throwAnim.sprites.map((s) => <DealFly key={"t" + s.key} from={s.from} legs={s.legs} />)}
      {/* the completed crib lives tucked up under the score row, only its bottom edge showing */}
      {(cutPhase || phase === "play") && crib.length > 0 && (
        <div data-slot="cribhome" style={{ position: "absolute", top: `calc(var(--ch) * ${-CRIB_HOME_LIFT})`, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 0, pointerEvents: "none" }}>
          <Fan items={backItems(crib.length)} clip={CRIB_PEEK} clipBottom />
        </div>
      )}
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
          {/* labels the face-up starter once the cut is done (play onward); before then the pile is
              just the undealt deck, so label it "deck". Keeps the row bottom-aligned with the seats. */}
          <div style={{ height: 18, marginBottom: 4, display: "flex", alignItems: "center", fontFamily: mono, fontSize: 10, color: T.muted }}>{(phase === "play" || showPhase || overPhase) ? tr("play.starterCard") : tr("play.deck")}</div>
          <div data-slot="deck" style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", height: "var(--ch)" }}>
            <StarterDeck starter={(phase === "play" || showPhase || overPhase) ? starter : null} count={shownDeck} />
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
          <div style={{ fontWeight: 700, fontSize: 18 }}>{winner !== null && teamOf(winner, P, teams) === teamOf(me, P, teams) ? tr("play.win.you") : tr("play.win.team", { team: teamLabel(teamsList(P, teams).find((m) => m.includes(winner)) || [winner]) })}</div>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>{tr("play.win.final", { target: targetFor(P), scores: teamsList(P, teams).map((m) => `${teamLabel(m)} ${seats[m[0]].score}`).join(" · ") })}</div>
        </Panel>
      ) : cutdealPhase ? (
        <Panel tone={isDealer ? "good" : null}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{tr("play.cutdeal.title")}</div>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>
            {isDealer ? tr("play.cutdeal.subYou") : tr("play.cutdeal.subSeat", { seat: seatName(dealerIdx) })}
          </div>
        </Panel>
      ) : dealPhase ? (
        <Panel tone={cribOurs ? "good" : null}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{isDealer ? tr("play.deal.yours") : teammateDeals ? tr("play.deal.teammate", { seat: seatName(dealerIdx) }) : tr("play.deal.theirs", { seat: seatName(dealerIdx) })}</div>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>{dealBlurb(P)}</div>
        </Panel>
      ) : showPhase ? (
        info.isCrib ? (
          // the crib has no seat — reveal it face up here, where the pile/crib normally sits.
          <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px", minHeight: 88, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{tr("play.show.entCounting", { ent: entText(info), step: stepLabel })}</span>
            <Fan items={cardItems(info.cards)} />
          </div>
        ) : (
          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{tr("play.show.title", { ent: entText(info) })}</div>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: T.muted }}>{tr("play.show.counting", { step: stepLabel })}</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>{tr("play.show.order")}</div>
          </Panel>
        )
      ) : discardPhase ? (
        <Panel tone={cribOurs ? "good" : "red"}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, minWidth: 0 }}>{multiHuman ? tr("play.crib.seatPrefix", { seat: seatName(me) }) : ""}{isDealer ? tr("play.crib.greedy") : teammateDeals ? tr("play.crib.teamGreedy", { seat: seatName(dealerIdx) }) : tr("play.crib.defend", { seat: seatName(dealerIdx) })}</div>
            {cribSoFar > 0 && <div data-slot="crib" style={{ flex: "0 0 auto", visibility: dealAnim ? "hidden" : "visible" }}><Fan items={backItems(cribSoFar)} hideFrom={throwAnim ? cribSoFar - throwAnim.hideN : undefined} /></div>}
          </div>
        </Panel>
      ) : cutPhase ? (
        <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px", minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{me === dealerIdx ? tr("play.cut.yourCrib") : tr("play.cut.seatCrib", { seat: seatName(dealerIdx) })}</span>
        </div>
      ) : (
        <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "0 12px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: `calc(var(--ch) * ${PILE_VISIBLE})` }}>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 12px", borderRadius: 9, background: "rgba(0,0,0,0.3)", border: `1px solid ${T.line}` }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{tr("play.pile.count")}</span>
              <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 28, lineHeight: 1, color: peg.count === 31 ? T.good : T.ivory }}>{peg.count}</span>
            </div>
            <div style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", display: "flex", justifyContent: "center" }}>
              {peg.pileSuited.length
                ? <PileFan cards={peg.pileSuited} />
                : <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{tr("play.pile.cleared")}</span>}
            </div>
          </div>
        </div>
      )}

      {overPhase ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SkunkPanel seats={seats} winner={winner} P={P} teams={teams} />
          {bigBtn(tr("play.btn.playAgain"), () => dispatch({ type: "PLAY_AGAIN" }), "good")}
        </div>
      ) : showPhase ? (
        needClaim ? (
          <div style={{ background: "rgba(0,0,0,0.26)", borderRadius: 10, padding: "14px 14px 16px" }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>
              {info.isCrib ? tr("play.show.claimCrib") : tr("play.show.claimHand")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 14 }}>
              <StepBtn onClick={() => setClaim((v) => Math.max(0, v - 1))}>−</StepBtn>
              <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 34, minWidth: 48, textAlign: "center" }}>{claim}</span>
              <StepBtn onClick={() => setClaim((v) => Math.min(29, v + 1))}>+</StepBtn>
            </div>
            {bigBtn(tr("play.show.claimBtn", { n: claim }), () => dispatch({ type: "SHOW_CLAIM", value: claim }), "good")}
          </div>
        ) : (
          <div style={{ background: "rgba(0,0,0,0.26)", borderRadius: 10, padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{tr("play.show.scoring")}</span>
              <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 20, color: T.ivory }}>{info.total}</span>
            </div>
            {info.total > 0
              ? <CatBars cats={info.acc} scale={info.total} color={info.isCrib ? (seatIsHuman(info.owner, settings) ? T.good : T.pegRed) : T.good} />
              : <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{tr("play.show.nineteen")}</div>}
            {muggins && state.show.claimSubmitted && (
              <div style={{ fontFamily: mono, fontSize: 11.5, color: state.show.claimValue >= info.total ? T.good : T.pegRed, marginTop: 10 }}>
                {state.show.claimValue < info.total
                  ? tr("play.show.claimedMissed", { n: state.show.claimValue, m: info.total - state.show.claimValue })
                  : state.show.claimValue > info.total
                    ? tr("play.show.claimedOver", { n: state.show.claimValue })
                    : tr("play.show.claimedSpot", { n: state.show.claimValue })}
              </div>
            )}
            {bigBtn(tr("play.btn.continue"), () => dispatch({ type: "SHOW_NEXT" }), "wood")}
          </div>
        )
      ) : preDeal ? (
        settings.autoDeal
          ? <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>{tr("play.btn.dealing")}</div>
          : (<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {dealPhase && (
                <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, lineHeight: 1.7, textAlign: "center" }}>
                  {tr("play.cfg.counting")} <b style={{ color: T.cream }}>{mugginsActive(settings) ? tr("play.cfg.muggins") : tr("play.cfg.auto")}</b> ·{" "}
                  {tr("play.cfg.goNoCard")} <b style={{ color: T.cream }}>{settings.autoGo ? tr("play.cfg.auto") : tr("play.cfg.manual")}</b> ·{" "}
                  {tr("play.cfg.warn")} <b style={{ color: T.cream }}>{settings.warn ? tr("play.cfg.on") : tr("play.cfg.off")}</b>
                  <span> {tr("play.cfg.tapChange")}</span>
                </div>
              )}
              {bigBtn(multiHuman ? tr("play.dealAs", { seat: seatName(dealerIdx) }) : isDealer ? tr("play.deal") : tr("play.dealCrib", { seat: seatName(dealerIdx) }), () => dispatch({ type: "DEAL" }), "wood")}
            </div>)
      ) : cutPhase ? (
        // Auto-cut skips this phase entirely; when it's off, a human cutter taps to cut,
        // while a bot cutter just does it (announced here, advanced on a timer).
        seatIsHuman(cutter, settings)
          ? bigBtn(tr("play.btn.cutFor", { seat: seatName(dealerIdx) }), () => dispatch({ type: "CUT" }), "wood")
          : <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>{tr("play.cutMsg", { seat: seatName(cutter) })}</div>
      ) : needHandoff ? <PassPanel to={discardPhase ? me : peg.turn} dispatch={dispatch} /> : (
      <div>
        {pending && (discardPhase
          ? <div style={{ marginBottom: 10 }}><DiscardWarning pd={pending} cribIsOurs={cribOurs} dispatch={dispatch} onCancel={() => setSel([])} /></div>
          : <div style={{ marginBottom: 10 }}><PlayWarning pp={pending} dispatch={dispatch} /></div>)}
        {!pending && (() => {
          // One fixed-height slot below the table: an action button when there's something to
          // do, otherwise the status line in the very same place — no separate prompt above.
          let el = null;
          if (stuck && !settings.autoGo && meHuman) {
            el = <button onClick={() => dispatch({ type: "PASS_GO", seat: me })} style={{
              width: "100%", padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
              background: `linear-gradient(180deg, ${T.pegRed}, #9c3120)`, color: T.ivory,
              fontSize: 15, fontWeight: 700, letterSpacing: 0.3, boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
            }}>{tr("play.go")}</button>;
          } else if (myTurn && meHuman && tapSelect) {
            // The confirm button doubles as the prompt: disabled "Tap a card…" until a full
            // selection is made, then it enables and reads "Throw to crib" / "Play".
            const ready = sel.length === count && sel.every((i) => isLegal(yourHand[i]));
            const label = discardPhase
              ? (ready ? tr("play.throw") : sel.length === 0 ? (count === 2 ? tr("play.tapTwo") : tr("play.tapOne")) : tr("play.tapMore"))
              : (ready ? tr("play.playCard") : tr("play.tapPlay"));
            el = <ConfirmButton label={label} enabled={ready} onClick={() => { const idxs = sel; setSel([]); commit(idxs); }} />;
          } else {
            const txt = (myTurn && meHuman)                                  // non-tap mode, your turn
              ? (discardPhase ? tr("play.tapOne") : tr("play.yourTurnPlay"))
              : peg ? (peg.turn === me
                  ? (yourHand.length === 0 ? (isYou(me) ? tr("play.allPlayed.you") : tr("play.allPlayed.seat", { seat: seatName(me) })) : tr("play.toPlay", { seat: seatName(me) }))
                  : tr("play.toPlay", { seat: seatName(peg.turn) }))
              : "";
            el = <div style={{ fontFamily: mono, fontSize: 11.5, color: (myTurn || stuck) ? T.selBlue : T.muted, textAlign: "center", lineHeight: 1.4 }}>{txt}</div>;
          }
          return <div style={{ minHeight: 44, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>{el}</div>;
        })()}
        {/* The interactive hand is only for a human in this seat; a bot (all-bot spectate)
            keeps its cards face down under its played pile, like every other seat. */}
        {meHuman && (
          <div data-slot="hand" className={discardPhase ? "dealwrap" : undefined} style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "nowrap", visibility: dealAnim ? "hidden" : "visible" }}>
            {yourHand.map((card, i) => {
              const legal = isLegal(card);
              const chosen = pending ? pendIdxs.includes(i) : sel.includes(i);
              return (
                <Card key={cardId(card)} card={card} selLabel={discardPhase ? undefined : tr("play.sel.play")}
                  clickable={pending ? true : (myTurn && legal)}
                  selected={!tapSelect && chosen}
                  raised={tapSelect && chosen}
                  dim={!pending && !legal && turn === me}
                  onClick={() => tapCard(i)} />
              );
            })}
            {!discardPhase && yourHand.length === 0 && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{tr("play.handEmpty")}</span>}
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
  const side = cribIsOurs ? tr("play.warn.forSide") : tr("play.warn.toOpp");
  const thrownTag = (o) => o.thrown.map(tag).join(" ");
  const Line = ({ label, o, strong }) => (
    <div style={{ fontFamily: mono, fontSize: 11.5, lineHeight: 1.6, color: strong ? T.cream : T.muted }}>
      <b style={{ color: strong ? T.good : T.ivory }}>{label}</b> {tr("play.warn.line", { thrown: thrownTag(o), keep: o.four.map(tag).join(" "), hand: o.keptEV.toFixed(2), crib: o.cribSwing.toFixed(2), side })} <b>{tr("play.warn.net", { net: o.value.toFixed(2) })}</b>
    </div>
  );
  return (
    <Panel tone="red">
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{tr("play.warn.title", { delta: delta.toFixed(2) })}</div>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        <Line label={tr("play.warn.best")} o={best} strong />
        <Line label={tr("play.warn.yours")} o={chosen} />
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.cream, marginBottom: 12 }}>
        {tr("play.warn.explain", { dir: cribIsOurs ? tr("play.warn.dirOurs") : tr("play.warn.dirOpp") })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => dispatch({ type: "CONFIRM_DISCARD" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer",
          background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>{tr("play.warn.throwAnyway", { thrown: thrownTag(chosen) })}</button>
        <button onClick={() => { dispatch({ type: "CANCEL_DISCARD" }); if (onCancel) onCancel(); }} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: "none", cursor: "pointer",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>{tr("play.warn.pickAgain")}</button>
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
  const off = tr("common.off"), on = tr("common.on"), manual = tr("common.manual"), auto = tr("common.auto");
  return (
    <div style={{ background: "rgba(0,0,0,0.32)", border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 16px 4px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{tr("settings.title")}</span>
        <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>{tr("common.done")}</button>
      </div>
      <Row title={tr("settings.tapToSelect.title")} k="tapToSelect"
        desc={tr("settings.tapToSelect.desc")}
        options={[[off, false], [on, true]]} />
      <Row title={tr("settings.autoCut.title")} k="autoCut"
        desc={tr("settings.autoCut.desc")}
        options={[[manual, false], [auto, true]]} />
      <Row title={tr("settings.autoGo.title")} k="autoGo"
        desc={tr("settings.autoGo.desc")}
        options={[[manual, false], [auto, true]]} />
      <Row title={tr("settings.warn.title")} k="warn"
        desc={tr("settings.warn.desc")}
        options={[[on, true], [off, false]]} />
      <Row title={tr("settings.autoPlayOne.title")} k="autoPlayOne"
        desc={tr("settings.autoPlayOne.desc")}
        options={[[off, false], [on, true]]} />
      <Row title={tr("settings.autoPlayBest.title")} k="autoPlayBest"
        desc={tr("settings.autoPlayBest.desc")}
        options={[[off, false], [on, true]]} />
      <Row title={tr("settings.autoDiscardBest.title")} k="autoDiscardBest"
        desc={tr("settings.autoDiscardBest.desc")}
        options={[[off, false], [on, true]]} />
      <Row title={tr("settings.autoContinue.title")} k="autoContinue"
        desc={tr("settings.autoContinue.desc")}
        options={[[off, false], [on, true]]} />
      <Row title={tr("settings.autoDeal.title")} k="autoDeal"
        desc={tr("settings.autoDeal.desc")}
        options={[[off, false], [on, true]]} />
      <Row title={tr("settings.counting.title")} k="counting" disabled={!soloGame}
        desc={tr(soloGame ? "settings.counting.desc" : "settings.counting.disabledDesc")}
        options={[[tr("settings.counting.optAuto"), "auto"], [tr("settings.counting.optMuggins"), "muggins"]]} />
      <LanguageRow />
      <div style={{ borderTop: `1px solid ${T.line}`, margin: "2px -16px 0", padding: "12px 16px 0" }}>
        <button onClick={onHistory} style={{ width: "100%", padding: "10px", borderRadius: 9, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{tr("settings.history")}</button>
      </div>
      <button onClick={() => dispatch({ type: "RESET_SETTINGS" })} style={{ width: "100%", margin: "10px 0 0", padding: "10px", borderRadius: 9, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{tr("settings.resetDefaults")}</button>
      <AboutRow onAbout={onAbout} />
      <button onClick={onClose} style={{
        width: "100%", margin: "12px 0 10px", padding: "12px", borderRadius: 9, border: "none", cursor: "pointer",
        background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory,
        fontFamily: mono, fontSize: 12.5, fontWeight: 700,
      }}>{tr("settings.continue")}</button>
    </div>
  );
}

// Global language chooser (shared via window.i18n / localStorage; reloads to apply). Only
// shown when more than one language is registered.
function LanguageRow() {
  const i = (typeof window !== "undefined") ? window.i18n : null;
  const langs = i ? i.languages() : [];
  if (!i || langs.length <= 1) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{window.t ? window.t("common.language") : "Language"}</div>
      <select defaultValue={i.lang} onChange={(e) => i.choose(e.target.value)}
        style={{ marginTop: 7, fontFamily: mono, fontSize: 12, color: T.cream, background: "rgba(0,0,0,0.25)", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
        {langs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
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
      }}>{tr("settings.aboutFeedback")}</button>
    </div>
  );
}

function HistoryModal({ onClose }) {
  const [tick, setTick] = React.useState(0);
  const all = loadHistory();
  const [sel, setSel] = React.useState("all");
  const [confirmClear, setConfirmClear] = React.useState(false);
  const keyOf = (r) => `${r.P}/${r.teams}`;
  const cfgLabel = (P, t) => (t < P ? tr("play.hist.cfgTeams", { p: P, teams: t }) : tr("play.hist.cfgHanded", { p: P }));
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
          <span style={{ fontWeight: 700, fontSize: 17 }}>{tr("play.hist.title")}</span>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>{tr("common.done")}</button>
        </div>

        {all.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, lineHeight: 1.6 }} data-tick={tick}>{tr("play.hist.empty")}</div>
        ) : (
          <React.Fragment>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {chip("all", tr("play.hist.all"))}
              {configs.map((k) => { const [P, t] = k.split("/").map(Number); return chip(k, cfgLabel(P, t)); })}
            </div>

            <Stat label={tr("play.hist.games")} value={games} />
            <Stat label={tr("play.hist.won")} value={tr("play.hist.wonValue", { n: won, pct: winPct })} accent={T.good} />
            <Stat label={tr("play.hist.lost")} value={lost} />
            <Stat label={tr("play.hist.skunked")} value={sk} accent={sk ? T.pegRed : T.cream} />
            <Stat label={tr("play.hist.dblSkunked")} value={dsk} accent={dsk ? T.pegRed : T.cream} />

            {specific ? (
              <React.Fragment>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, margin: "14px 0 4px", letterSpacing: 0.3 }}>{tr("play.hist.avgHeader")}</div>
                <Stat label={tr("play.hist.pegging")} value={avg("peg").toFixed(1)} />
                <Stat label={tr("play.hist.hand")} value={avg("hand").toFixed(1)} />
                <Stat label={tr("play.hist.crib")} value={avg("crib").toFixed(1)} />
              </React.Fragment>
            ) : (
              <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginTop: 12, lineHeight: 1.5 }}>{tr("play.hist.pickHint")}</div>
            )}

            <button onClick={() => { if (confirmClear) { clearHistory(); setSel("all"); setConfirmClear(false); setTick(tick + 1); } else setConfirmClear(true); }} style={{
              width: "100%", marginTop: 16, padding: "10px", borderRadius: 9, cursor: "pointer",
              border: `1px solid ${confirmClear ? T.pegRed : T.line}`, background: "rgba(0,0,0,0.25)",
              color: confirmClear ? T.pegRed : T.muted, fontFamily: mono, fontSize: 11.5, fontWeight: 700,
            }}>{confirmClear ? tr("play.hist.clearConfirm") : tr("play.hist.clear")}</button>
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
            <span style={{ fontWeight: 700, fontSize: 17 }}>{tr("about.title")}</span>
          </div>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>{tr("common.done")}</button>
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, lineHeight: 1.6, marginBottom: 12 }}>
          {tr("about.line1")}
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, lineHeight: 1.6, marginBottom: 16 }}>
          {tr("about.line2")}
        </div>
        <a href={REPO} target="_blank" rel="noopener noreferrer" style={{
          display: "block", textAlign: "center", padding: "12px", borderRadius: 9, textDecoration: "none", boxSizing: "border-box",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>{tr("about.sourceLink")}</a>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, textAlign: "center", margin: "8px 0 4px", wordBreak: "break-all" }}>github.com/ghug/cribbage-trainer</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textAlign: "center" }}>v__APP_VERSION__</div>
      </div>
    </div>
  );
}

function PlayWarning({ pp, dispatch }) {
  return (
    <Panel tone="red">
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{tr(pp.delta === 1 ? "play.warn.leavesOne" : "play.warn.leavesMany", { n: pp.delta })}</div>
      <div style={{ fontFamily: mono, fontSize: 11.5, lineHeight: 1.6, color: T.cream, marginBottom: 12 }}>
        {tr("play.warn.playLineA", { card: tag(pp.card), pts: pp.chosenPts })}<b style={{ color: T.good }}>{tag(pp.bestCard)}</b>{tr("play.warn.playLineB", { pts: pp.bestPts, delta: pp.delta })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => dispatch({ type: "CONFIRM_PLAY" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer",
          background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>{tr("play.warn.playAnyway", { card: tag(pp.card) })}</button>
        <button onClick={() => dispatch({ type: "CANCEL_PLAY" })} style={{
          flex: 1, padding: "11px", borderRadius: 9, border: "none", cursor: "pointer",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: 12.5, fontWeight: 700,
        }}>{tr("play.warn.pickAgain")}</button>
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
