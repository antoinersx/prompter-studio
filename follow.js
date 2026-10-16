/*
 * follow.js — voice-follow matcher for Prompter Studio.
 *
 * Turns a stream of recognized words into a position in the script.
 * Rules:
 *   - Reading the script moves the cursor forward.
 *   - Silence moves nothing: the cursor holds.
 *   - Ad-libs (words not in the script) move nothing: the cursor holds.
 *   - Re-saying an earlier part (about 4+ words) jumps back there.
 *   - Skipping ahead (about 3+ words that match later text) jumps forward.
 * A single common word never moves the cursor on its own.
 */
(function () {
  "use strict";

  // ---------- normalization ----------
  const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  function under1000(n) {
    const out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)], "hundred"); n %= 100; }
    if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) out.push(ONES[n]); }
    else if (n > 0 || out.length === 0) out.push(ONES[n]);
    return out;
  }

  function intToWords(n) {
    if (n === 0) return ["zero"];
    if (n >= 1e12) return String(n).split("").map(d => ONES[+d]);
    const out = [];
    const scales = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
    for (const [v, name] of scales) {
      if (n >= v) { out.push(...under1000(Math.floor(n / v)), name); n %= v; }
    }
    if (n > 0) out.push(...under1000(n));
    return out;
  }

  // "$65,000" -> sixty five thousand ; "3.5" -> three point five ; "20%" -> twenty percent
  function numberToWords(tok) {
    const m = tok.match(/^(\d[\d,]*)(?:\.(\d+))?(%)?$/);
    if (!m) return null;
    const intPart = parseInt(m[1].replace(/,/g, ""), 10);
    if (!isFinite(intPart)) return null;
    const out = intToWords(intPart);
    if (m[2]) { out.push("point", ...m[2].split("").map(d => ONES[+d])); }
    if (m[3]) out.push("percent");
    return out;
  }

  function stripAccents(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  /** One raw token (as displayed) -> array of normalized words (may be empty). */
  function normalizeToken(raw) {
    let t = stripAccents(String(raw).toLowerCase());
    t = t.replace(/[’‘`]/g, "'");
    const out = [];
    for (let part of t.split(/[-–—/]+/)) {
      part = part.replace(/^[^a-z0-9$]+|[^a-z0-9%]+$/g, "");   // trim punctuation
      part = part.replace(/^\$/, "");
      if (!part) continue;
      const num = numberToWords(part);
      if (num) { out.push(...num); continue; }
      const mk = part.match(/^(\d+(?:\.\d+)?)(k|m|b)$/);        // 65k
      if (mk) {
        const n = numberToWords(mk[1]);
        if (n) { out.push(...n, { k: "thousand", m: "million", b: "billion" }[mk[2]]); continue; }
      }
      const w = part.replace(/'/g, "").replace(/[^a-z0-9]/g, "");
      if (w) out.push(w);
    }
    return out;
  }

  /** A phrase (recognizer output) -> normalized words. */
  function normalizePhrase(text) {
    return String(text).split(/\s+/).flatMap(normalizeToken);
  }

  const STOP = new Set(("a an the and or but if so of to in on at by for from with as is are was were be been " +
    "it its i im me my we our us you your youre he she they them their this that these those there here " +
    "do does did dont not no yes just very really can will would could should have has had " +
    "le la les un une des de du et ou en je tu il elle on nous vous ils au aux ce ca est pas que qui").split(" "));

  function weight(w) { return STOP.has(w) ? 0.4 : 1.0; }

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0]; prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  /** Fuzzy word equality that tolerates small recognizer errors. */
  function same(a, b) {
    if (a === b) return true;
    if (a + "s" === b || b + "s" === a) return true;
    if (a.length < 4 || b.length < 4) return false;
    if ((a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 4) return true;
    const maxLen = Math.max(a.length, b.length);
    return lev(a, b) <= (maxLen >= 8 ? 2 : 1);
  }

  // ---------- follower ----------
  const DEFAULTS = {
    tail: 12,         // heard words considered per update
    back: 80,         // how far back a re-say can jump (words)
    fwd: 40,          // how far ahead a skip can jump (words)
    normalMin: 1.4,   // score to advance 1-2 words
    normalFarMin: 2.4,// score to advance 3-4 words
    jumpMin: 3.0,     // score for a skip ahead or a re-say jump back
    jumpMargin: 0.5,  // a jump must beat "staying here" by this much
  };

  class Follower {
    /** @param {string[]} words normalized script words */
    constructor(words, opts) {
      this.S = words;
      this.n = words.length;
      this.o = Object.assign({}, DEFAULTS, opts || {});
      this.cursor = 0;   // index of the next script word to be read
    }

    setCursor(i) { this.cursor = Math.max(0, Math.min(this.n, i | 0)); }

    // score how well heard words (ending at heard[h]) align with script ending at S[e]
    // Score how well the heard words ending at heard[h] line up with the script ending at S[e].
    // Alignment runs backwards from that anchor pair. Matches earn their weight; script words
    // skipped, extra heard words (ums, ad-libs) and misheard words cost points, so only
    // contiguous reading scores high. Returns {s, c} (c = matched content words) or null.
    _score(H, h, e, boundary) {
      // boundary: only script words after this index count toward c (content matches)
      const S = this.S;
      if (!same(H[h], S[e])) return null;
      const anchorW = weight(S[e]);
      const anchorC = anchorW === 1 && e > boundary ? 1 : 0;
      const hs = Math.max(0, h - (this.o.tail - 1));
      const hp = H.slice(hs, h).reverse();           // heard before anchor, nearest first
      if (!hp.length || e === 0) return { s: anchorW, c: anchorC, lo: e };
      const ss = Math.max(0, e - (hp.length + 4));
      const sp = S.slice(ss, e).reverse();           // script before anchor, nearest first
      const R = hp.length, C = sp.length;
      const HGAP = 0.4, SUB = 0.3;
      const sgap = w => (STOP.has(w) ? 0.3 : 0.7);
      const F = [], N = [], L = [];
      for (let i = 0; i <= R; i++) { F.push(new Float64Array(C + 1)); N.push(new Int16Array(C + 1)); L.push(new Int32Array(C + 1).fill(e)); }
      for (let j = 1; j <= C; j++) F[0][j] = F[0][j - 1] - sgap(sp[j - 1]);
      for (let i = 1; i <= R; i++) F[i][0] = F[i - 1][0] - HGAP;
      let best = 0, bestC = 0, bestL = e;
      for (let i = 1; i <= R; i++) {
        for (let j = 1; j <= C; j++) {
          let v = F[i - 1][j] - HGAP, n = N[i - 1][j], l = L[i - 1][j];
          const g = F[i][j - 1] - sgap(sp[j - 1]);
          if (g > v) { v = g; n = N[i][j - 1]; l = L[i][j - 1]; }
          if (same(hp[i - 1], sp[j - 1])) {
            const w = weight(sp[j - 1]);
            const m = F[i - 1][j - 1] + w;
            if (m >= v) { v = m; n = N[i - 1][j - 1] + (w === 1 && e - j > boundary ? 1 : 0); l = e - j; }
          } else {
            const m = F[i - 1][j - 1] - SUB;
            if (m > v) { v = m; n = N[i - 1][j - 1]; l = L[i - 1][j - 1]; }
          }
          F[i][j] = v; N[i][j] = n; L[i][j] = l;
          if (v > best || (v === best && n > bestC)) { best = v; bestC = n; bestL = l; }
        }
      }
      return { s: anchorW + best, c: anchorC + bestC, lo: best > 0 ? bestL : e };
    }

    /**
     * Feed the most recent heard words (normalized, oldest first).
     * Returns null when the cursor holds, or {type, from, to, score}.
     */
    update(heard) {
      if (!heard || !heard.length || !this.n) return null;
      const H = heard.slice(-this.o.tail - 1);
      const o = this.o;
      const last = this.cursor - 1;
      let here = 0;
      const cands = [];
      const lo = Math.max(0, last - o.back);
      const hi = Math.min(this.n - 1, last + o.fwd);
      for (let ao = 0; ao <= 1; ao++) {
        const h = H.length - 1 - ao;
        if (h < 0) break;
        for (let e = lo; e <= hi; e++) {
          const r = this._score(H, h, e, e > last ? last : -1);
          if (!r) continue;
          const s = r.s - ao * 0.5;      // anchoring one word early (garbled last word) costs a bit
          const delta = e - last;
          if (delta >= -2 && delta <= 0) { here = Math.max(here, s); continue; }
          let type, ok, penalty;
          if (delta >= 1 && delta <= 4) {
            type = "advance"; penalty = 0;
            ok = (r.c >= (delta <= 2 ? 1 : 2) && s >= (delta <= 2 ? o.normalMin : o.normalFarMin)) ||
                 (delta === 1 && s >= 2.2);   // small next word, backed by an in-sequence read
          } else if (delta > 4 && r.lo <= last + 2) {
            // one long chunk of continuous reading from the cursor (recognizer sent several words at once)
            type = "advance"; penalty = 0; ok = r.c >= 2 && s >= o.normalFarMin;
          } else if (delta > 4) {
            type = "skip"; penalty = 1.0; ok = r.c >= 3 && s >= o.jumpMin;
          } else {
            type = "resay"; penalty = 1.0; ok = r.c >= 2 && s >= o.jumpMin;
          }
          if (ok) cands.push({ type, e, s, adj: s - penalty, dist: Math.abs(delta - 1) });
        }
      }
      let best = null;
      for (const c of cands) {
        if (c.type !== "advance" && c.s < here + o.jumpMargin) continue;
        if (!best || c.adj > best.adj + 1e-9 || (Math.abs(c.adj - best.adj) < 1e-9 && c.dist < best.dist)) best = c;
      }
      if (!best) return null;
      const from = this.cursor;
      this.cursor = best.e + 1;
      return { type: best.type, from, to: this.cursor, score: Math.round(best.s * 10) / 10 };
    }
  }

  const api = { Follower, normalizeToken, normalizePhrase, same, DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.Follow = api;
})();
