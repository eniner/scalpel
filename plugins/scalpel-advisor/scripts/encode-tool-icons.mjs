import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'src', 'assets', 'icons')
const out = path.join(root, 'src', 'shared', 'toolIcons.ts')

const map = {
  'gem-leveling': 'facetors-lens.png',
  'gem-transfig': 'transfigured-gem.png',
  beasts: 'bestiary-orb.png',
  'scarab-atlas': 'scarab.png',
  essences: 'deafening-essence-of-greed.png',
  harvest: 'harvest.png',
  'currency-trends': 'faustus.png',
  'boss-profit': 'maven.png',
  nightmare: 'nightmare-map.png',
  betrayal: 'syndicate-medallion.png',
  scrying: 'scrying-orb.png',
}

const lines = ['/** Bundled hub icons (data URLs). */', 'export const TOOL_ICONS: Record<string, string> = {']
for (const [id, file] of Object.entries(map)) {
  const buf = fs.readFileSync(path.join(dir, file))
  lines.push(`  '${id}': 'data:image/png;base64,${buf.toString('base64')}',`)
}
lines.push('}', '')
fs.writeFileSync(out, lines.join('\n'))
console.log('wrote', out, fs.statSync(out).size)
