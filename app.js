/* Prompter Studio — two-camera recorder with a voice-following teleprompter. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const F = window.Follow;
  const TEST = new URLSearchParams(location.search).has("test");
  const VERSION = "1.0.0";

  // ---------------- settings (remembered in this browser) ----------------
  const DEF = {
    script: "", wpm: 150, camA: "", camB: "", mic: "", res: "1920x1080", fps: "30", bitrate: 16,
    fontSize: 60, textWidth: 88, readLine: 33, speed: 70, mirror: false, lang: "en-US",
    onDevice: false, mode: "voice", takeName: "", spell: true,
  };
  const S = (() => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem("ps.settings") || "{}")); } catch { return { ...DEF }; } })();
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem("ps.settings", JSON.stringify(S)); } catch { /* storage unavailable */ } }, 300);
  }

  // folder handle survives reloads via IndexedDB
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("prompter-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    try { const db = await idb(); return await new Promise(res => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); }
    catch { return undefined; }
  }
  async function idbSet(k, v) {
    try { const db = await idb(); await new Promise(res => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = res; tx.onerror = res; }); }
    catch { /* ignore */ }
  }

  // ---------------- helpers ----------------
  const pad = n => String(n).padStart(2, "0");
  function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600); const m = Math.floor(sec / 60) % 60; return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(sec % 60); }
  function fmtTC(sec) { if (sec == null) return "--:--:--.--"; const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return `${pad(h)}:${pad(m)}:${s.toFixed(2).padStart(5, "0")}`; }
  function fmtMB(b) { return b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : Math.round(b / 1e6) + " MB"; }
  function slug(s) { return String(s || "take").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "take"; }
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ---------------- warnings ----------------
  const warnMap = new Map();
  function warn(key, text) { if (text) warnMap.set(key, text); else warnMap.delete(key); renderWarnings(); }
  function renderWarnings() { $("warnings").innerHTML = [...warnMap.values()].map(t => `<div>⚠ ${t}</div>`).join(""); }
  let toastTimer;
  function toast(text, ms = 5000) { $("notice").textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("notice").textContent = ""; }, ms); }

  // ---------------- script model ----------------
  let M = parseScript(S.script);
  let follower = new F.Follower(M.norm);
  let curTok = 0;

  function parseScript(text) { return window.ScriptModel.parse(text, F); }

  function tokForNorm(n) { return n >= M.norm.length ? M.tokens.length : M.normTok[n]; }
  function clampTok(i) { return Math.max(0, Math.min(M.tokens.length, i)); }

  function sentStartAtOrBefore(i) { for (let k = Math.min(i, M.tokens.length - 1); k >= 0; k--) if (M.tokens[k].sent) return k; return 0; }
  function nextFlag(i, flag) { for (let k = i + 1; k < M.tokens.length; k++) if (M.tokens[k][flag]) return k; return M.tokens.length; }
  function prevFlag(i, flag) { for (let k = Math.min(i, M.tokens.length) - 1; k >= 0; k--) if (M.tokens[k][flag]) return k; return 0; }
  function startOf(i, flag) { for (let k = Math.min(i, M.tokens.length - 1); k >= 0; k--) if (M.tokens[k][flag]) return k; return 0; }

  function sentenceText(i) {
    if (!M.tokens.length) return "";
    const s = startOf(Math.min(i, M.tokens.length - 1), "sent");
    const e = Math.min(nextFlag(s, "sent"), M.tokens.length);
    return M.tokens.slice(s, e).map(t => t.raw).join(" ");
  }

  function updateScriptStats() {
    const words = M.norm.length;
    $("wordCount").textContent = `${words.toLocaleString()} words`;
    $("estRuntime").textContent = `~${fmtClock(words / (S.wpm || 150) * 60)} at ${S.wpm} wpm`;
    $("sectionCount").textContent = `${M.sections.length} section${M.sections.length === 1 ? "" : "s"}`;
  }

  let reparseTimer;
  function onScriptEdited() {
    clearTimeout(reparseTimer);
    reparseTimer = setTimeout(() => {
      const keep = curTok;
      M = parseScript(S.script);
      follower = new F.Follower(M.norm);
      curTok = clampTok(keep);
      follower.setCursor(M.tokens[curTok] ? M.tokens[curTok].normStart : M.norm.length);
      heardReset();
      updateScriptStats();
      renderPrompter();
    }, 500);
  }

  // ---------------- format for prompter ----------------
  const undoStack = [];

  // How many characters fit on one prompter line at the current text size and width.
  function charsPerLine() {
    const d = pd();
    if (d) {
      const box = d.getElementById("script");
      const probe = d.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
      probe.textContent = "The real upside comes from spotting early signals and once you know what to look for";
      box.appendChild(probe);
      const avg = probe.offsetWidth / probe.textContent.length;
      probe.remove();
      if (avg > 0 && box.clientWidth > 0) return { n: Math.floor(box.clientWidth / avg * 0.94), measured: true };
    }
    // prompter not open: assume the Elgato Prompter's 1024-px-wide screen
    return { n: Math.floor(1024 * S.textWidth / 100 / (S.fontSize * 0.53) * 0.94), measured: false };
  }

  function formatNow() {
    if (!window.Format) return;
    if (!S.script.trim()) { toast("Paste a script first."); return; }
    const fit = charsPerLine();
    const max = Math.max(14, Math.min(40, fit.n));
    const res = window.Format.formatScript(S.script, { maxChars: max, spell: S.spell });
    if (res.text === S.script) { toast("Already formatted for this prompter size."); return; }
    undoStack.push(S.script); if (undoStack.length > 20) undoStack.shift();
    $("script").value = S.script = res.text; save(); onScriptEdited();
    $("undoFormat").disabled = false;
    const long = res.stats.longSentences.length;
    toast(`✓ Formatted: lines up to ${max} characters (${fit.measured ? "measured on your prompter" : "estimated for the Elgato screen — open the prompter for an exact fit"}).` +
      (long ? ` ${long} sentence${long > 1 ? "s are" : " is"} over 25 words — consider splitting: “${res.stats.longSentences[0]}”` : ""), long ? 12000 : 6000);
  }

  function undoFormat() {
    if (!undoStack.length) return;
    $("script").value = S.script = undoStack.pop(); save(); onScriptEdited();
    $("undoFormat").disabled = !undoStack.length;
    toast("Restored the script from before formatting.");
  }

  // ---------------- prompter window ----------------
  let pw = null, tops = [], heights = [], lastTs = 0, pos = 0, target = 0, playing = false, countdownActive = false, doneUpTo = 0;
  const pd = () => (pw && !pw.closed && pw.__psReady ? pw.document : null);

  function openPrompter(features) {
    if (pw && !pw.closed) { pw.focus(); return; }
    pw = window.open("prompter.html", "ps-prompter", features || "popup=yes,width=1024,height=600");
    if (!pw) { warn("popup", "Chrome blocked the prompter window. Click the pop-up icon in the address bar and allow pop-ups for this page."); return; }
    warn("popup");
    const onReady = () => {
      if (!pw || pw.closed || pw.__psReady) return;
      if (!pw.document.getElementById("script")) { setTimeout(onReady, 50); return; }
      pw.__psReady = true;
      pw.document.addEventListener("keydown", onKey);
      pw.addEventListener("resize", () => { measure(); retarget(true); });
      pw.addEventListener("pagehide", () => { stopSpeech(); updateSpeechPill(); });
      renderPrompter();
      lastTs = 0;
      pw.requestAnimationFrame(loop);
      if (S.mode === "voice") startSpeech();
    };
    pw.addEventListener("load", onReady);
    setTimeout(onReady, 300);
  }

  async function placePrompter() {
    if (!("getScreenDetails" in window)) { toast("This Chrome can't place windows on a screen. Drag the prompter window onto the prompter screen instead."); openPrompter(); return; }
    try {
      const sd = await window.getScreenDetails();
      const pick = sd.screens.find(s => /prompter|elgato/i.test(s.label || "")) ||
        sd.screens.filter(s => s !== sd.currentScreen).sort((a, b) => a.width * a.height - b.width * b.height)[0];
      if (!pick) { toast("Only one screen found. Is the prompter display connected?"); return; }
      const feat = `popup=yes,left=${pick.availLeft},top=${pick.availTop},width=${pick.availWidth},height=${pick.availHeight}`;
      if (pw && !pw.closed) { pw.moveTo(pick.availLeft, pick.availTop); pw.resizeTo(pick.availWidth, pick.availHeight); pw.focus(); }
      else openPrompter(feat);
      toast(`Prompter placed on "${pick.label || "second screen"}". Press F in it for full screen.`);
    } catch (err) {
      toast("Window placement was not allowed. Drag the prompter window onto the prompter screen instead.");
      openPrompter();
    }
  }

  function renderPrompter() {
    const d = pd(); if (!d) return;
    const box = d.getElementById("script");
    box.textContent = "";
    for (const t of M.tokens) t.el = null;
    if (!M.tokens.length) {
      const p = d.createElement("div"); p.className = "para"; p.style.color = "#777"; p.textContent = "Paste your script in the main window.";
      box.appendChild(p);
    }
    for (const b of M.blocks) {
      if (b.type === "sec") {
        const el = d.createElement("div"); el.className = "sec"; el.textContent = b.title; box.appendChild(el);
      } else {
        const p = d.createElement("div"); p.className = "para";
        for (let i = b.start; i <= b.end; i++) {
          const t = M.tokens[i];
          if (t.br) p.appendChild(d.createElement("br")); else if (i > b.start) p.appendChild(d.createTextNode(" "));
          const s = d.createElement("span"); s.className = "w" + (t.cue ? " cue" : "") + (t.em ? " em" : ""); s.textContent = t.raw; t.el = s; p.appendChild(s);
        }
        box.appendChild(p);
      }
    }
    applyPrompterStyle();
    doneUpTo = 0; paintTo(curTok, true);
    retarget(true);
  }

  function applyPrompterStyle() {
    const d = pd(); if (!d) return;
    const box = d.getElementById("script");
    box.style.fontSize = S.fontSize + "px";
    box.style.lineHeight = "1.3";
    box.style.width = S.textWidth + "%";
    d.getElementById("readline").style.top = S.readLine + "%";
    d.getElementById("flip").classList.toggle("mirror", !!S.mirror);
    measure();
  }

  function measure() {
    tops = M.tokens.map(t => (t.el ? t.el.offsetTop : 0));
    heights = M.tokens.map(t => (t.el ? t.el.offsetHeight : 0));
  }

  function centerY(i) {
    if (!M.tokens.length) return 0;
    if (i >= M.tokens.length) { const k = M.tokens.length - 1; return tops[k] + heights[k] * 1.5; }
    return tops[i] + heights[i] / 2;
  }

  // first token of the line sitting on the reading line
  function tokAtY(y) {
    if (!M.tokens.length) return 0;
    let lo = 0, hi = M.tokens.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    while (ans > 0 && tops[ans - 1] === tops[ans]) ans--;
    if (ans === M.tokens.length - 1 && y > tops[ans] + heights[ans] * 1.2) return M.tokens.length;
    return ans;
  }

  // colour words already read (dim) and the next word (amber, voice mode only)
  function paintTo(i, force) {
    i = clampTok(i);
    const from = force ? 0 : Math.min(doneUpTo, i), to = force ? M.tokens.length : Math.max(doneUpTo, i) + 1;
    for (let k = from; k < Math.min(to, M.tokens.length); k++) {
      const el = M.tokens[k].el; if (!el) continue;
      el.classList.toggle("done", k < i);
      el.classList.toggle("cur", k === i && S.mode === "voice");
    }
    doneUpTo = i;
  }

  function setCurTok(i) {
    i = clampTok(i);
    if (i === curTok && doneUpTo === i) return;
    curTok = i; paintTo(i, false);
  }

  function retarget(snap) {
    target = centerY(curTok);
    if (snap || S.mode === "manual") pos = target;
  }

  function loop(ts) {
    if (!pw || pw.closed) return;
    const d = pw.document;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
    const readY = pw.innerHeight * S.readLine / 100;
    if (S.mode === "manual") {
      if (playing && !countdownActive) pos += S.speed * (S.fontSize / 60) * dt;
      const maxPos = centerY(M.tokens.length);
      if (pos > maxPos) { pos = maxPos; playing = false; }
      if (pos < 0) pos = 0;
      setCurTok(tokAtY(pos));
    } else {
      pos += (target - pos) * Math.min(1, dt * 7);
    }
    d.getElementById("script").style.transform = `translate3d(0, ${(readY - pos).toFixed(1)}px, 0)`;
    pw.requestAnimationFrame(loop);
  }

  function gotoTok(i) {
    i = clampTok(i);
    if (S.mode === "voice") {
      follower.setCursor(M.tokens[i] ? M.tokens[i].normStart : M.norm.length);
      heardReset();
    }
    setCurTok(i);
    paintTo(i, true);
    target = centerY(i);
    if (S.mode === "manual") pos = target;
  }

  // ---------------- voice follow (Chrome speech recognition) ----------------
  let rec = null, speechWanted = false, voiceHold = false, finalWords = [], interimWords = [], lastHeard = 0, speechState = "off", localFailed = false;

  function heardReset() { finalWords = []; interimWords = []; }

  function startSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { warn("speech", "Voice follow needs Google Chrome. This browser has no speech recognition, so use Manual scroll."); return; }
    speechWanted = true;
    if (rec) return;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.maxAlternatives = 1; r.lang = S.lang;
    if (S.onDevice && !localFailed && "processLocally" in r) { try { r.processLocally = true; } catch { /* unsupported */ } }
    r.onstart = () => { speechState = "on"; warn("speech"); updateSpeechPill(); };
    r.onresult = onSpeech;
    r.onerror = e => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if ((e.error === "language-not-supported" || e.error === "service-not-allowed") && r.processLocally) {
        localFailed = true; toast("On-device speech isn't available for this language in your Chrome. Using Chrome's online speech instead.");
        return;
      }
      const msg = {
        "not-allowed": "Chrome blocked the microphone for speech. Allow the mic for this page.",
        "audio-capture": "Speech recognition can't hear a microphone. Check your Mac's input device.",
        "network": "Voice follow lost its connection (Chrome's speech runs online). Retrying… Manual scroll still works.",
      }[e.error] || "Speech recognition error: " + e.error;
      warn("speech", msg);
    };
    r.onend = () => {
      rec = null; speechState = "off"; updateSpeechPill();
      if (speechWanted && pw && !pw.closed && S.mode === "voice") setTimeout(() => { if (speechWanted && !rec) startSpeech(); }, 250);
    };
    rec = r;
    const track = micStream && micStream.getAudioTracks()[0];
    try { if (track) r.start(track.clone()); else r.start(); }
    catch { try { r.start(); } catch { /* already started */ } }
  }

  function stopSpeech() {
    speechWanted = false;
    if (rec) { try { rec.abort(); } catch { /* ignore */ } }
    rec = null; speechState = "off"; updateSpeechPill();
  }

  function onSpeech(e) {
    const interim = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0].transcript;
      const words = F.normalizePhrase(text);
      if (res.isFinal) {
        finalWords.push(...words);
        if (recording && text.trim()) session.transcript.push({ t: +nowSec().toFixed(2), text: text.trim() });
      } else interim.push(...words);
    }
    if (finalWords.length > 60) finalWords = finalWords.slice(-60);
    interimWords = interim;
    lastHeard = performance.now();
    feedHeard();
  }

  function feedHeard() {
    if (voiceHold || S.mode !== "voice" || countdownActive) return;
    const heard = finalWords.concat(interimWords).slice(-16);
    const ev = follower.update(heard);
    if (!ev) return;
    setCurTok(tokForNorm(follower.cursor));
    target = centerY(curTok);
    if (ev.type === "resay") mark("re-say", { auto: true, jumpedBackWords: ev.from - ev.to });
    else if (ev.type === "skip") mark("skip-ahead", { auto: true, skippedWords: ev.to - ev.from });
  }

  function updateSpeechPill() {
    const dot = $("speechDot");
    const heardRecently = performance.now() - lastHeard < 600;
    const on = speechState === "on";
    dot.className = "speechdot" + (on ? (heardRecently ? " heard" : " on") : "");
    $("speechPill").lastChild.textContent = S.mode !== "voice" ? "voice off" : voiceHold ? "voice on hold" : on ? "listening" : speechWanted ? "starting…" : "voice off";
    const d = pd();
    if (d) {
      d.getElementById("dot").className = "dot" + (on ? (heardRecently ? " heard" : " on") : "");
      const st = d.getElementById("state");
      st.textContent = S.mode === "voice" ? (voiceHold ? "VOICE · HOLD" : on ? "VOICE" : "VOICE · STARTING") : (playing ? "MANUAL" : "MANUAL · PAUSED");
      st.className = voiceHold || (S.mode === "manual" && !playing) ? "hold" : "";
    }
  }

  // ---------------- devices ----------------
  let camStreamA = null, camStreamB = null, micStream = null, audioCtx = null, analyser = null;
  const lastFrame = { A: 0, B: 0 };

  async function enableDevices() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach(t => t.stop());
    } catch (err) {
      warn("devices", "Camera/mic permission was refused. Click the camera icon in Chrome's address bar to allow it, then try again.");
      return;
    }
    warn("devices");
    await listDevices();
    await openStreams();
    $("enableDevices").textContent = "Refresh devices";
    $("deviceHint").textContent = "Pick cameras and mic below.";
  }

  async function listDevices() {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cams = devs.filter(d => d.kind === "videoinput" && d.deviceId);
    const mics = devs.filter(d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
    const fill = (sel, list, value, allowNone) => {
      sel.innerHTML = (allowNone ? `<option value="">— none —</option>` : "") +
        list.map((d, i) => `<option value="${d.deviceId}">${(d.label || "Device " + (i + 1)).replace(/</g, "&lt;")}</option>`).join("");
      if (list.some(d => d.deviceId === value)) sel.value = value;
    };
    if (!cams.some(d => d.deviceId === S.camA)) S.camA = cams[0] ? cams[0].deviceId : "";
    if (!cams.some(d => d.deviceId === S.camB)) S.camB = cams.find(d => d.deviceId !== S.camA)?.deviceId || "";
    if (!mics.some(d => d.deviceId === S.mic)) S.mic = mics[0] ? mics[0].deviceId : "";
    fill($("camA"), cams, S.camA, false);
    fill($("camB"), cams, S.camB, true);
    fill($("mic"), mics, S.mic, false);
    save();
    if (cams.length < 2) warn("cams", `Chrome sees ${cams.length} camera${cams.length === 1 ? "" : "s"}. Plug in the second camera and click Refresh devices.`);
    else warn("cams");
  }

  function videoConstraints(deviceId) {
    const [w, h] = S.res.split("x").map(Number);
    return { deviceId: { exact: deviceId }, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: +S.fps } };
  }

  async function openStreams() {
    if (recording) { toast("Stop recording before changing devices."); return; }
    [camStreamA, camStreamB, micStream].forEach(s => s && s.getTracks().forEach(t => t.stop()));
    camStreamA = camStreamB = micStream = null;
    try {
      if (S.camA) camStreamA = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(S.camA), audio: false });
    } catch (err) { warn("camA", `Camera A failed to open (${err.name}). Another app may be using it.`); }
    try {
      if (S.camB && S.camB !== S.camA) camStreamB = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(S.camB), audio: false });
    } catch (err) { warn("camB", `Camera B failed to open (${err.name}). Try another USB port, or lower the resolution.`); }
    if (S.camB && S.camB === S.camA) warn("camB", "Camera A and Camera B are the same device. Pick a different Camera B.");
    else if (camStreamB || !S.camB) warn("camB");
    if (camStreamA) warn("camA");
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.mic ? { exact: S.mic } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000 } });
      warn("mic");
    } catch (err) { warn("mic", `Microphone failed to open (${err.name}).`); }
    attachPreview("A", camStreamA); attachPreview("B", camStreamB);
    startMeter();
    if (rec) { stopSpeech(); if (S.mode === "voice" && pw && !pw.closed) startSpeech(); }
  }

  function attachPreview(key, stream) {
    const v = $("prev" + key);
    v.srcObject = stream || null;
    $("res" + key).textContent = "";
    if (!stream) return;
    const tr = stream.getVideoTracks()[0];
    const st = tr.getSettings();
    $("res" + key).textContent = `${st.width}×${st.height} @ ${Math.round(st.frameRate || 0)}`;
    tr.onended = () => { warn("cam" + key + "lost", `Camera ${key} disconnected!`); $("box" + key).classList.add("bad"); if (recording) mark(`camera-${key}-lost`); };
    $("box" + key).classList.remove("bad"); warn("cam" + key + "lost");
    lastFrame[key] = performance.now();
    if ("requestVideoFrameCallback" in v) {
      const tick = () => { lastFrame[key] = performance.now(); if (v.srcObject === stream) v.requestVideoFrameCallback(tick); };
      v.requestVideoFrameCallback(tick);
    }
  }

  function startMeter() {
    if (!micStream) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024;
      src.connect(analyser);
    } catch { analyser = null; }
  }
  const meterBuf = new Float32Array(1024);
  function meterTick() {
    if (analyser) {
      analyser.getFloatTimeDomainData(meterBuf);
      let sum = 0; for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i] * meterBuf[i];
      const db = 20 * Math.log10(Math.sqrt(sum / meterBuf.length) + 1e-8);
      $("meter").style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + "%";
    }
    requestAnimationFrame(meterTick);
  }

  // ---------------- recording ----------------
  let rootDir = null, recording = false, saving = false, session = null, stopArmedAt = 0;
  const VIDEO_MIMES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.4d0028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  const AUDIO_MIMES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  const pickMime = list => list.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  const extFor = m => (m.startsWith("video/mp4") ? ".mp4" : m.startsWith("audio/mp4") ? ".m4a" : ".webm");
  const nowSec = () => (session ? (performance.now() - session.t0) / 1000 : 0);

  // Writes the recording in closed ~10 s part files, so a crash loses at most a few seconds.
  // On stop, the parts are joined into one file and removed.
  class PartSink {
    constructor(dir, base, ext, type) { Object.assign(this, { dir, base, ext, type, parts: [], buf: [], bytes: 0, lastFlush: performance.now(), chain: Promise.resolve(), rescue: [], no: 0 }); }
    push(blob) {
      if (!blob || !blob.size) return;
      this.buf.push(blob); this.bytes += blob.size;
      if (performance.now() - this.lastFlush > 10000) this.flush();
    }
    flush() {
      this.lastFlush = performance.now();
      if (!this.buf.length) return;
      const blobs = this.buf; this.buf = [];
      const name = `${this.base}.part${String(++this.no).padStart(4, "0")}${this.ext}`;
      this.chain = this.chain.then(async () => {
        const fh = await this.dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        for (const b of blobs) await w.write(b);
        await w.close();
        this.parts.push(name);
      }).catch(err => {
        this.rescue.push(...blobs);
        warn("disk", `Writing to disk failed (${err.name}). The take is being kept in memory and will download when you stop.`);
      });
    }
    async finish(progress) {
      this.flush();
      await this.chain;
      const out = `${this.base}${this.ext}`;
      if (this.parts.length) {
        await joinParts(this.dir, this.parts, out, progress);
      }
      if (this.rescue.length) download(new Blob(this.rescue, { type: this.type }), `${this.base}-rescued${this.ext}`);
      return out;
    }
  }

  class MemorySink {
    constructor(name, type) { this.name = name; this.type = type; this.buf = []; this.bytes = 0; }
    push(blob) { if (blob && blob.size) { this.buf.push(blob); this.bytes += blob.size; } }
    async finish() { download(new Blob(this.buf, { type: this.type }), this.name); return this.name; }
  }

  async function joinParts(dir, parts, outName, progress) {
    const fh = await dir.getFileHandle(outName, { create: true });
    const w = await fh.createWritable();
    for (let i = 0; i < parts.length; i++) {
      const f = await (await dir.getFileHandle(parts[i])).getFile();
      await w.write(f);
      if (progress) progress(i + 1, parts.length);
    }
    await w.close();
    for (const p of parts) { try { await dir.removeEntry(p); } catch { /* leave it */ } }
  }

  async function writeText(dir, name, text, type = "text/plain") {
    const blob = new Blob([text], { type });
    if (!dir) { download(blob, `${session ? session.folderName + "_" : ""}${name}`); return; }
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob); await w.close();
  }

  async function ensurePermission(handle) {
    try {
      if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
      return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
    } catch { return false; }
  }

  async function pickFolder() {
    if (!window.showDirectoryPicker) { toast("This browser can't write to a folder. Use Google Chrome."); return; }
    try {
      rootDir = await window.showDirectoryPicker({ id: "prompter-studio", mode: "readwrite", startIn: "videos" });
      await idbSet("rootDir", rootDir);
      showFolder();
    } catch { /* cancelled */ }
  }
  function showFolder() {
    $("folderLabel").textContent = rootDir ? `Saving into: ${rootDir.name}/<take folder>` : "No folder chosen: files will download when you stop.";
  }

  async function startRecording() {
    if (recording || saving) return;
    if (!window.MediaRecorder) { toast("This browser can't record. Use Google Chrome."); return; }
    if (!camStreamA) { toast("Camera A isn't open. Click “Allow cameras and mic” first."); return; }
    let dir = null;
    const d = new Date();
    const folderName = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}_${slug(S.takeName)}`;
    if (rootDir) {
      if (await ensurePermission(rootDir)) {
        try { dir = await rootDir.getDirectoryHandle(folderName, { create: true }); }
        catch (err) { toast(`Couldn't create the take folder (${err.name}). Files will download instead.`); }
      } else toast("No permission to write to the recordings folder. Files will download instead.");
    }
    const vMime = pickMime(VIDEO_MIMES), aMime = pickMime(AUDIO_MIMES);
    const mic = micStream && micStream.getAudioTracks()[0];
    const plan = [
      { key: "camA", stream: camStreamA, label: $("camA").selectedOptions[0]?.textContent },
      { key: "camB", stream: camStreamB, label: $("camB").selectedOptions[0]?.textContent },
    ].filter(p => p.stream);
    session = { folderName, dir, started: d, t0: performance.now(), markers: [], transcript: [], tracks: {}, stopped: [] };
    const t0 = session.t0;
    const recs = [];
    const make = (key, stream, mime, opts, label) => {
      const ext = extFor(mime);
      const sink = dir ? new PartSink(dir, key, ext, mime) : new MemorySink(`${folderName}_${key}${ext}`, mime);
      const mr = new MediaRecorder(stream, Object.assign({ mimeType: mime }, opts));
      const info = { key, file: dir ? key + ext : sink.name, mime, label: label || "", startOffsetMs: null, sink, mr };
      if (stream.getVideoTracks()[0]) info.video = stream.getVideoTracks()[0].getSettings();
      mr.ondataavailable = e => sink.push(e.data);
      mr.onstart = () => { info.startOffsetMs = +(performance.now() - t0).toFixed(1); };
      mr.onerror = e => warn("rec" + key, `Recorder ${key} error: ${e.error ? e.error.name : "unknown"}`);
      info.done = new Promise(res => { mr.onstop = res; });
      session.tracks[key] = info; recs.push(mr);
    };
    for (const p of plan) {
      const tracks = [p.stream.getVideoTracks()[0]]; if (mic) tracks.push(mic.clone());
      make(p.key, new MediaStream(tracks), vMime, { videoBitsPerSecond: Math.round(S.bitrate * 1e6), audioBitsPerSecond: 256000 }, p.label);
    }
    if (mic) make("mic", new MediaStream([mic.clone()]), aMime, { audioBitsPerSecond: 320000 }, $("mic").selectedOptions[0]?.textContent);
    try { for (const mr of recs) mr.start(1000); }
    catch (err) { recs.forEach(r => { try { r.stop(); } catch { /* ignore */ } }); toast(`Recording failed to start (${err.name}).`); session = null; return; }
    recording = true;
    $("markerLog").innerHTML = "";
    mark("start");
    if (!camStreamB) toast("Recording with Camera A only (Camera B isn't open).");
    setRecUI();
    countdown();
  }

  function countdown() {
    const d = pd(); if (!d) return;
    const el = d.getElementById("count");
    countdownActive = true; let n = 3;
    el.style.display = "flex"; el.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(iv); el.style.display = "none"; countdownActive = false;
        if (S.mode === "manual") playing = true;
        heardReset(); updateSpeechPill();
      } else el.textContent = n;
    }, 1000);
  }

  async function stopRecording() {
    if (!recording) return;
    mark("stop");
    recording = false; saving = true; setRecUI();
    const duration = nowSec();
    const tracks = Object.values(session.tracks);
    for (const t of tracks) { try { if (t.mr.state !== "inactive") t.mr.stop(); } catch { /* ignore */ } }
    await Promise.all(tracks.map(t => Promise.race([t.done, new Promise(r => setTimeout(r, 4000))])));
    for (const t of tracks) t.mr.stream.getAudioTracks().forEach(tr => tr.stop());   // mic copies made for this take
    const files = {};
    for (const t of tracks) {
      try {
        const name = await t.sink.finish((i, n) => { $("statePill").textContent = `SAVING ${t.key} ${i}/${n}`; });
        files[t.key] = { file: name, mime: t.mime, bytes: t.sink.bytes, device: t.label, startOffsetMs: t.startOffsetMs, video: t.video || null };
      } catch (err) { warn("save" + t.key, `Saving ${t.key} failed: ${err.message || err.name}. Leftover .part files can be joined with “Repair a crashed take”.`); }
    }
    const dir = session.dir;
    const meta = {
      app: "Prompter Studio", version: VERSION, take: S.takeName || "", folder: session.folderName,
      started: session.started.toISOString(), durationSec: +duration.toFixed(2), files,
      sync: "All files start within a few ms (see startOffsetMs). Every camera file carries the same mic audio, so audio-waveform sync lines them up exactly.",
      prompter: { mode: S.mode, lang: S.lang, wpm: S.wpm },
    };
    try {
      await writeText(dir, "session.json", JSON.stringify(meta, null, 2), "application/json");
      await writeText(dir, "markers.json", JSON.stringify(session.markers, null, 2), "application/json");
      await writeText(dir, "markers.txt", session.markers.map(m => `${fmtTC(m.t)}  ${m.type.toUpperCase().padEnd(12)}  ${m.sentence ? "“" + m.sentence + "”" : ""}`).join("\n") + "\n");
      await writeText(dir, "transcript.json", JSON.stringify(session.transcript, null, 2), "application/json");
      await writeText(dir, "script.md", S.script);
    } catch (err) { warn("meta", `Saving the markers/transcript failed: ${err.name}`); }
    saving = false; setRecUI();
    const total = tracks.reduce((a, t) => a + t.sink.bytes, 0);
    toast(dir ? `✓ Saved ${fmtMB(total)} to ${rootDir.name}/${session.folderName}` : `✓ Saved ${fmtMB(total)} to Downloads`, 15000);
    playing = false; updateSpeechPill();
  }

  async function repairTake() {
    if (!window.showDirectoryPicker) return;
    let dir;
    try { dir = await window.showDirectoryPicker({ id: "prompter-studio-repair", mode: "readwrite" }); } catch { return; }
    const groups = {};
    for await (const [name] of dir.entries()) {
      const m = name.match(/^(.+)\.part(\d{4})(\.\w+)$/);
      if (m) (groups[m[1] + m[3]] = groups[m[1] + m[3]] || []).push(name);
    }
    const outs = Object.keys(groups);
    if (!outs.length) { toast("No .part files in that folder — nothing to repair."); return; }
    for (const out of outs) {
      const parts = groups[out].sort();
      let outName = out;
      try { await dir.getFileHandle(out); outName = out.replace(/(\.\w+)$/, "-repaired$1"); } catch { /* doesn't exist: fine */ }
      await joinParts(dir, parts, outName);
    }
    toast(`Repaired: ${outs.join(", ")}`);
  }

  function setRecUI() {
    $("statePill").className = "pill" + (recording ? " rec" : saving ? " saving" : "");
    $("statePill").textContent = recording ? "● REC" : saving ? "SAVING…" : "READY";
    $("recBtn").disabled = recording || saving;
    $("stopBtn").disabled = !recording;
    const d = pd(); if (d) d.getElementById("hud").classList.toggle("recording", recording);
  }

  // ---------------- markers ----------------
  function mark(type, extra) {
    const t = recording ? +nowSec().toFixed(2) : null;
    const m = Object.assign({ t, type, sentence: sentenceText(curTok), wordIndex: curTok }, extra || {});
    if (recording && session) session.markers.push(m);
    const row = document.createElement("div");
    row.innerHTML = `${fmtTC(t)} <b>${type.toUpperCase()}</b> ${m.sentence ? "“" + m.sentence.slice(0, 70).replace(/</g, "&lt;") + (m.sentence.length > 70 ? "…" : "") + "”" : ""}`;
    const log = $("markerLog");
    if (log.firstChild && !recording && log.children.length === 1 && !log.firstChild.querySelector("b")) log.textContent = "";
    log.prepend(row);
  }

  // ---------------- actions ----------------
  let lastRetake = 0, lastRetakeTarget = 0;
  function retake() {
    if (!M.tokens.length) return;
    let s;
    const now = performance.now();
    if (now - lastRetake < 1500) s = sentStartAtOrBefore(Math.max(0, lastRetakeTarget - 1));
    else {
      s = sentStartAtOrBefore(Math.min(curTok, M.tokens.length - 1));
      if (s === curTok || curTok >= M.tokens.length) s = sentStartAtOrBefore(Math.max(0, Math.min(curTok, M.tokens.length) - 1));
    }
    lastRetake = now; lastRetakeTarget = s;
    gotoTok(s);
    mark("retake");
  }

  function setMode(m) {
    S.mode = m; save();
    document.querySelectorAll("#modeSeg button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
    $("modePill").textContent = m === "voice" ? "VOICE FOLLOW" : "MANUAL";
    playing = false; voiceHold = false;
    if (m === "voice") {
      follower.setCursor(M.tokens[curTok] ? M.tokens[curTok].normStart : M.norm.length);
      heardReset();
      if (pw && !pw.closed) startSpeech();
    } else {
      stopSpeech();
    }
    paintTo(curTok, true);
    retarget(true);
    updateSpeechPill();
  }

  function setFont(px) { S.fontSize = Math.max(28, Math.min(120, px)); $("fontSize").value = S.fontSize; $("fontVal").textContent = S.fontSize + "px"; save(); applyPrompterStyle(); retarget(true); }

  function onKey(e) {
    const tag = (e.target && e.target.tagName) || "";
    if (/^(TEXTAREA|INPUT|SELECT)$/.test(tag) && e.target.type !== "range" && e.target.type !== "checkbox") return;
    const k = e.key;
    let handled = true;
    if (k === "Enter" && e.shiftKey) {
      if (!recording) startRecording();
      else if (performance.now() - stopArmedAt < 2000) { stopArmedAt = 0; stopRecording(); }
      else { stopArmedAt = performance.now(); toast("Press Shift+Enter again within 2 seconds to stop recording."); }
    } else if (k === " ") {
      if (S.mode === "manual") playing = !playing;
      else { voiceHold = !voiceHold; if (!voiceHold) heardReset(); }
      updateSpeechPill();
    } else if (k === "r" || k === "R") retake();
    else if (k === "k" || k === "K") mark("keep");
    else if (k === "ArrowUp") gotoTok(e.shiftKey ? (curTok > 0 && M.tokens[curTok - 1] && startOf(curTok, "para") === curTok ? prevFlag(curTok, "para") : startOf(curTok, "para")) : (startOf(curTok, "sent") === curTok ? prevFlag(curTok, "sent") : startOf(curTok, "sent")));
    else if (k === "ArrowDown") gotoTok(nextFlag(curTok, e.shiftKey ? "para" : "sent"));
    else if (k === "ArrowLeft") { S.speed = Math.max(10, S.speed - 10); syncSpeed(); }
    else if (k === "ArrowRight") { S.speed = Math.min(300, S.speed + 10); syncSpeed(); }
    else if (/^[1-9]$/.test(k) && !e.metaKey && !e.ctrlKey) {
      const sec = M.sections[+k - 1];
      if (sec) { gotoTok(sec.tok); mark("section", { section: sec.title }); }
    } else if (k === "v" || k === "V") setMode(S.mode === "voice" ? "manual" : "voice");
    else if (k === "[") setFont(S.fontSize - 4);
    else if (k === "]") setFont(S.fontSize + 4);
    else if (k === "m" || k === "M") { S.mirror = !S.mirror; $("mirror").checked = S.mirror; save(); applyPrompterStyle(); }
    else if (k === "f" || k === "F") {
      const doc = e.view ? e.view.document : document;
      if (doc !== document) { if (!doc.fullscreenElement) doc.documentElement.requestFullscreen().catch(() => {}); else doc.exitFullscreen(); }
      else handled = false;
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  function syncSpeed() { $("speed").value = S.speed; $("speedVal").textContent = S.speed; save(); }

  // ---------------- control-window status ----------------
  function statusTick() {
    const el = recording ? nowSec() : 0;
    $("clock").textContent = fmtClock(el);
    const bytes = session ? Object.values(session.tracks).reduce((a, t) => a + t.sink.bytes, 0) : 0;
    $("sizePill").textContent = fmtMB(recording || saving ? bytes : 0);
    const d = pd(); if (d) d.getElementById("recTime").textContent = fmtClock(el);
    const total = M.tokens.length;
    $("progress").textContent = total ? `${Math.round(curTok / total * 100)}% through` : "";
    const left = M.norm.length - (M.tokens[curTok] ? M.tokens[curTok].normStart : M.norm.length);
    $("timeLeft").textContent = total ? `~${fmtClock(left / (S.wpm || 150) * 60)} of script left` : "";
    const t = M.tokens[Math.min(curTok, total - 1)];
    $("sectionNow").textContent = t && t.sec >= 0 ? `Section: ${M.sections[t.sec].title}` : "";
    // live sentence
    if (total) {
      const s = startOf(Math.min(curTok, total - 1), "sent"), e = Math.min(nextFlag(s, "sent"), total);
      const esc = x => x.replace(/</g, "&lt;");
      const said = M.tokens.slice(s, Math.min(curTok, e)).map(t => t.raw).join(" ");
      const next = curTok < e ? M.tokens[curTok].raw : "";
      const rest = M.tokens.slice(Math.min(curTok + 1, e), e).map(t => t.raw).join(" ");
      $("nowLine").innerHTML = `<span class="said">${esc(said)}</span> <span class="next">${esc(next)}</span> ${esc(rest)}`;
    }
    // frame watchdog while recording
    if (recording) {
      for (const key of ["A", "B"]) {
        const stream = key === "A" ? camStreamA : camStreamB;
        if (!stream) continue;
        const stale = performance.now() - lastFrame[key] > 2500 && !document.hidden;
        $("box" + key).classList.toggle("bad", stale);
        if (stale && !warnMap.has("frozen" + key)) { warn("frozen" + key, `Camera ${key} stopped sending frames. Check its cable.`); mark(`camera-${key}-frozen`); }
        if (!stale) warn("frozen" + key);
      }
    }
    updateSpeechPill();
  }

  // ---------------- wire up ----------------
  function bind() {
    const ta = $("script");
    ta.value = S.script;
    ta.addEventListener("input", () => { S.script = ta.value; save(); onScriptEdited(); });
    $("formatBtn").onclick = formatNow;
    $("undoFormat").onclick = undoFormat;
    $("spell").checked = S.spell; $("spell").onchange = e => { S.spell = e.target.checked; save(); };
    $("loadFile").onclick = () => $("fileInput").click();
    $("fileInput").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      ta.value = S.script = await f.text(); save(); onScriptEdited();
      if (!S.takeName) { S.takeName = f.name.replace(/\.\w+$/, ""); $("takeName").value = S.takeName; save(); }
    };
    $("wpm").value = S.wpm; $("wpm").oninput = e => { S.wpm = +e.target.value || 150; save(); updateScriptStats(); };
    $("enableDevices").onclick = enableDevices;
    for (const id of ["camA", "camB", "mic"]) $(id).onchange = e => { S[id] = e.target.value; save(); openStreams(); };
    for (const id of ["res", "fps"]) { $(id).value = S[id]; $(id).onchange = e => { S[id] = e.target.value; save(); openStreams(); }; }
    $("bitrate").value = S.bitrate; $("bitrate").oninput = e => { S.bitrate = Math.max(4, Math.min(80, +e.target.value || 16)); save(); };
    const slider = (id, key, out, fmt, after) => { $(id).value = S[key]; $(out).textContent = fmt(S[key]); $(id).oninput = e => { S[key] = +e.target.value; $(out).textContent = fmt(S[key]); save(); after && after(); }; };
    slider("fontSize", "fontSize", "fontVal", v => v + "px", () => { applyPrompterStyle(); retarget(true); });
    slider("textWidth", "textWidth", "widthVal", v => v + "%", () => { applyPrompterStyle(); retarget(true); });
    slider("readLine", "readLine", "lineVal", v => v + "%", () => applyPrompterStyle());
    slider("speed", "speed", "speedVal", v => String(v));
    $("mirror").checked = S.mirror; $("mirror").onchange = e => { S.mirror = e.target.checked; save(); applyPrompterStyle(); };
    $("lang").value = S.lang; $("lang").onchange = e => { S.lang = e.target.value; save(); if (rec) { stopSpeech(); if (S.mode === "voice" && pw && !pw.closed) startSpeech(); } };
    $("onDevice").checked = S.onDevice; $("onDevice").onchange = e => { S.onDevice = e.target.checked; localFailed = false; save(); if (rec) { stopSpeech(); startSpeech(); } };
    document.querySelectorAll("#modeSeg button").forEach(b => (b.onclick = () => setMode(b.dataset.mode)));
    $("openPrompter").onclick = () => openPrompter();
    $("placePrompter").onclick = placePrompter;
    $("pickFolder").onclick = pickFolder;
    $("takeName").value = S.takeName; $("takeName").oninput = e => { S.takeName = e.target.value; save(); };
    $("recBtn").onclick = startRecording;
    $("stopBtn").onclick = stopRecording;
    $("repairBtn").onclick = repairTake;
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", () => { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); });
    window.addEventListener("beforeunload", e => { if (recording) { e.preventDefault(); e.returnValue = ""; } });
    window.addEventListener("pagehide", () => { if (pw && !pw.closed) pw.close(); });
    navigator.mediaDevices && navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener("devicechange", () => { if (!recording && (camStreamA || micStream)) listDevices(); });
  }

  async function init() {
    bind();
    updateScriptStats();
    setMode(S.mode);
    rootDir = (await idbGet("rootDir")) || null; showFolder();
    if (!window.MediaRecorder || !window.showDirectoryPicker || !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      warn("browser", "Open this in Google Chrome on the Mac. Some features (folder saving, voice follow) are missing in this browser.");
    }
    // already granted? open devices straight away
    try {
      const st = await navigator.permissions.query({ name: "camera" });
      if (st.state === "granted") enableDevices();
    } catch { /* permissions API missing */ }
    setInterval(statusTick, 250);
    requestAnimationFrame(meterTick);
  }

  // test hooks (only with ?test in the URL)
  if (TEST) {
    window.__ps = {
      S, get M() { return M; }, get curTok() { return curTok; }, get recording() { return recording; }, get saving() { return saving; },
      get session() { return session; }, get follower() { return follower; }, get pw() { return pw; },
      enableDevices, openPrompter, startRecording, formatNow, undoFormat, charsPerLine, stopRecording, setMode, retake, gotoTok, onKey,
      useOPFS: async () => { rootDir = await navigator.storage.getDirectory(); showFolder(); },
      hear: text => { finalWords.push(...F.normalizePhrase(text)); feedHeard(); },
      warnings: () => [...warnMap.values()],
    };
  }

  init();
})();
