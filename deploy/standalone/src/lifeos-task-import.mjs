import { createHash, randomUUID } from 'node:crypto';

const IMPORTABLE_STATUSES = new Set(['todo', 'in-progress', 'done', 'cancelled']);
const IMPORTABLE_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const ITEM_KEYS = new Set(['sourceId', 'title', 'description', 'status', 'sourceStatus', 'priority', 'dueDate', 'startDate', 'estimatedMinutes', 'sourceUpdatedAt']);
const PAYLOAD_KEYS = new Set(['sourceKey', 'tasks', 'confirm']);

function importError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizedTitle(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function isoDate(value, field, sourceId) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw importError(`${field} must be an ISO date or timestamp for source task ${sourceId}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw importError(`${field} is invalid for source task ${sourceId}`);
  return date.toISOString();
}

export function normalizeTaskImportPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw importError('A JSON object is required');
  for (const key of Object.keys(input)) if (!PAYLOAD_KEYS.has(key)) throw importError(`Unsupported import field: ${key}`);
  const sourceKey = typeof input.sourceKey === 'string' ? input.sourceKey.trim() : '';
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(sourceKey)) throw importError('sourceKey must be a stable lowercase identifier');
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 500) {
    throw importError('tasks must contain between 1 and 500 records');
  }

  const seen = new Set();
  const tasks = input.tasks.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw importError(`Task ${index + 1} must be an object`);
    for (const key of Object.keys(item)) if (!ITEM_KEYS.has(key)) throw importError(`Unsupported field on task ${index + 1}: ${key}`);
    const sourceId = typeof item.sourceId === 'string' ? item.sourceId.trim() : '';
    if (!sourceId || sourceId.length > 200) throw importError(`Task ${index + 1} needs a stable sourceId (1–200 characters)`);
    if (seen.has(sourceId)) throw importError(`Duplicate sourceId in import: ${sourceId}`);
    seen.add(sourceId);

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title || title.length > 500) throw importError(`Task ${sourceId} needs a title (1–500 characters)`);
    const description = item.description === undefined || item.description === null || item.description === ''
      ? null
      : typeof item.description === 'string' && item.description.length <= 4000
        ? item.description : (() => { throw importError(`description is invalid for source task ${sourceId}`); })();
    const status = item.status === undefined || item.status === '' ? 'todo' : item.status;
    if (typeof status !== 'string' || !IMPORTABLE_STATUSES.has(status)) throw importError(`status is invalid for source task ${sourceId}`);
    const sourceStatus = item.sourceStatus === undefined || item.sourceStatus === null
      ? null : typeof item.sourceStatus === 'string' && item.sourceStatus.length <= 120
        ? item.sourceStatus : (() => { throw importError(`sourceStatus is invalid for source task ${sourceId}`); })();
    const priority = item.priority === undefined || item.priority === '' ? 'medium' : item.priority;
    if (typeof priority !== 'string' || !IMPORTABLE_PRIORITIES.has(priority)) throw importError(`priority is invalid for source task ${sourceId}`);
    const estimatedMinutes = item.estimatedMinutes === undefined || item.estimatedMinutes === null
      ? null : Number.isInteger(item.estimatedMinutes) && item.estimatedMinutes > 0 && item.estimatedMinutes <= 100000
        ? item.estimatedMinutes : (() => { throw importError(`estimatedMinutes is invalid for source task ${sourceId}`); })();

    return {
      sourceId,
      title,
      normalizedTitle: normalizedTitle(title),
      description,
      status,
      sourceStatus,
      priority,
      dueDate: isoDate(item.dueDate, 'dueDate', sourceId),
      startDate: isoDate(item.startDate, 'startDate', sourceId),
      estimatedMinutes,
      sourceUpdatedAt: isoDate(item.sourceUpdatedAt, 'sourceUpdatedAt', sourceId),
    };
  });
  return { sourceKey, tasks, confirmed: input.confirm === true };
}

export function planTaskImport({ sourceKey, tasks, sourceLinks, existingTasks }) {
  const linksById = new Map(sourceLinks.map(row => [row.source_task_id, row]));
  const tasksByTitle = new Map();
  for (const row of existingTasks) {
    const key = normalizedTitle(String(row.title || ''));
    if (!key) continue;
    const matches = tasksByTitle.get(key) || [];
    matches.push({ id: String(row.id), title: String(row.title), status: String(row.status), dueDate: row.due_date || null, archived: Boolean(row.archived) });
    tasksByTitle.set(key, matches);
  }

  const titleBuckets = new Map();
  for (const task of tasks) {
    const matches = titleBuckets.get(task.normalizedTitle) || [];
    matches.push(task);
    titleBuckets.set(task.normalizedTitle, matches);
  }
  const items = tasks.map(task => {
    const linked = linksById.get(task.sourceId);
    if (linked) return {
      sourceId: task.sourceId,
      sourceStatus: linked.source_status ?? task.sourceStatus,
      action: linked.task_id ? 'already_imported' : 'previously_imported_then_deleted',
      taskId: linked.task_id || null,
    };
    const collisions = tasksByTitle.get(task.normalizedTitle) || [];
    if (collisions.length) return { sourceId: task.sourceId, sourceStatus: task.sourceStatus, action: 'needs_review', matches: collisions };
    const sameBatch = titleBuckets.get(task.normalizedTitle) || [];
    if (sameBatch.length > 1) return {
      sourceId: task.sourceId,
      sourceStatus: task.sourceStatus,
      action: 'needs_review',
      matches: sameBatch.filter(other => other.sourceId !== task.sourceId).map(other => ({
        sourceId: other.sourceId,
        title: other.title,
        sourceBatchCollision: true,
      })),
    };
    return { sourceId: task.sourceId, sourceStatus: task.sourceStatus, action: 'create' };
  });
  return {
    sourceKey,
    summary: {
      total: items.length,
      willCreate: items.filter(item => item.action === 'create').length,
      alreadyImported: items.filter(item => item.action === 'already_imported').length,
      previouslyDeleted: items.filter(item => item.action === 'previously_imported_then_deleted').length,
      needsReview: items.filter(item => item.action === 'needs_review').length,
    },
    items,
  };
}

async function loadPlan(db, normalized) {
  const [links, existing] = await Promise.all([
    db.prepare('SELECT source_task_id, task_id, source_status FROM lifeos_task_import_sources WHERE source_key=?').bind(normalized.sourceKey).all(),
    db.prepare('SELECT id,title,status,due_date,archived FROM personal_workbench_lifeos_tasks').all(),
  ]);
  return planTaskImport({
    sourceKey: normalized.sourceKey,
    tasks: normalized.tasks,
    sourceLinks: links.results || [],
    existingTasks: existing.results || [],
  });
}

export async function previewLifeOsTaskImport(db, input) {
  const normalized = normalizeTaskImportPayload(input);
  return loadPlan(db, normalized);
}

export async function importLifeOsTasks(db, input, actor, { idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  const normalized = normalizeTaskImportPayload(input);
  if (!normalized.confirmed) {
    const error = importError('Preview the import, then repeat it with confirm=true');
    error.status = 428;
    throw error;
  }
  const plan = await loadPlan(db, normalized);
  const createIds = new Map(plan.items.filter(item => item.action === 'create').map(item => [item.sourceId, idFactory()]));
  if (!createIds.size) return { ...plan, imported: 0 };

  const timestamp = now();
  const statements = [];
  for (const task of normalized.tasks) {
    const taskId = createIds.get(task.sourceId);
    if (!taskId) continue;
    statements.push(db.prepare(`INSERT INTO personal_workbench_lifeos_tasks
      (id,title,description,status,priority,due_date,start_date,completed_at,estimated_minutes,actual_minutes,
       recurrence,recurrence_config,position,archived,project_id,parent_task_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,0,0,NULL,NULL,?,?)`).bind(
      taskId, task.title, task.description, task.status, task.priority, task.dueDate, task.startDate,
      null, task.estimatedMinutes, null, timestamp, timestamp,
    ));
    statements.push(db.prepare(`INSERT INTO lifeos_task_import_sources
      (source_key,source_task_id,task_id,imported_at,source_updated_at,source_status) VALUES (?,?,?,?,?,?)`).bind(
      normalized.sourceKey, task.sourceId, taskId, timestamp, task.sourceUpdatedAt, task.sourceStatus,
    ));
  }
  statements.push(db.prepare(`INSERT INTO personal_workbench_lifeos_audit_log
    (action,entity_id,detail_json,actor,created_at) VALUES (?,?,?,?,?)`).bind(
    'task.import.batch', normalized.sourceKey,
    JSON.stringify({ imported: createIds.size, alreadyImported: plan.summary.alreadyImported,
      previouslyDeleted: plan.summary.previouslyDeleted, needsReview: plan.summary.needsReview }),
    String(actor || 'unknown').slice(0, 120), timestamp,
  ));

  // Both the production D1 batch API and the standalone SQLite adapter run
  // batches transactionally. A unique-key race therefore rolls back every
  // task and source link in this import instead of leaving a partial batch.
  await db.batch(statements);
  return { ...plan, imported: createIds.size };
}
