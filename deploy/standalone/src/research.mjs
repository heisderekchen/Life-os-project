// First reviewable research-state-machine slice for the private Life OS
// workspace, plus a disabled-by-default Obsidian sync *interface*.
//
// Authoritative boundaries (enforced on every request):
//   * server.mjs resolves the principal fresh from the session cookie; this
//     module never trusts a cached identity and never trusts a caller-supplied
//     account/workspace identifier.
//   * The stable legacy owner principal (`isLegacyOwner`), a fresh grant for the
//     Life OS workspace (`workspacePageState`) and the exact stable workspace id
//     `ws_lifeos_legacy` are required through the *same* `resolveLifeOsScope`
//     used by the task-card slice. Anything else is reported as 404 so the
//     private surface never discloses its existence.
//   * Every session, round, evidence, plan and outbox read/write is filtered by
//     account_id + workspace_id + task_id, and the task id is re-validated
//     against personal_workbench_lifeos_tasks on every request.
//
// Hard product boundaries enforced here:
//   * `start` is only `draft -> waiting_executor`; a paused session can only be
//     turned back on through the explicit `resume` control.
//   * Rounds/evidence are never deleted or overwritten (no plan-delete endpoint
//     and no replan-erasure). Re-planning is rejected once history exists.
//   * The budget is a finite positive cap ($1, matched to the Agent Service
//     default); 0/negative is rejected and there is no "0 means unlimited".
//   * Source/action allowlists may only use the server-owned option catalogs.
//
// What this slice deliberately does NOT do:
//   * It never calls a model provider and never schedules background work. The
//     repository Agent Service only exposes single, manually approved
//     DeepSeek/OpenAI runs and there is no Neo integration or research
//     scheduler. An explicit start therefore persists `waiting_executor`
//     ("等待 Neo/研究执行器连接") and never reports `running`.
//   * It never accepts client-reported spend. With no real executor, cost is
//     always zero; the server-owned stored value is the only source.
//   * It never touches the filesystem or a vault. The Obsidian endpoint reports
//     disabled/unconfigured and only stages user-reviewed incremental artifact
//     metadata/body, the selected relative path and citations into a separate,
//     scoped outbox as `pending_sync`. An adapter contract is defined and tested
//     with an in-memory fake only; no vault root/subfolder is configured here.
import { json } from './app/response.mjs';
import { resolveLifeOsScope } from './task-cards.mjs';

export const RESEARCH_API_SUFFIX = '/api/research';

// Server-owned, immutable execution caps. No request and no model-produced
// field may widen the budget, the frequency, the source/action allowlists or the
// concurrent/subtask limits beyond these values; anything above is rejected.
export const RESEARCH_EXECUTION_CAPS = Object.freeze({
  maxRounds: 20,
  // First slice: exactly one concurrent subtask is allowed. Raising this is a
  // later, separately reviewed change.
  maxConcurrency: 1,
  maxSubtasks: 1,
  maxSources: 20,
  maxActions: 20,
  maxUnresolvedQuestions: 20,
  // Real finite cap matched to the existing Agent Service default budget of
  // $1 total. There is no "0 means unlimited": a missing budget uses the safe
  // default (= the cap) and a non-positive budget is rejected.
  maxCostLimitUsd: 1,
  defaultCostLimitUsd: 1,
  // Conservative lower bound: a research plan can never re-check more often
  // than once an hour in this first slice.
  minFrequencyMinutes: 60,
  maxFrequencyMinutes: 1440,
  maxBackoffMinutes: 1440,
  maxEvidencePerRound: 50,
  maxCitations: 20,
  maxGoalLength: 2000,
  maxTargetLength: 500,
  maxNextQuestionLength: 500,
  maxCheckpointChars: 4000,
  maxTitleLength: 200,
  maxRelativePathLength: 240,
  maxBlockChars: 8000,
  maxSummaryLength: 500,
});

export const RESEARCH_MODES = [
  { id: 'once', label: '单次' },
  { id: 'continuous', label: '持续' },
];

export const RESEARCH_STATUSES = [
  { id: 'draft', label: '草稿' },
  { id: 'waiting_executor', label: '等待执行器' },
  { id: 'paused', label: '已暂停' },
  { id: 'cancelled', label: '已取消' },
  { id: 'stopped', label: '已结束' },
];

export const EVIDENCE_CONFIDENCE = [
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
];

// Server-owned, immutable option catalogs. Source/action allowlists may only
// contain these ids; the request (and any future model output) cannot add,
// widen or rename an option. Every option is abstract and inert: there is no
// web fetch, no browser and no model action behind any of them here.
export const RESEARCH_SOURCE_OPTIONS = [
  { id: 'user_provided_reference', label: '用户提供的参考资料' },
  { id: 'selected_obsidian_reference', label: '已选择的 Obsidian 笔记引用' },
];

export const RESEARCH_ACTION_OPTIONS = [
  { id: 'deduplicate_evidence', label: '证据去重' },
  { id: 'draft_next_question', label: '起草下一个问题' },
  { id: 'stage_obsidian_artifact', label: '暂存 Obsidian 增量条目' },
];

const TERMINAL_STATUSES = new Set(['cancelled', 'stopped']);
const MODE_IDS = new Set(RESEARCH_MODES.map(entry => entry.id));
const STATUS_IDS = new Set(RESEARCH_STATUSES.map(entry => entry.id));
const CONFIDENCE_IDS = new Set(EVIDENCE_CONFIDENCE.map(entry => entry.id));

export const EXECUTOR_WAITING_MESSAGE = '等待 Neo/研究执行器连接';
const EXECUTOR_NOT_CONNECTED_REASON = 'neo_executor_not_connected';

// Obsidian sync is unavailable until an explicit filesystem/vault permission is
// granted in a later step. No vault root or subfolder is read from the
// environment here on purpose.
export const OBSIDIAN_DEFAULT_FOLDER = 'Life OS/Research';
export const OBSIDIAN_UNAVAILABLE = Object.freeze({
  enabled: false,
  configured: false,
  status: 'unavailable',
  reason: 'filesystem_permission_pending',
  message: 'Obsidian 同步未启用：等待 vault 路径与文件系统权限授权。当前只暂存待同步条目，不会写入任何文件。',
});

const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const notFound = () => json({ error: 'Not found' }, 404, noStore);
const badRequest = (code, message) => json({ error: message, code }, 400, noStore);
const conflict = (code, message) => json({ error: message, code }, 409, noStore);
const fail = (code, message) => ({ ok: false, code, message });

function bytes(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? '')));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Stable evidence dedupe key across identical source + content references.
export async function evidenceDedupeKey(entry) {
  const source = text(entry?.source, 200);
  const sourceRef = text(entry?.sourceRef, 400);
  const content = text(entry?.content ?? entry?.summary, 2000);
  if (!source || !content) return null;
  return sha256Hex(`${source}\n${sourceRef}\n${content}`);
}

function parseStringList(value, { code, label, max, itemMax }) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail(code, `${label}必须是数组。`);
  if (value.length > max) return fail(code, `${label}最多 ${max} 项。`);
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return fail(code, `${label}的每一项都必须是文本。`);
    const item = text(entry, itemMax);
    if (!item) return fail(code, `${label}不能包含空项。`);
    if (String(entry).length > itemMax) return fail(code, `${label}的单条内容超出长度上限 ${itemMax}。`);
    out.push(item);
  }
  return { ok: true, value: [...new Set(out)] };
}

// Source/action allowlists are restricted to the server-owned option catalog.
// Unknown ids (anything the caller or a future model invents) are rejected with
// a stable code and nothing is written.
function parseOptionList(value, { code, label, options, max }) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail(code, `${label}必须是数组。`);
  if (value.length > max) return fail(code, `${label}最多 ${max} 项。`);
  const allowed = new Set(options.map(entry => entry.id));
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return fail(code, `${label}的每一项都必须是文本。`);
    const id = entry.trim();
    if (!allowed.has(id)) return fail('UNKNOWN_OPTION', `${label}包含服务端未提供的取值，只能选择服务端选项。`);
    out.push(id);
  }
  return { ok: true, value: [...new Set(out)] };
}

function parseBoundedNumber(value, { code, label, min, max, integer = true }) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fail(code, `${label}必须是数字。`);
  if (integer && !Number.isInteger(number)) return fail(code, `${label}必须是整数。`);
  if (number < min) return fail(code, `${label}不能小于 ${min}。`);
  if (number > max) return fail('EXCEEDS_SERVER_CAP', `${label}不能超过服务端上限 ${max}。`);
  return { ok: true, value: number };
}

function parseCheckpoint(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_CHECKPOINT', '检查点必须是对象。');
  const serialized = JSON.stringify(value);
  if (serialized.length > RESEARCH_EXECUTION_CAPS.maxCheckpointChars) {
    return fail('EXCEEDS_SERVER_CAP', `检查点不能超过服务端上限 ${RESEARCH_EXECUTION_CAPS.maxCheckpointChars} 字符。`);
  }
  return { ok: true, value };
}

// Validates one plan/session write against the immutable caps. Returns a stable
// failure code for anything the caps forbid; nothing is written on failure.
function validateSessionBody(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const mode = text(body.mode, 20) || 'once';
  if (!MODE_IDS.has(mode)) return fail('INVALID_MODE', '研究模式必须是 once 或 continuous。');
  const goal = text(body.goal, RESEARCH_EXECUTION_CAPS.maxGoalLength);
  if (!goal) return fail('INVALID_GOAL', '研究目标不能为空。');
  if (String(body.goal ?? '').trim().length > RESEARCH_EXECUTION_CAPS.maxGoalLength) {
    return fail('EXCEEDS_SERVER_CAP', `研究目标不能超过 ${RESEARCH_EXECUTION_CAPS.maxGoalLength} 字符。`);
  }
  const target = text(body.target, RESEARCH_EXECUTION_CAPS.maxTargetLength);
  if (String(body.target ?? '').trim().length > RESEARCH_EXECUTION_CAPS.maxTargetLength) {
    return fail('EXCEEDS_SERVER_CAP', `研究目标站点不能超过 ${RESEARCH_EXECUTION_CAPS.maxTargetLength} 字符。`);
  }
  const sources = parseOptionList(body.sourceAllowlist, {
    code: 'INVALID_SOURCE_ALLOWLIST', label: '来源白名单', options: RESEARCH_SOURCE_OPTIONS, max: RESEARCH_EXECUTION_CAPS.maxSources,
  });
  if (!sources.ok) return sources;
  const actions = parseOptionList(body.actionAllowlist, {
    code: 'INVALID_ACTION_ALLOWLIST', label: '动作白名单', options: RESEARCH_ACTION_OPTIONS, max: RESEARCH_EXECUTION_CAPS.maxActions,
  });
  if (!actions.ok) return actions;
  const questions = parseStringList(body.unresolvedQuestions, {
    code: 'INVALID_UNRESOLVED_QUESTIONS', label: '未解决问题',
    max: RESEARCH_EXECUTION_CAPS.maxUnresolvedQuestions, itemMax: 300,
  });
  if (!questions.ok) return questions;
  const nextQuestion = text(body.nextQuestion, RESEARCH_EXECUTION_CAPS.maxNextQuestionLength);
  if (String(body.nextQuestion ?? '').trim().length > RESEARCH_EXECUTION_CAPS.maxNextQuestionLength) {
    return fail('EXCEEDS_SERVER_CAP', `下一个问题不能超过 ${RESEARCH_EXECUTION_CAPS.maxNextQuestionLength} 字符。`);
  }
  const checkpoint = parseCheckpoint(body.checkpoint);
  if (!checkpoint.ok) return checkpoint;
  // A finite, positive budget is required. A missing value falls back to the
  // server-owned safe default (equal to the cap); zero/negative is rejected so
  // "0" can never be read as "unlimited".
  const rawCostLimit = body.costLimitUsd;
  let costLimitUsd = RESEARCH_EXECUTION_CAPS.defaultCostLimitUsd;
  if (rawCostLimit !== undefined && rawCostLimit !== null && rawCostLimit !== '') {
    const costLimit = parseBoundedNumber(rawCostLimit, {
      code: 'INVALID_COST_LIMIT', label: '成本上限', min: 0, max: RESEARCH_EXECUTION_CAPS.maxCostLimitUsd, integer: false,
    });
    if (!costLimit.ok) return costLimit;
    if (!(costLimit.value > 0)) return fail('INVALID_COST_LIMIT', '成本上限必须是大于 0 的有限值；不支持 0 代表无限。');
    costLimitUsd = costLimit.value;
  }
  const frequency = parseBoundedNumber(body.frequencyMinutes, {
    code: 'INVALID_FREQUENCY', label: '检查频率', min: RESEARCH_EXECUTION_CAPS.minFrequencyMinutes,
    max: RESEARCH_EXECUTION_CAPS.maxFrequencyMinutes,
  });
  if (!frequency.ok) return frequency;
  const subtaskCap = parseBoundedNumber(body.subtaskCap, {
    code: 'INVALID_SUBTASK_CAP', label: '子任务上限', min: 0, max: RESEARCH_EXECUTION_CAPS.maxSubtasks,
  });
  if (!subtaskCap.ok) return subtaskCap;
  const maxConcurrency = parseBoundedNumber(body.maxConcurrency, {
    code: 'INVALID_CONCURRENCY', label: '并发上限', min: 1, max: RESEARCH_EXECUTION_CAPS.maxConcurrency,
  });
  if (!maxConcurrency.ok) return maxConcurrency;
  const maxRounds = parseBoundedNumber(body.maxRounds, {
    code: 'INVALID_MAX_ROUNDS', label: '最大轮次', min: 1, max: RESEARCH_EXECUTION_CAPS.maxRounds,
  });
  if (!maxRounds.ok) return maxRounds;
  return {
    ok: true,
    value: {
      mode,
      goal,
      target,
      sourceAllowlist: sources.value,
      actionAllowlist: actions.value,
      unresolvedQuestions: questions.value,
      nextQuestion,
      checkpoint: checkpoint.value,
      costLimitUsd,
      frequencyMinutes: frequency.value ?? 60,
      subtaskCap: subtaskCap.value ?? 1,
      maxConcurrency: maxConcurrency.value ?? 1,
      maxRounds: maxRounds.value ?? 1,
    },
  };
}

function parseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(typeof raw === 'string' && raw ? raw : '');
    return parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function executorPayload() {
  return { connected: false, status: 'not_connected', reason: EXECUTOR_NOT_CONNECTED_REASON, message: EXECUTOR_WAITING_MESSAGE };
}

function obsidianPayload(pendingCount = 0) {
  return { ...OBSIDIAN_UNAVAILABLE, pendingCount };
}

function serializeSession(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    mode: row.mode,
    goal: row.goal,
    target: row.target || '',
    sourceAllowlist: parseJson(row.source_allowlist_json, []),
    actionAllowlist: parseJson(row.action_allowlist_json, []),
    unresolvedQuestions: parseJson(row.unresolved_questions_json, []),
    nextQuestion: row.next_question || '',
    checkpoint: parseJson(row.checkpoint_json, {}),
    costLimitUsd: Number(row.cost_limit_usd || 0),
    costSpentUsd: Number(row.cost_spent_usd || 0),
    frequencyMinutes: Number(row.frequency_minutes || 0),
    nextCheckAt: row.next_check_at || null,
    subtaskCap: Number(row.subtask_cap || 0),
    maxConcurrency: Number(row.max_concurrency || 0),
    maxRounds: Number(row.max_rounds || 0),
    roundCount: Number(row.round_count || 0),
    noNewEvidenceStreak: Number(row.no_new_evidence_streak || 0),
    status: row.status,
    terminalReason: row.terminal_reason || null,
    executor: executorPayload(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRound(row) {
  return {
    roundIndex: Number(row.round_index),
    status: row.status,
    newEvidenceCount: Number(row.new_evidence_count || 0),
    duplicateEvidenceCount: Number(row.duplicate_evidence_count || 0),
    noNewEvidenceStreak: Number(row.no_new_evidence_streak || 0),
    nextCheckAt: row.next_check_at || null,
    terminalReason: row.terminal_reason || null,
    summary: row.summary || '',
    createdAt: row.created_at,
  };
}

function serializeEvidence(row) {
  return {
    dedupeKey: row.dedupe_key,
    source: row.source,
    sourceRef: row.source_ref || '',
    summary: row.summary || '',
    observedDate: row.observed_date || null,
    confidence: row.confidence,
    roundIndex: row.round_index === null ? null : Number(row.round_index),
    createdAt: row.created_at,
  };
}

function serializeOutbox(row) {
  return {
    id: row.id,
    relativePath: row.relative_path,
    title: row.title,
    blockHash: row.block_hash,
    expectedBaseHash: row.expected_base_hash || null,
    observedBaseHash: row.observed_base_hash || null,
    citations: parseJson(row.citations_json, []),
    status: row.status,
    conflictReason: row.conflict_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function taskExists(env, taskId) {
  try {
    const row = await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id = ?').bind(taskId).first();
    return Boolean(row);
  } catch {
    return false;
  }
}

async function audit(env, actor, action, entityId, detail) {
  try {
    await env.DB.prepare('INSERT INTO personal_workbench_lifeos_audit_log (action, entity_id, detail_json, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(action, entityId, JSON.stringify(detail ?? {}), actor, new Date().toISOString()).run();
  } catch {
    // Append-only auditing must never break the request path.
  }
}

async function loadSessionRow(env, scope, taskId) {
  return env.DB.prepare('SELECT * FROM lifeos_research_sessions WHERE account_id = ? AND workspace_id = ? AND task_id = ?')
    .bind(scope.accountId, scope.workspaceId, taskId).first();
}

async function listRounds(env, scope, taskId) {
  const result = await env.DB.prepare('SELECT * FROM lifeos_research_rounds WHERE account_id = ? AND workspace_id = ? AND task_id = ? ORDER BY round_index')
    .bind(scope.accountId, scope.workspaceId, taskId).all();
  return (result.results || []).map(serializeRound);
}

async function listEvidence(env, scope, taskId) {
  const result = await env.DB.prepare('SELECT * FROM lifeos_research_evidence WHERE account_id = ? AND workspace_id = ? AND task_id = ? ORDER BY created_at, dedupe_key')
    .bind(scope.accountId, scope.workspaceId, taskId).all();
  return (result.results || []).map(serializeEvidence);
}

// Outbox reads are always task-scoped: there is no workspace-wide listing.
async function listOutbox(env, scope, taskId, status = 'pending_sync') {
  const result = await env.DB.prepare('SELECT * FROM lifeos_obsidian_sync_outbox WHERE account_id = ? AND workspace_id = ? AND task_id = ? AND status = ? ORDER BY created_at')
    .bind(scope.accountId, scope.workspaceId, taskId, status).all();
  return (result.results || []).map(serializeOutbox);
}

async function countPendingOutbox(env, scope) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM lifeos_obsidian_sync_outbox WHERE account_id = ? AND workspace_id = ? AND status = 'pending_sync'")
    .bind(scope.accountId, scope.workspaceId).first();
  return Number(row?.n || 0);
}

// ---- Deterministic round engine (pure) --------------------------------------
// Dedupe, exponential backoff and every terminal transition live here. It is a
// pure function of the session row, the reported candidate evidence and an
// explicit `now`, so every stop condition is deterministic and testable. It
// never marks a session `running`; a completed round leaves the session in
// `waiting_executor` (or a terminal status). Client-reported spend is ignored:
// only the server-owned `cost_spent_usd` is read.
export async function applyResearchRound(session, evidence = [], options = {}) {
  const caps = RESEARCH_EXECUTION_CAPS;
  const now = typeof options.now === 'string' && options.now ? options.now : new Date().toISOString();
  const seen = new Set(Array.isArray(options.existingDedupeKeys) ? options.existingDedupeKeys : []);
  const fresh = [];
  const duplicates = [];
  for (const entry of Array.isArray(evidence) ? evidence.slice(0, caps.maxEvidencePerRound) : []) {
    if (!entry || typeof entry !== 'object') continue;
    const dedupeKey = typeof entry.dedupeKey === 'string' && entry.dedupeKey ? entry.dedupeKey : await evidenceDedupeKey(entry);
    if (!dedupeKey) continue;
    if (seen.has(dedupeKey)) { duplicates.push(dedupeKey); continue; }
    seen.add(dedupeKey);
    const confidence = CONFIDENCE_IDS.has(entry.confidence) ? entry.confidence : 'medium';
    fresh.push({
      dedupeKey,
      source: text(entry.source, 200),
      sourceRef: text(entry.sourceRef, 400),
      summary: text(entry.summary ?? entry.content, caps.maxSummaryLength),
      observedDate: text(entry.observedDate, 40) || null,
      confidence,
    });
  }
  const roundIndex = Number(session.round_count || 0) + 1;
  const newEvidenceCount = fresh.length;
  const noNewEvidenceStreak = newEvidenceCount === 0 ? Number(session.no_new_evidence_streak || 0) + 1 : 0;
  const baseFrequency = Math.max(caps.minFrequencyMinutes, Number(session.frequency_minutes || caps.minFrequencyMinutes));
  const waitMinutes = newEvidenceCount === 0
    ? Math.min(baseFrequency * (2 ** Math.min(noNewEvidenceStreak, 16)), caps.maxBackoffMinutes)
    : baseFrequency;
  let nextCheckAt = new Date(new Date(now).getTime() + waitMinutes * 60000).toISOString();
  const costSpentUsd = Number(session.cost_spent_usd || 0);
  const costLimitUsd = Number(session.cost_limit_usd || 0);
  let status = 'waiting_executor';
  let terminalReason = null;
  if (options.goalAchieved === true) { status = 'stopped'; terminalReason = 'goal_achieved'; }
  // The budget is always a finite positive cap (zero/negative is rejected at
  // intake), so reaching it always stops the session — never "unlimited".
  else if (costSpentUsd >= costLimitUsd) { status = 'stopped'; terminalReason = 'budget_exhausted'; }
  else if (roundIndex >= Number(session.max_rounds || 1)) { status = 'stopped'; terminalReason = 'max_rounds'; }
  else if (session.mode === 'once') { status = 'stopped'; terminalReason = 'once_mode_completed'; }
  if (status !== 'waiting_executor') nextCheckAt = null;
  return {
    roundIndex,
    newEvidence: fresh,
    duplicateDedupeKeys: duplicates,
    newEvidenceCount,
    duplicateEvidenceCount: duplicates.length,
    noNewEvidenceStreak,
    nextCheckAt,
    roundCount: roundIndex,
    status,
    terminalReason,
    costSpentUsd,
    now,
  };
}

// ---- Obsidian adapter contract (fake / in-memory only) ----------------------
// A real adapter must validate an explicitly selected folder, append only a
// bounded generated block, compare the expected base hash and return a conflict
// without overwriting user edits. This fake keeps the identical contract so the
// behaviour is testable without any vault or filesystem access.
export function normalizeRelativePath(relativePath, folder = OBSIDIAN_DEFAULT_FOLDER) {
  const raw = String(relativePath ?? '');
  if (!raw || raw.length > RESEARCH_EXECUTION_CAPS.maxRelativePathLength) return { ok: false, code: 'INVALID_RELATIVE_PATH' };
  if (raw.startsWith('/') || raw.includes('\\') || raw.includes('\0')) return { ok: false, code: 'INVALID_RELATIVE_PATH' };
  if (raw.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) return { ok: false, code: 'INVALID_RELATIVE_PATH' };
  if (!raw.toLowerCase().endsWith('.md')) return { ok: false, code: 'INVALID_RELATIVE_PATH' };
  const root = text(folder, 120) || OBSIDIAN_DEFAULT_FOLDER;
  if (!raw.startsWith(`${root}/`) || raw.length <= root.length + 1) return { ok: false, code: 'OUTSIDE_SELECTED_FOLDER' };
  return { ok: true, value: raw, folder: root };
}

export function buildObsidianBlock({ title, body, citations = [] }) {
  const lines = [`## ${text(title, RESEARCH_EXECUTION_CAPS.maxTitleLength)}`];
  const normalizedBody = String(body ?? '').trim();
  if (normalizedBody) lines.push('', normalizedBody);
  const normalizedCitations = (Array.isArray(citations) ? citations : []).slice(0, RESEARCH_EXECUTION_CAPS.maxCitations)
    .map(entry => text(entry, 300)).filter(Boolean);
  if (normalizedCitations.length) lines.push('', ...normalizedCitations.map(entry => `- ${entry}`));
  return lines.join('\n');
}

export function createInMemoryObsidianAdapter({ files = {}, folder = OBSIDIAN_DEFAULT_FOLDER } = {}) {
  const store = new Map(Object.entries(files));
  const hashOf = value => sha256Hex(value);
  return {
    kind: 'in-memory-fixture',
    folder,
    list: () => [...store.keys()].sort(),
    read: relativePath => (store.has(relativePath) ? store.get(relativePath) : null),
    async readVersion(relativePath) {
      if (!store.has(relativePath)) return { exists: false, hash: null, content: '' };
      const content = store.get(relativePath);
      return { exists: true, hash: await hashOf(content), content };
    },
    async appendBlock({ relativePath, block, expectedBaseHash }) {
      const normalized = normalizeRelativePath(relativePath, folder);
      if (!normalized.ok) return { status: 'rejected', reason: normalized.code };
      if (typeof block !== 'string' || !block.trim()) return { status: 'rejected', reason: 'EMPTY_BLOCK' };
      if (block.length > RESEARCH_EXECUTION_CAPS.maxBlockChars) return { status: 'rejected', reason: 'BLOCK_TOO_LARGE' };
      const current = store.has(relativePath) ? store.get(relativePath) : '';
      const currentHash = current ? await hashOf(current) : null;
      const expected = typeof expectedBaseHash === 'string' && expectedBaseHash ? expectedBaseHash : null;
      // Conflict detection: never overwrite a user edit. A mismatch is returned
      // as a conflict and the stored content is left untouched.
      if (expected !== currentHash) {
        return { status: 'conflict', reason: 'base_hash_mismatch', expectedBaseHash: expected, currentHash };
      }
      const next = current ? `${current.replace(/\s+$/, '')}\n\n${block}\n` : `${block}\n`;
      store.set(relativePath, next);
      return { status: 'applied', newHash: await hashOf(next), bytes: bytes(next) };
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

export function buildResearchCatalog(env = {}) {
  return {
    caps: { ...RESEARCH_EXECUTION_CAPS },
    modes: RESEARCH_MODES.map(entry => ({ ...entry })),
    statuses: RESEARCH_STATUSES.map(entry => ({ ...entry })),
    confidence: EVIDENCE_CONFIDENCE.map(entry => ({ ...entry })),
    sources: RESEARCH_SOURCE_OPTIONS.map(entry => ({ ...entry })),
    actions: RESEARCH_ACTION_OPTIONS.map(entry => ({ ...entry })),
    executor: executorPayload(),
    obsidian: obsidianPayload(),
  };
}

// ---- Request handlers -------------------------------------------------------
async function getTaskResponse(env, scope, taskId) {
  if (!(await taskExists(env, taskId))) return notFound();
  const row = await loadSessionRow(env, scope, taskId);
  const [rounds, evidence, outbox] = await Promise.all([
    row ? listRounds(env, scope, taskId) : Promise.resolve([]),
    row ? listEvidence(env, scope, taskId) : Promise.resolve([]),
    listOutbox(env, scope, taskId),
  ]);
  return json({
    taskId,
    session: row ? serializeSession(row) : null,
    rounds,
    evidence,
    outbox,
    executor: executorPayload(),
    obsidian: obsidianPayload(outbox.filter(entry => entry.status === 'pending_sync').length),
  }, 200, noStore);
}

async function getObsidianStatusResponse(env, scope, taskId) {
  if (!(await taskExists(env, taskId))) return notFound();
  const outbox = await listOutbox(env, scope, taskId);
  return json({ taskId, obsidian: obsidianPayload(outbox.length), outbox }, 200, noStore);
}

async function putSessionResponse(env, scope, principal, taskId, request) {
  if (!(await taskExists(env, taskId))) return notFound();
  const validated = validateSessionBody(await readJsonBody(request));
  if (!validated.ok) return badRequest(validated.code, validated.message);
  const existing = await loadSessionRow(env, scope, taskId);
  // Plan/create is a draft and never runs. Re-planning is only allowed on an
  // idle plan that has no history yet: an active session must be paused and
  // cancelled first, and any session that already produced rounds or evidence
  // (including stopped/cancelled history) is never overwritten or erased.
  if (existing && ['waiting_executor', 'paused'].includes(existing.status)) {
    return conflict('SESSION_ACTIVE', '研究已在进行中，请先暂停并取消，再重新起草计划。');
  }
  if (existing) {
    const history = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM lifeos_research_rounds WHERE account_id = ? AND workspace_id = ? AND task_id = ?)
            + (SELECT COUNT(*) FROM lifeos_research_evidence WHERE account_id = ? AND workspace_id = ? AND task_id = ?) AS n`,
    ).bind(scope.accountId, scope.workspaceId, taskId, scope.accountId, scope.workspaceId, taskId).first();
    if (Number(history?.n || 0) > 0) {
      return conflict('SESSION_HAS_HISTORY', '该任务已有轮次或证据历史，不能覆盖或删除；新的研究计划请使用新的任务。');
    }
  }
  const value = validated.value;
  const timestamp = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO lifeos_research_sessions (id, account_id, workspace_id, task_id, mode, goal, target,
      source_allowlist_json, action_allowlist_json, unresolved_questions_json, next_question, checkpoint_json,
      cost_limit_usd, cost_spent_usd, frequency_minutes, next_check_at, subtask_cap, max_concurrency, max_rounds,
      round_count, no_new_evidence_streak, status, terminal_reason, executor_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, 0, 0, 'draft', NULL, 'not_connected', ?, ?)
      ON CONFLICT(account_id, workspace_id, task_id) DO UPDATE SET mode = excluded.mode, goal = excluded.goal,
      target = excluded.target, source_allowlist_json = excluded.source_allowlist_json,
      action_allowlist_json = excluded.action_allowlist_json, unresolved_questions_json = excluded.unresolved_questions_json,
      next_question = excluded.next_question, checkpoint_json = excluded.checkpoint_json, cost_limit_usd = excluded.cost_limit_usd,
      cost_spent_usd = 0, frequency_minutes = excluded.frequency_minutes, next_check_at = NULL,
      subtask_cap = excluded.subtask_cap, max_concurrency = excluded.max_concurrency, max_rounds = excluded.max_rounds,
      round_count = 0, no_new_evidence_streak = 0, status = 'draft', terminal_reason = NULL,
      executor_status = 'not_connected', updated_at = excluded.updated_at`)
    .bind(existing?.id || crypto.randomUUID(), scope.accountId, scope.workspaceId, taskId, value.mode, value.goal,
      value.target, JSON.stringify(value.sourceAllowlist), JSON.stringify(value.actionAllowlist),
      JSON.stringify(value.unresolvedQuestions), value.nextQuestion, JSON.stringify(value.checkpoint),
      value.costLimitUsd, value.frequencyMinutes, value.subtaskCap, value.maxConcurrency, value.maxRounds,
      existing?.created_at || timestamp, timestamp).run();
  await audit(env, principal.username, existing ? 'research.plan.updated' : 'research.plan.created', taskId, {
    mode: value.mode, status: 'draft',
  });
  const row = await loadSessionRow(env, scope, taskId);
  return json({ session: serializeSession(row), executor: executorPayload() }, existing ? 200 : 201, noStore);
}

async function transitionResponse(env, scope, principal, taskId, action) {
  if (!(await taskExists(env, taskId))) return notFound();
  const row = await loadSessionRow(env, scope, taskId);
  if (!row) return notFound();
  const status = row.status;
  const timestamp = new Date().toISOString();
  let next = null;
  if (action === 'start') {
    // Start is only a draft -> waiting_executor transition. A paused (or any
    // other) session can never be turned back on here; resuming a paused
    // session is an explicit, separate resume control.
    if (status !== 'draft') {
      return conflict('INVALID_STATE', '只有草稿状态可以开始研究；暂停后的会话请使用「继续」。');
    }
    next = 'waiting_executor';
  } else if (action === 'pause') {
    if (status !== 'waiting_executor') return conflict('INVALID_STATE', '只有等待执行器的研究会话可以暂停。');
    next = 'paused';
  } else if (action === 'resume') {
    if (status !== 'paused') return conflict('INVALID_STATE', '只有已暂停的研究会话可以继续。');
    next = 'waiting_executor';
  } else if (action === 'cancel') {
    if (TERMINAL_STATUSES.has(status)) next = status;
    else next = 'cancelled';
  }
  if (next === null) return notFound();
  if (next !== status) {
    await env.DB.prepare('UPDATE lifeos_research_sessions SET status = ?, terminal_reason = ?, executor_status = ?, next_check_at = ?, updated_at = ? WHERE account_id = ? AND workspace_id = ? AND task_id = ?')
      .bind(next, next === 'cancelled' ? 'cancelled' : null, 'not_connected', next === 'waiting_executor' ? row.next_check_at : null,
        timestamp, scope.accountId, scope.workspaceId, taskId).run();
    await audit(env, principal.username, `research.session.${action}`, taskId, { from: status, to: next });
  }
  const updated = await loadSessionRow(env, scope, taskId);
  return json({ session: serializeSession(updated), executor: executorPayload() }, 200, noStore);
}

// Executor-reported round intake. When no executor is connected (production:
// always) this is closed with 409; it never fabricates a heartbeat or a running
// state. When an authorized executor is injected (tests only), it records one
// completed round and applies the deterministic engine above.
async function recordRoundResponse(env, scope, principal, taskId, request, options) {
  if (!(await taskExists(env, taskId))) return notFound();
  const row = await loadSessionRow(env, scope, taskId);
  if (!row) return notFound();
  if (options.executorConnected !== true) {
    return conflict('EXECUTOR_NOT_CONNECTED', EXECUTOR_WAITING_MESSAGE);
  }
  if (row.status !== 'waiting_executor') {
    return conflict('INVALID_STATE', '只有等待执行器的研究会话可以记录轮次。');
  }
  const body = await readJsonBody(request);
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  if (evidence.length > RESEARCH_EXECUTION_CAPS.maxEvidencePerRound) {
    return badRequest('EXCEEDS_SERVER_CAP', `单轮证据不能超过服务端上限 ${RESEARCH_EXECUTION_CAPS.maxEvidencePerRound}。`);
  }
  const existing = await env.DB.prepare('SELECT dedupe_key FROM lifeos_research_evidence WHERE account_id = ? AND workspace_id = ? AND task_id = ?')
    .bind(scope.accountId, scope.workspaceId, taskId).all();
  const result = await applyResearchRound(row, evidence, {
    existingDedupeKeys: (existing.results || []).map(entry => entry.dedupe_key),
    goalAchieved: body.goalAchieved === true,
    now: new Date().toISOString(),
  });
  const timestamp = result.now;
  await env.DB.prepare('INSERT INTO lifeos_research_rounds (id, account_id, workspace_id, task_id, session_id, round_index, status, new_evidence_count, duplicate_evidence_count, no_new_evidence_streak, next_check_at, terminal_reason, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), scope.accountId, scope.workspaceId, taskId, row.id, result.roundIndex,
      result.status, result.newEvidenceCount, result.duplicateEvidenceCount, result.noNewEvidenceStreak,
      result.nextCheckAt, result.terminalReason, text(body.summary, RESEARCH_EXECUTION_CAPS.maxSummaryLength), timestamp).run();
  for (const entry of result.newEvidence) {
    await env.DB.prepare('INSERT OR IGNORE INTO lifeos_research_evidence (id, account_id, workspace_id, task_id, session_id, round_index, dedupe_key, source, source_ref, summary, observed_date, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), scope.accountId, scope.workspaceId, taskId, row.id, result.roundIndex,
        entry.dedupeKey, entry.source, entry.sourceRef, entry.summary, entry.observedDate, entry.confidence, timestamp).run();
  }
  await env.DB.prepare('UPDATE lifeos_research_sessions SET round_count = ?, no_new_evidence_streak = ?, next_check_at = ?, status = ?, terminal_reason = ?, updated_at = ? WHERE account_id = ? AND workspace_id = ? AND task_id = ?')
    .bind(result.roundCount, result.noNewEvidenceStreak, result.nextCheckAt, result.status, result.terminalReason,
      timestamp, scope.accountId, scope.workspaceId, taskId).run();
  await audit(env, principal.username, 'research.round.recorded', taskId, {
    roundIndex: result.roundIndex, newEvidence: result.newEvidenceCount, terminalReason: result.terminalReason,
  });
  const updated = await loadSessionRow(env, scope, taskId);
  return json({
    session: serializeSession(updated),
    round: {
      roundIndex: result.roundIndex,
      newEvidenceCount: result.newEvidenceCount,
      duplicateEvidenceCount: result.duplicateEvidenceCount,
      noNewEvidenceStreak: result.noNewEvidenceStreak,
      nextCheckAt: result.nextCheckAt,
      terminalReason: result.terminalReason,
      status: result.status,
    },
    executor: executorPayload(),
  }, 201, noStore);
}

// Stages a user-reviewed incremental artifact (metadata/body + selected relative
// path + citations) into the scoped outbox as `pending_sync`. It never writes to
// any file; staging is the only action available while Obsidian is unavailable.
async function stageObsidianResponse(env, scope, principal, taskId, request) {
  if (!(await taskExists(env, taskId))) return notFound();
  const body = await readJsonBody(request);
  const normalized = normalizeRelativePath(body.relativePath, OBSIDIAN_DEFAULT_FOLDER);
  if (!normalized.ok) return badRequest(normalized.code, '必须选择已授权文件夹内的 .md 相对路径。');
  const title = text(body.title, RESEARCH_EXECUTION_CAPS.maxTitleLength);
  if (!title) return badRequest('INVALID_TITLE', '标题不能为空。');
  const artifactBody = String(body.body ?? '').trim();
  if (!artifactBody) return badRequest('INVALID_BODY', '正文不能为空。');
  const citations = await parseStringList(body.citations, {
    code: 'INVALID_CITATIONS', label: '引用', max: RESEARCH_EXECUTION_CAPS.maxCitations, itemMax: 300,
  });
  if (!citations.ok) return badRequest(citations.code, citations.message);
  const block = buildObsidianBlock({ title, body: artifactBody, citations: citations.value });
  if (block.length > RESEARCH_EXECUTION_CAPS.maxBlockChars) {
    return badRequest('EXCEEDS_SERVER_CAP', `生成的增量块不能超过服务端上限 ${RESEARCH_EXECUTION_CAPS.maxBlockChars} 字符。`);
  }
  const relativePath = normalized.value;
  const blockHash = await sha256Hex(`${relativePath}\n${block}`);
  const expectedBaseHash = text(body.expectedBaseHash, 200) || null;
  const existing = await env.DB.prepare('SELECT * FROM lifeos_obsidian_sync_outbox WHERE account_id = ? AND workspace_id = ? AND task_id = ? AND relative_path = ? AND block_hash = ?')
    .bind(scope.accountId, scope.workspaceId, taskId, relativePath, blockHash).first();
  if (existing) {
    return json({ staged: serializeOutbox(existing), obsidian: obsidianPayload(await countPendingOutbox(env, scope)) }, 200, noStore);
  }
  const session = await loadSessionRow(env, scope, taskId);
  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO lifeos_obsidian_sync_outbox (id, account_id, workspace_id, task_id, session_id, relative_path, expected_base_hash, observed_base_hash, title, body, citations_json, block_hash, status, conflict_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?)')
    .bind(id, scope.accountId, scope.workspaceId, taskId, session?.id || null, relativePath, expectedBaseHash,
      title, block, JSON.stringify(citations.value), blockHash, 'pending_sync', timestamp, timestamp).run();
  await audit(env, principal.username, 'research.obsidian.staged', taskId, { relativePath, blockHash });
  const row = await env.DB.prepare('SELECT * FROM lifeos_obsidian_sync_outbox WHERE id = ?').bind(id).first();
  return json({
    staged: serializeOutbox(row),
    obsidian: obsidianPayload(await countPendingOutbox(env, scope)),
  }, 201, noStore);
}

// Returns a Response for every handled request, or `null` for anything else so
// the caller keeps its existing not-found behaviour.
export async function handleResearchApi(request, env, url, principal, options = {}) {
  const basePath = typeof options.basePath === 'string' && options.basePath ? options.basePath : '/workbench';
  const prefix = `${basePath}${RESEARCH_API_SUFFIX}`;
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;

  const scope = await resolveLifeOsScope(env, principal);
  if (!scope) return notFound();

  const method = String(request.method || 'GET').toUpperCase();
  const path = url.pathname.slice(prefix.length) || '/';

  if (path === '/catalog' && (method === 'GET' || method === 'HEAD')) {
    return json(buildResearchCatalog(env), 200, noStore);
  }

  const taskMatch = path.match(/^\/tasks\/([A-Za-z0-9_-]{1,64})((?:\/[a-z_]+)*)$/);
  if (!taskMatch) return null;
  const taskId = taskMatch[1];
  const sub = taskMatch[2] || '';

  if (sub === '') {
    if (method === 'GET' || method === 'HEAD') return getTaskResponse(env, scope, taskId);
    if (method === 'PUT' || method === 'POST') return putSessionResponse(env, scope, principal, taskId, request);
    return null;
  }
  // Task-scoped Obsidian status/outbox: there is no workspace-wide listing.
  if (sub === '/obsidian/status') {
    if (method !== 'GET' && method !== 'HEAD') return null;
    return getObsidianStatusResponse(env, scope, taskId);
  }
  if (method !== 'POST') return null;
  if (sub === '/start' || sub === '/pause' || sub === '/resume' || sub === '/cancel') {
    return transitionResponse(env, scope, principal, taskId, sub.slice(1));
  }
  if (sub === '/rounds') return recordRoundResponse(env, scope, principal, taskId, request, options);
  if (sub === '/obsidian') return stageObsidianResponse(env, scope, principal, taskId, request);
  return null;
}
