/**
 * StarFieldSystem.js
 * ---------------------------------------------------------------
 * A 3D starfield that moves toward the player, wrapping around
 * in Z to create an "infinite flight" feel for a fixed shooter.
 * Uses THREE.Points with a shared geometry for low draw cost.
 *
 * Parallax: closer stars (higher Z) get a higher speed multiplier,
 * so near stars streak fast past the camera and far stars drift.
 *
 * Motion trails: a second, cheap layer (ONE LineSegments draw call)
 * draws a short -Z streak behind every star head, fading to black at
 * the tail so additive blending reads it as a light trail. Trail
 * length = speed × TRAIL_TIME, so near/fast stars warp-streak and
 * far stars barely tail. Total cost: +1 draw call and one extra
 * float write per star per frame on the CPU — negligible.
 *
 * Radial center fade: star brightness follows a smooth curve of
 * screen-space distance from the viewport centre — the middle reads
 * as sparse/faint while the edges stay dense. Implemented as per-star
 * vertex colours on BOTH the points and trail heads, recomputed from
 * a screen-space projection only when the fade crosses a 1 % level,
 * so the colour buffers stay cheap to upload. Cost: one projection
 * per star per frame on the CPU; colour rewrites fire only when a
 * star actually crosses a fade level (rare).
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

// Trail length is "how many seconds of recent travel to show". With
// base flight speeds of 43.7..141.8 u/s (× SPEED_FEEL.BASE_STAR_INTENSITY
// at rest), the tails are long comet streaks (≈ 43–142 world units)
// that carry the sense of speed on their own.
const TRAIL_TIME = 0.9;

const BOUNDS = {
  X: 90,
  Y: 45,
  Z_MIN: -95,
  Z_MAX: 30,
};

// Radial centre fade. Radii are in NDC units (screen centre = 0,0;
// the screen edge is at r ≈ 0.56–1.15 depending on aspect). FADE_OUTER
// is where the curve reaches full density; FADE_INNER is the radius at
// which stars are COMPLETELY gone — the centre reads as a clean "hole"
// staring straight ahead, all the streaks live on the periphery so the
// frame screams forward flight. (GALAGA 2: centre stars removed on
// request.)
const FADE_INNER  = 0.12;
const FADE_OUTER  = 0.62;
const FADE_FLOOR  = 0.0;           // 0 % of base brightness at r < INNER

/** 1 = full density, FADE_FLOOR = sparsest (screen centre). */
function _radialFade(x, y) {
  const r = Math.sqrt(x * x + y * y);
  const k = THREE.MathUtils.smoothstep(r, FADE_INNER, FADE_OUTER);
  // clamp to [FLOOR, 1] — the S-curve already does this, but be safe
  const v = FADE_FLOOR + (1 - FADE_FLOOR) * k;
  return v > 1 ? 1 : (v < FADE_FLOOR ? FADE_FLOOR : v);
}

export class StarFieldSystem {
  constructor(scene, count = 1800) {
    this._count = count;
    this._positions = new Float32Array(count * 3);
    this._speeds    = new Float32Array(count);

    // ── seed positions + parallax speeds ────────────────────────────
    for (let i = 0; i < count; i++) {
      this._positions[i * 3]     = (Math.random() - 0.5) * BOUNDS.X * 2;
      this._positions[i * 3 + 1] = (Math.random() - 0.5) * BOUNDS.Y * 2;
      this._positions[i * 3 + 2] = BOUNDS.Z_MIN +
        Math.random() * (BOUNDS.Z_MAX - BOUNDS.Z_MIN);
      const z = this._positions[i * 3 + 2];
      const t = (z - BOUNDS.Z_MIN) / (BOUNDS.Z_MAX - BOUNDS.Z_MIN);
      // GALAGA 2: base flight speed (14..44 -> x2 -> x1.3) = 36..118 u/s
      // so the periphery streaks read as constant forward motion
      // (x1.2 speed-up = 43.7..141.8 u/s)
      this._speeds[i] = 43.68 + t * 131.04;
    }

    // ── per-star static data (set once) ─────────────────────────────
    this._baseBright = new Float32Array(count);
    this._lastFade   = new Float32Array(count);   // start at floor
    for (let i = 0; i < count; i++) {
      this._baseBright[i] = 0.7 + Math.random() * 0.8; // 0.7 – 1.5 (few stars -> each one must read)
      this._lastFade[i]   = FADE_FLOOR;
    }

    const baseCol = new THREE.Color(0xbfe6ff);
    this._bR = baseCol.r;
    this._bG = baseCol.g;
    this._bB = baseCol.b;

    // ── points layer ────────────────────────────────────────────────
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this._positions, 3).setUsage(
        THREE.DynamicDrawUsage));
    this._pointsCol = new Float32Array(count * 3);
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(this._pointsCol, 3).setUsage(
        THREE.DynamicDrawUsage));

    const mat = new THREE.PointsMaterial({
      size: 0.32,
      color: 0xffffff,          // vertex colours carry the real tint
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._points = new THREE.Points(geo, mat);
    this._points.frustumCulled = false;
    scene.add(this._points);
    this._geometry = geo;

    // ── motion trails ───────────────────────────────────────────────
    // LineSegments: vertex 0 = bright head, vertex 1 = black tail.
    // The line interpolates to black, and under additive blending black
    // adds nothing → a fading light streak. Positions rewrite every
    // frame; head colours track the radial fade, tail stays (0,0,0).
    this._trailPos = new Float32Array(count * 6);
    this._trailCol = new Float32Array(count * 6);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this._trailPos, 3).setUsage(
        THREE.DynamicDrawUsage));
    trailGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this._trailCol, 3).setUsage(
        THREE.DynamicDrawUsage));
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._trails = new THREE.LineSegments(trailGeo, trailMat);
    this._trails.frustumCulled = false;
    scene.add(this._trails);
    this._trailGeo = trailGeo;

    // scratch vector for NDC projection (reused, no per-frame alloc)
    this._v = new THREE.Vector3();

    // write initial (floor-fade) colours so the first frame is correct
    this._writeAllColours();
  }

  /** Recompute every star's points + trail-head colour from base × fade. */
  _writeAllColours() {
    const pc  = this._pointsCol;
    const tc  = this._trailCol;
    const bb  = this._baseBright;
    const lf  = this._lastFade;
    const bR  = this._bR, bG = this._bG, bB = this._bB;
    for (let i = 0; i < this._count; i++) {
      const m  = bb[i] * lf[i];
      const i3 = i * 3;
      const i6 = i * 6;
      pc[i3] = bR * m;  pc[i3 + 1] = bG * m;  pc[i3 + 2] = bB * m;
      tc[i6] = bR * m;  tc[i6 + 1] = bG * m;  tc[i6 + 2] = bB * m;
      // trail tail (i6+3..i6+5) stays (0,0,0)
    }
    this._geometry.attributes.color.needsUpdate = true;
    this._trailGeo.attributes.color.needsUpdate = true;
  }

  /**
   * @param dt seconds
   * @param intensity star SPEED multiplier (warp burst / menu slowdown)
   * @param camera for the radial centre fade
   * @param trailScale GALAGA 2: independent tail-length multiplier.
   *   Kept decoupled from intensity so the wave-clear warp can double
   *   the comet tails (2x) without scaling them a second time through
   *   the speed factor.
   */
  update(dt, intensity = 1, camera = null, trailScale = 1) {
    const P    = this._positions;
    const S    = this._speeds;
    const T    = this._trailPos;
    const pc   = this._pointsCol;
    const tc   = this._trailCol;
    const bb   = this._baseBright;
    const lf   = this._lastFade;
    const v    = this._v;
    const bR   = this._bR, bG = this._bG, bB = this._bB;

    const hasCam = !!camera &&
                   !!camera.matrixWorldInverse &&
                   !!camera.projectionMatrix;
    const inv  = hasCam ? camera.matrixWorldInverse : null;
    const proj = hasCam ? camera.projectionMatrix  : null;

    let colDirty = false;

    for (let i = 0; i < this._count; i++) {
      const i3 = i * 3;
      const i6 = i * 6;

      // ── advance + wrap ───────────────────────────────────────────
      P[i3 + 2] += S[i] * dt * intensity;
      if (P[i3 + 2] > BOUNDS.Z_MAX) {
        P[i3 + 2] = BOUNDS.Z_MIN;
        P[i3]     = (Math.random() - 0.5) * BOUNDS.X * 2;
        P[i3 + 1] = (Math.random() - 0.5) * BOUNDS.Y * 2;
        // re-seed the speed for the (far) respawn depth, matching the
        // constructor curve — keeps the warp consistent through wraps
        const t = (P[i3 + 2] - BOUNDS.Z_MIN) /
                  (BOUNDS.Z_MAX - BOUNDS.Z_MIN);
        S[i] = 43.68 + t * 131.04;
      }

      // ── radial centre fade ───────────────────────────────────────
      // Project the star to NDC (screen centre = 0,0).  The camera's
      // matrixWorldInverse is refreshed by the renderer each frame;
      // using it here keeps the fade accurate through shake, boss
      // zoom, and the mobile look-lift without any extra bookkeeping.
      let f = 1;
      if (hasCam) {
        v.set(P[i3], P[i3 + 1], P[i3 + 2]);
        v.applyMatrix4(inv);          // world → eye
        v.applyMatrix4(proj);         // eye   → NDC  (w divided)
        // v.x, v.y are now in -1..1; centre = (0,0)
        f = _radialFade(v.x, v.y);
      }

      // Quantise to 1 % so the colour buffers only rewrite when a star
      // actually crosses a fade level — keeps uploads tiny.
      const fq = Math.round(f * 100) * 0.01;
      if (fq !== lf[i]) {
        lf[i] = fq;
        const m  = bb[i] * fq;
        pc[i3] = bR * m;  pc[i3 + 1] = bG * m;  pc[i3 + 2] = bB * m;
        tc[i6] = bR * m;  tc[i6 + 1] = bG * m;  tc[i6 + 2] = bB * m;
        colDirty = true;
      }

      // ── trail segment ────────────────────────────────────────────
      // Streak = the last TRAIL_TIME seconds of travel: a -Z segment
      // behind the head. Longer for faster (nearer) stars on purpose.
      // trailScale (GALAGA 2) doubles the tails during the wave-clear
      // warp burst — decoupled from the speed multiplier on purpose.
      // `intensity` is included so the streak length matches the actual
      // per-frame displacement (S[i] * dt * intensity) at any speed —
      // without it, a 2x base speed would leave half-length trails that
      // read as disconnected dots rather than comet streaks.
      const L = S[i] * intensity * TRAIL_TIME * trailScale;
      T[i6]     = P[i3];     T[i6 + 1] = P[i3 + 1]; T[i6 + 2] = P[i3 + 2];
      T[i6 + 3] = P[i3];     T[i6 + 4] = P[i3 + 1]; T[i6 + 5] = P[i3 + 2] - L;
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._trailGeo.attributes.position.needsUpdate = true;
    if (colDirty) {
      this._geometry.attributes.color.needsUpdate = true;
      this._trailGeo.attributes.color.needsUpdate = true;
    }
  }

  /** Show/hide the whole starfield (points + trails). */
  setActive(v) {
    this._points.visible = v;
    this._trails.visible = v;
  }

  clear() {
    this.setActive(false);
  }
}
