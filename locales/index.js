/* The catalogue of available languages. As translations are added, append { code, name }
 * here — `name` written in the language's own script — and ship a matching locales/<code>.js.
 * The picker reads this list; English is always present as the fallback.
 *
 * This is where the eventual ~200 languages get listed (one tiny line each). Only the
 * picked language's locales/<code>.js is actually loaded, so the list staying long is cheap.
 */
cribbageLanguages([
  { code: "en", name: "English" },
  { code: "es", name: "Español" }
]);
