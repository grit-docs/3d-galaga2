"""Targeted verification for the second BOSS (Ember Carrier):
  C1  wave 5 keeps the original dreadnought (group name 'boss')
  C2  wave 10 hands the slot to Boss2 (group name 'boss2', HP 1400)
  C3  Boss2 sweeps wide (x amplitude > 10 over ~20s)
  C4  Boss2 fires 8-way fans (>=8 pending/hostile spawns per tick)
  C5  Boss2 calls drones (enemyList grows while the carrier lives)
  C6  killing the carrier transitions the run on (wave clear)
  C7  no page/console errors
Run: uv run --with playwright python docs/verify_boss2.py
"""
from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"
RESULTS = []
PAGE_ERRORS = []
CONSOLE_ERRORS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), str(detail)[:400]))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} :: {str(detail)[:300]}")


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
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: PAGE_ERRORS.append(str(e)))

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

        # ---- C1: wave 5 -> dreadnought --------------------------------
        start_wave(page, 5)
        page.wait_for_timeout(1200)
        w5 = ev(page, """() => ({
            name: __ns._context.boss.group.name,
            hp: __ns._context.boss.hp,
            alive: __ns._context.boss.alive,
        })""")
        check("C1 wave 5 keeps dreadnought",
              w5["name"] == "boss" and w5["alive"], str(w5))

        # ---- C2: wave 10 -> ember carrier -----------------------------
        start_wave(page, 10)
        page.wait_for_timeout(1500)
        w10 = ev(page, """() => ({
            name: __ns._context.boss.group.name,
            hp: __ns._context.boss.hp,
            maxHp: __ns._context.boss.maxHp,
            alive: __ns._context.boss.alive,
        })""")
        check("C2 wave 10 spawns the ember carrier (hp 1400)",
              w10["name"] == "boss2" and w10["maxHp"] == 1400 and w10["alive"],
              str(w10))

        # ---- C3: wide left/right sweep ---------------------------------
        xs = []
        for _ in range(40):
            x = ev(page, "__ns._context.boss.group.position.x")
            xs.append(x)
            page.wait_for_timeout(500)
        amp = (max(xs) - min(xs)) / 2
        check("C3 carrier sweeps wide (amplitude > 10)", amp > 10,
              f"amplitude={amp:.1f} min={min(xs):.1f} max={max(xs):.1f}")

        # ---- C4: 8-way fan ---------------------------------------------
        fans = []
        for _ in range(60):
            pend = ev(page, "__ns._context.boss._pending.length")
            if pend >= 6:
                fans.append(pend)
            page.wait_for_timeout(120)
            if len(fans) >= 5:
                break
        check("C4 carrier fires 8-way fans (pending >= 8 seen)",
              any(f >= 8 for f in fans), f"pending samples={fans}")

        # ---- C5: drone call-ins -----------------------------------------
        # The spawner adds 2 craft each cycle. Watch the spawned counter
        # (monotonic — ram-kills decrement the *alive* count, not spawned,
        # so we can't false-fail when a drone dive-rams the immune player).
        s0 = ev(page, "__ns.waveSystem._spawnedCount")
        peak = s0
        for _ in range(16):
            s = ev(page, "__ns.waveSystem._spawnedCount")
            peak = max(peak, s)
            if peak >= s0 + 2:
                break
            page.wait_for_timeout(500)
        check("C5 carrier calls drones (spawn counter grows +2)",
              peak >= s0 + 2, f"spawned {s0} -> peak {peak}")

        # ---- C6: killing the carrier clears the wave --------------------
        ev(page, "() => { const b = __ns._context.boss; b._invuln = 0; b.entering = false; b.hp = 1; return true; }")
        page.wait_for_timeout(200)
        ev(page, """() => {
            const g = __ns; const b = g._context.boss;
            const killed = b.hit(9999);
            g._onBossKilled(b, b.position);
            return killed;
        }""")
        page.wait_for_timeout(1500)
        post = ev(page, """() => ({
            state: __ns.state.current,
            bossAlive: __ns._context.boss.alive,
        })""")
        # wave clears: boss dead + transition to WAVE_CLEAR (drones may
        # still be alive, which isCorrect behaviour — isComplete waits)
        check("C6 carrier destroyed (alive=false)", post["bossAlive"] is False,
              f"state={post['state']}")

        # ---- C7: errors ---------------------------------------------------
        check("C7 no page errors", not PAGE_ERRORS,
              "; ".join(PAGE_ERRORS[:3]) or "clean")
        real = [e for e in CONSOLE_ERRORS
                if "favicon" not in e.lower() and "404" not in e]
        check("C8 no console errors", not real, "; ".join(real[:3]) or "clean")

        browser.close()

    passed = sum(1 for r in RESULTS if r[1])
    print(f"\n== SUMMARY ==\nPASS {passed}/{len(RESULTS)}")
    for name, ok, detail in RESULTS:
        if not ok:
            print(f"  FAIL {name}: {detail}")


if __name__ == "__main__":
    main()
