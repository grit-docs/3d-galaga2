/**
 * config.js
 * ---------------------------------------------------------------
 * Single source of truth for gameplay tuning values.
 * Keeping every magic number here keeps entity/system code clean
 * and makes balancing easy to iterate on.
 * ---------------------------------------------------------------
 */

export const GAME = {
  TITLE: 'GALAGA 2',
  MAX_DELTA: 0.05, // clamp large frame deltas (tab switches etc.)
  HIGH_SCORE_KEY: 'nebula-strike.highscore',
  SETTINGS_KEY: 'nebula-strike.settings',
};

/** Playable battlefield extents (world units). */
export const BOUNDS = {
  // GALAGA 2: wider arena — the craft gets more horizontal room too
  PLAYER_MIN_X: -23,
  PLAYER_MAX_X: 23,
  PLAYER_Y: 1.1, // resting altitude (camera/look framing is tuned to this)
  // GALAGA 2: the craft flies freely in Y as well as X — the rail is now
  // a vertical band instead of a fixed height. The floor is kept above
  // -0.5 so the craft never sinks to the bottom edge of the screen
  // (it reads as leaving the battlefield and covers the HUD).
  PLAYER_MIN_Y: -0.5,
  PLAYER_MAX_Y: 9.5,
  PLAYER_Z: 17,

  FORMATION_Z_MIN: -34,
  FORMATION_Z_MAX: -46,
};

export const PLAYER = {
  // Movement 20% faster via accel 60→72 (cruise = ACCEL/DRAG, the real
  // speed; MAX_SPEED_X is just a never-hit safety cap).
  // ~12% faster: accel 72→80 / 60→67 (cruise 8 / 6.7).
  // GALAGA 2: +10% craft speed (accel 80→88 / 67→73.7, cruise ×1.1).
  ACCEL_X: 88,
  MAX_SPEED_X: 36,
  DRAG: 9,
  // GALAGA 2: vertical (Y) axis uses the same accel/drag model as X.
  ACCEL_Y: 73.7,
  MAX_SPEED_Y: 28,
  DRAG_Y: 10,
  BANK_TILT: 0.55,
  BANK_Z: 0.18,
  BANK_LERP: 8,
  // pitch (nose up/down) follows vertical speed — subtle, like the bank.
  PITCH_TILT: 0.35,

  MAX_LIVES: 3,
  MAX_SHIELD: 100,
  INVULN_TIME: 2.0,
  RESPAWN_INVULN_TIME: 2.6,

  DASH_SPEED: 55,
  DASH_TIME: 0.16,
  // 0.9s read as "free to spam"; bumped to 10s so every dodge is a
  // deliberate, high-stakes commit (bar refills slowly on the HUD)
  DASH_COOLDOWN: 10,
  DASH_INVULN: 0.22,

  HIT_DAMAGE: 34,

  // GALAGA 2: passive shield regen creates a risk/reward loop — you can
  // chip damage down, but 5s without a hit lets the shield slowly creep
  // back, so weaving through fire is rewarded rather than punishing.
  SHIELD_REGEN_AFTER: 5,   // seconds since last hit before regen starts
  SHIELD_REGEN_RATE: 3,    // shield points / second while regenerating
};

export const WEAPON = {
  // Shared fire cadence (shots per second) — applies to BOTH hold
  // auto-fire and manual taps: a shot only fires once the previous one's
  // cooldown (1/FIRE_RATE) has elapsed, so rapid tapping can't outrun the 
  // cadence. Base: 2 shots/sec (1 per 0.5s). The RAPID buff adds
  // RAPID_BONUS for its duration (2.0 -> 2.5 sps, i.e. 0.5s -> 0.4s).
  FIRE_RATE: 2.0, // shots per second, base (permanent)
  // RAPID now stacks PERMANENTLY: each Rapid pickup adds one level (capped
  // at RAPID_MAX_LEVEL), and each level adds RAPID_RATE_PER_LEVEL to the rate.
  RAPID_RATE_PER_LEVEL: 0.4,
  RAPID_MAX_LEVEL: 3,
  // Base single-shot laser
  PROJECTILE_SPEED: 52,
  DAMAGE: 10,
  // per-level upgrades (index = weaponLevel-1)
  COUNTS: [1, 2, 3, 3, 3],
  // All shots fire dead straight ahead — the diagonal fan was cut on
  // request (every level = N parallel forward lasers from the same
  // muzzle, so upgrades still scale damage, just with no side spread).
  SPEED_BONUS: [0, 0, 4, 8, 12],
  DMG_BONUS: [0, 5, 5, 10, 12],
  MAX_LEVEL: 5,
};

/**
 * GALAGA 2: BOMBA — the classic one-shot board clearer.
 * Starts with COUNT_START; refilled by picking up the BOMBA power-up
 * drop that enemies drop (capped at COUNT_MAX).
 * Using it now LAUNCHES A MISSILE: pressing L fires a rocket that flies
 * straight forward for FLIGHT_TIME (s) and DETONATES at the formation
 * (z DETONATE_Z). The board-clear — wiping every hostile shot and dealing
 * DAMAGE to all live enemies (and the boss) — happens at the DETONATION,
 * not the instant L is pressed.
 */
export const BOMBA = {
  COUNT_START: 1,
  COUNT_MAX: 3,
  DAMAGE: 40,
  // missile flight — the BOMBA is a LAUNCHED SALVO (Macross-style), not
  // an instant flash-bang. FLIGHT_TIME is how long the lead missile
  // travels before the first explosion; DETONATE_Z is the world depth
  // each missile detonates at (formation centre). Flight speed is
  // derived in BombaMissile as (launch z -> DETONATE_Z) / FLIGHT_TIME.
  FLIGHT_TIME: 2.0,
  DETONATE_Z: -40,
  // SALVO — the "dozens of torpedoes" look: SALVO_COUNT missiles launch
  // from a ring AROUND the craft (fanning out radially from the hull)
  // and stream forward over SALVO_STREAM seconds. Every missile then
  // HOMES on a live enemy (assigned round-robin at launch, retargeted
  // if the target dies), curving at a capped SALVO_TURN so the swarm
  // arcs visibly. Detonation: within SALVO_LOCK of the target, else at
  // the formation depth / FLIGHT_TIME backstop.
  SALVO_COUNT: 24,
  SALVO_STREAM: 0.35,  // whole ring streams out of the hull over this (s)
  SALVO_TURN: 2.4,     // homing turn cap (rad/s) — visible arcs, not rail
  SALVO_LOCK: 2.4,     // detonation distance from the target (world units)
};

export const SCORE_VALUES = {
  fighter: 100,
  interceptor: 150,
  heavy: 300,
  elite: 500,
  boss: 5000,
  DIVE_BONUS: 120, // bonus per kill while enemy is on a dive
};

/**
 * GALAGA 2: wave-clear upgrade selection (Vampire Survivors-style).
 * Each cleared wave offers 3 random cards; one is applied permanently.
 * A card disappears from the pool once its level reaches `cap`.
 * `level(p)` reads the player's current level, `apply(p)` bumps it.
 */
export const UPGRADE = {
  OFFERS: 3, // cards shown per wave clear
  // GALAGA 2: auto-upgrade (A plan). When ON, every wave clear applies
  // the "most needed" card instantly — no freeze, no panel. A short
  // bottom toast reports the pick and offers an UNDO (restores the
  // exact pre-card snapshot). OFF = the classic 3-card panel.
  AUTO_DEFAULT: true,
  AUTO_TOAST_TIME: 2.25, // seconds the undo toast stays on screen
  // GALAGA 2: TIER 2 — the late-game pool. From TIER2_START on, card
  // offers are drawn from POOL + POOL_T2 together, so a run that maxes
  // the base eight keeps getting meaningful picks (the old "pool
  // depletion" wall ~wave 10 disappears). T2 cards are enhanced builds
  // of the base concepts + one BOMBA expansion, each with its own cap
  // keys in player.upg.
  TIER2_START: 10,
  POOL: {
    weapon_dmg: {
      name: '고출력 코어', desc: '레이저 피해 +25%',
      icon: '▲', color: 'var(--neon)',
      cap: 5,
      level: (p) => p.upg.dmg,
      apply: (p) => { p.upg.dmg += 1; },
    },
    weapon_rate: {
      name: '쿨다운 압축', desc: '발사 속도 +18%',
      icon: '⚡', color: 'var(--acid)',
      cap: 3,
      level: (p) => p.upg.rate,
      apply: (p) => { p.upg.rate += 1; },
    },
    weapon_speed: {
      name: '초전도 레일', desc: '탄속 +14%',
      icon: '➤', color: 'var(--neon2)',
      cap: 3,
      level: (p) => p.upg.speed,
      apply: (p) => { p.upg.speed += 1; },
    },
    shield_cap: {
      name: '확장 실드', desc: '최대 실드 +30',
      icon: '◈', color: 'var(--neon3)',
      cap: 3,
      level: (p) => p.upg.shieldCap,
      apply: (p) => {
        p.upg.shieldCap += 1;
        p.shield = Math.min(p.maxShield(), p.shield + 30);
      },
    },
    shield_regen: {
      name: '자가복원', desc: '실드 재생 +60%',
      icon: '✚', color: 'var(--acid)',
      cap: 3,
      level: (p) => p.upg.regen,
      apply: (p) => { p.upg.regen += 1; },
    },
    score_mult: {
      name: '신경링크', desc: '득점 배율 +15%',
      icon: '∞', color: '#ffd166',
      cap: 3,
      level: (p) => p.upg.score,
      apply: (p) => { p.upg.score += 1; },
    },
    heal: {
      name: '에너지 충전', desc: '실드 40 회복',
      icon: '+', color: 'var(--acid)',
      cap: Infinity,
      level: () => 0,
      apply: (p) => { p.heal(40); },
    },
    life: {
      name: '비긴 코어', desc: '생명 +1',
      icon: '♥', color: 'var(--danger)',
      cap: 2,
      level: (p) => p.lives - PLAYER.MAX_LIVES,
      apply: (p) => { p.lives += 1; },
    },
  },
  // ---- TIER 2 (wave TIER2_START+): enhanced late-game picks ----
  POOL_T2: {
    t2_plasma: {
      name: '플라스마 코어', desc: '레이저 피해 +40% (T2)',
      icon: '◮', color: 'var(--neon)',
      cap: 3,
      level: (p) => p.upg.t2plasma,
      apply: (p) => { p.upg.t2plasma += 1; },
    },
    t2_pierce: {
      name: '강화 관통 레이저', desc: '레이저가 적 2기 관통 (T2)',
      icon: '↯', color: 'var(--acid)',
      cap: 2,
      level: (p) => p.upg.t2pierce,
      apply: (p) => { p.upg.t2pierce += 1; },
    },
    t2_bomba: {
      name: 'BOMBA 확장', desc: 'BOMBA 상한 +1, 피해 +50% (T2)',
      icon: '✸', color: '#ffd166',
      cap: 1,
      level: (p) => p.upg.t2bomba,
      apply: (p) => {
        p.upg.t2bomba += 1;
        p.bombaCount = Math.min(p.bombaCount + 1, p.bombaMax());
      },
    },
    t2_regen: {
      name: '나노 실드', desc: '실드 재생 +120%, 재생 대기 2s (T2)',
      icon: '❖', color: 'var(--neon3)',
      cap: 2,
      level: (p) => p.upg.t2regen,
      apply: (p) => { p.upg.t2regen += 1; },
    },
    t2_score: {
      name: '퀀텀 링크', desc: '득점 배율 +30% (T2)',
      icon: '∞', color: '#ff8a3c',
      cap: 3,
      level: (p) => p.upg.t2score,
      apply: (p) => { p.upg.t2score += 1; },
    },
    t2_repair: {
      name: '풀 리페어', desc: '실드 100 회복 + BOMBA +1 (T2)',
      icon: '✚', color: 'var(--acid)',
      cap: Infinity,
      level: () => 0,
      apply: (p) => {
        p.heal(100);
        p.bombaCount = Math.min(p.bombaCount + 1, p.bombaMax());
      },
    },
  },
};

export const COMBO = {
  WINDOW: 2.4, // seconds to keep the chain alive
  MAX_MULTIPLIER: 10,
  STEP: 9, // every N kills the multiplier climbs
};

/**
 * GALAGA 2: game-feel "juice" — hitstop + slow-motion + combo escalation.
 * Tuning follows the modern-arcade reference set (Hades contact-frame
 * hitstop, Everspace 1 time-extender on dash, Vlambeer-style combo tiers):
 * all effects read off the combo tier so the strongest moments stay rare.
 */
export const JUICE = {
  // hitstop: world freezes N seconds per kill; grows with the combo so
  // long chains feel heavier. Kept short (<=40ms) so the flow never
  // stutters — impact, not lag.
  HITSTOP_BASE: 0.022, // s per kill at combo 0-1
  HITSTOP_PER_KILL: 0.005, // extra per combo kill
  HITSTOP_MAX: 0.04, // cap per kill
  // dash slow-mo: the world (enemies + hostile fire) slows to this
  // timescale while you dash — a "time extender" that turns dodging
  // into a superpower. The player keeps full speed (Game.js splits
  // playerDt vs worldDt).
  SLOWMO_SCALE: 0.4,
  SLOWMO_DURATION: 0.26, // s of slow-mo per dash
  // boss-kill: one long freeze as the fight ends
  BOSS_HITSTOP: 0.09,
  BOSS_SLOWMO: 0.5,
  // combo tiers for the kill flair (explosion size / shake / HUD flash)
  COMBO_TIER2: 9, // combo >= 9  -> tier 2
  COMBO_TIER3: 18, // combo >= 18 -> tier 3
};

/** GALAGA 2: mouse aim reticle tuning. */
export const AIM = {
  // max perpendicular distance (world units) between the aim ray and an
  // enemy for the reticle to snap/lock onto it. Kept TIGHT: a large
  // radius lets the orange lock-on grab whatever happens to drift near
  // the aim line, which reads as the reticle moving on its own.
  LOCK_RADIUS: 2.4,
  // lock hysteresis: once locked, the target sticks until the aim ray
  // moves outside LOCK_RADIUS × this factor (prevents flicking between
  // near-miss enemies as the mouse jitters)
  LOCK_HOLD_FACTOR: 1.7,
  // plane the reticle rests on when no enemy is targeted
  FALLBACK_Z: -34,

  // ----------------------------------------------------------------
  // GALAGA 2: AUTO-AIM (default ON) — the craft's shots lock onto the
  // nearest enemy ahead (boss-priority) with lead, so the player only
  // dodges + holds fire. On mobile this removes ALL aiming (aimX/Y stay
  // pinned at screen center; the reticle homes on the target itself).
  // Toggle: menu checkbox / KeyQ / the touch AUTO button. Persisted.
  // ON by default on BOTH desktop and mobile — the player only dodges and
  // holds fire; manual aiming stays available when toggled off.
  AUTO_AIM_DEFAULT: true,
  // clamp the lead time (s) so very fast enemies don't get an absurd
  // aim point far ahead of themselves.
  MAX_LEAD_TIME: 0.5,
  // only auto-target enemies this far IN FRONT of the craft (smaller
  // world-z); bugs behind/level with the player are ignored so we don't
  // waste shots on ships already past the craft.
  FRONT_MARGIN: 1.5,
  // scoring weight for the boss in auto-aim target selection: <1 biases
  // toward the boss (it "looks" closer) but a much-nearer bug still wins,
  // so a distant boss isn't focused while the ship is under fire.
  BOSS_WEIGHT: 0.35,
  // target stickiness (hysteresis): the previously-locked target is kept
  // while its raw distance is within this factor of the best candidate's
  // weighted score (1.0 = always switch to the closest, >1 = hold longer).
  // Prevents the reticle flicking between two near-identical targets,
  // which would reset the trajectory fit and waste the lead.
  TARGET_HOLD: 1.15,
};

export const ENEMY = {
  BASE_HP: {
    // GALAGA 2 difficulty pass (user: "too easy"): fighters/interceptors now
    // take a 2-shot instead of a 1-shot, heavies/elites bumped up too.
    // Combined with the higher per-wave HP_SCALE this makes mid-game waves
    // require real focus fire rather than a single pass.
    fighter: 2,
    interceptor: 2,
    heavy: 5,
    elite: 4,
    scout: 2,
  },
  SPEED: {
    fighter: 17,
    interceptor: 23,
    heavy: 11,
    elite: 16,
    scout: 15,
  },
  RADIUS: {
    fighter: 1.15,
    interceptor: 1.05,
    heavy: 1.6,
    elite: 1.25,
    scout: 1.0,
  },
  FORMATION_WOBBLE: 0.16, // seconds per bob cycle
  FORMATION_BOB: 0.35, // world units of vertical bob
};

export const ENEMY_PROJECTILE = {
  // GALAGA 2: +20% regular enemy bullet speed (19 -> 22.8). Homing missiles
  // (HOMING.*) are intentionally left unchanged per design request.
  BASE_SPEED: 22.8, // difficulty pass: 16 -> 19, then +20% -> 22.8
  // Global slowdown multiplier applied to every hostile shot (×0.9 = 10%
  // slower). Applies to regular enemies AND boss shots.
  SPEED_SCALE: 0.9,
  DAMAGE: 28, // difficulty pass: 22 -> 28 (one hit bites harder)
  WAVESPEED_BONUS: 2.64, // + per wave above 1 (1.6 -> 2.2, then +20% -> 2.64)
};

// GALAGA 2: homing shots (the "scout" enemy's signature). These are NOT
// point-and-shoot — they curve toward the player with a TURN_RATE cap so
// they can be out-flanked (the evasion gap the straight shots never made).
// Tuned to be dodgable: a late, sharp lateral move outruns the turn.
export const HOMING = {
  // turn responsiveness (radians/s of heading change). This is the single
  // knob that makes it DODGABLE: the missile can only curve at this rate,
  // so a late, sharp lateral bank outruns it. Tuned so the turn radius is
  // wide enough (~v/ω ≈ 12/0.65 ≈ 18 units) that the missile visibly trails
  // where the player WAS, not where they are. (1.4 tested as a near-perfect
  // laser lock — bearing stayed 0°; rejected.)
  TURN_RATE: 0.65,
  // base speed (a bit slower than a normal shot — it trades speed for the
  // ability to curve, so it feels like a missile, not a bullet).
  // difficulty pass: 13 -> 14 (still a touch slower than a straight orb).
  SPEED: 14,
  // speed is multiplied by SPEED_SCALE like every hostile shot (×0.9).
  // damage is 1× the standard ENEMY_PROJECTILE.DAMAGE (set at spawn time).
  // how long it keeps tracking before it simply dies (s) — generous, since
  // it also despawns on the shared kill-zone.
  LIFE: 7.0, // difficulty pass: 6.5 -> 7.0 (sticks around longer)
  // visual hit radius — slightly bigger than a normal orb so the bigger
  // missile body is an honest hitbox (still dodgeable).
  RADIUS: 0.5,
  // scale (visual) — the missile is bigger than a stock orb (1.6 so the
  // fins + flame read clearly at range).
  SCALE: 1.6,
  // how often a scout may fire a homing shot (s), and the small random
  // jitter on top so a row of scouts doesn't fire in lockstep.
  // density pass 2: 3.2 -> 2.6 (missile pressure up ~25%)
  FIRE_INTERVAL: 2.6,
  FIRE_JITTER: 1.2,
  // per-wave speed creep so deep waves' missiles are a touch faster.
  WAVESPEED_BONUS: 0.5,
};

export const DIVE = {
  // seconds between picking a diver at wave 1
  FIRST_DELAY: 1.4,
  // difficulty pass: tighter dive cadence (was 2.6/2.1/1.7/1.4/1.15) —
  // dives start earlier and keep coming more often as waves deepen.
  // density pass 2: dives every ~15% sooner (was 2.1/1.7/1.4/1.15/0.95)
  INTERVAL_BY_WAVE: [0, 1.8, 1.4, 1.1, 0.9, 0.75],
  // density pass 2: +1 concurrent diver from wave 4 (was 1/2/3/3/4/4)
  MAX_CONCURRENT: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 5 },
  TRAVEL_TIME: 1.95, // difficulty pass: 2.3 -> 1.95 (dives close in ~15% faster)
  ENTER_TIME: 1.15,
  RETURN_TIME: 1.9,
};

export const WAVE = {
  HP_SCALE: 0.4, // difficulty pass: 0.3 -> 0.4 (+40% enemy HP per wave above 1, capped)
  SPEED_SCALE: 0.06,
  FIRE_CHANCE: 0.6, // density pass 2: 0.42 -> 0.6 (auto-aim made aiming free — the remaining skill is dodging, so the field has to be busier)
  FIRE_TICK: 0.5,
  BOSS_EVERY: 5,
  WAVE_CLEAR_TIME: 3.2,
  // GALAGA 2: scripted wave patterns (every 3rd wave). 3%6==0 -> ring
  // convergence, 3%3==0 -> V-split, otherwise the standard row grid.
  // Geometry knobs for the two scripted layouts:
  SCRIPT: {
    V_LEADER_Z: -44,     // apex depth (world z)
    V_FRONT_Z: -30,      // how far forward the wings sweep
    V_GAP: 5.2,          // lateral spacing along a wing arm (widened: less centre bunching)
    V_WING_BASE: 3,     // wing pairs per side at wave 3 (climbs w/ depth) — density pass 2: 2 -> 3
    V_WING_MAX: 5,      // density pass 2: 4 -> 5
    RING_RADIUS: 20,     // convergence circle radius (world units) — widened: less centre bunching
    RING_Z: -10,         // circle centre z (player is at z ~17)
    RING_COUNT_BASE: 10, // members at wave 3 (climbs with depth) — density pass 2: 8 -> 10
    RING_COUNT_MAX: 18,  // density pass 2: 14 -> 18
  },
  // GALAGA 2: brief "high-speed forward" burst at the moment the board
  // is cleared — the starfield speeds up ~2.8x for this window (with a
  // fast attack / smooth decay curve) so clearing a wave reads as the
  // craft surging forward into the next one.
  CLEAR_WARP_TIME: 3.0,
  // GALAGA 2: the flat wave-clear bonus (points + shield) was removed on
  // request — clearing the board pays out via the 3-card upgrade pick
  // instead. (WAVE_CLEAR_BONUS deleted.)
};

/**
 * GALAGA 2: second BOSS — the ember-carrier that takes over every
 * 5-wave boss fight from wave 10 on (wave 10, 15, 20...).
 * Same slot, new body: a wide, low deck that sweeps the full width
 * (SWEEP), spams an 8-way fan on a fast cadence, and calls small
 * drones to keep the field busy — the pressure step between the
 * dreadnought (violet) and whatever comes next.
 */
export const BOSS2 = {
  HP: 1400, // bigger pool than the first boss's cycle-0 (980)
  HP_SCALE: 400, // extra per cycle above wave 10
  RADIUS: 13.2, // tuned to the 2.2x-scaled carrier deck
  Z: -46,
  SWEEP: 16, // left/right patrol amplitude (world x)
  FIRE_INTERVAL: { p1: 0.62, p2: 0.5, p3: 0.42 }, // 8-way fan cadence
  DRONE_INTERVAL: 7, // s between drone call-ins (each = 2 small craft)
  DRONE_TYPES: ['fighter', 'interceptor'],
};

/**
 * GALAGA 2: third BOSS — the GLACIAL RING that takes the wave 15 slot.
 * A giant spinning ring of eight blades that orbits the field on a wide
 * path while its blades rotate. Signature attack: a radial ring of mines
 * (the "windshield-wiper" pattern) whose density climbs each phase, plus
 * an aimed triple and a rare homing dart in the dying phase.
 */
export const BOSS3 = {
  HP: 2200, // bigger pool than the carrier's cycle-0 (1400)
  HP_SCALE: 450, // extra per cycle above wave 15
  RADIUS: 15.0, // tuned to the 2.6x-scaled ring (8 blades @ r=3.1)
  Z: -48,
  ORBIT_R: 12, // wide orbital strafing amplitude (world x)
  ORBIT_SPEED: 0.3, // rad/s orbital sweep
  SPIN_BASE: 1.1, // rad/s blade spin (climbs as HP falls)
  FIRE_INTERVAL: { p1: 0.9, p2: 0.7, p3: 0.55 }, // radial-ring cadence
  RING_COUNT: { p1: 10, p2: 12, p3: 14 }, // mines per radial ring
  STRIKE_SPEED: 13, // homing dart speed (dying phase)
  STRIKE_TURN: 0.8, // homing dart turn rate (rad/s)
  DRONE_INTERVAL: 7, // s between escort call-ins (each = 2 small craft)
  DRONE_TYPES: ['scout', 'interceptor'],
};

/**
 * GALAGA 2: fourth BOSS — the ACID SERPENT, wave 20 and beyond.
 * Only the head carries the hitbox; a 14-segment body trails the head's
 * recent path so the whole creature coils and lunges through the field.
 * Acid spit on a cadence, a radial ring from the head, and (from phase 2)
 * a hard homing STRIKE dart. Toxic-green palette, distinct from the
 * violet dreadnought, ember carrier, and ice ring.
 */
export const BOSS4 = {
  HP: 3000, // the heaviest pool — the "final form" boss
  HP_SCALE: 500, // extra per cycle above wave 20
  RADIUS: 10.5, // head-only hitbox (1.7x-scaled serpent head)
  Z: -50,
  ORBIT_RX: 13, // orbital strafing amplitude (world x)
  SEGMENTS: 16, // body trail segments (visual only)
  SEG_SPACING: 0.12, // s of head-path sampled per segment (larger = longer coil)
  FIRE_INTERVAL: { p1: 0.85, p2: 0.68, p3: 0.52 }, // acid-spit cadence
  STRIKE_SPEED: 13.5, // homing STRIKE dart speed
  STRIKE_TURN: 0.85, // homing STRIKE turn rate (rad/s)
};

/**
 * GALAGA 2: enemy BEAM — a telegraphed vertical laser the formation
 * opens up from. Two fighters rise to a charge spot, flash a warning
 * line (CHARGE_TIME), then a solid beam drops through the player's
 * lane for FIRE_TIME. It's dodgeable by lateral movement (the beam is
 * a narrow vertical column at a fixed x/z, so bank off the lane).
 *
 * Scheduling (in BeamSystem): from WAVE_START, on a COOLDOWN cadence,
 * two live formation craft flank the PLAYER'S LANE — the column sits
 * at the player's x/z (the player flies a fixed-z band, so a beam
 * anywhere else could never touch them). While charging + firing the
 * two fighters hold a "BEAMING" pose (they stop bobbing and glow).
 */
export const BEAM = {
  WAVE_START: 3,       // beams begin on wave 3
  CHARGE_TIME: 0.6,    // s — telegraph line before the beam fires
  FIRE_TIME: 1.2,      // s — the beam is live (dealing damage)
  WIDTH: 1.7,          // beam column radius (world units)
  DAMAGE: 22,          // shield damage if the player is in the column
  COLOR: 0xff44dd,     // magenta — distinct from player (cyan) fire
  COOLDOWN: 6.5,       // s between beams (min)
};

export const BOSS = {
  HP: 980, // difficulty pass: 820 -> 980 (first boss takes a real fight now)
  HP_SCALE: 550, // extra HP per boss cycle (450 -> 550, later bosses hit harder)
  RADIUS: 12.675, // x/z collision radius — tuned to the 2.34x-scaled visual hull (8.45 x 1.5)
  Z: -50,
  INTRO_TIME: 2.6,
  // Boss.js reads BOSS.BOSS_EVERY — keep a local copy so the boss
  // math doesn't depend on WAVE (cleaner single-import path).
  BOSS_EVERY: 5,
  // GALAGA 2: boss firepower pass — all three phases fire ~20-25% faster
  FIRE_INTERVAL: { p1: 0.8, p2: 0.6, p3: 0.45 },
  // GALAGA 2: boss difficulty pass — the wave-5 fight was too soft.
  // 1) Escort top-ups: while the boss is alive, a fresh pair of escort
  //    fighters drips in on a timer, so the field never goes quiet.
  // 2) New boss ammunition (see _attackTick / _fireBossMissiles):
  //    - phase 2 also opens a wide slow ring (dodge the opening gap)
  //    - phase 3 adds aimed HOMING missile salvos (the same seeker
  //      darts as the scout, but faster and turning harder — the boss
  //      has bigger seekers) plus an aimed 2-round homing double tap
  ESCORT: {
    TYPES: ['interceptor', 'elite', 'scout'],
    // GALAGA 2: escort pass — squads arrive more often AND bigger (3 craft
    // per top-up, see Boss._updateEscorts)
    INTERVAL_MIN: 2.0,
    INTERVAL_MAX: 3.2,
    Y: [0.5, 4.5],
  },
  SHOT: {
    // aimed homing missile salvo — fires on the main fire cadence
    MIS_PER_SHOT: 3,
    MIS_SPREAD: 0.22,   // rad between salvo members
    // GALAGA 2 missile pass 3: seekers are a bit slower and turn a bit
    // less sticky, so a dodge actually escapes them (was 15 / 1.1).
    MIS_SPEED: 13,
    MIS_DAMAGE: 18,
    // hard turn rate (rad/s). Stickier than the scout's 0.65 but no
    // longer unescapable: turn radius ≈ 13/0.85 ≈ 15.3 units, so a
    // committed dodge pulls clear. (missile pass 3: was 1.1.)
    MIS_TURN: 0.85,
    // aimed 2-round double tap: first dart straight, second dart
    // offset by this much (rad) and slightly faster — you can't just
    // stand still through both.
    DOUBLE_TAP_SPREAD: 0.34,
    DOUBLE_TAP_SPEED_BONUS: 2,
    // ring counts / speeds (the old phase-3-only ring now scales per
    // phase)
    RING_P2: 8,
    RING_P2_SPEED: 8,
    RING_P3: 12,
    RING_P3_SPEED: 9,
  },
};

export const POWERUP = {
  // GALAGA 2: +30% fall speed so pickups drop toward the craft faster
  FALL_SPEED: 9.75,
  CHANCE: 0.32, // GALAGA 2: +10% (0.22 -> 0.32)
  SHIELD_AMOUNT: 45,
  // GALAGA 2: auto-absorb (magnet) — once a pickup enters this radius
  // it accelerates toward the craft and gets eaten on contact, so you
  // no longer have to fly its exact falling line.
  MAGNET_RADIUS: 6.0,
  // GALAGA 2: +30% pickup suction so drops reach the craft faster
  MAGNET_ACCEL: 33.8,      // world units/s^2 pulled toward the player
  MAGNET_MAX_SPEED: 28.6,  // cap so the snap reads as suction, not teleport
  // PIERCE and DRONE removed on request — remaining pickups only.
  // BOMBA: dropped by enemies like the others (replaces the old
  // per-cleared-wave auto-grant); picking it up refills +1 stock.
  TYPES: ['WEAPON', 'Rapid', 'SHIELD', 'BOMBA'],
  RARITY: [0.30, 0.25, 0.30, 0.15],
};

export const CAMERA = {
  FOV: 60,
  NEAR: 0.1,
  FAR: 400,
  // GALAGA 2 FORWARD VIEW: low chase camera — behind the craft (z 30 vs
  // player z 17) and only ~2.4u above it. The camera's downward tilt is
  // what decides how the nose reads on screen: the old 5.7u height made
  // the view dip ~7°, so the craft's level (horizontal) nose appeared to
  // point UP at the vanishing point. Flattening that tilt to ~3° (camera
  // y 6.8 -> 3.5, look still at the craft's altitude) makes the nose read
  // as flying STRAIGHT AHEAD toward the vanishing point, while the craft
  // still sits ~26% up from the bottom edge and the hull is read from
  // behind + slightly above (engine plume visible).
  POS: { x: 0, y: 3.5, z: 30 },
  // Look target stays on the craft's resting altitude, well ahead of the
  // formation — a shallow ~3° nose-down so the frame aims forward, at
  // the flight axis, instead of down at the craft.
  LOOK: { x: 0, y: 1.1, z: -14 },
  // Mobile (coarse pointer) portrait framing: the HUD stacks at the top
  // there, so the ship — framed for the desktop bottom bar — sits too
  // low. cameraBase() aims the camera this much lower (world units) per
  // unit of (1.35 - aspect), lifting the ship on-screen on narrow views.
  MOBILE_LOOK_LIFT: 1.6,
  // Lateral follow ratio. 0.85 (was 0.55): at the x rails (±23) the ship
  // now stays well inside the frame (~13% from the edge) instead of
  // clipping off-screen, while the wide arena travel (~70% of the frame
  // edge to edge) is what the player actually sees.
  PLAYER_FOLLOW: 0.85,
  // GALAGA 2: FOV kick while dashing — a brief speed line without any
  // motion-sickness-inducing camera motion.
  FOV_DASH_BOOST: 8,
  SHAKE_DECAY: 6.5, // exponential decay rate for the random shake
};

/**
 * GALAGA 2 sense of speed (modern arcade stack):
 * dynamic FOV + peripheral star rush + longer streaks + subtle
 * high-speed camera jitter + wind audio layer, all driven by a
 * single 0..1 "craft speed" value (lateral+vertical speed vs max,
 * dash = full). Tuning knobs only — the wiring lives in Game.update
 * (speed computation + starfield/audio) and CameraEffects.update
 * (FOV + jitter).
 */
export const SPEED_FEEL = {
  // degrees added to CAMERA.FOV at full craft speed (60 -> ~70)
  FOV_SPEED_BOOST: 10,
  // starfield intensity added at full speed (peripheral rush — the
  // streaks at the frame edges sweep past faster as you move faster)
  STAR_SPEED_BOOST: 0.55,
  // star streak length multiplier added at full speed (speed lines)
  TRAIL_SPEED_BOOST: 0.6,
  // continuous high-speed camera jitter amplitude (full speed) — tiny on
  // purpose; it sells velocity without hurting aim. Respects the
  // reduced-motion setting through CameraEffects.shakeScale.
  SHAKE_SPEED: 0.06,
  // wind audio layer gain at full speed (band-passed noise loop)
  WIND_MAX_GAIN: 0.16,
  // GALAGA 2: constant background star speed multiplier (applied on top
  // of the per-star parallax base speed, 36..118 u/s). 1.0 was the old
  // "cruise"; the wave-clear warp used to peak around ~3.3x that. The
  // user asked for the everyday background to already fly at roughly the
  // old wave-clear pace, so the new baseline is 2.0 — the periphery
  // streaks constantly, and the wave-clear surge (below) still punches
  // well above it for the "even faster" feel.
  BASE_STAR_INTENSITY: 2.0,
  // GALAGA 2: peak star-speed multiplier ADDED ON TOP of BASE_STAR_INTENSITY
  // during the wave-clear warp burst. The surge envelope r*(1-r)*4 peaks
  // at exactly 1.0 (r=0.5), so the value here IS the peak boost: at the
  // warp's apex the total star speed is BASE + WARP_STAR_BOOST = 2.0 + 3.0
  // = 5.0x the per-star base speed. That is clearly faster than normal
  // play (2.0x) AND faster than the old warp's peak (3.34x), so clearing
  // still reads as a distinct surge instead of going strobing-fast.
  WARP_STAR_BOOST: 3.0,
};

export const COLORS = {
  BG: 0x03030c,
  PLAYER_LASER: 0x5cf2ff,
  ENEMY_BULLET: 0xff5d8f,

  ENEMIES: {
    // Fluorescent insect palette (reference art): each bug type is a
    // distinct neon hue — body + wings both glow in that color, with a
    // bright contrasting "eye" core. fighter=green, interceptor=purple,
    // heavy=orange, elite=teal.
    fighter: {
      hull: 0x2fd63a,
      wing: 0x5dff4e,
      core: 0xffe14d,
      glow: 0x66ff55,
    },
    interceptor: {
      hull: 0x9a45ff,
      wing: 0xb866ff,
      core: 0xffd23d,
      glow: 0xc07bff,
    },
    heavy: {
      hull: 0xff9a1f,
      wing: 0xffb53d,
      core: 0xff4444,
      glow: 0xffb53d,
    },
    elite: {
      hull: 0x18d8c8,
      wing: 0x2ff0dc,
      core: 0xff5df0,
      glow: 0x4dffe0,
    },
    // scout: electric blue — the homing-missile bug. Kept away from the
    // player's cyan laser / engine (those are 0x5cf2ff / 0x28c8ff) by
    // pushing hue toward pure blue so a live missile never reads as
    // "one of my own shots".
    scout: {
      hull: 0x2f6bff,
      wing: 0x4d8bff,
      core: 0xff3bd0,
      glow: 0x6f9dff,
    },
  },
  BOSS: {
    // brightened (was 0x231038/0x3a1a5e — read as near-black vs the nebula);
    // ShipBuilder's boss branch also adds a self-illuminator override.
    hull: 0x43266e,
    wing: 0x5e3596,
    cannon: 0x8a4fd0,
    core: 0xff2bd6,
    glow: 0xff2bd6,
  },
  // GALAGA 2: second boss — ember-carrier. A hot orange/red palette so
  // it reads instantly distinct from the violet dreadnought (and from
  // the orange "heavy" bug, which is smaller and never this big).
  BOSS2: {
    hull: 0x7a2a12,
    wing: 0xa83c14,
    cannon: 0xd95f1e,
    core: 0xffb02e,
    glow: 0xff7a2e,
  },
  // GLACIAL RING — cold glacier-blue/ice palette, instantly distinct from
  // the violet dreadnought and ember carrier.
  BOSS3: {
    hull: 0x1d4a66,
    wing: 0x2e6f96,
    cannon: 0x57b8e6,
    core: 0xa8ecff,
    glow: 0x7fd8ff,
  },
  // ACID SERPENT — poisonous olive/bile-green with venomous acid core.
  BOSS4: {
    hull: 0x2b4a12,
    wing: 0x4a7a18,
    cannon: 0x84c02a,
    core: 0xcfff3a,
    glow: 0x9dff2e,
  },
};

export const AUDIO = {
  MASTER_VOLUME: 0.5,
  ENABLED: true,
  // GALAGA 2: adaptive procedural BGM (see audio/MusicEngine.js)
  MUSIC_ENABLED: true,
  MUSIC_VOLUME: 0.55, // relative to master
};

/** Pool startup sizes — avoids (re)allocations during gameplay. */
// density pass 2: 96 -> 256. The trail buffer (_updateTrails) is sized to
// this value, so at 96 the trail layer clipped the moment ~96 shots were
// live (boss-2's 8-way fan alone sustains ~95 concurrent). 256 covers the
// densest mid/late waves + boss fight with headroom; cost is ~256 small
// meshes pre-built at boot, same as before just more of them.
export const POOL_DEFAULTS = {
  PROJECTILES: 256,
  POWERUPS: 10,
};

// GALAGA 2: motion trails behind live shots — the same "bright head ->
// black tail" streak technique as the starfield, so every shot reads as
// a laser bolt instead of a dot. Trail length = TRAIL_TIME seconds of
// recent travel, so it auto-scales with speed: fast player lasers get
// the longest streak, slow enemy orbs a short bolt, homing darts in
// between. Purely visual — hitboxes (radius) are untouched, and the
// bright HEAD is still the shot's real position, so dodging fairness is
// unchanged (the tail only ever extends BEHIND the travel direction).
export const SHOT_TRAIL = {
  PLAYER_TIME: 0.03,  // subtle glow tail — the beam itself is a solid cylinder
  ENEMY_TIME: 0.06,  // short glow tail — enemy shots are solid cylinders too
  HOMING_TIME: 0.22, // ~12 u/s * 0.22 ≈ 2.6 u (dart keeps its streak)
};

// GALAGA 2: bloom post-processing — the "modern" look. Every emissive
// surface (lasers, engines, star tails, explosion cores, boss core)
// glows with a soft halo. Tuning: STRENGTH = overall glow amount,
// RADIUS = how far the halo spreads, THRESHOLD = brightness needed to
// start glowing (0.32 keeps the dark hulls matte — only the lights glow).
// Set ENABLED: false (or ?bloom=off URL param) to compare frames.
export const BLOOM = {
  ENABLED: true,
  STRENGTH: 0.85,
  RADIUS: 0.55,
  THRESHOLD: 0.32,
};
