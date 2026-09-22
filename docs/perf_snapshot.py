"""Perf snapshot v2: FPS (frame count over wall-clock window) + frame-time
percentiles across load levels (menu, wave 4, boss p3). No renderer.info
(WebGPURenderer has none) — scene census via traverse instead.
Run: uv run --with playwright python docs/perf_snapshot.py
"""
from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"

# count rAF frames over a wall-clock window; also collect frame deltas
# for p90/p99/spike stats.
SAMPLE = """(ms) => new Promise(res => {
    const dt = []; let n = 0, last = performance.now();
    const t0 = performance.now();
    (function f() {
        const now = performance.now();
        dt.push(now - last); last = now; n++;
        if (now - t0 < ms) requestAnimationFrame(f);
        else {
            dt.shift(); // drop the first (partial) delta
            if (dt.length) dt.sort((a,b)=>a-b);
            const fps = Math.round(n / ((now - t0) / 1000));
            res({ fps,
                  avg: dt.reduce((a,b)=>a+b,0) / dt.length,
                  p50: dt[Math.floor(dt.length*0.5)],
                  p90: dt[Math.floor(dt.length*0.9)],
                  p99: dt[Math.min(dt.length-1, Math.floor(dt.length*0.99))],
                  spikes: dt.filter(d => d > 33).length });
        }
    })();
})"""


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11",
                  "--ignore-certificate-errors"],
        )
        page = browser.new_page(viewport={"width": 1600, "height": 900})
        page.goto(URL, wait_until="load", timeout=30000)
        page.wait_for_timeout(2500)

        def ev(expr, arg=None):
            return page.evaluate(expr, arg)

        def row(label, r, extra=""):
            print(f"{label:9s} fps={r['fps']:4d} avg={r['avg']:5.2f} "
                  f"p50={r['p50']:5.2f} p90={r['p90']:5.2f} p99={r['p99']:5.2f} "
                  f"spikes>33ms={r['spikes']} {extra}")

        row("MENU", ev(SAMPLE, 3000))

        page.click("#startBtn")
        page.wait_for_timeout(1000)
        ev("""() => { const g=__ns; const p=g._context.player;
            p.alive=true; p.lives=99; p.shield=100;
            g._imm=true; g._oHit=g._onPlayerHit.bind(g);
            g._onPlayerHit=(d)=>{ if(!g._imm) g._oHit(d); }; }""")

        def full_spawn():
            for _ in range(40):
                if ev("__ns.waveSystem._spawnQueue.length") == 0:
                    return
                page.wait_for_timeout(300)

        # wave 4 (new layout 3x5 = 15)
        ev("__ns._startWave(4)")
        full_spawn()
        page.wait_for_timeout(1500)
        n4 = ev("__ns._context.enemyList.length")
        row("WAVE4", ev(SAMPLE, 4000), f"| enemies={n4}")
        page.wait_for_timeout(3000)
        row("WAVE4+3s", ev(SAMPLE, 4000))

        # boss wave 5, forced phase 3 (heaviest fire)
        ev("__ns._startWave(5)")
        page.wait_for_timeout(5000)
        b = ev("__ns._context.boss")
        if b and b["alive"]:
            ev("__ns._context.boss.hp = __ns._context.boss.maxHp * 0.15")
        page.wait_for_timeout(800)
        nb = ev("""() => ({
            e: __ns._context.enemyList.length,
            h: [...__ns._context.projectiles.activeProjectiles].filter(p=>p.hostile).length,
        })""")
        row("BOSS-p3", ev(SAMPLE, 4000), f"| enemies={nb['e']} hostiles={nb['h']}")
        page.wait_for_timeout(3000)
        row("BOSS+3s", ev(SAMPLE, 4000), f"| hostiles={ev('[...__ns._context.projectiles.activeProjectiles].filter(p=>p.hostile).length')}")

        census = ev("""() => {
            let meshes=0, lights=0, lines=0, pts=0, total=0;
            __ns.renderer.scene.traverse(o => {
                total++;
                if (o.isMesh) meshes++;
                else if (o.isPointLight || o.isDirectionalLight) lights++;
                else if (o.isLine || o.isLineSegments) lines++;
                else if (o.isPoints) pts++;
            });
            return { total, meshes, lights, lines, pts };
        }""")
        print(f"SCENE     total={census['total']} meshes={census['meshes']} "
              f"lights={census['lights']} lines={census['lines']} points={census['pts']}")
        browser.close()


if __name__ == "__main__":
    main()
