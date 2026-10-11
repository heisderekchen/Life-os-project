export const APP_STATE_PREFERENCE_KEYS = [
  'setupComplete',
  'language',
  'accentColor',
  'fontSize',
  'theme',
  'dashboardWidgets',
  'uiDensity',
  'animationsEnabled',
  'themeVariant',
  'customAccentColor',
  'baseCurrency',
  'currencyConverterEnabled',
  'enabledModules',
  'sidebarCollapsed',
] as const

export type AppStatePreferenceKey = (typeof APP_STATE_PREFERENCE_KEYS)[number]
export type AppStatePreferences = Partial<Record<AppStatePreferenceKey, unknown>>

export interface CloudAppState {
  initialized: boolean
  appInitialized: boolean
  preferencesVersion: boolean
  hasLifeOsData: boolean
  setupComplete: boolean
  revision: string | null
  preferences: AppStatePreferences
}

export async function decodeCloudAppStateResponse(response: Response): Promise<CloudAppState> {
  if (!response.ok) throw new Error(`Could not load cloud preferences (${response.status})`)
  const value = await response.json() as Partial<CloudAppState>
  if (typeof value.initialized !== 'boolean'
    || typeof value.preferencesVersion !== 'boolean'
    || typeof value.setupComplete !== 'boolean'
    || (value.revision !== null && typeof value.revision !== 'string')
    || !value.preferences || typeof value.preferences !== 'object' || Array.isArray(value.preferences)) {
    throw new Error('Cloud preferences response is incomplete')
  }
  return {
    initialized: value.initialized,
    appInitialized: value.appInitialized === true,
    preferencesVersion: value.preferencesVersion,
    hasLifeOsData: value.hasLifeOsData === true,
    setupComplete: value.setupComplete,
    revision: value.revision ?? null,
    preferences: value.preferences,
  }
}

export class LatestRequestGuard {
  private generation = 0

  begin() { return ++this.generation }
  isCurrent(generation: number) { return generation === this.generation }
}

/** Read only a pre-existing, explicitly completed local setup as migration evidence. */
export function readLegacyAppPreferences(raw: string | null): AppStatePreferences | null {
  if (!raw) return null
  try {
    const state = JSON.parse(raw)?.state
    if (!state || state.setupComplete !== true) return null
    const result: AppStatePreferences = { setupComplete: true }
    for (const key of APP_STATE_PREFERENCE_KEYS) {
      if (key === 'setupComplete' || state[key] === undefined) continue
      result[key] = state[key]
    }
    return result
  } catch {
    return null
  }
}

export function shouldMigrateLegacyPreferences(
  cloud: Pick<CloudAppState, 'preferencesVersion'> | null,
  legacy: AppStatePreferences | null,
): legacy is AppStatePreferences {
  return Boolean(cloud && cloud.preferencesVersion === false && legacy?.setupComplete === true)
}

export function selectAppStatePreferences(state: Record<string, unknown>): AppStatePreferences {
  const selected: AppStatePreferences = {}
  for (const key of APP_STATE_PREFERENCE_KEYS) {
    if (state[key] !== undefined) selected[key] = state[key]
  }
  return selected
}

export function diffAppStatePreferences(
  next: Record<string, unknown>,
  previous: Record<string, unknown>,
): AppStatePreferences {
  const delta: AppStatePreferences = {}
  for (const key of APP_STATE_PREFERENCE_KEYS) {
    if (!sameValue(next[key], previous[key])) delta[key] = next[key]
  }
  return delta
}

export function resolveAppStateConflict(
  base: AppStatePreferences,
  local: AppStatePreferences,
  cloud: AppStatePreferences,
): { retry: AppStatePreferences; conflicts: AppStatePreferenceKey[] } {
  const retry: AppStatePreferences = {}
  const conflicts: AppStatePreferenceKey[] = []
  for (const [rawKey, localValue] of Object.entries(local)) {
    if (!APP_STATE_PREFERENCE_KEYS.includes(rawKey as AppStatePreferenceKey)) continue
    const key = rawKey as AppStatePreferenceKey
    const cloudValue = cloud[key]
    if (sameValue(localValue, cloudValue)) continue
    if (sameValue(base[key], cloudValue)) retry[key] = localValue
    else conflicts.push(key)
  }
  return { retry, conflicts }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return false
}

export function localizeRemoteAppPreferences(cloud: CloudAppState): AppStatePreferences {
  const preferences = { ...cloud.preferences }
  if (preferences.language === 'zh-CN') preferences.language = 'zh'
  preferences.setupComplete = cloud.setupComplete
  return preferences
}
