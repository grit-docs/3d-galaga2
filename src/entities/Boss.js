/**
 * Boss.js
 * ---------------------------------------------------------------
 * The wave-5 (and every-5-waves) dreadnought.
 *
 * - Large multi-part hull with a glowing core + gun pods.
 * - HP pool; destroyed when HP hits 0.
 * - Three escalating attack phases:
 *     Phase 1 (>66% HP) -> tight forward mine spread from the pods
 *     Phase 2 (33-66%)  -> aimed mine burst + shallow flank mines
 *     Phase 3 (<33%)    -> forward fan of mines centered on the player
 * - A short fly-in, then a slow sine patrol near the front.
 *
 * Boss projectiles are routed through the shared projectile pool,
 * flagged hostile so the CollisionSystem treats them like enemy
 * shots but with boss damage/scale.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOSS, COLORS } from '../config.js';
import { buildEnemyShip } from './ShipBuilder.js';

const _dir = new THREE.Vector3();
const _mw = new THREE.Vector3();
const TELEGRAPH = 0.34; // seconds of charge before boss shots leave the pod
// Invuln grace floor (real seconds). The fly-in to the patrol ring takes
// ~2.5s; this guarantees the spawn window is at least 3s of invulnerability
// so late-arriving player volleys can't chip the tank before it engages.
const INVULN_FLOOR = 3.0;

export class Boss {
  constructor() {
    this.group = buildEnemyShip('boss', COLORS.BOSS);
    this.group.name = 'boss';
    this.radius = BOSS.RADIUS;

    this.maxHp = 1;
    this.hp = 1;
    this.alive = true;
    this.entering = true;
    this.phase = 1;

    this._t = 0;
    this._fireTimer = 1.2;
    // GALAGA 2 boss difficulty: escort top-up + ring state
    this._escortTimer = BOSS.ESCORT.INTERVAL_MIN + Math.random() * 2;
    // GALAGA 2: 3D movement state
    this._patrolY = 1.5;   // damped altitude tracking the player's band
    this._lungTimer = 0;   // time until the next forward lunge (phase 2/3)
    this._lungZ = 0;       // current lunge forward offset (added to patrol z)
    this._ringTimer = 2.6; // phase-3 3D ring cadence
    this._lungTarget = 0;

    this._cannons = [];
    this._core = null;
    this._vent = null;    // stern reactor (name 'vent') — breathed in update()
    this._pending = [];   // shots in the firing delay, leaving the barrel soon
    this._invuln = 0;          // remaining floor-time invulnerability (s)
    this._enterCueShown = false; // one-shot SHIELD DOWN popup flag
    this._collectParts();

    // "Make it big": upscale the whole dreadnought about its center.
    // 2.34 = 1.2 (base) x 1.3 (30% enlargement) x 1.5 (a further 50%).
    // The collision radius (config BOSS.RADIUS) is the tuned hitbox that
    // tracks the scaled visual, so both grow together.
    this.group.scale.set(2.34, 2.34, 2.34);
    this.group.visible = false;
  }

  _collectParts() {
    const cannons = [];
    let core = null;
    let vent = null;
    this.group.traverse((o) => {
      if (o.name === 'cannon') cannons.push(o);
      if (o.name === 'core') core = o;
      if (o.name === 'vent') vent = o;
    });
    this._cannons = cannons;
    this._core = core;
    this._vent = vent;
  }

  onRecycle() {
    this.alive = false;
    this.group.visible = false;
    this._clearPending();
  }

  configure(wave) {
    const cycle = Math.max(0, Math.floor(wave / BOSS.BOSS_EVERY) - 1);
    this.maxHp = BOSS.HP + BOSS.HP_SCALE * cycle;
    this.hp = this.maxHp;
    this.alive = true;
    this.entering = true;
    this.phase = 1;
    this._t = 0;
    this._fireTimer = 1.0;
    this._tickN = 0; // GALAGA 2: per-tick counter (salvo gating)
    this._patrolY = 1.5;
    this._lungTimer = 5 + Math.random() * 3; // first lunge a bit later
    this._lungZ = 0;
    this._lungTarget = 0;
    this._ringTimer = 2.6;
    this._escortTimer = BOSS.ESCORT.INTERVAL_MIN + Math.random() * 2;
    this._invuln = INVULN_FLOOR;
    this._enterCueShown = false;
    this._clearPending();
    this.group.visible = true;
    this.group.position.set(0, 4, -95);
    this.group.rotation.set(0, 0, 0);
  }

  get position() {
    return this.group.position;
  }

  get coreHpRatio() {
    return Math.max(0, this.hp / this.maxHp);
  }

  /**
   * @param game Game holding _context (player, spawnEnemyShot, wave, ...)
   */
  update(game, dt) {
    if (!this.alive) return;
    this._t += dt;

    // ---- phase selection from HP ratio --------------------------
    const ratio = this.coreHpRatio;
    const targetPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (targetPhase !== this.phase) {
      this.phase = targetPhase;
      this._fireTimer = Math.max(this._fireTimer, 0.6);
      this._pulseCore();
      // GALAGA 2 impact pass: a phase change is a visible event — the
      // hull flares, the camera thumps, and a warning pops over the boss.
      game._cameraFx.addShake(0.7);
      game._floatingText.spawnAt(
        this.position.clone().add(new THREE.Vector3(0, 3.2, 0)),
        this.phase === 2 ? 'BOSS ENRAGED' : 'BOSS CRITICAL',
        '#ff8a4c', false
      );
    }

    // ---- movement -----------------------------------------------
    // GALAGA 2: the patrol altitude + lung patterns track the player's
    // current band, so they're captured once per frame here.
    const playerY = game._context.player.group.position.y;
    if (this.entering) {
      this.group.position.z += (BOSS.Z - this.group.position.z) * Math.min(1, dt * 1.4);
      this.group.position.x += Math.sin(this._t * 0.6) * dt * 2;
      if (this.group.position.z > BOSS.Z - 1.5) this.entering = false;
    } else {
      // GALAGA 2: 3D patrol. The patrol altitude tracks the player's
      // band (damped) and breathes ±2.5 around it; z sways over the
      // wider -46..-54 band so the hull visibly advances/recedes.
      this._patrolY = THREE.MathUtils.damp(this._patrolY, playerY, 0.8, dt);
      this.group.position.x = Math.sin(this._t * 0.4) * 7;
      this.group.position.y = this._patrolY + Math.sin(this._t * 0.7) * 2.5;
      this.group.position.z = BOSS.Z + Math.sin(this._t * 0.5) * 4 + this._lungZ;
      this.group.rotation.z = -Math.cos(this._t * 0.4) * 0.12;
      this.group.rotation.x = Math.sin(this._t * 0.7) * 0.05;

      // GALAGA 2: one-shot forward LUNG in phases 2/3 — the dreadnought
      // surges toward the player and eases back (Nova-Storm pressure).
      this._updateLung(dt);
    }

    // ---- invuln window: fly-in arrival OR minimum grace (whichever
    //      ends later). Hits are blocked in hit() while `invuln`. ----
    if (this._invuln > 0) this._invuln -= dt;
    const invuln = this.entering || this._invuln > 0;
    if (!invuln && !this._enterCueShown) {
      this._enterCueShown = true; // one-shot cue that the shield has closed
      game._floatingText.spawnAt(
        this.position.clone().add(new THREE.Vector3(0, 3.2, 0)),
        'SHIELD DOWN', '#7dff9a', false
      );
    }

    // ---- core glow scales with danger (+ charge boost) ----------
    const charging = this._pending.length > 0;
    if (this._core) {
      const danger = 1 - ratio;
      const chargeBoost = charging ? 1.6 + Math.sin(this._t * 30) * 0.5 : 0;
      // visible tell for the invuln window (shield shimmer)
      const invulnBoost = invuln ? 1.2 + Math.sin(this._t * 10) * 0.5 : 0;
      this._core.material.emissiveIntensity =
        1.4 + Math.sin(this._t * 6) * 0.3 + danger * 1.6 + chargeBoost + invulnBoost;
      // elongate the core so it reads as a glowing energy cell, not a
      // flat ball; keep the idle pulse + danger swell as a multiplier
      const cs = 0.85 + Math.sin(this._t * 8) * 0.06 + danger * 0.15;
      this._core.scale.set(0.95 * cs, 0.72 * cs, 1.25 * cs);
    }

    // ---- stern reactor breathes (faster + hotter as it weakens ----
    if (this._vent) {
      const danger = 1 - ratio;
      const breath = 1 + Math.sin(this._t * (3 + danger * 5)) * 0.12;
      this._vent.scale.set(1.0 * breath, 0.7 * breath, 0.4 * breath);
      this._vent.material.emissiveIntensity = 1.4 + danger * 1.2 + (charging ? Math.sin(this._t * 30) * 0.5 : 0);
    }

    // ---- firing -------------------------------------------------
    this._fireTimer -= dt;
    if (this._fireTimer <= 0) {
      this._attackTick(game);
    }
    // GALAGA 2: the expanding ring (phases 2/3) on its own cadence
    this._maybeFireRing(game, dt, game._context.player.group.position);
    // GALAGA 2: escort top-ups keep the field alive while the boss lives
    this._updateEscorts(game, dt);

    // ---- pending shots: fire them once the charge finishes --------
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const s = this._pending[i];
      s.t -= dt;
      if (s.t <= 0) {
        game._context.spawnEnemyShot({
          origin: s.origin, dir: s.dir, speed: s.speed, damage: s.damage, scale: s.scale,
          kind: s.kind, life: s.life,
          homing: s.homing, homingSpeed: s.homingSpeed, turnRate: s.turnRate,
        });
        this._pending.splice(i, 1);
      }
    }

    // gun pods physically charge up while a volley is telegraphed
    const pk = charging ? 1.22 + Math.sin(this._t * 30) * 0.14 : 1;
    for (const c of this._cannons) {
      c.scale.set(0.45 * pk, 0.45 * pk, 0.8 * pk);
    }


  }

  _attackTick(game) {
    const ctx = game._context;
    const player = ctx.player.group.position;
    const wave = ctx.wave;

    const rate = this.phase === 1 ? BOSS.FIRE_INTERVAL.p1 : this.phase === 2 ? BOSS.FIRE_INTERVAL.p2 : BOSS.FIRE_INTERVAL.p3;
    this._fireTimer = rate * (0.85 + Math.random() * 0.4);

    const aim = (tx, tz, spread = 0) => {
      // GALAGA 2: 3D aim — the mine now carries the vertical component so
      // it actually reaches the player's altitude (the boss patrols in a
      // moving y band, so a flat y=0 aim would fly over/under the craft).
      const px = player.x, py = player.y;
      const dx = tx - this.position.x;
      const dy = py - this.position.y;
      const dz = tz - this.position.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      let dirx = dx / len;
      let diry = dy / len;
      let dirz = dz / len;
      if (spread !== 0) {
        const c = Math.cos(spread);
        const s = Math.sin(spread);
        const nx = dirx * c - dirz * s;
        dirz = dirx * s + dirz * c;
        dirx = nx;
      }
      return _dir.set(dirx, diry, dirz).normalize();
    };

    // WEAPONS — the boss throws:
    //   • MINE : small orb that travels in a straight line.
    // Every pod fires on a short charge pulse, then the mine leaves
    // the barrel. `o` = { speed, damage, scale, kind, life, ci }.
    const charge = (d, o = {}) => {
      const ci = (o.ci !== undefined) ? o.ci : 0;
      const c = this._cannons[ci] || this._cannons[0];
      const origin = c ? this.group.localToWorld(_mw.copy(c.position)).clone() : this.position.clone();
      this._pending.push({
        origin, dir: d.clone(), speed: o.speed, damage: o.damage ?? 26,
        scale: o.scale ?? 1, kind: o.kind ?? 'orb',
        life: o.life,
        homing: !!o.homing,
        homingSpeed: o.homingSpeed,
        turnRate: o.turnRate,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    };

    const mineSpeed = 11 + wave * 0.4; // slow enough to dodge
    const mine = { kind: 'orb', scale: 0.55, life: 6, damage: 22 };

    // GALAGA 2 boss difficulty: the tick counter gates the heavier
    // additions so they read as a rhythm, not a wall.
    this._tickN += 1;

    if (this.phase === 1) {
      // tight spread — seven mines in a narrow fan centered on your
      // position (firepower pass: 5 -> 7)
      charge(aim(player.x, player.z, -0.20), { ci: 0, speed: mineSpeed, ...mine, damage: 20 });
      charge(aim(player.x, player.z, -0.13), { ci: 3, speed: mineSpeed + 2, ...mine, damage: 22 });
      charge(aim(player.x, player.z, -0.06), { ci: 1, speed: mineSpeed + 3, ...mine, damage: 23 });
      charge(aim(player.x, player.z), { ci: 2, speed: mineSpeed + 3, ...mine, damage: 24 });
      charge(aim(player.x, player.z, 0.06), { ci: 4, speed: mineSpeed + 3, ...mine, damage: 23 });
      charge(aim(player.x, player.z, 0.13), { ci: 0, speed: mineSpeed + 2, ...mine, damage: 22 });
      charge(aim(player.x, player.z, 0.20), { ci: 3, speed: mineSpeed, ...mine, damage: 20 });
    } else if (this.phase === 2) {
      // tight 5-mine burst + two wing mines — ALL aimed forward at the
      // player (firepower pass: 5 -> 7)
      charge(aim(player.x, player.z, -0.14), { ci: 3, speed: mineSpeed + 3, ...mine, damage: 24 });
      charge(aim(player.x, player.z, -0.07), { ci: 0, speed: mineSpeed + 3, ...mine, damage: 25 });
      charge(aim(player.x, player.z), { ci: 2, speed: mineSpeed + 4, ...mine, damage: 26 });
      charge(aim(player.x, player.z, 0.07), { ci: 4, speed: mineSpeed + 3, ...mine, damage: 25 });
      charge(aim(player.x, player.z, 0.14), { ci: 1, speed: mineSpeed + 3, ...mine, damage: 24 });
      charge(aim(player.x, player.z, -0.03), { ci: 0, speed: mineSpeed, ...mine, damage: 22 });
      charge(aim(player.x, player.z, 0.03), { ci: 3, speed: mineSpeed, ...mine, damage: 22 });
      // GALAGA 2: every 4th tick the boss slings a HOMING double — two
      // seekers, the second offset + faster. (Missile pass 3: still too
      // many seekers; now a rare accent, the mines carry the pressure.)
      if (this._tickN % 4 === 0) this._fireBossMissiles(aim, game, 2);
    } else {
      // phase 3: forward fan of mines — all TEN travel toward the player.
      // Tightened to ±28° (was ±60°) so the outermost mines still read as
      // a forward burst instead of flying out to the sides.
      const n = 10;
      const half = Math.PI / 6.5; // ~28°
      const base = aim(player.x, player.z).clone();
      for (let i = 0; i < n; i++) {
        const ang = -half + (i / (n - 1)) * half * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        _dir.set(base.x * c - base.z * s, base.y, base.x * s + base.z * c).normalize();
        charge(_dir, { ci: i % this._cannons.length, speed: mineSpeed + 2, ...mine, damage: 20 });
      }
      // GALAGA 2: on top of the fan, every 4th tick the boss unleashes
      // a 2-round aimed HOMING missile salvo — the phase-3 signature,
      // now a punctuating hit instead of a constant swarm. (Missile
      // pass 3: 3-round every 2nd tick was still too oppressive.)
      if (this._tickN % 4 === 0) this._fireBossMissiles(aim, game, 2);
      // GALAGA 2: the 3D RING fires on its own slower cadence, driven in
      // update() via _ringTimer — see _maybeFireRing below.
    }
    // GALAGA 2 impact pass: each boss volley thumps the camera slightly
    // (bigger in later phases) so the fire feels heavy, not decorative.
    game._cameraFx.addShake(0.1 + this.phase * 0.08);
  }

  /**
   * GALAGA 2 boss difficulty: an aimed HOMING missile salvo. Same seeker
   * darts as the scout bug, but the boss's are faster (MIS_SPEED),
   * turn harder (MIS_TURN — sticky but still dodgeable: v/omega ≈ 12.3u
   * radius, so the dart curves through where you WAS), and slightly
   * bigger. `count` darts leave the pod staggered across the cannon
   * line; each gets a small angle offset so the salvo reads as a fan of
   * seekers, not one thick line.
   */
  _fireBossMissiles(aim, game, count) {
    const ctx = game._context;
    const player = ctx.player.group.position;
    const S = BOSS.SHOT;
    const spread = S.MIS_SPREAD;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spread;
      const d = aim(player.x, player.z, off);
      // each dart takes a cannon pod so they visibly leave different barrels
      const ci = i % this._cannons.length;
      const c = this._cannons[ci] || this._cannons[0];
      const origin = c
        ? this.group.localToWorld(_mw.copy(c.position)).clone()
        : this.position.clone();
      this._pending.push({
        origin, dir: d.clone(),
        speed: S.MIS_SPEED,
        damage: S.MIS_DAMAGE,
        scale: 1.5,
        kind: 'orb', // replaced by the homing visuals via homing:true
        life: 5,
        homing: true,
        homingSpeed: S.MIS_SPEED,
        turnRate: S.MIS_TURN,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    }
  }

  /**
   * GALAGA 2 boss difficulty: escort top-ups. While the boss is alive,
   * a fresh pair of escort fighters (interceptor / elite / scout) drips
   * in behind the formation on a randomised cadence, so the fight never
   * goes quiet between boss volleys. The pool grows unbounded via
   * acquireEnemy's factory fallback — a boss fight outlasts any cap.
   * GALAGA 2 escort pass: squads now arrive faster (see BOSS.ESCORT
   * intervals) and in groups of THREE instead of two.
   */
  _updateEscorts(game, dt) {
    if (!this.alive) return;
    this._escortTimer -= dt;
    if (this._escortTimer > 0) return;
    this._escortTimer =
      BOSS.ESCORT.INTERVAL_MIN +
      Math.random() * (BOSS.ESCORT.INTERVAL_MAX - BOSS.ESCORT.INTERVAL_MIN);
    const types = BOSS.ESCORT.TYPES;
    for (let i = 0; i < 3; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const side = Math.random() < 0.5 ? -1 : 1;
      const enemy = game.acquireEnemy(type);
      if (!enemy) continue;
      const x = side * (10 + Math.random() * 8);
      const y = BOSS.ESCORT.Y[0] + Math.random() * (BOSS.ESCORT.Y[1] - BOSS.ESCORT.Y[0]);
      const z = -34 - Math.random() * 14;
      const slot = new THREE.Vector3(x, y, z);
      // enter from the classic arc so the top-up reads as a fresh squad
      enemy.configure({
        slot,
        index: 0,
        spawnFrom: new THREE.Vector3(x * 1.8, 8 + Math.random() * 6, -85 - Math.random() * 10),
        hpScale: 1,
        approach: false,
      });
      game.addEnemy(enemy);
      game.waveSystem.enemySpawned(); // count it so isComplete waits for it
    }
  }

  /**
   * GALAGA 2: the expanding ring, on its own cadence (phases 2 AND 3).
   * Keeps the forward attack frequent while the surrounding halo opens
   * up on a slower beat, so the player threads a gap rather than sitting
   * in a wall of mines. Phase 3 widens the ring (12 vs 8) and speeds it
   * up (9 vs 8) — a visible pressure step, not just an HP bar change.
   */
  _maybeFireRing(game, dt, player) {
    if (this.phase < 2) return;
    this._ringTimer -= dt;
    if (this._ringTimer <= 0) {
      // phase 3: tighter cadence + bigger/faster ring
      this._ringTimer = this.phase === 3 ? 2.2 : 2.9;
      this._fireRing(game, player, this.phase === 3
        ? { count: BOSS.SHOT.RING_P3, speed: BOSS.SHOT.RING_P3_SPEED }
        : { count: BOSS.SHOT.RING_P2, speed: BOSS.SHOT.RING_P2_SPEED });
    }
  }

  /**
   * GALAGA 2: fire a ring of mines radiating outward from the BOSS's
   * core on a tilted near-horizontal ring. The ring expands across the
   * field like a shockwave; the player dodges by slipping through the
   * plane (vertical room) or dashing past its edge. Firing from the
   * boss — not from around the player — keeps the origin readable and
   * the dodge fair.
   */
  _fireRing(game, player, opts) {
    const ctx = game._context;
    const wave = ctx.wave;
    const count = opts.count;
    const speed = opts.speed + wave * 0.2;
    const tilt = 0.18; // slight upward pitch of the ring plane
    const cy = Math.cos(tilt), sy = Math.sin(tilt);
    const bp = this.group.position;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      // radial direction in the ring plane (x-z), then tilt up
      const rx = Math.cos(a);
      const rz = Math.sin(a);
      _dir.set(rx, sy, rz * cy).normalize();
      // spawn at the boss core; the expanding ring reaches the player
      // after a readable delay (speed ~8-9 vs ~30+ units of distance)
      this._pending.push({
        origin: bp.clone(),
        dir: _dir.clone(), speed, damage: 18,
        scale: 0.6, kind: 'orb', life: 7,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    }
  }

  /** Reset pending shots; call on death / reconfigure. */
  _clearPending() {
    this._pending.length = 0;
    for (const c of this._cannons) c.scale.set(0.45, 0.45, 0.8);
  }

  /**
   * GALAGA 2: the forward lunge (phases 2/3 only). Every 6-9s the
   * dreadnought surges ~14 units toward the player (z -50 -> -36),
   * holds for a beat, then eases back. The offset eases in/out so the
   * surge reads as a deliberate lunge, not a teleport.
   */
  /**
   * GALAGA 2: exact future-position prediction for auto-aim (see
   * Enemy.predictPositionAt). The boss patrols on low-frequency sines and
   * lunges via a damped z-offset, so evaluating those at `this._t + t`
   * gives the true position when the shot arrives.
   */
  predictPositionAt(t, out) {
    const T = this._t + t;
    if (this.entering) {
      // exponential z-approach to BOSS.Z; x drifts as the integral of the
      // sin(this._t * 0.6) * 2 term (matches the update's x velocity)
      out.z = BOSS.Z + (this.group.position.z - BOSS.Z) * Math.exp(-1.4 * t);
      out.x = this.group.position.x + 2 * (Math.sin(T * 0.6) - Math.sin(this._t * 0.6));
      out.y = this.group.position.y;
      return out;
    }
    out.x = Math.sin(T * 0.4) * 7;
    out.y = this._patrolY + Math.sin(T * 0.7) * 2.5;
    const lungZ = this._lungTarget + (this._lungZ - this._lungTarget) * Math.exp(-2.2 * t);
    out.z = BOSS.Z + Math.sin(T * 0.5) * 4 + lungZ;
    return out;
  }

  _updateLung(dt) {
    if (this.phase < 2) {
      this._lungZ = THREE.MathUtils.damp(this._lungZ, 0, 3, dt);
      return;
    }
    this._lungTimer -= dt;
    if (this._lungTimer <= 0) {
      // pick a target: surged forward or back to patrol
      const surging = this._lungZ < 6;
      this._lungTarget = surging ? 14 : 0;
      this._lungTimer = surging ? 1.6 : 6 + Math.random() * 3;
    }
    this._lungZ = THREE.MathUtils.damp(this._lungZ, this._lungTarget ?? 0, 2.2, dt);
  }

  _pulseCore() {
    if (this._core) this._core.scale.setScalar(2.2); // bigger flare: impact pass
    if (this._vent) this._vent.material.emissiveIntensity = 6.0; // phase-change flare
  }

  /** Return true when this hit destroyed the boss. */
  hit(damage) {
    if (!this.alive) return true;
    // Invincible during the entry window (fly-in to the patrol ring OR the
    // 3s minimum grace, whichever ends last): the boss spends its entry
    // crossing the player's firing line, so early volleys — plus stray shots
    // still in flight — would otherwise chip a big chunk of its HP pool
    // before it even starts attacking. Returning false makes the
    // CollisionSystem treat it as a non-lethal hit: the shot is spent on the
    // shield with a spark and a tick, zero damage.
    if (this.entering || this._invuln > 0) return false;
    this.hp -= damage;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }
}
