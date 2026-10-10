import { json } from './app/response.mjs';

const PROJECT_STATUSES = new Set(['active', 'paused', 'review', 'archived']);
const CHECKPOINT_KINDS = new Set(['progress', 'blocker', 'review', 'capture']);
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const notFound = () => json({ error: 'Not found' }, 404);

export function isPersonalWorkbenchOwner(auth, env) {
    const owner = text(env?.PERSONAL_WORKBENCH_OWNER, 120).toLowerCase();
    return Boolean(owner && auth?.role === 'admin' && text(auth.username, 120).toLowerCase() === owner);
}

export function isPersonalWorkbenchPrincipal(auth, env) {
    return Boolean(text(auth?.username, 120)
        && auth?.role === 'personal-workbench'
        && auth?.scope === 'personal-workbench');
}

async function bodyOf(request) { try { return await request.json(); } catch { return {}; } }

async function audit(env, actor, action, projectId = null, detail = {}) {
    await env.DB.prepare(`INSERT INTO personal_workbench_audit_log
        (action, project_id, detail_json, actor, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(action, projectId, JSON.stringify(detail), actor, nowIso()).run();
}

async function auditLifeOs(env, actor, action, entityId = null, detail = {}) {
    await env.DB.prepare(`INSERT INTO personal_workbench_lifeos_audit_log
        (action, entity_id, detail_json, actor, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(action, entityId, JSON.stringify(detail), actor, nowIso()).run();
}

function project(row) {
    return {
        id: Number(row.id), title: row.title, status: row.status, priority: Number(row.priority || 0),
        nextAction: row.next_action, resumeContext: row.resume_context, blocker: row.blocker,
        lastProgressAt: row.last_progress_at, createdAt: row.created_at, updatedAt: row.updated_at
    };
}

async function listProjects(env) {
    const result = await env.DB.prepare(`SELECT * FROM personal_workbench_projects
        WHERE status != 'archived'
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                 priority DESC, updated_at DESC, id DESC`).all();
    return (result.results || []).map(project);
}

async function createProject(request, env, actor) {
    const body = await bodyOf(request);
    const title = text(body.title, 180);
    const status = text(body.status, 20) || 'active';
    if (!title) return json({ error: '项目名称不能为空' }, 400);
    if (!PROJECT_STATUSES.has(status)) return json({ error: '无效的项目状态' }, 400);
    const priority = Number.isFinite(Number(body.priority)) ? Math.trunc(Number(body.priority)) : 0;
    const timestamp = nowIso();
    const result = await env.DB.prepare(`INSERT INTO personal_workbench_projects
        (title, status, priority, next_action, resume_context, blocker, last_progress_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(title, status, priority, text(body.nextAction, 500), text(body.resumeContext), text(body.blocker, 1200),
            body.lastProgressAt ? text(body.lastProgressAt, 64) : null, timestamp, timestamp).run();
    const id = Number(result.meta?.last_row_id);
    await audit(env, actor, 'project.created', id, { title, status });
    return json({ project: project(await env.DB.prepare('SELECT * FROM personal_workbench_projects WHERE id = ?').bind(id).first()) }, 201);
}

async function updateProject(request, env, actor, id) {
    const body = await bodyOf(request);
    const existing = await env.DB.prepare('SELECT * FROM personal_workbench_projects WHERE id = ?').bind(id).first();
    if (!existing) return notFound();
    const title = body.title === undefined ? existing.title : text(body.title, 180);
    const status = body.status === undefined ? existing.status : text(body.status, 20);
    const priority = body.priority === undefined ? Number(existing.priority) : Math.trunc(Number(body.priority));
    if (!title) return json({ error: '项目名称不能为空' }, 400);
    if (!PROJECT_STATUSES.has(status)) return json({ error: '无效的项目状态' }, 400);
    if (!Number.isFinite(priority)) return json({ error: '优先级必须是数字' }, 400);
    const nextAction = body.nextAction === undefined ? existing.next_action : text(body.nextAction, 500);
    const resumeContext = body.resumeContext === undefined ? existing.resume_context : text(body.resumeContext);
    const blocker = body.blocker === undefined ? existing.blocker : text(body.blocker, 1200);
    const lastProgressAt = body.lastProgressAt === undefined ? existing.last_progress_at : (body.lastProgressAt ? text(body.lastProgressAt, 64) : null);
    await env.DB.prepare(`UPDATE personal_workbench_projects
        SET title = ?, status = ?, priority = ?, next_action = ?, resume_context = ?, blocker = ?, last_progress_at = ?, updated_at = ?
        WHERE id = ?`).bind(title, status, priority, nextAction, resumeContext, blocker, lastProgressAt, nowIso(), id).run();
    await audit(env, actor, 'project.updated', id, { status, changed: Object.keys(body) });
    return json({ project: project(await env.DB.prepare('SELECT * FROM personal_workbench_projects WHERE id = ?').bind(id).first()) });
}

async function createCheckpoint(request, env, actor, projectId) {
    const body = await bodyOf(request);
    if (!await env.DB.prepare('SELECT id FROM personal_workbench_projects WHERE id = ?').bind(projectId).first()) return notFound();
    const kind = text(body.kind, 20) || 'progress';
    const content = text(body.content);
    const nextAction = text(body.nextAction, 500);
    if (!CHECKPOINT_KINDS.has(kind)) return json({ error: '无效的检查点类型' }, 400);
    if (!content) return json({ error: '请记录当前停点或进展' }, 400);
    const timestamp = nowIso();
    const result = await env.DB.prepare(`INSERT INTO personal_workbench_checkpoints
        (project_id, kind, content, next_action, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(projectId, kind, content, nextAction, timestamp).run();
    await env.DB.prepare(`UPDATE personal_workbench_projects
        SET resume_context = ?, next_action = CASE WHEN ? != '' THEN ? ELSE next_action END,
            blocker = CASE WHEN ? = 'blocker' THEN ? ELSE blocker END,
            last_progress_at = CASE WHEN ? = 'progress' THEN ? ELSE last_progress_at END, updated_at = ?
        WHERE id = ?`).bind(content, nextAction, nextAction, kind, content, kind, timestamp, timestamp, projectId).run();
    await audit(env, actor, 'checkpoint.created', projectId, { checkpointId: Number(result.meta?.last_row_id), kind });
    return json({ checkpoint: { id: Number(result.meta?.last_row_id), projectId, kind, content, nextAction, createdAt: timestamp } }, 201);
}

export async function processLifeOsRecurringTasks(env, now = Date.now()) {
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const rows = await env.DB.prepare(`SELECT * FROM personal_workbench_lifeos_tasks
        WHERE recurrence IN ('daily','weekly','monthly') AND archived=0 AND status='done' AND completed_at IS NOT NULL`).all();
    let created = 0;
    for (const task of rows.results || []) {
        const completed = new Date(task.completed_at);
        const completedMs = completed.getTime();
        if (!Number.isFinite(completedMs)) continue;
        const days = Math.floor((todayStart.getTime() - completedMs) / 86400000);
        const due = task.recurrence === 'daily' ? days >= 1
            : task.recurrence === 'weekly' ? days >= 7
                : completed.getUTCFullYear() !== todayStart.getUTCFullYear() || completed.getUTCMonth() !== todayStart.getUTCMonth();
        if (!due) continue;
        const completionKey = `${task.completed_at}`;
        const run = await env.DB.prepare('SELECT id FROM lifeos_task_recurrence_runs WHERE source_task_id=? AND completion_key=?')
            .bind(task.id, completionKey).first();
        if (run) continue;
        const generatedId = lifeOsId();
        const base = task.due_date ? new Date(task.due_date) : todayStart;
        if (!Number.isFinite(base.getTime())) continue;
        if (task.recurrence === 'daily') base.setUTCDate(base.getUTCDate() + 1);
        if (task.recurrence === 'weekly') base.setUTCDate(base.getUTCDate() + 7);
        if (task.recurrence === 'monthly') {
            const day = base.getUTCDate();
            base.setUTCDate(1);
            base.setUTCMonth(base.getUTCMonth() + 1);
            const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
            base.setUTCDate(Math.min(day, lastDay));
        }
        const timestamp = nowIso();
        const sourceTags = await env.DB.prepare('SELECT tag_id FROM lifeos_task_tags WHERE task_id=?').bind(task.id).all();
        const statements = [
            env.DB.prepare(`INSERT OR IGNORE INTO lifeos_task_recurrence_runs (id,source_task_id,completion_key,generated_task_id,created_at)
                VALUES (?,?,?,?,?)`).bind(lifeOsId(), task.id, completionKey, generatedId, timestamp),
            env.DB.prepare(`INSERT INTO personal_workbench_lifeos_tasks
                (id,title,description,status,priority,due_date,start_date,completed_at,estimated_minutes,actual_minutes,recurrence,
                 recurrence_config,position,archived,project_id,parent_task_id,created_at,updated_at)
                SELECT ?,title,description,'todo',priority,?,?,NULL,estimated_minutes,NULL,recurrence,recurrence_config,position,0,
                       project_id,parent_task_id,?,? FROM personal_workbench_lifeos_tasks source
                WHERE source.id=? AND EXISTS (SELECT 1 FROM lifeos_task_recurrence_runs WHERE generated_task_id=?)`)
                .bind(generatedId, base.toISOString(), task.start_date, timestamp, timestamp, task.id, generatedId)
        ];
        for (const tag of sourceTags.results || []) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO lifeos_task_tags (id,task_id,tag_id)
            SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM personal_workbench_lifeos_tasks WHERE id=?)`)
            .bind(lifeOsId(), generatedId, tag.tag_id, generatedId));
        const result = await env.DB.batch(statements);
        const inserted = Number(result?.[1]?.meta?.changes || result?.[1]?.meta?.rows_written || 0);
        if (inserted > 0) {
            await auditLifeOs(env, 'system', 'task.recurrence.created', generatedId, { sourceTaskId: task.id, recurrence: task.recurrence });
            created++;
        }
    }
    return created;
}

function lifeOsSettings(row) {
    if (!row) return null;
    return {
        id: row.settings_id, userId: row.profile_id,
        sidebarCollapsed: Boolean(row.sidebar_collapsed), defaultView: row.default_view,
        weekStartsOn: Number(row.week_starts_on), dateFormat: row.date_format,
        timeFormat: row.time_format, currency: row.currency,
        notificationsEnabled: Boolean(row.notifications_enabled),
        backupEnabled: Boolean(row.backup_enabled), backupFrequency: row.backup_frequency,
        createdAt: row.settings_created_at, updatedAt: row.settings_updated_at
    };
}

async function getLifeOsProfile(env) {
    const row = await env.DB.prepare(`SELECT p.*, s.id AS settings_id, s.sidebar_collapsed,
        s.default_view, s.week_starts_on, s.date_format, s.time_format, s.currency,
        s.notifications_enabled, s.backup_enabled, s.backup_frequency,
        s.created_at AS settings_created_at, s.updated_at AS settings_updated_at
        FROM lifeos_user_profile p LEFT JOIN lifeos_settings s ON s.user_id=p.id LIMIT 1`).first();
    if (!row) return null;
    return {
        id: row.id, name: row.name, email: row.email, avatar: row.avatar,
        timezone: row.timezone, locale: row.locale, theme: row.theme,
        setupComplete: Boolean(row.setup_complete), createdAt: row.created_at,
        updatedAt: row.updated_at, settings: lifeOsSettings(row.settings_id ? row : null)
    };
}

const LIFEOS_APP_PREFERENCE_KEYS = new Set([
    'setupComplete', 'language', 'accentColor', 'fontSize', 'theme', 'dashboardWidgets',
    'uiDensity', 'animationsEnabled', 'themeVariant', 'customAccentColor', 'baseCurrency',
    'currencyConverterEnabled', 'enabledModules', 'sidebarCollapsed'
]);
const LIFEOS_APP_PREFERENCE_VALUES = {
    language: new Set(['en', 'zh', 'tr', 'es', 'de', 'fr']),
    accentColor: new Set(['emerald', 'teal', 'amber', 'rose', 'violet', 'cyan', 'indigo', 'pink', 'lime', 'sky', 'custom']),
    fontSize: new Set(['small', 'medium', 'large']),
    theme: new Set(['light', 'dark', 'system']),
    uiDensity: new Set(['compact', 'comfortable', 'spacious']),
    themeVariant: new Set(['default', 'black', 'warm', 'cool', 'midnight', 'forest', 'sunset', 'lavender', 'nord']),
};
const LIFEOS_APP_MODULES = new Set(['dashboard', 'tasks', 'notes', 'habits', 'journal', 'finance', 'goals', 'learning', 'calendar', 'time', 'settings']);

function normalizeLifeOsAppPreferences(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const normalized = {};
    for (const [key, value] of Object.entries(input)) {
        if (!LIFEOS_APP_PREFERENCE_KEYS.has(key)) continue;
        if (key === 'setupComplete' || key === 'animationsEnabled' || key === 'currencyConverterEnabled' || key === 'sidebarCollapsed') {
            if (typeof value === 'boolean') normalized[key] = value;
            continue;
        }
        if (key === 'dashboardWidgets' || key === 'enabledModules') {
            if (Array.isArray(value) && value.length <= 60 && value.every(item => typeof item === 'string' && item.length <= 100)) {
                const items = key === 'enabledModules' ? value.filter(item => LIFEOS_APP_MODULES.has(item)) : value;
                normalized[key] = [...new Set(items)];
            }
            continue;
        }
        if (typeof value !== 'string') continue;
        if (key === 'customAccentColor') {
            if (/^#[0-9a-f]{6}$/i.test(value)) normalized[key] = value;
            continue;
        }
        if (key === 'baseCurrency') {
            if (/^[a-z]{3}$/i.test(value.trim())) normalized[key] = value.trim().toUpperCase();
            continue;
        }
        const trimmed = value.trim().slice(0, 32);
        if (!trimmed) continue;
        if (LIFEOS_APP_PREFERENCE_VALUES[key]) {
            if (LIFEOS_APP_PREFERENCE_VALUES[key].has(trimmed)) normalized[key] = trimmed;
            continue;
        }
        normalized[key] = trimmed;
    }
    return normalized;
}

function parseWorkspaceLayout(raw) {
    try {
        const value = JSON.parse(raw || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

async function getLifeOsAppState(env) {
    const [profile, workspace, task, project] = await Promise.all([
        getLifeOsProfile(env),
        env.DB.prepare('SELECT id,layout,updated_at FROM lifeos_workspaces WHERE is_default=1 LIMIT 1').first(),
        env.DB.prepare('SELECT 1 AS present FROM personal_workbench_lifeos_tasks LIMIT 1').first(),
        env.DB.prepare('SELECT 1 AS present FROM personal_workbench_lifeos_projects LIMIT 1').first()
    ]);
    const layout = parseWorkspaceLayout(workspace?.layout);
    const stored = normalizeLifeOsAppPreferences(layout.preferences) || {};
    const hasLifeOsData = Boolean(task || project);
    const appInitialized = Boolean(profile || layout.preferencesVersion === 1);
    const preferences = { ...stored };
    if (profile) {
        if (preferences.language === undefined) preferences.language = profile.locale?.toLowerCase().startsWith('zh') ? 'zh' : profile.locale;
        if (preferences.theme === undefined) preferences.theme = profile.theme;
        if (preferences.setupComplete === undefined) preferences.setupComplete = profile.setupComplete;
        if (preferences.baseCurrency === undefined && profile.settings?.currency) preferences.baseCurrency = profile.settings.currency;
        if (preferences.sidebarCollapsed === undefined && profile.settings) preferences.sidebarCollapsed = profile.settings.sidebarCollapsed;
    }
    if (preferences.dashboardWidgets === undefined && Array.isArray(layou…36630 tokens truncated…ifeos/compat/projects';
    if (url.pathname === base && request.method === 'GET') {
        const clauses = [];
        const bindings = [];
        if (url.searchParams.has('status')) { clauses.push('status = ?'); bindings.push(url.searchParams.get('status')); }
        if (url.searchParams.has('archived')) { clauses.push('archived = ?'); bindings.push(url.searchParams.get('archived') === 'true' ? 1 : 0); }
        const rows = await env.DB.prepare(`SELECT p.*,
            (SELECT COUNT(*) FROM personal_workbench_lifeos_tasks t WHERE t.project_id=p.id) AS task_count
            FROM personal_workbench_lifeos_projects p ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY p.created_at DESC`).bind(...bindings).all();
        return json(await Promise.all((rows.results || []).map(async row =>
            lifeOsProject(row, row.task_count, await lifeOsProjectGoals(env, row.source_id || row.id)))));
    }
    if (url.pathname === base && request.method === 'POST') {
        const body = await bodyOf(request);
        const nameValue = typeof body.name === 'string' ? body.name : body.title;
        const name = typeof nameValue === 'string' ? text(nameValue, 180) : '';
        if (!name) return json({ error: 'Name is required' }, 400);
        const status = typeof body.status === 'string' && body.status !== '' ? body.status : 'active';
        const timestamp = nowIso();
        const sourceId = lifeOsId();
        const result = await env.DB.prepare(`INSERT INTO personal_workbench_lifeos_projects
            (source_id,title,description,color,icon,status,start_date,end_date,priority,next_action,resume_context,blocker,archived,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
            sourceId, name, typeof body.description === 'string' && body.description !== '' ? body.description : null,
            typeof body.color === 'string' && body.color !== '' ? body.color : '#6b7280',
            typeof body.icon === 'string' && body.icon !== '' ? body.icon : null, status,
            parseLifeOsDate(body.startDate) ?? null, parseLifeOsDate(body.endDate) ?? null,
            Number.isFinite(Number(body.priority)) ? Math.trunc(Number(body.priority)) : 0,
            text(body.nextAction, 500), text(body.resumeContext), text(body.blocker, 1200),
            body.archived ? 1 : 0, timestamp, timestamp
        ).run();
        const id = Number(result.meta?.last_row_id);
        await auditLifeOs(env, actor, 'project.created', sourceId, { name, status });
        return json(lifeOsProject(await env.DB.prepare('SELECT * FROM personal_workbench_lifeos_projects WHERE id=?').bind(id).first()), 201);
    }
    const match = url.pathname.match(/^\/api\/personal-workbench\/lifeos\/compat\/projects\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const requestedId = match[1];
    const existing = await resolveLifeOsProject(env, requestedId);
    if (!existing) return notFound();
    const id = Number(existing.id);
    if (request.method === 'GET') {
        const [count, tasks, goals] = await Promise.all([
            env.DB.prepare('SELECT COUNT(*) AS count FROM personal_workbench_lifeos_tasks WHERE project_id=?').bind(id).first(),
            env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE project_id=? AND parent_task_id IS NULL ORDER BY position').bind(id).all(),
            lifeOsProjectGoals(env, existing.source_id || String(id))
        ]);
        const projectTasks = await Promise.all((tasks.results || []).map(async task => {
            const [tags, subtasks] = await Promise.all([
                env.DB.prepare(`SELECT tt.id,tt.task_id,tt.tag_id,t.name,t.color FROM lifeos_task_tags tt
                    JOIN lifeos_tags t ON t.id=tt.tag_id WHERE tt.task_id=?`).bind(task.id).all(),
                env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE parent_task_id=? ORDER BY position').bind(task.id).all()
            ]);
            return { ...await lifeOsTaskWithProjectId(env, task), tags: (tags.results || []).map(tag => ({ id: tag.id, taskId: tag.task_id,
                tagId: tag.tag_id, tag: { id: tag.tag_id, name: tag.name, color: tag.color } })),
                subtasks: await Promise.all((subtasks.results || []).map(child => lifeOsTaskWithProjectId(env, child))) };
        }));
        return json({ ...lifeOsProject(existing, count?.count, goals), tasks: projectTasks });
    }
    if (request.method === 'DELETE') {
        await env.DB.batch([
            env.DB.prepare('DELETE FROM lifeos_goal_projects WHERE project_id=COALESCE(?,CAST(? AS TEXT))').bind(existing.source_id, id),
            env.DB.prepare('DELETE FROM personal_workbench_lifeos_projects WHERE id=?').bind(id)
        ]);
        await auditLifeOs(env, actor, 'project.deleted', existing.source_id || String(id));
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    const name = typeof body.name === 'string' ? text(body.name, 180) : existing.title;
    const status = typeof body.status === 'string' ? body.status : existing.status;
    await env.DB.prepare(`UPDATE personal_workbench_lifeos_projects SET title=?,description=?,color=?,icon=?,status=?,
        start_date=?,end_date=?,archived=?,updated_at=? WHERE id=?`).bind(
        name,
        body.description === undefined ? existing.description : (typeof body.description === 'string' ? body.description : null),
        body.color === undefined ? existing.color : (typeof body.color === 'string' ? body.color : null),
        body.icon === undefined ? existing.icon : (typeof body.icon === 'string' ? body.icon : null), status,
        body.startDate === undefined ? existing.start_date : (parseLifeOsDate(body.startDate) ?? null),
        body.endDate === undefined ? existing.end_date : (parseLifeOsDate(body.endDate) ?? null),
        typeof body.archived === 'boolean' ? (body.archived ? 1 : 0) : Number(existing.archived), nowIso(), id
    ).run();
    await auditLifeOs(env, actor, 'project.updated', existing.source_id || String(id), { changed: Object.keys(body) });
    const row = await env.DB.prepare(`SELECT p.*,
        (SELECT COUNT(*) FROM personal_workbench_lifeos_tasks t WHERE t.project_id=p.id) AS task_count
        FROM personal_workbench_lifeos_projects p WHERE p.id=?`).bind(id).first();
    return json(lifeOsProject(row, row.task_count, await lifeOsProjectGoals(env, existing.source_id || id)));
}

async function handleLifeOsTasks(request, env, url, actor) {
    if (url.pathname === '/api/personal-workbench/lifeos/tasks' && request.method === 'GET') {
        const clauses = [];
        const bindings = [];
        if (url.searchParams.has('projectId')) {
            const project = await resolveLifeOsProject(env, url.searchParams.get('projectId'));
            clauses.push('project_id = ?'); bindings.push(project ? Number(project.id) : -1);
        }
        if (url.searchParams.has('status')) { clauses.push('status = ?'); bindings.push(url.searchParams.get('status')); }
        if (url.searchParams.has('priority')) { clauses.push('priority = ?'); bindings.push(url.searchParams.get('priority')); }
        if (url.searchParams.has('archived')) { clauses.push('archived = ?'); bindings.push(url.searchParams.get('archived') === 'true' ? 1 : 0); }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = await env.DB.prepare(`SELECT * FROM personal_workbench_lifeos_tasks ${where} ORDER BY position ASC, created_at DESC`)
            .bind(...bindings).all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsTaskWithTags(env, row))));
    }
    if (url.pathname === '/api/personal-workbench/lifeos/tasks' && request.method === 'POST') {
        const body = await bodyOf(request);
        const title = typeof body.title === 'string' ? text(body.title, 500) : '';
        if (!title) return json({ error: 'Title is required' }, 400);
        const status = typeof body.status === 'string' && body.status !== '' ? body.status : 'todo';
        const priority = typeof body.priority === 'string' && body.priority !== '' ? body.priority : 'medium';
        const id = crypto.randomUUID();
        const timestamp = nowIso();
        const projectIdInput = typeof body.projectId === 'string' ? body.projectId : null;
        const project = !projectIdInput
            ? null : await resolveLifeOsProject(env, body.projectId);
        if (projectIdInput && !project) return json({ error: 'Project not found' }, 404);
        const projectId = project ? Number(project.id) : null;
        const parentTaskId = typeof body.parentTaskId === 'string' && body.parentTaskId !== '' ? body.parentTaskId : null;
        if (parentTaskId && !await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id = ?').bind(parentTaskId).first()) {
            return json({ error: 'Parent task not found' }, 404);
        }
        const created = await env.DB.prepare(`INSERT INTO personal_workbench_lifeos_tasks
            (id,title,description,status,priority,due_date,start_date,completed_at,estimated_minutes,actual_minutes,
             recurrence,recurrence_config,position,archived,project_id,parent_task_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`).bind(
            id, title, typeof body.description === 'string' && body.description !== '' ? body.description : null, status, priority,
            parseLifeOsDate(body.dueDate) ?? null, parseLifeOsDate(body.startDate) ?? null, null,
            Number.isInteger(body.estimatedMinutes) && body.estimatedMinutes !== 0 ? body.estimatedMinutes : null,
            null,
            typeof body.recurrence === 'string' && body.recurrence !== '' ? body.recurrence : null,
            typeof body.recurrenceConfig === 'string' && body.recurrenceConfig !== '' ? body.recurrenceConfig : null,
            Number.isInteger(body.position) ? body.position : 0,
            projectId, parentTaskId, timestamp, timestamp
        ).run();
        if (!created.success) return json({ error: 'Could not create task' }, 500);
        if (body.tags !== undefined) await setLifeOsTaskTags(env, id, body.tags, timestamp);
        await auditLifeOs(env, actor, 'task.created', id, { title, projectId });
        const row = await env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE id = ?').bind(id).first();
        return json(await lifeOsTaskWithTags(env, row), 201);
    }
    const match = url.pathname.match(/^\/api\/personal-workbench\/lifeos\/tasks\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const id = match[1];
    const existing = await env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE id = ?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'GET') return json(await lifeOsTaskDetail(env, existing));
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM personal_workbench_lifeos_tasks WHERE id = ?').bind(id).run();
        await auditLifeOs(env, actor, 'task.deleted', id);
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return null;
    const body = await bodyOf(request);
    const title = typeof body.title === 'string' ? text(body.title, 500) : existing.title;
    const status = typeof body.status === 'string' ? body.status : existing.status;
    const priority = typeof body.priority === 'string' ? body.priority : existing.priority;
    if (!title) return json({ error: 'Title is required' }, 400);
    const nullable = (camel, snake = camel) => {
        const key = body[camel] !== undefined ? camel : snake;
        if (body[key] === undefined) return existing[snake];
        return typeof body[key] === 'string' ? body[key] : null;
    };
    const patchString = (camel, snake = camel) => {
        const key = body[camel] !== undefined ? camel : snake;
        if (body[key] === undefined) return existing[snake];
        return typeof body[key] === 'string' ? body[key] : null;
    };
    const optionalDate = (camel, snake) => {
        const value = body[camel] !== undefined ? body[camel] : body[snake];
        if (value === undefined) return existing[snake];
        return parseLifeOsDate(value) ?? null;
    };
    const updatedAt = nowIso();
    const completedAt = body.completedAt !== undefined
        ? (parseLifeOsDate(body.completedAt) ?? null)
        : typeof body.status === 'string' ? (status === 'done' ? updatedAt : null) : existing.completed_at;
    let projectId = existing.project_id;
    if (body.projectId !== undefined) {
        if (typeof body.projectId !== 'string' || body.projectId === '') projectId = null;
        else {
            const project = await resolveLifeOsProject(env, body.projectId);
            if (!project) return json({ error: 'Project not found' }, 404);
            projectId = Number(project.id);
        }
    }
    await env.DB.prepare(`UPDATE personal_workbench_lifeos_tasks SET title=?,description=?,status=?,priority=?,
        due_date=?,start_date=?,completed_at=?,estimated_minutes=?,actual_minutes=?,recurrence=?,recurrence_config=?,
        position=?,archived=?,project_id=?,parent_task_id=?,updated_at=? WHERE id=?`).bind(
        title, patchString('description'), status, priority, optionalDate('dueDate', 'due_date'),
        optionalDate('startDate', 'start_date'), completedAt,
        body.estimatedMinutes === undefined ? existing.estimated_minutes : (Number.isInteger(body.estimatedMinutes) ? body.estimatedMinutes : null),
        body.actualMinutes === undefined ? existing.actual_minutes : (Number.isInteger(body.actualMinutes) ? body.actualMinutes : null),
        nullable('recurrence'), nullable('recurrenceConfig', 'recurrence_config'),
        Number.isInteger(body.position) ? body.position : existing.position,
        typeof body.archived === 'boolean' ? (body.archived ? 1 : 0) : existing.archived, projectId,
        body.parentTaskId === undefined ? existing.parent_task_id : (typeof body.parentTaskId === 'string' && body.parentTaskId !== '' ? body.parentTaskId : null), updatedAt, id
    ).run();
    if (body.tags !== undefined) await setLifeOsTaskTags(env, id, body.tags);
    await auditLifeOs(env, actor, 'task.updated', id, { changed: Object.keys(body) });
    return json(await lifeOsTaskWithTags(env, await env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE id = ?').bind(id).first()));
}

export async function handlePersonalWorkbench(request, env, url, auth) {
    // Do not disclose this private surface by returning an authorization error.
    if (!isPersonalWorkbenchPrincipal(auth, env)) return notFound();
    const actor = text(auth.username, 120);
    const appStateResponse = await handleLifeOsAppState(request, env, url, actor);
    if (appStateResponse) return appStateResponse;
    const dashboardResponse = await handleLifeOsDashboard(request, env, url);
    if (dashboardResponse) return dashboardResponse;
    const widgetsResponse = await handleLifeOsWidgets(request, env, url, actor);
    if (widgetsResponse) return widgetsResponse;
    const searchResponse = await handleLifeOsSearch(request, env, url);
    if (searchResponse) return searchResponse;
    const activityResponse = await handleLifeOsActivity(request, env, url);
    if (activityResponse) return activityResponse;
    const notificationsResponse = await handleLifeOsNotifications(request, env, url);
    if (notificationsResponse) return notificationsResponse;
    const insightsResponse = await handleLifeOsInsights(request, env, url);
    if (insightsResponse) return insightsResponse;
    const weeklyReviewResponse = await handleLifeOsWeeklyReview(request, env, url);
    if (weeklyReviewResponse) return weeklyReviewResponse;
    const dataStatsResponse = await handleLifeOsDataStats(request, env, url);
    if (dataStatsResponse) return dataStatsResponse;
    const dataManagementResponse = await handleLifeOsDataManagement(request, env, url, actor);
    if (dataManagementResponse) return dataManagementResponse;
    const lifeOsProfileResponse = await handleLifeOsProfile(request, env, url, actor);
    if (lifeOsProfileResponse) return lifeOsProfileResponse;
    const lifeOsKnowledgeResponse = await handleLifeOsKnowledge(request, env, url, actor);
    if (lifeOsKnowledgeResponse) return lifeOsKnowledgeResponse;
    const lifeOsHabitsResponse = await handleLifeOsHabits(request, env, url, actor);
    if (lifeOsHabitsResponse) return lifeOsHabitsResponse;
    const lifeOsGoalsResponse = await handleLifeOsGoals(request, env, url, actor);
    if (lifeOsGoalsResponse) return lifeOsGoalsResponse;
    const lifeOsJournalResponse = await handleLifeOsJournal(request, env, url, actor);
    if (lifeOsJournalResponse) return lifeOsJournalResponse;
    const projectCompatibilityResponse = await handleLifeOsProjectCompatibility(request, env, url, actor);
    if (projectCompatibilityResponse) return projectCompatibilityResponse;
    const lifeOsTaskResponse = await handleLifeOsTasks(request, env, url, actor);
    if (lifeOsTaskResponse) return lifeOsTaskResponse;
    const lifeOsEventsResponse = await handleLifeOsEvents(request, env, url, actor);
    if (lifeOsEventsResponse) return lifeOsEventsResponse;
    const lifeOsCoursesResponse = await handleLifeOsCourses(request, env, url, actor);
    if (lifeOsCoursesResponse) return lifeOsCoursesResponse;
    const lifeOsFocusResponse = await handleLifeOsFocus(request, env, url, actor);
    if (lifeOsFocusResponse) return lifeOsFocusResponse;
    const lifeOsFinanceResponse = await handleLifeOsFinance(request, env, url, actor);
    if (lifeOsFinanceResponse) return lifeOsFinanceResponse;
    if (url.pathname === '/api/personal-workbench/projects' && request.method === 'GET') return json({ projects: await listProjects(env) });
    if (url.pathname === '/api/personal-workbench/projects' && request.method === 'POST') return createProject(request, env, actor);
    const checkpoint = url.pathname.match(/^\/api\/personal-workbench\/projects\/(\d+)\/checkpoints$/);
    if (checkpoint && request.method === 'POST') return createCheckpoint(request, env, actor, Number(checkpoint[1]));
    const match = url.pathname.match(/^\/api\/personal-workbench\/projects\/(\d+)$/);
    if (match && request.method === 'PATCH') return updateProject(request, env, actor, Number(match[1]));
    // Life OS migration pilot: same-origin, D1-backed project API. Keep its
    // tables and naming separate from HappySpa business records.
    if (url.pathname === '/api/personal-workbench/lifeos/projects' && request.method === 'GET') {
        const result = await env.DB.prepare(`SELECT * FROM personal_workbench_lifeos_projects
            WHERE archived = 0 ORDER BY priority DESC, updated_at DESC, id DESC`).all();
        return json({ projects: (result.results || []).map(row => ({
            id: row.source_id || String(row.id), title: row.title, status: row.status, priority: Number(row.priority),
            nextAction: row.next_action, resumeContext: row.resume_context, blocker: row.blocker,
            updatedAt: row.updated_at
        })) });
    }
    if (url.pathname === '/api/personal-workbench/lifeos/projects' && request.method === 'POST') {
        const body = await bodyOf(request);
        const title = text(body.title, 180);
        if (!title) return json({ error: '项目名称不能为空' }, 400);
        const status = text(body.status, 20) || 'active';
        if (!LIFEOS_PROJECT_STATUSES.has(status)) return json({ error: '无效的项目状态' }, 400);
        const priority = Number.isFinite(Number(body.priority)) ? Math.trunc(Number(body.priority)) : 0;
        const timestamp = nowIso();
        const sourceId = lifeOsId();
        const created = await env.DB.prepare(`INSERT INTO personal_workbench_lifeos_projects
            (source_id,title, status, priority, next_action, resume_context, blocker, archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).bind(
            sourceId, title, status, priority, text(body.nextAction, 500), text(body.resumeContext),
            text(body.blocker, 1200), timestamp, timestamp
        ).run();
        const id = Number(created.meta?.last_row_id);
        await auditLifeOs(env, actor, 'project.created', sourceId, { title, status });
        const row = await env.DB.prepare('SELECT * FROM personal_workbench_lifeos_projects WHERE id = ?').bind(id).first();
        return json({ project: {
            id: row.source_id || String(id), title: row.title, status: row.status, priority: Number(row.priority),
            nextAction: row.next_action, resumeContext: row.resume_context, blocker: row.blocker,
            updatedAt: row.updated_at
        } }, 201);
    }
    const lifeOsProjectMatch = url.pathname.match(/^\/api\/personal-workbench\/lifeos\/projects\/([a-zA-Z0-9-]+)$/);
    if (lifeOsProjectMatch) {
        const existing = await resolveLifeOsProject(env, lifeOsProjectMatch[1]);
        if (!existing) return notFound();
        const id = Number(existing.id);
        if (request.method === 'GET') {
            const tasks = await env.DB.prepare(`SELECT * FROM personal_workbench_lifeos_tasks
                WHERE project_id = ? AND parent_task_id IS NULL ORDER BY position ASC, created_at DESC`).bind(id).all();
            return json({ project: {
                id: existing.source_id || String(id), title: existing.title, status: existing.status, priority: Number(existing.priority),
                nextAction: existing.next_action, resumeContext: existing.resume_context, blocker: existing.blocker,
                updatedAt: existing.updated_at
            }, tasks: (tasks.results || []).map(task => lifeOsTask(task, existing.source_id || null)) });
        }
        if (request.method === 'DELETE') {
            await env.DB.batch([
                env.DB.prepare('DELETE FROM lifeos_goal_projects WHERE project_id=COALESCE(?,CAST(? AS TEXT))').bind(existing.source_id, id),
                env.DB.prepare('DELETE FROM personal_workbench_lifeos_projects WHERE id = ?').bind(id)
            ]);
            await auditLifeOs(env, actor, 'project.deleted', existing.source_id || String(id));
            return json({ success: true });
        }
        if (request.method !== 'PATCH') return notFound();
        const body = await bodyOf(request);
        const title = body.title === undefined ? existing.title : text(body.title, 180);
        const status = body.status === undefined ? existing.status : text(body.status, 20);
        const priority = body.priority === undefined ? Number(existing.priority) : Number(body.priority);
        if (!title) return json({ error: '项目名称不能为空' }, 400);
        if (!LIFEOS_PROJECT_STATUSES.has(status)) return json({ error: '无效的项目状态' }, 400);
        if (!Number.isFinite(priority)) return json({ error: '优先级必须是数字' }, 400);
        await env.DB.prepare(`UPDATE personal_workbench_lifeos_projects SET title=?,status=?,priority=?,
            next_action=?,resume_context=?,blocker=?,archived=?,updated_at=? WHERE id=?`).bind(
            title, status, Math.trunc(priority),
            body.nextAction === undefined ? existing.next_action : text(body.nextAction, 500),
            body.resumeContext === undefined ? existing.resume_context : text(body.resumeContext),
            body.blocker === undefined ? existing.blocker : text(body.blocker, 1200),
            body.archived === undefined ? Number(existing.archived) : (body.archived ? 1 : 0), nowIso(), id
        ).run();
        await auditLifeOs(env, actor, 'project.updated', existing.source_id || String(id), { changed: Object.keys(body) });
        const row = await env.DB.prepare('SELECT * FROM personal_workbench_lifeos_projects WHERE id = ?').bind(id).first();
        return json({ project: {
            id: row.source_id || String(id), title: row.title, status: row.status, priority: Number(row.priority),
            nextAction: row.next_action, resumeContext: row.resume_context, blocker: row.blocker,
            updatedAt: row.updated_at
        } });
    }
    if (url.pathname === '/api/personal-workbench/audit' && request.method === 'GET') {
        const result = await env.DB.prepare(`SELECT id, action, project_id, detail_json, actor, created_at
            FROM personal_workbench_audit_log ORDER BY id DESC LIMIT 100`).all();
        return json({ items: (result.results || []).map(row => ({
            id: Number(row.id), action: row.action, projectId: row.project_id === null ? null : Number(row.project_id),
            detail: JSON.parse(row.detail_json || '{}'), actor: row.actor, createdAt: row.created_at
        })) });
    }
    return notFound();
}
