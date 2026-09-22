/**
 * ExplosionEffect.js
 * ---------------------------------------------------------------
 * Wraps a burst of particles + a brief flash. The ParticleSystem
 * is already pooled, so every call here is just parameter setup.
 *
 * Two presets:
 *   small    - used for regular enemy kills
 *   big      - used for player death + boss dies
 *
 * Each preset also drives a one-shot point-light flash at the
 * explosion centre (for a few frames) for extra punch.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { COLORS } from '../config.js';

const FLASH_DURATION = 0.15; // seconds
const FLASH_STRENGTH = 6;    // light intensity

export class ExplosionEffect {
  constructor(scene, particleSystem) {
    this._scene = scene;
    this._particles = particleSystem;

    // one shared point light, re-used every frame — no allocation
    this._flash = new THREE.PointLight(0xffe8c8, 0, 26, 2);
    this._flash.visible = false;
    scene.add(this._flash);
    this._flashTimer = 0;


  }

  _emitBurst(pos, colorHex, speed, count, spread, life, gravity) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (Math.random() - 0.5) * spread;
      const v = (Math.random() - 0.5) * spread;
      this._particles.spawn(pos, {
        color: colorHex,
        vx: Math.cos(a) * speed * (0.6 + Math.random() * 0.8) + r,
        vy: -Math.abs(Math.sin(Math.random() * Math.PI)) * speed * 0.7 + v,
        vz: Math.sin(a) * speed * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * spread,
        life: life * (0.7 + Math.random() * 0.6),
        drag: 1.6,
        gravity: gravity,
      });
    }
  }

  /**
   * @param {THREE.Vector3} pos
   * @param {THREE.Color|number} color
   * @param {number} scale - juice multiplier (>=1): grows the burst
   *   count + speed + flash so high-combo kills feel bigger.
   */
  small(pos, color = COLORS.ENEMIES.fighter.core, scale = 1) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 0.7 * scale;
    this._emitBurst(pos, color, 14 * Math.sqrt(scale), 24 + Math.round(12 * (scale - 1)), 7, 0.55, 4);
  }

  medium(pos, color = COLORS.ENEMIES.elite.core, scale = 1) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 1.3 * scale;
    // two-tone burst: enemy core color + hot white core
    this._emitBurst(pos, color, 17 * Math.sqrt(scale), Math.round(40 * scale), 9, 0.75, 3);
    this._emitBurst(pos, 0xffffff, 24, Math.round(16 * scale), 5, 0.45, 1.5);
  }

  big(pos, color = 0xffc94d, scale = 1) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 2 * scale;
    // double burst for impact
    this._emitBurst(pos, color, 18 * Math.sqrt(scale), Math.round(60 * scale), 12, 0.9, 2);
    this._emitBurst(pos, 0xffffff, 26, Math.round(30 * scale), 6, 0.5, 1);
  }

  /**
   * Player hit — deliberately BRIGHT and warm-tinted. The burst sits on
   * top of the cool blue player hull + nebula, so white-hot + red/orange
   * sparks give maximum contrast and make every hit unmistakable.
   */
  playerHit(pos) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 3;
    // hot white core — the first thing you see the instant of impact
    this._emitBurst(pos, 0xffffff, 30, 18, 6, 0.35, 0.5);
    // warm red/orange flying sparks (contrasts the blue scene)
    this._emitBurst(pos, 0xff5d3d, 20, 34, 9, 0.75, 2.5);
    // cooler cyan debris as the outer shockwave
    this._emitBurst(pos, 0x3dc9ff, 16, 26, 10, 0.9, 2.0);
  }

  /** Ship totally destroyed (life lost) — big fiery debris explosion. */
  playerDestroyed(pos) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 2.2;
    // fire/orange hull chunks flying out — reads as the ship tearing apart
    this._emitBurst(pos, 0xff7a2a, 22, 46, 11, 1.0, 2.6);
    // cyan energy from the engine/core
    this._emitBurst(pos, 0x33d6ff, 18, 30, 8, 0.75, 2.0);
    // white-hot sparks for the impact flash
    this._emitBurst(pos, 0xffffff, 30, 24, 6, 0.5, 1.2);
  }

  update(dt) {
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      this._flash.intensity *= (1 - dt * 10);
      if (this._flashTimer <= 0) {
        this._flash.visible = false;
        this._flash.intensity = 0;
      }
    }
  }
}
