import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicProductPhotos, productAPIPhotos } from '../public-catalogue.mjs';
import { searchPhotos, sourceProductMatches, photoLimits, matchesIntent } from '../photo-search.mjs';
import { searchBroadPhotos } from '../broad-search.mjs';
const raw = (i, extra = {}) => ({ id: i + 1, handle: 'shoe-' + i, title: "Women's winter casual sneakers " + i,
  type: 'Shoes', vendor: 'Fixture', tags: ['Winter', 'female'], description: 'Insulated winter casual footwear.',
  images: [`https://cdn.example/shoe-${i}-side.jpg`, `https://cdn.example/shoe-${i}-top.jpg`], ...extra });
const input = { subject: '女款冬季休闲鞋', days: 0, domains: [], sourceScope: 2, sources: ['official', 'retail', 'media'] };
const fetcher = async url => url.endsWith('/chat/completions')
  ? Response.json({ choices: [{ message: { content: '{"intent":"women winter casual shoes","queries":["women winter casual shoes"]}' } }] })
  : Response.json({ results: [] });
fetcher.deepseekRelay = 'https://relay.example';

test('public product evidence binds handle and origin; clothing and unrelated products stay excluded', () => {
  const p=raw(1), url='https://brand.example/products/shoe-1';
  assert.equal(publicProductPhotos(p,'https://brand.example').length,2);
  assert.equal(publicProductPhotos(raw(1,{type:"Women's Clothing",title:'Ballet pink top'}),'https://brand.example').length,0);
  assert.equal(productAPIPhotos(JSON.stringify(p),url+'.js',url).length,2);
  assert.equal(productAPIPhotos(JSON.stringify(p),url+'.js','https://evil.example/products/shoe-1').length,0);
  assert.equal(productAPIPhotos(JSON.stringify(raw(2)),url+'.js',url).length,0);
  assert.equal(productAPIPhotos(JSON.stringify(p),'https://brand.example/products.json',url).length,0);
  assert(sourceProductMatches(JSON.stringify(p),url,{evidenceURL:url+'.js',image:p.images[0]},'women winter casual shoes'));
  assert(!sourceProductMatches(JSON.stringify(p),url,{evidenceURL:url+'.js',image:'https://cdn.example/other.jpg'},'women winter casual shoes'));
  assert(photoLimits(input).results >=100);
});

test('failed photo view preserves successful view; source data and exact bytes are required', async () => {
 const p=raw(1),url='https://brand.example/products/shoe-1';
 const result=await searchPhotos(input,{fetcher,plans:[{domains:['brand.example'],candidates:[{title:p.title,url,evidenceURL:url+'.js',viewLimit:2}]}],
  readPage:async()=>{throw Error('unexpected HTML read')},readDocument:async u=>({url:u,html:JSON.stringify(p)}),
  readImage:async u=>{if(u.includes('-top.'))throw Error('unavailable');return{bytes:Buffer.from(u),mime:'image/jpeg',width:1000,height:1000}},saveAsset:async()=>{}});
 assert(result.channels.every(c=>c.provider==='公开商品目录'));
 assert.equal(result.items.length,1); assert.equal(result.items[0].evidenceKind,'public-product-api');
 assert.equal(result.items[0].review,'pending');assert.equal(result.items[0].selected,false);
});

test('broad search replenishes after unavailable products and returns 100 downloaded distinct images', async () => {
 const plans=[{deepseek:true,domains:[]}]; plans.excludedDomains=[];
 const events=[]; const saved=new Set();let lastProgress;
 const result=await searchBroadPhotos(input,{fetcher,plans,target:100,catalogues:[{url:'https://catalogue-fixture.example',name:'Fixture',category:'official'}],
  readDocument:async u=>{
   if(u.includes('products.json'))return{url:u,html:JSON.stringify({products:Array.from({length:65},(_,i)=>raw(i))})};
   const i=Number(u.match(/shoe-(\d+)/)?.[1]);if(i<3)throw Error('original data unavailable');
   return{url:u,html:JSON.stringify(raw(i))};
  },readPage:async()=>{throw Error('unexpected HTML')},
  readImage:async u=>({bytes:Buffer.from(u),mime:'image/jpeg',width:900,height:900}),
  saveAsset:async hash=>saved.add(hash),onProgress:async p=>{lastProgress=p},trace:(type,data)=>events.push({type,data})});
 assert.equal(result.items.length,100);assert(saved.size>=100 && saved.size<=114);
 assert.equal(new Set(result.items.map(i=>i.imageSha256)).size,100);
 assert.equal(new Set(result.items.map(i=>i.clueKey)).size,50);
 assert(result.targetReached);assert.equal(lastProgress.accepted,100);
 assert(result.items.every(i=>i.sourceImageMatched&&i.evidenceURL&&i.review==='pending'&&!i.selected));
 assert(events.some(e=>e.type==='candidate.rejected'&&e.data.reason==='sourceUnavailable'));
 assert(events.some(e=>e.type==='broad.finished'&&e.data.targetReached));
});

test('empty sources stay below target with explicit trace; no invented or sample results', async () => {
 const plans=[{deepseek:true,domains:[]}]; plans.excludedDomains=['excluded.example'];
 const result=await searchBroadPhotos(input,{fetcher,plans,catalogues:[],readDocument:async()=>{throw Error('unexpected')},readPage:async()=>{throw Error('unexpected')},readImage:async()=>{throw Error('unexpected')},saveAsset:async()=>{}});
 assert.equal(result.items.length,0); assert.equal(result.targetReached,false);assert.match(result.message,/0 \/ 100/);
});

test('marketing tags and related color variants are not shoe season or color evidence', () => {
 const photos=publicProductPhotos(raw(1,{title:"Women's ballet mesh flat",description:'Everyday mesh shoes',tags:['winterpromo26','#shoe-white',"women's"],type:'Shoes'}),'https://brand.example');
 assert(!matchesIntent('women winter casual shoes',photos[0].intentEvidence,true));
 assert(!matchesIntent('women white shoes',photos[0].intentEvidence,true));
 assert(!matchesIntent('women winter casual shoes',"Women's winter strappy stiletto pumps for everyday wear",true));
});

test('similarity rejects resized duplicates and preserves different product views', async () => {
 const sharp=(await import('sharp')).default;
 const {imageFingerprint,similarImage}=await import('../image-quality.mjs');
 const svg=Buffer.from('<svg width="500" height="400"><rect width="500" height="400" fill="white"/><path d="M70 230 L200 100 L330 230 L440 240 L440 300 L70 300Z" fill="brown"/></svg>');
 const a=await sharp(svg).png().toBuffer(),b=await sharp(svg).resize(800,640).jpeg().toBuffer();
 const top=await sharp(Buffer.from('<svg width="500" height="400"><rect width="500" height="400" fill="white"/><ellipse cx="250" cy="200" rx="50" ry="160" fill="brown"/></svg>')).png().toBuffer();
 const [x,y,z]=await Promise.all([a,b,top].map(imageFingerprint));
 assert(similarImage(x,y));assert(!similarImage(x,z));
 await assert.rejects(imageFingerprint(Buffer.from('not an image')));
});

test('a white outsole and related white color tags do not turn a black shoe into a white sneaker', async () => {
 const {matchesPhotoProduct}=await import('../photo-search.mjs');
 const dark=publicProductPhotos(raw(2,{title:"Women's Tree Runner - Black (White Sole)",tags:['allbirds::hue => black','allbirds::hue => white'],description:'White rubber outsole. Womens sneakers.'}),'https://brand.example')[0];
 assert(!matchesPhotoProduct('women white sneakers',dark));
 const white=publicProductPhotos(raw(3,{title:"Women's Tree Runner - White",tags:['allbirds::hue => white'],description:'Women white sneakers.'}),'https://brand.example')[0];
 assert(matchesPhotoProduct('women white sneakers',white));
});
