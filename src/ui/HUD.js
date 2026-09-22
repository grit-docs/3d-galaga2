/**
 * HUD.js
 * ---------------------------------------------------------------
 * A thin wrapper over the <div id="game-root"> HUD.
 *
 *  - Top bar: Score / High score / Wave / Combo
 *  - Bottom bar: Weapon level, Shield gauge, Life icons
 *  - Boss bar: shown on boss waves
 *  - Menu, Pause, Game Over, Wave Clear overlays
 *
 * All methods are idempotent: calling showMenu() once is fine,
 * calling it again just refreshes it.
 *
 * The HUD does NOT create any DOM nodes at run time except for
 * the floating score text container, which is already part of the
 * page. Everything else is static HTML.
 * ---------------------------------------------------------------
 */
import { GAME, COMBO, PLAYER } from '../config.js';

export class HUD {
  constructor(root) {
    this._root = root;

    this.scoreEl = root.querySelector('[data-hud="#score"]');
    this.highScoreEl = root.querySelector('[data-hud="#highScore"]');
    this.waveEl = root.querySelector('[data-hud="#wave"]');
    this.comboEl = root.querySelector('[data-hud="#combo"]');
    this.comboCell = root.querySelector('#comboCell');
    // GALAGA 2: combo meter fill (progress bar under the xN readout)
    this.comboFillEl = root.querySelector('[data-hud="#comboFill"]');
    // GALAGA 2: dash readiness meter — the HTML bar existed but was
    // never wired; full + pulsing = READY, otherwise fills as the
    // cooldown drains.
    this.dashFillEl = root.querySelector('[data-hud="#dashFill"]');
    this.shieldFill = root.querySelector('[data-hud="#shieldFill"]');
    this.shieldPctEl = root.querySelector('[data-hud="#shieldPct"]');
    this.lifeEl = root.querySelector('[data-hud="#life"]');
    // Array (not NodeList) — setLife() appends hearts when life cap grows
    this.hearts = this.lifeEl
      ? Array.from(this.lifeEl.querySelectorAll('svg'))
      : [];
    // GALAGA 2: BOMBA stock pips (3 dots, filled = available)
    this.bombaPipsEl = root.querySelector('#bombaPips');
    this.weaponEl = root.querySelector('[data-hud="#weapon"]');
    this.rapidEl = root.querySelector('[data-hud="#rapid"]');
    this.bossEl = root.querySelector('[data-hud="#boss"]');
    this.bossFill = root.querySelector('[data-hud="#bossFill"]');
    this.bossPhaseEl = root.querySelector('[data-hud="#bossPhase"]');

    // Damage-feedback overlay: a red edge vignette that pulses every
    // time the player is hit (built once, re-triggered via CSS animation).
    const dmg = document.createElement('div');
    dmg.className = 'damage-flash';
    this._damageFlashEl = dmg;
    root.appendChild(dmg);

    // GALAGA 2: BOMBA screen flash — a bright white-cyan full-frame
    // pulse at the moment the blast goes off (same re-trigger pattern).
    const bomb = document.createElement('div');
    bomb.className = 'bomba-flash';
    this._bombaFlashEl = bomb;
    root.appendChild(bomb);

    this.menuEl = root.querySelector('#menu');
    this.pauseEl = root.querySelector('#pause');
    this.gameOverEl = root.querySelector('#gameOver');
    this.waveClearEl = root.querySelector('#waveClear');
    this.startButton = root.querySelector('#startBtn');
    this.resumeButton = root.querySelector('#resumeBtn');
    // note: Restart / Main-Menu buttons are bound by class in bind()
    // because they appear on BOTH the pause and game-over panels.
  }

  // ------- score / wave / combo ----------------------------------
  setScore(n) { this.scoreEl.textContent = String(Math.max(0, Math.floor(n))); }
  setHighScore(n) { this.highScoreEl.textContent = String(Math.max(0, Math.floor(n))); }
  setWave(n) { this.waveEl.textContent = String(n); }
  setCombo(m) {
    m = Math.max(1, m);
    this.comboEl.textContent = `x${m}`;
    this.comboEl.classList.toggle('hot', m >= 5);
    if (this.comboCell) this.comboCell.style.visibility = m >= 2 ? 'visible' : 'hidden';
    // GALAGA 2: combo meter — fills across COMBO.STEP kills, then wraps
    // (a full bar = one "tier" of chain earned; the xN label above is
    // the live multiplier, which is a separate, untouched formula).
    if (this.comboFillEl) {
      const step = COMBO.STEP;
      const inTier = (m - 1) % step;
      this.comboFillEl.style.width = `${(inTier / step) * 100}%`;
      // a bar that is just about to roll over gets a brief highlight
      this.comboCell.classList.toggle('tier', m > 1 && inTier >= step - 1);
    }
  }
  setShield(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    this.shieldFill.style.width = `${r * 100}%`;
    this.shieldFill.classList.toggle('low', r <= 0.2);
    this.shieldFill.classList.toggle('mid', r > 0.2 && r <= 0.5);
    if (this.shieldPctEl) this.shieldPctEl.textContent = `${Math.round(r * 100)}%`;
  }
  setLife(n) {
    // render n filled hearts; grow the pool when lives exceed the 3
    // baked into the markup (비긴 코어: max 5). Shown slots stay at the
    // highest count reached so a lost life reads as a greyed heart.
    const tpl = this.hearts[0];
    if (tpl) {
      while (this.hearts.length < n && this.hearts.length < 5) {
        const extra = tpl.cloneNode(true);
        this.lifeEl.appendChild(extra);
        this.hearts.push(extra);
      }
    }
    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].classList.toggle('lost', i >= n);
    }
  }
  /** new run: back to the base 5-slot pool (markup bakes in 5 hearts;
   *  lost ones read as hollow outlines via svg.lost — see setLife) */
  resetHearts() {
    if (!this.lifeEl) return;
    while (this.hearts.length > 5) {
      const el = this.hearts.pop();
      el.remove();
    }
  }
  setWeaponLevel(n) {
    this.weaponEl.textContent = `LV ${Math.max(1, n)}`;
  }
  /** GALAGA 2: BOMBA stock pips. n = units available (0..cap).
   *  Pips grow on demand so the T2 expansion (cap 3→4) needs no
   *  markup change — extra pips are appended to #bombaPips. */
  setBomba(n, cap) {
    if (!this.bombaPipsEl) return;
    // The pip pool mirrors the *cap* (max stock) so a T2 BOMBA expansion
    // (cap 3→4) grows it and a fresh run (cap back to 3) shrinks it again.
    // When `cap` is omitted the pool keeps its current size (callers that
    // only change the *filled* count must not accidentally remove slots);
    // only an explicit cap triggers a shrink. `n` fills the first n slots.
    const existing = this.bombaPipsEl.querySelectorAll('.bomba-pip').length;
    cap = Math.max(1, cap ?? (existing || n));
    let pips = this.bombaPipsEl.querySelectorAll('.bomba-pip');
    while (pips.length < cap) {
      const pip = document.createElement('span');
      pip.className = 'bomba-pip';
      this.bombaPipsEl.appendChild(pip);
      pips = this.bombaPipsEl.querySelectorAll('.bomba-pip');
    }
    while (pips.length > cap) {
      pips[pips.length - 1].remove();
      pips = this.bombaPipsEl.querySelectorAll('.bomba-pip');
    }
    pips.forEach((pip, i) => pip.classList.toggle('on', i < n));
  }

  /** GALAGA 2: bright full-frame pulse when BOMBA detonates. */
  flashBomba() {
    const el = this._bombaFlashEl;
    if (!el) return;
    el.classList.remove('bomba-flash-on');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('bomba-flash-on');
  }
  /** GALAGA 2: dash readiness meter. cooldownLeft = seconds of cooldown
   *  remaining (0 = READY). Fill runs 0→100% as the cooldown drains;
   *  at READY the fill pins at 100% and the cell pulses. */
  setDash(cooldownLeft) {
    if (!this.dashFillEl) return;
    const cd = Math.max(0, cooldownLeft || 0);
    const ready = cd <= 0;
    const ratio = ready ? 1 : Math.max(0, Math.min(1, 1 - cd / PLAYER.DASH_COOLDOWN));
    this.dashFillEl.style.width = `${ratio * 100}%`;
    const cell = this.dashFillEl.closest('.dash-cell');
    if (cell) cell.classList.toggle('dash-ready', ready);
  }
  setTimedBuff(showRapid, rapidLevel = 0) {
    if (!this.rapidEl) return;
    this.rapidEl.style.display = showRapid ? '' : 'none';
    this.rapidEl.textContent = rapidLevel > 1 ? `RAPID ${rapidLevel}` : 'RAPID';
  }

  /**
   * Pulse the red damage vignette when the player is hit.
   * @param {'hit'|'lostLife'|'dead'} kind hit = shield chip,
   *   lostLife/dead = a harder, brighter double pulse.
   */
  flashDamage(kind = 'hit') {
    const el = this._damageFlashEl;
    if (!el) return;
    el.classList.remove('damage-flash-hit', 'damage-flash-severe');
    // force reflow so the CSS animation restarts even on rapid hits
    void el.offsetWidth;
    el.classList.add(kind === 'hit' ? 'damage-flash-hit' : 'damage-flash-severe');
  }

  /**
   * GALAGA 2 juice: combo-tier kill flash. tier 2 (x9+) gives a gold
   * pulse on the combo cell; tier 3 (x18+) adds a brief full-screen
   * gold shimmer. Kept subtle — the strongest feedback belongs to the
   * explosion/hitstop, not the HUD.
   */
  flashComboTier(tier = 2) {
    if (!this.comboCell) return;
    const cls = tier >= 3 ? 'combo-flash-tier3' : 'combo-flash-tier2';
    this.comboCell.classList.remove('combo-flash-tier2', 'combo-flash-tier3');
    void this.comboCell.offsetWidth; // restart the CSS animation
    this.comboCell.classList.add(cls);
  }

  // ------- boss --------------------------------------------------
  setBoss(hpRatio, phase) {
    this.bossEl.style.visibility = 'visible';
    this.bossFill.style.width = `${Math.max(0, hpRatio) * 100}%`;
    this.bossPhaseEl.textContent = `PHASE ${phase}`;
    this.bossFill.style.background = phase >= 3 ? 'var(--danger)' : phase >= 2 ? 'var(--neon2)' : 'var(--neon3)';
  }
  hideBoss() {
    this.bossEl.style.visibility = 'hidden';
  }

  // ------- overlays ---------------------------------------------
  /** Hide every OTHER overlay so a transition never stacks two popups
   *  (e.g. game-over panel lingering behind the main menu). */
  _hideOthers(except) {
    for (const el of [this.menuEl, this.pauseEl, this.gameOverEl, this.waveClearEl]) {
      if (el && el !== except) el.style.display = 'none';
    }
  }

  showMenu(gpuSupported) {
    this._hideOthers(this.menuEl);
    this.menuEl.style.display = 'flex';
    const webgpu = this.menuEl.querySelector('[data-webgpu]');
    if (webgpu) {
      webgpu.textContent = gpuSupported ? 'WebGPU: OK' : 'WebGPU: required';
      webgpu.classList.toggle('ok', gpuSupported);
      webgpu.classList.toggle('bad', !gpuSupported);
    }
  }
  hideMenu() { this.menuEl.style.display = 'none'; }
  showPause() {
    this._hideOthers(this.pauseEl);
    this.pauseEl.style.display = 'flex';
  }
  hidePause() { this.pauseEl.style.display = 'none'; }
  showWaveClear(wave, bonusText = '') {
    this._hideOthers(this.waveClearEl);
    this.waveClearEl.style.display = 'flex';
    this.waveClearEl.querySelector('[data-wc="#num"]').textContent = wave;
    // GALAGA 2: simplified banner — the bare next-wave number only
    // (no card box, no "WAVE N CLEAR" label).
    this.waveClearEl.querySelector('[data-wc="#label"]').style.display = 'none';
    // GALAGA 2: wave-clear bonus reward line (points + shield), shown only
    // when the wave actually granted one (normal clears; boss waves drop
    // their own shield pickup and pass no text).
    const bonusEl = this.waveClearEl.querySelector('[data-wc="#bonus"]');
    if (bonusEl) {
      bonusEl.hidden = !bonusText;
      bonusEl.textContent = bonusText;
    }
  }
  hideWaveClear() {
    this.waveClearEl.style.display = 'none';
    this.waveClearEl.classList.remove('wc-shifted');
  }

  /**
   * Shift the banner up out of the way while the manual upgrade panel
   * is open (CSS transition) — the banner stays mounted, so closing the
   * panel doesn't re-trigger the slide-in animation (that crossfaded
   * with the panel fade-out and read as a flicker).
   */
  shiftWaveClear(shifted) {
    this.waveClearEl.classList.toggle('wc-shifted', shifted);
  }

  /**
   * @param {object} data { score, highScore, wave, kills }
   * @param {boolean} isNewHigh
   */
  showGameOver({ score, highScore, wave, kills }, isNewHigh) {
    this._hideOthers(this.gameOverEl);
    this.gameOverEl.style.display = 'flex';
    this.gameOverEl.querySelector('[data-go="#score"]').textContent = String(Math.floor(score));
    this.gameOverEl.querySelector('[data-go="#high"]').textContent = String(Math.floor(highScore));
    this.gameOverEl.querySelector('[data-go="#wave"]').textContent = String(wave);
    this.gameOverEl.querySelector('[data-go="#kills"]').textContent = String(kills);
    const newHigh = this.gameOverEl.querySelector('[data-go="#newhigh"]');
    newHigh.style.display = isNewHigh ? '' : 'none';
  }
  hideAll() {
    this.hideMenu(); this.hidePause(); this.hideWaveClear();
    this.gameOverEl.style.display = 'none';
    this.hideBoss();
  }

  // ------- binding ------------------------------------------------
  /**
   * Wire up the control buttons. Restart / Main-Menu appear on both
   * the pause and game-over panels, so they are bound by class
   * (.js-restart / .js-menu) and every match gets a listener.
   */
  bind({ onStart, onResume, onRestartMenu, onRestart, onPauseToggle }) {
    if (this.startButton) {
      this.startButton.addEventListener('click', () => {
        this.startButton.blur();
        onStart?.();
      });
    }
    if (this.resumeButton) {
      this.resumeButton.addEventListener('click', () => {
        this.resumeButton.blur();
        onResume?.();
      });
    }
    for (const btn of this._root.querySelectorAll('.js-restart')) {
      btn.addEventListener('click', () => {
        btn.blur();
        onRestart?.();
      });
    }
    for (const btn of this._root.querySelectorAll('.js-menu')) {
      btn.addEventListener('click', () => {
        btn.blur();
        onRestartMenu?.();
      });
    }
    onPauseToggle?.();
  }

  static title = GAME.TITLE;
}
