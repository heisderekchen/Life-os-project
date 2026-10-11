import { describe, expect, it } from 'vitest'
import {
  decodeCloudAppStateResponse,
  diffAppStatePreferences,
  LatestRequestGuard,
  localizeRemoteAppPreferences,
  readLegacyAppPreferences,
  resolveAppStateConflict,
  shouldMigrateLegacyPreferences,
} from '@/lib/app-state-sync'

describe('cross-device app-state bootstrap', () => {
  it('only treats an explicitly completed persisted local setup as legacy migration evidence', () => {
    const completed = readLegacyAppPreferences(JSON.stringify({ state: {
      setupComplete: true,
      language: 'zh',
      enabledModules: ['dashboard', 'tasks'],
    } }))
    expect(completed).toMatchObject({ setupComplete: true, language: 'zh', enabledModules: ['dashboard', 'tasks'] })
    expect(shouldMigrateLegacyPreferences({ preferencesVersion: false }, completed)).toBe(true)
    expect(shouldMigrateLegacyPreferences({ preferencesVersion: true }, completed)).toBe(false)
    expect(readLegacyAppPreferences(JSON.stringify({ state: { setupComplete: false } }))).toBeNull()
    expect(readLegacyAppPreferences(null)).toBeNull()
    expect(readLegacyAppPreferences('{broken')).toBeNull()
  })

  it('hydrates only values returned by cloud and normalizes the stored Simplified Chinese locale', () => {
    const preferences = localizeRemoteAppPreferences({
      initialized: true,
      appInitialized: true,
      preferencesVersion: true,
      hasLifeOsData: true,
      setupComplete: true,
      revision: 'rev-2',
      preferences: { language: 'zh-CN', theme: 'dark', enabledModules: ['dashboard', 'tasks'] },
    })
    expect(preferences).toEqual({ language: 'zh', theme: 'dark', enabledModules: ['dashboard', 'tasks'], setupComplete: true })
    expect(preferences).not.toHaveProperty('accentColor')
  })

  it('treats HTTP and malformed state failures as errors rather than a new account', async () => {
    await expect(decodeCloudAppStateResponse(new Response('{"error":"Not found"}', { status: 404 }))).rejects.toThrow('404')
    await expect(decodeCloudAppStateResponse(new Response('{"error":"Not found"}', { status: 200 }))).rejects.toThrow('incomplete')
    const empty = await decodeCloudAppStateResponse(new Response(JSON.stringify({
      initialized: false, appInitialized: false, preferencesVersion: false,
      hasLifeOsData: false, setupComplete: false, revision: null, preferences: {},
    }), { status: 200 }))
    expect(empty.initialized).toBe(false)
  })

  it('diffs only changed synchronized preferences for field-level multi-device saves', () => {
    expect(diffAppStatePreferences(
      { setupComplete: true, language: 'zh', enabledModules: ['dashboard', 'tasks'] },
      { setupComplete: true, language: 'en', enabledModules: ['dashboard', 'tasks'] },
    )).toEqual({ language: 'zh' })
  })

  it('keeps cloud values for same-field conflicts and retries only disjoint local changes', () => {
    expect(resolveAppStateConflict(
      { language: 'en', theme: 'light', accentColor: 'emerald' },
      { language: 'zh', theme: 'dark', accentColor: 'rose' },
      { language: 'fr', theme: 'light', accentColor: 'violet' },
    )).toEqual({
      retry: { theme: 'dark' },
      conflicts: ['language', 'accentColor'],
    })
  })

  it('ignores stale startup responses after a newer retry begins', () => {
    const guard = new LatestRequestGuard()
    const first = guard.begin()
    const retry = guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(retry)).toBe(true)
  })
})
