/**
 * CameraEffects.js
 * ---------------------------------------------------------------
 * A small camera FX layer that runs once per frame and nudges the
 * camera between:
 *
 *   - a fixed base pose (set by Renderer.js),
 *   - a subtle player-follow offset (lateral only),
 *   - a decaying random shake (from explosions / hits).
 *
 * All effects are intentionally subtle; the goal is to add punch
 * without hurting play ability.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOUNDS, CAMERA, SPEED_FEEL } from '../config.js';

// GALAGA 2 forward view: camera roll while steering hard, capped so it
// reads as a subtle "g-banking" feel without any nausea.
const CAMERA_ROLL_TILT = 0.055; // rad ≈ 3.2° at full lateral speed

export class CameraEffects {
  constructor(renderer, camera) {
    this._renderer = renderer;
    this._camera = camera;
    this.shake = 0;
    this.shakeDecay = CAMERA.SHAKE_DECAY;
    this.shakeAmp = 0;
    // accessibility: 0 = reduced-motion (no camera shake at all),
    // 1 = full. Set from the game settings / prefers-reduced-motion.
    this.shakeScale = 1;
    this._v = new THREE.Vector3();
    // scratch for the Y-shifted look target (cameraBase().look is a
    // shared vec, so it is copied before mutating)
    this._lookTmp = new THREE.Vector3();
    this._t = 0;
  }

  /** Trigger a shake (0..1 intensity). */
  addShake(intensity) {
    this.shake = Math.max(this.shake, intensity * this.shakeScale);
    this.shakeAmp = (0.15 + intensity * 0.9) * this.shakeScale;
  }

  /** Reset the damped vertical follow (call when the player respawns /
   *  a new game starts so the camera snaps back to base framing). */
  resetFollow() {
    this._playerY = BOUNDS.PLAYER_Y;
    this._roll = 0;
    this._fov = CAMERA.FOV;
    if (this._camera) this._camera.up.set(0, 1, 0);
  }

  /**
   * @param dt seconds
   * @param playerX lateral follow input
   * @param playerY GALAGA 2: player altitude — the camera follows it
   *   vertically (damped) so the craft stays mid-frame while flying up
   *   and down. Defaults to the resting altitude for menu frames.
   * @param playerVX GALAGA 2 forward view: lateral SPEED — drives a
   *   subtle camera roll in the same direction as the ship's bank.
   * @param dashing GALAGA 2: brief FOV kick while dashing.
   * @param speed GALAGA 2 sense of speed: normalized craft speed 0..1
   *   (dash = 1, passed from Game.update). Drives a continuous dynamic
   *   FOV widen (the core "modern arcade" speed cue) plus a tiny
   *   sustained high-speed jitter — velocity feedback, distinct from
   *   the one-shot hit/explosion shake in `shake`.
   */
  update(dt, playerX, playerY = BOUNDS.PLAYER_Y, playerVX = 0, dashing = false, speed = 0) {
    this._t += dt;
    if (this.shake > 0) {
      this.shake -= this.shakeDecay * dt;
      if (this.shake < 0) this.shake = 0;
    }

    // damped Y follow: ease the tracked altitude toward the player's
    // current Y. The base camera framing (pos/look, incl. the mobile
    // look-lift) is unchanged — this only shifts the whole view with
    // the craft, so desktop and mobile framing stay intact.
    // GALAGA 2: reduced from 0.85 -> 0.45 so climbing/diving moves the
    // ship across a real band of the frame (the high ratio cancelled
    // ~90% of the vertical travel).
    this._playerY = THREE.MathUtils.damp(this._playerY ?? BOUNDS.PLAYER_Y, playerY, 6, dt);
    const yOff = (this._playerY - BOUNDS.PLAYER_Y) * 0.45;

    const base = this._renderer.cameraBase();
    // lateral follow of the player
    const follow = playerX * CAMERA.PLAYER_FOLLOW;
    this._v.set(
      base.pos.x + follow,
      base.pos.y + yOff,
      base.pos.z
    );
    // shake offset (random but bounded)
    const amp = this.shakeAmp * this.shake;
    if (amp > 0.0001) {
      this._v.x += (Math.random() - 0.5) * amp * 0.3;
      this._v.y += (Math.random() - 0.5) * amp * 0.3;
      this._v.z += (Math.random() - 0.5) * amp * 0.2;
    }
    // GALAGA 2 sense of speed: continuous high-speed jitter — a faint
    // sustained tremor that scales with craft speed (0 at rest). The
    // amplitude is deliberately ~1/3 of the weakest hit shake so it
    // reads as "the hull is working hard", never as noise.
    const jAmp = speed * SPEED_FEEL.SHAKE_SPEED * this.shakeScale;
    if (jAmp > 0.0001) {
      this._v.x += (Math.random() - 0.5) * jAmp * 0.3;
      this._v.y += (Math.random() - 0.5) * jAmp * 0.3;
      this._v.z += (Math.random() - 0.5) * jAmp * 0.2;
    }
    this._camera.position.lerp(this._v, 0.35);

    // GALAGA 2: camera roll — eases toward a small tilt proportional to
    // lateral speed, in the same direction as the ship's bank (a right
    // roll drops the right side of the frame). Eases back to level on
    // release.
    const rollTarget = THREE.MathUtils.clamp(playerVX / 34, -1, 1) * CAMERA_ROLL_TILT;
    this._roll = THREE.MathUtils.damp(this._roll ?? 0, rollTarget, 6, dt);
    this._camera.up.set(-Math.sin(this._roll), Math.cos(this._roll), 0);

    // look target rides along with the Y follow so the whole scene
    // (enemies, boss) shifts with the player instead of leaving it
    // behind when the craft climbs.
    this._lookTmp.copy(base.look);
    this._lookTmp.y += yOff;
    this._camera.lookAt(this._lookTmp);

    // GALAGA 2: FOV — dynamic with speed. The dash kick is the
    // high-stakes spike; the speed term is the continuous modern-arcade
    // cue: the wider you fly, the more the periphery stretches, so
    // full-speed flight reads as ~70° FOV. Both smooth via the same
    // damp so they never fight.
    const fovTarget = CAMERA.FOV + (dashing ? CAMERA.FOV_DASH_BOOST : 0) +
      speed * SPEED_FEEL.FOV_SPEED_BOOST;
    const fov = THREE.MathUtils.damp(this._fov ?? CAMERA.FOV, fovTarget, 8, dt);
    if (Math.abs(fov - this._camera.fov) > 0.01) {
      this._camera.fov = fov;
      this._camera.updateProjectionMatrix();
    }
  }
}
