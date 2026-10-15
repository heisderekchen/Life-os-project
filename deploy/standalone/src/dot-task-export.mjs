import { createHash } from 'node:crypto';

const ROOT_KEYS = new Set(['title', 'as_of', 'usage', 'tasks', 'confirm']);
const TASK_KEYS = new Set(['name', 'description', 'project', 'type', 'status', 'latest_result', 'links', 'updated_at']);
const TASK_STATUSES = new Set(['todo', 'in-progress', 'done', 'cancelled']);

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function normalized(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function sourceIdFor(task) {
  const identity = JSON.stringify([normalized(task.name), normalized(task.project), normalized(task.type)]);
  return `dot:${createHash('sha256').update(identity).digest('hex')}`;
}

function canonicalJson(value, field, maxLength = 2500) {
  if (value === undefined || value === null || value === '') return '';
  let json;
  try { json = JSON.stringify(value); } catch { fail(`${field} must be JSON-compatible`); }
  if (json.length > maxLength) fail(`${field} is too large to import safely`);
  return json;
}

function normalizeRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`Task ${index + 1} must be an object`);
  for (const key of Object.keys(record)) if (!TASK_KEYS.has(key)) fail(`Unsupported source task field: ${key}`);
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.trim().length > 500) {
    fail(`Task ${index + 1} needs a name between 1 and 500 characters`);
  }
  for (const field of ['description', 'project', 'type', 'status']) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string') {
      fail(`${field} must be a string for task ${index + 1}`);
    }
  }
  const status = record.status?.trim() || 'todo';
  if (!TASK_STATUSES.has(status)) fail(`Unsupported status "${status}" on task ${record.name}`);
  const latestResult = canonicalJson(record.latest_result, 'latest_result');
  const links = canonicalJson(record.links, 'links');
  const context = [
    record.project?.trim() ? `Project: ${record.project.trim()}` : '',
    record.type?.trim() ? `Type: ${record.type.trim()}` : '',
    record.description?.trim() || '',
    latestResult ? `Latest result: ${latestResult}` : '',
    links ? `Links: ${links}` : '',
  ].filter(Boolean).join('\n\n');
  if (context.length > 4000) fail(`Combined source details are too large for task ${record.name}`);
  let sourceUpdatedAt = null;
  if (record.updated_at !== undefined && record.updated_at !== null && record.updated_at !== '') {
    const parsedDate = new Date(record.updated_at);
    if (Number.isNaN(parsedDate.getTime())) fail(`updated_at is invalid for task ${record.name}`);
    sourceUpdatedAt = parsedDate.toISOString();
  }
  return {
    sourceId: sourceIdFor(record),
    title: record.name.trim(),
    description: context || null,
    status,
    priority: 'medium',
    sourceUpdatedAt,
    identity: sourceIdFor(record),
    comparable: JSON.stringify({
      title: normalized(record.name),
      description: record.description?.trim() || '',
      project: normalized(record.project),
      type: normalized(record.type),
      status,
      latestResult,
      links,
    }),
  };
}

/** Convert the user's {title, as_of, usage, tasks:[...]} export to the safe import API shape. */
export function normalizeDotTaskExport(input, { sourceKey = 'dot.tasks' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A Dot task export object is required');
  for (const key of Object.keys(input)) if (!ROOT_KEYS.has(key)) fail(`Unsupported export field: ${key}`);
  if (typeof input.title !== 'string' || !input.title.trim()) fail('Export title is required');
  if (typeof input.as_of !== 'string' || Number.isNaN(Date.parse(input.as_of))) fail('Export as_of must be a date or timestamp');
  if (!Array.isArray(input.tasks) || input.tasks.length > 500) fail('Export tasks must be an array of at most 500 records');

  const unique = new Map();
  for (const [index, raw] of input.tasks.entries()) {
    const task = normalizeRecord(raw, index);
    const existing = unique.get(task.identity);
    if (existing) {
      if (existing.comparable !== task.comparable) {
        fail(`Ambiguous duplicate source task identity for "${task.title}"; review the export before importing`);
      }
      const currentDate = Date.parse(existing.sourceUpdatedAt || '') || 0;
      const nextDate = Date.parse(task.sourceUpdatedAt || '') || 0;
      if (nextDate > currentDate) unique.set(task.identity, task);
      continue;
    }
    unique.set(task.identity, task);
  }
  const tasks = [...unique.values()].map(({ identity, comparable, ...task }) => task);
  return { sourceKey, tasks, confirm: input.confirm === true };
}
