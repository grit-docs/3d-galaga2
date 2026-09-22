"""Visual verification for BEAM + scripted waves (frames for vision_analyze):
  1. wave_v.png        - wave 3 V-split silhouette (leader deep + wings)
  2. beam_telegraph.png- thin pulsing warning line at the player lane
  3. beam_fire.png     - solid bright laser column through the lane
Run: uv run --with playwright python docs/verify_beam_frames.py
"""
from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"


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

        ev(page, """() => {
            const g = __ns; const p = g._context.player;
            p.lives = 99; p.shield = 100;
            g._imm = true; g._oHit = g._oHit || g._onPlayerHit.bind(g);
            g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
            return true;
        }""")

        # ---- 1: wave 3 V silhouette (wide shot, no beam yet) ---------
        ev(page, """() => {
            const g = __ns;
            g.beamSystem._cooldown = 999;   // suppress beam for the shot
            g.attackSystem._timer = 999;     // suppress dives so the V holds
            g._upgradePickDelay = 0;
            g._waveClearTimer = 0;
            g._startWave(3);
            return true;
        }""")
        page.wait_for_timeout(6500)  # let the approach + pair-spread finish
        page.screenshot(path="docs/frame_wave_v.png")
        print("frame_wave_v captured")

        # ---- 2+3: beam telegraph and fire ----------------------------
        ev(page, """() => {
            const g = __ns;
            g._upgradePickDelay = 0;
            g.beamSystem.reset();
            g.beamSystem._cooldown = 0.1;
            const p = g._context.player;
            p.group.position.set(0, 1.1, 17);
            return true;
        }""")
        tele_ok = fire_ok = False
        for _ in range(120):
            phase = ev(page, "() => __ns.beamSystem.phase")
            if phase == "charging" and not tele_ok:
                page.wait_for_timeout(120)  # mid-telegraph
                page.screenshot(path="docs/frame_beam_telegraph.png")
                tele_ok = True
            if phase == "firing" and not fire_ok:
                page.wait_for_timeout(150)  # solid beam
                page.screenshot(path="docs/frame_beam_fire.png")
                fire_ok = True
            if tele_ok and fire_ok:
                break
            page.wait_for_timeout(120)
        print("tele:", tele_ok, "fire:", fire_ok)

        # ---- 4: wave 6 ring ------------------------------------------
        ev(page, """() => {
            const g = __ns;
            g.beamSystem._cooldown = 999;
            g.beamSystem.reset();
            g._upgradePickDelay = 0;
            g._waveClearTimer = 0;
            g._startWave(6);
            return true;
        }""")
        page.wait_for_timeout(7000)
        page.screenshot(path="docs/frame_wave_ring.png")
        print("frame_wave_ring captured")

        browser.close()


if __name__ == "__main__":
    main()
