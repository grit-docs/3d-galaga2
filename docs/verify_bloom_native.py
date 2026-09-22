import asyncio, json
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"
OUT = "docs/design_audit"

STATE_JS = r"""(() => {
  const g = window.__ns;
  const r = g.renderer;
  return { post: !!r._postProcessing, state: g.state?.current, score: g.score };
})()"""

FPS_JS = r"""(() => new Promise(res => {
  let frames = 0; const t0 = performance.now();
  const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(frames / 2)); };
  requestAnimationFrame(tick);
}))"""

async def shot(pw, q, name):
    b = await pw.chromium.launch(headless=True, args=[
        "--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"])
    pg = await b.new_page(viewport={"width": 1280, "height": 720})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    await pg.goto(BASE + q, wait_until="networkidle")
    await pg.click("#startBtn")
    await asyncio.sleep(7)
    st = await pg.evaluate(STATE_JS)
    fps = await pg.evaluate(FPS_JS)
    await pg.screenshot(path=f"{OUT}/{name}.png")
    print(name, json.dumps(st), "fps:", fps, "errors:", len(errors), errors[:2])
    await b.close()

async def main():
    async with async_playwright() as pw:
        await shot(pw, "?bloom=0", "bloom_off")
        await shot(pw, "", "bloom_on")

asyncio.run(main())
