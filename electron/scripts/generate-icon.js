/**
 * Rasterizes the brand SVG into the icons electron-builder embeds:
 *   - electron/icon.png — 1024×1024, used by BrowserWindow at runtime and as
 *     the Linux/macOS source for electron-builder.
 *   - electron/icon.ico — multi-resolution (16/24/32/48/64/128/256), used by
 *     electron-builder on Windows. Passing a pre-built .ico avoids the
 *     single-size 256×256 ICO that electron-builder's PNG→ICO fallback
 *     produces, which Windows scales poorly for the taskbar and sometimes
 *     causes rcedit to leave the default Electron atom embedded.
 *
 * Hooked into `preelectron:build` so the icons always track the SVG source.
 * Run manually with `npm run icon:generate`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..', '..')

const sourcePath = join(projectRoot, 'public', 'plannr-icon-light.svg')
const pngPath = join(projectRoot, 'electron', 'icon.png')
const icoPath = join(projectRoot, 'electron', 'icon.ico')

const svg = readFileSync(sourcePath)

function renderPng(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

writeFileSync(pngPath, renderPng(1024))

// Modern Windows accepts PNG-encoded images inside an ICO container at any
// size. Storing PNGs (instead of BMPs) keeps the file small while preserving
// alpha — same approach electron-builder itself uses for its 256×256 output.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const images = ICO_SIZES.map((size) => ({ size, png: renderPng(size) }))

function buildIco(items) {
  const n = items.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(n, 4) // image count

  const directory = Buffer.alloc(n * 16)
  let dataOffset = 6 + n * 16
  for (let i = 0; i < n; i++) {
    const { size, png } = items[i]
    const base = i * 16
    directory.writeUInt8(size >= 256 ? 0 : size, base + 0) // width (0 == 256)
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1) // height
    directory.writeUInt8(0, base + 2) // palette colors (0 = no palette)
    directory.writeUInt8(0, base + 3) // reserved
    directory.writeUInt16LE(1, base + 4) // color planes
    directory.writeUInt16LE(32, base + 6) // bits per pixel
    directory.writeUInt32LE(png.length, base + 8) // image data size
    directory.writeUInt32LE(dataOffset, base + 12) // image data offset
    dataOffset += png.length
  }

  return Buffer.concat([header, directory, ...items.map((i) => i.png)])
}

writeFileSync(icoPath, buildIco(images))

console.log(`Wrote ${pngPath} (1024×1024)`)
console.log(`Wrote ${icoPath} (${ICO_SIZES.join(', ')})`)
