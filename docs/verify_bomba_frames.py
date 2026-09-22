"""Visual verification for the BOMBA feature (frames for vision_analyze):
  1. hud_bomba.png   - HUD with BOMBA label + pips visible (1 lit)
  2. bomba_blast.png - the moment of the blast: white-cyan flash overlay
  3. hud_bomba3.png  - pips at max (3 lit)
Run: uv run --with playwright python docs/verify_bomba_frames.py
"""
from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"
OUT = r"C:\AI-SILEE-DEV\3d-galaga-2\docs"


def ev(page, expr, *args):
    return page.evaluate(expr, *args)


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

        # immortal so nothing interrupts the frames
        ev(page, """() => {
            const g = __ns; const p = g._context.player;
            p.alive = true; p.lives = 99; p.shield = 100;
            g._imm = true; g._oHit = g._oHit || g._onPlayerHit.bind(g);
            g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
            return true;
        }""")

        # frame 1: HUD with one pip lit (wave 1 settling)
        for _ in range(40):
            if ev(page, "__ns.waveSystem._spawnQueue.length") == 0:
                break
            page.wait_for_timeout(300)
        page.wait_for_timeout(500)
        page.screenshot(path=rf"{OUT}\bomba_hud1.png")

        # frame 2: the blast moment — press L, capture ~90ms in (the
        # flash overlay peaks in its first ~300ms)
        page.keyboard.press("KeyL")
        page.wait_for_timeout(90)
        page.screenshot(path=rf"{OUT}\bomba_blast.png")

        # frame 3: pips at max — grant +1 twice through real clears
        # (kill the board normally twice) then screenshot the HUD
        ev(page, """() => {
            try { __ns._upgradeSelect.cancel(); } catch (e) {}
            __ns._upgradePickDelay = 0;
            return true;
        }""")
        page.wait_for_timeout(3600)  # wave-clear lull
        for attempt in range(2):
            ev(page, """() => {
                try { __ns._upgradeSelect.cancel(); } catch (e) {}
                __ns._upgradePickDelay = 0;
                return true;
            }""")
            page.wait_for_timeout(3600)  # next wave lull
            for _ in range(60):
                st = ev(page, """() => ({
                    q: __ns.waveSystem._spawnQueue.length,
                    n: __ns._context.enemyList.filter(e => e.active).length,
                })""")
                if st["q"] == 0 and st["n"] >= 4:
                    break
                page.wait_for_timeout(300)
            page.wait_for_timeout(500)
            ev(page, """() => {
                const g = __ns;
                for (let r = 0; r < 30; r++) {
                    const live = g._context.enemyList.filter(e => e.active && !e.dying);
                    for (const e of live) { e.hp = 0; g._onEnemyKilled(e, e.group.position); }
                    if (g.waveSystem.isComplete) break;
                }
                return true;
            }""")
        page.wait_for_timeout(400)
        page.screenshot(path=rf"{OUT}\bomba_hud3.png")
        print("frames:", ev(page, """() => ({
            stock: __ns._context.player.bombaCount,
            pips: [...document.querySelectorAll('#bombaPips .bomba-pip.on')].length,
        })"""))
        browser.close()


if __name__ == "__main__":
    main()
