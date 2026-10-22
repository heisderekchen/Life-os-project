import { similarImage } from './image-quality.mjs';
import { bingImages, commonsPhotoCandidates } from './legacy-search.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { abortable } from './async-control.mjs';
import { readSourcePhotos } from './source-reader.mjs';
import { isTargetPage } from './target-page.mjs';
import { articleProductPhotos, structuredProductPhotos, productPageKey } from './article-products.mjs';
import { catalogAdapter, catalogueProductPhotos } from './source-adapters.mjs';
import { recentSitemapCandidates } from './sitemap-discovery.mjs';
import { deepseekDiscover } from './deepseek-search.mjs';
import { errorDetails } from './search-trace.mjs';
import { productAPIPhotos } from './public-catalogue.mjs';

const translations = [
  ['耐克', 'Nike'], ['阿迪达斯', 'Adidas'], ['新百伦', 'New Balance'], ['彪马', 'Puma'],
  ['玛丽珍鞋', 'mary jane shoes'], ['玛丽珍', 'mary jane'], ['芭蕾平底鞋', 'ballet flats'],
  ['芭蕾鞋', 'ballet flats'], ['乐福鞋', 'loafers'], ['高跟鞋', 'heels'],
  ['运动鞋', 'sneakers'], ['凉鞋', 'sandals'], ['短靴', 'ankle boots'], ['靴子', 'boots'],
  ['穆勒鞋', 'mules'], ['小白鞋', 'white sneakers'], ['女款', 'women'], ['女士', 'women'], ['女鞋', 'women shoes'],
  ['休闲鞋', 'casual shoes'], ['休闲', 'casual'], ['冬季', 'winter'], ['冬款', 'winter'], ['冬天', 'winter'],
  ['漆皮', 'patent leather'], ['绒面', 'suede'], ['麂皮', 'suede'], ['真皮', 'leather'],
  ['皮革', 'leather'], ['网眼', 'mesh'], ['缎面', 'satin'], ['金属', 'metallic'],
  ['极简', 'minimalist'], ['复古', 'retro'], ['黑色', 'black'], ['棕色', 'brown'],
  // Generic shoe words follow type compounds so "乐福鞋" remains "loafers".
  ['鞋履', 'footwear'], ['鞋子', 'shoes'], ['鞋款', 'shoes'], ['鞋', 'shoes'],
];
export function photoQuery(subject) {
  let value = subject;
  const compounds = translations.filter(([cn]) => cn === '小白鞋');
  for (const [cn, en] of compounds) value = value.replaceAll(cn, ` ${en} `);
  for (const [cn, en] of translations.filter(([cn]) => cn !== '小白鞋')) value = value.replaceAll(cn, ` ${en} `);
  return value.replace(/[,，。；;]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const stop = new Set(['shoe', 'shoes', 'footwear', 'for', 'and', 'the', 'with', 'of', 'in', 'a', 's']);
const footwear = /\b(?:loafer|ballet|flat|sandal|boot|shoe|heel|mule|sneaker|pump|slipper)s?\b|\bmary.jane\b|鞋|靴/i;
const apparel = /\b(?:apparel|clothing|jacket|hoodie|sweatshirt|sweater|pants|trousers|shorts|skirt|dress|shirt|tee|t-shirt|socks?|hat|cap|coat)\b|服装|衣|裤|裙/i;
const brandPatterns = {
  nike: /\b(?:nike|jordan)\b/gi,
  adidas: /\badidas\b/gi,
  'new balance': /\bnew\s+balance\b/gi,
  puma: /\bpuma\b/gi,
};
const brandsIn = value => {
  const translated = photoQuery(value);
  return new Set(Object.entries(brandPatterns)
    .filter(([, pattern]) => [...translated.matchAll(pattern)].length)
    .map(([name]) => name));
};
const withoutBrands = (value, brands) => {
  let translated = photoQuery(value);
  for (const name of brands) translated = translated.replace(brandPatterns[name], ' ');
  return translated.replace(/\s+/g, ' ').trim();
};
const compactBrand = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function matchesIntent(subject, value, productTypeEvidence = false) {
  const terms = photoQuery(subject).toLowerCase().replace(/['’]/g, '').replace(/\b(?:womens?|woman|ladies|female)\b/g, 'women').match(/[\p{L}\p{N}]+/gu) || [];
  const hay = photoQuery(value).toLowerCase().replace(/['’]/g, '')
    .replace(/\b(?:womens?|woman|ladies|female)\b/g, 'women');
  // Season and casual use are often expressed as product features rather than
  // literal title keywords. These aliases require positive product evidence.
  const features = hay + (/\b(?:snow|insulated|thermal|winter|cold.weather|fleece.lined)\b/i.test(hay) ? ' winter' : '') +
    (/\b(?:everyday|casual|lifestyle|sneakers?|trainers?)\b/i.test(hay) ? ' casual' : '') +
    (/\btrainers?\b/i.test(hay) ? ' sneakers' : '') +
    (/\bballerinas?\b/i.test(hay) ? ' ballet flats' : '') +
    (/\bmary[ _-]?janes?\b/i.test(hay) ? ' mary jane' : '');
  if (/\b(?:duffel|bag|handbag|backpack|shoebox|shoe bag|shoe box|storefront|logo)\b|鞋盒|手提包|鞋袋/i.test(value)) return false;
  if (apparel.test(value) && !footwear.test(value)) return false;
  if (terms.includes('leather') && /\bfaux\b|\bsynthetic\b|leather[- ]look|仿皮|人造革/i.test(value)) return false;
  if (terms.includes('winter') && terms.includes('casual') && /\b(?:sandals?|stilettos?|pumps?|strappy|open.toe|jelly)\b/i.test(value)) return false;
  const knownNikeModel = /\b(?:Nike\s+(?:Dunk|Mind\s+00[12]|Air|Shox|Vomero|Pegasus|Sabrina\s+\d+)|Air\s+(?:Jordan|Max|Force))\b/i.test(value);
  return terms.filter(t => !stop.has(t)).every(t => {
    if(t==='nike' && /\bAir\s+Jordan\b/i.test(value)) return true;
    const stem = t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t;
    return new RegExp('\\b' + escapeRegExp(stem) + 's?\\b', 'i').test(features);
  }) && (productTypeEvidence || knownNikeModel || footwear.test(value));
}
export function matchesProductIntent(subject, value, productTypeEvidence = false, verifiedBrand = '') {
  const translatedSubject = photoQuery(subject);
  const requested = brandsIn(subject);
  if (!requested.size) {
    const evidenceKey = compactBrand(verifiedBrand);
    if (!evidenceKey || !compactBrand(translatedSubject).includes(evidenceKey) || brandsIn(value).size)
      return matchesIntent(subject, value, productTypeEvidence);
    const evidencePattern = String(verifiedBrand).trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    const scopedSubject = translatedSubject.replace(new RegExp(evidencePattern, 'gi'), ' ').replace(/\s+/g, ' ').trim();
    return matchesIntent(scopedSubject || 'shoes', value, productTypeEvidence);
  }
  const found = brandsIn(value);
  if ([...found].some(brand => !requested.has(brand))) return false;
  const evidence = brandsIn(verifiedBrand);
  if ([...evidence].some(brand => !requested.has(brand))) return false;
  if (![...requested].some(brand => found.has(brand) || evidence.has(brand))) return false;
  return matchesIntent(withoutBrands(subject, requested) || 'shoes', value, productTypeEvidence);
}
export function matchesPhotoProduct(subject, product) {
  if (!matchesProductIntent(subject, product.intentEvidence || product.title, Boolean(product.productTypeEvidence), product.brandEvidence)) return false;
  const requested = photoQuery(subject).toLowerCase();
  const primary = product.primaryTypeEvidence || '';
  // Ballet-inspired heels and generic flat lace-ups are not ballet flats.
  // A Style:Ballet tag cannot override an explicit Type:Heels classification.
  if (/\bflats?\b/.test(requested) && /\b(?:heels|pumps|stilettos)\b/i.test(primary)) return false;
  if (/\bballet\b/.test(requested) && !/\b(?:ballet|ballerinas?)\b/i.test(primary)) return false;
  if (/\bheels?\b/.test(requested) && !/\b(?:heels?|pumps?|stilettos?)\b/i.test(primary)) {
    const values = product.intentEvidence || product.title || '';
    const height = [...values.matchAll(/heel\s*height\s*:?\s*(\d+(?:\.\d+)?)\s*(inches|inch|in\b|cm|["″])/gi)]
      .some(m => Number(m[1]) * (m[2].toLowerCase() === 'cm' ? 1 : 2.54) >= 3.5);
    if (/\b(?:sneakers?|trainers?|ballet|ballerinas?|flats?)\b/i.test(primary) ||
        (!height && !/Heel Height:\s*(?:Medium|High|Ultra High)\b/i.test(values))) return false;
  }
  const typeRules = [
    [/\bmules?\b/, /\bmules?\b/i, /\b(?:ballet|ballerinas?|loafers?|boots?|sneakers?|sandals?)\b/i],
    [/\bmary.jane\b/, /\bmary[ _-]?janes?\b/i, /\b(?:loafers?|boots?|sneakers?|sandals?)\b/i],
    [/\bloafers?\b/, /\bloafers?\b/i, /\b(?:ballet|ballerinas?|mary.jane|boots?|sneakers?|sandals?)\b/i],
    [/\bballet\b/, /\b(?:ballet|ballerinas?)\b/i, /\b(?:loafers?|boots?|sneakers?|sandals?)\b/i],
    [/\bsandals?\b/, /\bsandals?\b/i, /\b(?:ballet|ballerinas?|loafers?|boots?|sneakers?)\b/i],
    [/\b(?:sneakers?|trainers?)\b/, /\b(?:sneakers?|trainers?)\b/i, /\b(?:ballet|loafers?|sandals?|boots?)\b/i],
  ];
  if (typeRules.some(([wanted, positive, conflict]) => wanted.test(requested) && !positive.test(primary) && conflict.test(primary))) return false;
  if (/\bwom[ae]ns?\b/.test(requested) && /\b(?:kids?|children|girls?|boys?|junior|toddler|baby|infant)\b/i.test(product.audienceEvidence || '')) return false;
  for (const color of ['white', 'black', 'brown', 'green', 'red', 'blue', 'pink']) {
    if (!new RegExp('\\b' + color + '\\b').test(requested) || !product.colorEvidence) continue;
    const evidence = product.colorEvidence.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
      .replace(/\b(whites|blacks|browns|greens|reds|blues|pinks|greys|grays|beiges)\b/gi, m => m.slice(0, -1))
      .replace(/\b(?:cocoa|cacao|chocolate|espresso)\b/gi, 'brown');
    const primary = evidence.match(/\b(white|ivory|cream|ecru|blizzard|black|brown|green|red|blue|pink|grey|gray|navy|tan|beige)\b/i)?.[1]?.toLowerCase();
    const white = /^(?:white|ivory|cream|ecru|blizzard)$/;
    if (color === 'white' ? !primary || !white.test(primary) : primary !== color) return false;
  }
  return true;
}
export function sourceProductMatches(html, pageURL, item, subject, parsedEvidence) {
  if (item.evidenceURL) return productAPIPhotos(html, item.evidenceURL, pageURL, item.productCode, parsedEvidence).some(p =>
    matchesPhotoProduct(subject, p) && keyURL(p.image) === keyURL(item.image));
  const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  if (matchesProductIntent(subject, title, Boolean(item.productTypeEvidence), item.verifiedBrand || '')) return true;
  return structuredProductPhotos(html, pageURL, () => true)
    .some(product => matchesPhotoProduct(subject, product) && productPageKey(product.canonicalURL || product.url) === productPageKey(pageURL) && keyURL(product.image) === keyURL(item.image));
}
export function discoveryIntent(subject, title) {
  return matchesIntent(subject,title) || /\b(?:shoe|footwear|flat|loafer|sneaker|boot)s?\b|鞋|靴/i.test(title);
}
const blocked = /(?:pinterest|etsy|ebay|1stdibs|ufonomore|fashionphile|stockx|goat\.|therealreal|vestiairecollective|grailed|carousell|amazon|walmart|poshmark|depop|mercari|aliexpress|temu|storage\.googleapis|lyst\.|smartcloset\.|modesens\.|shopstyle\.|goxip\.|joom\.|grandado\.|dhgate\.|lazada\.|flipkart\.|alibaba\.|aliexpress\.|shopee\.|meesho\.|gihut\.com|dashangu\.com|wenmiyuan\.com)/i;
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const plain = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const copyString = value => typeof value === 'string' ? Buffer.from(value, 'utf8').toString('utf8') : value;
export const PAGE_CACHE_LIMIT = 48;
export const PAGE_CACHE_BYTE_LIMIT = 8 * 1024 * 1024;
export const PAGE_READ_CONCURRENCY = 6;
function estimatePageBytes(value) {
  const html = typeof value === 'string' ? value : value?.html;
  return typeof html === 'string' ? html.length * 2 : 0;
}
export function createPageLRU(limit = PAGE_CACHE_LIMIT, maxBytes = PAGE_CACHE_BYTE_LIMIT) {
  const entries = new Map();
  const max = Math.max(1, Number(limit) || PAGE_CACHE_LIMIT);
  const byteLimit = Math.max(1, Number(maxBytes) || PAGE_CACHE_BYTE_LIMIT);
  let bytes = 0;
  const touch = (key, value, size = estimatePageBytes(value)) => {
    const previous = entries.get(key);
    if (previous) {
      bytes -= previous.size;
      entries.delete(key);
    }
    if (size > byteLimit) return;
    entries.set(key, { value, size });
    bytes += size;
    while (entries.size > max || bytes > byteLimit) {
      const oldest = entries.keys().next().value;
      bytes -= entries.get(oldest).size;
      entries.delete(oldest);
    }
  };
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const entry = entries.get(key);
      touch(key, entry.value, entry.size);
      return entry.value;
    },
    set(key, value, size = estimatePageBytes(value)) { touch(key, value, size); },
    delete(key) {
      const entry = entries.get(key);
      if (entry) bytes -= entry.size;
      entries.delete(key);
    },
    clear() { entries.clear(); bytes = 0; },
    get size() { return entries.size; },
    get bytes() { return bytes; },
  };
}
export function createPageReadLimiter(limit = PAGE_READ_CONCURRENCY) {
  const maximum = Math.max(1, Number(limit) || PAGE_READ_CONCURRENCY);
  let active = 0;
  const waiters = [];
  const acquire = signal => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (active < maximum) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort);
        active++;
        resolve();
      };
      const onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(signal.reason);
      };
      waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
  const release = () => {
    active--;
    const next = waiters.shift();
    if (next) next();
  };
  return async (task, signal) => {
    await acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  };
}
export function countResultSources(items) {
  return new Set((items || []).map(item => item?.source).filter(Boolean)).size;
}
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
  const key = keyURL(image);
  if (html.includes(new URL(image).href)) return true;
  if (new URL(image).hostname === 'static.nike.com') {
    const asset = new URL(image).pathname.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/i)?.[0];
    if (asset && html.includes(asset)) return true;
  }
  const rawUrls = [...html.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+/g)];
  if (rawUrls.some(match => {
    try { return keyURL(match[0].startsWith('//') ? 'https:' + match[0] : match[0]) === key; } catch { return false; }
  })) return true;
  const bare = new URL(image);
  bare.search = '';
  bare.hash = '';
  if ([
    bare.href.replaceAll('/', '\\u002F'),
    bare.href.replaceAll('/', '\\u002f'),
    bare.href.replaceAll('/', '\\\\u002F'),
    bare.href.replaceAll('/', '\\\\u002f'),
  ].some(value => html.includes(value))) return true;
  if (!html.includes('\\/')) return false;
  const normalized = decode(html).replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  return normalized.includes(new URL(image).href) || [...normalized.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+/g)].some(m => {
    try { return keyURL(m[0].startsWith('//') ? 'https:' + m[0] : m[0]) === key; } catch { return false; }
  });
}
export function declaredImageURL(html, image) {
  if (new URL(image).hostname !== 'static.nike.com') return image;
  const normalized = html.includes('\\/') ? decode(html).replace(/\\\//g, '/').replace(/\\u0026/g, '&') : html;
  const urls = [...normalized.matchAll(/https:\/\/static\.nike\.com\/a\/images\/[^\s"'<>\\]+/g)].map(m => m[0]);
  const size = url => Number(url.match(/t_(?:web_pdp|PDP)_(\d+)/)?.[1] || 320);
  const declared = urls.filter(url => { try { return keyURL(url) === keyURL(image); } catch { return false; } })
    .sort((a, b) => size(b) - size(a))[0];
  if (declared && !declared.includes('/t_default/')) return copyString(declared);
  if (/\/a\/images\/t_(?:web_pdp|PDP)_\d+/i.test(new URL(image).pathname)) return copyString(image);
  if (image.includes('/a/images/t_default/')) {
    // PDP JSON declares the asset under t_default; the same asset id can be
    // rendered at a qualifying size by the public image CDN.
    return copyString(image.replace('/a/images/t_default/', '/a/images/t_web_pdp_936_v2/f_auto,'));
  }
  return copyString(declared || image);
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
  return input.sourceScope === 2 ? { candidates: 1200, results: 100 } : input.sourceScope === 1 ? { candidates: 128, results: 24 } : { candidates: 64, results: 16 };
}
export function photoQueries(subject, scope) {
  const base = photoQuery(subject);
  const hasShoe = /loafer|ballet|flat|sandal|boot|shoe|heel|mule|sneaker|mary.jane|footwear|pump|slipper|鞋|靴/i.test(base);
  if (hasShoe) return scope === 2 ? [base, `${base} new collection`, `${base} design`] : [base];
  return scope === 2 ? [`${base} shoes`, `${base} sneakers`, `${base} footwear`, `${base} women shoes`] : [`${base} shoes`];
}
function eligibilityReason(candidate, subject, domains) {
  try {
    const u = new URL(candidate.url), image = candidate.image ? new URL(candidate.image) : null;
    if (!/^https?:$/.test(u.protocol) || (image && !/^https?:$/.test(image.protocol))) return 'invalidProtocol';
    if (blocked.test(u.hostname)) return 'blockedDomain';
    if (!isTargetPage(u.href)) return 'notTargetPage';
    if (/\/(search|category|categories)(\/|$)|[?&]q=/i.test(u.pathname + u.search)) return 'searchOrCategoryPage';
    if (domains.length && !domains.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) return 'outsideSourceScope';
    if (/(?:演示数据|示例商品|demo product|sample product|placeholder)/i.test(candidate.title || '')) return 'placeholder';
    if (!(candidate.productTypeEvidence ? matchesPhotoProduct(subject, { ...candidate, brandEvidence: candidate.brandEvidence || candidate.catalogue }) : discoveryIntent(subject, candidate.title || ''))) return 'discoveryIntentMismatch';
    if ((candidate.width !== undefined && !(Number(candidate.width) >= 350)) ||
        (candidate.height !== undefined && !(Number(candidate.height) >= 250))) return 'declaredImageTooSmall';
    return null;
  } catch { return 'invalidURL'; }
}
const eligible = (candidate, subject, domains) => !eligibilityReason(candidate, subject, domains);
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

function discoveryMonth(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now);
}

export function openDiscoveryQueries(subject, now = new Date()) {
  const base = photoQuery(subject);
  return [...new Set([base, `${base} fashion`, `new shoe trends ${discoveryMonth(now)}`, `fashion shoes ${discoveryMonth(now)}`])];
}

export function sourcePublishedAt(html, candidate, now = Date.now()) {
  const dateValue = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/property=["']article:published_time["'][^>]*content=["']([^"']+)/i)?.[1];
  const timestamp = Date.parse(dateValue || candidate?.publishedAt);
  return Number.isFinite(timestamp) && timestamp <= now ? new Date(timestamp).toISOString() : null;
}

async function discoverOpenSources(entry, fetcher, readDocument, input, signal, excluded) {
  const attempts = [];
  const domains = new Map();
  for (const query of openDiscoveryQueries(input.subject)) {
    const found = await discover({ ...entry, query, domains: [] }, fetcher, input.subject, signal);
    attempts.push(...found.map(attempt => ({ ...attempt, query })));
    for (const candidate of found.flatMap(attempt => attempt.results || [])) {
      let host;
      try { host = new URL(candidate.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
      if (!host || blocked.test(host) || excluded(host)) continue;
      domains.set(host, (domains.get(host) || 0) + 1);
    }
  }
  for (const [domain] of [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    try {
      const results = await abortable(() => recentSitemapCandidates({
        domain,
        readDocument: url => readDocument(url, fetcher),
        isRelevant: title => discoveryIntent(input.subject, title),
        days: input.days,
        signal,
      }), signal);
      if (results.length) attempts.push({ provider: '结构化站点索引', query: entry.query, results });
    } catch (error) {
      signal?.throwIfAborted();
      attempts.push({ provider: '结构化站点索引', query: entry.query, results: [], error: `${domain}: ${error.message}` });
    }
  }
  return attempts;
}

export async function searchPhotos(input, { fetcher, plans, readPage, readDocument = readPage, readImage, saveAsset, signal, onProgress = async () => {}, resultLimit, checkpoint = null, pageCacheLimit = PAGE_CACHE_LIMIT, pageCacheByteLimit = PAGE_CACHE_BYTE_LIMIT, incrementalProgress = false, knownImageHashes = [], knownImageFingerprints = [], evidenceDocuments = new Map(), limitPageRead = task => task(), trace = () => {} } = {}) {
  const fingerprints = [...knownImageFingerprints];
  const parsedDocuments = new WeakMap();
  const channels = [], buckets = [], images = new Set(), hashes = new Set(knownImageHashes);
  const limits = photoLimits(input);
  const maxResults = Number.isFinite(resultLimit) && resultLimit > 0 ? resultLimit : limits.results;
  const sourceChecks = [];
  const pageCache = createPageLRU(pageCacheLimit, pageCacheByteLimit);
  const readCached = (url, f = fetcher) => {
    if (pageCache.get(url) === undefined) {
      trace('page.cache.miss', { url });
      const pending = abortable(() => limitPageRead(() => readPage(url, f), signal), signal).then(value => {
        pageCache.set(value.url, Promise.resolve(value), estimatePageBytes(value));
        if (value.url !== url) pageCache.delete(url);
        return value;
      }).catch(error => {
        pageCache.delete(url);
        throw error;
      });
      pageCache.set(url, pending);
    } else trace('page.cache.hit', { url });
    return pageCache.get(url);
  };
  const readCachedWithRetry = async (url, attempts = 3) => {
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { return await readCached(url); }
      catch (error) {
        trace('page.retry', { url, attempt: attempt + 1, maxAttempts: attempts, error: errorDetails(error), willRetry: !signal?.aborted && attempt + 1 < attempts });
        last = error;
        signal?.throwIfAborted();
        if (attempt + 1 < attempts) await abortable(() => new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt)), signal);
      }
    }
    throw last;
  };
  const excluded = host => (plans.excludedDomains || []).some(d => host === d || host.endsWith('.' + d));
  const variants = photoQueries(input.subject, input.sourceScope);
  const base = variants[0];
  const entries = plans.filter(x => x.domains.length && !x.deepseek && !x.catalogURL && !x.sources?.length && !x.candidates)
    .map(x => ({ ...x, query: `${base} (${x.domains.map(d => `site:${d}`).join(' OR ')})` }));
  const agentPlan = plans.find(p => p.deepseek);
  if (!agentPlan && !plans.some(p => p.candidates) && input.sourceScope !== 0 && (input.sourceScope !== undefined || !input.domains.length)) {
    entries.unshift(...variants.map(query => ({ query, domains: [], label: '公开图片' })));
    if (input.sourceScope === 2) entries.push({ query: base, domains: [], label: '公开图片 · 后续页', offset: 60 });
  }
  if (!entries.length && !plans.length) entries.push({ query: base, domains: input.domains, label: '公开图片' });
  entries.unshift(...plans.filter(p => p.sources?.length).map(p => ({
    ...p, catalogURL: undefined, catalogue: undefined, sourceReader: true, query: base, label: '来源自身读取',
  })));
  entries.unshift(...plans.filter(p => p.catalogURL).map(p => ({
    ...p, sources: undefined, sourceReader: false, query: base, label: '品牌官网目录',
  })));
  entries.unshift(...plans.filter(p => p.openDiscovery).map(p => ({
    ...p, sources: undefined, catalogURL: undefined, catalogue: undefined, sourceReader: false, openDiscovery: true, query: base,
  })));
  entries.unshift(...plans.filter(p => p.candidates).map(p => ({ ...p, query: p.query || p.intent || base, label: p.label || '补充商品候选' })));
  if (agentPlan) entries.unshift({ ...agentPlan, query: base, label: 'DeepSeek 商品发现' });
  trace('discovery.started', { originalSubject: input.subject, dictionaryQuery: base, variants, limits, maxResults, entryCount: entries.length, excludedDomains: plans.excludedDomains || [] });
  let checked = 0, completed = 0;
  const items = [];
  let catalogCheckpoint = null;
  let catalogDiscoveryError = null;
  let catalogCompleted = new Set();
  let reportedItemCount = 0;
  const report = async (stage, totalCandidates = buckets.reduce((n, b) => n + b.length, 0)) => {
    signal?.throwIfAborted();
    const progressItems = incrementalProgress ? items.slice(reportedItemCount) : items.slice(0, maxResults);
    if (incrementalProgress) reportedItemCount = items.length;
    await onProgress(structuredClone({ stage, channelsDone: completed, totalChannels: entries.length,
      candidates: totalCandidates, checked, resultLimit: maxResults, accepted: Math.min(items.length, maxResults),
      matchedSources: countResultSources(items), items: progressItems, channels, sourceChecks,
      ...(catalogCheckpoint ? { checkpoint: catalogCheckpoint } : {}) }));
  };
  await report('discover');
  let nextEntry = 0;
  await Promise.all(Array.from({ length: Math.min(entries.length, 5) }, async () => {
    while (nextEntry < entries.length) {
      const entry = entries[nextEntry++];
      const entryId = randomBytes(8).toString('hex');
      const entryTrace = (type, data) => trace(type, { entryId, ...data });
      entryTrace('entry.started', { entry });
      try {
        let attempts;
        if (entry.candidates) {
          attempts = [{ provider: entry.provider || '公开商品目录', results: entry.candidates, intent: entry.intent || input.subject, query: entry.query, ...(entry.error ? { error: entry.error } : {}) }];
        } else if (entry.deepseek) {
          attempts = await deepseekDiscover(input, base, fetcher, signal, entryTrace);
        } else if (entry.openDiscovery) {
          attempts = await discoverOpenSources(entry, fetcher, readDocument, input, signal, excluded);
        } else if (entry.sourceReader) {
          const read = await readSourcePhotos({sources:entry.sources, readDocument:url=>abortable(()=>readDocument(url,fetcher),signal),
            readPage:url=>readCached(url), isRelevant:title=>matchesIntent(input.subject,title), isDiscoveryRelevant:title=>discoveryIntent(input.subject,title),
            isPriorityRelevant:title=>matchesIntent(input.subject,title,true),
            isProductRelevant:(title,brand,evidence)=>matchesProductIntent(input.subject,evidence||title,true,brand), signal, trace: entryTrace});
          sourceChecks.push(...read.checks);
          attempts = [{provider:'来源自身页面',results:read.results,...(read.checks.every(c=>c.status==='error')?{error:'来源文档均不可读取'}:{})}];
        } else if (entry.catalogURL) {
          const adapter = catalogAdapter(entry.catalogue || entry.catalogURL);
          if (!adapter) throw Error('品牌目录适配器不可用');
          const readerVersion = Math.max(1, Number(entry.readerVersion) || 1);
          const resume = checkpoint?.readerVersion === readerVersion && checkpoint?.catalogURL === entry.catalogURL
            ? structuredClone(checkpoint)
            : null;
          const found = Array.isArray(resume?.products) ? resume.products : [];
          let next = typeof resume?.next === 'string' ? resume.next : '';
          const pageLimit = Math.max(1, Number(entry.catalogPages) || 1);
          const productLimit = Math.max(1, Number(entry.catalogProductLimit) || found.length);
          const knownProducts = new Set(found.map(product => product.url));
          const addProducts = products => {
            for (const product of products) {
              if (!product?.url || knownProducts.has(product.url)) continue;
              knownProducts.add(product.url);
              found.push({ ...product, catalogue: adapter.name });
            }
          };
          const addPages = (html, url) => {
            if (!adapter.linkGraph || typeof adapter.links !== 'function') return;
            for (const pageURL of adapter.links(html, url)) {
              if (!visited.has(pageURL) && !frontier.includes(pageURL)) frontier.push(pageURL);
            }
          };
          const visited = new Set(Array.isArray(resume?.visited) ? resume.visited : [entry.catalogURL]);
          let frontier = adapter.linkGraph
            ? (Array.isArray(resume?.frontier) ? [...resume.frontier] : found.map(product => product.url))
            : [];
          const discoveryFailures = Array.isArray(resume?.discoveryFailures) ? [...resume.discoveryFailures] : [];
          catalogCompleted = new Set(Array.isArray(resume?.completedImageKeys) ? resume.completedImageKeys : []);
          if (!resume) {
            const { html, url } = await abortable(() => readPage(entry.catalogURL, fetcher), signal);
            addProducts(adapter.photos(html, url));
            next = adapter.next(html);
            if (adapter.linkGraph) {
              frontier.push(...found.map(product => product.url));
              addPages(html, url);
            }
          }
          catalogCheckpoint = {
            readerVersion,
            catalogURL: entry.catalogURL,
            products: found.slice(0, productLimit),
            next,
            visited: [...visited],
            frontier,
            discoveryFailures,
            completedImageKeys: [...catalogCompleted],
            complete: false,
            updatedAt: new Date().toISOString(),
          };
          await report('catalog-discover', found.length);
          let pagesThisRun = 0;
          while (pagesThisRun < pageLimit && next && found.length < productLimit) {
            pagesThisRun++;
            const pageURL = next;
            try {
              const response = await abortable(() => fetcher(pageURL, {
                redirect: 'manual',
                headers: {
                  accept: 'application/json',
                  referer: entry.catalogURL,
                  'nike-api-caller-id': 'com.nike.commerce.nikedotcom.web',
                  'user-agent': 'Mozilla/5.0',
                },
                signal,
              }), signal);
              const responseURL = response.url ? new URL(response.url) : null;
              if (!response.ok || response.status >= 300 || (responseURL && responseURL.hostname !== 'api.nike.com'))
                throw Error(`Nike 官方目录分页暂不可用（${response.status}）`);
              const data = await abortable(() => response.json(), signal);
              const safeNext = adapter.next(data);
              addProducts(adapter.photos(data, entry.catalogURL));
              next = safeNext;
            } catch (error) {
              entryTrace('catalogue.page.failed', { url: pageURL, error: errorDetails(error) });
              catalogDiscoveryError = error;
              next = pageURL;
              break;
            }
            catalogCheckpoint = {
              ...catalogCheckpoint,
              products: found.slice(0, productLimit),
              next,
              completedImageKeys: [...catalogCompleted],
              updatedAt: new Date().toISOString(),
            };
            await report('catalog-discover', found.length);
          }
          if (adapter.linkGraph) {
            let graphPages = 1;
            while (graphPages < pageLimit && frontier.length && found.length < productLimit) {
              const pageURL = frontier.shift();
              if (!pageURL || visited.has(pageURL)) continue;
              visited.add(pageURL);
              graphPages++;
              try {
                const { html, url } = await readCachedWithRetry(pageURL, 2);
                const sourceURL = new URL(url);
                if (!entry.domains.some(domain => sourceURL.hostname === domain || sourceURL.hostname.endsWith('.' + domain)) ||
                    !isTargetPage(url)) throw Error('目录链接跳转到未确认页面');
                addProducts(adapter.photos(html, url));
                addPages(html, url);
                for (const product of found) {
                  if (!visited.has(product.url) && !frontier.includes(product.url)) frontier.push(product.url);
                }
              } catch (error) {
                entryTrace('catalogue.page.failed', { url: pageURL, error: errorDetails(error) });
                signal?.throwIfAborted();
                discoveryFailures.push({ url: pageURL, error: error.message || String(error) });
              }
              catalogCheckpoint = {
                ...catalogCheckpoint,
                products: found.slice(0, productLimit),
                next,
                visited: [...visited],
                frontier,
                discoveryFailures,
                completedImageKeys: [...catalogCompleted],
                updatedAt: new Date().toISOString(),
              };
              if (visited.size % 5 === 0) await report('catalog-discover', found.length);
            }
            next = '';
          }
          if (!catalogDiscoveryError && found.length < productLimit && next && pagesThisRun >= pageLimit)
            catalogDiscoveryError = Error('Nike 官方目录分页达到本轮有界预算，可续跑');
          catalogCheckpoint = {
            ...catalogCheckpoint,
            products: found.slice(0, productLimit),
            next,
            completedImageKeys: [...catalogCompleted],
            complete: !catalogDiscoveryError && (!next || found.length >= productLimit),
            updatedAt: new Date().toISOString(),
          };
          attempts = [{ provider: '品牌官网目录', results: found.slice(0, productLimit),
            ...(catalogDiscoveryError ? { error: catalogDiscoveryError.message } : {}) }];
        } else attempts = await discover(entry, fetcher, input.subject, signal);
        signal?.throwIfAborted();
        for (const { results: found, provider, error, query, intent, planningError, planningAttempts, transportAttempts } of attempts) {
          const channelId = randomBytes(8).toString('hex');
          const matches = [];
          for (const candidate of found) {
            const candidateId = randomBytes(8).toString('hex');
            const reason = eligibilityReason(candidate, intent || input.subject, entry.domains) ||
              (excluded(new URL(candidate.url).hostname) ? 'excludedDomain' : null);
            entryTrace('candidate.prefilter', { channelId, candidateId, provider, query: query || entry.query,
              intent: intent || input.subject, domains: entry.domains, candidate, decision: reason ? 'rejected' : 'retained', reason });
            if (!reason) matches.push({ ...candidate, debugId: candidateId });
          }
          const scopeRejected = entry.domains.length && found.length && !found.some(c=>{try{const h=new URL(c.url).hostname;return entry.domains.some(d=>h===d||h.endsWith('.'+d));}catch{return false;}});
          const channelError = error || (scopeRejected ? '检索渠道未返回指定来源内的内容，范围未确认' : null);
          const channel = { debugId: channelId, entryId, provider, query: query || entry.query, ...(intent ? { intent } : {}), label: entry.label, domains: entry.domains, status: channelError ? 'error' : matches.length ? 'ready' : 'empty',
            ...(transportAttempts ? { transportAttempts, planningAttempts } : {}),
            count: 0, discovered: found.length, intentMatched: matches.length, prefilterRejected: found.length - matches.length, rejected: {}, ...(planningError ? { planningError } : {}), ...(channelError ? { error:channelError } : {}) };
          channels.push(channel);
          entryTrace('channel.discovered', { channel });
          buckets.push(matches.map(candidate => ({
            ...candidate, channel, domains: entry.domains, intentSubject: intent || input.subject,
            catalogue: candidate.catalogURL
              ? candidate.catalogue || entry.catalogue || catalogAdapter(entry.catalogURL)?.name
              : undefined,
            catalogImageLimit: entry.catalogImageLimit,
          })));
        }
      } catch (error) {
        entryTrace('entry.failed', { error: errorDetails(error), aborted: Boolean(signal?.aborted) });
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
  const deduplicated = candidates.filter(candidate => {
    if (candidate.catalogURL && candidate.image && catalogCompleted.has(candidate.url + '|' + keyURL(candidate.image))) {
      trace('candidate.skipped', { candidateId: candidate.debugId, url: candidate.url, reason: 'checkpointAlreadyCompleted' }); return false;
    }
    const key = candidate.image ? keyURL(candidate.image) : `page:${candidate.url}`;
    if (images.has(key)) { trace('candidate.skipped', { candidateId: candidate.debugId, url: candidate.url, key, reason: 'duplicateDiscovery' }); return false; }
    images.add(key); return true;
  });
  const unique = deduplicated.slice(0, Math.max(limits.candidates, candidates.filter(candidate => candidate.catalogURL).length));
  for (const candidate of deduplicated.slice(unique.length)) trace('candidate.skipped', { candidateId: candidate.debugId, url: candidate.url, reason: 'candidateBudget' });
  trace('verification.started', { discovered: candidates.length, deduplicated: deduplicated.length, scheduled: unique.length, maxResults });
  await report('verify', unique.length);
  const verifyBatch = unique.some(candidate => candidate.catalogURL) ? 3 : 8;
  for (let index = 0; index < unique.length && items.length < maxResults; index += verifyBatch) {
    await Promise.all(unique.slice(index, index + verifyBatch).map(async candidate => {
      let reason = 'sourceUnavailable';
      const subject = candidate.intentSubject || input.subject;
      const evidence = { candidateId: candidate.debugId, channelId: candidate.channel.debugId, url: candidate.url, image: candidate.image, subject };
      const started = Date.now();
      trace('candidate.verify.started', evidence);
      try {
        const document = candidate.evidenceURL
          ? evidenceDocuments.get(candidate.evidenceURL) || await abortable(() => limitPageRead(() => readDocument(candidate.evidenceURL, fetcher), signal), signal)
          : await readCachedWithRetry(candidate.url, candidate.catalogURL ? 3 : 1);
        const { html } = document;
        const url = candidate.evidenceURL ? candidate.url : document.url;
        if (candidate.evidenceURL && document.url !== candidate.evidenceURL) throw Error('商品数据地址发生跳转');
        evidence.evidenceURL = candidate.evidenceURL;
        evidence.evidenceKind = candidate.evidenceKind;
        evidence.evidenceFetchedAt = document.fetchedAt || candidate.evidenceFetchedAt;
        evidence.sourceDocumentSHA256 = document.sha256;
        const source = new URL(url);
        evidence.finalURL = url;
        if (blocked.test(source.hostname) || excluded(source.hostname)) { reason = 'blockedRedirectDomain'; throw Error('跳转后的来源被排除'); }
        if (!isTargetPage(url)) { reason = 'redirectNotTargetPage'; throw Error('跳转后不是目标页面'); }
        if (candidate.domains.length && !candidate.domains.some(d => source.hostname === d || source.hostname.endsWith('.' + d))) { reason = 'redirectOutsideSourceScope'; throw Error('跳转后不在指定来源范围'); }
        const pageTitle = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
        Object.assign(evidence, { finalURL: url, pageTitle });
        const catalogueProducts = candidate.catalogue
          ? catalogueProductPhotos(candidate.catalogue, html, url, title => matchesProductIntent(input.subject, title, true, candidate.catalogue))
          : [];
        if (catalogueProducts.length) {
          const selected = catalogueProducts.slice(0, Math.max(1, Number(candidate.catalogImageLimit) || 2));
          trace('candidate.catalogue.evidence', { ...evidence, products: catalogueProducts, selectedImages: selected.length,
            skippedByImageLimit: catalogueProducts.length - selected.length });
          const accepted = [];
          for (const product of selected) {
            let productReason = 'imageSourceMismatch';
            try {
              const image = declaredImageURL(html, product.image);
              if (!imageDeclared(html, image)) throw Error('商品图片未在来源中声明');
              productReason = 'imageUnavailable';
              reason = 'imageUnavailable';
            const asset = await abortable(() => readImage(image, fetcher), signal);
              const aspect = asset.width && asset.height ? asset.width / asset.height : 0;
              if (candidate.catalogue === 'adidas' && product.imageRole === 'hero' &&
                  (asset.width < 350 || asset.height < 250 || aspect < 0.5 || aspect > 2)) { productReason = 'imageAspectOrSize'; throw Error('目录主图尺寸或比例不符'); }
              const sha256 = createHash('sha256').update(asset.bytes).digest('hex');
              if (hashes.has(sha256)) { trace('candidate.image.skipped', { ...evidence, product, sha256, reason: 'duplicateImageHash' }); continue; }
              hashes.add(sha256);
              productReason = 'assetSaveFailed';
              await abortable(() => saveAsset(sha256, asset), signal);
              trace('candidate.image.accepted', { ...evidence, product, image, sha256, width: asset.width, height: asset.height, bytes: asset.bytes.length, mime: asset.mime });
              accepted.push({
                id: randomBytes(8).toString('hex'), title: product.title, url,
                canonicalURL: product.canonicalURL || url,
                productCode: product.productCode || candidate.productCode || '',
                clueKey: `${candidate.catalogue || 'product'}:${product.productCode || candidate.productCode || new URL(url).pathname}`,
                source: source.hostname.replace(/^www\./, ''), image, imageKind: 'source-matched',
                imageSha256: sha256, imageMime: asset.mime,
                sourceCheckedAt: new Date().toISOString(), sourceImageMatched: true,
                productTypeEvidence: true,
                verifiedBrand: candidate.catalogue,
                publishedAt: null, collectedAt: new Date().toISOString(),
                review: 'pending', selected: false, note: '', summary: '',
              });
            } catch (error) {
              trace('candidate.image.rejected', { ...evidence, product, reason: productReason, error: errorDetails(error) });
              signal?.throwIfAborted();
            }
          }
          if (!accepted.length) { reason = 'catalogueImagesRejected'; throw Error('目录图片均未通过核对，详见 candidate.image.rejected'); }
          trace('candidate.accepted', { ...evidence, durationMs: Date.now() - started, accepted: accepted.length });
          candidate.channel.count += accepted.length;
          for (const check of sourceChecks) if (source.hostname === check.domain || source.hostname.endsWith('.' + check.domain)) {
            check.status = 'queried'; delete check.error;
          }
          return accepted;
        }
        if (candidate.evidenceURL && !parsedDocuments.has(document)) {
          try { parsedDocuments.set(document, document.parsed || JSON.parse(html)); } catch { parsedDocuments.set(document, null); }
        }
        const structured = candidate.evidenceURL ? productAPIPhotos(html, candidate.evidenceURL, url, candidate.productCode, parsedDocuments.get(document)) : structuredProductPhotos(html, url, () => true);
        const products = structured.filter(product => matchesPhotoProduct(subject, product))
          .concat(articleProductPhotos(html,url,t=>matchesIntent(subject,t)));
        const belongsToPage = product => productPageKey(product.canonicalURL || product.url || url) === productPageKey(url) && !/preview_images|\.thumbnail\./i.test(product.image);
        const declaredOwn = structured.filter(belongsToPage);
        const ownProducts = products.filter(belongsToPage);
        trace('candidate.page.evidence', { ...evidence, products, ownProducts: ownProducts.length,
          unfilteredStructuredProducts: !ownProducts.length ? structured : undefined,
          declaredOwnProducts: declaredOwn.length,
          distinctProductPages: new Set(products.map(p => productPageKey(p.canonicalURL || p.url || url))).size });
        reason = 'productEvidenceMissing';
        if (!candidate.image && !ownProducts.length) {
          if (declaredOwn.length) reason = 'sourceIntentMismatch';
          throw Error(declaredOwn.length ? '原页已有商品图片，但商品信息未满足检索条件' : '未提取到归属于当前页面的商品图片');
        }
        if (!candidate.image && new Set(ownProducts.map(p => p.title)).size > 1) { reason = 'ambiguousProductPage'; throw Error('原页存在多个不同商品，未自动选择图片'); }
        const product = (candidate.image ? products.find(p=>keyURL(p.image)===keyURL(candidate.image)) : ownProducts[0]) || (!matchesIntent(subject,pageTitle) ? products[0] : null);
        const title = product?.title || pageTitle;
        const candidateImage = product?.image || candidate.image;
        const productEvidence = product?.intentEvidence || title;
        Object.assign(evidence, { selectedProduct: product, selectedTitle: title, selectedImage: candidateImage,
          titleMatches: matchesProductIntent(subject, title, Boolean(product?.productTypeEvidence), product?.brandEvidence),
          productEvidence, productMatches: matchesProductIntent(subject, productEvidence, Boolean(product?.productTypeEvidence), product?.brandEvidence) });
        reason = 'sourceIntentMismatch';
        if (!matchesProductIntent(subject, productEvidence, Boolean(product?.productTypeEvidence), product?.brandEvidence)) throw Error('原页商品信息与英文需求不符');
        reason = 'imageSourceMismatch';
        if (!candidateImage || !imageDeclared(html, candidateImage)) throw Error('候选图片未在原页中找到');
        const timestamp = candidate.evidenceURL ? Date.parse(product?.publishedAt) : Date.parse(
          html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ||
          html.match(/property=["']article:published_time["'][^>]*content=["']([^"']+)/i)?.[1] ||
          (candidate.evidenceURL ? product?.publishedAt : candidate.publishedAt),
        );
        const publishedAt = sourcePublishedAt(candidate.evidenceURL ? '' : html, candidate.evidenceURL ? { ...candidate, publishedAt: product?.publishedAt } : candidate);
        Object.assign(evidence, { publishedAt, requestedDays: input.days, imageDeclared: Boolean(candidateImage && imageDeclared(html, candidateImage)) });
        reason = 'dateUnconfirmed';
        if (input.days && !publishedAt) throw Error('无法确认原页或候选的发布日期');
        reason = 'outsideDateRange';
        if (input.days && timestamp < Date.now() - input.days * 86400000) throw Error('发布日期早于指定时间范围');
        reason = 'imageUnavailable';
        const accepted = [];
        const viewLimit = Math.max(1, Math.min(2, Number(candidate.viewLimit) || 1));
        const selectedPhotos = candidate.image ? [{ image: candidateImage }] : ownProducts.slice(0, viewLimit > 1 ? 8 : 1);
        for (const selected of selectedPhotos) {
          if (accepted.length >= viewLimit) break;
          try {
            reason = 'imageSourceMismatch';
            if (!imageDeclared(html, selected.image)) { reason = 'imageSourceMismatch'; throw Error('商品视图未在来源中声明'); }
            const image = declaredImageURL(html, selected.image);
            reason = 'imageUnavailable';
            const asset = await abortable(() => readImage(image, fetcher), signal);
            const sha256 = createHash('sha256').update(asset.bytes).digest('hex');
            if (hashes.has(sha256)) { reason = 'duplicateImageHash'; trace('candidate.skipped', { ...evidence, sha256, reason }); continue; }
            if (asset.imageFingerprint && (fingerprints.some(p => similarImage(p, asset.imageFingerprint)) || accepted.some(p => similarImage(p.imageFingerprint, asset.imageFingerprint, { distance: 10, color: 12 })))) {
              reason = 'nearDuplicateImage'; trace('candidate.skipped', { ...evidence, image, reason, fingerprint: asset.imageFingerprint }); continue;
            }
            if (asset.imageFingerprint) fingerprints.push(asset.imageFingerprint);
            hashes.add(sha256);
            signal?.throwIfAborted();
            reason = 'assetSaveFailed';
            await abortable(() => saveAsset(sha256, asset), signal);
            signal?.throwIfAborted();
            candidate.channel.count++;
            trace('candidate.accepted', { ...evidence, image, sha256, width: asset.width, height: asset.height,
              bytes: asset.bytes.length, mime: asset.mime, durationMs: Date.now() - started });
            for(const check of sourceChecks)if(source.hostname===check.domain||source.hostname.endsWith('.'+check.domain)){check.status='queried';delete check.error;}
            accepted.push({ id: randomBytes(8).toString('hex'), title, url, source: source.hostname.replace(/^www\./, ''),
              canonicalURL: product?.canonicalURL || candidate.canonicalURL || url, productCode: product?.productCode || candidate.productCode || '',
              clueKey: (product?.productCode || candidate.productCode) ? `product:${source.hostname.toLowerCase()}:${product?.productCode || candidate.productCode}` : `page:${source.hostname.toLowerCase()}${source.pathname}`,
              image, imageKind: 'source-matched', imageSha256: sha256, imageMime: asset.mime,
              ...(asset.imageFingerprint ? { imageFingerprint: asset.imageFingerprint } : {}),
              sourceCheckedAt: new Date().toISOString(), sourceImageMatched: true,
              productTypeEvidence: Boolean(product?.productTypeEvidence),
              verifiedBrand: product?.brandEvidence || '',
              searchIntent: subject, ...(candidate.searchProvider ? { discovery: { provider: candidate.searchProvider, query: candidate.channel.query, score: candidate.searchScore } } : {}),
              publishedAt, collectedAt: new Date().toISOString(), review: 'pending', selected: false, note: '', summary: '', ...(candidate.evidenceURL ? { evidenceURL: candidate.evidenceURL, evidenceKind: candidate.evidenceKind || 'public-product-api', ...(candidate.evidenceFetchedAt ? { evidenceFetchedAt: candidate.evidenceFetchedAt, sourceDocumentSHA256: document.sha256 } : {}) } : {}) });
          } catch (error) {
            if (error.code === 'IMAGE_QUALITY') reason = 'imageQualityRejected';
            trace('candidate.image.rejected', { ...evidence, image: selected.image, reason, error: errorDetails(error) });
            signal?.throwIfAborted();
          }
        }
        if (!accepted.length) throw Error('本商品图片均未通过核对');
        return accepted;
      } catch (error) {
        trace('candidate.rejected', { ...evidence, reason, error: errorDetails(error), aborted: Boolean(signal?.aborted), durationMs: Date.now() - started });
        signal?.throwIfAborted();
        const rejects = candidate.channel.rejected;
        rejects[reason] = (rejects[reason] || 0) + 1;
        return null;
      } finally {
        pageCache.delete(candidate.url);
      }
    }).map(work => work.then(async item => {
      if (Array.isArray(item)) {
        for (const value of item) {
          if (value) catalogCompleted.add(value.url + '|' + keyURL(value.image));
        }
        for (const value of item) if (value && items.length < maxResults) items.push(value);
      } else if (item) items.push(item);
      if (catalogCheckpoint) {
        catalogCheckpoint = {
          ...catalogCheckpoint,
          completedImageKeys: [...catalogCompleted],
          updatedAt: new Date().toISOString(),
        };
      }
      checked++;
      await report('verify', unique.length);
    })));
  }
  for (const candidate of unique.slice(checked)) trace('candidate.skipped', { candidateId: candidate.debugId, url: candidate.url, reason: 'resultBudget' });
  channels.forEach(c => { if (c.status !== 'error') c.status = c.count ? 'ready' : 'empty'; });
  trace('verification.finished', { checked, acceptedBeforeResultLimit: items.length, accepted: Math.min(items.length, maxResults), channels, sourceChecks });
  if (catalogDiscoveryError) throw catalogDiscoveryError;
  if (catalogCheckpoint) {
    catalogCheckpoint = { ...catalogCheckpoint, complete: true, updatedAt: new Date().toISOString() };
  }
  return { items: items.slice(0, maxResults).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)),
    channels, sourceChecks, ...(catalogCheckpoint ? { checkpoint: catalogCheckpoint } : {}) };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function exportHTML(task, assets) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(task.input.subject)} · 图片与来源</title><style>body{font:16px/1.6 system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#11141a}article{border-top:1px solid #ccd3dc;padding:24px 0;break-inside:avoid}img{width:100%;max-height:520px;object-fit:contain}a,code{overflow-wrap:anywhere}p{margin:8px 0}a{color:#154bea}</style><h1>${esc(task.input.subject)}</h1><p>交付时间 ${esc(task.delivery.createdAt)} · ${task.delivery.items.length} 张图片</p><p>图片已嵌入本文件，可离线查看。原始来源与图片地址逐张保留。来源可追溯不代表获得商用授权。</p>${task.delivery.items.map((i, n) => `<article data-image-id="${esc(i.id)}"><h2>${n + 1}. ${esc(i.title)}</h2><img src="data:${i.imageMime};base64,${assets[n].toString('base64')}" alt="${esc(i.title)}"><p>图片编号：${esc(i.id)}</p><p><a href="${esc(i.url)}">打开原始来源：${esc(i.url)}</a></p><p><a href="${esc(i.image)}">原始图片：${esc(i.image)}</a></p>${i.evidenceURL ? `<p><a href="${esc(i.evidenceURL)}">来源数据证据</a> · 商品编号：${esc(i.productCode || "")}</p>` : ""}<p>核查依据：${esc(i.note)}</p><p>来源核对时间：${esc(i.sourceCheckedAt)} · 发布日期：${esc(i.publishedAt || '未确认')}</p><p>SHA-256：<code>${esc(i.imageSha256)}</code></p></article>`).join('')}</html>`;
}
