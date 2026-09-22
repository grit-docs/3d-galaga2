"""GALAGA 2 verify: enemy drop 32%, boss guaranteed drop (weighted)."""
import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"
ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11",
        "--ignore-certificate-errors"]

JS_START = """(() => {
  const g = window.__ns;
  if (!g) return 'no __ns';
  g.state.transition('PLAYING');
  // fast-forward to boss wave 5 (escorts auto-resolved by kills=0)
  g.waveSystem.wave = 5;
  return g.state.current;
})()"""

JS_KILL_NORMAL = """(() => {
  const g = window.__ns;
  const e = g.acquireEnemy('fighter');
  e._init('fighter'); e.alive = true;
  g.scene.add(e.group);
  g._activeEnemies.push(e);
  g.waveSystem.spawned += 1;
  e.group.position.copy(g._context.player.group.position);
  e.group.position.z -= 1;
  const before = g._context.projectiles._powerups.filter(p => p.alive).length;
  g._onEnemyKilled(e);
  e.group.removeFromParent();
  const after = g._context.projectiles._powerups.filter(p => p.alive).length;
  return after - before;
})()"""

JS_KILL_BOSS = """(() => {
  const g = window.__ns;
  const b = g.boss;
  if (!b || !b.alive) return 'no-boss';
  const before = g._context.projectiles._powerups.filter(p => p.alive).length;
  g._onBossKilled(b, b.group.position);
  const after = g._context.projectiles._powerups.filter(p => p.alive).length;
  return after - before;
})()"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=ARGS)
        page = await browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text)
                if m.type == "error" else None)
        await page.goto(BASE + "index.html", wait_until="load")
        await page.wait_for_timeout(1500)

        # 1) config
        chance = await page.evaluate("window.__ns && window.__ns._cfg ? 'x' : ''")
        drop = await page.evaluate("""(() => {
            // read live config via module namespace is not exposed;
            // check the running game's POWERUP.CHANCE through source is
            // unavailable — instead verify behaviour (below). Return
            // 'see-behavior'.
            return 'see-behavior';
        })()""")

        r = await page.evaluate(JS_START)
        print("start:", r)
        await page.wait_for_timeout(800)

        # 2) normal enemy drop frequency (30 kills)
        drops = [await page.evaluate(JS_KILL_NORMAL) for _ in range(30)]
        rate = sum(d > 0 for d in drops) / len(drops)
        print(f"normal-kill drops: {sum(d>0 for d in drops)}/30 = {rate:.0%}")

        # 3) boss guaranteed
        bd = await page.evaluate(JS_KILL_BOSS)
        print(f"boss drop: {bd}")

        await browser.close()
        print("console errors:", errors[:3] or "none")
        ok = (0.25 <= rate <= 0.42) and bd >= 1 and not errors
        print("RESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)

asyncio.run(main())
