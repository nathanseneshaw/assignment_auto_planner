import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const projectRoot = process.cwd()

// Glyph only (paper + checkmark) with the outer rounded-rect background
// stripped out, so @capacitor/assets can composite it onto a full-bleed
// square per platform instead of double-rounding an already-rounded source.
const lightGlyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect x="32" y="10" width="50" height="62" rx="7" fill="none" stroke="#FFFFFF" stroke-width="4" opacity="0.4"></rect>
  <rect x="24" y="20" width="50" height="62" rx="7" fill="none" stroke="#FFFFFF" stroke-width="4" opacity="0.7"></rect>
  <rect x="16" y="30" width="50" height="62" rx="7" fill="#FFFFFF"></rect>
  <path d="M27 60 L36 69 L53 50" fill="none" stroke="#0D4D3A" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`

const darkGlyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect x="32" y="10" width="50" height="62" rx="7" fill="none" stroke="#7FE0B4" stroke-width="4" opacity="0.4"></rect>
  <rect x="24" y="20" width="50" height="62" rx="7" fill="none" stroke="#7FE0B4" stroke-width="4" opacity="0.7"></rect>
  <rect x="16" y="30" width="50" height="62" rx="7" fill="#7FE0B4"></rect>
  <path d="M27 60 L36 69 L53 50" fill="none" stroke="#0B1410" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`

function renderPng(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

writeFileSync(join(projectRoot, 'assets', 'logo.png'), renderPng(lightGlyph, 1024))
writeFileSync(join(projectRoot, 'assets', 'logo-dark.png'), renderPng(darkGlyph, 1024))

console.log('Wrote assets/logo.png and assets/logo-dark.png (1024x1024, transparent bg)')
