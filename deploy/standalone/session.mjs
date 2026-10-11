import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto'

const LEGACY_TYPE = 'legacy-entry'
const ACCOUNT_TYPE = 'account'
const ACCOUNT_TOKEN_VERSION = 2
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
const MAX_TOKEN_LENGTH = 4096
const MAX_ACCOUNT_ID_LENGTH = 64

// Token-type labels are shared with the revocation store so a persisted
// revocation can record which signed-token shape it belongs to when known.
export const LEGACY_SESSION_TYPE = LEGACY_TYPE
export const ACCOUNT_SESSION_TYPE = ACCOUNT_TYPE

function keyVersion(entryKey) { return createHash('sha256').update(entryKey).digest('hex') }
function sign(payload, secret) { return createHmac('sha256', secret).update(payload).digest('base64url') }

function verifySignedPayload(token, secret) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  try {
    const supplied = Buffer.from(token.slice(dot + 1), 'base64url')
    const expected = Buffer.from(sign(payload, secret), 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch { return null }
}

function issueSignedToken(claims, secret) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

// Signature-only inspection used by logout/revocation. It deliberately ignores
// token type, version, expiry, session_version and key-version so a caller can
// revoke exactly the presented token even when it is already stale, already
// disabled by session_version, or issued in an older pre-migration shape. A
// token whose signature does not verify returns null and must never be
// persisted.
export function inspectSessionToken(token, secret) {
  const claims = verifySignedPayload(token, secret)
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null
  return claims
}

// Stable, non-reversible identifier for a raw signed token. Only this digest is
// ever stored; the raw token is never persisted.
export function hashSessionToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

// Legacy entry-key session: kept only for account A's legacy Life OS owner
// access. It carries no platform-admin/account-management authority.
export function issueSessionToken(secret, entryKey, username, now = Date.now()) {
  const claims = {
    type: LEGACY_TYPE, sid: randomUUID(),
    role: 'personal-workbench', exp: Math.floor(now / 86400000), username: String(username).trim().toLowerCase(),
    scope: 'personal-workbench', personalWorkbenchExpiresAt: now + EIGHT_HOURS_MS,
    personalWorkbenchKeyVersion: keyVersion(entryKey),
  }
  return issueSignedToken(claims, secret)
}

export function verifySessionToken(token, secret, entryKey, now = Date.now()) {
  const auth = verifySignedPayload(token, secret)
  if (!auth || typeof auth !== 'object') return null
  // Account sessions deliberately omit the legacy claims and must never be
  // accepted as an entry-key session.
  if (auth.type !== undefined && auth.type !== LEGACY_TYPE) return null
  if (auth.role !== 'personal-workbench' || auth.scope !== 'personal-workbench'
    || typeof auth.username !== 'string' || !auth.username
    || !Number.isSafeInteger(auth.exp) || auth.exp < Math.floor(now / 86400000) - 1
    || !Number.isSafeInteger(auth.personalWorkbenchExpiresAt) || auth.personalWorkbenchExpiresAt <= now
    || auth.personalWorkbenchKeyVersion !== keyVersion(entryKey)) return null
  return auth
}

// Unified account session: carries only the immutable account id, its current
// session version and an absolute expiry. Authoritative role, enabled state and
// workspace grants are always loaded from SQLite on every protected request.
export function issueAccountSessionToken(secret, accountId, sessionVersion, now = Date.now(), ttlMs = EIGHT_HOURS_MS) {
  const claims = {
    type: ACCOUNT_TYPE,
    v: ACCOUNT_TOKEN_VERSION,
    sid: randomUUID(),
    accountId: String(accountId),
    sessionVersion: Number(sessionVersion),
    exp: Math.floor((now + ttlMs) / 1000),
  }
  return issueSignedToken(claims, secret)
}

export function verifyAccountSessionToken(token, secret, now = Date.now()) {
  const claims = verifySignedPayload(token, secret)
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null
  if (claims.type !== ACCOUNT_TYPE || claims.v !== ACCOUNT_TOKEN_VERSION) return null
  if (typeof claims.accountId !== 'string' || !claims.accountId || claims.accountId.length > MAX_ACCOUNT_ID_LENGTH) return null
  if (!Number.isSafeInteger(claims.sessionVersion) || claims.sessionVersion < 1) return null
  if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now) return null
  return { accountId: claims.accountId, sessionVersion: claims.sessionVersion }
}

export function matchesEntryKey(supplied, expectedValue) {
  if (typeof supplied !== 'string' || !supplied || supplied.length > 256) return false
  const actual = createHash('sha256').update(supplied).digest()
  const expected = createHash('sha256').update(expectedValue).digest()
  return timingSafeEqual(actual, expected)
}

export const ACCOUNT_SESSION_TTL_MS = EIGHT_HOURS_MS
