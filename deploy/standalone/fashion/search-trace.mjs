import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const SEARCH_VERSION = '1.0.13';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_EVENTS = 30000;
const DOCUMENT_BUDGET = 4 * 1024 * 1024;
const SENSITIVE = /^(?:authorization|proxy-authorization|cookie|set-cookie|headers|password|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|session|signature)$/i;

export function errorDetails(error) {
  return { name: error?.name || 'Error', message: error?.message || String(error),
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.cause ? { cause: { name: error.cause.name, message: error.cause.message, code: error.cause.code } } : {}) };
}

// Only caller-supplied diagnostic fields enter the log. Never pass request headers,
// sessions or environment objects. This second layer also redacts credentials in URLs/errors.
export function sanitizeTrace(value, depth = 0) {
  if (depth > 14) return '[depth limit]';
  if (value instanceof Error) return sanitizeTrace(errorDetails(value), depth + 1);
  if (typeof value === 'string') {
    let safe = value;
    for (const secret of [process.env.DEEPSEEK_API_KEY].filter(Boolean)) safe = safe.split(secret).join('[redacted]');
    safe = safe.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
      .replace(/([?&](?:[^=&\s]*(?:token|secret|password|signature|credential|api[_-]?key|session)[^=&\s]*)=)[^&#\s"'<>]*/gi, '$1[redacted]');
    return safe.length > 65536 ? safe.slice(0, 65536) + ` [truncated: ${safe.length} characters]` : safe;
  }
  if (Array.isArray(value)) {
    const out = value.slice(0, 1000).map(v => sanitizeTrace(v, depth + 1));
    if (value.length > 1000) out.push({ truncatedEntries: value.length - 1000 });
    return out;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) =>
    [key, SENSITIVE.test(key) ? '[redacted]' : sanitizeTrace(v, depth + 1)]));
  return value;
}

export function traceFile(dataDir, account, taskId, runId) {
  if (!/^[a-f0-9]{24}$/.test(taskId) || !/^[a-f0-9]{24}$/.test(runId)) throw Error('调试记录编号无效');
  return resolve(dataDir, 'search-debug', createHash('sha256').update(account).digest('hex'), taskId, runId + '.jsonl');
}

export function createSearchTrace({ dataDir, account, taskId, run }) {
  const path = traceFile(dataDir, account, taskId, run.id);
  let tail = Promise.resolve(), buffer = [], bufferedBytes = 0, timer, closed = false, documentBytes = 0;
  run.events = 0; run.bytes = 0; run.droppedEvents = 0; run.documentSamplesOmitted = 0;
  run.captureLimits = { bytes: MAX_BYTES, events: MAX_EVENTS, documentBytes: DOCUMENT_BUDGET, documentCharacters: 64000 };
  const flush = async () => {
    clearTimeout(timer); timer = null;
    const body = buffer.join(''); buffer = []; bufferedBytes = 0;
    if (body && !run.storageError) tail = tail.then(async () => {
      await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
      await appendFile(path, body, { mode: 0o600 });
    }).catch(error => { run.storageError = sanitizeTrace(errorDetails(error)); });
    await tail;
  };
  const emit = (type, data = {}, force = false) => {
    if (closed) return;
    const event = { schemaVersion: 1, runId: run.id, taskId, seq: run.events + 1,
      at: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(run.startedAt), type, data: sanitizeTrace(data) };
    const line = JSON.stringify(event) + '\n', size = Buffer.byteLength(line);
    if (!force && (run.events >= MAX_EVENTS || run.bytes + size > MAX_BYTES - 65536)) { run.droppedEvents++; return; }
    run.events++; run.bytes += size;
    buffer.push(line); bufferedBytes += size;
    if (bufferedBytes >= 65536) void flush();
    else if (!timer) { timer = setTimeout(() => { void flush(); }, 100); timer.unref?.(); }
  };
  const document = (kind, requestedURL, page, durationMs) => {
    const html = page.html || '';
    // Public source snapshots: omit executable scripts and form values. Keep JSON-LD,
    // source metadata, markup and a content hash to diagnose parser/anti-bot failures.
    const sample = html.replace(/<script\b(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, '<!-- script omitted -->')
      .replace(/(<input\b[^>]*\bvalue\s*=\s*)["'][^"']*["']/gi, '$1"[redacted]"');
    const snippet = sample.slice(0, 64000);
    const size = Buffer.byteLength(snippet);
    const included = documentBytes + size <= DOCUMENT_BUDGET;
    if (included) documentBytes += size; else run.documentSamplesOmitted++;
    emit('document.read', { kind, requestedURL, finalURL: page.url, durationMs, characters: html.length,
      sha256: createHash('sha256').update(html).digest('hex'),
      title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
      htmlSample: included ? snippet : undefined,
      sampleTruncated: sample.length > snippet.length, sampleOmitted: !included });
  };
  const wrapFetcher = (fetcher, context = {}) => {
    const wrapped = async (url, options = {}) => {
      const requestId = `${run.id}-${++requests}`, started = Date.now();
      const safeURL = String(url);
      emit('http.request', { ...context, requestId, url: safeURL, method: options.method || 'GET' });
      try {
        const response = await fetcher(url, options);
        emit('http.response', { ...context, requestId, url: safeURL, finalURL: response.url || safeURL,
          status: response.status, durationMs: Date.now() - started, mime: response.headers.get('content-type'),
          declaredBytes: response.headers.get('content-length'), redirect: response.headers.get('location'),
          providerRequestId: response.headers.get('x-request-id') || undefined });
        return response;
      } catch (error) {
        emit('http.error', { ...context, requestId, url: safeURL, durationMs: Date.now() - started, error: errorDetails(error) });
        throw error;
      }
    };
    wrapped.deepseekRelay = fetcher.deepseekRelay;
    wrapped.trustedRelayHosts = fetcher.trustedRelayHosts;
    return wrapped;
  };
  let requests = 0;
  return { emit, document, wrapFetcher, flush,
    async finish(summary) {
      if (closed) return;
      Object.assign(run, { finishedAt: new Date().toISOString(), status: summary.status,
        resultCount: summary.resultCount, durationMs: Date.now() - Date.parse(run.startedAt) });
      emit('run.finished', { ...summary, durationMs: run.durationMs, capturedEvents: run.events,
        droppedEvents: run.droppedEvents, documentSamplesOmitted: run.documentSamplesOmitted }, true);
      closed = true;
      await flush();
    },
  };
}

export async function readSearchTrace(dataDir, account, taskId, run) {
  const content = await readFile(traceFile(dataDir, account, taskId, run.id), 'utf8');
  // A killed process can leave a partial append. Keep the evidence on disk and
  // expose an explicit recovery marker instead of exporting invalid JSONL.
  let malformedLines = 0;
  const lines = content.split('\n').filter(line => {
    if (!line) return false;
    try { JSON.parse(line); return true; } catch { malformedLines++; return false; }
  });
  if (malformedLines) lines.push(JSON.stringify({ type: 'trace.recovery', taskId, runId: run.id,
    data: { malformedLines, reason: 'incompleteWrite', originalFilePreserved: true } }));
  return lines.join('\n') + '\n';
}

export async function interruptSearchTrace(dataDir, account, taskId, run) {
  Object.assign(run, { status: 'interrupted', finishedAt: new Date().toISOString() });
  const path = traceFile(dataDir, account, taskId, run.id);
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const existing = await readFile(path, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
  let lastSequence = 0;
  for (const line of existing.split('\n')) {
    try { lastSequence = Math.max(lastSequence, JSON.parse(line).seq || 0); } catch { /* partial append remains on disk */ }
  }
  run.events = lastSequence + 1;
  const line = (existing && !existing.endsWith('\n') ? '\n' : '') + JSON.stringify({ schemaVersion: 1, taskId, runId: run.id, seq: run.events,
    at: run.finishedAt, type: 'run.interrupted', data: { reason: 'serviceRestart', lastPersistedEvents: run.events || 0 } }) + '\n';
  await appendFile(path, line, { mode: 0o600 });
}
