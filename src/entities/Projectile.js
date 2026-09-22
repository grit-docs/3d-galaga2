/**
 * Projectile.js
 * ---------------------------------------------------------------
 * A single pooled laser. Used for BOTH player lasers and enemy
 * bullets — the `hostile` flag + `style` field drive rendering and
 * collision routing in the CollisionSystem.
 *
 * Pooled: call `spawn(...)` to (re)initialise, `kill()` to return
 * it to the pool (via the owner ProjectileSystem).
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { COLORS, HOMING } from '../config.js';

// shared geometries/materials — created ONCE, shared across all shots
const GEO_PLAYER = new THREE.CapsuleGeometry(0.16, 1.1, 3, 8);
// GALAGA 2: enemy bullets are solid cylinders too — the same laser
// language as the player (slightly shorter, and the 0.7 scale in the
// constructor keeps them visually subordinate to the player beam).
const GEO_ENEMY = new THREE.CapsuleGeometry(0.18, 0.9, 3, 8);
const GEO_CORE = new THREE.SphereGeometry(0.06, 6, 4);
// GALAGA 2: the homing missile — a proper seeker, not a bullet.
// A slim capsule body, a pointed nose, two rear fins and a flickering
// engine flame. It always points along its (steering) velocity, so the
// fins + flame read instantly as "a missile is coming for you".
const GEO_HOMING = new THREE.CapsuleGeometry(0.13, 0.62, 3, 8);
const GEO_HOMING_TIP = new THREE.ConeGeometry(0.13, 0.3, 8);
const GEO_HOMING_FIN = new THREE.BoxGeometry(0.34, 0.045, 0.18);
const GEO_HOMING_FLAME = new THREE.ConeGeometry(0.09, 0.42, 6);

const MAT_PLAYER = new THREE.MeshStandardMaterial({
  color: 0x06222e,
  emissive: COLORS.PLAYER_LASER,
  emissiveIntensity: 4.2,
  roughness: 0.15,
});
const MAT_PLAYER_CORE = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xbfffff,
  emissiveIntensity: 4.0,
});
const MAT_ENEMY = new THREE.MeshStandardMaterial({
  color: 0x33001a,
  emissive: COLORS.ENEMY_BULLET,
  emissiveIntensity: 3.8,
  roughness: 0.18,
});
const MAT_ENEMY_CORE = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffc0dc,
  emissiveIntensity: 3.5,
});
// GALAGA 2: homing missile look — a hot magenta core (the "seeker", the
// most alarming part of the shot) wrapped in a dark blue body. The magenta
// is deliberately far from EVERY enemy color (green/purple/orange/teal/blue
// hulls) and from the stock enemy bullet pink (0xff5d8f is softer) so a live
// missile is instantly readable as "the one that's coming for you".
const MAT_HOMING_BODY = new THREE.MeshStandardMaterial({
  color: 0x101a3a,
  emissive: 0x3b5cff,
  emissiveIntensity: 1.6,
  roughness: 0.3,
});
const MAT_HOMING_CORE = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xff2fd0,
  emissiveIntensity: 4.5,
  roughness: 0.2,
});
// engine flame — additive + depthWrite off so it never z-fights the body
// and glows through bloom like a live thruster.
const MAT_HOMING_FLAME = new THREE.MeshBasicMaterial({
  color: 0xff8a3c,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

// GALAGA 2: module-level scratch for the 3D laser orientation — the
// pool is shared, so per-shot allocation would hit every frame.
const _dirFrom = new THREE.Vector3();
const _aimAt = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m4 = new THREE.Matrix4();

// GALAGA 2: scratch for the homing steer (module-level, zero allocation
// per frame — the pool is shared so per-shot vectors would hit every frame).
const _hVel = new THREE.Vector3();   // current velocity (normalized → heading)
const _hWant = new THREE.Vector3();  // desired direction (toward player)
const _hCross = new THREE.Vector3(); // axis of the turn
const _hQuat = new THREE.Quaternion();
const _hAxis = new THREE.Vector3();

export class Projectile {
  constructor(scene, poolRelease) {
    this.group = new THREE.Group();
    this._release = poolRelease; // () => pool.release(this)

    // player laser body
    this.playerShot = new THREE.Mesh(GEO_PLAYER, MAT_PLAYER);
    this.playerCore = new THREE.Mesh(GEO_CORE, MAT_PLAYER_CORE);
    this.playerShot.rotation.x = Math.PI / 2;
    this.group.add(this.playerShot, this.playerCore);

    // enemy laser (generic hostile shot)
    this.enemyShot = new THREE.Mesh(GEO_ENEMY, MAT_ENEMY);
    this.enemyShot.rotation.x = Math.PI / 2; // capsule axis along -Z
    this.enemyCore = new THREE.Mesh(GEO_CORE, MAT_ENEMY_CORE);
    // enemy bullets are 30% smaller (visual only — the shared hitbox radius
    // in spawn() is untouched, so dodging fairness is unchanged).
    this.enemyShot.scale.setScalar(0.7);
    this.enemyCore.scale.setScalar(0.7);
    this.group.add(this.enemyShot, this.enemyCore);
    this.enemyShot.visible = false;
    this.enemyCore.visible = false;

    // GALAGA 2: homing missile body (only visible when homing=true)
    // Pose convention: nose points -Z (the group aims at pos - dir).
    this.homingBody = new THREE.Mesh(GEO_HOMING, MAT_HOMING_BODY);
    this.homingBody.rotation.x = Math.PI / 2; // point the capsule along -Z
    this.homingCore = new THREE.Mesh(GEO_CORE, MAT_HOMING_CORE);
    this.homingTip = new THREE.Mesh(GEO_HOMING_TIP, MAT_HOMING_CORE);
    this.homingTip.rotation.x = -Math.PI / 2; // cone nose forward (-Z)
    this.homingTip.position.z = -0.5;
    // rear fins — perpendicular to the flight axis (a missile's tell)
    this.homingFinA = new THREE.Mesh(GEO_HOMING_FIN, MAT_HOMING_BODY);
    this.homingFinA.position.z = 0.38;
    this.homingFinB = new THREE.Mesh(GEO_HOMING_FIN, MAT_HOMING_BODY);
    this.homingFinB.rotation.y = Math.PI / 2;
    this.homingFinB.position.z = 0.38;
    // engine flame — trailing behind the body, flickered in update()
    this.homingFlame = new THREE.Mesh(GEO_HOMING_FLAME, MAT_HOMING_FLAME);
    this.homingFlame.rotation.x = Math.PI / 2; // wide end at +Z (rear)
    this.homingFlame.position.z = 0.55;
    this.group.add(this.homingBody, this.homingCore, this.homingTip,
      this.homingFinA, this.homingFinB, this.homingFlame);
    this.homingBody.visible = false;
    this.homingCore.visible = false;
    this.homingTip.visible = false;
    this.homingFinA.visible = false;
    this.homingFinB.visible = false;
    this.homingFlame.visible = false;

    this.group.visible = false;
    scene.add(this.group);

    this.active = false;
    this.hostile = false;
    this.homing = false; // GALAGA 2: steering toward the player?
    this._homingSpeed = 0; // current (s)
    this.speed = 0;
    this.damage = 0;
    this._t = 0; // elapsed life — drives the missile flame flicker
    this.pierce = 0; // remaining pierce hits (0 = normal)
    this.radius = 0.5;
    this._vx = 0;
    this._vy = 0; // GALAGA 2: 3D aim — vertical velocity component
    this._vz = 0;
    this._life = 0;
  }

  onRecycle() {
    this.active = false;
    this.homing = false;
    this._homingSpeed = 0;
    this._t = 0;
    this.group.visible = false;
    this.pierce = 0;
  }

  /**
   * @param {object} opts { position, velocity, damage, hostile, pierce, radius, speedScale, homing }
   */
  spawn(opts) {
    this.active = true;
    this.group.visible = true;
    this.hostile = !!opts.hostile;
    this.homing = !!opts.homing; // GALAGA 2
    // GALAGA 2: per-shot turn rate. Defaults to the scout's lazy 0.65;
    // the boss's seekers pass a stickier value (BOSS.SHOT.MIS_TURN).
    this._homingTurn = (opts.homing && opts.turnRate) || HOMING.TURN_RATE;
    this._homingSpeed = opts.homing
      ? (opts.homingSpeed || HOMING.SPEED)
      : 0;
    this.damage = opts.damage;
    this.pierce = opts.pierce ?? 0;
    this.radius = opts.radius ?? (opts.hostile ? 0.55 : 0.5);

    this._vx = opts.velocity.x;
    this._vy = opts.velocity.y; // GALAGA 2: keep the vertical component —
    this._vz = opts.velocity.z; // enemy 3D aim and player reticle aim both
    // carry y, and dropping it made aimed shots fly horizontally.
    this.group.position.copy(opts.position);
    this.group.rotation.set(0, 0, 0);

    this.playerShot.visible = !this.hostile;
    this.playerCore.visible = !this.hostile;
    this.enemyShot.visible = this.hostile && !this.homing;
    this.enemyCore.visible = this.hostile && !this.homing;
    this.homingBody.visible = this.homing;
    this.homingCore.visible = this.homing;
    this.homingTip.visible = this.homing;
    this.homingFinA.visible = this.homing;
    this.homingFinB.visible = this.homing;
    this.homingFlame.visible = this.homing;

    // GALAGA 2: orient EVERY shot body along its 3D travel direction.
    // All cylinder bodies (player laser, enemy laser, homing dart) point
    // -Z after their base pose, so aim at pos - dir for every kind.
    {
      const vx = this._vx, vy = this._vy, vz = this._vz;
      if (vx * vx + vy * vy + vz * vz > 1e-8) {
        _dirFrom.set(vx, vy, vz).normalize();
        _aimAt.copy(this.group.position).addScaledVector(_dirFrom, -1);
        _m4.lookAt(this.group.position, _aimAt, _up);
        this.group.quaternion.setFromRotationMatrix(_m4);
      }
    }

    // scale: shots are small by design
    const s = opts.scale ?? 1;
    this.group.scale.setScalar(s);

    // Hard lifetime budget so ANY shot (including sideways/horizontal
    // boss ring shots that never cross the z kill-zone) despawns.
    this._life = opts.life ?? (opts.hostile ? 4.0 : 2.4);
    return this;
  }

  update(dt, killZone, playerPos) {
    if (!this.active) return;

    // lifetime expiry — last line of defense against lingering shots
    this._life -= dt;
    if (this._life <= 0) {
      this.kill();
      return;
    }

    if (this.homing) {
      this._homingSteer(dt, playerPos);
    }

    this.group.position.x += this._vx * dt;
    this.group.position.y += this._vy * dt; // GALAGA 2: full 3D travel
    this.group.position.z += this._vz * dt;

    if (this.homing) {
      this._t += dt;
      // engine flame flicker — the missile is "burning" toward you
      const f = 1 + 0.35 * Math.sin(this._t * 46) * Math.sin(this._t * 17 + 2);
      this.homingFlame.scale.set(f, 1, f);
      // point the dart nose along its (steered) travel direction
      _dirFrom.set(this._vx, this._vy, this._vz);
      if (_dirFrom.lengthSq() > 1e-8) {
        _dirFrom.normalize();
        _aimAt.copy(this.group.position).addScaledVector(_dirFrom, -1);
        _m4.lookAt(this.group.position, _aimAt, _up);
        this.group.quaternion.setFromRotationMatrix(_m4);
      }
    }

    const p = this.group.position;
    // B7: ProjectileSystem passes { halfX, zMin, zMax } — use exactly
    // that shape. (Previously this read killZone.x/.top/.bottom which
    // were undefined, so culling never fired.)
    if (
      Math.abs(p.x) > killZone.halfX ||
      p.z > killZone.zMax ||
      p.z < killZone.zMin
    ) {
      // kill (not just deactivate) so the object returns to the pool —
      // a plain deactivate leaked the item into the active Set forever.
      this.kill();
    }
  }

  /**
   * GALAGA 2: turn the missile's heading toward the player, but cap how
   * fast it can turn (HOMING.TURN_RATE rad/s). This is what makes it
   * dodgeable — a late, sharp lateral move outruns the turn, whereas an
   * instant-reaim homing shot would be unfair. Pure heading-steer: we
   * only rotate the existing velocity vector; its magnitude is preserved.
   * `playerPos` is the live player group position (may be null if dead).
   */
  _homingSteer(dt, playerPos) {
    if (!playerPos) return;
    const p = this.group.position;
    // desired direction: straight at the player (full 3D, y included)
    _hWant.set(playerPos.x - p.x, playerPos.y - p.y, playerPos.z - p.z);
    const wantLen = _hWant.length();
    if (wantLen < 1e-5) return;
    _hWant.multiplyScalar(1 / wantLen);

    // current heading
    _hVel.set(this._vx, this._vy, this._vz);
    const velLen = _hVel.length();
    if (velLen < 1e-5) {
      // (degenerate — snap to the want direction at full speed)
      this._vx = _hWant.x * this._homingSpeed;
      this._vy = _hWant.y * this._homingSpeed;
      this._vz = _hWant.z * this._homingSpeed;
      return;
    }
    _hVel.multiplyScalar(1 / velLen);

    // angle between current heading and desired
    let dot = _hVel.dot(_hWant);
    dot = THREE.MathUtils.clamp(dot, -1, 1);
    const angle = Math.acos(dot);
    if (angle < 1e-4) return; // already aimed

    // cap the turn this frame
    const maxTurn = this._homingTurn * dt;
    const turn = Math.min(angle, maxTurn);

    // rotate _hVel toward _hWant by `turn` around the cross-product axis
    _hCross.crossVectors(_hVel, _hWant);
    if (_hCross.lengthSq() < 1e-8) return; // anti-parallel (won't happen for angle<π)
    _hAxis.copy(_hCross).normalize();
    _hQuat.setFromAxisAngle(_hAxis, turn);
    _hVel.applyQuaternion(_hQuat).normalize();

    // write back, preserving speed magnitude
    this._vx = _hVel.x * velLen;
    this._vy = _hVel.y * velLen;
    this._vz = _hVel.z * velLen;
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
  }

  kill() {
    // idempotent so that deactivateAll / collision / bounds never
    // double-release the same projectile back to the pool.
    if (!this.active) return;
    this.deactivate();
    this.onRecycle();
    this._release(this);
  }
}
