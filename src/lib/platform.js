/**
 * Platform detection  single source of truth for "which shell is this running in?"
 *
 * Two flavors per shell:
 *   - IS_ELECTRON_BUILD / IS_CAPACITOR_BUILD: Vite-injected literals
 *     (true/false). Set by `VITE_BUILD_TARGET=electron|capacitor` in npm
 *     scripts. Because Rollup sees these as constants, dead branches (and any
 *     imports inside them) are eliminated  this is what lets the Electron and
 *     iOS builds skip bundling LandingPage.vue.
 *   - isElectron / isCapacitor: build-time literal OR a runtime fallback.
 *     Electron's fallback checks the preload-exposed
 *     `window.electronAPI.isElectron` sentinel; Capacitor's checks the
 *     `Capacitor.isNativePlatform()` runtime, which the @capacitor/core
 *     package provides even in non-native builds (it just returns false).
 *     Use these when branching at runtime (e.g. hiding a link in a template).
 *
 * Use the *_BUILD constants for build-time decisions (route table shape,
 * imports). Use the plain (isElectron / isCapacitor) exports for everything
 * else.
 */
import { Capacitor } from '@capacitor/core'

// eslint-disable-next-line no-undef -- injected by Vite's `define`
export const IS_ELECTRON_BUILD = __IS_ELECTRON__
// eslint-disable-next-line no-undef -- injected by Vite's `define`
export const IS_CAPACITOR_BUILD = __IS_CAPACITOR__

export const isElectron =
  IS_ELECTRON_BUILD ||
  (typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron))

// Electron on macOS. The window-control buttons live on opposite sides per OS
// (traffic lights top-left on mac, min/max/close top-right on Windows), so the
// title-bar layout branches on this (App.vue adds .is-mac to <html>).
//
// This value is frozen the moment this module is first imported, so the mac
// check has to be correct at that instant. `window.electronAPI.platform` is the
// authoritative source, but with sandbox:true that preload handle occasionally
// isn't populated yet when platform.js evaluates — and because `isElectron` can
// be true purely from IS_ELECTRON_BUILD, the const would then freeze to `false`
// on macOS for the whole session (the traffic lights end up overlapping the
// logo). Fall back to the user agent, which is always readable synchronously on
// the renderer's window, so mac is detected regardless of preload timing.
function detectMacElectron() {
  if (!isElectron || typeof window !== 'object') return false
  const platform = window.electronAPI?.platform
  if (platform) return platform === 'darwin'
  const nav = window.navigator || {}
  const uaPlatform = nav.userAgentData?.platform || nav.platform || ''
  return /mac/i.test(uaPlatform) || /Mac OS X|Macintosh/i.test(nav.userAgent || '')
}

export const isMacElectron = detectMacElectron()

export const isCapacitor = IS_CAPACITOR_BUILD || Capacitor.isNativePlatform()

export const isIOS = isCapacitor && Capacitor.getPlatform() === 'ios'
