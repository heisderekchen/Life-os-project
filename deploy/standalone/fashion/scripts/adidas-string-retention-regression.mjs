#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { adidasCatalogPhotos, adidasProductPhotos } from '../source-adapters.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_ADIDAS_STRING_EVIDENCE ||
  resolve(here, '../../../../../../output/adidas-broad/adidas-string-retention.json'));
const iterations = Number(process.env.FASHION_MEMORY_PRODUCTS || 160);
const pageBytes = Number(process.env.FASHION_MEMORY_PAGE_BYTES || 1_800_000);
const heapLimitMiB = getHeapStatistics().heap_size_limit / 1024 / 1024;
let peakHeapUsed = 0;
let peakRss = 0;
const sample = () => {
  const usage = process.memoryUsage();
  peakHeapUsed = Math.max(peakHeapUsed, usage.heapUsed);
  peakRss = Math.max(peakRss, usage.rss);
};

const retained = [];
const started = performance.now();
for (let index = 0; index < iterations; index++) {
  const code = `AB${String(1000 + index)}`;
  const title = `Memory Product ${index} Shoes`;
  const productURL = `https://www.adidas.com.cn/pdp?articleId=${code}`;
  const image = `https://static1.adidas.com.cn/t395/memory-${index}.jpeg`;
  let catalog = `<a href="/pdp?articleId=${code}">${title}</a>`;
  catalog += `<i>${'x'.repeat(Math.max(0, pageBytes - catalog.length - 16))}</i>`;
  let pdp = `<title>阿迪达斯-${title} | adidas</title>
    <div data-anchor="pdp-product-detail"><div class="lib-detail-image"><img src="${image}" alt="${title}"></div></div>
    <div data-anchor="pdp-product-recommend"><img src="https://static1.adidas.com.cn/t395/other.jpeg" alt="Adidas Other Shoes"></div>`;
  pdp += `<i>${'x'.repeat(Math.max(0, pageBytes - pdp.length - 16))}</i>`;
  retained.push(
    adidasCatalogPhotos(catalog, 'https://www.adidas.com.cn/siteMap')[0],
    adidasProductPhotos(pdp, productURL)[0],
  );
  catalog = '';
  pdp = '';
  sample();
  global.gc?.();
}
sample();
const report = {
  generatedAt: new Date().toISOString(),
  iterations,
  pageBytes,
  extracted: retained.filter(Boolean).length,
  expected: iterations * 2,
  peakHeapUsedMiB: +(peakHeapUsed / 1024 / 1024).toFixed(1),
  peakRssMiB: +(peakRss / 1024 / 1024).toFixed(1),
  heapLimitMiB: +heapLimitMiB.toFixed(1),
  durationMs: Math.round(performance.now() - started),
  limitation: 'Local repeated 1.8 MB page replay checks retained extracted strings; it is not a claim of another live network crawl.',
};
report.pass = Boolean(global.gc) && report.extracted === report.expected &&
  report.peakHeapUsedMiB < report.heapLimitMiB && report.peakRssMiB < 128;
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ output, ...report }));
if (!report.pass) process.exitCode = 1;
