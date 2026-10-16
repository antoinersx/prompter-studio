/*
 * format.js — "Format for prompter" for Prompter Studio.
 *
 * What broadcast prompter operators do by hand, done automatically:
 *   - one sentence per line start, blank line between paragraphs
 *   - long sentences broken at natural phrase boundaries (after commas,
 *     before "and / but / because / which…"), never in the middle of
 *     "the + noun", sized so every line fits the prompter screen
 *   - no one-word orphan lines
 *   - numbers, money, percentages and symbols written the way you say them
 *   - markdown, links and emoji removed; **bold** kept as *emphasis*
 *   - [stage directions] kept as cues (shown small, never read)
 */
(function () {
  "use strict";

  // ---------- numbers to spoken words ----------
  const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  function under100(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : ""); }
  function under1000(n) {
    const h = Math.floor(n / 100), r = n % 100;
    return [h ? ONES[h] + " hundred" : "", r || !h ? under100(r) : ""].filter(Boolean).join(" ");
  }
  function intWords(n) {
    if (n === 0) return "zero";
    if (n >= 1e15) return String(n).split("").map(d => ONES[+d]).join(" ");
    const parts = [];
    for (const [v, name] of [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
      if (n >= v) { parts.push(under1000(Math.floor(n / v)) + " " + name); n %= v; }
    }
    if (n) parts.push(under1000(n));
    return parts.join(" ");
  }
  function yearWords(y) {
    if (y >= 2000 && y <= 2009) return intWords(y);
    const hi = Math.floor(y / 100), lo = y % 100;
    return under100(hi) + " " + (lo === 0 ? "hundred" : lo < 10 ? "oh " + ONES[lo] : under100(lo));
  }
  function decimalWords(intStr, decStr) {
    const i = intWords(parseInt(intStr.replace(/,/g, ""), 10) || 0);
    return decStr ? i + " point " + decStr.split("").map(d => ONES[+d]).join(" ") : i;
  }
  function ordinal(words) {
    const m = words.match(/^(.*?)([a-z]+)$/); if (!m) return words;
    const irregular = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
    const w = m[2];
    return m[1] + (irregular[w] || (w.endsWith("y") ? w.slice(0, -1) + "ieth" : w + "th"));
  }
  const SCALE = { k: "thousand", m: "million", b: "billion", t: "trillion", bn: "billion", mm: "million" };

  // Spell out one whitespace-separated token. Returns the token unchanged if it isn't numeric.
  function spellToken(tok) {
    const m = tok.match(/^([("“'\[*_]*)(.*?)([)"”'\].,!?;:…*_]*)$/);
    const [, pre, core, post] = m;
    let c = core, out = null;
    let mm;
    if ((mm = c.match(/^~(.+)$/))) { const s = spellToken(mm[1]); return pre + (s !== mm[1] ? "about " + s : c) + post; }
    if ((mm = c.match(/^(-|\+)?(\$|€|£)(\d[\d,]*)(?:\.(\d+))?(k|m|b|t|bn|mm)?$/i))) {
      const cur = { "$": "dollars", "€": "euros", "£": "pounds" }[mm[2]];
      const sign = mm[1] === "-" ? "minus " : mm[1] === "+" ? "plus " : "";
      const scale = mm[5] ? SCALE[mm[5].toLowerCase()] : "";
      if (!scale && mm[4] && mm[4].length === 2 && +mm[4] > 0) {
        const cents = { dollars: "cents", euros: "cents", pounds: "pence" }[cur];
        out = `${sign}${intWords(parseInt(mm[3].replace(/,/g, ""), 10))} ${cur} and ${under100(+mm[4])} ${cents}`;
      } else {
        out = `${sign}${decimalWords(mm[3], scale ? mm[4] : (mm[4] && +mm[4] ? mm[4] : ""))}${scale ? " " + scale : ""} ${cur}`;
      }
    } else if ((mm = c.match(/^(-|\+)?(\d[\d,]*)(?:\.(\d+))?%$/))) {
      out = (mm[1] === "-" ? "minus " : mm[1] === "+" ? "plus " : "") + decimalWords(mm[2], mm[3]) + " percent";
    } else if ((mm = c.match(/^(\d[\d,]*)(?:\.(\d+))?(k|m|b|t|bn)$/i))) {
      out = decimalWords(mm[1], mm[2]) + " " + SCALE[mm[3].toLowerCase()];
    } else if ((mm = c.match(/^(\d+(?:\.\d+)?)x$/i))) {
      const [a, b] = mm[1].split(".");
      out = decimalWords(a, b) + "-X";
    } else if ((mm = c.match(/^(\d+)(st|nd|rd|th)$/i))) {
      out = ordinal(intWords(+mm[1]));
    } else if ((mm = c.match(/^(19|20)(\d\d)s$/))) {
      const y = yearWords(+(mm[1] + mm[2]));
      out = y.replace(/y$/, "ie") + "s";
    } else if ((mm = c.match(/^'(\d\d)s$/))) {
      out = under100(+mm[1]).replace(/y$/, "ie") + "s";
    } else if ((mm = c.match(/^(\d[\d,]*(?:\.\d+)?)[-–](\d[\d,]*(?:\.\d+)?)$/))) {
      const a = spellToken(mm[1]), b = spellToken(mm[2]);
      out = `${a} to ${b}`;
    } else if ((mm = c.match(/^(1[89]\d\d|20\d\d)$/))) {
      out = yearWords(+c);
    } else if ((mm = c.match(/^(\d[\d,]*)(?:\.(\d+))?$/)) && (!mm[1].includes(",") || /^\d{1,3}(,\d{3})+$/.test(mm[1]))) {
      out = decimalWords(mm[1], mm[2]);
    }
    return out == null ? tok : pre + out + post;
  }

  // ---------- text cleanup ----------
  const ABBREV = [
    [/(^|\s)&(\s|$)/g, "$1and$2"],
    [/\bvs\.?(?=\s)/gi, "versus"],
    [/\be\.g\.,?/gi, "for example,"],
    [/\bi\.e\.,?/gi, "that is,"],
    [/\betc\.?/gi, "and so on"],
    [/\bapprox\.?(?=\s)/gi, "about"],
    [/\bw\/(?=\s)/gi, "with"],
    [/\s*(→|->|=>)\s*/g, " to "],
    [/(\w)\s*\+\s*(\w)/g, "$1 plus $2"],
  ];

  function cleanLine(line, opts) {
    let s = line;
    s = s.replace(/`([^`]*)`/g, "$1");                                   // inline code
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");                           // images
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]*)\)/g, "$1");               // links -> text
    s = s.replace(/https?:\/\/\S+/g, "");                                 // bare URLs
    s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => "*" + (a || b) + "*");  // bold -> emphasis
    s = s.replace(/[\p{Extended_Pictographic}️‍]/gu, "");       // emoji
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    s = s.replace(/\s+—\s+|\s+–\s+|—/g, " — ");
    if (opts.spell) {
      for (const [re, rep] of ABBREV) s = s.replace(re, rep);
      // keep [cues] untouched, spell everything else
      s = s.split(/(\[[^\]]*\])/).map(seg => seg.startsWith("[") ? seg : seg.split(/(\s+)/).map(t => (/\S/.test(t) ? spellToken(t) : t)).join("")).join("");
    }
    return s.replace(/[ \t]+/g, " ").trim();
  }

  // ---------- sentences ----------
  const NO_SPLIT = /\b(mr|mrs|ms|dr|st|vs|jr|sr|inc|ltd|co|no|u\.s|u\.k|a\.m|p\.m)\.$/i;
  function sentences(par) {
    const words = par.split(/\s+/).filter(Boolean);
    const out = []; let cur = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i]; cur.push(w);
      const next = words[i + 1];
      const ends = /[.!?…]["')\]*]*$/.test(w) && !NO_SPLIT.test(w.replace(/["')\]*]+$/, ""));
      if (ends && next && /^["'(\[*]*[A-Z0-9$€£¿¡À-Ý]/.test(next)) { out.push(cur); cur = []; }
      else if (/^\[.*\]$/.test(w) && cur.length === 1 && next) { out.push(cur); cur = []; }   // standalone cue
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // ---------- phrase-aware line breaking ----------
  const CONJ = new Set("and but or so because which who that when while if although though since unless until whereas then yet nor where whether instead otherwise et mais ou donc car parce quand alors puis".split(" "));
  const PREP = new Set("to from with without into onto for about after before between through during over under against like than across around toward towards via by at on in of de du des avec pour dans sur sans".split(" "));
  const GLUE = new Set("the a an my your our their his her its this that these those to of in on at by for with from and or but is are was were be i we you they it he she not no very just so le la les un une des du de ce cette mon ton son".split(" "));
  const bare = w => w.toLowerCase().replace(/^[^a-z0-9à-ÿ]+|[^a-z0-9à-ÿ]+$/g, "");

  // penalty for breaking the line AFTER words[i]
  function breakPenalty(words, i) {
    const w = words[i], nx = words[i + 1];
    if (/^\[.*\]$/.test(w) || /^\[/.test(nx || "")) return 0;           // cues stand alone
    if (/[,;:]["')*]*$/.test(w) || /[.!?…]["')*]*$/.test(w)) return 0;
    if (nx === "—" || w === "—") return 0.5;
    const b = bare(nx || "");
    if (CONJ.has(b)) return 1.5;
    if (PREP.has(b)) return 3;
    if (b.length > 4 && /ing$/.test(b) && !GLUE.has(bare(w))) return 3;          // "… one week / following a …"
    if (GLUE.has(bare(w))) return 12;                                     // never strand "the" / "to"
    return 6;
  }

  function breakSentence(words, max) {
    const n = words.length;
    const len = (i, j) => { let L = 0; for (let k = i; k <= j; k++) L += words[k].length + (k > i ? 1 : 0); return L; };
    if (len(0, n - 1) <= max) return [words.join(" ")];
    // DP: best[j] = min cost to lay out words[0..j-1]
    const best = new Array(n + 1).fill(Infinity), prev = new Array(n + 1).fill(-1);
    best[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        const L = len(i, j - 1);
        if (L > max && j - 1 > i) break;
        const last = j === n;
        const slack = (max - L) / max;
        let c = last ? 0 : slack * slack * 10;
        if (!last) c += breakPenalty(words, j - 1);
        const nWords = j - i;
        if (nWords === 1 && n > 2 && !/^\[.*\]$/.test(words[i])) c += last ? 14 : 8;   // orphan word
        if (last && L < max * 0.25 && n > 3) c += 4;
        if (best[i] + c < best[j]) { best[j] = best[i] + c; prev[j] = i; }
      }
    }
    const lines = []; let j = n;
    while (j > 0) { const i = prev[j]; lines.unshift(words.slice(i, j).join(" ")); j = i; }
    return lines;
  }

  /**
   * Format a script for the prompter.
   * @param {string} text
   * @param {{maxChars?: number, spell?: boolean}} opts
   * @returns {{text: string, stats: object}}
   */
  function formatScript(text, opts) {
    const o = Object.assign({ maxChars: 32, spell: true }, opts || {});
    const max = Math.max(14, Math.min(60, o.maxChars | 0));
    const lines = String(text).replace(/\r/g, "").split("\n");
    const out = [];
    const stats = { sentences: 0, longSentences: [], lines: 0, sections: 0 };
    let para = [], inList = false;
    const pushBlank = () => { if (out.length && out[out.length - 1] !== "") out.push(""); };
    const flushPara = (blank = true) => {
      if (!para.length) return;
      const joined = para.join(" ");
      para = [];
      const sents = sentences(joined);
      for (const sw of sents) {
        const isCue = sw.length === 1 && /^\[.*\]$/.test(sw[0]);
        if (!isCue) {
          stats.sentences++;
          const wc = sw.filter(w => !/^\[.*\]$/.test(w)).length;
          if (wc > 25) stats.longSentences.push(sw.slice(0, 8).join(" ") + "…");
        }
        for (const l of breakSentence(sw, max)) { out.push(l); stats.lines++; }
      }
      if (blank) pushBlank();
    };
    for (const raw of lines) {
      let line = raw.trim();
      if (!line) { if (inList) { inList = false; pushBlank(); } flushPara(); continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushPara(); continue; }     // horizontal rules
      const h = line.match(/^#{1,6}\s*(.+)$/);
      if (h) {
        inList = false; flushPara(); pushBlank();
        out.push("# " + h[1].replace(/\*+/g, "").trim()); stats.sections++;
        continue;
      }
      // whole-line stage direction in (parentheses) or [brackets] -> cue
      const cue = line.match(/^[\[(]\s*(.+?)\s*[\])]$/);
      if (cue && /^(b-?roll|cut|show|pause|beat|laugh|smile|cam|camera|screen|insert|graphic|on screen|sfx|music|look|gesture|point|lower third|transition|zoom)/i.test(cue[1])) {
        inList = false; flushPara(); pushBlank(); out.push("[" + cue[1].toUpperCase() + "]"); pushBlank();
        continue;
      }
      // list items become their own lines
      const li = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
      if (li) {
        if (!inList) flushPara();
        inList = true;
        const words = cleanLine(li[1], o).split(/\s+/).filter(Boolean);
        if (words.length) { stats.sentences++; for (const l of breakSentence(words, max)) { out.push(l); stats.lines++; } }
        continue;
      }
      if (inList) { inList = false; pushBlank(); }
      const cl = cleanLine(line, o);
      // a line with no closing punctuation followed by a capitalised line is its own sentence
      // (bullet items that already lost their markers, titles typed as plain lines)
      if (para.length) {
        const prevLast = para[para.length - 1].split(" ").pop();
        if (!/[.!?…,;:—]["')*]*$/.test(prevLast) && /^["'*]*[A-ZÀ-Ý]/.test(cl) && !/^(I|I'm|I've|I'll|I'd)\b/.test(cl) &&
            !GLUE.has(bare(prevLast)) && !PREP.has(bare(prevLast)) && !CONJ.has(bare(prevLast))) flushPara(false);
      }
      para.push(cl);
    }
    flushPara();
    while (out.length && out[out.length - 1] === "") out.pop();
    return { text: out.join("\n") + "\n", stats };
  }

  const api = { formatScript, spellToken, breakSentence };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.Format = api;
})();
