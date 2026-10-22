import { imageFingerprint } from './image-quality.mjs';
import { searchBroadPhotos, publicFetch, BROAD_TIMEOUT_MS } from './broad-search.mjs';
import { createServer } from "node:http";
import { abortable } from "./async-control.mjs";
import { runSourceQueue, SOURCE_QUEUE_READER_VERSION } from './source-queue.mjs';
import { sourceCatalog } from "./public/source-catalog.js";
import { searchPhotos, imageDeclared, matchesIntent, matchesProductIntent, sourceProductMatches, exportHTML, countResultSources, createPageReadLimiter } from "./photo-search.mjs";
import { deepseekSearchReady } from './deepseek-search.mjs';
import { SEARCH_VERSION, createSearchTrace, readSearchTrace, interruptSearchTrace, errorDetails, sanitizeTrace } from './search-trace.mjs';
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
const here = dirname(fileURLToPath(import.meta.url));
const json = (res, status, data) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data, (key, value) => key === 'sourceQueue' ? undefined : value));
};
const text = (v) =>
  String(v ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
const field = (s, key) =>
  text(
    s.match(new RegExp(`<${key}\\b[^>]*>([\\s\\S]*?)<\\/${key}>`, "i"))?.[1] ||
      "",
  );
export const safeURL = (value) => {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
};
export function normalizeInput(raw) {
  const subject = String(raw.subject || "").trim();
  if (!subject || subject.length > 180)
    throw Error("请填写 1–180 字的检索要求。");
  const days = Number(raw.days ?? 30);
  if (![7, 30, 90, 0].includes(days)) throw Error("时间范围无效。");
  const domains = [
    ...new Set(
      String(raw.domains || "")
        .split(/[,，\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const u = new URL(s.includes("://") ? s : `https://${s}`);
          if (
            !/^https?:$/.test(u.protocol) ||
            u.username ||
            u.password ||
            u.port ||
            isIP(u.hostname) ||
            !u.hostname.includes(".") ||
            /[^a-z0-9.-]/i.test(u.hostname)
          )
            throw Error("请填写公开网站域名。");
          return u.hostname.toLowerCase();
        }),
    ),
  ];
  if (domains.length > 3) throw Error("首版每个任务最多指定三个网站。");
  if (raw.sourceScope === undefined) return { subject, days, domains };
  const sourceScope = Number(raw.sourceScope);
  if (![0, 1, 2].includes(sourceScope)) throw Error("来源范围无效。");
  if (!Array.isArray(raw.sources) || raw.sources.some(id => !sourceCatalog.some(source => source.id === id)))
    throw Error("请选择已接入的来源。");
  const sources = [...new Set(raw.sources)];
  if (sourceScope === 0 && !sources.length && !domains.length) throw Error("聚焦检索至少选择一类来源。");
  return { subject, days, domains, sourceScope, sources };
}
export function queriesFor(input) {
  let q = input.subject;
  for (const [cn, en] of [
    ["乐福鞋", "loafers"],
    ["女鞋", "women footwear"],
    ["芭蕾鞋", "ballet flats"],
    ["凉鞋", "sandals"],
    ["运动鞋", "sneakers"],
    ["靴子", "boots"],
  ])
    if (q.includes(cn)) q += ` ${en}`;
  return input.domains.length
    ? input.domains.map((d) => `${q} site:${d}`)
    : [q];
}
export function searchPlan(input) {
  if (input.sourceScope === undefined) return queriesFor(input).map(query => ({ query, domains: input.domains, providers: ["Google News", "Bing"], label: "公开检索" }));
  const base = queriesFor({ ...input, domains: [] })[0];
  const groups = sourceCatalog.filter(source => input.sources.includes(source.id));
  const plan = groups.map(source => ({ query: `${base} (${source.domains.map(domain => `site:${domain}`).join(" OR ")})`, domains: source.domains, providers: ["Bing"], label: source.label }));
  for (const domain of input.domains) plan.push({ query: `${base} site:${domain}`, domains: [domain], providers: ["Bing"], label: "补充来源" });
  if (input.sourceScope >= 1) plan.push({ query: base, domains: [], providers: ["Google News"], label: "相关新闻" });
  if (input.sourceScope === 2) plan.push({ query: base, domains: [], providers: ["Bing"], label: "公开网页" });
  return plan;
}
export function parseRSS(xml, input, now = Date.now()) {
  const seen = new Set();
  const min = input.days ? now - input.days * 86400000 : 0;
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .flatMap(([, s]) => {
      const url = safeURL(field(s, "link")),
        title = field(s, "title"),
        rawDate = Date.parse(field(s, "pubDate"));
      if (!url || !title || seen.has(url)) return [];
      const host = new URL(url).hostname;
      if (
        input.domains.length &&
        !input.domains.some((d) => host === d || host.endsWith("." + d))
      )
        return [];
      const publishedAt = Number.isFinite(rawDate)
        ? new Date(rawDate).toISOString()
        : null;
      if (
        input.days &&
        (!publishedAt || rawDate < min || rawDate > now + 86400000)
      )
        return [];
      seen.add(url);
      return [
        {
          id: randomBytes(8).toString("hex"),
          title,
          url,
          source: field(s, "source") || host,
          publishedAt,
          collectedAt: new Date(now).toISOString(),
          image: null,
          imageKind: "none",
          summary: field(s, "description").slice(0, 1200),
          review: "pending",
          selected: false,
          note: "",
        },
      ];
    })
    .slice(0, 24);
}
export function privateAddress(address) {
  return (
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::|fc|fd|fe80)/i.test(
      address,
    ) || /^(?:ff|fe[89ab]|2001:db8:)/i.test(address)
  );
}
async function publicURL(value, fetcher) {
  const u = new URL(value);
  if (
    !safeURL(value) ||
    u.port ||
    isIP(u.hostname) ||
    !u.hostname.includes(".")
  )
    throw Error("仅支持公开网站。");
  if (fetcher?.trustedRelayHosts?.has(u.hostname)) return u;
  const ips = await lookup(u.hostname, { all: true });
  if (!ips.length || ips.some((x) => privateAddress(x.address)))
    throw Error("网站地址不可用。");
  return u;
}
export async function getPublic(value, fetcher, redirects = 0, allowFeed = false) {
  const u = await publicURL(value, fetcher);
  const r = await fetcher(u, {
    signal: AbortSignal.timeout(allowFeed ? 18000 : 7000),
    redirect: "manual",
    headers: { "user-agent": "Mozilla/5.0", accept: allowFeed ? "text/html,application/json,application/javascript,application/xml" : "text/html" },
  });
  if (r.status >= 300 && r.status < 400) {
    if (redirects >= 3) throw Error("跳转过多");
    return getPublic(
      new URL(r.headers.get("location"), u).href,
      fetcher,
      redirects + 1,
      allowFeed,
    );
  }
  const mime = r.headers.get("content-type") || "";
  if (!r.ok || !(mime.includes("text/html") || (allowFeed && /(?:application\/(?:rss\+xml|atom\+xml|xml)|text\/xml|application\/(?:json|javascript)|text\/javascript)/i.test(mime))))
    { const error = Error(`网页不可读（HTTP ${r.status}）`); error.status = r.status;
      const retry = Number(r.headers.get('retry-after')); if (Number.isFinite(retry) && retry > 0) error.retryAfterMs = retry * 1000;
      throw error; }
  let html = "";
  const decoder = new TextDecoder();
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, {stream:true});
    if (html.length > (allowFeed && /json|javascript/.test(mime) ? 8 * 1024 * 1024 : 2000000)) {
      await reader.cancel();
      break;
    }
  }
  html += decoder.decode();
  return { html, url: u.href };
}
export function imageDimensions(bytes,mime) {
 if(mime==='image/png'&&bytes.length>=24)return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 if(mime==='image/jpeg') {let p=2;while(p+8<bytes.length){if(bytes[p++]!==255)continue;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===218||marker===217)break;if(marker===216||marker===1)continue;if(p+2>bytes.length)break;const size=bytes.readUInt16BE(p);if(size<2||p+size>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {width:bytes.readUInt16BE(p+5),height:bytes.readUInt16BE(p+3)};p+=size;}}
 if(mime==='image/webp'&&bytes.length>=30){const type=bytes.subarray(12,16).toString();if(type==='VP8X')return {width:bytes.readUIntLE(24,3)+1,height:bytes.readUIntLE(27,3)+1};if(type==='VP8 ')return {width:bytes.readUInt16LE(26)&16383,height:bytes.readUInt16LE(28)&16383};if(type==='VP8L'){const bits=bytes.readUInt32LE(21);return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}}
 if(mime==='image/avif'){const p=bytes.indexOf(Buffer.from('ispe'));if(p>=0&&p+16<=bytes.length)return {width:bytes.readUInt32BE(p+8),height:bytes.readUInt32BE(p+12)};}
 return null;
}
export async function getImage(value, fetcher, redirects = 0) {
  const u = await publicURL(value, fetcher);
  const r = await fetcher(u, { signal: AbortSignal.timeout(9000), redirect: "manual", headers: { accept: "image/avif,image/webp,image/*", "user-agent": "Mozilla/5.0" } });
  if (r.status >= 300 && r.status < 400 && redirects < 3)
    return getImage(new URL(r.headers.get("location"), u).href, fetcher, redirects + 1);
  const mime = r.headers.get("content-type")?.split(";")[0];
  if (!r.ok || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(mime)) throw Error("图片暂不可用");
  const reader = r.body.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > 8_000_000) { await reader.cancel(); throw Error("图片过大"); }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const magic = mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : mime === 'image/png' ? bytes.subarray(1, 4).toString() === 'PNG' : mime === 'image/webp' ? bytes.subarray(8, 12).toString() === 'WEBP' : bytes.subarray(4, 8).toString() === 'ftyp';
  if (!magic || bytes.length < 100) throw Error("图片内容无效");
  const dimensions=imageDimensions(bytes,mime);
  if(!dimensions||dimensions.width<350||dimensions.height<250)throw Error('图片分辨率不足或格式不可读取');
  return { bytes, mime, ...dimensions };
}
async function preview(item, fetcher) {
  try {
    if (new URL(item.url).hostname === "news.google.com") return;
    const { html, url } = await getPublic(item.url, fetcher);
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    const attrs = (s) =>
      Object.fromEntries(
        [...s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [
          m[1].toLowerCase(),
          m[2],
        ]),
      );
    const tag = tags
      .map(attrs)
      .find((a) => a.property === "og:image" || a.name === "og:image");
    if (tag?.content) {
      item.image = safeURL(
        new URL(tag.content.replace(/&amp;/g, "&"), url).href,
      );
      item.imageKind = item.image ? "page-preview" : "none";
    }
    item.pageFetched = true;
  } catch {
    item.pageFetched = false;
  }
}
export async function runSearch(input, fetcher = fetch) {
  const channels = [], merged = [];
  const requests = searchPlan(input).flatMap(entry => entry.providers.map(provider => ({ ...entry, provider })));
  async function collect(entry) {
    const { query, provider, domains, label } = entry;
    const u = new URL(provider === "Google News" ? "https://news.google.com/rss/search" : "https://www.bing.com/search");
    u.searchParams.set("q", query);
    if (provider === "Google News") {
      u.searchParams.set("hl", "en-US"); u.searchParams.set("gl", "US"); u.searchParams.set("ceid", "US:en");
    } else u.searchParams.set("format", "rss");
    try {
      const response = await fetcher(u, { signal: AbortSignal.timeout(10000), headers: { accept: "application/rss+xml" } });
      if (!response.ok) throw Error();
      const items = parseRSS(await response.text(), { ...input, domains });
      channels.push({ provider, query, label, status: items.length ? "ready" : "empty", count: items.length });
      merged.push(...items);
    } catch { channels.push({ provider, query, label, status: "error", count: 0 }); }
  }
  for (let index = 0; index < requests.length; index += 3)
    await Promise.all(requests.slice(index, index + 3).map(collect));
  if (!channels.some(channel => channel.status !== "error")) throw Error("所有检索渠道暂时不可用，请稍后重试。");
  const limit = [24, 48, 72][input.sourceScope] || 24;
  const items = [...new Map(merged.map(item => [item.url, item])).values()]
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
    .slice(0, limit);
  for (let index = 0; index < items.length; index += 4)
    await Promise.all(items.slice(index, index + 4).map(item => preview(item, fetcher)));
  return { items, channels };
}
export function createApp({
  dataDir = resolve(here, ".data"),
  fetcher = fetch,
  users = null,
  guestPreview = false,
  photoSearch = true,
  cookiePath = "/",
  secureCookie = false,
  persistentSessions = false,
  searchTimeoutMs = 90_000,
  planSources = async () => null,
} = {}) {
  const sessions = new Map();
  const stores = new Map();
  const queues = new Map();
  const jobs = new Map();
  const traces = new Map();
  let server;
  const file = (account) => resolve(dataDir, account + ".json");
  const sessionFile = sid => resolve(dataDir, 'sessions', createHash('sha256').update(sid).digest('hex') + '.json');
  async function saveSession(sid, value) {
    if (!persistentSessions) return;
    await mkdir(resolve(dataDir, 'sessions'), { recursive: true, mode: 0o700 });
    await writeFile(sessionFile(sid), JSON.stringify(value), { mode: 0o600 });
  }
  const sessionCookie = (sid, age = 31536000) => `shoe_session=${sid}; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=${age}${secureCookie ? '; Secure' : ''}`;
  const assetFile = sha => resolve(dataDir, 'assets', sha);
  async function saveAsset(sha, asset) {
    await mkdir(resolve(dataDir, 'assets'), { recursive: true, mode: 0o700 });
    await writeFile(assetFile(sha), asset.bytes, { mode: 0o600 });
  }
  async function validateEvidence(task, items) {
    const documents = new Map();
    const evidenceFetcher = publicFetch(fetcher);
    const readEvidence = async url => {
      if (!documents.has(url)) documents.set(url, getPublic(url, evidenceFetcher, 0, true).then(doc => {
        try { doc.parsed = JSON.parse(doc.html); } catch {}
        return doc;
      }));
      return documents.get(url);
    };
    for (const item of items) {
      if (!item.imageSha256 || !item.sourceImageMatched || item.imageUnavailable || task.items.find(i => i.id === item.id)?.imageUnavailable) throw Error('有图片不可用或尚未建立来源对应关系，请重新检索并核查。');
      const bytes = await readFile(assetFile(item.imageSha256)).catch(() => { throw Error('图片缓存失效，请重新检索并核查。'); });
      if (createHash('sha256').update(bytes).digest('hex') !== item.imageSha256) throw Error('图片缓存已变化，请重新检索。');
      const document = item.evidenceURL ? await readEvidence(item.evidenceURL) : await getPublic(item.url, fetcher);
      const valid = (doc, proofURL) => doc.url === proofURL && imageDeclared(doc.html, item.image) &&
        sourceProductMatches(doc.html, item.url, { ...item, evidenceURL: item.evidenceURL ? proofURL : undefined }, item.searchIntent || task.input.subject, doc.parsed);
      if (!valid(document, item.evidenceURL || item.url)) {
        // A paginated catalogue can move an existing product to another page.
        const fallbackURL = item.url.replace(/\/$/, '') + '.js';
        if (item.evidenceKind !== 'public-product-catalogue' || !valid(await readEvidence(fallbackURL), fallbackURL))
          throw Error('原始来源或图片对应关系已变化，请重新检索并核查。');
      }
    }
  }
  async function load(account) {
    if (stores.has(account)) return stores.get(account);
    try {
      const v = JSON.parse(await readFile(file(account), "utf8"));
      let interrupted = false;
      for (const task of v.tasks || [])
        if (task.status === "running") {
          interrupted = true;
          task.status = "error";
          task.message = "上次检索因服务重启而中断，请重试。";
          const run = task.debugRuns?.at(-1);
          if (run?.status === 'running') {
            try { await interruptSearchTrace(dataDir, account, task.id, run); }
            catch (error) { run.storageError = sanitizeTrace(errorDetails(error)); }
          }
        }
      stores.set(account, v);
      if (interrupted) await save(account);
      return v;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const v = { tasks: [] };
      stores.set(account, v);
      return v;
    }
  }
  async function save(account) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const body = JSON.stringify(await load(account));
    const next = (queues.get(account) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await writeFile(file(account) + ".tmp", body, { mode: 0o600 });
        await rename(file(account) + ".tmp", file(account));
      });
    queues.set(account, next);
    await next;
  }
  function prepareSearch(task) {
    const now = new Date().toISOString();
    const priorQueue = task.sourceQueue && Array.isArray(task.sourceQueue.records) ? task.sourceQueue : null;
    task.status = 'running';
    task.message = '';
    task.channels = [];
    task.updatedAt = now;
    task.debugRuns ||= [];
    task.debugRuns.push({ id: randomBytes(12).toString('hex'), startedAt: now, status: 'running', version: SEARCH_VERSION });
    const priorProgress = priorQueue ? {
      plannedSources: priorQueue.plannedSources || 0,
      queriedSources: priorQueue.queriedSources || 0,
      matchedSources: priorQueue.matchedSources || 0,
      failedSources: priorQueue.failedSources || 0,
      pendingSources: priorQueue.pendingSources || 0,
    } : {};
    task.progress = { stage: 'discover', startedAt: now, deadlineAt: new Date(Date.now() + searchTimeoutMs).toISOString(),
      channelsDone: 0, totalChannels: 0, candidates: 0, checked: 0, accepted: 0, ...priorProgress };
  }
  function noResultsMessage(task) {
    const rejected = task.channels.reduce((all, channel) => {
      for (const [reason, count] of Object.entries(channel.rejected || {})) all[reason] = (all[reason] || 0) + count;
      return all;
    }, {});
    const notes = [];
    const failures = task.channels.filter(c => c.status === 'error');
    const discovered = task.channels.reduce((n, c) => n + (c.discovered || 0), 0);
    const matched = task.channels.reduce((n, c) => n + (c.intentMatched || 0), 0);
    if (failures.length) notes.push(`${failures.length} 个检索渠道失败，请展开渠道记录查看原因`);
    if (discovered && !matched) notes.push(`找到 ${discovered} 个候选，全部在来源或相关性筛选阶段被排除`);
    if (matched) notes.push(`初筛保留 ${matched} 个候选，已完成 ${task.progress?.checked || 0} 个原网页及图片核对，未有通过结果`);
    if (rejected.productEvidenceMissing) notes.push(`${rejected.productEvidenceMissing} 条未提取到当前商品图片证据`);
    if (rejected.sourceIntentMismatch) notes.push(`${rejected.sourceIntentMismatch} 条商品信息未满足检索条件`);
    if (rejected.ambiguousProductPage) notes.push(`${rejected.ambiguousProductPage} 条页面包含多个商品，未自动选图`);
    if (rejected.dateUnconfirmed) notes.push(`${rejected.dateUnconfirmed} 条未能确认发布日期`);
    if (rejected.outsideDateRange) notes.push(`${rejected.outsideDateRange} 条超出近 ${task.input.days} 天`);
    if (rejected.sourceUnavailable) notes.push(`${rejected.sourceUnavailable} 条原页面暂时无法读取`);
    if (rejected.imageSourceMismatch || rejected.imageUnavailable) notes.push(`${(rejected.imageSourceMismatch || 0) + (rejected.imageUnavailable || 0)} 条图片未通过核对`);
    return '未找到符合当前条件的结果。' + (notes.length ? notes.join('；') + '。' : '') +
      (task.input.days ? '可调整时间范围后重试；本次未放宽日期要求。' : '可重试本任务，并在搜索调试记录中查看具体原因。');
  }
  async function start(account, task, { fresh = false } = {}) {
    const key = account + task.id;
    if (jobs.has(key)) throw Error("任务正在检索，请稍候。");
    const controller = new AbortController();
    const run = task.debugRuns.at(-1);
    const debug = createSearchTrace({ dataDir, account, taskId: task.id, run });
    const trace = debug.emit;
    traces.set(run.id, debug);
    trace('run.started', { input: task.input, version: SEARCH_VERSION, fresh, previousRunId: task.debugRuns.at(-2)?.id,
      searchTimeoutMs, photoSearch, searchProvider: deepseekSearchReady(fetcher) ? 'deepseek' : 'legacy',
      existingResultCount: task.items.length, captureLimits: run.captureLimits });
    const recordedFetcher = debug.wrapFetcher(fetcher);
    let timeout = setTimeout(() => controller.abort(new DOMException('检索超时', 'TimeoutError')), searchTimeoutMs);
    const clearMainTimer = () => { if (timeout) { clearTimeout(timeout); timeout = null; } };
    const jobFetcher = (url, options = {}) => abortable(() => recordedFetcher(url, { ...options,
      signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal }), controller.signal);
    jobFetcher.trustedRelayHosts = fetcher.trustedRelayHosts;
    jobFetcher.deepseekRelay = fetcher.deepseekRelay;
    const tracedRead = (reader, kind) => async (url, f) => {
      const started = Date.now();
      trace('document.started', { kind, url });
      try {
        const page = await reader(url, f);
        debug.document(kind, url, page, Date.now() - started);
        return page;
      } catch (error) {
        trace('document.failed', { kind, url, durationMs: Date.now() - started, error: errorDetails(error) });
        throw error;
      }
    };
    const readPage = tracedRead(getPublic, 'page');
    const readDocument = tracedRead((url, f) => getPublic(url, f, 0, true), 'source-document');
    let measureVisuals = false;
    const readImage = async (url, f) => {
      const started = Date.now();
      try {
        const asset = await getImage(url, f);
        if (measureVisuals) asset.imageFingerprint = await imageFingerprint(asset.bytes);
        trace('image.read', { url, durationMs: Date.now() - started, bytes: asset.bytes.length,
          mime: asset.mime, width: asset.width, height: asset.height, sha256: createHash('sha256').update(asset.bytes).digest('hex') });
        return asset;
      } catch (error) {
        trace('image.failed', { url, durationMs: Date.now() - started, error: errorDetails(error) });
        throw error;
      }
    };
    const limitPageRead = createPageReadLimiter();
    const old = new Map(task.items.map(x => [x.url + ':' + x.imageSha256, x]));
    const retainReview = items => items.map(x => {
      const previous = old.get(x.url + ':' + x.imageSha256);
      return previous ? { ...x, id: previous.id, review: previous.review, selected: previous.selected, note: previous.note, reviewedAt: previous.reviewedAt } : x;
    });
    const itemByHash = new Map(task.items.map(item => [item.imageSha256, item]));
    const mergeItems = incoming => {
      let added = false;
      for (const x of incoming) {
        if (!x || !x.imageSha256 || itemByHash.has(x.imageSha256)) continue;
        itemByHash.set(x.imageSha256, x);
        task.items.push(x);
        added = true;
      }
      if (!added) return;
      task.items.sort((a, b) => {
        const da = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
        const db = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
        if (Number.isFinite(da) && Number.isFinite(db)) return db - da;
        if (Number.isFinite(da)) return -1;
        if (Number.isFinite(db)) return 1;
        return 0;
      });
    };
    let progressSaveTimer = null, progressSaveError = null, progressSaveInFlight = null, progressDirty = false;
    const runProgressSave = async () => {
      if (progressSaveInFlight) {
        progressDirty = true;
        return progressSaveInFlight;
      }
      do {
        progressDirty = false;
        progressSaveInFlight = save(account);
        try {
          await progressSaveInFlight;
        } catch (error) {
          progressSaveError = error;
          return;
        } finally {
          progressSaveInFlight = null;
        }
      } while (progressDirty);
    };
    const scheduleProgressSave = () => {
      progressDirty = true;
      if (!progressSaveTimer && !progressSaveInFlight) {
        progressSaveTimer = setTimeout(() => {
          progressSaveTimer = null;
          void runProgressSave();
        }, 50);
      }
      return Promise.resolve();
    };
    const flushProgress = async () => {
      if (progressSaveTimer) {
        clearTimeout(progressSaveTimer);
        progressSaveTimer = null;
      }
      progressDirty = true;
      if (progressSaveInFlight) await progressSaveInFlight;
      if (progressDirty) await runProgressSave();
      if (progressSaveError) throw progressSaveError;
    };
    let active = true;
    const job = (async () => {
      try {
        const onProgress = async ({ items, channels, ...progress }) => {
          if (!active || controller.signal.aborted) return;
          task.progress = { ...task.progress, ...progress };
          task.channels = channels;
          if (items.length) mergeItems(retainReview(items));
          task.updatedAt = new Date().toISOString();
          await scheduleProgressSave();
        };
        const plans = await abortable(async () => await planSources(task.input) || searchPlan(task.input), controller.signal);
        trace('plan.created', { entries: plans.length, excludedDomains: plans.excludedDomains || [] });
        plans.forEach((entry, index) => trace('plan.entry', { index, entry }));
        const broadAgent = photoSearch && task.input.sourceScope === 2 && plans.some(p => p.deepseek);
        measureVisuals = broadAgent;
        if (broadAgent) {
          clearMainTimer();
          timeout = setTimeout(() => controller.abort(new DOMException('广泛检索超时', 'TimeoutError')), BROAD_TIMEOUT_MS);
          task.progress.deadlineAt = new Date(Date.now() + BROAD_TIMEOUT_MS).toISOString();
        }
        const broadScope = photoSearch && task.input.sourceScope === 2 && Array.isArray(plans) && !plans.some(p => p.deepseek) && plans.some(p => p.domains.length);
        if (broadScope) {
          clearMainTimer();
          const excludedDomains = plans.excludedDomains || [];
          const hadSourceQueue = Boolean(task.sourceQueue);
          const priorRecords = Array.isArray(task.sourceQueue?.records) ? task.sourceQueue.records : [];
          if (!hadSourceQueue) task.items = [];
          const resumeRecords = fresh ? [] : priorRecords.map(r => ({ ...r }));
          const entries = plans;
          const queueSignal = AbortSignal.any([controller.signal]);
          const queueTraceStates = new Map();
          const result = await runSourceQueue({
            entries,
            previous: resumeRecords,
            signal: queueSignal,
            concurrency: 3,
            entryTimeoutMs: 30000,
            retryFailed: true,
            previousReaderVersion: Number(task.sourceQueue?.readerVersion) || 1,
            runEntry: async (entry, { signal: entrySignal, onPartial, checkpoint }) => {
              trace('queue.entry.started', { entry, resumed: Boolean(checkpoint), checkpointProducts: checkpoint?.products?.length });
              const comboSignal = AbortSignal.any([entrySignal, controller.signal]);
              const entryFetcher = (url, options = {}) => abortable(() => recordedFetcher(url, { ...options,
                signal: options.signal ? AbortSignal.any([comboSignal, options.signal]) : comboSignal }), comboSignal);
              entryFetcher.trustedRelayHosts = fetcher.trustedRelayHosts;
              entryFetcher.deepseekRelay = fetcher.deepseekRelay;
              const entryPlans = [entry];
              entryPlans.excludedDomains = excludedDomains;
              const value = await searchPhotos({ ...task.input, sourceScope: 0, domains: [] }, {
                fetcher: entryFetcher,
                plans: entryPlans,
                readPage,
                readDocument,
                readImage,
                saveAsset,
                signal: comboSignal,
                resultLimit: entry.catalogResultLimit,
                checkpoint,
                incrementalProgress: true,
                limitPageRead,
                trace: (type, data) => trace(type, { queueDomains: entry.domains, queueLabel: entry.label, ...data }),
                onProgress: async (p) => { if (typeof onPartial === 'function') await onPartial(p); },
              });
              return value;
            },
            onPartial: async (value) => {
              if (!active || controller.signal.aborted) return;
              if (value && Array.isArray(value.items) && value.items.length) {
                mergeItems(retainReview(value.items));
                const storeChannel = { provider: '公开来源索引', query: '分批来源查询', count: task.items.length };
                task.channels = [storeChannel];
                task.updatedAt = new Date().toISOString();
                await scheduleProgressSave();
              }
            },
            onResult: async ({ entry, value, partial }) => {
              trace(partial ? 'queue.entry.progress' : 'queue.entry.completed', { domains: entry.domains, label: entry.label,
                channels: partial ? undefined : value?.channels, sourceChecks: partial ? undefined : value?.sourceChecks,
                stage: value?.stage, checked: value?.checked, itemCount: value?.items?.length,
                checkpoint: !partial && value?.checkpoint ? { complete: value.checkpoint.complete, next: value.checkpoint.next,
                  products: value.checkpoint.products?.length, discoveryFailures: value.checkpoint.discoveryFailures } : undefined });
              if (!active || controller.signal.aborted) return;
              if (value && Array.isArray(value.items) && value.items.length) {
                mergeItems(retainReview(value.items));
              }
              const storeChannel = { provider: '公开来源索引', query: '分批来源查询', count: task.items.length };
              task.channels = [storeChannel];
              task.updatedAt = new Date().toISOString();
              await scheduleProgressSave();
            },
            onUpdate: async (snapshot) => {
              if (!active || controller.signal.aborted) return;
              const records = Array.isArray(snapshot.records) ? snapshot.records : [];
              for (const record of records) {
                const state = record.status + ':' + (record.error || '');
                if (queueTraceStates.get(record.id) !== state) {
                  queueTraceStates.set(record.id, state);
                  trace('queue.entry.state', { id: record.id, label: record.label, domains: record.domains,
                    status: record.status, error: record.error, sourceChecks: record.sourceChecks, matchedDomains: record.matchedDomains });
                }
              }
              task.sourceQueue = {
                readerVersion: SOURCE_QUEUE_READER_VERSION,
                records: records.map(r => ({ ...r })),
                plannedSources: snapshot.plannedSources || 0,
                queriedSources: snapshot.queriedSources || 0,
                matchedSources: snapshot.matchedSources || 0,
                directoryMatchedSources: snapshot.matchedSources || 0,
                failedSources: snapshot.failedSources || 0,
                pendingSources: snapshot.pendingSources || 0,
                updatedAt: new Date().toISOString(),
              };
              task.progress = {
                ...task.progress,
                stage: 'source-queue',
                deadlineAt: null,
                plannedSources: snapshot.plannedSources || 0,
                queriedSources: snapshot.queriedSources || 0,
                matchedSources: countResultSources(task.items),
                directoryMatchedSources: snapshot.matchedSources || 0,
                failedSources: snapshot.failedSources || 0,
                pendingSources: snapshot.pendingSources || 0,
                accepted: task.items.length,
              };
              const storeChannel = { provider: '公开来源索引', query: '分批来源查询', count: task.items.length };
              task.channels = [storeChannel];
              task.updatedAt = new Date().toISOString();
              await scheduleProgressSave();
            },
          });
          const q = task.sourceQueue || {};
          const planned = q.plannedSources || plans.length;
          const queried = q.queriedSources || 0;
          const failed = q.failedSources || 0;
          const pending = q.pendingSources || 0;
          if (pending > 0) {
            task.status = task.items.length ? 'review' : 'error';
            task.message = `已完成 ${queried} 个来源查询（失败 ${failed} 个），仍有 ${pending} 个来源未完成；可稍后继续（记录已保存）。`;
          } else {
            task.status = 'review';
            const summary = `已完成 ${queried} / ${planned} 个来源查询，${failed} 个来源失败（失败不等于无结果）。`;
            if (!task.items.length) {
              task.message = noResultsMessage(task) + ' ' + summary;
            } else {
              task.message = summary;
            }
          }
          task.channels = [{ provider: '公开来源索引', query: '分批来源查询', count: task.items.length }];
        } else {
          const result = await abortable(() => photoSearch ? (broadAgent ? searchBroadPhotos : searchPhotos)(task.input, {
            fetcher: jobFetcher, plans, readPage, readDocument, readImage,
            saveAsset, signal: controller.signal, onProgress, trace,
          }) : runSearch(task.input, jobFetcher), controller.signal);
          task.items = retainReview(result.items);
          task.channels = result.channels;
          task.status = 'review';
          task.message = result.message || (task.items.length ? '' : noResultsMessage(task));
        }
      } catch (e) {
        trace('run.failed', { error: errorDetails(e), aborted: controller.signal.aborted,
          abortReason: controller.signal.aborted ? errorDetails(controller.signal.reason) : undefined });
        const timedOut = controller.signal.aborted;
        task.status = timedOut && task.progress.accepted ? 'review' : 'error';
        task.message = timedOut
          ? `本次检索已达到 ${Math.ceil((task.input.sourceScope === 2 && deepseekSearchReady(fetcher) ? BROAD_TIMEOUT_MS : searchTimeoutMs) / 1000)} 秒时限。${task.progress.accepted ? `已保留 ${task.items.length} 条通过来源核对的结果，可继续核查或重新检索。` : '部分来源未响应，请重试或调整条件。'}`
          : (e && e.message) || '检索失败';
      } finally {
        active = false;
        clearMainTimer();
        task.progress = { ...task.progress, stage: task.status === 'error' ? 'error' : 'done', finishedAt: new Date().toISOString() };
        task.updatedAt = new Date().toISOString();
        await debug.finish({ status: controller.signal.aborted ? 'timed-out' : task.status,
          resultCount: task.items.length, message: task.message, progress: task.progress, channels: task.channels,
          resultEvidence: task.items.map(i => ({ id: i.id, url: i.url, image: i.image, title: i.title, sha256: i.imageSha256 })) });
        try { await flushProgress(); }
        catch (error) { task.status = 'error'; task.message = '任务结果保存失败，请稍后重试。'; run.taskSaveError = sanitizeTrace(errorDetails(error)); }
        traces.delete(run.id);
        jobs.delete(key);
      }
    })();
    jobs.set(key, job);
  }
  async function body(req) {
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 100000) throw Error("内容过长。");
    }
    return JSON.parse(data || "{}");
  }
  server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      if (
        u.pathname.startsWith("/api/") &&
        req.method !== "GET" &&
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return json(res, 403, { error: "请求来源无效。" });
      let sid = (req.headers.cookie || "").match(
        /(?:^|;\s*)shoe_session=([^;]+)/,
      )?.[1];
      if (!/^[a-f0-9]{48}$/.test(sid || '')) sid = undefined;
      let session = sessions.get(sid);
      if (!session && sid && persistentSessions) {
        try { session = JSON.parse(await readFile(sessionFile(sid), 'utf8')); sessions.set(sid, session); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      if (session && session.expires < Date.now()) {
        sessions.delete(sid);
        session = null;
      }
      if (u.pathname === "/api/session" && req.method === "GET") {
        if (guestPreview && !session) {
          sid = randomBytes(24).toString("hex");
          session = {
            account: "guest-" + randomBytes(12).toString("hex"),
            expires: Date.now() + (persistentSessions ? 31536000000 : 86400000),
          };
          sessions.set(sid, session);
          await saveSession(sid, session);
          res.setHeader(
            "set-cookie",
            sessionCookie(sid),
          );
        }
        return json(res, 200, {
          account: session?.account || null,
          demo: !users,
          guest: guestPreview,
          sourceCatalog,
        });
      }
      if (u.pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true, version: SEARCH_VERSION, storage: "persistent-files", searchProvider: deepseekSearchReady(fetcher) ? 'deepseek' : 'legacy', deepseekConfigured: deepseekSearchReady(fetcher) });
      if (u.pathname === "/api/login" && req.method === "POST") {
        if (guestPreview)
          return json(res, 405, { error: "此预览直接进入，无需登录。" });
        const b = await body(req);
        const account = String(b.account || "");
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(account))
          return json(res, 400, { error: "账号格式无效。" });
        if (users) {
          const expected = Buffer.from(String(users[account] || "")),
            actual = Buffer.from(String(b.password || ""));
          if (
            !expected.length ||
            expected.length !== actual.length ||
            !timingSafeEqual(expected, actual)
          )
            return json(res, 401, { error: "账号或密码不正确。" });
        } else if (!["demo-a", "demo-b"].includes(account))
          return json(res, 401, { error: "请选择体验账号。" });
        sid = randomBytes(24).toString("hex");
        sessions.set(sid, { account, expires: Date.now() + 86400000 });
        res.setHeader(
          "set-cookie",
          sessionCookie(sid),
        );
        return json(res, 200, { account });
      }
      if (u.pathname === "/api/logout" && req.method === "POST") {
        sessions.delete(sid);
        if (persistentSessions && sid) await unlink(sessionFile(sid)).catch(e => { if (e.code !== 'ENOENT') throw e; });
        res.setHeader(
          "set-cookie",
          sessionCookie("", 0),
        );
        return json(res, 200, { ok: true });
      }
      if (u.pathname.startsWith("/api/")) {
        if (!session) return json(res, 401, { error: "请先进入工作台。" });
        const account = session.account;
        const db = await load(account);
        const imageMatch = u.pathname.match(/^\/api\/images\/([a-f0-9]{64})$/);
        if (imageMatch && req.method === 'GET') {
          const item = db.tasks.flatMap(t => [...t.items, ...(t.delivery?.items || [])]).find(i => i.imageSha256 === imageMatch[1]);
          if (!item) return json(res, 404, { error: '图片不存在。' });
          try {
            const bytes = await readFile(assetFile(imageMatch[1]));
            res.writeHead(200, { 'content-type': item.imageMime, 'cache-control': 'private, max-age=3600' });
            return res.end(bytes);
          } catch { return json(res, 404, { error: '图片缓存失效，请重新检索。' }); }
        }
        if (u.pathname === "/api/tasks" && req.method === "GET")
          return json(res, 200, { tasks: db.tasks });
        if (u.pathname === "/api/tasks" && req.method === "POST") {
          const input = normalizeInput(await body(req));
          const task = {
            id: randomBytes(12).toString("hex"),
            input,
            status: "running",
            items: [],
            channels: [],
            message: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            delivery: null,
          };
          prepareSearch(task);
          db.tasks.unshift(task);
          await save(account);
          json(res, 201, { task });
          void start(account, task, { fresh: false });
          return;
        }
        if (!guestPreview && u.pathname === "/api/sample" && req.method === "POST") {
          const sample = JSON.parse(
            await readFile(resolve(here, "sample.json"), "utf8"),
          );
          const now = new Date().toISOString();
          const task = {
            id: randomBytes(12).toString("hex"),
            input: {
              subject: "Miu Miu 鞋履参考",
              days: 0,
              domains: ["miumiu.com"],
            },
            sample: true,
            status: "review",
            createdAt: now,
            updatedAt: now,
            channels: [],
            message: "历史素材示例，用于体验核查与交付；不代表本次实时检索。",
            delivery: null,
            items: sample.items.map((x) => ({
              id: randomBytes(8).toString("hex"),
              title: x.title,
              url: x.source,
              source: "Miu Miu",
              image: safeURL(x.image),
              imageKind: "historical-sample",
              summary: x.description,
              publishedAt: x.published_at || null,
              collectedAt: x.first_seen || now,
              review: "pending",
              selected: false,
              note: "",
            })),
          };
          db.tasks.unshift(task);
          await save(account);
          return json(res, 201, { task });
        }
        const m = u.pathname.match(
          /^\/api\/tasks\/([a-f0-9]+)(?:\/(retry|review|deliver|reopen|export|image-error|debug))?$/,
        );
        const task = m && db.tasks.find((t) => t.id === m[1]);
        if (!task) return json(res, 404, { error: "未找到任务。" });
        if (req.method === 'GET' && m[2] === 'debug') {
          const run = u.searchParams.has('run') ? task.debugRuns?.find(r => r.id === u.searchParams.get('run')) : task.debugRuns?.at(-1);
          if (!run) return json(res, 404, { error: '这次执行没有详细日志；新建或重试任务后开始记录。' });
          await traces.get(run.id)?.flush();
          let content;
          try { content = await readSearchTrace(dataDir, account, task.id, run); }
          catch (error) { if (error.code !== 'ENOENT') throw error; return json(res, 404, { error: '调试日志未能写入，请检查任务的日志保存错误。', run }); }
          const snapshot = JSON.stringify({ type: 'export.snapshot', at: new Date().toISOString(), taskId: task.id, runId: run.id, data: sanitizeTrace(run) }) + '\n';
          res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8',
            'content-disposition': `attachment; filename="search-${task.id}-${run.id}.jsonl"`, 'cache-control': 'private, no-store' });
          return res.end(content + snapshot);
        }
        if (req.method === 'GET' && m[2] === 'export') {
          if (!task.delivery) return json(res, 409, { error: '请先生成交付结果。' });
          await validateEvidence(task, task.delivery.items);
          const assets = await Promise.all(task.delivery.items.map(i => readFile(assetFile(i.imageSha256))));
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': 'attachment; filename="shoe-reference-images.html"', 'cache-control': 'no-store' });
          return res.end(exportHTML(task, assets));
        }
        if (req.method === "GET") return json(res, 200, { task });
        if (req.method !== "POST")
          return json(res, 405, { error: "不支持的操作。" });
        if (task.status === "running" && !(task.sourceQueue && ["review", "image-error"].includes(m[2])))
          return json(res, 409, { error: "任务正在执行，请稍候。" });
        if (m[2] === 'image-error') {
          const b = await body(req), item = task.items.find(i => i.id === b.id);
          if (!item) return json(res, 404, { error: '未找到图片。' });
          item.imageUnavailable = true;
          item.selected = false;
          item.review = 'uncertain';
          await save(account);
          return json(res, 200, { task });
        }
        if (m[2] === "retry") {
          if (task.delivery)
            return json(res, 409, { error: "请先重新打开交付。" });
          const fresh = task.status === "review";
          prepareSearch(task);
          await save(account);
          json(res, 200, { task });
          void start(account, task, { fresh });
          return;
        }
        if (m[2] === "review") {
          if (task.delivery)
            return json(res, 409, { error: "请先重新打开交付再修改。" });
          const b = await body(req);
          const item = task.items.find((i) => i.id === b.id);
          if (!item) return json(res, 404, { error: "未找到结果。" });
          if (
            !["pending", "verified", "uncertain", "excluded"].includes(
              b.review,
            ) ||
            typeof b.selected !== "boolean" ||
            typeof b.note !== "string" ||
            b.note.length > 2000
          )
            return json(res, 400, { error: "核查内容无效。" });
          if (b.review === "verified" && !b.note.trim())
            return json(res, 400, {
              error: "请记录核查依据，例如原文中的款式或日期信息。",
            });
          if (b.selected && b.review !== "verified")
            return json(res, 400, { error: "请核查通过后再选入交付。" });
          if (b.selected && item.imageUnavailable)
            return json(res, 400, { error: '图片加载失败，请重新检索后再选入。' });
          Object.assign(item, {
            review: b.review,
            selected: b.selected,
            note: b.note.trim(),
            reviewedAt: new Date().toISOString(),
          });
        } else if (m[2] === "deliver") {
          if (task.delivery)
            return json(res, 409, { error: "本任务已形成交付。" });
          const selected = task.items.filter(
            (i) => i.selected && i.review === "verified",
          );
          if (!selected.length)
            return json(res, 400, { error: "请先核查并选入至少一条结果。" });
          if (!task.sample && photoSearch) await validateEvidence(task, selected);
          task.delivery = {
            createdAt: new Date().toISOString(),
            items: structuredClone(selected),
          };
          task.status = "delivered";
        } else if (m[2] === "reopen") {
          task.delivery = null;
          task.status = "review";
        } else return json(res, 404, { error: "未找到操作。" });
        task.updatedAt = new Date().toISOString();
        await save(account);
        return json(res, 200, { task });
      }
      const path = u.pathname === "/" ? "/index.html" : u.pathname;
      const f = resolve(here, "public", "." + path);
      if (!f.startsWith(resolve(here, "public") + "/")) {
        res.writeHead(403);
        return res.end();
      }
      try {
        const bytes = await readFile(f);
        res.writeHead(200, {
          "content-type":
            {
              ".html": "text/html; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".webp": "image/webp",
              ".png": "image/png",
              ".svg": "image/svg+xml",
            }[extname(f)] || "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(bytes);
      } catch {
        res.writeHead(404);
        res.end("未找到页面");
      }
    } catch (e) {
      json(res, 400, {
        error: e.code
          ? "保存或读取失败，请重试。"
          : e.message || "操作失败，请重试。",
      });
    }
  });
  return { server, jobs, handle: server.listeners("request")[0] };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let users = null;
  if (process.env.SHOE_TASK_USERS) {
    users = JSON.parse(process.env.SHOE_TASK_USERS);
    if (
      !users ||
      typeof users !== "object" ||
      Array.isArray(users) ||
      !Object.keys(users).length
    )
      throw Error("账号配置无效");
  }
  const app = createApp({ users });
  app.server.listen(
    Number(process.env.SHOE_TASK_PORT || 4176),
    "127.0.0.1",
    () =>
      console.log(
        "女鞋检索工作台：http://127.0.0.1:" + app.server.address().port,
      ),
  );
}
