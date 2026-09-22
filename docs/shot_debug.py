import time
from playwright.sync_api import sync_playwright

URL = "https://localhost:5173/3d-galaga/"
JS_INFO = """() => {
    const g = __ns, c = g.renderer.camera, p = g._context.player;
    return {
        cam: [c.position.x, c.position.y, c.position.z],
        player: [p.group.position.x, p.group.position.y, p.group.position.z],
        enemies: g._context.enemyList.slice(0, 6).map(e =>
            [e.group.position.x, e.group.position.y, e.group.position.z])
    };
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-certificate-errors"])
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(2500)
    pg.click("#startBtn")
    pg.wait_for_timeout(1500)
    pg.screenshot(path="docs/shot_rest.png")
    print("REST", pg.evaluate(JS_INFO))
    pg.keyboard.down("w"); pg.wait_for_timeout(2000); pg.keyboard.up("w"); pg.wait_for_timeout(300)
    pg.screenshot(path="docs/shot_up.png")
    print("UP", pg.evaluate("() => ({ y: __ns._context.player.group.position.y, camY: __ns.renderer.camera.position.y })"))
    pg.keyboard.down("s"); pg.wait_for_timeout(2000); pg.keyboard.up("s"); pg.wait_for_timeout(300)
    pg.screenshot(path="docs/shot_down.png")
    print("DOWN", pg.evaluate("() => ({ y: __ns._context.player.group.position.y, camY: __ns.renderer.camera.position.y })"))
    b.close()
print("done")
