import { createHash } from 'node:crypto'

export function approvalSnapshot(run) {
  return {
    id: run.id,
    ownerId: run.ownerId,
    version: run.version,
    request: run.request,
    provider: run.provider,
    model: run.model,
    budgetUsd: run.budgetUsd,
    maxOutputTokens: run.maxOutputTokens,
    dataScope: run.dataScope,
  }
}

export function approvalFingerprint(run) {
  return createHash('sha256')
    .update(JSON.stringify(approvalSnapshot(run)))
    .digest('hex')
}

export function assertApproval(run, approval) {
  if (!approval || approval.version !== run.version) {
    throw new Error('APPROVAL_VERSION_MISMATCH')
  }
  if (approval.fingerprint !== approvalFingerprint(run)) {
    throw new Error('APPROVAL_SNAPSHOT_MISMATCH')
  }
  if (run.provider === 'openai' && approval.confirmedOpenAI !== true) {
    throw new Error('OPENAI_CONFIRMATION_REQUIRED')
  }
}
