import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = String.raw`C:\Users\E9ine\Desktop\profusion site\all stuff\xddbsns.com`
const outDir = path.join(
  String.raw`C:\Users\E9ine\Downloads\scalpel-main\scalpel-main\plugins\scalpel-advisor\src\data`,
)
const scriptsDir = path.join(
  String.raw`C:\Users\E9ine\Downloads\scalpel-main\scalpel-main\plugins\scalpel-advisor\scripts`,
)

fs.mkdirSync(outDir, { recursive: true })

const report = { written: [], counts: {}, failures: [] }

function writeJson(name, data) {
  const p = path.join(outDir, name)
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
  report.written.push(name)
  return p
}

function evalLiteral(code) {
  const trimmed = code.trim().replace(/;\s*$/, '')
  return vm.runInNewContext(`(${trimmed})`, {}, { timeout: 5000 })
}

function extractBalanced(src, openIdx, openChar, closeChar) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === openChar) depth++
    else if (c === closeChar) {
      depth--
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  throw new Error(`Unbalanced ${openChar}${closeChar} from ${openIdx}`)
}

function extractConstAssignment(src, constName) {
  const re = new RegExp(`const\\s+${constName}\\s*=\\s*`)
  const m = re.exec(src)
  if (!m) return null
  const start = m.index + m[0].length
  const first = src[start]
  if (first === '{' || first === '[') {
    return extractBalanced(src, start, first, first === '{' ? '}' : ']')
  }
  throw new Error(`Unsupported literal for ${constName}`)
}

function readHtml(name) {
  return fs.readFileSync(path.join(root, name), 'utf8')
}

function htmlInputValue(html, id) {
  const re = new RegExp(
    `<input[^>]*id="${id}"[^>]*value="([^"]*)"`,
    'i',
  )
  const m = html.match(re)
  return m ? m[1] : null
}

function htmlSelectDefault(html, id) {
  const blockRe = new RegExp(
    `<select[^>]*id="${id}"[\\s\\S]*?</select>`,
    'i',
  )
  const block = html.match(blockRe)?.[0]
  if (!block) return null
  const selected = block.match(/<option[^>]*value="([^"]*)"[^>]*selected/i)
  if (selected) return selected[1]
  const first = block.match(/<option[^>]*value="([^"]*)"/i)
  return first ? first[1] : null
}

function htmlCheckboxChecked(html, id) {
  const re = new RegExp(`<input[^>]*id="${id}"[^>]*>`, 'i')
  const tag = html.match(re)?.[0]
  if (!tag) return false
  return /\bchecked\b/i.test(tag)
}

function parseNum(v, fallback = 0) {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// --- Betrayal (refresh) ---
try {
  const html = readHtml('betrayal.html')
  const m = html.match(/const ROWS = (\[[\s\S]*?\]);/)
  if (!m) throw new Error('ROWS not found')
  const rows = evalLiteral(m[1])
  writeJson('betrayal-rows.json', rows)
  report.counts['betrayal-rows.json'] = { rows: rows.length }
} catch (e) {
  report.failures.push({ file: 'betrayal-rows.json', error: String(e.message || e) })
}

// --- Nightmare boss rush ---
try {
  const html = readHtml('nightmare-boss-rush.html')
  const bossesBlock = extractConstAssignment(html, 'BOSSES')
  const fragBlock = extractConstAssignment(html, 'FRAGMENT_NAMES')
  const bosses = evalLiteral(bossesBlock)
  const fragmentNames = evalLiteral(fragBlock)
  writeJson('nightmare-bosses.json', { bosses, fragmentNames })
  report.counts['nightmare-bosses.json'] = {
    bosses: bosses.length,
    fragmentNames: Object.keys(fragmentNames).length,
  }
} catch (e) {
  report.failures.push({ file: 'nightmare-bosses.json', error: String(e.message || e) })
}

// --- Boss config + default TTK ---
try {
  const rawPath = path.join(root, 'js/boss-config.js')
  const raw = fs.readFileSync(rawPath, 'utf8')
  fs.writeFileSync(path.join(outDir, 'boss-config.raw.js'), raw)

  const bossesBlock = extractConstAssignment(raw, 'BOSSES')
  const bosses = evalLiteral(bossesBlock)

  let baseNotes = null
  let tradeDefaults = null
  const notesM = raw.match(/const BASE_NOTES = '([^']*)';/)
  if (notesM) baseNotes = notesM[1]
  const tradeM = raw.match(/const TRADE_DEFAULTS = (\{[\s\S]*?\});/)
  if (tradeM) tradeDefaults = evalLiteral(tradeM[1])

  let defaultTtk = null
  try {
    const profitHtml = readHtml('boss-profit.html')
    const ttkBlock = extractConstAssignment(profitHtml, 'DEFAULT_TTK')
    defaultTtk = evalLiteral(ttkBlock)
  } catch (e) {
    report.failures.push({
      file: 'bosses.json (defaultTtk)',
      error: String(e.message || e),
    })
  }

  const payload = {
    baseNotes,
    tradeDefaults,
    defaultTtk,
    bosses,
  }
  writeJson('bosses.json', payload)
  report.counts['bosses.json'] = {
    bosses: Object.keys(bosses).length,
    defaultTtkEntries: defaultTtk ? Object.keys(defaultTtk).length : 0,
  }
} catch (e) {
  report.failures.push({ file: 'bosses.json', error: String(e.message || e) })
  try {
    const raw = fs.readFileSync(path.join(root, 'js/boss-config.js'), 'utf8')
    fs.writeFileSync(path.join(outDir, 'boss-config.raw.js'), raw)
  } catch (_) {}
}

// --- Beasts ---
try {
  const html = readHtml('beast-calculator.html')
  const baseRedM = html.match(/const BASE_RED_BEASTS = ([\d.]+);/)
  const baseYellowM = html.match(/const BASE_YELLOW_BEASTS = ([\d.]+);/)
  const beasts = {
    source: 'beast-calculator.html',
    pricesApi: '/api/beast-calculator/prices',
    note: 'Beast rows and market prices are loaded from the prices API at runtime; not present in the HTTrack mirror.',
    baseRedBeastsPerMap: baseRedM ? parseNum(baseRedM[1], 1) : 1,
    baseYellowBeastsPerMap: baseYellowM ? parseNum(baseYellowM[1], 4.5) : 4.5,
    classifications: ['The Deep', 'The Wilds', 'The Caverns', 'The Sands'],
    atlasBonusesDefault: {
      additionalRedPct: 30,
      additionalYellow: 2,
      yellowToRedPct: 15,
      pairChancePct: 8,
      beastCopyPct: 0,
    },
    scarabDefaults: {
      herd: parseNum(htmlSelectDefault(html, 'scarab-herd'), 0),
      duplicating: parseNum(htmlSelectDefault(html, 'scarab-duplicating'), 0),
      pricesChaos: {
        herd: parseNum(htmlInputValue(html, 'price-herd'), 1),
        duplicating: parseNum(htmlInputValue(html, 'price-duplicating'), 1),
      },
    },
    uiDefaults: {
      timePerMapSec: parseNum(htmlInputValue(html, 'time-per-map'), 240),
      discardBelowChaos: parseNum(htmlInputValue(html, 'discard-below'), 5),
      yellowPriceChaos: parseNum(htmlInputValue(html, 'yellow-price'), 0),
      thhMarkupPct: {
        tier10: parseNum(htmlInputValue(html, 'thh-10'), 5),
      },
    },
    beasts: [],
  }
  writeJson('beasts.json', beasts)
  report.counts['beasts.json'] = {
    beasts: 0,
    classifications: beasts.classifications.length,
  }
} catch (e) {
  report.failures.push({ file: 'beasts.json', error: String(e.message || e) })
}

// --- Essences ---
try {
  const html = readHtml('essence-calculator.html')
  const baseEssM = html.match(/const BASE_ESS_PER_MONSTER = ([\d.]+);/)
  const essences = {
    source: 'essence-calculator.html',
    pricesApi: '/api/essence-calculator/prices',
    note: 'Essence weights, groups, tiers, and prices are loaded from the prices API at runtime; not present in the HTTrack mirror.',
    baseEssencesPerMonster: baseEssM ? parseNum(baseEssM[1], 2.5) : 2.5,
    scarabDefaults: {
      ascent: parseNum(htmlSelectDefault(html, 'scarab-ascent'), 0),
      essence: parseNum(htmlSelectDefault(html, 'scarab-essence'), 0),
      calcification: parseNum(htmlSelectDefault(html, 'scarab-calcification'), 0),
      adversaries: parseNum(htmlSelectDefault(html, 'scarab-adversaries'), 0),
      stability: parseNum(htmlSelectDefault(html, 'scarab-stability'), 0),
      adaptation: parseNum(htmlSelectDefault(html, 'scarab-adaptation'), 0),
      pricesChaos: {
        ascent: parseNum(htmlInputValue(html, 'price-ascent'), 1),
        essence: parseNum(htmlInputValue(html, 'price-essence'), 1),
        calcification: parseNum(htmlInputValue(html, 'price-calcification'), 5),
        adversaries: parseNum(htmlInputValue(html, 'price-adversaries'), 1),
        stability: parseNum(htmlInputValue(html, 'price-stability'), 10),
        adaptation: parseNum(htmlInputValue(html, 'price-adaptation'), 5),
      },
    },
    uiDefaults: {
      vaalMode: htmlSelectDefault(html, 'vaal-mode') || 'all',
      vaalCostChaos: parseNum(htmlInputValue(html, 'vaal-cost'), 1),
      monstersPerMap: parseNum(htmlInputValue(html, 'monsters-per-map'), 10),
      timePerMapSec: parseNum(htmlInputValue(html, 'time-per-map'), 240),
      prolificEssence: htmlCheckboxChecked(html, 'prolific-essence'),
      amplifiedEnergies: htmlCheckboxChecked(html, 'amplified-energies'),
      crystalResonance: htmlCheckboxChecked(html, 'crystal-resonance'),
      phreciaBaseEssMonsters: parseNum(htmlInputValue(html, 'base-essence'), 0.08),
    },
    essences: [],
  }
  writeJson('essences.json', essences)
  report.counts['essences.json'] = { essences: 0 }
} catch (e) {
  report.failures.push({ file: 'essences.json', error: String(e.message || e) })
}

// --- Scrying orb ---
try {
  const scrying = {
    source: 'scrying-orb.html',
    pricesApi: '/api/scrying-orbs',
    note: 'Map area listings and prices come from the scrying-orbs API at runtime; the mirrored HTML has no hardcoded area table.',
    areas: [],
  }
  writeJson('scrying.json', scrying)
  report.counts['scrying.json'] = { areas: 0 }
} catch (e) {
  report.failures.push({ file: 'scrying.json', error: String(e.message || e) })
}

// --- Transfigured gems ---
try {
  const html = readHtml('transfigured-gems.html')
  const transfig = {
    source: 'transfigured-gems.html',
    pricesApi: '/api/transfigured-gem/ev',
    note: 'Gem variants and EV data are loaded from the transfigured-gem API at runtime; HTML only stores calculator defaults.',
    defaults: {
      fontsPerLab: parseNum(htmlInputValue(html, 'fonts-per-lab'), 2),
      timePerLabSec: parseNum(htmlInputValue(html, 'time-per-lab'), 360),
      minVolume24h: parseNum(htmlInputValue(html, 'min-vol'), 0),
    },
    gems: [],
  }
  writeJson('transfig.json', transfig)
  report.counts['transfig.json'] = { gems: 0 }
} catch (e) {
  report.failures.push({ file: 'transfig.json', error: String(e.message || e) })
}

// --- Tools catalog ---
const toolsCatalog = [
  { id: 'gem-leveling', title: 'Gem Leveling', actions: ['Leveling Advisor'], status: 'stub' },
  { id: 'gem-transfig', title: 'Gem Transfig', actions: ['Transfig EV'], status: 'ready' },
  { id: 'beasts', title: 'Beasts', actions: ['Farming EV'], status: 'ready' },
  { id: 'scarab-atlas', title: 'Scarab Atlas', actions: ['Farming EV', 'Vendor Guide'], status: 'stub' },
  { id: 'essences', title: 'Essences', actions: ['Farming EV'], status: 'ready' },
  { id: 'harvest', title: 'Harvest', actions: ['Farming EV', 'Crop Rotation'], status: 'stub' },
  { id: 'currency-trends', title: 'Currency Trends', actions: ['Price & Volume'], status: 'stub' },
  { id: 'boss-profit', title: 'Boss Profitability', actions: ['Calculator'], status: 'ready' },
  { id: 'nightmare', title: 'Nightmare Boss Rush', actions: ['Calculator'], status: 'ready' },
  { id: 'betrayal', title: 'Betrayal EV', actions: ['Calculator'], status: 'ready' },
  { id: 'scrying', title: 'Scrying Orb', actions: ['Market'], status: 'ready' },
]
writeJson('tools-catalog.json', toolsCatalog)
report.counts['tools-catalog.json'] = { tools: toolsCatalog.length }

if (!report.written.includes('boss-config.raw.js')) {
  report.written.push('boss-config.raw.js (copy)')
}

console.log(JSON.stringify(report, null, 2))
