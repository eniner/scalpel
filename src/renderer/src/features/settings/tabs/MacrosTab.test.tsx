// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MacrosTab } from './MacrosTab'
import type { RuntimeSettings } from '@shared/types'

function installApi(): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    getRegexPresets: vi.fn(async () => []),
    onRegexPresetsChanged: vi.fn(() => () => {}),
    pluginListRegisteredHotkeys: vi.fn(async () => []),
    onPluginHotkeysChanged: vi.fn(() => () => {}),
    pluginListRegisteredTabs: vi.fn(async () => []),
    listInstalledPlugins: vi.fn(async () => []),
    suspendHotkeys: vi.fn(),
    resumeHotkeys: vi.fn(),
  }
}

const baseSettings = {
  hotkey: 'F5',
  priceCheckHotkey: 'F6',
  launcherHotkey: 'Grave',
  launcherSliceMode: 'names',
  launcherStyle: 'classic',
  radialMenu: { slices: [] },
  chatCommands: [],
  appMacros: [],
} as unknown as RuntimeSettings

describe('MacrosTab built-in hotkeys', () => {
  beforeEach(() => installApi())

  it('renders the filter, price-check, and launcher rows in the Scalpel Hotkeys section', () => {
    const { getByText } = render(<MacrosTab settings={baseSettings} update={vi.fn()} tryHotkey={() => true} />)
    expect(getByText('Filter hotkey')).toBeTruthy()
    expect(getByText('Price check hotkey')).toBeTruthy()
    expect(getByText('Tool launcher hotkey')).toBeTruthy()
    expect(getByText('Tool launcher style')).toBeTruthy()
    expect(getByText('Tool launcher labels')).toBeTruthy()
  })

  it('changing launcher style writes launcherStyle', () => {
    const update = vi.fn()
    const { container } = render(<MacrosTab settings={baseSettings} update={update} tryHotkey={() => true} />)
    const select = container.querySelector('#setting-select-tool-launcher-style') as HTMLSelectElement
    expect(select).toBeTruthy()
    fireEvent.change(select, { target: { value: 'reticle' } })
    expect(update).toHaveBeenCalledWith('launcherStyle', 'reticle')
    fireEvent.change(select, { target: { value: 'minimal' } })
    expect(update).toHaveBeenCalledWith('launcherStyle', 'minimal')
  })

  it('changing launcher slice mode writes launcherSliceMode', () => {
    const update = vi.fn()
    const { container } = render(<MacrosTab settings={baseSettings} update={update} tryHotkey={() => true} />)
    const select = container.querySelector('#setting-select-tool-launcher-labels') as HTMLSelectElement
    expect(select).toBeTruthy()
    fireEvent.change(select, { target: { value: 'icons' } })
    expect(update).toHaveBeenCalledWith('launcherSliceMode', 'icons')
  })

  it('clearing the built-in rows writes the matching settings keys', () => {
    const update = vi.fn()
    const { container } = render(<MacrosTab settings={baseSettings} update={update} tryHotkey={() => true} />)
    const clears = container.querySelectorAll('button[title="Clear hotkey"]')
    expect(clears.length).toBe(3)
    fireEvent.click(clears[0])
    expect(update).toHaveBeenCalledWith('hotkey', '')
    fireEvent.click(clears[1])
    expect(update).toHaveBeenCalledWith('priceCheckHotkey', '')
    fireEvent.click(clears[2])
    expect(update).toHaveBeenCalledWith('launcherHotkey', '')
  })

  it('recomputes explicit scope when a command or action changes', () => {
    const update = vi.fn()
    const settings = {
      ...baseSettings,
      chatCommands: [{ hotkey: 'F7', command: '/menagerie', autoSubmit: true, scope: 'poe1' }],
      appMacros: [{ hotkey: 'F8', action: 'openDust', scope: 'poe1' }],
    } as RuntimeSettings
    const { container, getByDisplayValue } = render(
      <MacrosTab settings={settings} update={update} tryHotkey={() => true} />,
    )

    fireEvent.change(getByDisplayValue('/menagerie'), { target: { value: '/hideout' } })
    expect(update).toHaveBeenCalledWith('chatCommands', [
      { hotkey: 'F7', command: '/hideout', autoSubmit: true, scope: undefined },
    ])

    const actionSelect = [...container.querySelectorAll('select')].find((select) => select.value === 'openDust')
    expect(actionSelect).toBeTruthy()
    fireEvent.change(actionSelect as HTMLSelectElement, { target: { value: 'openRegex' } })
    expect(update).toHaveBeenCalledWith('appMacros', [
      { hotkey: 'F8', action: 'openRegex', presetId: undefined, tag: undefined, scope: undefined },
    ])
  })
})
