/**
 * Boss4.js
 * ---------------------------------------------------------------
 * GALAGA 2: the ACID SERPENT — fourth boss (wave 20+ slot, cycle 4+).
 *
 * Identity: a long coiled serpent. The HEAD is the collision body;
 * the BODY is a trail of 14 segments that sample the head's recent
 * path, so the whole creature visibly coils, undulates, and lunges
 * through the 3D field. Signature attacks: aimed acid spit, a
 * radial ring from the head, and a rare HOMING STRIKE dart in the
 * late phases. Toxic green palette (see COLORS.BOSS4) — distinct
 * from the violet dreadnought, ember carrier, and ice ring.
 *
 * Same architecture as Boss/Boss2/Boss3: shared `ctx.boss` slot,
 * pending telegraph queue, phases keyed off the HP ratio. The body
 * segments are decorative (no hitbox) — the head carries the
 * collision radius (BOSS4.RADIUS).
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOSS4, BOSS, COLORS } from '../config.js';
import { buildEnemyShip } from './ShipBuilder.js';
import { Boss } from './Boss.js';

const _dir = new THREE.Vector3();
const _mw = new THREE.Vector3();
const TELEGRAPH = 0.3;
const INVULN_FLOOR = 3.0;
const _histV = new THREE.Vector3();

export class Boss4 extends Boss {
  constructor() {
    super();
    // swap in the serpent head (new group; parent's dreadnought group
    // is never added to the scene and is left to GC)
    this.group = buildEnemyShip('boss4', COLORS.BOSS4);
    this.group.name = 'boss4';
    this.group.scale.set(1.7, 1.7, 1.7);
    this.group.visible = false;
    this.radius = BOSS4.RADIUS;
    this._collectParts();
    // body segments (visual only) — built here, attached to the scene
    this._segGeo = new THREE.SphereGeometry(1, 12, 10);
    this._segments = [];
    for (let i = 0; i < BOSS4.SEGMENTS; i++) {
      const f = 1 - (i + 1) / BOSS4.SEGMENTS; // 1 near head -> 0 at tail
      const mat = new THREE.MeshBasicMaterial({
        color: 0x1c4415,
        transparent: true,
        opacity: 0.55 + f * 0.45,
      });
      const m = new THREE.Mesh(this._segGeo, mat);
      m.scale.setScalar(1.5 * (0.5 + 0.5 * f));
      m.visible = false;
      this.group.add(m);
      this._segments.push(m);
    }
    this._history = []; // recent head positions (body samples these)
    this._histAccum = 0;
    this._lungTimer = 4;
    this._lungZ = 0;
    this._lungTarget = 0;
  }

  configure(wave) {
    const cycle = Math.max(0, Math.floor(wave / BOSS.BOSS_EVERY) - 4);
    this.maxHp = BOSS4.HP + BOSS4.HP_SCALE * cycle;
    this.hp = this.maxHp;
    this.alive = true;
    this.entering = true;
    this.phase = 1;
    this._t = 0;
    this._fireTimer = 1.0;
    this._tickN = 0;
    this._patrolY = 3.0;
    this._lungTimer = 4;
    this._lungZ = 0;
    this._lungTarget = 0;
    this._invuln = INVULN_FLOOR;
    this._enterCueShown = false;
    this._clearPending();
    // pre-fill the body trail with the entry position so the coil
    // doesn't snap in from the origin
    this._history = [];
    const start = new THREE.Vector3(0, 6, -120);
    for (let i = 0; i < BOSS4.SEG_SPACING * BOSS4.SEGMENTS; i++) this._history.push(start.clone());
    this.group.visible = true;
    this.group.position.copy(start);
    this.group.rotation.set(0, 0, 0);
  }

  predictPositionAt(t, out) {
    const T = this._t + t;
    if (this.entering) {
      out.z = BOSS4.Z + (this.group.position.z - BOSS4.Z) * Math.exp(-1.1 * t);
      out.x = this.group.position.x * Math.exp(-1.2 * t);
      out.y = this._patrolY;
      return out;
    }
    const lungZ = this._lungTarget + (this._lungZ - this._lungTarget) * Math.exp(-2.2 * t);
    out.x = Math.sin(T * 0.4) * BOSS4.ORBIT_RX;
    out.y = this._patrolY + Math.sin(T * 1.05) * 1.6;
    out.z = BOSS4.Z + Math.sin(T * 0.3) * 4 + lungZ;
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

    // ---- movement: orbit + periodic forward lunge ---------------
    const playerY = game._context.player.group.position.y;
    if (this.entering) {
      this.group.position.z += (BOSS4.Z - this.group.position.z) * Math.min(1, dt * 1.1);
      this.group.position.x += (0 - this.group.position.x) * Math.min(1, dt * 1.2);
      this._patrolY = THREE.MathUtils.damp(this._patrolY, Math.max(1, playerY * 0.5), 1.0, dt);
      this.group.position.y += (this._patrolY - this.group.position.y) * Math.min(1, dt * 1.4);
      if (this.group.position.z > BOSS4.Z - 2) this.entering = false;
    } else {
      this._patrolY = THREE.MathUtils.damp(this._patrolY, Math.max(1, playerY * 0.5), 0.8, dt);
      const T = this._t;
      this.group.position.x = Math.sin(T * 0.4) * BOSS4.ORBIT_RX;
      this.group.position.y = this._patrolY + Math.sin(T * 1.05) * 1.6;
      this.group.position.z = BOSS4.Z + Math.sin(T * 0.3) * 4 + this._lungZ;
      // face the travel direction (derivative of the orbit)
      const vx = Math.cos(T * 0.4) * 0.4 * BOSS4.ORBIT_RX;
      const vz = Math.cos(T * 0.3) * 0.3 * 4;
      this.group.rotation.y = Math.atan2(vx, vz);
      this.group.rotation.z = -Math.cos(T * 1.05) * 0.12;
    }

    // ---- lunge (phases 2/3): surge at the player ---------------
    if (!this.entering) {
      if (this.phase < 2) {
        this._lungZ = THREE.MathUtils.damp(this._lungZ, 0, 3, dt);
      } else {
        this._lungTimer -= dt;
        if (this._lungTimer <= 0) {
          const surging = this._lungZ < 6;
          this._lungTarget = surging ? 16 : 0;
          this._lungTimer = surging ? 1.8 : 5 + Math.random() * 3;
        }
        this._lungZ = THREE.MathUtils.damp(this._lungZ, this._lungTarget, 2.2, dt);
      }
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

    // ---- head + tail glow ----------------------------------------
    const charging = this._pending.length > 0;
    if (this._core) {
      const danger = 1 - ratio;
      const chargeBoost = charging ? 1.6 + Math.sin(this._t * 30) * 0.5 : 0;
      const invulnBoost = invuln ? 1.2 + Math.sin(this._t * 10) * 0.5 : 0;
      this._core.material.emissiveIntensity =
        1.4 + Math.sin(this._t * 6) * 0.3 + danger * 1.6 + chargeBoost + invulnBoost;
      const cs = 0.85 + Math.sin(this._t * 8) * 0.06 + danger * 0.15;
      this._core.scale.set(0.8 * cs, 0.8 * cs, 1.1 * cs);
    }
    // the tail segments "breathe" acid — brighter when charging
    const tailGlow = 0.5 + (charging ? Math.sin(this._t * 24) * 0.3 : 0) + (1 - ratio) * 0.4;
    for (let i = this._segments.length - 1; i >= Math.max(0, this._segments.length - 5); i--) {
      this._segments[i].material.color.setHex(0x2f7a1e).multiplyScalar(1);
      this._segments[i].material.opacity = Math.min(1, 0.3 + tailGlow * 0.35);
    }

    // ---- firing ---------------------------------------------------
    this._fireTimer -= dt;
    if (this._fireTimer <= 0) this._attackTick(game);

    // ---- body trail ------------------------------------------------
    this._histAccum += dt;
    while (this._histAccum >= BOSS4.SEG_SPACING) {
      this._histAccum -= BOSS4.SEG_SPACING;
      this._history.unshift(this.group.position.clone());
      const maxSamples = BOSS4.SEG_SPACING * (BOSS4.SEGMENTS + 2);
      if (this._history.length > maxSamples) this._history.length = maxSamples;
    }
    for (let i = 0; i < this._segments.length; i++) {
      const idx = (i + 1) * BOSS4.SEG_SPACING;
      const p = this._history[Math.min(this._history.length - 1, idx)];
      if (p) {
        this._segments[i].position.copy(_histV.copy(p).sub(this.group.position));
        // sag slightly so the coil reads as a body, not a line
        this._segments[i].position.y -= 0.18 * (i / this._segments.length);
      }
      this._segments[i].visible = !this.entering || this._history.length > idx;
    }

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

    // head pods charge while a volley is telegraphed
    const pk = charging ? 1.25 + Math.sin(this._t * 30) * 0.15 : 1;
    for (const c of this._cannons) c.scale.set(0.4 * pk, 0.4 * pk, 0.7 * pk);
  }

  /**
   * Acid arsenals: aimed spit volleys on the cadence, a radial ring
   * every few ticks, and (from phase 2) a hard homing STRIKE dart
   * that pulls in on the player.
   */
  _attackTick(game) {
    const ctx = game._context;
    const player = ctx.player.group.position;
    const wave = ctx.wave;

    const rate = this.phase === 1
      ? BOSS4.FIRE_INTERVAL.p1
      : this.phase === 2 ? BOSS4.FIRE_INTERVAL.p2 : BOSS4.FIRE_INTERVAL.p3;
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

    this._tickN += 1;

    // --- aimed acid spit ------------------------------------------
    const nSpit = this.phase === 1 ? 3 : this.phase === 2 ? 3 : 5;
    const spread = this.phase === 1 ? 0.06 : this.phase === 2 ? 0.05 : 0.13;
    for (let i = 0; i < nSpit; i++) {
      const off = (i - (nSpit - 1) / 2) * spread;
      charge(aim(player.x, player.z, off), {
        ci: i % this._cannons.length,
        speed: 12 + wave * 0.35,
        damage: 20 + this.phase,
      });
    }

    // --- radial ring from the head --------------------------------
    if (this._tickN % (this.phase === 3 ? 2 : 3) === 0) {
      const n = this.phase === 1 ? 8 : 10;
      const speed = 8 + wave * 0.25;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this._t * 0.4; // slowly rotating ring
        _dir.set(Math.sin(a), 0, Math.cos(a)).normalize();
        charge(_dir, { speed, damage: 17 + this.phase, scale: 0.7, life: 6 });
      }
    }

    // --- homing STRIKE (phase 2+) ----------------------------------
    if (this.phase >= 2 && this._tickN % (this.phase === 3 ? 2 : 3) === 0) {
      const c = this._cannons[0] ? this.group.localToWorld(_mw.copy(this._cannons[0].position)) : this.position;
      this._pending.push({
        origin: c.clone(),
        dir: aim(player.x, player.z, (Math.random() - 0.5) * 0.1).clone(),
        speed: BOSS4.STRIKE_SPEED, damage: 18, scale: 1.1, kind: 'orb', life: 6,
        homing: true, homingSpeed: BOSS4.STRIKE_SPEED, turnRate: BOSS4.STRIKE_TURN,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    }
  }
}
