import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceSearchPlan } from '../source-planner.mjs';
import { createSourceStore } from '../admin/store.mjs';
import { searchPhotos, photoQueries, declaredImageURL, imageDeclared, matchesIntent } from '../photo-search.mjs';
import { nikeCatalogPhotos } from '../source-adapters.mjs';

test('real private catalogue supplies Nike and footwear media; admin exclusions apply to subsequent searches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fashion-catalogue-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSourceStore({ registryFile: new URL('../data/source-registry.json', import.meta.url), settingsFile: join(dir, 'settings.json') });
  const data = await store.read(), input = { subject: '耐克', sourceScope: 2, sources: ['official', 'media', 'retail'], domains: [] };
  const plan = sourceSearchPlan(input, data.sources);
  assert(plan.some(p => p.catalogue === 'nike' && p.domains.includes('nike.com')));
  assert(plan.flatMap(p => p.domains).length > 15);
  assert(plan.some(p => p.domains.includes('footwearnews.com')));
  assert(!plan.some(p => p.domains.includes('miumiu.com')));
  const nike = data.sources.find(s => s.domain === 'nike.com');
  await store.update(nike.id, { review: 'exclude' }, data.revision);
  const changed = sourceSearchPlan(input, (await store.read()).sources);
  assert(!changed.some(p => p.domains.includes('nike.com')));
  assert(changed.excludedDomains.includes('nike.com'));
});

test('brand-only query expands footwear terms while specific shoe/material intent stays intact', () => {
  assert.equal(matchesIntent('nike', 'Nike footwear duffel bag in a history booth'), false);
  assert.deepEqual(photoQueries('nike', 2), ['nike shoes', 'nike sneakers', 'nike footwear', 'nike women shoes']);
  assert(photoQueries('女款绒面乐福鞋', 2).every(q => /suede.*loafers/.test(q) && !q.includes('sneakers')));
});

test('broad discovery combines providers, exceeds eight photos, rejects demo listings and respects excluded domains', async () => {
  const one = { title: 'Nike shoes first', url: 'https://first.example.com/shoe', image: 'https://cdn.example.com/first.jpg' };
  const more = Array.from({ length: 65 }, (_, i) => ({ t: 'Nike shoes ' + i, purl: `https://${i % 2 ? 'second' : 'third'}.example.com/product/${i}`, murl: `https://cdn.example.com/${i}.jpg` }));
  more.unshift({ t: '演示数据 Nike shoes', purl: 'https://store.example.com/demo', murl: 'https://cdn.example.com/demo.jpg' });
  const plans = []; plans.excludedDomains = ['third.example.com'];
  const result = await searchPhotos({ subject: 'nike', days: 0, domains: [], sourceScope: 2 }, {
    plans, fetcher: async url => new Response(String(url).includes('bing.com/images') ? more.map(c => `<a m='${JSON.stringify(c)}'>shoe</a>`).join('') : String(url).includes('/i.js?') ? JSON.stringify({ results: [one] }) : "vqd='4-123'"),
    readPage: async url => ({ url, html: `<title>Nike shoes</title><img src="${url===one.url ? one.image : 'https://cdn.example.com/'+url.split('/').at(-1)+'.jpg'}">` }),
    readImage: async url => ({ bytes: Buffer.from(url), mime: 'image/jpeg' }), saveAsset: async () => {},
  });
  assert(result.items.length > 8);
  assert(result.items.some(i => i.source === 'first.example.com'));
  assert(result.items.some(i => i.source === 'second.example.com'));
  assert(result.items.every(i => i.source !== 'third.example.com' && !i.url.endsWith('/demo')));
});

test('official footwear catalogue extracts products only; higher resolution must be the same declared asset', () => {
  const uuid = '12345678-1234-1234-1234-123456789abc';
  const image = `https://static.nike.com/a/images/t_default/${uuid}/SHOES.png`;
  const larger = `https://static.nike.com/a/images/t_web_pdp_936_v2/f_auto/${uuid}/SHOES.png`;
  const other = 'https://static.nike.com/a/images/t_web_pdp_936_v2/f_auto/aaaaaaaa-1234-1234-1234-123456789abc/SHOES.png';
  const product = { productType: 'FOOTWEAR', productCode: 'CODE-001', copy: { title: 'Running Shoes', subTitle: "Women's Shoes" }, pdpUrl: { url: 'https://www.nike.com/t/running-shoes/CODE-001' }, colorwayImages: { portraitURL: image } };
  const html = '<script id="__NEXT_DATA__">'+JSON.stringify({ props: { pageProps: { initialState: { Wall: { productGroupings: [{ products: [product, { ...product, productType: 'APPAREL' }] }] } } } } })+'</script>';
  assert.equal(nikeCatalogPhotos(html, 'https://www.nike.com/w/shoes-y7ok').length, 1);
  assert.equal(declaredImageURL(html+`<img src="${larger}"><img src="${other}">`, image), larger);
  assert(imageDeclared(`<img src="${larger}">`, image));
  assert(!imageDeclared(`<img src="${other}">`, image));
});
