import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the exact same bundle works from:
//  - the Express server (http://localhost:8787)
//  - a static host / CDN
//  - the Android TV app (file:///android_asset/)
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
