import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';import{createSourceStore}from'./store.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
export function createAdmin({registryFile=resolve(here,'../data/source-registry.json'),settingsFile=resolve(here,'../.data/source-admin.json'),authorize=null}={}){
 const store=createSourceStore({registryFile,settingsFile});
 const server=createServer(async(req,res)=>{const port=server.address()?.port,allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
  // This preview has a separate loopback listener, never attached to the customer tunnel.
  if(authorize ? !(await authorize(req)) : (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!allowedHosts.includes(req.headers.host)||req.headers['x-forwarded-host']||req.headers.forwarded||req.headers['cf-connecting-ip']))return json(res,403,{error:'来源管理只允许本机访问。'});
  if(!authorize&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'请求来源无效。'});
  try{const url=new URL(req.url,'http://'+req.headers.host);
   if(url.pathname==='/api/sources'&&req.method==='GET')return json(res,200,await store.read());
   const match=url.pathname.match(/^\/api\/sources\/(fs-[a-f0-9]{12})$/);
   if(match&&req.method==='PATCH'){if(!/^application\/json\b/.test(req.headers['content-type']||''))return json(res,415,{error:'请求格式无效。'});let bytes=0,body='';for await(const chunk of req){bytes+=chunk.length;if(bytes>16000)throw Error('内容过长');body+=chunk;}const data=JSON.parse(body);return json(res,200,await store.update(match[1],data.changes,data.revision));}
   const pages={'/settings/sources':'source-settings.html','/settings/sources/':'source-settings.html','/admin.css':'admin.css','/admin.js':'admin.js'};
   if(url.pathname==='/'&&req.method==='GET'){res.writeHead(302,{location:'/settings/sources'});return res.end();}
   const legacy=url.pathname.match(/^\/legacy\/([a-z0-9-]+\.(?:html|js))$/); const file=pages[url.pathname]||(['/migration.html','/migration.js'].includes(url.pathname)?url.pathname.slice(1):legacy?'legacy/'+legacy[1]:null);if(!file||req.method!=='GET')return json(res,404,{error:'未找到页面'});
   const contents=await readFile(resolve(here,'public',file));res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':file.startsWith('legacy/') ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src https: data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" : "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});res.end(contents);
  }catch(error){json(res,error.status||400,{error:error.code?'来源配置读取或保存失败':error.message});}
 });return{server,store,handle:server.listeners("request")[0]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const{server}=createAdmin();const port=Number(process.env.SHOE_ADMIN_PORT||4178);server.listen(port,'127.0.0.1',()=>console.log(`桌面来源管理：http://127.0.0.1:${port}/settings/sources`));}
