import sharp from 'sharp';
export async function imageFingerprint(bytes) {
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().toColourspace('srgb').flatten({ background: '#ffffff' });
  const pixels = await image.clone().resize(9, 8, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let bits = 0n; const rgb = [0, 0, 0];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
    const p = (y * 9 + x) * 3;
    for (let c = 0; c < 3; c++) rgb[c] += pixels[p + c];
    if (x < 8) {
      const a = pixels[p] + pixels[p + 1] + pixels[p + 2], b = pixels[p + 3] + pixels[p + 4] + pixels[p + 5];
      bits = (bits << 1n) | (a > b ? 1n : 0n);
    }
  }
  const average = rgb.map(v => Math.round(v / 72));
  if (average.every(v => v < 25) || average.every(v => v > 252)) {
    const error = Error('图片主体过暗或近乎空白，未达到可用图片线索标准'); error.code = 'IMAGE_QUALITY'; throw error;
  }
  return { hash: bits.toString(16).padStart(16, '0'), rgb: average };
}
export function similarImage(a, b, { distance: maximum = 3, color = 3 } = {}) {
  if (!a?.hash || !b?.hash || !a.rgb || !b.rgb) return false;
  if (a.rgb.some((v, i) => Math.abs(v - b.rgb[i]) > color)) return false;
  let xor = BigInt('0x' + a.hash) ^ BigInt('0x' + b.hash), distance = 0;
  while (xor) { xor &= xor - 1n; if (++distance > maximum) return false; }
  return true;
}
