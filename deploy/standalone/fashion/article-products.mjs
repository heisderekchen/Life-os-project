const ent=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x2F;/g,'/');
const copy=s=>typeof s==='string'?Buffer.from(s,'utf8').toString('utf8'):s;
const abs=(u,b)=>{try{const x=new URL(ent(u),b);return /^https?:$/.test(x.protocol)?x.href:null}catch{return null}};
const imgOf=b=>{const m=/<img\b[^>]*>/i.exec(b);if(!m)return null;const t=m[0];const a=/\balt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(t);if(!a)return null;const alt=ent(a[2]??a[3]??a[4]??'');const s=/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(t);if(!s)return null;return{alt,src:ent(s[2]??s[3]??s[4]??'')}};
export function articleProductPhotos(html,pageURL,isRelevant){
 if(typeof html!=='string')return[];let h=html;const am=/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(h);if(am)h=am[1];
 const re=/<div\b[^>]*class\s*=\s*("[^"]*\bproduct-block-row\b[^"]*"|'[^']*\bproduct-block-row\b[^']*'|[^\s>]*\bproduct-block-row\b[^\s>]*)[^>]*>/gi;const idx=[];let m;while((m=re.exec(h)))idx.push({s:m.index,e:m.index+m[0].length});
 const out=[],seen=new Set();
 for(let i=0;i<idx.length&&out.length<20;i++){const stop=i+1<idx.length?idx[i+1].s:h.length;let end=stop,depth=1;const tags=/<\/?div\b[^>]*>/gi;tags.lastIndex=idx[i].e;let tag;while((tag=tags.exec(h))&&tag.index<stop){depth+=/^<\//.test(tag[0])?-1:1;if(!depth){end=tag.index;break;}}const blk=h.slice(idx[i].e,end);
  // only featured_product_block if present
  let fb=blk;const f=/<div\b[^>]*class\s*=\s*("[^"]*\bfeatured_product_block\b[^"]*"|'[^']*\bfeatured_product_block\b[^']*')[^>]*>/i.exec(blk);if(f)fb=blk.slice(f.index+f[0].length);
  const dm=/\bdata-model-name\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(fb);if(!dm)continue;const name=ent(dm[2]??dm[3]??dm[4]??'');if(!name||!isRelevant(name))continue;
  const im=imgOf(fb);if(!im||!im.alt||!isRelevant(im.alt))continue;if(!im.src.trim()||/^(?:data|javascript):/i.test(im.src))continue;const url=abs(im.src,pageURL);if(!url||/^data:/i.test(url))continue;if(seen.has(url))continue;seen.add(url);out.push({title:copy(name),image:copy(url),url:pageURL});
 }
 return out;
}

function jsonNodes(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) jsonNodes(item, out);
    return out;
  }
  out.push(value);
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) jsonNodes(value[key], out);
  return out;
}

function absoluteURL(value, base) {
  if (typeof value === 'object' && value) value = value.url || value.contentUrl || value['@id'];
  if (typeof value !== 'string') return '';
  // Malformed Shopify values such as "https:files/photo.jpg" are not absolute
  // image evidence and must not resolve under the current product directory.
  if (/^https?:(?!\/\/)/i.test(value)) return '';
  const url = abs(value, base);
  return url && /^https?:$/.test(new URL(url).protocol) ? url : '';
}

export function productPageKey(value) {
  const u = new URL(value);
  const product = u.pathname.match(/\/(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/i);
  const path = product ? '/products/' + product[1] : u.pathname.replace(/\/$/, '');
  return u.hostname.toLowerCase().replace(/^www\./, '') + path;
}

export function structuredProductPhotos(html, pageURL, isRelevant) {
  if (typeof html !== 'string') return [];
  const out = [], seen = new Set();
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(ent(script[1]).trim()); } catch { continue; }
    for (const node of jsonNodes(data)) {
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (!types.some(type => /^Product(?:Group)?$/i.test(String(type || '')))) continue;
      const title = copy(ent(String(node.name || node.headline || '')).trim());
      const category = copy(ent(String(node.category || '')).trim());
      const description = copy(ent(String(node.description || '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000));
      const gender = copy(String(node.gender || node.audience?.suggestedGender || node.audience?.audienceType || ''));
      const intentEvidence = [title, category, description, gender, node.color || '', node.material || ''].filter(Boolean).join(' · ');
      const productURL = copy(absoluteURL(node.url || node.mainEntityOfPage, pageURL) || pageURL);
      const brandEvidence = copy(typeof node.brand === 'string' ? ent(node.brand)
        : ent(String(node.brand?.name || node.brand?.legalName || '')));
      const productTypeEvidence = /\b(?:footwear|shoes?|sneakers?|trainers?|boots?|sandals?)\b|鞋|靴/i.test(category + ' ' + title);
      if (!title || !productTypeEvidence || !isRelevant(title, brandEvidence, intentEvidence)) continue;
      const pathCode = (() => {
        try {
          const path = new URL(productURL).pathname;
          return path.match(/\/(\d{4,})\/?$/)?.[1] || '';
        } catch { return ''; }
      })();
      const images = Array.isArray(node.image) ? node.image : [node.image];
      for (const raw of images) {
        const image = copy(absoluteURL(raw, pageURL));
        if (!image || seen.has(image)) continue;
        seen.add(image);
        out.push({
          title,
          image,
          url: productURL,
          canonicalURL: productURL,
          productCode: copy(String(node.sku || node.mpn || node.productGroupID || pathCode)),
          productTypeEvidence: 'footwear',
          brandEvidence,
          intentEvidence,
          colorEvidence: [node.color || '', title.replace(/\([^)]*soles?[^)]*\)/gi, '')].join(' · '),
          schemaType: types.find(type => /^Product(?:Group)?$/i.test(String(type || ''))),
        });
      }
    }
  }
  return out.slice(0, 20);
}
