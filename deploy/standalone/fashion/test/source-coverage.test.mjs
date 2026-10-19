import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceSearchPlan } from '../source-planner.mjs';
import { createSourceStore } from '../admin/store.mjs';
import { searchPhotos, photoQueries, declaredImageURL, imageDeclared, matchesIntent, createPageLRU, createPageReadLimiter, PAGE_CACHE_LIMIT, PAGE_CACHE_BYTE_LIMIT, sourcePublishedAt, countResultSources } from '../photo-search.mjs';
import { nikeCatalogNext, nikeCatalogPhotos, nikeProductPhotos } from '../source-adapters.mjs';

test('real private catalogue supplies Nike and footwear media; admin exclusions apply to subsequent searches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fashion-catalogue-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSourceStore({ registryFile: new URL('../data/source-registry.json', import.meta.url), settingsFile: join(dir, 'settings.json') });
  const data = await store.read(), input = { subject: '耐克', sourceScope: 2, sources: ['official', 'media', 'retail'], domains: [] };
  const plan = sourceSearchPlan(input, data.sources);
  assert(plan.some(p => p.catalogue === 'nike' && p.domains.includes('nike.com')));
  assert(plan.flatMap(p => p.domains).length > 15);
  assert(plan.some(p => p.domains.includes('footwearnews.com')));
  assert.equal(new Set(plan.flatMap(p => p.domains)).size, 1000);
  assert(plan[0].domains.includes('nike.com'));
  assert.equal(plan[0].readerVersion, 3);
  assert.equal(plan[0].catalogProductLimit, 600);
  assert.equal(plan[0].timeoutMs, 720000);
  assert.equal(plan.filter(p => p.catalogURL).length, 1);
  assert(plan.some(p => p.openDiscovery && p.domains.length === 0));
  assert(plan.some(p => p.domains.includes('nike.com') && p.sources?.length));
  const nike = data.sources.find(s => s.domain === 'nike.com');
  await store.update(nike.id, { review: 'exclude' }, data.revision);
  const changed = sourceSearchPlan(input, (await store.read()).sources);
  assert(!changed.some(p => p.domains.includes('nike.com')));
  assert(changed.excludedDomains.includes('nike.com'));
});

test('scope 2 opens unrestricted web discovery only for the full official/media/retail selection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fashion-source-scope-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSourceStore({ registryFile: new URL('../data/source-registry.json', import.meta.url), settingsFile: join(dir, 'settings.json') });
  const sources = (await store.read()).sources;
  const plan = selected => sourceSearchPlan({ subject: '乐福鞋', sourceScope: 2, sources: selected, domains: [] }, sources);
  assert(!plan(['official']).some(item => item.openDiscovery));
  assert(!plan(['media']).some(item => item.openDiscovery));
  assert(!plan(['official', 'media']).some(item => item.openDiscovery));
  assert.equal(plan([]).length, 0);
  assert(plan(['official', 'media', 'retail']).some(item => item.openDiscovery));
});

test('public matched-source count reflects real result domains rather than planned-directory matches', () => {
  assert.equal(countResultSources([
    { source: 'whowhatwear.com' },
    { source: 'whowhatwear.com' },
    { source: 'footwearnews.com' },
  ]), 2);
  assert.equal(countResultSources([]), 0);
});

test('brand-only query expands footwear terms while specific shoe/material intent stays intact', () => {
  assert.equal(matchesIntent('nike', 'Nike footwear duffel bag in a history booth'), false);
  assert.deepEqual(photoQueries('nike', 2), ['nike shoes', 'nike sneakers', 'nike footwear', 'nike women shoes']);
  assert(photoQueries('女款绒面乐福鞋', 2).every(q => /suede.*loafers/.test(q) && !q.includes('sneakers')));
});

test('PDP page cache is a bounded LRU and touches recently reused pages', () => {
  const cache = createPageLRU(3);
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  assert.equal(cache.get('a'), 1);
  cache.set('d', 4);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.get('d'), 4);
  assert.equal(PAGE_CACHE_LIMIT, 48);
  assert.equal(PAGE_CACHE_BYTE_LIMIT, 8 * 1024 * 1024);
});

test('shared page-read limiter bounds concurrent large-page parsing', async () => {
  const limit = createPageReadLimiter(2);
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 10 }, (_, index) => limit(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, index % 2 ? 2 : 1));
    active--;
  })));
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('PDP page cache enforces a byte budget in addition to the entry count', () => {
  const cache = createPageLRU(10, 10);
  cache.set('a', 'a', 4);
  cache.set('b', 'b', 4);
  assert.equal(cache.get('a'), 'a');
  cache.set('c', 'c', 4);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.bytes, 8);
  cache.set('too-large', 'x', 11);
  assert.equal(cache.get('too-large'), undefined);
});

test('sitemap lastModifiedAt never substitutes for article publication date, while RSS pubDate remains valid', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(sourcePublishedAt('<title>No article date</title>', {
    lastModifiedAt: '2026-10-19T10:00:00Z',
  }, now), null);
  assert.equal(sourcePublishedAt('<title>No article date</title>', {
    publishedAt: '2026-10-19T10:00:00Z',
  }, now), '2026-10-19T10:00:00.000Z');
  assert.equal(sourcePublishedAt('<script type="application/ld+json">{"datePublished":"2026-10-18T09:00:00Z"}</script>', {
    lastModifiedAt: '2026-10-19T10:00:00Z',
  }, now), '2026-10-18T09:00:00.000Z');
});

test('broad discovery combines providers, exceeds eight photos, rejects demo listings and respects excluded domains', async () => {
  const one = { title: 'Nike shoes first', url: 'https://first.example.com/shoe', image: 'https://cdn.example.com/first.jpg' };
  const more = Array.from({ length: 65 }, (_, i) => ({ t: 'Nike shoes ' + i, purl: `https://${i % 2 ? 'second' : 'third'}.example.com/product/${i}`, murl: `https://cdn.example.com/${i}.jpg` }));
  more.unshift({ t: '演示数据 Nike shoes', purl: 'https://store.example.com/demo', murl: 'https://cdn.example.com/demo.jpg' });
  const plans = []; plans.excludedDomains = ['third.example.com'];
  const streamed = [];
  const result = await searchPhotos({ subject: 'nike', days: 0, domains: [], sourceScope: 2 }, {
    plans, fetcher: async url => new Response(String(url).includes('bing.com/images') ? more.map(c => `<a m='${JSON.stringify(c)}'>shoe</a>`).join('') : String(url).includes('/i.js?') ? JSON.stringify({ results: [one] }) : "vqd='4-123'"),
    readPage: async url => ({ url, html: `<title>Nike shoes</title><img src="${url===one.url ? one.image : 'https://cdn.example.com/'+url.split('/').at(-1)+'.jpg'}">` }),
    readImage: async url => ({ bytes: Buffer.from(url), mime: 'image/jpeg' }), saveAsset: async () => {},
    incrementalProgress: true, onProgress: async progress => streamed.push(...progress.items),
  });
  assert(result.items.length > 8);
  assert(result.items.some(i => i.source === 'first.example.com'));
  assert(result.items.some(i => i.source === 'second.example.com'));
  assert(result.items.every(i => i.source !== 'third.example.com' && !i.url.endsWith('/demo')));
  assert.equal(streamed.length, result.items.length);
  assert.equal(new Set(streamed.map(item => item.id)).size, result.items.length);
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

test('official catalogue exposes the public next-page cursor and PDP image group without duplicate assets', () => {
  const id1 = '11111111-1111-1111-1111-111111111111';
  const id2 = '22222222-2222-2222-2222-222222222222';
  const base = 'https://static.nike.com/a/images/t_default/u_bg/';
  const next = '/discover/product_wall/v1/marketplace/US/language/en?path=/w/shoes-y7ok&anchor=24&count=24';
  const wall = '<script id="__NEXT_DATA__">' + JSON.stringify({
    props: { pageProps: { initialState: { Wall: { pageData: { next }, productGroupings: [] } } } }
  }) + '</script>';
  assert.equal(nikeCatalogNext(wall), new URL(next, 'https://api.nike.com').href);
  assert.equal(nikeCatalogNext(JSON.stringify({ productGroupings: [], pages: { next } })), new URL(next, 'https://api.nike.com').href);
  const current = '/discover/product_wall/v1/marketplace/US/language/en/consumerChannelId/d9a5bc42-4b9c-4976-858a-f159cf99c647?path=/w/shoes-y7ok&anchor=24&count=24';
  assert.equal(nikeCatalogNext(JSON.stringify({ productGroupings: [], pages: { next: current } })), new URL(current, 'https://api.nike.com').href);
  for (const unsafe of [
    'http://api.nike.com/discover/product_wall/v1/marketplace/US/language/en',
    'https://user:pass@api.nike.com/discover/product_wall/v1/marketplace/US/language/en',
    'https://api.nike.com:444/discover/product_wall/v1/marketplace/US/language/en',
    'https://api.nike.com/private/product_wall/v1/marketplace/US/language/en',
    'https://api.nike.com/discover/product_wall/v1/marketplace/US/language/en/consumerChannelId/not-a-uuid',
    'https://evil.example/discover/product_wall/v1/marketplace/US/language/en',
  ]) {
    assert.equal(nikeCatalogNext(JSON.stringify({ productGroupings: [], pages: { next: unsafe } })), '');
  }
  const pdp = '<script id="__NEXT_DATA__">' + JSON.stringify({
    props: { pageProps: { selectedProduct: {
      productType: 'FOOTWEAR', styleColor: 'TEST-001',
      productInfo: { fullTitle: 'Nike Test Shoes' },
      pdpUrl: { url: 'https://www.nike.com/t/test/TEST-001', canonicalUrl: 'https://www.nike.com/t/test' },
      contentImages: [
        { cardType: 'image', properties: { portrait: { id: id1, url: base + id1 + '/SHOE.png' } } },
        { cardType: 'image', properties: { portrait: { id: id1, url: base + id1 + '/SHOE.png' } } },
        { cardType: 'image', properties: { squarish: { id: id2, url: base + id2 + '/SHOE.png' } } },
      ],
    } } }
  }) + '</script>';
  const images = nikeProductPhotos(pdp, 'https://www.nike.com/t/test/TEST-001', title => matchesIntent('nike', title));
  assert.equal(images.length, 2);
  assert.equal(new Set(images.map(image => image.imageId)).size, 2);
  assert(images.every(image => image.image.includes('/t_web_pdp_936_v2/f_auto,')));
  assert(imageDeclared(pdp, images[0].image));
  const jordan = pdp.replaceAll('Nike Test Shoes', "Jordan Spizike Low Men's Shoe");
  assert.equal(nikeProductPhotos(jordan, 'https://www.nike.com/t/test/TEST-001', title => /\b(?:shoes?|footwear)\b/i.test(title)).length, 2);
});
