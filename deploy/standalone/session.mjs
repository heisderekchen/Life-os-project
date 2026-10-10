import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

function keyVersion(entryKey) { return createHash('sha256').update(entryKey).digest('hex') }
function sign(payload, secret) { return createHmac('sha256', secret).update(payload).digest('base64url') }

export function issueSessionToken(secret, entryKey, username, now = Date.now()) {
  const claims = {
    role: 'personal-workbench', exp: Math.floor(now / 86400000), username: String(username).trim().toLowerCase(),
    scope: 'personal-workbench', personalWorkbenchExpiresAt: now + 8 * 60 * 60 * 1000,
    personalWorkbenchKeyVersion: keyVersion(entryKey),
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function verifySessionToken(token, secret, entryKey, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  try {
    const supplied = Buffer.from(token.slice(dot + 1), 'base64url')
    const expected = Buffer.from(sign(payload, secret), 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
    const auth = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (auth.role !== 'personal-workbench' || auth.scope !== 'personal-workbench'
      || typeof auth.username !== 'string' || !auth.username
      || !Number.isSafeInteger(auth.exp) || auth.exp < Math.floor(now / 86400000) - 1
      || !Number.isSafeInteger(auth.personalWorkbenchExpiresAt) || auth.personalWorkbenchExpiresAt <= now
      || auth.personalWorkbenchKeyVersion !== keyVersion(entryKey)) return null
    return auth
  } catch { return null }
}

export function matchesEntryKey(supplied, expectedValue) {
  if (typeof supplied !== 'string' || !supplied || supplied.length > 256) return false
  const actual = createHash('sha256').update(supplied).digest()
  const expected = createHash('sha256').update(expectedValue).digest()
  return timingSafeEqual(actual, expected)
}
