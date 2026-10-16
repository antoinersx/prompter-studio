// Simulated speech against the matcher. Run: node test/follow.test.js
const { Follower, normalizePhrase } = require("../follow.js");

const SCRIPT = `I made $10,400 with memecoins in just one week following a simple strategy.
And I'm breaking down exactly how you can copy it.
Chasing hype and buying late is the fastest way to lose money.
The real upside comes from spotting early signals, and once you know what to look for, the plays practically line up.
This isn't about random moonshots or gambling on charts.
I'm showing you the full process I use, from finding early coins, to confirming real momentum, to locking in profits at the right time.
So you can trade with conviction, not hope. Let's get into it.`;

const S = normalizePhrase(SCRIPT);
let fails = 0, passes = 0;
function check(name, cond, info) {
  if (cond) { passes++; console.log("  ok  " + name); }
  else { fails++; console.log("  FAIL " + name + (info ? "  -> " + info : "")); }
}
function idx(phrase, from = 0) {          // index just AFTER the phrase's last word
  const p = normalizePhrase(phrase);
  for (let i = from; i <= S.length - p.length; i++)
    if (p.every((w, k) => S[i + k] === w)) return i + p.length;
  throw new Error("phrase not in script: " + phrase);
}

// Speaker feeds words one at a time; the recognizer keeps a rolling buffer.
function makeSession() {
  const f = new Follower(S);
  const heard = [];
  const events = [];
  return {
    f, events,
    say(text) {
      for (const w of normalizePhrase(text)) {
        heard.push(w);
        const ev = f.update(heard.slice(-12));
        if (ev) events.push(ev);
      }
    },
    silence(n = 5) { for (let i = 0; i < n; i++) { const ev = f.update(heard.slice(-12)); if (ev) events.push(ev); } },
  };
}

console.log("1. straight read");
{
  const s = makeSession();
  s.say(SCRIPT);
  check("reaches the end", s.f.cursor === S.length, `${s.f.cursor}/${S.length}`);
  check("no backward jumps", !s.events.some(e => e.type === "resay"));
}

console.log("2. recognizer writes numbers differently and garbles words");
{
  const s = makeSession();
  s.say("I made ten thousand four hundred with meme coins in just one weak following a simple strategy");
  check("tracks through number/garble", s.f.cursor === idx("following a simple strategy"), s.f.cursor + " vs " + idx("following a simple strategy"));
}

console.log("3. pause = hold");
{
  const s = makeSession();
  s.say("I made $10,400 with memecoins in just one week");
  const at = s.f.cursor;
  s.silence(20);
  check("cursor holds during silence", s.f.cursor === at);
}

console.log("4. joke in the middle = hold, then resume");
{
  const s = makeSession();
  s.say("Chasing hype and buying late is the fastest way to lose money".replace(/^/, SCRIPT.split("\n")[0] + " " + SCRIPT.split("\n")[1] + " "));
  const at = s.f.cursor;
  s.say("honestly my mom still asks me why I keep buying frogs on the internet it is a lot of frogs");
  check("cursor holds during the joke", s.f.cursor === at, `${at} -> ${s.f.cursor}`);
  s.say("The real upside comes from spotting early signals");
  check("resumes after the joke", s.f.cursor === idx("spotting early signals"), s.f.cursor + "");
}

console.log("5. joke that reuses script words does not jump");
{
  const s = makeSession();
  s.say(SCRIPT.split("\n").slice(0, 2).join(" "));
  const at = s.f.cursor;
  s.say("and the money thing is real you know the way it is");
  check("common words don't move it far", Math.abs(s.f.cursor - at) <= 1, `${at} -> ${s.f.cursor}`);
}

console.log("6. re-say the last sentence");
{
  const s = makeSession();
  s.say(SCRIPT.split("\n").slice(0, 3).join(" "));
  check("at end of line 3", s.f.cursor === idx("lose money"));
  s.say("wait let me say that again");
  s.say("Chasing hype and buying late is the fastest way");
  check("jumped back into the sentence", s.f.cursor === idx("chasing hype and buying late is the fastest way"), s.f.cursor + " vs " + idx("chasing hype and buying late is the fastest way"));
  check("logged a re-say", s.events.some(e => e.type === "resay"));
  s.say("to lose money. The real upside comes from spotting early signals");
  check("continues forward after re-say", s.f.cursor === idx("spotting early signals"));
}

console.log("7. stumble and restart the same phrase");
{
  const s = makeSession();
  s.say("I made $10,400 with memecoins in just one week following a");
  s.say("uh following a simple strategy");
  check("stays on track", s.f.cursor === idx("following a simple strategy"));
}

console.log("8. skip a sentence");
{
  const s = makeSession();
  s.say(SCRIPT.split("\n").slice(0, 2).join(" "));
  s.say("The real upside comes from spotting early signals");
  check("jumped ahead over the skipped sentence", s.f.cursor === idx("spotting early signals"), s.f.cursor + "");
  check("logged a skip", s.events.some(e => e.type === "skip"));
}

console.log("9. random talk at the start doesn't move it");
{
  const s = makeSession();
  s.say("okay testing one two can you hear me alright let's go");
  check("still at start", s.f.cursor <= 1, s.f.cursor + "");
  s.say("I made $10,400 with memecoins");
  check("then follows", s.f.cursor === idx("with memecoins"));
}

console.log("10. drop a word now and then");
{
  const s = makeSession();
  s.say("Chasing hype buying late is fastest way to lose money".replace(/^/, SCRIPT.split("\n").slice(0, 2).join(" ") + " "));
  check("follows despite dropped words", s.f.cursor === idx("lose money"), s.f.cursor + " vs " + idx("lose money"));
}

console.log("11. recognizer sends whole phrases at once (no false skip)");
{
  const f = new Follower(S); const heard = []; const events = [];
  for (const chunk of ["I made $10,400 with memecoins in just one week", "following a simple strategy. And I'm breaking down",
                       "exactly how you can copy it. Chasing hype and buying late"]) {
    heard.push(...normalizePhrase(chunk)); const ev = f.update(heard.slice(-16)); if (ev) events.push(ev);
  }
  check("follows chunked results", f.cursor === idx("chasing hype and buying late"), f.cursor + "");
  check("chunks are not logged as skips", !events.some(e => e.type === "skip"), JSON.stringify(events.map(e => e.type)));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
