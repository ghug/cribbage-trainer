/* Shared settings + history storage (cribbage:settings / cribbage:history) — the SINGLE source of
 * truth for the global game settings, used by all three surfaces: the landing (plain JS), the Play
 * game and the Trainer (React). build.sh PREPENDS this into each app (compiled in alongside
 * engine.js/chrome.jsx) and INLINES it into the landing's <head>, so there's one DEFAULT_SETTINGS /
 * load+save with no per-page copy to drift out of sync (which is how the `counting` default once
 * diverged). Plain classic-script JS: the top-level declarations land in the shared global scope, so
 * the landing's later inline script sees them, and tsc compiles it fine when prepended to the apps. */
const SETTINGS_KEY = "cribbage:settings";
const DEFAULT_SETTINGS = { players: 2, teams: 2, seats: [], names: [], speed: "normal", textSize: "large", counting: "muggins", tapToSelect: true, autoCut: false, autoGo: false, warn: true, claimWarn: true, autoDeal: false, autoContinue: false, autoPlayOne: false, autoPlayBest: false, autoDiscardBest: false };
// True when every setting the reset would touch (all but `skip`) already equals its default.
function settingsAtDefaults(settings, skip) {
  for (const k in DEFAULT_SETTINGS) if (skip.indexOf(k) < 0 && settings[k] !== DEFAULT_SETTINGS[k]) return false;
  return true;
}
function loadSettings() {
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }
// Multi-tab clobber guard. localStorage is shared across every tab of the origin, so writing the whole
// settings blob from one tab's (possibly stale) in-memory copy reverts a different field another tab
// changed meanwhile. persistSettingChange re-reads the current stored blob and overlays ONLY the
// changed field(s), so concurrent edits to different fields survive. (No live cross-tab sync: a tab
// still shows another tab's change only after a reload.) Returns the merged object.
function persistSettingChange(changes) { const next = { ...loadSettings(), ...changes }; saveSettings(next); return next; }
const HISTORY_KEY = "cribbage:history";
/* Game history is stored as an AGGREGATE only — no per-game rows, no timestamps. It's an object keyed
 * `${P}-${teams}`, each value a bucket: { games, peg, hand, crib (running AVERAGES), won, lost,
 * skunked, doubleSkunked }. A finished game folds into its config's bucket. */
function histKey(P, teams) { return P + "-" + teams; }
function blankBucket() { return { games: 0, peg: 0, hand: 0, crib: 0, won: 0, lost: 0, skunked: 0, doubleSkunked: 0 }; }
// Fold one finished-game summary { P, teams, outcome, peg, hand, crib } into the aggregate, rolling the
// running averages: newAvg = (games*prevAvg + value) / (games+1), bumping games + the outcome counter.
// Mutates and returns `stats`.
function foldGameStats(stats, rec) {
  const key = histKey(rec.P, rec.teams), b = stats[key] || blankBucket(), n = b.games;
  b.peg = (n * b.peg + (rec.peg || 0)) / (n + 1);
  b.hand = (n * b.hand + (rec.hand || 0)) / (n + 1);
  b.crib = (n * b.crib + (rec.crib || 0)) / (n + 1);
  b.games = n + 1;
  if (b[rec.outcome] != null) b[rec.outcome] += 1;
  stats[key] = b;
  return stats;
}
// Combine buckets into one (the "all configs" view): summed counts/games, games-weighted averages.
function combineBuckets(list) {
  const out = blankBucket();
  for (const b of list) {
    const n = out.games, m = b.games || 0;
    if (n + m > 0) {
      out.peg = (n * out.peg + m * (b.peg || 0)) / (n + m);
      out.hand = (n * out.hand + m * (b.hand || 0)) / (n + m);
      out.crib = (n * out.crib + m * (b.crib || 0)) / (n + m);
    }
    out.games = n + m;
    out.won += b.won || 0; out.lost += b.lost || 0; out.skunked += b.skunked || 0; out.doubleSkunked += b.doubleSkunked || 0;
  }
  return out;
}
// Returns the aggregate object. A pre-aggregate install stored a per-game ARRAY (or anything else);
// that old format is IGNORED — return a fresh empty aggregate, which the next finished game overwrites.
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}
function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) {} }
function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch (e) {} }
