import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
export const categories=[['brand','品牌与企业'],['media','专业媒体'],['retail','零售与买手'],['industry','行业机构与展会'],['trend','趋势与材料']];
export const reviews=[['pending','待整理'],['retain','保留'],['exclude','排除']];
export const priorities=[['high','优先'],['normal','常规'],['reserve','备用']];
const categoryOf=value=>({'专业媒体':'media','零售平台':'retail','时装周与行业机构':'industry','设计趋势与材料资料':'trend'}[value]||'brand');
export function createSourceStore({registryFile,settingsFile}){
 let queue=Promise.resolve();
 async function state(){try{const d=JSON.parse(await readFile(settingsFile,'utf8'));if(!Number.isInteger(d.revision)||!d.overrides||typeof d.overrides!=='object')throw Error('来源设置格式异常');return d;}catch(error){if(error.code==='ENOENT')return{revision:0,overrides:{}};throw error;}}
 async function read(){const registry=JSON.parse(await readFile(registryFile,'utf8')),settings=await state();return{revision:settings.revision,categories,reviews,priorities,collectedDate:registry.collectedDate,sources:registry.sources.map(source=>({...source,originalCategory:source.category,category:categoryOf(source.category),review:'pending',priority:'normal',note:'',tags:source.shoeRelevance==='鞋履直接相关'?['鞋履相关']:[],...(settings.overrides[source.id]||{})}))};}
 function update(id,changes,revision){const job=queue.then(async()=>{const data=await read();if(data.revision!==revision){const error=Error('来源设置已被更新，请刷新后再保存。');error.status=409;throw error;}if(!data.sources.some(source=>source.id===id)){const error=Error('未找到来源');error.status=404;throw error;}
  const allowed=['category','review','priority','tags','note'];if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>!allowed.includes(key)))throw Error('设置字段无效');
  const patch={};for(const key of ['category','review','priority'])if(key in changes){const values={category:categories,review:reviews,priority:priorities}[key].map(([value])=>value);if(!values.includes(changes[key]))throw Error('分类或状态无效');patch[key]=changes[key];}
  if('note' in changes){if(typeof changes.note!=='string'||changes.note.length>2000)throw Error('备注最多2000字');patch.note=changes.note.trim();}
  if('tags' in changes){if(!Array.isArray(changes.tags)||changes.tags.length>12||changes.tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>24))throw Error('标签格式无效');patch.tags=[...new Set(changes.tags.map(tag=>tag.trim()))];}
  const settings=await state();settings.overrides[id]={...(settings.overrides[id]||{}),...patch,updatedAt:new Date().toISOString()};settings.revision++;
  await mkdir(dirname(settingsFile),{recursive:true});const temporary=settingsFile+'.tmp';await writeFile(temporary,JSON.stringify(settings,null,2),{mode:0o600});await rename(temporary,settingsFile);return read();
 });queue=job.catch(()=>{});return job;}
 return{read,update};
}
