"""Verify the design fixes: dash meter, wave-clear bonus line, pause menu,
menu grid, shield states."""
import asyncio
from playwright.async_api import async_playwright

URL = 'https://localhost:5173/3d-galaga/'
OUT = 'docs/design_audit'

DASH_CHECK = """() => {
  const el = document.querySelector('[data-hud="#dashFill"]');
  const cell = el ? el.closest('.dash-cell') : null;
  return {
    width: el ? el.style.width : null,
    ready: cell ? cell.classList.contains('dash-ready') : null,
  };
}"""

CLEAR_WAVE = """(g) => {
  // wait handled by the caller; here: force-clear the current wave
  const list = g._context.enemyList.slice();
  for (const e of list) {
    e.hp = 0;
    g._onEnemyKilled(e, e.group.position);
  }
}"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"],
        )
        page = await browser.new_page(viewport={'width': 1600, 'height': 900})
        await page.goto(URL, wait_until='load')
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f'{OUT}/f1_menu.png')

        # --- start + dash meter -------------------------------------------------
        await page.click('#startBtn')
        await page.wait_for_timeout(2500)
        # ready state before any dash
        print('dash before:', await page.evaluate(DASH_CHECK))
        await page.keyboard.down('d')
        await page.keyboard.press('Shift')  # dash
        await page.wait_for_timeout(60)
        await page.keyboard.up('d')
        # mid-cooldown (~0.5s of 0.9s left)
        await page.wait_for_timeout(400)
        print('dash mid-cd:', await page.evaluate(DASH_CHECK))
        await page.screenshot(path=f'{OUT}/f2_dash_cd.png', clip={'x': 0, 'y': 800, 'width': 800, 'height': 100})
        # wait for READY
        await page.wait_for_timeout(800)
        print('dash ready:', await page.evaluate(DASH_CHECK))
        await page.screenshot(path=f'{OUT}/f3_dash_ready.png', clip={'x': 0, 'y': 800, 'width': 800, 'height': 100})

        # --- shield low/mid states --------------------------------------------
        await page.evaluate('()=>{const pl=__ns._context.player; pl.shield=80; __ns.hud.setShield(80/100);}')
        await page.wait_for_timeout(200)
        await page.evaluate('()=>{const pl=__ns._context.player; pl.shield=35; __ns.hud.setShield(35/100);}')
        await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/f4_shield_mid.png', clip={'x': 0, 'y': 800, 'width': 800, 'height': 100})
        await page.evaluate('()=>{const pl=__ns._context.player; pl.shield=12; __ns.hud.setShield(12/100);}')
        await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/f5_shield_low.png', clip={'x': 0, 'y': 800, 'width': 800, 'height': 100})
        await page.evaluate('()=>{const pl=__ns._context.player; pl.shield=100; __ns.hud.setShield(1);}')

        # --- pause menu (corner brackets, dim, button widths) ------------------
        await page.keyboard.press('p')
        await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/f6_pause.png')
        await page.keyboard.press('p')
        await page.wait_for_timeout(300)

        # --- wave clear bonus line ---------------------------------------------
        await page.evaluate('window.__forceClear = () => { const g=__ns; const list=g._context.enemyList.slice(); for (const e of list){ e.hp=0; g._onEnemyKilled(e, e.group.position);} }')
        # wait until all planned enemies are spawned, then force-clear
        for _ in range(40):
            q = await page.evaluate('__ns.waveSystem._spawnQueue.length')
            if q == 0:
                break
            await page.wait_for_timeout(300)
        await page.evaluate('window.__forceClear()')
        for _ in range(30):
            st = await page.evaluate('__ns.state.current')
            if st == 'WAVE_CLEAR':
                break
            await page.wait_for_timeout(250)
        await page.wait_for_timeout(300)
        st = await page.evaluate('__ns.state.current')
        bonus = await page.evaluate('document.querySelector(\'[data-wc="#bonus"]\').textContent')
        bonus_hidden = await page.evaluate('document.querySelector(\'[data-wc="#bonus"]\').hidden')
        print('wave clear state:', st, '| bonus text:', repr(bonus), '| hidden:', bonus_hidden)
        await page.screenshot(path=f'{OUT}/f7_waveclear.png')

        await browser.close()

asyncio.run(main())
