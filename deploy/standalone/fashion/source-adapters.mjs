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
