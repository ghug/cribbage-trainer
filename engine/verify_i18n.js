/* Key-parity lint for the i18n catalogues. Catches the bug classes the other harnesses
 * can't (they only exercise the pure engine): a key referenced in the app with no English
 * entry (which then renders as the raw key, e.g. "play.deal"), a translation key that
 * doesn't exist in en.js (a typo or a dead key), and an index.js language with no file.
 *
 * en.js is the source of truth; OTHER locales may omit keys (those fall back to English),
 * so missing keys in a translation are NOT errors. Run: node engine/verify_i18n.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// Load every locale file in a stub context, capturing each cribbageLocale/cribbageLanguages call.
const cats = {};
let langs = [];
global.cribbageLocale = (code, map) => { cats[code] = Object.assign(cats[code] || {}, map); };
global.cribbageLanguages = (list) => { langs = list || []; };
const localeDir = path.join(ROOT, "locales");
fs.readdirSync(localeDir).filter((f) => f.endsWith(".js") && f !== "index.js")
  .forEach((f) => require(path.join(localeDir, f)));
require(path.join(localeDir, "index.js"));

const en = cats.en || {};
const enKeys = new Set(Object.keys(en));
let problems = 0;
const fail = (msg) => { console.error("  ✗ " + msg); problems++; };

// 1) Translation keys that aren't in en.js (typo or dead key).
Object.keys(cats).forEach((code) => {
  if (code === "en") return;
  Object.keys(cats[code]).forEach((k) => { if (!enKeys.has(k)) fail(`locale ${code}: key "${k}" is not in en.js (typo or dead key)`); });
});

// 2) Every language listed in index.js must actually register a catalogue.
langs.forEach((l) => { if (!cats[l.code]) fail(`index.js lists "${l.code}" but locales/${l.code}.js registered nothing`); });
if (!cats.en) fail("locales/en.js registered no keys (it is the required source of truth)");

// 3) Every key referenced in the app (data-i18n attrs, t()/tr() calls) must exist in en.js.
const SRC = ["src/landing.html", "src/CribbagePlay.jsx", "src/CribbageTrainer.jsx", "src/spa/core.jsx"];
const PATTERNS = [
  /data-i18n(?:-html|-aria)?="([a-zA-Z0-9._]+)"/g,   // static HTML attributes
  /window\.t\(\s*["']([a-zA-Z0-9._]+)["']/g,          // React/JS: window.t("key")
  /\btr\(\s*["']([a-zA-Z0-9._]+)["']/g                // landing/React alias: tr("key")
];
const refs = {};
SRC.forEach((rel) => {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  PATTERNS.forEach((re) => { let m; while ((m = re.exec(txt))) (refs[m[1]] = refs[m[1]] || new Set()).add(rel); });
});
Object.keys(refs).forEach((k) => { if (!enKeys.has(k)) fail(`key "${k}" referenced in ${[...refs[k]].join(", ")} is missing from en.js (renders as the raw key)`); });

console.log(`\ni18n key check: ${enKeys.size} en keys, ${langs.length} languages, ${Object.keys(refs).length} app references — ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
