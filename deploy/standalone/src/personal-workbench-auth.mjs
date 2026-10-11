import { json } from './app/response.mjs';

const OWNER_ID = 1;
const PASSWORD_SCHEME = 'pbkdf2-sha256-v1';
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_BYTES = 32;
const SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 14;
const MAX_PASSWORD_LENGTH = 128;
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_SETUP_GRANT_AGE_MS = 30 * 60 * 1000;
const DUMMY_SALT = new Uint8Array(SALT_BYTES);
const DUMMY_HASH = new Uint8Array(PASSWORD_BYTES);

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const encoder = new TextEncoder();
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function hex(bytes) {
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value, expectedBytes) {
    if (typeof value !== 'string' || value.length !== expectedBytes * 2 || !/^[0-9a-f]+$/i.test(value)) return null;
    return Uint8Array.from(value.match(/.{2}/g), byte => Number.parseInt(byte, 16));
}

function fromBase64Url(value, expectedBytes) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
        const decoded = atob(padded);
        if (decoded.length !== expectedBytes) return null;
        const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
        const canonical = btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        return canonical === value ? bytes : null;
    } catch {
        return null;
    }
}

function parseOwnerSetupGrant(value, now) {
    if (typeof value !== 'string') return null;
    const [version, environment, expirySecondsText, encodedKey, extra] = value.split('.');
    if (version !== 'v2' || !['staging', 'production'].includes(environment)
        || !/^\d{10}$/.test(expirySecondsText || '') || extra !== undefined) return null;
    const expirySeconds = Number(expirySecondsText);
    if (!Number.isSafeInteger(expirySeconds)) return null;
    const expiresAt = expirySeconds * 1000;
    if (expiresAt <= now || expiresAt > now + MAX_SETUP_GRANT_AGE_MS) return null;
    const key = fromBase64Url(encodedKey, 32);
    return key ? { key, expiresAt, environment } : null;
}

function timingSafeEqual(actual, expected) {
    if (actual.length !== expected.length) return false;
    if (typeof crypto.subtle.timingSafeEqual === 'function') {
        return crypto.subtle.timingSafeEqual(actual, expected);
    }
    let mismatch = 0;
    for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index];
    return mismatch === 0;
}

export async function derivePersonalWorkbenchPassword(password, salt, iterations = PASSWORD_ITERATIONS) {
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > PASSWORD_ITERATIONS) {
        throw new RangeError('Unsupported password hashing iteration count.');
    }
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations
    }, key, PASSWORD_BYTES * 8));
}

async function passwordMatches(password, salt, expected) {
    const actual = await derivePersonalWorkbenchPassword(password, salt);
    return timingSafeEqual(actual, expected);
}

async function requestBody(request) {
    try {
        const body = await request.json();
        return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    } catch {
        return {};
    }
}

function schemaUnavailable() {
    return json({ error: 'Life OS 专用登录尚未就绪，请联系负责人。' }, 503, noStore);
}

export async function createPersonalWorkbenchOwnerCredential(request, env) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, noStore);
    const environment = String(env?.ENVIRONMENT || '').toLowerCase();
    if (!['staging', 'production'].includes(environment)) return json({ error: 'Not found' }, 404, noStore);
    if (env?.PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED !== 'true') {
        return json({ error: 'Life OS 首次设置当前不可用，请联系负责人。' }, 503, noStore);
    }
    const requestUrl = new URL(request.url);
    if (requestUrl.protocol !== 'https:') {
        return json({ error: 'Life OS 首次设置仅允许通过安全连接提交。' }, 403, noStore);
    }
    const origin = request.headers.get('origin');
    if (!origin || origin !== requestUrl.origin) {
        return json({ error: 'Life OS 首次设置仅允许从本站提交。' }, 403, noStore);
    }
    if (requestUrl.search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
        return json({ error: 'Life OS 首次设置请求格式无效。' }, 400, noStore);
    }

    const body = await requestBody(request);
    const setupKey = typeof body.setupKey === 'string' ? body.setupKey : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        return json({ error: `Life OS 密码长度需为 ${MIN_PASSWORD_LENGTH} 至 ${MAX_PASSWORD_LENGTH} 个字符。` }, 400, noStore);
    }
    if (password !== confirmPassword) return json({ error: '两次输入的 Life OS 密码不一致。' }, 400, noStore);

    const owner = text(env?.PERSONAL_WORKBENCH_OWNER).toLowerCase();
    const configuredGrant = parseOwnerSetupGrant(env?.PERSONAL_WORKBENCH_OWNER_SETUP_GRANT, Date.now());
    if (!owner || !configuredGrant || configuredGrant.environment !== environment) {
        return json({ error: 'Life OS 首次设置当前不可用，请联系负责人。' }, 503, noStore);
    }

    let row;
    try {
        row = await env.DB.prepare(`SELECT password_hash, setup_grant_consumed_at, setup_grant_revoked_at
            FROM personal_workbench_owner_credentials WHERE owner_id = ?`).bind(OWNER_ID).first();
    } catch {
        return schemaUnavailable();
    }
    if (!row) return schemaUnavailable();

    const suppliedKey = fromBase64Url(setupKey, 32);
    if (!suppliedKey || !timingSafeEqual(suppliedKey, configuredGrant.key)) {
        return json({ error: 'Life OS 首设授权码无效或已过期。' }, 401, noStore);
    }
    if (row.password_hash || row.setup_grant_consumed_at || row.setup_grant_revoked_at) {
        return json({ error: 'Life OS 首次设置当前不可用，请联系负责人。' }, 409, noStore);
    }

    const now = new Date();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const passwordHash = hex(await derivePersonalWorkbenchPassword(password, salt));
    let result;
    try {
        result = await env.DB.prepare(`UPDATE personal_workbench_owner_credentials
            SET owner_username = ?, password_hash = ?, password_salt = ?, password_scheme = ?,
                password_iterations = ?, failed_attempts = 0, attempt_window_started_at = NULL,
                locked_until = NULL, setup_grant_consumed_at = ?, credential_created_at = ?,
                setup_grant_revoked_at = ?
            WHERE owner_id = ? AND password_hash IS NULL
                AND setup_grant_consumed_at IS NULL AND setup_grant_revoked_at IS NULL`)
            .bind(owner, passwordHash, hex(salt), PASSWORD_SCHEME, PASSWORD_ITERATIONS,
                now.toISOString(), now.toISOString(), now.toISOString(), OWNER_ID).run();
    } catch {
        return schemaUnavailable();
    }
    if (Number(result?.meta?.changes || 0) !== 1) {
        return json({ error: 'Life OS 专用密码已设置，请直接登录。' }, 409, noStore);
    }
    return new Response(null, { status: 204, headers: noStore });
}

function isCredentialReady(row, configuredOwner) {
    return Boolean(row
        && configuredOwner
        && text(row.owner_username).toLowerCase() === configuredOwner
        && row.password_scheme === PASSWORD_SCHEME
        && Number(row.password_iterations) === PASSWORD_ITERATIONS
        && fromHex(row.password_salt, SALT_BYTES)
        && fromHex(row.password_hash, PASSWORD_BYTES));
}

async function recordFailedAttempt(env, now) {
    const windowCutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
    const attemptStarted = now.toISOString();
    const lockUntil = new Date(now.getTime() + LOCKOUT_MS).toISOString();
    await env.DB.prepare(`UPDATE personal_workbench_owner_credentials
        SET failed_attempts = CASE
                WHEN attempt_window_started_at IS NULL OR attempt_window_started_at <= ? THEN 1
                ELSE MIN(?, failed_attempts + 1)
            END,
            attempt_window_started_at = CASE
                WHEN attempt_window_started_at IS NULL OR attempt_window_started_at <= ? THEN ?
                ELSE attempt_window_started_at
            END,
            locked_until = CASE
                WHEN (CASE WHEN attempt_window_started_at IS NULL OR attempt_window_started_at <= ? THEN 1
                    ELSE MIN(?, failed_attempts + 1) END) >= ? THEN ? ELSE NULL
            END
        WHERE owner_id = ?`)
        .bind(windowCutoff, MAX_FAILED_ATTEMPTS, windowCutoff, attemptStarted, windowCutoff,
            MAX_FAILED_ATTEMPTS, MAX_FAILED_ATTEMPTS, lockUntil, OWNER_ID).run();
}

export async function authenticatePersonalWorkbenchPassword(request, env) {
    if (request.method !== 'POST') return { response: json({ error: 'Method not allowed' }, 405, noStore) };
    const body = await requestBody(request);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) return { response: json({ error: '请填写 Life OS 密码。' }, 400, noStore) };
    if (password.length > MAX_PASSWORD_LENGTH) {
        return { response: json({ error: 'Life OS 密码不正确或尚未设置。' }, 401, noStore) };
    }

    let row;
    try {
        row = await env.DB.prepare(`SELECT owner_username, password_hash, password_salt, password_scheme,
                password_iterations, failed_attempts, attempt_window_started_at, locked_until
            FROM personal_workbench_owner_credentials WHERE owner_id = ?`).bind(OWNER_ID).first();
    } catch {
        return { response: schemaUnavailable() };
    }
    if (!row) return { response: schemaUnavailable() };

    const now = new Date();
    const nowIso = now.toISOString();
    if (row.locked_until && String(row.locked_until) > nowIso) {
        return { response: json({ error: '登录尝试过多，请稍后再试。' }, 429, noStore) };
    }

    const owner = text(env?.PERSONAL_WORKBENCH_OWNER).toLowerCase();
    const credentialReady = isCredentialReady(row, owner);
    const salt = credentialReady ? fromHex(row.password_salt, SALT_BYTES) : DUMMY_SALT;
    const expected = credentialReady ? fromHex(row.password_hash, PASSWORD_BYTES) : DUMMY_HASH;
    const matches = await passwordMatches(password, salt, expected);
    if (!credentialReady || !matches) {
        try {
            await recordFailedAttempt(env, now);
        } catch {
            return { response: schemaUnavailable() };
        }
        return { response: json({ error: 'Life OS 密码不正确或尚未设置。' }, 401, noStore) };
    }

    try {
        await env.DB.prepare(`UPDATE personal_workbench_owner_credentials
            SET failed_attempts = 0, attempt_window_started_at = NULL, locked_until = NULL
            WHERE owner_id = ?`).bind(OWNER_ID).run();
    } catch {
        return { response: schemaUnavailable() };
    }
    return { username: owner };
}

export {
    MAX_FAILED_ATTEMPTS as PERSONAL_WORKBENCH_MAX_FAILED_ATTEMPTS,
    MAX_PASSWORD_LENGTH as PERSONAL_WORKBENCH_MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH as PERSONAL_WORKBENCH_MIN_PASSWORD_LENGTH,
    PASSWORD_ITERATIONS as PERSONAL_WORKBENCH_PASSWORD_ITERATIONS,
    PASSWORD_SCHEME as PERSONAL_WORKBENCH_PASSWORD_SCHEME
};
