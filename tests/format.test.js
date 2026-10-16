// Run: node tests/format.test.js
const { formatScript, spellToken } = require("../format.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log("  ok  " + name); } else { fail++; console.log(`  FAIL ${name}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`); } };
const ok = (name, cond, info) => { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name + (info ? " -> " + info : "")); } };

console.log("numbers");
eq("money with commas", spellToken("$10,400"), "ten thousand four hundred dollars");
eq("money k", spellToken("$65k"), "sixty-five thousand dollars");
eq("money decimal scale", spellToken("$3.5M"), "three point five million dollars");
eq("money cents", spellToken("$4.99"), "four dollars and ninety-nine cents");
eq("percent", spellToken("20%"), "twenty percent");
eq("percent decimal", spellToken("0.5%"), "zero point five percent");
eq("negative percent", spellToken("-12%"), "minus twelve percent");
eq("year", spellToken("2026"), "twenty twenty-six");
eq("year 2008", spellToken("2008"), "two thousand eight");
eq("decade", spellToken("1990s"), "nineteen nineties");
eq("multiplier", spellToken("10x"), "ten-X");
eq("ordinal", spellToken("21st"), "twenty-first");
eq("range", spellToken("5-10"), "five to ten");
eq("trailing punctuation kept", spellToken("$10,400,"), "ten thousand four hundred dollars,");
eq("approx", spellToken("~$2B"), "about two billion dollars");
eq("plain number", spellToken("48"), "forty-eight");
eq("big plain", spellToken("1,250,000"), "one million two hundred fifty thousand");
eq("ticker left alone", spellToken("$BTC"), "$BTC");
eq("word left alone", spellToken("Solana"), "Solana");

console.log("layout");
const src = `## The Hook
I made **$10,400** with memecoins in just one week following a simple strategy, and I'm breaking down exactly how you can copy it because chasing hype and buying late is the fastest way to lose money.

(B-roll: wallet screenshot)
- Find early coins
- Confirm real momentum 🚀
Check [StalkChain](https://stalkchain.com) e.g. the top traders vs. the crowd.`;
const { text, stats } = formatScript(src, { maxChars: 30 });
console.log(text.split("\n").map(l => "       | " + l).join("\n"));
const lines = text.trim().split("\n");
ok("section kept as # line", lines[0] === "# The Hook");
ok("every line fits 30 chars", lines.every(l => l.length <= 30 || !l.includes(" ")), lines.filter(l => l.length > 30).join(" / "));
ok("emphasis kept", text.replace(/\s+/g, " ").includes("*ten thousand four hundred dollars*"));
ok("money spelled", !/\$\d/.test(text));
ok("no line ends on 'the' or 'to'", !lines.some(l => /\s(the|to|a|of)$/i.test(l)), lines.filter(l => /\s(the|to|a|of)$/i.test(l)).join(" / "));
ok("no one-word orphan lines (except cues/sections)", !lines.filter(l => l && !l.startsWith("#") && !l.startsWith("[")).some(l => !l.includes(" ")), lines.filter(l => l && !l.includes(" ")).join(" / "));
ok("stage direction became cue", text.includes("[B-ROLL: WALLET SCREENSHOT]"));
ok("bullets on own lines", lines.includes("Find early coins"));
ok("emoji removed", !/🚀/.test(text));
ok("link reduced to text, url gone", text.includes("StalkChain") && !text.includes("http"));
ok("abbreviations expanded", text.includes("for example,") && text.includes("versus"));
ok("long sentence flagged", stats.longSentences.length === 1, JSON.stringify(stats.longSentences));
ok("idempotent (formatting twice changes nothing)", formatScript(text, { maxChars: 30 }).text === text);

console.log("follow matcher still lines up after formatting");
{
  const { Follower, normalizePhrase } = require("../follow.js");
  const S = normalizePhrase(text.replace(/^#.*$/gm, "").replace(/\[[^\]]*\]/g, ""));
  const f = new Follower(S); const heard = [];
  for (const w of normalizePhrase("I made ten thousand four hundred dollars with memecoins in just one week following a simple strategy")) { heard.push(w); f.update(heard.slice(-16)); }
  ok("recognizer's spoken numbers match formatted script", f.cursor >= 17, f.cursor);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
