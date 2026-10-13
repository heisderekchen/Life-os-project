import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createD1Sqlite } from '../d1-sqlite.mjs';
import { authenticatePlatformAccount } from '../src/platform-auth.mjs';
import { derivePersonalWorkbenchPassword } from '../src/personal-workbench-auth.mjs';
import { initializeOwnerPassword, readHidden } from './initialize-owner-password.mjs';

function fakeTerminal() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.raw = false;
  input.paused = true;
  input.setRawMode = value => { input.raw = value; };
  input.resume = () => { input.paused = false; };
  input.pause = () => { input.paused = true; };
  const output = { value: '', write(value) { output.value += value; } };
  return { input, output };
}

{
  const { input, output } = fakeTerminal();
  const pending = readHidden('Password: ', { input, output });
  assert.equal(input.raw, true);
  assert.equal(input.paused, false);
  input.emit('data', Buffer.from('private-value\n'));
  assert.equal(await pending, 'private-value');
  assert.equal(input.raw, false);
  assert.equal(input.paused, true);
  assert.equal(input.listenerCount('data'), 0);
  const confirmation = readHidden('Confirm password: ', { input, output });
  input.emit('data', Buffer.from('private-value\n'));
  assert.equal(await confirmation, 'private-value');
  assert.equal(input.raw, false);
  assert.equal(input.paused, true);
  assert.equal(output.value, 'Password: \nConfirm password: \n');
}

{
  const { input, output } = fakeTerminal();
  const pending = readHidden('Password: ', { input, output });
  input.emit('data', Buffer.from('partial\u0003'));
  await assert.rejects(pending, /Setup cancelled/);
  assert.equal(input.raw, false);
  assert.equal(input.paused, true);
  assert.equal(input.listenerCount('data'), 0);
}

await assert.rejects(readHidden('Password: ', {
  input: { isTTY: false }, output: { write() {} },
}), /interactive root terminal/);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0090_personal_workbench_owner_credentials.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0092_platform_accounts_and_workspaces.sql', import.meta.url), 'utf8'));
  const now = '2026-10-13T00:00:00.000Z';
  db.prepare(`INSERT INTO platform_accounts
      (account_id,username,display_name,role,legacy_owner,enabled,session_version,failed_attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('acct_legacy_owner','heisderek','Life OS Owner','platform_admin',1,1,7,0,now,now);
  db.prepare(`INSERT INTO platform_account_workspaces (account_id,workspace_id,granted_at,granted_by)
      VALUES (?,?,?,?)`).run('acct_legacy_owner','ws_lifeos_legacy',now,'system:bootstrap');
  return db;
}

const db = fixture();
const password = 'correct horse battery staple';
const timestamp = new Date('2026-10-13T12:00:00.000Z');
const result = await initializeOwnerPassword(db, password, password, timestamp);
assert.deepEqual(result, { username: 'heisderek', timestamp: timestamp.toISOString() });
const owner = db.prepare(`SELECT owner_id,owner_username,password_hash,password_salt,password_scheme,
    password_iterations,setup_grant_consumed_at,setup_grant_revoked_at,credential_created_at
    FROM personal_workbench_owner_credentials WHERE owner_id=1`).get();
assert.equal(owner.owner_id, 1);
assert.equal(owner.owner_username, 'heisderek');
assert.equal(owner.password_scheme, 'pbkdf2-sha256-v1');
assert.equal(Number(owner.password_iterations), 100000);
assert.equal(owner.password_hash.length, 64);
assert.equal(owner.password_salt.length, 32);
assert.equal(owner.setup_grant_consumed_at, timestamp.toISOString());
assert.equal(owner.setup_grant_revoked_at, timestamp.toISOString());
assert.equal(owner.credential_created_at, timestamp.toISOString());
const expected = Buffer.from(await derivePersonalWorkbenchPassword(password, Buffer.from(owner.password_salt,'hex'))).toString('hex');
assert.equal(owner.password_hash, expected);
const env = {
  DB: createD1Sqlite(db), AUTH_SECRET: 'test-only-auth-secret',
  PERSONAL_WORKBENCH_OWNER: 'heisderek', PERSONAL_WORKBENCH_ENTRY_KEY: 'test-only-entry-key',
};
const loginRequest = new Request('https://lifeos.example/api/platform/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'heisderek', password }),
});
const login = await authenticatePlatformAccount(env, loginRequest, 'heisderek', password);
assert.equal(login.account.account_id, 'acct_legacy_owner');
const wrongPassword = await authenticatePlatformAccount(env, new Request(loginRequest.url, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'heisderek', password: 'wrong password' }),
}), 'heisderek', 'wrong password');
assert.equal(wrongPassword.status, 401);
const platform = db.prepare(`SELECT username,role,legacy_owner,enabled,session_version,password_hash
    FROM platform_accounts WHERE account_id='acct_legacy_owner'`).get();
assert.deepEqual({ ...platform }, { username:'heisderek',role:'platform_admin',legacy_owner:1,enabled:1,session_version:7,password_hash:null });
const afterSuccess = db.prepare(`SELECT owner_username,password_hash,password_salt,setup_grant_consumed_at,setup_grant_revoked_at
    FROM personal_workbench_owner_credentials WHERE owner_id=1`).get();
await assert.rejects(initializeOwnerPassword(db,password,password,timestamp), /already initialized/);
assert.deepEqual(db.prepare(`SELECT owner_username,password_hash,password_salt,setup_grant_consumed_at,setup_grant_revoked_at
    FROM personal_workbench_owner_credentials WHERE owner_id=1`).get(), afterSuccess);
db.close();

const uninitialized = fixture();
await assert.rejects(initializeOwnerPassword(uninitialized,password,'different',timestamp), /do not match/);
assert.equal(uninitialized.prepare('SELECT password_hash FROM personal_workbench_owner_credentials WHERE owner_id=1').get().password_hash,null);
uninitialized.prepare(`UPDATE personal_workbench_owner_credentials SET setup_grant_consumed_at=? WHERE owner_id=1`).run(timestamp.toISOString());
await assert.rejects(initializeOwnerPassword(uninitialized,password,password,timestamp), /already initialized/);
assert.equal(uninitialized.prepare('SELECT password_hash FROM personal_workbench_owner_credentials WHERE owner_id=1').get().password_hash,null);
uninitialized.close();

const wrongOwner = fixture();
wrongOwner.prepare(`UPDATE platform_accounts SET username='lifeos-owner' WHERE account_id='acct_legacy_owner'`).run();
await assert.rejects(initializeOwnerPassword(wrongOwner,password,password,timestamp), /not heisderek/);
assert.equal(wrongOwner.prepare('SELECT password_hash FROM personal_workbench_owner_credentials WHERE owner_id=1').get().password_hash,null);
wrongOwner.close();

for (const [statement, args, message] of [
  ["DELETE FROM platform_account_workspaces WHERE account_id='acct_legacy_owner'", [], /not assigned/],
  ["UPDATE platform_accounts SET enabled=0 WHERE account_id='acct_legacy_owner'", [], /not heisderek/],
  ["UPDATE platform_accounts SET role='member' WHERE account_id='acct_legacy_owner'", [], /not heisderek/],
]) {
  const denied = fixture();
  denied.prepare(statement).run(...args);
  await assert.rejects(initializeOwnerPassword(denied,password,password,timestamp), message);
  assert.equal(denied.prepare('SELECT password_hash FROM personal_workbench_owner_credentials WHERE owner_id=1').get().password_hash,null);
  denied.close();
}
console.log('owner password setup CLI transaction tests passed');
