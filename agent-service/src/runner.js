import { assertApproval } from './approval.js'
import { callProvider, capOutputTokens, estimateUsageCostUsd } from './providers.js'

const SYSTEM_PROMPT = `You are a planning assistant. Return only JSON with keys summary and drafts. drafts is an array of task objects with title, description, and priority. Do not claim any task was executed. Do not call tools or mutate external systems. The output is an editable proposal for a human.`

export function createTimeoutBoundProviderCall(providerCall, timeoutMs = 50_000) {
  return (request) => providerCall(request, { signal: AbortSignal.timeout(timeoutMs) })
}

export async function executeClaim(claim, store, {
  providerCall = callProvider,
  now = () => new Date(),
  env = process.env,
} = {}) {
  assertApproval(claim.run, claim.approval)
  const inputTokens = Math.ceil(JSON.stringify(claim.run.request).length / 4) + 80
  let cappedOutputTokens
  try {
    cappedOutputTokens = capOutputTokens(
      claim.run.provider,
      claim.run.budgetUsd,
      inputTokens,
      claim.run.maxOutputTokens,
      env,
    )
  } catch (error) {
    await store.finishClaim(claim.run.id, claim.leaseEpoch, {
      state: 'failed',
      errorCode: error.message === 'PROVIDER_PRICING_NOT_CONFIGURED' ? error.message : 'BUDGET_ESTIMATE_FAILED',
      finishedAt: now(),
    })
    return { outcome: 'failed' }
  }
  if (cappedOutputTokens < 1) {
    await store.finishClaim(claim.run.id, claim.leaseEpoch, {
      state: 'failed',
      errorCode: 'BUDGET_TOO_LOW_FOR_REQUEST',
      finishedAt: now(),
    })
    return { outcome: 'failed' }
  }
  const started = await store.markProviderStarted(claim.run.id, claim.leaseEpoch, now())
  if (!started) return { outcome: 'stale_lease' }

  let result
  try {
    result = await providerCall({
      provider: claim.run.provider,
      model: claim.run.model,
      maxOutputTokens: cappedOutputTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(claim.run.request) },
      ],
    })
  } catch (error) {
    // Once a provider request starts, network failures/timeouts cannot prove
    // that the provider did not process it. Never automatically retry it.
    const state = error.uncertain || error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'TypeError' ? 'uncertain' : 'failed'
    await store.finishClaim(claim.run.id, claim.leaseEpoch, {
      state,
      errorCode: error.message || 'PROVIDER_CALL_FAILED',
      finishedAt: now(),
    })
    return { outcome: state }
  }

  const estimatedCostUsd = estimateUsageCostUsd(claim.run.provider, result.usage, env)
  if (estimatedCostUsd > Number(claim.run.budgetUsd)) {
    await store.finishClaim(claim.run.id, claim.leaseEpoch, {
      state: 'budget_exceeded',
      providerRunId: result.providerRunId,
      usage: result.usage,
      estimatedCostUsd,
      finishedAt: now(),
    })
    return { outcome: 'budget_exceeded', providerRunId: result.providerRunId, usage: result.usage }
  }
  let proposal
  try {
    proposal = parseProposal(result.text)
  } catch {
    await store.finishClaim(claim.run.id, claim.leaseEpoch, {
      state: 'failed',
      errorCode: 'PROVIDER_PROPOSAL_INVALID',
      providerRunId: result.providerRunId,
      usage: result.usage,
      estimatedCostUsd,
      finishedAt: now(),
    })
    return { outcome: 'failed' }
  }
  await store.finishClaim(claim.run.id, claim.leaseEpoch, {
    state: 'succeeded',
    providerRunId: result.providerRunId,
    usage: result.usage,
    estimatedCostUsd,
    result: proposal,
    finishedAt: now(),
  })
  return { outcome: 'succeeded', providerRunId: result.providerRunId, usage: result.usage, estimatedCostUsd }
}

function parseProposal(text) {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.drafts)) {
      throw new Error('shape')
    }
    return parsed
  } catch {
    throw new Error('PROVIDER_PROPOSAL_INVALID')
  }
}
