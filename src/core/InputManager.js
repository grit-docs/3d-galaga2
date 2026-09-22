/**
 * InputManager.js
 * ---------------------------------------------------------------
 * Keyboard input abstraction with "just pressed" detection and a
 * small hook system for one-shot actions (pause, restart...).
 * Keeps entity/system code free from raw DOM event handling.
 * ---------------------------------------------------------------
 */
const MOVE_LEFT = new Set(['KeyA', 'ArrowLeft']);
const MOVE_RIGHT = new Set(['KeyD', 'ArrowRight']);
// GALAGA 2: free Y-axis flight (W/S or arrow up/down).
const MOVE_UP = new Set(['KeyW', 'ArrowUp']);
const MOVE_DOWN = new Set(['KeyS', 'ArrowDown']);
const FIRE = new Set(['Space', 'KeyJ']);
const DASH = new Set(['ShiftLeft', 'ShiftRight', 'KeyK']);
// GALAGA 2: BOMBA (the classic one-shot board clearer). L — the original
// Galaga "B button" hand position, free of every existing mapping.
const BOMBA = new Set(['KeyL']);

export class InputManager {
  constructor() {
    this._down = new Set();
    this._justPressed = new Set();
    this._pressedOnceFired = new Set();
    this._actions = new Map(); // key -> [fn]

    // touch layer (mobile): virtual stick axis + fire button state
    this._touchAxisX = 0;
    this._touchAxisY = 0;
    this._touchFiring = false;
    // GALAGA 2: touch BOMBA button -> one-frame press flag
    this._touchBomba = false;
    // GALAGA 2: touch DASH button -> one-frame press flag (like bomba)
    this._touchDash = false;

    // GALAGA 2 mouse aim: NDC coordinates of the last mousemove
    // (screen center at boot, so the first shot fires straight ahead
    // until the player actually moves the cursor).
    this.aimX = 0;
    this.aimY = 0;
    // left mouse button held down -> firing (shared with Space/J)
    this._mouseFiring = false;
    this._mouseJustPressed = false; // one-frame flag, cleared in endFrame

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    // Left button only — right-click stays free (context menu etc.)
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this._initTouchControls();
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    if (
      e.code === 'Space' ||
      e.code.startsWith('Arrow') ||
      e.code === 'ShiftLeft' ||
      e.code === 'ShiftRight'
    ) {
      e.preventDefault();
    }
    this._down.add(e.code);
    if (!this._pressedOnceFired.has(e.code)) {
      this._justPressed.add(e.code);
      this._pressedOnceFired.add(e.code);
    }
    const fns = this._actions.get(e.code);
    if (fns) for (const fn of fns) fn(e);
  }

  _onKeyUp(e) {
    this._down.delete(e.code);
  }

  _onBlur() {
    this._down.clear();
    this._touchAxisX = 0;
    this._touchAxisY = 0;
    this._touchFiring = false;
    this._mouseFiring = false;
  }

  // ----------------------------------------------------------------
  // GALAGA 2 mouse aim: NDC tracking + left-button fire
  // ----------------------------------------------------------------
  _onMouseMove(e) {
    // NDC: x right +1, y UP +1 (inverted clientY)
    this.aimX = (e.clientX / window.innerWidth) * 2 - 1;
    this.aimY = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    this._mouseFiring = true;
    this._mouseJustPressed = true;
  }

  _onMouseUp(e) {
    if (e.button !== 0) return;
    this._mouseFiring = false;
  }

  /** Register a one-shot action for a key code (e.g. 'KeyP'). */
  onAction(code, fn) {
    if (!this._actions.has(code)) this._actions.set(code, []);
    this._actions.get(code).push(fn);
  }

  isDown(code) {
    return this._down.has(code);
  }

  isAnyDown(set) {
    for (const c of set) if (this._down.has(c)) return true;
    return false;
  }

  /** Accepts a Set or an array of key codes. */
  wasPressed(codes) {
    for (const code of this._justPressed) {
      if (codes instanceof Set ? codes.has(code) : codes.includes(code)) return true;
    }
    return false;
  }

  get dashPressed() {
    if (this.wasPressed(DASH)) return true;
    if (this._touchDash) {
      this._touchDash = false; // one-frame press, like bombaPressed
      return true;
    }
    return false;
  }

  /** GALAGA 2: BOMBA press (one frame per press, like dashPressed).
   *  Fires on the L key OR the touch BOMBA button. */
  get bombaPressed() {
    if (this.wasPressed(BOMBA)) return true;
    if (this._touchBomba) {
      this._touchBomba = false;
      return true;
    }
    return false;
  }

  /** -1 left, +1 right, 0 center (movement axis). The touch stick gives
   *  an analog value and wins whenever it is displaced from center. */
  get axisX() {
    if (this._touchAxisX !== 0) return this._touchAxisX;
    let axis = 0;
    if (this.isAnyDown(MOVE_LEFT)) axis -= 1;
    if (this.isAnyDown(MOVE_RIGHT)) axis += 1;
    return axis;
  }

  /** GALAGA 2: -1 down, +1 up, 0 center (vertical movement axis).
   *  Mirrors axisX; the touch stick dy provides the analog value. */
  get axisY() {
    if (this._touchAxisY !== 0) return this._touchAxisY;
    let axis = 0;
    if (this.isAnyDown(MOVE_DOWN)) axis -= 1;
    if (this.isAnyDown(MOVE_UP)) axis += 1;
    return axis;
  }

  /** True while ANY fire source (Space/J, left mouse, touch FIRE) is
   *  held — drives auto-fire. */
  get firing() {
    return this._touchFiring || this._mouseFiring || this.isAnyDown(FIRE);
  }

  /** True exactly for one frame per fire press (key or left mouse) —
   *  drives the manual-tap first shot; both paths are gated by the
   *  shared fire cooldown. */
  get firePressed() {
    if (this.wasPressed(FIRE)) return true;
    if (this._mouseJustPressed) {
      this._mouseJustPressed = false;
      return true;
    }
    return false;
  }

  // ----------------------------------------------------------------
  // touch controls (mobile): virtual stick (left) + fire button (right)
  // ----------------------------------------------------------------
  _initTouchControls() {
    const wrap = document.getElementById('touch-controls');
    const stick = document.getElementById('tcStick');
    const knob = document.getElementById('tcKnob');
    const fire = document.getElementById('tcFire');
    if (!wrap || !stick || !knob || !fire) return;

    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!coarse && !hasTouch) return; // desktop keyboard/touchpad: keep hidden
    wrap.classList.add('on');

    // --- virtual stick: analog -1..1 horizontal axis ---------------
    let stickActive = false;
    const knobTo = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const stickMove = (e) => {
      if (!stickActive) return;
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2 - 10; // keep the knob inside the base
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      knobTo(dx, dy);
      this._touchAxisX = dx / max;
      // GALAGA 2: stick dy drives the vertical axis (screen up = +1)
      this._touchAxisY = -dy / max;
    };

    const stickDown = (e) => {
      stickActive = true;
      stick.classList.add('dragging');
      try { stick.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      this._touchAxisX = 0;
      this._touchAxisY = 0;
      stickMove(e);
      e.preventDefault();
    };
    const stickEnd = (e) => {
      if (!stickActive) return;
      stickActive = false;
      stick.classList.remove('dragging');
      try { stick.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      this._touchAxisX = 0;
      this._touchAxisY = 0;
      knobTo(0, 0);
    };

    stick.addEventListener('pointerdown', stickDown);
    stick.addEventListener('pointermove', stickMove);
    stick.addEventListener('pointerup', stickEnd);
    stick.addEventListener('pointercancel', stickEnd);

    // --- fire button: hold down = continuous auto-fire --------------
    fire.addEventListener('pointerdown', (e) => {
      try { fire.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      fire.classList.add('pressed');
      this._touchFiring = true;
      e.preventDefault();
    });
    const fireUp = () => {
      fire.classList.remove('pressed');
      this._touchFiring = false;
    };
    fire.addEventListener('pointerup', fireUp);
    fire.addEventListener('pointercancel', fireUp);
    // Android: long-press would otherwise open a context menu
    fire.addEventListener('contextmenu', (e) => e.preventDefault());
    stick.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- GALAGA 2: BOMBA button (one tap = one blast) --------------
    const bomba = document.getElementById('tcBomba');
    if (bomba) {
      bomba.addEventListener('pointerdown', (e) => {
        try { bomba.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        bomba.classList.add('pressed');
        this._touchBomba = true;
        e.preventDefault();
      });
      const bombaUp = () => bomba.classList.remove('pressed');
      bomba.addEventListener('pointerup', bombaUp);
      bomba.addEventListener('pointercancel', bombaUp);
      bomba.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // --- GALAGA 2: DASH button (one tap = one dash) ----------------
    const dash = document.getElementById('tcDash');
    if (dash) {
      dash.addEventListener('pointerdown', (e) => {
        try { dash.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        dash.classList.add('pressed');
        this._touchDash = true;
        e.preventDefault();
      });
      const dashUp = () => dash.classList.remove('pressed');
      dash.addEventListener('pointerup', dashUp);
      dash.addEventListener('pointercancel', dashUp);
      dash.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** Call once per frame at the end of update: clears pressed flags. */
  endFrame() {
    this._justPressed.clear();
    this._pressedOnceFired.clear();
    this._mouseJustPressed = false;
  }
}
