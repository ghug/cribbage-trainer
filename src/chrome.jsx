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

/* ---- shared components ---- */
// The card-face glyph (rank + two suit pips), byte-identical across the game's static card, its
// sprite face, and the trainer's card. The interactive/sizing WRAPPERS stay per-app (they differ);
// this is just the shared inner SVG. Render it inside a position:relative box sized to 68:96.
function CardGlyph({ card }) {
  return (
    <svg viewBox="0 0 68 96" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "block" }}>
      <text x="13" y="15" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="17" fill={isRed(card.s) ? T.suitRed : T.ink}>{rankLabel(card.r)}</text>
      <text x="13" y="30" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontWeight="700" fontSize="13" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
      <text x="34" y="49" textAnchor="middle" dominantBaseline="central" fontFamily={serif} fontSize="34" fill={isRed(card.s) ? T.suitRed : T.ink}>{SUIT[card.s]}</text>
    </svg>
  );
}
// Category breakdown bars (15s/pairs/runs/flush/nobs). `valW` widens the value column and `dec`
// gives decimal places — the game shows integer points (valW 30, dec 0), the trainer shows averages
// (valW 44, dec 2).
function CatBars({ cats, scale, color, valW = 30, dec = 0 }) {
  const max = Math.max(scale, ...cats, 0.001);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {cats.map((v, i) =>
        v < 0.005 ? null : (
          <div key={i} style={{ display: "grid", gridTemplateColumns: `58px 1fr ${valW}px`, gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: "max(11px, var(--min-fs, 0px))", color: T.muted }}>{catName(i)}</span>
            <span style={{ height: 7, background: "rgba(0,0,0,0.28)", borderRadius: 4, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(v / max) * 100}%`, background: color }} />
            </span>
            <span style={{ fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", textAlign: "right" }}>{dec ? v.toFixed(dec) : v}</span>
          </div>
        )
      )}
    </div>
  );
}

/* ---- settings / about / history modals ---- */
// Global language chooser (shared via window.i18n; switches live). Only shown when >1 language.
function LanguageRow() {
  const i = (typeof window !== "undefined") ? window.i18n : null;
  const langs = i ? i.languages() : [];
  if (!i || langs.length <= 1) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: "max(13.5px, var(--min-fs, 0px))" }}>{window.t ? window.t("common.language") : "Language"}</div>
      <select defaultValue={i.lang} onChange={(e) => i.choose(e.target.value)}
        style={{ marginTop: 7, fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.cream, background: "rgba(0,0,0,0.25)", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
        {langs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </div>
  );
}
// "About & feedback" entry at the bottom of Settings.
function AboutRow({ onAbout }) {
  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={onAbout} style={{
        width: "100%", padding: "10px", borderRadius: 9, cursor: "pointer",
        border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream,
        fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", fontWeight: 700,
      }}>{tr("settings.aboutFeedback")}</button>
    </div>
  );
}
// The About popup: open-source/public-domain note + a link to the GitHub repo. Reached from Settings.
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
        <div style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.cream, lineHeight: 1.6, marginBottom: 12 }}>{tr("about.line1")}</div>
        <div style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.cream, lineHeight: 1.6, marginBottom: 16 }}>{tr("about.line2")}</div>
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
// Game history modal — reads the shared cribbage:history store (clears it on request).
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
// The global settings menu, shared by both apps. Dual-contract: the Play game passes `dispatch`
// (reducer actions), the Trainer passes `onSet(k,v)`/`onReset()`. `hasHumans` is passed in (each app
// computes it its own way) and gates the muggins rows. The Done label + reset scope differ per host.
// `extraDirty` (Trainer only) lets a host flag host-local settings (e.g. the trainer's role/new-hand
// toggles) as non-default, so the reset isn't short-circuited to the "already at defaults" toast when
// only those differ. Play omits it (undefined → falsy), keeping its reducer path bit-for-bit unchanged.
function SettingsPanel({ settings, dispatch, onSet, onReset, onClose, onAbout, onHistory, hasHumans, extraDirty }) {
  const set = dispatch ? (k, v) => dispatch({ type: "SET_SETTING", key: k, value: v }) : onSet;
  const doReset = dispatch ? () => dispatch({ type: "RESET_SETTINGS" }) : onReset;
  const resetSkip = dispatch ? ["players", "teams", "seats", "names"] : ["seats", "names"];
  const doneLabel = dispatch ? tr("settings.continue") : tr("common.done");
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [resetMsg, setResetMsg] = React.useState(false);   // "already at defaults" toast
  React.useEffect(() => { if (!resetMsg) return; const t = setTimeout(() => setResetMsg(false), 2600); return () => clearTimeout(t); }, [resetMsg]);
  const tapReset = () => { if (settingsAtDefaults(settings, resetSkip) && !extraDirty) setResetMsg(true); else setConfirmReset(true); };
  const Row = ({ title, desc, k, options, disabled }) => (
    <div style={{ marginBottom: 14, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontWeight: 700, fontSize: "max(13.5px, var(--min-fs, 0px))" }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: "max(10.5px, var(--min-fs, 0px))", color: T.muted, margin: "2px 0 7px", lineHeight: 1.45 }}>{desc}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(([label, val]) => (
          <button key={String(val)} disabled={disabled} onClick={disabled ? undefined : () => set(k, val)} style={{ ...segStyle(settings[k] === val), cursor: disabled ? "default" : "pointer" }}>{label}</button>
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
      }}>{doneLabel}</button>
    </Modal>
    {confirmReset && (
      <Modal onBackdrop={() => setConfirmReset(false)} maxWidth={360} padding="18px" zIndex={230}>
        <div style={{ fontWeight: 700, fontSize: "max(16px, var(--min-fs, 0px))", marginBottom: 6 }}>{tr("settings.reset.title")}</div>
        <div style={{ fontFamily: mono, fontSize: "max(12px, var(--min-fs, 0px))", color: T.muted, lineHeight: 1.5, marginBottom: 16 }}>{tr("settings.reset.body")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setConfirmReset(false)} style={{ flex: 1, padding: "12px", borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer", background: "rgba(0,0,0,0.3)", color: T.cream, fontFamily: mono, fontSize: "max(13px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("common.cancel")}</button>
          <button onClick={() => { setConfirmReset(false); doReset(); }} style={{ flex: 1, padding: "12px", borderRadius: 9, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${T.pegRed}, #9c3120)`, color: T.ivory, fontFamily: mono, fontSize: "max(13px, var(--min-fs, 0px))", fontWeight: 700 }}>{tr("settings.reset.confirm")}</button>
        </div>
      </Modal>
    )}
    </>
  );
}
