/**
 * Renderer.js
 * ---------------------------------------------------------------
 * Thin wrapper around Three.js WebGPURenderer.
 * - Feature-detects WebGPU support up front.
 * - Async init (renderer.init() is async in three's WebGPU build).
 * - Owns scene, camera, lights, fog, background.
 * - Handles resize.
 * ---------------------------------------------------------------
 */
// three/webgpu — required for THREE.WebGPURenderer (see Renderer.init)
import * as THREE from 'three/webgpu';
// GALAGA 2: native WebGPU bloom. `pass` is the TSL (three shading
// language) scene-capture node; `bloom` is the built-in bloom post
// effect. Both run on the WebGPU pipeline (no WebGL jsm composer).
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { CAMERA, COLORS, BLOOM } from '../config.js';

export function isWebGPUSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

export class Renderer {
  constructor(canvasHost) {
    this._host = canvasHost;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this._baseCamPos = new THREE.Vector3().fromArray([CAMERA.POS.x, CAMERA.POS.y, CAMERA.POS.z]);
    this._baseCamLook = new THREE.Vector3().fromArray([CAMERA.LOOK.x, CAMERA.LOOK.y, CAMERA.LOOK.z]);
    // Touch/pen (portrait phone) framing flag — same test as the touch
    // controls in InputManager. When true, cameraBase() aims the camera
    // lower so the player ship sits higher on-screen (see CAMERA.MOBILE_LOOK_LIFT).
    this._coarse = (() => {
      try {
        return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
          || 'ontouchstart' in window
          || navigator.maxTouchPoints > 0;
      } catch { return false; }
    })();
    this._lookOut = new THREE.Vector3();
  }

  async init() {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(COLORS.BG, 1);

    const canvas = this.renderer.domElement;
    this._host.appendChild(canvas);

    await this.renderer.init();

    this.scene = new THREE.Scene();
    // GALAGA 2: depth cue — denser fog makes distant objects (formation,
    // far bullets) fade more, so the z-axis reads clearly.
    this.scene.fog = new THREE.FogExp2(COLORS.BG, 0.008);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR,
      CAMERA.FAR
    );
    this.camera.position.copy(this._baseCamPos);
    this.camera.lookAt(this._baseCamLook);

    this._setupLights();
    this._initBloom();
    return this;
  }

  /**
   * GALAGA 2: bloom via the NATIVE WebGPU post-processing pipeline
   * (THREE.PostProcessing + TSL bloom node) — the official three.js
   * webgpu_postprocessing_bloom pattern. No WebGL jsm composer, so it
   * works identically on WebGPU and WebGL2 (the renderer falls back to
   * WebGL2 on GPUs where its WebGPU backend is broken, and the TSL
   * pipeline runs there too).
   * Any failure degrades gracefully to direct rendering.
   */
  _initBloom() {
    if (!BLOOM.ENABLED) return;
    // ?bloom=0 — A/B compare toggle for debugging/playtests
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('bloom') === '0') {
      this._bloomDisabledByQuery = true;
      return;
    }
    this._buildBloom();
  }

  /** Build (or rebuild) the native TSL bloom pipeline. */
  _buildBloom() {
    try {
      const pp = new THREE.PostProcessing(this.renderer);
      const scenePass = pass(this.scene, this.camera);
      const sceneColor = scenePass.getTextureNode('output');
      this._bloomPass = bloom(sceneColor, BLOOM.STRENGTH, BLOOM.RADIUS, BLOOM.THRESHOLD);
      pp.outputNode = sceneColor.add(this._bloomPass);
      this._postProcessing = pp;
    } catch (err) {
      console.warn('[Renderer] bloom unavailable, direct render:', err);
      this._postProcessing = null;
    }
  }

  /** Runtime bloom toggle (menu setting). Rebuilding is cheap — it just
   *  composes three TSL nodes; the heavy work (pipeline binaries) is
   *  cached by the renderer, so toggling back on is instant. */
  setBloom(on) {
    if (on && !this._postProcessing && !this._bloomDisabledByQuery) {
      this._buildBloom();
    } else if (!on && this._postProcessing) {
      this._postProcessing.dispose?.();
      this._postProcessing = null;
    }
  }

  _setupLights() {
    const scene = this.scene;

    const ambient = new THREE.AmbientLight(0x2a3560, 0.9);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0x7fa8ff, 1.6);
    key.position.set(6, 18, 10);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xb060ff, 0.8);
    rim.position.set(-10, 6, -14);
    scene.add(rim);

    // subtle cool fill from below to lift dark hulls
    const fill = new THREE.HemisphereLight(0x1a2a55, 0x05030a, 0.6);
    scene.add(fill);
  }

  resize() {
    // A resize event can fire while init() is still awaiting (mobile
    // viewports adjust on load) — camera/scene don't exist until then.
    if (!this.renderer || !this.camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    // GALAGA 2: the native post-processing pipeline auto-tracks the
    // renderer size (it renders into the renderer's own targets).
  }

  /** Restore base camera framing (called each frame before custom cam FX).
   * On mobile (coarse pointer) the look target is aimed lower on narrow
   * viewports, which shifts the whole scene UP — lifting the player ship
   * off the bottom edge on portrait phones. Scaling with (1.35 - aspect)
   * means wide/desktop-ish views are unaffected. */
  cameraBase() {
    let lookY = this._baseCamLook.y;
    if (this._coarse && this.camera) {
      const narrow = Math.max(0, 1.35 - this.camera.aspect);
      lookY -= narrow * CAMERA.MOBILE_LOOK_LIFT;
    }
    this._lookOut.copy(this._baseCamLook);
    this._lookOut.y = lookY;
    return { pos: this._baseCamPos, look: this._lookOut };
  }

  /**
   * GALAGA 2: one render entry point for the game. Routes through the
   * native TSL post-processing pipeline when bloom was adopted, direct
   * renderer.render otherwise.
   */
  render() {
    if (this._postProcessing) {
      this._postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this._postProcessing?.dispose?.();
    this.renderer?.dispose();
    this._host.replaceChildren();
  }
}
