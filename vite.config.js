import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// VITE_BUILD_TARGET=electron|capacitor flips the renderer into the matching
// shell mode. This is set by the electron:dev/electron:build and ios:build npm
// scripts. Anything else (web dev, `vite build`, Vercel) gets the web variant.
// The literals are read in src/lib/platform.js and drive tree-shaking - e.g.
// the LandingPage import is pruned from the Electron and Capacitor bundles.
const isElectronBuild = process.env.VITE_BUILD_TARGET === 'electron'
const isCapacitorBuild = process.env.VITE_BUILD_TARGET === 'capacitor'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.js'],
    setupFiles: ['src/stores/__tests__/setup.js'],
  },
  base: './',
  define: {
    __IS_ELECTRON__: JSON.stringify(isElectronBuild),
    __IS_CAPACITOR__: JSON.stringify(isCapacitorBuild),
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
