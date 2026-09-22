/**
 * CollisionSystem.js
 * ---------------------------------------------------------------
 * Central place for all gameplay collisions. Uses simple distance
 * checks (bounding-sphere semantics) — plenty fast and matches the
 * spec's "BoundingSphere / BoundingBox" requirement.
 *
 * Detected interactions:
 *   player-shot  ↔ enemy
 *   player-shot  ↔ boss
 *   enemy-shot   ↔ player
 *   power-up     ↔ player
 *   enemy        ↔ player
 * ---------------------------------------------------------------
 */

import { POWERUP } from '../config.js';

const RAM_DAMAGE = 40;

export class CollisionSystem {
  constructor(game) {
    this._game = game;
    this._game.onScore = null; // Game wires this up
    this._game.onEnemyKilled = null;
    this._game.onPlayerHit = null;
    this._game.onPowerUpTaken = null;
    this._game.onBossKilled = null;
  }

  update(dt = 1 / 60) {
    const g = this._game;
    const ctx = g._context;
    const projectiles = ctx.projectiles.activeProjectiles;
    const powerups = ctx.projectiles.activePowerups;
    const enemies = [...g._context.enemyList]; // snapshot: kills splice the live list mid-frame
    const boss = ctx.boss;
    const player = ctx.player;

    if (!player.alive) return;

    // player shot -> enemy / boss
    for (const p of projectiles) {
      if (!p.active || p.hostile) continue;
      const pp = p.group.position;
      let consumed = false;

      // enemy collision
      // GALAGA 2: full 3D sphere test. The old x/z-plane rule existed
      // because player lasers flew at a fixed y while enemies swooped
      // high. Now shots fly in 3D toward the aim reticle (and the
      // player's altitude is bounded to -0.5..4.5, matching the
      // formation band y 0..4), so a strict 3D test is fair: shots
      // connect when aimed, and a laser physically flying over/under a
      // bug is a real miss — readable via the reticle.
      for (const e of enemies) {
        if (!e.active || e.dying) continue;
        const ep = e.group.position;
        const dx = pp.x - ep.x;
        const dy = pp.y - ep.y;
        const dz = pp.z - ep.z;
        const r = p.radius + e.radius;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          const killed = e.hit(p.damage);
          if (p.pierce > 0) {
            p.pierce -= 1;
          } else {
            p.kill();
            consumed = true;
          }
          if (killed) {
            this._game.onEnemyKilled?.(e, pp);
            if (p.active) continue;
          } else {
            // multi-HP enemy (heavy/elite): make the hit readable so it
            // doesn't feel like the shot 'missed'. Sparks + scale punch
            // + a soft tick on every non-lethal impact.
            this._hitFlash(e, pp);
            if (!p.active) break;
          }
          break;
        }
      }

      if (p.active && boss && boss.alive) {
        // GALAGA 2: same full-3D sphere rule as regular enemies
        // (BOSS.RADIUS is used as-is per the spec)
        const dx = pp.x - boss.position.x;
        const dy = pp.y - boss.position.y;
        const dz = pp.z - boss.position.z;
        const r = p.radius + boss.radius;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          const killed = boss.hit(p.damage);
          if (p.pierce > 0) p.pierce -= 1; else p.kill();
          if (killed) {
            this._game.onBossKilled?.(boss, pp);
          } else {
            this._hitFlash(boss, pp);
          }
        }
      }

      if (consumed) continue;
    }

    // enemy shot -> player
    for (const p of projectiles) {
      if (!p.active || !p.hostile) continue;
      const pp = p.group.position;
      const plp = player.group.position;
      const dx = pp.x - plp.x;
      const dy = pp.y - plp.y;
      const dz = pp.z - plp.z;
      const r = p.radius + player.radius;
      if (dx * dx + dy * dy + dz * dz < r * r) {
        this._game.onPlayerHit?.(p.damage);
        p.kill();
      }
    }

    // enemy craft -> player (ram) — reuse the snapshot above; a ram
    // kill splices the LIVE list mid-frame, so we must not re-snapshot.
    if (player.alive) {
      for (const e of enemies) {
        if (!e.active || e.dying || !e.isDiving()) continue;
        const ep = e.group.position;
        const plp = player.group.position;
        const dx = ep.x - plp.x;
        const dz = ep.z - plp.z;
        const dy = ep.y - plp.y;
        const r = e.radius + player.radius;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          const killed = e.hit(999); // ram = instant kill
          this._game.onPlayerHit?.(RAM_DAMAGE);
          if (killed) this._game.onEnemyKilled?.(e, ep);
        }
      }
    }

    // powerup -> player
    // GALAGA 2: magnet / auto-absorb. Inside MAGNET_RADIUS the pickup is
    // pulled toward the craft (accel capped at MAGNET_MAX_SPEED) and then
    // eaten on contact, so you no longer have to thread the exact falling
    // line. Outside the radius it keeps its normal drift/fall.
    const plp0 = player.group.position;
    const mR = POWERUP.MAGNET_RADIUS;
    for (const pu of powerups) {
      if (!pu.active) continue;
      const pp = pu.group.position;
      let dx = plp0.x - pp.x;
      let dy = plp0.y - pp.y;
      let dz = plp0.z - pp.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < mR) {
        // accelerate toward the player, capped, and let it ride in
        const inv = 1 / (dist || 1);
        const speed = Math.min(POWERUP.MAGNET_MAX_SPEED,
          dist * (POWERUP.MAGNET_ACCEL * 0.5) + POWERUP.MAGNET_ACCEL * dt);
        pu.magnetVX = dx * inv * speed;
        pu.magnetVY = dy * inv * speed;
        pu.magnetVZ = dz * inv * speed;
      }
      // contact check (slightly generous radius so a magnetized pickup
      // always lands)
      const r = 1.6 + player.radius;
      if (dx * dx + dy * dy + dz * dz < r * r) {
        this._game.onPowerUpTaken?.(pu);
        pu.kill();
      }
    }
  }

  /** Small impact spark when a shot connects but does not kill. */
  _hitFlash(entity, at) {
    const ctx = this._game._context;
    entity._hitFlash = 1; // ship scale-punch, read in the entity's update
    for (let i = 0; i < 3; i++) {
      ctx.particles?.spawn(at, {
        color: 0xcfeeff,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        vz: -5 - Math.random() * 3,
        life: 0.22,
        drag: 3,
        gravity: 0,
      });
    }
    this._game.audio?.play?.('hitTick');
  }
}
