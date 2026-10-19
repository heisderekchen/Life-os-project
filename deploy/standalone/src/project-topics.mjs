import { json } from './app/response.mjs'

const base = '/api/personal-workbench/lifeos/topics'
const clean = value => typeof value === 'string' ? value.trim() : ''
const serialize = row => ({ id: row.id, name: row.name, projectId: row.source_id || String(row.project_id), createdAt: row.created_at, updatedAt: row.updated_at })
const select = `SELECT t.*,p.source_id FROM lifeos_project_topics t JOIN personal_workbench_lifeos_projects p ON p.id=t.project_id`

export async function taskTopicForProject(env, topicId, projectId) {
  if (topicId == null || topicId === '') return { topicId: null }
  if (typeof topicId !== 'string') return { error: '主题无效', status: 400 }
  const topic = await env.DB.prepare('SELECT project_id FROM lifeos_project_topics WHERE id=?').bind(topicId).first()
  if (!topic) return { error: '主题不存在，请刷新后重试', status: 404 }
  if (projectId == null || Number(topic.project_id) !== Number(projectId)) return { error: '主题必须属于任务所在项目', status: 400 }
  return { topicId }
}

export async function handleProjectTopics(request, env, url, actor) {
  const match = url.pathname.match(/^\/api\/personal-workbench\/lifeos\/topics\/([a-zA-Z0-9-]+)$/)
  if (url.pathname !== base && !match) return null
  const id = match?.[1]
  if (!id && request.method === 'GET') {
    const rows = await env.DB.prepare(`${select} ORDER BY t.updated_at DESC,t.id`).all()
    return json((rows.results || []).map(serialize))
  }
  const existing = id ? await env.DB.prepare(`${select} WHERE t.id=?`).bind(id).first() : null
  if (id && !existing) return json({ error: '主题不存在' }, 404)
  const audit = (action, detail) => env.DB.prepare(`INSERT INTO personal_workbench_lifeos_audit_log
    (action,entity_id,detail_json,actor,created_at) VALUES (?,?,?,?,?)`).bind(action, id || detail.id, JSON.stringify(detail), actor, new Date().toISOString())
  if (id && request.method === 'DELETE') {
    const timestamp = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare('UPDATE personal_workbench_lifeos_tasks SET topic_id=NULL,updated_at=? WHERE topic_id=?').bind(timestamp, id),
      env.DB.prepare('DELETE FROM lifeos_project_topics WHERE id=?').bind(id),
      audit('topic.deleted', { name: existing.name }),
    ])
    return json({ success: true })
  }
  if ((!id && request.method !== 'POST') || (id && request.method !== 'PATCH')) return json({ error: 'Method not allowed' }, 405)
  let body
  try { body = await request.json() } catch { return json({ error: '请求格式无效' }, 400) }
  const name = clean(body?.name)
  if (!name || name.length > 120) return json({ error: '主题名称需要 1–120 个字符' }, 400)
  let projectId = existing?.project_id
  if (!id) {
    const project = await env.DB.prepare(`SELECT id FROM personal_workbench_lifeos_projects
      WHERE source_id=? OR (source_id IS NULL AND CAST(id AS TEXT)=?)`).bind(clean(body.projectId), clean(body.projectId)).first()
    if (!project) return json({ error: '请先选择项目' }, 400)
    projectId = Number(project.id)
  }
  const duplicate = await env.DB.prepare('SELECT id FROM lifeos_project_topics WHERE project_id=? AND name=? COLLATE NOCASE AND id!=?')
    .bind(projectId, name, id || '').first()
  if (duplicate) return json({ error: '该项目下已有同名主题' }, 409)
  const timestamp = new Date().toISOString()
  const topicId = id || crypto.randomUUID()
  if (id && body.fromUnclassified === true) return json({ error: '只能将未分类分组保存为新主题' }, 400)
  let unclassified = []
  if (!id && body.fromUnclassified === true) {
    // Resolve recorded parent ownership just as the workspace does. This action
    // covers the entire project group, independently of client-side filters.
    const rows = (await env.DB.prepare('SELECT id,project_id,topic_id,parent_task_id,archived,updated_at FROM personal_workbench_lifeos_tasks').all()).results || []
    const topicRows = (await env.DB.prepare('SELECT id,project_id FROM lifeos_project_topics').all()).results || []
    const byId = new Map(rows.map(row => [row.id, row]))
    const topicProjects = new Map(topicRows.map(row => [row.id, Number(row.project_id)]))
    unclassified = rows.filter(row => {
      if (row.archived) return false
      const chain = [], seen = new Set()
      let current = row
      while (current && !seen.has(current.id)) { chain.push(current); seen.add(current.id); current = byId.get(current.parent_task_id) }
      let effectiveProject = null, effectiveTopic = null
      for (const ancestor of chain.reverse()) {
        if (ancestor.project_id != null && ancestor.project_id !== effectiveProject) effectiveTopic = null
        effectiveProject = ancestor.project_id ?? effectiveProject
        effectiveTopic = ancestor.topic_id || effectiveTopic
      }
      return Number(effectiveProject) === projectId && (!effectiveTopic || topicProjects.get(effectiveTopic) !== projectId)
    })
  }
  let movedTaskCount = 0
  try {
    const result = await env.DB.batch([
      id ? env.DB.prepare('UPDATE lifeos_project_topics SET name=?,updated_at=? WHERE id=?').bind(name, timestamp, id)
        : env.DB.prepare('INSERT INTO lifeos_project_topics (id,project_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').bind(topicId, projectId, name, timestamp, timestamp),
      ...unclassified.map(row => env.DB.prepare(`UPDATE personal_workbench_lifeos_tasks SET project_id=?,topic_id=?,updated_at=?
        WHERE id=? AND updated_at=? AND project_id IS ? AND topic_id IS ? AND parent_task_id IS ?`)
        .bind(projectId, topicId, timestamp, row.id, row.updated_at, row.project_id, row.topic_id, row.parent_task_id)),
      audit(id ? 'topic.updated' : 'topic.created', { id: topicId, name, projectId, ...(body.fromUnclassified === true ? { fromUnclassified: true, taskIds: unclassified.map(row => row.id) } : {}) }),
    ])
    movedTaskCount = result.slice(1, 1 + unclassified.length).reduce((sum, item) => sum + Number(item.meta?.changes || 0), 0)
  } catch (error) {
    if (/UNIQUE constraint/i.test(String(error))) return json({ error: '该项目下已有同名主题' }, 409)
    throw error
  }
  const topic = serialize(await env.DB.prepare(`${select} WHERE t.id=?`).bind(topicId).first())
  return json({ ...topic, ...(body.fromUnclassified === true ? { movedTaskCount, skippedTaskCount: unclassified.length - movedTaskCount } : {}) }, id ? 200 : 201)
}
