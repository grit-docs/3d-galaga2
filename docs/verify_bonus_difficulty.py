"""Targeted verification for this task:
  A) wave-clear NO LONGER grants the base bonus (points + shield) —
     the payoff is now ONLY the 3-card upgrade pick.
  B) difficulty knobs are live in the running bundle (denser waves,
     tougher enemy HP, harder/faster hostiles, faster dives, boss HP up).
Run: uv run --with playwright python docs/verify_bonus_difficulty.py
"""
import time
from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"
RESULTS = []
PAGE_ERRORS = []
CONSOLE_ERRORS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), str(detail)[:400]))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} :: {str(detail)[:300]}")


def ev(page, expr):
    return page.evaluate(expr)


def wait_full_spawn(page, tries=40):
    """Wait until the spawn queue is empty (all planned enemies spawned)."""
    for _ in range(tries):
        n = ev(page, "__ns.waveSystem._spawnQueue.length")
        if n == 0:
            return
        page.wait_for_timeout(300)


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11",
                  "--ignore-certificate-errors"],
        )
        page = browser.new_page(viewport={"width": 1600, "height": 900})
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: PAGE_ERRORS.append(str(e)))

        page.goto(URL, wait_until="load", timeout=30000)
        page.wait_for_timeout(2500)
        badge = ev(page, "document.querySelector('[data-webgpu]')?.textContent || ''")
        check("A0 load+WebGPU", "OK" in badge.upper(), badge.strip())
        check("A1 booted MAIN_MENU", ev(page, "window.__ns?.state.current") == "MAIN_MENU",
              ev(page, "window.__ns?.state.current"))

        page.click("#startBtn")
        page.wait_for_timeout(700)
        check("A2 START -> PLAYING", ev(page, "__ns.state.current") == "PLAYING",
              ev(page, "__ns.state.current"))

        # Make the rig invulnerable so enemy fire doesn't game-over mid-test.
        ev(page, """() => {
            const g = __ns; const p = g._context.player;
            p.alive = true; p.lives = 99; p.shield = 100;
            g._imm = true; g._oHit = g._onPlayerHit.bind(g);
            g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
            return true;
        }""")

        # ---- B: wave 1 density + enemy HP are live -----------------
        wait_full_spawn(page)
        page.wait_for_timeout(800)
        w1 = ev(page, """() => {
            const g = __ns; const es = g._context.enemyList;
            const hp = {};
            for (const e of es) hp[e.type] = e.maxHp;
            return { n: es.length, hp };
        }""")
        check("B1 wave1 density = 8 (2x4)", w1["n"] == 8, f"n={w1['n']}")
        check("B2 fighter maxHp = 2 (was 1)", w1["hp"].get("fighter") == 2,
              f"hp={w1['hp']}")

        # ---- A: base-bonus removal (clean isolation) ---------------
        # Disable powerup drops so the ONLY possible shield source during
        # the clear is the (removed) base bonus. Kill all enemies through
        # the real callback; then WAVE_CLEAR must NOT bump shield/score.
        ev(page, """() => {
            const g = __ns; const p = g._context.player;
            g._context.projectiles.spawnPowerUp = () => {};  // no drops
            p.shield = 50; g.score = 0;
            return { shield: p.shield, score: g.score };
        }""")
        before = ev(page, """() => ({ s: __ns._context.player.shield,
                                       sc: __ns.score })""")
        kill_res = ev(page, """() => {
            const g = __ns;
            for (const e of g._context.enemyList.slice()) {
                if (e.active && !e.dying) { e.hp = 0; g._onEnemyKilled(e, e.group.position); }
            }
            return g.state.current;
        }""")
        page.wait_for_timeout(600)
        after = ev(page, """() => ({
            state: __ns.state.current,
            s: __ns._context.player.shield,
            sc: __ns.score,
            hasPanel: !!__ns._upgradeSelect
        })""")
        # If the base bonus were still present: shield 50 -> 70 (+20) and
        # score would include a flat +200. With it removed, shield is 50.
        check("A3 wave-clear reached", after["state"] == "WAVE_CLEAR",
              f"state={after['state']} kill_res={kill_res}")
        check("A4 base BONUS REMOVED (shield unchanged, no +20)",
              after["s"] == before["s"], f"shield {before['s']} -> {after['s']}")
        check("A5 3-card upgrade pick still opens (replacement payoff)",
              after["hasPanel"] is True, f"hasPanel={after['hasPanel']}")

        # cancel the panel so the world unfreezes for the rest of the test
        ev(page, "() => { try { __ns._upgradeSelect.cancel(); } catch(e) {} "
                 "return true; }")
        page.wait_for_timeout(300)

        # ---- B: hostile projectile damage is live (28) -------------
        # jump to a wave with firing enemies, sample a live hostile shot
        ev(page, "__ns._restart()")
        ev(page, """() => {
            const g = __ns; const p = g._context.player;
            p.alive = true; p.lives = 99; p.shield = 100;
            g._imm = true; g._oHit = g._onPlayerHit.bind(g);
            g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
            return true;
        }""")
        ev(page, "__ns._startWave(4)")
        dmg = None
        for _ in range(30):
            dmg = ev(page, """() => {
                const ps = [...__ns._context.projectiles.activeProjectiles]
                           .filter(p => p.hostile);
                return ps.length ? ps[0].damage : null;
            }""")
            if dmg: break
            page.wait_for_timeout(400)
        check("B3 hostile shot damage = 28 (was 22)", dmg == 28, f"damage={dmg}")

        # ---- B: dive behavior still occurs (faster cadence) --------
        diving = 0
        for _ in range(20):
            diving = ev(page, "__ns._context.enemyList.filter(e => e.state==='DIVING'||e.state==='APPROACHING').length")
            if diving: break
            page.wait_for_timeout(500)
        check("B4 dives/approaches occur (difficulty live)", diving >= 1,
              f"diving={diving}")

        # ---- B: wave 8 density (4x6 = 24) --------------------------
        ev(page, "__ns._startWave(8)")
        wait_full_spawn(page)
        page.wait_for_timeout(800)
        w8 = ev(page, "() => __ns._context.enemyList.length")
        check("B5 wave8 density = 24 (4x6)", w8 == 24, f"n={w8}")

        # ---- B: boss HP up (wave 5 boss maxHp = 980) ---------------
        ev(page, """() => {
            const g = __ns; const p = g._context.player;
            p.alive = true; p.lives = 99; p.shield = 100;
            g._imm = true; g._oHit = g._onPlayerHit.bind(g);
            g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
            return true;
        }""")
        ev(page, "__ns._startWave(5)")
        page.wait_for_timeout(3500)
        boss_hp = ev(page, "__ns._context.boss.maxHp")
        check("B6 boss maxHp = 980 (was 820)", boss_hp == 980, f"maxHp={boss_hp}")

        # ---- no page errors ----------------------------------------
        check("C1 no page errors", not PAGE_ERRORS,
              "; ".join(PAGE_ERRORS[:3]) or "clean")
        real = [e for e in CONSOLE_ERRORS
                if "favicon" not in e.lower() and "404" not in e]
        check("C2 no console errors", not real,
              "; ".join(real[:3]) or "clean")

        browser.close()

    print("\n== SUMMARY ==")
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"PASS {passed}/{len(RESULTS)}")
    for name, ok, det in RESULTS:
        if not ok:
            print(f"  FAIL {name}: {det}")


if __name__ == "__main__":
    main()
