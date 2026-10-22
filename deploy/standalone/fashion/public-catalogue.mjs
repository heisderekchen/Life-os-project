// Public storefront data only; no admin API or private credentials.
import { productPageKey } from './article-products.mjs';
export const PUBLIC_CATALOGUES = [
  { url: 'https://gioseppo.com/en-en', name: 'Gioseppo', category: 'official' },
  { url: 'https://www.rieker.co.uk', name: 'Rieker', category: 'official' },
  { url: 'https://www.stevemadden.com', name: 'Steve Madden', category: 'official' },
  { url: 'https://www.allbirds.com', name: 'Allbirds', category: 'official' },
  { url: 'https://www.dolcevita.com', name: 'Dolce Vita', category: 'official' },
  { url: 'https://larroude.com', name: 'Larroude', category: 'official' },
  { url: 'https://thesportsedit.com', name: 'The Sports Edit', category: 'retail' },
  { url: 'https://alohas.com', name: 'ALOHAS', category: 'official' },
  { url: 'https://dearfrances.com', name: 'Dear Frances', category: 'official' },
  { url: 'https://mgemi.com', name: 'M.Gemi', category: 'official' },
  { url: 'https://www.ghbass.com', name: 'G.H.BASS', category: 'official' },
];
const text = v => String(v || '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp);/g, ' ').replace(/\s+/g, ' ').trim();
const footwear = /\b(?:shoes?|footwear|sneakers?|trainers?|loafers?|flats?|sandals?|boots?|heels?|pumps?|mules?|slippers?|ballerinas?)\b/i;
export function publicProductPhotos(raw, base, expectedURL) {
  const p = raw?.product || raw;
  if (!p || !p.id || !/^[a-z0-9][a-z0-9_-]*$/i.test(p.handle || '') || !p.title) return [];
  const url = new URL('products/' + p.handle, base.replace(/\/?$/, '/')).href;
  if (expectedURL && productPageKey(url) !== productPageKey(expectedURL)) return [];
  const type = text(p.product_type || p.type);
  const tags = Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',');
  const categories = tags.filter(t => /^_filter_(?:super_category|category)\s+/i.test(t)).map(t => text(t).replace(/^_filter_(?:super_category|category)\s+/i, ''));
  const classification = [type, ...categories].join(' ');
  const subtypeTags = tags.filter(t => /^(?:shoes?|footwear|sneakers?|trainers?|loafers?|flats?|sandals?|boots?|heels?|pumps?|mules?|slippers?|ballerinas?)$/i.test(t));
  // A clothing item mentioning a matching shoe is not footwear evidence.
  if (!footwear.test([classification, p.title, ...subtypeTags].join(' ')) || /\b(?:clothing|apparel|accessories|socks?|bags?|handbags?|laces?|insoles?|shoe care|cleaners?|cleaning|spray|shoehorn)\b/i.test(classification)) return [];
  const hueTags = tags.filter(t => /hue\s*=>/i.test(t));
  const singleColor = (Array.isArray(p.options) ? p.options : []).filter(o => o && /^colou?r$/i.test(o.name) && Array.isArray(o.values) && o.values.length === 1).map(o => text(o.values[0]));
  const colorEvidence = [...tags.filter(t => /^(?:colou?r:|_filter_color\s+|color_plain:|clr:)/i.test(t)), ...singleColor, String(p.title).replace(/\([^)]*soles?[^)]*\)/gi, ''), ...(hueTags.length === 1 ? hueTags : [])].join(' · ');
  const evidence = [p.title, classification, ...singleColor, text(p.body_html || p.description), ...tags.filter(t => !/^[@#*]|^(?:loafers[- /]flats|flats[- /]loafers)$|YGroup|YCRF|YBlock|^(?:cf-)?size|promo|exclude|inclusion|friendfam|gifts|^notes|^image-add|laborday|nmas|scm-|threatlevel|Zodiac:|Everyday Essentials/i.test(String(t)))].map(text).filter(Boolean).join(' · ');
  const photos = Array.isArray(p.images) ? p.images : [];
  let productPhotos = photos;
  let imageSelectionEvidence;
  if (new URL(base).hostname.replace(/^www\./, '') === 'mgemi.com') {
    const model = text(p.title).replace(/\([^)]*\)/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const own = photos.filter(im => {
      const src = typeof im === 'string' ? im : im?.src;
      const name = String(src || '').split('?')[0].split('/').at(-1).toLowerCase().replace(/[^a-z0-9]/g, '');
      return name.includes(String(p.id)) || model.length >= 5 && name.includes(model);
    });
    productPhotos = own.length ? own : photos.slice(0, 1);
    imageSelectionEvidence = own.length ? 'named-product-view' : 'primary-product-image-only';
  }
  return productPhotos.map((im, index) => {
    const rawURL = typeof im === 'string' ? im : im?.src;
    let image; try { image = new URL(rawURL, base).href; } catch { return null; }
    if (!rawURL || !/^https?:/.test(image)) return null;
    return { title: text(p.title), image, url, canonicalURL: url, productCode: String(p.id),
      productTypeEvidence: 'footwear', primaryTypeEvidence: [p.title, classification, ...tags.filter(t => /^(?:Type|Style):/i.test(t))].join(' '), brandEvidence: text(p.vendor), intentEvidence: evidence,
      imagePosition: index + 1, colorEvidence, audienceEvidence: [type, ...tags.filter(t => /^(?:kids?|children|girls?|boys?|junior|toddler|baby|infant|woman|women|man|men|female|male)$/i.test(t))].join(' '), ...(im?.width ? { width: im.width, height: im.height } : {}),
      ...(imageSelectionEvidence ? { imageSelectionEvidence, excludedGalleryImages: photos.length - productPhotos.length } : {}),
      publishedAt: p.published_at || null, schemaType: 'ShopifyProduct' };
  }).filter(Boolean);
}
export function productAPIPhotos(body, documentURL, productURL, productCode = '', parsed) {
  const api = new URL(documentURL), page = new URL(productURL);
  if (api.origin !== page.origin || api.hash) return [];
  let data; try { data = parsed ?? JSON.parse(body); } catch { return []; }
  if (/\/products\.json$/.test(api.pathname)) {
    if (!productCode || !Array.isArray(data.products) || [...api.searchParams.keys()].some(k => !['page', 'limit'].includes(k))) return [];
    for (const key of ['page', 'limit']) if (api.searchParams.has(key) && !/^[1-9]\d{0,2}$/.test(api.searchParams.get(key))) return [];
    const matches = data.products.filter(p => String(p.id) === String(productCode));
    if (matches.length !== 1) return [];
    const base = api.origin + api.pathname.slice(0, -'products.json'.length);
    return publicProductPhotos(matches[0], base, productURL);
  }
  if (api.search || api.pathname !== page.pathname.replace(/\/$/, '') + '.js') return [];
  const product = data.product || data;
  if (productCode && String(product.id) !== String(productCode)) return [];
  const base = page.origin + page.pathname.slice(0, page.pathname.lastIndexOf('/products/') + 1);
  return publicProductPhotos(product, base, productURL);
}
