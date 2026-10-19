import { bingImages, commonsPhotoCandidates } from './legacy-search.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { abortable } from './async-control.mjs';
import { nikeCatalogPhotos } from './source-adapters.mjs';

const translations = [
  ['耐克', 'Nike'], ['阿迪达斯', 'Adidas'], ['新百伦', 'New Balance'], ['彪马', 'Puma'],
  ['玛丽珍鞋', 'mary jane shoes'], ['玛丽珍', 'mary jane'], ['芭蕾平底鞋', 'ballet flats'],
  ['芭蕾鞋', 'ballet flats'], ['乐福鞋', 'loafers'], ['高跟鞋', 'heels'],
  ['运动鞋', 'sneakers'], ['凉鞋', 'sandals'], ['短靴', 'ankle boots'], ['靴子', 'boots'],
  ['穆勒鞋', 'mules'], ['女款', 'women'], ['女士', 'women'], ['女鞋', 'women shoes'],
  ['漆皮', 'patent leather'], ['绒面', 'suede'], ['麂皮', 'suede'], ['真皮', 'leather'],
  ['皮革', 'leather'], ['网眼', 'mesh'], ['缎面', 'satin'], ['金属', 'metallic'],
  ['极简', 'minimalist'], ['复古', 'retro'], ['黑色', 'black'], ['棕色', 'brown'],
];
export function photoQuery(subject) {
  let value = subject;
  for (const [cn, en] of translations) value = value.replaceAll(cn, ` ${en} `);
  return value.replace(/[,，。；;]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const stop = new Set(['women', 'womens', 'woman', 'ladies', 'female', 'shoe', 'shoes', 'footwear', 'for', 'and', 'the', 'with', 'of', 'in', 'a', 's']);
export function matchesIntent(subject, value) {
  const terms = photoQuery(subject).toLowerCase().replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  const hay = photoQuery(value).toLowerCase().replace(/['’]/g, '');
  if (terms.includes('leather') && /\bfaux\b|\bsynthetic\b|leather[- ]look|仿皮|人造革/i.test(value)) return false;
  return terms.filter(t => !stop.has(t)).every(t => {
    const stem = t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t;
    return hay.includes(stem);
  }) && /loafer|ballet|flat|sandal|boot|shoe|heel|mule|sneaker|mary.jane|pump|slipper|鞋|靴/i.test(value);
}
const blocked = /(?:pinterest|etsy|ebay|1stdibs|ufonomore|therealreal|vestiairecollective|grailed|carousell|amazon|walmart|poshmark|depop|mercari|aliexpress|temu|storage\.googleapis|lyst\.|gihut\.com|dashangu\.com|wenmiyuan\.com)/i;
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const plain = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function keyURL(value) {
  const u = new URL(value);
  if (u.hostname === 'static.nike.com' && u.pathname.startsWith('/a/images/')) {
    const asset = u.pathname.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi)?.at(-1);
    if (asset) return u.hostname + '/asset/' + asset.toLowerCase();
  }
  return u.hostname.toLowerCase().replace(/^www\./, '') + decodeURIComponent(u.pathname).replace(/\/(?:s\d+|w_\d+)\//g, '/');
}
export function imageDeclared(html, image) {
  // Exact asset identity in page markup / embedded structured data. Query-size
  // transforms may differ, but filenames, paths, and hosts must correspond.
  const normalized = decode(html).replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  const key = keyURL(image);
  return normalized.includes(new URL(image).href) || [...normalized.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+/g)].some(m => {
    try { return keyURL(m[0].startsWith('//') ? 'https:' + m[0] : m[0]) === key; } catch { return false; }
  });
}
export function declaredImageURL(html, image) {
  if (new URL(image).hostname !== 'static.nike.com') return image;
  const normalized = decode(html).replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  const urls = [...normalized.matchAll(/https:\/\/static\.nike\.com\/a\/images\/[^\s"'<>\\]+/g)].map(m => m[0]);
  const size = url => Number(url.match(/t_(?:web_pdp|PDP)_(\d+)/)?.[1] || 320);
  return urls.filter(url => { try { return keyURL(url) === keyURL(image); } catch { return false; } })
    .sort((a, b) => size(b) - size(a))[0] || image;
}
async function duckDiscover(query, fetcher) {
  const headers = { accept: 'text/html', 'user-agent': 'Mozilla/5.0' };
  const page = await fetcher('https://duckduckgo.com/?q=' + encodeURIComponent(query), { headers, signal: AbortSignal.timeout(4500) });
  if (!page.ok) throw Error('图片搜索暂不可用');
  const token = (await page.text()).match(/vqd=['"]?([\d-]+)/)?.[1];
  if (!token) throw Error('图片搜索未返回有效凭据');
  const endpoint = new URL('https://duckduckgo.com/i.js');
  Object.entries({ l: 'us-en', o: 'json', q: query, vqd: token, p: '1' }).forEach(([k, v]) => endpoint.searchParams.set(k, v));
  const response = await fetcher(endpoint, { headers: { ...headers, accept: 'application/json', referer: 'https://duckduckgo.com/' }, signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw Error('图片搜索暂不可用');
  const data = await response.json();
  if (!Array.isArray(data.results)) throw Error('图片搜索返回异常');
  return data.results;
}

export function photoLimits(input) {
  return input.sourceScope === 2 ? { candidates: 192, results: 48 } : input.sourceScope === 1 ? { candidates: 128, results: 24 } : { candidates: 64, results: 16 };
}
export function photoQueries(subject, scope) {
  const base = photoQuery(subject);
  const hasShoe = /loafer|ballet|flat|sandal|boot|shoe|heel|mule|sneaker|mary.jane|footwear|pump|slipper|鞋|靴/i.test(base);
  if (hasShoe) return scope === 2 ? [base, `${base} new collection`, `${base} design`] : [base];
  return scope === 2 ? [`${base} shoes`, `${base} sneakers`, `${base} footwear`, `${base} women shoes`] : [`${base} shoes`];
}
function eligible(candidate, subject, domains) {
  try {
    const u = new URL(candidate.url), image = new URL(candidate.image);
    return /^https?:$/.test(u.protocol) && /^https?:$/.test(image.protocol) && !blocked.test(u.hostname) && u.pathname !== '/' &&
      !/\/(search|collections|category|categories)(\/|$)|[?&]q=/i.test(u.pathname + u.search) &&
      (!domains.length || domains.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) &&
      !/(?:演示数据|示例商品|demo product|sample product|placeholder)/i.test(candidate.title || '') && matchesIntent(subject, candidate.title || '') && (candidate.width === undefined || Number(candidate.width) >= 350) &&
      (candidate.height === undefined || Number(candidate.height) >= 250);
  } catch { return false; }
}
async function discover(entry, fetcher, subject, signal) {
  if (entry.catalogURL) return [{ provider: '品牌官网目录', results: [] }];
  const loads = [['DuckDuckGo Images', () => duckDiscover(entry.query, fetcher)],
    ['Bing Images', () => bingImages(entry.query, fetcher, { offset: entry.offset || 0 })]];
  const attempts = await Promise.all(loads.map(async ([provider, load]) => {
    try { return { provider, results: await abortable(load, signal) }; }
    catch (error) { signal?.throwIfAborted(); return { provider, results: [], error: error.message }; }
  }));
  // A single provider's few candidates must not suppress other providers. The
  // library fallback is appropriate only to an open query, never outside scope.
  if (!entry.domains.length && !attempts.some(a => a.results.some(c => eligible(c, subject, entry.domains)))) {
    try { attempts.push({ provider: 'Wikimedia Commons', results: await abortable(() => commonsPhotoCandidates(entry.query, fetcher), signal) }); }
    catch (error) { signal?.throwIfAborted(); attempts.push({ provider: 'Wikimedia Commons', results: [], error: error.message }); }
  }
  return attempts;
}

export async function searchPhotos(input, { fetcher, plans, readPage, readImage, saveAsset, signal, onProgress = async () => {} }) {
  const channels = [], buckets = [], images = new Set(), hashes = new Set();
  const limits = photoLimits(input);
  const excluded = host => (plans.excludedDomains || []).some(d => host === d || host.endsWith('.' + d));
  const variants = photoQueries(input.subject, input.sourceScope);
  const base = variants[0];
  const entries = plans.filter(x => x.domains.length).map(x => ({ ...x, query: `${base} (${x.domains.map(d => `site:${d}`).join(' OR ')})` }));
  if (input.sourceScope !== 0 && (input.sourceScope !== undefined || !input.domains.length)) {
    entries.unshift(...variants.map(query => ({ query, domains: [], label: '公开图片' })));
    if (input.sourceScope === 2) entries.push({ query: base, domains: [], label: '公开图片 · 后续页', offset: 60 });
  }
  if (!entries.length && !plans.length) entries.push({ query: base, domains: input.domains, label: '公开图片' });
  if (plans.some(p => p.catalogue === 'nike')) entries.unshift(...[
    'https://www.nike.com/w/shoes-y7ok', 'https://www.nike.com/w/womens-shoes-5e1x6zy7ok',
  ].map(catalogURL => ({ query: base, domains: ['nike.com'], label: '品牌官方', catalogURL })));
  let checked = 0, completed = 0;
  const items = [];
  const report = async (stage, totalCandidates = buckets.reduce((n, b) => n + b.length, 0)) => {
    signal?.throwIfAborted();
    await onProgress(structuredClone({ stage, channelsDone: completed, totalChannels: entries.length,
      candidates: totalCandidates, checked, resultLimit: limits.results, accepted: Math.min(items.length, limits.results),
      items: items.slice(0, limits.results), channels }));
  };
  await report('discover');
  let nextEntry = 0;
  await Promise.all(Array.from({ length: Math.min(entries.length, 5) }, async () => {
    while (nextEntry < entries.length) {
      const entry = entries[nextEntry++];
      try {
        let attempts;
        if (entry.catalogURL) {
          const { html, url } = await abortable(() => readPage(entry.catalogURL, fetcher), signal);
          attempts = [{ provider: '品牌官网目录', results: nikeCatalogPhotos(html, url) }];
        } else attempts = await discover(entry, fetcher, input.subject, signal);
        signal?.throwIfAborted();
        for (const { results: found, provider, error } of attempts) {
          const matches = found.filter(candidate => eligible(candidate, input.subject, entry.domains) && !excluded(new URL(candidate.url).hostname));
          const channel = { provider, query: entry.query, label: entry.label, status: error ? 'error' : matches.length ? 'ready' : 'empty',
            count: 0, discovered: found.length, intentMatched: matches.length, rejected: {}, ...(error ? { error } : {}) };
          channels.push(channel);
          buckets.push(matches.map(candidate => ({ ...candidate, channel, domains: entry.domains })));
        }
      } catch (error) {
        signal?.throwIfAborted();
        channels.push({ provider: entry.catalogURL ? '品牌官网目录' : '公开图片检索', query: entry.query, label: entry.label, status: 'error', count: 0, error: error.message });
      }
      completed++;
      await report('discover');
    }
  }));
  if (channels.length && channels.every(c => c.status === 'error')) throw Error('公开图片检索暂不可用，任务已保留，请稍后重试。');
  // Interleave sources before applying the candidate budget, so one provider
  // cannot consume the whole budget. Different images on one product may stay.
  const candidates = [];
  for (let row = 0; buckets.some(bucket => row < bucket.length); row++)
    for (const bucket of buckets) if (bucket[row]) candidates.push(bucket[row]);
  const unique = candidates.filter(candidate => {
    const key = keyURL(candidate.image);
    if (images.has(key)) return false;
    images.add(key); return true;
  }).slice(0, limits.candidates);
  await report('verify', unique.length);
  for (let index = 0; index < unique.length && items.length < limits.results; index += 8) {
    await Promise.all(unique.slice(index, index + 8).map(async candidate => {
      let reason = 'sourceUnavailable';
      try {
        const { html, url } = await abortable(() => readPage(candidate.url, fetcher), signal);
        const source = new URL(url);
        if (blocked.test(source.hostname) || excluded(source.hostname) || source.pathname === '/' || (candidate.domains.length && !candidate.domains.some(d => source.hostname === d || source.hostname.endsWith('.' + d)))) throw Error();
        const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
        reason = 'sourceIntentMismatch';
        if (!matchesIntent(input.subject, title)) throw Error();
        reason = 'imageSourceMismatch';
        if (!imageDeclared(html, candidate.image)) throw Error();
        const dateValue = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] || html.match(/property=["']article:published_time["'][^>]*content=["']([^"']+)/i)?.[1];
        const timestamp = Date.parse(dateValue);
        const publishedAt = Number.isFinite(timestamp) && timestamp <= Date.now() ? new Date(timestamp).toISOString() : null;
        reason = 'dateUnconfirmed';
        if (input.days && !publishedAt) throw Error();
        reason = 'outsideDateRange';
        if (input.days && timestamp < Date.now() - input.days * 86400000) throw Error();
        reason = 'imageUnavailable';
        const image = declaredImageURL(html, candidate.image);
        const asset = await abortable(() => readImage(image, fetcher), signal);
        const sha256 = createHash('sha256').update(asset.bytes).digest('hex');
        if (hashes.has(sha256)) return null;
        hashes.add(sha256);
        signal?.throwIfAborted();
        await abortable(() => saveAsset(sha256, asset), signal);
        signal?.throwIfAborted();
        candidate.channel.count++;
        return { id: randomBytes(8).toString('hex'), title, url, source: source.hostname.replace(/^www\./, ''),
          image, imageKind: 'source-matched', imageSha256: sha256, imageMime: asset.mime,
          sourceCheckedAt: new Date().toISOString(), sourceImageMatched: true,
          publishedAt, collectedAt: new Date().toISOString(), review: 'pending', selected: false, note: '', summary: '' };
      } catch {
        signal?.throwIfAborted();
        const rejects = candidate.channel.rejected;
        rejects[reason] = (rejects[reason] || 0) + 1;
        return null;
      }
    }).map(work => work.then(async item => {
      if (item) items.push(item);
      checked++;
      await report('verify', unique.length);
    })));
  }
  channels.forEach(c => { if (c.status !== 'error') c.status = c.count ? 'ready' : 'empty'; });
  return { items: items.slice(0, limits.results).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)), channels };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function exportHTML(task, assets) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(task.input.subject)} · 图片与来源</title><style>body{font:16px/1.6 system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#11141a}article{border-top:1px solid #ccd3dc;padding:24px 0;break-inside:avoid}img{width:100%;max-height:520px;object-fit:contain}a,code{overflow-wrap:anywhere}p{margin:8px 0}a{color:#154bea}</style><h1>${esc(task.input.subject)}</h1><p>交付时间 ${esc(task.delivery.createdAt)} · ${task.delivery.items.length} 张图片</p><p>图片已嵌入本文件，可离线查看。原始来源与图片地址逐张保留。来源可追溯不代表获得商用授权。</p>${task.delivery.items.map((i, n) => `<article data-image-id="${esc(i.id)}"><h2>${n + 1}. ${esc(i.title)}</h2><img src="data:${i.imageMime};base64,${assets[n].toString('base64')}" alt="${esc(i.title)}"><p>图片编号：${esc(i.id)}</p><p><a href="${esc(i.url)}">打开原始来源：${esc(i.url)}</a></p><p><a href="${esc(i.image)}">原始图片：${esc(i.image)}</a></p><p>核查依据：${esc(i.note)}</p><p>来源核对时间：${esc(i.sourceCheckedAt)} · 发布日期：${esc(i.publishedAt || '未确认')}</p><p>SHA-256：<code>${esc(i.imageSha256)}</code></p></article>`).join('')}</html>`;
}
