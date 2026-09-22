/**
 * PowerUp.js
 * ---------------------------------------------------------------
 * Spinning pickup dropped by destroyed enemies.
 * Types (see POWERUP.TYPES in config.js):
 *   WEAPON  - weapon level up (permanent)
 *   Rapid   - rapid-fire level (permanent, stacks to a cap)
 *   SHIELD  - restore shield
 *   BOMBA   - +1 BOMBA stock (capped)
 * Pooled; `kill()` hands the object back to the ProjectileSystem pool.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

const ICON_COLORS = {
  WEAPON: 0x5cf2ff,
  Rapid: 0xffd23d,
  SHIELD: 0x3d8bff,
  BOMBA: 0xff8a3c,
};

export class PowerUp {
  constructor(scene, onRelease) {
    this._release = onRelease;
    this.group = new THREE.Group();

    // glowing diamond core + rotating outer ring
    this.core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45, 0),
      new THREE.MeshStandardMaterial({
        color: 0x001420,
        emissive: 0x5cf2ff,
        emissiveIntensity: 2.4,
        roughness: 0.3,
        flatShading: true,
      })
    );
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.07, 6, 20),
      new THREE.MeshStandardMaterial({
        color: 0x000a12,
        emissive: 0x9fe8ff,
        emissiveIntensity: 1.8,
      })
    );
    this.group.add(this.core, this.ring);
    this.group.visible = false;
    scene.add(this.group);

    this.active = false;
    this.type = 'WEAPON';
    this.fallSpeed = 7.5;
    // GALAGA 2: magnet velocity (auto-absorb) — driven by the
    // CollisionSystem while inside POWERUP.MAGNET_RADIUS
    this.magnetVX = 0;
    this.magnetVY = 0;
    this.magnetVZ = 0;
    this._t = 0;
  }

  onRecycle() {
    this.active = false;
    this.group.visible = false;
    this.magnetVX = this.magnetVY = this.magnetVZ = 0;
  }

  spawn(x, z, type, fallSpeed) {
    this.active = true;
    this.type = type;
    this.group.visible = true;
    this.group.position.set(x, 0.4, z);
    this.fallSpeed = fallSpeed;
    this.magnetVX = 0;
    this.magnetVY = 0;
    this.magnetVZ = 0;
    const color = ICON_COLORS[type] ?? 0x5cf2ff;
    this.core.material.emissive.setHex(color);
    this.ring.material.emissive.setHex(color);
    this._t = 0;
  }

  update(dt) {
    if (!this.active) return;
    this._t += dt;
    this.group.position.z += this.fallSpeed * dt;
    this.group.position.x += Math.sin(this._t * 2.4) * dt * 0.9;
    // GALAGA 2: magnet — integrate the velocity the CollisionSystem
    // sets while the craft is inside MAGNET_RADIUS (suction, not
    // teleport), then decay it back to a gentle drift
    if (this.magnetVX || this.magnetVY || this.magnetVZ) {
      this.group.position.x += this.magnetVX * dt;
      this.group.position.y += this.magnetVY * dt;
      this.group.position.z += this.magnetVZ * dt;
      const decay = Math.max(0, 1 - 2.5 * dt);
      this.magnetVX *= decay;
      this.magnetVY *= decay;
      this.magnetVZ *= decay;
    }
    this.core.rotation.y += dt * 3.2;
    this.ring.rotation.x += dt * 2.0;
    this.ring.rotation.z += dt * 1.2;
    // `kill()` (not `deactivate()`) so the item is returned to the
    // pool and removed from the active set. A plain deactivate left
    // it active forever, leaking one entry per fallen power-up.
    if (this.group.position.z > 34) this.kill();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
  }

  kill() {
    this.deactivate();
    this.onRecycle();
    this._release(this);
  }
}
