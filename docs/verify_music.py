import asyncio, json
from playwright.async_api import async_playwright

BASE = "https://localhost:5173/3d-galaga/"

MUSIC_JS = r"""(() => {
  const g = window.__ns;
  const m = g.music;
  return {
    music: !!m,
    mode: m?.mode,
    totalSteps: m?._totalSteps,
    gain: !!m?._gain,
    ctxState: g.audio.ctx?.state,
    game: g.state?.current,
    bossAlive: g._context.boss?.alive,
  };
})()"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=[
            "--enable-unsafe-webgpu", "--use-angle=d3d11",
            "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(BASE, wait_until="networkidle")
        await asyncio.sleep(3)
        m1 = await pg.evaluate(MUSIC_JS)
        print("menu:", json.dumps(m1))
        # click start (user gesture -> AudioContext allowed)
        await pg.click("#startBtn")
        await asyncio.sleep(4)
        m2 = await pg.evaluate(MUSIC_JS)
        print("play:", json.dumps(m2))
        # long window: headless throttles setInterval, so allow a
        # generous rate floor; what matters is steady progress + the
        # scheduler horizon staying ahead of the audio clock
        await asyncio.sleep(8)
        m3 = await pg.evaluate(r"""(() => {
  const g = window.__ns; const m = g.music; const c = g.audio.ctx;
  return {
    mode: m.mode, totalSteps: m._totalSteps,
    horizon: m._nextTime - c.currentTime,   // buffered seconds ahead
  };
})()""")
        print("play+8s:", json.dumps(m3))
        advancing = m3["totalSteps"] - m2["totalSteps"]
        expected = 8 * 60 / 132 * 4  # ~146
        print(f"steps in 8s: {advancing} (real-time ~{expected}, throttled ok >{int(expected*0.5)})")
        print(f"scheduler horizon: {m3['horizon']:.3f}s ahead of audio clock")
        # force a boss wave
        await pg.evaluate("window.__ns._startWave(5)")
        await asyncio.sleep(2)
        m4 = await pg.evaluate(MUSIC_JS)
        print("boss:", json.dumps(m4))
        # pause
        await pg.keyboard.press("KeyP")
        await asyncio.sleep(0.5)
        m5 = await pg.evaluate(MUSIC_JS)
        print("paused:", json.dumps(m5))
        await b.close()
        ok = (m1.get("mode") == "menu" and m2.get("mode") == "play"
              and m3.get("mode") == "play" and advancing > expected * 0.5
              and m3.get("horizon", -1) > 0
              and m4.get("mode") == "boss" and m5.get("mode") == "off")
        print("VERDICT:", "PASS" if ok else "FAIL", "| errors:", len(errors), errors[:3])

asyncio.run(main())
