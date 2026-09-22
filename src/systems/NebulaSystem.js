/**
 * NebulaSystem.js
 * ---------------------------------------------------------------
 * A distant soft-glow nebula backdrop: a handful of large additive
 * sprite billboards tinted violet / deep blue / magenta, scattered
 * across the far side of the battlefield. Plus a dense band of tiny
 * pinpoint stars near the nebula core to echo the reference art.
 *
 * Everything is static except a very slow drift/rotation, so the
 * cost is fixed (a few sprites) no matter the screen size.
 *
 * The sprites are generated from a canvas radial gradient, so there
 * are still zero external assets.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

/** Build a soft round glow sprite from a canvas radial gradient. */
function makeGlowTexture(inner, outer) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.00, `rgba(${inner}, 0.9)`);
  g.addColorStop(0.35, `rgba(${inner}, 0.45)`);
  g.addColorStop(0.70, `rgba(${outer}, 0.14)`);
  g.addColorStop(1.00, `rgba(${outer}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** One nebula puff: position, scale, two-stop color, opacity. */
const PUFFS = [
  // main violet swirl, upper-right of the play field (kept very faint)
  { pos: [30, 10, -120], scale: 70, inner: '150,110,255', outer: '90,40,180', opacity: 0.20 },
  // deep blue body below the violet core
  { pos: [20, -6, -130], scale: 85, inner: '50,90,200', outer: '20,40,120', opacity: 0.18 },
  // magenta wisp threading through the middle
  { pos: [34, 2, -115], scale: 46, inner: '255,90,190', outer: '140,40,150', opacity: 0.13 },
  // small cyan spark near the core (bright star cluster area)
  { pos: [38, 6, -118], scale: 22, inner: '150,230,255', outer: '60,140,220', opacity: 0.16 },
  // distant violet halo far behind the battlefield
  { pos: [-10, 16, -160], scale: 95, inner: '110,70,210', outer: '50,30,120', opacity: 0.10 },
  // faint blue floor haze to ground the lower frame
  { pos: [-30, -18, -150], scale: 80, inner: '40,70,170', outer: '15,30,90', opacity: 0.08 },
];

// pin-star band that hugs the nebula core (dense white specks)
const PIN_STARS = 420;

export class NebulaSystem {
  constructor(scene) {
    this._group = new THREE.Group();
    this._textures = new Set();

    for (const p of PUFFS) {
      const tex = makeGlowTexture(p.inner, p.outer);
      this._textures.add(tex);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: p.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat.clone());
      sp.position.set(...p.pos);
      const base = p.scale;
      sp.scale.set(base, base * 0.82, 1); // slightly flattened ellipsoid
      sp.userData.warp = 0.92 + Math.random() * 0.16; // subtle per-puff breathing
      this._group.add(sp);
    }

    this._puffs = this._group.children;

    // dense pinpoint-stars cluster around the nebula core
    const pos = new Float32Array(PIN_STARS * 3);
    for (let i = 0; i < PIN_STARS; i++) {
      // gaussian-ish spread around the core (34, 4, -122)
      pos[i * 3] = 34 + (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = 4 + (Math.random() - 0.5) * 70;
      pos[i * 3 + 2] = -122 - Math.random() * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.5,
      color: 0xe8f4ff,
      transparent: true,
      opacity: 0.45,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._pins = new THREE.Points(geo, mat);
    this._pins.frustumCulled = false;
    this._group.add(this._pins);

    scene.add(this._group);
    this._t = 0;
  }

  update(dt) {
    this._t += dt;
    // slow breathing of each puff — cheap, no layout work
    for (const p of this._puffs) {
      const s = p.userData.baseScale ?? (p.userData.baseScale = p.scale.x);
      const breathe = 1 + Math.sin(this._t * 0.15 + p.userData.warp * 20) * 0.03 * p.userData.warp;
      p.scale.set(s * breathe, s * 0.82 * breathe, 1);
    }
    // whole nebula drifts gently to keep the background alive
    this._group.rotation.z = Math.sin(this._t * 0.02) * 0.015;
    this._pins.rotation.z = this._group.rotation.z * 1.6;
  }

  dispose(scene) {
    scene?.remove(this._group);
    for (const t of this._textures) t.dispose();
  }
}
