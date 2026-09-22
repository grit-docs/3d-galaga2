import asyncio
from playwright.async_api import async_playwright

URL = "https://localhost:5173/3d-galaga/"
OUT = "docs/design_audit"


def immune_js():
    # keep the test player alive so homing missiles keep steering
    return r"""
(() => {
  const g = window.__ns;
  if (!g) return "no";
  g._testImmune = true;
  if (!g._origPlayerHit) g._origPlayerHit = g._onPlayerHit.bind(g);
  g._onPlayerHit = (d) => { if (!g._testImmune) g._origPlayerHit(d); };
  const p = g._context.player;
  p.lives = 99; p.shield = 100; p.alive = true;
  return "ok";
})()
"""


def misalign_js():
    # grab the live homing missile and point it directly AWAY from the
    # player (180° misalignment). Returns the missile's speed so we know
    # it's alive and moving.
    return r"""
(() => {
  const g = window.__ns;
  const ctx = g._context;
  const pp = ctx.player.group.position;
  for (const p of ctx.projectiles.activeProjectiles) {
    if (p.homing && p.active) {
      const px = p.group.position.x, py = p.group.position.y, pz = p.group.position.z;
      let tx = px - pp.x, ty = py - pp.y, tz = pz - pp.z; // AWAY from player
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx/=tl; ty/=tl; tz/=tl;
      const sp = Math.hypot(p._vx, p._vy, p._vz);
      p._vx = tx * sp; p._vy = ty * sp; p._vz = tz * sp;
      return { misaligned: true, speed: sp };
    }
  }
  return { misaligned: false };
})()
"""


def bearing_to_player_js():
    # angle between the missile's heading and the line straight to the
    # player. 180 => flying away, 0 => locked on. Watch it decay over
    # time: the decay rate IS the turn-rate cap.
    return r"""
(() => {
  const g = window.__ns;
  const ctx = g._context;
  const pp = ctx.player.group.position;
  let best = null;
  for (const p of ctx.projectiles.activeProjectiles) {
    if (p.homing && p.active) {
      const px = p.group.position.x, py = p.group.position.y, pz = p.group.position.z;
      const vl = Math.hypot(p._vx, p._vy, p._vz);
      const tx = pp.x - px, ty = pp.y - py, tz = pp.z - pz;
      const tl = Math.hypot(tx, ty, tz);
      if (vl < 1e-6 || tl < 1e-6) continue;
      const dot = (p._vx*tx + p._vy*ty + p._vz*tz) / (vl*tl);
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180/Math.PI;
      best = best === null ? ang : Math.min(best, ang); // closest to lock
    }
  }
  return best;
})()
"""


def spawn_scout_js():
    return r"""
(() => {
  const g = window.__ns;
  if (!g) return "no __ns";
  const ctx = g._context;
  const V3 = g.renderer.camera.position.constructor;
  const out = { state: g.state.current, wave: g.waveSystem.wave };
  const scout = g.acquireEnemy("scout");
  scout.configure({
    slot: new V3(8, 2, -38),
    index: 999,
    spawnFrom: new V3(8, 6, -80),
    hpScale: 1,
  });
  g.addEnemy(scout);
  g.waveSystem.enemySpawned();
  out.scoutType = scout.type;
  return JSON.stringify(out);
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

        # confirm WebGPU secure context, then click START GAME
        gpu = await pg.evaluate("navigator.gpu !== undefined")
        print("webgpu:", gpu)
        await pg.click("#startBtn")
        await pg.wait_for_timeout(2500)

        # make the test player immune so missiles keep steering
        print("immune:", await pg.evaluate(immune_js()))
        st = await pg.evaluate("window.__ns.state.current")
        print("state:", st)

        # jump to wave 3 (scouts join from wave 3)
        await pg.evaluate("window.__ns._startWave(3)")
        await pg.wait_for_timeout(3500)

        # force-spawn one guaranteed scout
        info = await pg.evaluate(spawn_scout_js())
        print("scout spawn:", info)

        # --- DECISIVE turn-rate test -------------------------------------
        # 1) wait for a live homing missile
        # 2) yank its heading to point AWAY from the player (≈180° off)
        # 3) sample the bearing-to-player over time: it must DECAY
        #    monotonically toward 0 at a bounded rate (the turn cap), not
        #    snap to 0 (which would be a laser lock = undodgeable)
        await pg.wait_for_timeout(1200)
        got = None
        for _ in range(20):
            got = await pg.evaluate(misalign_js())
            if got.get("misaligned"):
                break
            await pg.wait_for_timeout(300)
        print("misalign:", got)
        if not got or not got.get("misaligned"):
            print("FAIL: no live homing missile to test")
            await b.close(); return

        samples = []
        t0 = await pg.evaluate("performance.now()")
        for i in range(30):
            brg = await pg.evaluate(bearing_to_player_js())
            now = await pg.evaluate("performance.now()")
            if brg is not None:
                samples.append((round((now - t0) / 1000, 2), round(brg, 1)))
            await pg.wait_for_timeout(150)
            if samples and samples[-1][1] < 2.0:
                break
        await pg.screenshot(path=f"{OUT}/scout_live.png")
        print("bearing-to-player over time (t_sec, deg):")
        print("  " + "  ".join(f"{t}:{d}" for t, d in samples))
        if samples:
            # crude decay-rate estimate from the first and a mid sample
            first = samples[0][1]
            last = samples[-1][1]
            dt = samples[-1][0] - samples[0][0]
            rate = (first - last) / dt if dt > 0 else 0
            print(f"DECAY: {first}deg -> {last}deg over {dt:.2f}s = {rate:.1f} deg/s")
            # at 60fps the per-frame cap is TURN_RATE/60 rad. TURN_RATE=0.65
            # => ~0.63 deg/frame => ~37.8 deg/s theoretical max. If the
            # measured rate is FAR below that, it's a genuine curve; if it
            # is a 1-frame snap (>>1000 deg/s), the cap isn't working.
            verdict = "DODGABLE (bounded curve)" if rate < 120 else "SUSPECT (looks like a laser lock)"
            print(f"VERDICT: {verdict}")
        print("DONE")
        await b.close()


asyncio.run(main())
