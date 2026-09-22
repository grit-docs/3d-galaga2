"""Repro part 2: capture screenshots across the FULL wave-clear -> panel
-> pick -> resume sequence to SEE the visual the user is describing
(banner and panel crossing / flicker). Densely samples around the
post-pick moment when showWaveClear() fires again.
"""
import asyncio, os
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga2/index.html"
ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"]
D = os.path.join(os.path.dirname(__file__), "design_audit", "flicker2")

JS_START = """(() => { const g=window.__ns; if(!g)return 'no'; g._settings.autoUpgrade=false;
  g.state.transition('PLAYING'); g._startWave(1); return g.state.current; })()"""
JS_CLEAR = """(() => { const g=window.__ns; g.waveSystem._spawnQueue.length=0;
  for(const e of [...g._context.enemyList]){ try{g._onEnemyKilled(e,e.group.position);}catch(_){} }
  return g.state.current; })()"""
JS_STATE = """(() => { const g=window.__ns;
  const wc=document.getElementById('waveClear'), upg=document.querySelector('.upg-overlay');
  return { state:g.state.current,
    wc: wc.style.display, upg: upg?upg.style.display:'none',
    closing: upg?upg.classList.contains('closing'):false }; })()"""

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
        await pg.evaluate(JS_CLEAR)

        # banner-only moment
        await pg.wait_for_timeout(300)
        print("banner moment:", await pg.evaluate(JS_STATE))
        await pg.screenshot(path=os.path.join(D,"01_banner.png"))

        # panel moment (after 0.9s delay)
        await pg.wait_for_timeout(900)
        print("panel moment:", await pg.evaluate(JS_STATE))
        await pg.screenshot(path=os.path.join(D,"02_panel.png"))

        # pick card 1, then densely sample the post-pick handoff
        await pg.keyboard.press("Digit1")
        for i in range(12):
            await pg.wait_for_timeout(60)
            st = await pg.evaluate(JS_STATE)
            print(f"post-pick {i:2d}:", st)
            if i in (2,4,6,8):
                await pg.screenshot(path=os.path.join(D,f"03_postpick_{i}.png"))

        await b.close()

asyncio.run(main())
