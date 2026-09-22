import asyncio
from playwright.async_api import async_playwright

URL = "https://localhost:5173/3d-galaga/"
OUT = "docs/design_audit"

SPAWN_JS = r"""
(() => {
  const g = window.__ns;
  const ctx = g._context;
  const pp = ctx.player.group.position;
  const V3 = g.renderer.camera.position.constructor;
  let n = 0;
  // 8 enemy orbs from a spread of positions, aimed at the player
  for (let i = 0; i < 8; i++) {
    const ox = (Math.random() - 0.5) * 24;
    const oy = 2 + Math.random() * 6;
    const oz = -(20 + Math.random() * 20);
    const dx = pp.x - ox, dy = pp.y - oy, dz = pp.z - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    ctx.spawnEnemyShot({
      origin: new V3(ox, oy, oz),
      dir: new V3(dx / l, dy / l, dz / l),
      speed: 14 + Math.random() * 4,
      damage: 1,
    });
    n++;
  }
  // player lasers: fire 5 in a fan
  const stats = { baseSpeed: 52, baseDamage: 10 };
  for (const a of [-0.3, -0.15, 0, 0.15, 0.3]) {
    const dir = new V3(-Math.sin(a), 0, -Math.cos(a));
    ctx.spawnPlayerShot({ origin: pp, dir, stats });
    n++;
  }
  return n;
})()
"""


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"],
        )
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto(URL, wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(3000)
        await pg.click("#startBtn")
        await pg.wait_for_timeout(2000)
        # keep the player alive for the burst
        await pg.evaluate(
            "(() => { const g = window.__ns; const p = g._context.player; "
            "p.lives = 99; p.shield = 100; p.alive = true; return 'ok'; })()"
        )
        spawned = await pg.evaluate(SPAWN_JS)
        print("spawned shots:", spawned)
        await pg.wait_for_timeout(250)  # let them travel a bit so trails are mid-frame
        await pg.screenshot(path=f"{OUT}/trails_1.png")
        await pg.wait_for_timeout(350)
        await pg.screenshot(path=f"{OUT}/trails_2.png")
        # verify the trail layer exists and is being written
        trail = await pg.evaluate(
            """(() => {
              const g = window.__ns;
              const t = g._context.projectiles._trailMesh;
              if (!t) return { exists: false };
              const pos = t.geometry.attributes.position.array;
              let nonzero = 0;
              for (let i = 0; i < pos.length; i++) if (Math.abs(pos[i]) > 0.01) nonzero++;
              return { exists: true, frustumCulled: t.frustumCulled, nonzeroComps: nonzero };
            })()"""
        )
        print("trail layer:", trail)
        print("DONE")
        await b.close()


asyncio.run(main())
