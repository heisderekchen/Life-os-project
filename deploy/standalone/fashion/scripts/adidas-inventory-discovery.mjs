#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublic } from '../server.mjs';
import { sourceFetch } from '../connector.mjs';
import { adidasCatalogPages, adidasCatalogPhotos } from '../source-adapters.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_ADIDAS_INVENTORY_OUT ||
  resolve(here, '../../../../../../output/adidas-broad/adidas-inventory-discovery.json'));
const pageLimit = Number(process.env.FASHION_ADIDAS_INVENTORY_PAGES || 60);
const productLimit = Number(process.env.FASHION_ADIDAS_INVENTORY_PRODUCTS || 600);
const sourceURL = 'https://www.adidas.com.cn/siteMap';
const fetcher = sourceFetch(fetch);
const visited = new Set([sourceURL]);
const products = new Map();
const failures = [];
const add = items => {
  for (const item of items) {
    if (!item?.url || products.has(item.url)) continue;
    products.set(item.url, {
      articleId: item.productCode,
      title: item.title,
      url: item.url,
    });
  }
};
const read = url => getPublic(url, fetcher);
const first = await read(sourceURL);
add(adidasCatalogPhotos(first.html, first.url));
const frontier = [...products.values()].map(product => product.url);
frontier.push(...adidasCatalogPages(first.html, first.url));
const queued = new Set(frontier);
while (visited.size < pageLimit && frontier.length && products.size < productLimit) {
  const url = frontier.shift();
  queued.delete(url);
  if (!url || visited.has(url)) continue;
  visited.add(url);
  try {
    const page = await read(url);
    const final = new URL(page.url);
    if (final.hostname !== 'www.adidas.com.cn') throw Error('unexpected discovery host');
    add(adidasCatalogPhotos(page.html, page.url));
    for (const pageURL of adidasCatalogPages(page.html, page.url)) {
      if (visited.has(pageURL) || queued.has(pageURL)) continue;
      queued.add(pageURL);
      frontier.push(pageURL);
    }
    for (const product of products.values()) {
      if (visited.has(product.url) || queued.has(product.url)) continue;
      queued.add(product.url);
      frontier.push(product.url);
    }
  } catch (error) {
    failures.push({ url, error: error.message || String(error) });
  }
}
const evidence = {
  generatedAt: new Date().toISOString(),
  sourceURL,
  pageBudget: pageLimit,
  productBudget: productLimit,
  pagesVisited: visited.size,
  productsDiscovered: products.size,
  ids: [...products.values()].map(product => product.articleId),
  failures,
  complete: visited.size < pageLimit && frontier.length === 0,
  limitation: 'Bounded public PDP link-graph discovery only; image and full application verification are separate.',
};
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  output,
  pagesVisited: evidence.pagesVisited,
  productsDiscovered: evidence.productsDiscovered,
  failures: failures.length,
  complete: evidence.complete,
}));
