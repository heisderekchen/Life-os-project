#!/usr/bin/env node
import { resolve } from 'node:path';
import { createSourceStore } from '../admin/store.mjs';
import { sourceFetch } from '../connector.mjs';
import { createApp } from '../server.mjs';
import { sourceSearchPlan } from '../source-planner.mjs';

const dataDir = process.env.FASHION_RESTART_DATA;
if (!dataDir) throw Error('FASHION_RESTART_DATA is required');
const port = Number(process.env.FASHION_RESTART_PORT || 4196);
const delayMs = Number(process.env.FASHION_RESTART_DELAY_MS || 0);
const raw = sourceFetch(fetch);
const fetcher = async (url, options = {}) => {
  if (String(url).includes('example.com') && delayMs) {
    await new Promise(resolveWait => setTimeout(resolveWait, delayMs));
  }
  return raw(url, options);
};
fetcher.trustedRelayHosts = raw.trustedRelayHosts;
const store = createSourceStore({
  registryFile: resolve(import.meta.dirname, '../data/source-registry.json'),
  settingsFile: resolve(dataDir, 'source-admin.json'),
});
const app = createApp({
  dataDir,
  fetcher,
  guestPreview: true,
  persistentSessions: true,
  planSources: async input => {
    const plans = sourceSearchPlan(input, (await store.read()).sources).slice(0, 1)
      .map(plan => ({ ...plan, sources: undefined, catalogPages: 1,
        catalogProductLimit: 1, catalogImageLimit: 2, catalogResultLimit: 5 }));
    plans.push({
      label: '重启测试迟延来源',
      domains: ['example.com'],
      sources: [{ domain: 'example.com', url: 'https://example.com/', feedUrls: [] }],
    });
    plans.excludedDomains = [];
    return plans;
  },
});
await new Promise((resolveReady, reject) => {
  app.server.once('error', reject);
  app.server.listen(port, '127.0.0.1', resolveReady);
});
console.log(JSON.stringify({ ready: true, port, dataDir, delayMs }));
