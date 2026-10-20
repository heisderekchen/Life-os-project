import test from 'node:test';import assert from 'node:assert/strict';import {articleProductPhotos as f,structuredProductPhotos} from '../article-products.mjs';import {matchesProductIntent} from '../photo-search.mjs';
const rel=s=>/loafer|shoe/i.test(s);
const D='https://ex.test/a';
const card=(n,img,alt)=>`<div class="product-block-row"><div class="featured_product_block"><a data-model-name="${n}"><img src="${img}" alt="${alt}"></a></div></div>`;
test('shoe only',()=>{const h='<article>'+card('sam edelman Lana Tassel Loafer','https://cdn.ex.test/s.jpg','sam edelman, Lana Tassel Loafer')+card('bag x','https://cdn.ex.test/b.jpg','nice bag')+'</article>';const r=f(h,D,rel);assert.equal(r.length,1);assert.equal(r[0].image,'https://cdn.ex.test/s.jpg')});
test('title no shoe body yes',()=>{const h='<article><h1>Spring style</h1>'+card('sam edelman Lana Tassel Loafer','https://cdn.ex.test/s.jpg','sam edelman, Lana Tassel Loafer')+'</article>';assert.equal(f(h,D,rel).length,1)});
test('loafers hero only',()=>{const h='<article>loafers<img src="https://cdn.ex.test/hero.jpg" alt="loafers"></article>';assert.deepEqual(f(h,D,rel),[])});
test('bad img no cross',()=>{const h='<article>'+card('Loafer a','data:image/png;base64,xx','Loafer a')+card('Loafer b','https://cdn.ex.test/x.jpg','handbag')+card('Loafer c','https://cdn.ex.test/y.jpg','Loafer c')+'</article>';const r=f(h,D,rel);assert.equal(r.length,1);assert.equal(r[0].image,'https://cdn.ex.test/y.jpg')});
test('relative img',()=>{const h='<article>'+card('Loafer r','/i/r.jpg','Loafer r')+'</article>';assert.equal(f(h,D,rel)[0].image,'https://ex.test/i/r.jpg')});
test('sidebar outside article',()=>{const h='<article>'+card('Loafer in','https://cdn.ex.test/in.jpg','Loafer in')+'</article>'+card('Loafer out','https://cdn.ex.test/out.jpg','Loafer out');const r=f(h,D,rel);assert.equal(r.length,1);assert.equal(r[0].image,'https://cdn.ex.test/in.jpg')});
test('structured product data supports brands whose product name omits the brand and rejects other product types',()=>{
 const shoes=[{"@type":'Product',name:'Classic 574',category:'Footwear',brand:{'@type':'Brand',name:'New Balance'},sku:'NB574',url:'https://nb.ex.test/574',image:['https://cdn.ex.test/574-a.jpg','https://cdn.ex.test/574-b.jpg']},{"@type":'Product',name:'Logo Tee',category:'Apparel',brand:{'@type':'Brand',name:'New Balance'},image:'https://cdn.ex.test/tee.jpg'}];
 const h='<script type="application/ld+json">'+JSON.stringify({'@graph':shoes})+'</script>';
 const r=structuredProductPhotos(h,'https://nb.ex.test/catalogue',(s,b)=>/574/.test(s)&&b==='New Balance');
 assert.equal(r.length,2);assert(r.every(x=>x.productTypeEvidence==='footwear'));assert(r.every(x=>x.productCode==='NB574'));assert(r.every(x=>x.brandEvidence==='New Balance'));
});
test('structured product brand evidence supports Gucci and Miu Miu without arbitrary brand prefixes',()=>{
 const products=[
  {'@type':'Product',name:'Horsebit loafer',category:'Footwear',brand:{'@type':'Brand',name:'Gucci'},url:'https://lux.ex.test/gucci/1',image:'https://cdn.ex.test/gucci.jpg'},
  {'@type':'Product',name:'Arcadie mule',category:'Footwear',brand:{'@type':'Brand',name:'Miu Miu'},url:'https://lux.ex.test/miu/2',image:'https://cdn.ex.test/miu.jpg'},
  {'@type':'Product',name:'Horsebit bag',category:'Bags',brand:{'@type':'Brand',name:'Gucci'},url:'https://lux.ex.test/gucci/bag',image:'https://cdn.ex.test/bag.jpg'}
 ];
 const h='<script type="application/ld+json">'+JSON.stringify(products)+'</script>';
 const gucci=structuredProductPhotos(h,'https://lux.ex.test/catalogue',(title,brand)=>matchesProductIntent('Gucci loafers',title,true,brand));
 const miu=structuredProductPhotos(h,'https://lux.ex.test/catalogue',(title,brand)=>matchesProductIntent('Miu Miu mules',title,true,brand));
 assert.deepEqual(gucci.map(x=>x.brandEvidence),['Gucci']);
 assert.deepEqual(miu.map(x=>x.brandEvidence),['Miu Miu']);
});
