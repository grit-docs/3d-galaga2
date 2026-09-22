/**
 * AudioSystem.js
 * ---------------------------------------------------------------
 * A small Web Audio API synthesiser. No external assets, all tones
 * are generated at runtime from oscillator + gain envelopes.
 *
 * Exposes play(name) for a fixed set of cues used across the game:
 *   laser, enemyLaser, explosion, playerHit, powerUp, bossAlert,
 *   bossDestroyed, gameOver, waveClear, dash, bomba
 *
 * Falls back to a no-op when audio is unavailable so the game keeps
 * working if the user's environment blocks Web Audio.
 *
 * The API is intentionally swappable: replace _play with a call to
 * an <audio> element / Howler / etc. and everything keeps working.
 * ---------------------------------------------------------------
 */
import { AUDIO, SPEED_FEEL } from '../config.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = AUDIO.ENABLED;
    this.volume = AUDIO.MASTER_VOLUME;
    this._master = null;
  }

  /** Lazy-init: browsers only allow AudioContext after a gesture. */
  ensure() {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this._master = this.ctx.createGain();
      this._master.gain.value = this.volume;
      this._master.connect(this.ctx.destination);
    } catch (err) {
      this.ctx = null;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(m) {
    if (this._master) this._master.gain.value = m ? 0 : this.volume;
  }

  /** Set the master SFX volume (0..1). Live — applies to the running
   *  gain node and is the value restored when unmuting. */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this._master) this._master.gain.value = this.volume;
  }

  /**
   * GALAGA 2 sense of speed: continuous wind layer — "sound is half
   * the sensation". A looping band-passed noise source whose gain and
   * filter frequency track the craft's normalized speed (0..1): at
   * rest it is inaudible, at full speed it is a rushing "whoosh" that
   * sharpens (higher cutoff) the faster you fly. The node graph is
   * built lazily on the first active call (after a user gesture, so
   * the AudioContext is allowed to start) and then reused forever —
   * only two parameter ramps per call, zero allocations.
   *
   * @param speed normalized craft speed 0..1
   * @param active false in the main menu / game over (fades to silence)
   */
  setWind(speed, active = true) {
    if (!this.enabled) return;
    const s = Math.max(0, Math.min(1, speed || 0));
    if (active && this.ctx && !this._wind) {
      try {
        const buf = this._noiseBuffer(2);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.7;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        src.connect(bp).connect(gain).connect(this._master);
        src.start();
        this._wind = { src, bp, gain };
      } catch (err) {
        this._wind = null;
      }
    }
    if (!this._wind) return;
    const t = this.ctx.currentTime;
    const target = active ? s * s * SPEED_FEEL.WIND_MAX_GAIN : 0; // quadratic: quiet at low speed
    this._wind.gain.gain.setTargetAtTime(target, t, 0.09);
    // the "edge" of the wind sharpens with speed: 450 Hz -> 2600 Hz
    this._wind.bp.frequency.setTargetAtTime(450 + s * 2150, t, 0.12);
  }

  play(name) {
    if (!this.enabled) return;
    this.ensure();
    this.resume();
    if (!this.ctx) return;
    switch (name) {
      case 'laser': this._laser(); break;
      case 'enemyLaser': this._enemyLaser(); break;
      case 'hitTick': this._hitTick(); break;
      case 'explosion': this._explosion(false); break;
      case 'bigExplosion': this._explosion(true); break;
      case 'playerHit': this._playerHit(); break;
      case 'powerUp': this._powerUp(); break;
      case 'bossAlert': this._bossAlert(); break;
      case 'bossDestroyed': this._bossDestroyed(); break;
      case 'gameOver': this._gameOver(); break;
      case 'waveClear': this._waveClear(); break;
      case 'dash': this._dash(); break;
      case 'warp': this._warp(); break;
      case 'bomba': this._bomba(); break;
      case 'bombaLaunch': this._bombaLaunch(); break;
      case 'beamCharge': this._beamCharge(); break;
      case 'beamFire': this._beamFire(); break;
      default: break;
    }
  }

  // -------- tone building blocks ---------------------------------
  _tone({ freq = 440, type = 'square', peak = 0.3, dur = 0.15, slide = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this._master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  _noise({ peak = 0.3, dur = 0.2, lowpass = 800 }) {
    if (!this.ctx) return;
    const buf = this._noiseBuffer(1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this._master);
    src.start(t0);
    src.stop(t0 + dur + 0.01);
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // -------- named cues -------------------------------------------
  _laser() {
    // Classic arcade "pew": a bright sawtooth that drops fast from high to
    // low (longer than the old 80ms blip so it reads as a laser zap, not a
    // pop). A high-pass kills the low "thud", and a thin square "zip" up
    // top adds the sharp attack that makes it feel like a beam.
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const hp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 650;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1500, t0);
    osc.frequency.exponentialRampToValueAtTime(280, t0 + 0.16);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.17, t0 + 0.006); // sharp attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.19);
    osc.connect(hp).connect(gain).connect(this._master);
    osc.start(t0);
    osc.stop(t0 + 0.2);
    this._tone({ freq: 2600, type: 'square', peak: 0.05, dur: 0.07, slide: -1700 });
  }
  _hitTick() {
    // short metallic 'clink' — confirms a non-lethal laser impact
    this._tone({ freq: 620, type: 'triangle', peak: 0.10, dur: 0.05, slide: -220 });
  }
  _enemyLaser() {
    this._tone({ freq: 320, type: 'square', peak: 0.12, dur: 0.09, slide: 160 });
  }
  _explosion(big) {
    this._noise({ peak: big ? 0.5 : 0.28, dur: big ? 0.5 : 0.22, lowpass: big ? 260 : 700 });
    this._tone({ freq: big ? 90 : 140, type: 'sine', peak: big ? 0.3 : 0.18, dur: big ? 0.4 : 0.18, slide: -60 });
  }
  _playerHit() {
    this._noise({ peak: 0.24, dur: 0.24, lowpass: 500 });
    this._tone({ freq: 120, type: 'triangle', peak: 0.2, dur: 0.2, slide: 120 });
  }
  _powerUp() {
    this._tone({ freq: 520, type: 'square', peak: 0.15, dur: 0.06 });
    setTimeout(() => this._tone({ freq: 780, type: 'square', peak: 0.15, dur: 0.08 }), 70);
    setTimeout(() => this._tone({ freq: 1100, type: 'square', peak: 0.14, dur: 0.12 }), 150);
  }
  _bossAlert() {
    this._tone({ freq: 180, type: 'sawtooth', peak: 0.22, dur: 0.9, slide: -60 });
  }
  _bossDestroyed() {
    this._noise({ peak: 0.6, dur: 1.2, lowpass: 240 });
    this._tone({ freq: 70, type: 'sine', peak: 0.35, dur: 1.1, slide: -30 });
  }
  _gameOver() {
    const notes = [440, 392, 330, 262];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'triangle', peak: 0.2, dur: 0.28 }), i * 180);
    });
  }
  _waveClear() {
    const notes = [523, 659, 784];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'square', peak: 0.16, dur: 0.14 }), i * 90);
    });
  }
  _dash() {
    this._tone({ freq: 900, type: 'sawtooth', peak: 0.1, dur: 0.08, slide: -500 });
  }
  /**
   * GALAGA 2: BOMBA — the board clearer. Reads as a classic arcade
   * flash-bang: a hard noise burst + low boom at the moment of the
   * blast, underpinned by a descending "time-warp" sweep (the world
   * slowing down). ~1.6s.
   */
  _bomba() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // stage 1: the blast — noise burst + deep boom
    this._noise({ peak: 0.55, dur: 0.5, lowpass: 420 });
    this._tone({ freq: 70, type: 'sine', peak: 0.4, dur: 0.55, slide: -25 });
    // stage 2: descending warp sweep — the world dropping into slow-mo
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1200, t0 + 0.05);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 1.5);
    g.gain.setValueAtTime(0.0001, t0 + 0.05);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    o.connect(g).connect(this._master);
    o.start(t0 + 0.05);
    o.stop(t0 + 1.55);
  }
  /**
   * GALAGA 2: BOMBA LAUNCH — the rocket firing from the craft when L is
   * pressed. A rising "launch" whoosh (low engine rumble + a tone that
   * sweeps UP, opposite of the detonation's descending warp sweep) so the
   * two moments read clearly: launch = rising whoosh, detonation = low
   * boom. Short (~0.9s) — the missile is in flight a full BOMBA.FLIGHT_TIME
   * after this plays, so it must not linger.
   */
  _bombaLaunch() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // engine rumble on launch
    this._noise({ peak: 0.3, dur: 0.6, lowpass: 300 });
    this._tone({ freq: 60, type: 'sine', peak: 0.3, dur: 0.6, slide: 30 });
    // rising launch sweep — the rocket accelerating away
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t0);
    o.frequency.exponentialRampToValueAtTime(700, t0 + 0.85);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(g).connect(this._master);
    o.start(t0);
    o.stop(t0 + 0.92);
  }
  /**
   * GALAGA 2: beam CHARGE — a rising warning whine under the telegraph
   * line (the "powering up" cue). Short, so it reads as urgency, not
   * atmosphere.
   */
  _beamCharge() {
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t0);
    o.frequency.exponentialRampToValueAtTime(1400, t0 + 0.55);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    o.connect(g).connect(this._master);
    o.start(t0);
    o.stop(t0 + 0.62);
  }
  /**
   * GALAGA 2: beam FIRE — a hard zap that holds: a bright burst into a
   * sustained crackle (detuned pair + noise) for the FIRE_TIME window.
   */
  _beamFire() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const hold = 1.2;
    // the initial strike
    this._noise({ peak: 0.3, dur: 0.12, lowpass: 5200 });
    this._tone({ freq: 1800, type: 'square', peak: 0.16, dur: 0.1, slide: -900 });
    // the sustained crackle — two detuned oscillators + band-passed noise
    for (const f of [1150, 1187]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + 0.08);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.14);
      g.gain.setValueAtTime(0.05, t0 + hold - 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + hold);
      o.connect(g).connect(this._master);
      o.start(t0 + 0.08);
      o.stop(t0 + hold + 0.02);
    }
    const buf = this._noiseBuffer(hold);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.08);
    g.gain.linearRampToValueAtTime(0.08, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + hold);
    src.connect(bp).connect(g).connect(this._master);
    src.start(t0 + 0.08);
    src.stop(t0 + hold);
  }
  /**
   * GALAGA 2 4D: warp/hyper-swipe — a rising "space-tear" chirp into a
   * long falling saw sweep (engine surging forward) + filtered noise
   * rush, then a faint blue-white shimmer tail. ~2.2s.
   */
  _warp() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // stage 1: rising chirp — the wormhole opening (0 -> 0.35s)
    const o1 = this.ctx.createOscillator();
    const g1 = this.ctx.createGain();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(160, t0);
    o1.frequency.exponentialRampToValueAtTime(1800, t0 + 0.32);
    g1.gain.setValueAtTime(0.0001, t0);
    g1.gain.linearRampToValueAtTime(0.16, t0 + 0.18);
    g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    o1.connect(g1).connect(this._master);
    o1.start(t0);
    o1.stop(t0 + 0.42);
    // stage 2: falling sweep — forward surge (0.3 -> 2.0s)
    const o2 = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(1400, t0 + 0.3);
    o2.frequency.exponentialRampToValueAtTime(70, t0 + 2.0);
    g2.gain.setValueAtTime(0.0001, t0 + 0.3);
    g2.gain.linearRampToValueAtTime(0.22, t0 + 0.45);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.0);
    o2.connect(g2).connect(this._master);
    o2.start(t0 + 0.3);
    o2.stop(t0 + 2.05);
    // stage 3: noise rush, band-passed so it reads as wind/hyperlight
    const buf = this._noiseBuffer(2.0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t0);
    bp.frequency.exponentialRampToValueAtTime(300, t0 + 1.6);
    bp.Q.value = 0.8;
    const g3 = this.ctx.createGain();
    g3.gain.setValueAtTime(0.0001, t0);
    g3.gain.linearRampToValueAtTime(0.18, t0 + 0.4);
    g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
    src.connect(bp).connect(g3).connect(this._master);
    src.start(t0);
    src.stop(t0 + 1.95);
  }
}
