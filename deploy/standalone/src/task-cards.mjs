// MVP task-card metadata + Worker routing for the private Life OS workspace.
//
// Contract enforced on every request handled here:
//   * server.mjs resolves the principal fresh from the session cookie for every
//     request; this module never trusts a cached identity.
//   * The principal must be the stable legacy owner principal (`isLegacyOwner`
//     from platform-auth), must hold a fresh grant for the Life OS workspace
//     (checked with the existing `workspacePageState` helper), and the resolved
//     workspace must be exactly `ws_lifeos_legacy`. The owner check is what keeps
//     the private surface usable only by legacy owner A even if a
//     `ws_lifeos_legacy` grant is ever mistakenly created for another account.
//     Anything else is reported as not found so the private surface never
//     discloses its existence.
//   * Every card read/write is filtered by account_id + workspace_id + task_id.
//   * Routing writes additionally require the current platform-admin policy and
//     must name a provider/model pair that the server catalog reports as ready.
//
// This module never calls a model provider and never returns provider
// credentials. Readiness is derived only from the local agent-service health
// flags that server.mjs already reads; provider API keys stay in the agent
// service and are never part of the catalog payload.
import { json } from './app/response.mjs';
import { LEGACY_WORKSPACE_ID, isLegacyOwner, isPlatformAdmin, workspacePageState } from './platform-auth.mjs';

export const TASK_CARD_API_SUFFIX = '/api/task-cards';

const LIFEOS_WORKSPACE_SLUG = 'lifeos';
const MAX_LIST_ITEMS = 50;
const MAX_ARTIFACT_LENGTH = 300;
const MAX_EVIDENCE_LENGTH = 500;
const MAX_GOAL_LENGTH = 2000;
const MAX_NEXT_STEP_LENGTH = 500;
const MAX_OBJECTIVE_LENGTH = 500;
const MAX_ROUTING_ROWS = 200;

const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const notFound = () => json({ error: 'Not found' }, 404, noStore);
const badRequest = (code, message) => json({ error: message, code }, 400, noStore);
const forbidden = () => json({ error: '只有平台管理员可以修改 Worker 路由。', code: 'FORBIDDEN' }, 403, noStore);
const fail = (code, message) => ({ ok: false, code, message });

const TASK_CARD_TYPES = [
  { id: 'bug', label: 'Bug' },
  { id: 'optimization', label: '优化' },
  { id: 'new_feature', label: '新需求' },
  { id: 'environment', label: '环境' },
  { id: 'test', label: '测试' },
];

const TASK_CARD_ROLES = [
  { id: 'planner', label: '规划' },
  { id: 'developer', label: '开发' },
  { id: 'reviewer', label: '复核' },
];

const TASK_CARD_STATUSES = [
  { id: 'draft', label: '草稿' },
  { id: 'ready', label: '就绪' },
  { id: 'done', label: '完成' },
];

const TYPE_IDS = new Set(TASK_CARD_TYPES.map(entry => entry.id));
const ROLE_IDS = new Set(TASK_CARD_ROLES.map(entry => entry.id));
const STATUS_IDS = new Set(TASK_CARD_STATUSES.map(entry => entry.id));

// Authoritative server-side catalog. Model identifiers come from the same
// operator configuration the agent service uses, so the browser can never
// invent a provider or a model id.
const SERVER_WORKER_CATALOG = [
  { provider: 'deepseek', label: 'DeepSeek', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-flash' },
  { provider: 'openai', label: 'OpenAI', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4.1-mini' },
];

// Explicitly listed so an absent Gemini configuration is labelled unavailable
// instead of silently disappearing or being invented with a made-up model id.
const UNAVAILABLE_WORKERS = [
  {
    provider: 'gemini',
    label: 'Gemini',
    available: false,
    reason: 'not_in_server_catalog',
    message: 'Gemini 不在当前服务端模型目录中，未配置即不可用，且没有可用模型 ID。',
  },
];

export function buildWorkerCatalog(env = {}, agentHealth = null) {
  const health = agentHealth && typeof agentHealth === 'object' && !Array.isArray(agentHealth) ? agentHealth : null;
  const readyFlags = health && health.providers && typeof health.providers === 'object' ? health.providers : {};
  const providers = SERVER_WORKER_CATALOG.map(entry => {
    const model = text(env?.[entry.modelEnv], 120) || entry.defaultModel;
    const ready = Boolean(health && readyFlags[entry.provider] === true);
    return {
      provider: entry.provider,
      label: entry.label,
      model,
      source: 'server-catalog',
      ready,
      reason: ready ? null : health ? 'provider_not_ready' : 'agent_service_not_configured',
    };
  });
  return {
    providers,
    unavailable: UNAVAILABLE_WORKERS.map(entry => ({ ...entry })),
    readyCount: providers.filter(entry => entry.ready).length,
    agentServiceReachable: Boolean(health),
  };
}

function readyWorker(catalog, provider, model) {
  return (catalog.providers || []).find(entry =>
    entry.provider === provider && entry.model === model && entry.ready === true) || null;
}

function parseStringList(value, { code, label, itemMax }) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail(code, `${label}必须是数组。`);
  if (value.length > MAX_LIST_ITEMS) return fail(code, `${label}最多 ${MAX_LIST_ITEMS} 项。`);
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return fail(code, `${label}的每一项都必须是文本。`);
    const item = text(entry, itemMax);
    if (!item) return fail(code, `${label}不能包含空项。`);
    out.push(item);
  }
  return { ok: true, value: out };
}

function parseRoles(value, catalog) {
  if (!Array.isArray(value) || value.length !== TASK_CARD_ROLES.length) {
    return fail('INVALID_ROLE_ASSIGNMENTS', '角色分配必须恰好包含 planner、developer、reviewer 各一条。');
  }
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return fail('INVALID_ROLE_ASSIGNMENTS', '角色分配的格式无效。');
    }
    const role = text(entry.role, 32);
    if (!ROLE_IDS.has(role) || seen.has(role)) {
      return fail('INVALID_ROLE_ASSIGNMENTS', '角色必须是 planner、developer、reviewer 且不能重复。');
    }
    seen.add(role);
    const provider = text(entry.provider, 32);
    const model = text(entry.model, 120);
    const objective = text(entry.objective, MAX_OBJECTIVE_LENGTH);
    if (!provider && !model) {
      out.push({ role, provider: null, model: null, objective });
      continue;
    }
    if (!provider || !model) {
      return fail('INVALID_WORKER_SELECTION', '模型提供方与模型 ID 必须同时填写或同时留空。');
    }
    const worker = readyWorker(catalog, provider, model);
    if (!worker) {
      return fail('WORKER_MODEL_NOT_READY', `模型条目不在服务端目录中或尚未就绪：${provider} / ${model}。`);
    }
    out.push({ role, provider: worker.provider, model: worker.model, objective });
  }
  return { ok: true, value: out };
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(typeof raw === 'string' && raw ? raw : '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeCard(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.card_type,
    goal: row.goal,
    expectedArtifacts: parseJsonArray(row.expected_artifacts_json),
    subtaskIds: parseJsonArray(row.subtask_ids_json),
    dependencyIds: parseJsonArray(row.dependency_ids_json),
    roles: parseJsonArray(row.roles_json),
    verification: parseJsonArray(row.verification_evidence_json),
    nextStep: row.next_step || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRouting(row, catalog) {
  return {
    type: row.card_type,
    role: row.role,
    provider: row.provider,
    model: row.model,
    ready: Boolean(readyWorker(catalog, row.provider, row.model)),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

// Scope check. All three conditions are required on every request: the stable
// legacy owner principal (independent of any workspace grant), a fresh grant
// check through the existing workspace helper, and the exact stable workspace id
// the scope columns are written with. The owner check means a mistakenly created
// `ws_lifeos_legacy` grant for another account still cannot reach the private
// Life OS surface.
async function resolveLifeOsScope(env, principal) {
  if (!principal) return null;
  if (!isLegacyOwner(principal)) return null;
  const state = await workspacePageState(env, principal, LIFEOS_WORKSPACE_SLUG);
  if (!state || state.status !== 'configured') return null;
  if (state.workspace?.workspaceId !== LEGACY_WORKSPACE_ID) return null;
  return { accountId: principal.accountId, workspaceId: state.workspace.workspaceId };
}

async function audit(env, actor, action, entityId, detail) {
  try {
    await env.DB.prepare('INSERT INTO personal_workbench_lifeos_audit_log (action, entity_id, detail_json, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(action, entityId, JSON.stringify(detail ?? {}), actor, new Date().toISOString()).run();
  } catch {
    // Append-only auditing must never break the request path.
  }
}

async function loadTask(env, taskId) {
  try {
    return await env.DB.prepare('SELECT id, title, status FROM personal_workbench_lifeos_tasks WHERE id = ?')
      .bind(taskId).first();
  } catch {
    return null;
  }
}

async function loadCardRow(env, scope, taskId) {
  return env.DB.prepare('SELECT * FROM lifeos_task_cards WHERE account_id = ? AND workspace_id = ? AND task_id = ?')
    .bind(scope.accountId, scope.workspaceId, taskId).first();
}

async function listRoutingRows(env, scope, type = null) {
  const base = 'SELECT * FROM lifeos_task_worker_routing WHERE account_id = ? AND workspace_id = ?';
  const statement = type
    ? env.DB.prepare(`${base} AND card_type = ? ORDER BY card_type, role`).bind(scope.accountId, scope.workspaceId, type)
    : env.DB.prepare(`${base} ORDER BY card_type, role LIMIT ${MAX_ROUTING_ROWS}`).bind(scope.accountId, scope.workspaceId);
  const result = await statement.all();
  return result.results || [];
}

async function validateCardBody(env, taskId, input, catalog) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const type = text(body.type, 40);
  if (!TYPE_IDS.has(type)) {
    return fail('INVALID_TASK_CARD_TYPE', '任务卡类型必须是 Bug、优化、新需求、环境、测试 之一。');
  }
  const goal = text(body.goal, MAX_GOAL_LENGTH);
  if (!goal) return fail('INVALID_GOAL', '任务目标不能为空。');
  const status = body.status === undefined || body.status === '' ? 'draft' : text(body.status, 20);
  if (!STATUS_IDS.has(status)) {
    return fail('INVALID_STATUS', '任务卡状态必须是 draft、ready、done 之一。');
  }
  const expectedArtifacts = parseStringList(body.expectedArtifacts, {
    code: 'INVALID_EXPECTED_ARTIFACTS', label: '预期产出', itemMax: MAX_ARTIFACT_LENGTH,
  });
  if (!expectedArtifacts.ok) return expectedArtifacts;
  const verification = parseStringList(body.verification, {
    code: 'INVALID_VERIFICATION', label: '验证证据', itemMax: MAX_EVIDENCE_LENGTH,
  });
  if (!verification.ok) return verification;
  const subtaskIds = parseStringList(body.subtaskIds, {
    code: 'INVALID_SUBTASK_REFERENCE', label: '子任务引用', itemMax: 64,
  });
  if (!subtaskIds.ok) return subtaskIds;
  for (const subtaskId of subtaskIds.value) {
    const row = await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id = ? AND parent_task_id = ?')
      .bind(subtaskId, taskId).first();
    if (!row) {
      return fail('INVALID_SUBTASK_REFERENCE', `子任务引用无效：${subtaskId} 不是该任务的现有子任务。`);
    }
  }
  const dependencyIds = parseStringList(body.dependencyIds, {
    code: 'INVALID_DEPENDENCY_REFERENCE', label: '依赖引用', itemMax: 64,
  });
  if (!dependencyIds.ok) return dependencyIds;
  for (const dependencyId of dependencyIds.value) {
    const row = await env.DB.prepare('SELECT id FROM lifeos_task_dependencies WHERE id = ? AND task_id = ?')
      .bind(dependencyId, taskId).first();
    if (!row) {
      return fail('INVALID_DEPENDENCY_REFERENCE', `依赖引用无效：${dependencyId} 不是该任务的现有依赖。`);
    }
  }
  const roles = parseRoles(body.roles, catalog);
  if (!roles.ok) return roles;
  return {
    ok: true,
    value: {
      type,
      goal,
      status,
      expectedArtifacts: expectedArtifacts.value,
      verification: verification.value,
      subtaskIds: [...new Set(subtaskIds.value)],
      dependencyIds: [...new Set(dependencyIds.value)],
      roles: roles.value,
      nextStep: text(body.nextStep, MAX_NEXT_STEP_LENGTH),
    },
  };
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

async function getCardResponse(env, scope, taskId, catalog) {
  const task = await loadTask(env, taskId);
  if (!task) return notFound();
  const row = await loadCardRow(env, scope, taskId);
  const routing = (await listRoutingRows(env, scope, row?.card_type || null))
    .map(entry => serializeRouting(entry, catalog));
  return json({
    taskId,
    task: { id: task.id, title: task.title, status: task.status },
    card: row ? serializeCard(row) : null,
    routing,
  }, 200, noStore);
}

async function putCardResponse(env, scope, principal, taskId, request, catalog) {
  const task = await loadTask(env, taskId);
  if (!task) return notFound();
  const validated = await validateCardBody(env, taskId, await readJsonBody(request), catalog);
  if (!validated.ok) return badRequest(validated.code, validated.message);
  const value = validated.value;
  const existing = await loadCardRow(env, scope, taskId);
  const timestamp = new Date().toISOString();
  await env.DB.prepare('INSERT INTO lifeos_task_cards (id, account_id, workspace_id, task_id, card_type, goal, expected_artifacts_json, subtask_ids_json, dependency_ids_json, roles_json, verification_evidence_json, next_step, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, workspace_id, task_id) DO UPDATE SET card_type = excluded.card_type, goal = excluded.goal, expected_artifacts_json = excluded.expected_artifacts_json, subtask_ids_json = excluded.subtask_ids_json, dependency_ids_json = excluded.dependency_ids_json, roles_json = excluded.roles_json, verification_evidence_json = excluded.verification_evidence_json, next_step = excluded.next_step, status = excluded.status, updated_at = excluded.updated_at')
    .bind(crypto.randomUUID(), scope.accountId, scope.workspaceId, taskId, value.type, value.goal,
      JSON.stringify(value.expectedArtifacts), JSON.stringify(value.subtaskIds),
      JSON.stringify(value.dependencyIds), JSON.stringify(value.roles),
      JSON.stringify(value.verification), value.nextStep, value.status, timestamp, timestamp).run();
  await audit(env, principal.username, existing ? 'task-card.updated' : 'task-card.created', taskId, {
    type: value.type, status: value.status,
  });
  const row = await loadCardRow(env, scope, taskId);
  return json({ card: serializeCard(row) }, existing ? 200 : 201, noStore);
}

async function deleteCardResponse(env, scope, principal, taskId) {
  const task = await loadTask(env, taskId);
  if (!task) return notFound();
  const result = await env.DB.prepare('DELETE FROM lifeos_task_cards WHERE account_id = ? AND workspace_id = ? AND task_id = ?')
    .bind(scope.accountId, scope.workspaceId, taskId).run();
  const deleted = Number(result?.meta?.changes || 0) > 0;
  if (deleted) await audit(env, principal.username, 'task-card.deleted', taskId, {});
  return json({ taskId, deleted }, 200, noStore);
}

async function putRoutingResponse(env, scope, principal, request, catalog) {
  const body = await readJsonBody(request);
  const type = text(body.type, 40);
  if (!TYPE_IDS.has(type)) return badRequest('INVALID_TASK_CARD_TYPE', '路由的任务类型必须合法。');
  const role = text(body.role, 32);
  if (!ROLE_IDS.has(role)) {
    return badRequest('INVALID_TASK_CARD_ROLE', '路由的角色必须是 planner、developer、reviewer 之一。');
  }
  const provider = text(body.provider, 32);
  const model = text(body.model, 120);
  if (!provider || !model) return badRequest('INVALID_WORKER_SELECTION', '必须提供 provider 与 model。');
  const worker = readyWorker(catalog, provider, model);
  if (!worker) {
    return badRequest('WORKER_MODEL_NOT_READY', `模型条目不在服务端目录中或尚未就绪：${provider} / ${model}。`);
  }
  const timestamp = new Date().toISOString();
  await env.DB.prepare('INSERT INTO lifeos_task_worker_routing (id, account_id, workspace_id, card_type, role, provider, model, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, workspace_id, card_type, role) DO UPDATE SET provider = excluded.provider, model = excluded.model, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(crypto.randomUUID(), scope.accountId, scope.workspaceId, type, role, worker.provider,
      worker.model, principal.username, timestamp, timestamp).run();
  await audit(env, principal.username, 'task-card.routing.updated', `${type}:${role}`, {
    provider: worker.provider, model: worker.model,
  });
  return json({ routing: { type, role, provider: worker.provider, model: worker.model, ready: true } }, 200, noStore);
}

async function deleteRoutingResponse(env, scope, principal, url) {
  const type = text(url.searchParams.get('type'), 40);
  const role = text(url.searchParams.get('role'), 32);
  if (!TYPE_IDS.has(type)) return badRequest('INVALID_TASK_CARD_TYPE', '路由的任务类型必须合法。');
  if (!ROLE_IDS.has(role)) {
    return badRequest('INVALID_TASK_CARD_ROLE', '路由的角色必须是 planner、developer、reviewer 之一。');
  }
  const result = await env.DB.prepare('DELETE FROM lifeos_task_worker_routing WHERE account_id = ? AND workspace_id = ? AND card_type = ? AND role = ?')
    .bind(scope.accountId, scope.workspaceId, type, role).run();
  const deleted = Number(result?.meta?.changes || 0) > 0;
  if (deleted) await audit(env, principal.username, 'task-card.routing.removed', `${type}:${role}`, {});
  return json({ type, role, deleted }, 200, noStore);
}

// Returns a Response for every handled request, or `null` for anything else so
// the caller keeps its existing not-found behaviour.
export async function handleTaskCardApi(request, env, url, principal, options = {}) {
  const basePath = typeof options.basePath === 'string' && options.basePath ? options.basePath : '/workbench';
  const prefix = `${basePath}${TASK_CARD_API_SUFFIX}`;
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;

  const scope = await resolveLifeOsScope(env, principal);
  if (!scope) return notFound();

  const method = String(request.method || 'GET').toUpperCase();
  const path = url.pathname.slice(prefix.length) || '/';
  const catalog = buildWorkerCatalog(env, options.agentHealth || null);

  if (path === '/catalog' && (method === 'GET' || method === 'HEAD')) {
    return json({
      catalog,
      types: TASK_CARD_TYPES.map(entry => ({ ...entry })),
      roles: TASK_CARD_ROLES.map(entry => ({ ...entry })),
      statuses: TASK_CARD_STATUSES.map(entry => ({ ...entry })),
      routing: (await listRoutingRows(env, scope)).map(entry => serializeRouting(entry, catalog)),
    }, 200, noStore);
  }

  if (path === '/routing') {
    if (method === 'GET' || method === 'HEAD') {
      return json({
        routing: (await listRoutingRows(env, scope)).map(entry => serializeRouting(entry, catalog)),
      }, 200, noStore);
    }
    // Writes require the *current* platform-admin policy, re-read on this
    // request from the freshly resolved principal.
    if (!isPlatformAdmin(principal)) return forbidden();
    if (method === 'PUT' || method === 'POST') return putRoutingResponse(env, scope, principal, request, catalog);
    if (method === 'DELETE') return deleteRoutingResponse(env, scope, principal, url);
    return null;
  }

  const cardMatch = path.match(/^\/tasks\/([A-Za-z0-9_-]{1,64})$/);
  if (cardMatch) {
    const taskId = cardMatch[1];
    if (method === 'GET' || method === 'HEAD') return getCardResponse(env, scope, taskId, catalog);
    if (method === 'PUT' || method === 'POST') {
      return putCardResponse(env, scope, principal, taskId, request, catalog);
    }
    if (method === 'DELETE') return deleteCardResponse(env, scope, principal, taskId);
    return null;
  }

  return null;
}

export {
  LIFEOS_WORKSPACE_SLUG,
  TASK_CARD_ROLES,
  TASK_CARD_STATUSES,
  TASK_CARD_TYPES,
  ROLE_IDS as TASK_CARD_ROLE_IDS,
  STATUS_IDS as TASK_CARD_STATUS_IDS,
  TYPE_IDS as TASK_CARD_TYPE_IDS,
  resolveLifeOsScope,
};
