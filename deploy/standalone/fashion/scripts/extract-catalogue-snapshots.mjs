#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { restoreCatalogueDocument } from '../catalogue-cache.mjs';
const traceFile=process.argv[2];
if(!traceFile)throw Error('Usage: node extract-catalogue-snapshots.mjs trace.jsonl [output-directory]');
const output=resolve(process.argv[3]||join(dirname(resolve(traceFile)),'catalogue-snapshots'));
await mkdir(output,{recursive:true,mode:0o700});let count=0;
for(const line of (await readFile(traceFile,'utf8')).split('\n')){
 if(!line.trim())continue;const event=JSON.parse(line),d=event.data;
 if(event.type!=='catalogue.source.snapshot')continue;
 if(d?.encoding!=='gzip+base64'||!Array.isArray(d.chunks)||!/^[a-f0-9]{64}$/.test(d.sha256))throw Error('Invalid source snapshot');
 const document=restoreCatalogueDocument({...d,compressed:Buffer.from(d.chunks.join(''),'base64')});
 const target=join(output,d.sha256+'.json');
 try{await writeFile(target,document.html,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await readFile(target,'utf8')!==document.html)throw e;}
 count++;
}
console.log(JSON.stringify({snapshots:count,output}));
