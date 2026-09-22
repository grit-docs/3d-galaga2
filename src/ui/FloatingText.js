/**
 * FloatingText.js
 * ---------------------------------------------------------------
 * HTML/CSS DOM-based floating score popups. Much faster than a 3D
 * text mesh and keeps everything inside the existing HUD overlay
 * (no new WebGL resources). Pooled via a small rotating buffer.
 *
 * spawnAt(worldPoint, text, color)
 *   Project worldPoint onto screen, place a DOM node, then animate
 *   it upward + fade over ~0.9s before returning it to the pool.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

const MAX_LIVE = 24;
const LIFETIME = 0.9; // seconds

export class FloatingText {
  constructor(scene, camera, hostEl) {
    this._scene = scene;
    this._camera = camera;
    this._host = hostEl;
    this._active = [];
    this._v3 = new THREE.Vector3();


    for (let i = 0; i < MAX_LIVE; i++) {
      const el = document.createElement('div');
      el.className = 'score-float';
      el.style.display = 'none';
      this._host.appendChild(el);
      this._active.push({ el, life: 0, maxLife: LIFETIME, x: 0, y: 0 });
    }
  }

  /**
   * @param {THREE.Vector3} world world point to anchor at
   * @param {string} text
   * @param {string} color  CSS color
   * @param {boolean} credit larger "bonus" style (gold glow handled by CSS)
   */
  spawnAt(world, text, color = '#bfe9ff', credit = false) {
    // pick the oldest available slot or overwrite the oldest
    let slot = null;
    let minLife = Infinity;
    for (const s of this._active) {
      if (s.life < minLife) {
        minLife = s.life;
        slot = s;
      }
    }
    if (!slot) return;

    this._v3.copy(world);
    this._v3.project(this._camera);
    const x = (this._v3.x * 0.5 + 0.5) * this._host.clientWidth;
    const y = (-this._v3.y * 0.5 + 0.5) * this._host.clientHeight;

    slot.x = x;
    slot.y = y;
    slot.life = slot.maxLife;
    slot.el.classList.toggle('credit', !!credit);
    slot.el.style.display = 'block';
    slot.el.style.left = `${x}px`;
    slot.el.style.top = `${y}px`;
    if (!credit) {
      slot.el.style.color = color;
      slot.el.style.textShadow = `0 0 8px ${color}`;
    }
    slot.el.textContent = text;
    slot.el.style.opacity = '1';
    slot.el.style.transform = 'translate(-50%, -50%) scale(1)';
    slot.el.style.transition = `opacity ${LIFETIME}s ease-out, transform ${LIFETIME}s ease-out`;
    // force reflow then animate
    void slot.el.offsetWidth;
    slot.el.style.opacity = '0';
    slot.el.style.transform = 'translate(-50%, -140%) scale(0.9)';
  }

  update(dt) {
    for (const s of this._active) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) s.el.style.display = 'none';
    }
  }
}
