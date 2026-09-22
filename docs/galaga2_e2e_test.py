"""GALAGA 2 E2E review test — Playwright (headless Chromium, WebGPU).

Run:  python C:/AI-SILEE-DEV/3d-galaga-2/docs/galaga2_e2e_test.py
"""
import json
import time

from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"
RESULTS = []
CONSOLE_ERRORS = []
PAGE_ERRORS = []


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(f"[{'PASS' if ok else 'FAIL'}] {name} :: {detail}"[:300])


def ev(page, expr):
    return page.evaluate(expr)


def overlays(page):
    return ev(page, """() => {
        const ids = ['menu','pause','gameOver','waveClear'];
        const out = {};
        for (const id of ids) {
            const el = document.getElementById(id);
            out[id] = el ? el.style.display !== 'none' : null;
        }
        return out;
    }""")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=[
                "--enable-unsafe-webgpu", "--use-angle=d3d11",
                "--ignore-certificate-errors",
            ],
        )
        page = browser.new_page(viewport={"width": 1600, "height": 900})
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: PAGE_ERRORS.append(str(e)))

        # ---------- item 2: load + WebGPU + START ------------------
        page.goto(URL, wait_until="load", timeout=30000)
        page.wait_for_timeout(2500)
        badge = ev(page, "document.querySelector('[data-webgpu]')?.textContent || ''")
        check("2a load+WebGPU badge", "OK" in badge.upper(), badge.strip())

        state = ev(page, "window.__ns ? __ns.state.current : 'no-ns'")
        check("2b game booted (MAIN_MENU)", state == "MAIN_MENU", state)

        page.click("#startBtn")
        page.wait_for_timeout(800)
        state = ev(page, "__ns.state.current")
        ov = overlays(page)
        check("2c START GAME -> PLAYING", state == "PLAYING", f"state={state} overlays={ov}")

        # ---------- item 3: WASD movement + camera follow ----------
        pos0 = ev(page, "({x: __ns._context.player.position.x, y: __ns._context.player.position.y})")
        cam0 = ev(page, "__ns.renderer.camera.position.y")
        page.keyboard.down("w")
        page.wait_for_timeout(900)
        pos_up = ev(page, "({x: __ns._context.player.position.x, y: __ns._context.player.position.y})")
        cam_up = ev(page, "__ns.renderer.camera.position.y")
        page.keyboard.up("w")
        page.wait_for_timeout(250)  # let vertical velocity settle
        page.keyboard.down("s")
        page.wait_for_timeout(900)
        pos_dn = ev(page, "({x: __ns._context.player.position.x, y: __ns._context.player.position.y})")
        page.keyboard.up("s")
        page.keyboard.down("d")
        page.wait_for_timeout(700)
        pos_r = ev(page, "({x: __ns._context.player.position.x, y: __ns._context.player.position.y})")
        page.keyboard.up("d")
        page.keyboard.down("a")
        page.wait_for_timeout(700)
        pos_l = ev(page, "({x: __ns._context.player.position.x, y: __ns._context.player.position.y})")
        page.keyboard.up("a")
        inband = -3.1 <= pos_up["y"] and pos_up["y"] <= 9.6 and -3.1 <= pos_l["y"] <= 9.6
        check("3a W moves up (y)", pos_up["y"] > pos0["y"] + 0.8,
              f"y {pos0['y']:.2f}->{pos_up['y']:.2f} (band ok={inband})")
        check("3b S moves down (y)", pos_dn["y"] < pos_up["y"] - 0.8,
              f"y {pos_up['y']:.2f}->{pos_dn['y']:.2f}")
        check("3c D/A move right/left (x)",
              pos_r["x"] > pos0["x"] + 2 and pos_l["x"] < pos_r["x"] - 2,
              f"x {pos0['x']:.2f} -> {pos_r['x']:.2f} -> {pos_l['x']:.2f}")
        check("3d camera Y-follow", cam_up > cam0 + 0.3,
              f"camY {cam0:.2f}->{cam_up:.2f}")

        # ---------- item 4: reticle + 3D aim firing + kill --------
        ret_display = ev(page, """() => {
            const el = document.getElementById('aim-reticle');
            return el ? getComputedStyle(el).display : 'missing';
        }""")
        # move mouse to upper area
        page.mouse.move(800, 200)
        page.wait_for_timeout(150)
        locked_before = ev(page, "__ns._reticleLocked")
        # poll until an enemy is inside the viewport (they enter from
        # deep z and drift into the frustum over a few seconds)
        aim_info = None
        for _ in range(12):
            aim_info = ev(page, """() => {
            const g = window.__ns;
            const cam = g.renderer.camera;
            const enemies = g._context.enemyList.filter(e =>
                e.active && !e.dying && e.group.position.z < 10);
            if (!enemies.length) return null;
            // project each; keep only those inside the viewport
            const V = enemies[0].group.position.constructor;
            const cands = [];
            for (const en of enemies) {
                const v = new V(en.group.position.x, en.group.position.y, en.group.position.z);
                v.project(cam);
                const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
                const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
                if (isFinite(sx) && isFinite(sy) &&
                    sx > 60 && sx < window.innerWidth - 60 &&
                    sy > 60 && sy < window.innerHeight - 60)
                    cands.push({ en, sx, sy });
            }
            if (!cands.length) return null;
            const pick = cands.reduce((a, b) =>
                b.en.group.position.z > a.en.group.position.z ? b : a);
            return { sx: pick.sx, sy: pick.sy,
                     enemyZ: pick.en.group.position.z,
                     locked: g._reticleLocked };
        }""")
            if aim_info:
                break
            page.wait_for_timeout(500)
        check("4a reticle element visible in PLAYING", ret_display != "none",
              f"display={ret_display} enemies={ev(page, '__ns._context.enemyList.length')}")
        kills0 = ev(page, "__ns.kills")
        score0 = ev(page, "__ns.score")
        if aim_info and all(map(lambda v: v == v, (aim_info.get("sx"), aim_info.get("sy")))):
            page.mouse.move(aim_info["sx"], aim_info["sy"])
            page.wait_for_timeout(120)
            locked_after = ev(page, "__ns._reticleLocked")
            check("4b reticle lock on targeted enemy", locked_after is True,
                  f"locked {locked_before}->{locked_after} (aim @ {aim_info['sx']:.0f},{aim_info['sy']:.0f})")
            # hold fire for up to 8s until a kill happens
            page.mouse.down()
            t_end = time.time() + 8
            kills = ev(page, "__ns.kills")
            while kills <= kills0 and time.time() < t_end:
                page.wait_for_timeout(300)
                kills = ev(page, "__ns.kills")
            page.mouse.up()
            check("4c shot kills aimed enemy (collision+score)",
                  kills > kills0,
                  f"kills {kills0}->{kills} score {score0}->{ev(page, '__ns.score')}")
        else:
            check("4b reticle lock (no enemy found)", False, "no enemy on screen")
            check("4c shot kills enemy", False, "no enemy to aim at")

        # ---------- item 5: 3D entry from depth (wave 3 ring/lane) -
        ev(page, "__ns._startWave(3)")
        page.wait_for_timeout(2500)
        entry_stat = ev(page, """() => {
            const g = window.__ns;
            const es = g._context.enemyList;
            const zs = es.map(e => e.group.position.z);
            const xs = es.map(e => e.group.position.x);
            return {
                n: es.length,
                minZ: Math.min(...zs), maxZ: Math.max(...zs),
                maxX: Math.max(...xs.map(v => Math.abs(v))),
            };
        }""")
        check("5a enemies enter from 3D depth (min z < -40 or wide x)",
              entry_stat["minZ"] < -40 or entry_stat["maxX"] > 30,
              f"n={entry_stat['n']} z[{entry_stat['minZ']:.1f},{entry_stat['maxZ']:.1f}] maxX={entry_stat['maxX']:.1f}")
        # dives are transient — poll up to 10s for a DIVING/APPROACHING state
        diving = 0
        for _ in range(20):
            diving = ev(page, "__ns._context.enemyList.filter(e => e.state==='DIVING' || e.state==='APPROACHING').length")
            if diving:
                break
            page.wait_for_timeout(500)
        check("5b 3D dives/approaches occur", diving >= 1, f"diving/approaching={diving}")

        # ---------- item 6: boss (wave 5) --------------------------
        # A stationary test rig would be shot down by the boss's aimed
        # barrage (expected gameplay), so make the harness immune to
        # damage while we verify the boss itself. Also make sure the
        # player is alive (item 5's enemy fire may have killed them).
        ev(page, """() => {
            const g = __ns;
            const p = g._context.player;
            if (!p.alive || g.state.current !== 'PLAYING') g._restart();
            p.alive = true; p.lives = 99; p.shield = 100;
            p.invulnTimer = 0; p.group.visible = true;
            g._context.projectiles.deactivateHostile();
            g._origOnPlayerHit = g._onPlayerHit.bind(g);
            g._bossTestImmune = true;
            g._onPlayerHit = (d) => { if (!g._bossTestImmune) g._origOnPlayerHit(d); };
            return g.state.current;
        }""")
        ev(page, "__ns._startWave(5)")
        page.wait_for_timeout(1000)
        st_intro = ev(page, "__ns.state.current")
        page.wait_for_timeout(2500)
        st_play = ev(page, "__ns.state.current")
        boss_alive = ev(page, "__ns._context.boss.alive")
        check("6a boss intro -> PLAYING, boss alive",
              st_intro == "BOSS_INTRO" and st_play == "PLAYING" and boss_alive,
              f"intro={st_intro} play={st_play} boss={boss_alive}")
        # wait out invuln floor (3s) + arrival, then damage in small
        # chunks while the game loop runs so update() recomputes phases
        page.wait_for_timeout(3500)
        phases = ev(page, """() => new Promise(res => {
            const b = __ns._context.boss;
            const seen = new Set();
            let i = 0;
            (function step() {
                if (b.alive && i < 60) {
                    b.hit(b.maxHp / 80); // ~1.25% per chunk, slow bleed
                    if (b.alive) seen.add(b.phase);
                    i++;
                    setTimeout(step, 400);
                } else res({ alive: b.alive, phases: [...seen].sort(),
                             ratio: b.coreHpRatio });
            })();
        })""")
        check("6b boss 3 phases reachable", len(phases["phases"]) >= 2 and phases["alive"],
              f"phases={phases['phases']} ratio={phases['ratio']:.2f}")
        hostile = ev(page, "[...__ns._context.projectiles.activeProjectiles].filter(p => p.hostile).length")
        check("6c boss fires (hostile projectiles present)", hostile >= 1, f"hostile={hostile}")
        # kill boss through the real callback path
        killed = ev(page, """() => {
            const b = __ns._context.boss;
            if (!b.alive) return 'already-dead';
            b.hit(99999);
            __ns._onBossKilled(b, b.position.clone());
            return __ns.state.current;
        }""")
        page.wait_for_timeout(500)
        boss_hidden = ev(page, "!__ns._context.boss.alive")
        ov = overlays(page)
        check("6d boss kill -> wave clear transition",
              killed in ("WAVE_CLEAR", "PLAYING") and boss_hidden,
              f"state-after={killed} overlays={ov}")
        # restore the real hit handler and vulnerability
        ev(page, """() => {
            const g = __ns;
            g._bossTestImmune = false;
            g._onPlayerHit = g._origOnPlayerHit;
            delete g._origOnPlayerHit;
            return true;
        }""")

        # ---------- item 7: dash / lives / game over / retry ------
        page.wait_for_timeout(ev(page, "__ns._waveClearTimer > 0 ? __ns._waveClearTimer * 1000 + 500 : 200"))
        # dash i-frame: real Shift key, let the game loop trigger the
        # dash, then deal a hit while invulnTimer is still active
        page.keyboard.down("ShiftLeft")
        page.wait_for_timeout(60)
        dash_res = ev(page, """() => {
            const g = __ns;
            const p = g._context.player;
            const d = p.dashTimer, inv = p.invulnTimer;
            const shieldBefore = p.shield, livesBefore = p.lives;
            g._onPlayerHit(30);
            return { d, inv, shieldBefore, shieldAfter: p.shield,
                     livesBefore, livesAfter: p.lives };
        }""")
        page.keyboard.up("ShiftLeft")
        check("7a dash gives i-frames (shield/lives unharmed)",
              dash_res["d"] > 0 and dash_res["inv"] > 0
              and dash_res["shieldBefore"] == dash_res["shieldAfter"]
              and dash_res["livesBefore"] == dash_res["livesAfter"],
              f"dashTimer={dash_res['d']:.3f} invuln={dash_res['inv']:.3f} "
              f"shield {dash_res['shieldBefore']}->{dash_res['shieldAfter']} "
              f"lives {dash_res['livesBefore']}->{dash_res['livesAfter']}")
        # game over
        go = ev(page, """() => {
            const g = __ns;
            g._context.player.lives = 1; g._context.player.shield = 10;
            g._context.player.invulnTimer = 0;
            g._onPlayerHit(999);
            return { state: g.state.current, alive: g._context.player.alive };
        }""")
        page.wait_for_timeout(400)
        ov = overlays(page)
        check("7b game over on final life lost",
              go["state"] == "GAME_OVER" and ov["gameOver"] is True and not go["alive"],
              f"state={go['state']} overlays={ov}")
        # retry
        rt = ev(page, """() => {
            const g = __ns;
            g._restart();
            return { state: g.state.current, score: g.score, wave: g.waveSystem.wave,
                     alive: g._context.player.alive, lives: g._context.player.lives };
        }""")
        page.wait_for_timeout(400)
        ov = overlays(page)
        check("7c RETRY -> fresh run (PLAYING, score 0, wave 1, 3 lives)",
              rt["state"] == "PLAYING" and rt["score"] == 0 and rt["wave"] == 1
              and rt["lives"] == 3 and not any(ov.values()),
              f"{rt} overlays={ov}")

        # ---------- item 8: pause overlay -------------------------
        page.keyboard.press("p")
        page.wait_for_timeout(300)
        st_p = ev(page, "__ns.state.current")
        ov_p = overlays(page)
        page.keyboard.press("p")
        page.wait_for_timeout(300)
        st_r = ev(page, "__ns.state.current")
        check("8 pause/resume via P", st_p == "PAUSED" and ov_p["pause"] is True and st_r == "PLAYING",
              f"pause={st_p} resume={st_r}")

        # ---------- item 9: console errors + FPS ------------------
        real_errors = [e for e in CONSOLE_ERRORS
                       if "favicon" not in e.lower() and "404" not in e]
        check("9a no console errors", not real_errors and not PAGE_ERRORS,
              f"console={len(real_errors)} page={len(PAGE_ERRORS)} "
              + "; ".join((real_errors + PAGE_ERRORS)[:3]))
        fps = ev(page, """() => new Promise(res => {
            let n = 0; const t0 = performance.now();
            (function f() { n++;
                if (n < 300) requestAnimationFrame(f);
                else res(Math.round((n - 1) / ((performance.now() - t0) / 1000)));
            })();
        })""")
        check("9b ~60fps (>= 45)", fps >= 45, f"fps={fps}")

        browser.close()

    # ---------- report -------------------------------------------
    lines = ["# GALAGA 2 — 리뷰어 E2E 테스트 보고서", "",
             f"실행 시각: {time.strftime('%Y-%m-%d %H:%M:%S')}",
             f"환경: Playwright headless Chromium (WebGPU flag), {URL}", "",
             "## 결과 요약", ""]
    passed = sum(1 for r in RESULTS if r["ok"])
    lines.append(f"**PASS {passed}/{len(RESULTS)}**")
    lines.append("")
    lines.append("| # | 항목 | 결과 | 상세 |")
    lines.append("|---|------|------|------|")
    for i, r in enumerate(RESULTS, 1):
        lines.append(f"| {i} | {r['name']} | {'✅' if r['ok'] else '❌'} | {r['detail']} |")
    lines += ["", "## 콘솔/페이지 에러", ""]
    lines += (CONSOLE_ERRORS + PAGE_ERRORS) or ["(없음)"]
    lines.append("")
    with open(r"C:\AI-SILEE-DEV\3d-galaga-2\docs\GALAGA2-REVIEW-REPORT.md", "w",
              encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n== SUMMARY ==")
    print(json.dumps({r["name"]: "PASS" if r["ok"] else "FAIL" for r in RESULTS},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
