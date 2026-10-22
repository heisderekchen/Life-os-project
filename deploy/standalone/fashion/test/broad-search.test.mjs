import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicProductPhotos, productAPIPhotos } from '../public-catalogue.mjs';
import { searchPhotos, sourceProductMatches, photoLimits, matchesIntent } from '../photo-search.mjs';
import { searchBroadPhotos, createCatalogueCache, CATALOGUE_CACHE_BYTES, catalogueRetryDelay, broadBackfillQueries } from '../broad-search.mjs';
import { packCatalogueDocument, restoreCatalogueDocument, catalogueSnapshotEvent } from '../catalogue-cache.mjs';
const raw = (i, extra = {}) => ({ id: i + 1, handle: 'shoe-' + i, title: "Women's winter casual sneakers " + i,
  type: 'Shoes', vendor: 'Fixture', tags: ['Winter', 'female'], description: 'Insulated winter casual footwear.',
  images: [`https://cdn.example/shoe-${i}-side.jpg`, `https://cdn.example/shoe-${i}-top.jpg`], ...extra });
const input = { subject: '女款冬季休闲鞋', days: 0, domains: [], sourceScope: 2, sources: ['official', 'retail', 'media'] };
test('additional catalogue adapters cannot crowd external publishers out of the bounded backfill plan', () => {
 const queries=broadBackfillQueries('women black loafers',Array.from({length:15},(_,i)=>({url:'https://brand'+i+'.test'})));
 assert.equal(queries.length,12);
 for(const domain of ['clarks.com','camper.com','ecco.com','nordstrom.com'])assert(queries.includes('women black loafers site:'+domain));
});
test('compressed catalogue cache and chunked debug snapshots restore exact source bytes', async () => {
 const {randomBytes}=await import('node:crypto');const {gunzipSync}=await import('node:zlib');
 const html=JSON.stringify({products:[raw(1,{body_html:randomBytes(100000).toString('hex')})]});
 const packed=packCatalogueDocument({url:'https://brand.test/products.json',html,fetchedAt:'2026-10-23T00:00:00.000Z'});
 assert.equal(packed.html,undefined);assert.equal(packed.parsed,undefined);assert.equal(packed.data,undefined);
 assert.equal(restoreCatalogueDocument(packed).html,html);assert.equal(restoreCatalogueDocument(packed).parsed.products[0].id,2);
 const snapshot=catalogueSnapshotEvent(packed);assert(snapshot.chunks.length>1);assert(snapshot.chunks.every(s=>s.length<=32768));
 assert.equal(gunzipSync(Buffer.from(snapshot.chunks.join(''),'base64')).toString(),html);
 assert.throws(()=>restoreCatalogueDocument({...packed,sha256:'0'.repeat(64)}),/校验失败/);
});
test('explicit storefront category and one-color options qualify their own product, not other variants', async () => {
 const {matchesPhotoProduct}=await import('../photo-search.mjs');
 const p=publicProductPhotos(raw(1,{title:'The Una',type:'',description:'Leather penny loafer',tags:['_filter_category Loafer','_filter_super_category Shoes','_filter_gender Women','_filter_color Black'],options:[{name:'Color',values:['Black Nappa']}]}),'https://brand.test')[0];
 assert(p);assert(matchesPhotoProduct('women black loafers',p));
 const mixed=publicProductPhotos(raw(2,{title:"Women's penny loafer",type:'Loafers',description:'Classic leather loafers',tags:['female'],options:[{name:'Color',values:['Black','Tan']}]}),'https://brand.test')[0];
 assert(!matchesPhotoProduct('women black loafers',mixed));
 assert.equal(publicProductPhotos(raw(3,{title:'Loafer printed top',type:'',tags:['_filter_super_category Clothing','_filter_category Top']}),'https://brand.test').length,0);
});
test('M.Gemi campaign photographs cannot replace identifiable own-product views', () => {
 const p=raw(20,{title:'The Una (Sample Sale)',images:['https://cdn.test/123_TheUna_Black_Nappa.jpg','https://cdn.test/TT18609-campaign.jpg']});
 const photos=publicProductPhotos(p,'https://mgemi.com');
 assert.equal(photos.length,1);assert(photos[0].image.includes('TheUna'));assert.equal(photos[0].excludedGalleryImages,1);
 assert.equal(publicProductPhotos(p,'https://another-brand.test').length,2);
 assert.equal(publicProductPhotos({...p,images:[p.images[1],p.images[0]]},'https://mgemi.com')[0].imagePosition,2);
 const unknown=publicProductPhotos({...p,images:['https://cdn.test/photo1.jpg','https://cdn.test/photo2.jpg']},'https://mgemi.com');assert.equal(unknown.length,1);
});
test('third-page official evidence precedes verification of unrelated web fallback candidates', async () => {
 const pages=[];let webReads=0;
 const f=async u=>String(u).endsWith('/chat/completions')?fetcher(String(u)):Response.json({results:[{title:'Women winter casual shoes',url:'https://unreviewed.test/products/shoe'}]});f.deepseekRelay='https://relay.example';
 const result=await searchBroadPhotos(input,{fetcher:f,plans:[{deepseek:true,domains:[]}],target:5,catalogues:[{url:'https://pages.test',name:'Pages',category:'official'}],
  readDocument:async url=>{const page=Number(new URL(url).searchParams.get('page')||1);pages.push(page);const rows=[raw(1000+page)];if(page<3)for(let i=0;i<249;i++)rows.push(raw(2000+i,{type:'Clothing',title:'Top'}));return{url,html:JSON.stringify({products:rows})};},
  readPage:async()=>{webReads++;throw Error('unexpected web fallback')},readImage:async url=>({bytes:Buffer.from(url),mime:'image/jpeg',width:800,height:800}),saveAsset:async()=>{}});
 assert.equal(result.items.length,5);assert.deepEqual(pages,[1,2,3]);assert.equal(webReads,0);
});
test('catalogue cache retains the observed twelve-page working set and refreshes recently used pages', () => {
 const cache=createCatalogueCache();
 const sizes=[2629804,1293851,1760191,2990535,2325805,1450389,2085941,2005833,2396650,1397153,2110313,2781348];
 const key=i=>'https://brand-'+Math.floor(i/2)+'.test/products.json?page='+(i%2+1);
 sizes.forEach((bytes,i)=>cache.set(key(i),{i},bytes*3));
 for(let i=0;i<30;i++)cache.set('https://deep.test/products.json?page='+(i+3),{i},3*1024*1024);
 sizes.forEach((_,i)=>assert.equal(cache.get(key(i))?.i,i));
 assert(cache.bytes <= CATALOGUE_CACHE_BYTES);
 const small=createCatalogueCache(16),url=k=>'https://'+k+'.test/products.json';small.set(url('a'),1,4);small.set(url('b'),2,4);small.set(url('c'),3,4);assert.equal(small.get(url('a')),1);small.set(url('d'),4,4);assert.equal(small.get(url('b')),undefined);assert.equal(small.get(url('a')),1);assert.equal(small.bytes,12);
});
test('catalogue 429 handling respects a one-minute retry period and preserves diagnostic status', async () => {
 const {errorDetails}=await import('../search-trace.mjs');const {getPublic}=await import('../server.mjs');
 const f=async()=>new Response('Rate limited',{status:429,headers:{'retry-after':'60'}});f.trustedRelayHosts=new Set(['catalogue-retry.test']);
 let caught;try{await getPublic('https://catalogue-retry.test/products.json',f,0,true);}catch(e){caught=e;}
 assert.equal(caught.status,429);assert.equal(catalogueRetryDelay(caught),60000);assert.equal(errorDetails(caught).retryAfterMs,60000);
 assert.equal(catalogueRetryDelay({status:429,retryAfterMs:120000}),null);assert.equal(catalogueRetryDelay({status:403}),null);
 const at=Date.now()+60000;const dated=async()=>new Response('Rate limited',{status:429,headers:{'retry-after':new Date(at).toUTCString()}});dated.trustedRelayHosts=f.trustedRelayHosts;
 await assert.rejects(getPublic('https://catalogue-retry.test/products.json',dated,0,true),e=>e.retryAfterMs>58000&&e.retryAfterMs<=60000);
});
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

test('broad search replenishes after unavailable images and returns 100 downloaded distinct images', async () => {
 const plans=[{deepseek:true,domains:[]}]; plans.excludedDomains=[];
 const events=[]; const saved=new Set();let lastProgress;let documentReads=0;
 const result=await searchBroadPhotos(input,{fetcher,plans,target:100,catalogues:[{url:'https://catalogue-fixture.example',name:'Fixture',category:'official'}],
  readDocument:async u=>{
   documentReads++;
   if(u.includes('products.json'))return{url:u,html:JSON.stringify({products:Array.from({length:65},(_,i)=>raw(i))})};
   const i=Number(u.match(/shoe-(\d+)/)?.[1]);if(i<3)throw Error('original data unavailable');
   return{url:u,html:JSON.stringify(raw(i))};
  },readPage:async()=>{throw Error('unexpected HTML')},
  readImage:async u=>{if(/shoe-[012]-/.test(u))throw Error('unavailable image');return{bytes:Buffer.from(u),mime:'image/jpeg',width:900,height:900}},
  saveAsset:async hash=>saved.add(hash),onProgress:async p=>{lastProgress=p},trace:(type,data)=>events.push({type,data})});
 assert.equal(result.items.length,100);assert(saved.size>=100 && saved.size<=114);
 assert.equal(new Set(result.items.map(i=>i.imageSha256)).size,100);
 assert.equal(new Set(result.items.map(i=>i.clueKey)).size,50);
 assert(result.targetReached);assert.equal(lastProgress.accepted,100);assert.equal(documentReads,1);
 assert(result.items.every(i=>i.evidenceKind==='public-product-catalogue'&&i.sourceDocumentSHA256&&i.evidenceFetchedAt));
 assert(result.items.every(i=>i.sourceImageMatched&&i.evidenceURL&&i.review==='pending'&&!i.selected));
 assert(events.some(e=>e.type==='candidate.rejected'&&e.data.reason==='imageUnavailable'));
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

test('a malformed retrieved URL is recorded and cannot abort replenishment', async () => {
 const f=async url=>url.endsWith('/chat/completions')?Response.json({choices:[{message:{content:'{"intent":"women winter casual shoes","queries":["women winter casual shoes"]}'}}]}):Response.json({results:[{title:'Women winter casual shoes',url:'not-a-url'}]});
 f.deepseekRelay='https://relay.example';const plans=[{deepseek:true,domains:[]}];plans.excludedDomains=['excluded.example'];const events=[];
 const result=await searchBroadPhotos(input,{fetcher:f,plans,catalogues:[],trace:(type,data)=>events.push({type,data}),readDocument:async()=>{throw Error('unexpected read')},readImage:async()=>{throw Error('unexpected image')},saveAsset:async()=>{}});
 assert.equal(result.items.length,0);assert(events.some(e=>e.data.reason==='invalidURL'));
});

test('combined flat/loafer navigation tags are excluded; generic audience category can still carry explicit footwear', async () => {
 const {matchesPhotoProduct}=await import('../photo-search.mjs');
 const flat=publicProductPhotos(raw(1,{title:'GROVE GREEN',type:"Women's Shoes",description:'A mesh ballet flat for everyday wear.',tags:["women's",'loafers-flats','Type:Flats','Style:Ballet']}),'https://brand.example')[0];
 assert(!matchesPhotoProduct('women loafers',flat));
 assert(matchesPhotoProduct('women ballet flats',flat));
 const loafer=publicProductPhotos(raw(2,{title:"Women's leather loafers",type:'WOMAN',description:'Penny loafers',tags:['Woman','Loafers']}),'https://brand.example')[0];
 assert(loafer);assert(matchesPhotoProduct('women loafers',loafer));
 const kids=publicProductPhotos(raw(3,{title:'Girls winter casual sneakers',type:'Shoes',tags:['female','Girls','Winter']}),'https://brand.example')[0];
 assert(!matchesPhotoProduct('women winter casual shoes',kids));
 const boot=publicProductPhotos(raw(4,{title:"Women's ankle boots",type:'Boots',description:'Ballet flats inspired shoes',tags:['female']}),'https://brand.example')[0];
 assert(!matchesPhotoProduct('women ballet flats',boot));
});

test('ballet-inspired high heels and generic lace-up flats cannot count as ballet flats', async () => {
 const {matchesPhotoProduct}=await import('../photo-search.mjs');
 for(const tags of [['female','Type:Heels','Style:Ballet'],['female','Type:Heels','Style:Platform']]) {
  const p=publicProductPhotos(raw(1,{title:'SOFIE BLUSH SATIN',type:"Women's Shoes",description:'Ballet-inspired heel with a bow. 4 inch heel height.',tags}),'https://brand.example')[0];
  assert(!matchesPhotoProduct('women ballet flats',p));
 }
 const lace=publicProductPhotos(raw(2,{title:'Grey leather flat shoes',type:"Women's Shoes",description:'Flat lace-up shoes. Browse ballet flats.',tags:['female','Type:Flats']}),'https://brand.example')[0];
 assert(!matchesPhotoProduct('women ballet flats',lace));
 const real=publicProductPhotos(raw(3,{title:'BELINDA BLACK',type:"Women's Shoes",description:'Ballet flats with a bow, .25 inch heel.',tags:['female','Type:Flats','Style:Ballet']}),'https://brand.example')[0];
 assert(matchesPhotoProduct('women ballet flats',real));
});

test('almost black and empty white images are rejected as unusable visual clues', async () => {
 const sharp=(await import('sharp')).default;const {imageFingerprint}=await import('../image-quality.mjs');
 for(const color of ['#050505','#ffffff']){const bytes=await sharp({create:{width:800,height:600,channels:3,background:color}}).jpeg().toBuffer();await assert.rejects(imageFingerprint(bytes),e=>e.code==='IMAGE_QUALITY')}
});

test('bulk first-party evidence binds exact product ID, handle, origin and its own image list', () => {
 const a=raw(40),b=raw(41),url='https://brand.example/products/shoe-40',proof='https://brand.example/products.json?limit=250&page=2';
 const body=JSON.stringify({products:[a,b]});
 assert.equal(productAPIPhotos(body,proof,url,String(a.id)).length,2);
 assert.equal(productAPIPhotos(body,proof,url,String(b.id)).length,0);
 assert.equal(productAPIPhotos(body,proof,url,'missing').length,0);
 assert.equal(productAPIPhotos(body,proof,url).length,0);
 assert.equal(productAPIPhotos(body,proof.replace('brand.example','other.example'),url,String(a.id)).length,0);
 assert.equal(productAPIPhotos(body,proof+'&token=x',url,String(a.id)).length,0);
 assert.equal(productAPIPhotos(JSON.stringify({products:[a,a]}),proof,url,String(a.id)).length,0);
 assert(sourceProductMatches(body,url,{evidenceURL:proof,productCode:String(a.id),image:a.images[0]},'women winter casual shoes'));
 assert(!sourceProductMatches(body,url,{evidenceURL:proof,productCode:String(a.id),image:b.images[0]},'women winter casual shoes'));
});

test('delivery rechecks one shared catalogue once and verifies moved records through their own product API', async t => {
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{createHash}=await import('node:crypto');const{createApp}=await import('../server.mjs');const sharp=(await import('sharp')).default;
 const dir=await mkdtemp(join(tmpdir(),'bulk-delivery-'));await mkdir(join(dir,'assets'));
 const proof='https://bulk.test/products.json?limit=250';const products=[raw(70),raw(71)];const items=[];
 for(const [i,p]of products.entries()) {const bytes=await sharp({create:{width:600,height:600,channels:3,background:i?'#bea07b':'#806030'}}).png().toBuffer();const hash=createHash('sha256').update(bytes).digest('hex');await writeFile(join(dir,'assets',hash),bytes);items.push({id:String(i),title:p.title,url:'https://bulk.test/products/'+p.handle,productCode:String(p.id),evidenceURL:proof,evidenceKind:'public-product-catalogue',image:p.images[0],imageSha256:hash,imageMime:'image/png',sourceImageMatched:true,review:'verified',selected:true,note:'Synthetic fixture: source and image match.'});}
 const taskId='a'.repeat(24);await writeFile(join(dir,'demo-a.json'),JSON.stringify({tasks:[{id:taskId,input:{subject:'women winter casual shoes',days:0,domains:[]},status:'review',items,channels:[],delivery:null}]}));
 let mode='full';const requests=[];const f=async u=>{u=String(u);requests.push(u);if(u.includes('products.json'))return Response.json({products:mode==='full'?products:[products[1]]});return Response.json(mode==='wrong'?raw(99):products[0])};f.trustedRelayHosts=new Set(['bulk.test']);
 const app=createApp({dataDir:dir,fetcher:f});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+app.server.address().port+'/api';const login=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:'{"account":"demo-a"}'});const cookie=login.headers.get('set-cookie').split(';')[0];
 const call=async path=>{const r=await fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});return{status:r.status,data:await r.json()}};
 let result=await call('/tasks/'+taskId+'/deliver');assert.equal(result.status,200);assert.equal(result.data.task.delivery.items.length,2);assert.equal(requests.filter(u=>u===proof).length,1);
 await call('/tasks/'+taskId+'/reopen');mode='moved';requests.length=0;result=await call('/tasks/'+taskId+'/deliver');assert.equal(result.status,200);assert.equal(requests.filter(u=>u===proof).length,1);assert(requests.includes(items[0].url+'.js'));
 await call('/tasks/'+taskId+'/reopen');mode='wrong';result=await call('/tasks/'+taskId+'/deliver');assert.equal(result.status,400);
});

test('a Heel Height field on a sneaker is not high-heel shoe evidence; primary type aliases retain meaning', async () => {
 const {matchesPhotoProduct}=await import('../photo-search.mjs');
 const sneaker=publicProductPhotos(raw(1,{title:"Women's white sneakers",description:'Heel Height: 0.5 inches',tags:['female','Heel Height:Flat (0-1 inch)']}),'https://brand.example')[0];assert(!matchesPhotoProduct('women heels',sneaker));
 const heel=publicProductPhotos(raw(2,{title:"Women's court shoes",type:'Shoes',description:'Heel Height: 5 cm',tags:['female']}),'https://brand.example')[0];assert(matchesPhotoProduct('women heels',heel));
 const flat=publicProductPhotos(raw(3,{title:"Women's mesh ballet flats",description:'Ballet flats with jelly mule inspired design.',tags:['female','Type:Flats','Style:Ballet']}),'https://brand.example')[0];assert(!matchesPhotoProduct('women mules',flat));
 assert(matchesIntent('women ballet flats','Women ballerinas',true));assert(matchesIntent('women sneakers','Women trainers',true));
});

test('a fresh date on another catalogue record cannot qualify an old product for a recent window', async () => {
 const p=raw(50,{published_at:'2020-01-01T00:00:00Z'}),other=raw(51,{datePublished:new Date().toISOString()});const url='https://date.test/products/shoe-50',proof='https://date.test/products.json?limit=250';
 const doc={url:proof,html:JSON.stringify({products:[p,other]})};let images=0;
 const result=await searchPhotos({...input,days:7},{fetcher,plans:[{domains:['date.test'],candidates:[{title:p.title,url,evidenceURL:proof,evidenceKind:'public-product-catalogue',productCode:String(p.id)}]}],
  evidenceDocuments:new Map([[proof,doc]]),readPage:async()=>{throw Error('unexpected')},readDocument:async()=>{throw Error('unexpected extra read')},readImage:async()=>{images++;throw Error('unexpected image')},saveAsset:async()=>{}});
 assert.equal(result.items.length,0);assert.equal(images,0);assert.equal(result.channels[0].rejected.outsideDateRange,1);
});
