"""GALAGA 2 verify: modern upgrade panel E2E.
Wave 1 clear -> panel appears centered, countdown frozen, key 2 picks,
card applied, state resumes. Screenshots to docs/design_audit/.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"
ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11",
        "--ignore-certificate-errors"]
SHOT_DIR = os.path.join(os.path.dirname(__file__), "design_audit")

JS_START = """(() => {
  const g = window.__ns;
  if (!g) return 'no __ns';
  g.state.transition('PLAYING');
  g._startWave(1);
  return g.state.current;
})()"""

JS_CLEAR_WAVE = """(() => {
  const g = window.__ns;
  const ws = g.waveSystem;
  ws._spawnQueue.length = 0;
  const list = [...g._context.enemyList];
  for (const e of list) {
    try { g._onEnemyKilled(e, e.group.position); } catch (err) {}
  }
  return { state: g.state.current, waveClear: g._waveClearTimer };
})()"""

JS_PANEL_INFO = """(() => {
  const g = window.__ns;
  const el = document.querySelector('.upg-overlay');
  if (!el) return { visible: false };
  const cs = getComputedStyle(el);
  const cards = [...document.querySelectorAll('.upg-card')]
    .filter(c => c.style.display !== 'none')
    .map(c => ({
      name: c.querySelector('.upg-name').textContent,
      desc: c.querySelector('.upg-desc').textContent,
      key: c.querySelector('.upg-key').textContent,
      visible: c.getBoundingClientRect().width > 50,
    }));
  const r = el.getBoundingClientRect();
  const title = el.querySelector('.upg-title');
  return {
    visible: el.style.display !== 'none',
    display: cs.display,
    position: cs.position,
    center: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 20,
    rect: { w: Math.round(r.width), h: Math.round(r.height) },
    title: title ? title.textContent : null,
    sub: el.querySelector('.upg-sub').textContent,
    hasKeycaps: el.querySelectorAll('.upg-sub .key').length,
    cards,
    frozenTimer: g._waveClearTimer,
    active: g._upgradeSelect.active,
  };
})()"""

async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=ARGS)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        await page.goto(BASE + "index.html", wait_until="load")
        await page.wait_for_timeout(1500)

        r = await page.evaluate(JS_START)
        print("start:", r)

        # wait until at least 3 live enemies exist (wave 1 spawner)
        for _ in range(40):
            alive = await page.evaluate("window.__ns._context.enemyList.length")
            if alive >= 3:
                break
            await page.wait_for_timeout(300)
        print("live enemies before clear:", alive)

        c = await page.evaluate(JS_CLEAR_WAVE)
        print("after clear:", c)
        await page.wait_for_timeout(200)

        # beat delay is 0.9s — wait for the panel
        await page.wait_for_timeout(1400)
        info = await page.evaluate(JS_PANEL_INFO)
        print("panel:", info)
        await page.screenshot(path=os.path.join(SHOT_DIR, "upgrade_panel.png"))

        # countdown must be frozen while the panel is open
        t1 = await page.evaluate("window.__ns._waveClearTimer")
        await page.wait_for_timeout(600)
        t2 = await page.evaluate("window.__ns._waveClearTimer")
        frozen = abs(t1 - t2) < 0.01
        print(f"countdown frozen: {frozen} ({t1:.3f} -> {t2:.3f})")

        # pick card 2 with the number key
        before = await page.evaluate("(() => { const p = window.__ns._context.player; return {dmg:p.upg.dmg, rate:p.upg.rate, speed:p.upg.speed, shieldCap:p.upg.shieldCap, regen:p.upg.regen, score:p.upg.score, shield:p.shield, maxShield:p.maxShield()}; })()")
        await page.keyboard.press("Digit2")
        await page.wait_for_timeout(700)
        after = await page.evaluate("(() => { const p = window.__ns._context.player; return {dmg:p.upg.dmg, rate:p.upg.rate, speed:p.upg.speed, shieldCap:p.upg.shieldCap, regen:p.upg.regen, score:p.upg.score, shield:p.shield, maxShield:p.maxShield()}; })()")
        picked = info["cards"][1] if len(info.get("cards", [])) > 1 else None
        applied = before != after
        print("picked:", picked)
        print("before:", before)
        print("after: ", after)
        print("applied:", applied)

        post = await page.evaluate("""(() => {
          const g = window.__ns;
          return {
            state: g.state.current,
            panelOpen: document.querySelector('.upg-overlay').style.display !== 'none',
            active: g._upgradeSelect.active,
          };
        })()""")
        print("post-pick:", post)
        await page.wait_for_timeout(3000)  # let the next wave start & run
        final_state = await page.evaluate("window.__ns.state.current")
        print("state after 3s:", final_state)

        await browser.close()
        ok = (info.get("visible") and info.get("center")
              and info.get("hasKeycaps", 0) == 3
              and len(info.get("cards", [])) == 3
              and frozen and applied and not post["panelOpen"]
              and not errors)
        print("console errors:", errors[:3] or "none")
        print("RESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)

asyncio.run(main())
