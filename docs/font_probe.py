"""Render the same font/weight/size offscreen in a blank page: is the slashed
zero Orbitron's own glyph, or a fallback tofu box?"""
import asyncio
from playwright.async_api import async_playwright

HTML = """<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&display=swap" rel="stylesheet">
<style>body{background:#03030a;margin:0;padding:40px}
.s{font-size:60px;font-weight:700;line-height:1.4;color:#fff}
.o{font-family:'Orbitron'}
.c{font-family:'Consolas'}
.r{font-family:'Rajdhani',sans-serif}</style></head><body>
<div class="s o" id="orb">0123456789</div>
<div class="s c" id="cons">0123456789</div>
<div class="s r" id="raj">0123456789</div>
</body></html>"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--ignore-certificate-errors"])
        page = await browser.new_page(viewport={'width': 700, 'height': 400}, device_scale_factor=3)
        await page.set_content(HTML)
        await page.wait_for_timeout(2500)  # let webfont load
        ok = await page.evaluate("document.fonts.check('700 60px Orbitron','0')")
        print('Orbitron has 0:', ok)
        await page.screenshot(path='docs/design_audit/07_font_probe.png')
        await browser.close()

asyncio.run(main())
