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
// cardId → the card it identifies, so the persistent card layer can render a sprite from a
// bare id (the homes map is keyed by id). 0..51, the inverse of cardId.
const CARD_BY_ID = (() => { const a = []; for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) a[(r - 1) * 4 + s] = { r, s }; return a; })();
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
// Build-time version (build.sh swaps __APP_VERSION__ for the VERSION file's value). On a dev
// build it's like "1.1.19-dev.51"; shown in the play header so a dev build is identifiable.
const APP_VERSION = "__APP_VERSION__";
const IS_DEV_VERSION = APP_VERSION.indexOf("-dev") !== -1;
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
  // Last throw: the crib is now full, but the game HOLDS in "cribbing" while the render animates
  // the card arriving and the crib gliding to its home. CRIB_DONE (dispatched when the animation
  // finishes — or immediately, in the render-free verify harness) advances to the cut.
  return { ...state, seats, crib: assembleCrib(seats, state.deck, pl), pendingDiscard: null, phase: "cribbing", discardSeat: null };
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

// The deal is INCREMENTAL: the model pushes ONE card at a time into a hand, and the view gates the
// next push on the previous card's transitionend (see PlayScreen's deal driver). `startDeal` shuffles,
// plans the round-robin SEAT ORDER (pone-first, clockwise, skipping seats already at size), and empties
// the hands; `dealStep` pushes deck[cursor] to seq[cursor] and, on the last card, runs `finalizeDeal`
// (the bot throws / crib / discard-or-cut tail). Deck order IS deal order — card k off the top goes to
// the k-th seat in the round-robin — so nothing peeks at the undealt rest.
function dealSeq(P, dealerIdx, pl) {
  const pone = (dealerIdx + 1) % P;
  const seq = [], counts = Array.from({ length: P }, () => 0);
  for (let dealing = true; dealing; ) {
    dealing = false;
    for (let k = 0; k < P; k++) {
      const seat = (pone + k) % P;
      if (counts[seat] < pl.sizes[seat]) { seq.push(seat); counts[seat]++; dealing = true; }
    }
  }
  return seq;
}
function startDeal(state) {
  const P = clampPlayers(state.settings.players);
  const d = state.dealerIdx;
  const pl = plan(P, d);
  const deck = freshDeck();
  const seq = dealSeq(P, d, pl);
  const seats = state.seats.map((s, i) => ({ score: s.score, isAI: !seatIsHuman(i, state.settings), history: s.history || [], dealt: [], kept: null, discard: null }));
  return {
    ...state, seats, deck, starter: null, crib: [], hisHeels: false,
    peg: null, show: null, winner: null, phase: "dealing", message: "", pendingDiscard: null, pendingPlay: null,
    deal: { seq, cursor: 0 },
    holder: nHumans(P, state.settings) > 1 ? d : firstHuman(P, state.settings), discardSeat: null,
  };
}
function dealStep(state) {
  const deal = state.deal;
  if (!deal || deal.cursor >= deal.seq.length) return state;
  const seat = deal.seq[deal.cursor];
  const card = state.deck[deal.cursor];                      // deck order == deal order
  const seats = state.seats.map((s, i) => i === seat ? { ...s, dealt: sortHand([...s.dealt, card]) } : s);
  const cursor = deal.cursor + 1;
  if (cursor < deal.seq.length) return { ...state, seats, deal: { ...deal, cursor } };
  return finalizeDeal({ ...state, seats, deal: null });      // last card just landed
}
function finalizeDeal(state) {
  const P = clampPlayers(state.settings.players);
  const teams = clampTeams(P, state.settings.teams);
  const d = state.dealerIdx;
  const pl = plan(P, d);
  const deck = state.deck;
  const seats = state.seats.map((s) => ({ ...s }));
  // Non-throwers keep their hand; throwing BOTS throw now; throwing HUMANS throw
  // interactively during the discard phase (one at a time, passing the device).
  for (let i = 0; i < P; i++) {
    if (pl.throws[i] === 0) { seats[i].kept = sortHand(seats[i].dealt); seats[i].discard = []; }
    else if (!seatIsHuman(i, state.settings)) { const r = aiDiscardN(seats[i].dealt, i, d, pl.throws[i], P, teams); seats[i].discard = r.discard; seats[i].kept = sortHand(r.kept); }
  }
  const humanThrowers = throwOrder(P, d, state.settings);   // pone first, clockwise, dealer last
  const base = { ...state, seats, phase: "discard", message: "", discardSeat: humanThrowers.length ? humanThrowers[0] : null };
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
      return startDeal(state);

    case "DEAL_NEXT":           // push the next card off the deck into its hand (driven by the view's transitionend gate)
      return dealStep(state);

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

    case "CRIB_DONE":
      return state.phase === "cribbing" ? afterCrib({ ...state, phase: "cut" }) : state;

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

const DEFAULT_SETTINGS = { players: 2, teams: 2, names: [], counting: "auto", tapToSelect: true, autoCut: false, autoGo: false, warn: true, autoDeal: false, autoContinue: false, autoPlayOne: false, autoPlayBest: false, autoDiscardBest: false };
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
    peg: null, show: null, winner: null, phase: "cutdeal", message: "", deal: null,
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
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%", maxHeight: "85vh", overflowY: "auto", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "18px 18px 14px", boxShadow: "0 14px 44px rgba(0,0,0,0.55)" }}>
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
function PassPanel({ to, dispatch, locked }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 16px", borderRadius: 12, background: "rgba(0,0,0,0.3)", border: `1px solid ${T.line}` }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>{tr("play.pass.to", { seat: seatName(to) })}</div>
      <ConfirmButton label={tr("play.pass.take", { seat: seatName(to) })} enabled={!locked} onClick={() => dispatch({ type: "TAKE_DEVICE" })} />
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
  const [viewSeat, setViewSeat] = React.useState(-1);          // the seat currently shown at the bottom — reported up by PlayScreen as the ring rotates
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

  // The "cribbing" hold: once the crib is full, give your card a beat to reach the crib, then let
  // the crib glide (crib → cribhome in the card layer), and only then advance the game (CRIB_DONE → cut).
  const [cribGliding, setCribGliding] = React.useState(false);
  useEffect(() => {
    if (phase !== "cribbing") { setCribGliding(false); return; }
    const t1 = setTimeout(() => setCribGliding(true), CRIB_THROW_TIME);
    const t2 = setTimeout(() => dispatch({ type: "CRIB_DONE" }), CRIB_THROW_TIME + CRIB_MOVE + 80);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);

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
    // Wait for the ring to finish rotating to the active seat before any bot (or auto) move. This
    // makes the rotation a hard precondition, not a race against the play timer — even a 0 ms timer
    // can't fire until the view has settled on peg.turn. (Only when the ring actually rotates, i.e.
    // multi-human; single-human keeps the human fixed at the bottom and never gates.)
    if (multiHuman && viewSeat !== peg.turn) return;
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
  }, [phase, peg, settings, state.pendingPlay, autoPaused, needHandoff, multiHuman, viewSeat]);

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
    // Only auto-cut turns the starter on a timer. In MANUAL mode the cut is always a deliberate,
    // visible step — a tap — even when a bot is the one cutting (you're not skipped past it).
    if (!settings.autoCut) return;
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
            <span style={{ fontFamily: mono, fontSize: 12, color: "rgba(42,27,14,0.8)", lineHeight: 1.3 }}>{headLine}<br />{tr("play.hdr.playTo", { target: targetFor(players) })}{IS_DEV_VERSION ? ` · v${APP_VERSION}` : ""}</span>
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
        {/* Score banner. (The crib's stored home now hangs off the LEFT edge of the play area —
            see PlayScreen's data-slot "cribhome" — rather than tucking behind this banner.) */}
        <div style={{ position: "relative", zIndex: 6, background: `radial-gradient(120% 200% at 50% -40%, ${T.baizeHi}, ${T.baize})` }}>
          <ScoreRow seats={seats} dealerIdx={dealerIdx} turn={turnNow} winner={phase === "over" ? winner : null}
            onPick={(i) => setHistorySeat((cur) => (cur === i ? null : i))} P={players} teams={teams} />
        </div>
        {historySeat !== null && <HistoryPanel seatIdx={historySeat} seats={seats} onClose={() => setHistorySeat(null)} P={players} teams={teams} />}

        {/* Fixed ONE-line height, never wrapping: a long status message runs off the RIGHT edge of
            the screen (clipped there) instead of wrapping to a second line, so the table below never
            shifts up/down as the message changes. `marginRight: 50% - 50vw` stretches the box's right
            edge out to the viewport edge (the table is centred), and overflow:hidden clips the bleed
            there — off-screen-right, with no horizontal scrollbar. */}
        <div style={{ fontFamily: mono, fontSize: 12, color: T.cream, marginTop: 5, marginBottom: 3, marginLeft: 2, marginRight: "calc(50% - 50vw)", height: 18, lineHeight: "18px", whiteSpace: "nowrap", overflow: "hidden" }}>
          {message}
        </div>


        {(phase === "cutdeal" || phase === "deal" || phase === "dealing" || phase === "discard" || phase === "cribbing" || phase === "cut" || (phase === "show" && show) || (phase === "play" && peg) || phase === "over") && (
          <PlayScreen state={state} dispatch={dispatch} me={phase === "discard" ? ds : (phase === "play" && peg && multiHuman) ? peg.turn : (multiHuman && (phase === "cutdeal" || phase === "deal" || phase === "dealing")) ? dealerIdx : playMe} needHandoff={needHandoff} cribGliding={cribGliding} onView={setViewSeat} />
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
// An invisible run of card-SIZED boxes used purely as measurement anchors for the sprite layer.
// These are NOT cards — no face, no back, no graphics — just empty footprints that reserve each
// card's landing spot so a flying sprite knows where to go. The persistent sprites are the one and
// only visible representation of every card; nothing in the DOM is ever an invisible card. `vis` is
// the fan overlap (the fraction of each card still showing).
function SlotGhost({ n, vis = BACK_VISIBLE }) {
  return Array.from({ length: Math.max(0, n || 0) }).map((_, k) => (
    <div key={k} style={{ width: "var(--cw)", aspectRatio: "68 / 96", flex: "0 0 auto", marginLeft: k === 0 ? 0 : `calc(var(--cw) * ${-(1 - vis)})` }} />
  ));
}
// The crib's storage stack is VERTICAL (see PlayScreen's "cribhome" anchor): card 0 (the pile's
// TOP card) sits at the BOTTOM, each deeper card stacked above it, overlapping so only `vis` of
// each lower card shows. Like SlotGhost these are pure measurement footprints — the n boxes are
// DIRECT children of the (positioned) data-slot host, so fanX reads each one as host.children[idx].
const CRIB_HOME_VISIBLE = 0.2;                   // 20% of each lower crib card shows (80% vertical overlap)
function SlotGhostV({ n, vis = CRIB_HOME_VISIBLE }) {
  return Array.from({ length: Math.max(0, n || 0) }).map((_, k) => (
    <div key={k} style={{ position: "absolute", left: 0, bottom: `calc(var(--ch) * ${k * vis})`, width: "var(--cw)", aspectRatio: "68 / 96" }} />
  ));
}
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
function PileFan({ cards, hideFrom }) {
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
      <div data-slot="pile"><Fan items={cardItems(cards, vis)} clip={PILE_VISIBLE} hideFrom={hideFrom} /></div>
    </div>
  );
}

// ---- persistent card layer -------------------------------------------------
// A single absolute element per physical card. From the first deal until the
// reshuffle it is NEVER created or destroyed — every transition (deal, throw to
// crib, the crib gliding home, the cut turn, a pegging play, the end-of-hand
// gather, and the hot-seat reveal/return) is just this element changing its
// `translate(x,y)` and its `rotateY` face. Because the DOM node persists, the
// browser tweens each change; nothing can teleport because nothing is replaced.

// The bare face of a card (no column/label/button chrome) — sized exactly --cw × --ch
// so it lines up back-to-back with CardBack for a clean 3-D flip.
function CardFace({ card, edge }) {
  return (
    <div style={{
      width: "var(--cw)", aspectRatio: "68 / 96", borderRadius: 8, background: T.ivory, position: "relative",
      border: edge ? `2px solid ${edge}` : "1px solid rgba(0,0,0,0.25)",
      boxShadow: edge ? "0 8px 18px rgba(0,0,0,0.45)" : "0 4px 10px rgba(0,0,0,0.35)",
    }}>
      <svg viewBox="0 0 68 96" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "block" }}>
        <text x="13" y="15" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="17" fill={isRed(card.s) ? T.suitRed : T.ink}>{rankLabel(card.r)}</text>
        <text x="13" y="30" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="13" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
        <text x="34" y="49" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontSize="34" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
      </svg>
    </div>
  );
}

// One persistent card. `home` = { x, y, up, z } where it should currently sit (up = face
// up). `dur`/`delay` time the move to a new home. The element holds both faces (front +
// back rotated 180°) so a face flip is the same rotateY tween as a move. Interactive props
// (clickable/selected/raised/dim/onClick) apply only when it is the human's live hand card.
function CardSprite({ card, home, dur, delay, clickable, selected, raised, dim, selLabel, onClick, hidden, onLanded }) {
  const lift = selected || raised ? 8 : 0;                 // selected/raised cards nudge up
  const edge = selected || raised ? T.selBlue : null;
  return (
    <div onClick={clickable ? onClick : undefined}
      onTransitionEnd={onLanded ? (e) => { if (e.target === e.currentTarget && e.propertyName === "transform") onLanded(); } : undefined}
      style={{
        position: "absolute", left: 0, top: 0, width: "var(--cw)", height: "var(--ch)",
        transformStyle: "preserve-3d", zIndex: home.z,
        transform: `translate(${home.x}px, ${home.y - lift}px) rotateY(${home.up ? 0 : 180}deg)`,
        transition: `transform ${dur}ms cubic-bezier(.2,.7,.3,1) ${delay || 0}ms`,
        cursor: clickable ? "pointer" : "default",
        pointerEvents: clickable ? "auto" : "none",
        opacity: hidden ? 0 : (dim ? 0.45 : 1),
        visibility: hidden ? "hidden" : "visible",
      }}>
      {(selected || raised) && (
        <span style={{ position: "absolute", bottom: "calc(100% + 2px)", left: 0, right: 0, textAlign: "center", backfaceVisibility: "hidden",
          fontFamily: mono, fontSize: 9.5, letterSpacing: 0.4, fontWeight: 700, color: T.ivory, pointerEvents: "none" }}>
          <span style={{ background: T.selBlue, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>{selLabel || tr("play.sel.throw")}</span>
        </span>
      )}
      <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}><CardFace card={card} edge={edge} /></div>
      <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}><CardBack /></div>
    </div>
  );
}

// One seat, used everywhere — the ring, the cut-for-deal, and your own bottom seat. A
// fixed-height label row (so the active chip's padding never nudges the cards) sits above
// a fixed --ch card slot holding a fan of whatever the seat is showing.
function Seat({ i, dealerIdx, active, dim, items, settings, me, hideFrom }) {
  return (
    <div style={{ textAlign: "center", minWidth: 0, opacity: dim ? 0.7 : 1 }}>
      <div style={{ height: 18, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
        <SeatLabel i={i} dealerIdx={dealerIdx} active={active} settings={settings} me={me} />
      </div>
      <div data-slot={"seat-" + i} style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", height: "var(--ch)" }}>
        <Fan items={items} hideFrom={hideFrom} />
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

// The deck in the centre of the table: a face-down stack whose thickness tracks how many cards
// are still undealt. The BASE card sits fixed at the slot; the rest stack up-and-right, so the
// TOP of the deck — where cards are dealt from, and where the starter is turned after the cut —
// is the highest card. As the deck thins it shrinks from the top (the top card lowers toward the
// base), like dealing off the top; the --cw footprint never changes so the table never shifts.
const DECK_EDGE = 0.2;                            // px of offset per stacked card
// The starter being turned at the cut: the top card flips from its back to its face on mount
// (a 3-D rotateY), so the cut is a real "turn the card" moment rather than a pop-in.
function StarterCard({ card }) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true))); return () => cancelAnimationFrame(id); }, []);
  return (
    <div style={{ position: "relative", width: "var(--cw)", height: "var(--ch)", transformStyle: "preserve-3d", transition: "transform 920ms cubic-bezier(.2,.7,.3,1)", transform: shown ? "rotateY(0deg)" : "rotateY(-180deg)" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "var(--cw)", backfaceVisibility: "hidden" }}><Card card={card} /></div>
      <div style={{ position: "absolute", top: 0, left: 0, width: "var(--cw)", backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}><CardBack /></div>
    </div>
  );
}
function StarterDeck({ starter, count = 4, topEmpty = false }) {
  const n = Math.max(1, Math.min(52, count || 1));
  return (
    <div style={{ position: "relative", width: "var(--cw)", height: "var(--ch)", margin: "0 auto" }}>
      {Array.from({ length: n }).map((_, k) => {
        const d = k * DECK_EDGE;                    // k=0 = fixed base; k=n-1 = top of the deck, up-right
        const isTop = k === n - 1;
        // The top slot is the deck's top card. Draw the cut card inline if given (`starter`); if a
        // persistent sprite is already sitting there (`topEmpty`), leave the slot EMPTY — keep only
        // its data-decktop anchor — so we never draw a back that the sprite would just cover.
        const content = isTop ? (starter ? <StarterCard card={starter} /> : topEmpty ? null : <CardBack />) : <CardBack />;
        return <div key={k} data-decktop={isTop ? "1" : undefined} style={{ position: "absolute", left: d, top: -d }}>{content}</div>;
      })}
    </div>
  );
}

// One moving deck in the swap. `phase==="out"`: starts at the centre and slides fully off to the
// upper-left (then it's unmounted). `phase==="in"`: starts off the upper-right and slides into the
// centre. The two phases play in sequence with an empty beat between, so the old deck is gone
// before the new one arrives. `offX`/`offY` are how far off-centre the deck travels (px).
function DeckSwapView({ phase, offX, offY, count = 52 }) {
  const [go, setGo] = React.useState(false);
  React.useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true))); return () => cancelAnimationFrame(id); }, []);
  const TR = `transform ${SWAP_DUR}ms cubic-bezier(.4,0,.2,1)`;
  const from = phase === "out" ? "none" : `translate(${offX}px, ${-offY}px)`;   // in: parked upper-right
  const to = phase === "out" ? `translate(${-offX}px, ${-offY}px)` : "none";    // out: off upper-left
  return (
    <div style={{ position: "relative", width: "var(--cw)", height: "var(--ch)", margin: "0 auto" }}>
      <div style={{ position: "absolute", inset: 0, transition: TR, transform: go ? to : from }}>
        <StarterDeck starter={null} count={count} />
      </div>
    </div>
  );
}

// Hot-seat: a card travelling between a player's seat and the hand row while flipping. It mounts
// at `from` rotated `r0`, then translates to `to` rotated `r1`. Reveal (seat→hand) flips back→face
// (r0=-180, r1=0); return (hand→seat) flips face→back (r0=0, r1=180).
function RevealFly({ from, to, card, delay, r0 = -180, r1 = 0 }) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => { const t = setTimeout(() => setShown(true), delay); return () => clearTimeout(t); }, []);
  const p = shown ? to : from;
  return (
    <div style={{
      position: "absolute", left: 0, top: 0, width: "var(--cw)", transformStyle: "preserve-3d", zIndex: 6, pointerEvents: "none",
      transform: `translate(${p.x}px, ${p.y}px) rotateY(${shown ? r1 : r0}deg)`,
      transition: `transform ${DEAL_MOVE}ms cubic-bezier(.2,.7,.3,1)`,
    }}>
      <div style={{ backfaceVisibility: "hidden" }}><Card card={card} /></div>
      <div style={{ position: "absolute", top: 0, left: 0, width: "var(--cw)", backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}><CardBack /></div>
    </div>
  );
}

// Deal animation timing — one tunable knob (snappy by default). DEAL_STAGGER is the gap
// between successive cards leaving the deck; DEAL_MOVE is one card's deck→seat travel time.
// Set DEAL_STAGGER to 0 to deal the whole hand at once.
const DEAL_STAGGER = 210;
const DEAL_MOVE = 460;
const GATHER_STAGGER = 60;                        // gap between cards sweeping back into the deck at hand end
const SEAT_ROTATE = 920;                          // ms for a seat to glide to its new spot as the ring rotates (hot-seat)
// FLIP: keeps a seat (its label + cards) visually continuous across a re-layout by animating from
// where it was to where it lands — so when the hot-seat ring rotates, each seat glides round the
// circle instead of teleporting. Imperative (touches el.style directly) and guarded against
// re-measuring mid-glide. `posRef[idx]` carries each seat's last true (untransformed) position.
function SeatFlip({ idx, posRef, onMove, children }) {
  const ref = React.useRef(null);
  const busy = React.useRef(false);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el || busy.current) return;
    const r = el.getBoundingClientRect();
    const cur = { x: r.left, y: r.top };
    const old = posRef.current[idx];
    posRef.current[idx] = cur;
    if (old && (Math.abs(old.x - cur.x) > 1 || Math.abs(old.y - cur.y) > 1)) {
      busy.current = true;
      el.style.transition = "none";
      el.style.transform = `translate(${old.x - cur.x}px, ${old.y - cur.y}px)`;   // jump back to where it was
      if (onMove) onMove();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = `transform ${SEAT_ROTATE}ms cubic-bezier(.4,0,.2,1)`;
        el.style.transform = "none";                                              // glide to the new spot
        setTimeout(() => { busy.current = false; }, SEAT_ROTATE + 40);
      }));
    }
  });
  return <div ref={ref}>{children}</div>;
}
const DEAL_THROW_PAUSE = 300;                     // beat between the deal landing and the discards flying to the crib
const THROW_STAGGER = 140;                         // gap between your two thrown cards flying to the crib
const CRIB_THROW_TIME = 880;                      // beat the "cribbing" hold waits for your card to reach the crib before it glides
const CRIB_MOVE = 840;                            // ms the cribbing hold allows for the crib to glide to its storage spot
// A card flying through a path of waypoints (`legs`): it mounts at `from`, then steps to each
// leg's {x,y} at that leg's absolute `delay`, the CSS transition animating each hop. A deck→seat
// deal is one leg; a card a bot throws gets a second leg (seat→crib).
function DealFly({ from, legs, card }) {
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
    }}>{card ? <Card card={card} /> : <CardBack />}</div>
  );
}

// The single table. Every pre-show phase renders here: the discard, the cut, and the
// pegging all share one frame (seat ring + starter slot) and one "hand zone" at the
// bottom — a card grid with tap-to-select and a confirm. Only a small per-phase config
// (how many cards, what's legal, where the throw goes, the labels) differs.
// The persistent card layer's per-card move/flip timing. One element per card lives from
// the deal to the reshuffle; every phase just hands it a new home and the browser tweens it.
const MOVE_DUR = 460;                              // base ms for a card to glide to a new home / flip
const CARD_STAGGER = 210;                          // gap between successive cards in a multi-card sweep (deal/gather)
const SWAP_DUR = 520;                              // ms for the old deck to slide out / the new deck to slide in
const EMPTY_DUR = 240;                             // empty beat between the old deck leaving and the new deck arriving
function PlayScreen({ state, dispatch, me: meTarget, needHandoff, cribGliding, onView }) {
  const { peg, starter, dealerIdx, crib, seats, settings, phase, dealDraw, winner, deal } = state;
  const discardPhase = phase === "discard";
  const cribbingPhase = phase === "cribbing";            // crib full, holding while it animates to its home
  const cutPhase = phase === "cut";
  const cutdealPhase = phase === "cutdeal";              // the opening cut-for-deal reveal
  const dealPhase = phase === "deal";                    // the between-hands "ready to deal" rest
  const dealingPhase = phase === "dealing";              // cards leaving the deck one at a time
  const showPhase = phase === "show";                    // counting the hands + crib, one at a time
  const overPhase = phase === "over";                    // game won — final banner + play again
  const dealCursor = deal ? deal.cursor : 0;             // how many cards have been dealt so far
  const preDeal = cutdealPhase || dealPhase;             // no live hand yet: seats hold no cards
  const P = peg ? peg.hands.length : seats.length;
  const teams = clampTeams(P, settings.teams);
  const pl = plan(P, dealerIdx);
  // The VIEW's active seat lags the reducer's: when the reducer hands the turn on (e.g. the
  // deal advances the active seat to the first thrower), the table stays in the current
  // orientation until the in-flight card animation settles, and only THEN rotates. So two
  // things never animate at once — the deal completes, then the ring turns, then the next
  // player reveals. `meTarget` is the reducer's seat; `me` is what the table currently shows.
  const animUntilRef = React.useRef(0);                  // performance.now() until the current card sweep has settled
  const [me, setMe] = React.useState(meTarget);
  const transitioning = me !== meTarget;
  // Advance the view toward `meTarget` ONE SEAT AT A TIME (turn order, counter-clockwise): each
  // step waits for the prior rotation to settle, so when the device passes the whole ring rotates
  // seat-by-seat until the next player sits at the bottom. (Flip to (m-1+P)%P if it reads CW.)
  React.useEffect(() => {
    if (me === meTarget) return;
    const step = () => setMe((m) => (m === meTarget ? m : (m + 1) % P));
    const wait = animUntilRef.current - (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (wait > 30) { const t = setTimeout(step, wait); return () => clearTimeout(t); }
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [meTarget, me]);
  // Report the settled view seat up so PlayApp can gate bot/auto moves on the rotation completing
  // (a bot can't play until the ring has actually reached its seat — see the play auto-move effect).
  React.useEffect(() => { if (onView) onView(me); }, [me, onView]);
  const ts = seatsAround(P, me);
  const totalDealt = pl.sizes.reduce((a, b) => a + b, 0);
  const deckCount = preDeal ? 52 : 52 - totalDealt - (phase === "discard" ? 0 : 1 + (pl.deckCard ? 1 : 0));
  const tableRef = React.useRef(null);
  const CW = Math.min(68, (Math.min(typeof window !== "undefined" ? window.innerWidth : 560, 560) - 62) / 6);

  // The show counts one owner at a time: their (face-up) hand or the crib, plus the cut.
  const info = showPhase ? computeShow(state) : null;
  const stepLabel = showPhase ? tr("play.show.step", { n: state.show.step + 1, m: state.show.order.length }) : "";
  // What each seat is holding (face down for the others): nothing before a hand is dealt;
  // during the discard, its current hand — the kept four once it has thrown, else the full
  // dealt hand; the kept four at the cut; the live peg hand during play; through the show the
  // same finished peg state (everyone's cards played and face up).
  const hands = peg ? peg.hands : seats.map((s) => (preDeal ? [] : (dealingPhase || discardPhase) ? (s.kept || s.dealt || []) : (s.kept || [])));
  const yourHand = hands[me];
  const turn = peg ? peg.turn : -1;
  const tapSelect = settings.tapToSelect;
  const cutter = (dealerIdx + P - 1) % P;
  const multiHuman = nHumans(P, settings) > 1;
  const meHuman = seatIsHuman(me, settings);               // false only in an all-bot (spectated) game
  const cribSoFar = seats.reduce((a, s) => a + (s.discard ? s.discard.length : 0), 0);   // cards thrown to the crib so far
  // The crib's stored home (left edge of the play area). It holds the 4 crib cards from the moment
  // they glide out of the discard banner, through the cut / play / show — EXCEPT while the crib
  // itself is being counted (then the cards are out at the showcrib panel, not in storage).
  const cribCounting = showPhase && state.show && state.show.order[state.show.step] === "CRIB";
  const cribStored = cribGliding || ((cutPhase || phase === "play" || showPhase) && !cribCounting);
  const cribHomeN = (crib && crib.length) ? crib.length : cribSoFar;

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

  // Which seat is the active/lit one, by phase (same rule the labels use).
  const activeSeat = (i) => overPhase ? teamOf(i, P, teams) === teamOf(winner, P, teams)
    : showPhase ? i === info.owner
    : discardPhase ? (i === me && myTurn)
    : cutdealPhase ? i === dealerIdx
    : turn === i;

  // Bots discard the instant they're dealt (in the reducer), but visually a bot should HOLD its
  // whole dealt hand for a beat after the deal lands, then throw to the crib. `botThrowReady` is
  // false from the deal until ~1s after it finishes; while false, each bot seat shows its full
  // dealt hand and the crib holds none of its cards. The human is unaffected (they throw by hand).
  const phaseTrackRef = React.useRef(phase);
  // The deal now finishes by going dealing -> discard (the last card pushed at finalize); the cut-for-deal
  // first hand still comes straight from cutdeal. Either lands in discard and means "the deal just ended".
  const dealJustHappened = phase === "discard" && (phaseTrackRef.current === "dealing" || phaseTrackRef.current === "cutdeal");
  const handEndJustHappened = phase === "deal" && phaseTrackRef.current === "show";   // the show just finished → swap the deck
  useEffect(() => { phaseTrackRef.current = phase; });
  const botThrowAtRef = React.useRef(0);
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  // Only the LAST card is still in flight when we reach discard (the rest were dealt one-by-one during
  // "dealing"), so the bots hold for that last card to land, then ~1s, then throw to the crib.
  if (dealJustHappened) botThrowAtRef.current = nowMs() + MOVE_DUR + 120 + 1000;
  const [, setBotTick] = React.useState(0);
  const botThrowReady = !(discardPhase && nowMs() < botThrowAtRef.current);

  // ---- the persistent card layer ------------------------------------------------------
  // For each card currently out of the deck, where it should sit and which way it faces.
  // place[id] = { group, idx, up }. Groups: "seat-i", "hand", "crib", "deck". The deck and
  // its top (where cards deal from and the starter turns) are anonymous backs (StarterDeck).
  const place = {};
  const seatCounts = {};                                    // how many ghost slots each seat needs
  if (cutdealPhase) {
    for (let i = 0; i < P; i++) { const d = dealDraw ? dealDraw[i] : null; if (d) { place[cardId(d)] = { group: "seat-" + i, idx: 0, up: true }; seatCounts[i] = 1; } else seatCounts[i] = 1; }
  } else if (!dealPhase) {
    for (let i = 0; i < P; i++) {
      const holding = discardPhase && !botThrowReady && seats[i].isAI;   // bot still holding its full hand
      const unplayed = (holding ? (seats[i].dealt || []) : (hands[i] || [])), played = peg ? peg.played[i] : [];
      const gridActive = i === me && meHuman && !needHandoff && (discardPhase || dealingPhase || (phase === "play" && peg));
      if (gridActive) {
        played.forEach((c, j) => { place[cardId(c)] = { group: "seat-" + i, idx: j, up: true }; });
        seatCounts[i] = played.length;
        // me's unplayed live in the interactive hand row (face up)
        unplayed.forEach((c, j) => { place[cardId(c)] = { group: "hand", idx: j, up: true }; });
      } else {
        unplayed.forEach((c, j) => { place[cardId(c)] = { group: "seat-" + i, idx: j, up: false }; });
        played.forEach((c, j) => { place[cardId(c)] = { group: "seat-" + i, idx: unplayed.length + j, up: true }; });
        seatCounts[i] = unplayed.length + played.length;
      }
    }
    // ---- the crib, persistent through its whole life ----
    // While it's being filled it sits at the discard banner ("crib"); once the cribbing glide
    // starts it moves to storage ("cribhome", a tucked stack at the top-right of the table) and
    // stays there through the cut, the play, and the show; when it's the crib's turn to be counted
    // it animates out to the scoring panel ("showcrib", face up). The same four card objects the
    // whole time — never destroyed and re-created. (A bot's card is withheld from the crib until
    // its post-deal throw beat, botThrowReady.)
    const showCribTurn = showPhase && info && info.isCrib;
    if (discardPhase || (cribbingPhase && !cribGliding)) {
      let k = 0;
      for (let i = 0; i < P; i++) {
        if (discardPhase && !botThrowReady && seats[i].isAI) continue;
        (seats[i].discard || []).forEach((c) => { place[cardId(c)] = { group: "crib", idx: k++, up: false }; });
      }
    } else if (cribbingPhase || cutPhase || phase === "play" || showPhase) {
      const cribCards = cribbingPhase ? [].concat.apply([], seats.map(function (s) { return s.discard || []; })) : (crib || []);
      const g = showCribTurn ? "showcrib" : "cribhome";
      cribCards.forEach((c, k) => { place[cardId(c)] = { group: g, idx: k, up: !!showCribTurn }; });
    }
    // the starter, turned at the cut, lives on the top of the deck face up
    if (starter && (phase === "play" || showPhase || overPhase)) place[cardId(starter)] = { group: "deck", idx: 0, up: true };
  }
  const handLen = (place && Object.values(place).filter((p) => p.group === "hand").length) || 0;
  const showcribN = Object.values(place).filter((p) => p.group === "showcrib").length;   // crib cards out for counting

  // homes[id] = {x,y,up,z} measured from the (invisible) ghost slots; sprites tween to these.
  const [homes, setHomes] = React.useState({});
  const homesRef = React.useRef({});
  const knownRef = React.useRef(new Set());
  const prevPlaceRef = React.useRef({});                    // each card's group/idx/up last render (to tell a gather from a crib hand-off)
  const delayRef = React.useRef({});                        // per-card transition-delay for its NEXT move (stagger)
  const sigRef = React.useRef("");
  const [deckShown, setDeckShown] = React.useState(deckCount);
  const deckTimers = React.useRef([]);
  const clearDeckTimers = () => { deckTimers.current.forEach(clearTimeout); deckTimers.current = []; };
  const [deckSwap, setDeckSwap] = React.useState(null);   // {offX,offY} while the old deck slides out / new slides in
  const dealPhaseRef = React.useRef(phase);               // previous phase, to spot the deal (preDeal → discard)
  const dealTimersRef = React.useRef([]);                 // the deal-timeline setTimeouts (cleared on re-trigger)
  const dealingRef = React.useRef(false);                 // true while the (legacy) deal timeline owns the card homes
  const swapUntilRef = React.useRef(0);                   // performance.now() when an in-flight post-show deck swap will have fully settled
  const gatherDealRef = React.useRef(false);              // true while the first-hand cut-for-deal cards are gathering into the deck
  const lastAdvancedRef = React.useRef(-1);               // the deal cursor we've already advanced from (so each push fires once)

  // THE DEAL DRIVER. Advance the incremental deal by one card, at most once per cursor value (so the
  // sprite's transitionend and the safety fallback can't double-fire). dispatch(DEAL_NEXT) pushes the
  // next card off the deck into its hand.
  const advanceDeal = (fromCursor) => {
    if (lastAdvancedRef.current === fromCursor) return;
    lastAdvancedRef.current = fromCursor;
    dispatch({ type: "DEAL_NEXT" });
  };
  // Kickoff (cursor 0, after any cut-for-deal gather) + a per-card FALLBACK. The primary gate for
  // cards after the first is the dealt sprite's onTransitionEnd (see the sprites below, which call
  // advanceDeal when the card lands); this timer only fires if that transitionend never arrives.
  React.useEffect(() => {
    if (!dealingPhase || !deal || deal.cursor >= deal.seq.length) return;
    const cursor = deal.cursor;
    const wait = cursor === 0 ? (gatherDealRef.current ? MOVE_DUR + 140 : 110) : MOVE_DUR + 260;
    const t = setTimeout(() => advanceDeal(cursor), wait);
    return () => clearTimeout(t);
  }, [dealingPhase, deal && deal.cursor]);

  // When the bots' hold beat ends (set on the deal -> discard transition) re-render so botThrowReady
  // flips true and their throws reach the crib.
  React.useEffect(() => {
    if (!discardPhase) return;
    const wait = botThrowAtRef.current - nowMs();
    if (wait <= 0) return;
    const t = setTimeout(() => setBotTick((x) => x + 1), wait + 30);
    return () => clearTimeout(t);
  }, [discardPhase]);

  // Re-measure every anchor when the viewport changes size (window resize, device rotation, an
  // on-screen keyboard). The homes effect below runs on each render and reads live geometry, so a
  // forced re-render is all that's needed to snap all card sprites — and the viewport-pinned crib —
  // to their new anchor positions.
  const [, bumpViewport] = React.useState(0);
  React.useEffect(() => {
    const onResize = () => bumpViewport((t) => t + 1);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("orientationchange", onResize); };
  }, []);

  React.useLayoutEffect(() => {
    const root = tableRef.current; if (!root) return;
    // A deal is in flight: its timeline solely owns the card homes (mounting each card on the
    // deck, then flying it to its seat). Bail out of every other run so a mid-deal layout shift
    // — e.g. the deck column resizing during the swap — can't fall through to the default path
    // and snap the still-flying cards into their seats at once (the pop-in bug).
    if (dealingRef.current) return;
    const rootR = root.getBoundingClientRect();
    const fanX = (host, j) => { const kid = host.children[j]; if (!kid) return null; const r = kid.getBoundingClientRect(); return { x: r.left - rootR.left, y: r.top - rootR.top }; };
    const deckEl = root.querySelector("[data-decktop]");
    const deckR = deckEl ? deckEl.getBoundingClientRect() : null;
    const deckTop = deckR ? { x: deckR.left - rootR.left, y: deckR.top - rootR.top } : { x: 0, y: 0 };
    // The deck top re-read LIVE. A deal can fire while a post-show swap is still mid-slide, so the
    // deckTop captured above would be stale (off-centre); the deal mounts each card on the deck at
    // fire time (after the swap has settled), when this returns the real, settled position.
    const liveDeckTop = () => { const el = root.querySelector("[data-decktop]"); if (!el) return deckTop; const r = el.getBoundingClientRect(), rr = root.getBoundingClientRect(); return { x: r.left - rr.left, y: r.top - rr.top }; };
    // Off-screen parking for the deck swap: far enough left/up that the deck is fully gone.
    // Slide the old/new deck out the side toward the top — but keep it BELOW the score banner
    // (the banner now sits above the card layer, so anything pushed up to negative y would hide
    // behind it). deckOut.y stays a small positive value (near the table top), off the left edge.
    const swapOffX = rootR.width, swapOffY = Math.max(20, deckTop.y - 8);
    const swapDeckOut = { x: deckTop.x - swapOffX, y: deckTop.y - swapOffY };   // top-left, off the edge, below the banner
    // Schedule the SEQUENTIAL deck swap: at `startAt` the old deck (and its consolidated cards)
    // slides fully off to the upper-left and is deleted; then an empty beat with nothing on screen;
    // then a fresh deck slides in from the upper-right. Returns when the new deck has settled.
    const scheduleDeckSwap = (oldCards, startAt) => {
      dealTimersRef.current.push(setTimeout(() => {                 // OUT: old deck + its cards slide off upper-left
        setDeckSwap({ phase: "out", offX: swapOffX, offY: swapOffY });
        const r = { ...homesRef.current };
        for (const id of oldCards) r[id] = { x: swapDeckOut.x, y: swapDeckOut.y, up: false, z: 62 };
        homesRef.current = r; setHomes(r);
      }, startAt));
      dealTimersRef.current.push(setTimeout(() => {                 // old fully off → delete its cards; empty beat
        const r = { ...homesRef.current }; oldCards.forEach((id) => { delete r[id]; delete delayRef.current[id]; });
        homesRef.current = r; setHomes(r);
        setDeckSwap({ phase: "empty", offX: swapOffX, offY: swapOffY });
      }, startAt + SWAP_DUR));
      dealTimersRef.current.push(setTimeout(() => setDeckSwap({ phase: "in", offX: swapOffX, offY: swapOffY }), startAt + SWAP_DUR + EMPTY_DUR));   // IN
      dealTimersRef.current.push(setTimeout(() => setDeckSwap(null), startAt + 2 * SWAP_DUR + EMPTY_DUR));                                          // settled
      return startAt + 2 * SWAP_DUR + EMPTY_DUR;
    };
    // resolve each card's target home from its ghost slot
    const targets = {};
    for (const id in place) {
      const p = place[id];
      let pos = null;
      if (p.group === "deck") pos = deckTop;
      else { const host = root.querySelector(`[data-slot="${p.group}"]`); if (host) pos = fanX(host, p.idx); }
      if (!pos) pos = deckTop;
      // crib cards (crib/cribhome/showcrib) float above the hands so they read clearly when they
      // glide in front of them; the score banner (raised z) still covers them when they're tucked.
      const cribZ = (p.group === "crib" || p.group === "cribhome" || p.group === "showcrib") ? 50 : 0;
      targets[id] = { x: pos.x, y: pos.y, up: p.up, z: 10 + p.idx + cribZ + (p.group === "hand" ? 30 : p.group === "deck" ? 60 : 0) };
    }
    const nowKnown = new Set(Object.keys(targets));
    const prevKnown = knownRef.current;
    const newCards = Object.keys(targets).filter((id) => !prevKnown.has(id));
    const goneCards = [...prevKnown].filter((id) => !nowKnown.has(id));

    const round = (h) => `${Math.round(h.x)},${Math.round(h.y)},${h.up ? 1 : 0},${h.z}`;
    const sig = Object.keys(targets).sort().map((id) => id + ":" + round(targets[id])).join("|") + "#" + goneCards.sort().join(",");
    if (sig === sigRef.current && !newCards.length && !goneCards.length) return;
    sigRef.current = sig;
    // mark how long this sweep will take, so the ring rotation (the view's seat change) can wait
    // for it to finish before it starts — a deal/gather staggers, a single move/flip does not.
    const sweep = Math.max(newCards.length, goneCards.length, 1);
    animUntilRef.current = (typeof performance !== "undefined" ? performance.now() : Date.now()) + (sweep - 1) * CARD_STAGGER + MOVE_DUR + 80;
    const phaseAtLast = dealPhaseRef.current;              // previous (meaningful) phase, for the deal sequence below
    dealPhaseRef.current = phase;

    // gone cards all sweep back into the deck (the gather). The crib is now persistent — it never
    // becomes "gone" mid-hand (it just moves crib → cribhome → showcrib) — so there's no separate
    // vanish path; it only leaves at the end of the hand, with everything else.
    const prevPlace = prevPlaceRef.current;
    const gatherGone = goneCards;

    // Deal order follows the DECK itself: each card ranks by its position from the top of the
    // shuffled deck (state.deck). Because the reducer dealt round-robin off the top, deck order
    // already is pone-first, clockwise, one card per seat per pass — so dealing in deck order
    // replays the real deal exactly, each flown card being the genuine next card off the top.
    const deckOrder = {};
    (state.deck || []).forEach((c, i) => { deckOrder[cardId(c)] = i; });
    const dealRank = (id) => (deckOrder[id] != null ? deckOrder[id] : 9999);

    // ============ THE INCREMENTAL DEAL ============
    // The reducer pushes ONE card per DEAL_NEXT (the deal driver gates each push on the previous
    // card's transitionend). Each render here: any leftover cards (the cut-for-deal draws, first hand
    // only) gather back into the deck, the just-pushed card mounts on the deck and flies to its seat,
    // and the deck thins by one. We own the homes and skip the default flow / the legacy timeline.
    if (dealingPhase) {
      for (const id in delayRef.current) delayRef.current[id] = 0;
      const render = {};
      for (const id in targets) render[id] = newCards.includes(id) ? { x: deckTop.x, y: deckTop.y, up: false, z: 60 } : targets[id];
      for (const id of gatherGone) render[id] = { x: deckTop.x, y: deckTop.y, up: false, z: 60 };   // cut-for-deal cards sweep home
      knownRef.current = nowKnown;
      prevPlaceRef.current = { ...place };
      homesRef.current = render; setHomes(render);
      setDeckShown(Math.max(1, 52 - dealCursor));        // thins one per dealt card (starter/filler still inside)
      gatherDealRef.current = gatherGone.length > 0;     // tell the driver whether a cut-for-deal gather is running
      if (newCards.length) {                              // a frame later the new card flies off the deck to its seat
        requestAnimationFrame(() => requestAnimationFrame(() => {
          homesRef.current = { ...homesRef.current, ...targets };
          setHomes(homesRef.current);
        }));
      }
      if (gatherGone.length) {                            // drop the gathered cut-for-deal cards once they reach the deck
        const drop = gatherGone.slice();
        setTimeout(() => { const next = { ...homesRef.current }; drop.forEach((id) => delete next[id]); homesRef.current = next; setHomes(next); }, MOVE_DUR + 80);
      }
      return;
    }

    // ============ THE DEAL: one explicit sequence — consolidate → deck swap → deal → rotate ============
    // (LEGACY — the all-at-once deal timeline. The incremental flow above now owns dealing; this stays
    // inert because phase goes deal → dealing → discard, so phaseAtLast is never "deal"/"cutdeal" here.)
    const isDeal = (phaseAtLast === "deal" || phaseAtLast === "cutdeal") && phase === "discard" && newCards.length > 1;
    if (isDeal) {
      dealingRef.current = true;                                     // lock out every other effect run until the deal lands
      const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const oldCards = [...prevKnown];                                // every card on the table (the cut-for-deal draws; empty on inter-hand deals)
      const dealList = Object.keys(targets);                          // the new hand
      const swap = oldCards.length > 0;                              // swap the deck at the deal only on the FIRST hand (cut-for-deal); inter-hand decks were already swapped at the end of the show
      const swapRemaining = Math.max(0, swapUntilRef.current - t0);  // time left on a still-running post-show deck swap
      const interHandWait = !swap && swapRemaining > 0;             // deal pressed mid-swap: let the new deck finish sliding in, THEN deal — don't cancel it
      const GATHER_DUR = swap ? MOVE_DUR + 80 : 0;                   // step 1 (consolidate) only when there are cut-for-deal cards
      const dealSpan = (dealList.length - 1) * CARD_STAGGER + MOVE_DUR + 80;
      const ordered = dealList.slice().sort((a, b) => dealRank(a) - dealRank(b));   // pone-first, round-robin

      // STEP 1 (now): every cut-for-deal card slides into the centre deck together (from its seat).
      // The new hand is NOT shown yet — it stays "in" the deck until it's dealt.
      for (const id in delayRef.current) delayRef.current[id] = 0;
      const r0 = {};
      for (const id of oldCards) r0[id] = { x: deckTop.x, y: deckTop.y, up: false, z: 60 };
      knownRef.current = nowKnown;
      prevPlaceRef.current = { ...place };
      // freeze the stable post-deal signature so the timeline's setHomes re-renders early-return
      sigRef.current = Object.keys(targets).sort().map((id) => id + ":" + round(targets[id])).join("|") + "#";
      // A post-show deck swap still in flight OWNS the deck + its timers — leave it running and just
      // delay the deal until it settles. Otherwise (first hand / no pending swap) reset the homes +
      // deck and drop any stale deal timers as usual.
      if (!interHandWait) {
        homesRef.current = r0; setHomes(r0);
        setDeckShown(52);
        dealTimersRef.current.forEach(clearTimeout); dealTimersRef.current = [];
      }
      // STEP 2: the sequential deck swap (first hand only — old out, empty beat, new in). The deal
      // begins once the new deck has fully settled — either the swap we kick off here (first hand)
      // or the in-flight post-show swap we wait out (swapRemaining).
      const dealStart = swap ? scheduleDeckSwap(oldCards, GATHER_DUR) : swapRemaining;
      animUntilRef.current = t0 + dealStart + dealSpan + 120;   // the ring rotation waits for the WHOLE sequence
      botThrowAtRef.current = animUntilRef.current + 1000;       // bots hold their hands, then throw to the crib 1s after the deal lands
      dealTimersRef.current.push(setTimeout(() => setBotTick((x) => x + 1), dealStart + dealSpan + 120 + 1000));   // release the bots' throw
      // STEP 3: deal the new hand ONE CARD AT A TIME off the fresh deck, pone-first round-robin.
      // Card k appears on the centre deck (face down) at dealStart + k·stagger, then a frame later
      // flies to its seat. Each card is its OWN element on its OWN timer, so the mount-on-deck and
      // fly-to-seat commits can never collapse into one — the deck→seat tween is always real and no
      // card ever pops into a seat out of nowhere. The deck thins by one as each card leaves.
      clearDeckTimers();
      ordered.forEach((id, k) => {
        dealTimersRef.current.push(setTimeout(() => {
          delayRef.current[id] = 0;
          const dt = liveDeckTop();                                  // settled deck position (the swap, if any, has finished)
          const r = { ...homesRef.current };
          r[id] = { x: dt.x, y: dt.y, up: false, z: 60 };   // appears ON the deck
          homesRef.current = r; setHomes(r);
          requestAnimationFrame(() => requestAnimationFrame(() => {    // a frame later, off it flies
            const r2 = { ...homesRef.current };
            r2[id] = targets[id];
            homesRef.current = r2; setHomes(r2);
            setDeckShown((v) => Math.max(deckCount, v - 1));
          }));
        }, dealStart + k * CARD_STAGGER));
      });
      // Release the lock once the last card has reached its seat; from here normal effect runs
      // (the bots' throw to the crib, etc.) resume. Bump a tick so the effect re-runs once to
      // reconcile anything that changed while the lock was held.
      dealTimersRef.current.push(setTimeout(() => { dealingRef.current = false; setBotTick((x) => x + 1); }, dealStart + dealSpan));
      return;   // STEP 4 (rotate) is handled by the me-lag reading animUntilRef above
    }

    // ============ END OF HAND: the same visible deck swap as the deal, in reverse ============
    // When the show finishes, every card still on the table slides into the centre deck together,
    // that deck slides off to the upper-left and is deleted, and a fresh deck slides in from the
    // upper-right — ready for the next deal (no cards teleport away).
    if (handEndJustHappened && goneCards.length > 0) {
      const oldCards = [...prevKnown];                       // every card the hand left on the table
      const GATHER_DUR = MOVE_DUR + 80;
      for (const id in delayRef.current) delayRef.current[id] = 0;
      const r0 = {};
      for (const id of oldCards) r0[id] = { x: deckTop.x, y: deckTop.y, up: false, z: 60 };   // consolidate to the centre deck
      knownRef.current = new Set();                          // table is empty after the swap; the next deal re-creates the cards
      prevPlaceRef.current = {};
      homesRef.current = r0; setHomes(r0);
      sigRef.current = "#";                                  // deal phase has no cards → stable, so the timeline isn't clobbered
      setDeckShown(52);
      dealTimersRef.current.forEach(clearTimeout); dealTimersRef.current = [];
      // sequential swap: old deck out → empty beat → new deck in. Restore the deck thickness when it settles.
      const settleAt = scheduleDeckSwap(oldCards, GATHER_DUR);
      swapUntilRef.current = (typeof performance !== "undefined" ? performance.now() : Date.now()) + settleAt;   // a deal pressed before this finishes waits for the new deck
      dealTimersRef.current.push(setTimeout(() => setDeckShown(deckCount), settleAt));
      animUntilRef.current = (typeof performance !== "undefined" ? performance.now() : Date.now()) + settleAt + 120;
      return;
    }

    // DELAY = how long after the sweep begins each card starts to move. The DEFAULT is 0 for
    // every card, so a rotation / handoff / throw / play moves each whole hand as ONE unit (all
    // its cards travel together, never strung out into a diagonal). Only two sweeps stagger:
    //  - the DEAL: one card at a time, dealt round-robin starting at the player left of the
    //    dealer (the pone), exactly like a real deal.
    //  - the end-of-hand GATHER: cards sweep back into the deck one after another.
    for (const id in targets) delayRef.current[id] = 0;
    for (const id of goneCards) delayRef.current[id] = 0;
    if (newCards.length > 1) {
      const ordered = newCards.slice().sort((a, b) => dealRank(a) - dealRank(b));
      ordered.forEach((id, k) => { delayRef.current[id] = k * CARD_STAGGER; });
    }
    if (gatherGone.length > 1) gatherGone.forEach((id, k) => { delayRef.current[id] = k * CARD_STAGGER; });

    const render = {};
    for (const id in targets) {
      if (newCards.includes(id)) render[id] = { x: deckTop.x, y: deckTop.y, up: false, z: 60 };   // enter from the deck
      else render[id] = targets[id];
    }
    for (const id of gatherGone) render[id] = { x: deckTop.x, y: deckTop.y, up: false, z: 60 };    // sweep back to the deck

    knownRef.current = nowKnown;
    prevPlaceRef.current = { ...place };
    homesRef.current = render;
    setHomes(render);

    // deck thickness ticks with the sweep so it thins/thickens card-by-card, not all at once
    clearDeckTimers();
    if (newCards.length > 1) {                              // a deal: thin the deck card-by-card as each leaves
      setDeckShown((v) => Math.max(deckCount, v));
      newCards.forEach((id, k) => deckTimers.current.push(setTimeout(() => setDeckShown((v) => Math.max(deckCount, v - 1)), k * CARD_STAGGER + 40)));
    } else if (gatherGone.length > 1) {                     // a gather: thicken the deck as each lands back
      gatherGone.forEach((id, k) => deckTimers.current.push(setTimeout(() => setDeckShown((v) => Math.min(52, v + 1)), k * CARD_STAGGER + MOVE_DUR)));
    } else {
      setDeckShown(deckCount);
    }

    if (newCards.length) {                                  // next frame, send the entering cards out to their homes
      requestAnimationFrame(() => requestAnimationFrame(() => {
        homesRef.current = { ...homesRef.current, ...targets };
        setHomes(homesRef.current);
      }));
    }
    if (gatherGone.length) {                                // drop the gathered cards once they've reached the deck
      const drop = gatherGone.slice();
      setTimeout(() => {
        const next = { ...homesRef.current }; drop.forEach((id) => delete next[id]);
        homesRef.current = next; setHomes(next);
        drop.forEach((id) => { delete delayRef.current[id]; });
      }, (gatherGone.length - 1) * CARD_STAGGER + MOVE_DUR + 80);
    }
  });

  // Hot-seat ring rotation: when the active player changes, each seat's LABEL glides to its new
  // grid spot (FLIP). Only the label moves — the card ghosts stay put so sprite measurement is
  // never corrupted; the cards themselves glide because their seat ghost moved to a new cell.
  const labelEls = React.useRef({});
  const labelPos = React.useRef({});
  const labelBusy = React.useRef({});
  const [rotating, setRotating] = React.useState(false);
  const rotTimer = React.useRef(null);
  React.useLayoutEffect(() => {
    let moved = false;
    for (const i in labelEls.current) {
      const el = labelEls.current[i]; if (!el || labelBusy.current[i]) continue;
      const r = el.getBoundingClientRect();
      const cur = { x: r.left, y: r.top }, old = labelPos.current[i];
      labelPos.current[i] = cur;
      if (multiHuman && old && (Math.abs(old.x - cur.x) > 1 || Math.abs(old.y - cur.y) > 1)) {
        labelBusy.current[i] = true; moved = true;
        el.style.transition = "none";
        el.style.transform = `translate(${old.x - cur.x}px, ${old.y - cur.y}px)`;
        const key = i, node = el;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          node.style.transition = `transform ${MOVE_DUR}ms cubic-bezier(.4,0,.2,1)`;
          node.style.transform = "none";
          setTimeout(() => { labelBusy.current[key] = false; }, MOVE_DUR + 40);
        }));
      }
    }
    if (moved) { setRotating(true); if (rotTimer.current) clearTimeout(rotTimer.current); rotTimer.current = setTimeout(() => setRotating(false), MOVE_DUR + 80); }
  });

  // One seat: the label (glides on rotation) over a hidden ghost fan that just reserves space
  // and positions the persistent sprites. The cards themselves are drawn in the sprite layer.
  const cell = (i) => {
    const n = seatCounts[i] || 0;
    return (
      <div key={i} style={{ textAlign: "center", minWidth: 0, opacity: activeSeat(i) || i === me ? 1 : 0.7 }}>
        <div ref={(el) => { labelEls.current[i] = el; }} style={{ height: 18, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
          <SeatLabel i={i} dealerIdx={dealerIdx} active={activeSeat(i)} settings={settings} me={me} />
        </div>
        <div data-slot={"seat-" + i} style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", height: "var(--ch)", visibility: "hidden" }}>
          <SlotGhost n={n} vis={BACK_VISIBLE} />
        </div>
      </div>
    );
  };

  // The card currently in flight off the deck (the just-pushed one). When its move ends, the deal
  // driver pushes the next card — this is the transitionend gate the whole incremental deal rides on.
  const dealingCardId = (dealingPhase && deal && deal.cursor > 0 && state.deck[deal.cursor - 1]) ? cardId(state.deck[deal.cursor - 1]) : null;
  // the persistent sprites: one per card on the table, positioned/faced by `homes`
  const sprites = Object.keys(homes).map((id) => {
    const c = CARD_BY_ID[id]; if (!c) return null;
    const h = homes[id];
    const p = place[id];
    const inHand = p && p.group === "hand";
    const handIdx = inHand ? p.idx : -1;
    const legal = inHand ? isLegal(yourHand[handIdx]) : false;
    const chosen = inHand && (pending ? (pendIdxs && pendIdxs.includes(handIdx)) : sel.includes(handIdx));
    const clickable = inHand && (pending ? true : (myTurn && legal));
    return <CardSprite key={id} card={c} home={h} dur={MOVE_DUR} delay={delayRef.current[id] || 0}
      clickable={clickable}
      selected={inHand && !tapSelect && chosen}
      raised={inHand && tapSelect && chosen}
      dim={inHand && !pending && !legal && (discardPhase ? false : turn === me)}
      selLabel={inHand && !discardPhase ? tr("play.sel.play") : undefined}
      onLanded={id === dealingCardId ? () => advanceDeal(deal.cursor) : undefined}
      onClick={inHand ? () => tapCard(handIdx) : undefined} />;
  });

  return (
    <div ref={tableRef} style={{ position: "relative", marginTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* the persistent card layer floats above the (invisible) ghost slots */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "none" }}>
          {sprites}
        </div>
      </div>
      {/* The crib's stored home: a vertical stack parked 75% off the LEFT edge of the VIEWPORT (only
          the right 25% shows) and centred vertically on the PLAY SCREEN (the table). Absolute inside
          the table: top:50% centres it on the table's height, while `50% - 50vw` still resolves to
          the viewport's left edge (the table is horizontally centred), so the −0.75·cw nudge parks
          the card 75% off-screen-left on any size. The pile's top card sits at the bottom, deeper
          cards above it (80% overlap). The crib sprites measure these footprints (re-measured on
          viewport resize) and tuck here. */}
      {cribStored && cribHomeN > 0 && (
        <div data-slot="cribhome" style={{
          position: "absolute", left: "calc(50% - 50vw - var(--cw) * 0.75)", top: "50%", transform: "translateY(-50%)",
          width: "var(--cw)", height: `calc(var(--ch) * ${1 + (cribHomeN - 1) * CRIB_HOME_VISIBLE})`,
          visibility: "hidden", pointerEvents: "none",
        }}>
          <SlotGhostV n={cribHomeN} vis={CRIB_HOME_VISIBLE} />
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
          <div style={{ height: 18, marginBottom: 4, display: "flex", alignItems: "center", fontFamily: mono, fontSize: 10, color: T.muted }}>{(phase === "play" || showPhase || overPhase) ? tr("play.starterCard") : tr("play.deck")}</div>
          <div data-slot="deck" style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", height: "var(--ch)" }}>
            {deckSwap
              ? (deckSwap.phase === "empty" ? null
                : <DeckSwapView key={deckSwap.phase} phase={deckSwap.phase} offX={deckSwap.offX} offY={deckSwap.offY} count={Math.max(1, deckShown)} />)
              : <StarterDeck starter={null} count={Math.max(1, deckShown)} topEmpty={!!(starter && (phase === "play" || showPhase || overPhase))} />}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>{ts.right != null ? cell(ts.right) : null}</div>
      </div>

      {/* your own seat at the bottom — rendered through the very same cell() as the others. */}
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
      ) : (dealPhase || dealingPhase) ? (
        <Panel tone={cribOurs ? "good" : null}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{isDealer ? tr("play.deal.yours") : teammateDeals ? tr("play.deal.teammate", { seat: seatName(dealerIdx) }) : tr("play.deal.theirs", { seat: seatName(dealerIdx) })}</div>
          <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 3 }}>{dealBlurb(P)}</div>
        </Panel>
      ) : showPhase ? (
        info.isCrib ? (
          // the crib has no seat — the persistent crib cards animate out of storage to here (the
          // showcrib ghost just reserves the slots; the real cards are the sprites, face up).
          <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px", minHeight: 88, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{tr("play.show.entCounting", { ent: entText(info), step: stepLabel })}</span>
            <div data-slot="showcrib" style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", height: "var(--ch)", visibility: "hidden" }}>
              <SlotGhost n={Math.max(showcribN, (info.cards || []).length)} vis={STACK_VISIBLE} />
            </div>
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
      ) : (discardPhase || cribbingPhase) ? (
        // The crib banner stays up through the whole cribbing phase, INCLUDING the glide to its
        // tucked home — it clears only once the crib is actually stored (the cut phase). The crib
        // cards leave the banner (to CribHome) once gliding, so the ghost shows only before then.
        <Panel tone={cribOurs ? "good" : "red"}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, minWidth: 0 }}>{multiHuman ? tr("play.crib.seatPrefix", { seat: seatName(me) }) : ""}{isDealer ? tr("play.crib.greedy") : teammateDeals ? tr("play.crib.teamGreedy", { seat: seatName(dealerIdx) }) : tr("play.crib.defend", { seat: seatName(dealerIdx) })}</div>
            {cribSoFar > 0 && !cribGliding && (
              <div data-slot="crib" style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-end", visibility: "hidden" }}>
                <SlotGhost n={cribSoFar} vis={BACK_VISIBLE} />
              </div>
            )}
          </div>
        </Panel>
      ) : cutPhase ? null : (
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
        // Manual cut: always a deliberate tap that turns the starter — you cut it yourself, or you
        // tap to turn it on a bot cutter's behalf. (Auto-cut skips straight past this phase.)
        bigBtn(seatIsHuman(cutter, settings) ? tr("play.btn.cutFor", { seat: seatName(dealerIdx) }) : tr("play.cutMsg", { seat: seatName(cutter) }), () => dispatch({ type: "CUT" }), "wood")
      ) : cribbingPhase ? null : (transitioning || rotating) ? null : needHandoff ? <PassPanel to={discardPhase ? me : peg.turn} dispatch={dispatch} locked={rotating} /> : (
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
            // The confirm button doubles as the prompt: disabled "Select a card…" until a full
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
        {/* The interactive hand: a hidden ghost row reserving the slots; the actual face-up,
            tappable cards are the persistent sprites positioned over it. */}
        {meHuman && (
          <div data-slot="hand" className={discardPhase ? "dealwrap" : undefined} style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "nowrap", height: "var(--ch)", visibility: "hidden" }}>
            {Array.from({ length: handLen }).map((_, i) => <div key={i} style={{ width: "var(--cw)", flex: "0 0 auto" }} />)}
          </div>
        )}
        {meHuman && !discardPhase && yourHand.length === 0 && <div style={{ textAlign: "center", marginTop: -8 }}><span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{tr("play.handEmpty")}</span></div>}
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
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "14px 16px 4px", maxWidth: 420, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 14px 44px rgba(0,0,0,0.55)" }}>
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
