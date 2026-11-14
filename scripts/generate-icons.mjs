import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const source = await readFile(new URL('../node_modules/lucide-static/icons/languages.svg', import.meta.url), 'utf8')
const iconSvg = Buffer.from(source.replace('stroke="currentColor"', 'stroke="#176f5e"'))
const background = { r: 232, g: 246, b: 238, alpha: 1 }

async function writeIcon(size, filename) {
  const markSize = Math.round(size * 0.56)
  const mark = await sharp(iconSvg).resize(markSize, markSize).png().toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background },
  }).composite([{ input: mark, gravity: 'centre' }]).png().toFile(fileURLToPath(new URL(`../public/icons/${filename}`, import.meta.url)))
}

await writeIcon(192, 'icon-192.png')
await writeIcon(512, 'icon-512.png')
await writeIcon(512, 'icon-512-maskable.png')
