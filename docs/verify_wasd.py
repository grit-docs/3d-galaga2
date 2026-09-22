import asyncio
from playwright.async_api import async_playwright

URL = "https://localhost:5173/3d-galaga/"

POS_JS = r"""(() => {
  const p = window.__ns._context.player.group.position;
  return { x: +p.x.toFixed(3), y: +p.y.toFixed(3) };
})()"""


async def check_move(pg, key, axis, delta):
    start = await pg.evaluate(POS_JS)
    await pg.keyboard.down(key)
    await pg.wait_for_timeout(900)
    end = await pg.evaluate(POS_JS)
    await pg.keyboard.up(key)
    moved = end[axis] - start[axis]
    ok = moved * delta > 1.0
    print(f"  {key}: {axis} {start[axis]} -> {end[axis]} (moved {moved:+.2f}) -> {'OK' if ok else 'FAIL'}")
    return ok


async def main():
    errors = []
    async with async_playwright() as pw:
        b = await pw.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"],
        )
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(str(e)[:150]))
        await pg.goto(URL, wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(3000)
        await pg.click("#startBtn")
        await pg.wait_for_timeout(1500)
        await pg.evaluate(
            "(() => { const p = window.__ns._context.player; "
            "p.lives = 99; p.shield = 100; return 1; })()"
        )
        # park the player at center so the bound clamp can't eat movement
        await pg.evaluate(
            "(() => { const p = window.__ns._context.player; "
            "p.group.position.x = 0; p.group.position.y = 1.1; "
            "p.velocityX = 0; p._recoil = 0; return 1; })()"
        )
        print("WASD movement test:")
        r = []
        r.append(await check_move(pg, "d", "x", +1))
        r.append(await check_move(pg, "a", "x", -1))
        r.append(await check_move(pg, "w", "y", +1))
        r.append(await check_move(pg, "s", "y", -1))
        # arrow keys still work (regression)
        print("Arrow-key regression:")
        r.append(await check_move(pg, "ArrowRight", "x", +1))
        r.append(await check_move(pg, "ArrowUp", "y", +1))
        print("page errors:", len(errors), errors[:3])
        print("VERDICT:", "PASS" if all(r) and not errors else "FAIL")
        await b.close()


asyncio.run(main())
