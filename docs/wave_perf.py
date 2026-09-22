import json
from playwright.sync_api import sync_playwright

# force-clear each wave by killing all enemies via the kill callback,
# snapshotting FPS + object counts after each clear
JS_WAVE = """(async () => {
  const g = __ns, ctx = g._context, scene = ctx.scene;
  const raf = () => new Promise(r => requestAnimationFrame(r));
  // measure fps over 1.5s
  const t0 = performance.now(); let f = 0;
  await new Promise(r => { const s = () => { f++; if (performance.now()-t0 < 1500) requestAnimationFrame(s); else r(); }; requestAnimationFrame(s); });
  let meshes = 0, lights = 0, total = 0;
  scene.traverse(o => { total++; if (o.isMesh) meshes++; if (o.isLight) lights++; });
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1;
  return JSON.stringify({
    wave: g.waveSystem.wave, state: g.state.current,
    enemies: ctx.enemyList.length,
    activeP: ctx.projectiles.activeProjectiles.size,
    activePu: ctx.projectiles.activePowerups.size,
    meshes, lights, total, mem, fps: f
  });
})"""

JS_CLEAR = """(async () => {
  const g = __ns, ctx = g._context, w = g.waveSystem;
  const raf = () => new Promise(r => requestAnimationFrame(r));
  // wait for spawn queue to drain
  for (let k = 0; k < 400 && w._spawnQueue.length > 0; k++) await raf();
  // kill all surviving enemies (and boss) so the wave clears
  for (const e of [...ctx.enemyList]) if (e.active && !e.dying) g._onEnemyKilled(e);
  const b = ctx.boss; if (b && b.active && !b.dying) g._onBossKilled?.(b);
  // wait for the WAVE_CLEAR timer to elapse and next wave to start
  for (let k = 0; k < 600; k++) {
    await raf();
    if (g.state.current === 'PLAYING' && w._spawnQueue.length > 0) break;
  }
  return 'ok';
})"""

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--enable-unsafe-webgpu","--use-angle=d3d11","--ignore-certificate-errors"])
    p = b.new_page(viewport={"width":1600,"height":900})
    p.goto("https://localhost:5173/3d-galaga/", wait_until="load", timeout=30000)
    p.wait_for_timeout(2500)
    p.click("#startBtn")
    p.wait_for_timeout(2500)
    # make player immortal (check field name in Player.js)
    p.evaluate("Object.defineProperty(__ns._context.player, 'alive', { get: () => true })")
    for _ in range(13):
        st = json.loads(p.evaluate(JS_WAVE))
        print(st, flush=True)
        if st["wave"] > 12 or st["state"] not in ("PLAYING", "BOSS_INTRO", "WAVE_CLEAR"):
            break
        p.evaluate(JS_CLEAR)
    b.close()
