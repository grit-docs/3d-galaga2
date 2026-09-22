/**
 * main.js
 * ---------------------------------------------------------------
 * Application entry point.
 *
 * 1. Grab the two DOM roots (#game-root canvas host + #hud root).
 * 2. Check WebGPU support up front; if missing, show the mandated
 *    Korean fallback and stop (the spec's fallback message).
 * 3. Otherwise construct and bootstrap Game (which still performs
 *    its own init-time safety check in case navigator.gpu is
 *    present but WebGPU context creation fails).
 *
 * Keeping this file tiny means all real game logic stays inside
 * Game.js and the systems — easy to test, easy to swap engines.
 * ---------------------------------------------------------------
 */
import { Game } from './core/Game.js';
import { isWebGPUSupported } from './core/Renderer.js';

const FALLBACK =
  '이 게임은 WebGPU를 지원하는 최신 Chrome 또는 Edge 브라우저가 필요합니다. ' +
  '다른 PC에서 접속하는 경우 반드시 https:// 주소로 접속하세요 ' +
  '(http:// 로 접속하면 보안 정책상 WebGPU가 비활성화됩니다).';

function ensureDom() {
  const canvasHost = document.getElementById('game-root');
  const hud = document.getElementById('hud');
  return { canvasHost, hud };
}

function showFallback(message) {
  // Update the GPU badge so the menu (if still mounted) stops showing
  // the stale "확인 중…" state, then replace the canvas host with the
  // explanatory fallback panel.
  const badge = document.querySelector('[data-webgpu]');
  if (badge) {
    badge.textContent = 'WebGPU: 미지원';
    badge.classList.remove('ok');
    badge.classList.add('bad');
  }
  const host = document.getElementById('game-root');
  if (host) {
    host.innerHTML = `
      <div class="webgpu-fallback" role="alert">
        <h1>GALAGA 2</h1>
        <p>${message}</p>
        <p class="sub">
          Please use a recent
          <strong>Chrome</strong> or
          <strong>Edge</strong>
          with WebGPU enabled.
        </p>
      </div>`;
  }
}

async function boot() {
  const { canvasHost, hud } = ensureDom();

  if (!canvasHost || !hud) {
    showFallback('Failed to find required DOM roots. Reload the page.');
    console.error('[main] missing #game-root or #hud');
    return;
  }

  // Spec requirement: hard-gate on WebGPU availability.
  if (!isWebGPUSupported()) {
    showFallback(FALLBACK);
    return;
  }

  try {
    const game = new Game(canvasHost, hud);
    await game.bootstrap();
    window.__ns = game; // debug / screenshot handle
  } catch (err) {
    console.error('[main] bootstrap failed:', err);
    showFallback(
      'Renderer failed to start. Check the browser console for details.'
    );
  }
}

// Kick off. `boot` is async but top-level await is intentionally
// avoided so dev tools can still attach before the first frame.
boot();
