"""Verify the new starfield speed: capture screenshots during normal
play (base intensity 2.0) and during the wave-clear surge (peak 5.0x)
so the user can see the "even faster" feel visually.
"""
import asyncio, os
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga2/index.html"
ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"]
D = os.path.join(os.path.dirname(__file__), "design_audit", "star_speed")

JS_START = """(() => { const g=window.__ns; if(!g)return 'no';
  g.state.transition('PLAYING'); g._startWave(1); return g.state.current; })()"""
JS_CLEAR = """(() => { const g=window.__ns; g.waveSystem._spawnQueue.length=0;
  for(const e of [...g._context.enemyList]){ try{g._onEnemyKilled(e,e.group.position);}catch(_){} }
  return g.state.current; })()"""
JS_INTENSITY = """(() => {
  // read the last-intensity value the starfield saw — not exposed
  // directly, so compute from the same formula Game.update uses
  const g = window.__ns;
  const r = g._clearWarp / 3.0;
  const warp = 3.0 * r * (1-r) * 4;
  return { clearWarp: g._clearWarp, warpRemain: r.toFixed(3), warpBoost: warp.toFixed(3) };
})()"""

async def main():
    os.makedirs(D, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=ARGS)
        pg = await b.new_page(viewport={"width":1280,"height":720})
        await pg.goto(BASE, wait_until="load"); await pg.wait_for_timeout(1500)
        print("start:", await pg.evaluate(JS_START))
        for _ in range(40):
            if await pg.evaluate("window.__ns._context.enemyList.length") >= 3: break
            await pg.wait_for_timeout(300)

        # Normal play — wait a few seconds for the starfield to be mid-motion
        await pg.wait_for_timeout(2000)
        print("normal:", await pg.evaluate(JS_INTENSITY))
        await pg.screenshot(path=os.path.join(D, "01_normal.png"))

        # Wave clear — surge
        await pg.evaluate(JS_CLEAR)
        await pg.wait_for_timeout(500)  # peak is at t=1.5s, we're at 0.5s
        print("clear:", await pg.evaluate(JS_INTENSITY))
        await pg.screenshot(path=os.path.join(D, "02_surge_early.png"))
        await pg.wait_for_timeout(700)  # ~1.2s into the surge
        print("clear2:", await pg.evaluate(JS_INTENSITY))
        await pg.screenshot(path=os.path.join(D, "03_surge_peak.png"))

        await b.close()
        print("done — screenshots in docs/design_audit/star_speed/")

asyncio.run(main())
