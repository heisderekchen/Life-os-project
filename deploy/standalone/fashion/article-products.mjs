const ent=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x2F;/g,'/');
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
  const im=imgOf(fb);if(!im||!im.alt||!isRelevant(im.alt))continue;if(!im.src.trim()||/^(?:data|javascript):/i.test(im.src))continue;const url=abs(im.src,pageURL);if(!url||/^data:/i.test(url))continue;if(seen.has(url))continue;seen.add(url);out.push({title:name,image:url,url:pageURL});
 }
 return out;
}
