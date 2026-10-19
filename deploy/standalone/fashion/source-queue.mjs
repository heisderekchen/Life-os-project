import { createHash } from 'node:crypto';

export const SOURCE_QUEUE_READER_VERSION = 3;

function stableId(domains, label) {
  const sorted = [...domains].sort();
  return createHash('sha1').update(sorted.join('\n') + '\u0000' + (label || '')).digest('hex');
}

function normalizeDomains(domains) {
  const out = [];
  for (const d of domains || []) {
    if (typeof d !== 'string') continue;
    let x = d.trim().toLowerCase();
    if (x.endsWith('.')) x = x.slice(0, -1);
    if (x.startsWith('www.')) x = x.slice(4);
    if (!x) continue;
    out.push(x);
  }
  return out;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function itemUrl(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.url === 'string') return item.url;
  if (typeof item.source === 'string') {
    const s = item.source;
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : 'https://' + s;
  }
  return null;
}

export async function runSourceQueue({
  entries,
  previous = [],
  runEntry,
  onUpdate = async () => {},
  onResult = async () => {},
  signal,
  concurrency = 3,
  entryTimeoutMs = 20000,
  retryFailed = false,
  previousReaderVersion = 1,
}) {
  const prevById = new Map();
  for (const p of previous || []) {
    if (p && p.id) prevById.set(p.id, p);
  }

  const records = [];
  const entryById = new Map();
  const seen = new Set();
  for (const raw of entries || []) {
    if (!raw || typeof raw !== 'object') continue;
    const domains = normalizeDomains(raw.domains);
    if (domains.length === 0 && !raw.openDiscovery) continue;
    const uniqueDomains = [...new Set(domains)];
    const label = typeof raw.label === 'string' ? raw.label : '';
    const id = raw.id || stableId(uniqueDomains, label);
    const requiredReaderVersion = Math.max(1, Number(raw.readerVersion) || 1);
    if (seen.has(id)) continue;
    seen.add(id);
    entryById.set(id, raw);
    const prev = prevById.get(id);
    let status = 'pending';
    let matchedDomains = [];
    let error = null;
    let checkpoint = null;
    if (prev) {
      if (Array.isArray(prev.matchedDomains)) matchedDomains = [...prev.matchedDomains];
      if (prev.checkpoint && typeof prev.checkpoint === 'object') checkpoint = structuredClone(prev.checkpoint);
      const priorReaderVersion = Math.max(1, Number(prev.readerVersion || previousReaderVersion) || 1);
      if (prev.status === 'done' && priorReaderVersion >= requiredReaderVersion &&
          !(retryFailed && prev.sourceChecks?.some(c => c.status === 'error'))) status = 'done';
      else if (prev.status === 'error' && !retryFailed) { status = 'error'; error = prev.error || null; }
      else if (prev.status === 'running' || prev.status === 'pending') status = 'pending';
    }
    records.push({
      id,
      label,
      domains: uniqueDomains,
      openDiscovery: Boolean(raw.openDiscovery),
      readerVersion: Math.max(requiredReaderVersion, Number(prev?.readerVersion) || 0),
      status,
      error,
      matchedDomains,
      sourceChecks: prev?.sourceChecks?.map(c=>({...c})),
      ...(checkpoint ? { checkpoint } : {}),
    });
  }

  const snapshot = () => {
    const planned = new Set();
    const queried = new Set();
    const matched = new Set();
    for (const r of records) {
      for (const d of r.domains) planned.add(d);
      if (r.status === 'done' || r.status === 'error') {
        for (const d of r.domains) queried.add(d);
      }
      for (const d of r.matchedDomains) matched.add(d);
    }
    const done = new Set(records.flatMap(r => r.sourceChecks ? r.sourceChecks.filter(c=>c.status==='queried').map(c=>c.domain) : r.status==='done'?r.domains:[]));
    const failed = new Set();
    for (const r of records) {
      if (r.sourceChecks || r.status === 'error') {
        for (const d of r.sourceChecks ? r.sourceChecks.filter(c=>c.status==='error').map(c=>c.domain) : r.domains) {
          if (!done.has(d)) failed.add(d);
        }
      }
    }
    const pending = [...planned].filter((d) => !queried.has(d));
    return {
      records: records.map(r => ({...r, domains:[...r.domains], matchedDomains:[...r.matchedDomains],sourceChecks:r.sourceChecks?.map(c=>({...c}))})),
      plannedSources: planned.size, queriedSources: queried.size,
      matchedSources: matched.size, failedSources: failed.size, pendingSources: pending.length,
    };
  };

  let fatal = null;
  const localStop = new AbortController();
  if (signal) {
    if (signal.aborted) localStop.abort(signal.reason);
    else {
      const onParentAbort = () => localStop.abort(signal.reason);
      signal.addEventListener('abort', onParentAbort, { once: true });
      // stash for cleanup
      localStop._parentCleanup = () => signal.removeEventListener('abort', onParentAbort);
    }
  }

  const cleanup = () => {
    if (typeof localStop._parentCleanup === 'function') localStop._parentCleanup();
  };

  let chain = Promise.resolve();
  const enqueue = (fn) => {
    const p = chain.then(async () => {
      if (fatal) throw fatal;
      if (localStop.signal.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      return await fn();
    });
    chain = p.catch((err) => {
      if (!fatal) fatal = err;
      try { localStop.abort(err); } catch {}
      throw err;
    });
    // Observe the internal tail as well as the promise returned to the caller.
    chain.catch(() => {});
    return p;
  };

  const emit = () => enqueue(() => onUpdate(snapshot()));

  try { await emit(); } catch (error) { cleanup(); throw error; }

  const mergeMatched = (value, record) => {
    if (value?.checkpoint && typeof value.checkpoint === 'object') {
      record.checkpoint = structuredClone(value.checkpoint);
    }
    if (Array.isArray(value?.sourceChecks) && value.sourceChecks.length) record.sourceChecks=value.sourceChecks.filter(c=>record.domains.includes(c.domain)).map(c=>({...c}));
    const items = value && Array.isArray(value.items) ? value.items : [];
    for (const item of items) {
      const url = itemUrl(item);
      if (!url) continue;
      const host = domainOf(url);
      if (!host) continue;
      for (const d of record.domains) {
        if (host === d || host.endsWith('.' + d)) {
          if (!record.matchedDomains.includes(d)) record.matchedDomains.push(d);
          break;
        }
      }
    }
  };

  const processEntry = async (record) => {
    const scheduledEntry = entryById.get(record.id);
    const perEntryTimeout = Math.max(1, Number(scheduledEntry?.timeoutMs) || entryTimeoutMs);
    const child = new AbortController();
    const entrySignal = child.signal;
    let active = true;
    let timer = null;

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        active = false;
        const e = new Error('timeout');
        e.name = 'TimeoutError';
        reject(e);
        child.abort(e);
      }, perEntryTimeout);
    });

    const stopPromise = new Promise((_, reject) => {
      const onAbort = () => {
        active = false;
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
        child.abort(e);
      };
      if (localStop.signal.aborted) onAbort();
      else localStop.signal.addEventListener('abort', onAbort, { once: true });
      child._stopCleanup = () => localStop.signal.removeEventListener('abort', onAbort);
    });

    timeoutPromise.catch(() => {});
    stopPromise.catch(() => {});
    const pendingPartials = new Set();
    record.status = 'running';
    record.error = null;

    try {
      await emit();

      const onPartial = (value) => {
        if (!active || child.signal.aborted || localStop.signal.aborted) return Promise.resolve();
        let op;
        op = enqueue(async () => {
          if (!active) return;
          if (child.signal.aborted) return;
          if (localStop.signal.aborted) return;
          await onResult({ entry: entryById.get(record.id), value, partial: true });
          mergeMatched(value, record);
          await onUpdate(snapshot());
        }).finally(() => {
          pendingPartials.delete(op);
        });
        pendingPartials.add(op);
        op.catch(() => {});
        return op;
      };

      let result;
      try {
        result = await Promise.race([
          Promise.resolve().then(() => runEntry(entryById.get(record.id), {
            signal: entrySignal,
            onPartial,
            checkpoint: record.checkpoint ? structuredClone(record.checkpoint) : null,
          })),
          timeoutPromise,
          stopPromise
        ]);
      } catch (err) {
        if (fatal) throw fatal;
        if (localStop.signal.aborted) return;

        record.status = 'error';
        record.error = err && err.message ? err.message : String(err);
        await emit();
        return;
      }

      // wait pending partial callbacks
      await Promise.all([...pendingPartials]);

      if (!active || child.signal.aborted || localStop.signal.aborted) return;

      await enqueue(async () => {
        if (!active) return;
        if (child.signal.aborted) return;
        if (localStop.signal.aborted) return;
        await onResult({ entry: entryById.get(record.id), value: result, partial: false });
        mergeMatched(result, record);
        record.status = 'done';
        record.error = null;
        await onUpdate(snapshot());
      });
    } finally {
      active = false;
      if (timer) clearTimeout(timer);
      if (typeof child._stopCleanup === 'function') child._stopCleanup();
    }
  };

  const queue = records.filter((r) => r.status === 'pending');

  let cursor = 0;

  const worker = async () => {
    while (true) {
      if (fatal) return;
      if (localStop.signal.aborted) return;
      const idx = cursor++;
      if (idx >= queue.length) return;
      const record = queue[idx];
      try {
        await processEntry(record);
      } catch (err) {
        if (!fatal) fatal = err;
        try { localStop.abort(err); } catch {}
        return;
      }
    }
  };

  const limited = Math.max(1, Math.min(concurrency, queue.length || 1));
  const workers = [];
  for (let i = 0; i < limited; i++) {
    workers.push(worker());
  }

  try {
    await Promise.all(workers);
  } finally {
    cleanup();
  }

  if (fatal) {
    throw fatal;
  }

  await chain.catch(() => {});
  if (localStop.signal.aborted) {
    const error = new Error('aborted'); error.name = 'AbortError';
    await onUpdate(snapshot());
    throw error;
  }
  return snapshot();
}
