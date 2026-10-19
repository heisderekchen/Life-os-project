import { createHash, randomBytes } from 'node:crypto';

const translations = [
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
const stop = new Set(['women', 'womens', 'woman', 'ladies', 'female', 'for', 'and', 'the', 'with', 'of', 'in', 'a', 's']);
export function matchesIntent(subject, value) {
  const terms = photoQuery(subject).toLowerCase().replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  const hay = value.toLowerCase().replace(/['’]/g, '');
  if (terms.includes('leather') && /\bfaux\b|\bsynthetic\b|leather[- ]look|仿皮|人造革/i.test(value)) return false;
  return terms.filter(t => !stop.has(t)).every(t => {
    const stem = t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t;
    return hay.includes(stem);
  }) && /loafer|ballet|flat|sandal|boot|shoe|heel|mule|sneaker|mary.jane|pump|slipper|鞋|靴/i.test(value);
}
const blocked = /(?:pinterest|etsy|ebay|1stdibs|ufonomore|therealreal|vestiairecollective|grailed|carousell|amazon|walmart|poshmark|depop|mercari|aliexpress|temu|storage\.googleapis|lyst\.)/i;
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const plain = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function keyURL(value) {
  const u = new URL(value);
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
async function discover(query, fetcher) {
  const headers = { accept: 'text/html', 'user-agent': 'Mozilla/5.0' };
  const page = await fetcher('https://duckduckgo.com/?q=' + encodeURIComponent(query), { headers, signal: AbortSignal.timeout(9000) });
  if (!page.ok) throw Error('图片搜索暂不可用');
  const token = (await page.text()).match(/vqd=['"]?([\d-]+)/)?.[1];
  if (!token) throw Error('图片搜索未返回有效凭据');
  const endpoint = new URL('https://duckduckgo.com/i.js');
  Object.entries({ l: 'us-en', o: 'json', q: query, vqd: token, p: '1' }).forEach(([k, v]) => endpoint.searchParams.set(k, v));
  const response = await fetcher(endpoint, { headers: { ...headers, accept: 'application/json', referer: 'https://duckduckgo.com/' }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw Error('图片搜索暂不可用');
  const data = await response.json();
  if (!Array.isArray(data.results)) throw Error('图片搜索返回异常');
  return data.results;
}

export async function searchPhotos(input, { fetcher, plans, readPage, readImage, saveAsset }) {
  const channels = [], candidates = [], pages = new Set(), images = new Set(), hashes = new Set();
  const base = photoQuery(input.subject);
  // Focused mode retains its domain boundary. Other modes also discover public
  // images; this is visible in the form and recorded in every channel log.
  const entries = plans.filter(x => x.domains.length).map(x => ({ ...x, query: `${base} (${x.domains.map(d => `site:${d}`).join(' OR ')})` }));
  if (input.sourceScope !== 0 && (input.sourceScope !== undefined || !input.domains.length)) entries.unshift({ query: base, domains: [], label: '公开图片' });
  if (!entries.length) entries.push({ query: base, domains: input.domains, label: '公开图片' });
  for (let index = 0; index < entries.length; index += 2) await Promise.all(entries.slice(index, index + 2).map(async entry => {
    try {
      const found = await discover(entry.query, fetcher);
      const matches = found.filter(x => {
        try {
          const u = new URL(x.url);
          return /^https?:$/.test(u.protocol) && !blocked.test(u.hostname) && u.pathname !== '/' &&
            !/\/(search|collections|category|categories)(\/|$)|[?&]q=/i.test(u.pathname + u.search) &&
            (!entry.domains.length || entry.domains.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) &&
            matchesIntent(input.subject, x.title || '') && Number(x.width) >= 350 && Number(x.height) >= 250;
        } catch { return false; }
      });
      channels.push({ provider: 'DuckDuckGo Images', query: entry.query, label: entry.label, status: matches.length ? 'ready' : 'empty', count: 0, discovered: found.length, intentMatched: matches.length, rejected: {} });
      const channel = channels.at(-1);
      candidates.push(...matches.map(x => ({ ...x, channel, domains: entry.domains })));
    } catch (e) { channels.push({ provider: 'DuckDuckGo Images', query: entry.query, label: entry.label, status: 'error', count: 0, error: e.message }); }
  }));
  if (channels.every(c => c.status === 'error')) throw Error('公开图片检索暂不可用，任务已保留，请稍后重试。');
  const unique = candidates.filter(x => {
    const page = new URL(x.url); page.search = ''; page.hash = '';
    const key = page.href;
    if (pages.has(key) || images.has(keyURL(x.image))) return false;
    pages.add(key); images.add(keyURL(x.image)); return true;
  }).slice(0, input.sourceScope === 2 ? 32 : 16);
  const items = [];
  for (let index = 0; index < unique.length && items.length < 8; index += 4) {
    const batch = await Promise.all(unique.slice(index, index + 4).map(async candidate => {
      let reason = 'sourceUnavailable';
      try {
        const { html, url } = await readPage(candidate.url, fetcher);
        const source = new URL(url);
        if (blocked.test(source.hostname) || source.pathname === '/' || (candidate.domains.length && !candidate.domains.some(d => source.hostname === d || source.hostname.endsWith('.' + d)))) throw Error();
        const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
        reason = 'sourceIntentMismatch';
        if (!matchesIntent(input.subject, title)) throw Error();
        reason = 'imageSourceMismatch';
        if (!imageDeclared(html, candidate.image)) throw Error();
        const dateValue = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] || html.match(/property=["']article:published_time["'][^>]*content=["']([^"']+)/i)?.[1];
        const timestamp = Date.parse(dateValue);
        const publishedAt = Number.isFinite(timestamp) && timestamp <= Date.now() ? new Date(timestamp).toISOString() : null;
        reason = 'dateUnconfirmedOrOutsideRange';
        if (input.days && (!publishedAt || timestamp < Date.now() - input.days * 86400000)) throw Error();
        reason = 'imageUnavailable';
        const asset = await readImage(candidate.image, fetcher);
        const sha256 = createHash('sha256').update(asset.bytes).digest('hex');
        if (hashes.has(sha256)) return null;
        hashes.add(sha256);
        await saveAsset(sha256, asset);
        candidate.channel.count++;
        return { id: randomBytes(8).toString('hex'), title, url, source: source.hostname.replace(/^www\./, ''),
          image: candidate.image, imageKind: 'source-matched', imageSha256: sha256, imageMime: asset.mime,
          sourceCheckedAt: new Date().toISOString(), sourceImageMatched: true,
          publishedAt, collectedAt: new Date().toISOString(), review: 'pending', selected: false, note: '', summary: '' };
      } catch {
        const rejects = candidate.channel.rejected;
        rejects[reason] = (rejects[reason] || 0) + 1;
        return null;
      }
    }));
    items.push(...batch.filter(Boolean));
  }
  channels.forEach(c => { if (c.status !== 'error') c.status = c.count ? 'ready' : 'empty'; });
  return { items: items.slice(0, 8), channels };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function exportHTML(task, assets) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(task.input.subject)} · 图片与来源</title><style>body{font:16px/1.6 system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#11141a}article{border-top:1px solid #ccd3dc;padding:24px 0;break-inside:avoid}img{width:100%;max-height:520px;object-fit:contain}a,code{overflow-wrap:anywhere}p{margin:8px 0}a{color:#154bea}</style><h1>${esc(task.input.subject)}</h1><p>交付时间 ${esc(task.delivery.createdAt)} · ${task.delivery.items.length} 张图片</p><p>图片已嵌入本文件，可离线查看。原始来源与图片地址逐张保留。来源可追溯不代表获得商用授权。</p>${task.delivery.items.map((i, n) => `<article data-image-id="${esc(i.id)}"><h2>${n + 1}. ${esc(i.title)}</h2><img src="data:${i.imageMime};base64,${assets[n].toString('base64')}" alt="${esc(i.title)}"><p>图片编号：${esc(i.id)}</p><p><a href="${esc(i.url)}">打开原始来源：${esc(i.url)}</a></p><p><a href="${esc(i.image)}">原始图片：${esc(i.image)}</a></p><p>核查依据：${esc(i.note)}</p><p>来源核对时间：${esc(i.sourceCheckedAt)} · 发布日期：${esc(i.publishedAt || '未确认')}</p><p>SHA-256：<code>${esc(i.imageSha256)}</code></p></article>`).join('')}</html>`;
}
