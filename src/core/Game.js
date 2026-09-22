/**
 * Game.js
 * ---------------------------------------------------------------
 * The glue class.
 *
 * Owns:
 *   - the requestAnimationFrame game loop (update + render),
 *   - the GameState machine (BOOT / MAIN_MENU / PLAYING / PAUSED /
 *     WAVE_CLEAR / BOSS_INTRO / GAME_OVER),
 *   - every system and entity (see this._context),
 *   - score / combo / high-score / lives / wave tracking,
 *   - all "something just happened" callbacks wired from
 *     CollisionSystem.
 *
 * The loop is strictly:
 *
 *   dt = clamp(clock)
 *   game.update(dt)
 *   renderer.render()
 *
 * No system is given direct access to rAF; everything funnels
 * through Game.update so state transitions stay in one place.
 * ---------------------------------------------------------------
 */
// three/webgpu is the build that EXPOSES THREE.WebGPURenderer.
// The bare 'three' package ships WebGL-only core in 0.182+.
import * as THREE from 'three/webgpu';
import { BOUNDS, COLORS, GAME, PLAYER, POWERUP, WAVE as WAVE_CFG, WEAPON, AIM, JUICE, AUDIO, UPGRADE, SPEED_FEEL, SCORE_VALUES } from '../config.js';
import { Renderer, isWebGPUSupported } from './Renderer.js';
import { InputManager } from './InputManager.js';
import { GameState, States } from './GameState.js';
import { Pool } from './Pool.js';

import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { Boss } from '../entities/Boss.js';
import { Boss2 } from '../entities/Boss2.js';
import { Boss3 } from '../entities/Boss3.js';
import { Boss4 } from '../entities/Boss4.js';
import { ENEMY as ENEMY_CFG, BOSS as BOSS_CFG } from '../config.js';

import { ProjectileSystem } from '../systems/ProjectileSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { WaveSystem } from '../systems/WaveSystem.js';
import { EnemyAttackSystem } from '../systems/EnemyAttackSystem.js';
import { BeamSystem } from '../systems/BeamSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { StarFieldSystem } from '../systems/StarFieldSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { MusicEngine } from '../audio/MusicEngine.js';

import { ExplosionEffect } from '../effects/ExplosionEffect.js';
import { CameraEffects } from '../effects/CameraEffects.js';
import { BombaMissile } from '../effects/BombaMissile.js';
import { FloatingText } from '../ui/FloatingText.js';
import { HUD } from '../ui/HUD.js';
import { UpgradeSelect } from '../ui/UpgradeSelect.js';

// GALAGA 2 aim: module-level scratch for the per-frame reticle ray math
// (no per-frame allocation — same convention as the entity files).
const _ndc = new THREE.Vector3();
const _toEnemy = new THREE.Vector3();
const _reticleWorld = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
// GALAGA 2: auto-aim scratch — the predicted intercept point, kept
// module-level to avoid per-frame allocations.
const _aaP = new THREE.Vector3();

export class Game {
  constructor(canvasHost, hudRoot) {
    this._canvasHost = canvasHost;
    this._hudRoot = hudRoot;

    this.state = new GameState();
    this.input = new InputManager();
    this.hud = new HUD(hudRoot);
    this._upgradeSelect = new UpgradeSelect(hudRoot);
    this.audio = new AudioSystem();
    // GALAGA 2: adaptive procedural BGM — follows the game state
    this.music = new MusicEngine(this.audio);
    this.renderer = new Renderer(canvasHost);

    this.score = 0;
    this.highScore = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    // GALAGA 2 juice: hitstop (kill freeze) + dash slow-mo timers
    this._hitstop = 0;
    this._slowmoTimer = 0;
    // true while a BOMBA blast is killing enemies — suppresses the
    // per-kill power-up drops (it's an escape tool, not a score farm)
    this._bombaKilling = false;
    // GALAGA 2: BOMBA salvo — monotonically rising id per press, and the
    // set of salvo ids whose board-clear has already run (each salvo
    // detonates N missiles; the clear must fire exactly ONCE of them).
    this._bombaSalvo = 0;
    this._bombaSalvoCleared = new Set();
    this._waveClearTimer = 0;
    // GALAGA 2: remaining time of the wave-clear warp burst (see update)
    this._clearWarp = 0;
    this._bossIntroTimer = 0;
    // fire cooldown (seconds remaining) — shared by hold auto-fire and
    // manual taps. After any shot it resets to 1/baseRate (baseRate is
    // FIRE_RATE + RAPID_BONUS while the speed buff is up), capping both
    // holding and rapid tapping at the same cadence.
    this._fireCooldown = 0;

    // context: shared refs handed to entities/systems so they don't
    // need to know about the Game object itself.
    this._context = {
      game: null,
      wave: 1,
      player: null,
      boss: null,
      enemyList: [],   // canonical list of live Enemy instances
      projectiles: null,
      particles: null,
      audio: this.audio,
      // spawn helpers are patched in after projectiles exists:
      spawnEnemyShot: null,
      spawnPlayerShot: null,
      spawnPowerUp: null,
    };

    this._last = performance.now();
    this._raf = null;
    this._webgpuOk = false;
    this._isNewHigh = false;

    // GALAGA 2: aim reticle state (world point the shots fly toward)
    this._reticleWorld = new THREE.Vector3(0, BOUNDS.PLAYER_Y, AIM.FALLBACK_Z);
    this._reticleEl = null;
    // GALAGA 2: auto-aim (ON by default, desktop + mobile). The reticle
    // homes onto the nearest enemy ahead (boss-priority) with lead instead
    // of tracking the mouse/touch aim point. Toggled by the menu checkbox,
    // KeyQ, or the touch AUTO button; persisted in settings. When on, the
    // player only dodges and holds fire — no aiming. _loadSettings()
    // overwrites this with the stored value (or the default on first run).
    this.autoAim = AIM.AUTO_AIM_DEFAULT;
    // GALAGA 2: auto-aim — last entity handed to the reticle (target
    // stickiness). Future target positions are predicted analytically from
    // each enemy's own motion model (predictPositionAt), so no per-target
    // position buffer is needed.
    this._autoTargetEnt = null;
  }

  // ----------------------------------------------------------------
  // setup
  // ----------------------------------------------------------------
  async bootstrap() {
    this._webgpuOk = isWebGPUSupported();
    window.addEventListener('resize', () => this.renderer.resize());
    if (this._webgpuOk) {
      try {
        await this.renderer.init();
      } catch (err) {
        console.error('WebGPU init failed, falling back.', err);
        this._webgpuOk = false;
      }
    }
    if (!this._webgpuOk) {
      this._failWebGPU();
      return;
    }

    const scene = this.renderer.scene;
    const camera = this.renderer.camera;

    this.input.attach();
    this._buildContext(scene, camera);
    this._buildReticleDom();
    this._buildStateTransitions();
    this._bindHud();
    this._loadHighScore();
    this._loadSettings();
    this._bindSettings();

    // enter the main menu (game world is visible behind it)
    this._enterMainMenu();

    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  _buildContext(scene, camera) {
    const ctx = this._context;
    ctx.game = this;
    ctx.scene = scene;
    ctx.camera = camera;

    ctx.player = new Player();
    scene.add(ctx.player.group);
    ctx.player.reset();

    ctx.boss = new Boss();
    ctx.bossDread = ctx.boss; // stable handle to the dreadnought (wave 5)
    scene.add(ctx.boss.group);
    // GALAGA 2: the second boss (wave 10+). Both live in the scene;
    // _startWave points ctx.boss at whichever one owns the slot.
    ctx.boss2 = new Boss2();
    scene.add(ctx.boss2.group);
    // GALAGA 2: the third (wave 15) and fourth (wave 20+) bosses. All four
    // live in the scene; _startWave points ctx.boss at the active one.
    ctx.boss3 = new Boss3();
    scene.add(ctx.boss3.group);
    ctx.boss4 = new Boss4();
    scene.add(ctx.boss4.group);

    ctx.projectiles = new ProjectileSystem(scene);

    // Wire the "spawn" helpers that Enemy / Boss / Game call via
    // ctx.spawn*. They forward to ProjectileSystem internally, so
    // callers don't need to know the shape of ProjectileSystem.opts.
    ctx.spawnPlayerShot = (opts) => ctx.projectiles.spawnPlayerShot(opts);
    // B4: single canonical shape { origin, dir, speed, damage, scale }
    // across every caller (Enemy / Boss / any future system).
    ctx.spawnEnemyShot = (opts) => ctx.projectiles.spawnEnemyShot(opts);
    ctx.spawnPowerUp = (opts) => ctx.projectiles.spawnPowerUp(opts);

    ctx.particles = new ParticleSystem(scene, 1400);
    ctx.starfield = new StarFieldSystem(scene, 300);

    this._explosion = new ExplosionEffect(scene, ctx.particles);
    // GALAGA 2: BOMBA missile — the rocket the board-clearer launches
    // forward; detonates at the formation (see _tryBomba/_bombaDetonate)
    this._bombaMissile = new BombaMissile(scene);
    this._cameraFx = new CameraEffects(this.renderer, camera);
    this._floatingText = new FloatingText(scene, camera, this._hudRoot);

    ctx.enemyPool = new Pool(() => this._makeEnemy(), 0);
    ctx.enemyList = [];

    this.waveSystem = new WaveSystem(this);
    this.attackSystem = new EnemyAttackSystem(this);
    // GALAGA 2: the formation's telegraphed vertical beam
    this.beamSystem = new BeamSystem(this, scene);
    this._collision = new CollisionSystem(this);
    this._wireCollisionCallbacks();
  }

  _makeEnemy() {
    // pool doesn't have a fixed type; we instantiate a new one via
    // the factory. To avoid waste we lazily add them to the scene.
    const type = 'fighter'; // placeholder; configure will replace
    return new Enemy(type);
  }

  /** Weighted power-up type pick. Lives above the class so no call
   *  site can reference it before the module finishes evaluating. */
  _pickPowerupWeighted() {
    const r = Math.random();
    const rarity = POWERUP.RARITY;
    let acc = 0;
    for (let i = 0; i < rarity.length; i++) {
      acc += rarity[i];
      if (r <= acc) return i;
    }
    return 0;
  }

  _wireCollisionCallbacks() {
    this._collision._game.onEnemyKilled = (enemy, at) =>
      this._onEnemyKilled(enemy, at);
    this._collision._game.onPlayerHit = (dmg) =>
      this._onPlayerHit(dmg);
    this._collision._game.onPowerUpTaken = (pu) =>
      this._onPowerUpTaken(pu);
    this._collision._game.onBossKilled = (boss, at) =>
      this._onBossKilled(boss, at);
  }

  // ----------------------------------------------------------------
  // enemy pool
  // ----------------------------------------------------------------
  acquireEnemy(type) {
    let e = this._context.enemyPool.acquire();
    // the pool returns a pre-built 'fighter' instance; if the type
    // differs, rebuild the ship group (cheap: only a few geos).
    if (e.type !== type) {
      // rebuild: replace the ship group with a fresh one for the
      // requested type. The old group was never in the scene at this
      // point (addEnemy attaches on spawn), so dispose its unique
      // materials to avoid GPU leaks — geometries are shared and
      // stay alive for the other pool members.
      const old = e.group;
      old.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      e.group = new Enemy(type).group;
      e.type = type;
      // userData.radius is never set by ShipBuilder, so read the
      // canonical per-type radius from config (the old code kept the
      // previous type's radius, so heavies/interceptors collided
      // with fighter-sized hitboxes).
      e._baseRadius = ENEMY_CFG.RADIUS[type] ?? e._baseRadius;
      e.radius = e._baseRadius;
      e._collectEngines();
    }
    return e;
  }

  /**
   * B2: attach the enemy's 3D group to the scene when it becomes
   * active. (Previously enemies were spawned but their group was
   * never added to the scene, so they were invisible and the
   * CollisionSystem could still see them via the list — producing
   * ghost collisions.)
   */
  addEnemy(enemy) {
    this._context.enemyList.push(enemy);
    this.renderer.scene.add(enemy.group);
  }

  /** B2: detach (scene + list + pool). Single point of removal. */
  _releaseEnemy(e) {
    const list = this._context.enemyList;
    const i = list.indexOf(e);
    if (i !== -1) list.splice(i, 1);
    this.renderer.scene.remove(e.group);
    e.onRecycle();
    this._context.enemyPool.release(e);
  }

  /**
   * GALAGA 2: apply a picked upgrade card to the player.
   * `id === null` = the all-maxed case (flat score bonus instead).
   * Runs while the world is frozen (UpgradeSelect.active), so the
   * HUD refresh below is safe and nothing moves underneath it.
   */
  _applyUpgrade(id) {
    const p = this._context.player;
    // GALAGA 2: T2 cards live in a second pool — look in both
    const cfg = id ? (UPGRADE.POOL[id] || UPGRADE.POOL_T2[id]) : null;
    if (!cfg) {
      // every card is maxed — a flat bonus keeps the pick rewarding
      const bonus = 500 * Math.max(1, this.waveSystem.wave);
      this.score += bonus;
      this.hud.setScore(this.score);
      this._floatingText.spawnAt(
        p.group.position, `ALL MAX +${bonus}`, '#ffd23d', true);
      return;
    }
    cfg.apply(p);
    // the life card changes HUD hearts; shield cards change the bar max
    if (id === 'life') this.hud.setLife(p.lives);
    // BOMBA-touching cards (t2_bomba cap+1, t2_fullrepair +1) bump stock
    // and/or cap — sync the pips so the new slot / fill shows immediately
    this.hud.setBomba(p.bombaCount, p.bombaMax());
    this.hud.setShield(p.shield / p.maxShield());
    this.audio.play('powerUp');
    // in-world confirmation popup on the craft
    this._floatingText.spawnAt(
      p.group.position, `${cfg.name} LV${cfg.level(p)}`,
      cfg.color.startsWith('var') ? '#2de2ff' : cfg.color, true);
  }

  // ----------------------------------------------------------------
  // GALAGA 2: auto-upgrade (A plan) — apply + toast + undo window
  // ----------------------------------------------------------------

  /** Snapshot the run-relevant player state (for auto-upgrade UNDO). */
  _snapshotPlayer(p) {
    return {
      upg: { ...p.upg },
      shield: p.shield,
      lives: p.lives,
      bombaCount: p.bombaCount,
      weaponLevel: p.weaponLevel,
      rapidLevel: p.rapidLevel,
      score: this.score,
    };
  }

  /** Restore a snapshot + re-sync every HUD surface it touches. */
  _restorePlayer(snap) {
    const p = this._context.player;
    Object.assign(p.upg, snap.upg);
    p.shield = snap.shield;
    p.lives = snap.lives;
    p.bombaCount = snap.bombaCount;
    p.weaponLevel = snap.weaponLevel;
    p.rapidLevel = snap.rapidLevel;
    this.score = snap.score;
    this.hud.setScore(this.score);
    this.hud.setLife(p.lives);
    this.hud.setShield(p.shield / p.maxShield());
    this.hud.setBomba(p.bombaCount, p.bombaMax());
    this.hud.setWeaponLevel(p.weaponLevel);
    this.hud.setTimedBuff(p.rapidLevel > 0, p.rapidLevel);
  }

  /**
   * Auto-upgrade path: apply the picked card without freezing the world,
   * then show the bottom toast ("card auto-applied — UNDO?"). UNDO
   * restores the exact pre-card snapshot while the toast is up.
   * `id === null` (all maxed) applies the flat bonus silently.
   */
  _autoApplyUpgrade(id, wave) {
    const p = this._context.player;
    const snap = this._snapshotPlayer(p);
    this._applyUpgrade(id);
    if (id === null) return; // bonus only — nothing to take back
    const cfg = UPGRADE.POOL[id] || UPGRADE.POOL_T2[id];
    this._showAutoUpgradeToast(cfg, snap, wave);
  }

  /** Build the auto-upgrade toast once (bottom-center, above touch UI). */
  _buildAutoToast() {
    const toast = document.createElement('div');
    toast.className = 'autoup-toast';
    toast.style.display = 'none';
    const body = document.createElement('div');
    body.className = 'autoup-body';
    const icon = document.createElement('span');
    icon.className = 'autoup-icon';
    const name = document.createElement('span');
    name.className = 'autoup-name';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'autoup-undo';
    undo.textContent = 'UNDO';
    undo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    undo.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._autoToastUndo) {
        this._restorePlayer(this._autoToastUndo);
        this._autoToastUndo = null;
        this.audio.play('hitTick');
        this._hideAutoToast();
      }
    });
    body.appendChild(icon);
    body.appendChild(name);
    body.appendChild(undo);
    toast.appendChild(body);
    this._hudRoot.appendChild(toast);
    this._autoToastEl = toast;
    this._autoToastIcon = icon;
    this._autoToastName = name;
    clearTimeout(this._autoToastTO);
  }

  _showAutoUpgradeToast(cfg, snap, wave) {
    if (!this._autoToastEl) this._buildAutoToast();
    this._autoToastUndo = snap;
    this._autoToastIcon.textContent = cfg.icon;
    this._autoToastIcon.style.color =
      cfg.color.startsWith('var') ? '#2de2ff' : cfg.color;
    this._autoToastName.textContent =
      `AUTO ${cfg.name}  (WAVE ${wave})`;
    this._autoToastEl.style.display = '';
    // retrigger the slide-in animation
    void this._autoToastEl.offsetWidth;
    this._autoToastEl.classList.add('in');
    clearTimeout(this._autoToastTO);
    this._autoToastTO = setTimeout(
      () => this._hideAutoToast(), UPGRADE.AUTO_TOAST_TIME * 1000);
  }

  _hideAutoToast() {
    if (this._autoToastEl) {
      this._autoToastEl.classList.remove('in');
      this._autoToastEl.style.display = 'none';
    }
    this._autoToastUndo = null;
  }

  // ----------------------------------------------------------------
  // state transitions
  // ----------------------------------------------------------------
  _buildStateTransitions() {
    const s = this.state;
    s.on(States.MAIN_MENU, () => {
      this.hud.showMenu(this._webgpuOk);
      this.hud.hideBoss();
      this._startMenuAmbient();
      this.music.setMode('menu');
      // restore the touch AUTO toggle (hidden while a run is in play)
      if (this._autoTouchBtn) this._autoTouchBtn.style.display = '';
    });
    // PLAYING listener is intentionally lightweight. The actual
    // "start the world" path is:
    //   START GAME button -> _beginPlay() -> _startWave(1)
    //   where _startWave does state.transition(PLAYING).
    // If we also call _beginPlay() from this listener we loop:
    //   listener -> _beginPlay -> _startWave -> transition(PLAYING)
    //   -> listener -> ...
    s.on(States.PLAYING, () => {
      this.hud.hideAll();
      // GALAGA 2: hide the touch AUTO toggle once a run is in progress —
      // auto-aim is a menu/setup choice, not something to fiddle with
      // mid-combat on a small screen.
      if (this._autoTouchBtn) this._autoTouchBtn.style.display = 'none';
      // GALAGA 2: adaptive music — boss track while the boss is on
      // screen (also covers resume-during-boss), combat groove otherwise
      this.music.setMode(this._context.boss?.alive ? 'boss' : 'play');
    });
    s.on(States.PAUSED, () => {
      this.hud.showPause();
      this.music.setMode('off');
    });
    s.on(States.GAME_OVER, (_prev, next) => {
      // never leave a frozen world + open panel behind
      this._upgradeSelect.cancel();
      this.hud.showGameOver(
        {
          score: this.score,
          highScore: this.highScore,
          wave: this.waveSystem.wave,
          kills: this.kills,
        },
        this._isNewHigh
      );
      this.audio.play('gameOver');
      this.music.setMode('off');
      void next;
    });
    s.on(States.BOSS_INTRO, () => {
      this.audio.play('bossAlert');
      this.music.setMode('boss');
    });

    // pause toggle (P/ESC)
    this.input.onAction('KeyP', () => this._togglePause());
    this.input.onAction('Escape', () => this._togglePause());
    // GALAGA 2: auto-aim toggle (Q)
    this.input.onAction('KeyQ', () => this.setAutoAim(!this.autoAim, true));
  }

  // ----------------------------------------------------------------
  // gameplay helpers
  // ----------------------------------------------------------------
  _startMenuAmbient() {
    // keep the starfield (stars + motion trails) moving for the menu
    this._context.starfield.setActive(true);
  }

  _enterMainMenu() {
    this.state.transition(States.MAIN_MENU);
  }

  _beginPlay() {
    this._hideAutoToast();
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this._isNewHigh = false;
    this._fireCooldown = 0;
    // GALAGA 2: reset auto-aim target stickiness for the fresh run
    this._autoTargetEnt = null;

    // reset the world
    const ctx = this._context;
    ctx.player.reset();
    ctx.bossDread.onRecycle();
    ctx.boss2.onRecycle();
    ctx.boss3.onRecycle();
    ctx.boss4.onRecycle();
    ctx.boss = ctx.bossDread; // slot starts on the dreadnought (wave 5)
    for (const e of [...ctx.enemyList]) {
      this._releaseEnemy(e);
    }
    ctx.projectiles.deactivateAll();
    ctx.particles.clear();
    this.waveSystem.reset();
    this.attackSystem.reset();
    this.beamSystem.reset();

    this.hud.setScore(0);
    this.hud.setHighScore(this.highScore);
    this.hud.setWave(1);
    this.hud.setCombo(1);
    this.hud.setShield(1);
    this.hud.resetHearts();
    this.hud.setLife(ctx.player.lives);
    this.hud.setWeaponLevel(ctx.player.weaponLevel);
    this.hud.setDash(0);
    this.hud.setTimedBuff(false, false);
    this.hud.hideBoss();
    // GALAGA 2: BOMBA stock resets with the run (player.reset did the
    // counting) — sync the HUD pips to the fresh run's cap (base 3)
    this.hud.setBomba(ctx.player.bombaCount, ctx.player.bombaMax());

    // camera: snap the damped Y-follow back to base framing for the
    // fresh player (avoids a slow slide from the previous run's altitude)
    this._cameraFx.resetFollow();

    this._startWave(1);
  }

  _startWave(wave) {
    // Release any enemies still alive from the previous wave (e.g.
    // leftover boss escorts when the boss fell before they did).
    // On a fresh _beginPlay the list is already empty, so this is a
    // no-op there.
    for (const e of [...this._context.enemyList]) this._releaseEnemy(e);

    this._context.wave = wave; // Boss reads ctx.wave for its firing cadence
    this.waveSystem.startWave(wave);
    this.hud.setWave(wave); // keep HUD in sync (regression: was stuck at 1)
    if (this.waveSystem._isBossWave) {
      this.state.transition(States.BOSS_INTRO);
      this._bossIntroTimer = BOSS_CFG.INTRO_TIME;
      const ctx = this._context;
      // GALAGA 2: every boss wave from 5 gets its OWN unique boss.
      //  5 → DREADNOUGHT (violet)  10 → EMBER CARRIER (orange)
      //  15 → GLACIAL RING (ice)   20+ → ACID SERPENT (toxic green)
      ctx.boss = wave >= 20 ? ctx.boss4
        : wave >= 15 ? ctx.boss3
        : wave >= 10 ? ctx.boss2
        : ctx.bossDread;
      ctx.boss.configure(wave);
      this.hud.setBoss(1, 1);
      // GALAGA 2: boss intro cue in-world — the hull descends in 3D
      // from deep z, so the warning reads against the staging.
      let introText = 'BOSS INBOUND — 3D';
      let introColor = '#ff5a7a';
      if (ctx.boss instanceof Boss4)      { introText = 'ACID SERPENT INBOUND';  introColor = '#9dff2e'; }
      else if (ctx.boss instanceof Boss3) { introText = 'GLACIAL RING INBOUND';  introColor = '#7fd8ff'; }
      else if (ctx.boss instanceof Boss2) { introText = 'EMBER CARRIER INBOUND'; introColor = '#ff8a3c'; }
      this._floatingText.spawnAt(
        new THREE.Vector3(0, 9, -40),
        introText, introColor, true
      );
    } else {
      this.state.transition(States.PLAYING);
    }
  }

  _onEnemyKilled(enemy, at) {
    let points = SCORE_VALUES[enemy.type] ?? 100;
    if (enemy.isDiving()) points += SCORE_VALUES.DIVE_BONUS; // dive bonus
    // GALAGA 2: per-run score multiplier (신경링크/퀀텀 링크 cards) + combo
    const pu = this._context.player.upg;
    const scoreMult = 1 + 0.15 * pu.score + 0.30 * pu.t2score;
    points = Math.round(points * scoreMult * (1 + Math.min(9, this.combo * 0.25)));

    this.score += points;
    this.kills += 1;
    this.combo += 1;
    this.comboTimer = 2.4;
    this._isNewHigh = this.score > this.highScore;
    if (this._isNewHigh) this.highScore = this.score;

    this.hud.setScore(this.score);
    this.hud.setHighScore(this.highScore);
    this.hud.setCombo(Math.max(1, Math.floor(this.combo)));

    // visuals
    const color = enemy.palette?.core ?? 0xffc24d;
    // GALAGA 2 juice: kill flair scales with the combo tier — bigger
    // explosion, more shake, and a hitstop (freeze) so each kill lands.
    const tier = this.combo >= JUICE.COMBO_TIER3 ? 3
      : this.combo >= JUICE.COMBO_TIER2 ? 2 : 0;
    const boomScale = 1 + (this.combo - 1) * 0.02 + tier * 0.15;
    const shake = 0.18 + tier * 0.06;
    this._cameraFx.addShake(shake);
    this._hitstop = Math.min(
      JUICE.HITSTOP_MAX,
      JUICE.HITSTOP_BASE + Math.max(0, this.combo - 1) * JUICE.HITSTOP_PER_KILL,
    );
    if (tier >= 2) {
      this.hud.flashComboTier(tier);
    }
    if (tier >= 1) {
      this._explosion.medium(enemy.group.position, color, boomScale);
    } else {
      this._explosion.small(enemy.group.position, color, boomScale);
    }
    // big golden "credit" popup on high-combo kills, normal on the rest
    const credit = this.combo >= 5;
    this._floatingText.spawnAt(enemy.group.position, `+${points}`, '#bfe9ff', credit);
    this.audio.play('explosion');

    // possibly drop a power-up (suppressed during BOMBA blasts)
    if (!this._bombaKilling && Math.random() < POWERUP.CHANCE) {
      const type = POWERUP.TYPES[this._pickPowerupWeighted()];
      this._context.projectiles.spawnPowerUp({
        origin: enemy.group.position,
        type,
        fallSpeed: POWERUP.FALL_SPEED,
      });
    }

    this._releaseEnemy(enemy);

    // wave progress — count the kill so `enemyDied` can flag
    // completion when everything has been spawned AND killed.
    this.waveSystem.enemyDied();
    if (this.waveSystem.isComplete && this._context.player.alive) {
      this._beginWaveClear();
    }
  }

  /**
   * Enter WAVE_CLEAR: wipe leftover enemy fire, start the clear timer
   * + the brief forward surge (star warp + FOV kick), show the banner,
   * and queue the upgrade pick after a beat (while the manual panel is
   * open the countdown below is frozen). Shared by normal clears and
   * boss-wave clears — the base wave-clear bonus (points + shield) was
   * removed on request, so the payoff is the upgrade pick (and the
   * boss-wave pickup drop on boss waves), not a flat bonus.
   */
  _beginWaveClear() {
    // Wipe remaining enemy fire so they don't linger on top of the
    // "WAVE CLEAR" banner (player's live lasers are kept).
    this._context.projectiles.deactivateHostile();
    this._waveClearTimer = WAVE_CFG.WAVE_CLEAR_TIME;
    this._clearWarp = WAVE_CFG.CLEAR_WARP_TIME;
    this._wormFlare();
    this.state.transition(States.WAVE_CLEAR);
    this.hud.showWaveClear(this.waveSystem.wave + 1);
    this.audio.play('waveClear');
    // GALAGA 2: upgrade selection after a beat (the surge plays first).
    this._upgradePickDelay = 0.9;
  }

  _onPlayerHit(dmg) {
    const p = this._context.player;
    const result = p.takeDamage(dmg);
    if (result === false) return; // invulnerable
    this.combo = 0;
    this.hud.setCombo(1);
    this.audio.play('playerHit');
    this._cameraFx.addShake(0.5);
    // red edge vignette pulse so every hit is unmistakable on screen
    this.hud.flashDamage(result === 'hit' ? 'hit' : 'severe');
        this.hud.setShield(p.shield / p.maxShield());
    this.hud.setLife(p.lives);

    if (result === 'lostLife') {
      // Ship destroyed: debris burst at the craft, wipe collected items,
      // then respawn centered (invulnerability flash set in takeDamage).
      this._explosion.playerDestroyed(p.group.position);
      this._cameraFx.addShake(1.0);
      p.resetCollected();
      // GALAGA 2: respawn consolation — charge +1 BOMBA (capped).
      p.bombaCount = Math.min(p.bombaCount + 1, p.bombaMax());
      this.hud.setBomba(p.bombaCount);
      p.group.position.x = 0;
      p.group.position.y = BOUNDS.PLAYER_Y;
      p.velocityX = 0;
      p.velocityY = 0;
      this.hud.setWeaponLevel(p.weaponLevel);
      this.hud.setTimedBuff(p.rapidLevel > 0, p.rapidLevel);
    } else if (result === 'shieldBreak') {
      // The barrier collapses first; the ship itself is removed only when
      // the timer resolves the actual life-loss step in Player.update().
      this._explosion.playerHit(p.group.position);
    } else if (result === 'hit') {
      this._explosion.playerHit(p.group.position);
    }

    if (result === 'dead') {
      // Final destruction, then the game-over panel.
      this._explosion.big(p.group.position, 0x66d9ff);
      this._cameraFx.addShake(1.0);
      this.state.transition(States.GAME_OVER);
    }
  }

  _onPowerUpTaken(pu) {
    const p = this._context.player;
    const type = pu.type;
    this.audio.play('powerUp');
    const at = pu.group.position;
    this._floatingText.spawnAt(at, this._powerupLabel(type), '#9fe8ff', true);
    if (type === 'WEAPON') p.upgradeWeapon();
    else if (type === 'SHIELD') p.heal(POWERUP.SHIELD_AMOUNT);
    else if (type === 'Rapid') p.grantRapid();
    else if (type === 'BOMBA') {
      p.bombaCount = Math.min(p.bombaCount + 1, p.bombaMax());
      this.hud.setBomba(p.bombaCount);
    }
    this.hud.setWeaponLevel(p.weaponLevel);
    this.hud.setShield(p.shield / p.maxShield());
    this.hud.setTimedBuff(p.rapidLevel > 0, p.rapidLevel);
    const PICKUP_COLORS = { WEAPON: 0x5cf2ff, SHIELD: 0x3d8bff, Rapid: 0xffd23d, BOMBA: 0xff8a3c };
    this._explosion.small(at, PICKUP_COLORS[type] ?? 0x5cf2ff);
  }

  _powerupLabel(type) {
    return { WEAPON: 'WEAPON UP', SHIELD: 'SHIELD+', Rapid: 'RAPID+', BOMBA: 'BOMBA +1' }[type];
  }

  _onBossKilled(boss, at) {
    this.score += 5000 + Math.floor(this.waveSystem.wave / 5) * 1000;
    this.kills += 1;
    this._isNewHigh = this.score > this.highScore;
    if (this._isNewHigh) this.highScore = this.score;

    // CRITICAL: actually hide the boss + reset its state.
    // Without onRecycle the boss ship stays visible in-scene
    // (boss.update early-returns on !alive, so it never clears itself).
    boss.onRecycle();

    // Clear the boss's residual fire so the scene is clean during
    // WAVE_CLEAR. Player's live lasers + falling powerups are kept.
    this._context.projectiles.deactivateHostile();

    this._explosion.big(at, 0xff7bd6);
    this._cameraFx.addShake(1.0);
    this._floatingText.spawnAt(at, 'BOSS DOWN', '', true);
    this.audio.play('bossDestroyed');
    this.hud.setScore(this.score);
    this.hud.setHighScore(this.highScore);
    this.hud.hideBoss();
    // GALAGA 2: guaranteed drop — boss kills ALWAYS drop exactly one
    // pickup (weighted type, so it's a real reward, not just shield)
    this._context.projectiles.spawnPowerUp({
      origin: at,
      type: POWERUP.TYPES[this._pickPowerupWeighted()],
      fallSpeed: POWERUP.FALL_SPEED,
    });
    // Set the boss-dead flag so WaveSystem.isComplete only fires once
    // every escort has also been wiped out.
    this.waveSystem.bossDied();

    // If escorts remain, keep PLAYING — the wave will transition to
    // WAVE_CLEAR via the normal _onEnemyKilled isComplete check once
    // the last escort dies.  If there are no escorts, clear immediately.
    // GALAGA 2: boss clears grant a card too (the boss drop already
    // gives shield; this is the build reward on top) — same surge,
    // banner and upgrade-pick pacing as a normal clear.
    if (this.waveSystem.isComplete && this._context.player.alive) {
      this._beginWaveClear();
    }
  }

  _togglePause() {
    if (this.state.current !== States.PLAYING && this.state.current !== States.PAUSED) return;
    if (this.state.current === States.PLAYING) this.state.transition(States.PAUSED);
    else this.state.transition(States.PLAYING);
  }

  _restart() {
    this._beginPlay();
  }

  _toMenu() {
    this._hideAutoToast();
    this._upgradeSelect.cancel();
    this.state.transition(States.MAIN_MENU);
  }

  // ----------------------------------------------------------------
  // main loop
  // ----------------------------------------------------------------
  _loop() {
    const t = performance.now();
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (dt > GAME.MAX_DELTA) dt = GAME.MAX_DELTA; // clamp big frame hitches

    // A single-frame exception must NEVER kill the RAF chain: log it,
    // drop the frame, keep the loop alive. (A silent frozen canvas with
    // a dead loop is the worst failure mode — it looks like the game
    // "hung" with no trace.)
    try {
      this.update(dt);
      this.render();
    } catch (err) {
      console.error('[game loop]', err);
    }

    this.input.endFrame();
    this._raf = requestAnimationFrame(this._loop);
  }

  /** Per-frame update: state-dependent work. */
  update(dt) {
    const ctx = this._context;
    const s = this.state.current;

    // GALAGA 2: wave-clear warp burst — when the board is cleared the
    // craft "surges" forward for a moment. Star speed scales up ~2.8x
    // on a fast-attack / smooth-decay curve, and the camera gets a
    // brief FOV kick (passed as the dashing flag) so the periphery
    // stretches outward. The warp is purely visual: it only multiplies
    // the starfield intensity and eases back to 0 on its own, so it
    // can never fight the dash-FOV logic (dashing OR warping -> boost).
    if (this._clearWarp > 0) {
      this._clearWarp = Math.max(0, this._clearWarp - dt);
    }
    const warpT = WAVE_CFG.CLEAR_WARP_TIME;
    const warpRemain = this._clearWarp / warpT;      // 1 -> 0 over the burst
    // GALAGA 2: the surge envelope is a symmetric curve (peak at t=0.5)
    // that adds up to WARP_STAR_BOOST on top of the constant base
    // star speed (SPEED_FEEL.BASE_STAR_INTENSITY). Because the base is
    // now high (2.0), the surge peak (WARP_STAR_BOOST = 3.0) still reads
    // as a clear "even faster" punch (5.0x total at the apex) rather
    // than the old modest 1.34x bump over a slow cruise.
    const warpBoost = SPEED_FEEL.WARP_STAR_BOOST * warpRemain * (1 - warpRemain) * 4;
    const warpFov = this._clearWarp > 0;

    // GALAGA 2 4D: wormhole layer opacity tracks the warp envelope
    // (peak just after the surge starts, fades out with it)
    if (this._wormEl) {
      const o = warpRemain > 0
        ? Math.min(1, warpBoost / SPEED_FEEL.WARP_STAR_BOOST) * 0.9
        : 0;
      this._wormEl.style.opacity = o.toFixed(3);
      if (warpRemain <= 0) this._wormEl.classList.remove('flare');
    }

    // GALAGA 2 sense of speed: one normalized craft-speed value (0..1)
    // drives the whole modern-arcade stack — dynamic FOV + high-speed
    // camera jitter (CameraEffects), peripheral star rush + longer
    // speed-line trails (starfield below), and the wind audio layer.
    // Dash = full speed. Read before the player update (previous
    // frame's velocity — a 1-frame lag, invisible, and it keeps the
    // ambient starfield call above the player section).
    let speed = 0;
    // While the upgrade panel is open the world (ship, camera) is frozen
    // below, but this speed value still feeds the starfield rush + trails
    // above — the background kept streaking at full flight speed behind
    // the semi-transparent panel, reading as flicker. Settle the
    // speed-driven layer to 0; the base ambient drift (intensity 1.0)
    // still keeps the panel feeling alive.
    if (this._upgradeSelect.active) {
      // wind layer below fades to silence with speed 0 — correct too
    } else if (s !== States.MAIN_MENU && s !== States.GAME_OVER && s !== States.PAUSED &&
        ctx.player.alive) {
      speed = ctx.player.dashTimer > 0
        ? 1
        : Math.hypot(
            ctx.player.velocityX / PLAYER.MAX_SPEED_X,
            ctx.player.velocityY / PLAYER.MAX_SPEED_Y);
      if (speed > 1) speed = 1;
    }
    // wind layer: audible only while flying (menu / game over fade out)
    this.audio.setWind(speed, s !== States.MAIN_MENU);

    // ambient systems that run all the time
    // GALAGA 2: during the wave-clear warp the comet tails double
    // (trailScale 1 -> 2) on top of the speed boost, so the surge
    // reads as long streaks racing past the periphery.
    // GALAGA 2 sense of speed: the craft's speed adds a peripheral
    // rush (star intensity) and longer streaks (speed lines) — the
    // same trick racing games use: the edges of the frame scream.
    ctx.starfield.update(dt,
      (s === States.MAIN_MENU ? 0.7 : SPEED_FEEL.BASE_STAR_INTENSITY) + warpBoost +
        (s === States.MAIN_MENU ? 0 : speed * SPEED_FEEL.STAR_SPEED_BOOST),
      ctx.camera,
      s === States.MAIN_MENU ? 0.7 :
        (warpFov ? 2 : 1) + speed * SPEED_FEEL.TRAIL_SPEED_BOOST);
    this._floatingText.update(dt);
    this._explosion.update(dt);

    if (s === States.MAIN_MENU) {
      // player hover demo in the menu background.
      // _menuT(dt) accumulates the menu clock each frame so the
      // hover keeps its phase across frames.
      ctx.player.group.position.x = Math.sin(this._menuT(dt)) * 6;
      this._setReticleVisible(false);
      this._cameraFx.update(dt, 0);
      return;
    }

    if (s === States.GAME_OVER) {
      // slow world decay: particles continue
      this._setReticleVisible(false);
      ctx.particles.update(dt);
      return;
    }

    if (s === States.PAUSED) {
      this._setReticleVisible(false);
      return;
    }

    // GALAGA 2: upgrade selection — the world (player, enemies, fire,
    // camera) freezes while the player picks a card; only the ambient
    // layers above (starfield / FX / floating text) keep moving, so the
    // panel feels alive without the field moving underneath it.
    if (this._upgradeSelect.active) {
      this._setReticleVisible(false);
      return;
    }

    // PLAYING / WAVE_CLEAR / BOSS_INTRO
    const playing = s === States.PLAYING;
    // The player keeps full control during WAVE_CLEAR lull AND during
    // BOSS_INTRO (the 1.5s cinematic) so they can position and fire.
    const controlled = playing || s === States.WAVE_CLEAR || s === States.BOSS_INTRO;

    // GALAGA 2 juice: derive the WORLD timescale from hitstop (kill
    // freeze) and dash slow-mo. The player always moves at full speed —
    // that's the whole point of the "time extender" (you dodge through
    // a slowed world). Hitstop takes priority (full freeze); otherwise
    // slow-mo scales the world down.
    let worldDt = dt;
    if (this._hitstop > 0) {
      this._hitstop -= dt;
      worldDt = 0;
    } else if (this._slowmoTimer > 0) {
      this._slowmoTimer -= dt;
      worldDt = dt * JUICE.SLOWMO_SCALE;
    }

    // player
    const prevDash = this._prevDashTimer ?? 0;
    if (controlled && ctx.player.alive) {
      ctx.player.update(this.input, dt, this._t0(dt));
    }
    // dash just triggered (previously was 0, now > 0) -> play cue
    if (controlled && ctx.player.alive && prevDash <= 0 && ctx.player.dashTimer > 0) {
      this.audio.play('dash');
      this._cameraFx.addShake(0.12);
      // GALAGA 2 juice: dash triggers a brief world slow-mo (time
      // extender) so the dodge reads as a superpower.
      this._slowmoTimer = JUICE.SLOWMO_DURATION;
    }
    this._prevDashTimer = ctx.player.dashTimer;

    // GALAGA 2: BOMBA — L key (or the touch button) fires the board
    // clearer when stock remains. Player + controlled states only.
    if (controlled && ctx.player.alive && this.input.bombaPressed) {
      this._tryBomba();
    }

    // firing — one shared cadence for auto & manual: a shot leaves only
    // when the cooldown has elapsed, then the cooldown resets to one
    // interval (1/baseRate, 0.5s at base). Holding SPACE/J auto-fires at
    // that cadence; tapping can't fire faster because the same cooldown
    // gates it. Player keeps full control (move + fire) through the
    // WAVE_CLEAR lull — leftovers still fly.
    this._fireCooldown -= dt;
    const wantFire =
      controlled && ctx.player.alive &&
      (this.input.firing || this.input.firePressed);
    if (wantFire && this._fireCooldown <= 0) {
      const stats = ctx.player.weaponStats();
      this._firePlayerLaser(stats);
      this.audio.play('laser');
      this._fireCooldown = 1 / stats.baseRate;
    }

    // enemies
    if (playing || s === States.WAVE_CLEAR) {
      if (s === States.PLAYING) {
        this.waveSystem.update(dt, this);
      }
      for (const e of [...ctx.enemyList]) {
        if (e.state === 'DIVING' && e.curveDone) {
          // (handled internally)
        }
        e.update(this, worldDt, this.waveSystem.wave);
        if (!e.active) {
          this._releaseEnemy(e);
        } else {
          // re-add if already in list (no-op)
        }
      }
      // cleanup list
      for (let i = ctx.enemyList.length - 1; i >= 0; i--) {
        if (!ctx.enemyList[i].active) ctx.enemyList.splice(i, 1);
      }
    }

    // boss
    if ((playing || s === States.BOSS_INTRO || s === States.WAVE_CLEAR) && ctx.boss.alive) {
      ctx.boss.update(this, worldDt);
      this.hud.setBoss(
        ctx.boss.coreHpRatio,
        ctx.boss.phase
      );
      if (!ctx.boss.alive) {
        // handled via _onBossKilled (collision) — also allow the
        // "boss died between frames" case by checking here:
        // (no extra code needed; collision covers it)
      }
    }

    // attack system (dive scheduling)
    if (playing) this.attackSystem.update(dt, this.waveSystem.wave);

    // GALAGA 2: formation beam (runs in the lull too — a charge can
    // finish across the WAVE_CLEAR boundary)
    this.beamSystem.update(dt, this.waveSystem.wave);

    // projectile + powerup systems
    // GALAGA 2: pass the player position so homing missiles can steer.
    // When the player is dead we pass null so any live missiles stop
    // tracking (they fly straight and despawn on the kill-zone).
    // GALAGA 2 juice: world timescale — bullets (both player & enemy)
    // freeze on hitstop and slow on dash, so a kill feels heavy and a
    // dash feels like a time-extender.
    ctx.projectiles.update(
      worldDt,
      this._context.player?.alive ? this._context.player.group.position : null
    );

    // collision (dt drives the powerup magnet suction)
    this._collision.update(dt);

    // combo decay
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // wave clear timer
    if (s === States.WAVE_CLEAR) {
      this._waveClearTimer -= dt;
      // Re-check the LIVE state before starting the next wave: `s` was
      // captured at frame start, but the player can die mid-frame
      // (leftover enemy fire during the lull, or a same-frame death
      // before this frame's kill finished the wave) and flip to
      // GAME_OVER — starting the next wave would overwrite GAME_OVER
      // and begin it with no player ship.
      if (this._waveClearTimer <= 0 && this.state.current === States.WAVE_CLEAR) {
        this.hud.hideWaveClear();
        this._startWave(this.waveSystem.wave + 1);
      }
    }

    // GALAGA 2: upgrade selection pacing — a beat after the surge,
    // then the pick; the countdown above is frozen while pending or
    // while the player is choosing.
    //
    // GALAGA 2: auto-upgrade (A plan, default ON) — EVERY wave clear
    // applies the "most needed" card on the spot (in-world popup + a
    // short bottom toast with UNDO), without freezing the world, so the
    // run never stops to read a card. Setting OFF = the classic 3-card
    // panel on every wave clear.
    if (s === States.WAVE_CLEAR) {
      if (this._upgradeSelect.active) {
        // world is paused inside the loop (early return below)
      } else if (this._upgradePickDelay > 0) {
        this._upgradePickDelay -= dt;
        if (this._upgradePickDelay <= 0 && this.state.current === States.WAVE_CLEAR) {
          this._upgradePickDelay = 0;
          const nextWave = this.waveSystem.wave + 1;
          if (this._settings?.autoUpgrade !== false) {
            // no freeze, no panel — apply the best card straight away,
            // with a toast + undo window (null id = everything maxed:
            // the flat bonus, no toast — nothing to take back)
            const id = this._upgradeSelect.autoPick(
              this._context.player, nextWave);
            this._autoApplyUpgrade(id, nextWave);
          } else {
            // The WAVE CLEAR banner and the card panel both claim the
            // screen centre. While the panel is open the world is frozen
            // (early return above), so the countdown that would normally
            // hide the banner never runs. Shift the banner up out of the
            // way (CSS transition) instead of hiding it — hiding + re-showing
            // re-triggered the 0.5s slide-in animation while the panel was
            // fading out, and the two crossfaded into a visible flicker.
            this.hud.shiftWaveClear(true);
            this._upgradeSelect.show(
              this._context.player, nextWave,
              (id) => {
                this.hud.shiftWaveClear(false);
                this._applyUpgrade(id);
              },
            );
          }
        }
      }
    }

    // boss intro timer
    if (s === States.BOSS_INTRO) {
      this._bossIntroTimer -= dt;
      // Same race as above: if the player died during the intro
      // (leftover shots) the GAME_OVER transition must not be
      // overwritten by the intro's return to PLAYING.
      if (this._bossIntroTimer <= 0 && this.state.current === States.BOSS_INTRO) {
        this.state.transition(States.PLAYING);
      }
    }

    // HUD live updates
    if (ctx.player.alive) {
      this.hud.setShield(ctx.player.shield / ctx.player.maxShield());
      this.hud.setLife(ctx.player.lives);
      this.hud.setWeaponLevel(ctx.player.weaponLevel);
      // GALAGA 2: dash readiness meter (cooldown-driven)
      this.hud.setDash(ctx.player.dashCooldown);
      this.hud.setTimedBuff(ctx.player.rapidLevel > 0, ctx.player.rapidLevel);
      this.hud.setCombo(Math.max(1, Math.min(10, Math.floor(this.combo) + 1)));
    }

    // camera
    // GALAGA 2: pass the player altitude so the camera damped-follows
    // vertically (CameraEffects.update handles the offset; the base
    // framing incl. mobile look-lift is untouched). The forward-view
    // layer adds lateral speed (camera roll) + dash state (FOV kick) +
    // the normalized craft speed (dynamic FOV + high-speed jitter).
    this._cameraFx.update(
      dt,
      ctx.player.alive ? ctx.player.group.position.x : 0,
      ctx.player.alive ? ctx.player.group.position.y : BOUNDS.PLAYER_Y,
      ctx.player.alive ? ctx.player.velocityX : 0,
      (ctx.player.alive && ctx.player.dashTimer > 0) || warpFov,
      speed
    );

    // GALAGA 2: aim reticle — recomputed AFTER the camera update so the
    // unproject uses this frame's final camera pose. The reticle is
    // shown only while the player can act (PLAYING / lull / boss intro);
    // it hides in the menu, pause, and game-over panels (above).
    if (controlled) {
      this._updateReticle();
      this._setReticleVisible(ctx.player.alive);
    }

    // particles
    ctx.particles.update(dt);

    // GALAGA 2: BOMBA salvo — flies forward on REAL dt (the player side,
    // so it keeps pace even while the world is in slow-mo) and HOMES on
    // the live board. Each returned entry is a detonation this frame:
    // the board-clear runs once per salvo, the rest cascade as chain
    // explosions.
    const bombas = this._bombaMissile.update(dt, ctx.enemyList, ctx.boss);
    for (const d of bombas) {
      this._bombaDetonate(d.pos, d.salvoId);
    }
  }

  _menuT(dt) {
    this._menuClock = (this._menuClock ?? 0) + dt;
    return this._menuClock;
  }
  _t0(dt) {
    this._gameClock = (this._gameClock ?? 0) + dt;
    return this._gameClock;
  }

  // ----------------------------------------------------------------
  // GALAGA 2: aim reticle (mouse NDC -> camera ray -> world point)
  // ----------------------------------------------------------------
  _buildReticleDom() {
    // the reticle node ships in index.html (with its crosshair parts);
    // just grab it so _updateReticle can drive its position/state.
    this._reticleEl = this._hudRoot.querySelector('#aim-reticle');
    // wormhole FX layer (index.html, sibling of #game-root)
    this._wormEl = document.getElementById('wormhole');
    this._wormFlareTO = 0;
    // GALAGA 2: auto-aim UI — the in-HUD "AUTO" badge (shown while on)
    // and the touch AUTO toggle button (touch devices only, inside
    // #touch-controls which is itself hidden on desktop).
    this._autoBadge = this._hudRoot.querySelector('#autoBadge');
    this._autoTouchBtn = document.getElementById('tcAuto');
    if (this._autoTouchBtn) {
      this._autoTouchBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.setAutoAim(!this.autoAim, true);
      });
      this._autoTouchBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /**
   * GALAGA 2 4D: fire the wormhole at warp start — chromatic
   * temperature flash (0.6s CSS keyframes) + pitch-drop hyper-swipe.
   * Called from both wave-clear trigger points.
   */
  _wormFlare() {
    if (this._wormEl) {
      this._wormEl.classList.remove('flare');
      void this._wormEl.offsetWidth; // restart the CSS animation
      this._wormEl.classList.add('flare');
    }
    clearTimeout(this._wormFlareTO);
    this._wormFlareTO = setTimeout(
      () => this._wormEl && this._wormEl.classList.remove('flare'), 700);
    this.audio.play('warp');
  }

  /**
   * GALAGA 2: BOMBA — the one-shot board clearer, now a launched missile.
   *
   * One press (L / touch button) consumes one unit of stock and LAUNCHES
   * a missile from the craft that flies straight forward for
   * BOMBA.FLIGHT_TIME and detonates at the formation. The board-clear —
   * wiping EVERY hostile shot, dealing BOMBA.DAMAGE to every live enemy
   * + the boss (kills route through the normal _onEnemyKilled path:
   * score, combo, drop suppression via _bombaKilling), and the flash-bang
   * cue + screen flash + shake — runs at DETONATION in _bombaDetonate,
   * not now.
   *
   * Stock: starts at BOMBA.COUNT_START, refilled by the BOMBA power-up
   * drop enemies drop (capped at COUNT_MAX + T2 expansions).
   */
  _tryBomba() {
    const ctx = this._context;
    const p = ctx.player;
    if (p.bombaCount <= 0) {
      // empty-stock cue so the press doesn't feel 'dead'
      this.audio.play('hitTick');
      return;
    }
    p.bombaCount -= 1;
    this.hud.setBomba(p.bombaCount);
    this.audio.play('bombaLaunch');
    // launch the SALVO — the lead missile detonates ~BOMBA.FLIGHT_TIME
    // from now and _bombaDetonate performs the board-clear exactly once;
    // the remaining missiles cascade in behind it.
    this._bombaSalvo += 1;
    const id = this._bombaSalvo;
    // prune ids more than a few back (no live salvo is older than that)
    for (const old of this._bombaSalvoCleared) {
      if (id - old > 8) this._bombaSalvoCleared.delete(old);
    }
    // pass the live board so each missile is assigned a target to home on
    this._bombaMissile.launch(p.group.position, id, ctx.enemyList, ctx.boss);
  }

  /**
   * GALAGA 2: BOMBA detonation. Every salvo missile that reaches the
   * formation calls in here — the FIRST one of a salvo performs the
   * full board-clear (deduped via _bombaSalvoCleared); the rest are
   * pure chain explosions so the burst reads as "dozens of torpedoes
   * punching through the formation". Only fires while the world is
   * actually in play (a wave transition / game-over that lands while
   * missiles are in flight must not detonate into a dead world).
   */
  _bombaDetonate(pos, salvoId) {
    const s = this.state.current;
    if (s !== States.PLAYING && s !== States.WAVE_CLEAR && s !== States.BOSS_INTRO) {
      return;
    }
    // not the lead of this salvo — a chain explosion, no board-clear
    if (this._bombaSalvoCleared.has(salvoId)) {
      this._explosion.medium(pos, 0xffa63c, 0.9);
      return;
    }
    this._bombaSalvoCleared.add(salvoId);
    const p = this._context.player;
    const ctx = this._context;
    this.audio.play('bomba');
    this.hud.flashBomba();
    this._cameraFx.addShake(0.6);

    // 1) clear every hostile projectile (player lasers are kept)
    ctx.projectiles.deactivateHostile();

    // 1b) sever an in-progress formation beam (the flash-bang cuts the
    //     laser — shooters drop back to their formation)
    this.beamSystem.cancel();

    // 2) damage the whole board. Kills route through _onEnemyKilled
    // (score + combo + wave progress); _bombaKilling suppresses the
    // per-kill power-up drops so the blast can't be farmed for pickups.
    this._bombaKilling = true;
    const bDmg = p.bombaDamage(); // GALAGA 2 T2: BOMBA 확장 피해 배율
    for (const e of [...ctx.enemyList]) {
      if (e.active && !e.dying) {
        const killed = e.hit(bDmg);
        if (killed) this._onEnemyKilled(e, e.group.position);
      }
    }
    const boss = ctx.boss;
    if (boss && boss.alive) {
      const killed = boss.hit(bDmg);
      if (killed) this._onBossKilled(boss, boss.position);
    }
    this._bombaKilling = false;

    // 3) the detonation itself — a big blast at the formation so the
    // missile's arrival reads as an explosion, not just a flash (the
    // rest of the salvo chains in behind this one, see above)
    this._explosion.big(pos, 0xffc94d, 1.5);
    this._floatingText.spawnAt(pos, 'BOMBA', '#ffd23d', true);
  }

  /**
   * Per-frame reticle update.
   *
   * GALAGA 2 AUTO-AIM (this.autoAim): the reticle homes onto the nearest
   * enemy ahead (boss-priority) with lead — the player only dodges and
   * holds fire. On mobile the aim point is pinned to screen center
   * (aimX/Y = 0,0), so this is what actually aims the shots.
   *
   * MANUAL (autoAim off): the aim ray comes from the camera through the
   * mouse NDC (input.aimX/aimY); target = the live enemy closest to the
   * ray within AIM.LOCK_RADIUS; when none, the ray meets the default
   * z = AIM.FALLBACK_Z plane.
   *
   * Results:
   *   this._reticleWorld — world point shots fly toward (used by
   *                        _firePlayerLaser)
   * Returns the reticle world point.
   */
  _updateReticle() {
    const cam = this._context.camera;
    const input = this.input;

    // GALAGA 2: during the wave-clear lull there are (nearly) no targets
    // and the surge camera drifts, so the free reticle wanders into the
    // lower half of the screen. Pin it dead-center for a clean lull; if
    // the player fires, the shots fly straight ahead.
    // The centred reticle sits behind the wave-clear popup, so fade it
    // fully transparent for the whole lull (restore in the normal path
    // below). The shots still fly straight ahead, so aiming is unaffected.
    if (this.state.current === States.WAVE_CLEAR) {
      _reticleWorld.copy(cam.position);
      _reticleWorld.z = AIM.FALLBACK_Z;
      if (this._reticleEl) {
        this._reticleEl.style.transform =
          `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px) translate(-50%, -50%)`;
        this._reticleEl.style.opacity = '0';
      }
      this._reticleWorld.copy(_reticleWorld);
      return this._reticleWorld;
    }

    // Leaving the wave-clear lull: restore the reticle's full opacity
    // (it was faded out while centred behind the clear popup).
    if (this._reticleEl && this._reticleEl.style.opacity === '0') {
      this._reticleEl.style.opacity = '';
    }

    // aim ray: unproject the mouse NDC from the camera (view space
    // -Z through the cursor); no manual quaternion math needed
    _ndc.set(input.aimX, input.aimY, 0.5).unproject(cam).sub(cam.position).normalize();

    let best = null;
    let autoPoint = null;

    if (this.autoAim) {
      // auto-aim: pick the nearest enemy ahead (boss-priority) with a
      // lead-compensated intercept point. `point` is where the target
      // will be when the shot arrives.
      const pick = this._pickAutoTarget();
      if (pick) { best = pick.entity; autoPoint = pick.point; }
    }

    if (!best && !this.autoAim) {
      // manual aim only (auto-aim ON with no target ahead fires straight
      // forward — never ray-locks a rear enemy through the screen center)
      let bestD = AIM.LOCK_RADIUS;
      for (const e of this._context.enemyList) {
        if (!e.active || e.dying) continue;
        _toEnemy.copy(e.group.position).sub(cam.position);
        const along = _toEnemy.dot(_ndc);
        if (along < 2) continue; // behind or too close to the camera
        const px = _toEnemy.x - _ndc.x * along;
        const py = _toEnemy.y - _ndc.y * along;
        const pz = _toEnemy.z - _ndc.z * along;
        const d = Math.sqrt(px * px + py * py + pz * pz) - e.radius;
        if (d < bestD) { bestD = d; best = e; }
      }
      // Lock hysteresis: a currently-locked target sticks until the aim
      // ray moves WELL outside the lock radius (LOCK_HOLD_FACTOR).
      if (this._lockedEnemy && this._lockedEnemy.active && !this._lockedEnemy.dying) {
        const le = this._lockedEnemy;
        _toEnemy.copy(le.group.position).sub(cam.position);
        const along = _toEnemy.dot(_ndc);
        if (along >= 2) {
          const px = _toEnemy.x - _ndc.x * along;
          const py = _toEnemy.y - _ndc.y * along;
          const pz = _toEnemy.z - _ndc.z * along;
          const d = Math.sqrt(px * px + py * py + pz * pz) - le.radius;
          if (d < AIM.LOCK_RADIUS * AIM.LOCK_HOLD_FACTOR) best = le;
        }
      }
    }
    this._lockedEnemy = best;

    if (best && autoPoint) {
      // auto-aim: snap onto the lead-compensated intercept point
      _reticleWorld.copy(autoPoint);
    } else if (best) {
      // manual lock: snap onto the enemy's position
      _reticleWorld.copy(best.group.position);
    } else {
      // no target: intersect the default aim plane (auto-aim on mobile
      // has aimX/Y = 0,0, so this is straight ahead)
      const denom = _ndc.z;
      if (Math.abs(denom) < 1e-5) {
        _reticleWorld.copy(cam.position).addScaledVector(_ndc, 60);
      } else {
        const t = (AIM.FALLBACK_Z - cam.position.z) / denom;
        _reticleWorld.copy(cam.position).addScaledVector(_ndc, t > 0 ? t : 60);
      }
    }

    // DOM crosshair follows the world point (project to screen)
    if (this._reticleEl) {
      _ndc.copy(_reticleWorld).project(cam);
      const behindCam = _ndc.z > 1;
      if (!behindCam) {
        const x = (_ndc.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-_ndc.y * 0.5 + 0.5) * window.innerHeight;
        this._reticleEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
    }
    // publish to the instance so _firePlayerLaser reads the same point
    this._reticleWorld.copy(_reticleWorld);
    return this._reticleWorld;
  }

  /**
   * GALAGA 2: auto-aim target selection. Returns { entity, point } where
   * `point` is the lead-compensated intercept position (where the target
   * will be when the shot arrives), or null when there is nothing to aim
   * at. Boss-priority: the boss is weighted so it "looks" nearer, but a
   * much-nearer bug still wins (a distant boss isn't focused while the
   * ship is under fire). Only targets IN FRONT of the craft are
   * considered (smaller world-z).
   */
  _pickAutoTarget() {
    const ctx = this._context;
    const player = ctx.player;
    if (!player.alive) return null;
    const origin = player.group.position;
    // a target qualifies only if it is at least FRONT_MARGIN ahead (smaller z)
    const frontMin = origin.z - AIM.FRONT_MARGIN;

    let bestEnt = null;
    let bestScore = Infinity;
    const consider = (ent, weight) => {
      const p = ent.position; // group.position (getter on Enemy/Boss/Boss2)
      if (p.z > frontMin) return; // behind the craft
      const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
      const score = Math.sqrt(dx * dx + dy * dy + dz * dz) * weight;
      if (score < bestScore) { bestScore = score; bestEnt = ent; }
    };
    const boss = ctx.boss;
    if (boss && boss.alive) consider(boss, AIM.BOSS_WEIGHT);
    for (const e of ctx.enemyList) {
      if (!e.active || e.dying) continue;
      consider(e, 1);
    }
    if (!bestEnt) return null;

    // Target stickiness (hysteresis): while the previously-locked target is
    // still live, ahead, and within AIM.TARGET_HOLD of the best score, keep
    // it — prevents the reticle (and the intercept lead) flicking between
    // two near-identical targets, which reads as jitter and wastes the
    // trajectory fit on a target that changes every few frames.
    const prev = this._autoTargetEnt;
    if (prev !== bestEnt && prev && prev.alive && !prev.dying) {
      const pp = prev.position;
      if (pp.z <= frontMin + AIM.FRONT_MARGIN * 1.5) {
        const pdx = pp.x - origin.x, pdy = pp.y - origin.y, pdz = pp.z - origin.z;
        const pScore = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);
        if (pScore <= bestScore * AIM.TARGET_HOLD) bestEnt = prev;
      }
    }
    this._autoTargetEnt = bestEnt;

    // Intercept: solve for the lead time at which the shot (speed =
    // baseSpeed) reaches EXACTLY where the target will be. The target's
    // future position is exact — predictPositionAt uses the enemy's own
    // closed-form motion model (a sine bob for formation, an arc-length
    // curve for dives/approaches) — so this is a true intercept, not a
    // fitted approximation. A few fixed-point iterations converge because
    // the predicted point moves smoothly with t.
    const speed = Math.max(1, player.weaponStats().baseSpeed);
    const tp = bestEnt.position;
    let tLead = Math.min(
      Math.hypot(tp.x - origin.x, tp.y - origin.y, tp.z - origin.z) / speed,
      AIM.MAX_LEAD_TIME,
    );
    for (let pass = 0; pass < 3; pass++) {
      bestEnt.predictPositionAt(tLead, _aaP);
      tLead = Math.min(
        Math.hypot(_aaP.x - origin.x, _aaP.y - origin.y, _aaP.z - origin.z) / speed,
        AIM.MAX_LEAD_TIME,
      );
    }
    bestEnt.predictPositionAt(tLead, _aaP);
    return { entity: bestEnt, point: _aaP };
  }

  /** GALAGA 2: toggle auto-aim (KeyQ / menu checkbox / touch button). */
  setAutoAim(on, persist = false) {
    this.autoAim = !!on;
    if (this._settings) this._settings.autoAim = this.autoAim;
    if (this._autoBadge) this._autoBadge.style.display = this.autoAim ? '' : 'none';
    if (this._autoTouchBtn) this._autoTouchBtn.classList.toggle('on', this.autoAim);
    const cb = document.getElementById('setAutoAim');
    if (cb) cb.checked = this.autoAim;
    if (persist) this._saveSettings();
    // in-world confirmation so the toggle is never a dead press
    const p = this._context && this._context.player;
    if (p && p.alive && this.state.current !== States.MAIN_MENU) {
      this._floatingText.spawnAt(
        p.group.position,
        this.autoAim ? 'AUTO AIM ON' : 'AUTO AIM OFF',
        '#2de2ff', true);
    }
  }

  /** Show/hide the reticle + hide the OS cursor while actively playing. */
  _setReticleVisible(visible) {
    if (this._reticleEl) this._reticleEl.style.display = visible ? '' : 'none';
    if (document.body) document.body.classList.toggle('aiming', visible);
  }

  _firePlayerLaser(stats) {
    const p = this._context.player;
    const origin = p.group.position;
    const count = stats.count;
    // Fan the barrels so the side shots fire FROM the wing guns at the tips
    // of the plane (x=±1.95, where the wing barrels sit), not floating
    // outside the silhouette or stacked on the nose. For 3 shots the
    // outer barrels land exactly on the wing-gun tips; for 2, a tight
    // inboard pair.
    const mid = (count - 1) / 2;
    const spacing = 1.95; // world units between adjacent barrels (= wing tip)
    // GALAGA 2: aim at the reticle world point (3D). If the reticle is
    // suspiciously close (aiming at own craft) fall back to straight -Z.
    const dx = this._reticleWorld.x - origin.x;
    const dy = this._reticleWorld.y - origin.y;
    const dz = this._reticleWorld.z - origin.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const aim = dist > 8;
    for (let i = 0; i < count; i++) {
      const xOff = (i - mid) * spacing;
      const from = new THREE.Vector3(origin.x + xOff, origin.y, origin.z - 0.4);
      let dir;
      if (aim) {
        _shotDir.set(dx, dy, dz).normalize();
        dir = _shotDir;
      } else {
        dir = undefined; // spawnPlayerShot falls back to straight -Z
      }
      this._context.projectiles.spawnPlayerShot({ origin: from, angle: 0, stats, dir });
    }
    // TOTAL shots = weapon COUNTS (max 3) — no extra drone fire (removed).
    this._muzzleFlash(origin);
  }


  _muzzleFlash(origin) {
    const c = new THREE.Color(COLORS.PLAYER_LASER);
    for (let i = 0; i < 4; i++) {
      this._context.particles.spawn(
        new THREE.Vector3(origin.x, origin.y, origin.z - 1.4),
        {
          color: c,
          vx: (Math.random() - 0.5) * 6,
          vy: (Math.random() - 0.5) * 6,
          vz: -16 - Math.random() * 6,
          life: 0.12,
          drag: 2,
          gravity: 0,
        }
      );
    }
  }

  // ----------------------------------------------------------------
  // render
  // ----------------------------------------------------------------
  render() {
    // GALAGA 2: Renderer.render routes bloom composer vs direct render
    this.renderer.render();
  }

  // ----------------------------------------------------------------
  // WebGPU fallback
  // ----------------------------------------------------------------
  _failWebGPU() {
    // Keep the menu badge honest — don't leave it on "확인 중…".
    const badge = this.hud?.menuEl?.querySelector('[data-webgpu]');
    if (badge) {
      badge.textContent = 'WebGPU: 미지원';
      badge.classList.remove('ok');
      badge.classList.add('bad');
    }
    const host = this._canvasHost;
    host.innerHTML = `
      <div class="webgpu-fallback">
        <h1>GALAGA 2</h1>
        <p>이 게임은 WebGPU를 지원하는 최신 Chrome 또는 Edge 브라우저가 필요합니다.
        다른 PC에서 접속하는 경우 반드시 <strong>https://</strong> 주소로 접속하세요
        (http:// 로 접속하면 보안 정책상 WebGPU가 비활성화됩니다).</p>
        <p class="sub">Please use a recent <strong>Chrome</strong> or <strong>Edge</strong> over HTTPS with WebGPU enabled.</p>
      </div>`;
  }

  _loadHighScore() {
    try {
      const v = localStorage.getItem(GAME.HIGH_SCORE_KEY);
      if (v) this.highScore = Math.max(0, parseInt(v, 10) || 0);
    } catch (e) {}
  }

  _saveHighScore() {
    try {
      localStorage.setItem(GAME.HIGH_SCORE_KEY, String(Math.floor(this.highScore)));
    } catch (e) {}
  }

  // ----------------------------------------------------------------
  // Settings (menu) — bloom / screen shake / sound & music volume.
  // Persisted in localStorage; screen shake defaults to the OS
  // prefers-reduced-motion the first time (respecting the user's
  // accessibility setting unless they explicitly change the toggle).
  // ----------------------------------------------------------------
  _loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(GAME.SETTINGS_KEY) || '{}'); }
    catch (e) { s = {}; }
    // GALAGA 2: auto-aim ON by default (desktop + mobile); an explicit
    // user choice (persisted) always wins.
    const autoAimDefault = AIM.AUTO_AIM_DEFAULT;
    this._settings = {
      bloom: s.bloom !== false,
      sound: typeof s.sound === 'number' ? s.sound : AUDIO.MASTER_VOLUME,
      music: typeof s.music === 'number' ? s.music : AUDIO.MUSIC_VOLUME,
      motion: (typeof s.motion === 'boolean')
        ? s.motion
        : !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      autoAim: (typeof s.autoAim === 'boolean') ? s.autoAim : autoAimDefault,
      // GALAGA 2: auto-upgrade — default ON (the user found the per-wave
      // card panel disruptive). An explicit persisted choice always wins.
      autoUpgrade: (typeof s.autoUpgrade === 'boolean') ? s.autoUpgrade : UPGRADE.AUTO_DEFAULT,
    };
    this._applySettings();
  }

  _applySettings() {
    const s = this._settings;
    this.renderer.setBloom(!!s.bloom);
    this._cameraFx.shakeScale = s.motion ? 1 : 0;
    this.audio.setVolume(s.sound);
    this.music.setVolume(s.music);
    // auto-aim (drives the HUD badge + touch button + checkbox)
    this.autoAim = !!s.autoAim;
    // sync the menu controls
    const el = (id) => document.getElementById(id);
    const b = el('setBloom'); if (b) b.checked = !!s.bloom;
    const m = el('setMotion'); if (m) m.checked = !!s.motion;
    const sd = el('setSound'); if (sd) sd.value = Math.round(s.sound * 100);
    const mu = el('setMusic'); if (mu) mu.value = Math.round(s.music * 100);
    const aa = el('setAutoAim'); if (aa) aa.checked = this.autoAim;
    const au = el('setAutoUpgrade'); if (au) au.checked = !!s.autoUpgrade;
    if (this._autoBadge) this._autoBadge.style.display = this.autoAim ? '' : 'none';
    if (this._autoTouchBtn) this._autoTouchBtn.classList.toggle('on', this.autoAim);
  }

  _saveSettings() {
    try { localStorage.setItem(GAME.SETTINGS_KEY, JSON.stringify(this._settings)); }
    catch (e) {}
  }

  _bindSettings() {
    const el = (id) => document.getElementById(id);
    const on = (id, ev, fn) => {
      const n = el(id);
      if (n) n.addEventListener(ev, fn);
    };
    on('setBloom', 'change', (e) => {
      this._settings.bloom = e.target.checked;
      this._applySettings(); this._saveSettings();
    });
    on('setMotion', 'change', (e) => {
      this._settings.motion = e.target.checked;
      this._applySettings(); this._saveSettings();
    });
    on('setSound', 'input', (e) => {
      this._settings.sound = Math.max(0, Math.min(1, e.target.value / 100));
      this._applySettings(); this._saveSettings();
    });
    on('setMusic', 'input', (e) => {
      this._settings.music = Math.max(0, Math.min(1, e.target.value / 100));
      this._applySettings(); this._saveSettings();
    });
    on('setAutoAim', 'change', (e) => {
      this._settings.autoAim = e.target.checked;
      this._applySettings(); this._saveSettings();
    });
    on('setAutoUpgrade', 'change', (e) => {
      this._settings.autoUpgrade = e.target.checked;
      this._applySettings(); this._saveSettings();
    });
  }

  // ----------------------------------------------------------------
  // HUD binding
  // ----------------------------------------------------------------
  _bindHud() {
    this.hud.bind({
      onStart: () => this._beginPlay(),
      onResume: () => this._togglePause(),
      onRestart: () => this._restart(),
      onRestartMenu: () => this._toMenu(),
    });
    // save high score periodically (once — the game lives for the page)
    if (!this._hsSaveTO) {
      this._hsSaveTO = setInterval(() => this._saveHighScore(), 2000);
    }
  }
}
