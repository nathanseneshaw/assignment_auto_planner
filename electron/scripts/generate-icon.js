/**
 * Rasterizes the brand SVG into the 1024×1024 PNG that electron-builder needs.
 *
 * electron-builder takes a single high-res PNG via `build.icon` and emits the
 * platform-specific bundles (Windows .ico, macOS .icns, Linux PNGs) at install
 * time. We use the light icon variant because the OS-level icon shows in the
 * taskbar/dock against any background, and the green is more brand-recognizable
 * than the dark mint variant.
 *
 * Hooked into `preelectron:build` so the PNG always tracks the SVG source.
 * Run manually with `npm run icon:generate`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..', '..')

const sourcePath = join(projectRoot, 'public', 'plannr-icon-light.svg')
const outPath = join(projectRoot, 'electron', 'icon.png')

const svg = readFileSync(sourcePath)
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
const png = resvg.render().asPng()
writeFileSync(outPath, png)

console.log(`Wrote ${outPath} (1024×1024) from ${sourcePath}`)
