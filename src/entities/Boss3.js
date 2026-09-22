/**
 * Boss3.js
 * ---------------------------------------------------------------
 * GALAGA 2: the GLACIAL RING — third boss (wave 15 slot, cycle 3).
 *
 * Identity: a giant rotating RING of eight blades — an orbital
 * weapon that strafes the field on a wide orbit while its blades
 * spin. Signature attack: radial bullet rings emitted from every
 * blade on the main cadence (the "windshield-wiper" pattern), plus
 * a rare aimed homing strike in the late phases. Ice/cyan palette
 * (see COLORS.BOSS3) so it never reads as the violet dreadnought
 * or the ember carrier.
 *
 * Same architecture as Boss/Boss2: shared `ctx.boss` slot, pending
 * telegraph queue, escort counting through WaveSystem, phases keyed
 * off the HP ratio.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOSS3, BOSS, COLORS } from '../config.js';
import { buildEnemyShip } from './ShipBuilder.js';
import { Boss } from './Boss.js';

const _dir = new THREE.Vector3();
const _mw = new THREE.Vector3();
const TELEGRAPH = 0.28;
const INVULN_FLOOR = 3.0;

export class Boss3 extends Boss {
  constructor() {
    super();
    // swap in the ring body (new group; parent's dreadnought group is
    // never added to the scene and is left to GC)
    this.group = buildEnemyShip('boss3', COLORS.BOSS3);
    this.group.name = 'boss3';
    this.group.scale.set(2.6, 2.6, 2.6);
    this.group.visible = false;
    this.radius = BOSS3.RADIUS;
    this._collectParts();
    this._blades = this.group.userData.blades || []; // spinning ring blades
    this._spin = 0; // accumulated blade rotation
    this._orbit = 0; // accumulated orbital angle
  }

  configure(wave) {
    const cycle = Math.max(0, Math.floor(wave / BOSS.BOSS_EVERY) - 3);
    this.maxHp = BOSS3.HP + BOSS3.HP_SCALE * cycle;
    this.hp = this.maxHp;
    this.alive = true;
    this.entering = true;
    this.phase = 1;
    this._t = 0;
    this._fireTimer = 1.0;
    this._tickN = 0;
    this._patrolY = 2.5;
    this._spin = 0;
    this._orbit = 0;
    this._droneTimer = BOSS3.DRONE_INTERVAL * 0.6;
    this._invuln = INVULN_FLOOR;
    this._enterCueShown = false;
    this._clearPending();
    this.group.visible = true;
    this.group.position.set(0, 10, -110);
    this.group.rotation.set(0, 0, 0);
  }

  predictPositionAt(t, out) {
    const T = this._t + t;
    if (this.entering) {
      out.x = this.group.position.x * Math.exp(-0.8 * t);
      out.z = BOSS3.Z + (this.group.position.z - BOSS3.Z) * Math.exp(-1.2 * t);
      out.y = this._patrolY;
      return out;
    }
    out.x = Math.sin(T * BOSS3.ORBIT_SPEED) * BOSS3.ORBIT_R;
    out.y = this._patrolY + Math.sin(T * 0.8) * 1.2;
    out.z = BOSS3.Z + Math.cos(T * BOSS3.ORBIT_SPEED) * 3.5;
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

    // ---- movement: wide orbit + relentless blade spin ----------
    const playerY = game._context.player.group.position.y;
    if (this.entering) {
      // descend from high and behind, settling onto the patrol band
      this._patrolY = THREE.MathUtils.damp(this._patrolY, Math.max(1, playerY * 0.5), 1.2, dt);
      this.group.position.z += (BOSS3.Z - this.group.position.z) * Math.min(1, dt * 1.1);
      this.group.position.x += (0 - this.group.position.x) * Math.min(1, dt);
      this.group.position.y += (this._patrolY - this.group.position.y) * Math.min(1, dt * 1.4);
      this._spin += dt * 1.0;
      if (this.group.position.z > BOSS3.Z - 2.5) this.entering = false;
    } else {
      this._patrolY = THREE.MathUtils.damp(this._patrolY, Math.max(1, playerY * 0.5), 0.8, dt);
      this._orbit += dt * BOSS3.ORBIT_SPEED;
      this.group.position.x = Math.sin(this._orbit) * BOSS3.ORBIT_R;
      this.group.position.y = this._patrolY + Math.sin(this._t * 0.8) * 1.2;
      this.group.position.z = BOSS3.Z + Math.cos(this._orbit) * 3.5;
      // the ring tilts with the orbit and spins faster as it weakens
      this._spin += dt * (BOSS3.SPIN_BASE + (1 - ratio) * 0.9);
      this.group.rotation.y = -Math.cos(this._orbit) * 0.28;
      this.group.rotation.x = Math.sin(this._t * 0.8) * 0.05;
      for (const b of this._blades) b.rotation.y = this._spin;
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

    // ---- core / rim glow ----------------------------------------
    const charging = this._pending.length > 0;
    if (this._core) {
      const danger = 1 - ratio;
      const chargeBoost = charging ? 1.6 + Math.sin(this._t * 30) * 0.5 : 0;
      const invulnBoost = invuln ? 1.2 + Math.sin(this._t * 10) * 0.5 : 0;
      this._core.material.emissiveIntensity =
        1.4 + Math.sin(this._t * 6) * 0.3 + danger * 1.6 + chargeBoost + invulnBoost;
      const cs = 0.85 + Math.sin(this._t * 8) * 0.06 + danger * 0.15;
      this._core.scale.setScalar(cs);
    }
    if (this._rim) {
      const danger = 1 - ratio;
      this._rim.material.emissiveIntensity =
        1.0 + danger * 1.1 + (charging ? Math.sin(this._t * 30) * 0.6 : 0) + Math.sin(this._t * 3) * 0.15;
    }

    // ---- firing: radial rings ------------------------------------
    this._fireTimer -= dt;
    if (this._fireTimer <= 0) this._attackTick(game);

    // ---- escort call-ins ------------------------------------------
    this._updateEscorts(game, dt);

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

    // pods physically charge while a volley is telegraphed
    const pk = charging ? 1.22 + Math.sin(this._t * 30) * 0.14 : 1;
    for (const c of this._cannons) c.scale.set(0.4 * pk, 0.4 * pk, 0.7 * pk);
  }

  /**
   * Signature: a RADIAL RING of mines from the blades — count and
   * speed climb with phase, so the gap to dodge grows tighter as the
   * ring weakens. Every 3rd tick adds a tight aimed triple, and in
   * the dying phase a single hard homing dart joins the pattern.
   */
  _attackTick(game) {
    const ctx = game._context;
    const player = ctx.player.group.position;
    const wave = ctx.wave;

    const rate = this.phase === 1
      ? BOSS3.FIRE_INTERVAL.p1
      : this.phase === 2 ? BOSS3.FIRE_INTERVAL.p2 : BOSS3.FIRE_INTERVAL.p3;
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
        origin, dir: d.clone(), speed: o.speed, damage: o.damage ?? 20,
        scale: o.scale ?? 0.8, kind: 'orb', life: o.life ?? 6,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    };

    this._tickN += 1;

    // --- radial ring (the ring's signature) ----------------------
    const n = this.phase === 1 ? BOSS3.RING_COUNT.p1
      : this.phase === 2 ? BOSS3.RING_COUNT.p2 : BOSS3.RING_COUNT.p3;
    const ringSpeed = 8.5 + wave * 0.25 + this.phase;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _dir.set(Math.sin(a), 0, Math.cos(a)).normalize();
      charge(_dir, {
        ci: i % this._cannons.length,
        speed: ringSpeed,
        damage: 17 + this.phase,
        scale: 0.75,
        life: 7,
      });
    }

    // --- tight aimed triple on top --------------------------------
    if (this._tickN % 3 === 0) {
      for (let i = -1; i <= 1; i++) {
        charge(aim(player.x, player.z, i * 0.05), {
          ci: (i + 1) % this._cannons.length,
          speed: 13 + wave * 0.35, damage: 21 + this.phase, scale: 0.8, life: 5,
        });
      }
    }

    // --- dying phase: one hard homing dart ------------------------
    if (this.phase === 3 && this._tickN % 4 === 0) {
      const c = this._cannons[0] ? this.group.localToWorld(_mw.copy(this._cannons[0].position)) : this.position;
      this._pending.push({
        origin: c.clone(),
        dir: aim(player.x, player.z, (Math.random() - 0.5) * 0.1).clone(),
        speed: BOSS3.STRIKE_SPEED, damage: 18, scale: 1.1, kind: 'orb', life: 6,
        homing: true, homingSpeed: BOSS3.STRIKE_SPEED, turnRate: BOSS3.STRIKE_TURN,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    }
  }

  /**
   * Escort call-ins (pairs every ~7s) so the orbit never sits still.
   */
  _updateEscorts(game, dt) {
    if (!this.alive) return;
    this._droneTimer -= dt;
    if (this._droneTimer > 0) return;
    this._droneTimer = BOSS3.DRONE_INTERVAL * (0.8 + Math.random() * 0.4);
    const types = BOSS3.DRONE_TYPES;
    for (let i = 0; i < 2; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const side = i === 0 ? -1 : 1;
      const enemy = game.acquireEnemy(type);
      if (!enemy) continue;
      const x = side * (12 + Math.random() * 6);
      const y = 1 + Math.random() * 3;
      const z = -36 - Math.random() * 10;
      enemy.configure({
        slot: new THREE.Vector3(x, y, z),
        index: 0,
        spawnFrom: new THREE.Vector3(x * 1.9, 9 + Math.random() * 5, -88 - Math.random() * 8),
        hpScale: 1,
        approach: false,
      });
      game.addEnemy(enemy);
      game.waveSystem.enemySpawned();
    }
  }
}
