/*
 * parse.js — script model shared by the desktop app and the phone page.
 * Turns prompter-format text into tokens (what's shown) and normalized words
 * (what voice follow matches against).
 *   # Title      section (shown small, never read)
 *   [CUE]        stage direction (shown small, never read or matched)
 *   *word*       emphasis (underlined)
 */
(function () {
  "use strict";
  function parse(text, F) {
    F = F || window.Follow;
    const tokens = [], norm = [], normTok = [], sections = [], blocks = [];
    let para = null, sentNext = true, inCue = false, inEm = false;
    const flush = () => { if (para && para.length) blocks.push({ type: "para", start: para[0], end: para[para.length - 1] }); para = null; };
    for (const line of String(text).replace(/\r/g, "").split("\n")) {
      const tl = line.trim();
      if (!tl) { flush(); sentNext = true; continue; }
      const h = tl.match(/^#{1,6}\s*(.+)$/);
      if (h) { flush(); sections.push({ title: h[1].trim(), tok: tokens.length }); blocks.push({ type: "sec", title: h[1].trim(), tok: tokens.length }); sentNext = true; continue; }
      let firstInLine = true;
      if (!para) { para = []; sentNext = true; }
      for (let raw of tl.split(/\s+/)) {
        const i = tokens.length;
        const cue = inCue || raw.startsWith("[");
        if (raw.startsWith("[")) inCue = true;
        if (inCue && /\][.,!?;:]*$/.test(raw)) inCue = false;
        let em = false;
        if (!cue) {
          const opens = /^["“'(]*\*/.test(raw), closes = /\*["”')]*[.,!?;:…]*$/.test(raw);
          em = inEm || opens;
          if (opens && !closes) inEm = true; else if (closes) inEm = false;
          raw = raw.replace(/\*/g, "") || raw;
        }
        const nw = cue ? [] : F.normalizeToken(raw);
        tokens.push({ raw, i, cue, em, normStart: norm.length, normEnd: norm.length + nw.length, sent: !cue && sentNext, para: para.length === 0, br: firstInLine && para.length > 0, sec: sections.length - 1, el: null });
        for (const w of nw) { norm.push(w); normTok.push(i); }
        para.push(i);
        if (!cue) sentNext = /[.!?…]["”’')\]]*$/.test(raw);
        firstInLine = false;
      }
    }
    flush();
    return { tokens, norm, normTok, sections, blocks };
  }
  const api = { parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.ScriptModel = api;
})();
