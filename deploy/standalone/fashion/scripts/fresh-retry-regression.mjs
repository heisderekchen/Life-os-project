#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_RETRY_EVIDENCE ||
  resolve(here, '../../../../../../output/acceptance-300-clues-500-images/round24-fresh-retry-api.json'));
const dataDir = await mkdtemp(join(tmpdir(), 'fashion-fresh-retry-'));
const port = 4198;
const input = { subject: 'nike', days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] };

const makeProduct = number => {
  const code = `FRESH-${number}`;
  const id = `22222222-2222-2222-2222-${String(number).padStart(12, '0')}`;
  return {
    code,
    url: `https://www.nike.com/t/nike-public-fixture-${number}/${code}`,
    image: `https://static.nike.com/a/images/t_default/${id}/PUBLIC-FIXTURE-${number}.png`,
    id,
  };
};

let products = [makeProduct(1)];
let catalogReads = 0;
const fetcher = async value => {
  const url = new URL(String(value));
  if (url.hostname === 'www.nike.com' && url.pathname === '/w/shoes-y7ok') {
    catalogReads++;
    const productGroupings = [{ products: products.map(product => ({
      productType: 'FOOTWEAR',
      productCode: product.code,
      copy: { title: `Nike Public Fixture Shoes ${product.code}`, subTitle: "Men's Shoes" },
      pdpUrl: { url: product.url, canonicalUrl: product.url.split('/').slice(0, -1).join('/') },
      colorwayImages: { portraitURL: product.image },
    })) }];
    return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { initialState: {
      Wall: { pageData: { next: '' }, productGroupings },
    } } } })}</script>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const product = products.find(candidate => candidate.url === url.href);
  if (product) {
    const selectedProduct = {
      productType: 'FOOTWEAR', styleColor: product.code,
      productInfo: { fullTitle: `Nike Public Fixture Shoes ${product.code}` },
      pdpUrl: { url: product.url, canonicalUrl: product.url.split('/').slice(0, -1).join('/') },
      contentImages: [{ properties: { portrait: { id: product.id, url: product.image } } }],
    };
    return new Response(`<title>Nike Public Fixture Shoes ${product.code}</title><script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { selectedProduct } },
    })}</script><img src="${product.image}">`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (url.hostname === 'static.nike.com') {
    const bytes = Buffer.alloc(100);
    bytes[0] = 137; bytes.write('PNG', 1); bytes.writeUInt32BE(800, 16); bytes.writeUInt32BE(600, 20);
    bytes.writeUInt32BE(products.findIndex(candidate => url.href.includes(candidate.id)) + 1, 96);
    return new Response(bytes, { headers: { 'content-type': 'image/png' } });
  }
  throw Error('unexpected fixture URL ' + url.href);
};
fetcher.trustedRelayHosts = new Set(['www.nike.com', 'static.nike.com']);

const plans = [{
  id: 'catalog-v3', label: 'Nike官方鞋履目录', domains: ['nike.com'],
  catalogURL: 'https://www.nike.com/w/shoes-y7ok', catalogPages: 1,
  catalogProductLimit: 2, catalogImageLimit: 2, catalogResultLimit: 10,
  readerVersion: 3, timeoutMs: 5000,
}];
const app = createApp({ dataDir, guestPreview: true, planSources: async () => plans, fetcher });
await new Promise((ready, reject) => {
  app.server.once('error', reject);
  app.server.listen(port, '127.0.0.1', ready);
});
const base = `http://127.0.0.1:${port}/api`;
const session = await fetch(base + '/session');
const cookie = session.headers.get('set-cookie').split(';')[0];
const call = async (path, body) => {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json()) };
};

const startedAt = new Date().toISOString();
const created = await call('/tasks', input);
await Promise.all([...app.jobs.values()]);
let first = (await call('/tasks/' + created.task.id)).task;
if (first.items.length !== 1) throw Error('first fixture retrieval did not return one SKU');
await call('/tasks/' + created.task.id + '/review', {
  id: first.items[0].id, review: 'verified', selected: true, note: 'fixture human review',
});
products = [...products, makeProduct(2)];
const retryAt = new Date().toISOString();
await call('/tasks/' + created.task.id + '/retry', {});
await Promise.all([...app.jobs.values()]);
const final = (await call('/tasks/' + created.task.id)).task;
const account = (await session.json()).account;
const stored = JSON.parse(await readFile(join(dataDir, account + '.json'), 'utf8')).tasks[0];
const evidence = {
  round: 24,
  mode: 'fixture-backed application API',
  fixtureBasis: 'Shape observed from the live public Nike catalogue and PDP; product identities are deterministic test fixtures.',
  startedAt,
  retryAt,
  finishedAt: new Date().toISOString(),
  taskId: final.id,
  catalogReads,
  firstRun: {
    items: 1,
    reviewedSelected: first.items[0].selected,
    productCode: first.items[0].productCode,
  },
  freshRetry: {
    items: final.items.length,
    productCodes: final.items.map(item => item.productCode),
    retainedReview: final.items.find(item => item.productCode === 'FRESH-1')?.review,
    retainedSelected: final.items.find(item => item.productCode === 'FRESH-1')?.selected,
    newSkuFound: final.items.some(item => item.productCode === 'FRESH-2'),
    catalogRecordStatus: stored.sourceQueue?.records?.find(record => record.id === 'catalog-v3')?.status,
  },
  pass: catalogReads === 2 && final.items.length === 2
    && final.items.some(item => item.productCode === 'FRESH-2')
    && final.items.find(item => item.productCode === 'FRESH-1')?.review === 'verified'
    && final.items.find(item => item.productCode === 'FRESH-1')?.selected === true,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(evidence, null, 2));
await writeFile(resolve(dirname(output), 'round24-fresh-retry-final-task.json'), JSON.stringify(final, null, 2));
console.log(JSON.stringify(evidence));
await new Promise(close => app.server.close(close));
await rm(dataDir, { recursive: true, force: true });
if (!evidence.pass) process.exitCode = 1;
