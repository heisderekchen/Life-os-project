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

test('transient connection failures recover before translating an unmapped Chinese subject', async () => {
 const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='fixture-not-real';
 try {
  let planning=0,searching=0;
  const attempts=await deepseekDiscover({subject:'薄荷绿女款低帮鞋',domains:[]},'薄荷绿 women 低帮 shoes',async(url)=>{
   if(url.endsWith('/chat/completions')){
    planning++;if(planning<3)throw new TypeError('fetch failed');
    return Response.json({choices:[{message:{content:'{"intent":"women mint green low top sneakers","queries":["women mint green low top sneakers"]}'}}]});
   }
   searching++;if(searching<2)throw new TypeError('fetch failed');
   return Response.json({results:[{title:'Women mint green low top sneakers',url:'https://brand.example/products/mint'}]});
  });
  assert.equal(attempts[0].planningAttempts,3);assert.equal(attempts[0].transportAttempts,2);
  assert.equal(attempts[0].planningError,undefined);assert.equal(attempts[0].results.length,1);
  assert(!/[\u3400-\u9fff]/.test(attempts[0].query));
 }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});

test('query expansion cannot weaken white sneakers or ankle boots into generic shoes', async () => {
 const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='fixture-not-real';
 try {
  for(const [subject,canonical]of [['女款小白鞋','women white sneakers'],['女款短靴','women ankle boots'],['女款冬季休闲鞋','women winter casual shoes']]){
   const events=[];
   const found=await deepseekDiscover({subject,domains:[]},canonical,async url=>url.endsWith('/chat/completions')
    ? Response.json({choices:[{message:{content:'{"intent":"women white shoes","queries":["women white shoes"]}'}}]})
    : Response.json({results:[]}),undefined,(type,data)=>events.push({type,data}));
   assert.equal(found[0].intent,canonical);assert(events.some(e=>e.type==='planning.constraints.locked'&&e.data.intent===canonical));
  }
 }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old}
});
