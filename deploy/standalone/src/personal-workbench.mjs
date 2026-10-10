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
    if (preferences.dashboardWidgets === undefined && Array.isArray(layout.widgets)) preferences.dashboardWidgets = layout.widgets;
    if (profile && (!Array.isArray(preferences.dashboardWidgets) || preferences.dashboardWidgets.length === 0)) {
        const legacyWidgets = await env.DB.prepare('SELECT widget_ids FROM lifeos_widgets WHERE user_id=?').bind(profile.id).first();
        try {
            const parsed = JSON.parse(legacyWidgets?.widget_ids || '[]');
            if (Array.isArray(parsed) && parsed.length) preferences.dashboardWidgets = parsed;
        } catch {
            // An invalid legacy widget snapshot is ignored; it is never written back.
        }
    }
    if (preferences.setupComplete === undefined && hasLifeOsData) preferences.setupComplete = true;
    return {
        initialized: appInitialized || Boolean(workspace) || hasLifeOsData,
        appInitialized,
        preferencesVersion: layout.preferencesVersion === 1,
        hasLifeOsData,
        setupComplete: preferences.setupComplete === true,
        profile: profile ? { id: profile.id, name: profile.name, email: profile.email, locale: profile.locale, theme: profile.theme } : null,
        preferences,
        revision: workspace?.updated_at || null
    };
}

async function handleLifeOsAppState(request, env, url, actor) {
    if (url.pathname !== '/api/personal-workbench/lifeos/app-state') return null;
    if (request.method === 'GET') return json(await getLifeOsAppState(env));
    if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
    let body;
    try { body = await bodyOf(request); }
    catch { return json({ error: 'Invalid JSON body' }, 400); }
    const incoming = normalizeLifeOsAppPreferences(body.preferences);
    if (!incoming || !Object.keys(incoming).length) return json({ error: 'Preferences are required' }, 400);
    if (body.legacyMigration === true && incoming.setupComplete !== true) {
        return json({ error: 'Legacy migration requires an explicitly completed local setup' }, 400);
    }

    const current = await getLifeOsAppState(env);
    const workspace = await env.DB.prepare('SELECT id,layout,updated_at FROM lifeos_workspaces WHERE is_default=1 LIMIT 1').first();
    if ((body.expectedRevision ?? null) !== (workspace?.updated_at || null)) {
        return json({ error: 'Preferences changed on another device', conflict: true, state: current }, 409, { 'cache-control': 'no-store' });
    }
    const previousLayout = parseWorkspaceLayout(workspace?.layout);
    const effectiveCloudPreferences = current.preferences;
    const nextPreferences = { ...effectiveCloudPreferences };
    for (const [key, value] of Object.entries(incoming)) {
        if (body.legacyMigration !== true || effectiveCloudPreferences[key] === undefined) nextPreferences[key] = value;
    }
    if (nextPreferences.setupComplete === undefined) nextPreferences.setupComplete = current.setupComplete;
    if (Array.isArray(nextPreferences.dashboardWidgets)) previousLayout.widgets = nextPreferences.dashboardWidgets;
    previousLayout.preferences = nextPreferences;
    previousLayout.preferencesVersion = 1;

    const previousMillis = Date.parse(workspace?.updated_at || '') || 0;
    const timestamp = new Date(Math.max(Date.now(), previousMillis + 1)).toISOString();
    const workspaceId = workspace?.id || lifeOsId();
    const serializedLayout = JSON.stringify(previousLayout);
    const workspaceWrite = workspace
        ? env.DB.prepare(`UPDATE lifeos_workspaces SET layout=?,updated_at=? WHERE id=? AND updated_at=?`)
            .bind(serializedLayout, timestamp, workspace.id, workspace.updated_at)
        : env.DB.prepare(`INSERT OR IGNORE INTO lifeos_workspaces (id,name,is_default,layout,sort_order,created_at,updated_at)
            VALUES (?,'Default',1,?,0,?,?)`).bind(workspaceId, serializedLayout, timestamp, timestamp);
    const existsAfterWrite = `EXISTS (SELECT 1 FROM lifeos_workspaces WHERE id=? AND updated_at=?)`;
    const statements = [workspaceWrite];
    if (current.profile?.id) {
        // D1 batch statements run sequentially in one transaction. `changes()`
        // ties these sidecar writes to the workspace CAS/insert immediately
        // before them, so a losing concurrent request cannot update profile or
        // settings when both writers calculate the same millisecond timestamp.
        const language = typeof nextPreferences.language === 'string' ? (nextPreferences.language === 'zh' ? 'zh-CN' : nextPreferences.language) : null;
        const theme = typeof nextPreferences.theme === 'string' ? nextPreferences.theme : null;
        statements.push(env.DB.prepare(`UPDATE lifeos_user_profile
            SET locale=COALESCE(?,locale), theme=COALESCE(?,theme), setup_complete=?, updated_at=?
            WHERE id=? AND changes()>0 AND ${existsAfterWrite}`)
            .bind(language, theme, nextPreferences.setupComplete ? 1 : 0, timestamp, current.profile.id, workspaceId, timestamp));
        if (typeof nextPreferences.baseCurrency === 'string' || typeof nextPreferences.sidebarCollapsed === 'boolean') {
            statements.push(env.DB.prepare(`UPDATE lifeos_settings
                SET currency=COALESCE(?,currency), sidebar_collapsed=COALESCE(?,sidebar_collapsed), updated_at=?
                WHERE user_id=? AND changes()>0 AND ${existsAfterWrite}`)
                .bind(typeof nextPreferences.baseCurrency === 'string' ? nextPreferences.baseCurrency : null,
                    typeof nextPreferences.sidebarCollapsed === 'boolean' ? (nextPreferences.sidebarCollapsed ? 1 : 0) : null,
                    timestamp, current.profile.id, workspaceId, timestamp));
        }
    }
    const results = await env.DB.batch(statements);
    const wroteWorkspace = Number(results?.[0]?.meta?.changes ?? results?.[0]?.meta?.rows_written ?? 0) > 0;
    if (!wroteWorkspace) {
        const latest = await getLifeOsAppState(env);
        return json({ error: 'Preferences changed on another device', conflict: true, state: latest }, 409, { 'cache-control': 'no-store' });
    }
    await auditLifeOs(env, actor, body.legacyMigration === true ? 'preferences.migrated' : 'preferences.updated', current.profile?.id || workspaceId,
        { changed: Object.keys(incoming), legacyMigration: body.legacyMigration === true });
    return json(await getLifeOsAppState(env), 200, { 'cache-control': 'no-store' });
}

async function handleLifeOsProfile(request, env, url, actor) {
    if (url.pathname !== '/api/personal-workbench/lifeos/profile') return null;
    if (request.method === 'GET') {
        const profile = await getLifeOsProfile(env);
        return profile ? json(profile) : json({ error: 'No profile found' }, 404);
    }
    if (!['POST', 'PATCH', 'PUT'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    const current = await env.DB.prepare('SELECT * FROM lifeos_user_profile LIMIT 1').first();
    const timestamp = nowIso();
    let id = current?.id;
    if (!current) {
        const name = text(body.name, 120);
        if (!name) return json({ error: 'Name is required' }, 400);
        id = crypto.randomUUID();
        const email = text(body.email, 254) || `${text(actor, 100).toLowerCase()}@lifeos.local`;
        await env.DB.prepare(`INSERT INTO lifeos_user_profile
            (id,name,email,avatar,timezone,locale,theme,setup_complete,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, name, email, body.avatar ?? null,
            text(body.timezone, 100) || 'UTC', text(body.locale, 20) || 'en',
            text(body.theme, 20) || 'system', body.setupComplete === false ? 0 : 1, timestamp, timestamp).run();
        await env.DB.prepare(`INSERT INTO lifeos_settings (id,user_id,created_at,updated_at) VALUES (?,?,?,?)`)
            .bind(crypto.randomUUID(), id, timestamp, timestamp).run();
    } else {
        const allowed = ['name', 'email', 'avatar', 'timezone', 'locale', 'theme'];
        const columns = { name: 'name', email: 'email', avatar: 'avatar', timezone: 'timezone', locale: 'locale', theme: 'theme' };
        const sets = [];
        const values = [];
        for (const key of allowed) {
            if (body[key] === undefined) continue;
            const value = key === 'avatar' && body[key] === null ? null : text(body[key], key === 'email' ? 254 : 400);
            if (key === 'name' && !value) return json({ error: 'Name is required' }, 400);
            sets.push(`${columns[key]}=?`); values.push(value);
        }
        if (body.setupComplete !== undefined) { sets.push('setup_complete=?'); values.push(body.setupComplete ? 1 : 0); }
        sets.push('updated_at=?'); values.push(timestamp, id);
        await env.DB.prepare(`UPDATE lifeos_user_profile SET ${sets.join(',')} WHERE id=?`).bind(...values).run();
        const settings = body.settings;
        if (settings && typeof settings === 'object') {
            const fields = {
                sidebarCollapsed: ['sidebar_collapsed', v => v ? 1 : 0], defaultView: ['default_view', String],
                weekStartsOn: ['week_starts_on', Number], dateFormat: ['date_format', String],
                timeFormat: ['time_format', String], currency: ['currency', String],
                notificationsEnabled: ['notifications_enabled', v => v ? 1 : 0],
                backupEnabled: ['backup_enabled', v => v ? 1 : 0], backupFrequency: ['backup_frequency', String]
            };
            const settingSets = []; const settingValues = [];
            for (const [key, [column, convert]] of Object.entries(fields)) {
                if (settings[key] === undefined) continue;
                settingSets.push(`${column}=?`); settingValues.push(convert(settings[key]));
            }
            if (settingSets.length) {
                settingSets.push('updated_at=?'); settingValues.push(timestamp, id);
                await env.DB.prepare(`UPDATE lifeos_settings SET ${settingSets.join(',')} WHERE user_id=?`).bind(...settingValues).run();
            }
        }
    }
    const profile = await getLifeOsProfile(env);
    await auditLifeOs(env, actor, current ? 'profile.updated' : 'profile.created', id, { changed: Object.keys(body) });
    return json(profile, current ? 200 : 201);
}

const dateForLifeOs = value => value == null ? null : (typeof value === 'number' ? new Date(value).toISOString() : String(value));
const lifeOsId = () => crypto.randomUUID();
const wordCount = value => String(value ?? '').trim().split(/\s+/).filter(Boolean).length;

async function lifeOsNoteTags(env, noteId) {
    const result = await env.DB.prepare(`SELECT nt.id, nt.note_id, nt.tag_id, t.name, t.color,
        t.created_at AS tag_created_at, t.updated_at AS tag_updated_at
        FROM lifeos_note_tags nt JOIN lifeos_tags t ON t.id=nt.tag_id WHERE nt.note_id=?`).bind(noteId).all();
    return (result.results || []).map(row => ({
        id: row.id, noteId: row.note_id, tagId: row.tag_id,
        tag: { id: row.tag_id, name: row.name, color: row.color,
            createdAt: row.tag_created_at, updatedAt: row.tag_updated_at }
    }));
}

async function setLifeOsNoteTags(env, noteId, rawTags, timestamp) {
    if (!Array.isArray(rawTags) && typeof rawTags !== 'string') return;
    const names = [...new Set((Array.isArray(rawTags) ? rawTags : rawTags.split(','))
        .map(value => text(value, 120)).filter(Boolean))];
    const createTags = names.map(name => env.DB.prepare(`INSERT INTO lifeos_tags (id,name,color,created_at,updated_at)
        SELECT ?,?,'#6b7280',?,? WHERE NOT EXISTS (SELECT 1 FROM lifeos_tags WHERE name=?)`)
        .bind(lifeOsId(), name, timestamp, timestamp, name));
    if (createTags.length) await env.DB.batch(createTags);
    const tagRows = await Promise.all(names.map(name => env.DB.prepare('SELECT id FROM lifeos_tags WHERE name=? ORDER BY created_at,id LIMIT 1').bind(name).first()));
    const statements = [env.DB.prepare('DELETE FROM lifeos_note_tags WHERE note_id=?').bind(noteId)];
    for (const tag of tagRows.filter(Boolean)) {
        statements.push(env.DB.prepare('INSERT OR IGNORE INTO lifeos_note_tags (id,note_id,tag_id) VALUES (?,?,?)')
            .bind(lifeOsId(), noteId, tag.id));
    }
    await env.DB.batch(statements);
}

async function setLifeOsHabitTags(env, habitId, rawTags, timestamp = nowIso()) {
    if (!Array.isArray(rawTags) && typeof rawTags !== 'string') return;
    const names = [...new Set((Array.isArray(rawTags) ? rawTags : rawTags.split(','))
        .map(value => text(value, 120)).filter(Boolean))];
    const statements = [env.DB.prepare('DELETE FROM lifeos_habit_tags WHERE habit_id=?').bind(habitId)];
    for (const name of names) {
        statements.push(env.DB.prepare(`INSERT INTO lifeos_tags (id,name,color,created_at,updated_at)
            SELECT ?,?,'#6b7280',?,? WHERE NOT EXISTS (SELECT 1 FROM lifeos_tags WHERE name=?)`)
            .bind(lifeOsId(), name, timestamp, timestamp, name));
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO lifeos_habit_tags (id,habit_id,tag_id)
            SELECT ?,?,id FROM lifeos_tags WHERE name=?`).bind(lifeOsId(), habitId, name));
    }
    await env.DB.batch(statements);
}

async function lifeOsNote(env, row, detail = false) {
    const folder = row.folder_id ? await env.DB.prepare(`SELECT id,name,icon,color FROM lifeos_note_folders WHERE id=?`).bind(row.folder_id).first() : null;
    const tags = await lifeOsNoteTags(env, row.id);
    const backlinks = await env.DB.prepare('SELECT COUNT(*) AS count FROM lifeos_note_links WHERE target_note_id=?').bind(row.id).first();
    const result = {
        id: row.id, title: row.title, content: row.content, type: row.type, icon: row.icon, color: row.color,
        isPinned: Boolean(row.is_pinned), isFavorite: Boolean(row.is_favorite), wordCount: Number(row.word_count),
        archived: Boolean(row.archived), folderId: row.folder_id,
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at), folder,
        tags, _count: { backlinks: Number(backlinks?.count || 0) }
    };
    if (detail) {
        const links = await env.DB.prepare(`SELECT l.id,l.source_note_id,l.target_note_id,n.title
            FROM lifeos_note_links l JOIN lifeos_notes n ON n.id=l.target_note_id WHERE l.source_note_id=?`).bind(row.id).all();
        const back = await env.DB.prepare(`SELECT l.id,l.source_note_id,l.target_note_id,n.title
            FROM lifeos_note_links l JOIN lifeos_notes n ON n.id=l.source_note_id WHERE l.target_note_id=?`).bind(row.id).all();
        result.links = (links.results || []).map(item => ({ id: item.id, sourceNoteId: item.source_note_id,
            targetNoteId: item.target_note_id, target: { id: item.target_note_id, title: item.title } }));
        result.backlinks = (back.results || []).map(item => ({ id: item.id, sourceNoteId: item.source_note_id,
            targetNoteId: item.target_note_id, source: { id: item.source_note_id, title: item.title } }));
        const bookmarks = await env.DB.prepare('SELECT * FROM lifeos_bookmarks WHERE note_id=? ORDER BY created_at DESC').bind(row.id).all();
        result.bookmarks = (bookmarks.results || []).map(bookmark => ({ id: bookmark.id, url: bookmark.url,
            title: bookmark.title, description: bookmark.description, favicon: bookmark.favicon,
            noteId: bookmark.note_id, createdAt: dateForLifeOs(bookmark.created_at) }));
    }
    return result;
}

async function handleLifeOsKnowledge(request, env, url, actor) {
    const path = url.pathname;
    const timestamp = nowIso();
    if (path === '/api/personal-workbench/lifeos/tags') {
        if (request.method === 'GET') {
            const rows = await env.DB.prepare(`SELECT t.*,(SELECT COUNT(*) FROM lifeos_note_tags n WHERE n.tag_id=t.id) AS note_count,
                (SELECT COUNT(*) FROM lifeos_task_tags tt WHERE tt.tag_id=t.id) AS task_count,
                (SELECT COUNT(*) FROM lifeos_habit_tags h WHERE h.tag_id=t.id) AS habit_count,
                (SELECT COUNT(*) FROM lifeos_goal_tags g WHERE g.tag_id=t.id) AS goal_count,
                (SELECT COUNT(*) FROM lifeos_journal_tags j WHERE j.tag_id=t.id) AS journal_count,
                (SELECT COUNT(*) FROM lifeos_bookmark_tags b WHERE b.tag_id=t.id) AS bookmark_count
                FROM lifeos_tags t ORDER BY t.name ASC`).all();
            return json((rows.results || []).map(row => ({ id: row.id, name: row.name, color: row.color,
                createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
                _count: { taskTags: Number(row.task_count), noteTags: Number(row.note_count), journalTags: Number(row.journal_count), goalTags: Number(row.goal_count), habitTags: Number(row.habit_count), bookmarkTags: Number(row.bookmark_count) } })));
        }
        if (request.method === 'POST') {
            const body = await bodyOf(request); const name = text(body.name, 120);
            if (!name) return json({ error: 'Name is required' }, 400);
            const id = lifeOsId();
            await env.DB.prepare('INSERT INTO lifeos_tags (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)')
                .bind(id, name, text(body.color, 40) || '#6b7280', timestamp, timestamp).run();
            await auditLifeOs(env, actor, 'tag.created', id, { name });
            return json({ id, name, color: text(body.color, 40) || '#6b7280', createdAt: timestamp, updatedAt: timestamp }, 201);
        }
    }
    if (path === '/api/personal-workbench/lifeos/note-folders') {
        if (request.method === 'GET') {
            const rows = await env.DB.prepare(`SELECT f.*,(SELECT COUNT(*) FROM lifeos_notes n WHERE n.folder_id=f.id) AS note_count,
                (SELECT COUNT(*) FROM lifeos_note_folders c WHERE c.parent_id=f.id) AS child_count
                FROM lifeos_note_folders f ORDER BY f.sort_order ASC`).all();
            return json((rows.results || []).map(row => ({ id: row.id, name: row.name, icon: row.icon, color: row.color,
                parentId: row.parent_id, order: Number(row.sort_order), createdAt: dateForLifeOs(row.created_at),
                updatedAt: dateForLifeOs(row.updated_at), _count: { notes: Number(row.note_count), children: Number(row.child_count) } })));
        }
        if (request.method === 'POST') {
            const body = await bodyOf(request); const name = text(body.name, 120);
            if (!name) return json({ error: 'Name is required' }, 400);
            if (body.parentId && !await env.DB.prepare('SELECT id FROM lifeos_note_folders WHERE id=?').bind(body.parentId).first()) return notFound();
            const id = lifeOsId();
            await env.DB.prepare(`INSERT INTO lifeos_note_folders (id,name,icon,color,parent_id,sort_order,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?)`).bind(id, name, body.icon ?? null, body.color ?? null, body.parentId ?? null,
                Number.isInteger(body.order) ? body.order : 0, timestamp, timestamp).run();
            await auditLifeOs(env, actor, 'note-folder.created', id, { name });
            return json({ id, name, icon: body.icon ?? null, color: body.color ?? null, parentId: body.parentId ?? null,
                order: Number.isInteger(body.order) ? body.order : 0, createdAt: timestamp, updatedAt: timestamp,
                _count: { notes: 0, children: 0 } }, 201);
        }
    }
    if (path === '/api/personal-workbench/lifeos/notes' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        if (url.searchParams.has('folderId')) { clauses.push('folder_id=?'); bindings.push(url.searchParams.get('folderId')); }
        if (url.searchParams.has('type')) { clauses.push('type=?'); bindings.push(url.searchParams.get('type')); }
        if (url.searchParams.has('archived')) { clauses.push('archived=?'); bindings.push(url.searchParams.get('archived') === 'true' ? 1 : 0); }
        if (url.searchParams.has('search')) { clauses.push('(title LIKE ? OR content LIKE ?)'); const term = `%${url.searchParams.get('search')}%`; bindings.push(term, term); }
        const rows = await env.DB.prepare(`SELECT * FROM lifeos_notes WHERE ${clauses.join(' AND ')} ORDER BY is_pinned DESC, updated_at DESC`)
            .bind(...bindings).all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsNote(env, row))));
    }
    if (path === '/api/personal-workbench/lifeos/notes' && request.method === 'POST') {
        const body = await bodyOf(request); const title = text(body.title, 500);
        if (!title) return json({ error: 'Title is required' }, 400);
        if (body.folderId && !await env.DB.prepare('SELECT id FROM lifeos_note_folders WHERE id=?').bind(body.folderId).first()) return notFound();
        const content = String(body.content ?? ''); const id = lifeOsId();
        await env.DB.prepare(`INSERT INTO lifeos_notes (id,title,content,type,icon,color,is_pinned,is_favorite,word_count,archived,folder_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,0,0,?,0,?,?,?)`).bind(id, title, content, text(body.type, 30) || 'note',
            body.icon ?? null, body.color ?? null, wordCount(content), body.folderId ?? null, timestamp, timestamp).run();
        await setLifeOsNoteTags(env, id, body.tags, timestamp);
        await auditLifeOs(env, actor, 'note.created', id, { title });
        return json(await lifeOsNote(env, await env.DB.prepare('SELECT * FROM lifeos_notes WHERE id=?').bind(id).first(), true), 201);
    }
    const match = path.match(/^\/api\/personal-workbench\/lifeos\/notes\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const id = match[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_notes WHERE id=?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'GET') return json(await lifeOsNote(env, existing, true));
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM lifeos_notes WHERE id=?').bind(id).run();
        await auditLifeOs(env, actor, 'note.deleted', id);
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request); const content = body.content === undefined ? existing.content : String(body.content ?? '');
    const current = {
        title: existing.title, content: existing.content, type: existing.type, icon: existing.icon, color: existing.color,
        isPinned: Boolean(existing.is_pinned), isFavorite: Boolean(existing.is_favorite), archived: Boolean(existing.archived),
        folderId: existing.folder_id
    };
    const next = { ...current, ...Object.fromEntries(['title','type','icon','color','isPinned','isFavorite','archived','folderId']
        .filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]])), content };
    next.title = text(next.title, 500);
    if (!next.title) return json({ error: 'Title is required' }, 400);
    if (next.folderId && !await env.DB.prepare('SELECT id FROM lifeos_note_folders WHERE id=?').bind(next.folderId).first()) return notFound();
    await env.DB.prepare(`UPDATE lifeos_notes SET title=?,content=?,type=?,icon=?,color=?,is_pinned=?,is_favorite=?,word_count=?,archived=?,folder_id=?,updated_at=? WHERE id=?`)
        .bind(next.title, next.content, text(next.type, 30), next.icon ?? null, next.color ?? null,
            next.isPinned ? 1 : 0, next.isFavorite ? 1 : 0, wordCount(next.content), next.archived ? 1 : 0,
            next.folderId || null, timestamp, id).run();
    if (body.tags !== undefined) await setLifeOsNoteTags(env, id, body.tags, timestamp);
    await auditLifeOs(env, actor, 'note.updated', id, { changed: Object.keys(body) });
    return json(await lifeOsNote(env, await env.DB.prepare('SELECT * FROM lifeos_notes WHERE id=?').bind(id).first(), true));
}

function lifeOsHabitLog(row) {
    return { id: row.id, habitId: row.habit_id, date: dateForLifeOs(row.date), count: Number(row.count),
        note: row.note, createdAt: dateForLifeOs(row.created_at) };
}

async function lifeOsHabit(env, row, logLimit = null) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM lifeos_habit_logs WHERE habit_id=?').bind(row.id).first();
    const logs = await env.DB.prepare(`SELECT * FROM lifeos_habit_logs WHERE habit_id=? ORDER BY date DESC${logLimit ? ' LIMIT ?' : ''}`)
        .bind(...(logLimit ? [row.id, logLimit] : [row.id])).all();
    const tags = await env.DB.prepare(`SELECT ht.id,ht.habit_id,ht.tag_id,t.name,t.color FROM lifeos_habit_tags ht
        JOIN lifeos_tags t ON t.id=ht.tag_id WHERE ht.habit_id=?`).bind(row.id).all();
    return {
        id: row.id, name: row.name, description: row.description, icon: row.icon, color: row.color,
        frequency: row.frequency, frequencyConfig: row.frequency_config, targetCount: Number(row.target_count),
        unit: row.unit, reminderEnabled: Boolean(row.reminder_enabled), reminderTime: row.reminder_time,
        gapForgiveness: Number(row.gap_forgiveness), archived: Boolean(row.archived),
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
        tags: (tags.results || []).map(tag => ({ id: tag.id, habitId: tag.habit_id, tagId: tag.tag_id,
            tag: { id: tag.tag_id, name: tag.name, color: tag.color } })),
        logs: (logs.results || []).map(lifeOsHabitLog), _count: { logs: Number(count?.count || 0) }
    };
}

async function handleLifeOsHabits(request, env, url, actor) {
    const path = url.pathname; const timestamp = nowIso();
    if (path === '/api/personal-workbench/lifeos/habits' && request.method === 'GET') {
        const archived = url.searchParams.get('archived');
        const rows = await env.DB.prepare(`SELECT * FROM lifeos_habits ${archived === null ? '' : 'WHERE archived=?'} ORDER BY created_at DESC`)
            .bind(...(archived === null ? [] : [archived === 'true' ? 1 : 0])).all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsHabit(env, row, 30))));
    }
    if (path === '/api/personal-workbench/lifeos/habits' && request.method === 'POST') {
        const body = await bodyOf(request); const name = text(body.name, 200);
        if (!name) return json({ error: 'Name is required' }, 400);
        const id = lifeOsId();
        await env.DB.prepare(`INSERT INTO lifeos_habits (id,name,description,icon,color,frequency,frequency_config,target_count,unit,
            reminder_enabled,reminder_time,gap_forgiveness,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
            .bind(id, name, body.description ?? null, body.icon ?? null, text(body.color, 40) || '#6b7280',
                text(body.frequency, 30) || 'daily', body.frequencyConfig ?? null,
                Number.isInteger(body.targetCount) ? body.targetCount : 1, body.unit ?? null,
                body.reminderEnabled ? 1 : 0, body.reminderTime ?? null,
                Number.isInteger(body.gapForgiveness) ? Math.max(0, body.gapForgiveness) : 0, timestamp, timestamp).run();
        await setLifeOsHabitTags(env, id, body.tags, timestamp);
        await auditLifeOs(env, actor, 'habit.created', id, { name });
        return json(await lifeOsHabit(env, await env.DB.prepare('SELECT * FROM lifeos_habits WHERE id=?').bind(id).first()), 201);
    }
    if (path === '/api/personal-workbench/lifeos/habit-logs' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        if (url.searchParams.has('habitId')) { clauses.push('l.habit_id=?'); bindings.push(url.searchParams.get('habitId')); }
        if (url.searchParams.has('date')) { clauses.push('substr(l.date,1,10)=?'); bindings.push(url.searchParams.get('date')); }
        const rows = await env.DB.prepare(`SELECT l.*,h.name AS habit_name,h.icon AS habit_icon,h.color AS habit_color
            FROM lifeos_habit_logs l JOIN lifeos_habits h ON h.id=l.habit_id WHERE ${clauses.join(' AND ')} ORDER BY l.date DESC`)
            .bind(...bindings).all();
        return json((rows.results || []).map(row => ({ ...lifeOsHabitLog(row), habit: {
            id: row.habit_id, name: row.habit_name, icon: row.habit_icon, color: row.habit_color
        } })));
    }
    if (path === '/api/personal-workbench/lifeos/habit-logs' && request.method === 'POST') {
        const body = await bodyOf(request); const habitId = text(body.habitId, 100);
        if (!habitId) return json({ error: 'habitId is required' }, 400);
        if (!body.date || Number.isNaN(Date.parse(body.date))) return json({ error: 'Invalid date format' }, 400);
        const habit = await env.DB.prepare('SELECT id,name,icon,color FROM lifeos_habits WHERE id=?').bind(habitId).first();
        if (!habit) return notFound();
        const date = new Date(body.date).toISOString().slice(0, 10);
        const existing = await env.DB.prepare('SELECT * FROM lifeos_habit_logs WHERE habit_id=? AND date=?').bind(habitId, date).first();
        const id = existing?.id || lifeOsId();
        if (existing) {
            await env.DB.prepare('UPDATE lifeos_habit_logs SET count=?,note=? WHERE id=?')
                .bind(Number.isInteger(body.count) ? body.count : 1, body.note ?? null, id).run();
        } else {
            await env.DB.prepare('INSERT INTO lifeos_habit_logs (id,habit_id,date,count,note,created_at) VALUES (?,?,?,?,?,?)')
                .bind(id, habitId, date, Number.isInteger(body.count) ? body.count : 1, body.note ?? null, timestamp).run();
        }
        await auditLifeOs(env, actor, existing ? 'habit-log.updated' : 'habit-log.created', id, { habitId, date });
        const row = await env.DB.prepare('SELECT * FROM lifeos_habit_logs WHERE id=?').bind(id).first();
        return json({ ...lifeOsHabitLog(row), habit }, 201);
    }
    const match = path.match(/^\/api\/personal-workbench\/lifeos\/habits\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const id = match[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_habits WHERE id=?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'GET') return json(await lifeOsHabit(env, existing));
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM lifeos_habits WHERE id=?').bind(id).run();
        await auditLifeOs(env, actor, 'habit.deleted', id, { name: existing.name });
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    const properties = {
        name: ['name', v => text(v, 200)], description: ['description', v => v == null ? null : text(v)],
        icon: ['icon', v => v ?? null], color: ['color', v => text(v, 40)], frequency: ['frequency', v => text(v, 30)],
        frequencyConfig: ['frequency_config', v => v ?? null], targetCount: ['target_count', Number], unit: ['unit', v => v ?? null],
        reminderEnabled: ['reminder_enabled', v => v ? 1 : 0], reminderTime: ['reminder_time', v => v ?? null],
        gapForgiveness: ['gap_forgiveness', v => Math.max(0, Number(v))], archived: ['archived', v => v ? 1 : 0]
    };
    const sets = []; const values = [];
    for (const [key, [column, convert]] of Object.entries(properties)) {
        if (body[key] === undefined) continue;
        const value = convert(body[key]);
        if (key === 'name' && !value) return json({ error: 'Name is required' }, 400);
        if (['targetCount','gapForgiveness'].includes(key) && !Number.isFinite(value)) return json({ error: `${key} must be a number` }, 400);
        sets.push(`${column}=?`); values.push(value);
    }
    sets.push('updated_at=?'); values.push(timestamp, id);
    await env.DB.prepare(`UPDATE lifeos_habits SET ${sets.join(',')} WHERE id=?`).bind(...values).run();
    if (body.tags !== undefined) await setLifeOsHabitTags(env, id, body.tags, timestamp);
    await auditLifeOs(env, actor, 'habit.updated', id, { changed: Object.keys(body) });
    return json(await lifeOsHabit(env, await env.DB.prepare('SELECT * FROM lifeos_habits WHERE id=?').bind(id).first(), 30));
}

function lifeOsMilestone(row) {
    return { id: row.id, goalId: row.goal_id, title: row.title, completed: Boolean(row.completed),
        completedAt: dateForLifeOs(row.completed_at), order: Number(row.sort_order),
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at) };
}

async function lifeOsGoal(env, row, detail = false) {
    const [milestones, tagRows, projectRows, childRows] = await Promise.all([
        env.DB.prepare('SELECT * FROM lifeos_milestones WHERE goal_id=? ORDER BY sort_order ASC').bind(row.id).all(),
        env.DB.prepare(`SELECT gt.id,gt.goal_id,gt.tag_id,t.name,t.color FROM lifeos_goal_tags gt
            JOIN lifeos_tags t ON t.id=gt.tag_id WHERE gt.goal_id=?`).bind(row.id).all(),
        env.DB.prepare(`SELECT gp.id,gp.goal_id,gp.project_id,p.title,p.color,p.source_id,p.id AS internal_project_id FROM lifeos_goal_projects gp
            JOIN personal_workbench_lifeos_projects p ON COALESCE(p.source_id,CAST(p.id AS TEXT))=gp.project_id WHERE gp.goal_id=?`).bind(row.id).all(),
        env.DB.prepare('SELECT * FROM lifeos_goals WHERE parent_goal_id=?').bind(row.id).all()
    ]);
    const result = {
        id: row.id, title: row.title, description: row.description, category: row.category, status: row.status,
        progress: Number(row.progress), startDate: dateForLifeOs(row.start_date), targetDate: dateForLifeOs(row.target_date),
        completedAt: dateForLifeOs(row.completed_at), archived: Boolean(row.archived), parentGoalId: row.parent_goal_id,
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
        tags: (tagRows.results || []).map(tag => ({ id: tag.id, goalId: tag.goal_id, tagId: tag.tag_id,
            tag: { id: tag.tag_id, name: tag.name, color: tag.color } })),
        milestones: (milestones.results || []).map(lifeOsMilestone),
        projects: (projectRows.results || []).map(project => ({ id: project.id, goalId: project.goal_id,
            projectId: project.source_id || project.project_id, project: { id: project.source_id || project.project_id, name: project.title, color: project.color } })),
        subgoals: await Promise.all((childRows.results || []).map(async child => ({ ...await lifeOsGoal(env, child), parentGoalId: child.parent_goal_id })))
    };
    if (detail) {
        result.parentGoal = row.parent_goal_id
            ? await env.DB.prepare('SELECT * FROM lifeos_goals WHERE id=?').bind(row.parent_goal_id).first()
                .then(parent => parent ? lifeOsGoal(env, parent) : null)
            : null;
    }
    return result;
}

async function handleLifeOsGoals(request, env, url, actor) {
    const path = url.pathname; const timestamp = nowIso();
    if (path === '/api/personal-workbench/lifeos/goals' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        for (const key of ['category','status']) if (url.searchParams.has(key)) { clauses.push(`${key}=?`); bindings.push(url.searchParams.get(key)); }
        if (url.searchParams.has('archived')) { clauses.push('archived=?'); bindings.push(url.searchParams.get('archived') === 'true' ? 1 : 0); }
        const rows = await env.DB.prepare(`SELECT * FROM lifeos_goals WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`).bind(...bindings).all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsGoal(env, row))));
    }
    if (path === '/api/personal-workbench/lifeos/goals' && request.method === 'POST') {
        const body = await bodyOf(request); const title = text(body.title, 500);
        if (!title) return json({ error: 'Title is required' }, 400);
        const id = lifeOsId();
        const parseDate = value => value == null || value === '' ? null : (Number.isNaN(Date.parse(value)) ? undefined : new Date(value).toISOString());
        const startDate = parseDate(body.startDate); const targetDate = parseDate(body.targetDate);
        if (startDate === undefined || targetDate === undefined) return json({ error: 'Invalid date format' }, 400);
        const parentId = body.parentGoalId || null;
        if (parentId && !await env.DB.prepare('SELECT id FROM lifeos_goals WHERE id=?').bind(parentId).first()) return notFound();
        await env.DB.prepare(`INSERT INTO lifeos_goals (id,title,description,category,status,progress,start_date,target_date,
            completed_at,archived,parent_goal_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,0,?,?,?)`)
            .bind(id, title, body.description ?? null, text(body.category, 40) || 'personal',
                text(body.status, 40) || 'not-started', Number.isInteger(body.progress) ? body.progress : 0,
                startDate, targetDate, parentId, timestamp, timestamp).run();
        if (Array.isArray(body.milestones)) {
            for (const [index, milestone] of body.milestones.entries()) {
                const milestoneTitle = text(milestone?.title, 500);
                if (!milestoneTitle) continue;
                await env.DB.prepare(`INSERT INTO lifeos_milestones (id,goal_id,title,completed,completed_at,sort_order,created_at,updated_at)
                    VALUES (?,?,?,0,NULL,?,?,?)`).bind(lifeOsId(), id, milestoneTitle,
                    Number.isInteger(milestone.order) ? milestone.order : index, timestamp, timestamp).run();
            }
        }
        await auditLifeOs(env, actor, 'goal.created', id, { title });
        return json(await lifeOsGoal(env, await env.DB.prepare('SELECT * FROM lifeos_goals WHERE id=?').bind(id).first()), 201);
    }
    const match = path.match(/^\/api\/personal-workbench\/lifeos\/goals\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const id = match[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_goals WHERE id=?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'GET') return json(await lifeOsGoal(env, existing, true));
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM lifeos_goals WHERE id=?').bind(id).run();
        await auditLifeOs(env, actor, 'goal.deleted', id);
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    const parseDate = (key, old) => body[key] === undefined ? old : (body[key] == null || body[key] === '' ? null :
        (Number.isNaN(Date.parse(body[key])) ? undefined : new Date(body[key]).toISOString()));
    const startDate = parseDate('startDate', existing.start_date); const targetDate = parseDate('targetDate', existing.target_date);
    if (startDate === undefined || targetDate === undefined) return json({ error: 'Invalid date format' }, 400);
    const title = body.title === undefined ? existing.title : text(body.title, 500);
    if (!title) return json({ error: 'Title is required' }, 400);
    const status = body.status === undefined ? existing.status : text(body.status, 40);
    const progress = Number.isInteger(body.progress) ? body.progress : Number(existing.progress);
    const completedAt = body.completedAt === undefined ? (status === 'completed' && existing.status !== 'completed' ? timestamp : existing.completed_at)
        : parseDate('completedAt', existing.completed_at);
    if (completedAt === undefined) return json({ error: 'Invalid date format' }, 400);
    await env.DB.prepare(`UPDATE lifeos_goals SET title=?,description=?,category=?,status=?,progress=?,start_date=?,target_date=?,
        completed_at=?,archived=?,updated_at=? WHERE id=?`).bind(title,
        body.description === undefined ? existing.description : body.description,
        body.category === undefined ? existing.category : text(body.category, 40), status, progress, startDate, targetDate,
        completedAt, body.archived === undefined ? existing.archived : (body.archived ? 1 : 0), timestamp, id).run();
    if (Array.isArray(body.milestones)) {
        for (const [index, milestone] of body.milestones.entries()) {
            const milestoneTitle = text(milestone?.title, 500);
            if (!milestoneTitle) continue;
            const completed = Boolean(milestone.completed);
            const milestoneId = typeof milestone.id === 'string' ? milestone.id : lifeOsId();
            const found = await env.DB.prepare('SELECT id FROM lifeos_milestones WHERE id=? AND goal_id=?').bind(milestoneId, id).first();
            if (found) {
                await env.DB.prepare(`UPDATE lifeos_milestones SET title=?,completed=?,completed_at=?,updated_at=? WHERE id=? AND goal_id=?`)
                    .bind(milestoneTitle, completed ? 1 : 0, completed ? timestamp : null, timestamp, milestoneId, id).run();
            } else {
                await env.DB.prepare(`INSERT INTO lifeos_milestones (id,goal_id,title,completed,completed_at,sort_order,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?)`).bind(milestoneId, id, milestoneTitle, completed ? 1 : 0,
                    completed ? timestamp : null, Number.isInteger(milestone.order) ? milestone.order : index, timestamp, timestamp).run();
            }
        }
    }
    await auditLifeOs(env, actor, 'goal.updated', id, { changed: Object.keys(body) });
    return json(await lifeOsGoal(env, await env.DB.prepare('SELECT * FROM lifeos_goals WHERE id=?').bind(id).first()));
}

async function lifeOsJournalTags(env, entryId) {
    const rows = await env.DB.prepare(`SELECT jt.id,jt.entry_id,jt.tag_id,t.name,t.color FROM lifeos_journal_tags jt
        JOIN lifeos_tags t ON t.id=jt.tag_id WHERE jt.entry_id=?`).bind(entryId).all();
    return (rows.results || []).map(row => ({ id: row.id, entryId: row.entry_id, tagId: row.tag_id,
        tag: { id: row.tag_id, name: row.name, color: row.color } }));
}

async function lifeOsJournalEntry(env, row) {
    return { id: row.id, title: row.title, content: row.content, mood: row.mood,
        moodScore: row.mood_score === null ? null : Number(row.mood_score),
        energy: row.energy === null ? null : Number(row.energy), stress: row.stress === null ? null : Number(row.stress),
        gratitude: row.gratitude, tags: row.tags, isFavorite: Boolean(row.is_favorite),
        date: dateForLifeOs(row.date), createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
        entryTags: await lifeOsJournalTags(env, row.id) };
}

async function handleLifeOsJournal(request, env, url, actor) {
    const path = url.pathname; const timestamp = nowIso();
    if (path === '/api/personal-workbench/lifeos/journal' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        if (url.searchParams.has('mood')) { clauses.push('mood=?'); bindings.push(url.searchParams.get('mood')); }
        if (url.searchParams.has('isFavorite')) { clauses.push('is_favorite=?'); bindings.push(url.searchParams.get('isFavorite') === 'true' ? 1 : 0); }
        const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM lifeos_journal_entries WHERE ${clauses.join(' AND ')}`).bind(...bindings).first();
        const limitValue = Number.parseInt(url.searchParams.get('limit') || '50', 10);
        const offsetValue = Number.parseInt(url.searchParams.get('offset') || '0', 10);
        const limit = Number.isFinite(limitValue) ? limitValue : 50; const offset = Number.isFinite(offsetValue) ? offsetValue : 0;
        const rows = await env.DB.prepare(`SELECT * FROM lifeos_journal_entries WHERE ${clauses.join(' AND ')} ORDER BY date DESC LIMIT ? OFFSET ?`)
            .bind(...bindings, limit, offset).all();
        return json({ entries: await Promise.all((rows.results || []).map(row => lifeOsJournalEntry(env, row))), total: Number(count?.total || 0) });
    }
    if (path === '/api/personal-workbench/lifeos/journal' && request.method === 'POST') {
        const body = await bodyOf(request); const id = lifeOsId();
        const parseDate = value => value == null || value === '' || Number.isNaN(Date.parse(value)) ? timestamp : new Date(value).toISOString();
        await env.DB.prepare(`INSERT INTO lifeos_journal_entries (id,title,content,mood,mood_score,energy,stress,gratitude,tags,
            is_favorite,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
            id, body.title ? text(body.title, 500) : null, typeof body.content === 'string' ? body.content : '',
            body.mood ? text(body.mood, 40) : null, Number.isInteger(body.moodScore) ? body.moodScore : null,
            Number.isInteger(body.energy) ? body.energy : null, Number.isInteger(body.stress) ? body.stress : null,
            body.gratitude ? String(body.gratitude) : null, body.tags ? String(body.tags) : null,
            body.isFavorite ? 1 : 0, parseDate(body.date), timestamp, timestamp).run();
        await auditLifeOs(env, actor, 'journal.created', id);
        return json(await lifeOsJournalEntry(env, await env.DB.prepare('SELECT * FROM lifeos_journal_entries WHERE id=?').bind(id).first()), 201);
    }
    const match = path.match(/^\/api\/personal-workbench\/lifeos\/journal\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const id = match[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_journal_entries WHERE id=?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'GET') return json(await lifeOsJournalEntry(env, existing));
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM lifeos_journal_entries WHERE id=?').bind(id).run();
        await auditLifeOs(env, actor, 'journal.deleted', id);
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    const nullable = (key, previous) => body[key] === undefined ? previous : body[key] === null ? null : body[key];
    const date = body.date === undefined ? existing.date : (body.date === null ? null :
        (Number.isNaN(Date.parse(body.date)) ? existing.date : new Date(body.date).toISOString()));
    const patchNum = (key, previous) => body[key] === undefined ? previous : (Number.isInteger(body[key]) ? body[key] : null);
    await env.DB.prepare(`UPDATE lifeos_journal_entries SET title=?,content=?,mood=?,mood_score=?,energy=?,stress=?,gratitude=?,tags=?,
        is_favorite=?,date=?,updated_at=? WHERE id=?`).bind(
        nullable('title', existing.title), body.content === undefined ? existing.content : String(body.content ?? ''),
        nullable('mood', existing.mood), patchNum('moodScore', existing.mood_score), patchNum('energy', existing.energy),
        patchNum('stress', existing.stress), nullable('gratitude', existing.gratitude), nullable('tags', existing.tags),
        body.isFavorite === undefined ? existing.is_favorite : (body.isFavorite ? 1 : 0), date, timestamp, id).run();
    await auditLifeOs(env, actor, 'journal.updated', id, { changed: Object.keys(body) });
    return json(await lifeOsJournalEntry(env, await env.DB.prepare('SELECT * FROM lifeos_journal_entries WHERE id=?').bind(id).first()));
}

function lifeOsTask(row, projectSourceId = null) {
    return {
        id: row.id, title: row.title, description: row.description,
        status: row.status, priority: row.priority, dueDate: row.due_date,
        startDate: row.start_date, completedAt: row.completed_at,
        estimatedMinutes: row.estimated_minutes === null ? null : Number(row.estimated_minutes),
        actualMinutes: row.actual_minutes === null ? null : Number(row.actual_minutes),
        recurrence: row.recurrence, recurrenceConfig: row.recurrence_config,
        position: Number(row.position), archived: Boolean(row.archived),
        createdAt: row.created_at, updatedAt: row.updated_at,
        projectId: row.project_id === null ? null : (projectSourceId || String(row.project_id)),
        parentTaskId: row.parent_task_id
    };
}

async function lifeOsTaskWithProjectId(env, row) {
    if (!row) return null;
    if (row.project_id == null) return lifeOsTask(row);
    const project = await env.DB.prepare('SELECT source_id FROM personal_workbench_lifeos_projects WHERE id=?').bind(row.project_id).first();
    return lifeOsTask(row, project?.source_id || null);
}

function lifeOsTaskTagNames(value) {
    const names = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
    return [...new Set(names.map(name => text(name, 120)).filter(Boolean))];
}

async function setLifeOsTaskTags(env, taskId, value, timestamp = nowIso()) {
    const names = lifeOsTaskTagNames(value);
    const current = await env.DB.prepare('SELECT id FROM lifeos_task_tags WHERE task_id=?').bind(taskId).all();
    const statements = (current.results || []).map(row => env.DB.prepare('DELETE FROM lifeos_task_tags WHERE id=?').bind(row.id));
    for (const name of names) {
        const tagId = lifeOsId();
        statements.push(env.DB.prepare(`INSERT INTO lifeos_tags (id,name,color,created_at,updated_at)
            SELECT ?,?,'#6b7280',?,? WHERE NOT EXISTS (SELECT 1 FROM lifeos_tags WHERE name=?)`)
            .bind(tagId, name, timestamp, timestamp, name));
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO lifeos_task_tags (id,task_id,tag_id)
            SELECT ?,?,id FROM lifeos_tags WHERE name=?`).bind(lifeOsId(), taskId, name));
    }
    if (statements.length) await env.DB.batch(statements);
}

async function lifeOsTaskWithTags(env, row) {
    const [links, subtasks, project, count] = await Promise.all([
        env.DB.prepare(`SELECT tt.id,tt.task_id,tt.tag_id,t.name,t.color,t.created_at,t.updated_at
            FROM lifeos_task_tags tt JOIN lifeos_tags t ON t.id=tt.tag_id WHERE tt.task_id=? ORDER BY t.name`)
            .bind(row.id).all(),
        env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE parent_task_id=? ORDER BY position,created_at')
            .bind(row.id).all(),
        row.project_id == null ? null : env.DB.prepare('SELECT id,source_id,title,color FROM personal_workbench_lifeos_projects WHERE id=?')
            .bind(row.project_id).first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM personal_workbench_lifeos_tasks WHERE parent_task_id=?')
            .bind(row.id).first()
    ]);
    return {
        ...lifeOsTask(row, project?.source_id || null),
        project: project ? { id: project.source_id || String(project.id), name: project.title, color: project.color } : null,
        tags: (links.results || []).map(tag => ({
            id: tag.id, taskId: tag.task_id, tagId: tag.tag_id,
            tag: { id: tag.tag_id, name: tag.name, color: tag.color,
                createdAt: dateForLifeOs(tag.created_at), updatedAt: dateForLifeOs(tag.updated_at) }
        })),
        subtasks: await Promise.all((subtasks.results || []).map(task => lifeOsTaskWithProjectId(env, task))),
        _count: { subtasks: Number(count?.count || 0) }
    };
}

async function lifeOsTaskDetail(env, row) {
    const [task, dependencies, dependents, timeEntries, eventRows] = await Promise.all([
        lifeOsTaskWithTags(env, row),
        env.DB.prepare(`SELECT d.* FROM lifeos_task_dependencies d WHERE d.task_id=? ORDER BY d.id`).bind(row.id).all(),
        env.DB.prepare(`SELECT d.* FROM lifeos_task_dependencies d WHERE d.depends_on_id=? ORDER BY d.id`).bind(row.id).all(),
        env.DB.prepare('SELECT * FROM lifeos_time_entries WHERE task_id=? ORDER BY start_time DESC').bind(row.id).all(),
        env.DB.prepare('SELECT id FROM lifeos_calendar_events WHERE task_id=? ORDER BY start_date').bind(row.id).all()
    ]);
    const dependentRows = await Promise.all((dependencies.results || []).map(link =>
        env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE id=?').bind(link.depends_on_id).first()));
    const taskRows = await Promise.all((dependents.results || []).map(link =>
        env.DB.prepare('SELECT * FROM personal_workbench_lifeos_tasks WHERE id=?').bind(link.task_id).first()));
    return {
        ...task,
        dependencies: (await Promise.all((dependencies.results || []).map(async (link, index) => dependentRows[index] ? ({
            id: link.id, taskId: link.task_id, dependsOnId: link.depends_on_id,
            dependsOn: await lifeOsTaskWithProjectId(env, dependentRows[index])
        }) : null))).filter(Boolean),
        dependents: (await Promise.all((dependents.results || []).map(async (link, index) => taskRows[index] ? ({
            id: link.id, taskId: link.task_id, dependsOnId: link.depends_on_id,
            task: await lifeOsTaskWithProjectId(env, taskRows[index])
        }) : null))).filter(Boolean),
        timeEntries: await Promise.all((timeEntries.results || []).map(entry => lifeOsTimedRecord(env, entry, 'time'))),
        calendarEvents: await Promise.all((eventRows.results || []).map(event => getLifeOsEvent(env, event.id)))
    };
}

function lifeOsEvent(row, task = null) {
    return {
        id: row.id, title: row.title, description: row.description,
        startDate: dateForLifeOs(row.start_date), endDate: dateForLifeOs(row.end_date),
        allDay: Boolean(row.all_day), color: row.color, location: row.location,
        recurrence: row.recurrence, recurrenceConfig: row.recurrence_config,
        taskId: row.task_id, createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at), task
    };
}

async function getLifeOsEvent(env, id) {
    const row = await env.DB.prepare('SELECT * FROM lifeos_calendar_events WHERE id=?').bind(id).first();
    if (!row) return null;
    const task = row.task_id ? await env.DB.prepare('SELECT id,title,status FROM personal_workbench_lifeos_tasks WHERE id=?')
        .bind(row.task_id).first() : null;
    return lifeOsEvent(row, task);
}

function parseLifeOsDate(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function handleLifeOsEvents(request, env, url, actor) {
    const path = url.pathname;
    if (path === '/api/personal-workbench/lifeos/events' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        for (const [param, operator] of [['startDate', '>='], ['endDate', '<=']]) {
            if (!url.searchParams.has(param)) continue;
            const rawDate = url.searchParams.get(param);
            const date = param === 'endDate' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
                ? `${rawDate}T23:59:59.999Z` : parseLifeOsDate(rawDate);
            if (date !== undefined) { clauses.push(`start_date ${operator} ?`); bindings.push(date); }
        }
        const limit = Number.isFinite(Number(url.searchParams.get('limit'))) ? Math.trunc(Number(url.searchParams.get('limit'))) : 50;
        const offset = Number.isFinite(Number(url.searchParams.get('offset'))) ? Math.trunc(Number(url.searchParams.get('offset'))) : 0;
        const where = clauses.join(' AND ');
        const [total, rows] = await Promise.all([
            env.DB.prepare(`SELECT COUNT(*) AS count FROM lifeos_calendar_events WHERE ${where}`).bind(...bindings).first(),
            env.DB.prepare(`SELECT * FROM lifeos_calendar_events WHERE ${where} ORDER BY start_date ASC LIMIT ? OFFSET ?`)
                .bind(...bindings, limit, offset).all()
        ]);
        return json({ events: await Promise.all((rows.results || []).map(row => getLifeOsEvent(env, row.id))), total: Number(total?.count || 0) });
    }
    if (path === '/api/personal-workbench/lifeos/events' && request.method === 'POST') {
        const body = await bodyOf(request); const title = text(body.title, 500);
        const startDate = parseLifeOsDate(body.startDate);
        const endDate = body.endDate == null || body.endDate === '' ? null : parseLifeOsDate(body.endDate);
        if (!title) return json({ error: 'Title is required' }, 400);
        if (startDate === undefined || (body.endDate != null && body.endDate !== '' && endDate === undefined)) return json({ error: 'startDate is required or date format is invalid' }, 400);
        const taskId = body.taskId || null;
        if (taskId && !await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id=?').bind(taskId).first()) return notFound();
        const id = lifeOsId(); const timestamp = nowIso();
        await env.DB.prepare(`INSERT INTO lifeos_calendar_events
            (id,title,description,start_date,end_date,all_day,color,location,recurrence,recurrence_config,task_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, title, body.description ?? null, startDate, endDate,
            body.allDay ? 1 : 0, text(body.color, 40) || '#6b7280', body.location ?? null,
            body.recurrence || null, body.recurrenceConfig || null, taskId, timestamp, timestamp).run();
        await auditLifeOs(env, actor, 'calendar-event.created', id, { title, taskId });
        return json(await getLifeOsEvent(env, id), 201);
    }
    const match = path.match(/^\/api\/personal-workbench\/lifeos\/events\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const id = match[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_calendar_events WHERE id=?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'GET') return json(await getLifeOsEvent(env, id));
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM lifeos_calendar_events WHERE id=?').bind(id).run();
        await auditLifeOs(env, actor, 'calendar-event.deleted', id);
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    const title = body.title === undefined ? existing.title : text(body.title, 500);
    if (!title) return json({ error: 'Title is required' }, 400);
    const updateDate = (key, oldValue) => body[key] === undefined ? oldValue : (body[key] == null || body[key] === '' ? null : parseLifeOsDate(body[key]));
    const startDate = updateDate('startDate', existing.start_date); const endDate = updateDate('endDate', existing.end_date);
    if (startDate === undefined || (body.endDate !== undefined && body.endDate != null && body.endDate !== '' && endDate === undefined)) return json({ error: 'Invalid date format' }, 400);
    const taskId = body.taskId === undefined ? existing.task_id : (body.taskId || null);
    if (taskId && !await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id=?').bind(taskId).first()) return notFound();
    await env.DB.prepare(`UPDATE lifeos_calendar_events SET title=?,description=?,start_date=?,end_date=?,all_day=?,color=?,location=?,
        recurrence=?,recurrence_config=?,task_id=?,updated_at=? WHERE id=?`).bind(
        title, body.description === undefined ? existing.description : body.description, startDate, endDate,
        body.allDay === undefined ? existing.all_day : (body.allDay ? 1 : 0),
        body.color === undefined ? existing.color : text(body.color, 40),
        body.location === undefined ? existing.location : body.location,
        body.recurrence === undefined ? existing.recurrence : body.recurrence,
        body.recurrenceConfig === undefined ? existing.recurrence_config : body.recurrenceConfig,
        taskId, nowIso(), id).run();
    await auditLifeOs(env, actor, 'calendar-event.updated', id, { changed: Object.keys(body) });
    return json(await getLifeOsEvent(env, id));
}

async function lifeOsCourse(env, row) {
    const resources = await env.DB.prepare('SELECT * FROM lifeos_course_resources WHERE course_id=? ORDER BY sort_order ASC')
        .bind(row.id).all();
    const mapped = (resources.results || []).map(resource => ({
        id: resource.id, courseId: resource.course_id, title: resource.title, type: resource.type,
        url: resource.url, completed: Boolean(resource.completed), notes: resource.notes,
        order: Number(resource.sort_order), createdAt: dateForLifeOs(resource.created_at), updatedAt: dateForLifeOs(resource.updated_at)
    }));
    return {
        id: row.id, title: row.title, description: row.description, provider: row.provider, url: row.url,
        status: row.status, progress: Number(row.progress), startDate: dateForLifeOs(row.start_date),
        endDate: dateForLifeOs(row.end_date), rating: row.rating == null ? null : Number(row.rating), notes: row.notes,
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
        resources: mapped, _count: { resources: mapped.length }
    };
}

async function handleLifeOsCourses(request, env, url, actor) {
    const path = url.pathname; const timestamp = nowIso();
    if (path === '/api/personal-workbench/lifeos/courses' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        for (const key of ['status', 'provider']) if (url.searchParams.has(key)) {
            clauses.push(`${key}=?`); bindings.push(url.searchParams.get(key));
        }
        const rows = await env.DB.prepare(`SELECT * FROM lifeos_courses WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
            .bind(...bindings).all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsCourse(env, row))));
    }
    if (path === '/api/personal-workbench/lifeos/courses' && request.method === 'POST') {
        const body = await bodyOf(request); const title = text(body.title, 500);
        if (!title) return json({ error: 'Title is required' }, 400);
        const id = lifeOsId();
        const startDate = body.startDate == null || body.startDate === '' ? null : parseLifeOsDate(body.startDate);
        const endDate = body.endDate == null || body.endDate === '' ? null : parseLifeOsDate(body.endDate);
        if ((body.startDate && !startDate) || (body.endDate && !endDate)) return json({ error: 'Invalid date format' }, 400);
        const progress = Number.isInteger(body.progress) ? body.progress : 0;
        if (progress < 0 || progress > 100) return json({ error: 'Progress must be between 0 and 100' }, 400);
        const statements = [env.DB.prepare(`INSERT INTO lifeos_courses
            (id,title,description,provider,url,status,progress,start_date,end_date,rating,notes,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, title, body.description ?? null, body.provider ?? null,
            body.url ?? null, text(body.status, 40) || 'not-started', progress, startDate, endDate,
            Number.isInteger(body.rating) ? body.rating : null, body.notes ?? null, timestamp, timestamp)];
        if (Array.isArray(body.resources)) for (const [index, resource] of body.resources.entries()) {
            const resourceTitle = text(resource?.title, 500);
            if (!resourceTitle) continue;
            statements.push(env.DB.prepare(`INSERT INTO lifeos_course_resources
                (id,course_id,title,type,url,completed,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
                .bind(lifeOsId(), id, resourceTitle, text(resource.type, 40) || 'video', resource.url ?? null,
                    resource.completed ? 1 : 0, resource.notes ?? null, Number.isInteger(resource.order) ? resource.order : index,
                    timestamp, timestamp));
        }
        await env.DB.batch(statements);
        await auditLifeOs(env, actor, 'course.created', id, { title });
        return json(await lifeOsCourse(env, await env.DB.prepare('SELECT * FROM lifeos_courses WHERE id=?').bind(id).first()), 201);
    }
    const match = path.match(/^\/api\/personal-workbench\/lifeos\/courses\/([a-zA-Z0-9-]+)$/);
    if (!match) return null;
    const id = match[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_courses WHERE id=?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'GET') return json(await lifeOsCourse(env, existing));
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM lifeos_courses WHERE id=?').bind(id).run();
        await auditLifeOs(env, actor, 'course.deleted', id);
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    const values = {
        title: body.title === undefined ? existing.title : text(body.title, 500),
        description: body.description === undefined ? existing.description : body.description,
        provider: body.provider === undefined ? existing.provider : body.provider,
        url: body.url === undefined ? existing.url : body.url,
        status: body.status === undefined ? existing.status : text(body.status, 40),
        progress: body.progress === undefined ? Number(existing.progress) : Number(body.progress),
        startDate: body.startDate === undefined ? existing.start_date : (body.startDate == null || body.startDate === '' ? null : parseLifeOsDate(body.startDate)),
        endDate: body.endDate === undefined ? existing.end_date : (body.endDate == null || body.endDate === '' ? null : parseLifeOsDate(body.endDate)),
        rating: body.rating === undefined ? existing.rating : body.rating,
        notes: body.notes === undefined ? existing.notes : body.notes
    };
    if (!values.title) return json({ error: 'Title is required' }, 400);
    if (!Number.isInteger(values.progress) || values.progress < 0 || values.progress > 100) return json({ error: 'Progress must be between 0 and 100' }, 400);
    if ((body.startDate !== undefined && body.startDate && !values.startDate) || (body.endDate !== undefined && body.endDate && !values.endDate)) return json({ error: 'Invalid date format' }, 400);
    if (values.rating != null && (!Number.isInteger(Number(values.rating)) || Number(values.rating) < 1 || Number(values.rating) > 5)) return json({ error: 'Rating must be between 1 and 5' }, 400);
    const statements = [env.DB.prepare(`UPDATE lifeos_courses SET title=?,description=?,provider=?,url=?,status=?,progress=?,
        start_date=?,end_date=?,rating=?,notes=?,updated_at=? WHERE id=?`).bind(
        values.title, values.description, values.provider, values.url, values.status, values.progress,
        values.startDate, values.endDate, values.rating, values.notes, timestamp, id)];
    if (Array.isArray(body.resources)) {
        const existingResources = await env.DB.prepare('SELECT id FROM lifeos_course_resources WHERE course_id=?').bind(id).all();
        const existingIds = new Set((existingResources.results || []).map(resource => resource.id));
        const incomingIds = new Set(body.resources.map(resource => resource?.id).filter(value => existingIds.has(value)));
        for (const resource of existingResources.results || []) if (!incomingIds.has(resource.id)) {
            statements.push(env.DB.prepare('DELETE FROM lifeos_course_resources WHERE id=? AND course_id=?').bind(resource.id, id));
        }
        for (const [index, resource] of body.resources.entries()) {
            const title = text(resource?.title, 500); if (!title) continue;
            const resourceId = existingIds.has(resource.id) ? resource.id : lifeOsId();
            statements.push(env.DB.prepare(`INSERT INTO lifeos_course_resources
                (id,course_id,title,type,url,completed,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title,type=excluded.type,url=excluded.url,
                completed=excluded.completed,notes=excluded.notes,sort_order=excluded.sort_order,updated_at=excluded.updated_at`)
                .bind(resourceId, id, title, text(resource.type, 40) || 'video', resource.url ?? null,
                    resource.completed ? 1 : 0, resource.notes ?? null, Number.isInteger(resource.order) ? resource.order : index,
                    timestamp, timestamp));
        }
    }
    await env.DB.batch(statements);
    await auditLifeOs(env, actor, 'course.updated', id, { changed: Object.keys(body) });
    return json(await lifeOsCourse(env, await env.DB.prepare('SELECT * FROM lifeos_courses WHERE id=?').bind(id).first()));
}

async function lifeOsTimedRecord(env, row, kind) {
    const task = row.task_id ? await env.DB.prepare('SELECT id,title,status FROM personal_workbench_lifeos_tasks WHERE id=?').bind(row.task_id).first() : null;
    if (kind === 'time') return {
        id: row.id, description: row.description, startTime: dateForLifeOs(row.start_time), endTime: dateForLifeOs(row.end_time),
        duration: row.duration == null ? null : Number(row.duration), billable: Boolean(row.billable), taskId: row.task_id,
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at), task
    };
    return {
        id: row.id, type: row.type, duration: Number(row.duration), completed: Boolean(row.completed), taskId: row.task_id,
        startedAt: dateForLifeOs(row.started_at), completedAt: dateForLifeOs(row.completed_at),
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at), task
    };
}

async function handleLifeOsFocus(request, env, url, actor) {
    const path = url.pathname; const timestamp = nowIso();
    if (path === '/api/personal-workbench/lifeos/time-entries' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        if (url.searchParams.has('taskId')) { clauses.push('task_id=?'); bindings.push(url.searchParams.get('taskId')); }
        if (url.searchParams.get('isRunning') === 'true') clauses.push('end_time IS NULL');
        const rows = await env.DB.prepare(`SELECT * FROM lifeos_time_entries WHERE ${clauses.join(' AND ')} ORDER BY start_time DESC`).bind(...bindings).all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsTimedRecord(env, row, 'time'))));
    }
    if (path === '/api/personal-workbench/lifeos/time-entries' && request.method === 'POST') {
        const body = await bodyOf(request); const description = text(body.description, 1000);
        if (!description) return json({ error: 'Description is required' }, 400);
        const startTime = body.startTime == null || body.startTime === '' ? timestamp : parseLifeOsDate(body.startTime);
        const endTime = body.endTime == null || body.endTime === '' ? null : parseLifeOsDate(body.endTime);
        if (!startTime || (body.endTime && !endTime)) return json({ error: 'Invalid date format' }, 400);
        const taskId = body.taskId || null;
        if (taskId && !await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id=?').bind(taskId).first()) return notFound();
        const id = lifeOsId();
        await env.DB.prepare(`INSERT INTO lifeos_time_entries (id,description,start_time,end_time,duration,billable,task_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, description, startTime, endTime,
            Number.isInteger(body.duration) ? body.duration : null, body.billable ? 1 : 0, taskId, timestamp, timestamp).run();
        await auditLifeOs(env, actor, 'time-entry.created', id, { taskId });
        return json(await lifeOsTimedRecord(env, await env.DB.prepare('SELECT * FROM lifeos_time_entries WHERE id=?').bind(id).first(), 'time'), 201);
    }
    if (path === '/api/personal-workbench/lifeos/time-entries' && request.method === 'PATCH') {
        const body = await bodyOf(request); const id = text(body.id, 100);
        if (!id) return json({ error: 'id is required' }, 400);
        const existing = await env.DB.prepare('SELECT * FROM lifeos_time_entries WHERE id=?').bind(id).first();
        if (!existing) return notFound();
        const endTime = body.endTime == null || body.endTime === '' ? timestamp : parseLifeOsDate(body.endTime);
        if (!endTime) return json({ error: 'Invalid date format' }, 400);
        const duration = Number.isInteger(body.duration) ? body.duration : Math.floor((Date.parse(endTime) - Date.parse(existing.start_time)) / 60000);
        await env.DB.prepare('UPDATE lifeos_time_entries SET end_time=?,duration=?,updated_at=? WHERE id=?').bind(endTime, duration, timestamp, id).run();
        await auditLifeOs(env, actor, 'time-entry.stopped', id);
        return json(await lifeOsTimedRecord(env, await env.DB.prepare('SELECT * FROM lifeos_time_entries WHERE id=?').bind(id).first(), 'time'));
    }
    const timeMatch = path.match(/^\/api\/personal-workbench\/lifeos\/time-entries\/([a-zA-Z0-9-]+)$/);
    if (timeMatch && request.method === 'DELETE') {
        const result = await env.DB.prepare('DELETE FROM lifeos_time_entries WHERE id=?').bind(timeMatch[1]).run();
        if (!result.meta?.changes) return notFound();
        await auditLifeOs(env, actor, 'time-entry.deleted', timeMatch[1]);
        return json({ success: true });
    }
    if (path === '/api/personal-workbench/lifeos/pomodoro-sessions' && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        for (const key of ['type', 'taskId']) if (url.searchParams.has(key)) { clauses.push(`${key === 'taskId' ? 'task_id' : key}=?`); bindings.push(url.searchParams.get(key)); }
        if (url.searchParams.has('completed')) { clauses.push('completed=?'); bindings.push(url.searchParams.get('completed') === 'true' ? 1 : 0); }
        if (url.searchParams.has('date')) {
            const day = url.searchParams.get('date');
            if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
                clauses.push('started_at>=? AND started_at<?');
                bindings.push(`${day}T00:00:00.000Z`, new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86400000).toISOString());
            }
        }
        const rows = await env.DB.prepare(`SELECT * FROM lifeos_pomodoro_sessions WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC`).bind(...bindings).all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsTimedRecord(env, row, 'pomodoro'))));
    }
    if (path === '/api/personal-workbench/lifeos/pomodoro-sessions' && request.method === 'POST') {
        const body = await bodyOf(request); const duration = Number(body.duration);
        if (!Number.isInteger(duration) || duration <= 0) return json({ error: 'Duration is required and must be positive' }, 400);
        const startedAt = body.startedAt == null || body.startedAt === '' ? timestamp : parseLifeOsDate(body.startedAt);
        if (!startedAt) return json({ error: 'Invalid date format' }, 400);
        const taskId = body.taskId || null;
        if (taskId && !await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id=?').bind(taskId).first()) return notFound();
        const id = lifeOsId();
        await env.DB.prepare(`INSERT INTO lifeos_pomodoro_sessions (id,type,duration,completed,task_id,started_at,completed_at,created_at,updated_at)
            VALUES (?,?,?,0,?,?,NULL,?,?)`).bind(id, text(body.type, 40) || 'focus', duration, taskId, startedAt, timestamp, timestamp).run();
        await auditLifeOs(env, actor, 'pomodoro.created', id, { taskId });
        return json(await lifeOsTimedRecord(env, await env.DB.prepare('SELECT * FROM lifeos_pomodoro_sessions WHERE id=?').bind(id).first(), 'pomodoro'), 201);
    }
    const pomoMatch = path.match(/^\/api\/personal-workbench\/lifeos\/pomodoro-sessions\/([a-zA-Z0-9-]+)$/);
    if (!pomoMatch) return null;
    const id = pomoMatch[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_pomodoro_sessions WHERE id=?').bind(id).first();
    if (!existing) return notFound();
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM lifeos_pomodoro_sessions WHERE id=?').bind(id).run();
        await auditLifeOs(env, actor, 'pomodoro.deleted', id);
        return json({ success: true });
    }
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request); const duration = body.duration === undefined ? Number(existing.duration) : Number(body.duration);
    if (!Number.isInteger(duration) || duration <= 0) return json({ error: 'Duration must be positive' }, 400);
    const completed = body.completed === undefined ? Number(existing.completed) : (body.completed ? 1 : 0);
    const completedAt = body.completedAt === undefined ? existing.completed_at : (body.completedAt == null ? null : parseLifeOsDate(body.completedAt));
    if (body.completedAt != null && completedAt == null) return json({ error: 'Invalid date format' }, 400);
    await env.DB.prepare('UPDATE lifeos_pomodoro_sessions SET duration=?,completed=?,completed_at=?,updated_at=? WHERE id=?')
        .bind(duration, completed, completedAt, timestamp, id).run();
    await auditLifeOs(env, actor, 'pomodoro.updated', id, { changed: Object.keys(body) });
    return json(await lifeOsTimedRecord(env, await env.DB.prepare('SELECT * FROM lifeos_pomodoro_sessions WHERE id=?').bind(id).first(), 'pomodoro'));
}

async function lifeOsCategoryMini(env, id) {
    if (!id) return null;
    const row = await env.DB.prepare('SELECT id,name,icon,color,type FROM lifeos_transaction_categories WHERE id=?').bind(id).first();
    return row ? { id: row.id, name: row.name, icon: row.icon, color: row.color, type: row.type } : null;
}

async function lifeOsTransaction(env, row) {
    const account = await env.DB.prepare('SELECT id,name,type,color FROM lifeos_finance_accounts WHERE id=?').bind(row.account_id).first();
    return {
        id: row.id, amount: Number(row.amount), description: row.description, type: row.type,
        date: dateForLifeOs(row.date), note: row.note, isRecurring: Boolean(row.is_recurring), recurrence: row.recurrence,
        accountId: row.account_id, categoryId: row.category_id, transferToId: row.transfer_to_id,
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
        account: account ? { id: account.id, name: account.name, type: account.type, color: account.color } : null,
        category: await lifeOsCategoryMini(env, row.category_id)
    };
}

async function lifeOsAccount(env, row, detail = false) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM lifeos_transactions WHERE account_id=?').bind(row.id).first();
    const account = {
        id: row.id, name: row.name, type: row.type, balance: Number(row.balance), currency: row.currency,
        color: row.color, icon: row.icon, isDefault: Boolean(row.is_default), archived: Boolean(row.archived),
        createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
        _count: { transactions: Number(count?.count || 0) }
    };
    if (detail) {
        const rows = await env.DB.prepare('SELECT * FROM lifeos_transactions WHERE account_id=? ORDER BY date DESC LIMIT 20').bind(row.id).all();
        account.transactions = await Promise.all((rows.results || []).map(item => lifeOsTransaction(env, item)));
    }
    return account;
}

async function lifeOsBudget(env, row) {
    const rows = await env.DB.prepare('SELECT * FROM lifeos_budget_items WHERE budget_id=? ORDER BY created_at').bind(row.id).all();
    const items = await Promise.all((rows.results || []).map(async item => ({
        id: item.id, budgetId: item.budget_id, categoryId: item.category_id,
        amount: Number(item.amount), spent: Number(item.spent),
        createdAt: dateForLifeOs(item.created_at), updatedAt: dateForLifeOs(item.updated_at),
        category: await lifeOsCategoryMini(env, item.category_id)
    })));
    return { id: row.id, name: row.name, period: row.period, startDate: dateForLifeOs(row.start_date),
        endDate: dateForLifeOs(row.end_date), createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at), items };
}

async function handleLifeOsFinance(request, env, url, actor) {
    const path = url.pathname; const timestamp = nowIso();
    const accountsPath = '/api/personal-workbench/lifeos/finance/accounts';
    if (path === accountsPath && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM lifeos_finance_accounts ORDER BY created_at DESC').all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsAccount(env, row))));
    }
    if (path === accountsPath && request.method === 'POST') {
        const body = await bodyOf(request); const name = text(body.name, 200);
        if (!name) return json({ error: 'Name is required' }, 400);
        const balance = body.balance === undefined ? 0 : Number(body.balance);
        if (body.balance !== undefined && (typeof body.balance !== 'number' || !Number.isFinite(balance))) return json({ error: 'Invalid balance' }, 400);
        const id = lifeOsId();
        await env.DB.prepare(`INSERT INTO lifeos_finance_accounts (id,name,type,balance,currency,color,icon,is_default,archived,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?, ?,0,?,?)`).bind(id, name, text(body.type, 40) || 'checking', balance,
            text(body.currency, 12) || 'USD', body.color ?? null, body.icon ?? null, body.isDefault ? 1 : 0, timestamp, timestamp).run();
        await auditLifeOs(env, actor, 'finance-account.created', id, { name });
        return json(await lifeOsAccount(env, await env.DB.prepare('SELECT * FROM lifeos_finance_accounts WHERE id=?').bind(id).first()), 201);
    }
    const accountMatch = path.match(/^\/api\/personal-workbench\/lifeos\/finance\/accounts\/([a-zA-Z0-9-]+)$/);
    if (accountMatch) {
        const id = accountMatch[1]; const existing = await env.DB.prepare('SELECT * FROM lifeos_finance_accounts WHERE id=?').bind(id).first();
        if (!existing) return notFound();
        if (request.method === 'GET') return json(await lifeOsAccount(env, existing, true));
        if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
        const body = await bodyOf(request); const balance = body.balance === undefined ? Number(existing.balance) : Number(body.balance);
        if (body.balance !== undefined && (typeof body.balance !== 'number' || !Number.isFinite(balance))) return json({ error: 'Invalid balance' }, 400);
        await env.DB.prepare(`UPDATE lifeos_finance_accounts SET name=?,type=?,balance=?,currency=?,color=?,icon=?,is_default=?,archived=?,updated_at=? WHERE id=?`)
            .bind(body.name === undefined ? existing.name : text(body.name, 200), body.type === undefined ? existing.type : text(body.type, 40),
                balance, body.currency === undefined ? existing.currency : text(body.currency, 12),
                body.color === undefined ? existing.color : body.color, body.icon === undefined ? existing.icon : body.icon,
                body.isDefault === undefined ? existing.is_default : (body.isDefault ? 1 : 0),
                body.archived === undefined ? existing.archived : (body.archived ? 1 : 0), timestamp, id).run();
        await auditLifeOs(env, actor, 'finance-account.updated', id, { changed: Object.keys(body) });
        return json(await lifeOsAccount(env, await env.DB.prepare('SELECT * FROM lifeos_finance_accounts WHERE id=?').bind(id).first()));
    }
    const transactionsPath = '/api/personal-workbench/lifeos/finance/transactions';
    if (path === transactionsPath && request.method === 'GET') {
        const clauses = ['1=1']; const bindings = [];
        for (const [key, column] of [['accountId', 'account_id'], ['categoryId', 'category_id'], ['type', 'type']]) {
            if (url.searchParams.has(key)) { clauses.push(`${column}=?`); bindings.push(url.searchParams.get(key)); }
        }
        if (url.searchParams.has('startDate')) { const value = parseLifeOsDate(url.searchParams.get('startDate')); if (value) { clauses.push('date>=?'); bindings.push(value); } }
        if (url.searchParams.has('endDate')) {
            const raw = url.searchParams.get('endDate'); const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : parseLifeOsDate(raw);
            if (value) { clauses.push('date<=?'); bindings.push(value); }
        }
        const where = clauses.join(' AND '); const limit = Math.max(0, Math.trunc(Number(url.searchParams.get('limit')) || 50));
        const offset = Math.max(0, Math.trunc(Number(url.searchParams.get('offset')) || 0));
        const [total, rows] = await Promise.all([
            env.DB.prepare(`SELECT COUNT(*) AS count FROM lifeos_transactions WHERE ${where}`).bind(...bindings).first(),
            env.DB.prepare(`SELECT * FROM lifeos_transactions WHERE ${where} ORDER BY date DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset).all()
        ]);
        return json({ transactions: await Promise.all((rows.results || []).map(row => lifeOsTransaction(env, row))), total: Number(total?.count || 0) });
    }
    if (path === transactionsPath && request.method === 'POST') {
        const body = await bodyOf(request); const amount = Number(body.amount); const description = text(body.description, 500);
        const accountId = text(body.accountId, 100); const date = parseLifeOsDate(body.date);
        if (typeof body.amount !== 'number' || !Number.isFinite(amount)) return json({ error: 'Amount is required' }, 400);
        if (!description) return json({ error: 'Description is required' }, 400);
        if (!accountId) return json({ error: 'accountId is required' }, 400);
        if (!date) return json({ error: 'Date is required' }, 400);
        if (!await env.DB.prepare('SELECT id FROM lifeos_finance_accounts WHERE id=?').bind(accountId).first()) return notFound();
        const id = lifeOsId(); const type = text(body.type, 30) || 'expense';
        const balanceChange = type === 'income' ? amount : (type === 'expense' ? -amount : 0);
        await env.DB.batch([
            env.DB.prepare(`INSERT INTO lifeos_transactions (id,amount,description,type,date,note,is_recurring,recurrence,account_id,category_id,transfer_to_id,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, amount, description, type, date, body.note ?? null, body.isRecurring ? 1 : 0,
                body.recurrence ?? null, accountId, body.categoryId || null, body.transferToId || null, timestamp, timestamp),
            ...(balanceChange ? [env.DB.prepare('UPDATE lifeos_finance_accounts SET balance=balance+?,updated_at=? WHERE id=?').bind(balanceChange, timestamp, accountId)] : [])
        ]);
        await auditLifeOs(env, actor, 'transaction.created', id, { amount, type, accountId });
        return json(await lifeOsTransaction(env, await env.DB.prepare('SELECT * FROM lifeos_transactions WHERE id=?').bind(id).first()), 201);
    }
    const txMatch = path.match(/^\/api\/personal-workbench\/lifeos\/finance\/transactions\/([a-zA-Z0-9-]+)$/);
    if (txMatch) {
        const id = txMatch[1]; const row = await env.DB.prepare('SELECT * FROM lifeos_transactions WHERE id=?').bind(id).first();
        if (!row) return notFound();
        if (request.method === 'GET') return json(await lifeOsTransaction(env, row));
        if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405);
        const reverse = row.type === 'income' ? -Number(row.amount) : (row.type === 'expense' ? Number(row.amount) : 0);
        await env.DB.batch([
            ...(reverse ? [env.DB.prepare('UPDATE lifeos_finance_accounts SET balance=balance+?,updated_at=? WHERE id=?').bind(reverse, timestamp, row.account_id)] : []),
            env.DB.prepare('DELETE FROM lifeos_transactions WHERE id=?').bind(id)
        ]);
        await auditLifeOs(env, actor, 'transaction.deleted', id);
        return json({ success: true });
    }
    const categoriesPath = '/api/personal-workbench/lifeos/finance/categories';
    if (path === categoriesPath && request.method === 'GET') {
        const rows = await env.DB.prepare(`SELECT c.*,
            (SELECT COUNT(*) FROM lifeos_transactions t WHERE t.category_id=c.id) AS transaction_count,
            (SELECT COUNT(*) FROM lifeos_budget_items b WHERE b.category_id=c.id) AS budget_count
            FROM lifeos_transaction_categories c ORDER BY c.name`).all();
        return json((rows.results || []).map(row => ({ id: row.id, name: row.name, icon: row.icon, color: row.color,
            type: row.type, isSystem: Boolean(row.is_system), createdAt: dateForLifeOs(row.created_at), updatedAt: dateForLifeOs(row.updated_at),
            _count: { transactions: Number(row.transaction_count), budgetItems: Number(row.budget_count) } })));
    }
    if (path === categoriesPath && request.method === 'POST') {
        const body = await bodyOf(request); const name = text(body.name, 200);
        if (!name) return json({ error: 'Name is required' }, 400);
        const id = lifeOsId();
        await env.DB.prepare(`INSERT INTO lifeos_transaction_categories (id,name,icon,color,type,is_system,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
            .bind(id, name, body.icon ?? null, text(body.color, 40) || '#6b7280', text(body.type, 30) || 'expense', body.isSystem ? 1 : 0, timestamp, timestamp).run();
        await auditLifeOs(env, actor, 'transaction-category.created', id, { name });
        return json({ id, name, icon: body.icon ?? null, color: text(body.color, 40) || '#6b7280',
            type: text(body.type, 30) || 'expense', isSystem: Boolean(body.isSystem),
            createdAt: timestamp, updatedAt: timestamp, _count: { transactions: 0, budgetItems: 0 } }, 201);
    }
    const budgetsPath = '/api/personal-workbench/lifeos/finance/budgets';
    if (path === budgetsPath && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM lifeos_budgets ORDER BY created_at DESC').all();
        return json(await Promise.all((rows.results || []).map(row => lifeOsBudget(env, row))));
    }
    if (path === budgetsPath && request.method === 'POST') {
        const body = await bodyOf(request); const name = text(body.name, 200); const startDate = parseLifeOsDate(body.startDate);
        const endDate = body.endDate == null || body.endDate === '' ? null : parseLifeOsDate(body.endDate);
        if (!name) return json({ error: 'Name is required' }, 400);
        if (!startDate) return json({ error: 'Start date is required' }, 400);
        if (body.endDate && !endDate) return json({ error: 'Invalid end date' }, 400);
        const id = lifeOsId(); const statements = [env.DB.prepare('INSERT INTO lifeos_budgets (id,name,period,start_date,end_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
            .bind(id, name, text(body.period, 30) || 'monthly', startDate, endDate, timestamp, timestamp)];
        if (Array.isArray(body.items)) for (const item of body.items) {
            if (!item?.categoryId || !Number.isFinite(Number(item.amount))) continue;
            statements.push(env.DB.prepare('INSERT INTO lifeos_budget_items (id,budget_id,category_id,amount,spent,created_at,updated_at) VALUES (?,?,?,?,0,?,?)')
                .bind(lifeOsId(), id, item.categoryId, Number(item.amount), timestamp, timestamp));
        }
        await env.DB.batch(statements);
        await auditLifeOs(env, actor, 'budget.created', id, { name });
        return json(await lifeOsBudget(env, await env.DB.prepare('SELECT * FROM lifeos_budgets WHERE id=?').bind(id).first()), 201);
    }
    return null;
}

function lifeOsSearchResult(row, type, module, icon, color, description) {
    return {
        id: String(row.id), type, title: row.title || row.name || 'Untitled',
        description: description || '', updatedAt: row.updated_at, module, icon, color
    };
}

async function handleLifeOsSearch(request, env, url) {
    if (url.pathname !== '/api/personal-workbench/lifeos/search' || request.method !== 'GET') return null;
    const query = text(url.searchParams.get('q'), 160);
    if (query.length < 2) return json({ results: [], query });
    const pattern = `%${query}%`;
    const tables = [
        ['personal_workbench_lifeos_tasks', 'title LIKE ? OR description LIKE ?', 'Task', 'tasks', 'CheckSquare', 'orange', row => row.description || `Status: ${row.status || 'todo'} · Priority: ${row.priority || 'medium'}`],
        ['lifeos_notes', 'title LIKE ? OR content LIKE ?', 'Note', 'notes', 'StickyNote', 'amber', row => String(row.content || '').replace(/[#*_\\n]/g, ' ').slice(0, 120)],
        ['lifeos_journal_entries', "COALESCE(title,'') LIKE ? OR content LIKE ?", 'Journal', 'journal', 'BookOpen', 'rose', row => String(row.content || '').replace(/[#*_\\n]/g, ' ').slice(0, 120) || row.mood || 'Journal entry'],
        ['lifeos_habits', 'name LIKE ?', 'Habit', 'habits', 'Repeat', 'teal', row => row.description || row.icon || 'Habit'],
        ['lifeos_goals', 'title LIKE ?', 'Goal', 'goals', 'Target', 'violet', row => row.description || `Progress: ${row.progress || 0}% · Category: ${row.category || 'personal'}`],
        ['lifeos_calendar_events', 'title LIKE ?', 'Event', 'calendar', 'CalendarDays', 'sky', row => row.description || `Starts: ${row.start_date}`],
        ['lifeos_courses', 'title LIKE ?', 'Course', 'learning', 'GraduationCap', 'cyan', row => row.description || `Progress: ${row.progress || 0}%`]
    ];
    const results = [];
    for (const [table, predicate, type, module, icon, color, describe] of tables) {
        const archive = ['personal_workbench_lifeos_tasks', 'lifeos_notes', 'lifeos_habits', 'lifeos_goals'].includes(table) ? ' AND archived=0' : '';
        const rows = await env.DB.prepare(`SELECT * FROM ${table} WHERE (${predicate})${archive} ORDER BY updated_at DESC LIMIT 5`)
            .bind(...(predicate.includes(' OR ') ? [pattern, pattern] : [pattern])).all();
        for (const row of rows.results || []) results.push(lifeOsSearchResult(row, type, module, icon, color, describe(row)));
    }
    results.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return json({ results: results.slice(0, 35), query });
}

async function handleLifeOsWidgets(request, env, url, actor) {
    if (url.pathname !== '/api/personal-workbench/lifeos/dashboard/widgets') return null;
    const profile = await getLifeOsProfile(env);
    if (!profile && request.method !== 'GET') return json({ error: 'Complete setup first' }, 409);
    if (request.method === 'GET') {
        const workspace = await env.DB.prepare('SELECT layout FROM lifeos_workspaces WHERE is_default=1 LIMIT 1').first();
        let widgets = parseWorkspaceLayout(workspace?.layout)?.widgets || [];
        if (!Array.isArray(widgets) || !widgets.length) {
            if (profile) {
                const legacy = await env.DB.prepare('SELECT widget_ids FROM lifeos_widgets WHERE user_id=?').bind(profile.id).first();
                try { widgets = JSON.parse(legacy?.widget_ids || '[]'); } catch { widgets = []; }
            }
        }
        return json({ widgets: Array.isArray(widgets) ? widgets.filter(id => typeof id === 'string').slice(0, 60) : [] });
    }
    if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    if (!Array.isArray(body.widgets) || body.widgets.length > 60 || body.widgets.some(id => typeof id !== 'string' || id.length > 100)) {
        return json({ error: 'widgets must be an array of at most 60 string IDs' }, 400);
    }
    const timestamp = nowIso();
    const workspace = await env.DB.prepare('SELECT id,layout FROM lifeos_workspaces WHERE is_default=1 LIMIT 1').first();
    const layoutData = parseWorkspaceLayout(workspace?.layout);
    layoutData.widgets = body.widgets;
    if (Array.isArray(layoutData.preferences?.dashboardWidgets)) layoutData.preferences.dashboardWidgets = body.widgets;
    const layout = JSON.stringify(layoutData);
    if (workspace) await env.DB.prepare('UPDATE lifeos_workspaces SET layout=?,updated_at=? WHERE id=?').bind(layout, timestamp, workspace.id).run();
    else await env.DB.prepare(`INSERT INTO lifeos_workspaces (id,name,is_default,layout,sort_order,created_at,updated_at)
        VALUES (?,?,1,?,0,?,?)`).bind(lifeOsId(), 'Default', layout, timestamp, timestamp).run();
    await env.DB.prepare(`INSERT INTO lifeos_widgets (id,user_id,widget_ids,created_at,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET widget_ids=excluded.widget_ids,updated_at=excluded.updated_at`)
        .bind(lifeOsId(), profile.id, JSON.stringify(body.widgets), timestamp, timestamp).run();
    await auditLifeOs(env, actor, 'dashboard.widgets.updated', profile.id, { count: body.widgets.length });
    return json({ widgets: body.widgets });
}

async function handleLifeOsActivity(request, env, url) {
    if (url.pathname !== '/api/personal-workbench/lifeos/activity' || request.method !== 'GET') return null;
    const [tasks, notes, journal, habitLogs, transactions] = await Promise.all([
        env.DB.prepare('SELECT id,title,status,updated_at AS timestamp FROM personal_workbench_lifeos_tasks ORDER BY updated_at DESC LIMIT 10').all(),
        env.DB.prepare('SELECT id,title,type,updated_at AS timestamp FROM lifeos_notes ORDER BY updated_at DESC LIMIT 10').all(),
        env.DB.prepare('SELECT id,title,mood,created_at AS timestamp FROM lifeos_journal_entries ORDER BY created_at DESC LIMIT 10').all(),
        env.DB.prepare('SELECT l.id,l.count,l.created_at AS timestamp,h.name FROM lifeos_habit_logs l JOIN lifeos_habits h ON h.id=l.habit_id ORDER BY l.created_at DESC LIMIT 10').all(),
        env.DB.prepare('SELECT id,description,amount,type,created_at AS timestamp FROM lifeos_transactions ORDER BY created_at DESC LIMIT 10').all()
    ]);
    const items = [];
    for (const row of tasks.results || []) items.push({ id: row.id, type: 'task', title: row.title, description: row.status === 'done' ? 'Task completed' : `Task ${row.status}`, timestamp: row.timestamp, module: 'tasks' });
    for (const row of notes.results || []) items.push({ id: row.id, type: 'note', title: row.title, description: `${row.type} updated`, timestamp: row.timestamp, module: 'notes' });
    for (const row of journal.results || []) items.push({ id: row.id, type: 'journal', title: row.title || 'Journal entry', description: row.mood ? `Mood: ${row.mood}` : 'New entry', timestamp: row.timestamp, module: 'journal' });
    for (const row of habitLogs.results || []) items.push({ id: row.id, type: 'habit', title: row.name, description: `Completed ${row.count}x`, timestamp: row.timestamp, module: 'habits' });
    for (const row of transactions.results || []) items.push({ id: row.id, type: 'transaction', title: row.description, description: `${row.type === 'income' ? '+' : '-'}$${Math.abs(Number(row.amount)).toFixed(2)}`, timestamp: row.timestamp, module: 'finance' });
    items.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return json({ activities: items.slice(0, 15) });
}

async function handleLifeOsDashboard(request, env, url) {
    if (url.pathname !== '/api/personal-workbench/lifeos/dashboard' || request.method !== 'GET') return null;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const month = `${today.slice(0, 7)}-01`;
    const [statusRows, habits, completedLogs, habitRows, accounts, transactions, notes, events, journals, goals, projects] = await Promise.all([
        env.DB.prepare('SELECT status,COUNT(*) AS count FROM personal_workbench_lifeos_tasks WHERE archived=0 GROUP BY status').all(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM lifeos_habits WHERE archived=0').first(),
        env.DB.prepare('SELECT COUNT(DISTINCT habit_id) AS count FROM lifeos_habit_logs WHERE substr(date,1,10)=?').bind(today).first(),
        env.DB.prepare('SELECT id,name,icon,color FROM lifeos_habits WHERE archived=0 ORDER BY created_at DESC LIMIT 20').all(),
        env.DB.prepare('SELECT id,name,type,balance,currency,color,icon FROM lifeos_finance_accounts WHERE archived=0').all(),
        env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' AND date>=? THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN type='expense' AND date>=? THEN amount ELSE 0 END),0) AS expenses FROM lifeos_transactions").bind(month, month).first(),
        env.DB.prepare(`SELECT n.id,n.title,n.type,n.icon,n.color,n.updated_at,f.id AS folder_id,f.name AS folder_name
            FROM lifeos_notes n LEFT JOIN lifeos_note_folders f ON f.id=n.folder_id WHERE n.archived=0 ORDER BY n.updated_at DESC LIMIT 5`).all(),
        env.DB.prepare('SELECT e.id,e.title,e.start_date,e.end_date,e.all_day,e.color,e.task_id,t.title AS task_title FROM lifeos_calendar_events e LEFT JOIN personal_workbench_lifeos_tasks t ON t.id=e.task_id WHERE e.start_date>=? ORDER BY e.start_date LIMIT 5').bind(now.toISOString()).all(),
        env.DB.prepare('SELECT id,title,mood,mood_score,date FROM lifeos_journal_entries ORDER BY date DESC LIMIT 3').all(),
        env.DB.prepare("SELECT id,title,progress,category,target_date FROM lifeos_goals WHERE status='in-progress' AND archived=0 ORDER BY updated_at DESC LIMIT 5").all(),
        env.DB.prepare(`SELECT p.id,p.title AS name,p.color,COUNT(t.id) AS task_count FROM personal_workbench_lifeos_projects p
            LEFT JOIN personal_workbench_lifeos_tasks t ON t.project_id=p.id WHERE p.status='active' AND p.archived=0 GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 5`).all()
    ]);
    const byStatus = { todo: 0, 'in-progress': 0, done: 0, cancelled: 0 };
    let taskTotal = 0;
    for (const row of statusRows.results || []) { byStatus[row.status] = Number(row.count); taskTotal += Number(row.count); }
    const habitTotal = Number(habits?.count || 0);
    const habitDone = Number(completedLogs?.count || 0);
    const accountRows = accounts.results || [];
    const recentHabitActivity = await Promise.all((habitRows.results || []).map(async habit => {
        const logs = await env.DB.prepare('SELECT date,count FROM lifeos_habit_logs WHERE habit_id=? ORDER BY date DESC LIMIT 7').bind(habit.id).all();
        return { id: habit.id, name: habit.name, icon: habit.icon, color: habit.color,
            logs: (logs.results || []).map(log => ({ date: dateForLifeOs(log.date), count: Number(log.count) })) };
    }));
    return json({
        tasks: { byStatus, total: taskTotal },
        habits: { total: habitTotal, completedToday: habitDone, completionRate: habitTotal ? Math.floor(habitDone * 100 / habitTotal) : 0,
            recentActivity: recentHabitActivity },
        finance: { accounts: accountRows.map(a => ({ ...a, balance: Number(a.balance), archived: undefined })),
            totalBalance: accountRows.reduce((total, a) => total + Number(a.balance), 0), monthlyIncome: Number(transactions?.income || 0), monthlyExpenses: Number(transactions?.expenses || 0) },
        recentNotes: (notes.results || []).map(n => ({ id: n.id, title: n.title, type: n.type, icon: n.icon, color: n.color, updatedAt: n.updated_at,
            folder: n.folder_id ? { id: n.folder_id, name: n.folder_name } : null })),
        upcomingEvents: (events.results || []).map(e => ({ id: e.id, title: e.title, startDate: e.start_date, endDate: e.end_date,
            allDay: Boolean(e.all_day), color: e.color, task: e.task_id ? { id: e.task_id, title: e.task_title } : null })),
        recentJournalEntries: (journals.results || []).map(j => ({ id: j.id, title: j.title, mood: j.mood, moodScore: j.mood_score, date: j.date })),
        activeGoals: (goals.results || []).map(g => ({ ...g, progress: Number(g.progress) })),
        activeProjects: (projects.results || []).map(p => ({ id: String(p.id), name: p.name, color: p.color, _count: { tasks: Number(p.task_count) } }))
    });
}

async function handleLifeOsNotifications(request, env, url) {
    if (url.pathname !== '/api/personal-workbench/lifeos/notifications' || request.method !== 'GET') return null;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 7 * 86400000).toISOString();
    const results = [];
    const due = await env.DB.prepare(`SELECT id,title,priority,due_date FROM personal_workbench_lifeos_tasks
        WHERE status!='done' AND archived=0 AND due_date IS NOT NULL AND substr(due_date,1,10)<? ORDER BY due_date LIMIT 10`).bind(today).all();
    for (const task of due.results || []) {
        const dueDay = String(task.due_date).slice(0, 10);
        const daysOverdue = Math.max(1, Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${dueDay}T00:00:00.000Z`)) / 86400000));
        results.push({ id: `task-${task.id}`, type: 'overdue-task', title: 'Overdue Task',
            description: `"${task.title}" is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`,
            module: 'tasks', priority: ['urgent', 'high'].includes(task.priority) ? 'high' : 'medium', createdAt: task.due_date, read: false });
    }
    const dueToday = await env.DB.prepare(`SELECT id,title,priority FROM personal_workbench_lifeos_tasks
        WHERE status!='done' AND archived=0 AND due_date IS NOT NULL AND substr(due_date,1,10)=? ORDER BY due_date LIMIT 5`).bind(today).all();
    if (dueToday.results?.length) {
        const names = dueToday.results.slice(0, 2).map(task => task.title);
        const remaining = dueToday.results.length > 2 ? ` and ${dueToday.results.length - 2} more` : '';
        results.push({ id: `task-due-today-${today}`, type: 'task-due-today', title: 'Tasks Due Today',
            description: `${dueToday.results.length} task${dueToday.results.length > 1 ? 's' : ''} due today: ${names.join(', ')}${remaining}`,
            module: 'tasks', priority: 'medium', createdAt: now.toISOString(), read: false });
    }
    const goals = await env.DB.prepare(`SELECT id,title,target_date,progress FROM lifeos_goals WHERE status='in-progress' AND archived=0 AND target_date>=? AND target_date<=?`).bind(now.toISOString(), tomorrow).all();
    for (const goal of goals.results || []) {
        const daysLeft = Math.max(0, Math.floor((Date.parse(goal.target_date) - now.getTime()) / 86400000) + 1);
        results.push({ id: `goal-${goal.id}`, type: 'goal-deadline', title: 'Goal Deadline Approaching',
            description: `"${goal.title}" is due in ${daysLeft} day${daysLeft > 1 ? 's' : ''} (${Number(goal.progress)}% complete)`,
            module: 'goals', priority: daysLeft <= 2 ? 'high' : daysLeft <= 4 ? 'medium' : 'low', createdAt: now.toISOString(), read: false });
    }
    const habitRows = await env.DB.prepare(`SELECT h.id,h.name FROM lifeos_habits h WHERE h.archived=0 AND NOT EXISTS
        (SELECT 1 FROM lifeos_habit_logs l WHERE l.habit_id=h.id AND substr(l.date,1,10)=?)`).bind(today).all();
    if (habitRows.results?.length && now.getUTCHours() >= 10) {
        const names = habitRows.results.slice(0, 3).map(habit => habit.name);
        const remaining = habitRows.results.length > 3 ? ` and ${habitRows.results.length - 3} more` : '';
        results.push({ id: `habit-reminder-${today}`, type: 'habit-reminder', title: 'Habits Pending',
            description: `${habitRows.results.length} habit${habitRows.results.length === 1 ? '' : 's'} not completed today: ${names.join(', ')}${remaining}`,
            module: 'habits', priority: habitRows.results.length >= 3 ? 'medium' : 'low', createdAt: now.toISOString(), read: false });
    }
    const addCurrent = (id,type,title,description,module,priority='low') => results.push({ id,type,title,description,module,priority,createdAt:now.toISOString(),read:false });
    const completedToday = await env.DB.prepare(`SELECT COUNT(*) AS count FROM personal_workbench_lifeos_tasks
        WHERE status='done' AND archived=0 AND substr(updated_at,1,10)=?`).bind(today).first();
    if (Number(completedToday?.count) > 0) addCurrent(`task-completed-${today}`,'task-completed','Tasks Completed! 🎉',
        `Great job! You completed ${Number(completedToday.count)} task${Number(completedToday.count) === 1 ? '' : 's'} today.`,'tasks');
    const missed = await env.DB.prepare(`SELECT COUNT(*) AS count FROM lifeos_habits h WHERE h.archived=0 AND NOT EXISTS
        (SELECT 1 FROM lifeos_habit_logs l WHERE l.habit_id=h.id AND substr(l.date,1,10)=?)`).bind(yesterday).first();
    if (Number(missed?.count)>0) results.push({ id:`habit-missed-${yesterday}`,type:'habit-missed',title:'Missed Habits Yesterday',
        description:`You missed ${Number(missed.count)} habit${Number(missed.count)===1?'':'s'} yesterday. Try to get back on track today!`,
        module:'habits',priority:'medium',createdAt:`${yesterday}T23:59:59.999Z`,read:false });
    const progressGoals = await env.DB.prepare("SELECT id,title,progress FROM lifeos_goals WHERE status='in-progress' AND progress IN (25,50,75) AND archived=0").all();
    for (const goal of progressGoals.results || []) addCurrent(`goal-progress-${goal.id}-${goal.progress}`,'goal-progress',`${goal.progress}% Progress! 🎯`,
        `"${goal.title}" is ${goal.progress}% complete. Keep pushing!`,'goals',Number(goal.progress)>=75?'medium':'low');
    const completedGoals = await env.DB.prepare("SELECT id,title FROM lifeos_goals WHERE status='completed' AND substr(updated_at,1,10)=? AND archived=0 LIMIT 5").bind(today).all();
    for (const goal of completedGoals.results || []) addCurrent(`goal-completed-${goal.id}`,'goal-completed','Goal Achieved! 🏆',
        `Congratulations! You completed "${goal.title}"`,'goals','high');
    const budgets = await env.DB.prepare(`SELECT bi.id,bi.amount,bi.spent,c.name FROM lifeos_budget_items bi
        JOIN lifeos_budgets b ON b.id=bi.budget_id JOIN lifeos_transaction_categories c ON c.id=bi.category_id
        WHERE b.start_date<=? AND (b.end_date IS NULL OR b.end_date>=?)`).bind(now.toISOString(),now.toISOString()).all();
    for (const item of budgets.results || []) if (Number(item.amount)>0 && Number(item.spent)/Number(item.amount)>.8) {
        const exceeded = Number(item.spent)>Number(item.amount);
        addCurrent(`budget-${item.id}`,'budget-alert',exceeded?'Budget Exceeded':'Budget Warning',
            `${item.name}: $${Number(item.spent).toFixed(0)} of $${Number(item.amount).toFixed(0)} (${Math.floor(Number(item.spent)/Number(item.amount)*100)}%)`,
            'finance',exceeded?'high':'medium');
    }
    const largeTransactions = await env.DB.prepare("SELECT id,description,amount FROM lifeos_transactions WHERE type='expense' AND amount>=100 AND substr(date,1,10)=? LIMIT 5").bind(today).all();
    for (const transaction of largeTransactions.results || []) addCurrent(`large-transaction-${transaction.id}`,'large-transaction','Large Transaction',
        `$${Number(transaction.amount).toFixed(0)} expense: ${transaction.description}`,'finance',Number(transaction.amount)>=500?'high':'medium');
    if (now.getUTCHours()>=18) {
        const entries = await env.DB.prepare('SELECT COUNT(*) AS count FROM lifeos_journal_entries WHERE substr(date,1,10)=?').bind(today).first();
        if (!Number(entries?.count)) addCurrent(`journal-reminder-${today}`,'writing-reminder','Daily Journal ✍️',
            "You haven't journalized today. Take a moment to reflect!",'journal');
    }
    const moodRows = await env.DB.prepare('SELECT mood_score FROM lifeos_journal_entries WHERE mood_score IS NOT NULL AND date>=? ORDER BY date DESC LIMIT 7')
        .bind(new Date(now.getTime()-7*86400000).toISOString()).all();
    const moodScores = (moodRows.results||[]).map(row=>Number(row.mood_score));
    if (moodScores.length>=3 && moodScores.reduce((a,b)=>a+b,0)/moodScores.length<=2) addCurrent(`mood-reflection-${today}`,'mood-reflection','Mood Reflection 🧘',
        'Your mood has been lower than usual this week. Consider self-care activities or reaching out.','journal','medium');
    const activeHabits = await env.DB.prepare('SELECT id,name FROM lifeos_habits WHERE archived=0').all();
    for (const habit of activeHabits.results || []) {
        const logRows = await env.DB.prepare('SELECT date FROM lifeos_habit_logs WHERE habit_id=? ORDER BY date DESC LIMIT 100').bind(habit.id).all();
        const loggedDates = new Set((logRows.results||[]).map(row=>String(row.date).slice(0,10)));
        let streak=0;
        for (let day=0;day<60;day++) {
            const check = new Date(now.getTime()-day*86400000).toISOString().slice(0,10);
            if (!loggedDates.has(check)) break;
            streak++;
        }
        if ([7,14,30,60,90].includes(streak)) {
            const label = streak===7?'One week':streak===14?'Two weeks':streak===30?'One month':streak===60?'Two months':'Three months';
            addCurrent(`habit-streak-${habit.id}-${today}`,'streak-milestone',`${label} Streak! 🔥`,
                `"${habit.name}" has reached a ${streak}-day streak — keep it going!`,'habits',streak>=30?'high':streak>=14?'medium':'low');
        }
    }
    if (now.getUTCDay()===0 && now.getUTCHours()>=10) addCurrent(`backup-reminder-${today}`,'data-backup','Weekly Backup Reminder',
        "It's Sunday! Consider backing up your data in Settings → Data.",'settings');
    const priority = { high:3, medium:2, low:1 };
    return json(results.sort((a,b)=>(priority[b.priority]||1)-(priority[a.priority]||1)||String(b.createdAt).localeCompare(String(a.createdAt))));
}

async function handleLifeOsInsights(request, env, url) {
    if (url.pathname !== '/api/personal-workbench/lifeos/insights' || request.method !== 'GET') return null;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const weekStart = new Date(todayStart.getTime() - ((todayStart.getUTCDay() + 6) % 7) * 86400000);
    const priorWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthEnd = new Date(thisMonthStart.getTime() - 1);
    const lastMonthStart = new Date(Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1));
    const [tasks, habits, todayLogs, goals, currentFinance, previousFinance, moods] = await Promise.all([
        env.DB.prepare('SELECT status,completed_at,due_date FROM personal_workbench_lifeos_tasks WHERE archived=0').all(),
        env.DB.prepare('SELECT id,name FROM lifeos_habits WHERE archived=0').all(),
        env.DB.prepare('SELECT DISTINCT habit_id FROM lifeos_habit_logs WHERE substr(date,1,10)=?').bind(today).all(),
        env.DB.prepare("SELECT title,progress,start_date,target_date,updated_at FROM lifeos_goals WHERE status='in-progress' AND archived=0").all(),
        env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expenses,COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income FROM lifeos_transactions WHERE date>=?").bind(thisMonthStart.toISOString()).first(),
        env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expenses FROM lifeos_transactions WHERE date>=? AND date<=?").bind(lastMonthStart.toISOString(), lastMonthEnd.toISOString()).first(),
        env.DB.prepare('SELECT mood_score FROM lifeos_journal_entries WHERE mood_score IS NOT NULL AND date>=? ORDER BY date DESC LIMIT 14').bind(new Date(now.getTime() - 14 * 86400000).toISOString()).all()
    ]);
    const taskRows = tasks.results || [];
    const totalTasks = taskRows.length;
    const doneTasks = taskRows.filter(task => task.status === 'done').length;
    const completion = totalTasks ? doneTasks * 100 / totalTasks : 0;
    const currentWeekDone = taskRows.filter(task => task.status === 'done' && task.completed_at >= weekStart.toISOString()).length;
    const previousWeekDone = taskRows.filter(task => task.status === 'done' && task.completed_at >= priorWeekStart.toISOString() && task.completed_at < weekStart.toISOString()).length;
    const trendFor = (current, previous) => previous === 0 ? current > 0 ? 'up' : 'stable'
        : (current - previous) / previous * 100 > 5 ? 'up' : (current - previous) / previous * 100 < -5 ? 'down' : 'stable';
    const habitRows = habits.results || [];
    const completedHabitCount = new Set((todayLogs.results || []).map(row => row.habit_id)).size;
    const habitConsistency = habitRows.length ? completedHabitCount / habitRows.length * 100 : 0;
    const goalRows = goals.results || [];
    const averageProgress = goalRows.length ? goalRows.reduce((sum, goal) => sum + Number(goal.progress), 0) / goalRows.length : 0;
    let goalsAhead = 0, goalsAtRisk = 0;
    for (const goal of goalRows) {
        if (!goal.start_date || !goal.target_date) continue;
        const duration = Date.parse(goal.target_date) - Date.parse(goal.start_date);
        const elapsed = now.getTime() - Date.parse(goal.start_date);
        if (duration > 0 && elapsed / duration < .5 && Number(goal.progress) > 50) goalsAhead++;
        if (duration > 0 && elapsed / duration > .5 && Number(goal.progress) < 50) goalsAtRisk++;
    }
    const currentExpenses = Number(currentFinance?.expenses || 0), priorExpenses = Number(previousFinance?.expenses || 0);
    const currentIncome = Number(currentFinance?.income || 0);
    const moodValues = (moods.results || []).map(row => Number(row.mood_score));
    const avgMood = moodValues.length ? moodValues.reduce((sum, value) => sum + value, 0) / moodValues.length : 0;
    let maxHabitStreak = 0, maxHabitName = '';
    for (const habit of habitRows) {
        const logRows = await env.DB.prepare('SELECT date FROM lifeos_habit_logs WHERE habit_id=? ORDER BY date DESC LIMIT 100').bind(habit.id).all();
        const logged = new Set((logRows.results || []).map(row => String(row.date).slice(0, 10)));
        let streak = 0;
        for (let day = 0; day < 60; day++) {
            const date = new Date(todayStart.getTime() - day * 86400000).toISOString().slice(0, 10);
            if (!logged.has(date)) break;
            streak++;
        }
        if (streak > maxHabitStreak) { maxHabitStreak = streak; maxHabitName = habit.name; }
    }
    const overdue = taskRows.filter(task => task.status !== 'done' && task.due_date && task.due_date.slice(0,10) < today).length;
    const insights = [];
    const push = (category,title,description,trend,trendValue,module) => insights.push({ id: `${category}-${today}-${insights.length}`,category,title,description,trend,trendValue,module });
    if (overdue) push('productivity','Overdue Tasks Need Attention',`You have ${overdue} overdue task${overdue === 1 ? '' : 's'}. Consider reprioritizing or breaking them into smaller steps.`,'down',String(overdue),'tasks');
    if (totalTasks && (currentWeekDone || previousWeekDone)) {
        const change = previousWeekDone ? Math.trunc((currentWeekDone - previousWeekDone) / previousWeekDone * 100) : 100;
        push('productivity','Weekly Task Progress',`You've completed ${currentWeekDone} task${currentWeekDone === 1 ? '' : 's'} this week, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% from last week's ${previousWeekDone}. ${change >= 0 ? 'Keep up the great momentum!' : 'Try to pick up the pace this week.'}`,
            trendFor(currentWeekDone,previousWeekDone),`${change >= 0 ? '+' : ''}${change}%`,'tasks');
    }
    if (maxHabitStreak >= 3) push('wellness','Habit Streak Achievement',`You've maintained a ${maxHabitStreak}-day streak on "${maxHabitName}" — ${maxHabitStreak >= 14 ? 'your longest yet! Incredible consistency!' : maxHabitStreak >= 7 ? "that's a full week! Keep going!" : 'great start, keep it up!'}`,
        maxHabitStreak >= 7 ? 'up' : 'stable',`${maxHabitStreak} days`,'habits');
    if (habitRows.length) push('wellness','Habit Consistency',`You've completed ${completedHabitCount} of ${habitRows.length} habits today (${Math.round(habitConsistency)}%). ${habitConsistency >= 80 ? 'Outstanding consistency!' : habitConsistency >= 50 ? 'Good progress — try to complete the remaining ones!' : 'Focus on building momentum by completing at least one more habit today.'}`,'stable',`${Math.round(habitConsistency)}%`,'habits');
    if (goalRows.length) push('goals','Goal Progress Overview',`Across ${goalRows.length} active goal${goalRows.length > 1 ? 's' : ''}, average progress is ${Math.round(averageProgress)}%. ${goalsAhead ? `${goalsAhead} goal${goalsAhead > 1 ? 's are' : ' is'} ahead of schedule!` : goalsAtRisk ? `${goalsAtRisk} goal${goalsAtRisk > 1 ? 's need' : ' needs'} attention — behind schedule.` : 'All goals are on track.'}`,
        goalsAhead > goalsAtRisk ? 'up' : goalsAtRisk ? 'down' : 'stable',`${Math.round(averageProgress)}%`,'goals');
    if (currentExpenses || priorExpenses) {
        const change = priorExpenses ? Math.trunc((currentExpenses-priorExpenses)/priorExpenses*100) : currentExpenses > 0 ? 100 : 0;
        const savingsRate = currentIncome > 0 ? Math.trunc((currentIncome-currentExpenses)/currentIncome*100) : 0;
        const savingsAdvice = savingsRate >= 20 ? 'Great savings discipline!' : savingsRate >= 0 ? 'Consider ways to increase your savings rate.' : 'Spending exceeds income — review your budget carefully.';
        push('finance','Spending Pattern Analysis',`${change > 0 ? 'Your spending is up' : change < 0 ? 'Your spending is down' : 'Your spending is stable'} ${Math.abs(change)}% compared to last month. ${currentIncome > 0 ? `Savings rate: ${Math.max(0,savingsRate)}%. ` : ''}${savingsAdvice}`,
            change > 10 ? 'down' : change < -5 ? 'up' : 'stable',`${change >= 0 ? '+' : ''}${change}%`,'finance');
    }
    if (moodValues.length >= 3) push('wellness','Mood Patterns',`Your average mood over the past 2 weeks is ${avgMood.toFixed(1)}/5. ${avgMood >= 3.5 ? 'You seem to be in a positive headspace!' : avgMood >= 2.5 ? 'Your mood has been moderate. Consider activities that boost your well-being.' : 'It seems like a tough period. Remember to practice self-care and reach out if needed.'}`,
        avgMood >= 3.5 ? 'up' : avgMood >= 2.5 ? 'stable' : 'down',`${avgMood.toFixed(1)}/5`,'journal');
    if (!totalTasks) push('productivity','Start Tracking Tasks','No tasks found yet. Start adding tasks to manage your daily workflow.','stable',undefined,'tasks');
    if (!goalRows.length) push('goals','Set Meaningful Goals','No active goals found. Setting clear, measurable goals is the first step toward achieving them.','stable',undefined,'goals');
    if (!currentExpenses && !currentIncome) push('finance','Track Your Finances','No financial transactions recorded yet. Start tracking income and expenses.','stable',undefined,'finance');
    const productivityScore = Math.min(100,Math.trunc(completion*.4+habitConsistency*.3+averageProgress*.3));
    const wellnessScore = Math.min(100,Math.trunc(avgMood/5*50+habitConsistency*.3));
    const selected = [];
    for (const category of ['productivity','wellness','finance','goals']) {
        const item = insights.find(insight => insight.category === category);
        if (item) selected.push(item);
    }
    for (const item of insights) {
        if (selected.length >= 6) break;
        if (!selected.some(existing => existing.id === item.id)) selected.push(item);
    }
    return json({ productivityScore,wellnessScore,productivityTrend:trendFor(currentWeekDone,previousWeekDone),
        wellnessTrend:avgMood>=3.5?'up':avgMood>=2.5?'stable':'down',analytics:selected.slice(0,6),generatedAt:now.toISOString() });
}

async function handleLifeOsWeeklyReview(request, env, url) {
    if (url.pathname !== '/api/personal-workbench/lifeos/weekly-review' || request.method !== 'GET') return null;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const weekStart = new Date(today.getTime() - 6 * 86400000).toISOString();
    const weekEnd = new Date(today.getTime() + 86399999).toISOString();
    const [completed, created, active, done, habitTotal, habitLogs, time, pomodoros, journals, financial, goals, habits, expensesByCategory] = await Promise.all([
        env.DB.prepare("SELECT id,title,priority FROM personal_workbench_lifeos_tasks WHERE status='done' AND completed_at>=? AND completed_at<=?").bind(weekStart, weekEnd).all(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM personal_workbench_lifeos_tasks WHERE created_at>=? AND created_at<=?').bind(weekStart, weekEnd).first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM personal_workbench_lifeos_tasks WHERE archived=0').first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM personal_workbench_lifeos_tasks WHERE archived=0 AND status='done'").first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM lifeos_habits WHERE archived=0').first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM lifeos_habit_logs WHERE date>=? AND date<=?').bind(weekStart, weekEnd).first(),
        env.DB.prepare('SELECT COALESCE(SUM(duration),0) AS total FROM lifeos_time_entries WHERE start_time>=? AND start_time<=?').bind(weekStart, weekEnd).first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM lifeos_pomodoro_sessions WHERE started_at>=? AND started_at<=? AND completed=1 AND type='focus'").bind(weekStart, weekEnd).first(),
        env.DB.prepare('SELECT mood_score,energy FROM lifeos_journal_entries WHERE date>=? AND date<=? ORDER BY date ASC').bind(weekStart, weekEnd).all(),
        env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expenses FROM lifeos_transactions WHERE date>=? AND date<=?").bind(weekStart, weekEnd).first(),
        env.DB.prepare("SELECT id,title,progress,updated_at FROM lifeos_goals WHERE status='in-progress' AND archived=0").all(),
        env.DB.prepare('SELECT id,name FROM lifeos_habits WHERE archived=0').all(),
        env.DB.prepare(`SELECT c.name,SUM(t.amount) AS total FROM lifeos_transactions t
            LEFT JOIN lifeos_transaction_categories c ON c.id=t.category_id
            WHERE t.type='expense' AND t.category_id IS NOT NULL AND t.date>=? AND t.date<=? GROUP BY t.category_id ORDER BY total DESC LIMIT 1`).bind(weekStart, weekEnd).all()
    ]);
    const moodValues = (journals.results || []).filter(r => r.mood_score != null).map(r => Number(r.mood_score)).filter(Number.isFinite);
    const energyValues = (journals.results || []).filter(r => r.energy != null).map(r => Number(r.energy)).filter(Number.isFinite);
    const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const totalTasks = Number(active?.count || 0);
    const taskRate = totalTasks ? Math.floor(Number(done?.count || 0) * 100 / totalTasks) : 0;
    const possibleHabitLogs = Number(habitTotal?.count || 0) * 7;
    const habitRate = possibleHabitLogs ? Math.floor(Number(habitLogs?.count || 0) * 100 / possibleHabitLogs) : 0;
    const income = Number(financial?.income || 0), expenses = Number(financial?.expenses || 0);
    const focus = Number(time?.total || 0);
    let longestHabitStreak = { name: '', streak: 0 };
    for (const habit of habits.results || []) {
        const logs = await env.DB.prepare('SELECT date FROM lifeos_habit_logs WHERE habit_id=? ORDER BY date DESC LIMIT 100').bind(habit.id).all();
        const dates = new Set((logs.results || []).map(row => String(row.date).slice(0, 10)));
        let streak = 0;
        for (let day = 0; day < 60; day++) {
            const date = new Date(today.getTime() - day * 86400000).toISOString().slice(0, 10);
            if (!dates.has(date)) break;
            streak++;
        }
        if (streak > longestHabitStreak.streak) longestHabitStreak = { name: habit.name, streak };
    }
    const moodTrend = moodValues.length >= 4
        ? (() => {
            const half = Math.floor(moodValues.length / 2);
            const first = average(moodValues.slice(0, half));
            const second = average(moodValues.slice(half));
            return second > first + .3 ? 'improving' : second < first - .3 ? 'declining' : 'stable';
        })()
        : 'stable';
    const highlights = [];
    if (completed.results?.length) highlights.push(`Completed ${completed.results.length} task${completed.results.length === 1 ? '' : 's'} this week${completed.results.length >= 5 ? ' — great productivity!' : ''}`);
    if (habitRate >= 80) highlights.push(`Habit completion rate of ${habitRate}% — outstanding consistency!`);
    else if (habitRate >= 50) highlights.push(`Habit completion at ${habitRate}% — keep building that momentum!`);
    if (longestHabitStreak.streak >= 7) highlights.push(`"${longestHabitStreak.name}" streak reached ${longestHabitStreak.streak} days 🔥`);
    if (focus > 0) highlights.push(`Logged ${(focus / 60).toFixed(1)} hours of focused work`);
    if (Number(pomodoros?.count || 0) > 0) highlights.push(`Completed ${Number(pomodoros.count)} pomodoro focus session${Number(pomodoros.count) === 1 ? '' : 's'}`);
    if (income > expenses) highlights.push(`Net savings of $${(income - expenses).toFixed(2)} this week`);
    if (moodTrend === 'improving') highlights.push('Mood trending upward this week 😊');
    if (highlights.length < 3) {
        if (!completed.results?.length) highlights.push('No tasks completed this week — set a goal for next week!');
        if (highlights.length < 3) highlights.push('A new week is ahead — plan your priorities and set intentions');
    }
    const scoreParts = Math.min(100, taskRate) * .25 + Math.min(100, habitRate) * .25
        + Math.min(100, focus / 12) * .15 + Math.min(100, average(moodValues) / 5 * 100) * .15
        + Math.min(100, average(energyValues) / 5 * 100) * .1
        + (income > expenses ? Math.min(100, (income - expenses) / Math.max(income, 1) * 100) * .1 : 0);
    const score = Math.min(100, Math.trunc(scoreParts));
    return json({ weekRange: { start: weekStart.slice(0, 10), end: weekEnd.slice(0, 10) }, tasksCompleted: completed.results?.length || 0,
        tasksCreated: Number(created?.count || 0), taskCompletionRate: taskRate,
        topCompletedTasks: (completed.results || []).sort((a,b) => ['urgent','high','medium','low'].indexOf(b.priority)-['urgent','high','medium','low'].indexOf(a.priority)).slice(0,5),
        habitsCompleted: Number(habitLogs?.count || 0), habitCompletionRate: habitRate, longestHabitStreak,
        totalFocusTime: focus, pomodoroSessions: Number(pomodoros?.count || 0), moodTrend,
        avgMoodScore: Math.round(average(moodValues)*10)/10, avgEnergyScore: Math.round(average(energyValues)*10)/10,
        avgSleepQuality: Math.round(average(energyValues)*10)/10, totalCaloriesBurned: 0,
        financialSummary: {
            income: Math.round(income * 100) / 100,
            expenses: Math.round(expenses * 100) / 100,
            netSavings: Math.round((income - expenses) * 100) / 100,
            topExpenseCategory: expensesByCategory.results?.[0]?.name || 'N/A'
        },
        goalsProgress: (goals.results || []).filter(g => g.updated_at >= weekStart).map(g => ({
            id: g.id, title: g.title, progressChange: Math.floor(Math.max(Number(g.progress) * .1, 5))
        })),
        highlights: highlights.slice(0,4), weekScore: score });
}

async function handleLifeOsDataStats(request, env, url) {
    if (url.pathname !== '/api/personal-workbench/lifeos/data/stats' || request.method !== 'GET') return null;
    const counts = {};
    const models = {
        tasks: 'personal_workbench_lifeos_tasks', projects: 'personal_workbench_lifeos_projects', notes: 'lifeos_notes',
        habits: 'lifeos_habits', habitLogs: 'lifeos_habit_logs', journalEntries: 'lifeos_journal_entries',
        transactions: 'lifeos_transactions', goals: 'lifeos_goals', courses: 'lifeos_courses',
        calendarEvents: 'lifeos_calendar_events', timeEntries: 'lifeos_time_entries', tags: 'lifeos_tags'
    };
    for (const [key, table] of Object.entries(models)) counts[key] = Number((await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first())?.count || 0);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const storageKb = Math.floor(total * 1.5);
    const profile = await env.DB.prepare('SELECT created_at FROM lifeos_user_profile ORDER BY created_at LIMIT 1').first();
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const since = new Date(today.getTime() - 364 * 86400000).toISOString();
    const activityDates = await Promise.all([
        env.DB.prepare('SELECT substr(created_at,1,10) AS day FROM personal_workbench_lifeos_tasks WHERE created_at>=?').bind(since).all(),
        env.DB.prepare('SELECT substr(created_at,1,10) AS day FROM lifeos_journal_entries WHERE created_at>=?').bind(since).all(),
        env.DB.prepare('SELECT substr(created_at,1,10) AS day FROM lifeos_habit_logs WHERE created_at>=?').bind(since).all()
    ]);
    const activeDays = new Set(activityDates.flatMap(result => (result.results || []).map(row => row.day)));
    let activityStreak = 0;
    let daysBack = activeDays.has(today.toISOString().slice(0,10)) ? 0 : 1;
    while (daysBack < 365) {
        const date = new Date(today.getTime() - daysBack * 86400000).toISOString().slice(0,10);
        if (!activeDays.has(date)) break;
        activityStreak++; daysBack++;
    }
    const moduleRecords = { Tasks: counts.tasks, Notes: counts.notes, Habits: counts.habits + counts.habitLogs,
        Journal: counts.journalEntries, Finance: counts.transactions, Goals: counts.goals, Learning: counts.courses,
        Calendar: counts.calendarEvents, Time: counts.timeEntries, Projects: counts.projects, Tags: counts.tags };
    return json({ counts, totalRecords: total, storageSizeMB: Math.round(storageKb / 1024 * 100) / 100,
        storageSizeKB: storageKb, activityStreak, accountCreated: profile?.created_at || nowIso(), moduleRecords });
}

const LIFEOS_PROJECT_STATUSES = new Set(['active', 'on-hold', 'completed', 'cancelled']);

const LIFEOS_DATA_TABLES = [
    ['profile', 'lifeos_user_profile'], ['settings', 'lifeos_settings'], ['workspace', 'lifeos_workspaces'],
    ['widgets', 'lifeos_dashboard_widgets'], ['dashboardLayout', 'lifeos_widgets'], ['tags', 'lifeos_tags'],
    ['projects', 'personal_workbench_lifeos_projects'], ['tasks', 'personal_workbench_lifeos_tasks'],
    ['taskTags', 'lifeos_task_tags'], ['taskDependencies', 'lifeos_task_dependencies'],
    ['noteFolders', 'lifeos_note_folders'], ['notes', 'lifeos_notes'], ['noteTags', 'lifeos_note_tags'],
    ['noteLinks', 'lifeos_note_links'], ['bookmarks', 'lifeos_bookmarks'], ['bookmarkTags', 'lifeos_bookmark_tags'],
    ['habits', 'lifeos_habits'], ['habitTags', 'lifeos_habit_tags'], ['habitLogs', 'lifeos_habit_logs'],
    ['goals', 'lifeos_goals'], ['goalTags', 'lifeos_goal_tags'], ['milestones', 'lifeos_milestones'],
    ['goalProjects', 'lifeos_goal_projects'], ['journalEntries', 'lifeos_journal_entries'], ['journalTags', 'lifeos_journal_tags'],
    ['financeAccounts', 'lifeos_finance_accounts'], ['transactionCategories', 'lifeos_transaction_categories'],
    ['transactions', 'lifeos_transactions'], ['budgets', 'lifeos_budgets'], ['budgetItems', 'lifeos_budget_items'],
    ['courses', 'lifeos_courses'], ['courseResources', 'lifeos_course_resources'],
    ['calendarEvents', 'lifeos_calendar_events'], ['timeEntries', 'lifeos_time_entries'],
    ['pomodoroSessions', 'lifeos_pomodoro_sessions']
];
const toCamel = value => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const toSnake = value => value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const LIFEOS_EXPORT_FIELD_ALIASES = {
    workspace: { sort_order: 'order' }, widgets: { sort_order: 'order' },
    noteFolders: { sort_order: 'order' }, milestones: { sort_order: 'order' },
    courseResources: { sort_order: 'order' }
};

async function handleLifeOsDataManagement(request, env, url, actor) {
    if (url.pathname === '/api/personal-workbench/lifeos/data/export' && request.method === 'GET') {
        const data = {};
        for (const [key, table] of LIFEOS_DATA_TABLES) {
            const rows = await env.DB.prepare(`SELECT * FROM ${table}`).all();
            const aliases = LIFEOS_EXPORT_FIELD_ALIASES[key] || {};
            data[key] = (rows.results || []).map(row => Object.fromEntries(Object.entries(row)
                .map(([column, value]) => [aliases[column] || toCamel(column), value])));
        }
        // Keep upstream Life OS project IDs stable at the API/backup boundary.
        const projectIds = new Map(data.projects.map(project => [String(project.id), project.sourceId || String(project.id)]));
        data.projects = data.projects.map(({ id, title, sourceId, ...row }) => ({ ...row, id: sourceId || String(id), name: title }));
        data.tasks = data.tasks.map(task => ({ ...task, projectId: task.projectId == null ? null : (projectIds.get(String(task.projectId)) || String(task.projectId)) }));
        data.goalProjects = data.goalProjects.map(link => ({ ...link, projectId: projectIds.get(String(link.projectId)) || String(link.projectId) }));
        const stats = await handleLifeOsDataStats(request, env, new URL('https://local/api/personal-workbench/lifeos/data/stats'));
        const statsBody = await stats.json();
        return json({ version: '1.0.0', exportedAt: nowIso(), data, stats: statsBody });
    }
    if (url.pathname === '/api/personal-workbench/lifeos/data/import' && request.method === 'POST') {
        const body = await bodyOf(request);
        if (!body || typeof body.version !== 'string' || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
            return json({ error: "Invalid import format: expected 'version' and object 'data'" }, 400);
        }
        const imported = {};
        let totalImported = 0;
        const projectIdMap = new Map();
        const maxProject = await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS id FROM personal_workbench_lifeos_projects').first();
        let nextProjectId = Number(maxProject?.id || 0) + 1;
        const currentProjects = await env.DB.prepare('SELECT id,source_id FROM personal_workbench_lifeos_projects').all();
        const existingProjectIds = new Map((currentProjects.results || []).filter(project => project.source_id != null)
            .map(project => [String(project.source_id), Number(project.id)]));
        const occupiedProjectIds = new Map((currentProjects.results || []).map(project => [Number(project.id), project.source_id == null ? null : String(project.source_id)]));
        for (const [key, table] of LIFEOS_DATA_TABLES) {
            let rows = body.data[key];
            if (key === 'projects' && Array.isArray(rows)) rows = rows.map(({ name, ...row }) => {
                const sourceId = row.id == null ? null : String(row.id);
                const existingId = sourceId ? existingProjectIds.get(sourceId) : undefined;
                const numericSourceId = sourceId && /^\d+$/.test(sourceId) ? Number(sourceId) : null;
                const sourceIdCanUseNumericKey = numericSourceId !== null
                    && (!occupiedProjectIds.has(numericSourceId) || occupiedProjectIds.get(numericSourceId) === sourceId);
                const numericId = existingId ?? (sourceIdCanUseNumericKey ? numericSourceId : nextProjectId++);
                occupiedProjectIds.set(numericId, sourceId);
                if (numericId >= nextProjectId) nextProjectId = numericId + 1;
                if (sourceId) projectIdMap.set(sourceId, String(numericId));
                return { ...row, id: numericId, sourceId, title: row.title ?? name };
            });
            if (!Array.isArray(rows)) continue;
            const schema = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
            const allowed = new Set((schema.results || []).map(column => column.name));
            const statements = [];
            for (const rawRow of rows) {
                let row = rawRow;
                if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
                if (key === 'tasks' && row.projectId != null) {
                    const mappedProjectId = projectIdMap.get(String(row.projectId));
                    if (mappedProjectId !== undefined) row = { ...row, projectId: Number(mappedProjectId) };
                }
                const columnAliases = key === 'workspace' ? { order: 'sort_order', isDefault: 'is_default' }
                    : key === 'widgets' ? { workspaceId: 'workspace_id', positionX: 'position_x', positionY: 'position_y', order: 'sort_order' }
                        : {};
                const fields = Object.entries(row).map(([name, value]) => {
                    const column = columnAliases[name] || toSnake(name);
                    const dateValue = typeof value === 'number' && /(_at|_date)$|^date$/.test(column) ? new Date(value).toISOString() : value;
                    const projectColumn = key === 'projects' && name === 'sourceId' ? ['source_id', value == null ? null : String(value)] : null;
                    return projectColumn || [column, dateValue];
                }).filter(([name]) => allowed.has(name));
                if (!fields.length) continue;
                const names = fields.map(([name]) => name);
                const placeholders = names.map(() => '?').join(',');
                const values = fields.map(([, value]) => typeof value === 'boolean' ? Number(value) : value);
                statements.push(env.DB.prepare(`INSERT OR REPLACE INTO ${table} (${names.join(',')}) VALUES (${placeholders})`).bind(...values));
            }
            for (let offset = 0; offset < statements.length; offset += 50) await env.DB.batch(statements.slice(offset, offset + 50));
            imported[key] = statements.length;
            totalImported += statements.length;
        }
        await auditLifeOs(env, actor, 'data.imported', null, { totalImported, models: Object.keys(imported) });
        return json({ success: true, imported, totalImported });
    }
    if (url.pathname === '/api/personal-workbench/lifeos/data/reset' && request.method === 'DELETE') {
        // Delete only namespaced Life OS data. HappySpa customers, bookings,
        // payments, staff, and the private-entry configuration are untouched.
        const deletionOrder = [...LIFEOS_DATA_TABLES].reverse().map(([, table]) => table);
        for (const table of deletionOrder) await env.DB.prepare(`DELETE FROM ${table}`).run();
        await env.DB.prepare('DELETE FROM personal_workbench_lifeos_audit_log').run();
        return json({ success: true, message: 'All Life OS data has been reset' });
    }
    return null;
}

async function lifeOsProjectGoals(env, projectId) {
    const project = await resolveLifeOsProject(env, projectId);
    if (!project) return [];
    const sourceId = project.source_id || String(project.id);
    const rows = await env.DB.prepare(`SELECT gp.id,gp.goal_id,gp.project_id,g.title FROM lifeos_goal_projects gp
        JOIN lifeos_goals g ON g.id=gp.goal_id WHERE gp.project_id=? ORDER BY g.title`).bind(sourceId).all();
    return (rows.results || []).map(row => ({ id: row.id, goalId: row.goal_id, projectId: sourceId,
        goal: { id: row.goal_id, title: row.title } }));
}

async function resolveLifeOsProject(env, projectId) {
    if (projectId == null || projectId === '') return null;
    const value = String(projectId);
    return env.DB.prepare(`SELECT * FROM personal_workbench_lifeos_projects
        WHERE source_id=? OR (source_id IS NULL AND CAST(id AS TEXT)=?) LIMIT 1`).bind(value, value).first();
}

function lifeOsProject(row, taskCount = 0, goals = []) {
    return {
        id: row.source_id || String(row.id), name: row.title, description: row.description,
        color: row.color, icon: row.icon, status: row.status,
        startDate: row.start_date, endDate: row.end_date, archived: Boolean(row.archived),
        createdAt: row.created_at, updatedAt: row.updated_at,
        nextAction: row.next_action, resumeContext: row.resume_context, blocker: row.blocker,
        _count: { tasks: Number(taskCount) }, goals
    };
}

async function handleLifeOsProjectCompatibility(request, env, url, actor) {
    const base = '/api/personal-workbench/lifeos/compat/projects';
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
