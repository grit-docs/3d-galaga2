"""GALAGA 2 verify: TIER-2 upgrade cards (wave 10+ late-game pool).

Covers the final batch that landed AFTER the previous E2E pass:
  A. t2_pierce (관통 레이저): a piercing laser kills TWO enemies in a
     line via the REAL CollisionSystem path; a non-piercing one stops
     after the first. Controlled ticks (projectiles.update +
     collision.update), no gameplay timing involved.
  B. t2_plasma: weaponStats().baseDamage x2.0 at level 2.
  C. t2_score: kill points 100 -> 130 at level 1 (deterministic combo 0).
  D. t2_regen: live-measured shield-regen delay 5.0s -> ~3.0s at level 1.
  E. Pool merge: wave 9 offers draw from the base 8 only (no T2);
     wave 10 offers draw from 8+6=14 and include T2 cards (pinned
     Math.random makes the draw deterministic: score_mult, t2_bomba,
     shield_cap).
  F. Real gameplay: wave 10 (boss) forced clear -> WAVE_CLEAR ->
     upgrade panel with the deterministic T2 offer -> pick t2_bomba
     (BOMBA 확장) -> upg.t2bomba 1, bombaMax 3->4, bombaDamage 40->60,
     stock +1, HUD pips grow; then the world resumes into wave 11.
Screenshots: docs/design_audit/t2_panel.png
Exit 0 = PASS, 1 = FAIL.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"
ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11",
        "--ignore-certificate-errors"]
SHOT_DIR = os.path.join(os.path.dirname(__file__), "design_audit")

# Pinned constant so UpgradeSelect.show()'s Fisher-Yates over the merged
# 14-card pool yields the deterministic offer [score_mult, t2_bomba,
# shield_cap] (t2_bomba at slot 2 -> key "2"). Verified by re-running the
# exact shuffle with this double value in Python.
RND_T2 = 0.195454

JS_START = """(() => {
  const g = window.__ns;
  if (!g) return 'no __ns';
  g.state.transition('PLAYING');
  g._startWave(1);
  // NOTE: do NOT inflate lives here — the 'life' upgrade card reads
  // `lives - PLAYER.MAX_LIVES` as its level; 99 would cap it out of
  // the draw pool and change the pool size (14 -> 13), breaking the
  // deterministic RND_T2 draw. The immunity wrapper (JS_IMMUNE) is the
  // real protection.
  return g.state.current;
})()"""

JS_IMMUNE = """(() => {
  const g = window.__ns;
  if (g._testImmuneWrapped) return 'ok';
  const _orig = g._onPlayerHit.bind(g);
  g._onPlayerHit = d => { if (!g._testImmune) _orig(d); };
  g._testImmune = true;
  g._testImmuneWrapped = true;
  return 'ok';
})()"""

JS_PIN_RND = """(v) => {
  if (!window.__origRandom) window.__origRandom = Math.random;
  Math.random = () => v;
  return 'pinned';
}"""
JS_UNPIN_RND = """() => {
  if (window.__origRandom) { Math.random = window.__origRandom; window.__origRandom = null; }
  return 'unpinned';
}"""

# ---- A) pierce: two enemies in the player's fire line at x=0 ----
# The enemies are pinned at the player's x (0) so a -Z laser passes
# through both. Beam + dive systems are frozen for the controlled
# window: a FORMATION test pair sitting side by side is the closest
# pair on screen (the beam would lift them) and the dive scheduler
# would re-route one mid-test.
JS_PIERCE_CREATE = """(pierce) => {
  const g = window.__ns;
  const ctx = g._context;
  const V = ctx.player.group.position.constructor;
  if (!g.__t2frozen) {
    g.__t2beamUpd = g.beamSystem.update;
    g.__t2atkUpd = g.attackSystem.update;
    g.beamSystem.update = () => {};
    g.attackSystem.update = () => {};
    g.__t2frozen = true;
  }
  // pin the player to the fire line (x=0), zero lateral velocity
  ctx.player.group.position.x = 0;
  ctx.player.velocityX = 0;
  const e1 = ctx.enemyPool.acquire();
  e1.configure({ slot: new V(0, 0.8, -18), index: 0,
                 spawnFrom: new V(0, 0.8, -18), hpScale: 1 });
  const e2 = ctx.enemyPool.acquire();
  e2.configure({ slot: new V(0, 0.8, -20.5), index: 1,
                 spawnFrom: new V(0, 0.8, -20.5), hpScale: 1 });
  e1.group.position.set(0, 0.8, -18);
  e2.group.position.set(0, 0.8, -20.5);
  e1.state = 'FORMATION';
  e2.state = 'FORMATION';
  e1.group.visible = false;
  e2.group.visible = false;
  ctx.addEnemy(e1);
  ctx.addEnemy(e2);
  e1.hp = 1; e2.hp = 1;
  window.__t2e1 = e1;
  window.__t2e2 = e2;
  // keep the wave from reading as "complete" when the test kills
  // route through _onEnemyKilled (enemyDied decrements per kill)
  g.waveSystem._aliveCount += 2;
  const o = ctx.player.group.position.clone();
  const p = ctx.projectiles.spawnPlayerShot({
    origin: o, dir: new V(0, 0, -1),
    stats: { baseSpeed: 40, baseDamage: 10, pierce },
  });
  return { ok: !!p, shotZ: p ? p.group.position.z : null };
}"""

JS_PIERCE_TICK = """(n) => {
  const g = window.__ns;
  const ctx = g._context;
  const dt = 0.05;
  for (let i = 0; i < n; i++) {
    ctx.projectiles.update(dt, ctx.player.group.position);
    g._collision.update(dt);
  }
  return 'ticked';
}"""

JS_PIERCE_READ = """() => {
  const g = window.__ns;
  const ctx = g._context;
  const shots = [...ctx.projectiles._activeProjectiles].filter(p => !p.hostile);
  return {
    e1Dying: window.__t2e1 ? window.__t2e1.dying : null,
    e2Dying: window.__t2e2 ? window.__t2e2.dying : null,
    shotActive: shots.length > 0,
  };
}"""

JS_PIERCE_CLEANUP = """() => {
  const g = window.__ns;
  const ctx = g._context;
  for (const e of [...ctx.enemyList]) {
    if (e === window.__t2e1 || e === window.__t2e2) g._releaseEnemy(e);
  }
  for (const p of [...ctx.projectiles._activeProjectiles]) {
    if (!p.hostile) p.kill();
  }
  // unfreeze the beam + dive schedulers
  if (g.__t2beamUpd) g.beamSystem.update = g.__t2beamUpd;
  if (g.__t2atkUpd) g.attackSystem.update = g.__t2atkUpd;
  g.__t2frozen = false;
  g.__t2beamUpd = null;
  g.__t2atkUpd = null;
  window.__t2e1 = null;
  window.__t2e2 = null;
  return ctx.enemyList.length;
}"""

# ---- C) score multiplier: kill a 1-HP fighter at combo 0 ----
JS_SCORE_KILL = """() => {
  const g = window.__ns;
  const ctx = g._context;
  const V = ctx.player.group.position.constructor;
  const e = ctx.enemyPool.acquire();
  e.configure({ slot: new V(8, 0.8, -18), index: 2,
                spawnFrom: new V(8, 0.8, -18), hpScale: 1 });
  e.group.position.set(8, 0.8, -18);
  e.state = 'FORMATION';
  e.group.visible = false;
  ctx.addEnemy(e);
  e.hp = 1;
  g.waveSystem._aliveCount += 1;
  g.combo = 0;
  const s0 = g.score;
  g._onEnemyKilled(e, e.group.position);
  return g.score - s0;
}"""

# ---- D) live shield-regen delay measurement ----
JS_REGEN_MEASURE = """async () => {
  const g = window.__ns;
  const p = g._context.player;
  p.shield = 90;
  p._timeSinceHit = 0;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 600; i++) {
    await frame();
    if (p.shield > 90.05) break;
  }
  return { regenAt: p._timeSinceHit, shield: p.shield };
}"""

# ---- E) pool merge probe (show + read offers + cancel, synchronous) ----
JS_POOL_PROBE = """(wave) => {
  const g = window.__ns;
  g._upgradeSelect.show(g._context.player, wave, () => {});
  const ids = g._upgradeSelect._offers.map(o => o[0]);
  g._upgradeSelect.cancel();
  return { wave, ids };
}"""

JS_PLAYER_STATE = """() => {
  const p = window.__ns._context.player;
  const pips = document.querySelectorAll('#bombaPips .bomba-pip');
  return {
    shield: p.shield,
    maxShield: p.maxShield(),
    bombaCount: p.bombaCount,
    bombaMax: p.bombaMax(),
    bombaDamage: p.bombaDamage(),
    upg: { ...p.upg },
    pipsTotal: pips.length,
    pipsOn: [...pips].filter(el => el.classList.contains('on')).length,
  };
}"""

JS_PANEL_INFO = """(() => {
  const g = window.__ns;
  const el = document.querySelector('.upg-overlay');
  if (!el) return { visible: false };
  const cards = [...document.querySelectorAll('.upg-card')]
    .filter(c => c.style.display !== 'none')
    .map(c => ({
      name: c.querySelector('.upg-name').textContent,
      desc: c.querySelector('.upg-desc').textContent,
      lv: c.querySelector('.upg-lv').textContent,
    }));
  const title = el.querySelector('.upg-title');
  return {
    visible: el.style.display !== 'none',
    title: title ? title.textContent : null,
    cards,
    active: g._upgradeSelect.active,
    offerIds: g._upgradeSelect._offers.map(o => o[0]),
  };
})()"""

JS_START_WAVE10 = """() => {
  const g = window.__ns;
  g._upgradeSelect.cancel();
  g._startWave(10);
  return g.state.current;
}"""

JS_CLEAR_WAVE = """() => {
  const g = window.__ns;
  const ws = g.waveSystem;
  ws._spawnQueue.length = 0;
  for (const e of [...g._context.enemyList]) {
    try { g._onEnemyKilled(e, e.group.position); } catch (err) {}
  }
  const boss = g._context.boss;
  if (boss && boss.alive) {
    try { g._onBossKilled(boss, boss.position); } catch (err) {}
  }
  return { state: g.state.current, wave: g.waveSystem.wave,
           bossAlive: boss ? boss.alive : null };
}"""


async def wait_until(page, fn, timeout_s, interval_s=0.2):
    for _ in range(int(timeout_s / interval_s)):
        v = await page.evaluate(fn)
        if v:
            return v
        await page.wait_for_timeout(int(interval_s * 1000))
    return None


async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    results = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=ARGS)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        await page.goto(BASE + "index.html", wait_until="load")
        await page.wait_for_timeout(1500)

        print("start:", await page.evaluate(JS_START))
        await page.evaluate(JS_IMMUNE)

        # ---- A) pierce: controlled collision ticks -------------------
        c = await page.evaluate(JS_PIERCE_CREATE, 1)
        print("pierce shot created:", c)
        # shot spawns z=15.4, flies -Z at 40/s; enemies at z=-18/-20.5
        # are reached at ~17/18 ticks. 25 ticks is safe headroom.
        await page.evaluate(JS_PIERCE_TICK, 25)
        r1 = await page.evaluate(JS_PIERCE_READ)
        print("pierce=1 read:", r1)
        results["pierce_two_kills"] = r1["e1Dying"] and r1["e2Dying"]
        await page.evaluate(JS_PIERCE_CLEANUP)
        await page.wait_for_timeout(150)

        c = await page.evaluate(JS_PIERCE_CREATE, 0)
        await page.evaluate(JS_PIERCE_TICK, 25)
        r0 = await page.evaluate(JS_PIERCE_READ)
        print("pierce=0 read:", r0)
        results["pierce_zero_stops"] = (r0["e1Dying"] and not r0["e2Dying"])
        await page.evaluate(JS_PIERCE_CLEANUP)

        # ---- B) plasma damage via weaponStats -------------------------
        ws_off = await page.evaluate(
            "() => window.__ns._context.player.weaponStats()")
        await page.evaluate(
            "() => { window.__ns._context.player.upg.t2plasma = 2; }")
        ws_on = await page.evaluate(
            "() => window.__ns._context.player.weaponStats()")
        await page.evaluate(
            "() => { window.__ns._context.player.upg.t2plasma = 0; }")
        ratio = ws_on["baseDamage"] / ws_off["baseDamage"] if ws_off["baseDamage"] else 0
        print(f"plasma dmg {ws_off['baseDamage']:.2f} -> {ws_on['baseDamage']:.2f} (x{ratio:.2f})")
        results["plasma_x2"] = abs(ratio - 2.0) < 0.01

        # ---- C) score multiplier --------------------------------------
        await page.evaluate(
            "() => { window.__ns._context.player.upg.t2score = 1; }")
        gained_on = await page.evaluate(JS_SCORE_KILL)
        await page.evaluate(
            "() => { window.__ns._context.player.upg.t2score = 0; }")
        gained_off = await page.evaluate(JS_SCORE_KILL)
        print(f"score kill: t2score=0 -> {gained_off}, t2score=1 -> {gained_on}")
        results["score_mult"] = gained_off == 100 and gained_on == 130

        # ---- D) regen delay (live measurement) ------------------------
        base = await page.evaluate(JS_REGEN_MEASURE)
        await page.evaluate(
            "() => { window.__ns._context.player.upg.t2regen = 1; }")
        t2 = await page.evaluate(JS_REGEN_MEASURE)
        await page.evaluate(
            "() => { window.__ns._context.player.upg.t2regen = 0; }")
        print(f"regen delay: base {base['regenAt']:.2f}s, t2 {t2['regenAt']:.2f}s")
        results["regen_base_5s"] = 4.8 < base["regenAt"] < 5.6
        results["regen_t2_3s"] = 2.8 < t2["regenAt"] < 3.6
        results["regen_shortened"] = t2["regenAt"] < base["regenAt"]

        # ---- E) pool merge: wave 9 (base only) vs wave 10 (merged) ----
        p9 = await page.evaluate(JS_POOL_PROBE, 9)
        await page.evaluate(JS_PIN_RND, RND_T2)
        p10 = await page.evaluate(JS_POOL_PROBE, 10)
        print("pool wave9 offers:", p9["ids"])
        print("pool wave10 offers:", p10["ids"])
        results["pool9_no_t2"] = not any(i.startswith("t2_") for i in p9["ids"])
        results["pool10_t2"] = any(i.startswith("t2_") for i in p10["ids"])
        results["pool10_deterministic"] = (
            p10["ids"] == ["score_mult", "t2_bomba", "shield_cap"])

        # ---- F) real wave-10 boss clear -> T2 panel -> pick t2_bomba --
        # Pin Math.random BEFORE the clear: the panel draw happens
        # ~0.9s later, still inside the pin window (we unpin after the
        # pick, below).
        print("start wave 10:", await page.evaluate(JS_START_WAVE10))
        await page.evaluate(JS_PIN_RND, RND_T2)
        # boss alive AND the whole escort plan spawned (queue drained)
        spawned = await wait_until(
            page, "() => { const g = window.__ns; const b = g._context.boss; "
                  "return b && b.alive && g.waveSystem._spawnQueue.length === 0; }",
            25)
        print("boss+escorts spawned:", spawned)
        results["boss_spawned"] = bool(spawned)

        pre = await page.evaluate(JS_PLAYER_STATE)
        print("pre clear:", pre)
        results["bomba_before"] = pre["bombaMax"] == 3 and pre["bombaDamage"] == 40

        await page.evaluate(JS_CLEAR_WAVE)
        info = await wait_until(
            page, "() => { const g = window.__ns; "
                  "return g._upgradeSelect.active; }",
            8)
        panel = await page.evaluate(JS_PANEL_INFO)
        print("panel:", panel)
        await page.screenshot(path=os.path.join(SHOT_DIR, "t2_panel.png"))
        results["panel_visible"] = bool(panel.get("visible") and panel.get("active"))
        results["panel_title_w11"] = (panel.get("title") or "").startswith("WAVE 11")
        results["panel_t2_offer"] = panel.get("offerIds") == [
            "score_mult", "t2_bomba", "shield_cap"]

        # pick t2_bomba (slot 2 -> Digit2)
        t2_idx = panel.get("offerIds", []).index("t2_bomba") if "t2_bomba" in panel.get("offerIds", []) else None
        print("picking t2_bomba idx:", t2_idx)
        await page.keyboard.press(f"Digit{t2_idx + 1}")
        for _ in range(30):
            act = await page.evaluate("window.__ns._upgradeSelect.active")
            if not act:
                break
            await page.wait_for_timeout(150)
        await page.wait_for_timeout(300)
        # unpin NOW: the panel is closed and the world will resume into
        # wave 11 (real randomness back for its spawns/shuffles)
        await page.evaluate(JS_UNPIN_RND)
        post = await page.evaluate(JS_PLAYER_STATE)
        print("post pick:", post)
        results["pick_t2bomba"] = post["upg"]["t2bomba"] == 1
        results["bomba_max_4"] = post["bombaMax"] == 4
        results["bomba_dmg_60"] = post["bombaDamage"] == 60
        results["bomba_stock_up"] = post["bombaCount"] == pre["bombaCount"] + 1
        results["bomba_pips"] = post["pipsTotal"] == post["bombaCount"] \
            and post["pipsOn"] == post["bombaCount"]

        resumed = await wait_until(
            page, "() => { const g = window.__ns; "
                  "return g.state.current === 'PLAYING' ? g.waveSystem.wave : null; }",
            15)
        print("resumed wave:", resumed)
        results["world_resumes_w11"] = resumed == 11

        await browser.close()

    results["no_errors"] = not errors
    print("console errors:", errors[:3] or "none")
    for k, v in results.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    ok = all(results.values())
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


asyncio.run(main())
