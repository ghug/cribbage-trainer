# spa/ — DEPRECATED (for now)

This directory holds the experimental **combined single-page app** (Home + Play + Trainer in one
page, `spa/index.html`). It is **deprecated for now**: it is no longer served on the live site
(`spa` is listed in the repo-root `.assetsignore`, so Cloudflare skips it), and it is not actively
maintained.

The shipping apps remain the three standalone pages at the repo root — `index.html` (landing),
`play.html`, and `trainer.html` — built from `src/` by `./build.sh`. The SPA here is a self-contained
fork (its own `src/`, `vendor/`, `i18n.js`, `locales/`, and `build.sh`) and does **not** affect them.

To revive it later: remove the `spa` line from `.assetsignore`, and rebuild with `bash spa/build.sh`.
