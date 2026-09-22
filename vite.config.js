import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  // GitHub Pages: project-site base path (https://<user>.github.io/3d-galaga2/)
  base: '/3d-galaga2/',
  // WebGPU only exists in SECURE contexts: https:// or http://localhost.
  // LAN clients (http://192.168.x.x) are non-secure and would see
  // navigator.gpu === undefined, so serve the dev server over HTTPS
  // with a self-signed cert (clients accept the warning once).
  plugins: [basicSsl()],
  resolve: {
    // GALAGA 2: single three instance. The game imports 'three/webgpu'
    // directly; the jsm post-processing addons import bare 'three'
    // (the WebGL core build). Two instances = two material systems, so
    // composer passes built from the wrong copy throw
    // "ShaderMaterial is not compatible" at runtime. Alias bare 'three'
    // onto the webgpu build so every import is the same module graph.
    alias: {
      // exact match ONLY — a plain-string alias would rewrite deep
      // imports ('three/examples/...') to 'three/webgpu/examples/...'
      // and break the build.
      find: /^three$/,
      replacement: 'three/webgpu',
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
