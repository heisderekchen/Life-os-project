const decode = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&')
  .replace(/&#38;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const field = (body, name) =>
  decode(body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim();
const normalizeHost = value => String(value || '').toLowerCase().replace(/^www\./, '');

function childSitemapRank(url, now) {
  const currentMonth = now.toISOString().slice(0, 7);
  const previous = new Date(now);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const previousMonth = previous.toISOString().slice(0, 7);
  if (url.includes(currentMonth)) return 0;
  if (url.includes(previousMonth)) return 1;
  if (/sitemap-news\.xml/i.test(url)) return 2;
  if (/sitemap-(?:article|post|content).*\.xml/i.test(url)) return 3;
  return 10;
}

export function sitemapChildURLs(xml, now = new Date()) {
  return [...String(xml || '').matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)]
    .map(match => field(match[1], 'loc'))
    .filter(value => /^https?:\/\//i.test(value))
    .sort((a, b) => childSitemapRank(a, now) - childSitemapRank(b, now))
    .slice(0, 3);
}

export function sitemapPageEntries(xml) {
  return [...String(xml || '').matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap(match => {
    const body = match[1];
    const url = field(body, 'loc');
    const lastModifiedAt = field(body, 'lastmod');
    const images = [...body.matchAll(/<image:loc\b[^>]*>([\s\S]*?)<\/image:loc>/gi)]
      .map(image => decode(image[1]).trim())
      .filter(image => /^https?:\/\//i.test(image));
    return url ? [{ url, lastModifiedAt, images }] : [];
  });
}

export async function recentSitemapCandidates({
  domain,
  readDocument,
  isRelevant,
  days,
  signal,
  now = new Date(),
  limit = 18,
}) {
  const origin = `https://${domain}`;
  const expectedHost = normalizeHost(domain);
  const index = await readDocument(`${origin}/sitemap.xml`);
  if (signal?.aborted) throw signal.reason;
  const indexXML = typeof index === 'string' ? index : index?.html || '';
  const children = sitemapChildURLs(indexXML, now)
    .filter(url => {
      try { return normalizeHost(new URL(url).hostname) === expectedHost; } catch { return false; }
    });
  if (!children.length) return [];
  const cutoff = days ? now.getTime() - days * 86400000 : 0;
  const futureLimit = now.getTime() + 86400000;
  const candidates = [];
  for (const child of children) {
    if (signal?.aborted) throw signal.reason;
    const document = await readDocument(child);
    const xml = typeof document === 'string' ? document : document?.html || '';
    for (const entry of sitemapPageEntries(xml)) {
      const timestamp = Date.parse(entry.lastModifiedAt);
      if (days && (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > futureLimit)) continue;
      let parsed;
      try { parsed = new URL(entry.url); } catch { continue; }
      if (normalizeHost(parsed.hostname) !== expectedHost) continue;
      const pathText = decodeURIComponent(parsed.pathname).replace(/[-_/]+/g, ' ');
      if (!isRelevant(pathText)) continue;
      const image = entry.images[0];
      if (!image) continue;
      candidates.push({
        title: pathText,
        url: parsed.href,
        image,
        lastModifiedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
        sourceDocument: child,
        provider: '结构化站点索引',
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}
