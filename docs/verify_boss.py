import asyncio, json
from playwright.async_api import async_playwright

URL = "https://localhost:5173/3d-galaga/"

# sample boss fight state in-page
SAMPLE_JS = r"""
(() => {
  const g = window.__ns;
  const ctx = g._context;
  const b = ctx.boss;
  let homing = 0, total = 0;
  for (const p of ctx.projectiles._activeProjectiles) {
    if (!p.active) continue;
    total++;
    if (p.homing) homing++;
  }
  return {
    state: g.state.current,
    boss: b ? { hp: Math.round(b.hp), max: b.maxHp, phase: b.phase, alive: b.alive } : null,
    enemies: ctx.enemyList.length,
    shots: total, homing,
  };
})()
"""


async def main():
    errors = []
    async with async_playwright() as pw:
        b = await pw.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"],
        )
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        pg.on("console", lambda m: errors.append("console:" + m.text[:200])
               if m.type == "error" else None)
        await pg.goto(URL, wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(3000)
        await pg.click("#startBtn")
        await pg.wait_for_timeout(1500)
        # force the boss wave (5)
        await pg.evaluate("(() => { window.__ns._startWave(5); })()")
        await pg.evaluate(
            "(() => { const p = window.__ns._context.player; "
            "p.lives = 99; p.shield = 100; p.alive = true; return 1; })()"
        )
        # phase 1 sample
        for _ in range(3):
            await pg.wait_for_timeout(3000)
        s1 = await pg.evaluate(SAMPLE_JS)
        print("P1:", json.dumps(s1))
        await pg.screenshot(path="docs/design_audit/boss_p1.png")
        # force phase 2 (hp ~50%)
        await pg.evaluate(
            "(() => { const b = window.__ns._context.boss; "
            "b.hp = b.maxHp * 0.5; return 1; })()"
        )
        for _ in range(3):
            await pg.wait_for_timeout(3000)
        s2 = await pg.evaluate(SAMPLE_JS)
        print("P2:", json.dumps(s2))
        await pg.screenshot(path="docs/design_audit/boss_p2.png")
        # force phase 3 (hp ~15%)
        await pg.evaluate(
            "(() => { const b = window.__ns._context.boss; "
            "b.hp = b.maxHp * 0.15; return 1; })()"
        )
        for _ in range(3):
            await pg.wait_for_timeout(3000)
        s3 = await pg.evaluate(SAMPLE_JS)
        print("P3:", json.dumps(s3))
        await pg.screenshot(path="docs/design_audit/boss_p3.png")
        print("page errors:", len(errors))
        for e in errors[:8]:
            print("  ERR:", e)
        ok = (
            len(errors) == 0
            and s1["state"] in ("playing", "PLAYING")
            and s3["boss"]["alive"] is True
            and s3["homing"] > 0
        )
        print("VERDICT:", "PASS" if ok else "FAIL")
        await b.close()


asyncio.run(main())
