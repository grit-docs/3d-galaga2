"""Design audit: capture menu, gameplay, HUD states for visual review."""
import asyncio, sys
sys.path.insert(0, '.')
from playwright.async_api import async_playwright

URL = 'https://localhost:5173/3d-galaga/'
OUT = 'docs/design_audit'
import os
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"],
        )
        page = await browser.new_page(viewport={'width': 1600, 'height': 900})
        await page.goto(URL, wait_until='load')
        await page.wait_for_timeout(3500)  # let menu + webgpu badge settle
        await page.screenshot(path=f'{OUT}/01_menu.png')

        # start game
        await page.click('#startBtn')
        await page.wait_for_timeout(4000)  # wave entry
        await page.screenshot(path=f'{OUT}/02_gameplay.png')

        # some combat: move + fire
        await page.keyboard.down('d')
        await page.wait_for_timeout(300)
        await page.keyboard.up('d')
        for _ in range(3):
            await page.keyboard.press('Space')
            await page.wait_for_timeout(120)
        await page.screenshot(path=f'{OUT}/03_combat.png')

        # pause overlay
        await page.keyboard.press('p')
        await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/04_pause.png')
        await page.keyboard.press('p')
        await page.wait_for_timeout(200)

        # game over: take damage until dead
        for i in range(40):
            state = await page.evaluate('__ns.state.current')
            if state == 'GAME_OVER':
                break
            await page.evaluate('(()=>{const pl=__ns._context.player; if(pl && pl.alive) pl.takeDamage(100);})()')
            await page.wait_for_timeout(300)
        await page.wait_for_timeout(600)
        state = await page.evaluate('__ns.state.current')
        print('final state:', state)
        await page.screenshot(path=f'{OUT}/05_gameover.png')

        await browser.close()

asyncio.run(main())
