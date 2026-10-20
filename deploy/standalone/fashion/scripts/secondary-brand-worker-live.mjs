#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFetch } from '../connector.mjs';
import { searchPhotos } from '../photo-search.mjs';
import { getImage, getPublic } from '../server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_SECONDARY_OUT ||
  resolve(here, '../../../../../../output/adidas-broad/secondary-puma-spotcheck.json'));
const sourceURL = 'https://us.puma.com/us/en/collaborations/select/speedcat';
const input = { subject: 'Puma Speedcat', days: 0, domains: [], sourceScope: 0 };
const plans = [{
  label: 'Puma Speedcat 来源页',
  domains: ['us.puma.com'],
  sources: [{ domain: 'us.puma.com', url: sourceURL, feedUrls: [] }],
  readerVersion: 2,
}];
plans.excludedDomains = [];
const saved = new Map();
const result = await searchPhotos(input, {
  plans,
  fetcher: sourceFetch(fetch),
  readPage: getPublic,
  readDocument: (url, fetcher) => getPublic(url, fetcher, 0, true),
  readImage: getImage,
  saveAsset: async (sha256, asset) => saved.set(sha256, asset.bytes.length),
  signal: AbortSignal.timeout(90000),
});
const evidence = {
  capturedAt: new Date().toISOString(),
  input,
  sourceURL,
  items: result.items.map(item => ({
    title: item.title,
    sourcePage: item.url,
    canonicalURL: item.canonicalURL,
    source: item.source,
    productCode: item.productCode,
    clueKey: item.clueKey,
    imageURL: item.image,
    imageSha256: item.imageSha256,
    cachedBytes: saved.get(item.imageSha256) || 0,
    sourceImageMatched: item.sourceImageMatched,
    productTypeEvidence: item.productTypeEvidence,
  })),
  channels: result.channels,
  counts: {
    leads: new Set(result.items.map(item => item.clueKey)).size,
    images: new Set(result.items.map(item => item.imageSha256)).size,
    verifiedFiles: result.items.filter(item => saved.has(item.imageSha256)).length,
  },
};
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ output, counts: evidence.counts, channel: result.channels[0] }));
process.exit(evidence.counts.verifiedFiles > 0 ? 0 : 1);
