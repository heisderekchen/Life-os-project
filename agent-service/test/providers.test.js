import test from 'node:test'
import assert from 'node:assert/strict'
import { callProvider, configuredModel, configuredRates } from '../src/providers.js'

test('DeepSeek adapter uses server-side key and records provider run ID and usage (stubbed HTTP)', async () => {
  let observed
  const response = await callProvider({
    provider: 'deepseek', model: 'deepseek-flash', maxOutputTokens: 50,
    messages: [{ role: 'user', content: 'Write a draft' }],
  }, {
    env: { DEEPSEEK_API_KEY: 'test-secret' },
    fetchImpl: async (url, options) => {
      observed = { url, options }
      return new Response(JSON.stringify({
        id: 'stub-run-id', choices: [{ message: { content: '{"summary":"ok","drafts":[]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200 })
    },
  })
  assert.equal(observed.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(observed.options.headers.authorization, 'Bearer test-secret')
  assert.equal(JSON.parse(observed.options.body).max_tokens, 50)
  assert.equal(response.providerRunId, 'stub-run-id')
  assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  assert.equal(JSON.stringify(response).includes('test-secret'), false)
})

test('OpenAI adapter uses its explicit endpoint and completion-token cap (stubbed HTTP)', async () => {
  let observed
  await callProvider({
    provider: 'openai', maxOutputTokens: 23, messages: [{ role: 'user', content: 'Draft' }],
  }, {
    env: { OPENAI_API_KEY: 'test-openai-secret' },
    fetchImpl: async (url, options) => {
      observed = { url, body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ id: 'openai-stub', choices: [{ message: { content: '{"summary":"ok","drafts":[]}' } }] }), { status: 200 })
    },
  })
  assert.equal(observed.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(observed.body.max_completion_tokens, 23)
})

test('missing API key or current price settings cannot be mistaken for provider readiness', async () => {
  assert.throws(() => configuredRates('deepseek', {}), /PROVIDER_PRICING_NOT_CONFIGURED/)
  await assert.rejects(callProvider({ provider: 'deepseek', messages: [] }, { env: {} }), /PROVIDER_NOT_CONFIGURED/)
})

test('provider models are configurable and default to documented DeepSeek flash', () => {
  assert.equal(configuredModel('deepseek', {}), 'deepseek-flash')
  assert.equal(configuredModel('deepseek', { DEEPSEEK_MODEL: 'deepseek-v4-pro' }), 'deepseek-v4-pro')
  assert.equal(configuredModel('openai', { OPENAI_MODEL: 'gpt-custom' }), 'gpt-custom')
})
