// Bound even dependencies that do not cooperate with AbortSignal (e.g. DNS).
export function abortable(operation, signal) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(operation);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
