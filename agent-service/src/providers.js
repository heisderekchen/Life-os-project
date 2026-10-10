const PROVIDERS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    modelEnv: 'DEEPSEEK_MODEL',
    keyName: 'DEEPSEEK_API_KEY',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    modelEnv: 'OPENAI_MODEL',
    keyName: 'OPENAI_API_KEY',
  },
}

export function providerConfig(name, env = process.env) {
  const config = PROVIDERS[name]
  if (!config) throw new Error('UNSUPPORTED_PROVIDER')
  const apiKey = env[config.keyName]
  if (!apiKey) throw new Error('PROVIDER_NOT_CONFIGURED')
  return { ...config, model: configuredModel(name, env), apiKey }
}

export function configuredModel(name, env = process.env) {
  const config = PROVIDERS[name]
  if (!config) throw new Error('UNSUPPORTED_PROVIDER')
  return env[config.modelEnv] || config.model
}

export async function callProvider({ provider, model, messages, maxOutputTokens }, {
  env = process.env,
  fetchImpl = fetch,
  signal,
} = {}) {
  const config = providerConfig(provider, env)
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(provider === 'openai'
      ? { model: model || config.model, messages, max_completion_tokens: maxOutputTokens, stream: false }
      : { model: model || config.model, messages, max_tokens: maxOutputTokens, stream: false }),
    signal,
  })
  if (!response.ok) {
    const error = new Error(`PROVIDER_HTTP_${response.status}`)
    error.uncertain = response.status >= 500 || response.status === 429
    throw error
  }
  const payload = await response.json()
  const choice = payload.choices?.[0]
  if (typeof choice?.message?.content !== 'string') {
    throw new Error('PROVIDER_RESPONSE_INVALID')
  }
  return {
    text: choice.message.content,
    providerRunId: payload.id ?? null,
    usage: {
      inputTokens: Number(payload.usage?.prompt_tokens ?? 0),
      outputTokens: Number(payload.usage?.completion_tokens ?? 0),
      totalTokens: Number(payload.usage?.total_tokens ?? 0),
    },
  }
}

export function estimateUsageCostUsd(provider, usage, env = process.env) {
  const rate = configuredRates(provider, env)
  return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000
}

export function estimateMaximumInputCostUsd(provider, inputTokens, env = process.env) {
  const rate = configuredRates(provider, env)
  return (inputTokens * rate.input) / 1_000_000
}

export function capOutputTokens(provider, budgetUsd, inputTokens, requestedMax, env = process.env) {
  const rate = configuredRates(provider, env)
  const inputCost = estimateMaximumInputCostUsd(provider, inputTokens, env)
  const remaining = Number(budgetUsd) - inputCost
  const available = Math.floor((remaining * 1_000_000) / rate.output)
  return Math.min(requestedMax, available)
}

export function configuredRates(provider, env = process.env) {
  const prefix = provider === 'deepseek' ? 'DEEPSEEK' : provider === 'openai' ? 'OPENAI' : null
  if (!prefix) throw new Error('UNSUPPORTED_PROVIDER')
  const input = Number(env[`${prefix}_INPUT_USD_PER_MILLION`])
  const output = Number(env[`${prefix}_OUTPUT_USD_PER_MILLION`])
  if (!Number.isFinite(input) || input <= 0 || !Number.isFinite(output) || output <= 0) {
    throw new Error('PROVIDER_PRICING_NOT_CONFIGURED')
  }
  return { input, output }
}
