/* Assembles index2.html — the combined single-page app (Home + Play + Trainer).
 *
 * Invoked by build.sh AFTER it has transpiled the two React apps to plain JS:
 *   node engine/build_spa.js <play.js> <trainer.js> <i18nHead.html> <landing.html> <out> <version>
 *
 * Strategy (see CLAUDE.md / the SPA plan): the two React apps share ~44 module-level
 * identifiers (T, Modal, tr, SPEED, the engine math, …) so each is wrapped in its OWN
 * IIFE — isolating those names — and exposes only its root component on window.__cribViews.
 * The vanilla landing's <style>, body markup and IIFE are lifted verbatim from
 * src/landing.html (single source of truth) into the Home view. A small hash router
 * (#/ , #/play , #/trainer) mounts one app at a time into #view-app, fresh each visit,
 * and shows/hides the static Home view. Navigation links/buttons are intercepted so the
 * page never reloads. The three pages stay independently deployable; this is additive.
 */
const fs = require("fs");

const [, , playJsPath, trainerJsPath, i18nHeadPath, landingPath, outPath, version, coreJsPath] = process.argv;
const read = (p) => fs.readFileSync(p, "utf8");

// Neutralise any literal "</script>" inside inlined JS so it can't close the host <script>.
const safe = (code) => code.replace(/<\/script>/gi, "<\\/script>");

const landing = read(landingPath);

// 1) The landing's <style> block (its CSS) → reused verbatim in the combined <head>.
const styleM = landing.match(/<style>[\s\S]*?<\/style>/i);
const landingStyle = styleM ? styleM[0] : "";

// 2) The landing body markup: everything between <body> and its (single) body <script>.
const bodyOpen = landing.indexOf("<body>") + "<body>".length;
const bodyScriptOpen = landing.indexOf("<script>", bodyOpen);
const bodyClose = landing.lastIndexOf("</body>");
const landingBody = landing.slice(bodyOpen, bodyScriptOpen);

// 3) The landing's body <script> (its IIFE) → runs once to drive the Home view.
const bodyScriptClose = landing.indexOf("</script>", bodyScriptOpen);
const landingScript = landing.slice(bodyScriptOpen + "<script>".length, bodyScriptClose);

const i18nHead = read(i18nHeadPath);

// Wrap a transpiled app in its own IIFE and publish its root component for the router.
const viewIife = (jsPath, component, key) =>
  `(function(){\n${safe(read(jsPath))}\nwindow.__cribViews=window.__cribViews||{};window.__cribViews[${JSON.stringify(key)}]=${component};\n})();`;

const playIife = viewIife(playJsPath, "CribbagePlay", "play");
const trainerIife = viewIife(trainerJsPath, "CribbageTrainer", "trainer");

// The hash router: mount one React view at a time; show/hide the static Home view;
// intercept the in-app navigation links/buttons so nothing ever reloads the page.
const router = `
(function () {
  var home = document.getElementById("view-home");
  var app = document.getElementById("view-app");
  var root = null;
  function unmount() { if (root) { try { root.unmount(); } catch (e) {} root = null; } app.innerHTML = ""; }
  function mount(view) {
    unmount();
    var comp = window.__cribViews && window.__cribViews[view];
    if (!comp) return;
    root = ReactDOM.createRoot(app);
    root.render(React.createElement(comp));
  }
  function show(route) {
    if (route === "play" || route === "trainer") {
      home.style.display = "none"; app.style.display = "";
      mount(route);                 // fresh mount each visit (reset-fresh)
    } else {
      unmount();
      app.style.display = "none"; home.style.display = "";
    }
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function route() {
    var h = (location.hash || "").replace(/^#\\/?/, "");
    show(h === "play" ? "play" : h === "trainer" ? "trainer" : "home");
  }
  window.__crib = window.__crib || {};
  window.__crib.goHome = function () { location.hash = "#/"; };
  window.__crib.go = function (v) { location.hash = "#/" + v; };
  // One shared, shell-level settings menu (core's SpaSettings). Every view's gear opens it.
  window.__crib.openSettings = function () { if (window.__cribOpenSettings) window.__cribOpenSettings(); };
  try { ReactDOM.createRoot(document.getElementById("spa-settings")).render(React.createElement(SpaSettings)); } catch (e) {}
  // Intercept the landing cards (play.html/trainer.html) and the apps' Home links (index.html).
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (href === "play.html") { e.preventDefault(); location.hash = "#/play"; }
    else if (href === "trainer.html") { e.preventDefault(); location.hash = "#/trainer"; }
    else if (href === "index.html") { e.preventDefault(); location.hash = "#/"; }
  });
  window.addEventListener("hashchange", route);
  route();
})();`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0f2417" />
<title>Cribbage</title>
${landingStyle}
<style>#view-app{min-height:100vh}</style>
<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
${i18nHead}</head>
<body>
<div id="view-home">${landingBody}</div>
<div id="view-app" style="display:none"></div>
<div id="spa-settings"></div>
<script>
${safe(read(coreJsPath))}
</script>
<script>
${safe(landingScript)}
</script>
<script>
${trainerIife}
</script>
<script>
${playIife}
</script>
<script>${router}
</script>
</body>
</html>
`;

fs.writeFileSync(outPath, html.replace(/__APP_VERSION__/g, version || "dev"));
const lines = html.split("\n").length;
console.log(`built ${outPath.split("/").pop()} (combined SPA, ${lines} lines)`);
