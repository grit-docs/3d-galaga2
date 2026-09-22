"""Targeted verification for the BOMBA feature:
  1. starts with 1 stock, HUD pip shows 1 lit
  2. L key fires it: hostile shots wiped, whole board killed,
     slow-mo timer set, score credited, wave clear triggered.
     (board clear grants +1 in the SAME frame -> stock round-trips
     1 -> 0 -> 1; the consumption itself is proven separately)
  3. consumption without a clear: pressing L on an EMPTY board
     (WAVE_CLEAR) decrements stock with no grant -> 1 -> 0, pip off
  4. a normal wave clear grants +1 stock (isolated: stock 0 -> 1)
  5. stock capped at COUNT_MAX (3)
  6. BOMBA wipes ALL hostile shots on a firing wave
  7. empty-stock press is a safe no-op
  8. no page/console errors
Run: uv run --with playwright python docs/verify_bomba.py
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


def ev(page, expr, *args):
    return page.evaluate(expr, *args)


def wait_full_spawn(page, tries=40):
    for _ in range(tries):
        n = ev(page, "__ns.waveSystem._spawnQueue.length")
        if n == 0:
            return
        page.wait_for_timeout(300)


def make_immortal(page):
    ev(page, """() => {
        const g = __ns; const p = g._context.player;
        p.alive = true; p.lives = 99; p.shield = 100;
        g._imm = true; g._oHit = g._oHit || g._onPlayerHit.bind(g);
        g._onPlayerHit = (d) => { if (!g._imm) g._oHit(d); };
        return true;
    }""")


def pips_on(page):
    return ev(page,
              "document.querySelectorAll('#bombaPips .bomba-pip.on').length")


def kill_board_normally(page, loops=30):
    """Kill live enemies through the normal path until the wave is
    actually complete (re-kill rounds pick up craft that spawned
    after the previous pass — single passes miss late spawns)."""
    return ev(page, """(loops) => {
        const g = __ns; let round = 0;
        for (round = 0; round < loops; round++) {
            const live = g._context.enemyList.filter(e => e.active && !e.dying);
            for (const e of live) { e.hp = 0; g._onEnemyKilled(e, e.group.position); }
            if (g.waveSystem.isComplete) break;
        }
        return { rounds: round + 1, complete: g.waveSystem.isComplete,
                 wave: g.waveSystem.wave, state: g.state.current };
    }""", loops)


def block_panel(page):
    """Keep the wave-clear lull moving: zero the upgrade-pick delay so
    the panel never opens (an open panel FREEZES the WAVE_CLEAR
    countdown forever — a one-shot cancel races the 0.9s delay) and
    cancel a panel that is already open."""
    ev(page, """() => {
        try {
            if (__ns._upgradeSelect.active) __ns._upgradeSelect.cancel();
            __ns._upgradePickDelay = 0;
        } catch (e) {}
        return true;
    }""")


def ensure_playing(page, max_ms=10000):
    """Block the upgrade panel and wait until the state is PLAYING
    (the lull is 3.2s; every clear re-arms the 0.9s pick delay)."""
    deadline = time.time() + max_ms / 1000
    while time.time() < deadline:
        block_panel(page)
        if ev(page, "__ns.state.current") == "PLAYING":
            return
        page.wait_for_timeout(250)
    block_panel(page)


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
        check("T0 load+WebGPU", "OK" in badge.upper(), badge.strip())
        check("T1 booted MAIN_MENU", ev(page, "window.__ns?.state.current") == "MAIN_MENU",
              ev(page, "window.__ns?.state.current"))

        page.click("#startBtn")
        page.wait_for_timeout(700)
        check("T2 START -> PLAYING", ev(page, "__ns.state.current") == "PLAYING",
              ev(page, "__ns.state.current"))
        make_immortal(page)

        # ---- 1: initial stock + HUD pip -----------------------------
        wait_full_spawn(page)
        page.wait_for_timeout(400)
        stock0 = ev(page, "__ns._context.player.bombaCount")
        check("T3 starts with 1 BOMBA", stock0 == 1, f"stock={stock0}")
        check("T4 HUD pip shows 1 lit", pips_on(page) == 1, f"pips={pips_on(page)}")

        # ---- 2: fire BOMBA with L on wave 1 --------------------------
        enemies_before = ev(page, "__ns._context.enemyList.length")
        score_before = ev(page, "__ns.score")
        page.keyboard.press("KeyL")
        page.wait_for_timeout(250)
        post = ev(page, """() => ({
            stock: __ns._context.player.bombaCount,
            timer: __ns._bombaTimer,
            enemies: __ns._context.enemyList.filter(e => e.active && !e.dying).length,
            hostiles: [...__ns._context.projectiles.activeProjectiles]
                      .filter(p => p.hostile).length,
            score: __ns.score,
            state: __ns.state.current,
        })""")
        # 1 -> 0 (consumed) -> +1 (the board clear it caused, same frame)
        check("T5 blast consumed stock (round-trip to 1 after clear grant)",
              post["stock"] == 1, f"stock={post['stock']}")
        check("T6 slow-mo timer set (>0, 3s BOMBA scale)", post["timer"] > 2,
              f"timer={post['timer']:.3f}")
        check("T7 whole board killed (wave1 = 8)",
              enemies_before == 8 and post["enemies"] == 0,
              f"before={enemies_before} after={post['enemies']}")
        check("T8 score credited for kills", post["score"] > score_before,
              f"{score_before} -> {post['score']}")
        check("T9 board clear -> WAVE_CLEAR transition",
              post["state"] == "WAVE_CLEAR", f"state={post['state']}")
        block_panel(page)

        # ---- 3: consumption WITHOUT a clear (empty board) ------------
        # We're in WAVE_CLEAR with zero live enemies: pressing L must
        # simply spend one unit (no grant can happen).
        stock_a = ev(page, "__ns._context.player.bombaCount")
        page.keyboard.press("KeyL")
        page.wait_for_timeout(250)
        stock_b = ev(page, "__ns._context.player.bombaCount")
        check("T10 consumption without clear: stock -1, no grant",
              stock_a == 1 and stock_b == 0, f"{stock_a} -> {stock_b}")
        check("T11 HUD pip shows 0 lit", pips_on(page) == 0, f"pips={pips_on(page)}")

        # ---- 4: normal wave clear grants +1 (isolated) ---------------
        # Block the upgrade panel so the lull ends and wave 2 starts.
        ensure_playing(page)
        # settle: wait until enemies are actually in the live list
        # (spawn queue empty AND a handful of craft present), so the
        # kill below completes the wave and the clear grant fires.
        for _ in range(40):
            st = ev(page, """() => ({
                q: __ns.waveSystem._spawnQueue.length,
                n: __ns._context.enemyList.filter(e => e.active).length,
            })""")
            if st["q"] == 0 and st["n"] >= 4:
                break
            page.wait_for_timeout(300)
        page.wait_for_timeout(600)
        ev(page, "() => { __ns._context.player.bombaCount = 0; return true; }")
        kr = kill_board_normally(page)
        page.wait_for_timeout(400)
        stock_c = ev(page, "__ns._context.player.bombaCount")
        state_c = ev(page, "__ns.state.current")
        check("T12 normal clear grants +1 (0 -> 1)", stock_c == 1,
              f"stock={stock_c} state={state_c} kill={kr}")
        check("T13 HUD pip back to 1 lit", pips_on(page) == 1, f"pips={pips_on(page)}")
        block_panel(page)

        # ---- 5: cap at COUNT_MAX (3) ---------------------------------
        # let the wave-3 lull end, settle on live enemies, then clear
        # the board with stock pinned at the cap -> grant must be a no-op
        ensure_playing(page)
        for _ in range(40):
            st = ev(page, """() => ({
                q: __ns.waveSystem._spawnQueue.length,
                n: __ns._context.enemyList.filter(e => e.active).length,
            })""")
            if st["q"] == 0 and st["n"] >= 4:
                break
            page.wait_for_timeout(300)
        page.wait_for_timeout(600)
        ev(page, "() => { __ns._context.player.bombaCount = 3; return true; }")
        kill_board_normally(page)
        page.wait_for_timeout(400)
        stock_cap = ev(page, "__ns._context.player.bombaCount")
        check("T14 stock capped at 3", stock_cap == 3, f"stock={stock_cap}")
        block_panel(page)

        # ---- 6: BOMBA wipes ALL hostile shots on a firing wave -------
        ev(page, """() => {
            __ns._waveClearTimer = 0; __ns._upgradePickDelay = 0;
            __ns._startWave(4); return true;
        }""")
        host = None
        for _ in range(30):
            host = ev(page, """() => [...__ns._context.projectiles.activeProjectiles]
                        .filter(p => p.hostile).length""")
            if host:
                break
            page.wait_for_timeout(400)
        check("T15 hostile shots exist on wave 4", host and host > 0, f"hostiles={host}")
        if host:
            ev(page, "() => { __ns._context.player.bombaCount = 1; __ns.hud.setBomba(1); return true; }")
            page.keyboard.press("KeyL")
            page.wait_for_timeout(250)
            host_after = ev(page, """() => [...__ns._context.projectiles.activeProjectiles]
                        .filter(p => p.hostile).length""")
            check("T16 BOMBA wipes ALL hostile shots", host_after == 0,
                  f"{host} -> {host_after}")
        block_panel(page)

        # ---- 7: empty-stock press is a safe no-op ---------------------
        # Let the T16 blast's slow-mo fully expire so any timer value
        # here can only come from THIS press (it must not start one).
        deadline = time.time() + 6
        while time.time() < deadline:
            if ev(page, "__ns._bombaTimer") <= 0:
                break
            page.wait_for_timeout(250)
        ev(page, "() => { __ns._context.player.bombaCount = 0; __ns.hud.setBomba(0); return true; }")
        page.keyboard.press("KeyL")
        page.wait_for_timeout(300)
        stock_empty = ev(page, "__ns._context.player.bombaCount")
        timer_empty = ev(page, "__ns._bombaTimer")
        check("T17 empty press: stock stays 0, no slow-mo",
              stock_empty == 0 and timer_empty <= 0,
              f"stock={stock_empty} timer={timer_empty:.3f}")

        # ---- no page errors ------------------------------------------
        check("T18 no page errors", not PAGE_ERRORS,
              "; ".join(PAGE_ERRORS[:3]) or "clean")
        real = [e for e in CONSOLE_ERRORS
                if "favicon" not in e.lower() and "404" not in e]
        check("T19 no console errors", not real,
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
