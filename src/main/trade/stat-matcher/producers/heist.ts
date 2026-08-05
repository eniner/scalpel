import { getPoeVersion } from '@main/game-state'
import type { StatFilter } from '../../trade'

type HeistItemInfo = {
  heistJob?: { skill: string; level: number }
  heistTarget?: string
  monsterLevel?: number
  wingsRevealed?: number
  wingsTotal?: number
  itemClass?: string
  baseType?: string
  enchants?: string[]
  implicits?: string[]
}

const ENCHANTED_ARMAMENTS = /Enchanted Armaments/i
const HEIST_TARGETS_ALWAYS = /Heist Targets are always Enchanted Armaments/i

/** True when a Blueprint looks enchanted (has enchant mods or Enchanted Armaments target). */
export function isEnchantedBlueprint(itemInfo: HeistItemInfo | undefined): boolean {
  if (!itemInfo || itemInfo.itemClass !== 'Blueprints') return false
  if ((itemInfo.enchants?.length ?? 0) > 0) return true
  if (itemInfo.heistTarget && ENCHANTED_ARMAMENTS.test(itemInfo.heistTarget)) return true
  const lines = [...(itemInfo.implicits ?? []), ...(itemInfo.enchants ?? [])]
  return lines.some((l) => HEIST_TARGETS_ALWAYS.test(l))
}

// Heist job skill requirement (contracts only; blueprints have multiple jobs that don't filter search)
// Area level chip (for heist contracts/blueprints)
// Heist blueprint wings revealed
// Exclude Enchanted chip (blueprints only)
export function buildHeistFilters(itemInfo: HeistItemInfo | undefined): StatFilter[] {
  const out: StatFilter[] = []

  if (itemInfo?.heistJob && itemInfo.itemClass === 'Contracts') {
    const skillKey = itemInfo.heistJob.skill.toLowerCase().replace(/\s+/g, '_')
    out.push({
      id: `heist.heist_${skillKey}`,
      text: `Requires ${itemInfo.heistJob.skill} (Level ${itemInfo.heistJob.level})`,
      value: itemInfo.heistJob.level,
      min: 1,
      max: null,
      enabled: true,
      type: 'heist',
    })
  }

  // Area level chip (for heist contracts/blueprints)
  if (itemInfo?.monsterLevel && itemInfo.itemClass !== 'Maps' && itemInfo.itemClass !== 'Sanctum Research') {
    // Both PoE2 trial keys (Djinn Barya and Inscribed Ultimatum) render as an
    // editable row with both ends pinned - within an ascendancy bracket a LOWER
    // area level is worth more, so an open-ended min lumps the item in with
    // cheaper higher-level listings (#433). PoE1 ultimatums scale the other way
    // and keep the min-only misc chip. All other items use min-only chip.
    const isPoe2TrialKey =
      getPoeVersion() === 2 && (itemInfo.baseType === 'Djinn Barya' || itemInfo.baseType === 'Inscribed Ultimatum')
    out.push({
      id: 'misc.area_level',
      text: `Area Level: ${itemInfo.monsterLevel}`,
      value: itemInfo.monsterLevel,
      min: itemInfo.monsterLevel,
      max: isPoe2TrialKey ? itemInfo.monsterLevel : null,
      enabled: true,
      type: isPoe2TrialKey ? 'pseudo' : 'misc',
    })
  }

  // Heist blueprint wings revealed
  if (itemInfo?.wingsRevealed != null) {
    out.push({
      id: 'heist.heist_wings',
      text: `Wings Revealed: ${itemInfo.wingsRevealed}`,
      value: itemInfo.wingsRevealed,
      min: itemInfo.wingsRevealed,
      max: null,
      enabled: true,
      type: 'heist',
    })
    if (itemInfo.wingsTotal) {
      out.push({
        id: 'heist.heist_max_wings',
        text: `Total Wings: ${itemInfo.wingsTotal}`,
        value: itemInfo.wingsTotal,
        min: itemInfo.wingsTotal,
        max: null,
        enabled: true,
        type: 'heist',
      })
    }
  }

  // Unenchanted blueprints: exclude listings that have enchant modifiers (e.g.
  // Enchanted Armaments). Emitted as a misc chip (above the filter rows) so it
  // toggles like Unidentified / influence — not a heist numeric row.
  // Defaults off when the clipboard BP itself is enchanted.
  if (itemInfo?.itemClass === 'Blueprints') {
    const enchanted = isEnchantedBlueprint(itemInfo)
    out.push({
      id: 'misc.exclude_enchanted',
      text: 'Exclude Enchanted',
      value: null,
      min: null,
      max: null,
      enabled: !enchanted,
      type: 'misc',
    })
  }

  return out
}
