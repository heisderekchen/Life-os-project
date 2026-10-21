import { sourceFetch } from './connector.mjs';
import { createApp } from './server.mjs';
import { sourceSearchPlan } from './source-planner.mjs';
import { deepseekSearchReady } from './deepseek-search.mjs';
import { createSearchBudget } from './search-budget.mjs';
import { createAdmin } from './admin/server.mjs';
import { createFashionIntelligenceSearch } from './legacy-search.mjs';
import { resolve, dirname } from 'node:path';
import { mkdir, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
export function createFashionRouter({dataDir,authorizeAdmin,fetcher=fetch,photoSearch=true,deepseekRelay=null}) {
  fetcher=sourceFetch(fetcher);
  if (deepseekRelay) fetcher.deepseekRelay = deepseekRelay;
  const admin=createAdmin({settingsFile:resolve(dataDir,'source-admin.json'),authorize:authorizeAdmin});
  const customer=createApp({dataDir,fetcher,guestPreview:true,persistentSessions:true,cookiePath:'/fashion/',secureCookie:true,photoSearch,
    planSources: async input => {
      if (deepseekSearchReady(fetcher)) {
        const sources = (await admin.store.read()).sources;
        const selected = new Set(input.sources || ['official', 'media', 'retail']);
        const categories = { official: ['brand'], media: ['media', 'industry', 'trend'], retail: ['retail'] };
        const groups = new Set([...selected].flatMap(id => categories[id] || []));
        const allClasses = ['official', 'media', 'retail'].every(id => selected.has(id));
        const domains = input.domains?.length ? input.domains : allClasses ? [] : sources.filter(s => groups.has(s.category) && s.review !== 'exclude').map(s => s.domain);
        const plans = [{ deepseek: true, domains, label: 'DeepSeek 商品发现' }];
        plans.excludedDomains = sources.filter(s => s.review === 'exclude').map(s => s.domain);
        return plans;
      }
      return sourceSearchPlan(input, (await admin.store.read()).sources);
    }});
  const legacy=createFashionIntelligenceSearch({fetcher});
  const allowSearch = createSearchBudget({ file: resolve(dataDir, 'search-budget.json') });
  let initialized;
  async function seed() {
    if(!initialized) initialized=(async()=>{
      await mkdir(dataDir,{recursive:true,mode:0o700});
      try{await access(resolve(dataDir,'source-admin.json'));}catch(e){if(e.code!=='ENOENT')throw e;try{await copyFile(resolve(HERE,'data/source-admin-seed.json'),resolve(dataDir,'source-admin.json'),1);}catch(e){if(e.code!=='ENOENT'&&e.code!=='EEXIST')throw e;}}
    })();
    await initialized;
  }
  return async function handleFashion(req,res) {
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    if(path==='/fashion'||path==='/fashion-admin'){res.writeHead(308,{location:path+'/', 'cache-control':'no-store'});res.end();return true;}
    if(path.startsWith('/fashion-admin/')) {await seed();req.url=req.url.slice('/fashion-admin'.length);await admin.handle(req,res);return true;}
    if(!path.startsWith('/fashion/'))return false;
    if (deepseekSearchReady(fetcher) && req.method === 'POST' && /^\/fashion\/api\/tasks(?:\/[a-f0-9]+\/retry)?$/.test(path)) {
      const remote = req.socket?.remoteAddress || 'unknown';
      const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
      const client = localProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',').at(-1).trim() : remote;
      if (customer.jobs.size >= 6 || !allowSearch(client)) {
        res.writeHead(429, { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '3600' });
        res.end(JSON.stringify({ error: '搜索次数或并发已达本轮上限，请稍后重试。' })); return true;
      }
    }
    if(path.startsWith('/fashion/api/search/')){
      if(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`){res.writeHead(403);res.end();return true;}
      let body='';for await(const part of req){body+=part;if(body.length>8192){res.writeHead(413);res.end();return true;}}
      const target=new URL('https://localhost'+req.url.replace('/fashion/api/','/fashion-intelligence/api/'));
      const response=await legacy(new Request(target,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:body}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return true;
    }
    await seed();req.url=req.url.slice('/fashion'.length);await customer.handle(req,res);return true;
  };
}
