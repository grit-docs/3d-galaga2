/**
 * Player.js
 * ---------------------------------------------------------------
 * The player craft.
 * - Acceleration based lateral movement with drag (no instant snap).
 * - Bank / lean into turns, ease back to level.
 * - Dash with invulnerability + cooldown.
 * - Shield / life management, brief hit invulnerability.
 * - Weapon state (level, rapid) used by the
 *   ProjectileSystem to decide what to spawn.
 * Owns its own 3D group; systems read/write its state.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOUNDS, PLAYER, WEAPON, BOMBA } from '../config.js';
import { buildPlayerShip } from './ShipBuilder.js';

/** Scratch vectors reused every frame to avoid allocation. */
const _bankTarget = new THREE.Vector3();

export class Player {
  constructor() {
    this.group = buildPlayerShip();
    this.group.name = 'player';
    // Visual size: 0.63 (base) × 0.9 × 0.9 × 0.8 × 0.8 (four requested
    // reductions) = 0.3266 of the original hull. The collision radius
    // (`this.radius`) is scaled with the same factor so the hitbox matches.
    this.group.scale.setScalar(0.63 * 0.9 * 0.9 * 0.8 * 0.8);

    this.velocityX = 0;
    this.velocityY = 0;
    this.alive = true;
    this.visible = true;

    this.lives = PLAYER.MAX_LIVES;
    this.shield = PLAYER.MAX_SHIELD;
    this.invulnTimer = 0;
    this.shieldBreakTimer = 0;
    this.shieldStripped = false;

    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashDir = 0;
    // GALAGA 2: seconds since the last applied hit — drives passive
    // shield regen (risk/reward for weaving through fire)
    this._timeSinceHit = 0;

    // weapon upgrades
    this.weaponLevel = 1;
    this.rapidLevel = 0; // permanent Rapid stack (cap: WEAPON.RAPID_MAX_LEVEL)
    // GALAGA 2: BOMBA stock — per-run (resets on ship destruction, not on
    // respawn within the same run), like the upgrade card levels.
    this.bombaCount = BOMBA.COUNT_START;
    // GALAGA 2: per-run upgrade card levels (wave-clear selection).
    // Reset with the run, not the ship — they persist through deaths.
    this.upg = {
      dmg: 0,       // weapon damage multiplier  x(1 + 0.25 * dmg)
      rate: 0,      // fire rate multiplier      x(1 + 0.18 * rate)
      speed: 0,     // projectile speed          x(1 + 0.14 * speed)
      shieldCap: 0, // +30 max shield each
      regen: 0,     // shield regen rate         x(1 + 0.6 * regen)
      score: 0,     // score multiplier          x(1 + 0.15 * score)
      // GALAGA 2 tier-2 (wave TIER2_START+): enhanced card levels
      t2plasma: 0,  // laser damage              x(1 + 0.40 * t2plasma)
      t2pierce: 0,  // +1 pierce hit per level (cap 2)
      t2bomba: 0,   // +1 BOMBA cap, +50% BOMBA damage
      t2regen: 0,   // regen rate x(1 + 1.2 * t2regen), delay -2s/level
      t2score: 0,   // score multiplier          x(1 + 0.30 * t2score)
    };

    this._collectEngines();

    this._t = 0;
    // 1.35 base x 0.9 x 0.8 x 0.8 (the player-size reductions) = 0.7776
    this.radius = 1.35 * 0.9 * 0.8 * 0.8;
  }

  _collectEngines() {
    const list = [];
    this._plumes = [];
    this._shieldAura = null;
    this.group.traverse((o) => {
      if (o.name === 'engine') list.push(o);
      else if (o.name === 'plume') this._plumes.push(o);
      else if (o.name === 'shieldAura') this._shieldAura = o;
    });
    this._engines = list;
    this._shieldAuraCells = this._shieldAura ? this._shieldAura.children : [];
  }

  reset() {
    this.group.position.set(0, BOUNDS.PLAYER_Y, BOUNDS.PLAYER_Z);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.velocityX = 0;
    this.velocityY = 0;
    this.alive = true;
    this.visible = true;
    this.lives = PLAYER.MAX_LIVES;
    this.shield = PLAYER.MAX_SHIELD;
    this.invulnTimer = PLAYER.RESPAWN_INVULN_TIME;
    this.shieldBreakTimer = 0;
    this.shieldStripped = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashDir = 0;
    this._timeSinceHit = 0;
    this.weaponLevel = 1;
    this.rapidLevel = 0;
    // per-run upgrade cards reset with the run
    this.upg.dmg = 0;
    this.upg.rate = 0;
    this.upg.speed = 0;
    this.upg.shieldCap = 0;
    this.upg.regen = 0;
    this.upg.score = 0;
    // GALAGA 2: tier-2 card levels (wave TIER2_START+)
    this.upg.t2plasma = 0;
    this.upg.t2pierce = 0;
    this.upg.t2bomba = 0;
    this.upg.t2regen = 0;
    this.upg.t2score = 0;
  }

  get position() {
    return this.group.position;
  }

  /** Max shield including the wave-clear "확장 실드" cards. */
  maxShield() {
    return PLAYER.MAX_SHIELD + this.upg.shieldCap * 30;
  }

  /** GALAGA 2: BOMBA stock cap — base COUNT_MAX + T2 expansions. */
  bombaMax() {
    return BOMBA.COUNT_MAX + this.upg.t2bomba;
  }

  /** GALAGA 2: BOMBA blast damage — T2 expansion adds +50%/level. */
  bombaDamage() {
    return BOMBA.DAMAGE * (1 + 0.5 * this.upg.t2bomba);
  }

  /** Current weapon stats resolved from level + temporary buffs +
   *  per-run upgrade cards (wave-clear selection). */
  weaponStats() {
    const i = Math.min(this.weaponLevel - 1, WEAPON.COUNTS.length - 1);
    return {
      count: WEAPON.COUNTS[i],
      baseSpeed: (WEAPON.PROJECTILE_SPEED + WEAPON.SPEED_BONUS[i])
        * (1 + 0.14 * this.upg.speed),
      baseDamage: (WEAPON.DAMAGE + WEAPON.DMG_BONUS[i])
        * (1 + 0.25 * this.upg.dmg)
        * (1 + 0.40 * this.upg.t2plasma), // GALAGA 2 T2: 플라스마 코어
      baseRate: (WEAPON.FIRE_RATE + this.rapidLevel * WEAPON.RAPID_RATE_PER_LEVEL)
        * (1 + 0.18 * this.upg.rate),
      // GALAGA 2 T2: 강화 관통 레이저 — +1 pierce hit per level
      pierce: this.upg.t2pierce,
      rapid: this.rapidLevel > 0,
      rapidLevel: this.rapidLevel,
    };
  }

  /**
   * @param input   InputManager
   * @param dt      delta seconds
   * @param now     elapsed game time (for timers)
   */
  update(input, dt, now) {
    this._t += dt;

    // --- timers -------------------------------------------------
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.shieldBreakTimer > 0) {
      this.shieldBreakTimer -= dt;
      if (this.shieldBreakTimer <= 0) {
        this.shieldStripped = true;
        this.shield = 0;
        this.invulnTimer = Math.max(this.invulnTimer, 0.18);
      }
    }

    if (!this.alive) return;

    // --- passive shield regen (GALAGA 2 risk/reward) ------------
    // After SHIELD_REGEN_AFTER s without a hit, the shield creeps
    // back up slowly, so weaving through enemy fire pays off.
    // GALAGA 2 T2: 나노 실드 shortens the delay (−2s/level, min 1s)
    // and multiplies the regen rate.
    this._timeSinceHit += dt;
    const regenDelay = Math.max(1, PLAYER.SHIELD_REGEN_AFTER - 2 * this.upg.t2regen);
    if (this._timeSinceHit >= regenDelay &&
        this.shield < this.maxShield()) {
      this.shield = Math.min(
        this.maxShield(),
        this.shield + PLAYER.SHIELD_REGEN_RATE
          * (1 + 0.6 * this.upg.regen)
          * (1 + 1.2 * this.upg.t2regen) * dt);
    }

    // --- lateral movement --------------------------------------
    let axis = this.dashTimer > 0 ? this.dashDir : input.axisX;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.velocityX = this.dashDir * PLAYER.DASH_SPEED;
    } else {
      // Accel/drag model (restored, with halved acceleration) — see the
      // old direct input→version that felt too snappy.
      const accel = PLAYER.ACCEL_X * dt;
      this.velocityX += axis * accel;
      // drag / decel
      this.velocityX -= this.velocityX * Math.min(1, PLAYER.DRAG * dt);
      // clamp
      const max = PLAYER.MAX_SPEED_X;
      if (this.velocityX > max) this.velocityX = max;
      else if (this.velocityX < -max) this.velocityX = -max;
    }

    this.group.position.x += this.velocityX * dt;
    if (this.group.position.x > BOUNDS.PLAYER_MAX_X) {
      this.group.position.x = BOUNDS.PLAYER_MAX_X;
      this.velocityX = 0;
    } else if (this.group.position.x < BOUNDS.PLAYER_MIN_X) {
      this.group.position.x = BOUNDS.PLAYER_MIN_X;
      this.velocityX = 0;
    }

    // --- vertical movement (GALAGA 2) --------------------------
    // Same accel/drag model as X; the craft now flies in a Y band
    // (BOUNDS.PLAYER_MIN_Y..PLAYER_MAX_Y) instead of a fixed rail.
    const vAxis = input.axisY;
    const vAccel = PLAYER.ACCEL_Y * dt;
    this.velocityY += vAxis * vAccel;
    this.velocityY -= this.velocityY * Math.min(1, PLAYER.DRAG_Y * dt);
    const vMax = PLAYER.MAX_SPEED_Y;
    if (this.velocityY > vMax) this.velocityY = vMax;
    else if (this.velocityY < -vMax) this.velocityY = -vMax;
    this.group.position.y += this.velocityY * dt;
    if (this.group.position.y > BOUNDS.PLAYER_MAX_Y) {
      this.group.position.y = BOUNDS.PLAYER_MAX_Y;
      this.velocityY = 0;
    } else if (this.group.position.y < BOUNDS.PLAYER_MIN_Y) {
      this.group.position.y = BOUNDS.PLAYER_MIN_Y;
      this.velocityY = 0;
    }
    // keep a tiny hover bob for life (added on top of the free Y)
    this.group.position.y += Math.sin(this._t * 2.2) * 0.02;
    // the craft never advances in Z (prevents any drift from
    // muzzle-kick style nudges accumulating).
    this.group.position.z = BOUNDS.PLAYER_Z;

    // --- banking + pitch ----------------------------------------
    // roll (z) follows lateral speed, pitch (x) follows vertical
    // speed — both ease back to level. The old "pitch with forward
    // speed" term is folded into the vertical-speed pitch.
    const speedRatio = THREE.MathUtils.clamp(this.velocityX / PLAYER.MAX_SPEED_X, -1, 1);
    const vRatio = THREE.MathUtils.clamp(this.velocityY / PLAYER.MAX_SPEED_Y, -1, 1);
    _bankTarget.set(0, 0, -speedRatio * PLAYER.BANK_TILT);
    const targetX = -vRatio * PLAYER.PITCH_TILT + speedRatio * PLAYER.BANK_Z * 0.4;
    const lerp = Math.min(1, PLAYER.BANK_LERP * dt);
    this.group.rotation.z += (_bankTarget.z - this.group.rotation.z) * lerp;
    this.group.rotation.x += (targetX - this.group.rotation.x) * lerp;

    // --- engine / invuln visuals --------------------------------
    // On-craft shield readout (GALAGA 2): engine flame hue tracks the
    // shield ratio (cyan -> orange -> red, blinking when critical) and
    // the shield aura's opacity tracks remaining %, so you never have
    // to look up at the HUD to know your margin.
    const shieldR = THREE.MathUtils.clamp(this.shield / this.maxShield(), 0, 1);
    const collapseRatio = this.shieldBreakTimer > 0 ? THREE.MathUtils.clamp(this.shieldBreakTimer / 0.26, 0, 1) : 0;
    const visualShieldR = this.shieldBreakTimer > 0 ? Math.max(0.08, collapseRatio * 0.25) : shieldR;
    const hideShield = visualShieldR <= 0.2 || this.shieldStripped;
    const engineGlow = 1.6 + Math.abs(speedRatio) * 1.2 + Math.sin(this._t * 30) * 0.25;
    const isStripped = this.shieldStripped;
    // the three flame cores share ONE material — set the hue once
    const flameMat = this._engines.length && this._engines[0].material;
    if (flameMat) {
      if (isStripped) flameMat.emissive.setHex(0xff4d4d);
      else if (visualShieldR > 0.6) flameMat.emissive.setHex(0x8ff8ff);
      else if (visualShieldR > 0.3) flameMat.emissive.setHex(0xffa53a);
      else flameMat.emissive.setHex(Math.sin(this._t * 16) > 0 ? 0xff3b3b : 0xff8c5a);
    }
    for (const e of this._engines) {
      const s = 0.2 + Math.min(0.5, Math.abs(speedRatio) * 0.4) + Math.sin(this._t * 40) * 0.04;
      e.scale.set(s, s, 0.3 * (1 + Math.min(1, Math.abs(speedRatio))));
      e.material.emissiveIntensity = engineGlow;
    }
    if (this._shieldAura) {
      if (!hideShield && !isStripped && visualShieldR > 0.01) {
        this._shieldAura.visible = true;
        let op;
        if (visualShieldR > 0.6) {
          op = 0.12 + 0.08 * ((visualShieldR - 0.6) / 0.4);
          for (const c of this._shieldAuraCells) c.material.color.setHex(0x35e6ff);
        } else if (visualShieldR > 0.3) {
          op = 0.10 + 0.06 * ((visualShieldR - 0.3) / 0.3);
          for (const c of this._shieldAuraCells) c.material.color.setHex(0xffa53a);
        } else {
          op = 0.06 + 0.06 * (visualShieldR / 0.3) + (Math.sin(this._t * 10) * 0.5 + 0.5) * 0.02;
          for (const c of this._shieldAuraCells) c.material.color.setHex(0xff4040);
        }
        for (const c of this._shieldAuraCells) {
          c.material.opacity = op;
          c.scale.setScalar(1 + Math.sin(this._t * 2.4 + c.position.x * 2.2) * 0.04);
        }
        this._shieldAura.scale.setScalar(1 + Math.sin(this._t * 2.2) * 0.01);
      } else {
        this._shieldAura.visible = false;
      }
    }
    // GALAGA 2 forward view: engine trail — the plumes stretch with
    // lateral speed and hard during dashes, so maneuvering reads as a
    // burst of high-speed flight (the craft always flies forward).
    if (this._plumes) {
      const trailStretch = 1 + Math.min(1.5, Math.abs(speedRatio) * 0.9) +
        (this.dashTimer > 0 ? 1.2 : 0) + Math.sin(this._t * 32) * 0.05;
      for (const pl of this._plumes) {
        pl.scale.z = 0.14 * trailStretch;
      }
    }

    // --- invulnerability flicker (subtle) ------------------------
    if (this.invulnTimer > 0) {
      this.group.visible = Math.sin(this._t * 28) > -0.6;
    } else {
      this.group.visible = true;
    }

    // --- dash trigger ------------------------------------------
    if (input.dashPressed && this.dashCooldown <= 0 && this.dashTimer <= 0) {
      this.dashTimer = PLAYER.DASH_TIME;
      this.dashDir = input.axisX !== 0 ? input.axisX : Math.sign(this.velocityX) || 1;
      this.dashCooldown = PLAYER.DASH_COOLDOWN;
      this.invulnTimer = Math.max(this.invulnTimer, PLAYER.DASH_INVULN);
    }
  }

  takeDamage(amount) {
    if (this.invulnTimer > 0 || !this.alive) return false;
    if (this.shieldBreakTimer > 0) return false;
    // GALAGA 2: any applied hit pauses passive shield regen
    this._timeSinceHit = 0;

    if (this.shieldStripped) {
      this.lives -= 1;
      this.shieldStripped = false;
      this.shield = 0;
      this.invulnTimer = PLAYER.INVULN_TIME;
      if (this.lives <= 0) {
        this.alive = false;
        this.visible = false;
        this.group.visible = false;
        return 'dead';
      }
      return 'lostLife';
    }

    this.shield -= amount;
    if (this.shield <= 0) {
      this.shield = 0;
      this.shieldBreakTimer = 0.26;
      this.invulnTimer = Math.max(this.invulnTimer, 0.18);
      return 'shieldBreak';
    }
    return 'hit';
  }

  heal(amount = 45) {
    // clamp to [0, MAX] — negative amounts (elite capture-beam chip)
    // simply reduce shield, never driving it below zero.
    this.shieldBreakTimer = 0;
    this.shieldStripped = false;
    this.shield = Math.max(0, Math.min(this.maxShield(), this.shield + amount));
  }

  /** +1 Rapid level (permanent, capped). Each level adds fire rate. */
  grantRapid() {
    this.rapidLevel = Math.min(WEAPON.RAPID_MAX_LEVEL, this.rapidLevel + 1);
  }

  /** Wipe collected upgrades (weapon + Rapid) — called on ship destruction. */
  resetCollected() {
    this.weaponLevel = 1;
    this.rapidLevel = 0;
  }

  upgradeWeapon() {
    this.weaponLevel = Math.min(WEAPON.MAX_LEVEL, this.weaponLevel + 1);
  }
}
