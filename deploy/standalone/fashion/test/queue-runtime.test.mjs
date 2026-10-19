import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
async function setup(t,opts){const dir=await mkdtemp(join(tmpdir(),'fashion-full-queue-'));const app=createApp({dataDir:dir,guestPreview:true,...opts});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;const session=await fetch(base+'/session'),cookie=session.headers.get('set-cookie').split(';')[0],account=(await session.json()).account;
const call=async(path,data)=>{const response=await fetch(base+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});return{code:response.status,...await response.json()}};t.after(async()=>{await Promise.allSettled([...app.jobs.values()]);await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})});return{...app,dir,call,account};}
const input={subject:'nike',days:0,sourceScope:2,sources:['official','media','retail']};
test('HTTP queue runs all 1000 planned sources and persists private records without exposing catalogue',async t=>{
 const entries=Array.from({length:200},(_,i)=>({label:'来源检索',domains:Array.from({length:5},(_,j)=>`source${i*5+j}.test`)}));let queries=0;
 const fetcher=async value=>{queries++;const u=String(value);if(u.includes('bing.com'))throw Error('fixture alternate unavailable');return u.includes('/i.js?')?Response.json({results:[]}):new Response("vqd='4-123'");};
 const {call,jobs,dir,account}=await setup(t,{planSources:async()=>entries,fetcher});
 const {task}=await call('/tasks',input);await Promise.all([...jobs.values()]);
 const r=await call('/tasks/'+task.id);assert.equal(r.task.status,'review');assert.equal(r.task.progress.plannedSources,1000);assert.equal(r.task.progress.queriedSources,1000);assert.equal(r.task.progress.failedSources,0);assert.equal(r.task.progress.matchedSources,0);assert.equal(r.task.sourceQueue,undefined);assert(!JSON.stringify(r).includes('source999.test'));assert(queries>=600);
 const stored=JSON.parse(await readFile(join(dir,account+'.json'),'utf8')).tasks[0];assert.equal(stored.sourceQueue.records.length,200);assert(stored.sourceQueue.records.every(r=>r.status==='done'));
});
test('retrying a readerVersion=2 task reruns its completed Nike record under the v3 catalogue adapter and retains human review',async t=>{
 const productURL='https://www.nike.com/t/nike-test-shoes/TEST-100';
 const imageId='11111111-1111-1111-1111-111111111111';
 const declaredImage=`https://static.nike.com/a/images/t_default/${imageId}/NIKE-TEST.png`;
 let catalogReads=0;
 const fetcher=async value=>{
   const u=new URL(String(value));
   if(u.hostname==='www.nike.com'&&u.pathname==='/w/shoes-y7ok'){
     catalogReads++;
     const product={productType:'FOOTWEAR',productCode:'TEST-100',copy:{title:'Nike Test',subTitle:"Men's Shoes"},
       pdpUrl:{url:productURL,canonicalUrl:'https://www.nike.com/t/nike-test-shoes'},colorwayImages:{portraitURL:declaredImage}};
     const wall={props:{pageProps:{initialState:{Wall:{pageData:{next:''},productGroupings:[{products:[product]}]}}}}};
     return new Response('<script id="__NEXT_DATA__">'+JSON.stringify(wall)+'</script>',{headers:{'content-type':'text/html; charset=utf-8'}});
   }
   if(u.hostname==='www.nike.com'&&u.pathname==='/t/nike-test-shoes/TEST-100')return new Response('<title>Nike Test Shoes</title><script id="__NEXT_DATA__">'+JSON.stringify({
     props:{pageProps:{selectedProduct:{productType:'FOOTWEAR',styleColor:'TEST-100',productInfo:{fullTitle:'Nike Test Shoes'},
       pdpUrl:{url:productURL,canonicalUrl:'https://www.nike.com/t/nike-test-shoes'},
       contentImages:[{properties:{portrait:{id:imageId,url:declaredImage}}}]}}}
   })+`</script><img src="${declaredImage}">`,{headers:{'content-type':'text/html; charset=utf-8'}});
   if(u.hostname==='static.nike.com'){
     const png=Buffer.alloc(100);png[0]=137;png.write('PNG',1);png.writeUInt32BE(800,16);png.writeUInt32BE(600,20);
     return new Response(png,{headers:{'content-type':'image/png'}});
   }
   throw Error('unexpected fixture URL '+u.href);
 };
 fetcher.trustedRelayHosts=new Set(['www.nike.com','static.nike.com']);
 const catalogPlan=[{id:'catalog-v3',label:'Nike官方鞋履目录',domains:['nike.com'],catalogURL:'https://www.nike.com/w/shoes-y7ok',
   catalogPages:1,catalogProductLimit:1,catalogImageLimit:2,catalogResultLimit:10,readerVersion:3,timeoutMs:5000}];
 const {call,jobs,dir,account}=await setup(t,{planSources:async()=>catalogPlan,fetcher});
 const now=new Date().toISOString();
 const oldItem={id:'abcdefabcdefabcd',title:'Nike old shoes',url:productURL,source:'nike.com',canonicalURL:'https://www.nike.com/t/nike-test-shoes',
   productCode:'TEST-OLD',clueKey:'nike:TEST-OLD',image:declaredImage,imageKind:'source-matched',imageSha256:'a'.repeat(64),imageMime:'image/png',
   sourceCheckedAt:now,sourceImageMatched:true,publishedAt:null,collectedAt:now,review:'verified',selected:true,note:'human review retained',summary:''};
 const oldTask={id:'0123456789abcdef01234567',input,status:'review',items:[oldItem],channels:[],message:'',createdAt:now,updatedAt:now,delivery:null,
   progress:{stage:'done',accepted:1},sourceQueue:{readerVersion:2,plannedSources:1,queriedSources:1,matchedSources:1,failedSources:0,pendingSources:0,
     records:[{id:'catalog-v3',label:'Nike官方鞋履目录',domains:['nike.com'],readerVersion:2,status:'done',matchedDomains:['nike.com'],
       sourceChecks:[{domain:'nike.com',status:'queried'}]}]}};
 await writeFile(join(dir,account+'.json'),JSON.stringify({tasks:[oldTask]}));
 const retried=await call('/tasks/0123456789abcdef01234567/retry',{});
 assert.equal(retried.code,200);
 await Promise.all([...jobs.values()]);
 assert.equal(catalogReads,1);
 const final=(await call('/tasks/0123456789abcdef01234567')).task;
 const stored=JSON.parse(await readFile(join(dir,account+'.json'),'utf8')).tasks[0];
 assert.equal(stored.sourceQueue.records[0].readerVersion,3);
 assert.equal(stored.sourceQueue.records[0].status,'done');
 assert.equal(stored.sourceQueue.readerVersion,3);
 const retained=final.items.find(item=>item.id===oldItem.id);
 assert.equal(retained.review,'verified');
 assert.equal(retained.selected,true);
 assert.equal(retained.note,'human review retained');
 assert(final.items.some(item=>item.productCode==='TEST-100'&&item.clueKey==='nike:TEST-100'));
});
test('review retry refreshes catalogue and media sources for new items while error retry remains resumable',async t=>{
 const makeProduct=number=>{
   const code=`TEST-${number}`;
   const id=`11111111-1111-1111-1111-${String(number).padStart(12,'0')}`;
   return {code,url:`https://www.nike.com/t/nike-test-${number}/${code}`,image:`https://static.nike.com/a/images/t_default/${id}/NIKE-TEST-${number}.png`,id};
 };
 let products=[makeProduct(1)];
 let mediaArticles=[1];
 let mediaFeedReads=0;
 let catalogReads=0;
 const fetcher=async value=>{
   const u=new URL(String(value));
   if(u.hostname==='www.nike.com'&&u.pathname==='/w/shoes-y7ok'){
     catalogReads++;
     const wallProducts=products.map(p=>({productType:'FOOTWEAR',productCode:p.code,copy:{title:`Nike Test Shoes ${p.code}`,subTitle:"Men's Shoes"},
       pdpUrl:{url:p.url,canonicalUrl:p.url.split('/').slice(0,-1).join('/')},colorwayImages:{portraitURL:p.image}}));
     return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{initialState:{Wall:{pageData:{next:''},productGroupings:[{products:wallProducts}]}}}}})+'</script>',
       {headers:{'content-type':'text/html; charset=utf-8'}});
   }
   if(u.hostname==='media.test'&&u.pathname==='/feed.xml'){
     mediaFeedReads++;
     const items=mediaArticles.map(number=>`<item><title>Nike Shoes Article ${number}</title><link>https://media.test/loafers-${number}</link><pubDate>${new Date(Date.now()-number*86400000).toUTCString()}</pubDate></item>`).join('');
     return new Response(`<rss><channel>${items}</channel></rss>`,{headers:{'content-type':'application/rss+xml'}});
   }
   const mediaNumber=Number(u.pathname.match(/^\/loafers-(\d+)$/)?.[1]||0);
   if(u.hostname==='media.test'&&mediaNumber){
     const image=`https://cdn.media.test/loafers-${mediaNumber}.png`;
     const published=new Date(Date.now()-mediaNumber*86400000).toISOString();
     return new Response(`<title>Nike Shoes Article ${mediaNumber}</title><meta property="og:image" content="${image}"><script type="application/ld+json">{"@type":"Article","datePublished":"${published}"}</script><img src="${image}">`,
       {headers:{'content-type':'text/html; charset=utf-8'}});
   }
   const product=products.find(p=>u.href===p.url);
   if(product){
     const selectedProduct={productType:'FOOTWEAR',styleColor:product.code,productInfo:{fullTitle:`Nike Test Shoes ${product.code}`},
       pdpUrl:{url:product.url,canonicalUrl:product.url.split('/').slice(0,-1).join('/')},
       contentImages:[{properties:{portrait:{id:product.id,url:product.image}}}]};
     return new Response(`<title>Nike Test Shoes ${product.code}</title><script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{selectedProduct}}})}</script><img src="${product.image}">`,
       {headers:{'content-type':'text/html; charset=utf-8'}});
   }
   if(u.hostname==='static.nike.com'){
     const png=Buffer.alloc(100);png[0]=137;png.write('PNG',1);png.writeUInt32BE(800,16);png.writeUInt32BE(600,20);png.writeUInt32BE(products.findIndex(p=>u.href.includes(p.id))+1,96);
     return new Response(png,{headers:{'content-type':'image/png'}});
   }
   if(u.hostname==='cdn.media.test'){
     const png=Buffer.alloc(100);png[0]=137;png.write('PNG',1);png.writeUInt32BE(800,16);png.writeUInt32BE(600,20);png.writeUInt32BE(20+Number(u.pathname.match(/(\d+)/)?.[1]||0),96);
     return new Response(png,{headers:{'content-type':'image/png'}});
   }
   throw Error('unexpected fixture URL '+u.href);
 };
 fetcher.trustedRelayHosts=new Set(['www.nike.com','static.nike.com','media.test','cdn.media.test']);
 const catalogPlan={id:'catalog-v3',label:'Nike官方鞋履目录',domains:['nike.com'],catalogURL:'https://www.nike.com/w/shoes-y7ok',
   catalogPages:1,catalogProductLimit:2,catalogImageLimit:2,catalogResultLimit:10,readerVersion:3,timeoutMs:5000};
 const mediaPlan={id:'media-feed',label:'媒体来源',domains:['media.test'],readerVersion:2,
   sources:[{domain:'media.test',url:'https://media.test/feed.xml',feedUrls:['https://media.test/feed.xml']}]};
 const {call,jobs,dir,account}=await setup(t,{planSources:async()=>[catalogPlan,mediaPlan],fetcher});
 const first=await call('/tasks',input);
 await Promise.all([...jobs.values()]);
 let current=(await call('/tasks/'+first.task.id)).task;
 const firstStored=JSON.parse(await readFile(join(dir,account+'.json'),'utf8')).tasks[0];
 assert.equal(current.items.length,2,JSON.stringify({task:current,queue:firstStored.sourceQueue}));
 assert.equal(catalogReads,1);
 assert.equal(mediaFeedReads,1);
 const catalogItem=current.items.find(item=>item.productCode==='TEST-1');
 const reviewed=await call('/tasks/'+first.task.id+'/review',{id:catalogItem.id,review:'verified',selected:true,note:'kept across fresh search'});
 assert.equal(reviewed.code,200);
 products=[...products,makeProduct(2)];
 mediaArticles=[...mediaArticles,2];
 const retry=await call('/tasks/'+first.task.id+'/retry',{});
 assert.equal(retry.code,200);
 await Promise.all([...jobs.values()]);
 current=(await call('/tasks/'+first.task.id)).task;
 const stored=JSON.parse(await readFile(join(dir,account+'.json'),'utf8')).tasks[0];
 assert.equal(catalogReads,2,JSON.stringify(stored.sourceQueue));
 assert.equal(mediaFeedReads,2,JSON.stringify(stored.sourceQueue));
 assert.equal(current.items.length,4,JSON.stringify(current.items));
 assert.equal(current.items.find(item=>item.productCode==='TEST-1').review,'verified');
 assert.equal(current.items.find(item=>item.productCode==='TEST-1').selected,true);
 assert(current.items.some(item=>item.productCode==='TEST-2'));
 assert(current.items.some(item=>item.url==='https://media.test/loafers-1'));
 assert(current.items.some(item=>item.url==='https://media.test/loafers-2'));
});
test('partial photos are available while remaining sources run beyond the short-search deadline',async t=>{
 let release;const gate=new Promise(r=>release=r);let held=true;
 const fetcher=async value=>{const u=new URL(value);if((u.searchParams.get('q')||'').includes('slow.test')&&held)await gate;
 if(u.hostname==='example.com')return new Response('<title>Nike shoes</title><img src="https://cdn.example.com/shoe.png">',{headers:{'content-type':'text/html'}});
 if(u.hostname==='cdn.example.com'){const png=Buffer.alloc(100);png[0]=137;png.write('PNG',1);png.writeUInt32BE(800,16);png.writeUInt32BE(600,20);return new Response(png,{headers:{'content-type':'image/png'}});}
 if(u.hostname.includes('bing.com'))throw Error('alternate unavailable');
 if(u.pathname==='/i.js')return Response.json({results:[{title:'Nike shoes',url:'https://example.com/shoe',image:'https://cdn.example.com/shoe.png'}]});return new Response("vqd='4-123'");};fetcher.trustedRelayHosts=new Set(['example.com','cdn.example.com']);
 const {call,jobs}=await setup(t,{searchTimeoutMs:100,planSources:async()=>[{label:'first',domains:['example.com']},{label:'slow',domains:['slow.test']}],fetcher});
 const {task}=await call('/tasks',input);let running;
 try{for(let i=0;i<40;i++){running=(await call('/tasks/'+task.id)).task;if(running.items.length)break;await new Promise(r=>setTimeout(r,5));}assert.equal(running.items.length,1);await new Promise(r=>setTimeout(r,120));running=(await call('/tasks/'+task.id)).task;assert.equal(running.status,'running');assert.equal(running.progress.plannedSources,2);assert.equal(running.progress.queriedSources,1);assert.equal(running.progress.matchedSources,1);assert.equal(running.progress.deadlineAt,null);
 const reviewed=await call('/tasks/'+task.id+'/review',{id:running.items[0].id,review:'verified',selected:true,note:'fixture source and photo matched'});assert.equal(reviewed.code,200);assert.equal(reviewed.task.status,'running');}finally{held=false;release();}
 await Promise.all([...jobs.values()]);const ended=(await call('/tasks/'+task.id)).task;assert.equal(ended.status,'review');assert.equal(ended.items.length,1);assert.equal(ended.progress.queriedSources,2);assert.equal(ended.items[0].selected,true);
});
