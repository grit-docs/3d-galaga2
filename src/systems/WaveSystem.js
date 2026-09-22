/**
 * WaveSystem.js
 * ---------------------------------------------------------------
 * Drives the wave cadence:
 *
 *   - Builds formation slots for the current wave (triangle, V, W,
 *     ring, twin columns...).
 *   - Spawns enemies in staggered pairs from the pool.
 *   - Applies per-wave HP / speed / fire-rate scaling.
 *   - Flags boss waves (every BOSS.BOSS_EVERY).
 *   - Reports completion when every spawned enemy is dead.
 *
 * The Game owns the enemy pool + list; WaveSystem just orchestrates.
 * ---------------------------------------------------------------
 */
import { BOUNDS, WAVE as WAVE_CFG } from '../config.js';
import * as THREE from 'three/webgpu';

export class WaveSystem {
  constructor(game) {
    this._game = game;
    this.wave = 0;
    this.active = false;
    this._spawnQueue = []; // {type, slot, delay}
    this._spawnTimer = 0;
    this._spawnedCount = 0;
    this._aliveCount = 0;
    this._isBossWave = false;
  }

  /** Start a new wave (call when entering PLAYING / WAVE_CLEAR). */
  startWave(wave) {
    this.wave = wave;
    this.active = true;
    this._isBossWave = wave % WAVE_CFG.BOSS_EVERY === 0;
    this._spawnQueue = this._buildSpawnPlan(wave);
    this._spawnedCount = 0;
    this._aliveCount = 0;
    this._spawnTimer = 0.6; // brief pause before first spawner
    this._bossDead = !this._isBossWave; // non-boss waves skip boss check
  }

  /** Call when the boss dies so isComplete waits for escorts too. */
  bossDied() {
    if (this._isBossWave) this._bossDead = true;
  }

  /** Wave scaling helpers (capped so very high waves stay sane). */
  hpScale(wave) {
    const s = 1 + Math.max(0, wave - 1) * WAVE_CFG.HP_SCALE;
    return Math.min(4, s);
  }
  speedScale(wave) {
    const s = 1 + Math.max(0, wave - 1) * WAVE_CFG.SPEED_SCALE;
    return Math.min(1.8, s);
  }

  /**
   * Build the spawner plan for a wave: a flat list of
   * {type, slot, entry} in formation order. Boss waves still include a
   * small escort ring so the boss isn't alone.
   *
   * GALAGA 2: every slot carries an entry pattern tag consumed by
   * _spawnFromFor():
   *   arc  — the classic top entry (wave 1 keeps 100% of these, so the
   *          original entry feel is regression-safe)
   *   lane — deep side approaches (wave 2+)
   *   ring — a circle around the player, forward arc (wave 3+, the ring
   *          share climbs with the wave)
   */
  _buildSpawnPlan(wave) {
    const plan = [];
    if (this._isBossWave) {
      // escort ring + a small elite line, so the boss isn't alone
      // (GALAGA 2: halved on request 6 -> 3, then density pass 2 bumped
      // 3 -> 5 — the boss fight should never go quiet)
      const escorts = [
        { type: 'interceptor', slot: { x: -9, y: 1.2, z: -38 } },
        { type: 'interceptor', slot: { x: 9, y: 0.4, z: -44 } },
        { type: 'elite', slot: { x: -5, y: 3.4, z: -46 } },
        { type: 'fighter', slot: { x: -13, y: 2.2, z: -42 } },
        { type: 'fighter', slot: { x: 13, y: 2.8, z: -40 } },
      ];
      for (const s of escorts) plan.push({ type: s.type, slot: s.slot, entry: 'arc' });
      return plan;
    }

    const layout = this._layoutFor(wave);
    const scripted = this._patternFor(wave) !== 'rows';
    const ringRatio = this._ringRatio(wave);
    const laneRatio = this._laneRatio(wave);
    // GALAGA 2: the scout (homing-missile bug) is a low-share "specialist"
    // that joins the formation from wave 3. It's deliberately rare — it
    // threatens by its missiles, not its numbers. Its share climbs a bit
    // with the wave (capped) so deep waves feel more dangerous.
    const scoutRatio = this._scoutRatio(wave);
    for (const slot of layout) {
      const r = Math.random();
      const entry =
        r < ringRatio ? 'ring'
        : r < ringRatio + laneRatio ? 'lane'
        : 'arc';
      // GALAGA 2: on wave 2+, 20-30% of the wave gets an "approach"
      // swipe queued (the bug skims the player at 3-6 units before
      // joining the formation attack pattern). Scouts never get the
      // approach swipe — they stay put and fire from range.
      // GALAGA 2: scripted patterns (V / ring) keep their authored types —
      // the silhouette IS the point, so no scout substitution there.
      const isScout = !scripted && Math.random() < scoutRatio;
      const approach = !isScout && !scripted && wave >= 2 && Math.random() < 0.2 + Math.random() * 0.1;
      plan.push({
        type: isScout ? 'scout' : slot.type,
        slot: slot.pos,
        entry,
        approach,
      });
    }
    return plan;
  }

  /** GALAGA 2: share of the wave that becomes a scout (homing bug). 0 on
   *  waves 1-2, then a small share that creeps up (capped) with depth. */
  _scoutRatio(wave) {
    if (wave < 3) return 0;
    return Math.min(0.22, 0.06 + (wave - 3) * 0.03);
  }

  /** GALAGA 2: ring-entry share per wave — 0 on waves 1-2, then climbs
   *  with the wave (capped) so deep waves feel like a 3D swarm. */
  _ringRatio(wave) {
    if (wave < 3) return 0;
    return Math.min(0.5, 0.15 + (wave - 3) * 0.08);
  }

  /** GALAGA 2: lane-entry share — kicks in from wave 2. */
  _laneRatio(wave) {
    if (wave < 2) return 0;
    return Math.min(0.35, 0.18 + (wave - 2) * 0.04);
  }

  /**
   * GALAGA 2: scripted wave patterns. Every 3rd wave breaks the row grid:
   *   wave % 6 === 0  -> 'ring'  (circular convergence)
   *   wave % 3 === 0  -> 'v'     (V-split)
   *   otherwise       -> 'rows'  (the standard grid)
   * Boss waves never script (they have their own escort plan).
   */
  _patternFor(wave) {
    if (this._isBossWave) return 'rows';
    if (wave % 6 === 0) return 'ring';
    if (wave % 3 === 0) return 'v';
    return 'rows';
  }

  _layoutFor(wave) {
    const w = wave;
    const pattern = this._patternFor(wave);
    if (pattern === 'v') return this._vShape(w);
    if (pattern === 'ring') return this._ringShape(w);
    // Galaga-style: clear horizontal rows, tight spacing, one type per row.
    // density pass 2 (auto-aim made the game too easy): rows/cols bumped
    // ~30-40% across the board — wave 1 8 -> 12, wave 8 24 -> 30, cap 30 -> 36.
    if (w === 1) return this._rows(3, 4, ['fighter']);
    if (w === 2) return this._rows(3, 5, ['fighter', 'interceptor']);
    if (w === 3) return this._rows(3, 5, ['fighter', 'heavy', 'interceptor']);
    if (w === 4) return this._rows(4, 5, ['interceptor', 'heavy']);
    if (w === 5) return this._rows(4, 5, ['fighter', 'heavy', 'interceptor', 'elite']);
    if (w === 6) return this._rows(5, 5, ['interceptor', 'elite']);
    if (w === 7) return this._rows(5, 5, ['fighter', 'heavy', 'elite']);
    if (w === 8) return this._rows(5, 6, ['interceptor', 'heavy', 'elite']);
    // beyond 8: cap at 6 rows x 6 cols with mixed rows
    const rows = Math.min(6, 5 + Math.floor((w - 8) / 2));
    const cols = Math.min(6, 5 + Math.floor((w - 8) / 3));
    return this._rows(rows, cols, ['fighter', 'interceptor', 'heavy', 'elite']);
  }

  // ---- shape generators (return {type, pos}[]) ---------------------

  /**
   * Galaga-style horizontal rows. Each row is a tight straight line of
   * `cols` enemies at the same z. Rows are stacked back-to-front so the
   * player sees a clean block of enemies lined up in rows, one type per
   * row (row index cycles the type list).
   * GALAGA 2: slots are scattered in Y (0..4) so the block reads as a
   * 3D cloud instead of a flat wall — the spec's "편대 내부 슬롯도 y 0~4
   * 분산". Z stays on the row line (the deeper rows still read as depth).
   */
  _rows(rows, cols, typeCycle) {
    const out = [];
    // spacing between enemies in a row (world units).
    // GALAGA 2: the row now spans a fixed world width (ROW_SPAN) instead
    // of a per-bug fixed gap, so a wide 6-col wave stretches out to the
    // edges of the playfield rather than bunching up in the centre. Fewer
    // columns read as a tighter, denser cluster (smaller gap) instead of
    // the same cramped band.
    const ROW_SPAN = 36; // target row width (world units)
    const gap = ROW_SPAN / Math.max(1, cols - 1);
    // rows span z from near (biggest) to far (smallest); the wider z run
    // keeps stacked rows visually separated down the depth axis
    const zNear = BOUNDS.FORMATION_Z_MIN + 3;   // ~-31 (near)
    const zFar = BOUNDS.FORMATION_Z_MAX - 3;    // ~-49 (far)
    for (let r = 0; r < rows; r++) {
      const tRatio = rows === 1 ? 0 : r / (rows - 1);
      const z = zNear + (zFar - zNear) * tRatio;
      // row width: same world-space width across rows so the
      // row looks uniform; perspective makes the far row render
      // narrower and smaller, just like in the reference art.
      const span = (cols - 1) * gap;
      // GALAGA 2: rows no longer hug the screen centre — each row gets
      // a random lateral offset (up to ±40% of its own width) so the
      // formation drifts left/right of centre instead of always
      // stacking on top of the player.
      const rowOffset = (Math.random() - 0.5) * span * 0.8;
      const rowType = typeCycle[r % typeCycle.length];
      for (let c = 0; c < cols; c++) {
        const x = -span / 2 + rowOffset + c * gap;
        // 3D scatter: each bug sits at its own altitude in the 0..5 band
        const y = Math.random() * 5;
        out.push({ type: rowType, pos: { x, y, z } });
      }
    }
    return out;
  }

  /**
   * GALAGA 2: the scripted "V-split" wave. A classic Galaga V with the
   * apex (leader) deep and the wings fanning forward — the pair-spawn
   * pops wings outward from the apex, so the V materializes on screen
   * as the wave unfolds. Counts scale with wave depth like the rows do.
   */
  _vShape(wave) {
    const S = WAVE_CFG.SCRIPT;
    const out = [];
    // wing length per side; the total is the wing pairs + 1 leader
    const wing = Math.min(S.V_WING_MAX, S.V_WING_BASE + Math.floor((wave - 3) / 3));
    const gap = S.V_GAP;
    const zLeader = S.V_LEADER_Z;             // deepest: the leader
    const zFront = S.V_FRONT_Z;               // wings sweep forward
    // type by arm: leader heavy, inner arms interceptor, outer fighters
    const types = { leader: 'heavy', inner: 'interceptor', outer: 'fighter' };
    out.push({ type: types.leader, pos: { x: 0, y: 3.2, z: zLeader } });
    for (let i = 1; i <= wing; i++) {
      const t = i / wing; // 0 (inner, deep) .. 1 (outer, forward)
      const x = i * gap * 1.05;
      const y = 1 + (1 - t) * 2.4;        // inner wings ride higher
      const z = zLeader + (zFront - zLeader) * (t * 0.85);
      out.push({ type: types.inner, pos: { x: -x, y, z } });
      out.push({ type: types.inner, pos: { x, y, z } });
    }
    // a fighter row tucked behind the wing tips closes the shape
    const tipZ = zFront - 2;
    for (let i = 1; i <= wing; i++) {
      const x = i * gap * 1.05 + gap * 0.5;
      out.push({ type: types.outer, pos: { x: -x, y: 0.6, z: tipZ } });
      out.push({ type: types.outer, pos: { x, y: 0.6, z: tipZ } });
    }
    return out;
  }

  /**
   * GALAGA 2: the scripted "ring convergence" wave. Enemies sit on a
   * forward circle (radius ~16-20) at the formation band and converge
   * inward — the pair-spawn pops from the outer ring so the circle
   * closes toward the player. The back of the ring (deepest arc) is
   * held by heavies/elites; the front arc by fighters.
   */
  _ringShape(wave) {
    const S = WAVE_CFG.SCRIPT;
    const out = [];
    const n = Math.min(S.RING_COUNT_MAX, S.RING_COUNT_BASE + Math.floor(wave / 2));
    const radius = S.RING_RADIUS;
    const yBand = 2.6;
    // theta spans the FULL circle (the back arc sits deep = the leader
    // line; the front arc sits close = the fighter screen)
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2;
      const x = Math.sin(theta) * radius;
      const z = S.RING_Z - Math.cos(theta) * (radius - 6); // flattened ellipse
      const y = yBand + (Math.cos(theta) * 0.5 + 0.5) * 1.8;
      // type by arc position: deep (cos ~ 1) = elites/heavies, front = fighters
      const depth = (Math.cos(theta) + 1) / 2; // 0 front .. 1 back
      let type = 'fighter';
      if (depth > 0.8) type = 'elite';
      else if (depth > 0.6) type = 'heavy';
      else if (depth > 0.4) type = 'interceptor';
      out.push({ type, pos: { x, y, z } });
    }
    return out;
  }

  get isComplete() {
    if (!this.active) return true;
    if (this._isBossWave) {
      // Boss wave: both the boss AND every escort must be dead.
      return this._bossDead && this._spawnQueue.length === 0 && this._aliveCount === 0;
    }
    // A wave is only complete when the spawner plan is EXHAUSTED and
    // every enemy that was spawned is dead. Previously only the
    // alive-count was checked, so a fast player could "clear" a wave
    // by killing just the first couple of spawns while the rest sat
    // un-spawned in the queue.
    return this._spawnQueue.length === 0 && this._aliveCount === 0;
  }

  /** Register a newly spawned enemy (increments alive count). */
  enemySpawned() {
    this._spawnedCount += 1;
    this._aliveCount += 1;
  }

  /** Register a dead enemy. */
  enemyDied() {
    this._aliveCount -= 1;
  }

  get remaining() {
    return this._aliveCount;
  }

  /** Per-frame spawner tick. */
  update(dt, game) {
    if (!this.active) return;
    if (this._spawnQueue.length === 0) return;

    // Boss waves DO drip-spawn their escorts (the boss itself is
    // configured separately by Game). Previously this method returned
    // early on boss waves so the plan's escorts were never spawned
    // (spec: boss waves feature "Boss + escorts").

    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0 && this._spawnQueue.length > 0) {
      // pop two at a time (left/right) for the classic mirrored entry
      const a = this._spawnQueue.shift();
      const b = this._spawnQueue.shift();
      const slots = [a, b].filter((s) => s);
      this._spawnPair(game, slots);
      this._spawnTimer = 0.5; // spawn interval
    }
  }

  /** Full reset — call when the player restarts the game. */
  reset() {
    this.wave = 0;
    this.active = false;
    this._spawnQueue.length = 0;
    this._spawnTimer = 0;
    this._spawnedCount = 0;
    this._aliveCount = 0;
    this._isBossWave = false;
    this._bossDead = true;
  }

  _spawnPair(game, slots) {
    for (const s of slots) {
      // use a real THREE.Vector3 so Enemy.configure().clone() works
      const slotV = new THREE.Vector3(s.slot.x, s.slot.y, s.slot.z);
      // GALAGA 2: the 3D entry spot depends on the wave's entry tag
      // (ring / lane / arc). The contract with Enemy is unchanged:
      // spawnFrom IS the 3D entry spot.
      const spawnFrom = this._spawnFromFor(slotV, s.entry);
      const enemy = this._game.acquireEnemy(s.type);
      if (!enemy) continue;
      enemy.configure({
        slot: slotV,
        index: this._spawnedCount,
        spawnFrom,
        hpScale: this.hpScale(this.wave),
        // GALAGA 2: some bugs queue a close "approach swipe" for their
        // first attack instead of a regular dive (see EnemyAttackSystem)
        approach: s.approach,
      });
      this._game.addEnemy(enemy);
      this.enemySpawned();
    }
  }

  /**
   * GALAGA 2: pick the 3D spawn point for an entry.
   *   arc  — the original top entry (regression-safe classic feel)
   *   lane — deep side approaches from far left/right
   *   ring — a point on the forward circle AROUND the player (0,1.1,17):
   *           radius 55..85 and altitude y 2..20 (per the spec). Theta spans
   *           the forward ¾ (±75°) so the ring wraps the front and the
   *           shoulders — the Nova-Storm "encircle from deep space" feel.
   *           (Note: the spec also lists a z -60..-90 band, which is
   *           geometrically incompatible with radius 55..85 around the
   *           player; the radius + altitude are honored as the binding
   *           constraints, and z falls out to ~-68..+17.)
   */
  _spawnFromFor(slotV, entry) {
    const out = new THREE.Vector3();
    if (entry === 'ring') {
      // forward ¾ around the player rest position (0, 1.1, 17):
      // theta 0 = straight ahead, ±75° = the shoulders (never dead
      // behind the craft).
      const theta = (Math.random() * 2 - 1) * (75 * Math.PI / 180);
      const radius = 55 + Math.random() * 30; // 55..85 per spec
      const x = Math.sin(theta) * radius;
      const z = 17 - Math.cos(theta) * radius; // ~-68 (front) .. +17 (side)
      out.set(x, 2 + Math.random() * 18, z);
    } else if (entry === 'lane') {
      const side = Math.random() < 0.5 ? -1 : 1;
      out.set(
        side * (30 + Math.random() * 16),
        5 + Math.random() * 13,
        -(75 + Math.random() * 20)
      );
    } else {
      // arc: the classic top entry — kept identical to the old behavior
      out.set(slotV.x * 1.8, 8 + Math.random() * 6, -85 - Math.random() * 10);
    }
    return out;
  }
}
