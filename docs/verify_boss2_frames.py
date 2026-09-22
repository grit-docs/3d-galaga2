"""Visual verification for the second BOSS (frames for vision_analyze):
  1. boss2_intro.png — the carrier's fly-in (ember palette, wide deck)
  2. boss2_combat.png— mid-fight: wide sweep + 8-way fan + drones
  3. boss2_phase3.png— low HP: wider fan, charged core
Run: uv run --with playwright python docs/verify_boss2_frames.py
"""
from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"


def ev(page, expr, *args):
    return page.evaluate(expr, *args)


def start_wave(page, wave):
    ev(page, f"""() => {{
        __ns._waveClearTimer = 0; __ns._upgradePickDelay = 0;
        __ns.beamSystem.reset();
        __ns._startWave({wave});
        return true;
    }}""")


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
        page.click("#startBtn")
        page.wait_for_timeout(700)
        ev(page, """() => {
            const g = __ns; const p = g._context.player;
            p.lives = 99; p.shield = 100;
            g._imm = true; g._oHit = g._oHit || g._onPlayerHit.bind(g);
            g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
            return true;
        }""")

        # 1) intro (carrier descending from deep z)
        start_wave(page, 10)
        page.wait_for_timeout(1300)
        page.screenshot(path="docs/boss2_intro.png")
        print("intro captured")

        # 2) mid combat — let it settle into the sweep, catch a fan
        for _ in range(30):
            pend = ev(page, "__ns._context.boss._pending.length")
            if pend >= 6:
                break
            page.wait_for_timeout(120)
        page.wait_for_timeout(150)
        page.screenshot(path="docs/boss2_combat.png")
        print("combat captured, pending:", ev(page, "__ns._context.boss._pending.length"))

        # 3) phase 3 (low HP) — charge the core, catch the wide fan
        ev(page, "() => { const b = __ns._context.boss; b.hp = Math.floor(b.maxHp * 0.2); b._invuln = 0; return true; }")
        for _ in range(40):
            pend = ev(page, "__ns._context.boss._pending.length")
            if pend >= 6:
                break
            page.wait_for_timeout(120)
        page.wait_for_timeout(150)
        st = ev(page, "() => ({ phase: __ns._context.boss.phase, x: __ns._context.boss.group.position.x })")
        page.screenshot(path="docs/boss2_phase3.png")
        print("phase3 captured", st)

        browser.close()


if __name__ == "__main__":
    main()
