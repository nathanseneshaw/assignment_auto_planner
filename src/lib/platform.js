/**
 * Platform detection — single source of truth for "are we running inside Electron?"
 *
 * Two flavors:
 *   - IS_ELECTRON_BUILD: a Vite-injected literal (true/false). Set by
 *     `VITE_BUILD_TARGET=electron` in npm scripts. Because Rollup sees it as a
 *     constant, dead branches (and any imports inside them) are eliminated —
 *     this is what lets the Electron build skip bundling LandingPage.vue.
 *   - isElectron: build-time literal OR a runtime fallback that checks the
 *     preload-exposed `window.electronAPI.isElectron` sentinel. Use this when
 *     branching at runtime (e.g. hiding a link in a Vue template).
 *
 * Use IS_ELECTRON_BUILD for build-time decisions (route table shape, imports).
 * Use isElectron for everything else.
 */

// eslint-disable-next-line no-undef -- injected by Vite's `define`
export const IS_ELECTRON_BUILD = __IS_ELECTRON__

export const isElectron =
  IS_ELECTRON_BUILD ||
  (typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron))
