import { sourceFetch } from './connector.mjs';
import { createApp } from './server.mjs';
import { createAdmin } from './admin/server.mjs';
import { createFashionIntelligenceSearch } from './legacy-search.mjs';
import { resolve, dirname } from 'node:path';
import { mkdir, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
export function createFashionRouter({dataDir,authorizeAdmin,fetcher=fetch,photoSearch=true}) {
  fetcher=sourceFetch(fetcher);
  const customer=createApp({dataDir,fetcher,guestPreview:true,persistentSessions:true,cookiePath:'/fashion/',secureCookie:true,photoSearch});
  const admin=createAdmin({settingsFile:resolve(dataDir,'source-admin.json'),authorize:authorizeAdmin});
  const legacy=createFashionIntelligenceSearch({fetcher});
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
