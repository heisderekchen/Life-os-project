// Unified platform accounts, workspaces, grants, sessions and platform-admin
// operations. This module owns all authoritative authority checks for the
// unified login. Identity metadata lives in platform_* tables only; it is never
// part of the 40-collection Life OS export/import/reset contract.
import { json } from './app/response.mjs';
import { authenticatePersonalWorkbenchPassword } from './personal-workbench-auth.mjs';
import {
  ACCOUNT_SESSION_TTL_MS, ACCOUNT_SESSION_TYPE, LEGACY_SESSION_TYPE, hashSessionToken,
  inspectSessionToken, issueAccountSessionToken, verifyAccountSessionToken, verifySessionToken,
} from '../session.mjs';

const SCHEME = 'pbkdf2-sha256-v1';
const ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 14;
const MAX_PASSWORD_LENGTH = 128;
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

const LEGACY_ACCOUNT_ID = 'acct_legacy_owner';
const LEGACY_WORKSPACE_ID = 'ws_lifeos_legacy';

const LOGIN_PATH = '/api/platform/login';
const SESSION_PATH = '/api/platform/session';
const LOGOUT_PATH = '/api/platform/logout';
const WORKSPACES_PATH = '/api/platform/workspaces';
const ADMIN_ACCOUNTS_PATH = '/api/platform/admin/accounts';
const ADMIN_WORKSPACES_PATH = '/api/platform/admin/workspaces';
const ACCOUNT_PASSWORD_PATH = /^\/api\/platform\/admin\/accounts\/([A-Za-z0-9_:.-]{1,64})\/password$/;
const ACCOUNT_ENABLED_PATH = /^\/api\/platform\/admin\/accounts\/([A-Za-z0-9_:.-]{1,64})\/enabled$/;
const ACCOUNT_WORKSPACES_PATH = /^\/api\/platform\/admin\/accounts\/([A-Za-z0-9_:.-]{1,64})\/workspaces$/;
const WORKSPACE_DETAIL_PATH = /^\/api\/platform\/workspaces\/([A-Za-z0-9_:.-]{1,64})$/;

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const ID_PATTERN = /^[A-Za-z0-9_:.-]{1,64}$/;
const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

const SESSION_COOKIE_NAME = 'happyspa_personal_workbench';
const SESSION_COOKIE_MAX_AGE = ACCOUNT_SESSION_TTL_MS / 1000;

// Conservative upper bound used when a signed token's own expiry cannot be
// derived. Such rows are never pruned, so an unexpired token can never bypass
// its revocation.
const FAR_FUTURE_EXPIRY = '9999-12-31T23:59:59.999Z';

const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const encoder = new TextEncoder();
const DUMMY_SALT = new Uint8Array(SALT_BYTES);
const DUMMY_HASH = new Uint8Array(HASH_BYTES);

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value, expectedBytes) {
  if (typeof value !== 'string' || value.length !== expectedBytes * 2 || !/^[0-9a-f]+$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), byte => Number.parseInt(byte, 16));
}

function timingSafeEqualBytes(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(actual, expected);
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index];
  return mismatch === 0;
}

export async function derivePlatformPassword(password, salt, iterations = ITERATIONS) {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > ITERATIONS) {
    throw new RangeError('Unsupported password hashing iteration count.');
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt, iterations,
  }, key, HASH_BYTES * 8));
}

async function passwordMatches(password, salt, expected) {
  const actual = await derivePlatformPassword(password, salt);
  return timingSafeEqualBytes(actual, expected);
}

async function dummyPasswordVerify(password) {
  await passwordMatches(typeof password === 'string' ? password : '', DUMMY_SALT, DUMMY_HASH);
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

async function recordAudit(env, entry) {
  try {
    await env.DB.prepare(`INSERT INTO platform_auth_audit
        (created_at, actor_account_id, actor_type, action, target_account_id, workspace_id, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(new Date().toISOString(), entry.actorAccountId || null, entry.actorType || 'system', entry.action,
        entry.targetAccountId || null, entry.workspaceId || null,
        entry.detail === undefined ? null : JSON.stringify(entry.detail)).run();
  } catch {
    // Append-only auditing must never break the request path.
  }
}

async function loadAccount(env, accountId) {
  try {
    return await env.DB.prepare('SELECT * FROM platform_accounts WHERE account_id = ?').bind(accountId).first();
  } catch {
    return null;
  }
}

async function loadAccountByUsername(env, username) {
  try {
    return await env.DB.prepare('SELECT * FROM platform_accounts WHERE username = ? COLLATE NOCASE').bind(username).first();
  } catch {
    return null;
  }
}

async function loadWorkspace(env, workspaceId) {
  try {
    return await env.DB.prepare('SELECT * FROM platform_workspaces WHERE workspace_id = ?').bind(workspaceId).first();
  } catch {
    return null;
  }
}

async function loadWorkspaceBySlug(env, slug) {
  try {
    return await env.DB.prepare('SELECT * FROM platform_workspaces WHERE slug = ? COLLATE NOCASE').bind(slug).first();
  } catch {
    return null;
  }
}

async function hasGrant(env, accountId, workspaceId) {
  try {
    const row = await env.DB.prepare(`SELECT 1 AS ok FROM platform_account_workspaces
        WHERE account_id = ? AND workspace_id = ?`).bind(accountId, workspaceId).first();
    return Boolean(row);
  } catch {
    return false;
  }
}

async function recordAccountFailure(env, accountId, now) {
  const windowCutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
  const lockUntil = new Date(now.getTime() + LOCKOUT_MS).toISOString();
  try {
    await env.DB.prepare(`UPDATE platform_accounts
        SET failed_attempts = CASE
                WHEN attempt_window_started_at IS NULL OR attempt_window_started_at <= ? THEN 1
                ELSE MIN(?, failed_attempts + 1) END,
            attempt_window_started_at = CASE
                WHEN attempt_window_started_at IS NULL OR attempt_window_started_at <= ? THEN ?
                ELSE attempt_window_started_at END,
            locked_until = CASE
                WHEN (CASE WHEN attempt_window_started_at IS NULL OR attempt_window_started_at <= ? THEN 1
                    ELSE MIN(?, failed_attempts + 1) END) >= ? THEN ? ELSE NULL END
        WHERE account_id = ?`)
      .bind(windowCutoff, MAX_FAILED_ATTEMPTS, windowCutoff, now.toISOString(),
        windowCutoff, MAX_FAILED_ATTEMPTS, MAX_FAILED_ATTEMPTS, lockUntil, accountId).run();
  } catch {
    // Rate-limit bookkeeping only; the login still fails closed.
  }
}

async function clearAccountFailures(env, accountId) {
  try {
    await env.DB.prepare(`UPDATE platform_accounts
        SET failed_attempts = 0, attempt_window_started_at = NULL, locked_until = NULL
        WHERE account_id = ?`).bind(accountId).run();
  } catch {
    // Ignored: a successful credential check already succeeded.
  }
}

function hasPlatformCredential(row) {
  return Boolean(row
    && row.password_scheme === SCHEME
    && Number(row.password_iterations) === ITERATIONS
    && fromHex(row.password_salt, SALT_BYTES)
    && fromHex(row.password_hash, HASH_BYTES));
}

export function principalFromAccount(row, type) {
  return {
    type,
    accountId: row.account_id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    legacyOwner: Number(row.legacy_owner) === 1,
    sessionVersion: Number(row.session_version),
  };
}

export function isPlatformAdmin(principal) {
  return principal?.type === 'account' && principal?.role === 'platform_admin';
}

export function isLegacyOwner(principal) {
  return principal?.legacyOwner === true;
}

export function serializeAccount(row, granted = []) {
  return {
    accountId: row.account_id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    legacyOwner: Number(row.legacy_owner) === 1,
    enabled: Number(row.enabled) === 1,
    sessionVersion: Number(row.session_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workspaces: granted,
  };
}

export function serializeWorkspace(row) {
  return {
    workspaceId: row.workspace_id,
    slug: row.slug,
    displayName: row.display_name,
    kind: row.kind,
    configured: Number(row.configured) === 1,
    applicationTarget: row.application_target || null,
    landingPath: `/workspace/${row.slug}`,
  };
}

function serializePrincipal(principal) {
  return {
    accountId: principal.accountId,
    username: principal.username,
    displayName: principal.displayName,
    role: principal.role,
    legacyOwner: principal.legacyOwner === true,
    sessionType: principal.type,
  };
}

// Deterministic bootstrap: binds the configured legacy owner handle to the
// immutable legacy account id and grants it the legacy Life OS workspace. This
// never creates a password and never creates account B.
export async function ensurePlatformBootstrap(env) {
  const now = new Date().toISOString();
  const handle = text(env?.PERSONAL_WORKBENCH_OWNER, 64).toLowerCase();
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO platform_workspaces
        (workspace_id, slug, display_name, kind, configured, application_target, created_at, updated_at)
        VALUES (?, 'lifeos', 'Life OS', 'lifeos', 1, '/workbench/', ?, ?)`)
      .bind(LEGACY_WORKSPACE_ID, now, now).run();
  } catch {
    return;
  }
  if (!handle) return;
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO platform_accounts
        (account_id, username, display_name, role, legacy_owner, enabled, session_version,
         failed_attempts, created_at, updated_at)
        VALUES (?, ?, 'Life OS Owner', 'platform_admin', 1, 1, 1, 0, ?, ?)`)
      .bind(LEGACY_ACCOUNT_ID, handle, now, now).run();
    await env.DB.prepare(`INSERT OR IGNORE INTO platform_account_workspaces
        (account_id, workspace_id, granted_at, granted_by)
        VALUES (?, ?, ?, 'system:bootstrap')`)
      .bind(LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID, now).run();
  } catch {
    // Schema not ready: every protected request fails closed to anonymous.
  }
}

export function parseConfiguredWorkspaces(raw) {
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const workspaceId = text(entry.id ?? entry.workspaceId, 64);
    const slug = text(entry.slug, 64).toLowerCase();
    const displayName = text(entry.displayName ?? entry.display_name ?? slug, 80);
    if (!workspaceId || !ID_PATTERN.test(workspaceId) || workspaceId === LEGACY_WORKSPACE_ID) continue;
    if (!slug || !SLUG_PATTERN.test(slug)) continue;
    const configured = entry.configured === true;
    const target = configured ? text(entry.applicationTarget ?? entry.target, 200) : '';
    // A configured workspace must point at an explicit local implementation
    // target; otherwise it stays in the safe not-configured state.
    if (configured && (!target || !target.startsWith('/') || target.startsWith('//'))) continue;
    out.push({ workspaceId, slug, displayName: displayName || slug, configured, applicationTarget: target || null });
  }
  return out;
}

// Configurable workspace metadata: operators may declare additional internal
// workspaces, but the default state is unconfigured (no invented application).
export async function syncConfiguredWorkspaces(env) {
  const now = new Date().toISOString();
  for (const workspace of parseConfiguredWorkspaces(env?.PLATFORM_WORKSPACES_JSON)) {
    try {
      await env.DB.prepare(`INSERT INTO platform_workspaces
          (workspace_id, slug, display_name, kind, configured, application_target, created_at, updated_at)
          VALUES (?, ?, ?, 'internal', ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            slug = excluded.slug, display_name = excluded.display_name,
            configured = excluded.configured, application_target = excluded.application_target,
            updated_at = excluded.updated_at`)
        .bind(workspace.workspaceId, workspace.slug, workspace.displayName,
          workspace.configured ? 1 : 0, workspace.applicationTarget, now, now).run();
    } catch {
      // Individual misconfiguration must not stop startup.
    }
  }
}

// Reads the presented session cookie value from an incoming request without
// re-deriving authority from it. Used by logout so the exact token can be
// revoked even when the session is already disabled/revoked by session_version
// (in which case no principal resolves).
function presentedSessionToken(request) {
  const header = request?.headers?.get?.('cookie') || '';
  const match = String(header).match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  return match?.[1] || '';
}

// Maps verified signed claims to the revocation metadata we are allowed to
// store. Only type/account/expiry are derived; the raw token never leaves this
// module and is reduced to a digest by the caller.
function describeTokenRevocation(claims) {
  if (claims.type === ACCOUNT_SESSION_TYPE) {
    return {
      tokenType: 'account',
      accountId: typeof claims.accountId === 'string' && claims.accountId ? claims.accountId.slice(0, 64) : null,
      expiresAt: Number.isSafeInteger(claims.exp) ? new Date(claims.exp * 1000).toISOString() : FAR_FUTURE_EXPIRY,
    };
  }
  // Legacy entry-key tokens (current shape and the pre-migration shape that has
  // no `type` claim) both carry the legacy personal-workbench claims.
  if (claims.type === LEGACY_SESSION_TYPE || claims.type === undefined) {
    return {
      tokenType: 'legacy-entry',
      accountId: typeof claims.username === 'string' && claims.username ? LEGACY_ACCOUNT_ID : null,
      expiresAt: Number.isSafeInteger(claims.personalWorkbenchExpiresAt)
        ? new Date(claims.personalWorkbenchExpiresAt).toISOString()
        : FAR_FUTURE_EXPIRY,
    };
  }
  return { tokenType: null, accountId: null, expiresAt: FAR_FUTURE_EXPIRY };
}

// True when the exact presented token has been durably revoked. A DB/schema
// error while checking fails closed (treat as revoked) rather than open.
export async function isSessionTokenRevoked(env, token) {
  if (!token) return false;
  try {
    const row = await env.DB.prepare('SELECT 1 AS revoked FROM platform_token_revocations WHERE token_hash = ?')
      .bind(hashSessionToken(token)).first();
    return Boolean(row);
  } catch {
    return true;
  }
}

// Durable per-token revocation. The signature is validated first, so malformed
// or forged tokens never create rows and never block the caller. Returns
// `{ revoked, failed }`: `failed` means the caller must fail closed and must
// not report a successful logout.
export async function revokeSessionToken(env, token) {
  if (!token || !env?.AUTH_SECRET) return { revoked: false, failed: false };
  let claims;
  try { claims = inspectSessionToken(token, env.AUTH_SECRET); } catch { claims = null; }
  if (!claims) return { revoked: false, failed: false };
  const { tokenType, accountId, expiresAt } = describeTokenRevocation(claims);
  try {
    await env.DB.prepare(`INSERT INTO platform_token_revocations
        (token_hash, token_type, account_id, revoked_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(token_hash) DO NOTHING`)
      .bind(hashSessionToken(token), tokenType, accountId, new Date().toISOString(), expiresAt).run();
  } catch {
    return { revoked: false, failed: true };
  }
  await pruneExpiredTokenRevocations(env);
  return { revoked: true, failed: false };
}

// Removes only rows whose token is already past its own expiry. Because
// `expires_at` is never earlier than the token's real expiry, this can never
// drop the revocation of a still-valid token.
export async function pruneExpiredTokenRevocations(env) {
  try {
    await env.DB.prepare('DELETE FROM platform_token_revocations WHERE expires_at <= ?')
      .bind(new Date().toISOString()).run();
  } catch {
    // Pruning is best-effort; a failure only delays cleanup.
  }
}

export async function resolvePrincipal(env, token) {
  if (!token || !env?.AUTH_SECRET) return null;
  // Reject a durably revoked token before any other path. This covers both the
  // account and legacy token shapes, including pre-migration legacy tokens.
  if (await isSessionTokenRevoked(env, token)) return null;
  const claim = verifyAccountSessionToken(token, env.AUTH_SECRET);
  if (claim) {
    const row = await loadAccount(env, claim.accountId);
    if (!row || Number(row.enabled) !== 1) return null;
    if (Number(row.session_version) !== claim.sessionVersion) return null;
    return principalFromAccount(row, 'account');
  }
  const legacy = verifySessionToken(token, env.AUTH_SECRET, env.PERSONAL_WORKBENCH_ENTRY_KEY);
  if (legacy) {
    // Legacy entry-key authority is only ever A's legacy Life OS access, and it
    // is invalidated the moment A's account is missing or disabled.
    const row = await loadAccount(env, LEGACY_ACCOUNT_ID);
    if (!row || Number(row.legacy_owner) !== 1 || Number(row.enabled) !== 1) return null;
    if (text(row.username, 64).toLowerCase() !== text(legacy.username, 64).toLowerCase()) return null;
    return { ...principalFromAccount(row, 'legacy-entry'), role: 'legacy-owner' };
  }
  return null;
}

export async function authenticatePlatformAccount(env, request, username, password) {
  const handle = text(username, 64).toLowerCase();
  const account = handle ? await loadAccountByUsername(env, handle) : null;
  const now = new Date();
  if (!account || Number(account.enabled) !== 1) {
    await dummyPasswordVerify(password);
    await recordAudit(env, {
      actorAccountId: account?.account_id || null, actorType: 'anonymous', action: 'login.failed',
      detail: { username: handle, reason: account ? 'disabled' : 'unknown' },
    });
    return { status: 401, error: '用户名或密码不正确。' };
  }
  if (account.locked_until && String(account.locked_until) > now.toISOString()) {
    return { status: 429, error: '登录尝试过多，请稍后再试。' };
  }
  if (Number(account.legacy_owner) === 1) {
    const result = await authenticatePersonalWorkbenchPassword(request, env);
    if (!result?.username || text(result.username, 64).toLowerCase() !== text(account.username, 64).toLowerCase()) {
      await recordAudit(env, {
        actorAccountId: account.account_id, actorType: 'account', action: 'login.failed',
        detail: { username: handle, reason: 'credential' },
      });
      return { status: 401, error: '用户名或密码不正确。' };
    }
    await recordAudit(env, { actorAccountId: account.account_id, actorType: 'account', action: 'login.succeeded' });
    return { account };
  }
  const ready = hasPlatformCredential(account);
  const salt = ready ? fromHex(account.password_salt, SALT_BYTES) : DUMMY_SALT;
  const expected = ready ? fromHex(account.password_hash, HASH_BYTES) : DUMMY_HASH;
  const supplied = typeof password === 'string' ? password : '';
  const matches = await passwordMatches(supplied, salt, expected);
  if (!ready || !matches || !supplied || supplied.length > MAX_PASSWORD_LENGTH) {
    await recordAccountFailure(env, account.account_id, now);
    await recordAudit(env, {
      actorAccountId: account.account_id, actorType: 'account', action: 'login.failed',
      detail: { username: handle, reason: 'credential' },
    });
    return { status: 401, error: '用户名或密码不正确。' };
  }
  await clearAccountFailures(env, account.account_id);
  await recordAudit(env, { actorAccountId: account.account_id, actorType: 'account', action: 'login.succeeded' });
  return { account };
}

export async function listGrantedWorkspaces(env, accountId) {
  try {
    const result = await env.DB.prepare(`SELECT w.* FROM platform_workspaces w
        JOIN platform_account_workspaces g ON g.workspace_id = w.workspace_id
        WHERE g.account_id = ? ORDER BY w.display_name`).bind(accountId).all();
    return (result.results || []).map(serializeWorkspace);
  } catch {
    return [];
  }
}

export async function listPlatformWorkspaces(env) {
  const result = await env.DB.prepare('SELECT * FROM platform_workspaces ORDER BY display_name').all();
  return (result.results || []).map(serializeWorkspace);
}

export async function listPlatformAccounts(env) {
  const accounts = await env.DB.prepare('SELECT * FROM platform_accounts ORDER BY created_at, account_id').all();
  const grants = await env.DB.prepare('SELECT account_id, workspace_id FROM platform_account_workspaces').all();
  const byAccount = new Map();
  for (const row of grants.results || []) {
    const list = byAccount.get(row.account_id) || [];
    list.push(row.workspace_id);
    byAccount.set(row.account_id, list);
  }
  return (accounts.results || []).map(row => serializeAccount(row, byAccount.get(row.account_id) || []));
}

export async function workspacePageState(env, principal, slug) {
  const workspace = await loadWorkspaceBySlug(env, slug);
  if (!workspace) return { status: 'not_found' };
  const granted = principal ? await hasGrant(env, principal.accountId, workspace.workspace_id) : false;
  if (!granted) return { status: 'not_found' };
  const serialized = serializeWorkspace(workspace);
  if (!serialized.configured) return { status: 'not_configured', workspace: serialized };
  return { status: 'configured', workspace: serialized };
}

export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value || value.length > 256) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\r\n]/.test(value)) return null;
  // Refuse traversal / encoded / query redirection targets outright.
  if (value.includes('..') || value.includes('%') || value.includes('?') || value.includes('#')) return null;
  if (value === '/workbench' || value.startsWith('/workbench/')) return value;
  if (value === '/workspaces' || value.startsWith('/workspaces/')) return value;
  if (value.startsWith('/workspace/')) return value;
  return null;
}

function adminGuard(principal) {
  if (!principal) return json({ error: 'Not signed in' }, 401, noStore);
  if (!isPlatformAdmin(principal)) return json({ error: 'Forbidden' }, 403, noStore);
  return null;
}

async function workspaceLandingResponse(env, principal, workspaceId) {
  const workspace = await loadWorkspace(env, workspaceId);
  if (!workspace) return json({ error: 'Not found' }, 404, noStore);
  const granted = await hasGrant(env, principal.accountId, workspace.workspace_id);
  if (!granted) return json({ error: 'Not found' }, 404, noStore);
  const serialized = serializeWorkspace(workspace);
  if (!serialized.configured) {
    return json({
      workspaceId: serialized.workspaceId, slug: serialized.slug, displayName: serialized.displayName,
      configured: false, status: 'not_configured',
      message: '该工作区尚未配置应用入口，请联系平台管理员。',
    }, 200, noStore);
  }
  return json({
    workspaceId: serialized.workspaceId, slug: serialized.slug, displayName: serialized.displayName,
    configured: true, status: 'configured', applicationTarget: serialized.applicationTarget,
  }, 200, noStore);
}

async function createAccountResponse(env, actor, request) {
  const body = await readJsonBody(request.clone());
  if (body.role !== undefined || body.admin !== undefined || body.legacyOwner !== undefined
    || body.platformAdmin !== undefined) {
    return json({ error: '账号一律创建为普通成员，无法创建或提升管理员。' }, 400, noStore);
  }
  const username = text(body.username, 64).toLowerCase();
  const displayName = text(body.displayName, 80) || username;
  if (!USERNAME_PATTERN.test(username)) {
    return json({ error: '用户名需为 3-64 位小写字母、数字、点、下划线或连字符。' }, 400, noStore);
  }
  const now = new Date().toISOString();
  const accountId = `acct_${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    await env.DB.prepare(`INSERT INTO platform_accounts
        (account_id, username, display_name, role, legacy_owner, enabled, session_version,
         failed_attempts, created_at, updated_at)
        VALUES (?, ?, ?, 'member', 0, 1, 1, 0, ?, ?)`)
      .bind(accountId, username, displayName, now, now).run();
  } catch {
    return json({ error: '用户名已存在或被占用。' }, 409, noStore);
  }
  await recordAudit(env, {
    actorAccountId: actor.accountId, actorType: 'account', action: 'account.created',
    targetAccountId: accountId, detail: { username },
  });
  const row = await loadAccount(env, accountId);
  return json({ account: serializeAccount(row, []) }, 201, noStore);
}

async function setAccountPasswordResponse(env, actor, targetId, request) {
  const target = await loadAccount(env, targetId);
  if (!target) return json({ error: 'Not found' }, 404, noStore);
  if (Number(target.legacy_owner) === 1 || target.role === 'platform_admin') {
    return json({ error: '平台管理员密码不通过此接口设置。' }, 409, noStore);
  }
  const body = await readJsonBody(request.clone());
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return json({ error: `密码长度需为 ${MIN_PASSWORD_LENGTH} 至 ${MAX_PASSWORD_LENGTH} 个字符。` }, 400, noStore);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = hex(await derivePlatformPassword(password, salt));
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`UPDATE platform_accounts
        SET password_hash = ?, password_salt = ?, password_scheme = ?, password_iterations = ?,
            session_version = session_version + 1, failed_attempts = 0,
            attempt_window_started_at = NULL, locked_until = NULL, updated_at = ?
        WHERE account_id = ? AND role = 'member' AND legacy_owner = 0`)
      .bind(hash, hex(salt), SCHEME, ITERATIONS, now, targetId).run();
  } catch {
    return json({ error: '密码更新失败。' }, 500, noStore);
  }
  await recordAudit(env, {
    actorAccountId: actor.accountId, actorType: 'account', action: 'account.password_set',
    targetAccountId: targetId, detail: { sessionVersionBumped: true },
  });
  return new Response(null, { status: 204, headers: noStore });
}

async function setAccountEnabledResponse(env, actor, targetId, request) {
  const target = await loadAccount(env, targetId);
  if (!target) return json({ error: 'Not found' }, 404, noStore);
  const body = await readJsonBody(request.clone());
  if (typeof body.enabled !== 'boolean') return json({ error: 'enabled 必须为布尔值。' }, 400, noStore);
  if (body.enabled === false) {
    if (target.role === 'platform_admin' || Number(target.legacy_owner) === 1) {
      return json({ error: '平台管理员不可停用。' }, 409, noStore);
    }
    if (target.account_id === actor.accountId) return json({ error: '不能停用当前登录账号。' }, 409, noStore);
  }
  const enabled = body.enabled ? 1 : 0;
  // A no-op toggle keeps every existing session valid. A real enabled-state
  // transition bumps session_version so disable/re-enable cannot revive an old
  // token, matching the immediate-revocation requirement.
  if (Number(target.enabled) === enabled) {
    return new Response(null, { status: 204, headers: noStore });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE platform_accounts
      SET enabled = ?, session_version = session_version + 1, updated_at = ?
      WHERE account_id = ?`)
    .bind(enabled, now, targetId).run();
  await recordAudit(env, {
    actorAccountId: actor.accountId, actorType: 'account',
    action: body.enabled ? 'account.enabled' : 'account.disabled', targetAccountId: targetId,
  });
  return new Response(null, { status: 204, headers: noStore });
}

async function setWorkspaceGrantResponse(env, actor, targetId, request) {
  const target = await loadAccount(env, targetId);
  if (!target) return json({ error: 'Not found' }, 404, noStore);
  const body = await readJsonBody(request.clone());
  const workspaceId = text(body.workspaceId, 64);
  if (typeof body.granted !== 'boolean' || !workspaceId) {
    return json({ error: 'workspaceId 与 granted 为必填项。' }, 400, noStore);
  }
  const workspace = await loadWorkspace(env, workspaceId);
  if (!workspace) return json({ error: 'Not found' }, 404, noStore);
  if (workspace.kind === 'lifeos' || workspace.workspace_id === LEGACY_WORKSPACE_ID) {
    return json({ error: '旧版 Life OS 工作区仅映射到旧版所有者。' }, 409, noStore);
  }
  if (Number(target.legacy_owner) === 1 || target.role === 'platform_admin') {
    return json({ error: '平台管理员的工作区授权由配置管理。' }, 409, noStore);
  }
  const now = new Date().toISOString();
  let changes = 0;
  let revoked = false;
  if (body.granted) {
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO platform_account_workspaces
        (account_id, workspace_id, granted_at, granted_by) VALUES (?, ?, ?, ?)`)
      .bind(targetId, workspaceId, now, actor.accountId).run();
    changes = Number(result?.meta?.changes || 0);
    if (changes > 0) {
      await recordAudit(env, {
        actorAccountId: actor.accountId, actorType: 'account', action: 'workspace.granted',
        targetAccountId: targetId, workspaceId,
      });
    }
  } else {
    const result = await env.DB.prepare(`DELETE FROM platform_account_workspaces
        WHERE account_id = ? AND workspace_id = ?`).bind(targetId, workspaceId).run();
    changes = Number(result?.meta?.changes || 0);
    if (changes > 0) {
      revoked = true;
      await recordAudit(env, {
        actorAccountId: actor.accountId, actorType: 'account', action: 'workspace.revoked',
        targetAccountId: targetId, workspaceId,
      });
    }
  }
  if (revoked) {
    // Only a real revoke (a grant row was actually deleted) invalidates the
    // target account's existing sessions so the loss of access takes effect
    // immediately. A new grant must be visible to already-valid sessions without
    // logging the user out, and a no-op (value unchanged) leaves sessions alone.
    await env.DB.prepare('UPDATE platform_accounts SET session_version = session_version + 1 WHERE account_id = ?')
      .bind(targetId).run();
  }
  return json({ accountId: targetId, workspaceId, granted: body.granted, changed: changes > 0 }, 200, noStore);
}

export async function handlePlatformApi(request, env, url, principal) {
  const path = url.pathname;
  const method = request.method;

  if (path === LOGIN_PATH) {
    if (method !== 'POST') return json({ error: 'Not found' }, 404, noStore);
    const parsed = await readJsonBody(request.clone());
    const username = typeof parsed.username === 'string' ? parsed.username : '';
    const password = typeof parsed.password === 'string' ? parsed.password : '';
    const auth = await authenticatePlatformAccount(env, request, username, password);
    if (!auth.account) return json({ error: auth.error || '登录失败。' }, auth.status || 401, noStore);
    const token = issueAccountSessionToken(env.AUTH_SECRET, auth.account.account_id,
      Number(auth.account.session_version));
    await recordAudit(env, { actorAccountId: auth.account.account_id, actorType: 'account', action: 'session.issued' });
    return json({ account: serializeAccount(auth.account), returnTo: safeReturnTo(parsed.returnTo) }, 200,
      { ...noStore, 'set-cookie': buildSessionCookie(token) });
  }

  if (path === LOGOUT_PATH || path === SESSION_PATH) {
    if (method === 'POST' || method === 'DELETE') {
      // Persist revocation of exactly the presented signed token before the
      // clearing cookie is returned. The signature is validated first, so a
      // malformed cookie creates no rows. A token already invalidated by
      // session_version is still individually blacklisted here.
      const revocation = await revokeSessionToken(env, presentedSessionToken(request));
      if (revocation.failed) {
        // Fail closed: never report a successful logout we could not persist.
        return json({ error: '退出登录失败，请稍后重试。' }, 503, noStore);
      }
      if (principal) {
        await recordAudit(env, {
          actorAccountId: principal.accountId, actorType: principal.type, action: 'session.logout',
          detail: { tokenRevoked: revocation.revoked },
        });
      }
      return new Response(null, { status: 204, headers: { ...noStore, 'set-cookie': buildClearSessionCookie() } });
    }
    if (path === LOGOUT_PATH) return json({ error: 'Not found' }, 404, noStore);
  }

  if (path === SESSION_PATH && method === 'GET') {
    if (!principal) return json({ error: 'Not signed in' }, 401, noStore);
    return json({
      authenticated: true,
      principal: serializePrincipal(principal),
      workspaces: await listGrantedWorkspaces(env, principal.accountId),
    }, 200, noStore);
  }

  if (path === WORKSPACES_PATH && method === 'GET') {
    if (!principal) return json({ error: 'Not signed in' }, 401, noStore);
    const workspaces = await listGrantedWorkspaces(env, principal.accountId);
    const response = { workspaces };
    if (isPlatformAdmin(principal)) response.catalog = await listPlatformWorkspaces(env);
    return json(response, 200, noStore);
  }

  const workspaceDetail = path.match(WORKSPACE_DETAIL_PATH);
  if (workspaceDetail && method === 'GET') {
    if (!principal) return json({ error: 'Not signed in' }, 401, noStore);
    return workspaceLandingResponse(env, principal, workspaceDetail[1]);
  }

  if (path === ADMIN_ACCOUNTS_PATH) {
    const denied = adminGuard(principal);
    if (denied) return denied;
    if (method === 'GET') return json({ accounts: await listPlatformAccounts(env) }, 200, noStore);
    if (method === 'POST') return createAccountResponse(env, principal, request);
    return json({ error: 'Not found' }, 404, noStore);
  }

  if (path === ADMIN_WORKSPACES_PATH && method === 'GET') {
    const denied = adminGuard(principal);
    if (denied) return denied;
    return json({ workspaces: await listPlatformWorkspaces(env) }, 200, noStore);
  }

  const passwordMatch = path.match(ACCOUNT_PASSWORD_PATH);
  if (passwordMatch && method === 'POST') {
    const denied = adminGuard(principal);
    if (denied) return denied;
    return setAccountPasswordResponse(env, principal, passwordMatch[1], request);
  }

  const enabledMatch = path.match(ACCOUNT_ENABLED_PATH);
  if (enabledMatch && method === 'POST') {
    const denied = adminGuard(principal);
    if (denied) return denied;
    return setAccountEnabledResponse(env, principal, enabledMatch[1], request);
  }

  const workspacesMatch = path.match(ACCOUNT_WORKSPACES_PATH);
  if (workspacesMatch && method === 'POST') {
    const denied = adminGuard(principal);
    if (denied) return denied;
    return setWorkspaceGrantResponse(env, principal, workspacesMatch[1], request);
  }

  return null;
}

export {
  ADMIN_ACCOUNTS_PATH,
  ADMIN_WORKSPACES_PATH,
  LEGACY_ACCOUNT_ID,
  LEGACY_WORKSPACE_ID,
  LOGIN_PATH,
  LOGOUT_PATH,
  SESSION_COOKIE_NAME,
  SESSION_PATH,
  WORKSPACES_PATH,
  buildClearSessionCookie,
  buildSessionCookie,
  MAX_PASSWORD_LENGTH as PLATFORM_MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH as PLATFORM_MIN_PASSWORD_LENGTH,
  SCHEME as PLATFORM_PASSWORD_SCHEME,
  ITERATIONS as PLATFORM_PASSWORD_ITERATIONS,
};
