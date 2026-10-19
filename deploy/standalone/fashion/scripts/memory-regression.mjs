#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { searchPhotos, PAGE_CACHE_LIMIT, PAGE_CACHE_BYTE_LIMIT, PAGE_READ_CONCURRENCY, createPageReadLimiter } from '../photo-search.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_MEMORY_EVIDENCE ||
  resolve(here, '../../../../../../output/acceptance-300-clues-500-images/round25-memory-regression.json'));
const pageBytesTarget = Number(process.env.FASHION_MEMORY_PAGE_BYTES || 1_800_000);
const productCount = Number(process.env.FASHION_MEMORY_PRODUCTS || 600);
const heapLimitMiB = getHeapStatistics().heap_size_limit / 1024 / 1024;
const maxOldSpaceFlagMiB = Number(process.execArgv.find(value => value.startsWith('--max-old-space-size='))?.split('=')[1] || 0) || null;

const uuid = (number, suffix) =>
  `11111111-1111-1111-1111-${String(number).padStart(8, '0')}${String(suffix).padStart(4, '0')}`;

function product(number) {
  const code = `MEM-${String(number).padStart(4, '0')}`;
  return {
    code,
    url: `https://www.nike.com/t/memory-shoe-${number}/${code}`,
    canonical: `https://www.nike.com/t/memory-shoe-${number}`,
    portrait: uuid(number, 1),
    side: uuid(number, 2),
  };
}

function catalogHTML(products) {
  const wall = {
    props: {
      pageProps: {
        initialState: {
          Wall: {
            pageData: { next: '' },
            productGroupings: [{
              products: products.map(item => ({
                productType: 'FOOTWEAR',
                productCode: item.code,
                copy: { title: `Nike Memory Shoes ${item.code}`, subTitle: "Men's Shoes" },
                pdpUrl: { url: item.url, canonicalUrl: item.canonical },
                colorwayImages: {
                  portraitURL: `https://static.nike.com/a/images/t_default/${item.portrait}/MEMORY.png`,
                },
              })),
            }],
          },
        },
      },
    },
  };
  return `<script id="__NEXT_DATA__">${JSON.stringify(wall)}</script>`;
}

function productHTML(item) {
  const page = {
    props: {
      pageProps: {
        selectedProduct: {
          productType: 'FOOTWEAR',
          styleColor: item.code,
          productInfo: { fullTitle: `Nike Memory Shoes ${item.code}` },
          pdpUrl: { url: item.url, canonicalUrl: item.canonical },
          contentImages: [
            { properties: { portrait: { id: item.portrait, url: `https://static.nike.com/a/images/t_default/${item.portrait}/MEMORY.png` } } },
            { properties: { portrait: { id: item.side, url: `https://static.nike.com/a/images/t_default/${item.side}/MEMORY-SIDE.png` } } },
          ],
        },
      },
    },
  };
  const fixture = `<script id="__NEXT_DATA__">${JSON.stringify(page)}</script>`;
  const padding = Math.max(0, pageBytesTarget - fixture.length);
  return fixture + `<div aria-hidden="true">${'x'.repeat(padding)}</div>`;
}

function tinyPNG(seed) {
  const bytes = Buffer.alloc(100);
  bytes[0] = 137;
  bytes.write('PNG', 1);
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(600, 20);
  createHash('sha256').update(seed).digest().copy(bytes, 24, 0, 32);
  return { bytes, mime: 'image/png' };
}

function memorySampler() {
  let peakHeapUsed = 0;
  let peakRss = 0;
  const sample = () => {
    const usage = process.memoryUsage();
    peakHeapUsed = Math.max(peakHeapUsed, usage.heapUsed);
    peakRss = Math.max(peakRss, usage.rss);
  };
  const timer = setInterval(sample, 10);
  sample();
  return {
    stop() {
      clearInterval(timer);
      sample();
      return {
        peakHeapUsedMiB: +(peakHeapUsed / 1024 / 1024).toFixed(1),
        peakRssMiB: +(peakRss / 1024 / 1024).toFixed(1),
      };
    },
  };
}

async function run(label, products, pageSource) {
  let pageReads = 0;
  const sampler = memorySampler();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = await searchPhotos({ subject: 'nike', days: 0, domains: [], sourceScope: 0 }, {
    plans: [{
      id: `memory-${label}`,
      label: 'memory fixture catalogue',
      domains: ['nike.com'],
      catalogURL: 'https://www.nike.com/w/shoes-y7ok',
      catalogPages: 1,
      catalogProductLimit: products.length,
      catalogImageLimit: 2,
      catalogResultLimit: products.length * 2,
      readerVersion: 3,
      timeoutMs: 60_000,
    }],
    fetcher: async () => { throw Error('network fetch is not used by this replay'); },
    readPage: async url => {
      pageReads++;
      if (url === 'https://www.nike.com/w/shoes-y7ok') return { url, html: catalogHTML(products) };
      const item = products.find(candidate => candidate.url === url);
      if (!item) throw Error('unexpected replay URL ' + url);
      return { url, html: pageSource(item) };
    },
    readImage: async url => tinyPNG(url),
    saveAsset: async () => {},
    resultLimit: products.length * 2,
    incrementalProgress: true,
    pageCacheLimit: PAGE_CACHE_LIMIT,
    pageCacheByteLimit: PAGE_CACHE_BYTE_LIMIT,
    limitPageRead: createPageReadLimiter(PAGE_READ_CONCURRENCY),
  });
  const memory = sampler.stop();
  return {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    products: products.length,
    pageReads,
    expectedPageReads: products.length + 1,
    items: result.items.length,
    distinctImages: new Set(result.items.map(item => item.imageSha256)).size,
    pageBytesTarget,
    ...memory,
    pass: pageReads === products.length + 1 &&
      result.items.length === products.length * 2 &&
      memory.peakHeapUsedMiB < heapLimitMiB,
  };
}

const coldProducts = Array.from({ length: productCount }, (_, index) => product(index + 1));
const cold = await run('cold-distinct-local-replay', coldProducts, productHTML);
if (global.gc) global.gc();
const warmCount = Math.min(48, coldProducts.length);
const warmProducts = coldProducts.slice(0, warmCount);
const warmPages = new Map(warmProducts.map(item => [item.url, productHTML(item)]));
const warm = await run('warm-resident-local-replay', warmProducts, item => warmPages.get(item.url));
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  maxOldSpaceFlagMiB,
  heapLimitMiB: +heapLimitMiB.toFixed(1),
  pageCacheLimit: PAGE_CACHE_LIMIT,
  pageCacheByteLimit: PAGE_CACHE_BYTE_LIMIT,
  pageReadConcurrency: PAGE_READ_CONCURRENCY,
  limitation: 'Local cold/warm replay validates page-cache retention under a restricted V8 heap; it does not claim another live 1000-source network crawl.',
  cold,
  warm,
  pass: cold.pass && warm.pass,
};
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.pass) process.exitCode = 1;
