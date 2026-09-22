/**
 * Boss2.js
 * ---------------------------------------------------------------
 * GALAGA 2: the EMBER CARRIER — the second boss. Takes over the
 * every-5-waves boss slot from wave 10 on (wave 10, 15, 20...);
 * the original dreadnought (Boss.js) keeps waves 5, and (if the
 * run is short) the first boss slot is simply never reached again.
 *
 * Same architecture as the first boss (shared slot `ctx.boss`,
 * pending-shot telegraph queue, escort counting through
 * WaveSystem), different identity:
 *
 *   movement  — a WIDE left/right sweep across the field (the
 *               dreadnought hugs the center; the carrier walks the
 *               rails), at a low altitude that damps to the player
 *               band
 *   weapons   — an 8-way rapid fan from all five pods, cycling the
 *               barrels, on a faster cadence than the dreadnought's
 *               5-mine ticks
 *   drones    — calls pairs of small craft (fighters/interceptors)
 *               on a timer so the field never sits still
 *
 * Phases still key off the HP ratio (1 = fresh, 2 = 1/3 left, 3 =
 * dying) and tighten the fan cadence + open the fan angle as it
 * weakens.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOSS2, BOSS, COLORS } from '../config.js';
import { buildEnemyShip } from './ShipBuilder.js';
import { Boss } from './Boss.js';

const _dir = new THREE.Vector3();
const _mw = new THREE.Vector3();
const TELEGRAPH = 0.3; // charge before carrier shots leave the pod
// Entry-grace floor — same rule as the first boss (fly-in + 3s so
// stray volleys can't chip it before it engages).
const INVULN_FLOOR = 3.0;

export class Boss2 extends Boss {
  constructor() {
    super(); // builds the dreadnought mesh — replaced below
    // swap in the carrier body (new group, so collect parts again).
    // the parent's dreadnought group is intentionally NOT added to the
    // scene and is left to GC once this constructor drops it.
    this.group = buildEnemyShip('boss2', COLORS.BOSS2);
    this.group.name = 'boss2';
    this.group.scale.set(2.2, 2.2, 2.2);
    this.group.visible = false;
    this.radius = BOSS2.RADIUS;
    this._collectParts();
    // drone call-in state
    this._droneTimer = BOSS2.DRONE_INTERVAL * 0.6;
  }

  /** Carrier stats: bigger pool than the first boss's cycle 0. */
  configure(wave) {
    // cycle above wave 10: wave 10 -> 0, wave 15 -> 1, ...
    const cycle = Math.max(0, Math.floor(wave / BOSS.BOSS_EVERY) - 2);
    this.maxHp = BOSS2.HP + BOSS2.HP_SCALE * cycle;
    this.hp = this.maxHp;
    this.alive = true;
    this.entering = true;
    this.phase = 1;
    this._t = 0;
    this._fireTimer = 1.0;
    this._tickN = 0;
    this._patrolY = 1.0; // the carrier sits LOW
    this._droneTimer = BOSS2.DRONE_INTERVAL * 0.6;
    this._invuln = INVULN_FLOOR;
    this._enterCueShown = false;
    this._clearPending();
    this.group.visible = true;
    this.group.position.set(0, 3, -95);
    this.group.rotation.set(0, 0, 0);
  }

  /**
   * Full override — the carrier moves and fights differently from
   * the dreadnought. Keeps the same public surface: pending-shot
   * queue, core/vent breathing, invuln window, phase by HP ratio.
   */
  /**
   * GALAGA 2: exact future-position prediction for auto-aim (see
   * Enemy.predictPositionAt). Boss2 sweeps on low-frequency sines, so
   * evaluating them at `this._t + t` gives the true position at impact.
   */
  predictPositionAt(t, out) {
    const T = this._t + t;
    if (this.entering) {
      out.z = BOSS2.Z + (this.group.position.z - BOSS2.Z) * Math.exp(-1.4 * t);
      out.x = this.group.position.x * Math.exp(-1.2 * t);
      out.y = this.group.position.y;
      return out;
    }
    out.x = Math.sin(T * 0.32) * BOSS2.SWEEP;
    out.y = this._patrolY + Math.sin(T * 0.9) * 0.9;
    out.z = BOSS2.Z + Math.sin(T * 0.45) * 2.5;
    return out;
  }

  update(game, dt) {
    if (!this.alive) return;
    this._t += dt;

    // ---- phase selection from HP ratio --------------------------
    const ratio = this.coreHpRatio;
    const targetPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (targetPhase !== this.phase) {
      this.phase = targetPhase;
      this._fireTimer = Math.max(this._fireTimer, 0.5);
      this._pulseCore();
    }

    // ---- movement: wide left/right SWEEP at low altitude --------
    const playerY = game._context.player.group.position.y;
    if (this.entering) {
      this.group.position.z += (BOSS2.Z - this.group.position.z) * Math.min(1, dt * 1.4);
      this.group.position.x += (0 - this.group.position.x) * Math.min(1, dt * 1.2);
      if (this.group.position.z > BOSS2.Z - 1.5) this.entering = false;
    } else {
      // the carrier walks the rails: a slow full-width sweep, tilted
      // slightly as it turns, breathing low around the player band
      this._patrolY = THREE.MathUtils.damp(this._patrolY, Math.max(0.5, playerY * 0.6), 0.8, dt);
      const sweep = Math.sin(this._t * 0.32);
      this.group.position.x = sweep * BOSS2.SWEEP;
      this.group.position.y = this._patrolY + Math.sin(this._t * 0.9) * 0.9;
      this.group.position.z = BOSS2.Z + Math.sin(this._t * 0.45) * 2.5;
      this.group.rotation.z = -Math.cos(this._t * 0.32) * 0.2;
      this.group.rotation.x = Math.sin(this._t * 0.9) * 0.03;
    }

    // ---- invuln window (fly-in OR minimum grace) ----------------
    if (this._invuln > 0) this._invuln -= dt;
    const invuln = this.entering || this._invuln > 0;
    if (!invuln && !this._enterCueShown) {
      this._enterCueShown = true;
      game._floatingText.spawnAt(
        this.position.clone().add(new THREE.Vector3(0, 3.2, 0)),
        'SHIELD DOWN', '#7dff9a', false
      );
    }

    // ---- core glow scales with danger (+ charge boost) ----------
    const charging = this._pending.length > 0;
    if (this._core) {
      const danger = 1 - ratio;
      const chargeBoost = charging ? 1.6 + Math.sin(this._t * 30) * 0.5 : 0;
      const invulnBoost = invuln ? 1.2 + Math.sin(this._t * 10) * 0.5 : 0;
      this._core.material.emissiveIntensity =
        1.4 + Math.sin(this._t * 6) * 0.3 + danger * 1.6 + chargeBoost + invulnBoost;
      const cs = 0.85 + Math.sin(this._t * 8) * 0.06 + danger * 0.15;
      this._core.scale.set(0.95 * cs, 0.72 * cs, 1.25 * cs);
    }
    if (this._vent) {
      const danger = 1 - ratio;
      const breath = 1 + Math.sin(this._t * (3 + danger * 5)) * 0.12;
      this._vent.scale.set(1.0 * breath, 0.7 * breath, 0.4 * breath);
      this._vent.material.emissiveIntensity = 1.4 + danger * 1.2 + (charging ? Math.sin(this._t * 30) * 0.5 : 0);
    }

    // ---- firing: 8-way rapid fan --------------------------------
    this._fireTimer -= dt;
    if (this._fireTimer <= 0) this._attackTick(game);

    // ---- drone call-ins ------------------------------------------
    this._updateDrones(game, dt);

    // ---- pending shots fire once the charge finishes -------------
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const s = this._pending[i];
      s.t -= dt;
      if (s.t <= 0) {
        game._context.spawnEnemyShot({
          origin: s.origin, dir: s.dir, speed: s.speed, damage: s.damage, scale: s.scale,
          kind: s.kind, life: s.life,
          homing: s.homing, homingSpeed: s.homingSpeed, turnRate: s.turnRate,
        });
        this._pending.splice(i, 1);
      }
    }

    // gun pods physically charge up while a volley is telegraphed
    const pk = charging ? 1.22 + Math.sin(this._t * 30) * 0.14 : 1;
    for (const c of this._cannons) c.scale.set(0.4 * pk, 0.4 * pk, 0.7 * pk);
  }

  /**
   * The carrier's signature: an 8-way fan of fast mines from all five
   * pods, cycled so the barrels visibly alternate. The fan centers on
   * the player and widens as the carrier weakens (phase 1 = ~26°,
   * phase 2 = ~34°, phase 3 = ~44° — a dodge, not a wall).
   */
  _attackTick(game) {
    const ctx = game._context;
    const player = ctx.player.group.position;
    const wave = ctx.wave;

    const rate = this.phase === 1
      ? BOSS2.FIRE_INTERVAL.p1
      : this.phase === 2 ? BOSS2.FIRE_INTERVAL.p2 : BOSS2.FIRE_INTERVAL.p3;
    this._fireTimer = rate * (0.9 + Math.random() * 0.3);

    const aim = (tx, tz, spread = 0) => {
      const dx = tx - this.position.x;
      const dy = player.y - this.position.y;
      const dz = tz - this.position.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      let dirx = dx / len, diry = dy / len, dirz = dz / len;
      if (spread !== 0) {
        const c = Math.cos(spread), s = Math.sin(spread);
        const nx = dirx * c - dirz * s;
        dirz = dirx * s + dirz * c;
        dirx = nx;
      }
      return _dir.set(dirx, diry, dirz).normalize();
    };

    const charge = (d, o = {}) => {
      const ci = (o.ci !== undefined) ? o.ci : 0;
      const c = this._cannons[ci] || this._cannons[0];
      const origin = c ? this.group.localToWorld(_mw.copy(c.position)).clone() : this.position.clone();
      this._pending.push({
        origin, dir: d.clone(), speed: o.speed, damage: o.damage ?? 22,
        scale: o.scale ?? 0.9, kind: 'orb', life: o.life ?? 5,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    };

    const n = 8;
    const half = this.phase === 1 ? 0.24 : this.phase === 2 ? 0.32 : 0.42;
    const base = aim(player.x, player.z);
    const speed = 12 + wave * 0.35;
    this._tickN += 1;
    for (let i = 0; i < n; i++) {
      const ang = -half + (i / (n - 1)) * half * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      _dir.set(base.x * c - base.z * s, base.y, base.x * s + base.z * c).normalize();
      // cycle all five pods so the volley visibly comes from the whole deck
      charge(_dir, {
        ci: i % this._cannons.length,
        speed: speed + (i === 3 || i === 4 ? 1.5 : 0), // center mines a touch faster
        damage: 20 + this.phase,
      });
    }
    // every 4th tick: a tight 3-shot aimed punch on top of the fan
    if (this._tickN % 4 === 0) {
      for (let i = -1; i <= 1; i++) {
        charge(aim(player.x, player.z, i * 0.05), {
          ci: (i + 2) % this._cannons.length,
          speed: speed + 4, damage: 24 + this.phase, scale: 0.7, life: 4,
        });
      }
    }
  }

  /**
   * Drone call-ins: while the carrier lives, a pair of small craft
   * (fighter/interceptor) drips in from the wings every ~7s. Same
   * accounting as the first boss's escorts (waveSystem.enemySpawned)
   * so the wave only completes after the whole swarm is dead.
   */
  _updateDrones(game, dt) {
    if (!this.alive) return;
    this._droneTimer -= dt;
    if (this._droneTimer > 0) return;
    this._droneTimer = BOSS2.DRONE_INTERVAL * (0.8 + Math.random() * 0.4);
    const types = BOSS2.DRONE_TYPES;
    for (let i = 0; i < 2; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const side = i === 0 ? -1 : 1;
      const enemy = game.acquireEnemy(type);
      if (!enemy) continue;
      const x = side * (12 + Math.random() * 6);
      const y = 1 + Math.random() * 2;
      const z = -36 - Math.random() * 10;
      enemy.configure({
        slot: new THREE.Vector3(x, y, z),
        index: 0,
        spawnFrom: new THREE.Vector3(x * 1.9, 9 + Math.random() * 5, -88 - Math.random() * 8),
        hpScale: 1,
        approach: false,
      });
      game.addEnemy(enemy);
      game.waveSystem.enemySpawned(); // count it so isComplete waits for it
    }
  }
}
