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
];
const text = v => String(v || '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp);/g, ' ').replace(/\s+/g, ' ').trim();
const footwear = /\b(?:shoes?|footwear|sneakers?|trainers?|loafers?|flats?|sandals?|boots?|heels?|pumps?|mules?|slippers?|ballerinas?)\b/i;
export function publicProductPhotos(raw, base, expectedURL) {
  const p = raw?.product || raw;
  if (!p || !p.id || !/^[a-z0-9][a-z0-9_-]*$/i.test(p.handle || '') || !p.title) return [];
  const url = new URL('products/' + p.handle, base.replace(/\/?$/, '/')).href;
  if (expectedURL && productPageKey(url) !== productPageKey(expectedURL)) return [];
  const type = text(p.product_type || p.type);
  // A clothing item mentioning a matching shoe is not footwear evidence.
  if (!footwear.test(type || p.title) || /\b(?:clothing|apparel|accessories|socks?|bags?|handbags?)\b/i.test(type)) return [];
  const tags = Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',');
  const hueTags = tags.filter(t => /hue\s*=>/i.test(t));
  const colorEvidence = [...tags.filter(t => /^colou?r:/i.test(t)), String(p.title).replace(/\([^)]*soles?[^)]*\)/gi, ''), ...(hueTags.length === 1 ? hueTags : [])].join(' · ');
  const evidence = [p.title, type, text(p.body_html || p.description), ...tags.filter(t => !/^[@#*]|YGroup|YCRF|YBlock|^(?:cf-)?size|promo|exclude|inclusion|friendfam|gifts|^notes|^image-add|laborday|nmas|scm-|threatlevel|Zodiac:|Everyday Essentials/i.test(String(t)))].map(text).filter(Boolean).join(' · ');
  const photos = Array.isArray(p.images) ? p.images : [];
  return photos.map((im, index) => {
    const rawURL = typeof im === 'string' ? im : im?.src;
    let image; try { image = new URL(rawURL, base).href; } catch { return null; }
    if (!rawURL || !/^https?:/.test(image)) return null;
    return { title: text(p.title), image, url, canonicalURL: url, productCode: String(p.id),
      productTypeEvidence: 'footwear', brandEvidence: text(p.vendor), intentEvidence: evidence,
      imagePosition: index + 1, colorEvidence, ...(im?.width ? { width: im.width, height: im.height } : {}),
      publishedAt: p.published_at || null, schemaType: 'ShopifyProduct' };
  }).filter(Boolean);
}
export function productAPIPhotos(body, documentURL, productURL) {
  const api = new URL(documentURL), page = new URL(productURL);
  if (api.origin !== page.origin || api.search || api.hash || api.pathname !== page.pathname.replace(/\/$/, '') + '.js') return [];
  let data; try { data = JSON.parse(body); } catch { return []; }
  const base = page.origin + page.pathname.slice(0, page.pathname.lastIndexOf('/products/') + 1);
  return publicProductPhotos(data, base, productURL);
}
