/**
 * UpgradeSelect.js
 * ---------------------------------------------------------------
 * GALAGA 2: wave-clear upgrade selection (Vampire Survivors-style).
 *
 * Flow (driven by Game.update, so it never fights the loop):
 *   1. Game calls show(player, onSelect) when a wave clears.
 *   2. A full-screen dim overlay + 3 random cards appear.
 *   3. 1/2/3 keys or a click picks a card; the chosen one flashes,
 *      the panel fades out (~0.25s), then onSelect(id) fires.
 *
 * While `active`, Game.update early-returns: the world (including
 * leftover hostile fire) freezes — the player is safe while choosing,
 * the same contract as the pause overlay.
 *
 * All DOM is built once and reused; no per-call allocation of nodes.
 * ---------------------------------------------------------------
 */
import { UPGRADE, PLAYER } from '../config.js';

const FADE_MS = 240;
// lives card scoring reference — mirror of PLAYER.MAX_LIVES so the
// picker doesn't hardcode the number (config.js is the single source)
const PLAYER_MAX_LIVES_FALLBACK = PLAYER.MAX_LIVES;

export class UpgradeSelect {
  constructor(hudRoot) {
    this._root = hudRoot;
    this.active = false;
    this._choosing = false; // between show() and fade-out
    this._offers = [];
    this._onSelect = null;
    this._cardEls = [];
    this._pendingTO = null; // pending pick / all-max finish timeout

    // ---- build the overlay once --------------------------------
    const wrap = document.createElement('div');
    wrap.className = 'upg-overlay';
    wrap.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'upg-title';
    title.textContent = '업그레이드 선택';

    const sub = document.createElement('div');
    sub.className = 'upg-sub';
    // explicit key-hint with keycap chips (set again in show())
    sub.innerHTML =
      '키 <span class="key">1</span><span class="key">2</span><span class="key">3</span> 또는 클릭으로 선택';

    wrap.appendChild(title);
    wrap.appendChild(sub);

    // cards live in their own row so they lay out horizontally
    const cards = document.createElement('div');
    cards.className = 'upg-cards';

    for (let i = 0; i < UPGRADE.OFFERS; i++) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'upg-card';
      card.innerHTML =
        `<span class="upg-icon"></span>` +
        `<span class="upg-name"></span>` +
        `<span class="upg-desc"></span>` +
        `<span class="upg-lv"></span>` +
        `<span class="upg-key">${i + 1}</span>`;
      card.addEventListener('click', () => this._pick(i));
      cards.appendChild(card);
      this._cardEls.push(card);
    }
    wrap.appendChild(cards);

    // key handling only while active
    this._onKey = (e) => {
      if (!this._choosing) return;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0,
                  Numpad2: 1, Numpad3: 2 }[e.code];
      if (n !== undefined) {
        e.preventDefault();
        this._pick(n);
      }
    };
    window.addEventListener('keydown', this._onKey);

    this._el = wrap;
    hudRoot.appendChild(wrap);
  }

  /** The cap-aware draw pool for `wave` (POOL + POOL_T2 from
   *  TIER2_START on). Shared by the manual panel and auto-pick so the
   *  two paths never disagree about what is available. */
  _poolFor(player, wave) {
    const t2Active = wave >= UPGRADE.TIER2_START;
    return [...Object.entries(UPGRADE.POOL),
      ...(t2Active ? Object.entries(UPGRADE.POOL_T2) : [])]
      .filter(([, c]) => c.level(player) < c.cap);
  }

  /** Random `OFFERS` cards (Fisher–Yates over the cap-aware pool). */
  _pickOffers(player, wave) {
    const list = this._poolFor(player, wave);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list.slice(0, UPGRADE.OFFERS);
  }

  /**
   * GALAGA 2: auto-upgrade pick — the single "most needed" card from the
   * 3 the manual panel would have offered, scored by how badly the player
   * needs it right now (the A-plan auto path applies it with a toast +
   * UNDO window; see Game._autoApplyUpgrade):
   *   - low shield -> heal / shield cards (survival first)
   *   - empty BOMBA stock -> BOMBA stock / repair (the escape tool)
   *   - damage / rate / pierce scale with wave (late waves outgun base DPS)
   *   - regen / cap / score / life get mild situational bumps
   *   - ties break randomly so the run keeps variety
   * Returns the card id (string) or null when everything is maxed.
   */
  autoPick(player, wave) {
    const offers = this._pickOffers(player, wave);
    if (!offers.length) return null;
    const shieldRatio = player.shield / player.maxShield();
    const bombaRatio = player.bombaCount / player.bombaMax();
    const scores = offers.map(([id, cfg]) => {
      const lv = cfg.level(player);
      const capRatio = cfg.cap === Infinity ? 0.5 : lv / cfg.cap;
      let s = 10 * (1 - capRatio) + 3 * (1 - lv / 10); // lower-investment first
      if (id === 'heal') s += shieldRatio < 0.9 ? 50 * (1 - shieldRatio) : 4;
      if (id === 't2_repair') s += shieldRatio < 0.95 ? 60 * (1 - shieldRatio)
        : (bombaRatio < 1 ? 20 : 6);
      if (id === 'shield_cap') s += shieldRatio < 0.5 ? 24 : 8;
      if (id === 't2_regen') s += shieldRatio < 0.5 ? 16 : 6;
      if (id === 'shield_regen') s += shieldRatio < 0.5 ? 14 : 6;
      if (id === 't2_bomba') s += bombaRatio < 0.5 ? 26 : 6;
      if (id === 'weapon_dmg') s += Math.min(20, wave * 0.9) * (1 - capRatio) * 2;
      if (id === 't2_plasma') s += Math.min(16, wave * 0.8) * (1 - capRatio) * 2;
      if (id === 'weapon_rate') s += Math.min(14, wave * 0.7) * (1 - capRatio) * 2;
      if (id === 't2_pierce') s += Math.min(12, wave * 0.6) * (1 - capRatio) * 2;
      if (id === 'score_mult') s += 6;
      if (id === 't2_score') s += 8;
      if (id === 'life') s += player.lives <= PLAYER_MAX_LIVES_FALLBACK ? 18 : 2;
      return { id, s: s + Math.random() * 2 };
    });
    scores.sort((a, b) => b.s - a.s);
    return scores[0].id;
  }

  /** Present `OFFERS` random cards (cap-aware). Resolves via onSelect.
   *  GALAGA 2: from UPGRADE.TIER2_START on the draw pool is POOL +
   *  POOL_T2 merged, so late waves keep meaningful picks instead of
   *  collapsing to "ALL SYSTEMS MAX". */
  show(player, wave, onSelect) {
    this._offers = this._pickOffers(player, wave);
    this._onSelect = onSelect;
    this._choosing = this._offers.length > 0;
    this.active = true;

    // fill the cards
    for (let i = 0; i < this._cardEls.length; i++) {
      const card = this._cardEls[i];
      const entry = this._offers[i];
      if (entry) {
        const [, cfg] = entry;
        card.style.display = '';
        card.classList.remove('picked', 'hidden');
        card.querySelector('.upg-icon').textContent = cfg.icon;
        card.querySelector('.upg-icon').style.color = cfg.color;
        card.querySelector('.upg-name').textContent = cfg.name;
        card.querySelector('.upg-desc').textContent = cfg.desc;
        const lv = cfg.level(player);
        const lvEl = card.querySelector('.upg-lv');
        lvEl.textContent = cfg.cap === Infinity ? '' : `LV ${lv} → ${lv + 1}`;
        lvEl.style.color = cfg.color;
        card.style.setProperty('--card-c', cfg.color);
      } else {
        card.style.display = 'none';
      }
    }

    if (this._offers.length > 0) {
      this._el.querySelector('.upg-title').textContent = `WAVE ${wave} — SYSTEM UPGRADE`;
      this._el.querySelector('.upg-sub').innerHTML =
        '키 <span class="key">1</span><span class="key">2</span><span class="key">3</span> 또는 클릭으로 선택';
    } else {
      // every card maxed: award the flat bonus and close on its own
      this._el.querySelector('.upg-title').textContent = `WAVE ${wave} — ALL SYSTEMS MAX`;
      this._el.querySelector('.upg-sub').textContent = '보너스 점수 지급';
      this._choosing = false;
      clearTimeout(this._pendingTO);
      this._pendingTO = setTimeout(() => { if (this.active) this._finish(null); }, 1000);
    }

    this._el.style.display = 'flex';
    // retrigger the deal-in animation
    void this._el.offsetWidth;
    this._el.classList.add('dealing');
  }

  /** Abort (restart / game over / to-menu) — never leave a frozen world. */
  cancel() {
    if (!this.active) return;
    this._choosing = false;
    this.active = false;
    this._onSelect = null;
    // a pick (or the all-max auto-close) may still be in its fade-out
    // window — drop it so a stale onSelect can't fire after the abort
    // and re-show a "WAVE N" banner into the new state.
    clearTimeout(this._pendingTO);
    this._pendingTO = null;
    this._el.classList.remove('dealing', 'closing');
    this._el.style.display = 'none';
    for (const c of this._cardEls) c.classList.remove('picked');
  }

  _pick(i) {
    if (!this._choosing) return;
    if (i >= this._offers.length) return;
    this._cardEls[i].classList.add('picked');
    this._choosing = false;
    const [id] = this._offers[i];
    clearTimeout(this._pendingTO);
    this._pendingTO = setTimeout(() => this._finish(id), FADE_MS);
  }

  _finish(id) {
    this._el.classList.remove('dealing');
    this._el.classList.add('closing');
    this.active = false;
    const cb = this._onSelect;
    setTimeout(() => {
      this._el.classList.remove('closing');
      this._el.style.display = 'none';
      for (const c of this._cardEls) c.classList.remove('picked');
      cb?.(id);
    }, FADE_MS);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this._el.remove();
  }
}
