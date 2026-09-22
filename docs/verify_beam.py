"""Targeted verification for the BEAM + scripted-wave features:

BEAM (wave 3+):
  B1  beam system exists, idle on wave 1-2
  B2  wave 3: a beam fires within ~12s (phase charging->firing)
  B3  beam telegraph is visible during charging, solid beam during firing
  B4  shooter pair holds a beam pose (y ~14.5) while active
  B5  player standing inside the column takes damage during fire
  B6  BOMBA cancels an in-progress beam
SCRIPTED WAVES:
  B7  wave 3 pattern = 'v'  (V-split layout: leader deep + symmetric wings)
  B8  wave 6 pattern = 'ring' (convergence circle)
  B9  scripted layouts keep authored types (no scouts in V/ring)
  B10 non-scripted wave (e.g. 4) stays on rows pattern
  B11 no page/console errors
Run: uv run --with playwright python docs/verify_beam.py
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


def block_panel(page):
    ev(page, """() => {
        try {
            if (__ns._upgradeSelect.active) __ns._upgradeSelect.cancel();
            __ns._upgradePickDelay = 0;
        } catch (e) {}
        return true;
    }""")


def make_immortal(page):
    ev(page, """() => {
        const g = __ns; const p = g._context.player;
        p.alive = true; p.lives = 99; p.shield = 100;
        g._imm = true; g._oHit = g._oHit || g._onPlayerHit.bind(g);
        g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
        return true;
    }""")


def start_wave(page, wave):
    ev(page, f"""() => {{
        __ns._waveClearTimer = 0; __ns._upgradePickDelay = 0;
        __ns.beamSystem.reset();
        __ns._startWave({wave}); return true;
    }}""")


def wait_spawned(page, tries=60):
    for _ in range(tries):
        st = ev(page, """() => ({
            q: __ns.waveSystem._spawnQueue.length,
            n: __ns._context.enemyList.filter(e => e.active).length,
        })""")
        if st["q"] == 0 and st["n"] >= 4:
            return st
        page.wait_for_timeout(300)
    return st


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
        make_immortal(page)
        block_panel(page)

        # ---- B1: beam idle on wave 1 ---------------------------------
        idle = ev(page, """() => ({
            active: __ns.beamSystem.active,
            phase: __ns.beamSystem.phase,
        })""")
        check("B1 beam idle on wave 1",
              idle["active"] is False and idle["phase"] == "idle", str(idle))

        # ---- B2/B3/B4: beam fires on wave 3 --------------------------
        start_wave(page, 3)
        fired = False
        sawTelegraph = False
        sawBeam = False
        shooterY = None
        for _ in range(80):
            st = ev(page, """() => {
                const b = __ns.beamSystem;
                const shooters = b.shooters
                    .filter(s => s.active).map(s => ({ y: s.group.position.y, pose: !!s._beamPose }));
                return { phase: b.phase, t: b.t,
                         tele: b._telegraph.visible, beam: b._beam.visible,
                         shooters };
            }""")
            if st["phase"] == "charging" and st["tele"]:
                sawTelegraph = True
            if st["phase"] == "firing":
                fired = True
                if st["beam"]:
                    sawBeam = True
                    ys = [s["y"] for s in st["shooters"] if s["pose"]]
                    shooterY = min(ys) if ys else None
                break
            page.wait_for_timeout(250)
        check("B2 beam fires on wave 3 (phase reaches firing)", fired,
              f"telegraph={sawTelegraph} fired={fired}")
        check("B3 telegraph visible while charging", sawTelegraph,
              f"sawTelegraph={sawTelegraph}")
        check("B3 solid beam visible while firing", sawBeam, f"sawBeam={sawBeam}")
        check("B4 shooters hold charge pose (y ~14.5)",
              shooterY is not None and 12 < shooterY < 17, f"y={shooterY}")

        # ---- B5: standing in the column takes damage -----------------
        # wait for the NEXT beam, then park the player on its x/z
        ev(page, "() => { __ns.beamSystem._cooldown = 0.2; return true; }")
        shield_before = None
        dmg = None
        for _ in range(80):
            st = ev(page, "() => ({ phase: __ns.beamSystem.phase })")
            if st["phase"] == "charging":
                ev(page, """() => {
                    const b = __ns.beamSystem;
                    const p = __ns._context.player;
                    p.group.position.set(b.x, 2, b.z);
                    p.velocityX = 0; p.velocityY = 0;
                    p.shield = 100;
                    return true;
                }""")
                shield_before = ev(page, "__ns._context.player.shield")
                break
            page.wait_for_timeout(150)
        if shield_before is not None:
            page.wait_for_timeout(1600)  # through charging(0.6) + firing(1.2)
            dmg = shield_before - ev(page, "__ns._context.player.shield")
        check("B5 player in column takes beam damage",
              dmg is not None and dmg > 0, f"shield {shield_before} -> {shield_before - (dmg or 0)}")
        # restore free movement
        ev(page, """() => {
            const p = __ns._context.player;
            p.group.position.set(0, 1.1, 17);
            return true;
        }""")

        # ---- B6: BOMBA cancels an in-progress beam -------------------
        ev(page, "() => { __ns.beamSystem._cooldown = 0.2; return true; }")
        cancelled = None
        for _ in range(80):
            if ev(page, "() => __ns.beamSystem.phase") != "idle":
                ev(page, "() => { __ns._context.player.bombaCount = 1; __ns._tryBomba(); return true; }")
                page.wait_for_timeout(150)
                cancelled = ev(page, """() => ({
                    active: __ns.beamSystem.active,
                    phase: __ns.beamSystem.phase,
                    poses: __ns._context.enemyList.filter(e => e._beamPose).length,
                })""")
                break
            page.wait_for_timeout(150)
        check("B6 BOMBA cancels in-progress beam",
              cancelled is not None and not cancelled["active"]
              and cancelled["phase"] == "idle" and cancelled["poses"] == 0,
              str(cancelled))

        # ---- B7: wave 3 pattern = V ----------------------------------
        pattern3 = ev(page, "__ns.waveSystem._patternFor(3)")
        check("B7 wave 3 pattern = 'v'", pattern3 == "v", f"pattern={pattern3}")
        vplan = ev(page, """() => {
            const ws = __ns.waveSystem;
            ws._isBossWave = false;
            const plan = ws._layoutFor(3);
            return { n: plan.length,
                     leader: plan[0],
                     sym: plan.filter(s => s.pos.x > 0).length
                            + plan.filter(s => s.pos.x < 0).length };
        }""")
        check("B8 V layout: leader deep, symmetric wings",
              vplan["n"] >= 8 and abs(vplan["leader"]["pos"]["x"]) < 0.01
              and vplan["leader"]["pos"]["z"] < -40 and vplan["sym"] >= 6,
              f"n={vplan['n']} leader={vplan['leader']['pos']} sym={vplan['sym']}")

        # ---- B9: wave 6 pattern = ring --------------------------------
        pattern6 = ev(page, "__ns.waveSystem._patternFor(6)")
        check("B9 wave 6 pattern = 'ring'", pattern6 == "ring", f"pattern={pattern6}")
        ring = ev(page, """() => {
            const ws = __ns.waveSystem;
            ws._isBossWave = false;
            const plan = ws._layoutFor(6);
            const xs = plan.map(s => s.pos.x);
            const minx = Math.min(...xs), maxx = Math.max(...xs);
            return { n: plan.length, span: maxx - minx,
                     hasFighter: plan.some(s => s.type === 'fighter'),
                     hasElite: plan.some(s => s.type === 'elite') };
        }""")
        check("B10 ring layout: circle span + tier mix",
              ring["n"] >= 10 and ring["span"] > 20
              and ring["hasFighter"] and ring["hasElite"],
              f"n={ring['n']} span={ring['span']:.1f}")

        # ---- B11: scripted waves keep authored types (no scouts) -----
        start_wave(page, 3)
        wait_spawned(page)
        page.wait_for_timeout(500)
        types3 = ev(page, """() => [...new Set(
            __ns._context.enemyList.filter(e => e.active).map(e => e.type))].sort()""")
        check("B11 V wave has no scouts (authored types only)",
              "scout" not in types3, f"types={types3}")

        # ---- B12: wave 4 stays on rows --------------------------------
        pattern4 = ev(page, "__ns.waveSystem._patternFor(4)")
        check("B12 wave 4 pattern = 'rows' (non-scripted)", pattern4 == "rows",
              f"pattern={pattern4}")

        # ---- errors ----------------------------------------------------
        check("B13 no page errors", not PAGE_ERRORS, "; ".join(PAGE_ERRORS[:3]) or "clean")
        real = [e for e in CONSOLE_ERRORS
                if "favicon" not in e.lower() and "404" not in e]
        check("B14 no console errors", not real, "; ".join(real[:3]) or "clean")

        browser.close()

    passed = sum(1 for r in RESULTS if r[1])
    print(f"\n== SUMMARY ==\nPASS {passed}/{len(RESULTS)}")
    for name, ok, detail in RESULTS:
        if not ok:
            print(f"  FAIL {name}: {detail}")


if __name__ == "__main__":
    main()
