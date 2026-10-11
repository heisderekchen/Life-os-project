const OUTCOMES = new Set(['not_started', 'failed', 'uncertain', 'budget_exceeded', 'succeeded'])

export function providerSmokeFailureSummary({
  mode,
  providerOutcome,
  errorCode,
  providerCalls,
  providerHttpRequests,
}) {
  const safeMode = mode === 'synthetic-offline-fixture' ? mode : 'synthetic-real-provider'
  const safeProviderOutcome = providerOutcome === 'not_started' && safeCount(providerHttpRequests) > 0
    ? 'uncertain'
    : OUTCOMES.has(providerOutcome) ? providerOutcome : 'failed'
  const safeCode = safeErrorCode(errorCode)
  return {
    mode: safeMode,
    outcome: 'failed',
    providerOutcome: safeProviderOutcome,
    errorCode: safeCode,
    providerCalls: safeCount(providerCalls),
    providerHttpRequests: safeCount(providerHttpRequests),
    automaticRetries: 0,
    secretsPrinted: false,
  }
}

function safeErrorCode(value) {
  if (typeof value !== 'string') return 'SMOKE_FAILED'
  if (/timeout|timed out/i.test(value)) return 'PROVIDER_TIMEOUT'
  if (/abort/i.test(value)) return 'PROVIDER_ABORTED'
  if (/network|fetch failed|socket|ECONN|ENOTFOUND/i.test(value)) return 'PROVIDER_NETWORK_ERROR'
  if (/^PROVIDER_HTTP_(429|5\d\d)$/.test(value)) return value
  if (/^[A-Z0-9_:-]{1,64}$/.test(value)) return value
  return 'SMOKE_FAILED'
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}
