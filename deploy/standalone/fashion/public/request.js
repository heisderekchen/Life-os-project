export async function requestJSON(url, options = {}, { fetcher = fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('连接超时，请刷新状态或稍后重试。', 'TimeoutError');
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { ...options, signal: controller.signal, cache: 'no-store' });
        return { response, data: await response.json() };
      })(),
      timeout,
    ]);
  } finally { clearTimeout(timer); }
}
