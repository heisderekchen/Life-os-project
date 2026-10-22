import { createHash } from 'node:crypto';
import { searchPhotos, photoQuery, matchesPhotoProduct, countResultSources, createPageLRU } from './photo-search.mjs';
import { deepseekDiscover } from './deepseek-search.mjs';
import { PUBLIC_CATALOGUES, publicProductPhotos } from './public-catalogue.mjs';
import { abortable } from './async-control.mjs';
import { errorDetails } from './search-trace.mjs';
import { publicJSONResponse } from './public-http.mjs';
import { packCatalogueDocument, restoreCatalogueDocument, catalogueSnapshotEvent } from './catalogue-cache.mjs';

export const BROAD_TARGET = 100;
export const BROAD_TIMEOUT_MS = 12 * 60 * 1000;
const CATALOGUE_PAGES = 8;
export const CATALOGUE_CACHE_BYTES = 128 * 1024 * 1024;
const CACHE_TTL = 15 * 60 * 1000;
export function createCatalogueCache(maxBytes = CATALOGUE_CACHE_BYTES) {
  // Keep discovery's first two pages available even after a rare category scans
  // deeper pages. Otherwise that one scan evicts every other search's entry point.
  const primaryBytes = Math.floor(maxBytes * 0.75);
  const primary = createPageLRU(24, primaryBytes), deeper = createPageLRU(40, maxBytes - primaryBytes);
  const tier = key => Number(new URL(key).searchParams.get('page') || 1) <= 2 ? primary : deeper;
  return { get: key => tier(key).get(key), set: (key, value, size) => tier(key).set(key, value, size),
    get bytes() { return primary.bytes + deeper.bytes; }, get size() { return primary.size + deeper.size; } };
}
const cache = createCatalogueCache();
export function catalogueRetryDelay(error) {
  if (error?.status !== 429 || (error.retryAfterMs || 0) > 90000) return null;
  return error.retryAfterMs || 3000;
}
const nextRequest = new Map();
export const publicFetch = (fetcher, signal, trace = () => {}) => {
  const wrapped = async (url, options = {}) => {
    const u = new URL(url);
    if (!/deepseek|fashion-source/.test(u.hostname + u.pathname)) {
      const key = u.hostname, now = Date.now(), at = Math.max(now, nextRequest.get(key) || now);
      const imageRequest = new Headers(options.headers).get('accept')?.startsWith('image/');
      nextRequest.set(key, at + (imageRequest ? 100 : 1600));
      if (at > now) await abortable(() => new Promise(resolve => setTimeout(resolve, at - now)), signal);
    }
    if (u.protocol === 'https:' && PUBLIC_CATALOGUES.some(c => new URL(c.url).hostname === u.hostname) && /\/(?:products\.json|products\/[^/]+\.js)$/.test(u.pathname)) {
      trace('http.request', { url: u.href, method: 'GET', transport: 'curl-public-json' });
      const started = Date.now();
      try {
        const response = await publicJSONResponse(u, options.signal);
        trace('http.response', { url: u.href, status: response.status, mime: response.headers.get('content-type'), retryAfter: response.headers.get('retry-after'), server: response.headers.get('server'), durationMs: Date.now() - started, transport: 'curl-public-json' });
        return response;
      } catch (error) { trace('http.error', { url: u.href, transport: 'curl-public-json', error: errorDetails(error) }); throw error; }
    }
    return fetcher(url, options);
  };
  wrapped.deepseekRelay = fetcher.deepseekRelay;
  wrapped.trustedRelayHosts = fetcher.trustedRelayHosts;
  return wrapped;
};
const host = value => new URL(value).hostname.replace(/^www\./, '');
const inScope = (url, domains) => !domains?.length || domains.some(d => host(url) === d.replace(/^www\./, '') || host(url).endsWith('.' + d.replace(/^www\./, '')));
export const broadBackfillQueries = (intent, catalogues) => [intent + ' product', intent + ' new collection',
  ...['clarks.com', 'camper.com', 'ecco.com', 'nordstrom.com'].map(d => intent + ' site:' + d),
  ...catalogues.map(c => intent + ' site:' + host(c.url))].slice(0, 12);
export async function searchBroadPhotos(input, options) {
  const { readDocument, signal, trace = () => {}, onProgress = async () => {}, plans,
    catalogues = PUBLIC_CATALOGUES, target = BROAD_TARGET } = options;
  const fetcher = publicFetch(options.fetcher, signal, trace);
  const goal = Math.min(BROAD_TARGET, Math.max(1, target));
  const items = [], channels = [], hashes = new Set(), pages = new Set(), imageKeys = new Set();
  const sources = [], stopped = new Set();
  const captured = new Set(), snapshotLimit = 4 * 1024 * 1024;
  let snapshotBytes = 0, snapshotsOmitted = 0;
  const snapshot = record => {
    if (captured.has(record.url)) return;
    captured.add(record.url);
    const encodedBytes = Math.ceil(record.compressed.length / 3) * 4;
    if (snapshotBytes + encodedBytes > snapshotLimit) {
      snapshotsOmitted++; trace('catalogue.source.snapshot.omitted', { url: record.url, sha256: record.sha256, reason: 'encodedSnapshotBudget', limit: snapshotLimit }); return;
    }
    snapshotBytes += encodedBytes;
    trace('catalogue.source.snapshot', catalogueSnapshotEvent(record));
  };
  let checked = 0, candidates = 0, round = 0, intent = photoQuery(input.subject);
  const excluded = url => (plans.excludedDomains || []).some(d => inScope(url, [d]));
  const selected = new Set(input.sources || ['official', 'media', 'retail']);
  const domains = plans.find(p => p.deepseek)?.domains || input.domains || [];
  const eligibleCatalogues = catalogues.filter(c => selected.has(c.category) && inScope(c.url, domains) && !excluded(c.url));
  const progress = async (stage, extra = {}) => onProgress({ stage, round, targetResults: goal,
    accepted: items.length, checked, candidates, resultLimit: goal, channelsDone: channels.length,
    totalChannels: channels.length, matchedSources: countResultSources(items),
    items: [...items], channels: [...channels], sourceChecks: [...sources], ...extra });
  trace('broad.started', { target: goal, input, catalogues: eligibleCatalogues, maxCataloguePages: CATALOGUE_PAGES, maxSearchQueries: 14,
    criteria: { ownProductEvidence: true, downloadableImage: true, minWidth: 350, minHeight: 250, maxViewsPerProduct: 2 } });

  const verify = async (buckets, label, evidenceDocuments = new Map()) => {
    const fresh = buckets.map(bucket => ({ ...bucket, candidates: bucket.candidates.filter(c => {
      try { if (!/^https?:$/.test(new URL(c.url).protocol)) throw Error('invalid protocol'); }
      catch { trace('broad.candidate.skipped', { url: c.url, reason: 'invalidURL' }); return false; }
      if (pages.has(c.url) || excluded(c.url)) { trace('broad.candidate.skipped', { url: c.url, reason: 'previouslyCheckedOrExcluded' }); return false; }
      pages.add(c.url); return true;
    }) })).filter(bucket => bucket.candidates.length || bucket.error);
    if (!fresh.length) return;
    candidates += fresh.reduce((n, b) => n + b.candidates.length, 0);
    const roundChannels = [];
    let roundChecked = 0;
    let result;
    try { result = await searchPhotos(input, { ...options, fetcher, evidenceDocuments, knownImageHashes: [...hashes], knownImageFingerprints: items.map(i => i.imageFingerprint).filter(Boolean), plans: fresh, resultLimit: goal - items.length,
      onProgress: async p => {
        for (const item of p.items) {
          const u = new URL(item.image); const imageKey = u.hostname + u.pathname;
          if (hashes.has(item.imageSha256) || imageKeys.has(imageKey) || items.length >= goal) continue;
          hashes.add(item.imageSha256); imageKeys.add(imageKey); items.push(item);
        }
        roundChecked = p.checked || 0;
        roundChannels.splice(0, roundChannels.length, ...p.channels);
        await progress('verify', { checked: checked + (p.checked || 0), channels: [...channels, ...roundChannels], searchPhase: label });
      }, trace: (type, data) => trace(type, { round, phase: label, ...data }) }); }
    catch (error) {
      signal?.throwIfAborted(); trace('broad.round.failed', { round, label, error: errorDetails(error) });
      channels.push(...roundChannels); await progress('discover'); return;
    }
    checked += roundChecked;
    channels.push(...result.channels);
    trace('broad.round.completed', { round, label, accepted: items.length, newImages: result.items.length, checked,
      channels: result.channels.map(c => ({ provider: c.provider, discovered: c.discovered, accepted: c.count, rejected: c.rejected })) });
    await progress('discover');
  };
  const listing = async (source, page) => {
    const url = source.url + '/products.json?limit=250' + (page === 1 ? '' : '&page=' + page);
    const cached = cache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      const document = restoreCatalogueDocument(cached); snapshot(cached);
      trace('catalogue.cache.hit', { url, bytes: cached.bytes, compressedBytes: cached.compressed.length, sha256: cached.sha256 });
      return { ...document.parsed, document };
    }
    let doc;
    try { doc = await abortable(() => readDocument(url, fetcher), signal); }
    catch (error) {
      signal?.throwIfAborted();
      const delay = catalogueRetryDelay(error);
      if (delay === null) throw error;
      trace('catalogue.backoff', { url, status: 429, waitMs: delay, maxAttempts: 2 });
      await abortable(() => new Promise(resolve => setTimeout(resolve, delay)), signal);
      doc = await abortable(() => readDocument(url, fetcher), signal);
    }
    if (new URL(doc.url).origin !== new URL(source.url).origin) throw Error('目录跳转到其他来源');
    const data = JSON.parse(doc.html);
    if (!Array.isArray(data.products)) throw Error('来源未提供公开商品目录');
    const bytes = Buffer.byteLength(doc.html), sha256 = createHash('sha256').update(doc.html).digest('hex');
    const document = { ...doc, parsed: data, sha256, fetchedAt: new Date().toISOString() };
    const packed = packCatalogueDocument(document);
    const weight = packed.compressed.length * 3;
    cache.set(url, { ...packed, at: Date.now() }, weight); snapshot(packed);
    trace('catalogue.listing', { url, products: data.products.length, bytes, compressedBytes: packed.compressed.length, sha256, cacheBytes: cache.bytes, cacheLimitBytes: CATALOGUE_CACHE_BYTES });
    return { ...data, document };
  };
  // Plan once. Later queries can change discovery wording, never the evidence requirement.
  let initialSearch = [], initialSearchUsed = false;
  try {
    initialSearch = await deepseekDiscover(input, intent, fetcher, signal, trace);
    intent = initialSearch.find(a => a.intent)?.intent || intent;
  } catch (error) { signal?.throwIfAborted(); trace('broad.planning.failed', { error: errorDetails(error) }); }
  if (/[\u3400-\u9fff]/.test(intent)) throw Error('英文需求翻译失败，未发送不完整检索词');
  trace('broad.intent', { originalSubject: input.subject, intent });
  for (let page = 1; page <= CATALOGUE_PAGES && eligibleCatalogues.length && items.length < goal; page++) {
    round++;
    const buckets = [], evidenceDocuments = new Map();
    // Sequential per domain pages and bounded independent domains avoid hammering storefronts.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, eligibleCatalogues.length) }, async () => {
      while (next < eligibleCatalogues.length) {
        const source = eligibleCatalogues[next++];
        if (stopped.has(source.url)) continue;
        try {
          const data = await listing(source, page);
          evidenceDocuments.set(data.document.url, data.document);
          if (data.products.length < 250) stopped.add(source.url);
          const retained = [], reasons = {}, examples = [];
          for (const raw of data.products) {
            const photos = publicProductPhotos(raw, source.url);
            const first = photos[0];
            const reason = !first ? 'notFootwearOrMissingImages' : !matchesPhotoProduct(intent, first) ? 'productIntentMismatch' : null;
            if (reason) { reasons[reason] = (reasons[reason] || 0) + 1; if (examples.length < 10) examples.push({ title: raw.title, reason }); continue; }
            retained.push({ ...first, image: undefined, evidenceURL: data.document.url, evidenceKind: 'public-product-catalogue', evidenceFetchedAt: data.document.fetchedAt, viewLimit: 2 });
          }
          trace('catalogue.filtered', { source: source.name, url: source.url, page, discovered: data.products.length, retained: retained.length, reasons, examples,
            products: retained.map(p => ({ url: p.url, title: p.title, productCode: p.productCode, intentEvidence: p.intentEvidence, imageSelectionEvidence: p.imageSelectionEvidence, excludedGalleryImages: p.excludedGalleryImages })) });
          sources.push({ domain: host(source.url), page, status: 'queried', retained: retained.length });
          buckets.push({ candidates: retained, domains: [new URL(source.url).hostname], intent, label: source.name + ' · 公开商品目录', provider: '公开商品目录' });
        } catch (error) {
          signal?.throwIfAborted(); stopped.add(source.url);
          trace('catalogue.failed', { source: source.name, url: source.url, page, error: errorDetails(error) });
          sources.push({ domain: host(source.url), page, status: 'error', error: error.message });
          channels.push({ provider: '公开商品目录', query: intent, label: source.name, status: 'error', count: 0, error: error.message });
        }
      }
    }));
    await verify(buckets, 'catalogue-page-' + page, evidenceDocuments);
    if ((page === CATALOGUE_PAGES || stopped.size >= eligibleCatalogues.length) && !initialSearchUsed && items.length < goal && initialSearch.length) {
      initialSearchUsed = true; round++; await verify(initialSearch.map(a => ({ candidates: a.results.map(c => ({ ...c, viewLimit: 2 })), domains, intent,
        provider: a.provider, label: 'DeepSeek · 英文检索', ...(a.error ? { error: a.error } : {}) })), 'initial-web-search');
    }
    if (stopped.size >= eligibleCatalogues.length) break;
    await progress('discover');
  }
  if (!eligibleCatalogues.length && initialSearch.length) {
    round++; await verify(initialSearch.map(a => ({ candidates: a.results.map(c => ({ ...c, viewLimit: 2 })), domains, intent, provider: a.provider, ...(a.error ? { error: a.error } : {}) })), 'initial-web-search');
  }
  const seenQueries = new Set(initialSearch.map(a => a.query));
  // Explicit domain searches supply new products instead of repeatedly requesting the same global top 20.
  const bases = broadBackfillQueries(intent, eligibleCatalogues);
  for (const query of bases) {
    if (items.length >= goal) break;
    if (seenQueries.has(query) || [...query].length > 128) continue;
    seenQueries.add(query); round++;
    const attempts = await deepseekDiscover(input, intent, fetcher, signal, trace, { queries: [query], intent });
    await verify(attempts.map(a => ({ candidates: a.results.map(c => ({ ...c, viewLimit: 2 })), domains, intent,
      provider: a.provider, ...(a.error ? { error: a.error } : {}), label: 'DeepSeek · 补充检索' })), 'web-backfill');
  }
  trace('broad.finished', { accepted: items.length, target: goal, targetReached: items.length >= goal, rounds: round, checked,
    sourceSnapshots: { captured: captured.size - snapshotsOmitted, omitted: snapshotsOmitted, encodedBytes: snapshotBytes, limit: snapshotLimit },
    distinctProducts: new Set(items.map(i => i.clueKey)).size, matchedSources: countResultSources(items), stoppedCatalogues: [...stopped] });
  await progress('done', { targetReached: items.length >= goal });
  return { items, channels, sourceChecks: sources, targetReached: items.length >= goal,
    message: items.length >= goal ? '' : `本轮取得 ${items.length} / ${goal} 条图片线索；已保留未达标原因和检索记录。` };
}
