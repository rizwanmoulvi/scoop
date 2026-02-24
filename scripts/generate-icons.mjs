/**
 * Generates simple solid-color PNG icons for the extension.
 * Run: node scripts/generate-icons.mjs
 *
 * Uses pngjs (installed as a dev dependency).
 * For a quick placeholder, this script creates blue/white circle icons.
 */

import { createWriteStream, mkdirSync } from 'fs'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ICONS_DIR = join(__dirname, '../public/icons')

mkdirSync(ICONS_DIR, { recursive: true })

const sizes = [16, 32, 48, 128]

for (const size of sizes) {
  const png = new PNG({ width: size, height: size, filterType: -1 })

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) * 4

      // Draw a teal circle on dark background
      const cx = size / 2
      const cy = size / 2
      const r = size / 2 - 1
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)

      if (dist <= r) {
        // Inside circle: branded blue #1d9bf0
        png.data[idx] = 0x1d     // R
        png.data[idx + 1] = 0x9b // G
        png.data[idx + 2] = 0xf0 // B
        png.data[idx + 3] = 255  // A
      } else {
        // Outside circle: transparent
        png.data[idx] = 0
        png.data[idx + 1] = 0
        png.data[idx + 2] = 0
        png.data[idx + 3] = 0
      }
    }
  }

  const out = createWriteStream(join(ICONS_DIR, `icon${size}.png`))
  png.pack().pipe(out)
  console.log(`✓ icon${size}.png`)
}
