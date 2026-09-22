/**
 * GameState.js
 * ---------------------------------------------------------------
 * Minimal finite-state machine for the top level game flow.
 * States:
 *   BOOT -> MAIN_MENU -> PLAYING <-> PAUSED
 *     PLAYING -> WAVE_CLEAR -> PLAYING
 *     PLAYING -> BOSS_INTRO -> PLAYING
 *     PLAYING / BOSS_INTRO -> GAME_OVER -> MAIN_MENU
 * ---------------------------------------------------------------
 */
export const States = Object.freeze({
  BOOT: 'BOOT',
  MAIN_MENU: 'MAIN_MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  WAVE_CLEAR: 'WAVE_CLEAR',
  BOSS_INTRO: 'BOSS_INTRO',
  GAME_OVER: 'GAME_OVER',
});

export class GameState {
  constructor() {
    this._state = States.BOOT;
    this._listeners = new Map();
  }

  get current() {
    return this._state;
  }

  is(states) {
    return Array.isArray(states) ? states.includes(this._state) : this._state === states;
  }

  transition(next) {
    const prev = this._state;
    this._state = next;
    // call listeners registered for the NEW state, then generic ones
    for (const fn of this._listeners.get(next) ?? []) fn(prev, next);
    for (const fn of this._listeners.get('*') ?? []) fn(prev, next);
  }

  on(state, fn) {
    if (!this._listeners.has(state)) this._listeners.set(state, []);
    this._listeners.get(state).push(fn);
    return () => this.off(state, fn);
  }

  off(state, fn) {
    const list = this._listeners.get(state);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }
}
