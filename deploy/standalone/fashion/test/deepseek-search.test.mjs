import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepseekDiscover } from '../deepseek-search.mjs';
import { searchPhotos } from '../photo-search.mjs';
import { isTargetPage } from '../target-page.mjs';

test('DeepSeek uses English queries, returns only retrieved URLs and reports provider failures', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'fixture-not-a-real-key';
  try {
    const requests = [];
    const found = await deepseekDiscover({ subject: '女款小白鞋', domains: [] }, 'women white sneakers', async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: '{"queries":["women white sneakers"]}' } }] });
      return Response.json({ results: [{ title: 'Women white sneakers', url: 'https://brand.example/products/white', rerank_score: 2 }] });
    });
    assert.equal(requests[1].url, 'https://api.deepseek.com/v1/tools/search');
    assert(!/[\u3400-\u9fff]/.test(requests[1].body.query));
    assert.equal(found[0].results[0].url, 'https://brand.example/products/white');
    const failed = await deepseekDiscover({ subject: '鞋' }, 'shoes', async () => new Response('unavailable', { status: 503 }));
    assert.equal(failed[0].results.length, 0);
    assert.match(failed[0].error, /503/);
    assert(!JSON.stringify(failed).includes(process.env.DEEPSEEK_API_KEY));
  } finally { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; }
});

test('retrieved product pages without a search thumbnail still require declared image evidence', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'fixture-not-a-real-key';
  try {
    const image = 'https://cdn.example/white.jpg';
    const result = await searchPhotos({ subject: '薄荷绿女款低帮鞋', domains: [], sourceScope: 1, days: 0 }, {
      plans: [{ deepseek: true, domains: [] }],
      fetcher: async url => url.endsWith('/chat/completions')
        ? Response.json({ choices: [{ message: { content: '{"intent":"women mint green low top sneakers","queries":["women mint green low top sneakers"]}' } }] })
        : Response.json({ results: [
          { title: 'Women mint green low top sneakers', url: 'https://brand.example/collections/women/products/white' },
          { title: 'Women mint green low top sneakers', url: 'https://lyst.com/shoes/white' },
        ] }),
      readPage: async url => ({ url, html: '<title>Women mint green low top sneakers</title><script type="application/ld+json">' + JSON.stringify({ '@type': 'Product', name: 'Women mint green low top sneakers', category: 'shoes', image }) + '</script>' }),
      readImage: async () => ({ bytes: Buffer.from('verified-image-fixture'), mime: 'image/jpeg' }),
      saveAsset: async () => {},
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sourceImageMatched, true);
    assert.equal(result.items[0].searchIntent, 'women mint green low top sneakers');
    assert.equal(result.items[0].image, image);
    assert.equal(result.channels[0].discovered, 2);
    assert.equal(result.channels[0].prefilterRejected, 1);
    assert(isTargetPage('https://brand.example/collections/women/products/white'));
    assert(!isTargetPage('https://brand.example/collections/women'));
  } finally { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; }
});

test('paid guest search budget survives guest cookie changes and bounds the global daily total', async () => {
  const {createSearchBudget}=await import('../search-budget.mjs');
  let time=0;
  const allow=createSearchBudget({perHour:2,perDay:3,now:()=>time});
  assert(allow('client-A')); assert(allow('client-A')); assert(!allow('client-A'));
  assert(allow('client-B')); assert(!allow('client-C'));
  time=3600001; assert(!allow('client-A'));
  time=86400001; assert(allow('client-A'));
});
