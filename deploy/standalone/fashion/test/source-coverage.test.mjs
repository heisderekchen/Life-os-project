import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceSearchPlan } from '../source-planner.mjs';
import { createSourceStore } from '../admin/store.mjs';
import { searchPhotos, photoQueries, declaredImageURL, imageDeclared, matchesIntent, matchesProductIntent, createPageLRU, createPageReadLimiter, PAGE_CACHE_LIMIT, PAGE_CACHE_BYTE_LIMIT, sourcePublishedAt, countResultSources } from '../photo-search.mjs';
import { nikeCatalogNext, nikeCatalogPhotos, nikeProductPhotos, adidasCatalogPhotos, adidasCatalogPages, adidasProductPhotos } from '../source-adapters.mjs';

const stateURL = value => JSON.stringify(value).replaceAll('/', '\\u002F');
function adidasPDP({ id, title, images, plpImage, other, variants = [], recommendations = [] }) {
  const assignments = images.map((image, index) => `d[${index}]=${stateURL(image)};`).join('');
  const plp = plpImage || `https://static1.adidas.com.cn/ecp-product/cdn-image/article/${id}/product/plp/0/${id}.jpg`;
  const otherBlock = other
    ? `{productSSRData:{articleId:${stateURL(other.id)},articleName:${stateURL(other.title)},imageUrlList:[${stateURL(other.image)}],plpImageUrl:${stateURL(`https://static1.adidas.com.cn/ecp-product/cdn-image/article/${other.id}/product/plp/0/${other.id}.jpg`)}}},`
    : '';
  const aggregate = variants.length
    ? `,aggregateArticleList:[${variants.map(item => `{articleId:${stateURL(item.id)},articleName:${stateURL(item.title)}}`).join(',')}]`
    : '';
  const hyper = recommendations.length
    ? `hyperBoostArticleList:[${recommendations.map(item => `{"@type":"Product",name:${stateURL(item.title)},productID:${stateURL(item.id)}}`).join(',')}],`
    : '';
  return `<title>阿迪达斯-${title} | adidas</title><script>window.__NUXT__=(function(a,b,d,e){${assignments}return {${hyper}data:[${otherBlock}{productSSRData:{articleId:a,articleName:b,imageUrlList:d,plpImageUrl:e${aggregate}}}]}}(${JSON.stringify(id)},${JSON.stringify(title)},Array(${images.length}),${stateURL(plp)}));</script>`;
}

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
  const updatedSources = (await store.read()).sources;
  const changed = sourceSearchPlan(input, updatedSources);
  assert(!changed.some(p => p.domains.includes('nike.com')));
  assert(changed.excludedDomains.includes('nike.com'));
  const catalogInput = { ...input, subject: '耐克鞋', days: 0 };
  const balanced = sourceSearchPlan({ ...catalogInput, sourceScope: 1 }, data.sources);
  const focused = sourceSearchPlan({ ...catalogInput, sourceScope: 0 }, data.sources);
  const balancedCatalog = balanced.find(plan => plan.catalogURL);
  const focusedCatalog = focused.find(plan => plan.catalogURL);
  assert.equal(balancedCatalog.catalogURL, 'https://www.nike.com/w/shoes-y7ok');
  assert.deepEqual(balancedCatalog.domains, ['nike.com']);
  assert.equal(balancedCatalog.catalogProductLimit, 30);
  assert.equal(balancedCatalog.catalogResultLimit, 24);
  assert.equal(focusedCatalog.catalogProductLimit, 24);
  assert.equal(focusedCatalog.catalogResultLimit, 16);
  assert.equal(balancedCatalog.readerVersion, 3);
  assert(balanced.find(plan => plan.label === '品牌官方').domains.includes('nike.com'));
  assert(balanced.some(plan => plan.label === '专业媒体' && plan.domains.length));
  assert(balanced.some(plan => plan.label === '零售平台' && plan.domains.length));
  assert(focused.find(plan => plan.label === '品牌官方').domains.includes('nike.com'));
  assert(!sourceSearchPlan({ ...catalogInput, sourceScope: 1, sources: ['media', 'retail'] }, data.sources)
    .some(plan => plan.catalogURL));
  assert(!sourceSearchPlan({ ...catalogInput, sourceScope: 1, days: 7 }, data.sources)
    .some(plan => plan.catalogURL));
  assert(!sourceSearchPlan({ ...catalogInput, sourceScope: 1, domains: ['example.com'] }, data.sources)
    .some(plan => plan.catalogURL));
  assert(!sourceSearchPlan({ ...catalogInput, sourceScope: 1 }, updatedSources)
    .some(plan => plan.catalogURL));
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

test('Chinese brand plus generic shoe compounds match footwear while retaining type, material, and gender intent', () => {
  const cases = [
    ['nike', "Nike Air Force 1 Men's Shoes"],
    ['耐克鞋', "Nike Air Force 1 Men's Shoes"],
    ['耐克鞋子', "Nike Air Force 1 Men's Shoes"],
    ['耐克女鞋', "Nike Women's Air Force 1 Shoes"],
    ['阿迪达斯鞋', 'Adidas Samba Shoes'],
    ['阿迪达斯麂皮鞋', 'Adidas suede Samba Shoes'],
    ['新百伦运动鞋', 'New Balance 574 Sneakers'],
  ];
  for (const [subject, title] of cases) assert.equal(matchesIntent(subject, title), true, `${subject} -> ${title}`);
  assert.equal(matchesIntent('耐克女鞋', "Nike Men's Air Force 1 Shoes"), false);
  assert.equal(matchesIntent('阿迪达斯麂皮鞋', 'Adidas leather Samba Shoes'), false);
  assert.equal(matchesIntent('耐克乐福鞋', "Nike Air Force 1 Men's Shoes"), false);
  assert.equal(matchesIntent('耐克鞋', 'Nike footwear duffel bag in a history booth'), false);
  assert.equal(matchesIntent('耐克鞋', "Nike Air Force 1 Men's Clothing"), false);
});

test('Adidas catalog plans use the public China storefront without changing the 1000-source queue', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fashion-adidas-catalogue-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSourceStore({ registryFile: new URL('../data/source-registry.json', import.meta.url), settingsFile: join(dir, 'settings.json') });
  const sources = (await store.read()).sources;
  for (const subject of ['阿迪达斯', 'Adidas', '阿迪达斯鞋', 'Adidas shoes']) {
    const plan = sourceSearchPlan({ subject, days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] }, sources);
    const catalog = plan.find(item => item.catalogue === 'adidas');
    assert.equal(catalog.catalogURL, 'https://www.adidas.com.cn/siteMap');
    assert.deepEqual(catalog.domains, ['adidas.com.cn']);
    assert.equal(catalog.catalogPages, 60);
    assert.equal(catalog.catalogProductLimit, 600);
    assert.equal(catalog.readerVersion, 5);
    assert.equal(new Set(plan.flatMap(item => item.domains)).size, 1000);
    assert(plan.some(item => item.domains.includes('adidas.com.cn') && item.sources?.length));
  }
  const strict = sourceSearchPlan({ subject: '阿迪达斯', days: 7, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] }, sources);
  assert(!strict.some(item => item.catalogURL));
  const focused = sourceSearchPlan({ subject: '阿迪达斯', days: 0, domains: [], sourceScope: 0, sources: ['official'] }, sources);
  assert.equal(focused.find(item => item.catalogue === 'adidas').catalogPages, 2);
  const adidas = sources.find(source => source.domain === 'adidas.com');
  await store.update(adidas.id, { review: 'exclude' }, (await store.read()).revision);
  assert(!sourceSearchPlan({ subject: '阿迪达斯', days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] }, (await store.read()).sources)
    .some(item => item.catalogURL));
});

test('Adidas discovery rejects catalogue-only, bags and apparel while binding only official footwear PDP assets', () => {
  const catalog = `
    <a href="/pdp?articleId=JH6149">SAMBA GOLF 「T头鞋」高尔夫运动鞋小白鞋</a>
    <a href="/pdp?articleId=AB1234">Adidas shoulder bag</a>
    <a href="/pdp?articleId=CD5678">Adidas cotton T-shirt</a>
    <a href="/plp/brand_ORIGINALS_ftw_male?page=1">Adidas footwear catalogue</a>`;
  const found = adidasCatalogPhotos(catalog, 'https://www.adidas.com.cn/siteMap');
  assert.equal(found.length, 1);
  assert.equal(found[0].productCode, 'JH6149');
  const image = 'https://static1.adidas.com.cn/t395/declared-gallery.jpeg?im=Resize=(1000,1000)';
  const secondImage = 'https://static1.adidas.com.cn/t395/declared-gallery-2.jpeg?im=Resize=(1000,1000)';
  const pdp = adidasPDP({ id: 'JH6149', title: 'SAMBA GOLF 「T头鞋」高尔夫运动鞋小白鞋', other: {
    id: 'KJ5431',
    title: 'SAMBA GOLF 低帮运动板鞋',
    image: 'https://static1.adidas.com.cn/t395/color-alias.jpg',
  }, images: [
    image,
    secondImage,
    'https://static1.adidas.com.cn/ecp-product/cdn-image/article/JH6149/product/plp/0/JH6149_current.jpg',
    'https://static1.adidas.com.cn/ecp-product/cdn-image/article/KJ5431/product/plp/0/KJ5431_other.jpg',
    'https://static1.adidas.com.cn/ecp-review/review.jpg',
    'https://evil.example/t395/tracker.jpg',
  ] }) + `
    <ul class="pdp-color-image-list"><li><a href="/pdp?articleId=KJ5431"><img src="https://static1.adidas.com.cn/t395/other-color.jpg" alt="SAMBA GOLF 低帮运动板鞋"></a></li></ul>
    <div data-anchor="pdp-product-recommend">
      <img src="https://static1.adidas.com.cn/t395/recommended-adidas.jpg" alt="Adidas Superstar Shoes">
      <img src="https://static1.adidas.com.cn/t395/recommended-puma.jpg" alt="Puma Speedcat running shoes">
    </div>`;
  const images = adidasProductPhotos(pdp, found[0].url);
  assert.equal(images.length, 3);
  assert.deepEqual(images.map(item => new URL(item.image).pathname), [
    new URL(image).pathname,
    new URL(secondImage).pathname,
    '/ecp-product/cdn-image/article/JH6149/product/plp/0/JH6149_current.jpg',
  ]);
  assert(images.slice(0, 2).every(item => new URL(item.image).searchParams.get('im') === 'Resize=(1200,1200)'));
  assert(!images.some(item => /recommended|other-color|color-alias|mismatched/.test(item.image)));
  assert(imageDeclared(pdp, images[0].image));
  assert(images.every(item => item.productCode === 'JH6149'));
});

test('Adidas PDP graph discovers explicit variants and footwear recommendations with SKU dedupe', () => {
  const url = 'https://www.adidas.com.cn/pdp?articleId=JH6149';
  const pdp = adidasPDP({
    id: 'JH6149',
    title: 'SAMBA GOLF 高尔夫运动鞋',
    images: ['https://static1.adidas.com.cn/t395/current.jpg'],
    variants: [
      { id: 'KJ5431', title: 'SAMBA GOLF 低帮运动板鞋' },
      { id: 'KJ5431', title: 'SAMBA GOLF 低帮运动板鞋' },
    ],
    recommendations: [
      { id: 'KI4406', title: 'Adidas HYPERBOOST EDGE 跑鞋' },
      { id: 'KI0001', title: 'Adidas Logo Tee' },
      { id: 'KI4406', title: 'Adidas HYPERBOOST EDGE 跑鞋' },
    ],
  });
  const found = adidasCatalogPhotos(pdp, url);
  assert.deepEqual(found.map(item => item.productCode), ['JH6149', 'KJ5431', 'KI4406']);
  assert.equal(new Set(found.map(item => item.productCode)).size, found.length);
  assert.deepEqual(adidasProductPhotos(pdp, 'https://www.adidas.com.cn/pdp?articleId=KI4406'), []);
});

test('Adidas public PLP pagination exposes footwear products and suppresses apparel pages', () => {
  const siteMap = `<a href="/plp/brand_ORIGINALS_ftw_male?page=1">鞋履</a>
    <a href="/plp/brand_ORIGINALS_app_male?page=1">服装</a>
    <a href="https://evil.example/plp/brand_ORIGINALS_ftw_male?page=1">外部</a>`;
  assert.deepEqual(adidasCatalogPages(siteMap, 'https://www.adidas.com.cn/siteMap'), [
    'https://www.adidas.com.cn/plp/brand_ORIGINALS_ftw_male?page=1',
  ]);
  const products = [
    { articleId: 'PL1001', articleName: 'Adidas Samba Shoes' },
    { articleId: 'PL1002', articleName: 'Adidas Logo Tee' },
    { articleId: 'PL1001', articleName: 'Adidas Samba Shoes' },
  ];
  const plp = `<script>window.__NUXT__=(function(a,b,c,d){return {listData:{productList:{totalPages:a,totalElements:b,content:[c,d,c]}}}}(2,12,{articleId:"PL1001",articleName:"Adidas Samba Shoes"},{articleId:"PL1002",articleName:"Adidas Logo Tee"}));</script>`;
  const found = adidasCatalogPhotos(plp, 'https://www.adidas.com.cn/plp/brand_ORIGINALS_ftw_male?page=1');
  assert.deepEqual(found.map(item => item.productCode), ['PL1001']);
  assert.deepEqual(adidasCatalogPages(plp, 'https://www.adidas.com.cn/plp/brand_ORIGINALS_ftw_male?page=1'), [
    'https://www.adidas.com.cn/plp/brand_ORIGINALS_ftw_male?page=2',
  ]);
});

test('Adidas catalogue verification returns the declared original page and image identity', async () => {
  const productURL = 'https://www.adidas.com.cn/pdp?articleId=JH6149';
  const image = 'https://static1.adidas.com.cn/t395/declared-gallery.jpeg?im=Resize=(200,200)';
  const tallImage = 'https://static1.adidas.com.cn/t395/long-storyboard.jpeg';
  const fetcher = async value => {
    const url = new URL(String(value));
    if (url.hostname === 'www.adidas.com.cn' && url.pathname === '/siteMap')
      return new Response('<a href="/pdp?articleId=JH6149">SAMBA GOLF 高尔夫运动鞋</a>');
    if (url.href === productURL)
      return new Response(adidasPDP({ id: 'JH6149', title: 'SAMBA GOLF 高尔夫运动鞋', images: [image, tallImage] }));
    throw Error('unexpected fixture URL ' + url.href);
  };
  const plan = {
    label: 'Adidas官方鞋履目录', domains: ['adidas.com.cn'], catalogue: 'adidas',
    catalogURL: 'https://www.adidas.com.cn/siteMap', catalogPages: 1,
    catalogProductLimit: 10, catalogImageLimit: 2, catalogResultLimit: 10,
    readerVersion: 5,
  };
  const plans = [plan];
  plans.excludedDomains = [];
  const saved = [];
  const result = await searchPhotos({ subject: '阿迪达斯', days: 0, domains: [], sourceScope: 0 }, {
    plans,
    fetcher,
    readPage: async (url, request = fetcher) => {
      const response = await request(url);
      return { url: String(url), html: await response.text() };
    },
    readImage: async url => url.includes('long-storyboard')
      ? ({ bytes: Buffer.from('long-storyboard'), mime: 'image/jpeg', width: 400, height: 1200 })
      : ({ bytes: Buffer.from('verified-adidas-image'), mime: 'image/jpeg', width: 800, height: 600 }),
    saveAsset: async (sha, asset) => saved.push({ sha, asset }),
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, productURL);
  assert.equal(new URL(result.items[0].image).searchParams.get('im'), 'Resize=(1200,1200)');
  assert.equal(result.items[0].sourceCheckedAt !== undefined, true);
  assert.equal(result.items[0].sourceImageMatched, true);
  assert.equal(result.items[0].imageSha256, saved[0].sha);
});

test('bounded Adidas link-graph discovery resumes from checkpoint without duplicate SKUs', async () => {
  const pages = {
    JH6149: adidasPDP({ id: 'JH6149', title: 'SAMBA GOLF 运动鞋', images: ['https://static1.adidas.com.cn/t395/jh.jpg'], variants: [
      { id: 'AA1001', title: 'SAMBA 运动鞋 A' },
      { id: 'AA1002', title: 'SAMBA 运动鞋 B' },
    ] }),
    AA1001: adidasPDP({ id: 'AA1001', title: 'SAMBA 运动鞋 A', images: ['https://static1.adidas.com.cn/t395/a.jpg'], variants: [
      { id: 'AA1003', title: 'SAMBA 运动鞋 C' },
    ] }),
    AA1002: adidasPDP({ id: 'AA1002', title: 'SAMBA 运动鞋 B', images: ['https://static1.adidas.com.cn/t395/b.jpg'], variants: [
      { id: 'AA1004', title: 'SAMBA 运动鞋 D' },
    ] }),
    AA1003: adidasPDP({ id: 'AA1003', title: 'SAMBA 运动鞋 C', images: ['https://static1.adidas.com.cn/t395/c.jpg'] }),
    AA1004: adidasPDP({ id: 'AA1004', title: 'SAMBA 运动鞋 D', images: ['https://static1.adidas.com.cn/t395/d.jpg'] }),
  };
  const readPage = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/siteMap')
      return { url, html: '<a href="/pdp?articleId=JH6149">SAMBA GOLF 运动鞋</a>' };
    const id = parsed.searchParams.get('articleId');
    if (!pages[id]) throw Error('unexpected page');
    return { url, html: pages[id] };
  };
  const plan = {
    label: 'Adidas官方鞋履目录', domains: ['adidas.com.cn'], catalogue: 'adidas',
    catalogURL: 'https://www.adidas.com.cn/siteMap', catalogPages: 2,
    catalogProductLimit: 20, catalogImageLimit: 2, catalogResultLimit: 20, readerVersion: 5,
  };
  const run = checkpoint => {
    const plans = [plan];
    plans.excludedDomains = [];
    return searchPhotos({ subject: '阿迪达斯', days: 0, domains: [], sourceScope: 0 }, {
      plans, fetcher: async () => { throw Error('network not used'); }, readPage,
      readImage: async url => ({ bytes: Buffer.from(url), mime: 'image/jpeg', width: 800, height: 600 }),
      saveAsset: async () => {}, checkpoint,
    });
  };
  const first = await run(null);
  assert.deepEqual(new Set(first.items.map(item => item.productCode)), new Set(['JH6149', 'AA1001', 'AA1002']));
  assert.equal(first.checkpoint.visited.length, 2);
  assert(first.checkpoint.frontier.length > 0);
  const resumed = await run(first.checkpoint);
  const again = await run(resumed.checkpoint);
  const ids = again.items.map(item => item.productCode);
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.includes('AA1003'));
  assert(ids.includes('AA1004'));
});

test('Adidas serialized hero state is refused when malformed or expression-driven', () => {
  const url = 'https://www.adidas.com.cn/pdp?articleId=JH6149';
  const malformed = '<title>阿迪达斯-SAMBA GOLF 高尔夫运动鞋 | adidas</title><script>window.__NUXT__=(function(a){return {productSSRData:{articleId:a}}}(</script>';
  const sideEffect = '<title>阿迪达斯-SAMBA GOLF 高尔夫运动鞋 | adidas</title><script>window.__NUXT__=(function(a){return {data:[{productSSRData:{articleId:a,articleName:"SAMBA GOLF 高尔夫运动鞋",imageUrlList:["https:\\\\u002F\\\\u002Fstatic1.adidas.com.cn\\\\u002Ft395\\\\u002Fwrong.jpg"],plpImageUrl:"https:\\\\u002F\\\\u002Fstatic1.adidas.com.cn\\\\u002Fecp-product\\\\u002Fcdn-image\\\\u002Farticle\\\\u002FJH6149\\\\u002Fproduct\\\\u002Fplp\\\\u002F0\\\\u002FJH6149.jpg"}}]}}(globalThis.__adidasStateRan=true))</script>';
  assert.deepEqual(adidasProductPhotos(malformed, url), []);
  assert.deepEqual(adidasProductPhotos(sideEffect, url), []);
  assert.equal(globalThis.__adidasStateRan, undefined);
});

test('brand-scoped structured product evidence supports non-Nike models without a model whitelist', () => {
  assert(matchesProductIntent('新百伦', 'Classic 574', true, 'New Balance'));
  assert(matchesProductIntent('Puma', 'Speedcat', true, 'PUMA'));
  assert(matchesProductIntent('Adidas', 'Samba', true, 'Adidas'));
  assert(!matchesProductIntent('Adidas', 'Samba', true));
  assert(!matchesProductIntent('阿迪达斯', 'Puma Speedcat running shoes', true, 'PUMA'));
  assert(!matchesProductIntent('Nike', 'Adidas Samba running shoes', true, 'Adidas'));
  assert(!matchesProductIntent('New Balance', 'Nike Air Max sneakers', true, 'Nike'));
  assert(!matchesProductIntent('Adidas 麂皮女鞋', 'Adidas leather men loafers', true, 'Adidas'));
  assert(!matchesProductIntent('Adidas loafers', 'Adidas running sneakers', true, 'Adidas'));
  assert(!matchesProductIntent('新百伦', 'New Balance 574 T-shirt', true, 'New Balance'));
});

test('brand matrix keeps requested brand, footwear type, gender and material constraints', () => {
  const brandModels = [
    ['Nike', 'Air Max', 'Nike'],
    ['耐克', 'Air Jordan', 'Nike'],
    ['Adidas', 'Samba', 'Adidas'],
    ['阿迪达斯', 'Samba', 'Adidas'],
    ['New Balance', 'Classic 574', 'New Balance'],
    ['新百伦', 'Classic 574', 'New Balance'],
    ['Puma', 'Speedcat', 'Puma'],
    ['彪马', 'Speedcat', 'Puma'],
  ];
  for (const [subject, title, brand] of brandModels)
    assert(matchesProductIntent(subject, title, true, brand), `${subject} -> ${title}`);
  assert(matchesProductIntent('Nike shoes', 'Nike Air Max running shoes', false, ''));
  assert(matchesProductIntent('Adidas sneakers', 'Adidas Samba sneakers', false, ''));
  assert(matchesProductIntent('New Balance shoes', 'New Balance 574 sneakers', false, ''));
  assert(matchesProductIntent('Puma shoes', 'Puma Speedcat sneakers', false, ''));
  const crossBrands = [
    ['Adidas', 'Puma running shoes', 'PUMA'],
    ['阿迪达斯', 'Nike Air Max sneakers', 'Nike'],
    ['Nike', 'New Balance 574 sneakers', 'New Balance'],
    ['新百伦', 'Puma Speedcat sneakers', 'Puma'],
    ['Puma', 'Adidas Samba sneakers', 'Adidas'],
  ];
  for (const [subject, title, brand] of crossBrands)
    assert(!matchesProductIntent(subject, title, true, brand), `${subject} -> ${title}`);
  assert(!matchesProductIntent('Adidas shoes', 'Adidas running shoe bag', true, 'Adidas'));
  assert(!matchesProductIntent('Adidas shoes', 'Adidas performance shirt', true, 'Adidas'));
  assert(!matchesProductIntent('Adidas suede women shoes', 'Adidas leather men sneakers', true, 'Adidas'));
});

test('schema brand evidence supports arbitrary named brands while rejecting conflicting evidence', () => {
  assert(matchesProductIntent('Gucci', 'Horsebit loafer', true, 'Gucci'));
  assert(matchesProductIntent('Gucci suede women loafers', 'Horsebit suede women loafers', true, 'Gucci'));
  assert(matchesProductIntent('Miu Miu', 'Arcadie mule', true, 'Miu Miu'));
  assert(!matchesProductIntent('Gucci', 'Horsebit loafer', true, 'Miu Miu'));
  assert(!matchesProductIntent('Miu Miu', 'Arcadie mule', true, 'Gucci'));
  assert(!matchesProductIntent('Gucci suede women loafers', 'Horsebit leather men loafers', true, 'Gucci'));
  assert(!matchesProductIntent('Gucci', 'Gucci Horsebit loafer bag', true, 'Gucci'));
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
