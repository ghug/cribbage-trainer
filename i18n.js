/* Minimal, offline-first internationalization for the cribbage pages.
 *
 * Design (built to scale to ~200 languages without a bundler or network):
 *  - Each language is one self-registering file, locales/<code>.js, that calls
 *    cribbageLocale("<code>", { key: "translated phrase", ... }).
 *  - English (locales/en.js) is ALWAYS loaded as the source of truth and the fallback for
 *    any missing key, so a partially-translated language never shows blanks.
 *  - locales/index.js registers the catalogue of available languages for the picker.
 *  - The active language (localStorage "cribbage:lang") is pulled in *synchronously* at
 *    <head> parse time by i18nBootstrap() (a document.write <script> tag), so t() already
 *    resolves before the first render — no flash of English, no async wait.
 *  - Loading is via <script> tags only (exactly like the vendored React), so it works the
 *    same when served over the web and offline inside the APK (file:// assets, no fetch,
 *    no INTERNET permission). Only the picked language's file is ever loaded.
 *
 * Usage from app code:  t("some.key")  or  t("some.key", { name: "North" })   ({name} interpolates)
 * Switch language:      i18n.set(code); location.reload();
 */
(function () {
  var LANG_KEY = "cribbage:lang";
  var STRINGS = {};        // code -> { key: phrase }
  var LANGS = [];          // [{ code, name }]
  var current = "en";
  try { current = localStorage.getItem(LANG_KEY) || "en"; } catch (e) {}
  // A ?lang=<code> URL parameter pre-selects a language (e.g. share .../?lang=ru). It overrides
  // the stored choice and persists it (like the picker), then is stripped from the URL so a
  // later in-app switch isn't forced back to it on reload. Unknown codes fall back to English.
  try {
    var m = String(location.search || "").match(/[?&]lang=([A-Za-z-]+)/);
    if (m) {
      current = m[1];
      try { localStorage.setItem(LANG_KEY, current); } catch (e2) {}
      try {
        if (history && history.replaceState) {
          var s = location.search.replace(/([?&])lang=[A-Za-z-]+/, "$1").replace(/\?&/, "?").replace(/[?&]$/, "");
          history.replaceState(null, "", location.pathname + s + location.hash);
        }
      } catch (e3) {}
    }
  } catch (e) {}

  // A locale file registers its phrases (merged, so a file may be split if ever wanted).
  window.cribbageLocale = function (code, map) {
    STRINGS[code] = STRINGS[code] || {};
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) STRINGS[code][k] = map[k];
  };

  // locales/index.js registers the list of available languages for the picker.
  window.cribbageLanguages = function (list) { LANGS = list || []; };

  // Called once from <head>, right after en.js: synchronously load the active non-English
  // file so every t() during the first render already has its translations.
  window.i18nBootstrap = function () {
    var c = (current || "en").replace(/[^a-z0-9-]/gi, "");   // sanitize before injecting
    if (c && c !== "en") document.write('<script src="locales/' + c + '.js"><\/script>');
  };

  function lookup(key) {
    var s = STRINGS[current] && STRINGS[current][key];
    if (s == null) s = STRINGS.en && STRINGS.en[key];        // fall back to English…
    return s == null ? key : s;                              // …then to the key itself
  }

  // Translate a key, interpolating {placeholder} tokens from vars when given.
  window.t = function (key, vars) {
    var s = lookup(key);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  };

  window.i18n = {
    get lang() { return current; },
    languages: function () { return LANGS.slice(); },
    set: function (code) { try { localStorage.setItem(LANG_KEY, code); } catch (e) {} current = code; }
  };
})();
