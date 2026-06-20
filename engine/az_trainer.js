#!/usr/bin/env node
/* engine/az_trainer.js — the single TRAINER for parallel Cribbage Zero training.
 *
 * The one writer of the checkpoint: it consumes self-play shards produced by the workers
 * (engine/az_data/*.json), SGD-trains the net on them, republishes engine/az_checkpoint.json
 * (atomically), and deletes the consumed shards. Resumes from an existing checkpoint, or seeds a
 * fresh random net (tabula rasa) if none exists. Runs until no new shards arrive for `idle` ms.
 *
 * Run: node engine/az_trainer.js [hidden=48] [idleSec=20] [--eval]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { freshNet, loadCheckpoint, saveCheckpoint, train, evalVsRandom, makeRng } = require("./az_common.js");

const HID = parseInt(process.argv[2], 10) || 48;
const IDLE = (parseInt(process.argv[3], 10) || 20) * 1000;
const DO_EVAL = process.argv.includes("--eval");
const LR = 0.02, EPOCHS = 2, EVAL = 200, EVAL_EVERY = 20;
const CKPT = path.join(__dirname, "az_checkpoint.json");
const DATA = path.join(__dirname, "az_data");
fs.mkdirSync(DATA, { recursive: true });
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {} };
const rng = makeRng((Date.now() ^ 0x1234) >>> 0);

let ck = loadCheckpoint(CKPT), net, iter;
if (ck) { net = ck.net; iter = ck.iter; console.log(`[trainer] resuming @ iter ${iter} (hidden ${net.nHid})`); }
else { net = freshNet(HID); iter = 0; saveCheckpoint(CKPT, net, iter); console.log(`[trainer] fresh net (hidden ${HID}), initial checkpoint written`); }

const t0 = Date.now(); let lastData = Date.now(), consumed = 0;
for (;;) {
  const shards = fs.readdirSync(DATA).filter((f) => f.endsWith(".json"));
  if (shards.length === 0) {
    if (Date.now() - lastData > IDLE) break;
    sleep(500); continue;
  }
  let data = [];
  for (const f of shards) { const p = path.join(DATA, f); try { data = data.concat(JSON.parse(fs.readFileSync(p, "utf8"))); } catch (e) {} fs.unlinkSync(p); }
  const loss = train(net, data, EPOCHS, LR, rng);
  iter += 1; consumed += shards.length;
  saveCheckpoint(CKPT, net, iter);
  lastData = Date.now();
  let line = `[trainer] iter ${iter}: trained on ${shards.length} shards / ${data.length} samples, loss ${loss.toFixed(3)} [${((Date.now() - t0) / 1000).toFixed(0)}s]`;
  if (DO_EVAL && iter % EVAL_EVERY === 0) line += `  vs random ${(100 * evalVsRandom(net, EVAL, rng)).toFixed(1)}%`;
  console.log(line);
}
console.log(`[trainer] idle ${IDLE / 1000}s with no shards — stopping @ iter ${iter} (${consumed} shards consumed total)`);
