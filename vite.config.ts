import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  optimizeDeps: {
    // Verovio ships a ~7 MB single-file WASM module that breaks esbuild's
    // dependency pre-bundling; we import it dynamically at runtime instead.
    exclude: ['verovio'],
  },
  server: {
    port: 3000,
    // Fail loudly if 3000 is taken instead of silently moving to 3001.
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: ["demo.thuannt.id.vn"]
  },
})