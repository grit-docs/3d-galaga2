import asyncio, json
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"

STATE_JS = """(() => {
  const g = window.__ns;
  return {
    hasSettings: !!document.getElementById('setBloom'),
    bloomOn: !!g.renderer._postProcessing,
    shakeScale: g._cameraFx.shakeScale,
    sound: g.audio.volume,
    musicVol: g.music.volume,
    stored: localStorage.getItem('nebula-strike.settings'),
  };
})()"""

async def main():
    errors = []
    async with async_playwright() as pw:
        b = await pw.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11",
                  "--ignore-certificate-errors"],
        )
        ctx = await b.new_context(viewport={"width": 1280, "height": 720})
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errors.append("page:" + str(e)[:160]))
        pg.on("console", lambda m: errors.append("console:" + m.text[:160])
               if m.type == "error" else None)
        await pg.goto(BASE, wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(2500)

        s1 = await pg.evaluate(STATE_JS)
        print("default:", json.dumps(s1, ensure_ascii=False))
        ok_default = (s1["hasSettings"] and s1["bloomOn"]
                      and s1["shakeScale"] == 1
                      and s1["sound"] == 0.5 and s1["musicVol"] == 0.55)

        # toggle bloom OFF
        await pg.evaluate("document.getElementById('setBloom').click()")
        await pg.wait_for_timeout(300)
        s2 = await pg.evaluate(STATE_JS)
        print("bloom off:", json.dumps(s2, ensure_ascii=False))
        ok_bloom_off = s2["bloomOn"] is False

        # toggle bloom back ON (runtime rebuild)
        await pg.evaluate("document.getElementById('setBloom').click()")
        await pg.wait_for_timeout(400)
        s3 = await pg.evaluate(STATE_JS)
        print("bloom on :", json.dumps(s3, ensure_ascii=False))
        ok_bloom_on = s3["bloomOn"] is True

        # motion OFF -> shakeScale 0
        await pg.evaluate("document.getElementById('setMotion').click()")
        await pg.wait_for_timeout(200)
        s4 = await pg.evaluate(STATE_JS)
        print("motion off:", json.dumps(s4, ensure_ascii=False))
        ok_motion = s4["shakeScale"] == 0

        # sound to 20
        await pg.evaluate("""(() => {
          const r = document.getElementById('setSound');
          r.value = 20; r.dispatchEvent(new Event('input', {bubbles:true}));
        })()""")
        await pg.wait_for_timeout(200)
        s5 = await pg.evaluate(STATE_JS)
        print("sound 20%:", json.dumps(s5, ensure_ascii=False))
        ok_sound = abs(s5["sound"] - 0.2) < 0.011

        # reload -> persisted
        await pg.reload(wait_until="networkidle")
        await pg.wait_for_timeout(2500)
        s6 = await pg.evaluate(STATE_JS)
        print("persisted:", json.dumps(s6, ensure_ascii=False))
        ok_persist = (s6["bloomOn"] is True and s6["shakeScale"] == 0
                      and abs(s6["sound"] - 0.2) < 0.011)

        # in-game: shake OFF actually suppresses addShake
        await pg.evaluate("document.getElementById('startBtn').click()")
        await pg.wait_for_timeout(1200)
        await pg.evaluate("""(() => {
          window.__ns._cameraFx.addShake(0.8);
        })()""")
        await pg.wait_for_timeout(100)
        shake = await pg.evaluate("window.__ns._cameraFx.shake")
        print("shake after addShake(0.8) with motion OFF:", shake)
        ok_shake_suppressed = shake == 0

        ok = (ok_default and ok_bloom_off and ok_bloom_on and ok_motion
              and ok_sound and ok_persist and ok_shake_suppressed
              and len(errors) == 0)
        print("errors:", len(errors))
        for e in errors[:6]:
            print("  ERR:", e)
        print("VERDICT:", "PASS" if ok else "FAIL")
        await b.close()


asyncio.run(main())
