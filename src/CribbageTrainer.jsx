import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ============================================================
   VERIFIED CRIBBAGE ENGINE
   scoreInto: accumulates category points [15s,pairs,runs,flush,nobs]
   (unit-tested: perfect 29 -> 16/12/0/0/1; locked 4556 -> 12)
   ============================================================ */
// Global game speed (shared with the Play game via settings.speed). `SPEED` is set from the setting
// at the top of the root component's render; `spd(ms)` scales any animation duration: slow 2×,
// normal 1× (unchanged), fast ½×, lightning a flat 32 ms, instant a flat 0 ms (spd(0) passes through).
const SPEED_MULT = { slow: 2, normal: 1, fast: 0.5 };
const SPEED_FLAT = { lightning: 32, instant: 0 };
let SPEED = "normal";
function spd(ms) { if (ms <= 0) return ms; const flat = SPEED_FLAT[SPEED]; return flat != null ? flat : Math.round(ms * (SPEED_MULT[SPEED] ?? 1)); }

// Global text-size floor (shared with landing + Play): every font-size is `max(<px>px, var(--min-fs,
// 0px))`, so raising `--min-fs` (set on the app root from settings.textSize) grows only sub-floor
// text. small = current sizing (0 floor); medium/large lift the minimum.
const MIN_FS = { small: "0px", medium: "12px", large: "14px", xlarge: "16px" };




function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function handDetail(four, dealt5) {
  const deck = deckExcluding(dealt5);
  const acc = [0, 0, 0, 0, 0];
  let total = 0, sq = 0, mn = 99, mx = 0;
  const byRank = {};
  const vals = [];
  for (const st of deck) {
    const t = scoreInto(four, st, false, acc);
    total += t; sq += t * t; if (t < mn) mn = t; if (t > mx) mx = t; vals.push(t);
    const b = byRank[st.r] || (byRank[st.r] = { sum: 0, n: 0 });
    b.sum += t; b.n++;
  }
  const n = deck.length;
  const ev = total / n;
  const sd = Math.sqrt(Math.max(0, sq / n - ev * ev));
  vals.sort((a, b) => a - b);
  const locked = lockedFour(four);
  const top = Object.keys(byRank)
    .map((r) => ({ r: +r, avg: byRank[r].sum / byRank[r].n, p: byRank[r].n / n }))
    .sort((a, b) => b.avg - a.avg).slice(0, 3);
  return { ev, sd, mn, mx, p10: vals[(n * 0.1) | 0], p90: vals[(n * 0.9) | 0], cats: acc.map((x) => x / n), locked, fromCut: ev - locked, top };
}

/* Role-split empirical discard distributions from a fixed-point self-play
   calibration (10,000 hands per pass, roles at the true 1-in-4 dealer rate).
   Index 0=A .. 12=K. DEALER = cards thrown into one's OWN crib; DEFENDER =
   cards surrendered to an opponent's crib. Crib composition: your crib draws
   3 defender throws; the dealer's crib (when you defend) draws 1 dealer throw
   + 2 defender throws. Suits uniform within a rank; the cut stays uniform.
   [final: averaged over calibration passes 2-3 to cancel Monte-Carlo noise] */
const DEALER_DISCARD_PROBS = [0.0639, 0.08325, 0.09032, 0.05659, 0.07681, 0.06226, 0.08103, 0.0937, 0.06772, 0.04889, 0.09511, 0.07993, 0.10046];
const DEFENDER_DISCARD_PROBS = [0.09388, 0.06719, 0.04547, 0.04428, 0.00398, 0.06537, 0.0818, 0.08531, 0.08712, 0.09632, 0.0411, 0.11445, 0.17376];
const cumOf = (p) => { const c = []; let s = 0; for (const x of p) { s += x; c.push(s); } return c; };
const DEALER_CUM = cumOf(DEALER_DISCARD_PROBS);
const DEFENDER_CUM = cumOf(DEFENDER_DISCARD_PROBS);
function pickWeightedRank(rng, cum) {
  const u = rng() * cum[12];
  for (let i = 0; i < 13; i++) if (u <= cum[i]) return i + 1;
  return 13;
}

function cribDetail(discards, dealt, N, rng, cribIsOurs, players, teams) {
  const pool = deckExcluding(dealt);
  const suitsByRank = Array.from({ length: 14 }, () => []);
  for (const c of pool) suitsByRank[c.r].push(c.s);
  // The crib holds 4 cards: your discard(s) + the other throwers' cards (+ in 3-handed
  // one uniform deck card). Each OTHER crib card comes from a player throwing to *help*
  // the dealer's crib (DEALER intent) if they're on the dealer's team, or junk
  // (DEFENDER) otherwise. So nDealer = throwers on the dealer's team, minus you when the
  // crib is on your team. teamSize = players/teams (equal teams); the dealer throws in
  // 2-/3-/4-handed but NOT in 5-/6-handed (dealt 4). Heads-up is special — the lone
  // opponent throws both of the other crib cards.
  const nUniform = players === 3 ? 1 : 0; // deck card dealt straight into the crib
  const nThrows = 4 - discards.length - nUniform; // opponent throws to simulate
  const teamSize = players / teams;
  const dealerThrows = players <= 4;
  const D = Math.max(0, teamSize - (dealerThrows ? 0 : 1)); // throwers on the dealer's team
  let nDealer = players === 2 ? (cribIsOurs ? 0 : nThrows) : Math.max(0, D - (cribIsOurs ? 1 : 0));
  nDealer = Math.min(nDealer, nThrows);
  const weighted = new Array(nDealer).fill(DEALER_CUM).concat(new Array(nThrows - nDealer).fill(DEFENDER_CUM));
  const acc = [0, 0, 0, 0, 0];
  let total = 0, sq = 0, hits = 0;
  const used = new Set();
  const drawUniform = () => { // a uniform unused card from the live deck (deck-crib card or the cut)
    for (let t = 0; t < 80; t++) { const c = pool[(rng() * pool.length) | 0]; if (!used.has(c.r * 4 + c.s)) { used.add(c.r * 4 + c.s); return c; } }
    return pool[0];
  };
  for (let k = 0; k < N; k++) {
    used.clear();
    const draw = discards.slice(); // your known card(s) are always in the crib
    for (let d = 0; d < weighted.length; d++) {
      let card = null;
      for (let tries = 0; tries < 48 && !card; tries++) {
        const r = pickWeightedRank(rng, weighted[d]);
        const suits = suitsByRank[r];
        if (!suits.length) continue;
        const free = suits.filter((s) => !used.has(r * 4 + s));
        if (!free.length) continue;
        const s = free[(rng() * free.length) | 0];
        card = { r, s }; used.add(r * 4 + s);
      }
      if (!card) card = drawUniform(); // rare fallback (rank exhausted): take any remaining card
      draw.push(card);
    }
    for (let u = 0; u < nUniform; u++) draw.push(drawUniform()); // deck card into the crib (3-handed)
    const starter = drawUniform(); // the cut is uniform, not a discard
    const t = scoreInto([draw[0], draw[1], draw[2], draw[3]], starter, true, acc);
    total += t; sq += t * t; if (t > 0) hits++;
  }
  const ev = total / N;
  return { ev, sd: Math.sqrt(Math.max(0, sq / N - ev * ev)), cats: acc.map((x) => x / N), hitRate: hits / N };
}

/* ===== Pegging (play phase) ===== suits are irrelevant, so cards are ranks 1..13.
   Scoring mechanics unit-tested (15s, 31s, pair royals, in/out-of-order runs,
   gos, last card). Opponents play a greedy point-grabbing policy with light
   defense, so the pegging term is an estimate of play-phase value, not exact. */
function playPegging(hands, dealerIdx) {
  hands = hands.map((h) => h.slice());
  const P = hands.length; // 3- or 4-handed; derived so the loop is seat-count agnostic
  const pts = new Array(P).fill(0);
  let turn = (dealerIdx + 1) % P, count = 0, pile = [], passes = 0, last = -1;
  let remaining = hands.reduce((s, h) => s + h.length, 0);
  while (remaining > 0) {
    const hand = hands[turn];
    const legal = hand.filter((c) => pval(c) + count <= 31);
    if (legal.length === 0) {
      if (++passes >= P) { if (last >= 0 && count !== 31) pts[last] += 1; count = 0; pile = []; passes = 0; last = -1; }
      turn = (turn + 1) % P; continue;
    }
    const card = pegChoose(legal, count, pile, hand);
    hand.splice(hand.indexOf(card), 1); remaining--;
    count += pval(card); pile.push(card);
    pts[turn] += pegScore(pile, count); last = turn; passes = 0;
    if (count === 31) { count = 0; pile = []; last = -1; }
    turn = (turn + 1) % P;
  }
  if (last >= 0) pts[last] += 1;
  return pts;
}
function pegDetail(four, dealt5, N, rng, youDeal, players) {
  const pool = deckExcluding(dealt5);
  const ourR = four.map((c) => c.r);
  const dealerSeat = players - 1;       // dealer sits last — the best pegging seat
  const oppCards = (players - 1) * 4;    // every other player holds 4 cards after discard
  let total = 0, sq = 0;
  for (let k = 0; k < N; k++) {
    const seen = new Set(); const opp = [];
    while (opp.length < oppCards) { const i = (rng() * pool.length) | 0; if (!seen.has(i)) { seen.add(i); opp.push(pool[i].r); } }
    const ourSeat = youDeal ? dealerSeat : (rng() * (players - 1)) | 0;
    const hands = Array.from({ length: players }, () => []); hands[ourSeat] = ourR.slice();
    let oi = 0; for (let s = 0; s < players; s++) { if (s === ourSeat) continue; hands[s] = opp.slice(oi, oi + 4); oi += 4; }
    const p = playPegging(hands, dealerSeat)[ourSeat];
    total += p; sq += p * p;
  }
  const ev = total / N;
  return { ev, sd: Math.sqrt(Math.max(0, sq / N - ev * ev)) };
}

// Index sets of cards to discard: 1-of-N for 3-/4-handed, all 2-card combos heads-up.
function discardCombos(handLen, k) {
  const out = [];
  if (k === 1) { for (let i = 0; i < handLen; i++) out.push([i]); return out; }
  for (let i = 0; i < handLen; i++) for (let j = i + 1; j < handLen; j++) out.push([i, j]);
  return out;
}
function analyze(hand, scenario, mode, players = 4, teams = players, N = 10000, Npeg = 700) {
  const rng = mulberry32(hand.reduce((a, c) => (a * 53 + cardId(c) + 1) >>> 0, 7));
  const { youDeal, cribIsOurs } = scenario;            // youDeal: you're the dealer; cribIsOurs: crib on your team
  const sign = cribIsOurs ? 1 : -1;
  const cribW = (mode === "protect" && !cribIsOurs) ? 1.3 : (mode === "need" && !cribIsOurs) ? 0.9 : 1.0;
  const riskSign = mode === "need" ? 1 : mode === "protect" ? -1 : 0;
  const k = players === 2 ? 2 : 1; // cards discarded to the crib
  const opts = [];
  for (const idxs of discardCombos(hand.length, k)) {
    const drop = new Set(idxs);
    const four = hand.filter((_, j) => !drop.has(j));
    const discards = idxs.map((j) => hand[j]);
    const hd = handDetail(four, hand);
    const cd = cribDetail(discards, hand, N, rng, cribIsOurs, players, teams);
    const pd = pegDetail(four, hand, Npeg, rng, youDeal, players);
    const net = hd.ev + pd.ev + sign * cd.ev;                       // mode-neutral expected points
    const sd = Math.sqrt(hd.sd * hd.sd + cd.sd * cd.sd + pd.sd * pd.sd);
    const adj = hd.ev + pd.ev + sign * cribW * cd.ev + riskSign * RISK * sd; // ranking objective
    opts.push({ id: idxs.join(","), idxs, cards: discards, hand: hd, crib: cd, peg: pd, handEV: hd.ev, cribEV: cd.ev, pegEV: pd.ev, netEV: net, sd, adj });
  }
  opts.sort((a, b) => b.adj - a.adj);
  return opts;
}

// Board-position posture suggested from the pip scores (game to 121).
function suggestMode(you, leader) {
  if (!you && !leader) return "ev";
  if (leader >= 106 && you < leader) return "need";        // someone's about to peg out and you trail
  if (you >= leader + 15 && you >= 95) return "protect";   // comfortable lead near the finish
  return "ev";
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
const SUIT = ["♠", "♥", "♦", "♣"];
const isRed = (s) => s === 1 || s === 2;
const rankLabel = (r) => (r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r));
const tag = (c) => `${rankLabel(c.r)}${SUIT[c.s]}`;
const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const serif = "'Hoefler Text', 'Iowan Old Style', Georgia, 'Times New Roman', serif";
// Render-only i18n helper (= window.t with key-fallback). Safe when window is absent
// (the engine/verify_*.js harnesses run the pure functions in Node) — returns the key.
const tr = (k, v) => (typeof window !== "undefined" && window.t) ? window.t(k, v) : k;
// Scoring-category display names, in scoreInto's acc order: 15s/pairs/runs/flush/nobs.
const CAT_KEYS = ["trainer.cat.fifteens", "trainer.cat.pairs", "trainer.cat.runs", "trainer.cat.flush", "trainer.cat.nobs"];
const catName = (i) => tr(CAT_KEYS[i]);

function randomHand(count = 5) {
  const deck = deckExcluding([]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, count).sort((a, b) => a.r - b.r || a.s - b.s);
}

/* ============================ CARD ============================ */
function Card({ card, onClick, phase, badge, dim, selected }) {
  const clickable = phase === "choose";
  const [hover, setHover] = useState(false);
  const lift = badge || selected ? -10 : hover && clickable ? -6 : 0;
  const edge = badge ? badge.color : selected ? T.selBlue : null;
  // Cards size to 68px when there's room but shrink to fit when a 6-card hand is wider
  // than the screen. The face is a container; its text uses cqw units so the rank/suit
  // scale with the box. (1px ≈ 1.47cqw at the 68px base width.)
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: "0 1 68px", minWidth: 0, maxWidth: 68 }}>
      <div style={{ height: 18 }}>
        {badge ? (
          <span style={{
            fontFamily: mono, fontSize: "max(10px, var(--min-fs, 0px))", letterSpacing: 0.5, fontWeight: 700,
            color: T.ivory, background: badge.color, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap",
          }}>{badge.text}</span>
        ) : selected ? (
          <span style={{
            fontFamily: mono, fontSize: "max(10px, var(--min-fs, 0px))", letterSpacing: 0.5, fontWeight: 700,
            color: T.ivory, background: T.selBlue, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap",
          }}>THROW</span>
        ) : null}
      </div>
      <button
        onClick={clickable ? onClick : undefined}
        onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
        aria-label={`${rankLabel(card.r)} of ${["spades", "hearts", "diamonds", "clubs"][card.s]}`}
        aria-pressed={clickable ? !!selected : undefined}
        style={{
          width: "100%", borderRadius: 9, padding: 0, background: T.ivory, position: "relative",
          cursor: clickable ? "pointer" : "default",
          border: edge ? `2px solid ${edge}` : "1px solid rgba(0,0,0,0.25)",
          boxShadow: badge || selected ? "0 8px 18px rgba(0,0,0,0.45)" : "0 4px 10px rgba(0,0,0,0.35)",
          transform: `translateY(${lift}px)`, transition: "transform 140ms ease, box-shadow 140ms ease",
          opacity: dim ? 0.5 : 1, outlineOffset: 3,
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

function PegTrack({ pct }) {
  const holes = 26;
  const pegAt = Math.round((pct / 100) * (holes - 1));
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
      {Array.from({ length: holes }).map((_, i) => {
        const on = i === pegAt;
        return (<span key={i} style={{
          width: on ? 11 : 7, height: on ? 11 : 7, borderRadius: "50%",
          background: on ? T.pegRed : "rgba(0,0,0,0.4)",
          boxShadow: on ? "0 0 0 2px rgba(236,220,180,0.5)" : "inset 0 1px 2px rgba(0,0,0,0.6)",
          transition: "all 200ms ease",
        }} />);
      })}
    </div>
  );
}

/* ---- category bars inside the explain drawer ---- */
function CatBars({ cats, scale, color }) {
  const max = Math.max(scale, ...cats, 0.001);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {cats.map((v, i) =>
        v < 0.005 ? null : (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "58px 1fr 44px", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted }}>{catName(i)}</span>
            <span style={{ height: 7, background: "rgba(0,0,0,0.28)", borderRadius: 4, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(v / max) * 100}%`, background: color }} />
            </span>
            <span style={{ fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", textAlign: "right" }}>{v.toFixed(2)}</span>
          </div>
        )
      )}
    </div>
  );
}

function dominant(cats) {
  let bi = 0;
  for (let i = 1; i < cats.length; i++) if (cats[i] > cats[bi]) bi = i;
  return cats[bi] > 0.01 ? catName(bi) : tr("trainer.cat.spread");
}

/* ---- the per-discard explanation ---- */
function Explain({ opt, cribIsOurs, youDeal, mode, players = 4 }) {
  const h = opt.hand, cr = opt.crib, pg = opt.peg;
  const topStr = h.top.map((c) => `${rankLabel(c.r)}→${c.avg.toFixed(1)}`).join("   ");
  const pegWhy = pg.ev >= 3.6
    ? tr("trainer.ex.pegHigh")
    : pg.ev <= 2.6
      ? tr("trainer.ex.pegLow")
      : tr("trainer.ex.pegMid");
  return (
    <div style={{ padding: "12px 12px 14px", background: "rgba(0,0,0,0.26)", borderRadius: 9, marginTop: 6, lineHeight: 1.5 }}>
      {/* HAND */}
      <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginBottom: 6 }}>
        {tr("trainer.ex.handHdr", { ev: h.ev.toFixed(2), cuts: players === 2 ? 46 : 47 })}
      </div>
      <div style={{ fontSize: "max(13.5px, var(--min-fs, 0px))", marginBottom: 8 }}>
        {tr("trainer.ex.handBody", { locked: h.locked.toFixed(0), fromCut: h.fromCut.toFixed(2), cat: dominant(h.cats) })}
      </div>
      <CatBars cats={h.cats} scale={h.ev} color={T.good} />
      <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginTop: 8 }}>
        {tr("trainer.ex.bestCuts")}&nbsp; <span style={{ color: T.cream }}>{topStr}</span>
      </div>

      {/* CRIB */}
      <div style={{ height: 1, background: T.line, margin: "13px 0" }} />
      <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginBottom: 6 }}>
        {tr(opt.cards.length > 1 ? "trainer.ex.cribHdrTwo" : "trainer.ex.cribHdrOne", { cards: opt.cards.map(tag).join(" + "), ev: cr.ev.toFixed(2), dir: cribIsOurs ? tr("trainer.ex.forYou") : tr("trainer.ex.againstYou") })}
      </div>
      <div style={{ fontSize: "max(13.5px, var(--min-fs, 0px))", marginBottom: 8 }}>
        {tr("trainer.ex.cribBody", { pct: (cr.hitRate * 100).toFixed(0), cat: dominant(cr.cats) })}
        {cribIsOurs ? tr("trainer.ex.cribOurs") : tr("trainer.ex.cribTheirs")}
      </div>
      <CatBars cats={cr.cats} scale={cr.ev} color={cribIsOurs ? T.good : T.pegRed} />

      {/* PEGGING */}
      <div style={{ height: 1, background: T.line, margin: "13px 0" }} />
      <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginBottom: 6 }}>
        {tr("trainer.ex.pegHdr", { ev: pg.ev.toFixed(2), seat: youDeal ? tr("trainer.ex.pegLast") : "" })}
      </div>
      <div style={{ fontSize: "max(13.5px, var(--min-fs, 0px))", marginBottom: 4 }}>{pegWhy}</div>

      {/* SPREAD + COMPONENTS */}
      <div style={{ height: 1, background: T.line, margin: "13px 0" }} />
      <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.cream, lineHeight: 1.7 }}>
        <div>{tr("trainer.tbl.hand")} {h.ev.toFixed(2)} &nbsp; {tr("trainer.tbl.crib")} {cribIsOurs ? "+" : "−"}{cr.ev.toFixed(2)} &nbsp; {tr("trainer.tbl.peg")} +{pg.ev.toFixed(2)} &nbsp;→&nbsp; <b>{tr("trainer.ex.net", { v: opt.netEV.toFixed(2) })}</b></div>
        <div style={{ color: T.muted }}>{tr("trainer.ex.spread", { sd: opt.sd.toFixed(2), mn: h.mn, mx: h.mx, p10: h.p10, p90: h.p90 })}</div>
        {mode !== "ev" && (
          <div style={{ color: mode === "need" ? T.good : T.pegRed }}>
            {tr("trainer.ex.adjLine", { mode: tr(mode === "need" ? "trainer.mode.need" : "trainer.mode.protect"), sign: mode === "need" ? "+" : "−", risk: RISK, adj: opt.adj.toFixed(2) })}
          </div>
        )}
      </div>
      <div style={{ fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))", color: T.muted, marginTop: 10, lineHeight: 1.5 }}>
        {tr("trainer.ex.footer", { deck: players === 3 ? tr("trainer.ex.footerDeck") : "", p: players, seat: youDeal ? tr("trainer.ex.seatDealer") : tr("trainer.ex.seatNon") })}
      </div>
    </div>
  );
}

/* ====================== TOP-LEVEL NOTE ====================== */
function buildNote(cribIsOurs, best, chosen) {
  const optimal = best.id === chosen.id;
  const bestLabel = best.cards.map((c) => rankLabel(c.r)).join("+");
  const multi = best.cards.length > 1;
  const phrase = multi ? bestLabel : `the ${bestLabel}`;          // "the K"  vs  "K+3"
  const bestHas5 = best.cards.some((c) => c.r === 5);
  const allHigh = best.cards.every((c) => c.r >= 11 && c.r <= 13);
  if (optimal) {
    if (cribIsOurs) {
      if (bestHas5) return tr("trainer.note.bestOurs5");
      return tr("trainer.note.bestOurs");
    }
    if (bestHas5) return tr("trainer.note.bestTheirs5");
    if (allHigh) return tr("trainer.note.bestTheirsHigh");
    return multi ? tr("trainer.note.bestTheirsMulti") : tr("trainer.note.bestTheirsOne");
  }
  const delta = best.adj - chosen.adj;
  if (!cribIsOurs && chosen.cards.some((c) => c.r === 5) && !bestHas5)
    return tr("trainer.note.fed5", { cribEV: chosen.cribEV.toFixed(1), phrase, delta: delta.toFixed(2) });
  if (chosen.handEV > best.handEV)
    return multi
      ? tr("trainer.note.handMoreMulti", { phrase, delta: delta.toFixed(2) })
      : tr("trainer.note.handMoreOne", { label: bestLabel, delta: delta.toFixed(2) });
  return tr("trainer.note.close", { phrase, delta: delta.toFixed(2) });
}

// A centered overlay modal (backdrop + card), identical to the Play game's, so the settings menu
// looks the same across pages.
function Modal({ onBackdrop, maxWidth = 380, padding = "20px", scroll = false, zIndex = 220, cardStyle, children }) {
  return (
    <div onClick={onBackdrop} style={{ position: "fixed", inset: 0, zIndex, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth, width: "100%", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding, boxShadow: "0 14px 44px rgba(0,0,0,0.55)", ...(scroll ? { maxHeight: "86vh", overflowY: "auto" } : null), ...cardStyle }}>
        {children}
      </div>
    </div>
  );
}
// The title-left / Done-button-right header the modals share.
function ModalHeader({ title, onClose, closeLabel, mb = 12, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: mb, flex: "0 0 auto" }}>
      {children != null ? children : <span style={{ fontWeight: 700, fontSize: "max(17px, var(--min-fs, 0px))" }}>{title}</span>}
      <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", fontWeight: 700 }}>{closeLabel || tr("common.done")}</button>
    </div>
  );
}

// Shared segmented-button style (selected vs not), matching the Play game's settings rows.
const segStyle = (on) => ({
  flex: 1, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))",
  background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
  border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
});

// A collapsible settings section (header + chevron). Open state is local, so toggling a setting
// inside it (which re-renders the panel) never collapses the section. Mirrors the Play game.
function SettingsSection({ title, defaultOpen, children }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <div style={{ borderTop: `1px solid ${T.line}`, marginBottom: open ? 12 : 0 }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "none", border: "none", cursor: "pointer", padding: "12px 0 10px",
        color: T.cream, fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      }}>
        <span>{title}</span><span style={{ color: T.muted, fontSize: "max(13px, var(--min-fs, 0px))" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// Settings menu — the IDENTICAL global game-settings menu shared by the landing page and the Play
// game (one localStorage object), so any toggle here sticks everywhere. The trainer's own setup
// (table size, practice-as role, new-hand mode) is NOT here — it lives inline on the main screen
// (InlineSetup), above the board-position item, alongside the analysis it drives.
function SettingsPanel({ settings, onSet, onReset, onClose, onAbout, onHistory }) {
  const hasHumans = humanCountT(settings) >= 1;   // muggins needs at least one human
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [resetMsg, setResetMsg] = React.useState(false);   // "already at defaults" toast
  React.useEffect(() => { if (!resetMsg) return; const t = setTimeout(() => setResetMsg(false), 2600); return () => clearTimeout(t); }, [resetMsg]);
  // The trainer reset returns everything (incl. table size/teams) to default except seats/names.
  const tapReset = () => { if (settingsAtDefaults(settings, ["seats", "names"])) setResetMsg(true); else setConfirmReset(true); };
  const Row = ({ title, desc, k, options, disabled }) => (
    <div style={{ marginBottom: 14, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontWeight: 700, fontSize: "max(13.5px, var(--min-fs, 0px))" }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))", color: T.muted, margin: "2px 0 7px", lineHeight: 1.45 }}>{desc}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(([label, val]) => (
          <button key={String(val)} disabled={disabled} onClick={disabled ? undefined : () => onSet(k, val)} style={{ ...segStyle(settings[k] === val), cursor: disabled ? "default" : "pointer" }}>{label}</button>
        ))}
      </div>
    </div>
  );
  const off = tr("common.off"), on = tr("common.on"), manual = tr("common.manual"), auto = tr("common.auto");
  return (
    <>
    <Modal onBackdrop={onClose} maxWidth={420} padding="14px 16px 4px" scroll cardStyle={{ maxHeight: "88vh" }}>
      <ModalHeader title={tr("settings.title")} onClose={onClose}>
        <span style={{ fontWeight: 700, fontSize: "max(16px, var(--min-fs, 0px))" }}>{tr("settings.title")}</span>
      </ModalHeader>
      <SettingsSection title={tr("settings.group.controls")}>
        <Row title={tr("settings.speed.title")} k="speed" desc={tr("settings.speed.desc")}
          options={[[tr("settings.speed.optSlow"), "slow"], [tr("settings.speed.optNormal"), "normal"], [tr("settings.speed.optFast"), "fast"], [tr("settings.speed.optLightning"), "lightning"], [tr("settings.speed.optInstant"), "instant"]]} />
        <Row title={tr("settings.tapToSelect.title")} k="tapToSelect" desc={tr("settings.tapToSelect.desc")} options={[[off, false], [on, true]]} />
        <Row title={tr("settings.warn.title")} k="warn" desc={tr("settings.warn.desc")} options={[[on, true], [off, false]]} />
      </SettingsSection>
      <SettingsSection title={tr("settings.group.automation")}>
        <Row title={tr("settings.autoDeal.title")} k="autoDeal" desc={tr("settings.autoDeal.desc")} options={[[off, false], [on, true]]} />
        <Row title={tr("settings.autoCut.title")} k="autoCut" desc={tr("settings.autoCut.desc")} options={[[manual, false], [auto, true]]} />
        <Row title={tr("settings.autoDiscardBest.title")} k="autoDiscardBest" desc={tr("settings.autoDiscardBest.desc")} options={[[off, false], [on, true]]} />
        <Row title={tr("settings.autoPlayOne.title")} k="autoPlayOne" desc={tr("settings.autoPlayOne.desc")} options={[[off, false], [on, true]]} />
        <Row title={tr("settings.autoPlayBest.title")} k="autoPlayBest" desc={tr("settings.autoPlayBest.desc")} options={[[off, false], [on, true]]} />
        <Row title={tr("settings.autoGo.title")} k="autoGo" desc={tr("settings.autoGo.desc")} options={[[manual, false], [auto, true]]} />
        <Row title={tr("settings.autoContinue.title")} k="autoContinue" desc={tr("settings.autoContinue.desc")} options={[[off, false], [on, true]]} />
      </SettingsSection>
      <SettingsSection title={tr("settings.group.counting")}>
        <Row title={tr("settings.counting.title")} k="counting" disabled={!hasHumans}
          desc={tr(hasHumans ? "settings.counting.desc" : "settings.counting.disabledDesc")}
          options={[[tr("settings.counting.optAuto"), "auto"], [tr("settings.counting.optMuggins"), "muggins"]]} />
        <Row title={tr("settings.claimWarn.title")} k="claimWarn" disabled={!(hasHumans && settings.counting === "muggins")}
          desc={tr("settings.claimWarn.desc")} options={[[on, true], [off, false]]} />
      </SettingsSection>
      <Row title={tr("settings.textSize.title")} k="textSize" desc={tr("settings.textSize.desc")}
        options={[[tr("settings.textSize.optSmall"), "small"], [tr("settings.textSize.optMedium"), "medium"], [tr("settings.textSize.optLarge"), "large"], [tr("settings.textSize.optXLarge"), "xlarge"]]} />
      <LanguageRow />
      <div style={{ borderTop: `1px solid ${T.line}`, margin: "2px -16px 0", padding: "12px 16px 0" }}>
        <button onClick={onHistory} style={{ width: "100%", padding: "10px", borderRadius: 9, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("settings.history")}</button>
      </div>
      <button onClick={tapReset} style={{ width: "100%", margin: "10px 0 0", padding: "10px", borderRadius: 9, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("settings.resetDefaults")}</button>
      {resetMsg && (
        <div onClick={() => setResetMsg(false)} role="status" style={{
          position: "fixed", left: "50%", top: 72, transform: "translateX(-50%)", zIndex: 240,
          background: `linear-gradient(180deg, ${T.woodL}, ${T.woodM})`, border: `1px solid ${T.pegIvory}`, borderRadius: 10, padding: "10px 16px",
          boxShadow: `0 8px 26px rgba(0,0,0,0.55), 0 0 0 3px ${T.baize}`, fontWeight: 700, fontSize: "max(14px, var(--min-fs, 0px))", color: T.ink,
          cursor: "pointer", maxWidth: "90vw", textAlign: "center",
        }}>{tr("settings.reset.alreadyDefault")}</div>
      )}
      <AboutRow onAbout={onAbout} />
      <button onClick={onClose} style={{
        width: "100%", margin: "12px 0 10px", padding: "12px", borderRadius: 9, border: "none", cursor: "pointer",
        background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory,
        fontFamily: mono, fontSize: "max(12.5px, var(--min-fs, 0px))", fontWeight: 700,
      }}>{tr("common.done")}</button>
    </Modal>
    {confirmReset && (
      <Modal onBackdrop={() => setConfirmReset(false)} maxWidth={360} padding="18px" zIndex={230}>
        <div style={{ fontWeight: 700, fontSize: "max(16px, var(--min-fs, 0px))", marginBottom: 6 }}>{tr("settings.reset.title")}</div>
        <div style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.muted, lineHeight: 1.5, marginBottom: 16 }}>{tr("settings.reset.body")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setConfirmReset(false)} style={{ flex: 1, padding: "12px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer", background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: "max(13px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("common.cancel")}</button>
          <button onClick={() => { setConfirmReset(false); onReset(); }} style={{ flex: 1, padding: "12px", borderRadius: 9, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${T.pegRed}, #9c3120)`, color: T.ivory, fontFamily: mono, fontSize: "max(13px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("settings.reset.confirm")}</button>
        </div>
      </Modal>
    )}
    </>
  );
}

// Game history — the same cribbage:history store the Play game writes (this trainer only reads/clears
// it). Ported verbatim from the Play game's HistoryModal so the settings menus match across pages.
const HISTORY_KEY = "cribbage:history";
function loadHistory() { try { const r = localStorage.getItem(HISTORY_KEY); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch (e) {} }
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
      padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", fontWeight: 700,
      border: `1px solid ${sel === key ? T.pegIvory : T.line}`,
      background: sel === key ? T.pegIvory : "rgba(0,0,0,0.25)", color: sel === key ? "#2A1B0E" : T.cream,
    }}>{label}</button>
  );
  const Stat = ({ label, value, accent }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderBottom: `1px solid ${T.line}` }}>
      <span style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.muted }}>{label}</span>
      <span style={{ fontFamily: serif, fontSize: "max(16px, var(--min-fs, 0px))", fontWeight: 700, color: accent || T.cream }}>{value}</span>
    </div>
  );
  return (
    <Modal onBackdrop={onClose} scroll>
      <ModalHeader title={tr("play.hist.title")} onClose={onClose} mb={14} />
        {all.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.muted, lineHeight: 1.6 }} data-tick={tick}>{tr("play.hist.empty")}</div>
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
                <div style={{ fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))", color: T.muted, margin: "14px 0 4px", letterSpacing: 0.3 }}>{tr("play.hist.avgHeader")}</div>
                <Stat label={tr("play.hist.pegging")} value={avg("peg").toFixed(1)} />
                <Stat label={tr("play.hist.hand")} value={avg("hand").toFixed(1)} />
                <Stat label={tr("play.hist.crib")} value={avg("crib").toFixed(1)} />
              </React.Fragment>
            ) : (
              <div style={{ fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))", color: T.muted, marginTop: 12, lineHeight: 1.5 }}>{tr("play.hist.pickHint")}</div>
            )}
            <button onClick={() => { if (confirmClear) { clearHistory(); setSel("all"); setConfirmClear(false); setTick(tick + 1); } else setConfirmClear(true); }} style={{
              width: "100%", marginTop: 16, padding: "10px", borderRadius: 9, cursor: "pointer",
              border: `1px solid ${confirmClear ? T.pegRed : T.line}`, background: "rgba(0,0,0,0.25)",
              color: confirmClear ? T.pegRed : T.muted, fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", fontWeight: 700,
            }}>{confirmClear ? tr("play.hist.clearConfirm") : tr("play.hist.clear")}</button>
          </React.Fragment>
        )}
    </Modal>
  );
}

// The trainer's own setup, inline on the main screen (above the board-position item): table size,
// the role you practice, and whether new hands auto-pick the best discard. Size persists to the
// shared global settings (Players); role/auto-best are trainer-local.
function InlineSetup({ players, teams, roleMode, onRoleMode, autoBest, onAutoBest, onSize }) {
  const label = { fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginBottom: 6 };
  const isTeams = teams < players;
  const forcedDefend = teams === players && players >= 5; // solo 5/6: you can only defend
  // role options map to roleMode: solo uses deal/defend; teams use ours/theirs.
  const roleOpts = isTeams
    ? [["random", tr("trainer.set.role.random")], ["ours", tr("trainer.set.role.ours")], ["theirs", tr("trainer.set.role.theirs")]]
    : [["random", tr("trainer.set.role.randomDeal", { p: players })], ["deal", tr("trainer.set.role.deal")], ["defend", tr("trainer.set.role.defend")]];
  return (
    <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontWeight: 700, fontSize: "max(13.5px, var(--min-fs, 0px))", marginBottom: 10 }}>{tr("trainer.set.setup")}</div>
      <div style={{ marginBottom: 12, fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, lineHeight: 1.6 }}>
        {tr("trainer.set.sizeLabel")} <b style={{ color: T.cream }}>{players === 2 ? tr("trainer.set.size2") : tr("trainer.set.sizeN", { p: players })}</b>.{" "}
        {tr("trainer.set.sizeTail")}
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={label}>{tr("trainer.set.tableSize")}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[2, 3, 4, 5, 6].map((p) => (
            <button key={p} onClick={() => onSize(p)} style={segStyle(players === p)}>{p}</button>
          ))}
        </div>
      </div>
      {forcedDefend ? (
        <div style={{ marginBottom: 12, fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))", color: T.muted, lineHeight: 1.5 }}>
          {tr("trainer.set.forcedDefend", { p: players })}
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div style={label}>{isTeams ? tr("trainer.set.practiceAsTeam") : tr("trainer.set.practiceAs")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {roleOpts.map(([k, l]) => (
              <button key={k} onClick={() => onRoleMode(k)} style={segStyle(roleMode === k)}>{l}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <div style={label}>{tr("trainer.set.newHand")}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onAutoBest(false)} style={segStyle(!autoBest)}>{tr("trainer.set.iChoose")}</button>
          <button onClick={() => onAutoBest(true)} style={segStyle(autoBest)}>{tr("trainer.set.autoBest")}</button>
        </div>
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
      <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginBottom: 6 }}>{window.t ? window.t("common.language") : "Language"}</div>
      <select defaultValue={i.lang} onChange={(e) => i.choose(e.target.value)}
        style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.cream, background: "rgba(0,0,0,0.2)", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
        {langs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
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
        fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", fontWeight: 700,
      }}>{tr("settings.aboutFeedback")}</button>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: "rgba(0,0,0,0.25)", color: T.ivory, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "max(19px, var(--min-fs, 0px))", lineHeight: 1 }}>♣</span>
            <span style={{ fontWeight: 700, fontSize: "max(17px, var(--min-fs, 0px))" }}>{tr("about.title")}</span>
          </div>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("common.done")}</button>
        </div>
        <div style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.cream, lineHeight: 1.6, marginBottom: 12 }}>
          {tr("about.line1")}
        </div>
        <div style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.cream, lineHeight: 1.6, marginBottom: 16 }}>
          {tr("about.line2")}
        </div>
        <a href={REPO} target="_blank" rel="noopener noreferrer" style={{
          display: "block", textAlign: "center", padding: "12px", borderRadius: 9, textDecoration: "none", boxSizing: "border-box",
          background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: T.ivory, fontFamily: mono, fontSize: "max(12.5px, var(--min-fs, 0px))", fontWeight: 700,
        }}>{tr("about.sourceLink")}</a>
        <div style={{ fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))", color: T.muted, textAlign: "center", margin: "8px 0 4px", wordBreak: "break-all" }}>github.com/ghug/cribbage-trainer</div>
        <div style={{ fontFamily: mono, fontSize: "max(10px, var(--min-fs, 0px))", color: T.muted, textAlign: "center" }}>v__APP_VERSION__</div>
      </div>
    </div>
  );
}

// A compact, tappable card face for the deck picker grid.
function MiniCard({ card, selected, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={selected}
      aria-label={`${rankLabel(card.r)} of ${["spades", "hearts", "diamonds", "clubs"][card.s]}`}
      style={{
        // Constant 1px border + a 6px outline for selection: an outline doesn't change the
        // card's box, so selecting one never resizes it or shifts the cards below.
        width: "100%", boxSizing: "border-box", borderRadius: 6, padding: 0, background: T.ivory, position: "relative",
        cursor: disabled ? "default" : "pointer",
        border: "1px solid rgba(0,0,0,0.25)",
        outline: selected ? `6px solid ${T.selBlue}` : "none", outlineOffset: "-3px",
        boxShadow: selected ? "0 4px 12px rgba(0,0,0,0.45)" : "0 2px 5px rgba(0,0,0,0.3)",
        opacity: disabled ? 0.4 : 1, transition: "opacity 120ms, box-shadow 120ms",
      }}>
      <span style={{ display: "block", paddingBottom: "141.18%" }} />
      <svg viewBox="0 0 68 96" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
        <text x="13" y="15" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="17" fill={isRed(card.s) ? T.suitRed : T.ink}>{rankLabel(card.r)}</text>
        <text x="13" y="30" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="13" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
        <text x="34" y="49" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontSize="34" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
      </svg>
    </button>
  );
}

// Build a specific hand: a four-wide deck grid (all 52, A→K by rank) where you tap to pick
// exactly `count` cards, then deal them.
function CardPicker({ count, onPick, onClose, dealerInit, canDeal }) {
  const [sel, setSel] = useState([]);                  // selected cardIds, in tap order
  const [asDealer, setAsDealer] = useState(!!dealerInit);   // build the hand as the dealer (your crib) or defending
  const deck = deckExcluding([]);
  const seg = (on) => ({
    flex: 1, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))",
    background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
    border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
  });
  const toggle = (c) => {
    const id = cardId(c);
    setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length >= count ? s : [...s, id]));
  };
  const ready = sel.length === count;
  return (
    // Full-screen fixed backdrop (the reliable visible-area box on mobile); the modal is
    // pinned to its top/bottom edges with position:absolute, so its height is the visible
    // viewport minus the gutters — no vh/dvh/flex-fill that mis-resolves with the chrome.
    <div style={{ position: "fixed", inset: 0, zIndex: 230, background: "rgba(0,0,0,0.62)" }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 12, bottom: 12, left: "50%", transform: "translateX(-50%)", width: "calc(100% - 24px)", maxWidth: 360, display: "flex", flexDirection: "column", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding: "16px", boxShadow: "0 14px 44px rgba(0,0,0,0.55)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "max(16px, var(--min-fs, 0px))" }}>{tr("trainer.picker.title")}</div>
            <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginTop: 2 }}>{tr("trainer.picker.hint", { n: count, sel: sel.length })}</div>
          </div>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("trainer.picker.cancel")}</button>
        </div>
        {/* Four suit columns, ranks A->K down each, overlapping vertically by 66% (so each
            card shows its top 34% — the corner rank+suit — with the bottom card full).
            marginTop is 66% of the card HEIGHT, expressed as a % of width: 0.66*(96/68). */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -4px", padding: "0 4px 8px" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            {[0, 1, 2, 3].map((s) => (
              <div key={s} style={{ flex: 1, minWidth: 0 }}>
                {Array.from({ length: 13 }, (_, k) => {
                  const c = { r: k + 1, s };
                  const id = cardId(c);
                  const on = sel.includes(id);
                  return (
                    <div key={id} style={{ position: "relative", zIndex: k, marginTop: k === 0 ? 0 : "-93.18%" }}>
                      <MiniCard card={c} selected={on} disabled={!on && sel.length >= count} onClick={() => toggle(c)} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {canDeal && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginBottom: 6 }}>{tr("trainer.picker.roleLabel")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setAsDealer(true)} style={seg(asDealer)}>{tr("trainer.picker.asDealer")}</button>
              <button onClick={() => setAsDealer(false)} style={seg(!asDealer)}>{tr("trainer.picker.asDefend")}</button>
            </div>
          </div>
        )}
        <button onClick={ready ? () => onPick(deck.filter((c) => sel.includes(cardId(c))), canDeal ? asDealer : false) : undefined} disabled={!ready}
          style={{
            marginTop: 14, width: "100%", padding: "13px", borderRadius: 10, border: "none",
            cursor: ready ? "pointer" : "default",
            background: ready ? `linear-gradient(180deg, ${T.good}, ${T.goodDeep})` : "rgba(0,0,0,0.25)",
            color: ready ? T.ivory : T.muted, opacity: ready ? 1 : 0.6,
            fontSize: "max(16px, var(--min-fs, 0px))", fontWeight: 700, letterSpacing: 0.3, boxShadow: ready ? "0 4px 12px rgba(0,0,0,0.35)" : "none",
          }}>{tr("trainer.picker.deal", { n: count })}</button>
      </div>
    </div>
  );
}

// The table size comes from the global "Players" setting chosen on the landing page
// (shared localStorage key). The trainer practices YOUR discard: 2-handed throws two
// from six; 3-/4-/5-/6-handed throw one from five. In 5-/6-handed the dealer is dealt
// four and throws none, so the human is always a non-dealer thrower (role "defend")
// feeding the dealer's all-defender crib. try/catch keeps it safe with no storage.
const teamOptionsT = (p) => (p === 4 ? [4, 2] : p === 6 ? [6, 3, 2] : [p]);
const SETTINGS_KEY = "cribbage:settings";
// The full GLOBAL settings object, shared (same localStorage key) with the landing page and the
// Play game, so the gear menu here is the identical global game-settings menu. The trainer itself
// only acts on players/teams; the gameplay toggles (counting/automation/...) are carried & synced.
const DEFAULT_SETTINGS = { players: 2, teams: 2, seats: [], names: [], speed: "normal", textSize: "large", counting: "auto", tapToSelect: true, autoCut: false, autoGo: false, warn: true, claimWarn: true, autoDeal: false, autoContinue: false, autoPlayOne: false, autoPlayBest: false, autoDiscardBest: false };
// True when every setting the reset would touch (all but `skip`) already equals its default.
function settingsAtDefaults(settings, skip) {
  for (const k in DEFAULT_SETTINGS) if (skip.indexOf(k) < 0 && settings[k] !== DEFAULT_SETTINGS[k]) return false;
  return true;
}
function loadSettings() { try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch (e) {} return { ...DEFAULT_SETTINGS }; }
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }
// Solo iff exactly one human seat (seat 0 human by default) — gates the muggins counting rows,
// mirroring the Play game so the shared menu reads identically.
function humanCountT(settings) { const P = settings.players; let c = 0; for (let i = 0; i < P; i++) { const v = settings.seats && settings.seats[i]; if (v === "human" || (v == null && i === 0)) c++; } return c; }
// Trainer-only toggle (persisted): auto-pick the optimal discard the moment a hand is dealt.
function loadAutoBest() { try { return localStorage.getItem("cribbage:trainerAutoBest") === "1"; } catch (e) { return false; } }
function saveAutoBest(v) { try { localStorage.setItem("cribbage:trainerAutoBest", v ? "1" : "0"); } catch (e) {} }
// The trainer scenario per hand: `cribIsOurs` (the crib lands on your team) drives the
// crib sign/composition; `youDeal` (you're literally the dealer) drives the pegging
// seat. At solo 5-/6-handed the dealer is dealt four and throws none, so you can only
// be a non-dealer thrower → forced defend.
function trainerScenario(roleMode, players, teams) {
  const teamSize = players / teams;
  const dealerThrows = players <= 4;
  const forcedDefend = teams === players && players >= 5;
  let cribIsOurs;
  if (forcedDefend) cribIsOurs = false;
  else if (roleMode === "ours" || roleMode === "deal") cribIsOurs = true;
  else if (roleMode === "theirs" || roleMode === "defend") cribIsOurs = false;
  else cribIsOurs = Math.random() < teamSize / players;          // random
  const youDeal = cribIsOurs && dealerThrows && (teamSize === 1 || Math.random() < 1 / teamSize);
  return { youDeal, cribIsOurs };
}

/* ============================ APP ============================ */
export default function CribbageTrainer() {
  const [settings, setSettings] = useState(loadSettings);  // the full GLOBAL settings object (shared with landing + Play)
  SPEED = settings.speed || "normal";   // scales the deal-in animation (and any future trainer timers)
  const players = (settings.players >= 2 && settings.players <= 6) ? settings.players : 2;
  const teams = teamOptionsT(players).includes(settings.teams) ? settings.teams : players;
  const [roleMode, setRoleMode] = useState("random");
  const [autoBest, setAutoBest] = useState(loadAutoBest);   // auto-pick the best discard on deal
  const [hand, setHand] = useState(() => randomHand(players === 2 ? 6 : 5));
  const [scenario, setScenario] = useState(() => trainerScenario("random", players, teams));
  const [phase, setPhase] = useState("choose");
  const [selected, setSelected] = useState([]);   // card indices tapped during the choose phase
  const [chosenId, setChosenId] = useState(null);  // option id ("i" or "i,j") the user committed to
  const [expanded, setExpanded] = useState(null);  // option id of the open explain drawer
  const [showModel, setShowModel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);   // the "Deal custom" deck picker
  const [showBoard, setShowBoard] = useState(false);
  const [yourPips, setYourPips] = useState(0);
  const [leaderPips, setLeaderPips] = useState(0);
  const [modeOverride, setModeOverride] = useState(null); // null = auto from pips
  const [stats, setStats] = useState({ hands: 0, optimal: 0, lost: 0 });
  // Live language switch: re-render when i18n.choose() loads a new locale (no page reload).
  const [, bumpLang] = useState(0);
  useEffect(() => {
    const i = (typeof window !== "undefined") ? window.i18n : null;
    if (i && i.onChange) i.onChange(() => bumpLang((v) => v + 1));
  }, []);

  const suggested = suggestMode(yourPips, leaderPips);
  const mode = modeOverride || suggested;

  const discardCount = players === 2 ? 2 : 1; // cards thrown to the crib (heads-up throws two)

  const opts = useMemo(() => (phase === "revealed" ? analyze(hand, scenario, mode, players, teams) : null), [phase, hand, scenario, mode, players, teams]);

  // customHandRef marks the current hand as a "Deal custom" one, so it can be excluded from the
  // header hand stats (those track your random-deal practice, not hands you set up yourself).
  const customHandRef = useRef(false);
  const dealHand = useCallback((p) => {
    const sc = trainerScenario(roleMode, p, teams);
    customHandRef.current = false;
    setHand(randomHand(p === 2 ? 6 : 5)); setScenario(sc);
    setSelected([]); setChosenId(null); setExpanded(null); setPhase("choose");
  }, [roleMode, teams]);

  const deal = useCallback(() => dealHand(players), [dealHand, players]);

  const handSize = players === 2 ? 6 : 5;                 // cards dealt (heads-up deals 6)
  const forcePickRef = useRef(false);                     // one-shot: auto-pick the next choose hand
  const dealCustom = useCallback((cards, asDealer) => {
    // The picker's Dealer/Defending toggle sets the scenario directly: dealer = your crib, else you
    // defend into someone else's. (Forced-defend solo 5/6 passes asDealer=false — the toggle is hidden.)
    const sc = asDealer ? { youDeal: true, cribIsOurs: true } : { youDeal: false, cribIsOurs: false };
    forcePickRef.current = true;                          // a custom hand always reveals the best
    customHandRef.current = true;                          // …but it's excluded from the hand stats
    setHand(cards.slice().sort((a, b) => a.r - b.r || a.s - b.s)); setScenario(sc);
    setSelected([]); setChosenId(null); setExpanded(null); setPhase("choose");
    setPickerOpen(false);
  }, []);

  // In-trainer table-size chooser. Changing the size drops to cutthroat (teams = players) — the team
  // split is only copied from the global setting at init — resets the role to random, and deals a
  // fresh hand under the new size (heads-up deals 6, otherwise 5).
  // Size is a GLOBAL setting (Players): persist it (cutthroat teams), like the Play game does on a
  // size change, so it stays in sync with the landing page and the Play game.
  const chooseSize = useCallback((p) => {
    if (p === players) return;
    setSettings((prev) => { const next = { ...prev, players: p, teams: p }; saveSettings(next); return next; });
    setRoleMode("random");
    customHandRef.current = false;
    setHand(randomHand(p === 2 ? 6 : 5));
    setScenario(trainerScenario("random", p, p));
    setSelected([]); setChosenId(null); setExpanded(null); setPhase("choose");
  }, [players]);
  // The shared global menu rows write straight to the settings object (and localStorage).
  const setSetting = useCallback((k, val) => {
    setSettings((prev) => { const next = { ...prev, [k]: val }; saveSettings(next); return next; });
  }, []);
  // Reset all gameplay toggles AND the table size/teams to defaults (keeping the per-seat roles +
  // custom names), then re-deal a fresh hand at the default size — like chooseSize.
  const resetSettings = useCallback(() => {
    const dp = DEFAULT_SETTINGS.players, dt = DEFAULT_SETTINGS.teams;
    setSettings((prev) => {
      const next = { ...prev };
      for (const k in DEFAULT_SETTINGS) if (k !== "seats" && k !== "names") next[k] = DEFAULT_SETTINGS[k];
      saveSettings(next); return next;
    });
    setRoleMode("random");
    customHandRef.current = false;
    setHand(randomHand(dp === 2 ? 6 : 5));
    setScenario(trainerScenario("random", dp, dt));
    setSelected([]); setChosenId(null); setExpanded(null); setPhase("choose");
  }, []);

  const pick = useCallback((idxs) => {
    const id = idxs.slice().sort((a, b) => a - b).join(","); // match analyze's i<j combo ids
    const res = analyze(hand, scenario, mode, players, teams);
    const best = res[0];
    const chosen = res.find((o) => o.id === id);
    const delta = best.adj - chosen.adj;
    setChosenId(id); setExpanded(null); setPhase("revealed");
    if (!customHandRef.current)   // custom ("Deal custom") hands don't count toward the header stats
      setStats((s) => ({ hands: s.hands + 1, optimal: s.optimal + (delta < 0.1 ? 1 : 0), lost: s.lost + delta }));
  }, [hand, scenario, mode, players, teams]);

  // Auto-pick the optimal discard once a hand is in the choose phase — when the setting is
  // on, or always after a "Deal custom" (the one-shot forcePickRef).
  useEffect(() => {
    if (phase !== "choose" || (!autoBest && !forcePickRef.current)) return;
    forcePickRef.current = false;
    pick(analyze(hand, scenario, mode, players, teams)[0].idxs);
  }, [autoBest, phase, hand, scenario, mode, players, teams, pick]);

  const toggleSelect = useCallback((i) => {
    if (selected.includes(i)) { setSelected(selected.filter((x) => x !== i)); return; } // tap again to deselect
    const next = [...selected, i];
    if (next.length >= discardCount) { setSelected([]); pick(next); } // complete set → reveal
    else setSelected(next);
  }, [selected, discardCount, pick]);

  const best = opts ? opts[0] : null;
  const chosen = opts ? opts.find((o) => o.id === chosenId) : null;
  const acc = stats.hands ? (stats.optimal / stats.hands) * 100 : 0;
  const avgLost = stats.hands ? stats.lost / stats.hands : 0;
  const maxAdj = opts ? Math.max(...opts.map((o) => o.adj)) : 1;
  const cribIsOurs = scenario.cribIsOurs;
  const isTeams = teams < players;
  // banner: you deal · your team's crib (partner deals) · opponents' crib
  const bannerTitle = scenario.youDeal ? tr("trainer.banner.youDeal")
    : cribIsOurs ? tr("trainer.banner.partner")
    : isTeams ? tr("trainer.banner.oppTeam") : tr("trainer.banner.oppSolo");
  const bannerSub = cribIsOurs ? tr("trainer.banner.subGreedy")
    : tr("trainer.banner.subDefend");
  const gridCols = `16px ${discardCount === 2 ? "58px" : "30px"} 1fr 38px 40px 34px 46px`;
  const MODE_LABEL = { ev: tr("trainer.mode.ev"), need: tr("trainer.mode.need"), protect: tr("trainer.mode.protect") };

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 90% at 50% 0%, ${T.baizeHi}, ${T.baize})`,
      color: T.cream, fontFamily: serif, padding: "0 0 28px", "--min-fs": MIN_FS[settings.textSize] || "0px",
    }}>
      <style>{`
        @keyframes dealIn {from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .dealwrap > * {animation:dealIn var(--deal-ms,260ms) ease both}
        .dealwrap > *:nth-child(2){animation-delay:calc(var(--deal-stg,40ms)*1)}
        .dealwrap > *:nth-child(3){animation-delay:calc(var(--deal-stg,40ms)*2)}
        .dealwrap > *:nth-child(4){animation-delay:calc(var(--deal-stg,40ms)*3)}
        .dealwrap > *:nth-child(5){animation-delay:calc(var(--deal-stg,40ms)*4)}
        .dealwrap > *:nth-child(6){animation-delay:calc(var(--deal-stg,40ms)*5)}
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
            <a href="index.html" aria-label={tr("trainer.home")} title={tr("trainer.home")} style={{
              flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: T.baize, color: T.ivory, textDecoration: "none",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: "max(19px, var(--min-fs, 0px))", lineHeight: 1,
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.12), 0 2px 5px rgba(0,0,0,0.35)",
            }}>♣</a>
            <span style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: "rgba(42,27,14,0.8)", lineHeight: 1.3 }}>{players === 2 ? tr("trainer.hdr.heads") : teams < players ? tr("trainer.hdr.teams", { p: players, teams, size: players / teams }) : tr("trainer.hdr.solo", { p: players })}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <a href="index.html" aria-label={tr("trainer.home")} style={{
              width: 40, height: 40, borderRadius: 10, textDecoration: "none",
              border: "1px solid rgba(0,0,0,0.28)", background: "rgba(42,27,14,0.14)",
              color: "#2A1B0E", fontSize: "max(19px, var(--min-fs, 0px))", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>⌂</a>
            <button onClick={() => setShowSettings((o) => !o)} aria-label={tr("settings.title")} aria-expanded={showSettings} style={{
              width: 40, height: 40, borderRadius: 10, cursor: "pointer",
              border: "1px solid rgba(0,0,0,0.28)", background: showSettings ? "rgba(42,27,14,0.28)" : "rgba(42,27,14,0.14)",
              color: "#2A1B0E", fontSize: "max(20px, var(--min-fs, 0px))", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>⚙</button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}><PegTrack pct={acc} /></div>
        <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: "#2A1B0E" }}>
          <span><b style={{ fontSize: "max(15px, var(--min-fs, 0px))" }}>{stats.hands}</b> {tr("trainer.stat.hands")}</span>
          <span><b style={{ fontSize: "max(15px, var(--min-fs, 0px))" }}>{stats.hands ? acc.toFixed(0) : "–"}%</b> {tr("trainer.stat.optimal")}</span>
          <span><b style={{ fontSize: "max(15px, var(--min-fs, 0px))" }}>{stats.hands ? avgLost.toFixed(2) : "–"}</b> {tr("trainer.stat.lost")}</span>
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 0" }}>
        {showSettings && <SettingsPanel settings={settings} onSet={setSetting} onReset={resetSettings} onClose={() => setShowSettings(false)} onAbout={() => { setShowSettings(false); setAboutOpen(true); }} onHistory={() => { setShowSettings(false); setHistoryOpen(true); }} />}
        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
        {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
        {pickerOpen && <CardPicker count={handSize} onPick={dealCustom} onClose={() => setPickerOpen(false)} dealerInit={scenario.youDeal} canDeal={!(teams === players && players >= 5)} />}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 10,
          background: cribIsOurs ? "rgba(95,164,124,0.16)" : "rgba(200,65,43,0.14)",
          border: `1px solid ${cribIsOurs ? "rgba(95,164,124,0.5)" : "rgba(200,65,43,0.45)"}`,
        }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: cribIsOurs ? T.good : T.pegRed, flex: "0 0 auto", boxShadow: "0 0 0 3px rgba(0,0,0,0.2)" }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "max(15px, var(--min-fs, 0px))" }}>{bannerTitle}</div>
            <div style={{ fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", color: T.muted, marginTop: 2 }}>{bannerSub}</div>
          </div>
        </div>

        <p style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.muted, margin: "18px 2px 6px" }}>
          {phase === "choose"
            ? (discardCount === 2
                ? (selected.length === 1 ? tr("trainer.prompt.tapTwoMore") : tr("trainer.prompt.tapTwo"))
                : tr("trainer.prompt.tapOne"))
            : (mode === "ev"
                ? tr("trainer.prompt.ranked", { mode: MODE_LABEL[mode] })
                : tr("trainer.prompt.rankedRisk", { mode: MODE_LABEL[mode], sign: mode === "need" ? "+" : "−" }))}
        </p>
        <div className={phase === "choose" ? "dealwrap" : ""} style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "nowrap", "--deal-ms": spd(260) + "ms", "--deal-stg": spd(40) + "ms" }}>
          {hand.map((card, i) => {
            let badge = null, dim = false, sel = false;
            if (phase === "revealed") {
              const isBest = best.idxs.includes(i), isPick = chosen ? chosen.idxs.includes(i) : false;
              if (isBest && isPick) badge = { text: "BEST ✓", color: T.goodDeep };
              else if (isBest) badge = { text: "BEST", color: T.goodDeep };
              else if (isPick) badge = { text: "YOUR PICK", color: T.pegRed };
              else dim = true;
            } else {
              sel = selected.includes(i);
            }
            return <Card key={cardId(card)} card={card} phase={phase} badge={badge} dim={dim} selected={sel} onClick={() => toggleSelect(i)} />;
          })}
        </div>

        {phase === "revealed" && opts && (
          <div style={{ marginTop: 20 }}>
            <div style={{
              padding: "12px 14px", borderRadius: 10, marginBottom: 14, lineHeight: 1.5, fontSize: "max(14.5px, var(--min-fs, 0px))",
              background: chosenId === best.id ? "rgba(95,164,124,0.14)" : "rgba(0,0,0,0.22)",
              border: `1px solid ${chosenId === best.id ? "rgba(95,164,124,0.4)" : T.line}`,
            }}>{buildNote(cribIsOurs, best, chosen)}</div>

            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 5, fontFamily: mono, fontSize: "max(10px, var(--min-fs, 0px))", color: T.muted, padding: "0 4px 2px" }}>
              <span></span><span>{tr("trainer.tbl.throw")}</span><span>{tr("trainer.tbl.bar", { m: mode === "ev" ? tr("trainer.tbl.net") : tr("trainer.tbl.adj") })}</span>
              <span style={{ textAlign: "right" }}>{tr("trainer.tbl.hand")}</span><span style={{ textAlign: "right" }}>{tr("trainer.tbl.crib")}</span>
              <span style={{ textAlign: "right" }}>{tr("trainer.tbl.peg")}</span><span style={{ textAlign: "right" }}>{mode === "ev" ? tr("trainer.tbl.net") : tr("trainer.tbl.adj")}</span>
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              {opts.map((o) => {
                const isBest = o.id === best.id, isPick = o.id === chosenId, isOpen = expanded === o.id;
                const scoreVal = mode === "ev" ? o.netEV : o.adj;
                return (
                  <div key={o.id}>
                    <button onClick={() => setExpanded(isOpen ? null : o.id)} style={{
                      width: "100%", textAlign: "left", cursor: "pointer",
                      display: "grid", gridTemplateColumns: gridCols, gap: 5, alignItems: "center",
                      padding: "8px 4px", borderRadius: 8,
                      background: isBest ? "rgba(95,164,124,0.12)" : "rgba(0,0,0,0.12)",
                      border: isPick && !isBest ? `1px solid ${T.pegRed}` : "1px solid transparent",
                    }}>
                      <span style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.muted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>{"›"}</span>
                      <span style={{ fontFamily: serif, fontWeight: 700, fontSize: discardCount === 2 ? 13 : 15, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {o.cards.map((c) => <span key={cardId(c)} style={{ color: isRed(c.s) ? T.suitRed : T.ivory }}>{tag(c)}</span>)}
                      </span>
                      <span style={{ height: 9, background: "rgba(0,0,0,0.28)", borderRadius: 5, overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.max(4, (scoreVal / maxAdj) * 100)}%`, background: isBest ? T.good : isPick ? T.pegRed : "rgba(236,224,182,0.45)" }} />
                      </span>
                      <span style={{ fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", textAlign: "right", color: T.cream }}>{o.handEV.toFixed(2)}</span>
                      <span style={{ fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", textAlign: "right", color: T.muted }}>{cribIsOurs ? "+" : "−"}{o.cribEV.toFixed(2)}</span>
                      <span style={{ fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", textAlign: "right", color: T.muted }}>+{o.pegEV.toFixed(2)}</span>
                      <span style={{ fontFamily: mono, fontSize: "max(12.5px, var(--min-fs, 0px))", fontWeight: 700, textAlign: "right", color: isBest ? T.good : T.cream }}>{scoreVal.toFixed(2)}</span>
                    </button>
                    {isOpen && <Explain opt={o} cribIsOurs={cribIsOurs} youDeal={scenario.youDeal} mode={mode} players={players} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10 }}>
            {[[tr("trainer.dealCustom"), () => setPickerOpen(true)], [tr("trainer.dealRandom"), deal]].map(([label, onClick]) => (
              <button key={label} onClick={onClick} style={{
                flex: 1, padding: "13px", borderRadius: 10, border: "none", cursor: "pointer",
                background: `linear-gradient(180deg, ${T.woodL}, ${T.woodM})`, color: "#2A1B0E",
                fontSize: "max(16px, var(--min-fs, 0px))", fontWeight: 700, letterSpacing: 0.3, boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
              }}>{label}</button>
            ))}
          </div>

          <InlineSetup players={players} teams={teams} roleMode={roleMode} onRoleMode={setRoleMode}
            autoBest={autoBest} onAutoBest={(v) => { setAutoBest(v); saveAutoBest(v); }} onSize={chooseSize} />

          <div>
            <button onClick={() => setShowBoard((v) => !v)} style={{
              width: "100%", textAlign: "left", cursor: "pointer", padding: "10px 12px", borderRadius: 8,
              background: mode === "ev" ? "rgba(0,0,0,0.2)" : (mode === "need" ? "rgba(95,164,124,0.18)" : "rgba(200,65,43,0.16)"),
              border: `1px solid ${mode === "ev" ? T.line : (mode === "need" ? "rgba(95,164,124,0.5)" : "rgba(200,65,43,0.45)")}`,
              color: T.cream, fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>{tr("trainer.board.toggle", { mode: MODE_LABEL[mode], state: modeOverride ? tr("trainer.board.stManual") : tr("trainer.board.stAuto") })}</span>
              <span style={{ transform: showBoard ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>{"›"}</span>
            </button>
            {showBoard && (
              <div style={{ padding: "12px 12px 14px", background: "rgba(0,0,0,0.26)", borderRadius: 9, marginTop: 6 }}>
                <div style={{ fontSize: "max(13px, var(--min-fs, 0px))", lineHeight: 1.5, marginBottom: 12 }}>
                  {tr("trainer.board.body")}
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  {[["your", tr("trainer.board.yourPips"), yourPips, setYourPips], ["leader", tr("trainer.board.leaderPips"), leaderPips, setLeaderPips]].map(([id, lbl, val, set]) => (
                    <label key={id} style={{ flex: 1, fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted }}>
                      {lbl}
                      <input type="number" min={0} max={120} value={val}
                        onChange={(e) => set(Math.max(0, Math.min(120, parseInt(e.target.value || "0", 10))))}
                        style={{
                          width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 7, boxSizing: "border-box",
                          background: "rgba(0,0,0,0.35)", border: `1px solid ${T.line}`, color: T.cream,
                          fontFamily: mono, fontSize: "max(15px, var(--min-fs, 0px))",
                        }} />
                    </label>
                  ))}
                </div>
                <div style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted, marginBottom: 10 }}>
                  {yourPips || leaderPips
                    ? tr("trainer.board.need", { you: Math.max(0, 121 - yourPips), leader: Math.max(0, 121 - leaderPips), mode: MODE_LABEL[suggested] })
                    : tr("trainer.board.neutral")}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["auto", null], ["ev", "ev"], ["need", "need"], ["protect", "protect"]].map(([lbl, val]) => {
                    const on = val === modeOverride;
                    const txt = val === null ? tr("trainer.board.auto") : MODE_LABEL[val];
                    return (
                      <button key={lbl} onClick={() => setModeOverride(val)} style={{
                        flex: 1, padding: "9px 4px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))",
                        background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
                        border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
                      }}>{txt}</button>
                    );
                  })}
                </div>
                <div style={{ fontFamily: mono, fontSize: "max(10px, var(--min-fs, 0px))", color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
                  {tr("trainer.board.risk", { risk: RISK })}
                </div>
              </div>
            )}
          </div>

          <div>
            <button onClick={() => setShowModel((v) => !v)} style={{
              width: "100%", textAlign: "left", cursor: "pointer", padding: "10px 12px", borderRadius: 8,
              background: "rgba(0,0,0,0.2)", border: `1px solid ${T.line}`, color: T.cream,
              fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>{tr("trainer.model.toggle")}</span>
              <span style={{ transform: showModel ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>{"›"}</span>
            </button>
            {showModel && (
              <div style={{ padding: "12px 12px 14px", background: "rgba(0,0,0,0.26)", borderRadius: 9, marginTop: 6 }}>
                <div style={{ fontSize: "max(13px, var(--min-fs, 0px))", lineHeight: 1.5, marginBottom: 12 }}>
                  {tr("trainer.model.introA")}<b>{tr("trainer.model.dealers")}</b>{tr("trainer.model.introMid")}<b>{tr("trainer.model.defenders")}</b>{tr("trainer.model.introB")}{" "}
                  {isTeams
                    ? tr("trainer.model.teams", { teams })
                    : players === 2
                    ? tr("trainer.model.heads")
                    : players === 3
                    ? tr("trainer.model.three")
                    : players >= 5
                    ? tr("trainer.model.five")
                    : tr("trainer.model.four")}
                  {" "}{tr("trainer.model.cutUniform")}
                  {players !== 4 && (
                    <span style={{ color: T.muted }}> &nbsp;{tr("trainer.model.reuse", { p: players })}</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "16px 1fr 1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <span></span>
                  <span style={{ fontFamily: mono, fontSize: "max(10px, var(--min-fs, 0px))", color: T.good }}>{tr("trainer.model.dealerCol")}</span>
                  <span style={{ fontFamily: mono, fontSize: "max(10px, var(--min-fs, 0px))", color: T.pegRed }}>{tr("trainer.model.defenderCol")}</span>
                </div>
                {DEALER_DISCARD_PROBS.map((dp, i) => {
                  const r = i + 1;
                  const fp = DEFENDER_DISCARD_PROBS[i];
                  const mx = Math.max(...DEALER_DISCARD_PROBS, ...DEFENDER_DISCARD_PROBS);
                  const Bar = ({ v, color }) => (
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ height: 8, flex: 1, background: "rgba(0,0,0,0.28)", borderRadius: 4, overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${(v / mx) * 100}%`, background: color }} />
                      </span>
                      <span style={{ fontFamily: mono, fontSize: "max(9.5px, var(--min-fs, 0px))", color: T.muted, width: 30, textAlign: "right" }}>{(v * 100).toFixed(1)}</span>
                    </span>
                  );
                  return (
                    <div key={r} style={{ display: "grid", gridTemplateColumns: "16px 1fr 1fr", gap: 6, alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontFamily: serif, fontWeight: 700, fontSize: "max(13px, var(--min-fs, 0px))" }}>{rankLabel(r)}</span>
                      <Bar v={dp} color={T.good} />
                      <Bar v={fp} color={T.pegRed} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
