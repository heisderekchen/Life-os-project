// Public, server-rendered catalogue and PDP data; no private product API,
// account state, credentials, or browser session are used.
function nikePageData(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const body = value.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || value;
  try { return JSON.parse(body); } catch { return null; }
}

export function nikeCatalogPage(value) {
  const parsed = nikePageData(value);
  const wall = parsed?.props?.pageProps?.initialState?.Wall || parsed;
  if (!wall || !Array.isArray(wall.productGroupings)) return null;
  return {
    products: wall.productGroupings.flatMap(group => group.products || []),
    next: typeof (wall.pageData?.next || wall.pages?.next) === 'string'
      ? (wall.pageData?.next || wall.pages?.next)
      : '',
    totalResources: Number(wall.pageData?.totalResources || wall.pages?.totalResources) || 0,
  };
}

export function nikeCatalogPhotos(value, sourceURL) {
  const page = nikeCatalogPage(value);
  if (!page) return [];
  return page.products.flatMap(product => {
    const url = product.pdpUrl?.url;
    const image = product.colorwayImages?.portraitURL;
    try {
      if (product.productType !== 'FOOTWEAR' || new URL(url).hostname !== 'www.nike.com' || new URL(image).hostname !== 'static.nike.com') return [];
      return [{
        title: `Nike ${product.copy?.title || ''} ${product.copy?.subTitle || ''}`.trim(),
        url,
        canonicalURL: product.pdpUrl?.canonicalUrl || '',
        image,
        catalogURL: sourceURL,
        productCode: product.productCode,
      }];
    } catch { return []; }
  });
}

export function nikeCatalogNext(value) {
  const next = nikeCatalogPage(value)?.next || '';
  if (!next) return '';
  try {
    const url = new URL(next, 'https://api.nike.com');
    const expectedPath = /^\/discover\/product_wall\/v1\/marketplace\/[a-z]{2}\/language\/[a-z]{2}(?:\/consumerChannelId\/[a-f0-9-]{36})?\/?$/i;
    return url.protocol === 'https:' &&
      url.hostname === 'api.nike.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      expectedPath.test(url.pathname)
      ? url.href
      : '';
  } catch { return ''; }
}

function nikeImageURL(value) {
  const url = new URL(value);
  if (url.hostname !== 'static.nike.com') return value;
  const marker = '/a/images/t_default/';
  if (!url.pathname.startsWith(marker)) return value;
  url.pathname = '/a/images/t_web_pdp_936_v2/f_auto,' + url.pathname.slice(marker.length);
  return url.href;
}

export function nikeProductPhotos(value, pageURL = '', isRelevant = () => true) {
  const parsed = nikePageData(value);
  const product = parsed?.props?.pageProps?.selectedProduct;
  if (!product || product.productType !== 'FOOTWEAR' || !Array.isArray(product.contentImages)) return [];
  const title = product.productInfo?.fullTitle || product.productInfo?.title || product.productInfo?.subtitle ||
    `${product.productInfo?.brand || 'Nike'} ${product.productInfo?.name || product.groupLabel || product.title || ''}`.trim();
  if (!title || !isRelevant(title)) return [];
  const images = [];
  const seen = new Set();
  for (const card of product.contentImages) {
    const portrait = card?.properties?.portrait;
    const squarish = card?.properties?.squarish;
    const chosen = portrait?.url || squarish?.url;
    const id = portrait?.id || squarish?.id || '';
    if (!chosen || !id || seen.has(id)) continue;
    let image;
    try { image = nikeImageURL(chosen); } catch { continue; }
    seen.add(id);
    images.push({
      title,
      image,
      url: pageURL || product.pdpUrl?.url || '',
      canonicalURL: product.pdpUrl?.canonicalUrl || '',
      productCode: product.styleColor || product.displayStyle || '',
      imageId: id,
    });
  }
  return images;
}

const adidasTitle = html => {
  const raw = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return copyString(raw
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^阿迪达斯\s*[-–—]\s*/i, '')
    .replace(/\s*\|\s*adidas.*$/i, '')
    .trim());
};
const copyString = value => typeof value === 'string' ? Buffer.from(value, 'utf8').toString('utf8') : value;
const STATE_MISSING = Symbol('state-missing');

function stateClose(value, start, open, close) {
  let depth = 0, quote = '', escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === open) depth++;
    else if (char === close && --depth === 0) return index + 1;
  }
  return -1;
}

function stateSplit(value) {
  const parts = [];
  let start = 0, depth = 0, quote = '', escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function stateString(token) {
  const quote = token[0];
  if ((quote !== '"' && quote !== "'") || token.at(-1) !== quote) return STATE_MISSING;
  let out = '';
  for (let index = 1; index < token.length - 1; index++) {
    const char = token[index];
    if (char !== '\\') { out += char; continue; }
    const next = token[++index];
    if (next === undefined) return STATE_MISSING;
    if (next === 'u') {
      const hex = token.slice(index + 1, index + 5);
      if (!/^[a-f0-9]{4}$/i.test(hex)) return STATE_MISSING;
      out += String.fromCharCode(parseInt(hex, 16));
      index += 4;
    } else if (next === 'x') {
      const hex = token.slice(index + 1, index + 3);
      if (!/^[a-f0-9]{2}$/i.test(hex)) return STATE_MISSING;
      out += String.fromCharCode(parseInt(hex, 16));
      index += 2;
    } else out += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' })[next] || next;
  }
  return copyString(out);
}

function stateLiteral(token) {
  const value = String(token || '').trim();
  if (!value || value.length > 4096) return STATE_MISSING;
  if ((value[0] === '"' || value[0] === "'") && stateString(value) !== STATE_MISSING) return stateString(value);
  if (value === '!0' || value === 'true') return true;
  if (value === '!1' || value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d{1,6}(?:\.\d+)?$/.test(value)) return Number(value);
  const arraySize = value.match(/^Array\((\d{1,3})\)$/);
  if (arraySize) return Array.from({ length: Number(arraySize[1]) });
  if (value.startsWith('[') && value.endsWith(']')) {
    const values = [];
    for (const part of stateSplit(value.slice(1, -1))) {
      const parsed = stateLiteral(part);
      if (parsed === STATE_MISSING) return STATE_MISSING;
      values.push(parsed);
    }
    return values;
  }
  return STATE_MISSING;
}

function nuxtState(html) {
  const top = html.indexOf('window.__NUXT__=');
  const fn = top < 0 ? -1 : html.indexOf('(function(', top);
  if (fn < 0) return null;
  const paramsOpen = html.indexOf('(', fn + 1);
  const paramsEnd = stateClose(html, paramsOpen, '(', ')');
  if (paramsEnd < 0) return null;
  const paramsText = html.slice(paramsOpen + 1, paramsEnd - 1).trim();
  const params = paramsText ? stateSplit(paramsText).map(value => value.trim()) : [];
  if (params.some(name => !/^[A-Za-z_$][\w$]*$/.test(name))) return null;
  const bodyOpen = html.indexOf('{', paramsEnd);
  const bodyEnd = bodyOpen < 0 ? -1 : stateClose(html, bodyOpen, '{', '}');
  if (bodyEnd < 0) return null;
  const argsOpen = html.indexOf('(', bodyEnd);
  const argsEnd = argsOpen < 0 ? -1 : stateClose(html, argsOpen, '(', ')');
  if (argsEnd < 0) return null;
  const args = stateSplit(html.slice(argsOpen + 1, argsEnd - 1));
  if (params.length !== args.length) return null;
  return {
    bindings: new Map(params.map((name, index) => [name, args[index]])),
    body: html.slice(bodyOpen + 1, bodyEnd - 1),
  };
}

function stateExpressionEnd(value, start) {
  let depth = 0, quote = '', escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if ((char === ';' || char === ',') && depth === 0) return index;
  }
  return value.length;
}

function resolveStateExpression(expression, state, seen = new Set()) {
  const token = String(expression || '').trim();
  const literal = stateLiteral(token);
  if (literal !== STATE_MISSING) return literal;
  if (!/^[A-Za-z_$][\w$]*$/.test(token) || seen.has(token) || seen.size > 8) return STATE_MISSING;
  seen.add(token);
  const raw = state.bindings.get(token);
  const binding = raw === undefined ? STATE_MISSING : resolveStateExpression(raw, state, seen);
  const indexed = new Map();
  const assignment = new RegExp(`(?:^|[;,({])\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d{1,3})\\]\\s*=`, 'g');
  for (const match of state.body.matchAll(assignment)) {
    const index = match.index + match[0].length;
    const end = stateExpressionEnd(state.body, index);
    const value = resolveStateExpression(state.body.slice(index, end), state, new Set(seen));
    if (value !== STATE_MISSING) indexed.set(Number(match[1]), value);
  }
  if (indexed.size) {
    const result = Array.isArray(binding) ? [...binding] : [];
    for (const [index, value] of indexed) result[index] = value;
    return result;
  }
  return binding;
}

function adidasSerializedProduct(html, currentArticleId) {
  const state = nuxtState(html);
  if (!state) return null;
  const fieldsAt = [];
  for (let index = html.indexOf('productSSRData:{'); index >= 0 && fieldsAt.length < 4; index = html.indexOf('productSSRData:{', index + 1))
    fieldsAt.push(index);
  for (const at of fieldsAt) {
    const open = at + 'productSSRData:'.length;
    const end = stateClose(html, open, '{', '}');
    if (end < 0) continue;
    const fields = new Map();
    for (const part of stateSplit(html.slice(open + 1, end - 1))) {
      const match = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(part);
      if (match) fields.set(match[1], match[2]);
    }
    const value = name => fields.has(name) ? resolveStateExpression(fields.get(name), state) : STATE_MISSING;
    const articleId = value('articleId');
    const imageUrlList = value('imageUrlList');
    if (articleId !== currentArticleId || !Array.isArray(imageUrlList)) continue;
    return {
      articleId,
      title: value('articleName') !== STATE_MISSING ? value('articleName') : '',
      imageUrlList,
    };
  }
  return null;
}

function stateObjectArticles(expression, state) {
  let token = String(expression || '').trim().replace(/\\"/g, '"');
  if (/^[A-Za-z_$][\w$]*$/.test(token)) token = state.bindings.get(token) || '';
  token = token.trim().replace(/\\"/g, '"');
  if (token.startsWith('[')) {
    if (!token.endsWith(']')) return [];
    return stateSplit(token.slice(1, -1)).flatMap(part => stateObjectArticles(part, state));
  }
  if (!token.startsWith('{') || !token.endsWith('}')) return [];
  const fields = new Map();
  for (const field of stateSplit(token.slice(1, -1))) {
    const match = /^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]*)$/.exec(field);
    if (match) fields.set(match[1] || match[2], match[3]);
  }
  const out = [];
  const articleId = ['articleId', 'productID'].map(name => fields.has(name) ? resolveStateExpression(fields.get(name), state) : STATE_MISSING)
    .find(value => typeof value === 'string');
  const title = ['articleName', 'name'].map(name => fields.has(name) ? resolveStateExpression(fields.get(name), state) : STATE_MISSING)
    .find(value => typeof value === 'string') || '';
  if (articleId && title) out.push({ articleId, title });
  for (const name of ['@graph', 'itemListElement', 'item']) {
    if (fields.has(name)) out.push(...stateObjectArticles(fields.get(name), state));
  }
  return out;
}

function adidasFootwear(title) {
  return /\b(?:footwear|shoes?|sneakers?|trainers?|boots?|sandals?|slides?|loafers?)\b|鞋|靴/i.test(title);
}

function adidasArticleURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.adidas.com.cn' || url.username || url.password || url.port || url.hash) return null;
    if (url.pathname !== '/pdp' || !/^[a-z0-9-]{4,24}$/i.test(url.searchParams.get('articleId') || '')) return null;
    return url;
  } catch { return null; }
}

const adidasText = value => copyString(String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/gi, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim());

export function adidasCatalogPhotos(value, sourceURL) {
  const html = String(value || '');
  const out = [], seen = new Set();
  const push = article => {
    const url = adidasArticleURL(`https://www.adidas.com.cn/pdp?articleId=${encodeURIComponent(article.articleId)}`);
    const title = adidasText(article.title);
    if (!url || !title || !adidasFootwear(title) || seen.has(url.href)) return;
    seen.add(url.href);
    out.push({
      title,
      url: copyString(url.href),
      canonicalURL: copyString(url.href),
      catalogURL: copyString(sourceURL),
      productCode: copyString(url.searchParams.get('articleId')),
      productTypeEvidence: 'footwear',
    });
  };
  const sourceArticle = adidasArticleURL(sourceURL);
  if (sourceArticle) {
    const current = adidasSerializedProduct(html, sourceArticle.searchParams.get('articleId'));
    if (current) push(current);
  }
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/pdp\?articleId=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = adidasArticleURL(new URL(match[1], sourceURL).href);
    const alt = match[2].match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1];
    const title = adidasText(match[2]) || adidasText(alt);
    if (url) push({ articleId: url.searchParams.get('articleId'), title });
  }
  const state = nuxtState(html);
  if (state) {
    const productMarker = 'productSSRData:{';
    for (let index = html.indexOf(productMarker); index >= 0; index = html.indexOf(productMarker, index + 1)) {
      const open = index + productMarker.length - 1;
      const end = stateClose(html, open, '{', '}');
      if (end < 0) break;
      const fields = new Map();
      for (const part of stateSplit(html.slice(open + 1, end - 1))) {
        const match = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(part);
        if (match) fields.set(match[1], match[2]);
      }
      if (fields.has('aggregateArticleList'))
        for (const article of stateObjectArticles(fields.get('aggregateArticleList'), state)) push(article);
    }
    const listMarker = 'productList:{';
    for (let index = html.indexOf(listMarker); index >= 0; index = html.indexOf(listMarker, index + 1)) {
      const open = index + listMarker.length - 1;
      const end = stateClose(html, open, '{', '}');
      if (end < 0) break;
      const fields = new Map();
      for (const part of stateSplit(html.slice(open + 1, end - 1))) {
        const match = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(part);
        if (match) fields.set(match[1], match[2]);
      }
      if (fields.has('content'))
        for (const article of stateObjectArticles(fields.get('content'), state)) push(article);
    }
    const hyper = html.indexOf('hyperBoostArticleList:');
    if (hyper >= 0) {
      const start = html.indexOf('[', hyper);
      const end = start < 0 ? -1 : stateClose(html, start, '[', ']');
      if (end > start) {
        const block = html.slice(start, end);
        for (const article of stateObjectArticles(block, state)) push(article);
      }
    }
  }
  return out;
}

export function adidasCatalogPages(value, sourceURL) {
  const html = String(value || '');
  const pages = [], seen = new Set();
  const push = raw => {
    try {
      const url = new URL(raw, sourceURL);
      if (url.protocol !== 'https:' || url.hostname !== 'www.adidas.com.cn' || url.username || url.password || url.port || url.hash) return;
      if (url.pathname !== '/plp' && !url.pathname.startsWith('/plp/')) return;
      if (seen.has(url.href)) return;
      seen.add(url.href);
      pages.push(copyString(url.href));
    } catch {}
  };
  for (const match of html.matchAll(/href=["']([^"']*\/plp\/[^"']+)["']/gi)) {
    const raw = match[1].replace(/&amp;/g, '&');
    if (/\/(?:[^/?]*_)?(?:ftw|footwear|shoes)(?:[_/-]|$)/i.test(new URL(raw, sourceURL).pathname)) push(raw);
  }
  const state = nuxtState(html);
  if (!state) return pages;
  const listMarker = 'productList:{';
  const listAt = html.indexOf(listMarker);
  if (listAt >= 0) {
    const open = listAt + listMarker.length - 1;
    const end = stateClose(html, open, '{', '}');
    if (end > open) {
      const fields = new Map();
      for (const part of stateSplit(html.slice(open + 1, end - 1))) {
        const match = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(part);
        if (match) fields.set(match[1], match[2]);
      }
      const totalPages = fields.has('totalPages') ? resolveStateExpression(fields.get('totalPages'), state) : 0;
      try {
        const current = new URL(sourceURL);
        const page = Math.max(1, Number(current.searchParams.get('page')) || 1);
        if (Number.isInteger(totalPages) && page < totalPages) {
          current.searchParams.set('page', String(page + 1));
          push(current.href);
        }
      } catch {}
    }
  }
  return pages;
}

function adidasHeroImageURL(value, articleId) {
  try {
    const url = new URL(String(value).replace(/\\u002F/gi, '/'));
    if (url.protocol !== 'https:' || url.hostname !== 'static1.adidas.com.cn' ||
        url.username || url.password || url.port || url.hash) return '';
    const heroPath = url.pathname.startsWith('/t395/') ||
      url.pathname.startsWith(`/ecp-product/cdn-image/article/${articleId}/product/plp/`);
    if (!heroPath) return '';
    const params = [...url.searchParams.keys()];
    if (params.some(name => name !== 'im')) return '';
    if (url.searchParams.has('im')) url.searchParams.set('im', 'Resize=(1200,1200)');
    return copyString(url.href);
  } catch { return ''; }
}

export function adidasProductPhotos(value, pageURL = '') {
  const html = String(value || '');
  const page = adidasArticleURL(pageURL);
  if (!page) return [];
  const articleId = page.searchParams.get('articleId');
  const product = adidasSerializedProduct(html, articleId);
  if (!product) return [];
  const title = copyString(product.title || adidasTitle(html));
  if (!title || !adidasFootwear(title)) return [];
  const images = [], seen = new Set();
  for (const raw of product.imageUrlList) {
    if (typeof raw !== 'string') continue;
    const image = adidasHeroImageURL(raw, articleId);
    if (!image || seen.has(image)) continue;
    seen.add(image);
    images.push({
      title: copyString(title),
      image: copyString(image),
      url: copyString(pageURL),
      canonicalURL: copyString(pageURL),
      productCode: copyString(articleId),
      productTypeEvidence: 'footwear',
      imageRole: 'hero',
      imageId: copyString(new URL(image).pathname),
    });
  }
  return images;
}

const catalogAdapters = {
  nike: {
    name: 'nike',
    photos: nikeCatalogPhotos,
    next: nikeCatalogNext,
  },
  adidas: {
    name: 'adidas',
    photos: adidasCatalogPhotos,
    next: () => '',
    links: adidasCatalogPages,
    linkGraph: true,
  },
};

export function catalogAdapter(value) {
  let name = String(value || '').toLowerCase();
  if (!catalogAdapters[name] && /^https?:/i.test(name)) {
    try {
      const host = new URL(name).hostname.replace(/^www\./, '');
      name = host === 'nike.com' || host.endsWith('.nike.com') ? 'nike'
        : host === 'adidas.com.cn' || host.endsWith('.adidas.com.cn') ? 'adidas' : '';
    } catch { name = ''; }
  }
  return catalogAdapters[name] || null;
}

export function catalogueProductPhotos(name, value, pageURL, isRelevant = () => true) {
  if (name === 'nike') return nikeProductPhotos(value, pageURL, isRelevant);
  if (name === 'adidas') return adidasProductPhotos(value, pageURL);
  return [];
}
