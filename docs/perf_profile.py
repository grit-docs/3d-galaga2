import json, time
from playwright.sync_api import sync_playwright

JS_SNAP = """(async () => {
  const g = __ns, ctx = g._context, scene = ctx.scene;
  // keep player immortal so the session can progress through waves
  ctx.player.invuln = 99999;
  let meshes = 0, lights = 0, points = 0, lines = 0, total = 0;
  scene.traverse(o => { total++;
    if (o.isMesh) meshes++; if (o.isLight) lights++;
    if (o.isPoints || o.isLineSegments || o.isLine) points++; });
  const dom = document.querySelectorAll('#hud > *').length;
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1;
  const t0 = performance.now(); let f = 0;
  await new Promise(r => { const s = () => { f++; if (performance.now()-t0 < 1000) requestAnimationFrame(s); else r(); }; requestAnimationFrame(s); });
  return JSON.stringify({
    t: Math.round((performance.now()-window.__t0)/1000),
    wave: g.waveSystem.wave, state: g.state.current,
    enemies: ctx.enemyList.length,
    activeP: ctx.projectiles.activeProjectiles.size,
    activePu: ctx.projectiles.activePowerups.size,
    meshes, lights, points, dom, mem, fps: f
  });
})"""

def hold(page, key, ms):
    page.keyboard.down(key); page.wait_for_timeout(ms); page.keyboard.up(key)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--enable-unsafe-webgpu","--use-angle=d3d11","--ignore-certificate-errors"])
    p = b.new_page(viewport={"width":1600,"height":900})
    p.goto("https://localhost:5173/3d-galaga/", wait_until="load", timeout=30000)
    p.wait_for_timeout(2500)
    p.click("#startBtn")
    p.wait_for_timeout(2000)
    p.evaluate("window.__t0 = performance.now()")
    print(json.loads(p.evaluate(JS_SNAP)), flush=True)
    t_end = time.time() + 180
    while time.time() < t_end:
        hold(p, " ", 500); hold(p, "d", 200); hold(p, "a", 200); hold(p, "w", 150); hold(p, "s", 150)
        st = p.evaluate("__ns.state.current")
        if st == "GAME_OVER":
            p.click("#gameOver .js-restart"); p.wait_for_timeout(1200)
        print(json.loads(p.evaluate(JS_SNAP)), flush=True)
    b.close()
