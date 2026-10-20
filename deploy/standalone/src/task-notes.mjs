import { json } from './app/response.mjs';

const ROUTE = /^\/api\/personal-workbench\/lifeos\/tasks\/([^/]+)\/notes(?:\/([^/]+)(?:\/images\/([^/]+))?)?$/;
const AUDIT = 'personal_workbench_lifeos_audit_log';

const bad = (error, status = 400) => json({ error }, status);
const dec = s => { try { return decodeURIComponent(s); } catch { return null; } };
const actorId = a => typeof a === 'string' ? a : (a && (a.id || a.email || a.sub || a.userId)) || 'unknown';
const imgUrl = (t, n, i) => `/api/tasks/${encodeURIComponent(t)}/notes/${encodeURIComponent(n)}/images/${encodeURIComponent(i)}`;

function parseImages(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.id === 'string') : []; } catch { return []; }
}

function noteJson(r) {
  return {
    id: r.id, taskId: r.task_id, content: r.content,
    images: parseImages(r.images_json).map(x => ({ id: x.id, name: x.name, mime: x.mime, url: imgUrl(r.task_id, r.id, x.id) })),
    revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at
  };
}

function parseImageDataUrl(s) {
  const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) return null;
  const b64 = m[3];
  if (b64.length > 4 * Math.ceil(160 * 1024 / 3) || b64.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) return null;
  let bin;
  try { bin = atob(b64); } catch { return null; }
  if (bin.length === 0 || bin.length > 160 * 1024) return null;
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const mime = m[1];
  if (mime === 'image/png' && !(b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)) return null;
  if (mime === 'image/jpeg' && !(b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return null;
  if (mime === 'image/webp' && !(b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)) return null;
  return { mime, bytes: b };
}

export function validateNotePayload(p, oldImages = null) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: '请求体必须是JSON对象' };
  if (typeof p.content !== 'string') return { ok: false, error: 'content必须是字符串' };
  if (Array.from(p.content).length > 20000) return { ok: false, error: 'content超过20000字符' };
  if (!Array.isArray(p.images)) return { ok: false, error: 'images必须是数组' };
  if (p.images.length > 4) return { ok: false, error: '图片最多4张' };
  const old = new Map((oldImages || []).map(x => [x.id, x]));
  const out = [], seen = new Set();
  for (const it of p.images) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { ok: false, error: '图片格式错误' };
    let img;
    if (typeof it.id === 'string' && it.name === undefined && it.dataUrl === undefined) {
      img = old.get(it.id);
      if (!img) return { ok: false, error: '图片不存在' };
    } else {
      if (it.id !== undefined) return { ok: false, error: '图片格式错误' };
      if (typeof it.name !== 'string') return { ok: false, error: '图片name必须是字符串' };
      if (!it.name.trim() || Array.from(it.name).length > 120) return { ok: false, error: '图片name超过120字符' };
      if (typeof it.dataUrl !== 'string') return { ok: false, error: '图片dataUrl必须是字符串' };
      const parsed = parseImageDataUrl(it.dataUrl);
      if (!parsed) return { ok: false, error: '仅支持png/jpeg/webp图片' };
      img = { id: crypto.randomUUID(), name: it.name, mime: parsed.mime, dataUrl: it.dataUrl };
    }
    if (seen.has(img.id)) return { ok: false, error: '图片id重复' };
    seen.add(img.id); out.push(img);
  }
  if (p.content.trim().length === 0 && out.length === 0) return { ok: false, error: '备注不能为空' };
  return { ok: true, content: p.content, images: out };
}

async function readJson(request) {
  try { return await request.json(); } catch { return undefined; }
}

async function listNotes(url, env, taskId) {
  const cursor = url.searchParams.get('cursor');
  let before = null;
  if (cursor) {
    before = await env.DB.prepare('SELECT id,created_at FROM lifeos_task_notes WHERE id=? AND task_id=?').bind(cursor, taskId).first();
    if (!before) return bad('游标无效');
  }
  const stmt = before
    ? env.DB.prepare('SELECT * FROM lifeos_task_notes WHERE task_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 21').bind(taskId, before.created_at, before.created_at, before.id)
    : env.DB.prepare('SELECT * FROM lifeos_task_notes WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT 21').bind(taskId);
  const rows = (await stmt.all()).results || [];
  const more = rows.length > 20;
  const page = more ? rows.slice(0, 20) : rows;
  return json({ notes: page.map(noteJson), nextCursor: more ? page[page.length - 1].id : null }, 200, { 'Cache-Control': 'no-store' });
}

async function createNote(request, env, taskId, actor) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('JSON格式错误');
  const v = validateNotePayload(body);
  if (!v.ok) return bad(v.error);
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const imagesJson = JSON.stringify(v.images);
  const results = await env.DB.batch([
    env.DB.prepare('INSERT INTO lifeos_task_notes (id,task_id,content,images_json,revision,created_at,updated_at) VALUES (?,?,?,?,1,?,?)').bind(id, taskId, v.content, imagesJson, now, now),
    env.DB.prepare('UPDATE personal_workbench_lifeos_tasks SET updated_at=? WHERE id=?').bind(now, taskId),
    env.DB.prepare(`INSERT INTO ${AUDIT} (actor,action,entity_id,detail_json,created_at) VALUES (?,?,?,?,?)`).bind(actorId(actor), 'task_note.create', id, JSON.stringify({ noteId: id }), now)
  ]);
  if (!results?.[0]?.meta?.changes) return bad('创建失败', 500);
  return json(noteJson({ id, task_id: taskId, content: v.content, images_json: imagesJson, revision: 1, created_at: now, updated_at: now }), 201, { 'Cache-Control': 'no-store' });
}

async function updateNote(request, env, taskId, noteId, actor) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('JSON格式错误');
  const rev = body.expectedRevision;
  if (!Number.isSafeInteger(rev) || rev < 1) return bad('expectedRevision必须是正整数');
  const row = await env.DB.prepare('SELECT * FROM lifeos_task_notes WHERE id=? AND task_id=?').bind(noteId, taskId).first();
  if (!row) return bad('备注不存在', 404);
  if (row.revision !== rev) return bad('备注已被修改，请刷新后重试', 409);
  const v = validateNotePayload(body, parseImages(row.images_json));
  if (!v.ok) return bad(v.error);
  const now = new Date().toISOString(), next = rev + 1;
  const imagesJson = JSON.stringify(v.images), detail = JSON.stringify({ noteId });
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE lifeos_task_notes SET content=?,images_json=?,revision=?,updated_at=? WHERE id=? AND task_id=? AND revision=?').bind(v.content, imagesJson, next, now, noteId, taskId, rev),
    // changes() is scoped to the preceding statement on the same batch transaction.
    env.DB.prepare(`INSERT INTO ${AUDIT} (actor,action,entity_id,detail_json,created_at) SELECT ?,?,?,?,? WHERE changes()>0`).bind(actorId(actor), 'task_note.update', noteId, detail, now),
    env.DB.prepare('UPDATE personal_workbench_lifeos_tasks SET updated_at=? WHERE id=? AND changes()>0').bind(now, taskId)
  ]);
  if (!results?.[0]?.meta?.changes) return bad('备注已被修改，请刷新后重试', 409);
  return json(noteJson({ ...row, content: v.content, images_json: imagesJson, revision: next, updated_at: now }), 200, { 'Cache-Control': 'no-store' });
}

async function deleteNote(url, env, taskId, noteId, actor) {
  const s = url.searchParams.get('revision');
  if (s === null || !/^\d+$/.test(s)) return bad('revision必须是正整数');
  const rev = Number(s);
  if (!Number.isSafeInteger(rev) || rev < 1) return bad('revision必须是正整数');
  const row = await env.DB.prepare('SELECT revision FROM lifeos_task_notes WHERE id=? AND task_id=?').bind(noteId, taskId).first();
  if (!row) return bad('备注不存在', 404);
  if (row.revision !== rev) return bad('备注已被修改，请刷新后重试', 409);
  const now = new Date().toISOString(), detail = JSON.stringify({ noteId });
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE personal_workbench_lifeos_tasks SET updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM lifeos_task_notes WHERE id=? AND task_id=? AND revision=?)').bind(now, taskId, noteId, taskId, rev),
    env.DB.prepare(`INSERT INTO ${AUDIT} (actor,action,entity_id,detail_json,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM lifeos_task_notes WHERE id=? AND task_id=? AND revision=?)`).bind(actorId(actor), 'task_note.delete', noteId, detail, now, noteId, taskId, rev),
    env.DB.prepare('DELETE FROM lifeos_task_notes WHERE id=? AND task_id=? AND revision=?').bind(noteId, taskId, rev)
  ]);
  if (!results?.[2]?.meta?.changes) return bad('备注已被修改，请刷新后重试', 409);
  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
}

async function getImage(env, taskId, noteId, imageId) {
  const r = await env.DB.prepare('SELECT images_json FROM lifeos_task_notes WHERE id=? AND task_id=?').bind(noteId, taskId).first();
  if (!r) return bad('图片不存在', 404);
  const img = parseImages(r.images_json).find(x => x.id === imageId);
  if (!img) return bad('图片不存在', 404);
  const parsed = parseImageDataUrl(img.dataUrl);
  if (!parsed) return bad('图片不存在', 404);
  return new Response(parsed.bytes, { status: 200, headers: { 'Content-Type': parsed.mime, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } });
}

export async function handleTaskNotes(request, env, url, actor) {
  const m = ROUTE.exec(url.pathname);
  if (!m) return null;
  const taskId = dec(m[1]);
  const noteId = m[2] === undefined ? null : dec(m[2]);
  const imageId = m[3] === undefined ? null : dec(m[3]);
  if (taskId === null || (m[2] !== undefined && noteId === null) || (m[3] !== undefined && imageId === null)) return bad('路径参数解码失败');
  const method = request.method.toUpperCase();
  const collection = noteId === null, image = imageId !== null;
  if (collection) {
    if (method !== 'GET' && method !== 'POST') return bad('方法不允许', 405);
  } else if (image) {
    if (method !== 'GET') return bad('方法不允许', 405);
  } else if (method !== 'GET' && method !== 'PATCH' && method !== 'DELETE') return bad('方法不允许', 405);
  const task = await env.DB.prepare('SELECT id FROM personal_workbench_lifeos_tasks WHERE id=?').bind(taskId).first();
  if (!task) return bad('任务不存在', 404);
  if (collection) return method === 'GET' ? listNotes(url, env, taskId) : createNote(request, env, taskId, actor);
  if (image) return getImage(env, taskId, noteId, imageId);
  if (method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM lifeos_task_notes WHERE id=? AND task_id=?').bind(noteId, taskId).first();
    return row ? json(noteJson(row)) : bad('备注不存在', 404);
  }
  if (method === 'PATCH') return updateNote(request, env, taskId, noteId, actor);
  return deleteNote(url, env, taskId, noteId, actor);
}
