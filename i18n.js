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
 * Switch language:      i18n.choose(code)   (live — no page reload; updates the URL + re-renders)
 * Re-render hook:       i18n.onChange(fn)   (each UI registers; called after the new locale loads)
 */
(function () {
  var LANG_KEY = "cribbage:lang";
  var STRINGS = {};        // code -> { key: phrase }
  var LANGS = [];          // [{ code, name }]
  var listeners = [];      // re-render callbacks, fired after a live language switch

  // The URL for a given language: non-English carries ?lang=<code> so the page is copy/shareable;
  // English strips it (kept clean). Preserves any other query params and the hash.
  function langURL(code) {
    var search = String(location.search || "").replace(/([?&])lang=[A-Za-z-]+/, "$1").replace(/\?&/, "?").replace(/[?&]$/, "");
    if (code && code !== "en") search = (search ? search + "&" : "?") + "lang=" + code;
    return location.pathname + search + location.hash;
  }

  // Map the browser/device language to a supported code (English fallback). Hardcoded because the
  // registered language list (index.js) isn't loaded this early. ADD A LINE HERE for a new language.
  function detectLang() {
    try {
      var ls = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
      for (var i = 0; i < ls.length; i++) {
        var l = String(ls[i] || "").toLowerCase();
        if (l.indexOf("zh") === 0) return "zh-Hans";   // any Chinese variant → Simplified (the only one)
        if (l.indexOf("es") === 0) return "es";
        if (l.indexOf("fr") === 0) return "fr";
        if (l.indexOf("ru") === 0) return "ru";
        if (l.indexOf("en") === 0) return "en";
      }
    } catch (e) {}
    return "en";
  }

  // Resolve the active language. Precedence: a ?lang=<code> URL param (share link) > the stored
  // choice > the browser/device language > English. The first two are EXPLICIT — persisted, and
  // mirrored into the URL bar so the page is copy/shareable. Auto-detect is NOT: it just follows
  // the browser, leaving the URL clean and unpersisted, until the user explicitly picks one.
  var current = "en", explicit = false;
  try { var stored = localStorage.getItem(LANG_KEY); if (stored) { current = stored; explicit = true; } } catch (e) {}
  try {
    var m = String(location.search || "").match(/[?&]lang=([A-Za-z-]+)/);
    if (m) { current = m[1]; explicit = true; try { localStorage.setItem(LANG_KEY, current); } catch (e2) {} }
  } catch (e) {}
  if (!explicit) current = detectLang();
  // Keep <html lang> in sync with the active language (a11y: screen-reader voice, hyphenation).
  // Called at resolve time and on every live switch. The served HTML ships lang="en"; this updates
  // it to the detected/chosen language at runtime.
  function applyHtmlLang(code) { try { if (document.documentElement) document.documentElement.setAttribute("lang", code || "en"); } catch (e) {} }
  applyHtmlLang(current);
  // Mirror an EXPLICIT language in the URL bar (non-English carries ?lang=, English strips it) so
  // it's copy/shareable — without a history entry. Skip on file:// (no URL bar in the APK) and for
  // auto-detect (a browser-default visitor keeps a clean URL).
  try {
    if (explicit && location.protocol !== "file:" && history && history.replaceState) {
      var want = langURL(current), nowU = location.pathname + (location.search || "") + (location.hash || "");
      if (want !== nowU) history.replaceState(null, "", want);
    }
  } catch (e) {}

  // A locale file registers its phrases (merged, so a file may be split if ever wanted).
  window.cribbageLocale = function (code, map) {
    STRINGS[code] = STRINGS[code] || {};
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) STRINGS[code][k] = map[k];
  };

  // locales/index.js registers the list of available languages for the picker.
  window.cribbageLanguages = function (list) { LANGS = list || []; };

  // Lazily load a locale file for a LIVE switch (after first paint), then call cb. English is
  // inlined and any already-loaded locale is in STRINGS, so those resolve immediately. Uses an
  // appended <script> (not document.write, which only works during the initial parse); the
  // relative src resolves under the page's directory, the same on the web and from file://.
  function loadLocale(code, cb) {
    if (!code || code === "en" || STRINGS[code]) { if (cb) cb(); return; }
    var s = document.createElement("script");
    s.src = "locales/" + code.replace(/[^a-z0-9-]/gi, "") + ".js";
    s.onload = s.onerror = function () { if (cb) cb(); };   // on failure, fall back to English
    document.head.appendChild(s);
  }

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
    set: function (code) { try { localStorage.setItem(LANG_KEY, code); } catch (e) {} current = code; applyHtmlLang(code); },
    // Register a re-render callback, fired (with the new code) after a live switch loads the locale.
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    // Pick a language LIVE — no page reload. Persist it, mirror it in the URL bar (replaceState,
    // no navigation), lazily load the locale, then flip `current` and notify the UIs to re-render.
    // `current` flips only after the file is in, so there's no flash of half-translated text.
    choose: function (code) {
      try { localStorage.setItem(LANG_KEY, code); } catch (e) {}
      try {
        if (location.protocol !== "file:" && history && history.replaceState) history.replaceState(null, "", langURL(code));
      } catch (e) {}
      loadLocale(code, function () {
        current = code;
        applyHtmlLang(code);
        for (var i = 0; i < listeners.length; i++) { try { listeners[i](code); } catch (e2) {} }
      });
    }
  };
})();
