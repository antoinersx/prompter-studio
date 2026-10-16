# Phone page end-to-end test: iPhone-sized viewport, fake camera, simulated speech.
# Run: python3 tests/phone_e2e.py [output_dir]   (CHROME_PATH optional)
import os, sys, json, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ps-phone"
os.makedirs(OUT, exist_ok=True)
h = functools.partial(SimpleHTTPRequestHandler, directory=ROOT); h.log_message = lambda *a, **k: None
srv = ThreadingHTTPServer(("127.0.0.1", 8766), h); threading.Thread(target=srv.serve_forever, daemon=True).start()

SCRIPT = """# 1. Hook
Everyone's editing their videos with Claude.
I'm one level above. I'm *recording* with Claude.

[SHOW PROMPTER]

It costs $0 and it's 100% open source."""
res, errs = [], []
def check(n, c, info=""):
    res.append(c); print(("  ok  " if c else "  FAIL ") + n + (("  -> " + str(info)) if info and not c else ""))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,
                          args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
    ctx.grant_permissions(["camera", "microphone"], origin="http://127.0.0.1:8766")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8766/phone.html?test")
    pg.click("#bStart"); pg.wait_for_timeout(1500)
    check("camera preview live", pg.evaluate("!!document.getElementById('preview').srcObject"))
    check("setup sheet opens when no script", pg.evaluate("document.getElementById('setup').classList.contains('open')"))
    pg.fill("#text", SCRIPT); pg.wait_for_timeout(600)
    pg.click("#bFormat"); pg.wait_for_timeout(500)
    t = pg.input_value("#text")
    check("format spelled numbers", "zero dollars" in t and "one hundred percent" in t, t)
    pg.click("#bDone"); pg.wait_for_timeout(500)
    check("prompter shows words", pg.evaluate("document.querySelectorAll('#script .w').length") > 15)
    check("cue rendered small", pg.evaluate("document.querySelectorAll('#script .w.cue').length") >= 2)
    wrap = pg.evaluate("""() => { let bad = 0; for (const p of document.querySelectorAll('#script .para')) { let top = null;
        for (const n of p.childNodes) { if (n.nodeName === 'BR') { top = null; continue; } if (n.nodeType !== 1 || n.classList.contains('cue')) continue;
          if (top === null) top = n.offsetTop; else if (Math.abs(n.offsetTop - top) > 4) bad++; } } return bad; }""")
    check("formatted lines fit the phone width", wrap == 0, wrap)
    pg.screenshot(path=os.path.join(OUT, "phone_top.png"))

    pg.evaluate("__pp.setMode('voice')"); pg.evaluate("__pp.gotoTok(0)")
    pg.evaluate("__pp.startRec()"); pg.wait_for_timeout(3600)
    check("recording", pg.evaluate("__pp.recording"))
    pg.evaluate("__pp.hear(\"Everyone's editing their videos with Claude\")")
    t1 = pg.evaluate("__pp.curTok"); check("voice follows", t1 >= 6, t1)
    pg.evaluate("__pp.hear('my cat thinks this whole thing is ridiculous honestly')")
    check("holds during ad-lib", pg.evaluate("__pp.curTok") == t1)
    pg.click("#bRetake"); pg.click("#bKeep")
    # tap the prompter = hold; tap again = release
    pg.mouse.click(195, 150); pg.wait_for_timeout(200)
    check("tap holds voice follow", "HOLD" in pg.inner_text("#state"), pg.inner_text("#state"))
    pg.mouse.click(195, 150); pg.wait_for_timeout(2500)
    pg.evaluate("__pp.stopRec()"); pg.wait_for_timeout(2500)
    check("save sheet opened", pg.evaluate("document.getElementById('save').classList.contains('open')"))
    info = pg.evaluate("({size: __pp.take.file.size, type: __pp.take.file.type, name: __pp.take.file.name, markers: __pp.take.markers.map(m => m.type)})")
    check("video file produced", info["size"] > 50000, info)
    for m in ["start", "retake", "keep", "stop"]: check(f"marker {m}", m in info["markers"], info["markers"])
    side = pg.evaluate("__pp.sideFiles().map(f => f.name)")
    check("markers/script/session files", len(side) == 5 and all(n.startswith(info["name"].rsplit('.', 1)[0]) for n in side), side)
    # download the video to verify it decodes
    import base64
    b64 = pg.evaluate("""async () => { const buf = new Uint8Array(await __pp.take.file.arrayBuffer()); let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }""")
    vp = os.path.join(OUT, info["name"]); open(vp, "wb").write(base64.b64decode(b64))
    import subprocess
    pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", vp], capture_output=True, text=True).stdout.split()
    check("video has audio + video", sorted(pr) == ["audio", "video"], pr)
    pg.screenshot(path=os.path.join(OUT, "phone_save.png"))
    pg.click("#bClose"); pg.wait_for_timeout(300)
    # text-only layout (selfie monitor)
    pg.click("#bScript"); pg.click("#layout button[data-v=textonly]"); pg.click("#bDone"); pg.wait_for_timeout(500)
    check("text-only layout", pg.evaluate("document.body.classList.contains('textonly')"))
    pg.screenshot(path=os.path.join(OUT, "phone_textonly.png"))
    b.close()
srv.shutdown()
check("no page errors", not errs, errs[:3])
print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed"); sys.exit(0 if all(res) else 1)
