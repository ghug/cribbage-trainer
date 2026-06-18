/* Shared UI chrome — theme, i18n/format helpers, speed+text utilities, settings/history storage,
 * and the modal shell — used by BOTH the Play game (src/CribbagePlay.jsx) and the Discard Trainer
 * (src/CribbageTrainer.jsx). `build.sh` PREPENDS this file (after src/engine.js) to each app before
 * the name-guard + transpile, so every built page still ships one self-contained copy (no bundler).
 * These definitions were byte-for-byte identical across the two apps; this is the single source of
 * truth for them. Hooks are called as `React.*` so this file needs no React import of its own.
 *
 * NOTE: components that legitimately differ between the apps (Card wrapper, PegTrack) are NOT here.
 */

/* ---- theme + format ---- */
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

/* ---- i18n ---- */
// Render-only i18n helper (= window.t with key-fallback). Safe when window is absent (the
// engine/verify_*.js harnesses run in Node) — returns the key.
const tr = (k, v) => (typeof window !== "undefined" && window.t) ? window.t(k, v) : k;
// Scoring-category display names, in scoreInto's acc order: 15s/pairs/runs/flush/nobs.
const CAT_KEYS = ["trainer.cat.fifteens", "trainer.cat.pairs", "trainer.cat.runs", "trainer.cat.flush", "trainer.cat.nobs"];
const catName = (i) => tr(CAT_KEYS[i]);

/* ---- version (build-stamped) ---- */
const APP_VERSION = "__APP_VERSION__";
const IS_DEV_VERSION = APP_VERSION.indexOf("-dev") !== -1;

/* ---- game speed + text-size floor ---- */
// `spd(ms)` scales any animation/pause/deal duration: slow 2×, normal 1×, fast ½×, lightning a flat
// 32 ms, instant a flat 0 ms. spd(0) passes through so intentional zeros stay zero. SPEED is assigned
// from settings.speed at each app's root render (one app runs per page, so a shared global is fine).
const SPEED_MULT = { slow: 2, normal: 1, fast: 0.5 };
const SPEED_FLAT = { lightning: 32, instant: 0 };   // a fixed duration regardless of the base value
let SPEED = "normal";
function spd(ms) { if (ms <= 0) return ms; const flat = SPEED_FLAT[SPEED]; return flat != null ? flat : Math.round(ms * (SPEED_MULT[SPEED] ?? 1)); }
// Text-size floor: every font-size is `max(<px>px, var(--min-fs, 0px))`, so raising `--min-fs` (set
// on the app root from settings.textSize) only grows text below the floor.
const MIN_FS = { small: "0px", medium: "12px", large: "14px", xlarge: "16px" };

/* ---- settings + history storage (the shared cribbage:settings / cribbage:history) ---- */
const SETTINGS_KEY = "cribbage:settings";
const DEFAULT_SETTINGS = { players: 2, teams: 2, seats: [], names: [], speed: "normal", textSize: "large", counting: "auto", tapToSelect: true, autoCut: false, autoGo: false, warn: true, claimWarn: true, autoDeal: false, autoContinue: false, autoPlayOne: false, autoPlayBest: false, autoDiscardBest: false };
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

/* ---- the modal shell ---- */
// Shared segmented-button style (selected vs not).
const segStyle = (on) => ({
  flex: 1, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))",
  background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
  border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
});
// A centered overlay modal (backdrop + card).
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
// A collapsible settings section (header + chevron). Open state is local so toggling a setting
// inside it (which re-renders the panel) never collapses the section.
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
