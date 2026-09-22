/**
 * ProjectileSystem.js
 * ---------------------------------------------------------------
 * Owns the shared projectile + power-up pools and exposes spawn /
 * update / getActiveProjectiles / deactivateAll helpers.
 *
 * All spawns are pooled — no (re)allocation after boot.
 * Pools are shared so a single boss bullet uses the same resource
 * as a regular enemy shot.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { COLORS, ENEMY_PROJECTILE, HOMING, POOL_DEFAULTS, SHOT_TRAIL } from '../config.js';
import { Pool } from '../core/Pool.js';
import { Projectile } from '../entities/Projectile.js';
import { PowerUp } from '../entities/PowerUp.js';

// kill-zone bounds for out-of-play culling (world units).
// zMax sits just behind the camera (z=30) so shots despawn as soon
// as they leave the visible frame — no lingering bullets in the sky.
const KILL_ZONE = {
  halfX: 34,
  zMin: -110,
  zMax: 38,
};

// module-level scratch — spawn() copies the vectors synchronously, so
// reusing these across spawn calls avoids a 2–3 Vector3 allocation
// per shot (the boss fans fire dozens per second).
const _velocity = new THREE.Vector3();
const _spawnPos = new THREE.Vector3();

export class ProjectileSystem {
  constructor(scene) {
    this._scene = scene;
    this._projectilePool = new Pool(() => this._makeProjectile(), POOL_DEFAULTS.PROJECTILES);
    this._powerupPool = new Pool(() => this._makePowerUp(), POOL_DEFAULTS.POWERUPS);
    this._activeProjectiles = new Set();
    this._activePowerups = new Set();
    this._initTrails();
  }

  /**
   * GALAGA 2: one shared LineSegments layer draws a fading streak behind
   * every live shot (bright head colour -> black tail, additive blending —
   * the same trick as the starfield's comet tails). Pool-sized capacity,
   * written in place every frame; inactive slots are collapsed to a
   * zero-length segment so they cost nothing under additive blending.
   */
  _initTrails() {
    const n = POOL_DEFAULTS.PROJECTILES;
    this._trailPos = new Float32Array(n * 6);
    this._trailCol = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this._trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(this._trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._trailMesh = new THREE.LineSegments(geo, mat);
    this._trailMesh.frustumCulled = false;
    this._trailGeo = geo;
    this._scene.add(this._trailMesh);
    // head colour lookup — created once, shared for every trail head
    this._cPlayer = new THREE.Color(COLORS.PLAYER_LASER);
    this._cEnemy = new THREE.Color(COLORS.ENEMY_BULLET);
    this._cHoming = new THREE.Color(0xff2fd0); // the seeker magenta
  }

  /** Rebuild the trail vertices from the live shot list (per frame). */
  _updateTrails() {
    const pos = this._trailPos;
    const col = this._trailCol;
    let i = 0;
    for (const p of this._activeProjectiles) {
      if (i >= POOL_DEFAULTS.PROJECTILES) break;
      if (!p.active) continue;
      const t6 = i * 6;
      const px = p.group.position.x;
      const py = p.group.position.y;
      const pz = p.group.position.z;
      // trail time per shot kind
      const time = p.homing
        ? SHOT_TRAIL.HOMING_TIME
        : (p.hostile ? SHOT_TRAIL.ENEMY_TIME : SHOT_TRAIL.PLAYER_TIME);
      // head colour
      const c = p.homing ? this._cHoming : (p.hostile ? this._cEnemy : this._cPlayer);
      col[t6] = c.r; col[t6 + 1] = c.g; col[t6 + 2] = c.b;
      // tail: straight back along the velocity direction
      pos[t6] = px; pos[t6 + 1] = py; pos[t6 + 2] = pz;
      pos[t6 + 3] = px - p._vx * time;
      pos[t6 + 4] = py - p._vy * time;
      pos[t6 + 5] = pz - p._vz * time;
      // tail colour: black (additive blending => fades to invisible)
      col[t6 + 3] = 0; col[t6 + 4] = 0; col[t6 + 5] = 0;
      i += 1;
    }
    // collapse any unused slots to a zero-length segment at the origin
    while (i < POOL_DEFAULTS.PROJECTILES) {
      const t6 = i * 6;
      pos[t6] = pos[t6 + 3] = 0;
      pos[t6 + 1] = pos[t6 + 4] = 0;
      pos[t6 + 2] = pos[t6 + 5] = 0;
      col[t6] = col[t6 + 3] = 0;
      col[t6 + 1] = col[t6 + 4] = 0;
      col[t6 + 2] = col[t6 + 5] = 0;
      i += 1;
    }
    this._trailGeo.attributes.position.needsUpdate = true;
    this._trailGeo.attributes.color.needsUpdate = true;
  }

  _makeProjectile() {
    const p = new Projectile(this._scene, (item) => {
      this._activeProjectiles.delete(item);
      this._projectilePool.release(item);
    });
    return p;
  }

  _makePowerUp() {
    const pu = new PowerUp(this._scene, (item) => {
      this._activePowerups.delete(item);
      this._powerupPool.release(item);
    });
    return pu;
  }

  /**
   * Spawn a player laser. `angle` in radians; 0 = straight.
   * Convention: player fires in -Z direction.
   * GALAGA 2: pass `dir` (unit 3D vector) to fire toward the aim
   * reticle instead of straight ahead. When omitted, the old
   * angle-based straight/fanned behavior is kept.
   */
  spawnPlayerShot({ origin, angle = 0, stats, dir }) {
    const speed = stats.baseSpeed;
    if (dir) {
      _velocity.set(dir.x, dir.y, dir.z).multiplyScalar(speed);
    } else {
      _velocity.set(-Math.sin(angle) * speed, 0, -Math.cos(angle) * speed);
    }
    const velocity = _velocity;
    const off = _spawnPos.set(origin.x, origin.y + 0.2, origin.z - 1.6);
    const p = this._projectilePool.acquire();
    p.spawn({
      position: off,
      velocity,
      hostile: false,
      damage: stats.baseDamage,
      // GALAGA 2 T2: 강화 관통 레이저 — shots punch through `pierce`
      // extra craft before dissipating (0 = normal single-hit laser)
      pierce: stats.pierce || 0,
      scale: 1.0,
    });
    this._activeProjectiles.add(p);
    return p;
  }

  spawnEnemyShot({ origin, dir, speed, damage, scale = 1, kind, life, radius, homing = false, homingSpeed, turnRate }) {
    // Enemy bullets are 10% slower than their raw `speed` (config
    // ENEMY_PROJECTILE.SPEED_SCALE) so they're easier to dodge.
    const v = _velocity.copy(dir).multiplyScalar(speed * ENEMY_PROJECTILE.SPEED_SCALE);
    const p = this._projectilePool.acquire();
    // Lifetime: explicit `life` wins (boss mines pass 6s); otherwise
    // give a regular shot enough time to actually REACH the player —
    // worst case spawn is ~85 units away (z -68 .. player 17) at the
    // slowest wave-1 speed (16 * 0.9 = 14.4/s) ≈ 5.9s. The old blanket
    // 4.0s expiry killed bullets mid-flight near the player, reading as
    // "shots disappearing around the craft".
    // Homing shots pass their own generous life (they may take a curve).
    const dist = Math.hypot(origin.x, origin.z - 17);
    const needed = dist / (speed * ENEMY_PROJECTILE.SPEED_SCALE);
    p.spawn({
      position: origin,
      velocity: v,
      hostile: true,
      damage,
      scale,
      kind,
      life: life ?? (homing ? HOMING.LIFE : Math.min(12, needed + 1.5)),
      // hitbox matches the 30%-smaller visual ball (0.55 x 0.7)
      radius: radius ?? (homing ? HOMING.RADIUS : 0.385),
      homing,
      homingSpeed: homing ? homingSpeed : undefined,
      turnRate,
    });
    this._activeProjectiles.add(p);
    return p;
  }

  spawnPowerUp({ origin, type, fallSpeed }) {
    const pu = this._powerupPool.acquire();
    pu.spawn(origin.x, origin.z, type, fallSpeed);
    this._activePowerups.add(pu);
    return pu;
  }

  update(dt, playerPos) {
    // projectiles
    for (const p of this._activeProjectiles) {
      p.update(dt, KILL_ZONE, playerPos);
    }
    // GALAGA 2: motion trails behind every live shot (one draw call)
    this._updateTrails();
    // powerups
    for (const pu of this._activePowerups) {
      pu.update(dt);
    }
  }

  get activeProjectiles() {
    return this._activeProjectiles;
  }
  get activePowerups() {
    return this._activePowerups;
  }

  deactivateAll() {
    for (const p of [...this._activeProjectiles]) p.kill();
    for (const pu of [...this._activePowerups]) pu.kill();
  }

  /** Kill only hostile shots — used when the boss dies so the screen
   *  clears of its fire while the player's live lasers / powerups
   *  are left alone. */
  deactivateHostile() {
    for (const p of [...this._activeProjectiles]) {
      if (p.hostile) p.kill();
    }
  }
}
