import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSitemapCandidates, sitemapChildURLs, sitemapPageEntries } from '../sitemap-discovery.mjs';

test('sitemap index prefers current and previous monthly public feeds', () => {
  const xml = `<sitemapindex>
    <sitemap><loc>https://www.example.com/sitemap-news.xml</loc></sitemap>
    <sitemap><loc>https://www.example.com/sitemap-2026-08.xml</loc></sitemap>
    <sitemap><loc>https://www.example.com/sitemap-2026-10.xml</loc></sitemap>
  </sitemapindex>`;
  assert.deepEqual(sitemapChildURLs(xml, new Date('2026-10-20T00:00:00Z')), [
    'https://www.example.com/sitemap-2026-10.xml',
    'https://www.example.com/sitemap-news.xml',
    'https://www.example.com/sitemap-2026-08.xml',
  ]);
});

test('sitemap URL entries retain lastmod and public image declarations', () => {
  const xml = `<urlset><url>
    <loc>https://www.example.com/fashion/shoes/loafers</loc>
    <lastmod>2026-10-19T10:00:00Z</lastmod>
    <image:image><image:loc>https://cdn.example.com/loafer.jpg</image:loc></image:image>
  </url></urlset>`;
  assert.deepEqual(sitemapPageEntries(xml), [{
    url: 'https://www.example.com/fashion/shoes/loafers',
    lastModifiedAt: '2026-10-19T10:00:00Z',
    images: ['https://cdn.example.com/loafer.jpg'],
  }]);
});

test('recent sitemap discovery uses dates, domains and generic shoe intent without article-specific URLs', async () => {
  const readDocument = async url => {
    if (url.endsWith('/sitemap.xml')) return `<sitemapindex>
      <sitemap><loc>https://www.example.com/sitemap-2026-10.xml</loc></sitemap>
    </sitemapindex>`;
    return `<urlset>
      <url><loc>https://www.example.com/fashion/shopping/best-shoes-bags-2026</loc><lastmod>2026-10-13T09:00:00Z</lastmod>
        <image:image><image:loc>https://cdn.example.com/public-shoes.jpg</image:loc></image:image></url>
      <url><loc>https://www.example.com/fashion/shoes/old-loafers</loc><lastmod>2026-09-01T09:00:00Z</lastmod>
        <image:image><image:loc>https://cdn.example.com/old.jpg</image:loc></image:image></url>
      <url><loc>https://foreign.example/shoes/loafers</loc><lastmod>2026-10-19T09:00:00Z</lastmod>
        <image:image><image:loc>https://cdn.example.com/foreign.jpg</image:loc></image:image></url>
    </urlset>`;
  };
  const results = await recentSitemapCandidates({
    domain: 'www.example.com',
    readDocument,
    isRelevant: text => /\b(?:shoes?|loafers?)\b/i.test(text),
    days: 7,
    now: new Date('2026-10-20T00:00:00Z'),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://www.example.com/fashion/shopping/best-shoes-bags-2026');
  assert.equal(results[0].lastModifiedAt, '2026-10-13T09:00:00.000Z');
  assert.equal(results[0].publishedAt, undefined);
});
