async function buildError(res: Response): Promise<Error> {
  try {
    const data = await res.json()
    if (data?.error) return new Error(data.error)
  } catch {
    // response body was not JSON — fall through to the status-based message
  }
  return new Error(`API error: ${res.status}`)
}

export function apiPath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH || ''
  if (!basePath || !path.startsWith('/') || path.startsWith(`${basePath}/`) || path === basePath) {
    return path
  }
  return `${basePath}${path}`
}

export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(apiPath(path), window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  if (!res.ok) throw await buildError(res)
  return res.json()
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiPath(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await buildError(res)
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiPath(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await buildError(res)
  return res.json()
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiPath(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await buildError(res)
  return res.json()
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(apiPath(path), { method: 'DELETE' })
  if (!res.ok) throw await buildError(res)
}
