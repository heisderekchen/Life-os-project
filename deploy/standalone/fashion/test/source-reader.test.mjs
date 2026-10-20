import test from 'node:test';
import assert from 'node:assert/strict';
import {readSourcePhotos} from '../source-reader.mjs';
import {matchesIntent,searchPhotos} from '../photo-search.mjs';
import {runSourceQueue} from '../source-queue.mjs';
const source={domain:'media.test',url:'https://media.test/',feedUrls:['https://media.test/comments/feed/','https://media.test/feed/']};
const article='<title>Nike Dunk Low Halloween Release</title><meta content="/shoe.jpg" property="og:image">';
const relevant=t=>matchesIntent('nike',t);
test('own RSS exposes dated shoe articles with original declared photos, not foreign or apparel links',async()=>{
 const xml='<rss><channel><item><title>Nike Dunk Low</title><link>https://media.test/nike-dunk</link><pubDate>Mon, 19 Oct 2026 00:00:00 GMT</pubDate></item><item><title>Nike shoes</title><link>https://foreign.test/shoe</link></item><item><title>Nike backpack</title><link>https://media.test/bag</link></item></channel></rss>';
 const r=await readSourcePhotos({sources:[source],readDocument:async u=>{assert.equal(u,source.feedUrls[1]);return{html:xml,url:u}},readPage:async u=>({url:u,html:article}),isRelevant:relevant});
 assert.equal(r.results.length,1);assert.equal(r.results[0].image,'https://media.test/shoe.jpg');assert.equal(r.results[0].publishedAt,'2026-10-19T00:00:00.000Z');assert.equal(r.checks[0].status,'queried');
});
test('feed failures fall back to own homepage; challenges and off-domain article redirects are not material',async()=>{
 const r=await readSourcePhotos({sources:[source],readDocument:async u=>{if(u.includes('/feed/'))throw Error('feed unavailable');return{url:u,html:'<a href="/nike-shoes">Nike shoes</a>'}},readPage:async()=>({url:'https://foreign.test/shoe',html:article}),isRelevant:relevant});assert.equal(r.results.length,0);assert.equal(r.checks[0].status,'queried');
 const denied=await readSourcePhotos({sources:[{domain:'bad.test',url:'https://bad.test/',feedUrls:[]}],readDocument:async u=>({url:u,html:'<title>Access Denied</title>'}),readPage:async()=>{assert.fail()},isRelevant:relevant});assert.equal(denied.checks[0].status,'error');
});
test('article image and publication date must be present in source evidence; Atom updated is not a publication date',async()=>{
 const xml='<feed><entry><title>Nike Mind 002</title><link href="https://media.test/mind" rel="alternate"/><updated>2026-10-19</updated></entry></feed>';
 const r=await readSourcePhotos({sources:[source],readDocument:async u=>({url:u,html:xml}),readPage:async u=>({url:u,html:'<title>Nike Mind 002</title><meta name="twitter:image" content="https://media.test/mind.jpg">'}),isRelevant:relevant});assert.equal(r.results.length,1);assert.equal(r.results[0].publishedAt,undefined);
});
test('structured product candidates precede navigation and category links in the bounded reader',async()=>{
 const productURL='https://media.test/pd/speedcat/398846';
 const product={'@type':'Product',name:'Speedcat OG Sneakers',url:productURL};
 const html=`<a href="/women/shoes">Women's shoes</a><a href="/men/shoes">Men's sneakers</a>
   <script type="application/ld+json">${JSON.stringify({'@type':'ItemList',itemListElement:[{'@type':'ListItem',item:product}]})}</script>`;
 const reads=[];
 const result=await readSourcePhotos({
   sources:[{domain:'media.test',url:'https://media.test/catalogue',feedUrls:[]}],
   readDocument:async url=>({url,html}),
   readPage:async url=>{reads.push(url);return{url,html:`<title>${url===productURL ? 'Speedcat OG Sneakers | PUMA' : 'Women Shoes'}</title><meta property="og:image" content="https://cdn.media.test/${url===productURL ? 'speedcat' : 'nav'}.jpg">`}},
   isRelevant:title=>/Speedcat/.test(title),
   isDiscoveryRelevant:title=>/Speedcat|sneakers?|shoes?/i.test(title),
 });
 assert.equal(reads[0],productURL);
 assert.equal(result.results.length,1);
});
test('scope-ignoring search responses are failures rather than evidence of an empty source',async()=>{
 const c={title:'Nike shoes',url:'https://foreign.test/shoe',image:'https://foreign.test/shoe.jpg'};
 await assert.rejects(searchPhotos({subject:'nike',sourceScope:0,days:0,domains:[]},{plans:[{label:'source',domains:['media.test']}],fetcher:async u=>new Response(String(u).includes('/i.js?')?JSON.stringify({results:[c]}):String(u).includes('bing.com')?`<a m='${JSON.stringify({t:c.title,purl:c.url,murl:c.image})}'>shoe</a>`:"vqd='4-123'"),readPage:async()=>{assert.fail()},readImage:async()=>{assert.fail()},saveAsset:async()=>{}}),/暂不可用/);
});
test('actual document failures are counted per domain and retry clears only repaired failures',async()=>{
 const entries=[{domains:['a.test','b.test'],label:'sources'}];const first=await runSourceQueue({entries,runEntry:async()=>({items:[{url:'https://a.test/shoe'}],sourceChecks:[{domain:'a.test',status:'queried'},{domain:'b.test',status:'error',error:'403'}]})});assert.equal(first.queriedSources,2);assert.equal(first.failedSources,1);assert.equal(first.matchedSources,1);
 let calls=0;const fixed=await runSourceQueue({entries,previous:first.records,retryFailed:true,runEntry:async()=>{calls++;return{items:[{url:'https://b.test/shoe'}],sourceChecks:[{domain:'a.test',status:'queried'},{domain:'b.test',status:'queried'}]}}});assert.equal(calls,1);assert.equal(fixed.failedSources,0);assert.equal(fixed.matchedSources,2);
});
