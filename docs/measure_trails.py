import asyncio
from playwright.async_api import async_playwright

URL = "https://localhost:5173/3d-galaga/"

SPAWN_JS = r"""
(() => {
  const g = window.__ns;
  const ctx = g._context;
  const pp = ctx.player.group.position;
  const V3 = g.renderer.camera.position.constructor;
  for (let i = 0; i < 6; i++) {
    const ox = (Math.random() - 0.5) * 20;
    const oy = 2 + Math.random() * 5;
    const oz = -(15 + Math.random() * 15);
    const dx = pp.x - ox, dy = pp.y - oy, dz = pp.z - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    ctx.spawnEnemyShot({
      origin: new V3(ox, oy, oz),
      dir: new V3(dx / l, dy / l, dz / l),
      speed: 14, damage: 1,
    });
  }
  const stats = { baseSpeed: 52, baseDamage: 10 };
  for (const a of [-0.2, 0, 0.2]) {
    ctx.spawnPlayerShot({ origin: pp, dir: new V3(-Math.sin(a), 0, -Math.cos(a)), stats });
  }
  return 9;
})()
"""

# measure on-screen pixel length of each shot's trail
MEASURE_JS = r"""
(() => {
  const g = window.__ns;
  const cam = g.renderer.camera;
  const V3 = cam.position.constructor;
  const out = [];
  const proj = (x, y, z) => {
    const v = new V3(x, y, z).project(cam);
    return [ (v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight, v.z ];
  };
  const ps = g._context.projectiles;
  const shots = [];
  for (const p of ps._activeProjectiles) shots.push(p);
  for (const p of shots) {
    if (!p.active) continue;
    const pos = p.group.position;
    const h = proj(pos.x, pos.y, pos.z);
    if (h[2] < -1 || h[2] > 1) continue; // behind camera / off
    const t = p.homing ? 0.16 : (p.hostile ? 0.16 : 0.075);
    const tl = proj(pos.x - p._vx * t, pos.y - p._vy * t, pos.z - p._vz * t);
    const px = Math.hypot(h[0] - tl[0], h[1] - tl[1]);
    out.push({
      kind: p.homing ? 'homing' : (p.hostile ? 'enemy' : 'player'),
      screenPx: Math.round(px * 10) / 10,
      worldLen: Math.hypot(p._vx * t, p._vy * t, p._vz * t).toFixed(2),
    });
  }
  return out;
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
        await pg.evaluate(
            "(() => { const g = window.__ns; const p = g._context.player; "
            "p.lives = 99; p.shield = 100; return 'ok'; })()"
        )
        await pg.evaluate(SPAWN_JS)
        await pg.wait_for_timeout(300)
        m = await pg.evaluate(MEASURE_JS)
        print("trail pixel lengths:")
        for row in m:
            print(" ", row)
        print("DONE")
        await b.close()


asyncio.run(main())
