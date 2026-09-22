/**
 * BombaMissile.js
 * ---------------------------------------------------------------
 * GALAGA 2: the BOMBA missile — the visual carrier for the board
 * clearer. Pressing L no longer detonates in place; it LAUNCHES a
 * rocket from the craft that flies straight forward (-Z) for
 * BOMBA.FLIGHT_TIME seconds and detonates at the formation
 * (z = BOMBA.DETONATE_Z). The actual board-clear (hostile wipe +
 * damage + slow-mo + flash) runs at detonation in Game._bombaDetonate.
 *
 * Design notes:
 *   - A tiny pool (BOMBA.COUNT_MAX + 1) so a back-to-back press can
 *     have two missiles in the air at once; no per-launch allocation.
 *   - Flight speed is derived from the launch z -> DETONATE_Z distance
 *     over FLIGHT_TIME, so the rocket always reaches the formation in
 *     exactly FLIGHT_TIME regardless of where the player fired from.
 *   - The missile updates with REAL dt (full speed) — it is part of the
 *     "player side" and must keep flying at normal pace even while the
 *     world is in dash / BOMBA slow-mo (the time-extender contract).
 *   - update() returns an array of detonation positions (world Vector3)
 *     for this frame; Game detonates each one and the missile returns
 *     to the pool.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOMBA } from '../config.js';

// Shared geometry/materials — created once, reused by every missile.
const GEO_BODY = new THREE.CapsuleGeometry(0.16, 0.9, 3, 8);
const GEO_TIP = new THREE.ConeGeometry(0.14, 0.4, 6);
const GEO_CORE = new THREE.SphereGeometry(0.1, 6, 4);
const GEO_PLUME = new THREE.ConeGeometry(0.13, 0.7, 6);

const MAT_BODY = new THREE.MeshStandardMaterial({
  color: 0x0a1420,
  emissive: 0xffb02e,
  emissiveIntensity: 2.4,
  roughness: 0.3,
});
const MAT_TIP = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffe0a0,
  emissiveIntensity: 4.5,
  roughness: 0.2,
});
const MAT_CORE = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffc24d,
  emissiveIntensity: 5.0,
  roughness: 0.2,
});
const MAT_PLUME = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xff8a3c,
  emissiveIntensity: 3.0,
  roughness: 0.5,
  transparent: true,
  opacity: 0.8,
});

// module-level scratch (zero allocation per frame — the pool is shared)
const _bUp = new THREE.Vector3(0, 1, 0);
const _bWant = new THREE.Vector3();
const _bAim = new THREE.Vector3();
const _bAxis = new THREE.Vector3();
const _bQuat = new THREE.Quaternion();
const _bM4 = new THREE.Matrix4();

class Missile {
  constructor(scene) {
    this.group = new THREE.Group();
    this.body = new THREE.Mesh(GEO_BODY, MAT_BODY);
    this.body.rotation.x = Math.PI / 2; // capsule along -Z
    this.tip = new THREE.Mesh(GEO_TIP, MAT_TIP);
    this.tip.rotation.x = -Math.PI / 2; // cone nose forward (-Z)
    this.tip.position.z = -0.62;
    this.core = new THREE.Mesh(GEO_CORE, MAT_CORE);
    this.plume = new THREE.Mesh(GEO_PLUME, MAT_PLUME);
    this.plume.rotation.x = -Math.PI / 2; // plume trails backward (+Z)
    this.plume.position.z = 0.75;
    // salvo missiles read as small torpedoes, not one big rocket
    this.group.scale.setScalar(0.7);
    this.group.add(this.body, this.tip, this.core, this.plume);
    this.group.visible = false;
    scene.add(this.group);
    this.active = false;
    this._t = 0;
    this._delay = 0;
    this._salvoId = 0;
    this._vel = new THREE.Vector3(0, 0, -1); // heading (pooled, no per-frame alloc)
    this._off = null; // ring launch slot + initial outward direction
    this._target = null;
    this._targetIsBoss = false;
  }

  /**
   * Arm a salvo missile. `off` = { x,y,z (launch slot around the
   * craft), dx,dy,dz (unnormalized initial outward+forward direction) }.
   * `delay` is the seconds until it actually fires (the streaming
   * burst); `target` is the enemy/boss it should home on (or null);
   * `salvoId` groups all missiles of one BOMBA press so the
   * board-clear runs exactly once.
   */
  launch(off, delay, salvoId, target) {
    this.active = true;
    this._t = 0;
    this._delay = delay;
    this._salvoId = salvoId;
    this._off = off;
    this._target = target;
    this._targetIsBoss = !!(target && target.alive !== undefined && target.group === undefined);
    this.group.visible = delay <= 0;
    if (delay <= 0) this._fire();
  }

  /** Fire for real (after the stream delay elapses). */
  _fire() {
    const o = this._off;
    // start at its ring slot around the craft, nose pointing OUTWARD +
    // forward — the fan opens up from the hull.
    this.group.position.set(o.x, o.y, o.z);
    const dz = Math.abs(this.group.position.z - BOMBA.DETONATE_Z);
    const speed = dz / BOMBA.FLIGHT_TIME; // reach the formation in FLIGHT_TIME
    this._vel.set(o.dx, o.dy, o.dz).normalize().multiplyScalar(speed);
    this.group.visible = true;
  }

  onRecycle() {
    this.active = false;
    this.group.visible = false;
    this._delay = 0;
    this._target = null;
  }

  _targetAlive(t) {
    return this._targetIsBoss ? t.alive : (t.active && !t.dying);
  }
  _targetPos(t) {
    return this._targetIsBoss ? t.position : t.group.position;
  }

  /** Nearest live enemy (or the boss) — used at launch-fallback and retarget. */
  _nearest(enemyList, boss) {
    let best = null, isBoss = false, bd = Infinity;
    const p = this.group.position;
    for (const e of enemyList) {
      if (!e.active || e.dying) continue;
      const q = e.group.position;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) { bd = d; best = e; isBoss = false; }
    }
    if (boss && boss.alive) {
      const q = boss.position;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) { bd = d; best = boss; isBoss = true; }
    }
    this._targetIsBoss = isBoss;
    return best;
  }

  /**
   * Advance the missile. `dt` is REAL (full) time; `enemyList`/`boss`
   * are the live board (used for homing/retarget). Returns
   * `{ pos, salvoId }` at detonation, otherwise null.
   */
  update(dt, enemyList, boss) {
    if (!this.active) return null;
    if (this._delay > 0) {
      this._delay -= dt;
      if (this._delay <= 0) this._fire();
      return null;
    }
    this._t += dt;

    // retarget: the assigned target may have died mid-flight
    if (this._target && !this._targetAlive(this._target)) this._target = null;
    if (!this._target) this._target = this._nearest(enemyList, boss);

    const p = this.group.position;
    const tp = this._target ? this._targetPos(this._target) : null;

    if (tp) {
      // homing: rotate the heading toward the target, capped at
      // SALVO_TURN so the swarm arcs instead of rail-snapping.
      _bWant.set(tp.x - p.x, tp.y - p.y, tp.z - p.z);
      const wantLen = _bWant.length();
      if (wantLen > 1e-4) {
        _bWant.multiplyScalar(1 / wantLen);
        const vLen = this._vel.length() || 1;
        const dot = THREE.MathUtils.clamp(this._vel.dot(_bWant) / vLen, -1, 1);
        const angle = Math.acos(dot);
        if (angle > 1e-3) {
          if (angle <= BOMBA.SALVO_TURN * dt) {
            this._vel.copy(_bWant).multiplyScalar(vLen); // close — snap
          } else {
            _bAxis.crossVectors(this._vel, _bWant);
            if (_bAxis.lengthSq() > 1e-8) {
              _bAxis.normalize();
              _bQuat.setFromAxisAngle(_bAxis, BOMBA.SALVO_TURN * dt);
              this._vel.applyQuaternion(_bQuat);
            }
          }
        }
      }
    }

    p.addScaledVector(this._vel, dt);

    // engine flicker on the plume for life
    const flick = 0.8 + Math.sin(this._t * 42) * 0.25;
    this.plume.scale.set(flick, flick, 0.7 + Math.abs(Math.sin(this._t * 30)) * 0.5);

    // nose along the (steered) heading — the arcs read as banking turns
    _bAim.copy(p).addScaledVector(this._vel, -1);
    _bM4.lookAt(p, _bAim, _bUp);
    this.group.quaternion.setFromRotationMatrix(_bM4);

    // detonate on the target…
    if (tp) {
      const dx = p.x - tp.x, dy = p.y - tp.y, dz = p.z - tp.z;
      if (dx * dx + dy * dy + dz * dz < BOMBA.SALVO_LOCK * BOMBA.SALVO_LOCK) {
        return { pos: tp.clone(), salvoId: this._salvoId };
      }
    }
    // …or at the formation depth / the timer backstop (no target to chase)
    if (p.z <= BOMBA.DETONATE_Z || this._t >= BOMBA.FLIGHT_TIME) {
      return { pos: p.clone(), salvoId: this._salvoId };
    }
    return null;
  }
}

export class BombaMissile {
  constructor(scene) {
    this._scene = scene;
    this._pool = [];
    this._active = [];
    // enough for every stock unit to have a FULL SALVO airborne at once
    const n = BOMBA.SALVO_COUNT * (BOMBA.COUNT_MAX + 1);
    for (let i = 0; i < n; i++) this._pool.push(new Missile(scene));
    this._scratch = new THREE.Vector3();
  }

  /**
   * Launch a Macross-style SALVO from `origin` (the craft position).
   * SALVO_COUNT missiles sit on a ring AROUND the craft (three shells
   * of radius) and stream outward over SALVO_STREAM seconds — the
   * burst fans out radially from the hull. Each missile is assigned a
   * live enemy round-robin (boss included, first in line) to home on;
   * with no enemies aboard the board they fly straight and detonate at
   * the formation. `salvoId` tags every missile of this press.
   */
  launch(origin, salvoId, enemyList, boss) {
    const targets = [];
    if (boss && boss.alive) targets.push(boss); // boss first — missile 0 leads it
    for (const e of enemyList) {
      if (e.active && !e.dying) targets.push(e);
    }
    const n = BOMBA.SALVO_COUNT;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ring = 1.2 + (i % 3) * 0.45; // three staggered shells around the hull
      const off = {
        x: origin.x + Math.cos(a) * ring,
        y: origin.y + Math.sin(a) * ring * 0.65, // squashed vertically
        z: origin.z - 1.4,
        // initial heading: outward from the craft + forward (the fan)
        dx: Math.cos(a),
        dy: Math.sin(a) * 0.65,
        dz: -1.0,
      };
      const target = targets.length ? targets[i % targets.length] : null;
      const m = this._acquire();
      m.launch(off, (i / n) * BOMBA.SALVO_STREAM, salvoId, target);
    }
  }

  _acquire() {
    let m = this._pool.find((x) => !x.active);
    if (!m) {
      // every slot busy (shouldn't happen — pool sized to stock cap);
      // reuse the oldest active one rather than dropping the launch.
      m = this._active[0] || this._pool[0];
      if (this._active[0] === m) this._active.shift(); // drop the old ref first
    }
    this._active.push(m);
    return m;
  }

  /**
   * Advance all live missiles with real `dt`. `enemyList`/`boss` are
   * the live board (homing targets). Returns an array of detonation
   * entries `{ pos, salvoId }` for this frame.
   */
  update(dt, enemyList, boss) {
    const detonations = [];
    for (let i = this._active.length - 1; i >= 0; i--) {
      const m = this._active[i];
      const d = m.update(dt, enemyList, boss);
      if (d) {
        detonations.push(d);
        m.onRecycle();
        this._active.splice(i, 1);
      }
    }
    return detonations;
  }

  /** Clear every live missile (run reset / game over). */
  clear() {
    for (const m of this._active) m.onRecycle();
    this._active.length = 0;
  }
}
