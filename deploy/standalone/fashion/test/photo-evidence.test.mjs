import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPhotos, imageDeclared, exportHTML, matchesIntent } from '../photo-search.mjs';

test('图片与原页面必须对应；失效、改款和重复图片均不混入结果', async () => {
  const good = { title: 'Women suede loafers', width: 1000, height: 800, image: 'https://cdn.example.com/good.jpg', url: 'https://example.com/products/good' };
  const candidates = [good, { ...good }, { ...good, image: 'https://cdn.example.com/mismatch.jpg', url: 'https://example.com/products/mismatch' }, { ...good, image: 'https://cdn.example.com/broken.jpg', url: 'https://example.com/products/broken' }, { ...good, image: 'https://cdn.example.com/wrong.jpg', url: 'https://example.com/products/wrong' }, { ...good, title: 'Manchester United football' }];
  const saved = [];
  const result = await searchPhotos({ subject: '女款 绒面 乐福鞋', days: 0, domains: [], sourceScope: 2 }, {
    plans: [],
    fetcher: async u => new Response(String(u).includes('/i.js?') ? JSON.stringify({ results: candidates }) : "vqd='4-123'"),
    readPage: async url => ({ url, html: `<title>${url.endsWith('wrong') ? 'Leather sandals' : good.title}</title><img src="https://cdn.example.com/${url.endsWith('mismatch') ? 'another' : url.split('/').at(-1)}.jpg">` }),
    readImage: async url => { if (url.includes('broken')) throw Error('404'); return { bytes: Buffer.from('real-fixture-bytes'), mime: 'image/jpeg' }; },
    saveAsset: async (sha, asset) => saved.push({ sha, asset }),
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].image, good.image);
  assert.equal(result.items[0].url, good.url);
  assert.equal(saved.length, 1);
  assert.deepEqual(result.channels[0].rejected, { imageSourceMismatch: 1, imageUnavailable: 1, sourceIntentMismatch: 1 });
  assert(!imageDeclared('<img src="https://other.example.com/good.jpg">', good.image));
  assert(matchesIntent('women suede loafers','女士绒面乐福鞋'));assert(matchesIntent('Nike shoes','NIKE 女款运动鞋'));assert(!matchesIntent('Nike shoes','Nike clothing')); 
  assert(!matchesIntent('black patent mary jane', 'Brown leather mary jane'));
  assert(!matchesIntent('leather mary jane', 'Faux Leather Mary Jane Shoes')); 
});

test('来源日期未知时限定时间不伪造新品，空查询不补历史图，渠道异常可区分', async () => {
  const candidate = { title: 'Minimalist leather sandals', width: 800, height: 800, image: 'https://cdn.example.com/sandal.jpg', url: 'https://example.com/products/sandal' };
  const dependencies = {
    plans: [], fetcher: async u => new Response(String(u).includes('/i.js?') ? JSON.stringify({ results: [candidate] }) : "vqd='4-123'"),
    readPage: async url => ({ url, html: `<title>${candidate.title}</title><img src="${candidate.image}">` }),
    readImage: async () => { assert.fail('不应读取日期未知的图片'); }, saveAsset: async () => {},
  };
  const filtered = await searchPhotos({ subject: candidate.title, days: 7, domains: [] }, dependencies);
  assert.equal(filtered.items.length, 0);
  assert.equal(filtered.channels[0].rejected.dateUnconfirmed, 1);
  const empty = await searchPhotos({ subject: 'zznonexistent loafer', days: 0, domains: [] }, { ...dependencies, fetcher: async u => new Response(String(u).includes('/i.js?') ? '{"results":[]}' : "vqd='4-123'") });
  assert.equal(empty.items.length, 0);
  await assert.rejects(searchPhotos({ subject: 'loafers', days: 0, domains: [] }, { ...dependencies, fetcher: async () => { throw Error('offline'); } }), /任务已保留/);
});

test('离线图片包逐张绑定原图、来源、核查依据和完整性摘要', () => {
  const item = { id: 'photo-1', title: 'Suede loafers', url: 'https://example.com/products/loafer?a=1&b=2', image: 'https://cdn.example.com/a.jpg', imageMime: 'image/jpeg', imageSha256: 'abc123', note: '原页面与鞋图对应', sourceCheckedAt: '2026-10-19T00:00:00Z' };
  const html = exportHTML({ input: { subject: 'Suede loafers' }, delivery: { createdAt: '2026-10-19', items: [item] } }, [Buffer.from('image-bytes')]);
  assert(html.includes('data:image/jpeg;base64,' + Buffer.from('image-bytes').toString('base64')));
  assert(html.includes('data-image-id="photo-1"'));
  assert(html.includes('https://example.com/products/loafer?a=1&amp;b=2'));
  assert(html.includes(item.image)); assert(html.includes(item.note)); assert(html.includes(item.imageSha256));
  assert(html.includes('不代表获得商用授权'));
});

test('主图片渠道失败后用 Bing 发现候选，仍核查来源而不填充假结果',async()=>{
 const candidate={t:'Women suede loafers',purl:'https://example.com/products/loafer',murl:'https://cdn.example.com/loafer.jpg'};
 const result=await searchPhotos({subject:'women suede loafers',days:0,domains:[],sourceScope:2},{plans:[],fetcher:async url=>{if(String(url).includes('bing.com/images'))return new Response(`<a m='${JSON.stringify(candidate)}'>shoe</a>`);throw Error('primary unavailable');},readPage:async url=>({url,html:`<title>Women suede loafers</title><img src="${candidate.murl}">`}),readImage:async()=>({bytes:Buffer.from('test-image'),mime:'image/jpeg'}),saveAsset:async()=>{}});
 assert.equal(result.items.length,1);assert(result.channels.some(c=>c.provider==='Bing Images'&&c.count===1));assert.equal(result.items[0].publishedAt,null);assert.equal(result.items[0].sourceImageMatched,true);
});
