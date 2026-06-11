# Cutthroat Cribbage Discard Trainer

An interactive trainer for optimal discarding in **4-player cutthroat cribbage**.
Deal a hand, pick your throw, and get a ranked, fully-explained breakdown of all
five discards — hand EV (exact over every cut), crib EV (Monte Carlo against a
calibrated opponent model), and pegging EV (simulated play), plus a board-position
mode that re-ranks for chasing points or protecting a lead.

## Files

- `index.html` — **the whole app, ready to run.** Open it in any browser; no build or install. This is the file to host if you ever want a public link.

- `src/CribbageTrainer.jsx` — the entire app (single React component, inline
  styles, no dependencies beyond React).
- `engine/` — Node verification scripts the engine was validated against
  (`pegging.js`, `breakdown.js`, `engine.js`, `calibrate_split.js`,
  `state.json`). Not imported by the app; run them to re-prove the math.
- `CLAUDE.md` — full project context and design decisions. **If you're an AI
  assistant picking this up, read CLAUDE.md first.**

## Run it (Vite)

```bash
npm create vite@latest cribbage-trainer -- --template react
# put src/CribbageTrainer.jsx in place, render <CribbageTrainer/> from main.jsx
npm install && npm run dev
```

For GitHub Pages, set `base: '/<repo-name>/'` in `vite.config.js`, run
`npm run build`, and publish `dist/`.

## Verify the engine

```bash
node engine/pegging.js       # pegging scoring unit tests + full-game sanity
node engine/breakdown.js     # show-scoring breakdown + perfect-29 check
```

See `CLAUDE.md` for the EV model, the calibrated discard distributions, the
per-rank "crib swing" reference numbers, known limitations, and next steps.
