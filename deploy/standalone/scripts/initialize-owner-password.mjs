#!/usr/bin/env node
import { randomBytes, webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import {
  derivePersonalWorkbenchPassword,
  PERSONAL_WORKBENCH_MAX_PASSWORD_LENGTH,
  PERSONAL_WORKBENCH_MIN_PASSWORD_LENGTH,
  PERSONAL_WORKBENCH_PASSWORD_ITERATIONS,
  PERSONAL_WORKBENCH_PASSWORD_SCHEME,
} from '../src/personal-workbench-auth.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const OWNER_USERNAME = 'heisderek';
const OWNER_ID = 1;
const PLATFORM_ACCOUNT_ID = 'acct_legacy_owner';
const LEGACY_WORKSPACE_ID = 'ws_lifeos_legacy';
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function fail(message) { throw new Error(message); }
function hex(bytes) { return Buffer.from(bytes).toString('hex'); }

function readConfiguredOwner(configPath) {
  let source;
  try { source = readFileSync(configPath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Unable to read the Life OS config file.');
  }
  const values = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?PERSONAL_WORKBENCH_OWNER\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[1];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.push(value);
  }
  if (values.length > 1) fail('Life OS config has multiple owner settings.');
  return values[0] ?? null;
}

function assertOwnerMapping(db) {
  const account = db.prepare(`SELECT account_id, username, role, legacy_owner, enabled
      FROM platform_accounts WHERE account_id = ?`).get(PLATFORM_ACCOUNT_ID);
  if (!account || account.username !== OWNER_USERNAME || account.role !== 'platform_admin'
      || Number(account.legacy_owner) !== 1 || Number(account.enabled) !== 1) {
    fail('The configured Life OS platform owner is not heisderek; refusing to initialize credentials.');
  }
  const grant = db.prepare(`SELECT 1 FROM platform_account_workspaces
      WHERE account_id = ? AND workspace_id = ?`).get(PLATFORM_ACCOUNT_ID, LEGACY_WORKSPACE_ID);
  if (!grant) fail('The legacy Life OS workspace is not assigned to heisderek.');
}

export async function initializeOwnerPassword(db, password, confirmation, now = new Date()) {
  if (typeof password !== 'string' || password.length < PERSONAL_WORKBENCH_MIN_PASSWORD_LENGTH
      || password.length > PERSONAL_WORKBENCH_MAX_PASSWORD_LENGTH) {
    fail(`Password must be ${PERSONAL_WORKBENCH_MIN_PASSWORD_LENGTH}–${PERSONAL_WORKBENCH_MAX_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirmation) fail('The two password entries do not match.');

  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
  try {
    assertOwnerMapping(db);
    const current = db.prepare(`SELECT owner_id, owner_username, password_hash,
          setup_grant_consumed_at, setup_grant_revoked_at
        FROM personal_workbench_owner_credentials WHERE owner_id = ?`).get(OWNER_ID);
    if (!current || current.owner_username !== null || current.password_hash !== null
        || current.setup_grant_consumed_at !== null || current.setup_grant_revoked_at !== null) {
      fail('Life OS owner credentials are already initialized or unavailable.');
    }

    const salt = randomBytes(SALT_BYTES);
    const passwordHash = hex(await derivePersonalWorkbenchPassword(password, salt));
    const timestamp = now.toISOString();
    const result = db.prepare(`UPDATE personal_workbench_owner_credentials
        SET owner_username = ?, password_hash = ?, password_salt = ?, password_scheme = ?,
            password_iterations = ?, failed_attempts = 0, attempt_window_started_at = NULL,
            locked_until = NULL, setup_grant_consumed_at = ?, setup_grant_revoked_at = ?,
            credential_created_at = ?
        WHERE owner_id = ? AND owner_username IS NULL AND password_hash IS NULL
            AND setup_grant_consumed_at IS NULL AND setup_grant_revoked_at IS NULL`)
      .run(OWNER_USERNAME, passwordHash, hex(salt), PERSONAL_WORKBENCH_PASSWORD_SCHEME,
        PERSONAL_WORKBENCH_PASSWORD_ITERATIONS, timestamp, timestamp, timestamp, OWNER_ID);
    if (Number(result.changes) !== 1) fail('Life OS owner credentials changed concurrently; nothing was initialized.');
    db.exec('COMMIT');
    return { username: OWNER_USERNAME, timestamp };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export async function readHidden(prompt, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') fail('Run this command in an interactive root terminal.');
  output.write(prompt);
  const decoder = new StringDecoder('utf8');
  const chars = [];
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.removeListener('data', onData);
      try { input.setRawMode(false); } catch {}
      try { input.pause(); } catch {}
      output.write('\n');
      if (error) reject(error); else resolve(chars.join(''));
    };
    const onData = (chunk) => {
      for (const char of decoder.write(chunk)) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('Setup cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') { chars.pop(); continue; }
        if (!/[\u0000-\u001f\u007f]/u.test(char)) chars.push(char);
      }
    };
    input.on('data', onData);
    try {
      input.setRawMode(true);
      input.resume();
    } catch (error) {
      finish(new Error('Unable to read hidden terminal input.'));
    }
  });
}

function resolveDatabasePath(raw) {
  if (!raw) return '/var/lib/lifeos/lifeos.db';
  if (raw.startsWith('file:')) return raw.slice(5).split('?')[0];
  return raw;
}

export async function main() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) fail('Run this command as root.');
  const configPath = process.env.LIFEOS_CONFIG_FILE || '/etc/lifeos/lifeos.conf';
  const configuredOwner = process.env.PERSONAL_WORKBENCH_OWNER || readConfiguredOwner(configPath);
  if (configuredOwner && configuredOwner.toLowerCase() !== OWNER_USERNAME) {
    fail('Life OS runtime owner is not configured as heisderek; refusing to initialize credentials.');
  }
  const db = new DatabaseSync(resolveDatabasePath(process.env.DATABASE_URL));
  try {
    const password = await readHidden('New Life OS password (input is hidden): ');
    const confirmation = await readHidden('Confirm new Life OS password (input is hidden): ');
    const result = await initializeOwnerPassword(db, password, confirmation);
    process.stdout.write(`Initialized the Life OS owner credential for ${result.username}. You can now sign in.\n`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`Life OS owner setup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
