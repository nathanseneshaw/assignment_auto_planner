import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// VITE_BUILD_TARGET=electron flips the renderer into Electron mode. This is set
// by the electron:dev and electron:build npm scripts. Anything else (web dev,
// `vite build`, Vercel) gets the web variant. The literal is read in
// src/lib/platform.js and drives tree-shaking — e.g. the LandingPage import is
// pruned from the Electron bundle.
const isElectronBuild = process.env.VITE_BUILD_TARGET === 'electron'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  define: {
    __IS_ELECTRON__: JSON.stringify(isElectronBuild),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  // Without this, `vite preview` serves index.html for /api/* and fetch().json() fails on "<!DOCTYPE...".
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
