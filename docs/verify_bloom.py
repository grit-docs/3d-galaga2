import asyncio, json
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"
OUT = "docs/design_audit"

STATE_JS = r"""(() => {
  const g = window.__ns;
  const r = g.renderer;
  let fps = null;
  if (window.__fpsSamples) {
    fps = Math.round(window.__fpsSamples.length);
  }
  return {
    composer: !!r.composer,
    passes: r.composer ? r.composer.passes.map(p => p.constructor.name) : [],
    fps,
    state: g.state.current,
  };
})()"""

# install an FPS sampler on the page
FPS_JS = r"""(() => {
  let frames = 0, last = performance.now();
  window.__fpsSamples = [];
  const t0 = performance.now();
  const loop = () => {
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      window.__fpsSamples.push(frames);
      frames = 0; last = now;
    }
    if (now - t0 < 4000) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return true;
})()"""


async def play_shot(pg, url, tag):
    await pg.goto(url, wait_until="networkidle", timeout=60000)
    await pg.wait_for_timeout(3000)
    st0 = await pg.evaluate(STATE_JS)
    await pg.click("#startBtn")
    await pg.wait_for_timeout(1500)
    await pg.evaluate("(() => { const p = window.__ns._context.player; p.lives = 99; p.shield = 100; return 1; })()")
    await pg.evaluate(FPS_JS)
    await pg.wait_for_timeout(4000)
    # a few seconds of real combat for glow sources
    await pg.keyboard.down("d")
    await pg.wait_for_timeout(700)
    await pg.keyboard.up("d")
    await pg.wait_for_timeout(800)
    st1 = await pg.evaluate(STATE_JS)
    await pg.screenshot(path=f"{OUT}/{tag}.png")
    return st0, st1


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"],
        )
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
        on0, on1 = await play_shot(pg, BASE, "bloom_on")
        print("ON :", json.dumps(on0), "->", json.dumps(on1))
        off0, off1 = await play_shot(pg, BASE + "?bloom=off", "bloom_off")
        print("OFF:", json.dumps(off0), "->", json.dumps(off1))
        print("page errors:", errs[:5])
        print("VERDICT:",
              "PASS" if (on1["composer"] and not off1["composer"] and not errs) else "FAIL")
        await b.close()


asyncio.run(main())
