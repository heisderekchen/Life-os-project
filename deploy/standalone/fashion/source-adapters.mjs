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

export function adidasCatalogPhotos(value, sourceURL) {
  const out = [], seen = new Set();
  for (const match of String(value || '').matchAll(/<a\b[^>]*href=["']([^"']*\/pdp\?articleId=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = adidasArticleURL(new URL(match[1], sourceURL).href);
    const title = copyString(match[2].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
    if (!url || !title || !adidasFootwear(title) || seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({
      title,
      url: copyString(url.href),
      canonicalURL: copyString(url.href),
      catalogURL: copyString(sourceURL),
      productCode: copyString(url.searchParams.get('articleId')),
      productTypeEvidence: 'footwear',
    });
  }
  return out;
}

function adidasImageURL(value) {
  const url = new URL(value);
  if (url.hostname !== 'static1.adidas.com.cn' || !url.pathname.startsWith('/t395/')) return '';
  if (url.searchParams.has('im')) url.searchParams.set('im', 'Resize=(1200,1200)');
  return url.href;
}

export function adidasProductPhotos(value, pageURL = '') {
  const html = String(value || '');
  if (!adidasArticleURL(pageURL)) return [];
  const title = adidasTitle(html);
  if (!title || !adidasFootwear(title)) return [];
  const articleId = new URL(pageURL).searchParams.get('articleId');
  const detailStart = html.search(/data-anchor=["']pdp-product-detail["']/i);
  if (detailStart < 0) return [];
  const remainder = html.slice(detailStart);
  const detailEnd = remainder.search(/data-anchor=["']pdp-product-(?:tryon|recommend|comments)["']/i);
  const detail = detailEnd > 0 ? remainder.slice(0, detailEnd) : remainder;
  const normalizedTitle = title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const altMatches = alt => {
    const normalized = alt.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return normalized && (normalized === normalizedTitle ||
      normalized.includes(normalizedTitle) || normalizedTitle.includes(normalized));
  };
  const images = [], seen = new Set();
  for (const match of detail.matchAll(/<div\b[^>]*class=["'][^"']*\blib-detail-image\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const imageTag = match[1].match(/<img\b([^>]*)>/i)?.[1] || '';
    const src = imageTag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || '';
    const alt = imageTag.match(/\balt=["']([^"']*)["']/i)?.[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() || '';
    if (alt && !altMatches(alt)) continue;
    let image;
    try { image = adidasImageURL(new URL(src, pageURL).href); } catch { continue; }
    if (!image || seen.has(image)) continue;
    seen.add(image);
    images.push({
      title: copyString(title),
      image: copyString(image),
      url: copyString(pageURL),
      canonicalURL: copyString(pageURL),
      productCode: copyString(articleId),
      productTypeEvidence: 'footwear',
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
