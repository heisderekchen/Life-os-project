import { createHash, createHmac, randomBytes } from 'node:crypto'

export function createWorkspaceSubjectHeaders({
  ownerId,
  method,
  requestTarget,
  body = Buffer.alloc(0),
  idempotencyKey = '',
  serviceToken,
  signingSecret,
  timestamp = String(Date.now()),
  nonce = randomBytes(16).toString('hex'),
}) {
  const subject = String(ownerId || '')
  if (!subject || subject.length > 160 || /[\r\n]/.test(subject)) throw new Error('INVALID_AGENT_OWNER')
  if (!serviceToken || !signingSecret) throw new Error('AGENT_BRIDGE_NOT_CONFIGURED')
  const bodyDigest = createHash('sha256').update(body).digest('hex')
  const canonical = JSON.stringify([
    timestamp, nonce, subject, method.toUpperCase(), requestTarget, idempotencyKey, bodyDigest,
  ])
  const signature = createHmac('sha256', signingSecret).update(canonical).digest('hex')
  return {
    authorization: 'Bearer ' + serviceToken,
    'x-workspace-subject': subject,
    'x-workspace-subject-timestamp': timestamp,
    'x-workspace-subject-nonce': nonce,
    'x-workspace-subject-signature': signature,
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  }
}

export function mapAgentTarget(pathname, search = '', basePath = '/workbench') {
  const prefix = basePath + '/api/agent'
  if (pathname === prefix + '/health') return '/v1/health' + search
  if (!pathname.startsWith(prefix + '/runs')) return null
  const suffix = pathname.slice(prefix.length)
  if (!/^\/runs(?:\/[0-9a-f-]+(?:\/(?:approve|cancel|events))?)?$/i.test(suffix)) return null
  return '/v1' + suffix + search
}
