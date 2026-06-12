# New-Session Bootstrap — Cribbage Trainer

Paste this (with your PAT filled in) as the **first message** to a fresh Claude Code
session on the `vanderoi/cribbage-trainer` repo. It tells the session which GitHub
accounts/repos to use and how to deploy. Full project context lives in `CLAUDE.md`
(auto-loaded) and the build plan in `docs/cribbage-play-plan.md`.

---

## Task
Continue building the playable game (4-player cutthroat cribbage vs 3 AI + the
`index.html` welcome-page restructure). Follow `docs/cribbage-play-plan.md`. First,
fetch and check out the working branch — it has all the latest code:

```
git fetch origin claude/claude-md-review-m77h8q
git checkout claude/claude-md-review-m77h8q
```

## Repos & accounts
- **Dev repo (this session's clone):** `vanderoi/cribbage-trainer` — reached
  automatically via the session's GitHub integration. Push dev work to branch
  `claude/claude-md-review-m77h8q` on `origin`.
- **Deploy repo (the live site):** `ghug/cribbage-trainer` — a **separate, public**
  GitHub account (`ghug`), used only for deploy. NOT part of the session's
  integration; you reach it with the PAT below (inline in the push URL).
- **Live URL:** https://cribbage-trainer.gabrielhug.workers.dev
  (Cloudflare Workers Builds auto-deploys on every push to `ghug` `main`.)

## Deploy steps
1. Edit source in `src/`, then `./build.sh` (regenerates the root `*.html`).
2. Commit, push to the dev branch on `origin`.
3. Deploy by pushing to the `ghug` repo (no named remote; PAT goes inline — **never
   commit or log the real token**):

```
git push "https://x-access-token:PASTE_GHUG_PAT_HERE@github.com/ghug/cribbage-trainer.git" HEAD:main
```

### The PAT
A **fine-grained GitHub PAT for the `ghug` account**, scoped to **only**
`ghug/cribbage-trainer` → **Repository permissions → Contents: Read and write**.
It is never stored — paste a fresh/again-copied token into `PASTE_GHUG_PAT_HERE`
above each session. (Create at: github.com signed into the `ghug` account →
Settings → Developer settings → Fine-grained tokens.)

## Live smoke-test prerequisite (optional)
For the sandbox to `curl` the live URL itself (instead of you eyeballing in a
browser), add `*.gabrielhug.workers.dev` under the environment's
**Network access → Custom** (keep "Also include default list of common package
managers" ticked) BEFORE starting the session. Without it, requests to the live URL
return `host_not_allowed` and deploy checks must be done in a browser.

## Verify the engine/build in-sandbox (no network needed)
```
./build.sh                      # regenerates index.html / trainer.html / play.html
node engine/verify_players.js   # 2-/3-/4-handed regression + sanity
node engine/pegging.js          # pegging unit tests
node engine/breakdown.js        # scoring reconciliation + perfect-29
```
