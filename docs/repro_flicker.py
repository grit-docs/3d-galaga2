"""Repro: wave-clear banner vs upgrade-panel crossfade flicker.
Forces autoUpgrade OFF (classic panel), clears wave 1, then samples
the DOM state of #waveClear and .upg-overlay every ~50ms and records
both opacities + displays over time. Also dumps screenshots at the
moment both are visible.
"""
import asyncio, os, json
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga2/index.html"
ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11",
        "--ignore-certificate-errors"]
SHOT_DIR = os.path.join(os.path.dirname(__file__), "design_audit", "flicker")

JS_START = """(() => {
  const g = window.__ns;
  if (!g) return 'no __ns';
  g._settings.autoUpgrade = false;   // force the classic 3-card panel
  g.state.transition('PLAYING');
  g._startWave(1);
  return g.state.current;
})()"""

JS_CLEAR_WAVE = """(() => {
  const g = window.__ns;
  g.waveSystem._spawnQueue.length = 0;
  const list = [...g._context.enemyList];
  for (const e of list) {
    try { g._onEnemyKilled(e, e.group.position); } catch (err) {}
  }
  return { state: g.state.current, waveClear: g._waveClearTimer };
})()"""

JS_SAMPLE = """(() => {
  const g = window.__ns;
  const wc = document.getElementById('waveClear');
  const wcCard = wc.querySelector('.overlay-card');
  const upg = document.querySelector('.upg-overlay');
  const csWc = getComputedStyle(wc);
  const csUpg = upg ? getComputedStyle(upg) : null;
  const wcAnim = wcCard ? getComputedStyle(wcCard).animationName : null;
  return {
    state: g.state.current,
    timer: g._waveClearTimer,
    delay: g._upgradePickDelay,
    panelActive: g._upgradeSelect.active,
    wc: {
      display: wc.style.display,
      csDisplay: csWc.display,
      opacity: csWc.opacity,
      cardAnim: wcAnim,
      rect: wc.getBoundingClientRect().top
    },
    upg: upg ? {
      display: upg.style.display,
      opacity: csUpg.opacity,
      dealing: upg.classList.contains('dealing'),
      closing: upg.classList.contains('closing'),
    } : null,
  };
})()"""

async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=ARGS)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        await page.goto(BASE, wait_until="load")
        await page.wait_for_timeout(1500)

        print("start:", await page.evaluate(JS_START))
        for _ in range(40):
            alive = await page.evaluate("window.__ns._context.enemyList.length")
            if alive >= 3:
                break
            await page.wait_for_timeout(300)
        print("after clear:", await page.evaluate(JS_CLEAR_WAVE))

        rows = []
        t = 0
        shot_i = 0
        both_seen = False
        while t < 8.0:
            await page.wait_for_timeout(50)
            t += 0.05
            s = await page.evaluate(JS_SAMPLE)
            rows.append({"t": round(t, 2), **s})
            wc_vis = s["wc"]["display"] != "none" and s["wc"]["csDisplay"] != "none"
            upg_vis = s["upg"] and s["upg"]["display"] != "none"
            if wc_vis and upg_vis:
                both_seen = True
                if shot_i < 4:
                    await page.screenshot(path=os.path.join(SHOT_DIR, f"both_{shot_i}.png"))
                    shot_i += 1
        await browser.close()

        print(f"both-visible frames: {both_seen}")
        # compact print: t | state | timer | delay | wc disp/opacity | upg disp/opacity/dealing
        for r in rows:
            u = r["upg"]
            print(f"t={r['t']:5.2f} {r['state']:<10} timer={r['timer']:5.2f} delay={r['delay']:4.2f} "
                  f"wc={r['wc']['display'] or 'none':<4}/{r['wc']['csDisplay']:<5} op={r['wc']['opacity']:<5} "
                  f"upg={'-' if not u else (u['display'] or 'none'):<4} op={u['opacity'] if u else '-'} "
                  f"deal={u['dealing'] if u else '-'} close={u['closing'] if u else '-'}")
        with open(os.path.join(SHOT_DIR, "samples.json"), "w") as f:
            json.dump(rows, f, indent=1)

asyncio.run(main())
