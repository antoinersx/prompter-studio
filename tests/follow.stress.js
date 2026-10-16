// Stress: long script speed + random chatter using script vocabulary. Run: node tests/follow.stress.js
const { Follower, normalizePhrase } = require("../follow.js");
const fs = require("fs");
const base = fs.readFileSync(__dirname + "/follow.test.js", "utf8").match(/const SCRIPT = `([\s\S]*?)`/)[1];
// ~2,200 words, like a 15-minute video (base text repeated with numbered variations)
let long = ""; for (let i = 0; i < 21; i++) long += base.replace(/simple strategy/, `simple strategy number ${i + 1}`) + "\n";
const S = normalizePhrase(long);
const f = new Follower(S); const heard = [];
const t0 = Date.now(); let updates = 0;
for (const w of S) { heard.push(w); f.update(heard.slice(-12)); updates++; }
const ms = Date.now() - t0;
console.log(`script words: ${S.length}, cursor at end: ${f.cursor === S.length}, ${(ms / updates).toFixed(3)} ms per update`);

// random chatter: 30 bursts of 12 words sampled from the script's own vocabulary
const vocab = [...new Set(S)];
let maxMove = 0, rng = 7; const rand = n => (rng = (rng * 48271) % 2147483647) % n;
const g = new Follower(S); g.setCursor(500); const h = [];
for (let b = 0; b < 30; b++) {
  const at = g.cursor;
  for (let k = 0; k < 12; k++) { h.push(vocab[rand(vocab.length)]); g.update(h.slice(-12)); }
  maxMove = Math.max(maxMove, Math.abs(g.cursor - at));
}
console.log(`random chatter, biggest single-burst move: ${maxMove} words (cursor ${g.cursor})`);
process.exit(f.cursor === S.length && ms / updates < 5 && maxMove <= 4 ? 0 : 1);
