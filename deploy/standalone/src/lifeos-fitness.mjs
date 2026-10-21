import { json } from './app/response.mjs';

const ROOT = '/api/personal-workbench/lifeos/fitness';
const id = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const clean = (value, max = 180) => String(value ?? '').trim().slice(0, max);
const missing = () => json({ error: 'Not found' }, 404);
const bodyOf = async request => { try { return await request.json(); } catch { return {}; } };

async function planDetails(env, plan, owner) {
  const rows = await env.DB.prepare(`SELECT id,name,position FROM lifeos_fitness_plan_exercises
    WHERE plan_id=? AND owner_username=? ORDER BY position,id`).bind(plan.id, owner).all();
  return { id: plan.id, name: plan.name, description: plan.description,
    exercises: rows.results || [], createdAt: plan.created_at, updatedAt: plan.updated_at };
}

async function sessionDetails(env, session, owner) {
  const rows = await env.DB.prepare(`SELECT id,name,position FROM lifeos_fitness_session_exercises
    WHERE session_id=? AND owner_username=? ORDER BY position,id`).bind(session.id, owner).all();
  const exercises = [];
  for (const exercise of rows.results || []) {
    const sets = await env.DB.prepare(`SELECT id,set_number,reps,weight_kg,created_at FROM lifeos_fitness_sets
      WHERE exercise_id=? AND owner_username=? ORDER BY set_number`).bind(exercise.id, owner).all();
    exercises.push({ id: exercise.id, name: exercise.name, position: exercise.position,
      sets: (sets.results || []).map(set => ({ id: set.id, setNumber: set.set_number,
        reps: set.reps, weightKg: set.weight_kg, createdAt: set.created_at })) });
  }
  return { id: session.id, planId: session.plan_id, title: session.title, status: session.status,
    startedAt: session.started_at, endedAt: session.ended_at, notes: session.notes, exercises };
}

export async function handleLifeOsFitness(request, env, url, owner) {
  const path = url.pathname;
  if (!path.startsWith(`${ROOT}/`) && path !== ROOT) return null;
  if (!owner) return missing();
  const now = stamp();

  if (path === `${ROOT}/plans` && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT * FROM lifeos_fitness_plans WHERE owner_username=? ORDER BY updated_at DESC`)
      .bind(owner).all();
    return json(await Promise.all((rows.results || []).map(row => planDetails(env, row, owner))));
  }
  if (path === `${ROOT}/plans` && request.method === 'POST') {
    const body = await bodyOf(request); const name = clean(body.name);
    const exercises = Array.isArray(body.exercises) ? body.exercises.map(value => clean(value, 100)).filter(Boolean).slice(0, 40) : [];
    if (!name) return json({ error: 'Plan name is required' }, 400);
    if (!exercises.length) return json({ error: 'Add at least one exercise' }, 400);
    const planId = id();
    await env.DB.prepare(`INSERT INTO lifeos_fitness_plans (id,owner_username,name,description,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).bind(planId, owner, name, clean(body.description, 1000) || null, now, now).run();
    for (const [position, exerciseName] of exercises.entries()) {
      await env.DB.prepare(`INSERT INTO lifeos_fitness_plan_exercises (id,owner_username,plan_id,name,position,created_at)
        VALUES (?,?,?,?,?,?)`).bind(id(), owner, planId, exerciseName, position, now).run();
    }
    return json(await planDetails(env, await env.DB.prepare('SELECT * FROM lifeos_fitness_plans WHERE id=? AND owner_username=?').bind(planId, owner).first(), owner), 201);
  }
  if (path === `${ROOT}/sessions` && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT * FROM lifeos_fitness_sessions WHERE owner_username=? ORDER BY started_at DESC LIMIT 100`)
      .bind(owner).all();
    return json(await Promise.all((rows.results || []).map(row => sessionDetails(env, row, owner))));
  }
  if (path === `${ROOT}/sessions` && request.method === 'POST') {
    const body = await bodyOf(request); const planId = clean(body.planId, 80);
    const plan = await env.DB.prepare('SELECT * FROM lifeos_fitness_plans WHERE id=? AND owner_username=?').bind(planId, owner).first();
    if (!plan) return missing();
    const planExercises = await env.DB.prepare(`SELECT name,position FROM lifeos_fitness_plan_exercises
      WHERE plan_id=? AND owner_username=? ORDER BY position`).bind(planId, owner).all();
    if (!planExercises.results?.length) return json({ error: 'Plan has no exercises' }, 409);
    const sessionId = id(); const title = clean(body.title, 180) || plan.name;
    await env.DB.prepare(`INSERT INTO lifeos_fitness_sessions
      (id,owner_username,plan_id,title,status,started_at,created_at,updated_at) VALUES (?,?,?,?,'active',?,?,?)`)
      .bind(sessionId, owner, planId, title, now, now, now).run();
    for (const [position, exercise] of planExercises.results.entries()) {
      await env.DB.prepare(`INSERT INTO lifeos_fitness_session_exercises (id,owner_username,session_id,name,position,created_at)
        VALUES (?,?,?,?,?,?)`).bind(id(), owner, sessionId, exercise.name, position, now).run();
    }
    return json(await sessionDetails(env, await env.DB.prepare('SELECT * FROM lifeos_fitness_sessions WHERE id=? AND owner_username=?').bind(sessionId, owner).first(), owner), 201);
  }

  const setRoute = path.match(new RegExp(`^${ROOT}/sessions/([a-f0-9-]+)/sets$`));
  if (setRoute && request.method === 'POST') {
    const sessionId = setRoute[1]; const body = await bodyOf(request);
    const session = await env.DB.prepare(`SELECT id FROM lifeos_fitness_sessions WHERE id=? AND owner_username=? AND status='active'`)
      .bind(sessionId, owner).first();
    if (!session) return missing();
    const exerciseId = clean(body.exerciseId, 80);
    const exercise = await env.DB.prepare(`SELECT id FROM lifeos_fitness_session_exercises WHERE id=? AND session_id=? AND owner_username=?`)
      .bind(exerciseId, sessionId, owner).first();
    if (!exercise) return missing();
    const reps = Number(body.reps); const weight = Number(body.weightKg);
    if (!Number.isInteger(reps) || reps < 1 || reps > 1000 || !Number.isFinite(weight) || weight < 0 || weight > 2000)
      return json({ error: 'Reps must be 1–1000 and weight must be 0–2000 kg' }, 400);
    const last = await env.DB.prepare('SELECT MAX(set_number) AS n FROM lifeos_fitness_sets WHERE exercise_id=? AND owner_username=?')
      .bind(exerciseId, owner).first();
    const setId = id(); const setNumber = Number(last?.n || 0) + 1;
    await env.DB.prepare(`INSERT INTO lifeos_fitness_sets (id,owner_username,exercise_id,set_number,reps,weight_kg,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(setId, owner, exerciseId, setNumber, reps, weight, now).run();
    return json({ id: setId, setNumber, reps, weightKg: weight, createdAt: now }, 201);
  }

  const sessionRoute = path.match(new RegExp(`^${ROOT}/sessions/([a-f0-9-]+)$`));
  if (sessionRoute) {
    const sessionId = sessionRoute[1];
    const session = await env.DB.prepare('SELECT * FROM lifeos_fitness_sessions WHERE id=? AND owner_username=?')
      .bind(sessionId, owner).first();
    if (!session) return missing();
    if (request.method === 'GET') return json(await sessionDetails(env, session, owner));
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const body = await bodyOf(request);
    if (body.status !== 'completed' && body.status !== 'cancelled') return json({ error: 'Invalid session status' }, 400);
    if (session.status !== 'active') return json({ error: 'Session is already closed' }, 409);
    await env.DB.prepare('UPDATE lifeos_fitness_sessions SET status=?,ended_at=?,updated_at=? WHERE id=? AND owner_username=?')
      .bind(body.status, now, now, sessionId, owner).run();
    return json(await sessionDetails(env, await env.DB.prepare('SELECT * FROM lifeos_fitness_sessions WHERE id=? AND owner_username=?').bind(sessionId, owner).first(), owner));
  }
  return null;
}
