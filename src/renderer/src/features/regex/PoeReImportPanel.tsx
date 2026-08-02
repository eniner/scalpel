import { useMemo, useState } from 'react'
import type { RegexPreset } from '@shared/types'
import {
  decodePoeReExport,
  extractPoeReMapSettings,
  mapPoeReToMapsPreset,
  poeReExportToMapsPreset,
} from './poe-re-import'

interface PoeReImportPanelProps {
  /** Drawer visibility, driven by the Maps chip row's one-open-at-a-time panel state. */
  open: boolean
  onImport: (preset: RegexPreset) => void
}

/** Paste drawer for poe.re Maps profile export strings, opened from the Maps chip row. */
export function PoeReImportPanel({ open, onImport }: PoeReImportPanelProps): JSX.Element {
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importedNote, setImportedNote] = useState<string | null>(null)

  const preview = useMemo(() => {
    if (!raw.trim()) return null
    try {
      const decoded = decodePoeReExport(raw)
      const { map, profileName } = extractPoeReMapSettings(decoded)
      const result = mapPoeReToMapsPreset(map, { profileName, id: 'poe-re-preview' })
      return { ok: true as const, result }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  }, [raw])

  const apply = (): void => {
    setError(null)
    setImportedNote(null)
    try {
      const result = poeReExportToMapsPreset(raw)
      onImport(result.preset)
      const bits: string[] = []
      bits.push(`${result.preset.avoid.length} avoid`)
      bits.push(`${result.preset.want.length} want`)
      const q = Object.keys(result.preset.qualifiers).length
      if (q) bits.push(`${q} qualifier${q === 1 ? '' : 's'}`)
      if (result.unknownModIds.length) bits.push(`${result.unknownModIds.length} unknown mod(s) skipped`)
      if (result.nightmareSkipped) bits.push(`${result.nightmareSkipped} nightmare mod(s) skipped`)
      if (result.unsupported.length) bits.push(`${result.unsupported.length} option(s) not applied`)
      setImportedNote(`Loaded ${result.preset.name}: ${bits.join(' · ')}`)
      setRaw('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      className="overflow-hidden transition-all duration-150"
      style={{
        maxHeight: open ? 240 : 0,
        opacity: open ? 1 : 0,
        margin: open ? '8px -12px 0' : '0',
        padding: open ? '0 12px' : '0',
        borderTop: '1px solid var(--border)',
        paddingTop: open ? 8 : 0,
      }}
    >
      <p className="text-[10px] text-text-dim m-0 mb-2 leading-relaxed">
        On poe.re → Maps → profile → Export, copy the string, paste here. Avoid/want mods and qualifiers load into
        Scalpel; trade-only toggles are skipped.
      </p>
      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          setError(null)
          setImportedNote(null)
        }}
        rows={3}
        spellCheck={false}
        placeholder="Paste poe.re export string…"
        className="w-full box-border text-[11px] font-mono bg-black/30 rounded px-2 py-1.5 text-text outline-none resize-none border border-white/10"
      />
      {preview?.ok && (
        <div className="mt-1.5 text-[10px] text-text-dim leading-relaxed">
          Preview:{' '}
          <span className="text-text">{(preview.result.profileName ?? preview.result.preset.name) || 'unnamed'}</span>
          {' · '}
          {preview.result.preset.avoid.length} avoid / {preview.result.preset.want.length} want
          {preview.result.unknownModIds.length > 0 && (
            <span className="text-[#ff9800]"> · {preview.result.unknownModIds.length} unknown id(s)</span>
          )}
          {preview.result.nightmareSkipped > 0 && (
            <span className="text-[#ff9800]"> · {preview.result.nightmareSkipped} nightmare skipped</span>
          )}
          {/* Named rather than counted: "quality match-any" changes what the regex
              matches, so it needs to be readable before the user commits to it. */}
          {preview.result.unsupported.length > 0 && (
            <div className="text-text-dim opacity-70">Not applied: {preview.result.unsupported.join(', ')}</div>
          )}
        </div>
      )}
      {preview && !preview.ok && raw.trim() && (
        <div className="mt-1.5 text-[10px] text-[#ef5350]">{preview.message}</div>
      )}
      {error && <div className="mt-1.5 text-[10px] text-[#ef5350]">{error}</div>}
      {importedNote && <div className="mt-1.5 text-[10px] text-[#81c784]">{importedNote}</div>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="primary text-[11px] disabled:opacity-40"
          disabled={!preview?.ok}
          onClick={apply}
        >
          Import into Maps
        </button>
      </div>
    </div>
  )
}
