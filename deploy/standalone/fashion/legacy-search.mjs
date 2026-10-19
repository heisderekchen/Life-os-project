const MAX_QUERY_LENGTH = 360;
const MAX_RESULTS = 8;
const IMAGE_SOURCE_TIMEOUT_MS = 5000;

const FOOTWEAR = /\b(shoe|shoes|footwear|sneaker|boot|loafer|sandal|slingback|pump|mule|ballerina|trainer|heel|slipper|espadrille|oxford|derby|platform)s?\b|鞋|靴|乐福|凉鞋|运动鞋|高跟|平底|芭蕾|拖鞋|穆勒/i;
const NOT_SHOE_FOCUSED = /\b(ankle|ankles|calf|calves|leg|legs|thigh|thighs|torso|waist|full[- ]?body|body shot|outfit|street style|model|models)\b|脚踝|小腿|大腿|腿部|全身|模特|穿搭|街拍|身体/i;
const BLOCKED_HOST = /(?:pinterest|carousell|1stdibs|ebay|poshmark|depop|mercari)/i;

function response(status, payload) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
}

function terms(value, limit = 8) {
    const input = Array.isArray(value) ? value : String(value || '').split(/[,，;；\n]+/);
    return [...new Set(input.map(item => String(item).trim()).filter(Boolean))].slice(0, limit);
}

async function jsonBody(request) {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 8192) throw new Error('搜索条件过长。');
    const text = await request.text();
    if (text.length > 8192) throw new Error('搜索条件过长。');
    try { return JSON.parse(text || '{}'); } catch { throw new Error('搜索条件格式无效。'); }
}

function eventQuery(body) {
    const subject = String(body?.subject || '').trim();
    const eventTerms = terms(body?.events);
    if (!subject || !eventTerms.length) throw new Error('请填写品牌或主题，以及事件关键词。');
    const query = `${subject} (${eventTerms.map(item => `"${item}"`).join(' OR ')})`;
    if (query.length > MAX_QUERY_LENGTH) throw new Error('搜索关键词过长。');
    return query;
}

function materialQuery(body) {
    const subject = String(body?.subject || '').trim();
    const materialTerms = terms(body?.materials || body?.shoeTerms || body?.keywords || ['shoes']);
    if (!subject) throw new Error('请填写品牌或主题。');
    const shoeTerms = materialTerms.length > 1 ? `(${materialTerms.map(item => `"${item}"`).join(' OR ')})` : materialTerms[0] || 'shoes';
    const query = `${subject} ${shoeTerms} runway`;
    if (query.length > MAX_QUERY_LENGTH) throw new Error('搜索关键词过长。');
    return { query, terms: materialTerms.length ? materialTerms : ['shoes'] };
}

function decodeXml(value = '') {
    return value.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function xmlField(xml, name) {
    return decodeXml(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
}

function qualifyMaterials(results) {
    const seen = new Set();
    const rejected = { noShoeSubject: 0, bodyCropOrFashion: 0, invalidOrBlocked: 0, duplicate: 0 };
    const materials = [];
    for (const result of Array.isArray(results) ? results : []) {
        const title = String(result?.title || '');
        const url = String(result?.url || '');
        const image = String(result?.image || '');
        let reason = '';
        if (!title || !FOOTWEAR.test(title)) reason = 'noShoeSubject';
        else if (NOT_SHOE_FOCUSED.test(title)) reason = 'bodyCropOrFashion';
        else if (!/^https?:\/\//.test(url) || !/^https?:\/\//.test(image) || BLOCKED_HOST.test(url)) reason = 'invalidOrBlocked';
        else if (seen.has(image)) reason = 'duplicate';
        if (reason) { rejected[reason] += 1; continue; }
        seen.add(image);
        let source = '公开图片来源';
        try { source = new URL(url).hostname.replace(/^www\./, ''); } catch {}
        materials.push({ id: `material-${Date.now()}-${materials.length}`, title, url, image, source, publishedAt: result.discovery_date || null });
        if (materials.length === MAX_RESULTS) break;
    }
    return { materials, quality: { inspected: Array.isArray(results) ? results.length : 0, rejected } };
}

function rssCandidates(xml) {
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 10).map(([, item], index) => ({
        id: `event-${Date.now()}-${index}`,
        title: xmlField(item, 'title'),
        url: xmlField(item, 'link'),
        source: xmlField(item, 'source') || '公开新闻来源',
        publishedAt: xmlField(item, 'pubDate'),
        summary: xmlField(item, 'description')
    })).filter(item => item.title && item.url && item.publishedAt);
}

async function searchEvents(body, fetcher) {
    const query = eventQuery(body);
    const google = new URL('https://news.google.com/rss/search');
    google.searchParams.set('q', query);
    google.searchParams.set('hl', 'en-US');
    google.searchParams.set('gl', 'US');
    google.searchParams.set('ceid', 'US:en');
    try {
        const upstream = await fetcher(google.toString(), { headers: { accept: 'application/rss+xml, application/xml;q=0.9' } });
        if (upstream.ok) {
            const candidates = rssCandidates(await upstream.text());
            if (candidates.length) return { query, candidates, searchSource: 'Google News RSS' };
        }
    } catch {}
    const bing = new URL('https://www.bing.com/search');
    bing.searchParams.set('format', 'rss');
    bing.searchParams.set('q', query);
    try {
        const upstream = await fetcher(bing.toString(), { headers: { accept: 'application/rss+xml, application/xml;q=0.9' } });
        if (!upstream.ok) throw new Error('not-ok');
        return { query, candidates: rssCandidates(await upstream.text()), searchSource: 'Bing RSS' };
    } catch {
        throw new Error('公开事件搜索暂时不可用，任务已保留，可稍后重试。');
    }
}

// Read the body within the same deadline as the headers. A stalled provider
// must release its request before trying another public source.
async function imageSource(fetcher, url, format) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_SOURCE_TIMEOUT_MS);
    try {
        const result = await fetcher(String(url), { signal: controller.signal, headers: {
            accept: format === 'json' ? 'application/json' : 'text/html',
            ...(String(url).startsWith('https://duckduckgo.com/i.js') ? { referer: 'https://duckduckgo.com/' } : {})
        } });
        if (!result.ok) throw new Error('图片来源暂时不可用。');
        return await (format === 'json' ? result.json() : result.text());
    } finally { clearTimeout(timer); }
}

async function duckImages(query, fetcher) {
    const html = await imageSource(fetcher, `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, 'text');
    const vqd = html.match(/vqd=['"]?([\d-]+)['"]?/i)?.[1];
    if (!vqd) throw new Error('图片搜索未返回有效凭据。');
    const endpoint = new URL('https://duckduckgo.com/i.js');
    endpoint.searchParams.set('l', 'us-en'); endpoint.searchParams.set('o', 'json');
    endpoint.searchParams.set('q', query); endpoint.searchParams.set('vqd', vqd);
    const payload = await imageSource(fetcher, endpoint, 'json');
    if (!Array.isArray(payload?.results)) throw new Error('图片搜索返回异常。');
    return payload.results;
}

function htmlEntities(value) {
    return value.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (match, code) => {
        const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }).replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function bingImages(query, fetcher) {
    const endpoint = new URL('https://www.bing.com/images/search');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('count', '40');
    endpoint.searchParams.set('adlt', 'strict');
    const html = await imageSource(fetcher, endpoint, 'text');
    const results = [];
    for (const [, , value] of html.matchAll(/<a\b[^>]*\bm=(['"])(.*?)\1/gi)) {
        try {
            const item = JSON.parse(htmlEntities(value));
            if (item.murl && item.purl && item.t) results.push({ title: item.t, url: item.purl, image: item.murl });
        } catch { /* Skip malformed cards without discarding other images. */ }
    }
    // A challenge or changed HTML is a source failure, not an empty search.
    if (!results.length) throw new Error('备用图片搜索未返回可解析结果。');
    return results;
}

async function commonsImages(subject, shoeTerms, fetcher) {
    const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
    const query = `${subject} ${shoeTerms[0]}`;
    const params = { action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6',
        gsrlimit: '30', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1000', format: 'json' };
    Object.entries(params).forEach(([key, value]) => endpoint.searchParams.set(key, value));
    const payload = await imageSource(fetcher, endpoint, 'json');
    if (payload?.error || (!payload?.query && !Object.hasOwn(payload || {}, 'batchcomplete'))) throw new Error('备用图库返回异常。');
    return Object.values(payload?.query?.pages || {}).flatMap(page => {
        const info = page.imageinfo?.[0];
        if (!info || !/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(info.url || '')) return [];
        const description = String(info.extmetadata?.ImageDescription?.value || '').replace(/<[^>]*>/g, ' ');
        const title = htmlEntities(`${page.title?.replace(/^File:/, '') || ''} ${description}`).replace(/\s+/g, ' ').trim().slice(0, 500);
        // Search APIs can return broad matches. Do not mix another brand into a task.
        if (!title.toLocaleLowerCase().includes(subject.toLocaleLowerCase())) return [];
        return [{ title, image: info.thumburl || info.url, url: info.descriptionurl }];
    });
}

async function searchMaterials(body, fetcher) {
    const search = materialQuery(body);
    const subject = String(body.subject).trim();
    // Some public search gateways reject OR expressions while the same brand
    // and one footwear term work. Try a narrower, literal query before switching.
    const literalQuery = `${subject} ${search.terms[0]} runway`;
    const sources = [
        ['DuckDuckGo Images', () => duckImages(search.query, fetcher), search.query],
        ...(literalQuery !== search.query ? [['DuckDuckGo Images', () => duckImages(literalQuery, fetcher), literalQuery]] : []),
        ['Bing Images', () => bingImages(search.query, fetcher)],
        ['Wikimedia Commons', () => commonsImages(subject, search.terms, fetcher), `${subject} ${search.terms[0]}`]
    ];
    let empty = null;
    for (const [searchSource, load, sourceQuery = search.query] of sources) {
        try {
            const qualified = qualifyMaterials(await load());
            const result = { query: sourceQuery, requestedQuery: search.query, terms: search.terms, searchSource, ...qualified };
            if (qualified.materials.length) return result;
            empty ||= result;
        } catch { /* Each source has an independent deadline and fallback. */ }
    }
    if (empty) return empty;
    throw new Error('公开图片来源暂时均不可用，请稍后点击“重试获取照片”。');
}

export function createFashionIntelligenceSearch({ fetcher = fetch } = {}) {
    return async function handleFashionIntelligenceSearch(request) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith('/fashion-intelligence/api/')) return null;
        if (request.method !== 'POST') return response(405, { error: '不支持的请求方法。' });
        try {
            const body = await jsonBody(request);
            if (url.pathname === '/fashion-intelligence/api/search/events') return response(200, await searchEvents(body, fetcher));
            if (url.pathname === '/fashion-intelligence/api/search/materials') return response(200, await searchMaterials(body, fetcher));
            return response(404, { error: '未找到接口。' });
        } catch (error) {
            return response(400, { error: error instanceof Error ? error.message : '搜索失败。' });
        }
    };
}
