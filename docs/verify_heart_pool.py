"""GALAGA 2 verify: life card grows the HUD heart pool (3 -> 4 -> 5)."""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"
ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11",
        "--ignore-certificate-errors"]
SHOT = r"C:\AI-SILEE-DEV\3d-galaga-2\docs\design_audit\heart_pool.png"

JS_START = """(() => {
  const g = window.__ns;
  if (!g) return 'no __ns';
  g.state.transition('PLAYING');
  g._startWave(1);
  return g.state.current;
})()"""

JS_ENEMIES = "window.__ns._context.enemyList.length"

JS_CLEAR_WAVE = """(() => {
  const g = window.__ns;
  g.waveSystem._spawnQueue.length = 0;
  const list = [...g._context.enemyList];
  for (const e of list) { try { g._onEnemyKilled(e, e.group.position); } catch (err) {} }
  return g.state.current;
})()"""

# Re-present the panel until 'life' is among the offers (keeps the game's
# own onSelect callback intact). Returns offer ids.
JS_ENSURE_LIFE = """(() => {
  const g = window.__ns;
  const us = g._upgradeSelect;
  for (let i = 0; i < 12; i++) {
    const cb = us._onSelect;
    const wave = g.waveSystem ? g.waveSystem.wave : 1;
    us.show(g._context.player, wave, cb);
    const ids = us._offers.map(o => o[0]);
    if (ids.indexOf('life') !== -1) return ids;
  }
  return null;
})()"""

JS_OFFERS = """(() => {
  const g = window.__ns;
  return { active: g._upgradeSelect.active,
           offers: g._upgradeSelect._offers.map(o => o[0]) };
})()"""

JS_HEARTS = """(() => {
  const el = document.querySelector('[data-hud="#life"]');
  const svgs = [...el.querySelectorAll('svg')];
  return { total: svgs.length,
           filled: svgs.filter(s => !s.classList.contains('lost')).length };
})()"""

JS_LIVES = "window.__ns._context.player.lives"

JS_RESTART = """(() => {
  const g = window.__ns;
  g._toMenu();
  g._beginPlay();
  return { pool: g.hud.hearts.length, lives: g._context.player.lives };
})()"""


async def wait_panel(page, timeout_s=12):
    import time
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if await page.evaluate("window.__ns._upgradeSelect.active"):
            return True
        await page.wait_for_timeout(250)
    return False


async def pick_life(page, errors):
    offers = await page.evaluate(JS_ENSURE_LIFE)
    assert offers and "life" in offers, f"life never offered: {offers}"
    idx = offers.index("life")
    await page.keyboard.press(f"Digit{idx + 1}")
    await page.wait_for_timeout(700)
    return offers


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=ARGS)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        await page.goto(BASE + "index.html", wait_until="load")
        await page.wait_for_timeout(1500)

        base = await page.evaluate(JS_HEARTS)
        print("base hearts:", base)
        assert base == {"total": 3, "filled": 3}, base

        print("start:", await page.evaluate(JS_START))
        alive = 0
        for _ in range(40):
            alive = await page.evaluate(JS_ENEMIES)
            if alive >= 3:
                break
            await page.wait_for_timeout(300)
        print("live enemies:", alive)

        # ---- wave 1 clear -> life pick #1 -> 4 hearts ----
        print("clear:", await page.evaluate(JS_CLEAR_WAVE))
        assert await wait_panel(page), "panel never opened"
        offers1 = await pick_life(page, errors)
        print("pick#1 offers:", offers1)
        h1 = await page.evaluate(JS_HEARTS)
        lives1 = await page.evaluate(JS_LIVES)
        print("after pick#1:", h1, "lives:", lives1)
        assert lives1 == 4 and h1 == {"total": 4, "filled": 4}, (h1, lives1)

        # ---- wave 2 clear -> life pick #2 -> 5 hearts (cap) ----
        await page.wait_for_timeout(4200)  # wave-clear countdown -> wave 2
        await page.wait_for_timeout(1500)  # let wave 2 spawn
        print("clear#2:", await page.evaluate(JS_CLEAR_WAVE))
        assert await wait_panel(page), "panel never opened (2nd)"
        offers2 = await pick_life(page, errors)
        print("pick#2 offers:", offers2)
        h2 = await page.evaluate(JS_HEARTS)
        lives2 = await page.evaluate(JS_LIVES)
        print("after pick#2:", h2, "lives:", lives2)
        assert lives2 == 5 and h2 == {"total": 5, "filled": 5}, (h2, lives2)

        await page.screenshot(path=SHOT)

        # ---- restart -> heart pool back to 3 ----
        r = await page.evaluate(JS_RESTART)
        h3 = await page.evaluate(JS_HEARTS)
        print("after restart:", r, "hearts:", h3)
        assert r["pool"] == 3 and h3 == {"total": 3, "filled": 3}, (r, h3)

        print("console errors:", errors[:3] or "none")
        await browser.close()
        ok = not errors
        print("RESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)


asyncio.run(main())
