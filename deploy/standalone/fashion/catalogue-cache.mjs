import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

// Keep exact public source bytes, not reconstructed HTML or product rows.
export function packCatalogueDocument(document) {
  const bytes = Buffer.from(document.html, 'utf8');
  return { url: document.url, fetchedAt: document.fetchedAt, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), compressed: gzipSync(bytes, { level: 1 }) };
}
export function restoreCatalogueDocument(record) {
  const bytes = gunzipSync(record.compressed, { maxOutputLength: 8 * 1024 * 1024 });
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw Error('目录缓存校验失败');
  const html = bytes.toString('utf8');
  return { url: record.url, html, parsed: JSON.parse(html), sha256: record.sha256, fetchedAt: record.fetchedAt };
}
export function catalogueSnapshotEvent(record) {
  return { url: record.url, fetchedAt: record.fetchedAt, sha256: record.sha256, rawBytes: record.bytes,
    compressedBytes: record.compressed.length, encoding: 'gzip+base64',
    chunks: record.compressed.toString('base64').match(/.{1,32768}/g) || [] };
}
