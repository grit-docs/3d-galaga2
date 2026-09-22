/**
 * MusicEngine.js
 * ---------------------------------------------------------------
 * Adaptive procedural BGM — pure WebAudio, zero audio assets.
 *
 * A look-ahead scheduler (25ms interval, schedules ~120ms ahead)
 * plays a 4-bar loop (Am – F – C – G, 132 BPM) whose LAYERS change
 * with the game mode, so the music "adapts":
 *
 *   menu — slow pad chords + sparse arpeggio (calm, inviting)
 *   play — bass + 8th arp + kick/snare/hat groove (steady combat)
 *   boss — driving 16th-note arp, stabs, denser drums (tension)
 *   off  — silent
 *
 * The engine is lazy: it does nothing until the AudioContext exists
 * (created on the first user gesture via AudioSystem.ensure), so no
 * "AudioContext was not allowed to start" warnings on page load.
 * All voices route through a dedicated music gain under the master.
 * ---------------------------------------------------------------
 */
import { AUDIO } from '../config.js';

const BPM = 132;
const STEP_DUR = 60 / BPM / 4;          // 16th note in seconds
const STEPS_PER_BAR = 16;
const BARS = 4;
const LOOKAHEAD = 0.12;                 // seconds scheduled ahead

// 4-bar chord loop: Am, F, C, G
//   bass — root for the bassline
//   arp  — arpeggio notes (ascending chord tones)
//   pad  — menu pad chord (root + fifth-ish)
const CHORDS = [
  { bass: 55.00, arp: [220.00, 261.63, 329.63, 440.00], pad: [110.00, 164.81] },
  { bass: 43.65, arp: [174.61, 220.00, 261.63, 349.23], pad: [87.31, 130.81] },
  { bass: 65.41, arp: [261.63, 329.63, 392.00, 523.25], pad: [130.81, 196.00] },
  { bass: 49.00, arp: [196.00, 246.94, 293.66, 392.00], pad: [98.00, 146.83] },
];

export class MusicEngine {
  constructor(audio) {
    this.audio = audio;
    this.mode = 'off';
    this.volume = AUDIO.MUSIC_VOLUME;
    this._step = 0;
    this._totalSteps = 0;   // monotonic — for debug/E2E (resets don't touch it)
    this._nextTime = 0;
    this._gain = null;
    this._noiseBuf = null;
    // Cheap no-op interval until ctx exists / mode is enabled.
    this._timer = setInterval(() => this._tick(), 25);
  }

  /** Switch the adaptive mode: 'menu' | 'play' | 'boss' | 'off'. */
  setMode(mode) {
    const ok = !!(this.audio?.enabled && AUDIO.MUSIC_ENABLED);
    this.mode = ok ? mode : 'off';
  }

  /** Set the music volume (0..1). Applies live — the next scheduled
   *  note (and an existing gain node) picks the new level up. */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this._gain) this._gain.gain.value = this.volume;
  }

  dispose() {
    if (this._timer != null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._gain?.disconnect();
    this._gain = null;
  }

  _ctx() {
    return this.audio.ctx;
  }

  _tick() {
    const ctx = this._ctx();
    if (!ctx || ctx.state !== 'running' || this.mode === 'off') return;
    if (!this._gain) {
      this._gain = ctx.createGain();
      this._gain.gain.value = this.volume;
      this._gain.connect(this.audio._master);
    }
    // first time we actually have a running context: start the clock
    if (this._nextTime < ctx.currentTime) {
      this._step = 0;
      this._nextTime = ctx.currentTime + 0.15;
    }
    while (this._nextTime < ctx.currentTime + LOOKAHEAD) {
      this._scheduleStep(this._step % (STEPS_PER_BAR * BARS), this._nextTime);
      this._nextTime += STEP_DUR;
      this._step++;
      this._totalSteps++;
    }
  }

  // -------- pattern -------------------------------------------------
  _scheduleStep(step, t) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const s16 = step % STEPS_PER_BAR;
    const chord = CHORDS[bar % BARS];
    const mode = this.mode;

    if (mode === 'menu') {
      if (s16 === 0) this._pad(t, chord.pad, STEP_DUR * STEPS_PER_BAR - 0.05);
      if (s16 % 4 === 0) this._arp(t, chord.arp[((s16 >> 2) + bar) % 4], 0.045);
      return;
    }

    // play & boss share the bass; boss layers tension on top
    if (s16 % 2 === 0) this._bass(t, chord.bass * (s16 === 8 ? 2 : 1));

    if (mode === 'play') {
      if (s16 % 2 === 0) this._arp(t, chord.arp[((s16 >> 1) + bar * 2) % 4], 0.065);
      if (s16 === 0 || s16 === 8) this._kick(t);
      if (s16 === 4 || s16 === 12) this._snare(t);
      if (s16 % 4 === 2) this._hat(t);
    } else if (mode === 'boss') {
      // driving 16th arp, octaves up on the back of each 8th
      const seq = [0, 2, 1, 3];
      const f = chord.arp[seq[(s16 + bar) % 4]] * (s16 % 8 === 6 ? 2 : 1);
      this._arp(t, f, 0.05);
      if (s16 === 0 || s16 === 4 || s16 === 8 || s16 === 12) this._kick(t);
      if (s16 === 4 || s16 === 12) this._snare(t);
      if (s16 % 2 === 0) this._hat(t);
      // high tension stabs on the beat
      if (s16 === 0 || s16 === 8) this._stab(t, chord.bass * 8);
    }
  }

  // -------- voices ----------------------------------------------------
  _noise() {
    const ctx = this._ctx();
    if (!this._noiseBuf) {
      const len = Math.floor(ctx.sampleRate);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    return this._noiseBuf;
  }

  _kick(t) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g).connect(this._gain);
    o.start(t); o.stop(t + 0.28);
  }

  _snare(t) {
    const ctx = this._ctx();
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(bp).connect(g).connect(this._gain);
    src.start(t); src.stop(t + 0.18);
  }

  _hat(t) {
    const ctx = this._ctx();
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(hp).connect(g).connect(this._gain);
    src.start(t); src.stop(t + 0.05);
  }

  _bass(t, freq) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(lp).connect(g).connect(this._gain);
    o.start(t); o.stop(t + 0.22);
  }

  _arp(t, freq, peak) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(lp).connect(g).connect(this._gain);
    o.start(t); o.stop(t + 0.12);
  }

  _stab(t, freq) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this._gain);
    o.start(t); o.stop(t + 0.32);
  }

  _pad(t, freqs, dur) {
    const ctx = this._ctx();
    for (const f of freqs) {
      // two detuned saws per note = warm chord body
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        lp.type = 'lowpass';
        lp.frequency.value = 850;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.5);
        g.gain.setValueAtTime(0.035, t + Math.max(0.5, dur - 0.4));
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(lp).connect(g).connect(this._gain);
        o.start(t); o.stop(t + dur + 0.02);
      }
    }
  }
}
