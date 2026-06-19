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
const HISTORY_KEY = "cribbage:history";
function loadHistory() { try { const r = localStorage.getItem(HISTORY_KEY); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch (e) {} }
