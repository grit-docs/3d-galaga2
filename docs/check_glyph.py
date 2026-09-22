"""Verify whether the HUD score digits actually render as tofu (missing glyph)."""
import asyncio
from playwright.async_api import async_playwright

URL = 'https://localhost:5173/3d-galaga/'

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"],
        )
        page = await browser.new_page(viewport={'width': 1600, 'height': 900}, device_scale_factor=3)
        await page.goto(URL, wait_until='load')
        await page.wait_for_timeout(3000)

        info = await page.evaluate("""() => {
          const el = document.querySelector('[data-hud="#score"]');
          const cs = getComputedStyle(el);
          // check font availability for the glyphs we actually use
          const probe = document.createElement('span');
          probe.style.cssText = 'position:absolute;visibility:hidden;font-family:Orbitron, monospace;';
          probe.textContent = '0123456789';
          document.body.appendChild(probe);
          const probeCS = getComputedStyle(probe);
          const hasOrbitron = document.fonts.check('700 24px Orbitron', '0');
          const hasRajdhani = document.fonts.check('600 24px Rajdhani', '0');
          return {
            text: el.textContent,
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            fontsStatus: document.fonts.status,
            hasOrbitron, hasRajdhani,
            fontFaces: [...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.status),
          };
        }""")
        print(info)

        # crop top-left at 3x scale
        await page.screenshot(path='docs/design_audit/06_score_3x.png',
                              clip={'x': 0, 'y': 0, 'width': 500, 'height': 140})
        await browser.close()

asyncio.run(main())
