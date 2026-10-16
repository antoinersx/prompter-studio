/* Prompter Studio — phone mode: one camera + voice-following teleprompter on the same screen. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const F = window.Follow, TEST = new URLSearchParams(location.search).has("test");
  const VERSION = "1.1.0-phone";

  // ---------- settings ----------
  const DEF = { script: "", mode: "voice", facing: "user", layout: "top", quality: "1080", font: 32, ph: 42, rl: 22, speed: 60, mirror: false, lang: "en-US" };
  const S = (() => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem("ps.phone") || "{}")); } catch { return { ...DEF }; } })();
  let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem("ps.phone", JSON.stringify(S)); } catch { /* private mode */ } }, 250); };

  // ---------- helpers ----------
  const pad = n => String(n).padStart(2, "0");
  const fmtClock = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const fmtTC = s => s == null ? "--:--.--" : `${pad(Math.floor(s / 60))}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  const fmtMB = b => (b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : Math.round(b / 1e6) + " MB");
  let toastT;
  function toast(msg, warn, ms = 4000) { const t = $("toast"); t.textContent = msg; t.className = warn ? "warn" : ""; t.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = "none"), ms); }

  // ---------- script model + prompter ----------
  let M = window.ScriptModel.parse(S.script, F), follower = new F.Follower(M.norm), curTok = 0, doneUpTo = 0;
  let tops = [], heights = [], pos = 0, target = 0, playing = false, hold = false, counting = false, lastTs = 0;
  const box = $("script");

  function applyStyle() {
    document.documentElement.style.setProperty("--ph", S.ph + "%");
    box.style.fontSize = S.font + "px";
    $("readline").style.top = S.rl + "%";
    $("flip").classList.toggle("mirror", !!S.mirror);
    document.body.classList.toggle("textonly", S.layout === "textonly");
    $("preview").classList.toggle("mirror", S.facing === "user");
    requestAnimationFrame(() => { measure(); snap(); });
  }

  function render() {
    box.textContent = "";
    for (const t of M.tokens) t.el = null;
    if (!M.tokens.length) { const p = document.createElement("div"); p.className = "para"; p.style.color = "#888"; p.textContent = "Tap ✎ Script to paste your text."; box.appendChild(p); }
    for (const b of M.blocks) {
      if (b.type === "sec") { const el = document.createElement("div"); el.className = "sec"; el.textContent = b.title; box.appendChild(el); continue; }
      const p = document.createElement("div"); p.className = "para";
      for (let i = b.start; i <= b.end; i++) {
        const t = M.tokens[i];
        if (t.br) p.appendChild(document.createElement("br")); else if (i > b.start) p.appendChild(document.createTextNode(" "));
        const s = document.createElement("span"); s.className = "w" + (t.cue ? " cue" : "") + (t.em ? " em" : ""); s.textContent = t.raw; t.el = s; p.appendChild(s);
      }
      box.appendChild(p);
    }
    doneUpTo = 0; paint(curTok, true); measure(); snap();
    const words = M.norm.length; $("wc").textContent = `${words} words · ~${fmtClock(words / 150 * 60)}`;
  }
  function measure() { tops = M.tokens.map(t => (t.el ? t.el.offsetTop : 0)); heights = M.tokens.map(t => (t.el ? t.el.offsetHeight : 0)); }
  function centerY(i) { if (!M.tokens.length) return 0; if (i >= M.tokens.length) { const k = M.tokens.length - 1; return tops[k] + heights[k] * 1.5; } return tops[i] + heights[i] / 2; }
  function tokAtY(y) {
    if (!M.tokens.length) return 0;
    let lo = 0, hi = M.tokens.length - 1, a = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (tops[m] <= y) { a = m; lo = m + 1; } else hi = m - 1; }
    while (a > 0 && tops[a - 1] === tops[a]) a--;
    if (a === M.tokens.length - 1 && y > tops[a] + heights[a] * 1.2) return M.tokens.length;
    return a;
  }
  const clampTok = i => Math.max(0, Math.min(M.tokens.length, i));
  function paint(i, force) {
    i = clampTok(i);
    const from = force ? 0 : Math.min(doneUpTo, i), to = force ? M.tokens.length : Math.max(doneUpTo, i) + 1;
    for (let k = from; k < Math.min(to, M.tokens.length); k++) { const el = M.tokens[k].el; if (!el) continue; el.classList.toggle("done", k < i); el.classList.toggle("cur", k === i && S.mode === "voice"); }
    doneUpTo = i;
  }
  function setTok(i) { i = clampTok(i); if (i !== curTok || doneUpTo !== i) { curTok = i; paint(i, false); } }
  function snap() { target = pos = centerY(curTok); }
  function gotoTok(i) {
    i = clampTok(i);
    if (S.mode === "voice") { follower.setCursor(M.tokens[i] ? M.tokens[i].normStart : M.norm.length); heard = []; interim = []; }
    setTok(i); paint(i, true); target = centerY(i); if (S.mode === "manual") pos = target;
  }
  const startOf = (i, f) => { for (let k = Math.min(i, M.tokens.length - 1); k >= 0; k--) if (M.tokens[k][f]) return k; return 0; };
  const nextFlag = (i, f) => { for (let k = i + 1; k < M.tokens.length; k++) if (M.tokens[k][f]) return k; return M.tokens.length; };
  const prevFlag = (i, f) => { for (let k = Math.min(i, M.tokens.length) - 1; k >= 0; k--) if (M.tokens[k][f]) return k; return 0; };
  function sentenceText(i) { if (!M.tokens.length) return ""; const s = startOf(Math.min(i, M.tokens.length - 1), "sent"), e = Math.min(nextFlag(s, "sent"), M.tokens.length); return M.tokens.slice(s, e).filter(t => !t.cue).map(t => t.raw).join(" "); }

  function loop(ts) {
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
    const ph = $("prompter").clientHeight, readY = ph * S.rl / 100;
    if (S.mode === "manual") {
      if (playing && !counting && !dragging) pos += S.speed * (S.font / 40) * dt;
      pos = Math.max(0, Math.min(pos, centerY(M.tokens.length)));
      if (!dragging) setTok(tokAtY(pos));
    } else if (!dragging) pos += (target - pos) * Math.min(1, dt * 7);
    box.style.transform = `translate3d(0, ${(readY - pos).toFixed(1)}px, 0)`;
    requestAnimationFrame(loop);
  }

  // drag the text to scroll back / forward
  let dragging = false, dragY = 0, dragPos = 0, moved = false;
  $("prompter").addEventListener("pointerdown", e => { dragging = true; moved = false; dragY = e.clientY; dragPos = pos; });
  window.addEventListener("pointermove", e => { if (!dragging) return; const dy = e.clientY - dragY; if (Math.abs(dy) > 8) moved = true; if (moved) pos = Math.max(0, dragPos - dy * (S.mirror ? 1 : 1)); });
  window.addEventListener("pointerup", () => {
    if (!dragging) return; dragging = false;
    if (moved) { const ph = $("prompter").clientHeight; gotoTok(tokAtY(pos)); void ph; }
    else togglePause();
  });

  // ---------- voice follow ----------
  let rec = null, wantSpeech = false, heard = [], interim = [], lastHeard = 0, speechOn = false;
  function startSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("This browser has no speech recognition. Use Manual scroll (Safari on iPhone needs Siri/Dictation turned on).", true, 6000); return; }
    wantSpeech = true; if (rec) return;
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = S.lang;
    r.onstart = () => { speechOn = true; };
    r.onresult = e => {
      const tmp = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], words = F.normalizePhrase(res[0].transcript);
        if (res.isFinal) { heard.push(...words); if (recording) take.transcript.push({ t: +now().toFixed(2), text: res[0].transcript.trim() }); }
        else tmp.push(...words);
      }
      if (heard.length > 60) heard = heard.slice(-60);
      interim = tmp; lastHeard = performance.now(); feed();
    };
    r.onerror = e => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Speech recognition isn't allowed. On iPhone: Settings › Siri › turn on Siri or Dictation, then reload. Manual scroll still works.", true, 7000);
      else if (e.error === "audio-capture") toast("Voice follow can't hear the mic on this phone while the camera records. Switch to Manual scroll.", true, 7000);
      else if (e.error === "network") toast("Voice follow needs an internet connection here. Manual scroll still works.", true, 6000);
    };
    r.onend = () => { rec = null; speechOn = false; if (wantSpeech && S.mode === "voice") setTimeout(() => { if (wantSpeech && !rec) startSpeech(); }, 200); };
    rec = r; try { r.start(); } catch { /* already started */ }
  }
  function stopSpeech() { wantSpeech = false; if (rec) { try { rec.abort(); } catch { /* ignore */ } } rec = null; speechOn = false; }
  function feed() {
    if (hold || S.mode !== "voice" || counting) return;
    const ev = follower.update(heard.concat(interim).slice(-16)); if (!ev) return;
    const t = ev.to >= M.norm.length ? M.tokens.length : M.normTok[ev.to];
    setTok(t); target = centerY(curTok);
    if (ev.type === "resay") mark("re-say", { auto: true }); else if (ev.type === "skip") mark("skip-ahead", { auto: true });
  }

  // ---------- camera ----------
  let stream = null;
  async function openCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    const q = S.quality === "720" ? { w: 720, h: 1280 } : { w: 1080, h: 1920 };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: S.facing }, width: { ideal: q.w }, height: { ideal: q.h }, aspectRatio: { ideal: 9 / 16 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      $("startHint").textContent = `Camera/mic blocked (${err.name}). On iPhone: Settings › Safari › Camera and Microphone › Allow, then reload.`;
      $("start").style.display = "flex"; return false;
    }
    $("preview").srcObject = stream;
    applyStyle();
    return true;
  }

  // ---------- recording ----------
  let recorder = null, recording = false, take = null, chunks = [], bytes = 0, opfs = null, writer = null, wakeLock = null;
  const now = () => (take ? (performance.now() - take.t0) / 1000 : 0);
  const MIMES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  function mark(type, extra) {
    if (!recording) return;
    take.markers.push(Object.assign({ t: +now().toFixed(2), type, sentence: sentenceText(curTok), wordIndex: curTok }, extra || {}));
  }

  async function startRec() {
    if (recording || !stream) return;
    const mime = MIMES.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    const vbr = S.quality === "1080hi" ? 10e6 : S.quality === "720" ? 3.5e6 : 6e6;
    const d = new Date();
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}_phone`;
    take = { name, started: d, t0: performance.now(), markers: [], transcript: [], mime, ext: mime.includes("mp4") ? ".mp4" : ".webm" };
    chunks = []; bytes = 0; writer = null;
    // try to stream the take to on-device storage instead of memory (long takes)
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(name + take.ext, { create: true });
      if (fh.createWritable) { writer = await fh.createWritable(); opfs = fh; }
    } catch { writer = null; opfs = null; }
    try { recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: vbr, audioBitsPerSecond: 192000 }); }
    catch (err) { toast(`Recording isn't supported here (${err.name}).`, true); return; }
    let chain = Promise.resolve();
    recorder.ondataavailable = e => {
      if (!e.data || !e.data.size) return; bytes += e.data.size;
      if (writer) { const blob = e.data; chain = chain.then(() => writer.write(blob)).catch(() => { chunks.push(blob); }); }
      else chunks.push(e.data);
    };
    take.done = new Promise(res => { recorder.onstop = () => chain.then(res); });
    recorder.start(1000);
    recording = true; document.body.classList.add("recording");
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
    mark("start");
    countdown();
  }
  function countdown() {
    const el = $("count"); counting = true; let n = 3; el.style.display = "flex"; el.textContent = n;
    const iv = setInterval(() => { n--; if (n <= 0) { clearInterval(iv); el.style.display = "none"; counting = false; if (S.mode === "manual") playing = true; heard = []; interim = []; } else el.textContent = n; }, 1000);
  }
  async function stopRec() {
    if (!recording) return;
    mark("stop"); recording = false; document.body.classList.remove("recording"); playing = false;
    try { recorder.stop(); } catch { /* ignore */ }
    await Promise.race([take.done, new Promise(r => setTimeout(r, 5000))]);
    try { wakeLock && (await wakeLock.release()); } catch { /* ignore */ }
    let file;
    if (writer) { try { await writer.close(); file = await opfs.getFile(); } catch { file = null; } }
    if (!file) file = new File(chunks, take.name + take.ext, { type: take.mime || "video/mp4" });
    else file = new File([file], take.name + take.ext, { type: take.mime || "video/mp4" });
    take.file = file; take.duration = now();
    const s = stream.getVideoTracks()[0].getSettings();
    take.meta = { app: "Prompter Studio (phone)", version: VERSION, take: take.name, started: take.started.toISOString(), durationSec: +((performance.now() - take.t0) / 1000).toFixed(2),
      files: { cam: { file: file.name, mime: take.mime, bytes: file.size, facing: S.facing, width: s.width, height: s.height, frameRate: s.frameRate } },
      prompter: { mode: S.mode, lang: S.lang }, note: "Single camera with its own audio. Markers are seconds from the start of the video file." };
    $("saveInfo").textContent = `${take.name}${take.ext} · ${fmtClock(take.meta.durationSec)} · ${fmtMB(file.size)}`;
    $("markers").innerHTML = take.markers.map(m => `<div>${fmtTC(m.t)} <b>${m.type.toUpperCase()}</b> ${m.sentence ? "“" + m.sentence.slice(0, 60).replace(/</g, "&lt;") + "”" : ""}</div>`).join("");
    openSheet("save");
  }
  function sideFiles() {
    const txt = (n, s, type = "text/plain") => new File([s], `${take.name}_${n}`, { type });
    return [
      txt("markers.json", JSON.stringify(take.markers, null, 2), "application/json"),
      txt("markers.txt", take.markers.map(m => `${fmtTC(m.t)}  ${m.type.toUpperCase().padEnd(12)}  ${m.sentence ? "“" + m.sentence + "”" : ""}`).join("\n") + "\n"),
      txt("transcript.json", JSON.stringify(take.transcript, null, 2), "application/json"),
      txt("script.md", S.script),
      txt("session.json", JSON.stringify(take.meta, null, 2), "application/json"),
    ];
  }
  async function share(files) {
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files }); return; } catch (err) { if (err.name === "AbortError") return; }
    }
    for (const f of files) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
  }

  // ---------- actions ----------
  function togglePause() {
    if (S.mode === "manual") playing = !playing; else { hold = !hold; if (!hold) { heard = []; interim = []; } }
    updateHud();
  }
  let lastRetake = 0, lastRetakeTarget = 0;
  function retake() {
    if (!M.tokens.length) return;
    const t = performance.now(); let s;
    if (t - lastRetake < 1500) s = startOf(Math.max(0, lastRetakeTarget - 1), "sent");
    else { s = startOf(Math.min(curTok, M.tokens.length - 1), "sent"); if (s === curTok || curTok >= M.tokens.length) s = startOf(Math.max(0, Math.min(curTok, M.tokens.length) - 1), "sent"); }
    lastRetake = t; lastRetakeTarget = s; gotoTok(s); mark("retake");
    if (!recording) toast("Back to the start of the sentence.", false, 1200);
  }
  function setMode(m) {
    S.mode = m; save(); playing = false; hold = false;
    segOn("mode", m);
    if (m === "voice") { follower.setCursor(M.tokens[curTok] ? M.tokens[curTok].normStart : M.norm.length); heard = []; interim = []; startSpeech(); } else stopSpeech();
    paint(curTok, true); snap(); updateHud();
  }
  function updateHud() {
    const st = $("state");
    st.textContent = S.mode === "voice" ? (hold ? "VOICE · HOLD" : speechOn ? "VOICE" : "VOICE · STARTING") : (playing ? "MANUAL" : "MANUAL · PAUSED");
    st.className = (hold || (S.mode === "manual" && !playing)) ? "hold" : "";
    $("holdLbl").textContent = S.mode === "voice" ? (hold ? "Release" : "Hold") : (playing ? "Pause" : "Play");
    $("vdot").className = "dot" + (speechOn ? (performance.now() - lastHeard < 600 ? " heard" : " on") : "");
    $("rectime").textContent = fmtClock(now()) + (recording ? ` · ${fmtMB(bytes)}` : "");
  }

  // ---------- sheets / inputs ----------
  function openSheet(id) { document.querySelectorAll(".sheet").forEach(s => s.classList.toggle("open", s.id === id)); }
  function closeSheets() { document.querySelectorAll(".sheet").forEach(s => s.classList.remove("open")); }
  function segOn(id, v) { document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle("on", b.dataset.v === v)); }
  function reparse() { const keep = curTok; M = window.ScriptModel.parse(S.script, F); follower = new F.Follower(M.norm); curTok = clampTok(keep); follower.setCursor(M.tokens[curTok] ? M.tokens[curTok].normStart : M.norm.length); render(); }
  const undo = [];
  function charsPerLine() {
    const probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
    probe.textContent = "The real upside comes from spotting early signals and once you know"; box.appendChild(probe);
    const avg = probe.offsetWidth / probe.textContent.length; probe.remove();
    return Math.max(12, Math.min(40, Math.floor(box.clientWidth / avg * 0.94)));
  }

  function bind() {
    const ta = $("text"); ta.value = S.script;
    let rt; ta.addEventListener("input", () => { S.script = ta.value; save(); clearTimeout(rt); rt = setTimeout(reparse, 400); });
    $("bFormat").onclick = () => {
      if (!S.script.trim()) return toast("Paste a script first.");
      const res = window.Format.formatScript(S.script, { maxChars: charsPerLine(), spell: true });
      if (res.text === S.script) return toast("Already formatted for this screen.");
      undo.push(S.script); ta.value = S.script = res.text; save(); reparse(); $("bUndo").disabled = false;
      toast(`Formatted for this screen.${res.stats.longSentences.length ? ` ${res.stats.longSentences.length} long sentence(s) to split.` : ""}`);
    };
    $("bUndo").onclick = () => { if (!undo.length) return; ta.value = S.script = undo.pop(); save(); reparse(); $("bUndo").disabled = !undo.length; };
    $("bLoad").onclick = () => $("file").click();
    $("file").onchange = async e => { const f = e.target.files[0]; if (!f) return; ta.value = S.script = await f.text(); save(); reparse(); };
    document.querySelectorAll("#mode button").forEach(b => (b.onclick = () => setMode(b.dataset.v)));
    document.querySelectorAll("#facing button").forEach(b => (b.onclick = async () => { if (recording) return toast("Stop recording first."); S.facing = b.dataset.v; save(); segOn("facing", S.facing); await openCamera(); }));
    document.querySelectorAll("#layout button").forEach(b => (b.onclick = () => { S.layout = b.dataset.v; save(); segOn("layout", S.layout); applyStyle(); }));
    $("quality").value = S.quality; $("quality").onchange = async e => { if (recording) return; S.quality = e.target.value; save(); await openCamera(); };
    const slider = (id, key, out, fmt) => { $(id).value = S[key]; $(out).textContent = fmt(S[key]); $(id).oninput = e => { S[key] = +e.target.value; $(out).textContent = fmt(S[key]); save(); applyStyle(); }; };
    slider("font", "font", "fsv", v => v + "px"); slider("ph", "ph", "phv", v => v + "%"); slider("rl", "rl", "rlv", v => v + "%"); slider("speed", "speed", "spv", v => String(v));
    $("mirror").checked = S.mirror; $("mirror").onchange = e => { S.mirror = e.target.checked; save(); applyStyle(); };
    $("lang").value = S.lang; $("lang").onchange = e => { S.lang = e.target.value; save(); if (rec) { stopSpeech(); startSpeech(); } };
    $("bScript").onclick = () => { if (recording) return toast("Stop recording to edit the script."); openSheet("setup"); };
    $("bDone").onclick = () => { closeSheets(); render(); };
    $("bRetake").onclick = retake;
    $("bKeep").onclick = () => { mark("keep"); toast(recording ? "★ Kept" : "Keep marks work while recording.", false, 900); };
    $("bHold").onclick = togglePause;
    $("rec").onclick = () => (recording ? stopRec() : startRec());
    $("bSaveVideo").onclick = () => share([take.file]);
    $("bSaveAll").onclick = () => share([take.file, ...sideFiles()]);
    $("bClose").onclick = closeSheets;
    $("bStart").onclick = async () => { if (await openCamera()) { $("start").style.display = "none"; if (S.mode === "voice") startSpeech(); if (!S.script.trim()) openSheet("setup"); } };
    let armed = 0;
    document.addEventListener("keydown", e => {
      if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) && e.target.type !== "range" && e.target.type !== "checkbox") return;
      const k = e.key; let h = true;
      if (k === "Enter" && e.shiftKey) { if (!recording) startRec(); else if (performance.now() - armed < 2000) stopRec(); else { armed = performance.now(); toast("Press again to stop."); } }
      else if (k === " " || k === "Enter") togglePause();
      else if (k === "r" || k === "R" || k === "PageUp") retake();
      else if (k === "k" || k === "K") mark("keep");
      else if (k === "ArrowDown" || k === "PageDown" || k === "ArrowRight") gotoTok(nextFlag(curTok, "sent"));
      else if (k === "ArrowUp" || k === "ArrowLeft") gotoTok(startOf(curTok, "sent") === curTok ? prevFlag(curTok, "sent") : startOf(curTok, "sent"));
      else h = false;
      if (h) e.preventDefault();
    });
    window.addEventListener("resize", () => { measure(); snap(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && recording) toast("Keep this screen open while recording — leaving the page can stop the camera.", true, 6000); });
  }

  // ---------- init ----------
  segOn("mode", S.mode); segOn("facing", S.facing); segOn("layout", S.layout);
  bind(); applyStyle(); render(); requestAnimationFrame(loop); setInterval(updateHud, 250);
  if (!navigator.mediaDevices || !window.MediaRecorder) $("startHint").textContent = "This browser can't record video. Use Safari on iPhone (iOS 15+) or Chrome on Android.";
  if (!window.isSecureContext) $("startHint").textContent = "Open this page over https (the camera is blocked on plain http).";

  if (TEST) window.__pp = { S, get M() { return M; }, get curTok() { return curTok; }, get recording() { return recording; }, get take() { return take; },
    openCamera, startRec, stopRec, retake, setMode, gotoTok, sideFiles, hear: t => { heard.push(...F.normalizePhrase(t)); feed(); }, charsPerLine };
})();
