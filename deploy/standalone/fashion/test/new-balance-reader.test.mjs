import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPhotos } from '../photo-search.mjs';

test('New Balance products survive discovery with separate brand/category evidence and multiple images', async () => {
  const domain = 'retailer.test';
  const products = ['574', '1906'].map(sku => ({
    '@type': 'Product', name: `Classic ${sku}`, category: 'Footwear',
    brand: { name: 'New Balance' }, sku, url: `https://${domain}/products/${sku}`,
    image: [`https://${domain}/${sku}-a.jpg`, `https://${domain}/${sku}-b.jpg`],
  }));
  const markup = data => `<title>Shop collection</title><script type="application/ld+json">${JSON.stringify(data)}</script>`;
  const result = await searchPhotos({ subject: 'new balance shoes', sourceScope: 0, days: 0, domains: [] }, {
    plans: [{ domains: [domain], sources: [{ domain, url: `https://${domain}/` }] }],
    readDocument: async url => ({ url, html: markup({ '@type': 'ItemList', itemListElement: products.map(item => ({ item })) }) }),
    readPage: async url => ({ url, html: markup(products.find(p => p.url === url)) }),
    readImage: async url => ({ bytes: Buffer.from(url), mime: 'image/jpeg' }),
    saveAsset: async () => {},
  });
  assert.equal(result.items.length, 4);
  assert.deepEqual(new Set(result.items.map(item => item.productCode)), new Set(['574', '1906']));
  assert(result.items.every(item => item.verifiedBrand === 'New Balance'));
});

test('matching brand articles are read before generic footwear links consume the candidate budget', async () => {
  const domain = 'media.test';
  const unrelated = Array.from({ length: 14 }, (_, i) => `<a href="/shoe-${i}">Nike shoes ${i}</a>`).join('');
  const result = await searchPhotos({ subject: 'new balance shoes', sourceScope: 0, days: 0, domains: [] }, {
    plans: [{ domains: [domain], sources: [{ domain, url: `https://${domain}/` }] }],
    readDocument: async url => ({ url, html: unrelated + '<a href="/nb">New Balance 574 sneakers</a>' }),
    readPage: async url => ({ url, html: `<title>${url.endsWith('/nb') ? 'New Balance 574 sneakers' : 'Nike shoes'}</title><meta property="og:image" content="https://media.test/574.jpg">` }),
    readImage: async url => ({ bytes: Buffer.from(url), mime: 'image/jpeg' }), saveAsset: async () => {},
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, `https://${domain}/nb`);
});
