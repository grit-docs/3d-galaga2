/**
 * BeamSystem.js
 * ---------------------------------------------------------------
 * GALAGA 2: the formation's telegraphed vertical beam.
 *
 * From BEAM.WAVE_START, on a cooldown cadence, two live formation
 * craft rise to flanks of the PLAYER'S LANE and drop a solid laser
 * column through it (the column sits at the player's x/z — the
 * player flies on a fixed-z band, so a beam anywhere else could
 * never touch them):
 *
 *   CHARGING — a thin warning line at the lane pulses for
 *              BEAM.CHARGE_TIME (dodge the lane during this window)
 *   FIRING   — the column goes solid for BEAM.FIRE_TIME and chips
 *              shield on a damage tick while the player is inside it
 *
 * The column is a narrow vertical cylinder, so the dodge is
 * lateral movement — the same read as every other pattern. Shooters
 * are pooled enemies; if one dies mid-beam the other keeps firing,
 * if both die the beam is cancelled.
 *
 * BOMBA cancels an active beam (the flash-bang severs the laser).
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BEAM } from '../config.js';

// Beam column spans y TOP_Y .. BOTTOM_Y (covers the player band 0.5..4.5
// plus margin, and starts just below the shooters' charge altitude).
const TOP_Y = 17;
const BOTTOM_Y = -4;

export class BeamSystem {
  constructor(game, scene) {
    this._game = game;
    this._cooldown = BEAM.COOLDOWN * 0.5; // first beam comes early-ish
    this.active = false;
    this.phase = 'idle'; // idle | charging | firing
    this.t = 0;
    this.x = 0;
    this.z = 0;
    this.shooters = [];
    this._dmgT = 0;

    // visuals: one thin telegraph line + one solid column
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this._telegraphMat = new THREE.MeshBasicMaterial({
      color: BEAM.COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._beamMat = new THREE.MeshBasicMaterial({
      color: BEAM.COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._telegraph = new THREE.Mesh(geo, this._telegraphMat);
    this._telegraph.scale.set(0.08, TOP_Y - BOTTOM_Y, 0.08);
    this._beam = new THREE.Mesh(geo, this._beamMat);
    this._beam.scale.set(BEAM.WIDTH / 2, TOP_Y - BOTTOM_Y, BEAM.WIDTH / 2);
    const midY = (TOP_Y + BOTTOM_Y) / 2;
    this._telegraph.position.y = midY;
    this._beam.position.y = midY;
    this._telegraph.visible = false;
    this._beam.visible = false;

    this.group = new THREE.Group();
    this.group.add(this._telegraph, this._beam);
    scene.add(this.group);
  }

  reset() {
    this.active = false;
    this.phase = 'idle';
    this.t = 0;
    this.shooters.length = 0;
    this._dmgT = 0;
    this._cooldown = BEAM.COOLDOWN * 0.5;
    this._telegraph.visible = false;
    this._beam.visible = false;
    this._telegraphMat.opacity = 0;
    this._beamMat.opacity = 0;
  }

  /** BOMBA interaction: sever an in-progress beam. */
  cancel() {
    if (!this.active) return;
    for (const s of this.shooters) {
      if (s.active && !s.dying) s.endBeamPose();
    }
    this.shooters.length = 0;
    this.active = false;
    this.phase = 'idle';
    this._telegraph.visible = false;
    this._beam.visible = false;
    this._telegraphMat.opacity = 0;
    this._beamMat.opacity = 0;
  }

  update(dt, wave) {
    if (this.active) {
      this._progress(dt);
    } else {
      // not firing: tick the cooldown (shorter wait below WAVE_START so
      // the first beam arrives on time when wave 3 begins)
      this._cooldown -= dt;
      if (wave < BEAM.WAVE_START || this._cooldown > 0) {
        this._fadeIdle();
        return;
      }
      const shooters = this._pickShooters();
      if (!shooters) {
        this._cooldown = 1.2; // retry sooner once more fighters exist
        this._fadeIdle();
        return;
      }
      // The column drops through the PLAYER'S LANE: the player flies
      // on a fixed-z band, so a beam at formation depth could never
      // hit them. Target the player's current x/z — the CHARGE_TIME
      // telegraph is the dodge window (player lateral speed outruns
      // the column's width comfortably).
      const player = this._game._context.player;
      if (!player || !player.alive) {
        this._cooldown = 1.0;
        this._fadeIdle();
        return;
      }
      const pp = player.group.position;
      this.x = pp.x;
      this.z = pp.z;
      this.shooters = shooters;
      shooters[0].startBeamPose(this.x, this.z, -1);
      shooters[1].startBeamPose(this.x, this.z, +1);
      this.active = true;
      this.phase = 'charging';
      this.t = 0;
      this._dmgT = 0;
      this._telegraph.visible = true;
      this._telegraph.position.set(this.x, this._telegraph.position.y, this.z);
      this._beam.position.set(this.x, this._beam.position.y, this.z);
      this._game.audio?.play?.('beamCharge');
    }
  }

  _progress(dt) {
    this.t += dt;

    // drop dead shooters; if the whole pair is gone, cancel
    for (let i = this.shooters.length - 1; i >= 0; i--) {
      const s = this.shooters[i];
      if (!s.active || s.dying) this.shooters.splice(i, 1);
    }
    if (this.shooters.length === 0) {
      this.cancel();
      return;
    }

    if (this.phase === 'charging') {
      if (this.t >= BEAM.CHARGE_TIME) {
        this.phase = 'firing';
        this.t = 0;
        this._dmgT = 0;
        this._beam.visible = true;
        this._game.audio?.play?.('beamFire');
      }
    } else if (this.phase === 'firing') {
      // damage tick while the player sits inside the column
      this._dmgT += dt;
      if (this._dmgT >= 0.4) {
        this._dmgT = 0;
        const player = this._game._context.player;
        if (player && player.alive) {
          const p = player.group.position;
          const dx = p.x - this.x;
          const dz = p.z - this.z;
          const r = BEAM.WIDTH / 2 + 0.6; // + player hitbox margin
          if (dx * dx + dz * dz < r * r && p.y < TOP_Y) {
            player.takeDamage(BEAM.DAMAGE);
            this._game.audio?.play?.('playerHit');
            this._game.hud?.flashDamage?.('hit');
            this._game._cameraFx?.addShake?.(0.25);
          }
        }
      }
      if (this.t >= BEAM.FIRE_TIME) {
        for (const s of this.shooters) s.endBeamPose();
        this.shooters.length = 0;
        this.active = false;
        this.phase = 'idle';
        this._cooldown = BEAM.COOLDOWN;
        this._fadeIdle();
      }
    }

    // visuals: position + opacity per phase
    const midY = (TOP_Y + BOTTOM_Y) / 2;
    this._telegraph.position.set(this.x, midY, this.z);
    this._beam.position.set(this.x, midY, this.z);
    if (this.phase === 'charging') {
      const u = this.t / BEAM.CHARGE_TIME;
      // the warning line brightens as the beam is about to drop
      this._telegraphMat.opacity = 0.25 + 0.55 * u + Math.sin(this.t * 40) * 0.08;
      this._beamMat.opacity = 0;
    } else if (this.phase === 'firing') {
      this._telegraphMat.opacity = 0.5;
      this._beamMat.opacity = 0.7 + Math.sin(this.t * 55) * 0.2;
      this._telegraph.scale.set(0.08 + u01(this.t), TOP_Y - BOTTOM_Y, 0.08 + u01(this.t));
    }
  }

  _fadeIdle() {
    if (this._telegraph.visible || this._beam.visible) {
      this._telegraph.visible = false;
      this._beam.visible = false;
      this._telegraphMat.opacity = 0;
      this._beamMat.opacity = 0;
      this._telegraph.scale.set(0.08, TOP_Y - BOTTOM_Y, 0.08);
    }
  }

  /**
   * Pick two live FORMATION enemies to raise the beam. Prefer fighters
   * (spec: the fighters charge the beam); fall back to other light
   * craft. The pair is the closest together so the column lands between
   * them (and not at the edge of the formation).
   */
  _pickShooters() {
    const enemies = this._game._context.enemyList;
    const pool = [];
    for (const e of enemies) {
      if (!e.active || e.dying || e.state !== 'FORMATION') continue;
      if (e.type === 'scout') continue; // scouts hold their missile stance
      pool.push(e);
    }
    if (pool.length < 2) return null;
    // prefer fighters: if two or more exist, beam with fighters only
    const fighters = pool.filter((e) => e.type === 'fighter');
    const candidates = fighters.length >= 2 ? fighters : pool;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i].position;
        const b = candidates[j].position;
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = [candidates[i], candidates[j]]; }
      }
    }
    return best;
  }
}

// small helper: 0..1 pulse used to fatten the telegraph on fire
function u01(t) {
  return (Math.sin(t * 30) * 0.5 + 0.5) * 0.05;
}
