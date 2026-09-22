"""Post-cleanup smoke test: boots the game, then exercises every code
path touched by the source cleanup:
  - _beginWaveClear (deduped wave-clear block, auto-upgrade path)
  - hud.shiftWaveClear (new banner-shift flicker fix)
  - UpgradeSelect.cancel pending-timeout clearing
  - BombaMissile.launch (pool-exhaustion fix)
  - _onBossKilled -> _beginWaveClear (wave 10, Boss2)
"""
import asyncio
from playwright.async_api import async_playwright

URL = 'https://localhost:5173/3d-galaga2/'
OUT = 'docs/design_audit'

BOOT = """() => {
  const g = window.__ns;
  if (!g || !g.state) throw new Error('game not booted');
  return { state: g.state.current, ok: !!g._context.player };
}"""

START = """() => {
  const g = window.__ns;
  g._beginPlay();
  return { state: g.state.current, wave: g._context.wave };
}"""

KILL_WAVE = """() => {
  const g = window.__ns;
  // finish the spawn plan first so isComplete can trip, then kill all
  const ws = g.waveSystem;
  ws._spawnQueue.length = 0;
  ws._spawnTimer = 0;
  const list = g._context.enemyList.slice();
  for (const e of list) { e.hp = 0; g._onEnemyKilled(e, e.group.position); }
  return {
    state: g.state.current,
    banner: document.querySelector('#waveClear').style.display,
    warp: g._clearWarp > 0,
    pickDelay: g._upgradePickDelay,
  };
}"""

MANUAL_PANEL = """() => {
  const g = window.__ns;
  g._settings = { ...(g._settings || {}), autoUpgrade: false };
  g._upgradePickDelay = 0.05;  // let the next update tick open the panel
  return { forced: true };
}"""

PANEL_STATE = """() => {
  const g = window.__ns;
  const banner = document.querySelector('#waveClear');
  return {
    panelActive: g._upgradeSelect.active,
    bannerDisplay: banner.style.display,
    bannerShifted: banner.classList.contains('wc-shifted'),
  };
}"""

PICK_CARD = """() => {
  const g = window.__ns;
  g._upgradeSelect._pick(0);
  return { picking: true };
}"""

AFTER_PICK = """() => {
  const banner = document.querySelector('#waveClear');
  return {
    panelActive: window.__ns._upgradeSelect.active,
    bannerDisplay: banner.style.display,
    bannerShifted: banner.classList.contains('wc-shifted'),
  };
}"""

BOMBA = """() => {
  const g = window.__ns;
  const b = g._bombaMissile;
  const before = b._active.length;
  const o = g._context.player.group.position;
  b.launch(o);
  const a1 = b._active.length;
  b.launch(o);
  const a2 = b._active.length;
  // exhaust the pool to hit the reuse branch
  while (b._active.length < b._pool.length) b.launch(o);
  b.launch(o);  // every slot busy -> oldest must be spliced, not doubled
  const a3 = b._active.length;
  const dup = b._active.filter((m) => m === b._active[0]).length;
  b.clear();
  return { before, a1, a2, a3, dupAtHead: dup, pool: b._pool.length };
}"""

BOSS_WAVE = """() => {
  const g = window.__ns;
  g._startWave(10);  // wave 10 -> Boss2 (ember carrier)
  const b = g._context.boss;
  return {
    state: g.state.current,
    bossType: b.constructor.name,
    intro: g._bossIntroTimer,
    alive: b.alive,
  };
}"""

BOSS_KILL = """() => {
  const g = window.__ns;
  // escorts + spawn queue must also be cleared for isComplete (boss wave
  // = _bossDead && _spawnQueue.length === 0 && _aliveCount === 0)
  const ws = g.waveSystem;
  ws._spawnQueue.length = 0;
  ws._spawnTimer = 0;
  for (const e of g._context.enemyList.slice()) {
    e.hp = 0; g._onEnemyKilled(e, e.group.position);
  }
  const b = g._context.boss;
  g._onBossKilled(b, b.group.position);
  return {
    state: g.state.current,
    bossAlive: b.alive,
    banner: document.querySelector('#waveClear').style.display,
  };
}"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-angle=d3d11",
                  "--ignore-certificate-errors"],
        )
        page = await browser.new_page(viewport={'width': 1600, 'height': 900})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

        await page.goto(URL, wait_until='load')
        await page.wait_for_timeout(3500)
        print('boot:', await page.evaluate(BOOT))
        await page.screenshot(path=f'{OUT}/smoke_1_boot.png')

        print('start:', await page.evaluate(START))
        await page.wait_for_timeout(1500)

        print('kill wave:', await page.evaluate(KILL_WAVE))
        await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/smoke_2_waveclear.png')

        # auto-upgrade toast path (default ON)
        await page.wait_for_timeout(2500)
        print('after auto-pick window:', await page.evaluate("""() => ({
            state: window.__ns.state.current,
            toast: document.querySelector('.autoup-toast')
                  ? document.querySelector('.autoup-toast').style.display : null,
        })"""))

        # manual panel path (fresh wave clear)
        print('start w2:', await page.evaluate(START))
        await page.wait_for_timeout(1500)
        print('kill w2:', await page.evaluate(KILL_WAVE))
        print('force manual:', await page.evaluate(MANUAL_PANEL))
        await page.wait_for_timeout(400)
        print('panel open:', await page.evaluate(PANEL_STATE))
        await page.screenshot(path=f'{OUT}/smoke_3_panel.png')
        print('pick card:', await page.evaluate(PICK_CARD))
        await page.wait_for_timeout(400)
        print('fading:', await page.evaluate(AFTER_PICK))
        await page.wait_for_timeout(400)
        print('after pick:', await page.evaluate(AFTER_PICK))
        await page.screenshot(path=f'{OUT}/smoke_4_afterpick.png')

        print('bomba:', await page.evaluate(BOMBA))
        print('boss wave:', await page.evaluate(BOSS_WAVE))
        await page.wait_for_timeout(3200)  # BOSS.INTRO_TIME = 2.6
        print('boss kill:', await page.evaluate(BOSS_KILL))
        await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/smoke_5_boss.png')

        # cancel() with a pending pick must not fire a stale onSelect
        print('cancel pending:', await page.evaluate("""() => {
            const g = window.__ns;
            g._startWave(11);
            g._upgradeSelect.active = true;
            g._upgradeSelect._choosing = false;
            g._upgradeSelect._onSelect = () => { window.__stale = true; };
            g._upgradeSelect._pendingTO =
                setTimeout(() => g._upgradeSelect._finish('weapon_dmg'), 240);
            g._upgradeSelect.cancel();
            return { cancelled: true };
        }"""))
        await page.wait_for_timeout(500)
        print('stale fired?:', await page.evaluate('window.__stale === true'))

        print('page errors:', errs if errs else 'none')
        await browser.close()


asyncio.run(main())
