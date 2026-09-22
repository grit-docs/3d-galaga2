/**
 * Enemy.js
 * ---------------------------------------------------------------
 * A single hostile craft with a small state machine:
 *
 *   ENTERING   -> fly in on a curve to a formation slot
 *   FORMATION  -> bob in place (occasionally fire)
 *   DIVING     -> follow an attack curve toward / past the player
 *   APPROACHING-> GALAGA 2: close "approach swipe" — skim the player
 *                 at 3-6 units (Nova Storm feel), then rejoin
 *   REJOINING  -> curve back to its formation slot
 *
 * Curve movement is sampled by arc length (getPointAt) for constant
 * speed; the craft orients nose-first along the travel tangent.
 *
 * Pattern variants:
 *   fighter     -> simple curved dive
 *   interceptor -> fast S-curve dive
 *   heavy       -> slow lob dive + volleys while diving
 *   elite       -> predictive dive (aims where the player will be)
 *
 * Scratch vectors are module-level so no per-frame allocation.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { COLORS, DIVE, ENEMY, ENEMY_PROJECTILE, HOMING, WAVE } from '../config.js';
import { buildEnemyShip } from './ShipBuilder.js';

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _mLook = new THREE.Matrix4();
const _fireDir = new THREE.Vector3();
// per-type damage multiplier (hoisted — damageFor runs per shot)
const DAMAGE_BY_TYPE = { fighter: 1, interceptor: 0.9, heavy: 1.5, elite: 1.15 };

/** Size an enemy eases to as a dive closes in on the player.
 * Full-size enemies right next to the player read disproportionately large,
 * so the hull (and its hitbox) shrinks near closest approach and eases back
 * to 1 on the way out. */
const DIVE_SHRINK = 0.5;

export class Enemy {
  constructor(type) {
    this.type = type;
    this.palette = COLORS.ENEMIES[type];
    this.group = buildEnemyShip(type, this.palette);
    this.group.name = `enemy-${type}`;

    this._baseRadius = ENEMY.RADIUS[type];
    this.radius = this._baseRadius;
    this._diveScale = 1; // dive-shrink factor, eases toward DIVE_SHRINK
    this.maxHp = 1;
    this.hp = 1;

    this.state = 'ENTERING';
    this.formationIndex = -1;
    this.formationSlot = new THREE.Vector3();
    this.active = true;
    this.dying = false;
    // GALAGA 2: one-shot close approach swipe, consumed by the first
    // attack the EnemyAttackSystem schedules for this bug
    this._approachQueued = false;

    this._curve = null;
    this._curveT = 0;
    this._bobPhase = Math.random() * Math.PI * 2;
    this._fireCooldown = 0.8 + Math.random() * 1.6;
    this._volleyLeft = 0;
    // GALAGA 2: the scout's homing-missile cadence (independent of the
    // shared straight-shot _fireCooldown). Staggered so a row of scouts
    // doesn't launch in lockstep.
    this._homingCooldown = HOMING.FIRE_INTERVAL * (0.3 + Math.random() * 0.7);
    this._t = Math.random() * 10;
    this._hitFlash = 0; // non-lethal hit punch (0..1), decayed in update
    this._beamPose = null; // GALAGA 2: BeamSystem charge hover (see below)
    this._engines = [];
    this._collectEngines();
  }

  _collectEngines() {
    const list = [];
    let core = null;
    this.group.traverse((o) => {
      if (o.name === 'engine') list.push(o);
      if (o.name === 'core') core = o;
    });
    this._engines = list;
    this._core = core; // reactor: breathed idly, flares on hit
  }

  onRecycle() {
    this.active = false;
    this.dying = false;
  }

  /** Configure for a wave. */
  configure({ slot, index, spawnFrom, hpScale, approach }) {
    this.formationIndex = index;
    this.formationSlot.copy(slot);
    this.maxHp = Math.max(1, Math.round(ENEMY.BASE_HP[this.type] * hpScale));
    this.hp = this.maxHp;
    this.state = 'ENTERING';
    this.active = true;
    this.dying = false;
    this._approachQueued = !!approach; // GALAGA 2
    this._beamPose = null; // GALAGA 2: any beam charge dies with the wave
    this._bobPhase = Math.random() * Math.PI * 2;
    this._fireCooldown = 0.8 + Math.random() * 1.6;
    this._volleyLeft = 0;
    this._homingCooldown = HOMING.FIRE_INTERVAL * (0.3 + Math.random() * 0.7);

    const from = spawnFrom
      ? spawnFrom.clone()
      : new THREE.Vector3(this.formationSlot.x * 1.8, 8, -85);
    this._buildCurve(from, this.formationSlot);
    this.group.position.copy(from);
    // start full-size (a recycled enemy may have died mid-shrink at 0.5)
    this._diveScale = 1;
    this.group.scale.setScalar(1);
    this.group.visible = true;
  }

  _buildCurve(from, to) {
    const mid = from.clone().lerp(to, 0.5);
    mid.x += (Math.random() - 0.5) * 7;
    mid.y += 10 + Math.random() * 4;
    mid.z += 16;
    this._curve = new THREE.CatmullRomCurve3([from, mid, to], false, 'catmullrom', 0.4);
    this._curveT = 0;
  }

  _buildDiveCurve(game) {
    const start = this.group.position.clone();
    const player = game._context.player.group.position;
    const px = player.x;
    const py = player.y; // GALAGA 2: pass height follows the player's altitude
    const pz = player.z;
    let pts;
    if (this.type === 'interceptor') {
      // GALAGA 2: 20% of interceptors dive from a SIDE lane (behind the
      // player's shoulder) instead of the classic frontal S — rear/side
      // approach coverage per the spec.
      const side = Math.random() < 0.5 ? -1 : 1;
      const fromSide = Math.random() < 0.2;
      pts = fromSide
        ? [
            start,
            new THREE.Vector3(side * (Math.abs(px) + 10), py + 3, pz - 2),
            new THREE.Vector3(side * (Math.abs(px) + 2), py + 0.5, pz + 10),
            new THREE.Vector3(px * 0.5, py - 0.5, pz + 26),
          ]
        : [
            start,
            new THREE.Vector3(start.x + (Math.random() - 0.5) * 5, py + 6, start.z + 5),
            new THREE.Vector3(-px, py + 3, -10),
            new THREE.Vector3(px * 0.8, py + 1, pz - 6),
            new THREE.Vector3(px * 0.35, py, pz + 20),
          ];
    } else if (this.type === 'heavy') {
      pts = [
        start,
        new THREE.Vector3(start.x * 0.5, py + 8, -16),
        new THREE.Vector3(px * 0.6, py + 10, -2),
        new THREE.Vector3(px * 1.1, py + 7, pz - 5),
        new THREE.Vector3(px * 1.1, py + 3, pz + 14),
      ];
      this._volleyLeft = 3;
    } else if (this.type === 'elite') {
      // predict: aim ~2.2s of the player's lateral travel ahead
      const predictedX = px + game._context.player.velocityX * 2.2;
      pts = [
        start,
        new THREE.Vector3(predictedX * 0.6, py + 6, -14),
        new THREE.Vector3(predictedX * 1.05, py + 2, pz - 6),
        new THREE.Vector3(predictedX * 1.2, py, pz + 16),
      ];
    } else {
      // fighter: simple curved pass
      const side = px >= 0 ? -1 : 1;
      pts = [
        start,
        new THREE.Vector3(px * 0.8 + side * 4, py + 7, -16),
        new THREE.Vector3(px * 0.5 + side * 2, py + 2, -6),
        new THREE.Vector3(px, py + 0.5, pz - 5),
        new THREE.Vector3(px + side * 1.5, py - 1, pz + 18),
      ];
    }
    this._curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.45);
    this._curveT = 0;
  }

  _buildReturnCurve(to) {
    const from = this.group.position.clone();
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 8;
    mid.x += (from.x > 0 ? -1 : 1) * 5;
    this._curve = new THREE.CatmullRomCurve3([from, mid, to], false, 'catmullrom', 0.4);
    this._curveT = 0;
  }

  /**
   * GALAGA 2: the "approach swipe" (Nova Storm feel). The bug breaks
   * from its slot, banks around the player and skims PAST at a
   * guaranteed 3-6 unit closest approach (outside the ram spheres:
   * player radius ~0.86 + shrunk enemy radius < 1.7 — no free hit),
   * then exits behind and rejoins the formation. The curve is fully
   * 3D — the pass height matches the player's current altitude so the
   * skim reads as "barely missed".
   */
  _buildApproachCurve(game) {
    const start = this.group.position.clone();
    const player = game._context.player.group.position;
    const px = player.x, py = player.y, pz = player.z;
    const side = Math.random() < 0.5 ? -1 : 1;
    const gap = 3 + Math.random() * 3; // closest approach distance
    // pass point: beside the player at player altitude
    const pass = new THREE.Vector3(px + side * gap, py + (Math.random() * 2 - 1), pz - 1);
    // mid bank point: out wide and up, between the slot and the pass
    const mid = start.clone().lerp(pass, 0.5);
    mid.x += side * (6 + Math.random() * 4);
    mid.y += 4 + Math.random() * 3;
    // exit: behind the player, out to the same side
    const exit = new THREE.Vector3(px + side * (gap + 8), py + 1.5, pz + 22);
    this._curve = new THREE.CatmullRomCurve3(
      [start, mid, pass, exit], false, 'catmullrom', 0.45
    );
    this._curveT = 0;
  }

  get position() {
    return this.group.position;
  }

  isDiving() {
    // the approach swipe counts as a dive: it earns the dive-kill bonus
    // and it can ram (the 3-6 unit pass keeps it a near-miss, not a hit)
    return this.state === 'DIVING' || this.state === 'APPROACHING';
  }

  /**
   * @param game the Game (holds _context with shared systems/refs)
   */
  update(game, dt, wave) {
    if (!this.active || this.dying) return;
    this._t += dt;
    this._updateDiveScale(dt);
    this._engineGlow();
    this._corePulse();
    this._hitPulse(dt);

    // GALAGA 2: while raised by the BeamSystem the craft hovers at its
    // charge spot and does NOT fire — the beam is the weapon, not the
    // ship. The normal state machine resumes on endBeamPose().
    if (this._beamPose) {
      this._hoverBeamPose();
      return;
    }

    switch (this.state) {
      case 'ENTERING':
        this._advanceCurve(dt, 1 / DIVE.ENTER_TIME, () => { this.state = 'FORMATION'; });
        break;
      case 'FORMATION':
        this._bobInFormation();
        this._tryFire(game, dt, wave);
        break;
      case 'DIVING': {
        const speedMul = this.type === 'interceptor' ? 0.55 : this.type === 'heavy' ? 1.7 : 1;
        if (this.type === 'heavy' && this._volleyLeft > 0 && Math.random() < 0.04) {
          this._volleyLeft -= 1;
          this._fire(game, wave, 1);
        }
        this._advanceCurve(dt, (1 / (DIVE.TRAVEL_TIME * speedMul)), () => {
          this.state = 'REJOINING';
          this._buildReturnCurve(this.formationSlot);
        });
        break;
      }
      case 'REJOINING':
        this._advanceCurve(dt, 1 / DIVE.RETURN_TIME, () => { this.state = 'FORMATION'; });
        break;
      case 'APPROACHING':
        // GALAGA 2: same mechanics as a dive (arc-length curve, shrink,
        // volley-free) — just a different curve built around the player.
        // Finishes into the usual return flight to the formation slot.
        this._advanceCurve(dt, 1 / (DIVE.TRAVEL_TIME * 0.9), () => {
          this.state = 'REJOINING';
          this._buildReturnCurve(this.formationSlot);
        });
        break;
      default:
        break;
    }
  }

  _advanceCurve(dt, speed, onDone) {
    if (!this._curve) return;
    this._curveT = Math.min(1, this._curveT + speed * dt);
    this._curve.getPointAt(this._curveT, _pos);
    this.group.position.copy(_pos);
    this._orientAlongTangent(this._curveT);
    if (this._curveT >= 1) onDone();
  }

  _orientAlongTangent(u) {
    if (!this._curve) return;
    this._curve.getTangentAt(THREE.MathUtils.clamp(u, 0.001, 0.999), _tgt);
    if (_tgt.lengthSq() < 1e-6) return;
    // Ship bow points -Z in model space; align -Z with travel direction.
    // lookAt orients +Z toward target, so aim at (pos - tangent).
    _tgt.copy(_pos).addScaledVector(_tgt, -1);
    _mLook.lookAt(_pos, _tgt, _up);
    this.group.quaternion.setFromRotationMatrix(_mLook);
  }

  _bobInFormation() {
    const slot = this.formationSlot;
    const bob = Math.sin(this._t * (Math.PI * 2 / ENEMY.FORMATION_WOBBLE) + this._bobPhase) * ENEMY.FORMATION_BOB;
    // GALAGA 2: formation slots now carry their own altitude (y 0..4) —
    // the bob rides ON TOP of it, not in place of it (pre-slots were all
    // y=0, so the old code dropped the slot y entirely).
    this.group.position.set(slot.x, slot.y + bob, slot.z);
    // face the front (toward player) with a gentle sway
    this.group.rotation.set(0, Math.sin(this._t * 0.9 + this._bobPhase) * 0.12, 0);
  }

  /**
   * GALAGA 2: exact future-position prediction for auto-aim. Evaluates the
   * SAME closed-form motion model that update() integrates, but at time
   * `this._t + t` instead of stepping it frame-by-frame. The formation bob
   * is an exact sine; curve states advance the arc-length parameter
   * analytically. Auto-aim aims at this predicted point so the shot meets
   * the ship, instead of extrapolating a short position buffer (which
   * mis-predicts a 6.25 Hz wobble and drifts with frame rate).
   */
  predictPositionAt(t, out) {
    if (this._beamPose) {
      const bp = this._beamPose;
      const bob = Math.sin((this._t + t) * 3 + this._bobPhase) * 0.4;
      out.set(bp.x, bp.y + bob, bp.z);
      return out;
    }
    const T = this._t + t;
    const slot = this.formationSlot;
    switch (this.state) {
      case 'FORMATION': {
        const bob = Math.sin(T * (Math.PI * 2 / ENEMY.FORMATION_WOBBLE) + this._bobPhase) * ENEMY.FORMATION_BOB;
        out.set(slot.x, slot.y + bob, slot.z);
        break;
      }
      case 'ENTERING':
      case 'DIVING':
      case 'REJOINING':
      case 'APPROACHING': {
        if (this._curve) {
          let speed;
          switch (this.state) {
            case 'ENTERING': speed = 1 / DIVE.ENTER_TIME; break;
            case 'DIVING': {
              const mul = this.type === 'interceptor' ? 0.55 : this.type === 'heavy' ? 1.7 : 1;
              speed = 1 / (DIVE.TRAVEL_TIME * mul);
              break;
            }
            case 'REJOINING': speed = 1 / DIVE.RETURN_TIME; break;
            case 'APPROACHING': speed = 1 / (DIVE.TRAVEL_TIME * 0.9); break;
          }
          const u = Math.min(1, this._curveT + speed * t);
          this._curve.getPointAt(u, out);
        } else {
          out.copy(this.group.position);
        }
        break;
      }
      default:
        out.copy(this.group.position);
    }
    return out;
  }

  /**
   * GALAGA 2: BeamSystem charge hover. The two fighters rise to flanks
   * of the beam column and hold — a small idle bob plus a hotter core
   * reads as "charging".
   */
  startBeamPose(x, z, side) {
    this._beamPose = { x: x + side * 2.6, y: 14.5, z };
    this.group.visible = true;
  }

  endBeamPose() {
    this._beamPose = null;
    // back to the formation loop (slot bob resumes next frame)
    this.state = 'FORMATION';
  }

  _hoverBeamPose() {
    const bp = this._beamPose;
    const bob = Math.sin(this._t * 3 + this._bobPhase) * 0.4;
    this.group.position.set(bp.x, bp.y + bob, bp.z);
    this.group.rotation.set(0, Math.sin(this._t * 0.9 + this._bobPhase) * 0.12, 0);
    // charge glow: the reactor flares while the beam is building
    if (this._core) this._core.material.emissiveIntensity = 2.2 + Math.sin(this._t * 22) * 1.2;
  }

  _tryFire(game, dt, wave) {
    // GALAGA 2: the scout fires homing missiles on its own cadence instead
    // of straight shots — that's its whole identity (a ranged missile
    // bug, not a bullet spitter).
    if (this.type === 'scout') {
      this._homingCooldown -= dt;
      if (this._homingCooldown <= 0) {
        this._fireHoming(game, wave);
        this._homingCooldown = HOMING.FIRE_INTERVAL + Math.random() * HOMING.FIRE_JITTER;
      }
      return;
    }
    if (this._fireCooldown > 0) {
      this._fireCooldown -= dt;
      return;
    }
    const chance = WAVE.FIRE_CHANCE + Math.max(0, wave - 1) * 0.025;
    if (Math.random() > chance) return;
    // density pass 2: 1.1 + rand*1.8 (avg 2.0s) -> 0.9 + rand*1.4 (avg 1.6s)
    this._fireCooldown = 0.9 + Math.random() * 1.4;
    // density pass 2: volley sizes up — heavy 3->4, interceptor 2->3,
    // fighter 1->2 (only from wave 3, so waves 1-2 stay the gentle intro)
    const volley =
      this.type === 'heavy' ? 4
      : this.type === 'interceptor' ? 3
      : (wave >= 3 ? 2 : 1);
    this._fire(game, wave, volley);
  }

  /**
   * GALAGA 2: launch a homing missile. It starts roughly aimed at the
   * player (so it reads as "launched at you") but the ProjectileSystem
   * then steers it with a turn-rate cap — the player outruns it with a
   * late bank. Only fires while the player is alive.
   */
  _fireHoming(game, wave) {
    const ctx = game._context;
    const player = ctx.player;
    if (!player || !player.alive) return;
    const pp = player.group.position;
    const ox = this.group.position.x;
    const oy = this.group.position.y;
    const oz = this.group.position.z;
    let dx = pp.x - ox, dy = pp.y - oy, dz = pp.z - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;
    // a little initial inaccuracy so the very first frames read as a
    // "just-launched, still settling" missile rather than a laser lock
    dx += (Math.random() - 0.5) * 0.25;
    dz += (Math.random() - 0.5) * 0.25;
    const speed = HOMING.SPEED + HOMING.WAVESPEED_BONUS * Math.max(0, wave - 1);
    ctx.spawnEnemyShot({
      origin: this.group.position,
      dir: _fireDir.set(dx, dy, dz).normalize(),
      speed,
      damage: this.damageFor(wave),
      scale: HOMING.SCALE,
      homing: true,
      homingSpeed: speed,
    });
  }

  _fire(game, wave, count) {
    const speed = ENEMY_PROJECTILE.BASE_SPEED + ENEMY_PROJECTILE.WAVESPEED_BONUS * Math.max(0, wave - 1);
    const ctx = game._context;
    // Aim at the player in 3D (x/y/z): formation shots come from y 0..~10
    // while the player sits at y≈1.1 — a horizontal aim makes those shots
    // fly PAST the craft, which read as "bullets vanishing nearby". With
    // the vertical component they actually arrive at player height.
    const pp = ctx.player?.group?.position;
    const alive = ctx.player?.alive;
    const ox = this.group.position.x;
    const oy = this.group.position.y;
    const oz = this.group.position.z;
    const dx0 = (alive ? pp.x : 0) - ox;
    const dy0 = (alive ? pp.y : -0.5) - oy;
    const dz0 = (alive ? pp.z : oz + 40) - oz;
    const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0) || 1;
    const bx = dx0 / len0, by = dy0 / len0, bz = dz0 / len0;
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 0.16;
      const c = Math.cos(spread), s = Math.sin(spread);
      // rotate the base aim around the Y axis for the volley fan
      _fireDir.set(bx * c + bz * s, by, -bx * s + bz * c).normalize();
      // B4: named-argument spawn — single canonical shape.
      ctx.spawnEnemyShot({
        origin: this.group.position,
        dir: _fireDir,
        speed,
        damage: this.damageFor(wave),
      });
    }
  }

  damageFor(wave) {
    return Math.round(ENEMY_PROJECTILE.DAMAGE * (DAMAGE_BY_TYPE[this.type] ?? 1) * (1 + Math.max(0, wave - 1) * 0.04));
  }

  /** Return true when this hit killed the enemy. */
  hit(damage) {
    if (this.dying) return true;
    this.hp -= damage;
    if (this.hp <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  /** Ease the hull (and hitbox) toward DIVE_SHRINK as a dive closes in on
   * the player; back to full size otherwise. The change is eased so nothing
   * visibly pops. */
  _updateDiveScale(dt) {
    let target = 1;
    if (this.state === 'DIVING' || this.state === 'APPROACHING') {
      // curveT 0 = formation release; closest pass beside the player is
      // around 0.75, so the shrink lands right before the close pass.
      // (Approach swipes have their own pass point near the end of the
      // 4-point curve — same shrink profile still reads correctly.)
      const near = THREE.MathUtils.smoothstep(this._curveT, 0.3, 0.7);
      target = 1 + (DIVE_SHRINK - 1) * near;
    }
    this._diveScale = THREE.MathUtils.damp(this._diveScale, target, 8, dt);
    // keep the hitbox honest: it must never outgrow the shrunk visual
    this.radius = this._baseRadius * this._diveScale;
  }

  /** Visual-only punch applied each frame while a recent hit decays. */
  _hitPulse(dt) {
    if (this._hitFlash <= 0) {
      this.group.scale.setScalar(this._diveScale);
      return;
    }
    this._hitFlash = Math.max(0, this._hitFlash - dt * 7); // ~0.14s punch
    const s = this._diveScale * (1 + this._hitFlash * 0.28);
    this.group.scale.setScalar(s);
  }

  _die() {
    this.dying = true;
  }

  _engineGlow() {
    for (const e of this._engines) {
      const p = 0.9 + Math.sin(this._t * 25 + this._bobPhase) * 0.22;
      const b = e.userData.baseScale || [0.16, 0.16, 0.26];
      e.scale.set(b[0] * p, b[1] * p, b[2] * (0.85 + Math.sin(this._t * 33 + this._bobPhase) * 0.25)); // flame flicker
      e.material.emissiveIntensity = 1.5 + Math.sin(this._t * 30 + this._bobPhase) * 0.5;
    }
  }

  /** Idle reactor breathing + elite halo spin (named meshes, lazily cached). */
  _corePulse() {
    const k = Math.sin(this._t * 5 + this._bobPhase);
    if (this._core) this._core.scale.setScalar(0.3 + k * 0.05 + this._hitFlash * 0.1);
    if (this._hitFlash > 0) this._core.material.emissiveIntensity = 2.0 + this._hitFlash * 2.4;
    if (this.type === 'elite') {
      if (!this._halo) {
        let h = null;
        this.group.traverse((o) => { if (o.name === 'halo') h = o; });
        this._halo = h;
      }
      if (this._halo) this._halo.rotation.z += 0.03;
    }
  }
}
