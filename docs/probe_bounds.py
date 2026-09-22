import asyncio
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"
OUT = "docs/design_audit/bounds_after"

async def go(pg, x, y, name):
    await pg.evaluate(f"""(() => {{
      const p = window.__ns._context.player;
      p.group.position.set({x}, {y}, 17);
      p.velocityX = 0; p.velocityY = 0;
    }})()""")
    await asyncio.sleep(2.0)
    r = await pg.evaluate("""(() => {
      const p = window.__ns._context.player.group.position;
      const v = p.clone().project(window.__ns.renderer.camera);
      return { fx: +((v.x+1)/2*100).toFixed(1), fy: +((1-v.y)/2*100).toFixed(1) };
    })()""")
    await pg.screenshot(path=f"{OUT}/{name}.png")
    print(f"{name:>12}: screen {r['fx']}% , {r['fy']}%")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=[
            "--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE, wait_until="networkidle")
        await pg.click("#startBtn")
        await asyncio.sleep(3)
        await go(pg, 0, 1.1, "centre")
        await go(pg, 23, 1.1, "right")
        await go(pg, -23, 1.1, "left")
        await go(pg, 0, 9.5, "top")
        await go(pg, 0, -3.0, "bottom")
        await go(pg, 23, 9.5, "corner_RT")
        await b.close()
        print("errors:", len(errs), errs[:2])

asyncio.run(main())
