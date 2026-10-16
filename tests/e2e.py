# End-to-end test in headless Chromium with two fake cameras.
# Run: pip install playwright && python3 tests/e2e.py [output_dir]
# Set CHROME_PATH to use a specific Chrome/Chromium binary.
import base64, json, os, subprocess, sys, threading, time, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ps-e2e"
os.makedirs(OUT, exist_ok=True)
handler = functools.partial(SimpleHTTPRequestHandler, directory=ROOT)
handler.log_message = lambda *a, **k: None
srv = ThreadingHTTPServer(("127.0.0.1", 8765), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

SCRIPT = open(os.path.join(ROOT, "tests", "follow.test.js")).read().split("const SCRIPT = `")[1].split("`")[0]
SCRIPT = "# 1. Hook\n" + SCRIPT.split("\n")[0] + "\n" + SCRIPT.split("\n")[1] + "\n\n# 2. The problem\n" + "\n".join(SCRIPT.split("\n")[2:])

results, errors = [], []
def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("  ok  " if cond else "  FAIL ") + name + (("  -> " + str(info)) if (info and not cond) else ""))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=[
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream=device-count=2",
        "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    ctx.grant_permissions(["camera", "microphone"], origin="http://127.0.0.1:8765")
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and errors.append("main: " + m.text))
    page.on("pageerror", lambda e: errors.append("main pageerror: " + str(e) + " @ " + (e.stack or "")[:400]))
    page.goto("http://127.0.0.1:8765/index.html?test")
    page.fill("#script", SCRIPT)
    page.wait_for_timeout(800)
    check("script parsed into sections", page.evaluate("__ps.M.sections.length") == 2)

    page.evaluate("__ps.enableDevices()")
    page.wait_for_timeout(2500)
    cams = page.evaluate("[...document.querySelectorAll('#camA option')].length")
    check("two cameras listed", cams >= 2, cams)
    check("camera B auto-selected", page.evaluate("document.getElementById('camB').value !== '' && document.getElementById('camB').value !== document.getElementById('camA').value"))
    check("both previews live", page.evaluate("!!document.getElementById('prevA').srcObject && !!document.getElementById('prevB').srcObject"))

    with page.expect_popup() as pop:
        page.evaluate("__ps.openPrompter()")
    pw = pop.value
    pw.on("pageerror", lambda e: errors.append("prompter pageerror: " + str(e)))
    pw.wait_for_timeout(1200)
    n_spans = pw.evaluate("document.querySelectorAll('#script .w').length")
    check("prompter rendered words", n_spans == page.evaluate("__ps.M.tokens.length"), n_spans)
    check("prompter shows section titles", pw.evaluate("document.querySelectorAll('#script .sec').length") == 2)

    # ---- format for prompter ----
    before = page.input_value("#script")
    page.fill("#script", before + "\n\n[SHOW CHART]\nThis is **really** important: it went up 20% in 2026 to $65k.")
    page.wait_for_timeout(700)
    raw = page.input_value("#script")
    page.click("#formatBtn")
    page.wait_for_timeout(900)
    fmt = page.input_value("#script")
    check("format: script changed", fmt != raw)
    check("format: numbers spelled", "twenty percent" in fmt and "sixty-five thousand dollars" in fmt and "twenty twenty-six" in fmt, fmt[-200:])
    check("format: notice shown", "Formatted" in page.inner_text("#notice"))
    wrapped = pw.evaluate("""() => { const lines = {}; const ws = [...document.querySelectorAll('#script .w')];
        // words between <br>s must share one visual line
        let bad = 0; let cur = null;
        for (const p of document.querySelectorAll('#script .para')) { let top = null;
          for (const n of p.childNodes) { if (n.nodeName === 'BR') { top = null; continue; }
            if (n.nodeType !== 1) continue; if (n.classList.contains('cue')) continue;
            if (top === null) top = n.offsetTop; else if (Math.abs(n.offsetTop - top) > 4) bad++; } }
        return bad; }""")
    check("format: every line fits the prompter without wrapping", wrapped == 0, wrapped)
    check("format: cue rendered small", pw.evaluate("document.querySelectorAll('#script .w.cue').length") >= 2)
    check("format: emphasis rendered", pw.evaluate("[...document.querySelectorAll('#script .w.em')].map(e=>e.textContent).join(' ')") == "really")
    check("format: cue not in matcher words", "show" not in page.evaluate("__ps.M.norm"))
    page.click("#undoFormat")
    page.wait_for_timeout(700)
    check("format: undo restores", page.input_value("#script") == raw)
    page.click("#formatBtn")
    page.wait_for_timeout(900)
    pw.screenshot(path=os.path.join(OUT, "prompter-formatted.png"))

    # ---- voice follow, driven through the app's own pipeline ----
    page.evaluate("__ps.setMode('voice')")
    page.evaluate("__ps.gotoTok(0)")
    page.evaluate("__ps.hear('I made ten thousand four hundred dollars with memecoins in just one week following a simple strategy')")
    t1 = page.evaluate("__ps.curTok")
    check("voice: follows reading", t1 >= 12, t1)
    page.evaluate("__ps.hear('honestly my mom asks why I keep buying frogs on the internet')")
    check("voice: holds during joke", page.evaluate("__ps.curTok") == t1, page.evaluate("__ps.curTok"))
    page.evaluate("__ps.hear('And I\\'m breaking down exactly how you can copy it')")
    t2 = page.evaluate("__ps.curTok")
    check("voice: resumes after joke", t2 > t1, t2)
    pw.wait_for_timeout(600)
    cur_class = pw.evaluate(f"document.querySelectorAll('#script .w')[{t2}]?.className || 'end'")
    check("prompter highlights next word", "cur" in cur_class or cur_class == "end", cur_class)
    check("prompter dims spoken words", pw.evaluate("document.querySelectorAll('#script .w.done').length") == t2)

    # ---- recording to a folder (Chrome's private folder stands in for a real one) ----
    page.evaluate("__ps.useOPFS()")
    page.evaluate("__ps.startRecording()")
    page.wait_for_timeout(1500)
    check("recording started", page.evaluate("__ps.recording"))
    check("prompter shows REC", pw.evaluate("document.getElementById('hud').classList.contains('recording')"))
    check("countdown shown", pw.evaluate("getComputedStyle(document.getElementById('count')).display") == "flex")
    page.wait_for_timeout(2600)
    pw.keyboard.press("r")            # retake from inside the prompter window
    pw.keyboard.press("k")
    pw.keyboard.press("2")            # jump to section 2
    page.evaluate("__ps.hear('Chasing hype and buying late is the fastest way to lose money')")
    page.evaluate("__ps.hear('Chasing hype and buying late is the fastest way')")   # re-say
    page.wait_for_timeout(9000)       # cross a 10 s part boundary
    pw.keyboard.press("Shift+Enter")  # first press only arms stop
    page.wait_for_timeout(300)
    check("single Shift+Enter does not stop", page.evaluate("__ps.recording"))
    pw.keyboard.press("Shift+Enter")
    for _ in range(60):
        page.wait_for_timeout(500)
        if not page.evaluate("__ps.recording || __ps.saving"): break
    check("stopped and saved", not page.evaluate("__ps.recording || __ps.saving"))
    types = page.evaluate("__ps.session.markers.map(m => m.type)")
    for t in ["start", "retake", "keep", "section", "re-say", "stop"]:
        check(f"marker logged: {t}", t in types, types)

    listing = page.evaluate("""async () => {
      const root = await navigator.storage.getDirectory(); const out = {};
      for await (const [name, h] of root.entries()) if (h.kind === 'directory') {
        out[name] = {};
        for await (const [n, fh] of h.entries()) out[name][n] = (await fh.getFile()).size;
      }
      return out; }""")
    take = next(iter(listing))
    files = listing[take]
    print("  take folder:", take, json.dumps(files))
    check("no leftover .part files", not any(".part" in n for n in files))
    for need in ["session.json", "markers.json", "markers.txt", "transcript.json", "script.md"]:
        check(f"wrote {need}", need in files)
    vids = [n for n in files if n.startswith(("camA", "camB", "mic"))]
    check("three media files (camA, camB, mic)", len(vids) == 3, vids)
    for n in vids:
        b64 = page.evaluate(f"""async () => {{
          const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle({json.dumps(take)});
          const f = await (await d.getFileHandle({json.dumps(n)})).getFile(); const buf = new Uint8Array(await f.arrayBuffer());
          let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          return btoa(s); }}""")
        path = os.path.join(OUT, n)
        open(path, "wb").write(base64.b64decode(b64))
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", path], capture_output=True, text=True)
        dec = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-enc_time_base:v", "1/1000", "-f", "null", "-"], capture_output=True, text=True)
        pk = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "packet=stream_index,dts", "-of", "json", path], capture_output=True, text=True).stdout)["packets"]
        mono = all(b["dts"] > a["dts"] for si in {q["stream_index"] for q in pk} for a, b in zip([q for q in pk if q["stream_index"] == si], [q for q in pk if q["stream_index"] == si][1:]))
        check(f"{n}: timestamps strictly increasing", mono)
        streams = json.loads(probe.stdout or "{}").get("streams", [])
        kinds = sorted(s["codec_type"] for s in streams)
        want = ["audio"] if n.startswith("mic") else ["audio", "video"]
        check(f"{n}: streams {want}", kinds == want, kinds)
        check(f"{n}: decodes cleanly across joined parts", dec.returncode == 0 and not dec.stderr.strip(), dec.stderr[:200])
        dur = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
        print(f"     {n}: {files[n]/1e6:.1f} MB, packets in first stream: {dur}")

    md = page.evaluate(f"""async () => {{ const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle({json.dumps(take)});
      return await (await (await d.getFileHandle('markers.txt')).getFile()).text(); }}""")
    print("  markers.txt:\n    " + md.strip().replace("\n", "\n    "))

    page.evaluate("__ps.setMode('manual')")
    page.evaluate("__ps.gotoTok(0)")
    pw.wait_for_timeout(300)
    t0 = page.evaluate("__ps.curTok")
    pw.keyboard.press("Space")
    pw.wait_for_timeout(4000)
    t1 = page.evaluate("__ps.curTok")
    check("manual: Space starts scrolling", t1 > t0, f"{t0} -> {t1}")
    pw.keyboard.press("Space")
    pw.wait_for_timeout(1500)
    t2 = page.evaluate("__ps.curTok")
    pw.wait_for_timeout(1500)
    check("manual: Space pauses", page.evaluate("__ps.curTok") == t2)
    pw.keyboard.press("r")
    pw.wait_for_timeout(300)
    check("manual: retake jumps back to sentence start", page.evaluate("__ps.M.tokens[__ps.curTok]?.sent") is True)
    pw.wait_for_timeout(800)
    pw.screenshot(path=os.path.join(OUT, "prompter.png"))
    page.screenshot(path=os.path.join(OUT, "control.png"), full_page=True)
    browser.close()

srv.shutdown()
bad = [e for e in errors if "speech" not in e.lower()]
check("no page errors", not bad, bad[:5])
print(f"\n{sum(r for _, r in results)} passed, {sum(not r for _, r in results)} failed")
sys.exit(0 if all(r for _, r in results) else 1)
