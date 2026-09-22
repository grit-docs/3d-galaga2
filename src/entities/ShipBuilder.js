/**
 * ShipBuilder.js
 * ---------------------------------------------------------------
 * Shared low-poly sci-fi ship construction from three.js primitives.
 * Builds every hull with a small set of reusable, shareable base
 * geometries so the scene stays cheap even with many ships.
 * Ship orientation convention:
 *   +Z = toward the player (camera side), -Z = "forward" flight.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

/** Shared unit geometries (created once, reused across all ships). */
const GEO = {
  hull: new THREE.ConeGeometry(1, 1, 5),
  wing: new THREE.BoxGeometry(1, 1, 1),
  fin: new THREE.ConeGeometry(1, 1, 4),
  core: new THREE.IcosahedronGeometry(1, 0),
  engine: new THREE.CylinderGeometry(1, 1, 1, 8),
  canopy: new THREE.SphereGeometry(1, 8, 6),
  gun: new THREE.BoxGeometry(1, 1, 1),
  ring: new THREE.TorusGeometry(1, 1, 6, 24),
};

/** Thin emissive quad — the "neon strip" detailing language. */
function strip(parent, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 0.03, 0.08]) {
  return add(parent, GEO.gun, mat, pos, rot, scale);
}

export function stdMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.55,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: true,
  });
}

export function glowMat(color, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: 0,
    flatShading: true,
  });
}

/** Adds a mesh and returns it for further tweaking. */
function add(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.scale.set(...scale);
  parent.add(m);
  return m;
}

/**
 * Low-poly swept delta wing — a real trapezoid silhouette (wide root,
 * tapered tip, leading edge swept back), built as a thin extruded
 * prism. Lives in XZ (x = outboard, z = aft) and returns +Y up.
 * Pass `mirror: true` for the port side. (unit space: caller scales)
 */
function makeDeltaWing(mirror = false) {
  const s = new THREE.Shape();
  const P = [[0, 0], [0.5, 1.05], [1.85, 1.85], [1.75, 2.65], [0.55, 1.75]];
  s.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) s.lineTo(P[i][0], P[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.12, bevelEnabled: false, curveSegments: 1,
  });
  // rotateX(+PI/2) maps the shape's y (0..span-aft) onto +Z (aft) so the
  // wing sweeps BACK toward the engine bay — NOT +PI/2 with a leading edge
  // that reaches PAST the nose (+forward). (The earlier -PI/2 flipped the
  // sweep to +forward, poking a big wing past the front of the craft.)
  g.rotateX(Math.PI / 2);            // XZ plane, +Y up, tip swept aft (+Z)
  g.translate(0, 0.06, 0);           // center the thickness on y=0
  if (mirror) g.scale(-1, 1, 1);
  return g;
}

/**
 * Low-poly canopy prism — a wedge/cab shape in XZ (z = aft), taller at
 * the front and tapering toward a low flat deck at the back, with a
 * flat top face the cockpit core sits in. (unit space: caller scales)
 */
function makeCanopyPrism(w = 1, frontH = 0.55, backH = 0.1, depth = 1) {
  const hw = w / 2;
  const pos = [
    -hw, 0, 0,    hw, 0, 0,      // front base L/R
    -hw, 0, depth, hw, 0, depth, // back  base L/R
    -hw, frontH, 0,   hw, frontH, 0,   // front top  L/R
    -hw, backH, depth, hw, backH, depth, // back top   L/R
  ];
  const idx = [
    0, 1, 4,  1, 5, 4,   // front face
    2, 6, 7,  7, 6, 3,   // back   face
    0, 4, 6,  0, 6, 2,   // left
    1, 5, 7,  1, 7, 3,   // right
    4, 5, 7,  4, 7, 6,   // top deck
    0, 2, 3,  0, 3, 1,   // bottom
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The player craft — silhouette-first redesign.
 * ~80% big readable shapes, ~20% detail. Read from a distance by three
 * clear blocks: ① long sharp nose + slim spine w/ wedge cockpit,
 * ② two real swept delta wings (custom low-poly trapezoid: wide root ->
 * tapered tip, leading edge swept back), ③ heavy triple-engine rear.
 * Neon is restrained: cyan on wing leading edges / spine / cockpit core /
 * engines only; orange on ~3 points (nose tip + one wingtip per side).
 * Proportions (unit space, before Player.js scale 0.63): length ≈ 4.5
 * (z -2.35 -> +2.1), wingspan ≈ 4.4 (tip x ±2.2), fuselage width ≈ 0.9.
 * +Z = toward the player, -Z = forward.
 * IMPORTANT: exactly the three flame cores are named 'engine'; Player.js
 * finds them via group.traverse and animates scale/emissive each frame.
 */
export function buildPlayerShip() {
  const g = new THREE.Group();

  // --- palette: readable primary, gun-metal secondary, cyan energy, sparse ---
  // Base colors brightened + self-emission bumped so the ship reads clearly
  // against the dark space background (was a very dark navy that lost detail).
  const hull = stdMat(0x33598c, { roughness: 0.45, metalness: 0.55, emissive: 0x16305a, emissiveIntensity: 0.55 });
  const hullLight = stdMat(0x5a8cc4, { roughness: 0.4, metalness: 0.5, emissive: 0x2c548a, emissiveIntensity: 0.7 });
  const dark = stdMat(0x08101e, { roughness: 0.65, metalness: 0.5 });
  const gunMetal = stdMat(0x33475e, { roughness: 0.45, metalness: 0.7 });
  const trim = glowMat(0x35e6ff, 2.8);   // cyan energy (few places only)
  const accent = glowMat(0xff8c2a, 2.4); // orange, ~3 points total
  const flame = glowMat(0x8ff8ff, 3.6);
  const glass = stdMat(0x0c2c46, { roughness: 0.15, metalness: 0.3, emissive: 0x0e3a5c, emissiveIntensity: 0.5 });
  const core = glowMat(0x35e6ff, 3.2);   // the cockpit's inner core
  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0x9ff5ff, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const plumeCore = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // =============== ①  NOSE + FUSELAGE (one continuous mass) =====
  // broad wedge nose — wider base (r 0.62), shorter than a needle so the
  // front reads as a clear arrowhead: "this way is forward"
  add(g, GEO.hull, hull, [0, 0, -0.95], [-Math.PI / 2, 0, 0], [0.62, 2.5, 0.85]);
  // orange nose-tip — the single bright forward point
  add(g, GEO.core, accent, [0, 0, -2.2], [0, 0, 0], [0.1, 0.1, 0.1]);
  // central fuselage pod — ~1.5x wider than before, spanning nose -> engine
  // bay (z -1.3 ~ +1.7) as one continuous block so nothing reads as
  // disconnected segments.
  add(g, GEO.wing, hull, [0, 0, 0.2], [0, 0, 0], [1.48, 0.92, 3.0]);
  // raised dorsal spine — sits on the pod, ties nose to cockpit as a flow
  add(g, GEO.hull, hullLight, [0, 0.45, -0.5], [-Math.PI / 2, 0, 0], [0.42, 1.8, 0.5]);
  // spine light — cyan strip reduced to ~55% length (only the back half)
  add(g, GEO.gun, trim, [0, 0.68, 0.6], [0, 0, 0], [0.04, 0.035, 1.1]);

  // =========================== cockpit ==========================
  // wedge canopy ~25% larger than before; dark frame, only the inner core
  // glows (not the whole glass) -> a fighter cockpit, not a glowing eye
  add(g, makeCanopyPrism(1.0, 0.65, 0.15, 1.8), dark, [0, 0.42, -0.95], [0, 0, 0], [1, 1, 1]);
  add(g, GEO.wing, glass, [0, 1.0, -0.8], [0, 0, 0], [0.7, 0.08, 1.2]);   // glass strip
  add(g, GEO.core, core, [0, 1.12, -1.3], [0, 0, 0], [0.2, 0.13, 0.2]);   // glowing core

  // ============  ②  MAIN WINGS (swept delta, low-poly) =========
  // wing root sits INSIDE the fuselage (x offset 0.28 < half-pod 0.74)
  // so the wing appears to grow out of the body, not float beside it.
  // Moved forward by 0.15 in z so the CG doesn't bunch the rear.
  for (const side of [-1, 1]) {
    add(g, makeDeltaWing(side < 0), hull, [side * 0.28, 0.0, -0.35], [0, 0, 0], [1.15, 1, 1.15]);
    add(g, makeDeltaWing(side < 0), hullLight, [side * 0.26, 0.16, -0.3], [0, 0, 0], [0.95, 1, 0.95]);
    // wingtip: orange strobe + one simple gun-metal cannon (no fin)
    add(g, GEO.core, accent, [side * 2.1, 0.18, 1.1], [0, 0, 0], [0.08, 0.08, 0.08]);
    add(g, GEO.gun, gunMetal, [side * 1.95, -0.02, -0.1], [0, 0, 0], [0.08, 0.1, 0.85]);
  }

  // ===============  ③  ENGINE BAY (integrated rear) =============
  // cowl sits INSIDE the pod's rear end (pod ends at z=1.7; cowl at 1.15)
  // so the engines appear embedded in the fuselage, not hanging behind it.
  // Nozzles moved ~0.15 inward + 0.15 forward. Plume length ~65%.
  add(g, GEO.wing, dark, [0, 0, 1.15], [0, 0, 0], [1.3, 0.78, 0.55]);
  add(g, GEO.wing, gunMetal, [0, 0, 1.4], [0, 0, 0], [1.05, 0.55, 0.16]);
  const engineLight = new THREE.PointLight(0x66f0ff, 5, 7, 2);
  engineLight.position.set(0, 0, 1.5);
  g.add(engineLight);

  //  O   O  /  O  — moved inward (x ±0.4) and forward (z 1.35)
  for (const [ex, ey] of [[-0.4, 0.08], [0.4, 0.08], [0, -0.15]]) {
    add(g, GEO.engine, gunMetal, [ex, ey, 1.35], [Math.PI / 2, 0, 0], [0.36, 0.36, 0.58]);
    add(g, GEO.engine, dark, [ex, ey, 1.63], [Math.PI / 2, 0, 0], [0.3, 0.3, 0.16]);
    // flame core — the ONLY three meshes named 'engine'
    const nozzle = add(g, GEO.core, flame, [ex, ey, 1.82], [0, 0, 0], [0.24, 0.24, 0.4]);
    nozzle.name = 'engine';
  }

  // plume trails — length reduced to ~65% so they don't read as legs.
  // The outer cone is named 'plume'; Player.js stretches it with speed
  // (GALAGA 2 forward view: a longer engine trail sells the sense of
  // high-speed forward flight).
  for (const [ex, ey] of [[-0.4, 0.08], [0.4, 0.08], [0, -0.15]]) {
    const plume = add(g, GEO.hull, plumeMat, [ex, ey, 2.15], [-Math.PI / 2, 0, 0], [0.14, 0.46, 0.14]);
    plume.name = 'plume';
    add(g, GEO.hull, plumeCore, [ex, ey, 2.08], [-Math.PI / 2, 0, 0], [0.06, 0.24, 0.06]);
  }

  // ============  ④  SHIELD AURA (GALAGA 2) =======================
  // Keep the shield as a thin, circular outer ring so it reads like a
  // force barrier around the craft instead of a flattened oval attached to
  // the body. The ring stays slim and clear so the ship silhouette remains
  // visible at the center.
  const shieldAuraGroup = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(2.35, 0.045, 12, 72);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x8feaff,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerRingGeo = new THREE.TorusGeometry(2.18, 0.03, 8, 56);
  const innerRingMat = new THREE.MeshBasicMaterial({
    color: 0x9ff9ff,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowGeo = new THREE.CircleGeometry(1.55, 48);
  const shieldGlowMat = new THREE.MeshBasicMaterial({
    color: 0x8feaff,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const innerGlow = new THREE.Mesh(glowGeo, shieldGlowMat);
  innerGlow.rotation.x = -Math.PI / 2;
  innerGlow.position.z = -0.04;
  shieldAuraGroup.add(innerGlow);

  const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
  innerRing.rotation.z = Math.PI / 2;
  shieldAuraGroup.add(innerRing);

  const ring = new THREE.Mesh(ringGeo, ringMat);
  // Keep the shield ring vertical in the ship's local space so it reads as a
  // circular barrier around the hull instead of a flattened torus lying on its
  // side; the ship is viewed from the front, so a vertical ring is the most
  // legible circular guard.
  ring.rotation.z = Math.PI / 2;
  shieldAuraGroup.add(ring);

  shieldAuraGroup.name = 'shieldAura';
  shieldAuraGroup.visible = false;
  g.add(shieldAuraGroup);

  return g;
}

/**
 * Builds one of the four enemy archetypes.
 * `palette` = { hull, wing, core, glow }
 */
export function buildEnemyShip(type, palette) {
  const g = new THREE.Group();
  // Fluorescent insect look: hull & wing both self-illuminate in their
  // own neon hue so the bug reads as glowing, not metal. Higher
  // emissiveIntensity = more "lit from within".
  const hullM = stdMat(palette.hull, { emissive: palette.hull, emissiveIntensity: 0.75, roughness: 0.4, metalness: 0.2 });
  const wingM = stdMat(palette.wing, { emissive: palette.wing, emissiveIntensity: 1.0, roughness: 0.35, metalness: 0.15 });
  const coreM = glowMat(palette.core, 2.4);
  const darkM = stdMat(0x0a0a14, { roughness: 0.8, metalness: 0.3 });
  const glowM = glowMat(palette.glow, 2.0);
  const canopyM = stdMat(0x9fe8ff, { roughness: 0.15, metalness: 0.1, emissive: palette.glow, emissiveIntensity: 0.5 });

  const core = (name) => {
    const c = add(g, GEO.core, coreM, [0, 0.16, -0.15], [0, 0, 0], [0.3, 0.3, 0.3]);
    c.name = name;
    return c;
  };

  if (type === 'fighter') {
    // "Firefly" — Galaga-style wasp: fat rounded thorax + needle beak,
    // forward antennae, big round eyes, two pairs of swept wings, twin
    // abdomen stingers. Everything sits slightly forward so the face is
    // the most legible part when it dives at you.
    // --- fat rounded thorax (body reads as a wasp, not a fighter jet) ---
    add(g, GEO.wing, hullM, [0, 0.02, -0.15], [0, 0, 0], [0.85, 0.62, 1.15]); // core thorax
    add(g, GEO.wing, wingM, [0, 0.28, -0.1], [0, 0, 0], [0.35, 0.28, 0.85]); // dorsal plate
    // --- forward beak / mandibles ---
    add(g, GEO.hull, hullM, [0, -0.02, -1.15], [Math.PI / 2, 0, 0], [0.32, 1.1, 0.35]); // beak cone
    add(g, GEO.core, glowM, [0, -0.04, -1.72], [0, 0, 0], [0.09, 0.09, 0.09]); // beak tip
    for (const s of [-1, 1]) {
      add(g, GEO.fin, hullM, [s * 0.16, -0.1, -1.15], [0, s * 0.35, 0], [0.08, 0.08, 0.35]); // mandible
    }
    // --- big glowing eyes (wasps read by their faces) ---
    add(g, GEO.core, coreM, [-0.28, 0.18, -0.72], [0, 0, 0], [0.14, 0.14, 0.14]);
    add(g, GEO.core, coreM, [0.28, 0.18, -0.72], [0, 0, 0], [0.14, 0.14, 0.14]);
    // --- forward antennae ---
    for (const s of [-1, 1]) {
      add(g, GEO.gun, darkM, [s * 0.22, 0.35, -0.78], [0, s * -0.5, -0.35], [0.03, 0.03, 0.55]);
      add(g, GEO.core, glowM, [s * 0.38, 0.5, -0.98], [0, 0, 0], [0.05, 0.05, 0.05]);
    }
    // --- two pairs of swept wings (upper + lower, neon leading edge) ---
    for (const s of [-1, 1]) {
      add(g, GEO.wing, wingM, [s * 0.85, 0.18, 0.1], [0, s * -0.55, 0], [1.35, 0.07, 0.75]); // upper
      add(g, GEO.wing, wingM, [s * 0.95, -0.12, 0.55], [0, s * -0.85, 0], [1.5, 0.07, 0.6]); // lower
      strip(g, glowM, [s * 0.9, 0.2, 0.02], [0, s * -0.55, 0], [1.2, 0.03, 0.06]); // upper edge
      strip(g, glowM, [s * 1.0, -0.1, 0.5], [0, s * -0.85, 0], [1.35, 0.03, 0.06]); // lower edge
    }
    // --- twin abdomen stingers (aft) ---
    add(g, GEO.wing, darkM, [0, -0.05, 1.0], [0, 0, 0], [0.55, 0.35, 0.7]); // abdomen block
    add(g, GEO.fin, wingM, [-0.18, 0.1, 1.3], [0.25, 0, 0], [0.08, 0.35, 0.28]);
    add(g, GEO.fin, wingM, [0.18, 0.1, 1.3], [0.25, 0, 0], [0.08, 0.35, 0.28]);
    core('core');
  } else if (type === 'interceptor') {
    // "Moth" — fast, wide-winged: flat dark thorax, huge four wings that
    // sweep back like a dart, glowing wing-eyes on the tips, forward
    // proboscis + antennae. Reads as a fast, wide, evasive target.
    // --- flat dark thorax (wider than tall = moth silhouette) ---
    add(g, GEO.wing, hullM, [0, 0, 0], [0, 0, 0], [0.75, 0.42, 0.9]); // thorax
    add(g, GEO.wing, wingM, [0, 0.24, 0], [0, 0, 0], [0.35, 0.22, 0.75]); // raised back
    // --- forward proboscis (thin needle) ---
    add(g, GEO.hull, wingM, [0, 0, -1.0], [Math.PI / 2, 0, 0], [0.22, 1.1, 0.26]);
    add(g, GEO.core, glowM, [0, 0, -1.58], [0, 0, 0], [0.07, 0.07, 0.07]);
    // --- twin antennae curving up ---
    for (const s of [-1, 1]) {
      add(g, GEO.gun, darkM, [s * 0.18, 0.32, -0.72], [0, s * -0.35, -0.5], [0.03, 0.03, 0.6]);
      add(g, GEO.core, glowM, [s * 0.32, 0.55, -0.92], [0, 0, 0], [0.05, 0.05, 0.05]);
    }
    // --- big round eyes ---
    add(g, GEO.core, coreM, [-0.24, 0.16, -0.55], [0, 0, 0], [0.12, 0.12, 0.12]);
    add(g, GEO.core, coreM, [0.24, 0.16, -0.55], [0, 0, 0], [0.12, 0.12, 0.12]);
    // --- four huge swept wings (2 upper + 2 lower, neon tips) ---
    for (const s of [-1, 1]) {
      for (const [row, tilt, yBase] of [[1, 0.75, 0.14], [-1, 0.95, -0.14]]) {
        add(g, GEO.wing, wingM, [s * 1.1, yBase, 0.35], [0, s * -tilt, 0], [1.85, 0.06, 0.85]);
        strip(g, glowM, [s * 1.15, yBase + 0.02, 0.28], [0, s * -tilt, 0], [1.7, 0.03, 0.06]);
        add(g, GEO.core, glowM, [s * 1.85, yBase, 0.72], [0, 0, 0], [0.09, 0.09, 0.09]); // wingtip eye
      }
    }
    // --- twin aft stingers (engines sit here) ---
    add(g, GEO.wing, darkM, [0, -0.02, 1.05], [0, 0, 0], [0.5, 0.3, 0.55]);
    core('core');
  } else if (type === 'heavy') {
    // "Beetle" — heavy armored: big rounded elytra (hard shell) over a
    // wide thorax with a raised command turret, two armored side pincers
    // with glowing muzzles, and a broad armored aft deck.
    // --- wide base thorax ---
    add(g, GEO.wing, hullM, [0, -0.1, 0.1], [0, 0, 0], [1.7, 0.55, 1.4]);
    // --- elytra (hard shell wings, closed over the body) ---
    for (const s of [-1, 1]) {
      add(g, GEO.wing, hullM, [s * 0.85, 0.15, -0.15], [0, s * -0.15, 0], [0.95, 0.55, 1.15]);
      add(g, GEO.wing, wingM, [s * 0.85, 0.4, -0.15], [0, s * -0.15, 0], [0.35, 0.2, 1.0]); // shell ridge
      strip(g, glowM, [s * 0.85, 0.05, 0.75], [0, s * -0.15, 0], [0.5, 0.03, 0.07]); // ridge glow
    }
    // --- head: big armored face with wide mandibles ---
    add(g, GEO.wing, wingM, [0, 0.1, -0.9], [0, 0, 0], [0.75, 0.5, 0.55]);
    add(g, GEO.core, coreM, [-0.3, 0.28, -1.15], [0, 0, 0], [0.1, 0.1, 0.1]); // eye L
    add(g, GEO.core, coreM, [0.3, 0.28, -1.15], [0, 0, 0], [0.1, 0.1, 0.1]); // eye R
    // big pincer mandibles
    for (const s of [-1, 1]) {
      add(g, GEO.fin, hullM, [s * 0.42, 0.05, -1.35], [0, s * -0.35, 0], [0.12, 0.4, 0.55]);
      add(g, GEO.core, glowM, [s * 0.55, 0.02, -1.62], [0, 0, 0], [0.06, 0.06, 0.06]); // pincer tip
    }
    // --- raised command turret (glowing bridge) ---
    add(g, GEO.wing, wingM, [0, 0.7, 0.1], [0, 0, 0], [0.7, 0.5, 0.55]);
    add(g, GEO.canopy, canopyM, [0, 0.85, -0.15], [0, 0, 0], [0.18, 0.12, 0.25]); // turret glass
    add(g, GEO.core, glowM, [0, 0.95, -0.35], [0, 0, 0], [0.07, 0.07, 0.07]); // turret eye
    // --- armored side pincers / gun pods ---
    for (const s of [-1, 1]) {
      add(g, GEO.wing, hullM, [s * 1.45, -0.15, 0.35], [0, s * -0.1, 0], [0.6, 0.7, 1.0]);
      add(g, GEO.engine, darkM, [s * 1.62, -0.1, -0.4], [Math.PI / 2, 0, 0], [0.15, 0.15, 1.15]); // barrel
      add(g, GEO.core, glowM, [s * 1.62, -0.1, -0.98], [0, 0, 0], [0.11, 0.11, 0.11]); // muzzle
    }
    // --- broad armored aft deck ---
    add(g, GEO.wing, darkM, [0, -0.1, 1.0], [0, 0, 0], [1.5, 0.4, 0.7]);
    core('core');
  } else if (type === 'elite') {
    // "Oracle" — dragonfly: very slim abdomen, big round compound eyes
    // (signature silhouette), four long narrow wings (2 upper + 2 lower)
    // and a slowly rotating energy halo. Fastest + rarest target.
    // --- slim abdomen (needle spine) ---
    add(g, GEO.hull, hullM, [0, 0.04, 0.55], [0, 0, 0], [0.28, 1.5, 0.4]);
    add(g, GEO.hull, wingM, [0, 0.2, 0.2], [0, 0, 0], [0.2, 1.0, 0.3]); // spine ridge
    // --- head: two big round compound eyes, close together ---
    add(g, GEO.wing, wingM, [0, 0.25, -0.65], [0, 0, 0], [0.55, 0.42, 0.5]); // head plate
    add(g, GEO.core, coreM, [-0.18, 0.32, -0.82], [0, 0, 0], [0.16, 0.16, 0.14]); // left eye
    add(g, GEO.core, coreM, [0.18, 0.32, -0.82], [0, 0, 0], [0.16, 0.16, 0.14]); // right eye
    add(g, GEO.gun, darkM, [0, -0.02, -1.0], [0, 0, 0], [0.08, 0.08, 0.5]); // proboscis
    add(g, GEO.core, glowM, [0, -0.02, -1.3], [0, 0, 0], [0.05, 0.05, 0.05]); // tip
    // --- four long narrow wings (2 upper + 2 lower, neon edges) ---
    for (const s of [-1, 1]) {
      // upper pair (smaller, higher)
      add(g, GEO.wing, wingM, [s * 0.85, 0.22, 0.0], [0, s * -0.35, 0], [2.0, 0.04, 0.22]);
      strip(g, glowM, [s * 0.9, 0.24, -0.05], [0, s * -0.35, 0], [1.85, 0.02, 0.06]);
      // lower pair (larger, angled slightly down)
      add(g, GEO.wing, wingM, [s * 0.95, -0.05, 0.35], [0, s * -0.55, 0], [2.15, 0.04, 0.26]);
      strip(g, glowM, [s * 1.0, -0.03, 0.3], [0, s * -0.55, 0], [2.0, 0.02, 0.06]);
      // wingtip node
      add(g, GEO.core, glowM, [s * 1.9, -0.02, 0.55], [0, 0, 0], [0.05, 0.05, 0.05]);
    }
    // --- twin aft pods (engines sit here) ---
    for (const s of [-1, 1]) add(g, GEO.engine, darkM, [s * 0.18, -0.08, 1.0], [Math.PI / 2, 0, 0], [0.14, 0.14, 0.65]);
    // --- rotating energy halo (name 'halo' — Enemy.js spins it) ---
    const halo = new THREE.Mesh(GEO.ring, glowMat(palette.glow, 2.2));
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 0.12, 0.2);
    halo.scale.set(1.12, 1.12, 0.13);
    halo.name = 'halo';
    g.add(halo);
    core('core');
  } else if (type === 'scout') {
    // "Dart" — a homing-missile bug: a long needle fuselage, a glowing
    // seeker head (reads as "this one is coming for you"), four small
    // canard fins near the nose and two wide rear control surfaces.
    // Slim + pointed so it unmistakably reads as a missile, not a wasp.
    // --- long needle fuselage (the dominant silhouette) ---
    add(g, GEO.hull, hullM, [0, 0.05, 0.1], [Math.PI / 2, 0, 0], [0.3, 2.1, 0.34]); // body
    add(g, GEO.hull, wingM, [0, 0.12, -0.4], [Math.PI / 2, 0, 0], [0.2, 1.0, 0.24]); // spine ridge
    // --- glowing seeker head (front, +... nose is -Z) ---
    add(g, GEO.core, coreM, [0, 0.05, -0.95], [0, 0, 0], [0.2, 0.2, 0.2]); // seeker eye
    add(g, GEO.core, glowM, [0, 0.05, -1.2], [0, 0, 0], [0.08, 0.08, 0.08]); // seeker tip
    // --- four small canard fins near the nose (neon) ---
    for (const s of [-1, 1]) {
      add(g, GEO.wing, wingM, [s * 0.3, 0.12, -0.55], [0, s * -0.5, 0.15], [0.5, 0.03, 0.3]);
      strip(g, glowM, [s * 0.34, 0.13, -0.5], [0, s * -0.5, 0.15], [0.45, 0.02, 0.06]);
    }
    // --- two wide rear control surfaces (the "tail") ---
    for (const s of [-1, 1]) {
      add(g, GEO.wing, hullM, [s * 0.5, 0.08, 0.85], [0, s * -0.25, 0], [0.9, 0.05, 0.6]);
      strip(g, glowM, [s * 0.55, 0.1, 0.8], [0, s * -0.25, 0], [0.85, 0.03, 0.06]);
    }
    // --- twin dorsal fins ---
    add(g, GEO.wing, wingM, [0, 0.32, 0.7], [0, 0, 0], [0.18, 0.04, 0.6]);
    core('core');
  } else if (type === 'boss') {
    // Boss material overrides (shadow the shared hullM/wingM/darkM for this
    // block only): self-illuminated luminous violet so the dreadnought
    // reads bold against the dark nebula instead of near-black.
    const hullM = stdMat(palette.hull, { roughness: 0.42, metalness: 0.32, emissive: 0x301a5c, emissiveIntensity: 0.8 });
    const wingM = stdMat(palette.wing, { roughness: 0.38, metalness: 0.3, emissive: 0x45277e, emissiveIntensity: 0.85 });
    const darkM = stdMat(0x2c1d44, { roughness: 0.65, metalness: 0.35, emissive: 0x180e2e, emissiveIntensity: 0.5 });
    // massive dreadnought: layered hull, five gun pods, armoured face,
    // glowing trim, dorsal spires, red stern vents, wingtip pods.
    // +Z faces the player; cannons keep their original x/z so the
    // muzzle fire in Boss.js lines up with the visible barrels.
    add(g, GEO.wing, hullM, [0, 0, 0], [0, 0, 0], [3.4, 1.5, 3.2]);
    add(g, GEO.wing, wingM, [0, 0.9, 0], [0, 0, 0], [2.3, 0.7, 3.3]);
    add(g, GEO.wing, hullM, [0, -0.4, -1.2], [0, 0, 0], [4.4, 1.0, 1.6]);
    add(g, GEO.hull, wingM, [0, 1.1, 0.6], [Math.PI / 2, 0, 0], [1.0, 1.6, 1.0]);
    // side armour cheeks between hull and outer guns
    add(g, GEO.wing, hullM, [-1.7, -0.2, 1.1], [0, 0, 0], [1.1, 0.8, 1.3]);
    add(g, GEO.wing, hullM, [1.7, -0.2, 1.1], [0, 0, 0], [1.1, 0.8, 1.3]);
    // V-shaped prow plates flanking the center barrel
    add(g, GEO.wing, wingM, [-0.62, -0.05, 1.95], [0, 0.38, 0], [0.72, 0.95, 0.2]);
    add(g, GEO.wing, wingM, [0.62, -0.05, 1.95], [0, -0.38, 0], [0.72, 0.95, 0.2]);
    // lower jaw plate
    add(g, GEO.wing, hullM, [0, -0.78, 1.35], [0, 0, 0], [2.2, 0.42, 0.6]);
    // glowing trim strips along the flanks
    add(g, GEO.gun, glowMat(palette.glow, 1.5), [-1.85, 0.52, 0], [0, 0, 0], [0.07, 0.09, 2.9]);
    add(g, GEO.gun, glowMat(palette.glow, 1.5), [1.85, 0.52, 0], [0, 0, 0], [0.07, 0.09, 2.9]);
    // wing blades + glowing tip pods
    add(g, GEO.fin, wingM, [-2.9, 0.4, 0.2], [0, 0.4, -0.5], [0.5, 2.6, 0.3]);
    add(g, GEO.fin, wingM, [2.9, 0.4, 0.2], [0, -0.4, 0.5], [0.5, 2.6, 0.3]);
    add(g, GEO.core, glowMat(palette.glow, 2.0), [-3.3, 0.45, 0.05], [0, 0, 0], [0.26, 0.26, 0.26]);
    add(g, GEO.core, glowMat(palette.glow, 2.0), [3.3, 0.45, 0.05], [0, 0, 0], [0.26, 0.26, 0.26]);
    // dorsal spire crown
    add(g, GEO.fin, wingM, [0, 1.55, 0.9], [0.1, 0, 0], [0.14, 0.7, 0.5]);
    add(g, GEO.fin, wingM, [0, 1.62, -0.2], [0.1, 0, 0], [0.16, 0.85, 0.5]);
    add(g, GEO.fin, wingM, [0, 1.55, -1.2], [0.1, 0, 0], [0.14, 0.7, 0.5]);
    // red stern reactor vents (rear = -Z)
    add(g, GEO.wing, glowMat(0xff3b5c, 1.7), [-1.2, -0.5, -1.75], [0, 0, 0], [0.7, 0.5, 0.35]);
    add(g, GEO.wing, glowMat(0xff3b5c, 1.7), [1.2, -0.5, -1.75], [0, 0, 0], [0.7, 0.5, 0.35]);
    // gun pods (name them so projectiles can be traced back to the boss)
    for (const [x, z] of [[-2.1, 1.1], [2.1, 1.1], [0, 1.6], [-1.3, 1.5], [1.3, 1.5]]) {
      const pod = add(g, GEO.engine, darkM, [x, -0.35, z], [Math.PI / 2, 0, 0], [0.45, 0.45, 0.8]);
      pod.name = 'cannon';
      add(g, GEO.core, glowMat(palette.glow, 2.2), [x, -0.35, z + 0.5], [0, 0, 0], [0.22, 0.22, 0.22]);
    }
    // big central core
    const bigCore = add(g, GEO.core, glowMat(palette.core, 2.4), [0, 0.55, 1.1], [0, 0, 0], [0.9, 0.9, 0.9]);
    bigCore.name = 'core';
    // flank crown spikes + ram horns
    for (const s of [-1, 1]) {
      add(g, GEO.fin, wingM, [s * 0.55, 1.32, 0.4], [0, 0, s * -0.5], [0.1, 0.5, 0.34]);
      add(g, GEO.fin, darkM, [s * 0.55, 0, 2.55], [Math.PI / 2, 0, 0], [0.13, 0.13, 1.1]);
      add(g, GEO.core, glowMat(palette.glow, 2.2), [s * 0.55, 0, 3.12], [0, 0, 0], [0.09, 0.09, 0.09]);
    }
    // --- upgraded armour ring -------------------------------------
    // shoulder armour pylons + glowing edge trim (visual, non-firing)
    for (const s of [-1, 1]) {
      add(g, GEO.wing, hullM, [s * 2.15, 0.95, 0.55], [0, s * -0.22, 0], [1.05, 0.5, 1.25]);
      add(g, GEO.wing, darkM, [s * 2.75, 0.7, 0.95], [0, s * -0.3, 0], [0.5, 0.62, 0.72]);
      strip(g, glowM, [s * 1.78, 1.08, 1.18], [0, s * -0.22, 0], [0.9, 0.05, 0.07]);
      // cheek gun barrels (decor — keep them OFF the 'cannon' name so the
      // Boss.js charge/ci mapping stays on the five real firing pods)
      add(g, GEO.engine, darkM, [s * 1.95, -0.78, 1.7], [Math.PI / 2, 0, 0], [0.13, 0.13, 0.95]);
      add(g, GEO.core, glowMat(palette.glow, 2.0), [s * 1.95, -0.78, 2.18], [0, 0, 0], [0.09, 0.09, 0.09]);
    }
    // outer wing layer: longer secondary blades + outer glow pods
    for (const s of [-1, 1]) {
      add(g, GEO.fin, hullM, [s * 3.85, 0.7, 0.05], [0, s * 0.5, -s * 0.6], [0.42, 2.3, 0.26]);
      add(g, GEO.wing, darkM, [s * 3.5, 0.1, 0.4], [0, s * 0.45, 0], [0.38, 0.34, 0.95]);
      add(g, GEO.core, glowMat(palette.glow, 2.2), [s * 4.28, 1.12, -0.15], [0, 0, 0], [0.18, 0.18, 0.18]);
    }
    // red prow "eyes" embedded in the V plates — the boss stares back
    for (const s of [-1, 1]) {
      add(g, GEO.core, glowMat(0xff3b5c, 2.6), [s * 0.62, 0.12, 2.08], [0, 0, 0], [0.1, 0.1, 0.1]);
    }
    // dorsal spire crown: red energy caps on each spire tip
    add(g, GEO.core, glowMat(0xff3b5c, 2.2), [0, 1.92, 0.9], [0, 0, 0], [0.08, 0.08, 0.08]);
    add(g, GEO.core, glowMat(0xff3b5c, 2.2), [0, 2.08, -0.2], [0, 0, 0], [0.09, 0.09, 0.09]);
    add(g, GEO.core, glowMat(0xff3b5c, 2.2), [0, 1.92, -1.2], [0, 0, 0], [0.08, 0.08, 0.08]);
    // pulsing stern reactor (name 'vent' — Boss.js breathes it)
    const vent = add(g, GEO.wing, glowMat(0xff3b5c, 1.7), [0, -0.55, -1.85], [0, 0, 0], [1.0, 0.7, 0.4]);
    vent.name = 'vent';
  } else if (type === 'boss2') {
    // GALAGA 2: the EMBER CARRIER (second boss, wave 10+). A wide, LOW
    // deck that reads as a different class entirely from the tall violet
    // dreadnought: broad horizontal wings, a flat spine, a molten core
    // on the prow, and a ring of small radial pods (decor — the five
    // named 'cannon' pods carry the charge flash). Palette is hot
    // orange/red (see COLORS.BOSS2).
    const hullM = stdMat(palette.hull, { roughness: 0.4, metalness: 0.35, emissive: 0x3a0d02, emissiveIntensity: 0.85 });
    const wingM = stdMat(palette.wing, { roughness: 0.35, metalness: 0.3, emissive: 0x5c1c06, emissiveIntensity: 0.9 });
    const darkM = stdMat(0x26100a, { roughness: 0.65, metalness: 0.35, emissive: 0x1a0802, emissiveIntensity: 0.5 });
    // --- broad flat wings (the carrier silhouette) ---
    add(g, GEO.wing, wingM, [-2.4, 0.1, 0.1], [0, 0, 0.06], [2.9, 0.5, 2.3]);
    add(g, GEO.wing, wingM, [2.4, 0.1, 0.1], [0, 0, -0.06], [2.9, 0.5, 2.3]);
    // wingtip blades, swept back
    for (const s of [-1, 1]) {
      add(g, GEO.fin, hullM, [s * 4.35, 0.25, -0.4], [0, s * 0.55, -s * 0.35], [0.36, 0.9, 2.2]);
      add(g, GEO.core, glowMat(palette.glow, 2.4), [s * 4.62, 0.3, -0.75], [0, 0, 0], [0.2, 0.2, 0.2]);
    }
    // --- central spine + low prow block ---
    add(g, GEO.wing, hullM, [0, 0, 0], [0, 0, 0], [2.2, 0.85, 3.4]);
    add(g, GEO.hull, wingM, [0, 0.62, 0.4], [Math.PI / 2, 0, 0], [0.9, 1.15, 1.1]);
    add(g, GEO.wing, darkM, [0, -0.5, 0.9], [0, 0, 0], [1.7, 0.4, 1.5]);
    // prow ram plates (V, pointing at the player)
    add(g, GEO.wing, wingM, [-0.5, -0.1, 2.05], [0, 0.42, 0], [0.6, 0.8, 0.18]);
    add(g, GEO.wing, wingM, [0.5, -0.1, 2.05], [0, -0.42, 0], [0.6, 0.8, 0.18]);
    // --- glowing ember trim along the wing edges ---
    for (const s of [-1, 1]) {
      add(g, GEO.gun, glowMat(palette.glow, 1.6), [s * 2.15, 0.42, 0.15], [0, 0, 0], [0.06, 0.07, 2.5]);
      add(g, GEO.gun, glowMat(0xffb02e, 1.8), [s * 3.9, 0.55, -0.1], [0, s * 0.55, -s * 0.35], [0.06, 0.07, 1.6]);
    }
    // --- dorsal ridges (low, forward-swept) ---
    for (const s of [-1, 1]) {
      add(g, GEO.fin, hullM, [s * 0.8, 0.75, 0.2], [0.12, 0, s * -0.15], [0.16, 0.5, 2.0]);
    }
    add(g, GEO.fin, wingM, [0, 0.95, -0.6], [0.1, 0, 0], [0.2, 0.7, 1.4]);
    // --- the five real firing pods (named so Boss.js charge maps) ---
    // two wing pods, one center prow, two rear flank pods
    for (const [x, z] of [[-1.7, 1.2], [1.7, 1.2], [0, 1.55], [-2.6, -0.6], [2.6, -0.6]]) {
      const pod = add(g, GEO.engine, darkM, [x, -0.18, z], [Math.PI / 2, 0, 0], [0.4, 0.4, 0.72]);
      pod.name = 'cannon';
      add(g, GEO.core, glowMat(palette.glow, 2.2), [x, -0.18, z + 0.46], [0, 0, 0], [0.2, 0.2, 0.2]);
    }
    // --- molten core on the prow (name 'core') ---
    const bigCore = add(g, GEO.core, glowMat(palette.core, 2.6), [0, 0.35, 1.25], [0, 0, 0], [0.8, 0.8, 0.8]);
    bigCore.name = 'core';
    // red ember "eyes" in the prow plates
    for (const s of [-1, 1]) {
      add(g, GEO.core, glowMat(0xff4422, 2.6), [s * 0.5, 0.05, 2.12], [0, 0, 0], [0.09, 0.09, 0.09]);
    }
    // stern vent cluster (the carrier's heat dump)
    for (const s of [-1, 1]) {
      add(g, GEO.wing, glowMat(0xff5a2e, 1.8), [s * 1.1, -0.4, -1.7], [0, 0, 0], [0.55, 0.42, 0.32]);
    }
    const vent = add(g, GEO.wing, glowMat(0xffb02e, 1.9), [0, -0.45, -1.8], [0, 0, 0], [0.9, 0.6, 0.38]);
    vent.name = 'vent';
  } else if (type === 'boss3') {
    // GALAGA 2: the GLACIAL RING (third boss, wave 15). A huge spinning
    // ring of eight blades around a frozen core — an orbital weapon.
    // The eight blades live in their own sub-groups (collected into
    // g.userData.blades) so Boss3 can spin the whole ring; each blade
    // carries one named 'cannon' pod facing outward. Ice/cyan palette
    // (see COLORS.BOSS3).
    const hullM = stdMat(palette.hull, { roughness: 0.35, metalness: 0.4, emissive: 0x0e3348, emissiveIntensity: 0.9 });
    const wingM = stdMat(palette.wing, { roughness: 0.3, metalness: 0.35, emissive: 0x1a5f80, emissiveIntensity: 1.0 });
    const darkM = stdMat(0x0a2233, { roughness: 0.6, metalness: 0.4, emissive: 0x051826, emissiveIntensity: 0.5 });
    // --- the eight spinning blades ---
    const blades = [];
    const RING_R = 3.1;
    const BLADES = 8;
    for (let i = 0; i < BLADES; i++) {
      const a = (i / BLADES) * Math.PI * 2;
      const blade = new THREE.Group();
      blade.position.set(Math.sin(a) * RING_R, 0, Math.cos(a) * RING_R);
      blade.rotation.y = a; // +Z (outward after group spin) faces out
      // blade body: a swept fin + hull block
      add(blade, GEO.fin, wingM, [0, 0.1, 0.6], [0.2, 0, 0], [0.42, 1.6, 1.4]);
      add(blade, GEO.wing, hullM, [0, -0.1, 0.1], [0, 0, 0], [0.85, 0.5, 1.5]);
      add(blade, GEO.fin, darkM, [0, 0.5, -0.3], [-0.3, 0, 0], [0.28, 1.0, 0.7]);
      // glowing blade edge
      add(blade, GEO.gun, glowMat(palette.glow, 1.8), [0, 0.55, 0.9], [0, 0, 0], [0.06, 0.14, 1.1]);
      // the firing pod on this blade (named so Boss3 charge maps)
      const pod = add(blade, GEO.engine, darkM, [0, -0.15, 1.35], [Math.PI / 2, 0, 0], [0.42, 0.42, 0.78]);
      pod.name = 'cannon';
      add(blade, GEO.core, glowMat(palette.glow, 2.2), [0, -0.15, 1.85], [0, 0, 0], [0.2, 0.2, 0.2]);
      g.add(blade);
      blades.push(blade);
    }
    g.userData.blades = blades;
    // --- central frozen core hub ---
    add(g, GEO.wing, hullM, [0, 0, 0], [0, 0, 0], [1.9, 1.0, 1.9]);
    add(g, GEO.hull, wingM, [0, 0.7, 0], [Math.PI / 2, 0, 0], [0.85, 1.1, 0.85]);
    add(g, GEO.wing, darkM, [0, -0.45, 0], [0, 0, 0], [1.3, 0.5, 1.3]);
    // glowing rim ring (name 'rim' — Boss3 breathes its glow)
    const rim = add(g, GEO.ring, glowMat(palette.glow, 1.8), [0, 0, 0], [Math.PI / 2, 0, 0], [RING_R, RING_R, 0.16]);
    rim.name = 'rim';
    // inner ring detail
    add(g, GEO.ring, darkM, [0, 0.1, 0], [Math.PI / 2, 0, 0], [2.2, 2.2, 0.1]);
    // the frozen central core (name 'core')
    const bigCore = add(g, GEO.core, glowMat(palette.core, 2.6), [0, 0.55, 0.4], [0, 0, 0], [0.95, 0.95, 0.95]);
    bigCore.name = 'core';
    // icy spike crown rising from the hub
    for (const s of [-1, 0, 1]) {
      add(g, GEO.fin, wingM, [s * 0.9, 1.05, -0.3 - (s === 0 ? 0.4 : 0)], [0, 0, s * 0.25], [0.22, 0.9, 0.6]);
      add(g, GEO.core, glowMat(palette.glow, 2.4), [s * 0.9, 1.5, -0.3 - (s === 0 ? 0.4 : 0)], [0, 0, 0], [0.1, 0.1, 0.1]);
    }
    // stern vent (the ring's reactor dump)
    const vent = add(g, GEO.wing, glowMat(0x7de8ff, 1.9), [0, -0.6, -1.4], [0, 0, 0], [1.1, 0.6, 0.45]);
    vent.name = 'vent';
  } else if (type === 'boss4') {
    // GALAGA 2: the ACID SERPENT (fourth boss, wave 20+). Only the
    // serpent's HEAD is built here — the body is a 14-segment trail
    // the Boss4 class animates from the head's recent path. A long,
    // low, venomous head with a forked snout, a glowing acid throat
    // core, fanged jaw plates, and a dorsal crest of spines. Toxic
    // green palette (see COLORS.BOSS4).
    const hullM = stdMat(palette.hull, { roughness: 0.42, metalness: 0.3, emissive: 0x123a0c, emissiveIntensity: 0.9 });
    const wingM = stdMat(palette.wing, { roughness: 0.36, metalness: 0.28, emissive: 0x1f5c12, emissiveIntensity: 1.0 });
    const darkM = stdMat(0x0c2408, { roughness: 0.6, metalness: 0.35, emissive: 0x06140a, emissiveIntensity: 0.5 });
    // --- elongated head (long along +Z toward the player) ---
    add(g, GEO.wing, hullM, [0, 0, 0.4], [0, 0, 0], [1.9, 0.9, 4.2]);
    add(g, GEO.hull, wingM, [0, 0.55, 1.1], [Math.PI / 2, 0, 0], [0.75, 1.15, 1.6]);
    // forked snout (two prongs pointing forward at the player)
    add(g, GEO.wing, wingM, [-0.55, -0.05, 2.4], [0, 0.34, 0], [0.72, 0.6, 1.0]);
    add(g, GEO.wing, wingM, [0.55, -0.05, 2.4], [0, -0.34, 0], [0.72, 0.6, 1.0]);
    add(g, GEO.wing, darkM, [0, -0.45, 2.0], [0, 0, 0], [1.3, 0.45, 1.6]);
    // fanged jaw plates (lower, split)
    for (const s of [-1, 1]) {
      add(g, GEO.fin, hullM, [s * 0.95, -0.5, 1.5], [0.15, 0, s * -0.4], [0.3, 0.5, 1.6]);
      // fangs
      add(g, GEO.fin, darkM, [s * 0.55, -0.75, 2.5], [Math.PI / 2, 0, 0], [0.08, 0.08, 0.6]);
    }
    // glowing acid trim along the jaw
    for (const s of [-1, 1]) {
      add(g, GEO.gun, glowMat(palette.glow, 1.7), [s * 1.0, -0.2, 1.2], [0, 0, 0], [0.07, 0.08, 2.6]);
    }
    // dorsal crest of spines down the neck (rear = -Z)
    for (let i = 0; i < 4; i++) {
      const z = -0.2 - i * 0.7;
      add(g, GEO.fin, wingM, [0, 0.75 - i * 0.06, z], [-0.25, 0, 0], [0.22, 0.85 - i * 0.1, 0.5]);
      add(g, GEO.core, glowMat(palette.glow, 2.0), [0, 1.1 - i * 0.06, z - 0.15], [0, 0, 0], [0.09, 0.09, 0.09]);
    }
    // side "ear" frills (serpent head silhouette)
    for (const s of [-1, 1]) {
      add(g, GEO.wing, hullM, [s * 1.5, 0.35, 0.4], [0, s * -0.3, 0], [0.9, 0.55, 1.6]);
      add(g, GEO.fin, darkM, [s * 2.0, 0.6, -0.4], [0, s * -0.5, -s * 0.4], [0.25, 0.7, 0.8]);
    }
    // the three real firing pods (named so Boss4 charge maps):
    // one throat (center) + two flank pods on the snout
    for (const [x, z] of [[0, 2.7], [-0.9, 1.6], [0.9, 1.6]]) {
      const pod = add(g, GEO.engine, darkM, [x, -0.3, z], [Math.PI / 2, 0, 0], [0.4, 0.4, 0.74]);
      pod.name = 'cannon';
      add(g, GEO.core, glowMat(palette.glow, 2.2), [x, -0.3, z + 0.48], [0, 0, 0], [0.2, 0.2, 0.2]);
    }
    // glowing acid throat core (name 'core')
    const bigCore = add(g, GEO.core, glowMat(palette.core, 2.7), [0, 0.15, 1.7], [0, 0, 0], [0.8, 0.8, 0.9]);
    bigCore.name = 'core';
    // venom "eyes" in the snout
    for (const s of [-1, 1]) {
      add(g, GEO.core, glowMat(0xd8ff44, 2.6), [s * 0.45, 0.28, 2.75], [0, 0, 0], [0.1, 0.1, 0.1]);
    }
    // neck vent (where the body trail attaches — name 'vent')
    const vent = add(g, GEO.wing, glowMat(0x9dff2e, 1.9), [0, -0.15, -1.75], [0, 0, 0], [1.4, 0.85, 0.55]);
    vent.name = 'vent';
  }

  // --- engine glow emitters (aft / below the body) ---
  // Positioned per-type to match the new insect bodies above. Enemy.js
  // finds them by name 'engine' and pulses their scale + emissive.
  const engines = [];
  if (type !== 'boss') {
    const emitters = {
      fighter: [[-0.2, -0.15, 1.05], [0, -0.18, 1.12], [0.2, -0.15, 1.05]],
      interceptor: [[-0.18, -0.18, 1.15], [0.18, -0.18, 1.15]],
      heavy: [[-0.42, -0.3, 1.25], [0, -0.35, 1.32], [0.42, -0.3, 1.25]],
      elite: [[-0.18, -0.15, 1.2], [0.18, -0.15, 1.2]],
      scout: [[0, -0.05, 1.15]],
    }[type];
    if (emitters) {
      for (const [ex, ey, ez] of emitters) {
        const eng = add(g, GEO.core, glowMat(palette.glow, 1.6), [ex, ey, ez], [0, 0, 0], [0.15, 0.15, 0.28]);
        eng.name = 'engine';
        eng.userData.baseScale = [0.15, 0.15, 0.28]; // _engineGlow pulses against this
        engines.push(eng);
      }
    }
  }
  g.userData.engines = engines;
  return g;
}
