/* Shared SPA chrome for index2.html — ONE settings menu for all three views.
 *
 * The landing, play and trainer pages each ship their own copy of the global settings menu
 * (Modal + SettingsPanel + History/About). In the combined single-page app we host ONE live
 * menu here, at the shell level: <SpaSettings/> is mounted once by the router and every view's
 * gear opens it via window.__crib.openSettings (a tiny, window.__crib-guarded redirect in each
 * source, so the standalone pages are unaffected). Settings persist to the shared
 * cribbage:settings store; views re-read them on their next (fresh) mount.
 *
 * This file is self-contained (no imports): build.sh transpiles it with --jsx react and inlines
 * it in the SPA's global scope ahead of the per-app IIFEs. The two React apps keep their own
 * copies of this chrome for their standalone builds; those copies just go unused inside index2.
 *
 * The components below are lifted verbatim from CribbageTrainer.jsx (which itself shares them
 * "identically/verbatim" with CribbagePlay.jsx, per their source comments) so the menu looks and
 * behaves exactly like the one on the standalone pages.
 */

const T = {
  baize: "#1F423A", baizeHi: "#28534A",
  woodD: "#5E3F26", woodM: "#8A5E37", woodL: "#B9824B",
  pegRed: "#C8412B", pegIvory: "#ECDCB4",
  ivory: "#F6EFDE", ink: "#241D14", suitRed: "#A8362A",
  cream: "#ECE0C6", muted: "#C9BC9A", line: "rgba(236,224,182,0.16)",
  good: "#5FA47C", goodDeep: "#3F7E5E", selBlue: "#5B95C2",
};
const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const serif = "'Hoefler Text', 'Iowan Old Style', Georgia, 'Times New Roman', serif";
const tr = (k, v) => (typeof window !== "undefined" && window.t) ? window.t(k, v) : k;

// Text-size floor (shared with the apps). Applied to the document root so the shell menu and the
// static Home view respond live; the mounted React app reads its own floor on its next mount.
const MIN_FS = { small: "0px", medium: "12px", large: "14px", xlarge: "16px" };
const applyMinFs = (size) => { try { document.documentElement.style.setProperty("--min-fs", MIN_FS[size] || "0px"); } catch (e) {} };

/* ---- settings + history storage (the shared cribbage:settings / cribbage:history) ---- */
const SETTINGS_KEY = "cribbage:settings";
const DEFAULT_SETTINGS = { players: 2, teams: 2, seats: [], names: [], speed: "normal", textSize: "large", counting: "auto", tapToSelect: true, autoCut: false, autoGo: false, warn: true, claimWarn: true, autoDeal: false, autoContinue: false, autoPlayOne: false, autoPlayBest: false, autoDiscardBest: false };
function settingsAtDefaults(settings, skip) {
  for (const k in DEFAULT_SETTINGS) if (skip.indexOf(k) < 0 && settings[k] !== DEFAULT_SETTINGS[k]) return false;
  return true;
}
function loadSettings() { try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch (e) {} return { ...DEFAULT_SETTINGS }; }
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }
// At least one human among the active seats (seat 0 human by default) — gates the muggins rows.
function hasHumanSeat(settings) {
  const P = Math.max(2, Math.min(6, settings.players || 2));
  const seats = settings.seats || [];
  for (let i = 0; i < P; i++) { const v = seats[i]; if (v === "human" || (v == null && i === 0)) return true; }
  return false;
}
const HISTORY_KEY = "cribbage:history";
function loadHistory() { try { const r = localStorage.getItem(HISTORY_KEY); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch (e) {} }

/* ---- the modal shell + settings menu (verbatim from the apps) ---- */
function Modal({ onBackdrop, maxWidth = 380, padding = "20px", scroll = false, zIndex = 220, cardStyle, children }) {
  return (
    <div onClick={onBackdrop} style={{ position: "fixed", inset: 0, zIndex, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth, width: "100%", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding, boxShadow: "0 14px 44px rgba(0,0,0,0.55)", ...(scroll ? { maxHeight: "86vh", overflowY: "auto" } : null), ...cardStyle }}>
        {children}
      </div>
    </div>
  );
}
function ModalHeader({ title, onClose, closeLabel, mb = 12, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: mb, flex: "0 0 auto" }}>
      {children != null ? children : <span style={{ fontWeight: 700, fontSize: "max(17px, var(--min-fs, 0px))" }}>{title}</span>}
      <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))", fontWeight: 700 }}>{closeLabel || tr("common.done")}</button>
    </div>
  );
}
const segStyle = (on) => ({
  flex: 1, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: "max(11.5px, var(--min-fs, 0px))",
  background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
  border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
});
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
function SettingsPanel({ settings, onSet, onReset, onClose, onAbout, onHistory }) {
  const hasHumans = hasHumanSeat(settings);   // muggins needs at least one human
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [resetMsg, setResetMsg] = React.useState(false);   // "already at defaults" toast
  React.useEffect(() => { if (!resetMsg) return; const t = setTimeout(() => setResetMsg(false), 2600); return () => clearTimeout(t); }, [resetMsg]);
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

/* ---- the shell host: one live settings menu for the whole SPA ---- */
// Mounted once by the router into #spa-settings. window.__crib.openSettings opens it. Changes
// persist to cribbage:settings and apply the text-size floor live; the mounted view re-reads
// settings on its next fresh mount (the SPA resets each view on navigation).
function SpaSettings() {
  const [open, setOpen] = React.useState(false);
  const [about, setAbout] = React.useState(false);
  const [hist, setHist] = React.useState(false);
  const [settings, setSettings] = React.useState(loadSettings);
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    window.__cribOpenSettings = () => { setSettings(loadSettings()); setOpen(true); };
    const i = (typeof window !== "undefined") ? window.i18n : null;
    if (i && i.onChange) i.onChange(() => bump((v) => v + 1));   // live language switch
  }, []);
  const set = (k, v) => { const ns = { ...settings, [k]: v }; setSettings(ns); saveSettings(ns); if (k === "textSize") applyMinFs(v); };
  const reset = () => { const ns = { ...DEFAULT_SETTINGS, seats: settings.seats, names: settings.names }; setSettings(ns); saveSettings(ns); applyMinFs(ns.textSize); };
  if (!open && !about && !hist) return null;
  return (
    <>
      {open && <SettingsPanel settings={settings} onSet={set} onReset={reset}
        onClose={() => setOpen(false)} onAbout={() => setAbout(true)} onHistory={() => setHist(true)} />}
      {about && <AboutModal onClose={() => setAbout(false)} />}
      {hist && <HistoryModal onClose={() => setHist(false)} />}
    </>
  );
}
