import { articleProductPhotos } from './article-products.mjs';
export async function readSourcePhotos({sources,readDocument,readPage,isRelevant,isDiscoveryRelevant=isRelevant,signal}) {
  const results = [];
  const checks = [];
  if (signal && signal.aborted) throw signal.reason;
  const normHost = (h) => h.toLowerCase().replace(/^www\./,'');
  const hostOf = (u) => { try { return normHost(new URL(u).hostname); } catch { return ''; } };
  const sameDomain = (u, domain) => {
    const h = hostOf(u);
    const d = normHost(domain);
    return h === d || h.endsWith('.' + d);
  };
  const decode = (s) => {
    if (s == null) return '';
    return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
      .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/gi,"'")
      .replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'');
  };
  const stripTags = (s) => decode(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const pickFeed = (src) => {
    const feeds = Array.isArray(src.feedUrls) ? src.feedUrls : [];
    const f = feeds.find(u => typeof u === 'string' && !/\/comments\//i.test(u));
    return f || src.url || `https://${src.domain}/`;
  };
  const getText = (doc) => {
    if (typeof doc === 'string') return doc;
    if (doc && typeof doc.html === 'string') return doc.html;
    return '';
  };
  const now = Date.now();
  const validDate = (raw) => {
    if (!raw) return undefined;
    const t = Date.parse(decode(raw).trim());
    if (!Number.isFinite(t) || t > now) return undefined;
    return new Date(t).toISOString();
  };
  const mapLimit = async (arr, limit, fn) => {
    const out = new Array(arr.length);
    let i = 0;
    const workers = Array.from({length: Math.min(limit, arr.length)}, async () => {
      while (true) {
        const idx = i++;
        if (idx >= arr.length) return;
        if (signal && signal.aborted) throw signal.reason;
        out[idx] = await fn(arr[idx], idx);
      }
    });
    await Promise.all(workers);
    return out;
  };

  const parseFeed = (xml, feedURL, domain) => {
    const items = [];
    const blocks = [];
    const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRe.exec(xml))) blocks.push({body: m[1], type: 'rss'});
    const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xml))) blocks.push({body: m[1], type: 'atom'});
    for (const {body, type} of blocks) {
      const tMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
      const title = tMatch ? stripTags(tMatch[1]) : '';
      if (!title || !isDiscoveryRelevant(title)) continue;
      let link = '';
      if (type === 'rss') {
        const lMatch = body.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
        if (lMatch) link = decode(lMatch[1]).trim();
      } else {
        const linkRe = /<link\b([^>]*)\/?>/gi;
        let lm;
        while ((lm = linkRe.exec(body))) {
          const attrs = lm[1];
          const rel = (attrs.match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
          const href = (attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
          if (href && (!rel || /alternate/i.test(rel))) { link = decode(href).trim(); break; }
        }
      }
      if (!link) {
        const g = body.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
        if (g) link = decode(g[1]).trim();
      }
      if (!/^https?:\/\//i.test(link)) continue;
      if (!sameDomain(link, domain)) continue;
      if (new URL(link).pathname === '/' || new URL(link).pathname === '') continue;
      const pub = body.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i) ||
                  body.match(/<published\b[^>]*>([\s\S]*?)<\/published>/i);
      const publishedAt = pub ? validDate(pub[1]) : undefined;
      items.push({title, url: link, publishedAt, sourceDocument: feedURL});
    }
    return items;
  };

  const parseHtml = (html, pageURL, sourceURL, domain) => {
    const out = [];
    const seen = new Set();
    const push = (title, url, publishedAt) => {
      if (out.length >= 12) return;
      if (!title || !url) return;
      if (!/^https?:\/\//i.test(url)) return;
      if (!sameDomain(url, domain)) return;
      try {
        const u = new URL(url);
        if (u.pathname === '/' || u.pathname === '') return;
      } catch { return; }
      if (!isDiscoveryRelevant(title)) return;
      const key = url;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({title, url, publishedAt, sourceDocument: sourceURL});
    };
    const scriptRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = scriptRe.exec(html))) {
      let data;
      try { data = JSON.parse(decode(m[1]).trim()); } catch { continue; }
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const t = node['@type'];
        const types = Array.isArray(t) ? t : (t ? [t] : []);
        const isA = types.some(x => /Article|NewsArticle|Product/i.test(String(x)));
        if (isA) {
          const headline = node.headline || node.name;
          const url = node.url || (node.mainEntityOfPage && (node.mainEntityOfPage['@id'] || node.mainEntityOfPage.url));
          if (headline && url) {
            let abs;
            try { abs = new URL(url, pageURL).href; } catch { abs = null; }
            if (abs) push(stripTags(String(headline)), abs);
          }
        }
        if (node['@graph']) walk(node['@graph']);
        if (node.itemListElement) walk(node.itemListElement);
        if (node.mainEntity) walk(node.mainEntity);
        if (node.item) walk(node.item);
      };
      walk(data);
    }
    // Product/article structures take precedence over navigation anchors such
    // as gender and category menus, which otherwise consume the small candidate budget.
    const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    while ((m = aRe.exec(html))) {
      const attrs = m[1];
      const href = (attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!href) continue;
      const title = stripTags(m[2]);
      if (!title) continue;
      let abs;
      try { abs = new URL(href, pageURL).href; } catch { continue; }
      if (!/^https?:\/\//i.test(abs)) continue;
      push(title, abs);
    }
    return out;
  };

  const extractPage = (html, pageURL) => {
    const actualTitleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const actualTitle = actualTitleMatch ? stripTags(actualTitleMatch[1]) : '';
    let image;
    const metaRe = /<meta\b([^>]*)\/?>/gi;
    let m;
    while ((m = metaRe.exec(html))) {
      const attrs = m[1];
      const prop = (attrs.match(/\bproperty\s*=\s*["']([^"']+)["']/i) || [])[1];
      const name = (attrs.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1];
      const content = (attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
      const key = (prop || name || '').toLowerCase();
      if (key === 'og:image' || key === 'twitter:image') {
        if (content) {
          try { image = new URL(decode(content).trim(), pageURL).href; } catch { image = undefined; }
          if (image) break;
        }
      }
    }
    return {actualTitle, image};
  };

  const processSource = async (src) => {
    const domain = src.domain;
    let sourceDoc = pickFeed(src);
    let firstDoc;
    let firstURL;
    let sourceError;
    try {
      firstDoc = await readDocument(sourceDoc);
      firstURL = (firstDoc && firstDoc.url) || sourceDoc;
      if (!(src.feedUrls || []).includes(sourceDoc) && !sameDomain(firstURL, domain)) throw Error('来源跳转至其他域名');
      if (/<title[^>]*>\s*(?:Just a moment|Attention Required|Access Denied|Robot Check)/i.test(getText(firstDoc))) throw Error('来源访问受限');
    } catch (e) {
      if (signal && signal.aborted) throw signal.reason;
      sourceError = e;
      firstDoc = null;
    }
    if (firstDoc) {
      const html = getText(firstDoc);
      if (html) {
        let items;
        if (/^\s*<\?xml|^\s*<rss|^\s*<feed\b/i.test(html) || /<item\b|<entry\b/i.test(html)) {
          items = parseFeed(html, firstURL, domain);
        } else {
          items = parseHtml(html, firstURL, firstURL, domain);
        }
        const distinct = [];
        const seen = new Set();
        for (const it of items) {
          if (seen.has(it.url)) continue;
          seen.add(it.url);
          distinct.push(it);
          if (distinct.length >= 6) break;
        }
        return {items: distinct, documentURL: firstURL, error: null};
      }
    }
    if (sourceError) {
      let homepage = src.url || `https://${domain}/`;
      if (homepage === sourceDoc) homepage = `https://${domain}/`;
      if (homepage !== sourceDoc) {
        try {
          const homeDoc = await readDocument(homepage);
          const homeURL = (homeDoc && homeDoc.url) || homepage;
          const html = getText(homeDoc);
          if(!sameDomain(homeURL,domain) || /<title[^>]*>\s*(?:Just a moment|Attention Required|Access Denied|Robot Check)/i.test(html)) throw Error('来源访问受限或跳转到其他域名');
          let items = html ? parseHtml(html, homeURL, homeURL, domain) : [];
          const distinct = [];
          const seen = new Set();
          for (const it of items) {
            if (seen.has(it.url)) continue;
            seen.add(it.url);
            distinct.push(it);
            if (distinct.length >= 6) break;
          }
          return {items: distinct, documentURL: homeURL, error: null};
        } catch (e2) {
          if (signal && signal.aborted) throw signal.reason;
          return {items: [], documentURL: null, error: e2};
        }
      }
      let homepage2 = src.url || sourceDoc;
      if (homepage2 !== sourceDoc) {
        try {
          const homeDoc = await readDocument(homepage2);
          const homeURL = (homeDoc && homeDoc.url) || homepage2;
          const html = getText(homeDoc);
          if(!sameDomain(homeURL,domain) || /<title[^>]*>\s*(?:Just a moment|Attention Required|Access Denied|Robot Check)/i.test(html)) throw Error('来源访问受限或跳转到其他域名');
          let items = html ? parseHtml(html, homeURL, homeURL, domain) : [];
          const distinct = [];
          const seen = new Set();
          for (const it of items) {
            if (seen.has(it.url)) continue;
            seen.add(it.url);
            distinct.push(it);
            if (distinct.length >= 6) break;
          }
          return {items: distinct, documentURL: homeURL, error: null};
        } catch (e2) {
          if (signal && signal.aborted) throw signal.reason;
          return {items: [], documentURL: null, error: e2};
        }
      }
      return {items: [], documentURL: null, error: sourceError};
    }
    let items2 = [];
    const distinct2 = [];
    return {items: distinct2, documentURL: null, error: new Error('empty feed')};
  };

  const settled = await Promise.allSettled(sources.map(s => (async () => {
    if (signal && signal.aborted) throw signal.reason;
    const domain = s.domain;
    const srcResult = await processSource(s);
    if (srcResult.error) {
      checks.push({domain, status: 'error', error: srcResult.error && srcResult.error.message ? srcResult.error.message : String(srcResult.error)});
      return;
    }
    checks.push({domain, status: 'queried'});
    if (!srcResult.items.length) return;
    const candidates = srcResult.items;
    const perCand = await mapLimit(candidates, 3, async (c) => {
      if (signal && signal.aborted) throw signal.reason;
      let page;
      try {
        page = await readPage(c.url);
      } catch (e) {
        if (signal && signal.aborted) throw signal.reason;
        return null;
      }
      if (!page) return null;
      const finalURL = (page.url) || c.url;
      const html = getText(page);
      if (!html) return null;
      if (!sameDomain(finalURL, s.domain)) return null;
      const {actualTitle, image} = extractPage(html, finalURL);
      const product = articleProductPhotos(html,finalURL,isRelevant)[0];
      if (!product && (!actualTitle || !image || !isRelevant(actualTitle))) return null;
      const item = {title: product?.title || actualTitle, url: finalURL, image:product?.image || image, sourceDocument: srcResult.documentURL || c.sourceDocument};
      if (c.publishedAt) item.publishedAt = c.publishedAt;
      if (!item.image) delete item.image;
      return item;
    });
    for (const r of perCand) if (r) results.push(r);
  })()));

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'rejected') {
      if (signal && signal.aborted) throw signal.reason;
      const domain = sources[i] && sources[i].domain;
      if (!checks.some(c => c.domain === domain)) {
        checks.push({domain, status: 'error', error: r.reason && r.reason.message ? r.reason.message : String(r.reason)});
      }
    }
  }

  return {results, checks};
}
