#!/usr/bin/env node
/**
 * Generates assets/icon.ico (Windows) and assets/icon.png (512px, used for Mac)
 * from assets/icon.svg.
 *
 * Usage: node scripts/build-icons.js
 */
const fs = require('fs')
const path = require('path')
const { Resvg } = require('@resvg/resvg-js')
const toIco = require('to-ico')

const root = path.resolve(__dirname, '..')
const svgPath = path.join(root, 'assets', 'icon.svg')
const svgData = fs.readFileSync(svgPath)

async function main() {
  console.log('Building icons from assets/icon.svg...')

  // Render SVG → PNG at multiple sizes for ICO (16, 32, 48, 64, 128, 256)
  const icoSizes = [16, 32, 48, 64, 128, 256]
  const pngBuffers = icoSizes.map((size) => {
    const resvg = new Resvg(svgData, {
      fitTo: { mode: 'width', value: size },
    })
    return resvg.render().asPng()
  })

  // Write 512px PNG (used for macOS — rename to .icns manually or via iconutil)
  const resvg512 = new Resvg(svgData, { fitTo: { mode: 'width', value: 512 } })
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), resvg512.render().asPng())
  console.log('  ✓ assets/icon.png (512px)')

  // Build ICO from all sizes
  const icoBuffer = await toIco(pngBuffers)
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), icoBuffer)
  console.log('  ✓ assets/icon.ico (Windows)')

  console.log('\nDone. For macOS, convert assets/icon.png to icon.icns using:')
  console.log('  iconutil (Mac only) or an online converter.')
}

main().catch((err) => { console.error(err); process.exit(1) })
