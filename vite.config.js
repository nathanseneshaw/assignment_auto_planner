import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue({
    template: {
      compilerOptions: {
        // <webview> is an Electron-specific element, not a Vue component
        isCustomElement: (tag) => tag === 'webview',
      },
    },
  })],
  base: './',
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
