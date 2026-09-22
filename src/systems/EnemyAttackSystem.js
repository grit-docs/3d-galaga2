/**
 * EnemyAttackSystem.js
 * ---------------------------------------------------------------
 * Periodically picks enemies out of the formation and sends them
 * diving toward the player on a per-variant curve.
 *
 * Cadence scales with wave; the concurrent-dive cap grows with
 * wave so later waves feel busy without becoming unfair.
 *
 * Elite variants additionally fire a small "energy capture beam"
 * cone while on the dive — a nod to the classic capture mechanic,
 * implemented with our own rules (brief slow + shield chip if the
 * player stands inside the cone for the whole duration).
 * ---------------------------------------------------------------
 */
import { DIVE } from '../config.js';

// (concurrent-dive cap now lives in config DIVE.MAX_CONCURRENT)
const ELITE_BEAM_RADIUS = 2.2;
const ELITE_BEAM_DURATION = 1.0;
// highest wave key defined in DIVE.MAX_CONCURRENT (hoisted — update()
// used to recompute the Object.keys spread every frame)
const MAX_DIVE_WAVE_KEY = Math.max(...Object.keys(DIVE.MAX_CONCURRENT).map(Number));

export class EnemyAttackSystem {
  constructor(game) {
    this._game = game;
    this._timer = DIVE.FIRST_DELAY;
    this._diveCooldowns = new Map(); // enemy -> seconds until reusable
    this._eliteBeam = { active: false, enemy: null, t: 0 };
  }

  reset() {
    this._timer = DIVE.FIRST_DELAY;
    this._diveCooldowns.clear();
    this._eliteBeam.active = false;
  }

  update(dt, wave) {
    // decay dive cooldowns and drop entries for gone enemies.
    // Without this the map only ever grows (enemies are pooled) and
    // a once-selected diver stays "on cooldown" forever, so the same
    // ship keeps diving while the rest of the wave never does.
    for (const [e, cd] of this._diveCooldowns) {
      const n = cd - dt;
      if (n <= 0 || !e.active) this._diveCooldowns.delete(e);
      else this._diveCooldowns.set(e, n);
    }

    // elite beam lifecycle
    if (this._eliteBeam.active) {
      this._eliteBeam.t += dt;
      const target = this._eliteBeam.enemy;
      // if the dived away / died, kill the beam
      if (!target || !target.active || target.dying || !target.isDiving()) {
        this._eliteBeam.active = false;
      } else if (this._eliteBeam.t > ELITE_BEAM_DURATION) {
        // expire: apply the small shield chip if player still in cone
        const player = this._game._context.player;
        const dx = target.position.x - player.group.position.x;
        const dy = target.position.y - player.group.position.y;
        if (dx * dx + dy * dy < ELITE_BEAM_RADIUS * ELITE_BEAM_RADIUS) {
          player.heal(-PLAYER_SHIELD_HIT);
          this._game.audio?.play?.('playerHit');
          this._game.hud?.flashDamage?.('hit');
        }
        this._eliteBeam.active = false;
      }
    }

    // schedule new dives
    this._timer -= dt;
    if (this._timer > 0) return;
    const interval = DIVE.INTERVAL_BY_WAVE[Math.min(wave, DIVE.INTERVAL_BY_WAVE.length - 1)] ?? 1.2;
    this._timer = interval * (0.8 + Math.random() * 0.5);

    if (wave < 1) return;

    // difficulty pass: the concurrent-dive cap now reads from config
    // (DIVE.MAX_CONCURRENT) so it's tunable in one place. Wave keys are
    // clamped to the highest defined wave; deeper waves reuse the max.
    const maxConcurrent = DIVE.MAX_CONCURRENT[Math.min(wave, MAX_DIVE_WAVE_KEY)] ?? 2;
    const activeDivers = this._countActiveDivers();
    if (activeDivers >= maxConcurrent) return;

    const diver = this._pickDiver(wave);
    if (!diver) return;
    // GALAGA 2: a bug that queued an "approach" spends its FIRST
    // scheduled attack on the close player swipe instead of a normal
    // dive. (WaveSystem only sets it on wave 2+.)
    if (diver._approachQueued && wave >= 2) {
      diver._approachQueued = false;
      diver._buildApproachCurve(this._game);
      diver.state = 'APPROACHING';
    } else {
      diver._buildDiveCurve(this._game);
      diver.state = 'DIVING';
    }
    this._diveCooldowns.set(diver, DIVE.RETURN_TIME + 2 + Math.random() * 2);

    // elite: trigger a capture beam on a subset of dives
    if (diver.type === 'elite' && Math.random() < 0.6) {
      this._eliteBeam.active = true;
      this._eliteBeam.enemy = diver;
      this._eliteBeam.t = 0;
    }
  }

  _countActiveDivers() {
    const enemies = this._game._context.enemyList;
    let n = 0;
    for (const e of enemies) if (e.active && (e.state === 'DIVING' || e.state === 'APPROACHING')) n++;
    return n;
  }

  /**
   * Pick a diver: prefer elites, then heavies/interceptors, then
   * fighters. Skip enemies that are already on cooldown.
   */
  _pickDiver(wave) {
    const enemies = this._game._context.enemyList;
    let candidate = null;
    let bestPriority = -1;

    for (const e of enemies) {
      if (!e.active || e.dying || e.state !== 'FORMATION') continue;
      const cd = this._diveCooldowns.get(e) ?? 0;
      if (cd > 0) continue;
      const priority = priorityFor(e.type, wave);
      if (priority > bestPriority) {
        bestPriority = priority;
        candidate = e;
      }
    }
    // NOTE: the diving cooldown is applied by update() after it takes
    // the candidate. Do NOT set it here again (double-set used to make
    // the same enemy dive twice back-to-back).
    return candidate;
  }

  get eliteBeam() {
    return this._eliteBeam;
  }
}

function priorityFor(type, wave) {
  let p;
  switch (type) {
    case 'elite': p = 10 + wave; break;
    case 'interceptor': p = 6 + wave * 0.4; break;
    case 'heavy': p = 4 + wave * 0.3; break;
    default: p = 2 + wave * 0.2;
  }
  return p + Math.random() * 2;
}

const PLAYER_SHIELD_HIT = 12;
