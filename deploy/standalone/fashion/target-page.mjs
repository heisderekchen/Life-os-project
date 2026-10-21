export function isTargetPage(url){
  let p;try{const u=new URL(url);if(!/^https?:$/.test(u.protocol))return false;p=u.pathname}catch{return false}
  const s=p.split('/').filter(Boolean);
  // Shopify product URLs may include their collection prefix.
  if(s.indexOf('products') === s.length-2 && s.length >= 2)return true;
  if(s.some(segment => segment.toLowerCase() === 'collections'))return false;
  if(!s.length)return false;
  if(/^(en|cn)(-[a-z]{2})?$/i.test(s[0]))s.shift();
  if(!s.length)return false;
  const d=s[0].toLowerCase();
  if(d==='products'||d==='product'||d==='p'||d==='t')return s.length>1;
  return !['search','collections','category','categories','brands','brand','sale','new-arrivals'].includes(d);
}
