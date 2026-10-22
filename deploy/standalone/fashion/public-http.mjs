import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
// Compatibility transport for public storefront JSON. No shell, redirects,
// cookies, credential files or environment secrets are passed to curl.
export async function publicJSONResponse(url, signal) {
  const { stdout } = await exec('curl', ['--disable', '--silent', '--show-error', '--compressed',
    '--max-time', '15', '--max-filesize', '8388608', '--proto', '=https', '--dump-header', '-', '--url', String(url)],
    { encoding: 'buffer', maxBuffer: 9 * 1024 * 1024, signal, env: { PATH: process.env.PATH } });
  let body = stdout, status, headers;
  while (body.subarray(0, 5).toString() === 'HTTP/') {
    const end = body.indexOf('\r\n\r\n');
    if (end < 0) throw Error('公开数据响应头不完整');
    const lines = body.subarray(0, end).toString().split('\r\n');
    status = Number(lines.shift().split(' ')[1]); headers = new Headers();
    for (const line of lines) {
      const split = line.indexOf(':'); if (split < 1) continue;
      const key = line.slice(0, split).toLowerCase();
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(key)) headers.append(key, line.slice(split + 1).trim());
    }
    body = body.subarray(end + 4);
  }
  if (!status) throw Error('公开数据未返回 HTTP 状态');
  return new Response([204, 304].includes(status) ? null : body, { status, headers });
}
